//! Scripts Python contra una o varias sesiones abiertas. El script habla con la app por
//! stdin/stdout en líneas JSON (ver `netterminal.py`); cada pedido lleva un `id` y la
//! respuesta lo repite, así un script con hilos puede tener varios pedidos en curso.
//!
//! Modelo de seguridad:
//! - El script solo alcanza las sesiones que el usuario eligió al lanzarlo (destinos).
//!   `sessions()` devuelve nombre, tipo, host, puerto y plataforma, nunca credenciales.
//! - Lo que el script envía se arma como lo haría la línea de comandos del equipo
//!   (retroceso, Ctrl-U, Ctrl-W) y cada línea completa (al llegar Enter o Ctrl-Z) pasa por
//!   la interfaz, que la clasifica con `computeRisk`. Las consultas pasan; un cambio pide
//!   confirmación salvo en modo "permitir cambios"; lo que puede cortar servicio, y las
//!   líneas con teclas que el equipo interpreta (Tab, ?, Esc, Ctrl-D), se confirman
//!   siempre. Cada línea se pregunta una vez por ejecución. Si el usuario rechaza o no
//!   responde, el script se detiene y la línea no llega al equipo.
//! - Mientras el script corre, sus destinos quedan tomados: lo que el usuario teclea en
//!   esas pestañas, la difusión, MCP y las herramientas se rechazan para no mezclarse.
//! - `ask_secret`: el valor viaja solo por el stdin del script. Se enmascara en todo lo
//!   que el script muestra en la app (mensajes, errores, diálogos de confirmación).
//! - No hay acceso a la bóveda: ninguna operación devuelve una contraseña guardada.
//!   `type_saved_password` hace que la app escriba la contraseña guardada de un destino en el
//!   pedido de login que su pantalla muestra en ese momento, sin que el script la vea. Requiere
//!   que el usuario lo permita al lanzar (casilla por ejecución; en plugins, además el permiso
//!   "vault-type") y se responde una vez por pedido.

use crate::expect::{self, WaitEnd};
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{channel, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};
use zeroize::Zeroizing;

const HELPER: &str = include_str!("netterminal.py");

const EXAMPLE: &str = r#"# Ejemplo: respaldo de configuración del equipo de la sesión activa.
# Ejecútalo desde la barra de botones o el menú Scripts con una sesión conectada.
import datetime
import pathlib

import netterminal as nt

nt.run("terminal length 0")           # Cisco/Arista. Huawei: "screen-length 0 temporary"
config = nt.run("show running-config", timeout=90)

carpeta = pathlib.Path(nt.data_dir) / "respaldos"
carpeta.mkdir(parents=True, exist_ok=True)
nombre = nt.session.get("name", "equipo").replace("/", "-")
archivo = carpeta / f"{nombre}_{datetime.datetime.now():%Y%m%d-%H%M%S}.txt"
archivo.write_text(config, encoding="utf-8")

print(f"Respaldo guardado: {archivo} ({len(config.splitlines())} líneas)")
"#;

/// Máximo de sesiones con una operación en curso a la vez.
pub const MAX_PARALLEL: usize = 4;
/// Pedidos concurrentes de un script (hilos de Python) antes de dejar de leer.
const MAX_INFLIGHT: usize = 16;
/// Tramo de espera: cada cuánto una espera larga revisa si el script se detuvo.
const SLICE: Duration = Duration::from_millis(200);
const GATE_TIMEOUT: Duration = Duration::from_secs(120);
const SECRET_TIMEOUT: Duration = Duration::from_secs(300);
const MAX_SECRET_PROMPTS: usize = 10;
/// Contraseñas guardadas que un script puede escribir por ejecución (además, una por pedido).
const MAX_VAULT_TYPES: usize = 10;
const MAX_LABEL: usize = 120;
const MASK: &str = "••••••";
pub const BUSY: &str = "Un script está usando esta sesión. Espera a que termine o usa Detener script.";

fn lock<T: ?Sized>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

// ---------- Armado de líneas ----------

/// Lo que el script lleva escrito en la línea actual de una sesión.
#[derive(Default, Debug)]
struct LineState {
    /// Texto visible de la línea (con marcas para las teclas especiales).
    buf: String,
    /// La línea tiene teclas que el equipo interpreta (Tab, ?, Esc): no se sabe qué ejecuta.
    opaque: bool,
    /// Parte de la línea ya se escribió en el equipo (un `send` sin Enter).
    dirty: bool,
}

#[derive(Debug, PartialEq)]
enum Chunk {
    /// Texto sin Enter: se escribe sin preguntar (no ejecuta nada).
    Text(String),
    /// Una línea que el equipo ejecutará al recibir `bytes`.
    Commit { bytes: String, line: String, opaque: bool, dirty: bool },
}

fn caret(c: char) -> String {
    match c {
        '\t' => "⇥".into(),
        '\x1b' => "␛".into(),
        c if (c as u32) < 0x20 => format!("^{}", ((c as u8) + 64) as char),
        c => format!("<U+{:04X}>", c as u32),
    }
}

/// Parte `data` en texto suelto y líneas completas, aplicando la edición de línea
/// habitual de los CLI de red y de las shells.
fn split_commits(st: &mut LineState, data: &str) -> Vec<Chunk> {
    let mut out = Vec::new();
    let mut bytes = String::new();
    let mut prev_cr = false;
    for c in data.chars() {
        // "\r\n" es un solo Enter.
        if c == '\n' && prev_cr {
            if let Some(Chunk::Commit { bytes: b, .. }) = out.last_mut() {
                if bytes.is_empty() {
                    b.push('\n');
                    prev_cr = false;
                    continue;
                }
            }
        }
        prev_cr = c == '\r';
        bytes.push(c);
        match c {
            '\r' | '\n' | '\x1a' => {
                out.push(Chunk::Commit {
                    bytes: std::mem::take(&mut bytes),
                    line: std::mem::take(&mut st.buf),
                    opaque: st.opaque,
                    dirty: st.dirty,
                });
                st.opaque = false;
                st.dirty = false;
            }
            // Ctrl-D: en una shell vacía cierra la sesión.
            '\x04' => {
                st.buf.push_str("^D");
                out.push(Chunk::Commit {
                    bytes: std::mem::take(&mut bytes),
                    line: std::mem::take(&mut st.buf),
                    opaque: true,
                    dirty: st.dirty,
                });
                st.opaque = false;
                st.dirty = false;
            }
            '\x7f' | '\x08' => {
                st.buf.pop();
            }
            '\x15' => st.buf.clear(),
            '\x17' => {
                let t = st.buf.trim_end().len();
                st.buf.truncate(t);
                let cut = st.buf.rfind(' ').map(|i| i + 1).unwrap_or(0);
                st.buf.truncate(cut);
            }
            // Ctrl-C descarta la línea (y corta un comando en curso).
            '\x03' => {
                st.buf.clear();
                st.opaque = false;
            }
            '?' => {
                st.buf.push('?');
                st.opaque = true;
            }
            c if c.is_control()
                || matches!(c, '\u{200B}'..='\u{200F}' | '\u{202A}'..='\u{202E}' | '\u{2066}'..='\u{2069}' | '\u{FEFF}') =>
            {
                st.buf.push_str(&caret(c));
                st.opaque = true;
            }
            c => st.buf.push(c),
        }
    }
    if !bytes.is_empty() {
        st.dirty |= !st.buf.is_empty();
        out.push(Chunk::Text(bytes));
    }
    out
}

// ---------- Interfaz con la app (abstracta para probarla sin Tauri) ----------

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Prompt {
    /// Una línea que el script quiere ejecutar. La interfaz la clasifica con computeRisk.
    Gate {
        line: String,
        opaque: bool,
        session: String,
        targets: Vec<String>,
        #[serde(rename = "allowChanges")]
        allow_changes: bool,
    },
    /// Pedido de secreto (diálogo de contraseña).
    Secret { label: String },
}

pub enum Answer {
    Approve,
    Deny,
    Secret(Zeroizing<String>),
}

pub trait Bridge: Send + Sync + 'static {
    fn write(&self, conn: &str, data: &[u8]) -> Result<(), String>;
    /// Mensaje del script para la app (ya enmascarado).
    fn log(&self, message: String);
    /// Pide una decisión a la interfaz. None: sin respuesta a tiempo o script detenido.
    fn prompt(&self, p: Prompt) -> Option<Answer>;
    /// Detiene la ejecución (rechazo del usuario).
    fn abort(&self, reason: String);
    /// Escribe la contraseña guardada de la sesión en el pedido de login que muestra su
    /// pantalla. Nunca devuelve el valor; el error explica por qué no se escribió.
    fn type_saved_password(&self, conn: &str) -> Result<(), String>;
}

/// Semáforo simple: tope de sesiones con una operación en curso.
struct Semaphore {
    free: Mutex<usize>,
    cv: Condvar,
}

struct Permit<'a>(&'a Semaphore);

