//! Servidores locales para el trabajo con equipos: TFTP (RFC 1350 + blksize/tsize),
//! HTTP de solo lectura y Syslog (UDP). Apagados por defecto; escuchan solo mientras
//! el usuario los mantiene activos.

use serde::Serialize;
use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::net::{SocketAddr, UdpSocket};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

#[derive(Default)]
pub struct Servers {
    flags: Mutex<HashMap<&'static str, Arc<AtomicBool>>>,
    /// Escritura habilitada (TFTP y FTP): se cambia en caliente, sin reiniciar el servidor,
    /// así no se cortan transferencias en curso ni cambian las credenciales FTP.
    writes: Mutex<HashMap<&'static str, Arc<AtomicBool>>>,
    http: Mutex<Option<Arc<tiny_http::Server>>>,
}

#[derive(Serialize, Clone)]
struct TransferEvent {
    id: String,
    proto: &'static str,
    client: String,
    file: String,
    dir: &'static str, // "get" (equipo descarga) | "put" (equipo sube)
    bytes: u64,
    total: Option<u64>,
    done: bool,
    error: Option<String>,
}

#[derive(Serialize, Clone)]
pub struct SyslogMsg {
    ts: i64,
    src: String,
    severity: u8,
    facility: u8,
    msg: String,
}

/// Ruta segura dentro de `root`: sin "..", sin rutas absolutas ni unidades.
pub fn safe_path(root: &Path, requested: &str) -> Option<PathBuf> {
    let req = requested.replace('\\', "/");
    let mut out = root.to_path_buf();
    for comp in Path::new(req.trim_start_matches('/')).components() {
        match comp {
            // En Windows un ":" en medio ("a/C:/x") es una unidad que reemplaza toda la ruta
            // al hacer push, o un flujo alternativo NTFS ("ios.bin:oculto").
            Component::Normal(c) if cfg!(windows) && c.to_string_lossy().contains(':') => return None,
            Component::Normal(c) => out.push(c),
            Component::CurDir => {}
            _ => return None, // ParentDir, RootDir, Prefix (C:\)
        }
    }
    (out != root).then_some(out)
}

/// Verifica que la ruta real (tras resolver enlaces) siga dentro de `root`.
pub(crate) fn inside_root(root: &Path, path: &Path) -> bool {
    let Ok(root) = root.canonicalize() else { return false };
    let target = if path.exists() { path.canonicalize() } else { path.parent().map(|p| p.canonicalize()).unwrap_or(Err(std::io::ErrorKind::NotFound.into())) };
    target.map(|t| t.starts_with(&root)).unwrap_or(false)
}

impl Servers {
    pub(crate) fn flag(&self, name: &'static str) -> Arc<AtomicBool> {
        let f = Arc::new(AtomicBool::new(true));
        if let Some(old) = self.flags.lock().unwrap().insert(name, f.clone()) {
            old.store(false, Ordering::SeqCst);
        }
        f
    }

    /// Bandera de escritura de un servidor que se inicia (reemplaza la anterior).
    pub(crate) fn write_flag(&self, name: &'static str, allow: bool) -> Arc<AtomicBool> {
        let f = Arc::new(AtomicBool::new(allow));
        self.writes.lock().unwrap().insert(name, f.clone());
        f
    }

    /// Escritura del servidor en marcha (None si no está activo).
    pub fn write_allowed(&self, name: &str) -> Option<bool> {
        if !self.flags.lock().unwrap().contains_key(name) {
            return None;
        }
        self.writes.lock().unwrap().get(name).map(|f| f.load(Ordering::SeqCst))
    }

    /// Habilita o quita la escritura sin reiniciar. Devuelve el valor anterior.
    pub fn set_write(&self, name: &str, allow: bool) -> Result<bool, String> {
        if !self.flags.lock().unwrap().contains_key(name) {
            return Err("El servidor no está activo".into());
        }
        let writes = self.writes.lock().unwrap();
        let f = writes.get(name).ok_or("Este servidor no admite subidas")?;
        Ok(f.swap(allow, Ordering::SeqCst))
    }

    pub fn stop(&self, name: &str) {
        if let Some(f) = self.flags.lock().unwrap().remove(name) {
            f.store(false, Ordering::SeqCst);
        }
        self.writes.lock().unwrap().remove(name);
        if name == "http" {
            if let Some(s) = self.http.lock().unwrap().take() {
                s.unblock();
            }
        }
    }

    pub fn running(&self) -> Vec<String> {
        let mut v: Vec<String> = self.flags.lock().unwrap().keys().map(|k| k.to_string()).collect();
        if self.http.lock().unwrap().is_some() {
            v.push("http".into());
        }
        v
    }

    // ---------- TFTP ----------

