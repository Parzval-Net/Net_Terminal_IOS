//! Conexiones activas: shell local y SSH (sobre PTY), Telnet (TCP nativo) y Serial.
//! Cada conexión empuja bytes crudos al frontend por un `Channel`, opcionalmente los
//! registra en un log de texto plano y mantiene un historial limpio que leen los
//! scripts y los agentes de IA (MCP).

use crate::autofill::AutoFill;
use crate::logfile::{LogOptions, LogVars, LogWriter};
use crate::models::{Session, SessionType};
use crate::telnet::{self, TelnetShared};
use crate::triggers::{self, Watcher};
use portable_pty::{native_pty_system, ChildKiller, CommandBuilder, MasterPty, PtySize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::{Shutdown, TcpStream, ToSocketAddrs};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::Sender;
use std::sync::{Arc, Condvar, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tauri::ipc::{Channel, InvokeResponseBody};
use zeroize::Zeroizing;

const HISTORY_MAX: usize = 256 * 1024;

/// Salida en texto limpio: historial acotado + suscriptores en vivo (scripts, MCP).
#[derive(Default)]
struct Mirror {
    stripper: AnsiStripper,
    /// Búfer reutilizado entre llamadas (evita una asignación por fragmento).
    scratch: Vec<u8>,
    /// Bytes de un carácter UTF-8 que quedó partido entre dos fragmentos (máx. 3).
    partial: Vec<u8>,
    history: String,
    taps: Vec<std::sync::mpsc::SyncSender<String>>,
    /// Alertas por palabra clave (sin reglas, una lectura atómica por fragmento).
    watch: Option<Watcher>,
    /// Autocompletado de contraseña: solo en sesiones con contraseña guardada y hasta
    /// que responde o se descarta (luego se suelta y la contraseña se borra de memoria).
    autofill: Option<(AutoFill, Sender<Outgoing>)>,
    /// Bytes de texto limpio recibidos desde la conexión (posición absoluta en la salida).
    written: u64,
    /// Inicio de la línea del último pedido respondido con la contraseña guardada (por el
    /// autocompletado o por un script): cada pedido se responde una sola vez.
    answered: Option<u64>,
    /// Intentos de contraseña de saltos ya hechos (uno por paso de cada salto): nunca se repite.
    hop_tokens: Vec<String>,
}

/// Cuántos bytes finales son el comienzo de un carácter UTF-8 todavía incompleto.
fn incomplete_utf8_tail(b: &[u8]) -> usize {
    for i in 1..=b.len().min(3) {
        let c = b[b.len() - i];
        if c & 0xC0 == 0x80 {
            continue;
        }
        let needed = match c {
            0xF0.. => 4,
            0xE0.. => 3,
            0xC0.. => 2,
            _ => 1,
        };
        return if needed > i { i } else { 0 };
    }
    0
}

pub const HOP_ONE_TRY: &str = "La contraseña de este salto ya se intentó una vez: no se reintenta";
pub const HOP_NO_ECHO: &str = "El pedido de contraseña no viene después del comando de salto";

/// Fragmentos pendientes por suscriptor. Un script que solo envía y nunca lee no debe
/// acumular toda la salida de la sesión en memoria: pasado el tope se descarta.
const TAP_CAPACITY: usize = 8192;

impl Mirror {
    fn push(&mut self, bytes: &[u8]) {
        let mut clean = std::mem::take(&mut self.scratch);
        clean.clear();
        clean.append(&mut self.partial);
        self.stripper.strip_into(bytes, &mut clean);
        // Un carácter partido (á, ñ, ─) se completa con el fragmento siguiente en vez de
        // convertirse en U+FFFD para scripts y agentes.
        let keep = incomplete_utf8_tail(&clean);
        self.partial.extend_from_slice(&clean[clean.len() - keep..]);
        let text = String::from_utf8_lossy(&clean[..clean.len() - keep]);
        if !text.is_empty() {
            if !self.taps.is_empty() {
                let owned = text.to_string();
                self.taps
                    .retain(|t| !matches!(t.try_send(owned.clone()), Err(std::sync::mpsc::TrySendError::Disconnected(_))));
            }
            self.history.push_str(&text);
            self.written += text.len() as u64;
            // Se recorta al doble del tope: mover 256 KB en cada fragmento costaba más que
            // todo lo demás. `history()` nunca entrega más de HISTORY_MAX.
            if self.history.len() > 2 * HISTORY_MAX {
                let mut cut = self.history.len() - HISTORY_MAX;
                while !self.history.is_char_boundary(cut) {
                    cut += 1;
                }
                self.history.drain(..cut);
            }
            if let Some(w) = self.watch.as_mut() {
                w.feed(&text);
            }
            if self.autofill.is_some() {
                self.run_autofill(&text);
            }
        }
        drop(text);
        self.scratch = clean;
    }

    fn run_autofill(&mut self, text: &str) {
        let Some((af, tx)) = self.autofill.as_mut() else {
            return;
        };
        // Va por el hilo de escritura: mismo orden que lo tecleado y nunca pasa por el
        // log, el historial ni los suscriptores (solo ven lo que devuelve el equipo).
        let sent = af.feed(text, Instant::now()).map(|bytes| tx.send(Outgoing::Secret(bytes))).is_some();
        if af.done() {
            self.autofill = None;
        }
        // Ese pedido ya tuvo respuesta: un script no la vuelve a escribir encima.
        if sent {
            self.answered = Some(self.line_start());
        }
    }

    /// Posición absoluta donde empieza la línea actual (la última del historial).
    fn line_start(&self) -> u64 {
        let h = &self.history;
        let last = h.rfind('\n').map_or(0, |i| i + 1);
        self.written - (h.len() - last) as u64
    }

    /// Escribe la contraseña guardada si la pantalla muestra ahora un pedido de login que no se
    /// respondió (ver `autofill::screen_prompt`). Como el autocompletado, va por el hilo de
    /// escritura y nunca pasa por el log, el historial ni los suscriptores.
    fn type_secret(&mut self, tx: &Sender<Outgoing>, secret: &str, newline: &str, host: Option<&str>, strict: bool) -> Result<(), String> {
        let tail = self.tail(2048);
        let start = crate::autofill::screen_prompt(tail, host, strict)?;
        let at = self.written - (tail.len() - start) as u64;
        if self.answered == Some(at) {
            return Err("Ese pedido de contraseña ya se respondió: se escribe una vez por pedido".into());
        }
        let mut out = Zeroizing::new(Vec::with_capacity(secret.len() + newline.len()));
        out.extend_from_slice(secret.as_bytes());
        out.extend_from_slice(newline.as_bytes());
        tx.send(Outgoing::Secret(out)).map_err(|_| "La conexión se cerró".to_string())?;
        self.answered = Some(at);
        Ok(())
    }

    /// Contraseña de un salto (Topología): como `type_secret`, pero el pedido tiene que venir
    /// después del eco del comando de salto (`after`, ya enviado a esta conexión) y se hace un solo
    /// intento por `token` (paso del salto): un nuevo "Password:" tras un rechazo no se responde.
    /// El token se gasta solo cuando se escribe; un pedido que aún no llega se puede reintentar.
    fn type_hop_secret(&mut self, tx: &Sender<Outgoing>, secret: &str, newline: &str, host: &str, after: &str, token: &str) -> Result<(), String> {
        if self.hop_tokens.iter().any(|t| t == token) {
            return Err(HOP_ONE_TRY.into());
        }
        let tail = self.tail(8192);
        let echo = tail.rfind(after).ok_or(HOP_NO_ECHO)?;
        let start = crate::autofill::screen_prompt(tail, Some(host), false)?;
        if start <= echo {
            return Err(HOP_NO_ECHO.into());
        }
        let at = self.written - (tail.len() - start) as u64;
        if self.answered == Some(at) {
            return Err("Ese pedido de contraseña ya se respondió: se escribe una vez por pedido".into());
        }
        let mut out = Zeroizing::new(Vec::with_capacity(secret.len() + newline.len()));
        out.extend_from_slice(secret.as_bytes());
        out.extend_from_slice(newline.as_bytes());
        self.hop_tokens.push(token.to_string());
        if self.hop_tokens.len() > 64 {
            self.hop_tokens.remove(0);
        }
        tx.send(Outgoing::Secret(out)).map_err(|_| "La conexión se cerró".to_string())?;
        self.answered = Some(at);
        Ok(())
    }

    /// Últimos `max` bytes (como máximo HISTORY_MAX), cortados en un límite de carácter.
    fn tail(&self, max: usize) -> &str {
        let h = &self.history;
        let mut start = h.len().saturating_sub(max.min(HISTORY_MAX));
        while !h.is_char_boundary(start) {
            start += 1;
        }
        &h[start..]
    }
}

/// Ventana de agrupación hacia el frontend. Un fragmento aislado (eco de una tecla) sale
/// de inmediato; en una ráfaga se envía como máximo un mensaje por ventana. Cada envío es
/// un `eval` en el hilo principal del webview y un PTY entrega a menudo una línea por
/// lectura (~10 bytes), así que sin agrupar un `show run` largo genera cientos de miles.
const FLUSH_WINDOW: Duration = Duration::from_millis(4);
/// Con esta cantidad pendiente se envía sin esperar el resto de la ventana.
const FLUSH_MAX: usize = 256 * 1024;

#[derive(Default)]
struct Pending {
    buf: Vec<u8>,
    closed: bool,
}

/// Bytes pendientes de enviar al frontend y el hilo que los agrupa.
struct Outbox {
    data: Channel<InvokeResponseBody>,
    pending: Mutex<Pending>,
    ready: Condvar,
    /// Tomar el búfer y enviarlo es atómico respecto de otros envíos (mantiene el orden).
    send_lock: Mutex<()>,
}

impl Outbox {
    fn start(data: Channel<InvokeResponseBody>) -> Arc<OutboxHandle> {
        let ob = Arc::new(Outbox { data, pending: Mutex::default(), ready: Condvar::new(), send_lock: Mutex::new(()) });
        let worker = ob.clone();
        thread::spawn(move || worker.run());
        Arc::new(OutboxHandle(ob))
    }

    fn push(&self, bytes: &[u8]) {
        lock(&self.pending).buf.extend_from_slice(bytes);
        self.ready.notify_one();
    }

    /// Envía lo pendiente.
    fn flush(&self) {
        let _order = lock(&self.send_lock);
        self.flush_locked();
    }

    fn flush_locked(&self) {
        let buf = std::mem::take(&mut lock(&self.pending).buf);
        if !buf.is_empty() {
            let _ = self.data.send(InvokeResponseBody::Raw(buf));
        }
    }

    /// Envía lo pendiente y después el aviso de cierre por el mismo canal (un string JSON;
    /// los datos van como binario). El canal del frontend entrega en orden de índice, así
    /// que el cierre nunca se adelanta a los últimos datos, aunque estos viajen por fetch.
    fn finish(&self, reason: &str) {
        let _order = lock(&self.send_lock);
        self.flush_locked();
        if let Ok(json) = serde_json::to_string(reason) {
            let _ = self.data.send(InvokeResponseBody::Json(json));
        }
    }

    fn run(&self) {
        let mut last: Option<Instant> = None;
        loop {
            {
                let mut p = lock(&self.pending);
                loop {
                    if p.buf.is_empty() {
                        if p.closed {
                            return;
                        }
                        p = self.ready.wait(p).unwrap_or_else(|e| e.into_inner());
                        continue;
                    }
                    // En ráfaga (envío reciente): espera al fin de la ventana para agrupar.
                    let due = last.map(|l| l + FLUSH_WINDOW).filter(|_| !p.closed && p.buf.len() < FLUSH_MAX);
                    match due.and_then(|d| d.checked_duration_since(Instant::now())) {
                        Some(left) if !left.is_zero() => {
                            p = self.ready.wait_timeout(p, left).unwrap_or_else(|e| e.into_inner()).0;
                        }
                        _ => break,
                    }
                }
            }
            self.flush();
            last = Some(Instant::now());
        }
    }
}

/// Al soltarse el último `Sink`, el hilo envía lo pendiente y termina.
struct OutboxHandle(Arc<Outbox>);

impl Drop for OutboxHandle {
    fn drop(&mut self) {
        lock(&self.0.pending).closed = true;
        self.0.ready.notify_one();
    }
}

/// Lock que no propaga el envenenamiento: un pánico en otro hilo no debe tumbar la salida.
fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// Destino de los datos recibidos: frontend + log opcional + espejo de texto.
#[derive(Clone)]
pub struct Sink {
    out: Arc<OutboxHandle>,
    exited: Arc<AtomicBool>,
    log: Arc<Mutex<Option<LogWriter>>>,
    mirror: Arc<Mutex<Mirror>>,
}

impl Sink {
    fn new(data: Channel<InvokeResponseBody>) -> Self {
        Sink {
            out: Outbox::start(data),
            exited: Arc::new(AtomicBool::new(false)),
            log: Arc::new(Mutex::new(None)),
            mirror: Arc::new(Mutex::new(Mirror::default())),
        }
    }

    pub fn push(&self, bytes: &[u8]) {
        if bytes.is_empty() {
            return;
        }
        if let Some(log) = lock(&self.log).as_mut() {
            log.write(bytes);
        }
        // El espejo se actualiza al instante: scripts y MCP no esperan la agrupación.
        lock(&self.mirror).push(bytes);
        self.out.0.push(bytes);
    }

    /// Notifica el cierre una sola vez, venga de donde venga, detrás de los últimos datos.
    pub fn close(&self, reason: impl Into<String>) {
        if !self.exited.swap(true, Ordering::SeqCst) {
            self.out.0.finish(&reason.into());
        }
    }
}

/// Quita secuencias ANSI, retornos de carro y caracteres de control sueltos.
/// Conserva el estado entre llamadas porque una secuencia puede venir partida.
#[derive(Default)]
pub(crate) struct AnsiStripper {
    state: u8, // 0 normal, 1 ESC, 2 CSI, 3 OSC
}

impl AnsiStripper {
    /// Agrega a `out` el texto limpio. Un backspace solo borra lo agregado en esta llamada.
    pub(crate) fn strip_into(&mut self, bytes: &[u8], out: &mut Vec<u8>) {
        let base = out.len();
        out.reserve(bytes.len());
        for &b in bytes {
            match self.state {
                0 => match b {
                    0x1b => self.state = 1,
                    b'\r' | 0x07 | 0x00 => {}
                    0x08 => {
                        if out.len() > base {
                            out.pop();
                        }
                    }
                    _ => out.push(b),
                },
                1 => {
                    self.state = match b {
                        b'[' => 2,
                        b']' => 3,
                        _ => 0,
                    }
                }
                2 => {
                    if (0x40..=0x7e).contains(&b) {
                        self.state = 0;
                    }
                }
                _ => {
                    if b == 0x07 || b == b'\\' {
                        self.state = 0;
                    }
                }
            }
        }
    }
}

/// Resumen de una conexión abierta (para MCP y scripts).
#[derive(serde::Serialize, Clone)]
pub struct ConnInfo {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub kind: SessionType,
    pub target: String,
}

enum Transport {
    Pty {
        master: Box<dyn MasterPty + Send>,
        /// Se entrega al hilo de escritura al conectar.
        writer: Option<Box<dyn Write + Send>>,
        killer: Box<dyn ChildKiller + Send + Sync>,
    },
    Telnet {
        stream: TcpStream,
        shared: Arc<Mutex<TelnetShared>>,
        /// TCP crudo: sin IAC ni conversión de fin de línea.
        raw: bool,
    },
    Serial {
        port: Box<dyn serialport::SerialPort>,
        stop: Arc<AtomicBool>,
    },
}

/// Lo que se envía al equipo. `Raw` no pasa por la codificación Telnet (comandos IAC).
/// `Secret` es como `Data`, pero sus búferes se borran de memoria tras escribirse.
enum Outgoing {
    Data(Vec<u8>),
    Raw(Vec<u8>),
    Secret(Zeroizing<Vec<u8>>),
}

/// Hilo que escribe en el equipo en orden. Así una consola lenta (Telnet/Serial con el
/// búfer lleno) no bloquea la interfaz ni el resto de las sesiones.
fn spawn_writer(mut out: Box<dyn Write + Send>, telnet_encode: bool) -> Sender<Outgoing> {
    let (tx, rx) = std::sync::mpsc::channel::<Outgoing>();
    thread::spawn(move || {
        for msg in rx {
            let mut send = |buf: &[u8]| out.write_all(buf).and_then(|_| out.flush());
            let res = match msg {
                Outgoing::Secret(d) if telnet_encode => send(&Zeroizing::new(telnet::encode_input(&d))),
                Outgoing::Secret(d) => send(&d),
                Outgoing::Data(d) if telnet_encode => send(&telnet::encode_input(&d)),
                Outgoing::Data(d) | Outgoing::Raw(d) => send(&d),
            };
            if res.is_err() {
                break;
            }
        }
    });
    tx
}

struct Connection {
    input: Sender<Outgoing>,
    transport: Transport,
    sink: Sink,
    name: String,
    session: Session,
}

impl Connection {
    fn info(&self, id: &str) -> ConnInfo {
        let s = &self.session;
        ConnInfo {
            id: id.to_string(),
            name: self.name.clone(),
            kind: s.session_type.clone(),
            target: match s.session_type {
                SessionType::Serial => s.serial_port.clone().unwrap_or_default(),
                SessionType::Local => "local".into(),
                _ => format!(
                    "{}{}",
                    s.username.as_deref().map(|u| format!("{u}@")).unwrap_or_default(),
                    s.host.clone().unwrap_or_default()
                ),
            },
        }
    }
}

/// Contraseña guardada (y usuario para Telnet/Serial) para autocompletar el login.
pub struct FillSpec {
    pub secret: Zeroizing<String>,
    pub user: Option<String>,
    /// Con bastión: solo se responde el prompt que nombra este host (ver `AutoFill::only_host`).
    pub only_host: Option<String>,
}

#[derive(Default)]
pub struct ConnectionManager {
    conns: Mutex<HashMap<String, Connection>>,
    triggers: Arc<triggers::Hub>,
}

impl ConnectionManager {
    pub fn connect(
        &self,
        id: String,
        session: &Session,
        cols: u16,
        rows: u16,
        data: Channel<InvokeResponseBody>,
        fill: Option<FillSpec>,
    ) -> Result<(), String> {
        // Una reconexión reutiliza el id: se cierra lo anterior primero.
        self.disconnect(&id);

        let sink = Sink::new(data);
        lock(&sink.mirror).watch = Some(Watcher::new(self.triggers.clone(), id.clone(), session.folder.as_deref()));

        let mut transport = match session.session_type {
            SessionType::Local if session.scp.is_some() => spawn_pty(scp_command(session)?, cols, rows, &sink, None)?,
            SessionType::Local => spawn_pty(local_shell(), cols, rows, &sink, None)?,
            SessionType::Ssh => spawn_pty(ssh_command(session)?, cols, rows, &sink, erase_of(session))?,
            SessionType::Telnet => open_telnet(session, cols, rows, &sink, false)?,
            SessionType::Raw => open_telnet(session, cols, rows, &sink, true)?,
            SessionType::Serial => open_serial(session, &sink)?,
        };

        let input = match &mut transport {
            Transport::Pty { writer, .. } => spawn_writer(writer.take().ok_or("PTY sin escritura")?, false),
            Transport::Telnet { stream, raw, .. } => {
                spawn_writer(Box::new(stream.try_clone().map_err(|e| e.to_string())?), !*raw)
            }
            Transport::Serial { port, .. } => spawn_writer(Box::new(port.try_clone().map_err(|e| e.to_string())?), false),
        };

        if let Some(f) = fill {
            let newline = newline_of(session);
            let mut m = lock(&sink.mirror);
            // Lo que ya llegó antes de instalarlo (Telnet rápido) también cuenta.
            let seen = m.tail(1024).to_string();
            m.autofill = Some((AutoFill::new(f.secret, f.user, newline, Instant::now()).only_host(f.only_host), input.clone()));
            m.run_autofill(&seen);
        }

        lock(&self.conns).insert(
            id,
            Connection {
                input,
                transport,
                sink,
                name: session.name.clone(),
                session: session.clone(),
            },
        );
        Ok(())
    }

    /// Escribe la contraseña guardada de la sesión en un pedido de login que la pantalla muestra
    /// ahora (pedido por un script con la aprobación del usuario). El valor nunca vuelve a quien
    /// lo pidió ni pasa por el log, el historial o los suscriptores.
    pub fn type_saved(&self, id: &str, fill: FillSpec, host: Option<&str>, strict: bool) -> Result<(), String> {
        let (mirror, input, newline) = {
            let map = lock(&self.conns);
            let conn = map.get(id).filter(|c| !c.sink.exited.load(Ordering::SeqCst)).ok_or("Sesión no conectada")?;
            (conn.sink.mirror.clone(), conn.input.clone(), newline_of(&conn.session))
        };
        let mut m = lock(&mirror);
        m.type_secret(&input, &fill.secret, newline, host, strict)
    }

    /// Escribe la contraseña de un salto en el pedido de login que la pantalla muestra tras el
    /// comando `after` (ver `Mirror::type_hop_secret`). El valor no vuelve a quien lo pide ni pasa
    /// por el log, el historial o los suscriptores.
    pub fn type_hop(&self, id: &str, secret: &str, host: &str, after: &str, token: &str) -> Result<(), String> {
        let (mirror, input, newline) = {
            let map = lock(&self.conns);
            let conn = map.get(id).filter(|c| !c.sink.exited.load(Ordering::SeqCst)).ok_or("Sesión no conectada")?;
            (conn.sink.mirror.clone(), conn.input.clone(), newline_of(&conn.session))
        };
        let mut m = lock(&mirror);
        m.type_hop_secret(&input, secret, newline, host, after, token)
    }

    pub fn write(&self, id: &str, data: &[u8]) -> Result<(), String> {
        let map = lock(&self.conns);
        let conn = map.get(id).ok_or("Sesión no conectada")?;
        conn.input
            .send(Outgoing::Data(data.to_vec()))
            .map_err(|_| "La conexión se cerró".to_string())
    }

    pub fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<(), String> {
        let mut map = lock(&self.conns);
        let Some(conn) = map.get_mut(id) else {
            return Ok(());
        };
        match &mut conn.transport {
            Transport::Pty { master, .. } => master
                .resize(PtySize {
                    rows,
                    cols,
                    pixel_width: 0,
                    pixel_height: 0,
                })
                .map_err(|e| e.to_string()),
            Transport::Telnet { shared, .. } => {
                let mut s = lock(shared);
                s.cols = cols;
                s.rows = rows;
                // Por el hilo de escritura: un socket con el búfer lleno no debe bloquear
                // el mapa global (y con él a todas las sesiones).
                if s.naws {
                    let _ = conn.input.send(Outgoing::Raw(telnet::naws(cols, rows)));
                }
                Ok(())
            }
            Transport::Serial { .. } => Ok(()),
        }
    }

    pub fn send_break(&self, id: &str) -> Result<(), String> {
        // El lock se suelta antes de esperar: un Break serial tarda 300 ms.
        let port = {
            let map = lock(&self.conns);
            let conn = map.get(id).ok_or("Sesión no conectada")?;
            match &conn.transport {
                Transport::Serial { port, .. } => port.try_clone().map_err(|e| e.to_string())?,
                Transport::Telnet { raw: true, .. } => return Err("Break no aplica a conexiones TCP crudas".into()),
                Transport::Telnet { .. } => {
                    return conn
                        .input
                        .send(Outgoing::Raw(vec![telnet::IAC, telnet::BRK]))
                        .map_err(|_| "La conexión se cerró".to_string())
                }
                Transport::Pty { .. } => return Err("Break solo aplica a Serial y Telnet".into()),
            }
        };
        port.set_break().map_err(|e| e.to_string())?;
        thread::sleep(Duration::from_millis(300));
        port.clear_break().map_err(|e| e.to_string())
    }

    /// Alertas por palabra clave, compartidas por todas las conexiones.
    pub fn triggers(&self) -> &triggers::Hub {
        &self.triggers
    }

    /// Activa o desactiva el log. Devuelve la ruta del archivo cuando se activa.
    pub fn set_logging(
        &self,
        id: &str,
        enabled: bool,
        opts: LogOptions,
        dir: &Path,
        resume: Option<&str>,
    ) -> Result<Option<String>, String> {
        // Crear la carpeta y el archivo ocurre sin el lock del mapa global.
        let (log, vars) = {
            let map = lock(&self.conns);
            let conn = map.get(id).ok_or("Sesión no conectada")?;
            let s = &conn.session;
            let host = match s.session_type {
                SessionType::Serial => s.serial_port.as_deref().and_then(|p| p.rsplit(['/', '\\']).next()).unwrap_or(""),
                SessionType::Local => "local",
                _ => s.host.as_deref().unwrap_or(""),
            };
            let vars = LogVars { session: conn.name.clone(), host: host.to_string(), folder: s.folder.clone().unwrap_or_default() };
            (conn.sink.log.clone(), vars)
        };
        if !enabled {
            *lock(&log) = None;
            return Ok(None);
        }
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        // Reconexión: se sigue escribiendo en el mismo archivo para no fragmentar la evidencia
        // de una ventana de cambio. Solo se acepta un .log que ya exista en la carpeta de logs.
        let writer = match resume.and_then(|p| resumable_log(dir, Path::new(p))) {
            Some(prev) => LogWriter::resume(&prev, dir, opts, vars)?,
            None => LogWriter::create(dir, opts, vars)?,
        };
        let path = writer.path().to_string_lossy().into_owned();
        *lock(&log) = Some(writer);
        Ok(Some(path))
    }

    pub fn list(&self) -> Vec<ConnInfo> {
        let map = lock(&self.conns);
        let mut list: Vec<_> = map
            .iter()
            .filter(|(_, c)| !c.sink.exited.load(Ordering::SeqCst))
            .map(|(id, c)| c.info(id))
            .collect();
        list.sort_by(|a, b| a.id.cmp(&b.id));
        list
    }

    /// Búsqueda directa (antes armaba y recorría la lista completa en cada llamada).
    pub fn info(&self, id: &str) -> Option<(ConnInfo, Session)> {
        let map = lock(&self.conns);
        let c = map.get(id).filter(|c| !c.sink.exited.load(Ordering::SeqCst))?;
        Some((c.info(id), c.session.clone()))
    }

    /// Últimos `max` caracteres de salida en texto limpio.
    pub fn history(&self, id: &str, max: usize) -> Option<String> {
        let mirror = lock(&self.conns).get(id)?.sink.mirror.clone();
        let text = lock(&mirror).tail(max).to_string();
        Some(text)
    }

    /// Suscripción a la salida en vivo; se cancela sola al soltar el receptor.
    pub fn tap(&self, id: &str) -> Option<std::sync::mpsc::Receiver<String>> {
        let mirror = lock(&self.conns).get(id)?.sink.mirror.clone();
        let (tx, rx) = std::sync::mpsc::sync_channel(TAP_CAPACITY);
        lock(&mirror).taps.push(tx);
        Some(rx)
    }

    pub fn disconnect(&self, id: &str) {
        let Some(conn) = lock(&self.conns).remove(id) else {
            return;
        };
        // Marcado como cerrado para que los hilos no notifiquen un cierre "inesperado".
        conn.sink.exited.store(true, Ordering::SeqCst);
        match conn.transport {
            Transport::Pty { mut killer, .. } => {
                let _ = killer.kill();
            }
            Transport::Telnet { stream, .. } => {
                let _ = stream.shutdown(Shutdown::Both);
            }
            Transport::Serial { stop, .. } => stop.store(true, Ordering::SeqCst),
        }
    }
}

/// Fin de línea configurado en la sesión (Enter del login).
fn newline_of(session: &Session) -> &'static str {
    match session.newline.as_deref() {
        Some("lf") => "\n",
        Some("crlf") => "\r\n",
        _ => "\r",
    }
}

/// Ruta de un log existente dentro de la carpeta de logs o sus subcarpetas (sin salir de ella).
fn resumable_log(dir: &Path, path: &Path) -> Option<PathBuf> {
    let dir = dir.canonicalize().ok()?;
    let path = path.canonicalize().ok()?;
    (path.starts_with(&dir) && path.extension().is_some_and(|e| e == "log") && path.is_file()).then_some(path)
}



// ---------- PTY (local y SSH) ----------

fn is_dir_writable(path: &std::path::Path) -> bool {
    if !path.is_dir() {
        return false;
    }
    let test_file = path.join(".nt_wtest");
    if let Ok(mut f) = std::fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .open(&test_file)
    {
        use std::io::Write;
        let _ = f.write_all(b"1");
        drop(f);
        let _ = std::fs::remove_file(test_file);
        true
    } else {
        false
    }
}

fn local_shell() -> CommandBuilder {
    if cfg!(windows) {
        let mut cmd = CommandBuilder::new("powershell.exe");
        cmd.arg("-NoLogo");
        if let Some(home) = std::env::var_os("USERPROFILE") {
            cmd.cwd(home);
        }
        cmd
    } else if cfg!(target_os = "android") {
        // En Android, CommandBuilder::new_default_prog() puede fallar si SHELL no está definido
        // o apunta a /bin/sh. Busca primero $SHELL, luego Termux bash/sh, /system/bin/sh y /bin/sh.
        let candidates = [
            std::env::var("SHELL").ok(),
            Some("/data/data/com.termux/files/usr/bin/bash".to_string()),
            Some("/data/data/com.termux/files/usr/bin/sh".to_string()),
            Some("/system/bin/sh".to_string()),
            Some("/bin/sh".to_string()),
        ];
        let chosen_shell = candidates
            .into_iter()
            .flatten()
            .find(|p| std::path::Path::new(p).exists())
            .unwrap_or_else(|| "/system/bin/sh".to_string());

        let mut cmd = CommandBuilder::new(chosen_shell);

        let home_ok = std::env::var_os("HOME")
            .map(std::path::PathBuf::from)
            .is_some_and(|p| is_dir_writable(&p));

        if !home_ok {
            let data_dir = [
                std::env::var_os("EXTERNAL_STORAGE").map(std::path::PathBuf::from),
                std::env::var_os("ANDROID_DATA").map(|d| std::path::PathBuf::from(d).join("data/cl.netterminal.app/files")),
                Some(std::path::PathBuf::from("/data/data/cl.netterminal.app/files")),
                Some(std::path::PathBuf::from("/data/user/0/cl.netterminal.app/files")),
                Some(std::path::PathBuf::from("/data/data/com.termux/files/home")),
                Some(std::env::temp_dir()),
                Some(std::path::PathBuf::from("/data/local/tmp")),
            ]
            .into_iter()
            .flatten()
            .find(|d| is_dir_writable(d) || std::fs::create_dir_all(d).is_ok_and(|_| is_dir_writable(d)))
            .unwrap_or_else(std::env::temp_dir);

            cmd.env("HOME", &data_dir);
            cmd.cwd(&data_dir);
        }
        cmd
    } else {
        // Shell de login del usuario, en su home.
        CommandBuilder::new_default_prog()
    }
}

/// Host o destino seguro para pasar a ssh: sin espacios, sin control y sin empezar con
/// "-" (evita que un valor como "-oProxyCommand=..." se interprete como opción).
fn safe_target(value: &str, field: &str) -> Result<String, String> {
    let v = value.trim();
    if v.is_empty() {
        return Err(format!("Falta {field}"));
    }
    if v.starts_with('-') || v.chars().any(|c| c.is_whitespace() || c.is_control() || SHELL_META.contains(&c)) {
        return Err(format!("{field} inválido: {v}"));
    }
    // IPv6 entre corchetes ("[2001:db8::1]") se normaliza: ssh lo espera sin corchetes.
    let v = v.strip_prefix('[').and_then(|x| x.strip_suffix(']')).unwrap_or(v);
    if v.is_empty() || v.starts_with('-') {
        return Err(format!("{field} inválido"));
    }
    Ok(v.to_string())
}

/// Caracteres que una shell interpreta. OpenSSH anterior a 9.6 (p. ej. el que trae Windows)
/// arma con el host, el usuario o el jump host comandos que pasan por `sh -c` (ProxyJump y
/// ProxyCommand con %h/%r de ~/.ssh/config, CVE-2023-51385). Un nombre de equipo nunca los usa.
const SHELL_META: &[char] = &['`', '$', ';', '|', '&', '<', '>', '(', ')', '\'', '"', '\\', '{', '}', '*', '?', '!', '#', '~'];

/// Usuario para `-l`: sin control, espacios ni metacaracteres de shell (se permite "\" para
/// cuentas DOMINIO\usuario).
fn safe_user(user: &str) -> Result<&str, String> {
    let bad = |c: char| c.is_whitespace() || c.is_control() || (SHELL_META.contains(&c) && c != '\\');
    if user.starts_with('-') || user.chars().any(bad) {
        return Err(format!("Usuario inválido: {user}"));
    }
    Ok(user)
}

/// Opciones de ssh que ejecutan comandos locales. No se aceptan en "argumentos extra"
/// (que pueden venir de sesiones importadas); quien las necesite usa ~/.ssh/config.
/// Opciones `-o` que ejecutan comandos, cargan código o leen otra configuración.
const BLOCKED_SSH_OPTIONS: [&str; 9] = [
    "proxycommand",
    "localcommand",
    "permitlocalcommand",
    "knownhostscommand",
    "match",
    "remotecommand",
    "pkcs11provider",
    "securitykeyprovider",
    "include",
];
/// Flags de ssh que reciben un valor (según su getopt).
const SSH_FLAGS_WITH_VALUE: &str = "bceilmopBDEFIJLOPQRSwW";
/// Flags simples de ssh.
const SSH_FLAGS_SIMPLE: &str = "1246afgknqstvxACGKMNTVXYy";
/// -F (otro archivo de configuración), -I (biblioteca PKCS#11) y -E (escribe un archivo).
const SSH_FLAGS_FORBIDDEN: &str = "FIE";

/// Valida los argumentos extra con la misma semántica de getopt que usa ssh: flags
/// agrupados ("-vo…", "-vF…"), valor pegado o en el argumento siguiente. Solo se aceptan
/// opciones; un argumento suelto cambiaría el host o el comando remoto.
fn check_extra_args(args: &[String]) -> Result<(), String> {
    let mut i = 0;
    while i < args.len() {
        let a = &args[i];
        let Some(flags) = a.strip_prefix('-').filter(|f| !f.is_empty() && !f.starts_with('-')) else {
            return Err(format!("Argumento no permitido: \"{a}\". Solo se aceptan opciones de ssh (-L, -D, -A, -o …)."));
        };
        let chars: Vec<char> = flags.chars().collect();
        for (j, &c) in chars.iter().enumerate() {
            if SSH_FLAGS_FORBIDDEN.contains(c) {
                return Err(format!("La opción -{c} no está permitida en argumentos extra"));
            }
            if SSH_FLAGS_WITH_VALUE.contains(c) {
                let rest: String = chars[j + 1..].iter().collect();
                let value = if rest.is_empty() {
                    i += 1;
                    args.get(i).cloned().ok_or(format!("Falta el valor de -{c}"))?
                } else {
                    rest
                };
                let name = if c == 'o' { value.trim().split(['=', ' ', '\t']).next().unwrap_or("").to_ascii_lowercase() } else { String::new() };
                if BLOCKED_SSH_OPTIONS.contains(&name.as_str()) {
                    return Err(format!(
                        "Opción no permitida en argumentos extra: {name}. Configúrala en ~/.ssh/config si la necesitas."
                    ));
                }
                // Jump host, host y usuario terminan en el ProxyCommand que OpenSSH < 9.6 pasa
                // por `sh -c` (CVE-2023-51385): misma regla que los campos de la sesión.
                if (matches!(c, 'J' | 'l') || matches!(name.as_str(), "proxyjump" | "hostname" | "user"))
                    && value.chars().any(|ch| ch.is_control() || (SHELL_META.contains(&ch) && !(c == 'l' && ch == '\\')))
                {
                    return Err(format!("Valor no permitido en argumentos extra: {value}"));
                }
                break;
            }
            if !SSH_FLAGS_SIMPLE.contains(c) {
                return Err(format!("Opción de ssh desconocida: -{c}"));
            }
        }
        i += 1;
    }
    Ok(())
}

/// Máximo de túneles por sesión.
const MAX_TUNNELS: usize = 32;

/// Dirección de un túnel (escucha o destino): IPv4, IPv6, nombre o "*". IPv6 va entre corchetes.
fn tunnel_addr(value: &str, field: &str) -> Result<String, String> {
    let v = value.trim();
    let v = v.strip_prefix('[').and_then(|x| x.strip_suffix(']')).unwrap_or(v);
    let ok = !v.is_empty()
        && v.len() <= 253
        && !v.starts_with('-')
        && v.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | ':' | '-' | '_' | '*' | '%'));
    if !ok {
        return Err(format!("{field} del túnel es inválido: {v}"));
    }
    Ok(if v.contains(':') { format!("[{v}]") } else { v.to_string() })
}