impl Semaphore {
    fn new(n: usize) -> Self {
        Semaphore { free: Mutex::new(n.max(1)), cv: Condvar::new() }
    }
    fn acquire(&self) -> Permit<'_> {
        let mut f = lock(&self.free);
        while *f == 0 {
            f = self.cv.wait(f).unwrap_or_else(|e| e.into_inner());
        }
        *f -= 1;
        Permit(self)
    }
}

impl Drop for Permit<'_> {
    fn drop(&mut self) {
        *lock(&self.0.free) += 1;
        self.0.cv.notify_one();
    }
}

struct Io {
    rx: Receiver<String>,
    pending: String,
    line: LineState,
}

/// Una sesión de los destinos. El lock de `io` ordena las operaciones de esa sesión.
pub struct Target {
    pub name: String,
    pub conn: String,
    pub info: Value,
    io: Mutex<Io>,
}

impl Target {
    pub fn new(name: String, conn: String, info: Value, rx: Receiver<String>) -> Self {
        Target { name, conn, info, io: Mutex::new(Io { rx, pending: String::new(), line: LineState::default() }) }
    }
}

pub struct Broker<B: Bridge> {
    pub bridge: B,
    targets: Vec<Target>,
    allow_session: bool,
    allow_changes: bool,
    parallel: Semaphore,
    /// Líneas ya aprobadas en esta ejecución. Su lock también ordena los diálogos.
    gate: Mutex<HashSet<String>>,
    secrets: Mutex<Vec<Zeroizing<String>>>,
    secret_prompts: Mutex<usize>,
    stop: Arc<AtomicBool>,
    /// El usuario permitió, para esta ejecución, escribir contraseñas guardadas en los destinos.
    allow_vault: bool,
    vault_typed: Mutex<usize>,
}

fn ok() -> Value {
    json!({"ok": true})
}

fn fail(code: &str, error: impl Into<String>) -> Value {
    json!({"ok": false, "code": code, "error": error.into()})
}

impl<B: Bridge> Broker<B> {
    pub fn new(bridge: B, targets: Vec<Target>, allow_session: bool, allow_changes: bool, parallel: usize, stop: Arc<AtomicBool>) -> Self {
        Broker {
            bridge,
            targets,
            allow_session,
            allow_changes,
            parallel: Semaphore::new(parallel.clamp(1, MAX_PARALLEL)),
            gate: Mutex::new(HashSet::new()),
            secrets: Mutex::new(Vec::new()),
            secret_prompts: Mutex::new(0),
            stop,
            allow_vault: false,
            vault_typed: Mutex::new(0),
        }
    }

    /// Permiso de la ejecución para `type_saved_password` (casilla del diálogo de lanzamiento).
    pub fn with_vault(mut self, allow: bool) -> Self {
        self.allow_vault = allow;
        self
    }

    fn stopped(&self) -> bool {
        self.stop.load(Ordering::SeqCst)
    }

    /// Reemplaza los secretos entregados al script por una máscara.
    pub fn redact(&self, text: &str) -> String {
        let secrets = lock(&self.secrets);
        let mut out = text.to_string();
        for s in secrets.iter() {
            if !s.is_empty() && out.contains(s.as_str()) {
                out = out.replace(s.as_str(), MASK);
            }
        }
        out
    }

    fn is_secret(&self, line: &str) -> bool {
        lock(&self.secrets).iter().any(|s| !s.is_empty() && (s.as_str() == line || s.trim() == line.trim()))
    }

    fn target(&self, name: Option<&str>) -> Result<&Target, Value> {
        match name {
            None => self.targets.first().ok_or_else(|| fail("session", "No hay una sesión conectada")),
            Some(n) => self
                .targets
                .iter()
                .find(|t| t.name == n)
                .ok_or_else(|| fail("session", format!("La sesión {n:?} no está entre los destinos elegidos al lanzar el script"))),
        }
    }

    /// Atiende un pedido del script y devuelve la respuesta (sin el id).
    pub fn handle(&self, req: &Value) -> Value {
        match req["op"].as_str().unwrap_or("") {
            "log" => {
                self.bridge.log(self.redact(req["msg"].as_str().unwrap_or("")));
                ok()
            }
            "sessions" if !self.allow_session => fail("permission", "Este plugin no declaró el permiso 'session'"),
            "sessions" => json!({"ok": true, "sessions": self.targets.iter().map(|t| t.info.clone()).collect::<Vec<_>>()}),
            "ask_secret" => self.ask_secret(req["label"].as_str().unwrap_or("")),
            "type_saved_password" => self.type_saved(req),
            op @ ("send" | "wait" | "read" | "clear") => self.session_op(op, req),
            other => fail("unknown", format!("operación desconocida: {other}")),
        }
    }

    fn session_op(&self, op: &str, req: &Value) -> Value {
        if !self.allow_session {
            return fail("permission", "Este plugin no declaró el permiso 'session'");
        }
        if self.stopped() {
            return fail("cancelled", "El script se detuvo");
        }
        let t = match self.target(req["session"].as_str()) {
            Ok(t) => t,
            Err(e) => return e,
        };
        let mut io = lock(&t.io);
        let _permit = self.parallel.acquire();
        let secs = |k: &str, d: f64| Duration::from_secs_f64(req[k].as_f64().unwrap_or(d).clamp(0.05, 3600.0));
        match op {
            "send" => self.send(t, &mut io, req["data"].as_str().unwrap_or("")),
            "wait" => {
                let Ok(re) = Regex::new(req["pattern"].as_str().unwrap_or("")) else {
                    return fail("pattern", "patrón inválido");
                };
                let only_match = req["return_match_only"].as_bool().unwrap_or(false);
                self.wait(&mut io, &re, secs("timeout", 10.0), only_match)
            }
            "read" => self.read(&mut io, secs("idle", 1.0), secs("timeout", 10.0)),
            _ => {
                io.pending.clear();
                while io.rx.try_recv().is_ok() {}
                ok()
            }
        }
    }

    /// Contraseña guardada escrita por la app en el pedido de login del destino. El script solo
    /// recibe si se escribió o por qué no; el valor no pasa por él ni por sus mensajes.
    fn type_saved(&self, req: &Value) -> Value {
        if !self.allow_session {
            return fail("permission", "Este plugin no declaró el permiso 'session'");
        }
        if !self.allow_vault {
            return fail("permission", "No se permitió escribir contraseñas guardadas en esta ejecución (casilla al lanzar el script)");
        }
        if self.stopped() {
            return fail("cancelled", "El script se detuvo");
        }
        let t = match self.target(req["session"].as_str()) {
            Ok(t) => t,
            Err(e) => return e,
        };
        let io = lock(&t.io);
        let _permit = self.parallel.acquire();
        // Con texto a medio escribir la contraseña quedaría pegada a él.
        if !io.line.buf.is_empty() || io.line.opaque {
            return fail("pending", "Hay texto sin Enter en la línea: envía Enter o Ctrl-U antes de escribir la contraseña");
        }
        if *lock(&self.vault_typed) >= MAX_VAULT_TYPES {
            return fail("limit", format!("Máximo {MAX_VAULT_TYPES} contraseñas guardadas por ejecución"));
        }
        match self.bridge.type_saved_password(&t.conn) {
            Ok(()) => {
                *lock(&self.vault_typed) += 1;
                self.bridge.log(format!("Contraseña guardada escrita en {} (el script no la ve)", t.name));
                ok()
            }
            Err(e) => fail("vault", e),
        }
    }

    fn send(&self, t: &Target, io: &mut Io, data: &str) -> Value {
        for chunk in split_commits(&mut io.line, data) {
            let bytes = match chunk {
                Chunk::Text(b) => b,
                Chunk::Commit { bytes, line, opaque, dirty } => {
                    if let Err(e) = self.gate(t, &line, opaque) {
                        // Lo ya escrito de esa línea queda en el equipo: Ctrl-U lo borra en
                        // los CLI de red y en las shells.
                        if dirty {
                            let _ = self.bridge.write(&t.conn, b"\x15");
                        }
                        io.line = LineState::default();
                        return fail("denied", e);
                    }
                    bytes
                }
            };
            if let Err(e) = self.bridge.write(&t.conn, bytes.as_bytes()) {
                return fail("write", e);
            }
        }
        ok()
    }

    /// Autoriza una línea completa antes de escribir su Enter.
    fn gate(&self, t: &Target, line: &str, opaque: bool) -> Result<(), String> {
        let trimmed = line.trim();
        if !opaque && (trimmed.is_empty() || self.is_secret(line)) {
            return Ok(());
        }
        let key = format!("{}{trimmed}", if opaque { "\u{0}" } else { "" });
        let mut approved = lock(&self.gate);
        if approved.contains(&key) {
            return Ok(());
        }
        let shown = self.redact(trimmed);
        if self.stopped() {
            return Err("El script se detuvo".into());
        }
        let answer = self.bridge.prompt(Prompt::Gate {
            line: shown.clone(),
            opaque,
            session: t.name.clone(),
            targets: self.targets.iter().map(|t| t.name.clone()).collect(),
            allow_changes: self.allow_changes,
        });
        match answer {
            Some(Answer::Approve) => {
                approved.insert(key);
                Ok(())
            }
            other => {
                let why = if other.is_none() && !self.stopped() { "Sin respuesta" } else { "Rechazado" };
                let msg = format!("{why}: «{shown}» en {}. Script detenido.", t.name);
                self.stop.store(true, Ordering::SeqCst);
                self.bridge.abort(msg.clone());
                Err(msg)
            }
        }
    }

