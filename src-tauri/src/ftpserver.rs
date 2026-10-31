//! Servidor FTP mínimo para que los equipos descarguen o suban archivos de la carpeta
//! compartida con `copy ftp:` (RFC 959, EPSV/EPRT de RFC 2428 y SIZE/MDTM de RFC 3659).
//!
//! Apagado por defecto. Usuario fijo `nt` y contraseña aleatoria en cada inicio, solo lectura salvo
//! que se habilite la subida, rutas confinadas a la carpeta compartida, conexiones de datos
//! solo con la IP que inició sesión (sin "FTP bounce", RFC 2577) y límites de clientes,
//! intentos y tamaño. FTP no cifra: usuario, contraseña y archivos viajan en claro.

use crate::servers::{bind_error, inside_root, spawn_limited, Servers, TFTP_MAX_UPLOAD};
use serde::Serialize;
use serde_json::{json, Value};
use std::fs::{self, File};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{IpAddr, Shutdown, SocketAddr, TcpListener, TcpStream};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{Emitter, Manager};

/// Clientes FTP simultáneos como máximo.
const MAX_CLIENTS: usize = 8;
/// Intentos de login por conexión.
const MAX_LOGIN_FAILS: u32 = 3;
/// Inactividad del canal de control antes de cerrar.
const IDLE: Duration = Duration::from_secs(300);
/// Espera de la conexión de datos (PASV) o del connect (PORT).
const DATA_WAIT: Duration = Duration::from_secs(20);
const MAX_LINE: usize = 1024;
/// Plazo para iniciar sesión. Sin él, 8 conexiones sin credenciales enviando NOOP
/// ocuparían todos los cupos indefinidamente.
const LOGIN_WAIT: Duration = Duration::from_secs(if cfg!(test) { 4 } else { 60 });

#[derive(Serialize, Clone)]
pub struct FtpInfo {
    pub user: String,
    pub pass: String,
    pub port: u16,
    pub write: bool,
}

static INFO: Mutex<Option<FtpInfo>> = Mutex::new(None);

type Events = Arc<dyn Fn(Value) + Send + Sync>;

/// Configuración compartida por las conexiones de un servidor en marcha.
struct Config {
    root: PathBuf,
    user: String,
    pass: String,
    /// Subidas habilitadas: se cambia en caliente con `server_set_write`.
    write: Arc<AtomicBool>,
    flag: Arc<AtomicBool>,
    events: Events,
}

fn random_text(n: usize) -> String {
    // Sin caracteres ambiguos ni los que rompen una URL (@ : /), para dictarla o escribirla.
    const ALPHA: &[u8] = b"abcdefghjkmnpqrstuvwxyz23456789";
    let mut b = vec![0u8; n];
    crate::seal::fill_random(&mut b);
    b.iter().map(|x| ALPHA[*x as usize % ALPHA.len()] as char).collect()
}