/// Convierte los túneles estructurados en argumentos -L/-R/-D validados.
pub(crate) fn tunnel_args(list: &[crate::models::Tunnel]) -> Result<Vec<String>, String> {
    use crate::models::TunnelKind;
    if list.len() > MAX_TUNNELS {
        return Err(format!("Máximo {MAX_TUNNELS} túneles por sesión"));
    }
    let mut out = Vec::with_capacity(list.len() * 2);
    for t in list {
        if t.listen_port == 0 {
            return Err("Puerto de escucha del túnel inválido".into());
        }
        let bind = tunnel_addr(
            t.bind.as_deref().filter(|b| !b.trim().is_empty()).unwrap_or("127.0.0.1"),
            "La dirección de escucha",
        )?;
        let spec = if t.kind == TunnelKind::Dynamic {
            format!("{bind}:{}", t.listen_port)
        } else {
            let host = tunnel_addr(t.dest_host.as_deref().unwrap_or(""), "El destino")?;
            if host.contains('*') {
                return Err("El destino del túnel no puede ser \"*\"".into());
            }
            let port = t.dest_port.filter(|p| *p != 0).ok_or("Falta el puerto de destino del túnel")?;
            format!("{bind}:{}:{host}:{port}", t.listen_port)
        };
        let flag = match t.kind {
            TunnelKind::Local => "-L",
            TunnelKind::Remote => "-R",
            TunnelKind::Dynamic => "-D",
        };
        out.push(flag.to_string());
        out.push(spec);
    }
    // Defensa en profundidad: pasan por la misma validación que los argumentos extra.
    check_extra_args(&out)?;
    Ok(out)
}