    fn wait(&self, io: &mut Io, re: &Regex, timeout: Duration, only_match: bool) -> Value {
        let Io { rx, pending, .. } = io;
        match expect::wait_for(rx, re, timeout, pending, &|| self.stopped()) {
            Ok(mut output) => {
                // Solo hasta la coincidencia: el resto queda para la próxima lectura.
                if only_match {
                    if let Some(m) = re.find(&output) {
                        *pending = output.split_off(m.end());
                    }
                }
                json!({"ok": true, "output": output})
            }
            Err(WaitEnd::Timeout(output)) => json!({"ok": false, "code": "timeout", "error": "timeout", "output": output}),
            Err(WaitEnd::Closed(output)) => {
                json!({"ok": false, "code": "closed", "error": "La sesión se desconectó", "output": output})
            }
            Err(WaitEnd::Cancelled(_)) => fail("cancelled", "El script se detuvo"),
        }
    }

    fn read(&self, io: &mut Io, idle: Duration, timeout: Duration) -> Value {
        let mut out = std::mem::take(&mut io.pending);
        let start = Instant::now();
        let deadline = start + timeout;
        let mut last = start;
        loop {
            if self.stopped() {
                return fail("cancelled", "El script se detuvo");
            }
            let now = Instant::now();
            let left = deadline.saturating_duration_since(now).min((last + idle).saturating_duration_since(now));
            if left.is_zero() {
                break;
            }
            match io.rx.recv_timeout(left.min(SLICE)) {
                Ok(chunk) => {
                    out.push_str(&chunk);
                    last = Instant::now();
                }
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => break,
            }
        }
        json!({"ok": true, "output": out})
    }

    fn ask_secret(&self, label: &str) -> Value {
        if self.stopped() {
            return fail("cancelled", "El script se detuvo");
        }
        {
            let mut n = lock(&self.secret_prompts);
            if *n >= MAX_SECRET_PROMPTS {
                return fail("limit", format!("Máximo {MAX_SECRET_PROMPTS} pedidos de secreto por ejecución"));
            }
            *n += 1;
        }
        let label: String = label.chars().filter(|c| !c.is_control()).take(MAX_LABEL).collect();
        let label = if label.trim().is_empty() { "Secreto".to_string() } else { label.trim().to_string() };
        // Un diálogo a la vez por ejecución.
        let _order = lock(&self.gate);
        match self.bridge.prompt(Prompt::Secret { label }) {
            Some(Answer::Secret(v)) => {
                let reply = json!({"ok": true, "value": v.as_str()});
                if !v.is_empty() {
                    lock(&self.secrets).push(v);
                }
                reply
            }
            _ => fail("cancelled", "El usuario canceló el ingreso del secreto"),
        }
    }
}

fn reply_line(req: &Value, mut reply: Value) -> String {
    if let (Some(id), Some(obj)) = (req.get("id"), reply.as_object_mut()) {
        obj.insert("id".into(), id.clone());
    }
    reply.to_string()
}

/// Atiende los pedidos del script hasta que cierra su stdout. Las operaciones de sesión y
/// los secretos corren en hilos aparte (un script con hilos puede esperar en varias
/// sesiones a la vez); mensajes y listados se responden en orden.
pub fn serve<B: Bridge>(broker: Arc<Broker<B>>, input: impl BufRead, out: Arc<Mutex<dyn Write + Send>>) {
    let inflight = Arc::new((Mutex::new(0usize), Condvar::new()));
    let mut workers: Vec<std::thread::JoinHandle<()>> = Vec::new();
    let send = |out: &Arc<Mutex<dyn Write + Send>>, line: String| {
        let mut w = lock(out);
        let _ = writeln!(w, "{line}").and_then(|_| w.flush());
    };
    for line in input.lines().map_while(Result::ok) {
        let req: Value = match serde_json::from_str::<Value>(&line) {
            Ok(v) if v.is_object() => v,
            _ => {
                broker.bridge.log(broker.redact(&line));
                continue;
            }
        };
        let concurrent = matches!(req["op"].as_str(), Some("send" | "wait" | "read" | "clear" | "ask_secret" | "type_saved_password"));
        if !concurrent {
            send(&out, reply_line(&req, broker.handle(&req)));
            continue;
        }
        {
            let (m, cv) = &*inflight;
            let mut n = lock(m);
            while *n >= MAX_INFLIGHT {
                n = cv.wait(n).unwrap_or_else(|e| e.into_inner());
            }
            *n += 1;
        }
        workers.retain(|w| !w.is_finished());
        let (broker, out, inflight) = (broker.clone(), out.clone(), inflight.clone());
        workers.push(std::thread::spawn(move || {
            let line = reply_line(&req, broker.handle(&req));
            send(&out, line);
            let (m, cv) = &*inflight;
            *lock(m) -= 1;
            cv.notify_one();
        }));
    }
    for w in workers {
        let _ = w.join();
    }
}

// ---------- Ejecución con Tauri ----------

#[derive(Deserialize, Clone, Debug)]
pub struct TargetReq {
    pub conn: String,
    /// Plataforma detectada en la pestaña (la sesión guardada puede no tenerla).
    #[serde(default)]
    pub platform: Option<String>,
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RunOptions {
    #[serde(default)]
    pub allow_changes: bool,
    #[serde(default = "one")]
    pub parallel: usize,
    #[serde(default = "thirty")]
    pub max_minutes: u64,
    /// Casilla "Permitir que el script escriba contraseñas guardadas": vale solo esta ejecución.
    #[serde(default)]
    pub vault_type: bool,
}

fn one() -> usize {
    1
}
fn thirty() -> u64 {
    30
}

impl Default for RunOptions {
    fn default() -> Self {
        RunOptions { allow_changes: false, parallel: 1, max_minutes: 30, vault_type: false }
    }
}

/// Estado de una ejecución en curso: el proceso, la causa de término y los diálogos abiertos.
struct RunCtl {
    child: Mutex<Child>,
    stop: Arc<AtomicBool>,
    reason: Mutex<Option<String>>,
    prompts: Mutex<HashMap<String, Sender<Answer>>>,
}

impl RunCtl {
    fn halt(&self, reason: String) {
        lock(&self.reason).get_or_insert(reason);
        self.stop.store(true, Ordering::SeqCst);
        // Soltar los emisores destraba los diálogos pendientes (cuentan como rechazo).
        lock(&self.prompts).clear();
        let _ = lock(&self.child).kill();
    }
}

#[derive(Default)]
pub struct ScriptRunner {
    running: Mutex<HashMap<String, Arc<RunCtl>>>,
    /// Sesiones tomadas por un script: conexión -> ejecución.
    owners: Mutex<HashMap<String, String>>,
}

#[derive(Serialize, Clone)]
struct ScriptEvent {
    run: String,
    script: String,
    kind: &'static str, // "log" | "done" | "error"
    message: String,
}

#[derive(Serialize, Clone)]
struct PromptEvent {
    run: String,
    id: String,
    script: String,
    #[serde(flatten)]
    prompt: Prompt,
}

struct TauriBridge {
    app: AppHandle,
    run: String,
    script: String,
    ctl: Arc<RunCtl>,
}

impl TauriBridge {
    fn emit(&self, kind: &'static str, message: String) {
        let _ = self.app.emit("script-event", ScriptEvent { run: self.run.clone(), script: self.script.clone(), kind, message });
    }
}

impl Bridge for TauriBridge {
    fn write(&self, conn: &str, data: &[u8]) -> Result<(), String> {
        self.app.state::<crate::AppState>().conns.write(conn, data)
    }

    fn log(&self, message: String) {
        self.emit("log", message);
    }

    fn prompt(&self, p: Prompt) -> Option<Answer> {
        if self.ctl.stop.load(Ordering::SeqCst) {
            return None;
        }
        let timeout = if matches!(p, Prompt::Secret { .. }) { SECRET_TIMEOUT } else { GATE_TIMEOUT };
        let id = uuid::Uuid::new_v4().to_string();
        let (tx, rx) = channel();
        lock(&self.ctl.prompts).insert(id.clone(), tx);
        let _ = self.app.emit(
            "script-prompt",
            PromptEvent { run: self.run.clone(), id: id.clone(), script: self.script.clone(), prompt: p },
        );
        let answer = rx.recv_timeout(timeout).ok();
        lock(&self.ctl.prompts).remove(&id);
        let _ = self.app.emit("script-prompt-closed", json!({"run": self.run, "id": id}));
        answer
    }