    pub fn start_tftp(&self, app: AppHandle, root: PathBuf, port: u16, allow_write: bool) -> Result<String, String> {
        fs::create_dir_all(&root).map_err(|e| e.to_string())?;
        self.stop("tftp");
        let sock = bind_udp(port).map_err(|e| bind_error("TFTP", port, e))?;
        sock.set_read_timeout(Some(Duration::from_millis(400))).ok();
        let flag = self.flag("tftp");
        let allow_write = self.write_flag("tftp", allow_write);
        std::thread::spawn(move || {
            let mut buf = [0u8; 2048];
            // Sesiones activas por equipo: descarta pedidos retransmitidos (el mismo RRQ dos
            // veces abriría dos envíos en paralelo) y limita los hilos ante un flood UDP.
            let active: Arc<Mutex<std::collections::HashSet<SocketAddr>>> = Arc::default();
            while flag.load(Ordering::SeqCst) {
                let Ok((n, peer)) = sock.recv_from(&mut buf) else { continue };
                {
                    let mut set = active.lock().unwrap();
                    if set.contains(&peer) || set.len() >= TFTP_MAX_SESSIONS {
                        continue;
                    }
                    set.insert(peer);
                }
                let req = buf[..n].to_vec();
                let (app, root, flag, active, write) = (app.clone(), root.clone(), flag.clone(), active.clone(), allow_write.clone());
                std::thread::spawn(move || {
                    tftp_session(app, root, write.load(Ordering::SeqCst), peer, req, flag);
                    active.lock().unwrap().remove(&peer);
                });
            }
        });
        Ok(format!("TFTP escuchando en UDP {port}"))
    }

    // ---------- HTTP ----------

    pub fn start_http(&self, app: AppHandle, root: PathBuf, port: u16) -> Result<String, String> {
        fs::create_dir_all(&root).map_err(|e| e.to_string())?;
        self.stop("http");
        let server = Arc::new(
            tiny_http::Server::http(("0.0.0.0", port)).map_err(|e| format!("No se pudo abrir el puerto HTTP {port}: {e}"))?,
        );
        *self.http.lock().unwrap() = Some(server.clone());
        std::thread::spawn(move || {
            let active = Arc::new(AtomicUsize::new(0));
            for req in server.incoming_requests() {
                let (app, root) = (app.clone(), root.clone());
                if let Err(req) = spawn_limited(&active, HTTP_MAX_CLIENTS, req, move |req| http_serve(app, root, req)) {
                    let _ = req.respond(tiny_http::Response::empty(503));
                }
            }
        });
        Ok(format!("HTTP escuchando en TCP {port} (solo lectura)"))
    }

    // ---------- Syslog ----------

    pub fn start_syslog(&self, app: AppHandle, port: u16, save_dir: Option<PathBuf>) -> Result<String, String> {
        self.stop("syslog");
        let sock = bind_udp(port).map_err(|e| bind_error("Syslog", port, e))?;
        sock.set_read_timeout(Some(Duration::from_millis(200))).ok();
        let flag = self.flag("syslog");
        std::thread::spawn(move || {
            let mut buf = [0u8; 8192];
            let mut batch: Vec<SyslogMsg> = Vec::new();
            let mut last_flush = Instant::now();
            let mut file: Option<(String, File)> = None;
            while flag.load(Ordering::SeqCst) {
                if let Ok((n, peer)) = sock.recv_from(&mut buf) {
                    let msg = parse_syslog(&String::from_utf8_lossy(&buf[..n]), peer);
                    if let Some(dir) = &save_dir {
                        let day = chrono::Local::now().format("%Y-%m-%d").to_string();
                        if file.as_ref().map(|(d, _)| d != &day).unwrap_or(true) {
                            let _ = fs::create_dir_all(dir);
                            file = fs::OpenOptions::new()
                                .create(true)
                                .append(true)
                                .open(dir.join(format!("syslog_{day}.log")))
                                .ok()
                                .map(|f| (day, f));
                        }
                        if let Some((_, f)) = file.as_mut() {
                            let _ = writeln!(f, "{} {} <{}.{}> {}", chrono::Local::now().format("%H:%M:%S"), msg.src, msg.facility, msg.severity, one_line(&msg.msg));
                        }
                    }
                    batch.push(msg);
                }
                // Envío por lotes para no saturar la interfaz con ráfagas de logs.
                if !batch.is_empty() && (last_flush.elapsed() > Duration::from_millis(250) || batch.len() >= 500) {
                    let _ = app.emit("syslog", std::mem::take(&mut batch));
                    last_flush = Instant::now();
                }
            }
        });
        Ok(format!("Syslog escuchando en UDP {port}"))
    }

    // ---------- Receptor de traps SNMP ----------