/// Resuelve la ruta del binario requerido (ssh, scp, sftp).
/// En Android busca en el PATH directo y en rutas habituales (/data/data/com.termux/files/usr/bin/ y /system/bin/).
/// Si no se encuentra en Android, genera un mensaje claro para el usuario.
fn resolve_bin(name: &str) -> Result<String, String> {
    let bin_name = if cfg!(windows) {
        if name.ends_with(".exe") { name.to_string() } else { format!("{name}.exe") }
    } else {
        name.to_string()
    };

    // En Android, verificar en el PATH directo y luego en rutas conocidas (/data/data/com.termux/files/usr/bin/, /system/bin/, /system/xbin/)
    if cfg!(target_os = "android") {
        if let Some(path_var) = std::env::var_os("PATH") {
            for dir in std::env::split_paths(&path_var) {
                let candidate = dir.join(&bin_name);
                if candidate.is_file() {
                    return Ok(candidate.to_string_lossy().into_owned());
                }
            }
        }

        let android_paths = [
            format!("/data/data/com.termux/files/usr/bin/{bin_name}"),
            format!("/system/bin/{bin_name}"),
            format!("/system/xbin/{bin_name}"),
        ];
        for p in &android_paths {
            if std::path::Path::new(p).is_file() {
                return Ok(p.clone());
            }
        }

        if name == "ssh" {
            return Err("No se encontró el binario 'ssh' en Android. Para conectarte por SSH, instala OpenSSH en Termux (pkg install openssh) o utiliza sesiones Telnet o Raw.".to_string());
        } else {
            return Err(format!("No se encontró el binario '{name}' en Android. Instala OpenSSH en Termux (pkg install openssh) para usar esta funcionalidad."));
        }
    }

    Ok(bin_name)
}