fn ct_eq(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

impl Servers {
    pub fn start_ftp(&self, app: tauri::AppHandle, root: PathBuf, port: u16, write: bool) -> Result<FtpInfo, String> {
        fs::create_dir_all(&root).map_err(|e| e.to_string())?;
        self.stop("ftp");
        let listener = bind_tcp(port).map_err(|e| bind_error("FTP", port, e))?;
        listener.set_nonblocking(true).map_err(|e| e.to_string())?;
        let info = FtpInfo { user: "nt".into(), pass: random_text(10), port, write };
        let flag = self.flag("ftp");
        let write = self.write_flag("ftp", write);
        let cfg = Arc::new(Config {
            root,
            user: info.user.clone(),
            pass: info.pass.clone(),
            write,
            flag: flag.clone(),
            events: Arc::new(move |v| {
                let _ = app.emit("transfer", v);
            }),
        });
        *INFO.lock().unwrap() = Some(info.clone());
        std::thread::spawn(move || serve(listener, cfg));
        Ok(info)
    }
}

/// Al reiniciar, el hilo anterior suelta el puerto en hasta ~200 ms.
fn bind_tcp(port: u16) -> std::io::Result<TcpListener> {
    let mut last = None;
    for _ in 0..10 {
        match TcpListener::bind(("0.0.0.0", port)) {
            Ok(l) => return Ok(l),
            Err(e) if e.kind() == std::io::ErrorKind::AddrInUse => {
                last = Some(e);
                std::thread::sleep(Duration::from_millis(150));
            }
            Err(e) => return Err(e),
        }
    }
    Err(last.unwrap())
}

fn serve(listener: TcpListener, cfg: Arc<Config>) {
    let active = Arc::new(AtomicUsize::new(0));
    while cfg.flag.load(Ordering::SeqCst) {
        match listener.accept() {
            Ok((stream, peer)) => {
                let _ = stream.set_nonblocking(false);
                let c = cfg.clone();
                if let Err(mut s) = spawn_limited(&active, MAX_CLIENTS, stream, move |s| session(s, peer, c)) {
                    let _ = s.write_all(b"421 Demasiados clientes, intenta luego\r\n");
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => std::thread::sleep(Duration::from_millis(100)),
            Err(_) => std::thread::sleep(Duration::from_millis(100)),
        }
    }
}

/// Transferencia que se informa a la interfaz (mismo evento "transfer" que TFTP/HTTP).
struct Xfer<'a> {
    id: &'a str,
    file: &'a str,
    dir: &'static str,
}

enum Data {
    None,
    Passive(TcpListener),
    Active(SocketAddr),
}

struct Session {
    ctrl: TcpStream,
    peer: SocketAddr,
    cfg: Arc<Config>,
    cwd: Vec<String>,
    data: Data,
}

impl Session {
    fn reply(&mut self, code: u16, text: &str) -> std::io::Result<()> {
        self.ctrl.write_all(format!("{code} {text}\r\n").as_bytes())
    }

    /// Ruta dentro de la carpeta compartida. None si sale de ella.
    fn resolve(&self, arg: &str) -> Option<(PathBuf, Vec<String>)> {
        let arg = arg.replace('\\', "/");
        let mut parts: Vec<String> = if arg.starts_with('/') { vec![] } else { self.cwd.clone() };
        for comp in arg.split('/') {
            match comp {
                "" | "." => {}
                ".." => {
                    parts.pop()?;
                }
                c if c.contains('\0') || (cfg!(windows) && c.contains(':')) => return None,
                c => parts.push(c.to_string()),
            }
        }
        let mut path = self.cfg.root.clone();
        for p in &parts {
            path.push(p);
        }
        Some((path, parts))
    }

    fn event(&self, x: Xfer, bytes: u64, total: Option<u64>, done: bool, error: Option<String>) {
        let Xfer { id, file, dir } = x;
        (self.cfg.events)(json!({
            "id": id, "proto": "ftp", "client": self.peer.to_string(), "file": file, "dir": dir,
            "bytes": bytes, "total": total, "done": done, "error": error,
        }));
    }

    /// Conexión de datos según el último PASV/EPSV o PORT/EPRT, solo con la IP del cliente.
    fn open_data(&mut self) -> Option<TcpStream> {
        match std::mem::replace(&mut self.data, Data::None) {
            Data::Passive(l) => {
                let deadline = Instant::now() + DATA_WAIT;
                l.set_nonblocking(true).ok()?;
                while Instant::now() < deadline && self.cfg.flag.load(Ordering::SeqCst) {
                    match l.accept() {
                        Ok((s, from)) if from.ip() == self.peer.ip() => {
                            s.set_nonblocking(false).ok()?;
                            return Some(s);
                        }
                        Ok(_) => {} // otra IP intentando robar la conexión de datos
                        Err(_) => std::thread::sleep(Duration::from_millis(50)),
                    }
                }
                None
            }
            Data::Active(addr) => TcpStream::connect_timeout(&addr, DATA_WAIT).ok(),
            Data::None => None,
        }
    }

    fn port_target(&self, ip: IpAddr, port: u16) -> Result<SocketAddr, &'static str> {
        // RFC 2577: el destino debe ser el mismo cliente y no un puerto privilegiado.
        if ip != self.peer.ip() || port < 1024 {
            return Err("Solo se permite la IP del cliente y puertos 1024 o superiores");
        }
        Ok(SocketAddr::new(ip, port))
    }

    fn listing(&mut self, arg: &str, names_only: bool) -> std::io::Result<()> {
        // Opciones estilo "ls -la" que envían algunos clientes.
        let arg = arg.split_whitespace().filter(|a| !a.starts_with('-')).collect::<Vec<_>>().join(" ");
        let Some((path, _)) = self.resolve(&arg) else { return self.reply(550, "Ruta no permitida") };
        if !inside_root(&self.cfg.root, &path) && path != self.cfg.root {
            return self.reply(550, "Ruta no permitida");
        }
        let mut entries: Vec<(String, fs::Metadata)> = if path.is_dir() {
            fs::read_dir(&path).into_iter().flatten().flatten().filter_map(|e| Some((e.file_name().to_string_lossy().into_owned(), e.metadata().ok()?))).collect()
        } else if path.is_file() {
            vec![(path.file_name().unwrap_or_default().to_string_lossy().into_owned(), fs::metadata(&path)?)]
        } else {
            return self.reply(550, "No existe");
        };
        entries.retain(|(n, _)| !n.starts_with('.'));
        entries.sort_by(|a, b| a.0.cmp(&b.0));
        let mut out = String::new();
        for (name, m) in entries {
            if names_only {
                out.push_str(&format!("{name}\r\n"));
            } else {
                let date: chrono::DateTime<chrono::Local> = m.modified().map(Into::into).unwrap_or_else(|_| chrono::Local::now());
                out.push_str(&format!(
                    "{} 1 owner group {:>12} {} {name}\r\n",
                    if m.is_dir() { "drwxr-xr-x" } else { "-rw-r--r--" },
                    m.len(),
                    date.format("%b %d %H:%M")
                ));
            }
        }
        self.reply(150, "Listado")?;
        match self.open_data() {
            Some(mut d) => {
                let _ = d.write_all(out.as_bytes());
                let _ = d.shutdown(Shutdown::Both);
                self.reply(226, "Listado enviado")
            }
            None => self.reply(425, "No se pudo abrir la conexión de datos"),
        }
    }

    fn retr(&mut self, arg: &str) -> std::io::Result<()> {
        let Some((path, parts)) = self.resolve(arg) else { return self.reply(550, "Ruta no permitida") };
        if !path.is_file() || !inside_root(&self.cfg.root, &path) {
            return self.reply(550, "Archivo no encontrado");
        }
        let Ok(mut file) = File::open(&path) else { return self.reply(550, "Acceso denegado") };
        let total = file.metadata().map(|m| m.len()).ok();
        let name = parts.join("/");
        let id = uuid::Uuid::new_v4().to_string();
        self.reply(150, "Enviando archivo")?;
        let Some(mut data) = self.open_data() else {
            self.event(Xfer { id: &id, file: &name, dir: "get" }, 0, total, true, Some("Sin conexión de datos".into()));
            return self.reply(425, "No se pudo abrir la conexión de datos");
        };
        self.event(Xfer { id: &id, file: &name, dir: "get" }, 0, total, false, None);
        let mut buf = vec![0u8; 64 * 1024];
        let mut sent = 0u64;
        let mut last = Instant::now();
        let result = loop {
            if !self.cfg.flag.load(Ordering::SeqCst) {
                break Err("Servidor detenido".to_string());
            }
            match file.read(&mut buf) {
                Ok(0) => break Ok(()),
                Ok(n) => {
                    if let Err(e) = data.write_all(&buf[..n]) {
                        break Err(e.to_string());
                    }
                    sent += n as u64;
                    if last.elapsed() > Duration::from_millis(300) {
                        self.event(Xfer { id: &id, file: &name, dir: "get" }, sent, total, false, None);
                        last = Instant::now();
                    }
                }
                Err(e) => break Err(e.to_string()),
            }
        };
        let _ = data.shutdown(Shutdown::Both);
        self.event(Xfer { id: &id, file: &name, dir: "get" }, sent, total, true, result.clone().err());
        match result {
            Ok(()) => self.reply(226, "Transferencia completa"),
            Err(_) => self.reply(426, "Transferencia interrumpida"),
        }
    }

    fn stor(&mut self, arg: &str) -> std::io::Result<()> {
        if !self.cfg.write.load(Ordering::SeqCst) {
            return self.reply(550, "Servidor de solo lectura: habilita las subidas en NetTerminal");
        }
        let Some((path, parts)) = self.resolve(arg) else { return self.reply(553, "Nombre no permitido") };
        let Some(fname) = parts.last().filter(|n| !n.starts_with('.')).cloned() else { return self.reply(553, "Nombre no permitido") };
        if path.is_dir() || !path.parent().is_some_and(|p| p.is_dir()) || !inside_root(&self.cfg.root, &path) {
            return self.reply(553, "Nombre no permitido");
        }
        let name = parts.join("/");
        let id = uuid::Uuid::new_v4().to_string();
        // Temporal único: dos subidas a la vez no se pisan y un corte no deja un archivo a medias.
        let tmp = path.with_file_name(format!(".{fname}.{}.part", uuid::Uuid::new_v4().simple()));
        let Ok(mut file) = File::create(&tmp) else { return self.reply(553, "No se pudo crear el archivo") };
        self.reply(150, "Recibiendo archivo")?;
        let Some(mut data) = self.open_data() else {
            let _ = fs::remove_file(&tmp);
            self.event(Xfer { id: &id, file: &name, dir: "put" }, 0, None, true, Some("Sin conexión de datos".into()));
            return self.reply(425, "No se pudo abrir la conexión de datos");
        };
        self.event(Xfer { id: &id, file: &name, dir: "put" }, 0, None, false, None);
        let mut buf = vec![0u8; 64 * 1024];
        let mut got = 0u64;
        let mut last = Instant::now();
        let result = loop {
            if !self.cfg.flag.load(Ordering::SeqCst) {
                break Err("Servidor detenido".to_string());
            }
            match data.read(&mut buf) {
                Ok(0) => break Ok(()),
                Ok(n) => {
                    got += n as u64;
                    if got > TFTP_MAX_UPLOAD {
                        break Err("Archivo demasiado grande".to_string());
                    }
                    if let Err(e) = file.write_all(&buf[..n]) {
                        break Err(e.to_string());
                    }
                    if last.elapsed() > Duration::from_millis(300) {
                        self.event(Xfer { id: &id, file: &name, dir: "put" }, got, None, false, None);
                        last = Instant::now();
                    }
                }
                Err(e) => break Err(e.to_string()),
            }
        };
        drop(file);
        let result = result.and_then(|_| fs::rename(&tmp, &path).map_err(|e| e.to_string()));
        if result.is_err() {
            let _ = fs::remove_file(&tmp);
        }
        self.event(Xfer { id: &id, file: &name, dir: "put" }, got, Some(got), true, result.clone().err());
        match result {
            Ok(()) => self.reply(226, "Archivo recibido"),
            Err(_) => self.reply(451, "Transferencia interrumpida"),
        }
    }
}

/// Lee una línea de control acotada. None: conexión cerrada, inactiva o línea excesiva.
fn read_line(r: &mut BufReader<TcpStream>, flag: &AtomicBool, idle: Duration) -> Option<String> {
    let mut line = Vec::new();
    let start = Instant::now();
    loop {
        if !flag.load(Ordering::SeqCst) || start.elapsed() > idle {
            return None;
        }
        let buf = match r.fill_buf() {
            Ok([]) => return None,
            Ok(b) => b,
            Err(e) if matches!(e.kind(), std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut) => continue,
            Err(_) => return None,
        };
        if let Some(i) = buf.iter().position(|b| *b == b'\n') {
            line.extend_from_slice(&buf[..i]);
            r.consume(i + 1);
            break;
        }
        let n = buf.len();
        line.extend_from_slice(buf);
        r.consume(n);
        if line.len() > MAX_LINE {
            return None;
        }
    }
    if line.len() > MAX_LINE {
        return None;
    }
    Some(String::from_utf8_lossy(&line).trim_end_matches('\r').to_string())
}

fn parse_port(arg: &str) -> Option<(IpAddr, u16)> {
    let n: Vec<u8> = arg.split(',').map(|p| p.trim().parse().ok()).collect::<Option<_>>()?;
    if n.len() != 6 {
        return None;
    }
    Some((IpAddr::from([n[0], n[1], n[2], n[3]]), u16::from_be_bytes([n[4], n[5]])))
}

/// EPRT |1|132.235.1.2|6275|
fn parse_eprt(arg: &str) -> Option<(IpAddr, u16)> {
    let d = arg.chars().next()?;
    let parts: Vec<&str> = arg.split(d).collect();
    if parts.len() != 5 || !matches!(parts[1], "1" | "2") {
        return None;
    }
    Some((parts[2].parse().ok()?, parts[3].parse().ok()?))
}

fn session(ctrl: TcpStream, peer: SocketAddr, cfg: Arc<Config>) {
    let _ = ctrl.set_read_timeout(Some(Duration::from_secs(1)));
    let _ = ctrl.set_write_timeout(Some(Duration::from_secs(30)));
    let Ok(read) = ctrl.try_clone() else { return };
    let mut reader = BufReader::new(read);
    let local_ip = ctrl.local_addr().map(|a| a.ip()).ok();
    let mut s = Session { ctrl, peer, cfg: cfg.clone(), cwd: vec![], data: Data::None };
    let mut user_ok = false;
    let mut authed = false;
    let mut fails = 0;
    if s.reply(220, "NetTerminal FTP").is_err() {
        return;
    }
    let started = Instant::now();
    loop {
        let idle = if authed { IDLE } else { LOGIN_WAIT.saturating_sub(started.elapsed()) };
        let Some(line) = read_line(&mut reader, &cfg.flag, idle) else {
            if !authed {
                let _ = s.reply(421, "Tiempo de inicio de sesión agotado");
            }
            break;
        };
        let (cmd, arg) = line.split_once(' ').map(|(c, a)| (c.to_ascii_uppercase(), a.to_string())).unwrap_or((line.to_ascii_uppercase(), String::new()));
        let r = match cmd.as_str() {
            "USER" => {
                user_ok = ct_eq(arg.trim().as_bytes(), cfg.user.as_bytes());
                authed = false;
                s.reply(331, "Contraseña")
            }
            "PASS" => {
                if user_ok && ct_eq(arg.as_bytes(), cfg.pass.as_bytes()) {
                    authed = true;
                    s.reply(230, "Sesión iniciada")
                } else {
                    fails += 1;
                    (cfg.events)(json!({
                        "id": uuid::Uuid::new_v4().to_string(), "proto": "ftp", "client": peer.to_string(),
                        "file": "(inicio de sesión)", "dir": "get", "bytes": 0, "total": null, "done": true,
                        "error": "Usuario o contraseña FTP incorrectos",
                    }));
                    std::thread::sleep(Duration::from_secs(1));
                    if fails >= MAX_LOGIN_FAILS {
                        let _ = s.reply(421, "Demasiados intentos");
                        break;
                    }
                    s.reply(530, "Usuario o contraseña incorrectos")
                }
            }
            "QUIT" => {
                let _ = s.reply(221, "Adiós");
                break;
            }
            "SYST" => s.reply(215, "UNIX Type: L8"),
            "NOOP" => s.reply(200, "OK"),
            "FEAT" => s.ctrl.write_all(b"211-Extensiones\r\n EPSV\r\n EPRT\r\n PASV\r\n SIZE\r\n MDTM\r\n UTF8\r\n211 Fin\r\n"),
            "OPTS" => s.reply(200, "OK"),
            "AUTH" => s.reply(502, "TLS no disponible: este servidor FTP no cifra"),
            _ if !authed => s.reply(530, "Inicia sesión primero"),
            "TYPE" | "MODE" | "STRU" | "ALLO" => s.reply(200, "OK"),
            "PWD" | "XPWD" => s.reply(257, &format!("\"/{}\"", s.cwd.join("/"))),
            "CWD" | "XCWD" => match s.resolve(&arg) {
                Some((p, parts)) if p.is_dir() && (parts.is_empty() || inside_root(&cfg.root, &p)) => {
                    s.cwd = parts;
                    s.reply(250, "OK")
                }
                _ => s.reply(550, "Carpeta no encontrada"),
            },
            "CDUP" | "XCUP" => {
                s.cwd.pop();
                s.reply(250, "OK")
            }
            "PASV" | "EPSV" => {
                let ip = local_ip.unwrap_or(IpAddr::from([0, 0, 0, 0]));
                match TcpListener::bind((ip, 0)).and_then(|l| Ok((l.local_addr()?.port(), l))) {
                    Ok((port, l)) => {
                        s.data = Data::Passive(l);
                        match (cmd.as_str(), ip) {
                            ("PASV", IpAddr::V4(v4)) => {
                                let o = v4.octets();
                                s.reply(227, &format!("Modo pasivo ({},{},{},{},{},{})", o[0], o[1], o[2], o[3], port >> 8, port & 0xFF))
                            }
                            ("PASV", _) => s.reply(522, "Usa EPSV en IPv6"),
                            _ => s.reply(229, &format!("Modo pasivo extendido (|||{port}|)")),
                        }
                    }
                    Err(_) => s.reply(425, "No se pudo abrir un puerto de datos"),
                }
            }
            "PORT" | "EPRT" => match if cmd == "PORT" { parse_port(&arg) } else { parse_eprt(&arg) } {
                Some((ip, port)) => match s.port_target(ip, port) {
                    Ok(addr) => {
                        s.data = Data::Active(addr);
                        s.reply(200, "OK")
                    }
                    Err(e) => s.reply(504, e),
                },
                None => s.reply(501, "Parámetros inválidos"),
            },
            "LIST" => s.listing(&arg, false),
            "NLST" => s.listing(&arg, true),
            "RETR" => s.retr(&arg),
            "STOR" => s.stor(&arg),
            "SIZE" => match s.resolve(&arg) {
                Some((p, _)) if p.is_file() && inside_root(&cfg.root, &p) => {
                    let n = fs::metadata(&p).map(|m| m.len()).unwrap_or(0);
                    s.reply(213, &n.to_string())
                }
                _ => s.reply(550, "Archivo no encontrado"),
            },
            "MDTM" => match s.resolve(&arg) {
                Some((p, _)) if p.is_file() && inside_root(&cfg.root, &p) => {
                    let t: chrono::DateTime<chrono::Utc> = fs::metadata(&p).and_then(|m| m.modified()).map(Into::into).unwrap_or_else(|_| chrono::Utc::now());
                    s.reply(213, &t.format("%Y%m%d%H%M%S").to_string())
                }
                _ => s.reply(550, "Archivo no encontrado"),
            },
            "ABOR" => s.reply(226, "OK"),
            "DELE" | "RMD" | "XRMD" | "MKD" | "XMKD" | "RNFR" | "RNTO" | "SITE" | "APPE" | "STOU" | "REST" => s.reply(502, "No permitido en este servidor"),
            _ => s.reply(502, "Comando no soportado"),
        };
        if r.is_err() {
            break;
        }
    }
    let _ = s.ctrl.shutdown(Shutdown::Both);
}

// ---------- Comandos ----------

/// Inicia (o reinicia con credenciales nuevas) el servidor FTP de la carpeta compartida.
#[tauri::command(async)]
pub fn ftp_server_start(port: u16, allow_write: bool, app: tauri::AppHandle) -> Result<FtpInfo, String> {
    let state = app.state::<crate::AppState>();
    let root = state.data_dir.join("tftp");
    state.servers.start_ftp(app.clone(), root, port, allow_write)
}

/// Credenciales del servidor en marcha (para armar los comandos copy ftp:).
#[tauri::command]
pub fn ftp_server_info(state: tauri::State<'_, crate::AppState>) -> Option<FtpInfo> {
    let Some(write) = state.servers.write_allowed("ftp") else {
        *INFO.lock().unwrap() = None;
        return None;
    };
    INFO.lock().unwrap().clone().map(|i| FtpInfo { write, ..i })
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Ftp {
        ctrl: TcpStream,
        r: BufReader<TcpStream>,
    }

    impl Ftp {
        fn connect(addr: SocketAddr) -> Ftp {
            let ctrl = TcpStream::connect(addr).unwrap();
            ctrl.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
            let r = BufReader::new(ctrl.try_clone().unwrap());
            let mut f = Ftp { ctrl, r };
            assert!(f.line().starts_with("220"));
            f
        }
        fn line(&mut self) -> String {
            let mut l = String::new();
            self.r.read_line(&mut l).unwrap();
            l
        }
        fn cmd(&mut self, c: &str) -> String {
            self.ctrl.write_all(format!("{c}\r\n").as_bytes()).unwrap();
            self.line()
        }
        fn pasv(&mut self) -> TcpStream {
            let r = self.cmd("EPSV");
            assert!(r.starts_with("229"), "{r}");
            let port: u16 = r.split("|||").nth(1).unwrap().split('|').next().unwrap().parse().unwrap();
            TcpStream::connect(("127.0.0.1", port)).unwrap()
        }
    }

    fn server(write: bool) -> (SocketAddr, PathBuf, Arc<AtomicBool>, Arc<Mutex<Vec<Value>>>) {
        let root = std::env::temp_dir().join(format!("nt-ftp-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(root.join("sub")).unwrap();
        fs::write(root.join("fw.bin"), vec![7u8; 200_000]).unwrap();
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let addr = listener.local_addr().unwrap();
        let flag = Arc::new(AtomicBool::new(true));
        let events: Arc<Mutex<Vec<Value>>> = Arc::default();
        let ev = events.clone();
        let cfg = Arc::new(Config {
            root: root.clone(),
            user: "nt".into(),
            pass: "clave".into(),
            write: Arc::new(AtomicBool::new(write)),
            flag: flag.clone(),
            events: Arc::new(move |v| ev.lock().unwrap().push(v)),
        });
        std::thread::spawn(move || serve(listener, cfg));
        (addr, root, flag, events)
    }

    #[test]
    fn ftp_login_retr_list_and_read_only() {
        let (addr, root, flag, events) = server(false);
        let mut f = Ftp::connect(addr);
        assert!(f.cmd("RETR fw.bin").starts_with("530"));
        assert!(f.cmd("USER nt").starts_with("331"));
        assert!(f.cmd("PASS mala").starts_with("530"));
        assert!(events.lock().unwrap().iter().any(|e| e["error"].as_str().unwrap_or("").contains("incorrectos")));
        f.cmd("USER nt");
        assert!(f.cmd("PASS clave").starts_with("230"));
        assert!(f.cmd("TYPE I").starts_with("200"));
        assert!(f.cmd("SIZE fw.bin").starts_with("213 200000"));

        let mut d = f.pasv();
        assert!(f.cmd("RETR fw.bin").starts_with("150"));
        let mut got = Vec::new();
        d.read_to_end(&mut got).unwrap();
        assert!(f.line().starts_with("226"));
        assert_eq!(got.len(), 200_000);

        let mut d = f.pasv();
        assert!(f.cmd("NLST").starts_with("150"));
        let mut list = String::new();
        d.read_to_string(&mut list).unwrap();
        assert!(f.line().starts_with("226"));
        assert!(list.contains("fw.bin") && list.contains("sub"));

        // Fuera de la carpeta, subidas en solo lectura y PORT hacia otra IP.
        assert!(f.cmd("RETR ../../etc/passwd").starts_with("550"));
        assert!(f.cmd("CWD ..").starts_with("550"));
        assert!(f.cmd("CWD sub").starts_with("250"));
        assert!(f.cmd("PWD").contains("/sub"));
        // "../fw.bin" desde sub/ sigue dentro de la carpeta; sin PASV previo no hay datos.
        assert!(f.cmd("RETR ../fw.bin").starts_with("150"));
        assert!(f.line().starts_with("425"));
        assert!(f.cmd("STOR x.cfg").starts_with("550"));
        assert!(f.cmd("PORT 10,9,9,9,40,1").starts_with("504"));
        assert!(f.cmd("PORT 127,0,0,1,0,22").starts_with("504"));
        assert!(f.cmd("DELE fw.bin").starts_with("502"));
        assert!(f.cmd("QUIT").starts_with("221"));
        flag.store(false, Ordering::SeqCst);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn ftp_upload_when_enabled() {
        let (addr, root, flag, events) = server(true);
        let mut f = Ftp::connect(addr);
        f.cmd("USER nt");
        f.cmd("PASS clave");
        let mut d = f.pasv();
        assert!(f.cmd("STOR respaldo.cfg").starts_with("150"));
        d.write_all(b"hostname sw1\n").unwrap();
        drop(d);
        assert!(f.line().starts_with("226"));
        assert_eq!(fs::read(root.join("respaldo.cfg")).unwrap(), b"hostname sw1\n");
        // Sin temporales a la vista ni nombres ocultos.
        assert!(f.cmd("STOR .oculto").starts_with("553"));
        assert!(f.cmd("STOR ../fuera.cfg").starts_with("553"));
        assert!(fs::read_dir(&root).unwrap().flatten().all(|e| !e.file_name().to_string_lossy().ends_with(".part")));
        assert!(events.lock().unwrap().iter().any(|e| e["dir"] == "put" && e["done"] == true && e["error"].is_null()));
        flag.store(false, Ordering::SeqCst);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn ftp_write_toggles_live_without_restart() {
        // Mismo esquema que `server`, pero con acceso a la bandera de escritura.
        let root = std::env::temp_dir().join(format!("nt-ftp-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let addr = listener.local_addr().unwrap();
        let flag = Arc::new(AtomicBool::new(true));
        let write = Arc::new(AtomicBool::new(false));
        let cfg = Arc::new(Config { root: root.clone(), user: "nt".into(), pass: "clave".into(), write: write.clone(), flag: flag.clone(), events: Arc::new(|_| {}) });
        std::thread::spawn(move || serve(listener, cfg));
        let mut f = Ftp::connect(addr);
        f.cmd("USER nt");
        assert!(f.cmd("PASS clave").starts_with("230"));
        assert!(f.cmd("STOR a.cfg").starts_with("550"), "solo lectura");
        // La misma sesión (mismas credenciales) acepta la subida en cuanto se habilita.
        write.store(true, Ordering::SeqCst);
        let mut d = f.pasv();
        assert!(f.cmd("STOR a.cfg").starts_with("150"));
        d.write_all(b"x").unwrap();
        drop(d);
        assert!(f.line().starts_with("226"));
        write.store(false, Ordering::SeqCst);
        assert!(f.cmd("STOR b.cfg").starts_with("550"));
        flag.store(false, Ordering::SeqCst);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn interop_with_ftp_client() {
        use crate::ftpclient::{open, parse_entries, FtpParams};
        let (addr, root, flag, _) = server(true);
        let params = |pass: &str, tls: bool| FtpParams {
            host: "127.0.0.1".into(),
            port: Some(addr.port()),
            user: "nt".into(),
            pass: pass.into(),
            tls,
            path: Some("/".into()),
        };
        let mut ftp = open(&params("clave", false)).unwrap();
        let list = parse_entries(&crate::ftpclient::list_bounded(&mut ftp).unwrap());
        assert!(list.iter().any(|e| e.name == "fw.bin" && e.size == 200_000));
        let mut s = ftp.retr_as_stream("fw.bin").unwrap();
        let mut got = Vec::new();
        s.read_to_end(&mut got).unwrap();
        s.finish().unwrap();
        assert_eq!(got.len(), 200_000);
        let mut up = ftp.put_with_stream("nuevo.cfg").unwrap();
        up.write_all(b"interface Gi0/1\n").unwrap();
        up.finish().unwrap();
        assert_eq!(fs::read(root.join("nuevo.cfg")).unwrap(), b"interface Gi0/1\n");
        // Contraseña incorrecta y FTPS contra un servidor sin TLS: errores claros.
        assert!(open(&params("mala", false)).err().unwrap().contains("incorrectos"));
        assert!(open(&params("clave", true)).err().unwrap().contains("FTPS"));
        flag.store(false, Ordering::SeqCst);
        fs::remove_dir_all(root).unwrap();
    }

    /// Servidor real para probar con otro cliente (curl, un equipo de laboratorio):
    /// `NT_FTP_LAB=2121 cargo test -- --ignored ftp_lab` sirve 30 s con usuario nt / clave.
    #[test]
    #[ignore]
    fn ftp_lab_serve() {
        let port: u16 = std::env::var("NT_FTP_LAB").expect("NT_FTP_LAB").parse().unwrap();
        let root = std::env::temp_dir().join("nt-ftp-lab");
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("fw.bin"), vec![7u8; 1_000_000]).unwrap();
        let listener = TcpListener::bind(("127.0.0.1", port)).unwrap();
        listener.set_nonblocking(true).unwrap();
        let flag = Arc::new(AtomicBool::new(true));
        let cfg = Arc::new(Config { root, user: "nt".into(), pass: "clave".into(), write: Arc::new(AtomicBool::new(true)), flag: flag.clone(), events: Arc::new(|_| {}) });
        std::thread::spawn(move || serve(listener, cfg));
        std::thread::sleep(Duration::from_secs(30));
        flag.store(false, Ordering::SeqCst);
    }

    #[test]
    fn ftp_rejects_hostile_paths_and_input() {
        let (addr, root, flag, _) = server(true);
        let mut f = Ftp::connect(addr);
        f.cmd("USER nt");
        assert!(f.cmd("PASS clave").starts_with("230"));
        for p in [
            "../../../../etc/passwd",
            "/../../etc/passwd",
            "..\\..\\etc\\passwd",
            "sub/../../fw.bin",
            "/etc/passwd",
            "C:/Windows/win.ini",
            "fw.bin\0x",
            "./././../fw.bin",
        ] {
            assert!(f.cmd(&format!("SIZE {p}")).starts_with("550"), "{p}");
            assert!(f.cmd(&format!("CWD {p}")).starts_with("550"), "{p}");
            assert!(f.cmd(&format!("MDTM {p}")).starts_with("550"), "{p}");
        }
        assert!(f.cmd("STOR ../../fuera.cfg").starts_with("553"));
        assert!(f.cmd("STOR /../fuera.cfg").starts_with("553"));
        // Un enlace simbólico dentro de la carpeta no da acceso a lo que está fuera.
        #[cfg(unix)]
        {
            let outside = root.with_extension("fuera");
            fs::create_dir_all(&outside).unwrap();
            fs::write(outside.join("secreto.txt"), b"x").unwrap();
            std::os::unix::fs::symlink(&outside, root.join("enlace")).unwrap();
            assert!(f.cmd("SIZE enlace/secreto.txt").starts_with("550"));
            assert!(f.cmd("RETR enlace/secreto.txt").starts_with("550"));
            assert!(f.cmd("CWD enlace").starts_with("550"));
            assert!(f.cmd("STOR enlace/nuevo.cfg").starts_with("553"));
            assert!(!outside.join("nuevo.cfg").exists());
            fs::remove_dir_all(&outside).unwrap();
        }
        // Basura aleatoria en el canal de control: el servidor sigue respondiendo.
        let mut rng = crate::snmp::tests::Rng(0x5EED_F00D_CAFE_0001);
        let mut junk = Vec::new();
        for _ in 0..300 {
            let n = rng.below(80);
            let line: Vec<u8> = (0..n).map(|_| (rng.next() as u8).max(0x20)).filter(|b| *b != b'\r' && *b != b'\n' && *b != 0x7F).collect();
            // Sin QUIT ni PASS (cerraría o contaría intentos fallidos).
            if !line.to_ascii_uppercase().starts_with(b"QUI") && !line.to_ascii_uppercase().starts_with(b"PAS") {
                junk.extend(line);
                junk.extend(b"\r\n");
            }
        }
        f.ctrl.write_all(&junk).unwrap();
        f.ctrl.write_all(b"NOOP\r\nSYST\r\n").unwrap();
        let mut alive = false;
        for _ in 0..2000 {
            if f.line().starts_with("215 ") {
                alive = true;
                break;
            }
        }
        assert!(alive);
        // Línea de control excesiva: se corta la conexión.
        let _ = f.ctrl.write_all(&vec![b'A'; 20_000]);
        let _ = f.ctrl.write_all(b"\r\n");
        let mut rest = Vec::new();
        let _ = f.r.read_to_end(&mut rest);
        flag.store(false, Ordering::SeqCst);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn ftp_closes_idle_unauthenticated_clients() {
        let (addr, root, flag, _) = server(false);
        let mut f = Ftp::connect(addr);
        let t = Instant::now();
        // Sin credenciales, ni siquiera NOOP mantiene la conexión más allá de LOGIN_WAIT.
        while t.elapsed() < LOGIN_WAIT + Duration::from_secs(3) {
            if f.ctrl.write_all(b"NOOP\r\n").is_err() {
                break;
            }
            let mut l = String::new();
            if f.r.read_line(&mut l).is_err() || l.is_empty() || l.starts_with("421") {
                break;
            }
            std::thread::sleep(Duration::from_millis(500));
        }
        assert!(t.elapsed() < LOGIN_WAIT + Duration::from_secs(3));
        flag.store(false, Ordering::SeqCst);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn parses_port_commands() {
        assert_eq!(parse_port("192,0,2,1,4,1"), Some((IpAddr::from([192, 0, 2, 1]), 1025)));
        assert_eq!(parse_port("192,0,2,1,4"), None);
        assert_eq!(parse_port("300,0,2,1,4,1"), None);
        assert_eq!(parse_eprt("|1|192.0.2.1|6275|"), Some((IpAddr::from([192, 0, 2, 1]), 6275)));
        assert_eq!(parse_eprt("|2|::1|6275|"), Some(("::1".parse().unwrap(), 6275)));
        assert_eq!(parse_eprt("|3|x|1|"), None);
        let mut rng = crate::snmp::tests::Rng(0xABCD_EF01_2345_6789);
        let alphabet = ['|', ',', '1', '9', '2', '5', ':', '.', 'é', ' ', '-', '0'];
        for _ in 0..20_000 {
            let s: String = (0..rng.below(24)).map(|_| alphabet[rng.below(alphabet.len())]).collect();
            let _ = (parse_port(&s), parse_eprt(&s));
        }
        let pass = random_text(10);
        assert_eq!(pass.len(), 10);
        assert!(pass.chars().all(|c| c.is_ascii_alphanumeric() && !"lo01".contains(c)));
    }
}