    /// Muestra los traps e informs que llegan (v1, v2c y cabecera de v3). Responde los
    /// informs v2c para que el equipo no los reintente. La community nunca se muestra.
    pub fn start_snmptrap(&self, app: AppHandle, addr: SocketAddr, usm: Option<crate::snmp::V3Creds>) -> Result<String, String> {
        self.stop("snmptrap");
        let port = addr.port();
        let mut sock = UdpSocket::bind(addr);
        for _ in 0..10 {
            match &sock {
                Err(e) if e.kind() == std::io::ErrorKind::AddrInUse => {
                    std::thread::sleep(Duration::from_millis(150));
                    sock = UdpSocket::bind(addr);
                }
                _ => break,
            }
        }
        let sock = sock.map_err(|e| bind_error("Traps SNMP", port, e))?;
        sock.set_read_timeout(Some(Duration::from_millis(200))).ok();
        let flag = self.flag("snmptrap");
        let mut usm = usm.map(crate::snmp::TrapUsm::new);
        std::thread::spawn(move || {
            let mut buf = vec![0u8; 65535];
            let mut batch: Vec<crate::snmp::Trap> = Vec::new();
            let mut last_flush = Instant::now();
            while flag.load(Ordering::SeqCst) {
                if let Ok((n, peer)) = sock.recv_from(&mut buf) {
                    // Tope por lote: una ráfaga no debe congelar la interfaz.
                    if batch.len() < 500 {
                        match crate::snmp::decode_trap(&buf[..n], peer, usm.as_mut()) {
                            Ok((trap, reply)) => {
                                if let Some(r) = reply {
                                    let _ = sock.send_to(&r, peer);
                                }
                                batch.push(trap);
                            }
                            Err(e) => batch.push(crate::snmp::Trap::invalid(peer, e)),
                        }
                    }
                }
                if !batch.is_empty() && last_flush.elapsed() > Duration::from_millis(250) {
                    let _ = app.emit("snmp-trap", std::mem::take(&mut batch));
                    last_flush = Instant::now();
                }
            }
        });
        Ok(format!("Receptor de traps escuchando en {addr} (UDP)"))
    }
}

/// Descargas HTTP simultáneas como máximo (un hilo por cliente).
const HTTP_MAX_CLIENTS: usize = 32;

/// Atiende `item` en un hilo propio si hay cupo; si no, lo devuelve para rechazarlo. Evita
/// que una ráfaga de peticiones cree hilos sin límite.
pub fn spawn_limited<T: Send + 'static>(
    active: &Arc<AtomicUsize>,
    max: usize,
    item: T,
    f: impl FnOnce(T) + Send + 'static,
) -> Result<(), T> {
    if active.fetch_add(1, Ordering::SeqCst) >= max {
        active.fetch_sub(1, Ordering::SeqCst);
        return Err(item);
    }
    struct Slot(Arc<AtomicUsize>);
    impl Drop for Slot {
        fn drop(&mut self) {
            self.0.fetch_sub(1, Ordering::SeqCst);
        }
    }
    let slot = Slot(active.clone());
    std::thread::spawn(move || {
        let _slot = slot;
        f(item);
    });
    Ok(())
}

/// Al reiniciar un servidor, el hilo anterior suelta el puerto en hasta ~400 ms.
fn bind_udp(port: u16) -> std::io::Result<UdpSocket> {
    let mut last = None;
    for _ in 0..10 {
        match UdpSocket::bind(("0.0.0.0", port)) {
            Ok(s) => return Ok(s),
            Err(e) if e.kind() == std::io::ErrorKind::AddrInUse => {
                last = Some(e);
                std::thread::sleep(Duration::from_millis(150));
            }
            Err(e) => return Err(e),
        }
    }
    Err(last.unwrap())
}

/// Puerto sin privilegios sugerido para cada servicio (el mismo que indica la interfaz).
pub(crate) fn unprivileged_port(port: u16) -> u16 {
    match port {
        69 => 1069,
        80 => 8080,
        21 => 2121,
        514 => 1514,
        162 => 1162,
        p => p.saturating_add(1000).max(1025),
    }
}

pub(crate) fn bind_error(what: &str, port: u16, e: std::io::Error) -> String {
    if e.kind() == std::io::ErrorKind::PermissionDenied && port < 1024 {
        format!("{what}: el puerto {port} requiere privilegios en este sistema. Usa un puerto mayor a 1024 (ej. {}).", unprivileged_port(port))
    } else if e.kind() == std::io::ErrorKind::AddrInUse {
        format!("{what}: el puerto {port} ya está en uso por otra aplicación")
    } else {
        format!("{what}: {e}")
    }
}

pub fn parse_syslog(raw: &str, peer: SocketAddr) -> SyslogMsg {
    let raw = raw.trim_end_matches(['\n', '\r', '\0']);
    let (pri, rest) = raw
        .strip_prefix('<')
        .and_then(|r| r.split_once('>'))
        .and_then(|(p, rest)| p.parse::<u16>().ok().filter(|p| *p <= 191).map(|p| (p, rest)))
        .unwrap_or((13, raw)); // user.notice por defecto (RFC 3164)
    SyslogMsg {
        ts: chrono::Utc::now().timestamp_millis(),
        src: peer.ip().to_string(),
        severity: (pri & 7) as u8,
        facility: (pri >> 3) as u8,
        msg: rest.trim().chars().take(4000).collect(),
    }
}

/// Una línea por mensaje en el archivo: un salto de línea dentro del mensaje (UDP sin
/// autenticación) permitiría agregar entradas falsas con otra hora e IP de origen.
fn one_line(msg: &str) -> String {
    msg.chars().map(|c| if c.is_control() && c != '\t' { ' ' } else { c }).collect()
}