fn ssh_command(s: &Session) -> Result<CommandBuilder, String> {
    let host = safe_target(s.host.as_deref().unwrap_or(""), "el host")?;
    let ssh_bin = resolve_bin("ssh")?;
    let mut cmd = CommandBuilder::new(ssh_bin);
    cmd.args(["-o", "ServerAliveInterval=30", "-o", "ConnectTimeout=15"]);
    if let Some(port) = s.port.filter(|p| *p != 22) {
        cmd.args(["-p", &port.to_string()]);
    }
    if let Some(user) = s.username.as_deref().filter(|u| !u.is_empty()) {
        cmd.args(["-l", safe_user(user)?]);
    }
    if let Some(key) = s.identity_file.as_deref().filter(|k| !k.is_empty()) {
        cmd.args(["-i", key]);
    }
    if let Some(jump) = s.jump_host.as_deref().filter(|j| !j.trim().is_empty()) {
        cmd.args(["-J".to_string(), safe_target(jump, "el jump host")?]);
    }
    if s.legacy_ssh.unwrap_or(false) {
        for opt in legacy_options() {
            cmd.args(["-o", opt]);
        }
    }
    if let Some(extra) = s.ssh_args.as_deref() {
        let extra = split_args(extra);
        check_extra_args(&extra)?;
        cmd.args(extra);
    }
    if let Some(tunnels) = s.tunnels.as_deref() {
        cmd.args(tunnel_args(tunnels)?);
    }
    // "--" cierra las opciones: el host nunca se interpreta como opción.
    cmd.arg("--");
    cmd.arg(host);
    Ok(cmd)
}


/// Versión (mayor, menor) del OpenSSH instalado.
fn openssh_version() -> Option<(u32, u32)> {
    static V: std::sync::OnceLock<Option<(u32, u32)>> = std::sync::OnceLock::new();
    *V.get_or_init(|| {
        let bin = resolve_bin("ssh").ok()?;
        let mut c = std::process::Command::new(bin);
        c.arg("-V");
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            c.creation_flags(0x0800_0000);
        }
        let out = c.output().ok()?;
        let text = String::from_utf8_lossy(&out.stderr).to_string() + &String::from_utf8_lossy(&out.stdout);
        let v = text.split("OpenSSH_").nth(1)?;
        let mut it = v.split(|c: char| !c.is_ascii_digit());
        Some((it.next()?.parse().ok()?, it.next()?.parse().ok()?))
    })
}

/// Comando scp para la pestaña de transferencia. Usa las credenciales y opciones SSH de
/// la sesión (usuario, puerto, jump host, algoritmos legacy); la contraseña se escribe
/// en la propia pestaña.
fn scp_command(s: &Session) -> Result<CommandBuilder, String> {
    let spec = s.scp.as_ref().ok_or("Falta la especificación SCP")?;
    let host = safe_target(s.host.as_deref().unwrap_or(""), "el host")?;
    let remote_dir = spec.remote_dir.trim();
    if remote_dir.starts_with('-') || remote_dir.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return Err("Carpeta remota inválida".into());
    }
    let user = s.username.as_deref().map(str::trim).filter(|u| !u.is_empty());
    if user.is_some_and(|u| u.contains(['@', ':']) || safe_user(u).is_err()) {
        return Err("Usuario inválido".into());
    }
    let mode = spec.mode.as_deref().unwrap_or("scp");
    if mode == "shell" {
        return sftp_shell(s, &host, user, &spec.local_dir);
    }
    if spec.files.is_empty() {
        return Err("No hay archivos para copiar".into());
    }
    let remote = |file: &str| -> Result<String, String> {
        if file.starts_with('-') || file.contains(['/', '\\', ' ']) {
            return Err(format!("Nombre de archivo inválido: {file}"));
        }
        let sep = if remote_dir.is_empty() || remote_dir.ends_with(['/', ':']) { "" } else { "/" };
        // scp separa host y ruta con ":", así que una IPv6 va entre corchetes.
        let host = if host.contains(':') { format!("[{host}]") } else { host.clone() };
        Ok(format!("{}{host}:{remote_dir}{sep}{file}", user.map(|u| format!("{u}@")).unwrap_or_default()))
    };

    let scp_bin = resolve_bin("scp")?;
    let mut cmd = CommandBuilder::new(scp_bin);
    let version = openssh_version();
    match mode {
        // OpenSSH >= 9 usa SFTP por defecto; el servidor SCP de Cisco IOS solo habla SCP clásico.
        "scp" => {
            if version.is_some_and(|v| v >= (9, 0)) {
                cmd.arg("-O");
            }
        }
        // SFTP: por defecto desde OpenSSH 9.0; entre 8.7 y 8.9 con -s.
        "sftp" => match version {
            Some(v) if v >= (9, 0) => {}
            Some(v) if v >= (8, 7) => {
                cmd.arg("-s");
            }
            _ => return Err("El OpenSSH de este PC no transfiere por SFTP con scp (requiere 8.7 o superior). Usa SFTP interactivo.".into()),
        },
        _ => return Err("Modo de transferencia inválido".into()),
    }
    cmd.args(["-o", "ConnectTimeout=15"]);
    if let Some(port) = s.port.filter(|p| *p != 22 && *p != 23) {
        cmd.args(["-P", &port.to_string()]);
    }
    if let Some(key) = s.identity_file.as_deref().filter(|k| !k.is_empty()) {
        cmd.args(["-i", key]);
    }
    if let Some(jump) = s.jump_host.as_deref().filter(|j| !j.trim().is_empty()) {
        cmd.args(["-J".to_string(), safe_target(jump, "el jump host")?]);
    }
    if s.legacy_ssh.unwrap_or(false) {
        for opt in legacy_options() {
            cmd.args(["-o", opt]);
        }
    }
    cmd.arg("--");
    if spec.upload {
        if spec.local_paths.len() != spec.files.len() {
            return Err("Rutas locales no resueltas".into());
        }
        cmd.args(&spec.local_paths);
        let sep = if remote_dir.is_empty() || remote_dir.ends_with(['/', ':']) { "" } else { "/" };
        cmd.arg(format!("{}{host}:{remote_dir}{sep}", user.map(|u| format!("{u}@")).unwrap_or_default()));
    } else {
        if spec.local_dir.is_empty() {
            return Err("Carpeta local no resuelta".into());
        }
        for f in &spec.files {
            cmd.arg(remote(f)?);
        }
        cmd.arg(&spec.local_dir);
    }
    Ok(cmd)
}

/// Cliente sftp interactivo con las opciones SSH de la sesión, dentro de la carpeta
/// compartida (get y put leen y escriben ahí). La contraseña se escribe en la pestaña y la
/// llave de host se verifica contra known_hosts como en SSH.
fn sftp_shell(s: &Session, host: &str, user: Option<&str>, local_dir: &str) -> Result<CommandBuilder, String> {
    if local_dir.is_empty() {
        return Err("Carpeta local no resuelta".into());
    }
    let sftp_bin = resolve_bin("sftp")?;
    let mut cmd = CommandBuilder::new(sftp_bin);
    cmd.cwd(local_dir);
    cmd.args(["-o", "ConnectTimeout=15", "-o", "ServerAliveInterval=30"]);
    if let Some(port) = s.port.filter(|p| *p != 22 && *p != 23) {
        cmd.args(["-P", &port.to_string()]);
    }
    if let Some(key) = s.identity_file.as_deref().filter(|k| !k.is_empty()) {
        cmd.args(["-i", key]);
    }
    if let Some(jump) = s.jump_host.as_deref().filter(|j| !j.trim().is_empty()) {
        cmd.args(["-J".to_string(), safe_target(jump, "el jump host")?]);
    }
    if s.legacy_ssh.unwrap_or(false) {
        for opt in legacy_options() {
            cmd.args(["-o", opt]);
        }
    }
    cmd.arg("--");
    // sftp acepta IPv6 entre corchetes en el destino.
    let host = if host.contains(':') { format!("[{host}]") } else { host.to_string() };
    cmd.arg(format!("{}{host}", user.map(|u| format!("{u}@")).unwrap_or_default()));
    Ok(cmd)
}

/// Algoritmos que OpenSSH deshabilita por defecto pero que equipos antiguos aún exigen.
/// Solo se piden los que el OpenSSH instalado soporta: si se nombra uno inexistente
/// (p. ej. ssh-dss en OpenSSH 10), ssh rechaza la conexión completa.
fn legacy_options() -> &'static [String] {
    static OPTS: std::sync::OnceLock<Vec<String>> = std::sync::OnceLock::new();
    OPTS.get_or_init(|| {
        let wanted: [(&str, &str, &[&str]); 5] = [
            (
                "KexAlgorithms",
                "kex",
                &["diffie-hellman-group-exchange-sha1", "diffie-hellman-group14-sha1", "diffie-hellman-group1-sha1"],
            ),
            ("HostKeyAlgorithms", "key", &["ssh-rsa", "ssh-dss"]),
            ("PubkeyAcceptedAlgorithms", "key", &["ssh-rsa", "ssh-dss"]),
            ("Ciphers", "cipher", &["aes128-cbc", "aes192-cbc", "aes256-cbc", "3des-cbc"]),
            ("MACs", "mac", &["hmac-sha1", "hmac-sha1-96", "hmac-md5", "hmac-md5-96"]),
        ];
        wanted
            .iter()
            .filter_map(|(opt, query, algs)| {
                let bin = resolve_bin("ssh").unwrap_or_else(|_| "ssh".to_string());
                let mut q = std::process::Command::new(bin);
                q.args(["-Q", query]);
                #[cfg(windows)]
                {
                    // Sin ventana de consola al consultar desde la app gráfica.
                    use std::os::windows::process::CommandExt;
                    q.creation_flags(0x0800_0000);
                }
                let out = q.output().ok()?;
                let supported: std::collections::HashSet<_> =
                    String::from_utf8_lossy(&out.stdout).lines().map(str::to_owned).collect();
                let list: Vec<_> = algs.iter().filter(|a| supported.contains(**a)).copied().collect();
                (!list.is_empty()).then(|| format!("{opt}=+{}", list.join(",")))
            })
            .collect()
    })
}

/// Divide argumentos como una shell simple: respeta comillas simples y dobles.
fn split_args(s: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut quote: Option<char> = None;
    let mut has = false;
    for c in s.chars() {
        match (quote, c) {
            (Some(q), c) if c == q => quote = None,
            (Some(_), c) => cur.push(c),
            (None, '"' | '\'') => {
                quote = Some(c);
                has = true;
            }
            (None, c) if c.is_whitespace() => {
                if has || !cur.is_empty() {
                    out.push(std::mem::take(&mut cur));
                }
                has = false;
            }
            (None, c) => cur.push(c),
        }
    }
    if has || !cur.is_empty() {
        out.push(cur);
    }
    out
}

/// Carácter de borrado de la sesión para la PTY local: solo cambia si Retroceso envía BS (^H).
/// La terminal manda el modo efectivo (el automático ya resuelto) en `session.backspace`.
fn erase_of(session: &Session) -> Option<u8> {
    (session.backspace.as_deref() == Some("bs")).then_some(0x08)
}