    fn abort(&self, reason: String) {
        self.ctl.halt(reason);
    }

    fn type_saved_password(&self, conn: &str) -> Result<(), String> {
        crate::type_saved_password(&self.app.state::<crate::AppState>(), conn)
    }
}

pub fn scripts_dir(data_dir: &Path) -> PathBuf {
    let dir = data_dir.join("scripts");
    let _ = fs::create_dir_all(&dir);
    // El helper se mantiene al día con la app, pero solo se reescribe si cambió: antes se
    // escribía en cada listado y un script que arrancaba en ese momento podía importar
    // el archivo truncado.
    let helper = dir.join("netterminal.py");
    if fs::read(&helper).map(|c| c != HELPER.as_bytes()).unwrap_or(true) {
        let _ = fs::write(helper, HELPER);
    }
    let example = dir.join("ejemplo_respaldo.py");
    // Si el usuario lo eliminó no se vuelve a crear.
    if !example.exists() && !dir.join(TRASH).join("ejemplo_respaldo.py").exists() {
        let _ = fs::write(example, EXAMPLE);
    }
    dir
}

/// Tamaño máximo de un script traído desde otra carpeta.
const MAX_IMPORT: u64 = 1024 * 1024;
/// Subcarpeta donde quedan los scripts eliminados desde la app (recuperables).
const TRASH: &str = "eliminados";

/// Nombre de script seguro: un solo componente de ruta, .py, sin prefijo de unidad (`C:x.py`
/// en Windows reemplaza la carpeta base al unirlo), sin ocultos ni el helper.
fn valid_name(name: &str) -> bool {
    use std::path::Component;
    let mut comps = Path::new(name).components();
    matches!((comps.next(), comps.next()), (Some(Component::Normal(_)), None))
        && !name.contains(['/', '\\', ':'])
        && !name.starts_with('.')
        && !name.chars().any(char::is_control)
        && name.len() > 3
        && name.ends_with(".py")
        && name != "netterminal.py"
}

/// Guarda `content` con el primer nombre libre (`x.py`, `x-2.py`…). Si ya hay un archivo
/// idéntico con ese nombre lo reutiliza. Nunca sobrescribe ni sigue enlaces (create_new) y
/// salta los nombres que están en eliminados, para que un botón que apuntaba a un script
/// eliminado no pase a ejecutar otro distinto.
fn store_unique(dir: &Path, name: &str, content: &[u8]) -> Result<String, String> {
    let stem = &name[..name.len() - 3];
    for i in 1..1000 {
        let candidate = if i == 1 { name.to_string() } else { format!("{stem}-{i}.py") };
        let dest = dir.join(&candidate);
        if dir.join(TRASH).join(&candidate).exists() {
            continue;
        }
        match fs::OpenOptions::new().write(true).create_new(true).open(&dest) {
            Ok(mut f) => {
                f.write_all(content).map_err(|e| e.to_string())?;
                return Ok(candidate);
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                if fs::symlink_metadata(&dest).is_ok_and(|m| m.is_file()) && fs::read(&dest).is_ok_and(|c| c == content) {
                    return Ok(candidate);
                }
            }
            Err(e) => return Err(e.to_string()),
        }
    }
    Err("Demasiados scripts con ese nombre".into())
}

/// Copia a la carpeta de scripts un .py que el usuario eligió en el diálogo del sistema (la ruta
/// nunca viene del frontend) y devuelve su nombre. Solo se ejecuta desde esa carpeta: así los
/// botones guardan un nombre y nunca una ruta.
pub fn import(data_dir: &Path, src: &Path) -> Result<String, String> {
    let meta = fs::metadata(src).map_err(|e| e.to_string())?;
    let name = src.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    if !name.ends_with(".py") {
        return Err("Elige un archivo .py".into());
    }
    if !meta.is_file() || !valid_name(&name) {
        return Err("Archivo de script inválido".into());
    }
    if meta.len() > MAX_IMPORT {
        return Err("El script supera 1 MB".into());
    }
    let content = fs::read(src).map_err(|e| e.to_string())?;
    store_unique(&scripts_dir(data_dir), &name, &content)
}

/// Quita un script de la lista moviéndolo a `scripts/eliminados`, sin borrarlo del disco.
pub fn remove(data_dir: &Path, name: &str) -> Result<(), String> {
    if !valid_name(name) {
        return Err("Nombre de script inválido".into());
    }
    let dir = scripts_dir(data_dir);
    let src = dir.join(name);
    if !fs::symlink_metadata(&src).is_ok_and(|m| m.is_file()) {
        return Err(format!("No existe {name}"));
    }
    let content = fs::read(&src).map_err(|e| e.to_string())?;
    let trash = dir.join(TRASH);
    fs::create_dir_all(&trash).map_err(|e| e.to_string())?;
    store_unique(&trash, name, &content)?;
    fs::remove_file(&src).map_err(|e| e.to_string())
}

/// Scripts en eliminados, para restaurarlos.
pub fn list_deleted(data_dir: &Path) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(scripts_dir(data_dir).join(TRASH))
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|e| e.file_name().to_str().map(String::from))
        .filter(|n| valid_name(n))
        .collect();
    names.sort();
    names
}

/// Devuelve un script eliminado a la carpeta de scripts (con sufijo si el nombre está ocupado).
pub fn restore(data_dir: &Path, name: &str) -> Result<String, String> {
    if !valid_name(name) {
        return Err("Nombre de script inválido".into());
    }
    let dir = scripts_dir(data_dir);
    let src = dir.join(TRASH).join(name);
    if !fs::symlink_metadata(&src).is_ok_and(|m| m.is_file()) {
        return Err(format!("No existe {name}"));
    }
    let content = fs::read(&src).map_err(|e| e.to_string())?;
    fs::remove_file(&src).map_err(|e| e.to_string())?;
    store_unique(&dir, name, &content)
}

pub fn list(data_dir: &Path) -> Vec<String> {
    let dir = scripts_dir(data_dir);
    let mut names: Vec<String> = fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|e| {
            let p = e.path();
            let name = p.file_name()?.to_string_lossy().into_owned();
            (p.extension()? == "py" && p.file_stem()? != "netterminal").then_some(name)
        })
        .collect();
    names.sort();
    names
}

/// Un intérprete a probar: ejecutable y argumentos previos (`py -3`).
#[derive(Clone, Debug, PartialEq)]
pub struct Interpreter {
    pub bin: String,
    pub args: Vec<String>,
}

impl Interpreter {
    fn new(bin: impl Into<String>, args: &[&str]) -> Self {
        Interpreter { bin: bin.into(), args: args.iter().map(|a| a.to_string()).collect() }
    }
}

#[derive(Clone, Copy, PartialEq, Debug)]
enum Os {
    Windows,
    Mac,
    Other,
}

const MAC_PREFERRED: [&str; 3] = [
    "/opt/homebrew/bin/python3",
    "/usr/local/bin/python3",
    "/Library/Frameworks/Python.framework/Versions/Current/bin/python3",
];
/// En macOS puede ser el stub de las Command Line Tools: ejecutarlo sin ellas abre el
/// instalador de Apple.
const MAC_STUB: &str = "/usr/bin/python3";

/// Candidatos en orden de preferencia. `exists` y `clt` se inyectan para probar el orden.
/// - Windows: `py -3` (el lanzador elige el Python 3 instalado), luego python y python3.
/// - macOS: Homebrew (Apple Silicon e Intel), python.org, otros python3 del PATH (pyenv,
///   conda) y al final /usr/bin/python3, solo si `xcode-select -p` confirma que las
///   Command Line Tools están instaladas.
/// - Linux y otros: python3 y python del PATH.
fn candidates(os: Os, path_dirs: &[PathBuf], exists: &dyn Fn(&Path) -> bool, clt: &dyn Fn() -> bool) -> Vec<Interpreter> {
    match os {
        Os::Windows => vec![Interpreter::new("py", &["-3"]), Interpreter::new("python", &[]), Interpreter::new("python3", &[])],
        Os::Other => vec![Interpreter::new("python3", &[]), Interpreter::new("python", &[])],
        Os::Mac => {
            let mut out: Vec<Interpreter> = Vec::new();
            let mut push = |p: PathBuf| {
                let s = p.to_string_lossy().into_owned();
                if s != MAC_STUB && exists(&p) && !out.iter().any(|c| c.bin == s) {
                    out.push(Interpreter::new(s, &[]));
                }
            };
            for p in MAC_PREFERRED {
                push(PathBuf::from(p));
            }
            for d in path_dirs {
                push(d.join("python3"));
            }
            if exists(Path::new(MAC_STUB)) && clt() {
                out.push(Interpreter::new(MAC_STUB, &[]));
            }
            out
        }
    }
}

fn current_os() -> Os {
    if cfg!(windows) {
        Os::Windows
    } else if cfg!(target_os = "macos") {
        Os::Mac
    } else {
        Os::Other
    }
}