// ---------- TFTP: una transferencia ----------

const OP_RRQ: u16 = 1;
const OP_WRQ: u16 = 2;
const OP_DATA: u16 = 3;
const OP_ACK: u16 = 4;
const OP_ERROR: u16 = 5;
const OP_OACK: u16 = 6;
const RETRIES: u32 = 5;

fn tftp_error(sock: &UdpSocket, peer: SocketAddr, code: u16, msg: &str) {
    let mut p = vec![0, OP_ERROR as u8];
    p.extend(code.to_be_bytes());
    p.extend(msg.as_bytes());
    p.push(0);
    let _ = sock.send_to(&p, peer);
}

/// Sesiones TFTP simultáneas como máximo.
const TFTP_MAX_SESSIONS: usize = 16;
/// Timeout máximo (s) que se acepta en la opción "timeout" de un cliente TFTP.
const TFTP_MAX_TIMEOUT: u64 = 30;
/// Tamaño máximo de un archivo recibido por TFTP (imágenes de firmware grandes incluidas).
pub(crate) const TFTP_MAX_UPLOAD: u64 = 8 * 1024 * 1024 * 1024;

fn tftp_session(app: AppHandle, root: PathBuf, allow_write: bool, peer: SocketAddr, req: Vec<u8>, flag: Arc<AtomicBool>) {
    let Ok(sock) = UdpSocket::bind(("0.0.0.0", 0)) else { return };
    if req.len() < 4 {
        return;
    }
    let op = u16::from_be_bytes([req[0], req[1]]);
    let fields: Vec<String> = req[2..].split(|b| *b == 0).map(|s| String::from_utf8_lossy(s).into_owned()).collect();
    let (Some(name), Some(mode)) = (fields.first().cloned(), fields.get(1)) else { return };
    if !mode.eq_ignore_ascii_case("octet") && !mode.eq_ignore_ascii_case("netascii") {
        return tftp_error(&sock, peer, 0, "Modo no soportado");
    }
    let mut opts: HashMap<String, String> = HashMap::new();
    let mut i = 2;
    while i + 1 < fields.len() {
        if !fields[i].is_empty() {
            opts.insert(fields[i].to_lowercase(), fields[i + 1].clone());
        }
        i += 2;
    }

    let id = uuid::Uuid::new_v4().to_string();
    let Some(path) = safe_path(&root, &name) else {
        return tftp_error(&sock, peer, 2, "Ruta no permitida");
    };
    let blksize = opts.get("blksize").and_then(|v| v.parse::<usize>().ok()).map(|b| b.clamp(8, 65464));
    // RFC 2349 permite hasta 255 s, pero con 5 reintentos un pedido falso retendría una de
    // las 16 sesiones por ~21 min. Fuera de 1..=30 la opción se ignora (sin OACK) y rige 3 s.
    let timeout = opts.get("timeout").and_then(|v| v.parse::<u64>().ok()).filter(|t| (1..=TFTP_MAX_TIMEOUT).contains(t));
    sock.set_read_timeout(Some(Duration::from_secs(timeout.unwrap_or(3)))).ok();
    let block = blksize.unwrap_or(512);

    let report = |bytes: u64, total: Option<u64>, done: bool, error: Option<String>, dir: &'static str| {
        let _ = app.emit(
            "transfer",
            TransferEvent { id: id.clone(), proto: "tftp", client: peer.to_string(), file: name.clone(), dir, bytes, total, done, error },
        );
    };

    match op {
        OP_RRQ => {
            if !path.is_file() || !inside_root(&root, &path) {
                report(0, None, true, Some("Archivo no encontrado".into()), "get");
                return tftp_error(&sock, peer, 1, "Archivo no encontrado");
            }
            let Ok(mut file) = File::open(&path) else {
                return tftp_error(&sock, peer, 2, "Acceso denegado");
            };
            let total = file.metadata().map(|m| m.len()).ok();
            // Opciones aceptadas -> OACK y esperar ACK 0
            let mut oack = Vec::new();
            if let Some(b) = blksize {
                oack.push(("blksize".to_string(), b.to_string()));
            }
            if opts.contains_key("tsize") {
                oack.push(("tsize".to_string(), total.unwrap_or(0).to_string()));
            }
            if let Some(t) = timeout {
                oack.push(("timeout".to_string(), t.to_string()));
            }
            if !oack.is_empty() && !send_oack(&sock, peer, &oack, 0) {
                return report(0, total, true, Some("El cliente no confirmó opciones".into()), "get");
            }
            let mut buf = vec![0u8; block];
            let mut blockno: u16 = 1;
            let mut sent: u64 = 0;
            let mut last_report = Instant::now();
            loop {
                if !flag.load(Ordering::SeqCst) {
                    tftp_error(&sock, peer, 0, "Servidor detenido");
                    return report(sent, total, true, Some("Servidor detenido".into()), "get");
                }
                let n = read_full(&mut file, &mut buf);
                let mut pkt = vec![0, OP_DATA as u8];
                pkt.extend(blockno.to_be_bytes());
                pkt.extend(&buf[..n]);
                if !send_and_wait_ack(&sock, peer, &pkt, blockno) {
                    return report(sent, total, true, Some("Tiempo agotado esperando al equipo".into()), "get");
                }
                sent += n as u64;
                if last_report.elapsed() > Duration::from_millis(300) {
                    report(sent, total, false, None, "get");
                    last_report = Instant::now();
                }
                if n < block {
                    return report(sent, total, true, None, "get");
                }
                blockno = blockno.wrapping_add(1);
            }
        }
        OP_WRQ => {
            if !allow_write {
                report(0, None, true, Some("Escritura deshabilitada".into()), "put");
                return tftp_error(&sock, peer, 2, "Escritura deshabilitada en el servidor");
            }
            if let Some(parent) = path.parent() {
                // Antes de crear carpetas: un enlace simbólico dentro de la carpeta no debe
                // permitir crearlas fuera de ella.
                let existing = parent.ancestors().find(|a| a.exists()).unwrap_or(&root);
                if !inside_root(&root, existing) {
                    return tftp_error(&sock, peer, 2, "Ruta no permitida");
                }
                let _ = fs::create_dir_all(parent);
            }
            if !inside_root(&root, &path) {
                return tftp_error(&sock, peer, 2, "Ruta no permitida");
            }
            let total = opts.get("tsize").and_then(|v| v.parse::<u64>().ok());
            if total.is_some_and(|t| t > TFTP_MAX_UPLOAD) {
                return tftp_error(&sock, peer, 3, "Archivo demasiado grande");
            }
            // Temporal único: dos subidas a la vez (ios.bin e ios.txt) no deben pisarse.
            let fname = path.file_name().and_then(|f| f.to_str()).unwrap_or("archivo");
            let tmp = path.with_file_name(format!(".{fname}.{}.part", uuid::Uuid::new_v4().simple()));
            let Ok(mut file) = File::create(&tmp) else {
                return tftp_error(&sock, peer, 2, "No se pudo crear el archivo");
            };
            let mut oack = Vec::new();
            if let Some(b) = blksize {
                oack.push(("blksize".to_string(), b.to_string()));
            }
            if let Some(t) = total {
                oack.push(("tsize".to_string(), t.to_string()));
            }
            let first_ack = if oack.is_empty() {
                let _ = sock.send_to(&[0, OP_ACK as u8, 0, 0], peer);
                true
            } else {
                let mut p = vec![0, OP_OACK as u8];
                for (k, v) in &oack {
                    p.extend(k.as_bytes());
                    p.push(0);
                    p.extend(v.as_bytes());
                    p.push(0);
                }
                sock.send_to(&p, peer).is_ok()
            };
            if !first_ack {
                return;
            }
            let mut expected: u16 = 1;
            let mut got: u64 = 0;
            let mut buf = vec![0u8; block + 4];
            let mut last_report = Instant::now();
            let mut retries = 0;
            // Datagramas basura o bloques repetidos no cuentan como avance: sin este tope, un
            // tercero que conozca el puerto mantendría la sesión abierta para siempre.
            let stall = Duration::from_secs(timeout.unwrap_or(3) * (RETRIES as u64 + 1));
            let mut last_progress = Instant::now();
            loop {
                if last_progress.elapsed() > stall {
                    let _ = fs::remove_file(&tmp);
                    report(got, total, true, Some("Transferencia interrumpida".into()), "put");
                    return tftp_error(&sock, peer, 0, "Tiempo agotado");
                }
                match sock.recv_from(&mut buf) {
                    Ok((n, from)) if from == peer && n >= 4 && u16::from_be_bytes([buf[0], buf[1]]) == OP_DATA => {
                        let bno = u16::from_be_bytes([buf[2], buf[3]]);
                        if bno == expected {
                            if file.write_all(&buf[4..n]).is_err() {
                                return tftp_error(&sock, peer, 3, "Disco lleno o error de escritura");
                            }
                            got += (n - 4) as u64;
                            if got > TFTP_MAX_UPLOAD {
                                drop(file);
                                let _ = fs::remove_file(&tmp);
                                report(got, total, true, Some("Archivo demasiado grande".into()), "put");
                                return tftp_error(&sock, peer, 3, "Archivo demasiado grande");
                            }
                            expected = expected.wrapping_add(1);
                            retries = 0;
                            last_progress = Instant::now();
                        }
                        let mut ack = vec![0, OP_ACK as u8];
                        ack.extend(bno.to_be_bytes());
                        let _ = sock.send_to(&ack, peer);
                        if last_report.elapsed() > Duration::from_millis(300) {
                            report(got, total, false, None, "put");
                            last_report = Instant::now();
                        }
                        if n - 4 < block && bno.wrapping_add(1) == expected {
                            drop(file);
                            let _ = fs::rename(&tmp, &path);
                            return report(got, total, true, None, "put");
                        }
                    }
                    Ok(_) => {}
                    Err(_) => {
                        retries += 1;
                        if retries > RETRIES || !flag.load(Ordering::SeqCst) {
                            let _ = fs::remove_file(&tmp);
                            return report(got, total, true, Some("Transferencia interrumpida".into()), "put");
                        }
                    }
                }
            }
        }
        _ => tftp_error(&sock, peer, 4, "Operación TFTP no válida"),
    }
}