/// Fija el carácter de borrado (VERASE) de la PTY. OpenSSH lo informa al servidor en el pedido
/// de terminal (RFC 4254 §8, opcode VERASE), como PuTTY con "The Backspace key", y el pedido
/// de contraseña del propio ssh (modo canónico) borra con él.
#[cfg(unix)]
fn set_pty_erase(master: &dyn MasterPty, erase: u8) {
    let Some(fd) = master.as_raw_fd() else { return };
    // SAFETY: termios es una estructura C simple; tcgetattr la llena antes de usarla.
    unsafe {
        let mut t: libc::termios = std::mem::zeroed();
        if libc::tcgetattr(fd, &mut t) == 0 {
            t.c_cc[libc::VERASE] = erase as libc::cc_t;
            libc::tcsetattr(fd, libc::TCSANOW, &t);
        }
    }
}

/// En Windows (ConPTY) no hay termios: ssh.exe informa sus propios modos.
#[cfg(not(unix))]
fn set_pty_erase(_master: &dyn MasterPty, _erase: u8) {}

fn spawn_pty(mut cmd: CommandBuilder, cols: u16, rows: u16, sink: &Sink, erase: Option<u8>) -> Result<Transport, String> {
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    // Apps GUI en macOS no heredan LANG: sin esto zsh/ssh rompen los caracteres UTF-8.
    if std::env::var_os("LANG").is_none() && !cfg!(windows) {
        cmd.env("LANG", "en_US.UTF-8");
    }

    let pair = native_pty_system()
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("No se pudo crear la PTY: {e}"))?;
    if let Some(erase) = erase {
        set_pty_erase(pair.master.as_ref(), erase);
    }

    let mut child = pair.slave.spawn_command(cmd).map_err(|e| {
        format!("No se pudo iniciar el proceso: {e}. Si es SSH, verifica que OpenSSH esté instalado.")
    })?;
    drop(pair.slave);

    let killer = child.clone_killer();
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    let s = sink.clone();
    thread::spawn(move || {
        let mut buf = [0u8; 16 * 1024];
        while let Ok(n) = reader.read(&mut buf) {
            if n == 0 {
                break;
            }
            s.push(&buf[..n]);
        }
    });

    // El fin del proceso se detecta con wait(): en Windows (ConPTY) el lector no recibe EOF.
    let s = sink.clone();
    thread::spawn(move || {
        let status = child.wait();
        thread::sleep(Duration::from_millis(150)); // deja drenar la salida pendiente
        let msg = match status {
            Ok(st) if st.success() => "Sesión finalizada".to_string(),
            Ok(st) => format!("Proceso terminado (código {})", st.exit_code()),
            Err(e) => format!("Proceso terminado: {e}"),
        };
        s.close(msg);
    });

    Ok(Transport::Pty {
        master: pair.master,
        writer: Some(writer),
        killer,
    })
}

// ---------- Telnet ----------

fn open_telnet(s: &Session, cols: u16, rows: u16, sink: &Sink, raw: bool) -> Result<Transport, String> {
    let host = s
        .host
        .as_deref()
        .map(|h| h.trim().trim_start_matches('[').trim_end_matches(']'))
        .filter(|h| !h.is_empty())
        .ok_or("Falta el host")?;
    let port = s.port.unwrap_or(23);
    let addrs: Vec<_> = (host, port)
        .to_socket_addrs()
        .map_err(|e| format!("No se pudo resolver {host}: {e}"))?
        .collect();

    let mut last_err = String::from("sin direcciones");
    let stream = addrs
        .iter()
        .find_map(|a| match TcpStream::connect_timeout(a, Duration::from_secs(10)) {
            Ok(st) => Some(st),
            Err(e) => {
                last_err = e.to_string();
                None
            }
        })
        .ok_or_else(|| format!("No se pudo conectar a {host}:{port}: {last_err}"))?;
    let _ = stream.set_nodelay(true);

    let shared = Arc::new(Mutex::new(TelnetShared::new(cols, rows)));
    let mut reader = stream.try_clone().map_err(|e| e.to_string())?;
    let mut replier = stream.try_clone().map_err(|e| e.to_string())?;
    let sh = shared.clone();
    let s = sink.clone();

    thread::spawn(move || {
        let mut parser = telnet::Parser::default();
        let mut buf = [0u8; 16 * 1024];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => {
                    s.close("Conexión cerrada por el host remoto");
                    break;
                }
                Ok(n) if raw => s.push(&buf[..n]),
                Ok(n) => {
                    let (data, reply) = parser.feed(&buf[..n], &sh);
                    if !reply.is_empty() {
                        let _ = replier.write_all(&reply);
                    }
                    s.push(&data);
                }
                Err(e) => {
                    s.close(format!("Conexión perdida: {e}"));
                    break;
                }
            }
        }
    });

    Ok(Transport::Telnet { stream, shared, raw })
}

// ---------- Serial ----------

fn open_serial(s: &Session, sink: &Sink) -> Result<Transport, String> {
    use serialport::{DataBits, FlowControl, Parity, StopBits};

    let path = s
        .serial_port
        .as_deref()
        .filter(|p| !p.is_empty())
        .ok_or("Falta el puerto serial")?;
    let data_bits = match s.data_bits.unwrap_or(8) {
        5 => DataBits::Five,
        6 => DataBits::Six,
        7 => DataBits::Seven,
        _ => DataBits::Eight,
    };
    let stop_bits = if s.stop_bits == Some(2) { StopBits::Two } else { StopBits::One };
    let parity = match s.parity.as_deref() {
        Some("odd") => Parity::Odd,
        Some("even") => Parity::Even,
        _ => Parity::None,
    };
    let flow = match s.flow_control.as_deref() {
        Some("software") => FlowControl::Software,
        Some("hardware") => FlowControl::Hardware,
        _ => FlowControl::None,
    };

    let port = serialport::new(path, s.baud_rate.unwrap_or(9600))
        .data_bits(data_bits)
        .stop_bits(stop_bits)
        .parity(parity)
        .flow_control(flow)
        .timeout(Duration::from_millis(50))
        .open()
        .map_err(|e| format!("No se pudo abrir {path}: {e}"))?;

    let mut reader = port.try_clone().map_err(|e| e.to_string())?;
    let stop = Arc::new(AtomicBool::new(false));
    let st = stop.clone();
    let sk = sink.clone();

    thread::spawn(move || {
        let mut buf = [0u8; 4096];
        while !st.load(Ordering::SeqCst) {
            match reader.read(&mut buf) {
                Ok(n) => sk.push(&buf[..n]),
                Err(e) if e.kind() == std::io::ErrorKind::TimedOut => {}
                Err(e) if e.kind() == std::io::ErrorKind::Interrupted => {}
                Err(e) => {
                    sk.close(format!("Puerto desconectado: {e}"));
                    break;
                }
            }
        }
    });

    Ok(Transport::Serial { port, stop })
}

pub fn list_serial_ports() -> Vec<crate::models::SerialPortInfo> {
    use serialport::SerialPortType;
    let mut ports: Vec<_> = serialport::available_ports()
        .unwrap_or_default()
        .into_iter()
        // En macOS cada puerto aparece como tty.* y cu.*; cu.* es el correcto para salir.
        .filter(|p| !p.port_name.starts_with("/dev/tty.") || cfg!(not(target_os = "macos")))
        .map(|p| crate::models::SerialPortInfo {
            port_type: match p.port_type {
                SerialPortType::UsbPort(info) => info
                    .product
                    .map(|n| format!("USB · {n}"))
                    .unwrap_or_else(|| "USB".into()),
                SerialPortType::PciPort => "PCI".into(),
                SerialPortType::BluetoothPort => "Bluetooth".into(),
                SerialPortType::Unknown => "Serial".into(),
            },
            port_name: p.port_name,
        })
        .collect();
    #[cfg(target_os = "android")]
    {
        for prefix in ["/dev/ttyUSB", "/dev/ttyACM", "/dev/ttyS"] {
            for i in 0..10 {
                let path = format!("{prefix}{i}");
                if std::path::Path::new(&path).exists() && !ports.iter().any(|p| p.port_name == path) {
                    ports.push(crate::models::SerialPortInfo {
                        port_type: "USB Serial".into(),
                        port_name: path,
                    });
                }
            }
        }
    }
    // Algunos drivers de adaptadores USB (CH340, PL2303, FTDI antiguos) no publican la interfaz
    // que lee serialport en Windows: el registro SERIALCOMM sí lista todos los COM activos.
    #[cfg(windows)]
    for name in windows_serialcomm() {
        if !ports.iter().any(|p| p.port_name.eq_ignore_ascii_case(&name)) {
            ports.push(crate::models::SerialPortInfo { port_name: name, port_type: "Serial".into() });
        }
    }
    ports.sort_by(|a, b| port_order(&a.port_name, &b.port_name));
    ports
}

/// Orden natural: COM3 < COM5 < COM10 (el orden de texto pondría COM10 antes de COM3).
fn port_order(a: &str, b: &str) -> std::cmp::Ordering {
    let split = |s: &str| {
        let head = s.trim_end_matches(|c: char| c.is_ascii_digit());
        (head.to_ascii_lowercase(), s[head.len()..].parse::<u64>().ok())
    };
    split(a).cmp(&split(b)).then_with(|| a.cmp(b))
}

/// Puertos COM activos según HKLM\HARDWARE\DEVICEMAP\SERIALCOMM.
#[cfg(windows)]
fn windows_serialcomm() -> Vec<String> {
    let Ok(out) = crate::monitor::command("reg")
        .args(["query", r"HKLM\HARDWARE\DEVICEMAP\SERIALCOMM"])
        .output()
    else {
        return Vec::new();
    };
    parse_serialcomm(&String::from_utf8_lossy(&out.stdout))
}

/// Cada valor de `reg query` es "    \Device\Serial0    REG_SZ    COM1": el puerto es la última columna.
#[cfg_attr(not(windows), allow(dead_code))]
fn parse_serialcomm(text: &str) -> Vec<String> {
    text.lines()
        .filter(|l| l.contains("REG_SZ"))
        .filter_map(|l| l.split_whitespace().last())
        .filter(|n| n.len() > 3 && n[..3].eq_ignore_ascii_case("COM"))
        .map(str::to_string)
        .collect()
}

#[cfg(test)]
mod tests {
    use crate::logfile::{LogOptions, LogVars, LogWriter};

    /// Log de prueba en una carpeta temporal propia.
    fn test_log(mask: bool) -> (LogWriter, std::path::PathBuf) {
        let dir = std::env::temp_dir().join(format!("nt-log-{}", uuid::Uuid::new_v4()));
        let opts = LogOptions { timestamps: true, mask, ..Default::default() };
        let vars = LogVars { session: "t".into(), ..Default::default() };
        (LogWriter::create(&dir, opts, vars).unwrap(), dir)
    }

    #[test]
    fn serial_ports_natural_order_and_registry() {
        use super::{parse_serialcomm, port_order};
        let mut v = vec!["COM10", "COM5", "COM3", "/dev/ttyUSB1", "/dev/ttyUSB0"];
        v.sort_by(|a, b| port_order(a, b));
        assert_eq!(v, ["/dev/ttyUSB0", "/dev/ttyUSB1", "COM3", "COM5", "COM10"]);
        let reg = "\r\nHKEY_LOCAL_MACHINE\\HARDWARE\\DEVICEMAP\\SERIALCOMM\r\n    \\Device\\Serial0    REG_SZ    COM3\r\n    \\Device\\Silabser0    REG_SZ    COM5\r\n\r\n";
        assert_eq!(parse_serialcomm(reg), ["COM3", "COM5"]);
    }

    #[test]
    fn builds_safe_scp_commands() {
        use crate::models::{ScpSpec, Session, SessionType};
        let mut s: Session = serde_json::from_value(serde_json::json!({
            "name": "sw", "type": "local", "host": "10.0.0.1", "username": "noc", "port": 22
        }))
        .unwrap();
        s.session_type = SessionType::Local;
        s.scp = Some(ScpSpec {
            upload: false,
            files: vec!["ios.bin".into()],
            remote_dir: "flash:".into(),
            local_paths: vec![],
            local_dir: "/tmp/tftp".into(),
            mode: None,
        });
        assert!(super::scp_command(&s).is_ok());
        // SFTP interactivo: sin archivos, en la carpeta compartida, host tras "--".
        s.scp.as_mut().unwrap().mode = Some("shell".into());
        s.scp.as_mut().unwrap().files = vec![];
        let cmd = super::scp_command(&s).unwrap();
        let argv: Vec<String> = cmd.get_argv().iter().map(|a| a.to_string_lossy().into_owned()).collect();
        assert!(argv[0].starts_with("sftp"));
        assert_eq!(&argv[argv.len() - 2..], ["--", "noc@10.0.0.1"]);
        s.scp.as_mut().unwrap().mode = Some("rsync".into());
        s.scp.as_mut().unwrap().files = vec!["ios.bin".into()];
        assert!(super::scp_command(&s).is_err());
        s.scp.as_mut().unwrap().mode = None;
        // Nombres que intentan inyectar opciones o rutas
        for bad in ["-oProxyCommand=x", "../etc/passwd", "a b"] {
            s.scp.as_mut().unwrap().files = vec![bad.into()];
            assert!(super::scp_command(&s).is_err(), "{bad}");
        }
        s.scp.as_mut().unwrap().files = vec!["ok.bin".into()];
        s.scp.as_mut().unwrap().remote_dir = "-F/tmp/x".into();
        assert!(super::scp_command(&s).is_err());
        s.scp.as_mut().unwrap().remote_dir = "flash:".into();
        s.host = Some("-oProxyCommand=sh".into());
        assert!(super::scp_command(&s).is_err());
    }