/// Salida de un comando con plazo: lo que no responde a tiempo se mata.
fn output_within(mut cmd: Command, timeout: Duration) -> Option<String> {
    cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    hide_console(&mut cmd);
    let mut child = cmd.spawn().ok()?;
    let deadline = Instant::now() + timeout;
    loop {
        match child.try_wait() {
            Ok(Some(st)) => {
                let mut text = String::new();
                if let Some(mut o) = child.stdout.take() {
                    let _ = std::io::Read::read_to_string(&mut o, &mut text);
                }
                if let Some(mut e) = child.stderr.take() {
                    let _ = std::io::Read::read_to_string(&mut e, &mut text);
                }
                return st.success().then_some(text);
            }
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(25)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    }
}

/// Versión de Python 3 que informa el intérprete, si responde a tiempo.
fn python_version(i: &Interpreter) -> Option<String> {
    let mut c = Command::new(&i.bin);
    c.args(&i.args).arg("--version");
    let v = output_within(c, Duration::from_secs(5))?;
    let v = v.trim();
    v.starts_with("Python 3").then(|| v.to_string())
}

fn detect() -> Option<(Interpreter, String)> {
    let dirs: Vec<PathBuf> = std::env::var_os("PATH").map(|p| std::env::split_paths(&p).collect()).unwrap_or_default();
    let clt = || {
        let mut c = Command::new("xcode-select");
        c.arg("-p");
        output_within(c, Duration::from_secs(3)).is_some()
    };
    candidates(current_os(), &dirs, &|p| p.is_file(), &clt)
        .into_iter()
        .find_map(|i| python_version(&i).map(|v| (i, v)))
}

static PYTHON: Mutex<Option<(Interpreter, String)>> = Mutex::new(None);

/// Intérprete detectado. Solo se recuerda un resultado positivo: si falta Python, cada
/// ejecución vuelve a buscar, así instalarlo no exige reiniciar la app.
fn python() -> Option<Interpreter> {
    let mut cached = lock(&PYTHON);
    if cached.is_none() {
        *cached = detect();
    }
    cached.as_ref().map(|(i, _)| i.clone())
}

/// Olvida el intérprete y lo vuelve a buscar ("Volver a detectar Python").
pub fn redetect_python() -> Result<String, String> {
    let found = detect();
    let mut cached = lock(&PYTHON);
    *cached = found;
    cached.as_ref().map(|(i, v)| format!("{v} ({})", i.bin)).ok_or_else(|| NO_PYTHON.into())
}

/// Intérprete en uso, sin forzar una búsqueda nueva si ya hay uno.
pub fn python_status() -> Result<String, String> {
    python().ok_or(NO_PYTHON)?;
    let cached = lock(&PYTHON);
    cached.as_ref().map(|(i, v)| format!("{v} ({})", i.bin)).ok_or_else(|| NO_PYTHON.into())
}

const NO_PYTHON: &str = "No se encontró Python 3. Instálalo (python.org o Homebrew en macOS) y usa Volver a detectar.";

fn hide_console(_c: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        _c.creation_flags(0x0800_0000);
    }
}

/// Qué ejecutar: un script de usuario o la acción de un plugin.
pub struct RunSpec {
    pub label: String,
    pub path: PathBuf,
    pub cwd: PathBuf,
    /// Sesiones que el usuario eligió; la primera es la principal (`nt.run`, `nt.session`).
    pub targets: Vec<TargetReq>,
    /// false = el script no puede enviar ni leer de la sesión (plugin sin permiso "session").
    pub allow_session: bool,
    pub options: RunOptions,
    pub env: Vec<(String, String)>,
}

impl ScriptRunner {
    pub fn run(
        &self,
        app: AppHandle,
        script: String,
        targets: Vec<TargetReq>,
        options: RunOptions,
        data_dir: &Path,
    ) -> Result<String, String> {
        let dir = scripts_dir(data_dir);
        // Solo archivos .py dentro de la carpeta de scripts (sin rutas).
        if !valid_name(&script) {
            return Err("Nombre de script inválido".into());
        }
        let path = dir.join(&script);
        if !path.is_file() {
            return Err(format!("No existe {script}"));
        }
        if targets.is_empty() {
            return Err("Elige al menos una sesión conectada".into());
        }
        self.run_spec(
            app,
            RunSpec { label: script, path, cwd: dir, targets, allow_session: true, options, env: vec![] },
            data_dir,
        )
    }

    /// Ejecución que tiene tomada la sesión, si hay una.
    pub fn owner(&self, conn: &str) -> Option<String> {
        lock(&self.owners).get(conn).cloned()
    }

    pub fn run_spec(&self, app: AppHandle, spec: RunSpec, data_dir: &Path) -> Result<String, String> {
        let RunSpec { label: script, path, cwd, targets: wanted, allow_session, options, env } = spec;
        let Interpreter { bin, args: pre } = python().ok_or(NO_PYTHON)?;
        let helper_dir = scripts_dir(data_dir);
        let conns = &app.state::<crate::AppState>().conns;

        // Destinos: conectados, sin repetir y con nombre único para on(nombre).
        let mut targets: Vec<Target> = Vec::new();
        let mut main_session = json!({});
        if allow_session {
            let mut seen = HashSet::new();
            for t in wanted.iter().filter(|t| seen.insert(t.conn.clone())) {
                let (_, s) = conns.info(&t.conn).ok_or("Una de las sesiones elegidas no está conectada")?;
                let rx = conns.tap(&t.conn).ok_or("Una de las sesiones elegidas no está conectada")?;
                let mut name = s.name.clone();
                let mut n = 2;
                while targets.iter().any(|x| x.name == name) {
                    name = format!("{} ({n})", s.name);
                    n += 1;
                }
                if targets.is_empty() {
                    main_session = json!({
                        "name": name, "type": s.session_type, "host": s.host,
                        "port": s.port, "username": s.username, "serial_port": s.serial_port,
                    });
                }
                let platform = t.platform.clone().or(s.platform.clone());
                let info = json!({"name": name, "type": s.session_type, "host": s.host, "port": s.port, "platform": platform});
                targets.push(Target::new(name, t.conn.clone(), info, rx));
            }
        }

        let run_id = uuid::Uuid::new_v4().to_string();
        {
            let mut owners = lock(&self.owners);
            if let Some(t) = targets.iter().find(|t| owners.contains_key(&t.conn)) {
                return Err(format!("{} ya está en uso por otro script", t.name));
            }
            for t in &targets {
                owners.insert(t.conn.clone(), run_id.clone());
            }
        }
        let release = |owners: &Mutex<HashMap<String, String>>, run: &str| lock(owners).retain(|_, r| r != run);

        let parallel = options.parallel.clamp(1, MAX_PARALLEL);
        let mut cmd = Command::new(bin);
        cmd.args(pre)
            .arg("-u")
            .arg("-B")
            .arg(&path)
            .current_dir(&cwd)
            .env("PYTHONIOENCODING", "utf-8")
            .env("PYTHONDONTWRITEBYTECODE", "1")
            .env("PYTHONPATH", &helper_dir)
            .env("NT_DATA_DIR", data_dir)
            .env("NT_SESSION", main_session.to_string())
            .env("NT_ALLOW_CHANGES", if options.allow_changes { "1" } else { "0" })
            .env("NT_MAX_PARALLEL", parallel.to_string())
            .envs(env)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        hide_console(&mut cmd);
        let mut child = match cmd.spawn() {
            Ok(c) => c,
            Err(e) => {
                release(&self.owners, &run_id);
                return Err(format!("No se pudo iniciar Python: {e}"));
            }
        };

        let (Some(stdout), Some(stdin), Some(stderr)) = (child.stdout.take(), child.stdin.take(), child.stderr.take()) else {
            let _ = child.kill();
            release(&self.owners, &run_id);
            return Err("No se pudo conectar con el script".into());
        };
        let stop = Arc::new(AtomicBool::new(false));
        let ctl = Arc::new(RunCtl { child: Mutex::new(child), stop: stop.clone(), reason: Mutex::new(None), prompts: Mutex::default() });
        lock(&self.running).insert(run_id.clone(), ctl.clone());

        let errors = Arc::new(Mutex::new(Vec::<String>::new()));
        let errs = errors.clone();
        std::thread::spawn(move || {
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                let mut e = lock(&errs);
                e.push(line);
                if e.len() > 20 {
                    e.remove(0);
                }
            }
        });

        // Tiempo máximo de la ejecución completa.
        let max = Duration::from_secs(options.max_minutes.clamp(1, 240) * 60);
        let (watch, finished) = (ctl.clone(), Arc::new(AtomicBool::new(false)));
        let done_flag = finished.clone();
        std::thread::spawn(move || {
            let deadline = Instant::now() + max;
            while !done_flag.load(Ordering::SeqCst) {
                if Instant::now() >= deadline {
                    watch.halt(format!("Tiempo máximo del script agotado ({} min)", max.as_secs() / 60));
                    break;
                }
                std::thread::sleep(SLICE);
            }
        });