fn read_full(file: &mut File, buf: &mut [u8]) -> usize {
    let mut n = 0;
    while n < buf.len() {
        match file.read(&mut buf[n..]) {
            Ok(0) | Err(_) => break,
            Ok(r) => n += r,
        }
    }
    n
}

fn send_oack(sock: &UdpSocket, peer: SocketAddr, opts: &[(String, String)], expect_ack: u16) -> bool {
    let mut p = vec![0, OP_OACK as u8];
    for (k, v) in opts {
        p.extend(k.as_bytes());
        p.push(0);
        p.extend(v.as_bytes());
        p.push(0);
    }
    send_and_wait_ack(sock, peer, &p, expect_ack)
}

fn send_and_wait_ack(sock: &UdpSocket, peer: SocketAddr, pkt: &[u8], blockno: u16) -> bool {
    let mut buf = [0u8; 516];
    for _ in 0..RETRIES {
        if sock.send_to(pkt, peer).is_err() {
            return false;
        }
        let deadline = Instant::now() + sock.read_timeout().ok().flatten().unwrap_or(Duration::from_secs(3));
        while Instant::now() < deadline {
            match sock.recv_from(&mut buf) {
                Ok((n, from)) if from == peer && n >= 4 => {
                    let op = u16::from_be_bytes([buf[0], buf[1]]);
                    if op == OP_ERROR {
                        return false;
                    }
                    if op == OP_ACK && u16::from_be_bytes([buf[2], buf[3]]) == blockno {
                        return true;
                    }
                }
                Ok(_) => {}
                Err(_) => break,
            }
        }
    }
    false
}