    #[test]
    fn writer_thread_keeps_order_and_encodes_telnet() {
        use std::sync::{Arc, Mutex};
        #[derive(Clone, Default)]
        struct Shared(Arc<Mutex<Vec<u8>>>);
        impl std::io::Write for Shared {
            fn write(&mut self, b: &[u8]) -> std::io::Result<usize> {
                self.0.lock().unwrap().extend_from_slice(b);
                Ok(b.len())
            }
            fn flush(&mut self) -> std::io::Result<()> {
                Ok(())
            }
        }
        let out = Shared::default();
        let tx = super::spawn_writer(Box::new(out.clone()), false);
        for i in 0..500 {
            tx.send(super::Outgoing::Data(format!("{i},").into_bytes())).unwrap();
        }
        drop(tx);
        let expected: String = (0..500).map(|i| format!("{i},")).collect();
        for _ in 0..50 {
            if out.0.lock().unwrap().len() == expected.len() {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        assert_eq!(String::from_utf8(out.0.lock().unwrap().clone()).unwrap(), expected);

        // Telnet: los datos se codifican (IAC duplicado) y los comandos Raw no.
        let out = Shared::default();
        let tx = super::spawn_writer(Box::new(out.clone()), true);
        tx.send(super::Outgoing::Data(vec![255])).unwrap();
        tx.send(super::Outgoing::Raw(vec![255, 243])).unwrap();
        drop(tx);
        std::thread::sleep(std::time::Duration::from_millis(100));
        assert_eq!(*out.0.lock().unwrap(), vec![255, 255, 255, 243]);
    }

    #[test]
    fn mirror_joins_utf8_split_between_chunks() {
        let mut m = super::Mirror::default();
        let s = "interfaz ñandú ─ ok".as_bytes();
        for chunk in s.chunks(1) {
            m.push(chunk);
        }
        assert_eq!(m.tail(1000), "interfaz ñandú ─ ok");
        assert_eq!(super::incomplete_utf8_tail("ab".as_bytes()), 0);
        assert_eq!(super::incomplete_utf8_tail(&[b'a', 0xE2, 0x94]), 2);
        assert_eq!(super::incomplete_utf8_tail(&[0xC3]), 1);
        assert_eq!(super::incomplete_utf8_tail("ñ".as_bytes()), 0);
    }

    #[test]
    fn resumes_only_logs_inside_the_log_folder() {
        let dir = std::env::temp_dir().join(format!("nt-logs-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        let ok = dir.join("core_20261020.log");
        std::fs::write(&ok, "x").unwrap();
        let other = dir.join("notas.txt");
        std::fs::write(&other, "x").unwrap();
        assert!(super::resumable_log(&dir, &ok).is_some());
        assert!(super::resumable_log(&dir, &other).is_none());
        assert!(super::resumable_log(&dir, &dir.join("no-existe.log")).is_none());
        assert!(super::resumable_log(&dir, &dir.join("../core_20261020.log")).is_none());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn rejects_argument_injection() {
        assert!(super::safe_target("-oProxyCommand=sh", "host").is_err());
        assert!(super::safe_target("10.0.0.1 -v", "host").is_err());
        assert_eq!(super::safe_target(" router.lab ", "host").unwrap(), "router.lab");
        assert_eq!(super::safe_target("[2001:db8::1]", "host").unwrap(), "2001:db8::1");
        assert!(super::safe_target("[-oProxyCommand=x]", "host").is_err());
        let bad = |s: &str| super::check_extra_args(&super::split_args(s)).is_err();
        assert!(bad("-oProxyCommand=curl x|sh"));
        assert!(bad("-o ProxyCommand=nc %h %p"));
        assert!(bad("-o 'LocalCommand id'"));
        assert!(bad("-F /tmp/evil_config"));
        assert!(bad("-o KnownHostsCommand=/bin/x"));
        assert!(!bad("-L 8443:10.0.0.1:443 -A -o StrictHostKeyChecking=accept-new"));
        assert!(!bad("-f -N -D 1080"));
        // Flags agrupados y opciones que cargan código.
        assert!(bad("-voProxyCommand=sh\\ -c\\ x"));
        assert!(bad("-vF/tmp/cfg"));
        assert!(bad("-oPKCS11Provider=/tmp/x.dylib"));
        assert!(bad("-o SecurityKeyProvider=/tmp/x"));
        assert!(bad("-I /tmp/lib.so"));
        assert!(bad("-o Include=/tmp/x"));
        assert!(bad("evil.example"));
        assert!(bad("-- otro-host"));
        assert!(bad("-L"));
        assert!(!bad("-vvv -C -o ServerAliveCountMax=3 -J bastion"));
        // Jump host, host y usuario con metacaracteres (ProxyJump pasa por sh -c en OpenSSH < 9.6).
        assert!(bad("-J 'x;id'"));
        assert!(bad("-vJx$(id)"));
        assert!(bad("-o ProxyJump=a`id`"));
        assert!(bad("-o 'Hostname x;id'"));
        assert!(bad("-o User=a|b"));
        assert!(bad("-l a;b"));
        assert!(!bad("-l DOMINIO\\\\usuario -o ProxyJump=noc@bastion:22 -o IdentityFile=~/.ssh/id_lab"));
    }

    #[test]
    fn rejects_shell_metacharacters_for_old_openssh() {
        // OpenSSH < 9.6 pasa el jump host y %h/%r por `sh -c` (CVE-2023-51385).
        for bad in ["x$(touch${IFS}/tmp/p)", "a;id", "h`id`", "h|nc", "a&b"] {
            assert!(super::safe_target(bad, "el jump host").is_err(), "{bad}");
        }
        assert!(super::safe_target("admin@bastion:2222,10.0.0.1", "el jump host").is_ok());
        assert!(super::safe_target("fe80::1%en0", "host").is_ok());
        assert!(super::safe_user("$(id)").is_err());
        assert!(super::safe_user("o'neil").is_err());
        assert_eq!(super::safe_user("DOM\\noc").unwrap(), "DOM\\noc");
        let s: crate::models::Session = serde_json::from_value(serde_json::json!({
            "name": "sw", "type": "ssh", "host": "10.0.0.1", "username": "$(id)"
        }))
        .unwrap();
        assert!(super::ssh_command(&s).is_err());
    }

    #[test]
    fn builds_and_validates_tunnels() {
        use crate::models::{Tunnel, TunnelKind};
        let t = |kind, bind: Option<&str>, lp, host: Option<&str>, dp| Tunnel {
            kind,
            bind: bind.map(String::from),
            listen_port: lp,
            dest_host: host.map(String::from),
            dest_port: dp,
        };
        let ok = super::tunnel_args(&[
            t(TunnelKind::Local, None, 8443, Some("192.0.2.10"), Some(443)),
            t(TunnelKind::Remote, Some("0.0.0.0"), 9000, Some("localhost"), Some(22)),
            t(TunnelKind::Dynamic, Some(""), 1080, None, None),
            t(TunnelKind::Local, Some("::1"), 8080, Some("[2001:db8::5]"), Some(80)),
        ])
        .unwrap();
        assert_eq!(
            ok,
            vec![
                "-L", "127.0.0.1:8443:192.0.2.10:443",
                "-R", "0.0.0.0:9000:localhost:22",
                "-D", "127.0.0.1:1080",
                "-L", "[::1]:8080:[2001:db8::5]:80",
            ]
        );
        // Inyección por destino o dirección, puertos en cero y destinos faltantes.
        for bad in [
            t(TunnelKind::Local, None, 80, Some("-oProxyCommand=sh"), Some(1)),
            t(TunnelKind::Local, None, 80, Some("a b"), Some(1)),
            t(TunnelKind::Local, Some("1.2.3.4 -v"), 80, Some("h"), Some(1)),
            t(TunnelKind::Local, None, 0, Some("h"), Some(1)),
            t(TunnelKind::Local, None, 80, Some("h"), None),
            t(TunnelKind::Remote, None, 80, None, Some(22)),
            t(TunnelKind::Local, None, 80, Some("*"), Some(22)),
        ] {
            assert!(super::tunnel_args(std::slice::from_ref(&bad)).is_err(), "{bad:?}");
        }
        let many: Vec<Tunnel> = (1..=33).map(|p| t(TunnelKind::Dynamic, None, p, None, None)).collect();
        assert!(super::tunnel_args(&many).is_err());
    }

    #[test]
    fn splits_ssh_args_with_quotes() {
        assert_eq!(
            super::split_args(r#"-L 8443:10.0.0.1:443 -o "ProxyCommand=nc -X 5 %h %p" -A"#),
            vec!["-L", "8443:10.0.0.1:443", "-o", "ProxyCommand=nc -X 5 %h %p", "-A"]
        );
        assert!(super::split_args("   ").is_empty());
    }

    #[test]
    fn legacy_options_only_use_supported_algorithms() {
        let opts = super::legacy_options();
        // En OpenSSH >= 10 ssh-dss ya no existe y no debe pedirse.
        let ver = std::process::Command::new("ssh").arg("-V").output();
        if let Ok(v) = ver {
            if String::from_utf8_lossy(&v.stderr).contains("OpenSSH_10") {
                assert!(opts.iter().all(|o| !o.contains("ssh-dss")));
            }
        }
        for o in opts {
            let ok = std::process::Command::new("ssh").args(["-G", "-o", o, "x"]).output().unwrap();
            assert!(ok.status.success(), "ssh rechazó {o}");
        }
    }

    /// Micro-benchmark del camino caliente (cargo test --release -- --ignored --nocapture bench_).
    #[test]
    #[ignore]
    fn bench_mirror_and_log() {
        use std::time::Instant;
        let line = "\x1b[32mGi1/0/1\x1b[0m   connected    10   a-full a-1000 10/100/1000BaseTX áé\r\n";
        let chunk: Vec<u8> = line.repeat(1024 / line.len() + 1).into_bytes()[..1024].to_vec();
        let total = 64 * 1024 * 1024 / chunk.len();
        let mut m = super::Mirror::default();
        let t = Instant::now();
        for _ in 0..total {
            m.push(&chunk);
        }
        let s = t.elapsed().as_secs_f64();
        println!("mirror sin taps: {:.0} MB/s ({:.2} us/chunk)", 64.0 / s, s * 1e6 / total as f64);
        let mut m = super::Mirror::default();
        let (tx, rx) = std::sync::mpsc::sync_channel(super::TAP_CAPACITY);
        m.taps.push(tx);
        let t = Instant::now();
        for _ in 0..total {
            m.push(&chunk);
            while rx.try_recv().is_ok() {}
        }
        let s = t.elapsed().as_secs_f64();
        println!("mirror con 1 tap: {:.0} MB/s ({:.2} us/chunk)", 64.0 / s, s * 1e6 / total as f64);
        for mask in [false, true] {
            let (mut w, dir) = test_log(mask);
            let t = Instant::now();
            for _ in 0..total / 4 {
                w.write(&chunk);
            }
            let s = t.elapsed().as_secs_f64();
            println!("log con hora, enmascarado={mask}: {:.0} MB/s ({:.2} us/chunk)", 16.0 / s, s * 1e6 / (total / 4) as f64);
            drop(w);
            let _ = std::fs::remove_dir_all(dir);
        }
        // Mirror con alertas activas (3 reglas que no coinciden).
        let hub = std::sync::Arc::new(crate::triggers::Hub::default());
        let rules = ["%LINK-3-UPDOWN", "%SYS-5-RESTART", "BGP.*Down"]
            .iter()
            .enumerate()
            .map(|(i, p)| serde_json::from_value(serde_json::json!({"id": i.to_string(), "pattern": p, "regex": true})).unwrap())
            .collect();
        hub.configure(rules, std::sync::Arc::new(|_| {})).unwrap();
        let mut m = super::Mirror { watch: Some(super::Watcher::new(hub, "c".into(), None)), ..Default::default() };
        let t = Instant::now();
        for _ in 0..total {
            m.push(&chunk);
        }
        let s = t.elapsed().as_secs_f64();
        println!("mirror con 3 alertas: {:.0} MB/s ({:.2} us/chunk)", 64.0 / s, s * 1e6 / total as f64);
    }

    /// Cuántas lecturas produce una salida masiva por PTY (tamaño típico de fragmento).
    #[test]
    #[ignore]
    fn bench_pty_chunk_sizes() {
        use portable_pty::{native_pty_system, CommandBuilder, PtySize};
        use std::io::Read;
        let pair = native_pty_system().openpty(PtySize { rows: 50, cols: 200, pixel_width: 0, pixel_height: 0 }).unwrap();
        let mut cmd = CommandBuilder::new("sh");
        cmd.args(["-c", "seq 1 400000"]);
        let mut child = pair.slave.spawn_command(cmd).unwrap();
        drop(pair.slave);
        let mut r = pair.master.try_clone_reader().unwrap();
        let (sink, log) = test_sink();
        let (mut reads, mut bytes, mut small) = (0usize, 0usize, 0usize);
        let mut buf = [0u8; 16 * 1024];
        let t = std::time::Instant::now();
        while let Ok(n) = r.read(&mut buf) {
            if n == 0 {
                break;
            }
            sink.push(&buf[..n]);
            reads += 1;
            bytes += n;
            small += (n < 1024) as usize;
            if bytes >= 2_700_000 {
                break;
            }
        }
        let elapsed = t.elapsed();
        let _ = child.kill();
        drop(sink);
        std::thread::sleep(std::time::Duration::from_millis(50));
        let msgs = log.lock().unwrap().len();
        println!(
            "PTY: {bytes} bytes en {reads} lecturas (prom {} B, {small} < 1 KB) en {elapsed:?} -> {msgs} mensajes al frontend",
            bytes / reads.max(1)
        );
    }

    #[test]
    fn mirror_trims_history_and_feeds_taps() {
        let mut m = super::Mirror::default();
        let (tx, rx) = std::sync::mpsc::sync_channel(super::TAP_CAPACITY);
        m.taps.push(tx);
        m.push(b"\x1b[1mab\x08c\x1b[0m\r\n");
        assert_eq!(rx.try_recv().unwrap(), "ac\n");
        // Un backspace al inicio del fragmento no borra lo anterior (igual que antes).
        m.push(b"\x08z");
        assert_eq!(m.tail(100), "ac\nz");
        let mut all = String::from("ac\nz");
        for i in 0..40_000 {
            let line = format!("línea {i}\n");
            m.push(line.as_bytes());
            all.push_str(&line);
        }
        assert!(m.history.len() <= 2 * super::HISTORY_MAX);
        let tail = m.tail(usize::MAX);
        assert!(tail.len() <= super::HISTORY_MAX && tail.len() > super::HISTORY_MAX - 4);
        assert!(all.ends_with(tail));
        assert!(all.ends_with(m.tail(50)) && m.tail(50).len() <= 50);
    }

    /// Mensajes recibidos por el canal de prueba, en orden (None = aviso de cierre).
    type Received = std::sync::Arc<std::sync::Mutex<Vec<(std::time::Instant, Option<Vec<u8>>)>>>;

    fn test_sink() -> (super::Sink, Received) {
        use std::sync::Arc;
        use tauri::ipc::{Channel, InvokeResponseBody};
        let log: Received = Arc::default();
        let l = log.clone();
        let data = Channel::new(move |b| {
            let entry = match b {
                InvokeResponseBody::Raw(v) => Some(v),
                InvokeResponseBody::Json(_) => None,
            };
            l.lock().unwrap().push((std::time::Instant::now(), entry));
            Ok(())
        });
        (super::Sink::new(data), log)
    }

    /// Un host Telnet que envía mucho y cierra: el cierre va por el mismo canal, después
    /// de todos los datos (antes podía adelantarse a datos grandes, que viajan por fetch).
    #[test]
    fn telnet_close_arrives_after_all_data() {
        use std::io::Write;
        for raw in [false, true] {
            let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            let port = listener.local_addr().unwrap().port();
            let payload: Vec<u8> = (0..200_000u32).map(|i| b'a' + (i % 26) as u8).collect();
            let p = payload.clone();
            let server = std::thread::spawn(move || {
                let (mut s, _) = listener.accept().unwrap();
                s.write_all(&p).unwrap();
                // Cierra de inmediato (sin esperar), el caso que provocaba la carrera.
            });
            let session: crate::models::Session = serde_json::from_value(serde_json::json!({
                "name": "t", "type": if raw { "raw" } else { "telnet" }, "host": "127.0.0.1", "port": port
            }))
            .unwrap();
            let (sink, log) = test_sink();
            let _t = super::open_telnet(&session, 80, 24, &sink, raw).unwrap();
            server.join().unwrap();
            let t = std::time::Instant::now();
            while !log.lock().unwrap().iter().any(|(_, d)| d.is_none()) {
                assert!(t.elapsed() < std::time::Duration::from_secs(5), "sin aviso de cierre");
                std::thread::sleep(std::time::Duration::from_millis(5));
            }
            let entries = log.lock().unwrap();
            assert!(entries.last().unwrap().1.is_none(), "el cierre debe ser el último mensaje");
            assert_eq!(entries.iter().filter(|(_, d)| d.is_none()).count(), 1);
            let got: Vec<u8> = entries.iter().filter_map(|(_, d)| d.clone()).flatten().collect();
            assert_eq!(got, payload);
        }
    }

    /// Equipo Telnet simulado como Huawei VRP: negocia ECHO y SGA, hace eco de lo tecleado,
    /// borra con ^H (CTRL_H, tecla de sistema de VRP) respondiendo "\b \b" y, si `accepts_del`,
    /// también con DEL. Al recibir CR devuelve la línea que quedó para comprobarla.
    fn fake_vrp(accepts_del: bool) -> (u16, std::thread::JoinHandle<Vec<u8>>) {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let h = std::thread::spawn(move || {
            let (mut s, _) = listener.accept().unwrap();
            s.set_read_timeout(Some(std::time::Duration::from_secs(5))).unwrap();
            s.write_all(&[255, 251, 1, 255, 251, 3]).unwrap();
            s.write_all(b"\r\n<HUAWEI>").unwrap();
            let (mut received, mut line, mut iac) = (Vec::new(), Vec::<u8>::new(), 0usize);
            let mut buf = [0u8; 256];
            'outer: while let Ok(n @ 1..) = s.read(&mut buf) {
                for &b in &buf[..n] {
                    // Respuestas de negociación del cliente (IAC DO x): no son datos.
                    if iac > 0 || b == 255 {
                        iac = if iac == 0 { 2 } else { iac - 1 };
                        continue;
                    }
                    received.push(b);
                    match b {
                        0 => {}
                        b'\r' => {
                            s.write_all(format!("\r\nline={}\r\n<HUAWEI>", String::from_utf8_lossy(&line)).as_bytes()).unwrap();
                            if line == b"quit" {
                                break 'outer;
                            }
                            line.clear();
                        }
                        0x08 | 0x7f if b == 0x08 || accepts_del => {
                            if line.pop().is_some() {
                                s.write_all(b"\x08 \x08").unwrap();
                            }
                        }
                        0x7f => {}
                        _ => {
                            line.push(b);
                            s.write_all(&[b]).unwrap();
                        }
                    }
                }
            }
            received
        });
        (port, h)
    }

    /// Con Retroceso = BS la PTY de ssh borra con ^H (y OpenSSH lo informa al servidor); por
    /// defecto queda DEL (^?), el valor estándar de macOS y Linux.
    #[cfg(unix)]
    #[test]
    fn ssh_pty_erase_follows_backspace_mode() {
        for (erase, want) in [(None, "erase = ^?"), (Some(0x08), "erase = ^H")] {
            let (sink, log) = test_sink();
            let mut cmd = portable_pty::CommandBuilder::new("sh");
            cmd.args(["-c", "stty -a; sleep 0.3"]);
            let _t = super::spawn_pty(cmd, 80, 24, &sink, erase).unwrap();
            let t = std::time::Instant::now();
            loop {
                let out: Vec<u8> = log.lock().unwrap().iter().filter_map(|(_, d)| d.clone()).flatten().collect();
                if String::from_utf8_lossy(&out).contains(want) {
                    break;
                }
                assert!(t.elapsed() < std::time::Duration::from_secs(5), "stty no mostró {want:?}: {}", String::from_utf8_lossy(&out));
                std::thread::sleep(std::time::Duration::from_millis(10));
            }
        }
        let s: crate::models::Session = serde_json::from_value(serde_json::json!({ "name": "s", "type": "ssh", "backspace": "bs" })).unwrap();
        assert_eq!(super::erase_of(&s), Some(0x08));
        let s: crate::models::Session = serde_json::from_value(serde_json::json!({ "name": "s", "type": "ssh" })).unwrap();
        assert_eq!(super::erase_of(&s), None);
    }

    /// Retroceso por Telnet: ^H y DEL llegan al equipo sin cambios (solo CR pasa a CR NUL) y el
    /// eco "\b \b" del equipo vuelve intacto. Un VRP que solo borra con ^H ignora DEL.
    #[test]
    fn telnet_backspace_reaches_vrp_unchanged() {
        for accepts_del in [false, true] {
            let (port, server) = fake_vrp(accepts_del);
            let session: crate::models::Session = serde_json::from_value(serde_json::json!({
                "name": "vrp", "type": "telnet", "host": "127.0.0.1", "port": port
            }))
            .unwrap();
            let got = std::sync::Arc::new(std::sync::Mutex::new(Vec::<u8>::new()));
            let g = got.clone();
            let data = tauri::ipc::Channel::new(move |b| {
                if let tauri::ipc::InvokeResponseBody::Raw(v) = b {
                    g.lock().unwrap().extend(v);
                }
                Ok(())
            });
            let mgr = super::ConnectionManager::default();
            mgr.connect("c1".into(), &session, 80, 24, data, None).unwrap();
            let wait_for = |want: &str| {
                let t = std::time::Instant::now();
                while !String::from_utf8_lossy(&got.lock().unwrap()).contains(want) {
                    assert!(t.elapsed() < std::time::Duration::from_secs(5), "no llegó {want:?} (DEL aceptado: {accepts_del})");
                    std::thread::sleep(std::time::Duration::from_millis(5));
                }
            };
            wait_for("<HUAWEI>");
            // Como teclea la terminal: una tecla por escritura.
            for k in ["d", "i", "x", "\x08", "s", "\r"] {
                mgr.write("c1", k.as_bytes()).unwrap();
            }
            wait_for("line=dis\r\n");
            for k in ["a", "b", "\x7f", "\r"] {
                mgr.write("c1", k.as_bytes()).unwrap();
            }
            wait_for(if accepts_del { "line=a\r\n" } else { "line=ab\r\n" });
            mgr.write("c1", b"quit\r").unwrap();
            let received = server.join().unwrap();
            assert_eq!(received, b"dix\x08s\r\0ab\x7f\r\0quit\r", "bytes de control intactos (el equipo cierra antes del NUL final)");
            let screen = got.lock().unwrap().clone();
            assert!(screen.windows(5).any(|w| w == b"dix\x08 "), "eco \\b \\b intacto y en orden");
            mgr.disconnect("c1");
        }
    }

    #[test]
    fn sink_coalesces_bursts_and_keeps_order() {
        use std::time::{Duration, Instant};
        let (sink, log) = test_sink();
        // Ráfaga: muchas líneas cortas, como entrega un PTY.
        let mut expected = Vec::new();
        let pushes = 100_000;
        for i in 0..pushes {
            let line = format!("{i}\r\n");
            sink.push(line.as_bytes());
            expected.extend_from_slice(line.as_bytes());
        }
        std::thread::sleep(Duration::from_millis(50));
        let msgs = log.lock().unwrap().len();
        let got: Vec<u8> = log.lock().unwrap().iter().flat_map(|(_, d)| d.clone().unwrap()).collect();
        assert_eq!(got, expected);
        println!("ráfaga: {pushes} fragmentos -> {msgs} mensajes al frontend");
        assert!(msgs < pushes / 10, "{msgs}");

        // Fragmento aislado (eco de una tecla): sale sin esperar la ventana.
        log.lock().unwrap().clear();
        let t = Instant::now();
        sink.push(b"x");
        while log.lock().unwrap().is_empty() {
            assert!(t.elapsed() < Duration::from_secs(1));
            std::thread::yield_now();
        }
        let latency = log.lock().unwrap()[0].0 - t;
        println!("latencia de un fragmento aislado: {latency:?}");
        assert!(latency < super::FLUSH_WINDOW);

        // El cierre llega después de todos los datos.
        log.lock().unwrap().clear();
        for _ in 0..1000 {
            sink.push(b"fin de sesion\r\n");
        }
        sink.close("cerrado");
        let entries = log.lock().unwrap();
        let data: usize = entries.iter().filter_map(|(_, d)| d.as_ref().map(Vec::len)).sum();
        assert_eq!(data, 15_000);
        assert!(entries.last().unwrap().1.is_none());
    }

    #[test]
    fn sink_drop_flushes_and_stops_thread() {
        let (sink, log) = test_sink();
        sink.push(b"a");
        sink.push(b"b");
        sink.push(b"c");
        let out = std::sync::Arc::downgrade(&sink.out.0);
        drop(sink);
        for _ in 0..100 {
            if out.upgrade().is_none() {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(5));
        }
        assert!(out.upgrade().is_none(), "el hilo de envío no terminó");
        let got: Vec<u8> = log.lock().unwrap().iter().flat_map(|(_, d)| d.clone().unwrap()).collect();
        assert_eq!(got, b"abc");
    }

    #[test]
    fn log_strips_ansi_and_stamps_lines() {
        for mask in [false, true] {
            let (mut w, dir) = test_log(mask);
            w.write(b"\x1b[32mRouter#\x1b[0m show ver\r\nCisco");
            w.write(b" IOS\r\n");
            let path = w.path().to_path_buf();
            drop(w);
            let text = std::fs::read_to_string(&path).unwrap();
            let lines: Vec<_> = text.lines().collect();
            assert_eq!(lines.len(), 2);
            assert!(lines[0].starts_with('[') && lines[0].ends_with("] Router# show ver"));
            assert!(lines[1].ends_with("] Cisco IOS"));
            let _ = std::fs::remove_dir_all(dir);
        }
    }

    /// Contraseña guardada escrita a pedido de un script: solo con un pedido de login en
    /// pantalla, una vez por pedido, nunca tras un rechazo, y sin pasar por el historial, los
    /// suscriptores ni el log.
    #[test]
    fn typed_saved_password_once_per_prompt_and_never_logged() {
        use std::io::{BufRead, BufReader, Write};
        use std::time::Duration;
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let (step_tx, step_rx) = std::sync::mpsc::channel::<&'static [u8]>();
        let (got_tx, got_rx) = std::sync::mpsc::channel::<String>();
        let server = std::thread::spawn(move || {
            let (s, _) = listener.accept().unwrap();
            let mut w = s.try_clone().unwrap();
            let mut r = BufReader::new(s);
            std::thread::spawn(move || {
                let mut line = Vec::new();
                while r.read_until(b'\r', &mut line).unwrap_or(0) > 0 {
                    let _ = got_tx.send(String::from_utf8_lossy(&line).into_owned());
                    line.clear();
                }
            });
            for step in step_rx {
                w.write_all(step).unwrap();
            }
        });
        let session: crate::models::Session = serde_json::from_value(serde_json::json!({
            "name": "t", "type": "raw", "host": "127.0.0.1", "port": port
        }))
        .unwrap();
        let mgr = super::ConnectionManager::default();
        mgr.connect("c1".into(), &session, 80, 24, tauri::ipc::Channel::new(|_| Ok(())), None).unwrap();
        let dir = std::env::temp_dir().join(format!("nt-ts-{}", uuid::Uuid::new_v4()));
        let opts = crate::logfile::LogOptions { mask: false, ..Default::default() };
        let path = mgr.set_logging("c1", true, opts, &dir, None).unwrap().unwrap();
        let tap = mgr.tap("c1").unwrap();
        let fill = || super::FillSpec { secret: zeroize::Zeroizing::new("Sup3r-S3cret".into()), user: None, only_host: None };
        let show = |b: &'static [u8]| {
            step_tx.send(b).unwrap();
            let t = std::time::Instant::now();
            let want = String::from_utf8_lossy(b).replace('\r', "");
            while !mgr.history("c1", 10_000).unwrap().ends_with(&want) {
                assert!(t.elapsed() < Duration::from_secs(3), "no llegó {want:?}");
                std::thread::sleep(Duration::from_millis(5));
            }
        };

        // Prompt de comandos: no hay pedido, nada se escribe.
        show(b"router>");
        assert_eq!(mgr.type_saved("c1", fill(), None, false), Err(crate::autofill::NO_PROMPT.into()));
        // Pedido de login: se escribe una vez; el mismo pedido no se responde dos veces.
        show(b"\r\nUser Access Verification\r\n\r\nPassword: ");
        assert_eq!(mgr.type_saved("c1", fill(), None, false), Ok(()));
        assert_eq!(got_rx.recv_timeout(Duration::from_secs(3)).unwrap(), "Sup3r-S3cret\r");
        assert!(mgr.type_saved("c1", fill(), None, false).unwrap_err().contains("ya se respondió"));
        // Rechazo y nuevo pedido: no se reintenta.
        show(b"\r\n% Login invalid\r\n\r\nPassword: ");
        assert_eq!(mgr.type_saved("c1", fill(), None, false), Err(crate::autofill::AFTER_DENIED.into()));
        // Pedido de otro equipo (un ssh lanzado dentro de la sesión): no.
        show(b"\r\nUser Access Verification\r\nUsername: noc\r\nrouter>show clock\r\n10:00:00 UTC\r\nrouter>ssh -l noc 198.51.100.9\r\nnoc@198.51.100.9's password: ");
        assert_eq!(mgr.type_saved("c1", fill(), None, false), Err(crate::autofill::OTHER_HOST.into()));
        // Pedido nuevo y válido más adelante: sí, otra vez una sola.
        show(b"\r\nConnection closed\r\nrouter>login\r\n\r\nPassword: ");
        assert_eq!(mgr.type_saved("c1", fill(), None, false), Ok(()));
        assert_eq!(got_rx.recv_timeout(Duration::from_secs(3)).unwrap(), "Sup3r-S3cret\r");
        show(b"\r\nrouter>");
        assert!(got_rx.recv_timeout(Duration::from_millis(200)).is_err(), "nada más llegó al equipo");

        let history = mgr.history("c1", 100_000).unwrap();
        let tapped: String = tap.try_iter().collect();
        mgr.set_logging("c1", false, Default::default(), &dir, None).unwrap();
        mgr.disconnect("c1");
        let log = std::fs::read_to_string(&path).unwrap();
        for (what, text) in [("historial", &history), ("suscriptores", &tapped), ("log", &log)] {
            assert!(text.contains("Password:") && !text.contains("Sup3r"), "{what}: {text}");
        }
        drop(step_tx);
        server.join().unwrap();
        let _ = std::fs::remove_dir_all(dir);
    }

    /// El autocompletado ya respondió el pedido: un script no vuelve a escribir encima.
    #[test]
    fn autofilled_prompt_is_not_typed_again() {
        let (tx, rx) = std::sync::mpsc::channel();
        let mut m = super::Mirror::default();
        let af = crate::autofill::AutoFill::new(zeroize::Zeroizing::new("S3cret".into()), None, "\r", std::time::Instant::now());
        m.autofill = Some((af, tx.clone()));
        m.push(b"banner\r\nPassword: ");
        assert!(matches!(rx.try_recv(), Ok(super::Outgoing::Secret(_))));
        assert!(m.type_secret(&tx, "S3cret", "\r", None, false).unwrap_err().contains("ya se respondió"));
        assert!(rx.try_recv().is_err());
    }

    /// Contraseña de un salto: solo tras el eco del comando de salto, una vez por paso y sin llegar
    /// al log, al historial ni a los suscriptores.
    #[test]
    fn hop_password_needs_the_hop_echo_and_is_tried_once() {
        use crate::autofill::{AFTER_DENIED, NO_PROMPT, OTHER_HOST};
        let (tx, rx) = std::sync::mpsc::channel();
        let mut m = super::Mirror::default();
        let cmd = "ssh -l noc 192.0.2.11";
        let typed = |m: &mut super::Mirror, token: &str| m.type_hop_secret(&tx, "V3cino", "\r", "192.0.2.11", cmd, token);
        // El pedido del propio pivote (login de la pestaña), sin comando de salto antes: no.
        m.push(b"Welcome\r\nPassword: ");
        assert_eq!(typed(&mut m, "t1|0"), Err(super::HOP_NO_ECHO.into()));
        // Con el comando enviado pero el prompt de comandos a la vista (salto rechazado) no hay pedido.
        m.push(b"\r\ncore-sw01#ssh -l noc 192.0.2.11\r\n% Connection refused by remote host\r\ncore-sw01#");
        assert_eq!(typed(&mut m, "t1|0"), Err(NO_PROMPT.into()));
        // Comando de salto enviado y pedido del vecino: se escribe.
        m.push(b"ssh -l noc 192.0.2.11\r\nPassword: ");
        assert_eq!(typed(&mut m, "t1|0"), Ok(()));
        assert!(matches!(rx.try_recv(), Ok(super::Outgoing::Secret(s)) if &s[..] == b"V3cino\r"));
        // Mismo pedido o mismo paso: no.
        assert!(typed(&mut m, "t1|0").unwrap_err().contains("ya se intentó"));
        // Rechazo y nuevo pedido: no se reintenta (ni con otro token, por el rechazo reciente).
        m.push(b"\r\n% Authentication failed.\r\nPassword: ");
        assert!(typed(&mut m, "t1|0").unwrap_err().contains("ya se intentó"));
        assert_eq!(typed(&mut m, "t1|1"), Err(AFTER_DENIED.into()));
        assert!(rx.try_recv().is_err(), "no se escribió nada más");
        // Un pedido que nombra a otro host no recibe la contraseña de este vecino; el que nombra al
        // vecino sí, con un paso nuevo.
        let mut m2 = super::Mirror::default();
        m2.push(b"core-sw01#ssh -l noc 192.0.2.11\r\nnoc@203.0.113.9's password: ");
        assert_eq!(typed(&mut m2, "t1|2"), Err(OTHER_HOST.into()));
        let mut m3 = super::Mirror::default();
        m3.push(b"core-sw01#ssh -l noc 192.0.2.11\r\nnoc@192.0.2.11's password: ");
        assert_eq!(typed(&mut m3, "t1|2"), Ok(()));
        assert!(matches!(rx.try_recv(), Ok(super::Outgoing::Secret(_))));
        // El valor no queda en el historial de pantalla (solo ve lo que devuelve el equipo).
        assert!(!m.history.contains("V3cino"));
    }

    /// Login por TCP con contraseña guardada: se envían usuario y contraseña una sola vez,
    /// y la contraseña no aparece en el log, el historial ni los suscriptores (MCP/scripts).
    #[test]
    fn autofill_login_never_reaches_log_or_history() {
        use std::io::{BufRead, BufReader, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = std::thread::spawn(move || {
            let (s, _) = listener.accept().unwrap();
            let mut w = s.try_clone().unwrap();
            let mut r = BufReader::new(s);
            let mut got = Vec::new();
            std::thread::sleep(std::time::Duration::from_millis(300));
            w.write_all(b"\r\nUser Access Verification\r\n\r\nUsername: ").unwrap();
            let mut line = Vec::new();
            r.read_until(b'\r', &mut line).unwrap();
            got.push(String::from_utf8_lossy(&line).into_owned());
            // El equipo hace eco del usuario, no de la contraseña.
            w.write_all(b"noc\r\nPassword: ").unwrap();
            line.clear();
            r.read_until(b'\r', &mut line).unwrap();
            got.push(String::from_utf8_lossy(&line).into_owned());
            // Un segundo prompt (enable) no se responde.
            w.write_all(b"\r\nrouter>enable\r\nPassword: ").unwrap();
            w.set_read_timeout(Some(std::time::Duration::from_millis(400))).ok();
            r.get_ref().set_read_timeout(Some(std::time::Duration::from_millis(400))).unwrap();
            line.clear();
            let extra = r.read_until(b'\r', &mut line).unwrap_or(0);
            (got, extra)
        });

        let session: crate::models::Session = serde_json::from_value(serde_json::json!({
            "name": "t", "type": "raw", "host": "127.0.0.1", "port": port, "username": "noc"
        }))
        .unwrap();
        let data = tauri::ipc::Channel::new(|_| Ok(()));
        let mgr = super::ConnectionManager::default();
        let fill = super::FillSpec { secret: zeroize::Zeroizing::new("Sup3r-S3cret".into()), user: Some("noc".into()), only_host: None };
        mgr.connect("c1".into(), &session, 80, 24, data, Some(fill)).unwrap();
        let dir = std::env::temp_dir().join(format!("nt-af-{}", uuid::Uuid::new_v4()));
        let opts = crate::logfile::LogOptions { mask: false, ..Default::default() };
        let path = mgr.set_logging("c1", true, opts, &dir, None).unwrap().unwrap();
        let tap = mgr.tap("c1").unwrap();

        let (got, extra) = server.join().unwrap();
        assert_eq!(got, vec!["noc\r".to_string(), "Sup3r-S3cret\r".to_string()]);
        assert_eq!(extra, 0, "no debe responder el segundo prompt");

        let history = mgr.history("c1", 10_000).unwrap();
        assert!(history.contains("Password:") && !history.contains("Sup3r"));
        let tapped: String = tap.try_iter().collect();
        assert!(!tapped.contains("Sup3r"));
        mgr.set_logging("c1", false, Default::default(), &dir, None).unwrap();
        mgr.disconnect("c1");
        let log = std::fs::read_to_string(&path).unwrap();
        assert!(log.contains("Username:") && !log.contains("Sup3r"));
        let _ = std::fs::remove_dir_all(dir);
    }
}