        let bridge = TauriBridge { app: app.clone(), run: run_id.clone(), script: script.clone(), ctl: ctl.clone() };
        let vault = allow_session && options.vault_type;
        let broker = Arc::new(Broker::new(bridge, targets, allow_session, options.allow_changes, parallel, stop).with_vault(vault));
        let id = run_id.clone();
        std::thread::spawn(move || {
            let out: Arc<Mutex<dyn Write + Send>> = Arc::new(Mutex::new(stdin));
            serve(broker.clone(), BufReader::new(stdout), out);
            // Sin retener el lock mientras espera, para que "Detener" pueda matar el proceso.
            let status = loop {
                match lock(&ctl.child).try_wait() {
                    Ok(Some(st)) => break Ok(st),
                    Ok(None) => {}
                    Err(e) => break Err(e),
                }
                std::thread::sleep(Duration::from_millis(100));
            };
            finished.store(true, Ordering::SeqCst);
            let runner = &app.state::<crate::AppState>().scripts;
            lock(&runner.running).remove(&id);
            release(&runner.owners, &id);
            let reason = lock(&ctl.reason).clone();
            match (reason, status) {
                (Some(r), _) => broker.bridge.emit("error", broker.redact(&r)),
                (None, Ok(s)) if s.success() => broker.bridge.emit("done", "Script finalizado".into()),
                (None, Ok(s)) => {
                    let tail = lock(&errors).join("\n");
                    let last = tail.lines().last().unwrap_or("").to_string();
                    broker.bridge.emit("error", broker.redact(&format!("Terminó con código {}: {last}", s.code().unwrap_or(-1))));
                }
                (None, Err(e)) => broker.bridge.emit("error", e.to_string()),
            }
        });
        Ok(run_id)
    }

    pub fn stop(&self, run_id: &str) {
        if let Some(ctl) = lock(&self.running).get(run_id).cloned() {
            ctl.halt("Detenido por el usuario".into());
        }
    }

    /// Respuesta de la interfaz a un diálogo del script (confirmación o secreto).
    pub fn answer(&self, run: &str, id: &str, approve: bool, value: Option<String>) {
        let Some(ctl) = lock(&self.running).get(run).cloned() else { return };
        let Some(tx) = lock(&ctl.prompts).remove(id) else { return };
        let answer = match (approve, value) {
            (false, _) => Answer::Deny,
            (true, Some(v)) => Answer::Secret(Zeroizing::new(v)),
            (true, None) => Answer::Approve,
        };
        let _ = tx.send(answer);
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn import_and_remove_scripts() {
        let root = std::env::temp_dir().join(format!("nt-scripts-{}", uuid::Uuid::new_v4()));
        let ext = root.join("externo");
        fs::create_dir_all(&ext).unwrap();
        let a = ext.join("respaldo.py");
        fs::write(&a, "print(1)").unwrap();
        assert_eq!(import(&root, &a).unwrap(), "respaldo.py");
        // Mismo contenido: no duplica. Distinto: sufijo, nunca sobrescribe.
        assert_eq!(import(&root, &a).unwrap(), "respaldo.py");
        let b = root.join("otro");
        fs::create_dir_all(&b).unwrap();
        fs::write(b.join("respaldo.py"), "print(2)").unwrap();
        assert_eq!(import(&root, &b.join("respaldo.py")).unwrap(), "respaldo-2.py");
        assert_eq!(fs::read_to_string(root.join("scripts/respaldo.py")).unwrap(), "print(1)");
        // Solo .py y nunca el helper.
        fs::write(ext.join("x.sh"), "echo").unwrap();
        assert!(import(&root, &ext.join("x.sh")).is_err());
        fs::write(ext.join("netterminal.py"), "x").unwrap();
        assert!(import(&root, &ext.join("netterminal.py")).is_err());

        // Eliminar mueve a scripts/eliminados y el ejemplo no reaparece.
        remove(&root, "ejemplo_respaldo.py").unwrap();
        remove(&root, "respaldo.py").unwrap();
        assert!(remove(&root, "netterminal.py").is_err());
        assert!(remove(&root, "../x.py").is_err());
        assert!(remove(&root, "C:x.py").is_err());
        assert_eq!(list(&root), vec!["respaldo-2.py".to_string()]);
        assert!(root.join("scripts/eliminados/respaldo.py").is_file());
        // Un nombre que está en eliminados no se reutiliza para otro contenido.
        fs::write(ext.join("respaldo.py"), "print(3)").unwrap();
        assert_eq!(import(&root, &ext.join("respaldo.py")).unwrap(), "respaldo-3.py");
        assert_eq!(list_deleted(&root), vec!["ejemplo_respaldo.py".to_string(), "respaldo.py".to_string()]);
        assert_eq!(restore(&root, "respaldo.py").unwrap(), "respaldo.py");
        assert!(!root.join("scripts/eliminados/respaldo.py").exists());
        fs::remove_dir_all(&root).unwrap();
    }

    use super::*;
    use std::io::Cursor;

    /// Puente de prueba: equipos ficticios que responden a cada Enter y una interfaz que
    /// aprueba consultas (`show`, `terminal`, `ping`) y responde lo configurado al resto.
    struct Fake {
        devices: Mutex<HashMap<String, Sender<String>>>,
        written: Mutex<Vec<(String, String)>>,
        logs: Mutex<Vec<String>>,
        prompts: Mutex<Vec<Prompt>>,
        approve_changes: bool,
        secret: Option<String>,
        aborted: Mutex<Option<String>>,
        line: Mutex<HashMap<String, String>>,
    }

    impl Fake {
        fn new(approve_changes: bool, secret: Option<&str>) -> Self {
            Fake {
                devices: Mutex::default(),
                written: Mutex::default(),
                logs: Mutex::default(),
                prompts: Mutex::default(),
                approve_changes,
                secret: secret.map(str::to_string),
                aborted: Mutex::default(),
                line: Mutex::default(),
            }
        }
        fn sent(&self, conn: &str) -> String {
            lock(&self.written).iter().filter(|(c, _)| c == conn).map(|(_, d)| d.as_str()).collect()
        }
        fn confirmations(&self) -> Vec<Prompt> {
            lock(&self.prompts).iter().filter(|p| matches!(p, Prompt::Gate { line, opaque, .. } if *opaque || !is_read(line))).cloned().collect()
        }
    }

    fn is_read(line: &str) -> bool {
        ["show ", "terminal ", "ping "].iter().any(|p| line.starts_with(p))
    }

    impl Bridge for Fake {
        fn write(&self, conn: &str, data: &[u8]) -> Result<(), String> {
            let text = String::from_utf8_lossy(data).to_string();
            lock(&self.written).push((conn.to_string(), text.clone()));
            let mut lines = lock(&self.line);
            let cur = lines.entry(conn.to_string()).or_default();
            for c in text.chars() {
                if c == '\r' {
                    let cmd = std::mem::take(cur);
                    if let Some(tx) = lock(&self.devices).get(conn) {
                        let _ = tx.send(format!("{cmd}\r\n{conn}: salida de {cmd}\r\n{conn}#"));
                    }
                } else if c != '\n' {
                    cur.push(c);
                }
            }
            Ok(())
        }
        fn log(&self, message: String) {
            lock(&self.logs).push(message);
        }
        fn prompt(&self, p: Prompt) -> Option<Answer> {
            lock(&self.prompts).push(p.clone());
            match p {
                Prompt::Gate { line, opaque, .. } if !opaque && is_read(&line) => Some(Answer::Approve),
                Prompt::Gate { .. } if self.approve_changes => Some(Answer::Approve),
                Prompt::Gate { .. } => Some(Answer::Deny),
                Prompt::Secret { .. } => self.secret.clone().map(|s| Answer::Secret(Zeroizing::new(s))),
            }
        }
        fn abort(&self, reason: String) {
            *lock(&self.aborted) = Some(reason);
        }
        /// Como la app: el valor va directo al equipo (aquí, a `written`) y nunca vuelve.
        fn type_saved_password(&self, conn: &str) -> Result<(), String> {
            if conn == "sin-pedido" {
                return Err(crate::autofill::NO_PROMPT.into());
            }
            lock(&self.written).push((conn.to_string(), format!("{VAULT_SECRET}\r")));
            Ok(())
        }
    }

    const VAULT_SECRET: &str = "B0veda-S3creta";

    fn broker(fake: Fake, names: &[&str], allow_changes: bool) -> Arc<Broker<Fake>> {
        let mut targets = Vec::new();
        for n in names {
            let (tx, rx) = channel();
            lock(&fake.devices).insert(n.to_string(), tx);
            targets.push(Target::new(n.to_string(), n.to_string(), json!({"name": n, "type": "ssh", "host": "192.0.2.1"}), rx));
        }
        Arc::new(Broker::new(fake, targets, true, allow_changes, 1, Arc::new(AtomicBool::new(false))))
    }

    #[test]
    fn lines_are_assembled_like_a_cli() {
        let mut st = LineState::default();
        assert_eq!(split_commits(&mut st, "reloa"), vec![Chunk::Text("reloa".into())]);
        assert!(st.dirty);
        let c = split_commits(&mut st, "d\r\n");
        assert_eq!(c, vec![Chunk::Commit { bytes: "d\r\n".into(), line: "reload".into(), opaque: false, dirty: true }]);
        // Retroceso, Ctrl-U y Ctrl-W editan la línea como en el equipo.
        let c = split_commits(&mut LineState::default(), "show ver\x15rel\x7fload\r");
        assert!(matches!(&c[0], Chunk::Commit { line, .. } if line == "reload"));
        let c = split_commits(&mut LineState::default(), "show clock reload\x17\r");
        assert!(matches!(&c[0], Chunk::Commit { line, .. } if line == "show clock "));
        // Tab, ? y Esc: el equipo completa o recupera historial, la línea es opaca.
        for data in ["rel\t\r", "re?\r", "\x1b[A\r", "show\u{202E}x\r"] {
            let c = split_commits(&mut LineState::default(), data);
            assert!(matches!(&c[0], Chunk::Commit { opaque: true, .. }), "{data:?}");
        }
        // Ctrl-D se trata como una línea opaca; Ctrl-C descarta lo escrito.
        let c = split_commits(&mut LineState::default(), "\x04");
        assert!(matches!(&c[0], Chunk::Commit { opaque: true, line, .. } if line == "^D"));
        let c = split_commits(&mut LineState::default(), "reload\x03\r");
        assert!(matches!(&c[0], Chunk::Commit { opaque: false, line, .. } if line.is_empty()));
        // Varias líneas en un solo envío: una por Enter.
        let c = split_commits(&mut LineState::default(), "show a\rshow b\rshow");
        assert_eq!(c.len(), 3);
        assert_eq!(c[2], Chunk::Text("show".into()));
    }

    #[test]
    fn read_commands_pass_and_changes_are_confirmed_once_per_run() {
        let b = broker(Fake::new(true, None), &["core", "acc1", "acc2"], false);
        assert_eq!(b.handle(&(json!({"op": "send", "data": "show version\r"})))["ok"], true);
        assert_eq!(b.bridge.sent("core"), "show version\r");
        // Mismo cambio en tres sesiones: se confirma una vez y el diálogo nombra los destinos.
        for s in ["core", "acc1", "acc2"] {
            let r = b.handle(&(json!({"op": "send", "session": s, "data": "interface Gi1/0/5\r"})));
            assert_eq!(r["ok"], true, "{s}: {r}");
        }
        let c = b.bridge.confirmations();
        assert_eq!(c.len(), 1);
        let Prompt::Gate { targets, session, line, .. } = &c[0] else { panic!() };
        assert_eq!((targets.len(), session.as_str(), line.as_str()), (3, "core", "interface Gi1/0/5"));
        assert!(b.bridge.aborted.lock().unwrap().is_none());
    }

    #[test]
    fn denial_aborts_and_nothing_reaches_the_device() {
        let b = broker(Fake::new(false, None), &["core", "acc1"], false);
        b.handle(&(json!({"op": "send", "session": "acc1", "data": "relo"})));
        let r = b.handle(&(json!({"op": "send", "session": "acc1", "data": "ad\r"})));
        assert_eq!((r["ok"].as_bool(), r["code"].as_str()), (Some(false), Some("denied")));
        // Solo quedó lo tecleado sin Enter, borrado después con Ctrl-U.
        assert_eq!(b.bridge.sent("acc1"), "relo\x15");
        assert!(b.bridge.aborted.lock().unwrap().as_deref().unwrap().contains("«reload» en acc1"));
        // Tras el rechazo ninguna sesión acepta más operaciones.
        let r = b.handle(&(json!({"op": "send", "session": "core", "data": "show clock\r"})));
        assert_eq!(r["code"], "cancelled");
        assert_eq!(b.bridge.sent("core"), "");
    }

    #[test]
    fn opaque_lines_always_ask() {
        let b = broker(Fake::new(true, None), &["core"], true);
        b.handle(&(json!({"op": "send", "data": "show ver\t\r"})));
        let c = b.bridge.confirmations();
        assert!(matches!(&c[..], [Prompt::Gate { opaque: true, allow_changes: true, .. }]), "{c:?}");
    }

    #[test]
    fn only_selected_sessions_are_reachable() {
        let b = broker(Fake::new(true, None), &["core", "acc1"], false);
        let r = b.handle(&(json!({"op": "send", "session": "otro", "data": "show clock\r"})));
        assert_eq!(r["code"], "session");
        let list = b.handle(&(json!({"op": "sessions"})));
        let names: Vec<&str> = list["sessions"].as_array().unwrap().iter().map(|s| s["name"].as_str().unwrap()).collect();
        assert_eq!(names, ["core", "acc1"]);
        assert!(list.to_string().find("password").is_none() && list.to_string().find("username").is_none());
        // Plugin sin el permiso "session".
        let p = Broker::new(Fake::new(true, None), vec![], false, false, 1, Arc::new(AtomicBool::new(false)));
        assert_eq!(p.handle(&(json!({"op": "send", "data": "show clock\r"})))["code"], "permission");
        assert_eq!(p.handle(&(json!({"op": "sessions"})))["code"], "permission");
    }

    #[test]
    fn secrets_are_masked_everywhere_the_app_shows_them() {
        let b = broker(Fake::new(true, Some("Cl4ve-Sup3r")), &["core"], false);
        let r = b.handle(&(json!({"op": "ask_secret", "label": "Enable\u{7}"})));
        assert_eq!(r["value"], "Cl4ve-Sup3r");
        assert_eq!(lock(&b.bridge.prompts)[0], Prompt::Secret { label: "Enable".into() });
        b.handle(&(json!({"op": "log", "msg": "la clave es Cl4ve-Sup3r"})));
        assert_eq!(lock(&b.bridge.logs)[0], format!("la clave es {MASK}"));
        // Responder un pedido de contraseña con el secreto no pide confirmación.
        b.handle(&(json!({"op": "send", "data": "Cl4ve-Sup3r\r"})));
        assert!(b.bridge.confirmations().is_empty());
        // Dentro de un comando, el diálogo lo muestra enmascarado.
        b.handle(&(json!({"op": "send", "data": "username ops secret Cl4ve-Sup3r\r"})));
        let c = b.bridge.confirmations();
        assert!(matches!(&c[..], [Prompt::Gate { line, .. }] if line == &format!("username ops secret {MASK}")), "{c:?}");
        // Cancelar el diálogo no detiene el script, pero el script recibe un error.
        let b = broker(Fake::new(true, None), &["core"], false);
        assert_eq!(b.handle(&(json!({"op": "ask_secret", "label": "x"})))["code"], "cancelled");
        assert!(b.bridge.aborted.lock().unwrap().is_none());
    }

    #[test]
    fn saved_password_needs_approval_a_target_and_never_returns_the_value() {
        let req = |s: &str| json!({"op": "type_saved_password", "session": s});
        // Sin la casilla del diálogo de lanzamiento: rechazado y nada llega al equipo.
        let b = broker(Fake::new(true, None), &["core", "sin-pedido"], false);
        let r = b.handle(&req("core"));
        assert_eq!((r["ok"].as_bool(), r["code"].as_str()), (Some(false), Some("permission")));
        assert_eq!(b.bridge.sent("core"), "");
        // Plugin sin "session": tampoco (la casilla no basta).
        let p = Broker::new(Fake::new(true, None), vec![], false, false, 1, Arc::default()).with_vault(true);
        assert_eq!(p.handle(&json!({"op": "type_saved_password"}))["code"], "permission");

        let b = Arc::try_unwrap(b).ok().unwrap().with_vault(true);
        // Sesión que no está entre los destinos: rechazada.
        assert_eq!(b.handle(&req("otra"))["code"], "session");
        // Sin pedido de contraseña en pantalla: el motivo vuelve al script, sin escribir nada.
        let r = b.handle(&req("sin-pedido"));
        assert_eq!((r["code"].as_str(), r["error"].as_str()), (Some("vault"), Some(crate::autofill::NO_PROMPT)));
        assert_eq!(b.bridge.sent("sin-pedido"), "");
        // Texto a medio escribir en la línea: no se pega la contraseña detrás.
        b.handle(&json!({"op": "send", "session": "core", "data": "sh"}));
        assert_eq!(b.handle(&req("core"))["code"], "pending");
        b.handle(&json!({"op": "send", "session": "core", "data": "\x15"}));
        // Aprobado, destino válido y con pedido: la app la escribe; el script solo recibe ok.
        let r = b.handle(&req("core"));
        assert_eq!(r, json!({"ok": true}));
        assert!(b.bridge.sent("core").ends_with(&format!("{VAULT_SECRET}\r")));
        let logs = lock(&b.bridge.logs).clone();
        assert_eq!(logs, ["Contraseña guardada escrita en core (el script no la ve)"]);
        // El valor no aparece en respuestas, mensajes, diálogos ni errores.
        let shown = format!("{r}{logs:?}{:?}{:?}", lock(&b.bridge.prompts), lock(&b.bridge.aborted));
        assert!(!shown.contains(VAULT_SECRET));
        // Tope por ejecución.
        for _ in 1..MAX_VAULT_TYPES {
            assert_eq!(b.handle(&req("core"))["ok"], true);
        }
        assert_eq!(b.handle(&req("core"))["code"], "limit");
        // Por serve también se responde por id y en paralelo con el resto.
        let out: Arc<Mutex<Vec<u8>>> = Arc::default();
        let w: Arc<Mutex<dyn Write + Send>> = out.clone();
        let b2 = broker(Fake::new(true, None), &["core"], false);
        serve(b2, Cursor::new(format!("{}\n", json!({"id": 7, "op": "type_saved_password"}))), w);
        let reply: Value = serde_json::from_slice(lock(&out).as_slice()).unwrap();
        assert_eq!((reply["id"].as_i64(), reply["code"].as_str()), (Some(7), Some("permission")));
    }

    #[test]
    fn wait_returns_everything_or_only_up_to_the_match() {
        let b = broker(Fake::new(true, None), &["core"], false);
        let (tx, rx) = channel();
        let t = Target::new("x".into(), "x".into(), json!({}), rx);
        let mut io = lock(&t.io);
        tx.send("uno\r\nMore: dos\r\ncore#".into()).unwrap();
        let re = Regex::new("More:").unwrap();
        let r = b.wait(&mut io, &re, Duration::from_secs(1), true);
        assert_eq!(r["output"], "uno\r\nMore:");
        assert_eq!(io.pending, " dos\r\ncore#");
        let r = b.wait(&mut io, &Regex::new("#$").unwrap(), Duration::from_secs(1), false);
        assert_eq!(r["output"], " dos\r\ncore#");
        // Tiempo agotado: devuelve lo recibido.
        tx.send("parcial".into()).unwrap();
        let r = b.wait(&mut io, &Regex::new("nunca").unwrap(), Duration::from_millis(80), false);
        assert_eq!((r["code"].as_str(), r["output"].as_str()), (Some("timeout"), Some("parcial")));
    }

    #[test]
    fn stop_interrupts_a_long_wait() {
        let b = broker(Fake::new(true, None), &["core"], false);
        let b2 = b.clone();
        let start = Instant::now();
        let h = std::thread::spawn(move || b2.handle(&json!({"op": "wait", "pattern": "nunca", "timeout": 60})));
        std::thread::sleep(Duration::from_millis(100));
        b.stop.store(true, Ordering::SeqCst);
        assert_eq!(h.join().unwrap()["code"], "cancelled");
        assert!(start.elapsed() < Duration::from_secs(2));
    }

    #[test]
    fn serve_matches_replies_by_id_and_caps_parallelism() {
        let b = broker(Fake::new(true, None), &["core", "acc1"], false);
        let input = [
            json!({"id": 1, "op": "send", "session": "acc1", "data": "show clock\r"}),
            json!({"id": 2, "op": "log", "msg": "hola"}),
            json!({"id": 3, "op": "sessions"}),
        ]
        .iter()
        .map(|v| v.to_string() + "\n")
        .collect::<String>()
            + "texto suelto\n";
        let out: Arc<Mutex<Vec<u8>>> = Arc::default();
        let w: Arc<Mutex<dyn Write + Send>> = out.clone();
        serve(b.clone(), Cursor::new(input), w);
        let text = String::from_utf8(lock(&out).clone()).unwrap();
        let mut ids: Vec<i64> = text.lines().map(|l| serde_json::from_str::<Value>(l).unwrap()["id"].as_i64().unwrap()).collect();
        ids.sort();
        assert_eq!(ids, [1, 2, 3]);
        assert_eq!(lock(&b.bridge.logs).as_slice(), ["hola", "texto suelto"]);
        // El semáforo nunca deja más permisos que el tope.
        let s = Semaphore::new(9);
        assert_eq!(*lock(&s.free), 9);
        let s = Arc::new(Semaphore::new(2));
        let (p1, p2) = (s.acquire(), s.acquire());
        assert_eq!(*lock(&s.free), 0);
        drop((p1, p2));
        assert_eq!(*lock(&s.free), 2);
        assert_eq!(Broker::new(Fake::new(true, None), vec![], true, false, 99, Arc::default()).parallel.free.lock().map(|f| *f).unwrap(), MAX_PARALLEL);
    }

    fn bins(c: Vec<Interpreter>) -> Vec<String> {
        c.into_iter().map(|i| [vec![i.bin], i.args].concat().join(" ")).collect()
    }

    #[test]
    fn python_candidates_prefer_real_installs_on_macos() {
        let all = |_: &Path| true;
        let path = [PathBuf::from("/Users/u/.pyenv/shims"), PathBuf::from("/usr/bin"), PathBuf::from("/opt/homebrew/bin")];
        // Con las Command Line Tools: Homebrew, /usr/local, python.org, el PATH y el stub al final.
        assert_eq!(
            bins(candidates(Os::Mac, &path, &all, &|| true)),
            [
                "/opt/homebrew/bin/python3",
                "/usr/local/bin/python3",
                "/Library/Frameworks/Python.framework/Versions/Current/bin/python3",
                "/Users/u/.pyenv/shims/python3",
                "/usr/bin/python3",
            ]
        );
        // Sin ellas, /usr/bin/python3 no se ejecuta: abriría el instalador de Apple.
        let only_stub = |p: &Path| p == Path::new("/usr/bin/python3");
        assert!(candidates(Os::Mac, &path, &only_stub, &|| false).is_empty());
        assert_eq!(bins(candidates(Os::Mac, &path, &only_stub, &|| true)), ["/usr/bin/python3"]);
        // Solo los que existen, sin repetir.
        let brew = |p: &Path| p.starts_with("/usr/local");
        assert_eq!(bins(candidates(Os::Mac, &[PathBuf::from("/usr/local/bin")], &brew, &|| true)), ["/usr/local/bin/python3"]);
    }

    #[test]
    fn python_candidates_on_windows_and_linux() {
        let none = |_: &Path| false;
        assert_eq!(bins(candidates(Os::Windows, &[], &none, &|| false)), ["py -3", "python", "python3"]);
        assert_eq!(bins(candidates(Os::Other, &[], &none, &|| false)), ["python3", "python"]);
    }

    #[test]
    fn slow_commands_are_cut_by_the_timeout() {
        if cfg!(windows) {
            return;
        }
        let start = Instant::now();
        let mut c = Command::new("sleep");
        c.arg("5");
        assert_eq!(output_within(c, Duration::from_millis(200)), None);
        assert!(start.elapsed() < Duration::from_secs(2));
        let mut c = Command::new("echo");
        c.arg("Python 3.12.1");
        assert_eq!(output_within(c, Duration::from_secs(2)).as_deref().map(str::trim), Some("Python 3.12.1"));
    }

    /// El netterminal.py real contra el Broker: varias sesiones, hilos y respuestas por id.
    #[test]
    fn python_helper_runs_multi_session_scripts() {
        let Some(Interpreter { bin, args: pre }) = python() else {
            eprintln!("sin Python 3: se omite");
            return;
        };
        let dir = std::env::temp_dir().join(format!("nt-py-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("netterminal.py"), HELPER).unwrap();
        fs::write(
            dir.join("prueba.py"),
            r#"import netterminal as nt
names = [s["name"] for s in nt.sessions()]
print("destinos:", ",".join(names))
res = nt.for_each(lambda s: s.run("show clock").strip(), parallel=3)
for n in names:
    print(n, "=>", res[n])
print("principal:", nt.run("show ver").strip())
try:
    nt.on("ajena")
except RuntimeError as e:
    print("ajena rechazada")
"#,
        )
        .unwrap();
        let mut child = Command::new(bin)
            .args(pre)
            .args(["-u", "-B"])
            .arg(dir.join("prueba.py"))
            .env("PYTHONPATH", &dir)
            .env("NT_MAX_PARALLEL", "3")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        let b = broker(Fake::new(true, None), &["core", "acc1", "acc2"], false);
        let out: Arc<Mutex<dyn Write + Send>> = Arc::new(Mutex::new(child.stdin.take().unwrap()));
        serve(b.clone(), BufReader::new(child.stdout.take().unwrap()), out);
        let st = child.wait().unwrap();
        let mut err = String::new();
        std::io::Read::read_to_string(&mut child.stderr.take().unwrap(), &mut err).unwrap();
        assert!(st.success(), "{err}");
        let logs = lock(&b.bridge.logs).clone();
        assert_eq!(
            logs,
            [
                "destinos: core,acc1,acc2",
                "core => core: salida de show clock",
                "acc1 => acc1: salida de show clock",
                "acc2 => acc2: salida de show clock",
                "principal: core: salida de show ver",
                "ajena rechazada",
            ]
        );
        let _ = fs::remove_dir_all(dir);
    }
}