// ---------- HTTP de solo lectura ----------

fn http_serve(app: AppHandle, root: PathBuf, req: tiny_http::Request) {
    let peer = req.remote_addr().map(|a| a.to_string()).unwrap_or_default();
    if *req.method() != tiny_http::Method::Get && *req.method() != tiny_http::Method::Head {
        let _ = req.respond(tiny_http::Response::empty(405));
        return;
    }
    let url = req.url().split('?').next().unwrap_or("/").to_string();
    let decoded = percent_decode(&url);
    if decoded == "/" {
        let mut names: Vec<String> = fs::read_dir(&root)
            .into_iter()
            .flatten()
            .flatten()
            .filter(|e| e.path().is_file())
            .map(|e| e.file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        let items: String = names
            .iter()
            .map(|n| {
                let esc = n.replace('&', "&amp;").replace('<', "&lt;").replace('"', "&quot;");
                format!("<li><a href=\"/{}\">{esc}</a></li>", percent_encode(n))
            })
            .collect();
        let html = format!("<!doctype html><meta charset=utf-8><title>NetTerminal</title><h3>Archivos</h3><ul>{items}</ul>");
        let resp = tiny_http::Response::from_string(html)
            .with_header(tiny_http::Header::from_bytes("Content-Type", "text/html; charset=utf-8").unwrap());
        let _ = req.respond(resp);
        return;
    }
    let path = match safe_path(&root, &decoded) {
        Some(p) if p.is_file() && inside_root(&root, &p) => p,
        _ => {
            let _ = req.respond(tiny_http::Response::empty(404));
            return;
        }
    };
    let Ok(file) = File::open(&path) else {
        let _ = req.respond(tiny_http::Response::empty(403));
        return;
    };
    let total = file.metadata().map(|m| m.len()).ok();
    let id = uuid::Uuid::new_v4().to_string();
    let name = decoded.trim_start_matches('/').to_string();
    let _ = app.emit(
        "transfer",
        TransferEvent { id: id.clone(), proto: "http", client: peer.clone(), file: name.clone(), dir: "get", bytes: 0, total, done: false, error: None },
    );
    let resp = tiny_http::Response::from_file(file)
        .with_header(tiny_http::Header::from_bytes("Content-Type", "application/octet-stream").unwrap());
    let result = req.respond(resp);
    let _ = app.emit(
        "transfer",
        TransferEvent {
            id,
            proto: "http",
            client: peer,
            file: name,
            dir: "get",
            bytes: if result.is_ok() { total.unwrap_or(0) } else { 0 },
            total,
            done: true,
            error: result.err().map(|e| e.to_string()),
        },
    );
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    // Se decodifica sobre bytes: cortar `s` en i + 1..i + 3 puede caer en medio de un
    // carácter UTF-8 ("%aé") y ese pánico cerraría la app entera (panic = "abort").
    let hex = |b: u8| (b as char).to_digit(16).map(|d| d as u8);
    while i < bytes.len() {
        if bytes[i] == b'%' {
            if let (Some(h), Some(l)) = (bytes.get(i + 1).copied().and_then(hex), bytes.get(i + 2).copied().and_then(hex)) {
                out.push((h << 4) | l);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn percent_encode(s: &str) -> String {
    s.bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn write_flag_changes_without_restart() {
        let s = Servers::default();
        assert!(s.set_write("tftp", true).is_err(), "sin servidor activo");
        assert_eq!(s.write_allowed("tftp"), None);
        let run = s.flag("tftp");
        let w = s.write_flag("tftp", false);
        assert_eq!(s.write_allowed("tftp"), Some(false));
        assert_eq!(s.set_write("tftp", true), Ok(false), "devuelve el valor anterior");
        assert!(w.load(Ordering::SeqCst), "la sesión en marcha ve el cambio");
        assert!(run.load(Ordering::SeqCst), "sin reiniciar: el servidor sigue activo");
        s.stop("tftp");
        assert_eq!(s.write_allowed("tftp"), None);
        assert!(s.set_write("syslog", true).is_err());
    }

    #[test]
    fn suggests_the_same_unprivileged_ports_as_the_ui() {
        assert_eq!([69, 80, 21, 514, 162].map(unprivileged_port), [1069, 8080, 2121, 1514, 1162]);
        assert!(bind_error("FTP", 21, std::io::ErrorKind::PermissionDenied.into()).contains("2121"));
    }

    #[test]
    fn safe_path_blocks_traversal() {
        let root = Path::new("/srv/tftp");
        assert_eq!(safe_path(root, "ios.bin"), Some(root.join("ios.bin")));
        assert_eq!(safe_path(root, "/flash/ios.bin"), Some(root.join("flash/ios.bin")));
        assert_eq!(safe_path(root, "../etc/passwd"), None);
        assert_eq!(safe_path(root, "a/../../x"), None);
        assert_eq!(safe_path(root, "..\\..\\windows\\win.ini"), None);
        assert_eq!(safe_path(root, ""), None);
    }

    #[test]
    fn percent_decode_handles_hostile_input() {
        assert_eq!(percent_decode("/a%20b"), "/a b");
        assert_eq!(percent_decode("%41"), "A");
        assert_eq!(percent_decode("%2e%2E/x"), "../x");
        // Antes: pánico al cortar el &str en medio de "é" (cierre de la app).
        assert_eq!(percent_decode("%aé"), "%aé");
        for raw in ["%", "%4", "%zz", "%+1", "%%41", "€%", "%€"] {
            let _ = percent_decode(raw);
        }
        assert_eq!(percent_decode("%+1"), "%+1");
        let mut rng = crate::snmp::tests::Rng(0xDEAD_BEEF_1234_5678);
        let alphabet = ['%', 'a', 'F', '0', '9', 'é', '/', '.', '\\', '€', 'z', '\u{0}'];
        for _ in 0..20_000 {
            let s: String = (0..rng.below(16)).map(|_| alphabet[rng.below(alphabet.len())]).collect();
            let _ = percent_decode(&s);
        }
    }

    #[test]
    fn fuzz_safe_path_stays_inside_root() {
        let root = Path::new("/srv/tftp");
        let pieces = ["..", ".", "a", "fw.bin", "/", "\\", "C:", "c:\\", "%2e%2e", "", "...", "//", "~", ":", "\\\\?\\", "NUL"];
        let mut rng = crate::snmp::tests::Rng(0x0123_4567_89AB_CDEF);
        for _ in 0..20_000 {
            let raw: String = (0..1 + rng.below(8)).map(|_| pieces[rng.below(pieces.len())]).collect();
            // Igual que el servidor HTTP: primero se decodifica y luego se valida.
            for req in [raw.clone(), percent_decode(&raw)] {
                if let Some(p) = safe_path(root, &req) {
                    assert!(p.starts_with(root) && p != root, "{req:?} -> {p:?}");
                    assert!(p.components().all(|c| !matches!(c, Component::ParentDir | Component::Prefix(_))), "{req:?}");
                }
            }
        }
        assert_eq!(safe_path(root, "%2e%2e/x"), Some(root.join("%2e%2e/x")));
        assert_eq!(safe_path(root, &percent_decode("%2e%2e/x")), None);
        assert_eq!(safe_path(root, "/../x"), None);
        assert_eq!(safe_path(root, "\\..\\x"), None);
    }

    #[cfg(unix)]
    #[test]
    fn symlink_inside_root_does_not_escape() {
        let base = std::env::temp_dir().join(format!("nt-root-{}", uuid::Uuid::new_v4()));
        let (root, outside) = (base.join("root"), base.join("fuera"));
        fs::create_dir_all(&root).unwrap();
        fs::create_dir_all(&outside).unwrap();
        fs::write(outside.join("secreto.txt"), b"x").unwrap();
        std::os::unix::fs::symlink(&outside, root.join("enlace")).unwrap();
        // Lectura: la ruta léxica es válida, pero la real sale de la carpeta.
        let p = safe_path(&root, "enlace/secreto.txt").unwrap();
        assert!(p.is_file() && !inside_root(&root, &p));
        // Escritura (WRQ): el ancestro existente más cercano se valida antes de crear carpetas.
        let p = safe_path(&root, "enlace/nueva/x.bin").unwrap();
        let existing = p.parent().unwrap().ancestors().find(|a| a.exists()).unwrap();
        assert!(!inside_root(&root, existing));
        let p = safe_path(&root, "propia/x.bin").unwrap();
        let existing = p.parent().unwrap().ancestors().find(|a| a.exists()).unwrap();
        assert!(inside_root(&root, existing));
        fs::remove_dir_all(base).unwrap();
    }

    #[test]
    fn spawn_limited_caps_concurrency() {
        let active = Arc::new(AtomicUsize::new(0));
        let (tx, rx) = std::sync::mpsc::channel::<()>();
        let rx = Arc::new(Mutex::new(rx));
        for i in 0..3 {
            let rx = rx.clone();
            assert!(spawn_limited(&active, 3, i, move |_| {
                let _ = rx.lock().unwrap().recv();
            })
            .is_ok());
        }
        assert_eq!(spawn_limited(&active, 3, 99, |_| {}), Err(99));
        for _ in 0..3 {
            tx.send(()).unwrap();
        }
        for _ in 0..100 {
            if active.load(Ordering::SeqCst) == 0 {
                break;
            }
            std::thread::sleep(Duration::from_millis(5));
        }
        assert!(spawn_limited(&active, 3, 1, |_| {}).is_ok());
    }

    #[test]
    fn parses_syslog_priority() {
        let peer: SocketAddr = "10.0.0.1:514".parse().unwrap();
        let m = parse_syslog("<187>%LINK-3-UPDOWN: Interface Gi0/1, changed state to down\n", peer);
        assert_eq!((m.facility, m.severity), (23, 3));
        assert_eq!(m.src, "10.0.0.1");
        let raw = parse_syslog("sin prioridad", peer);
        assert_eq!(raw.severity, 5);
        let forged = parse_syslog("<14>hola\n10:00:00 10.9.9.9 <4.0> falso", peer);
        assert!(!one_line(&forged.msg).contains('\n'));
    }

    #[test]
    fn tftp_end_to_end_read_with_blksize() {
        // Servidor real en un puerto efímero y cliente TFTP mínimo.
        let dir = std::env::temp_dir().join(format!("nt-tftp-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let data: Vec<u8> = (0..20_000u32).map(|i| (i % 251) as u8).collect();
        fs::write(dir.join("fw.bin"), &data).unwrap();

        let server = UdpSocket::bind("127.0.0.1:0").unwrap();
        let addr = server.local_addr().unwrap();
        let root = dir.clone();
        std::thread::spawn(move || {
            let mut buf = [0u8; 600];
            let (n, peer) = server.recv_from(&mut buf).unwrap();
            // Igual que tftp_session pero sin AppHandle: se prueba el núcleo de envío.
            let sock = UdpSocket::bind("127.0.0.1:0").unwrap();
            sock.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
            let fields: Vec<String> = buf[2..n].split(|b| *b == 0).map(|s| String::from_utf8_lossy(s).into_owned()).collect();
            let path = safe_path(&root, &fields[0]).unwrap();
            let mut f = File::open(path).unwrap();
            assert!(send_oack(&sock, peer, &[("blksize".into(), "1428".into())], 0));
            let mut b = vec![0u8; 1428];
            let mut no: u16 = 1;
            loop {
                let n = read_full(&mut f, &mut b);
                let mut pkt = vec![0, 3];
                pkt.extend(no.to_be_bytes());
                pkt.extend(&b[..n]);
                assert!(send_and_wait_ack(&sock, peer, &pkt, no));
                if n < 1428 {
                    break;
                }
                no += 1;
            }
        });

        let client = UdpSocket::bind("127.0.0.1:0").unwrap();
        client.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
        let mut rrq = vec![0, 1];
        rrq.extend(b"fw.bin\0octet\0blksize\x001428\0");
        client.send_to(&rrq, addr).unwrap();
        let mut got: Vec<u8> = Vec::new();
        let mut buf = vec![0u8; 1432];
        loop {
            let (n, from) = client.recv_from(&mut buf).unwrap();
            let op = u16::from_be_bytes([buf[0], buf[1]]);
            let no = u16::from_be_bytes([buf[2], buf[3]]);
            if op == 6 {
                client.send_to(&[0, 4, 0, 0], from).unwrap();
                continue;
            }
            assert_eq!(op, 3);
            got.extend(&buf[4..n]);
            let mut ack = vec![0, 4];
            ack.extend(no.to_be_bytes());
            client.send_to(&ack, from).unwrap();
            if n - 4 < 1428 {
                break;
            }
        }
        assert_eq!(got, data);
        let _ = fs::remove_dir_all(dir);
    }
}
