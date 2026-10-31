//! Cliente FTP/FTPS para traer o dejar firmware y configuraciones en un servidor FTP
//! (repositorio corporativo, servidor de laboratorio). Trabaja sobre la carpeta compartida.
//!
//! FTPS explícito (AUTH TLS, RFC 4217) con el rustls de la app y los certificados del
//! sistema (sirve con CA corporativas). No hay opción para aceptar certificados inválidos.
//! En FTP sin TLS la interfaz advierte que todo, contraseña incluida, viaja en claro.
//! Modo pasivo con la IP del canal de control: el servidor no puede redirigir la conexión
//! de datos a otro destino.

use crate::nettools::emit;
use crate::servers::safe_path;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream, ToSocketAddrs};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use suppaftp::types::FileType;
use suppaftp::{FtpError, Mode, RustlsConnector, RustlsFtpStream};
use tauri::{AppHandle, Emitter, Manager};


const CONNECT: Duration = Duration::from_secs(15);
const IO: Duration = Duration::from_secs(60);
/// Entradas por listado: una carpeta enorme no debe bloquear la interfaz.
const MAX_LIST: usize = 5000;
/// Bytes por listado: `list()` de suppaftp acumula sin límite y un servidor hostil podría
/// enviar un listado infinito hasta agotar la memoria.
const MAX_LIST_BYTES: u64 = 4 * 1024 * 1024;

#[derive(Deserialize)]
pub struct FtpParams {
    pub host: String,
    pub port: Option<u16>,
    pub user: String,
    pub pass: String,
    /// true: FTPS explícito (AUTH TLS). false: FTP en claro.
    pub tls: bool,
    /// Carpeta remota (vacía: la de inicio).
    pub path: Option<String>,
}

/// La contraseña se borra de memoria al terminar la operación.
impl Drop for FtpParams {
    fn drop(&mut self) {
        use zeroize::Zeroize;
        self.pass.zeroize();
    }
}

#[derive(Serialize)]
pub struct Entry {
    pub(crate) name: String,
    pub(crate) size: u64,
    pub(crate) dir: bool,
    pub(crate) date: String,
}

#[derive(Serialize)]
pub struct Listing {
    cwd: String,
    entries: Vec<Entry>,
    tls: bool,
}

fn check_host(h: &str) -> Result<String, String> {
    let h = h.trim();
    if h.is_empty() || h.len() > 253 || h.starts_with('-') || !h.chars().all(|c| c.is_ascii_alphanumeric() || ".-:_[]".contains(c)) {
        return Err("Host inválido".into());
    }
    Ok(h.trim_start_matches('[').trim_end_matches(']').to_string())
}

/// Nombre o ruta remota sin saltos de línea (inyección de comandos FTP).
fn check_remote(p: &str) -> Result<(), String> {
    if p.len() > 1024 || p.chars().any(|c| c.is_control()) {
        return Err("Ruta remota inválida".into());
    }
    Ok(())
}

fn err_text(e: FtpError) -> String {
    match e {
        FtpError::ConnectionError(e) => format!("Error de conexión: {e}"),
        FtpError::SecureError(e) => format!("TLS: {e}. El servidor debe tener un certificado válido para este nombre o IP."),
        FtpError::UnexpectedResponse(r) => {
            let body = String::from_utf8_lossy(&r.body).trim().chars().take(300).collect::<String>();
            match r.status.code() {
                530 => format!("Usuario o contraseña incorrectos ({body})"),
                534 | 431 | 502 | 504 if body.to_ascii_uppercase().contains("AUTH") || body.contains("TLS") => {
                    format!("El servidor no ofrece FTPS ({body})")
                }
                _ => format!("El servidor respondió: {body}"),
            }
        }
        other => other.to_string(),
    }
}

fn tls_connector() -> Result<RustlsConnector, String> {
    use rustls_platform_verifier::ConfigVerifierExt;
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
    let cfg = rustls::ClientConfig::with_platform_verifier().map_err(|e| e.to_string())?;
    Ok(RustlsConnector::from(Arc::new(cfg)))
}

/// Conecta, negocia TLS si corresponde, inicia sesión y entra en la carpeta pedida.
pub(crate) fn open(p: &FtpParams) -> Result<RustlsFtpStream, String> {
    let host = check_host(&p.host)?;
    let port = p.port.filter(|p| *p != 0).unwrap_or(21);
    if p.user.is_empty() || p.user.len() > 128 || p.user.chars().any(|c| c.is_control()) {
        return Err("Usuario inválido".into());
    }
    if p.pass.len() > 256 || p.pass.chars().any(|c| c.is_control()) {
        return Err("Contraseña inválida".into());
    }
    let addr: SocketAddr = (host.as_str(), port)
        .to_socket_addrs()
        .map_err(|e| format!("No se pudo resolver {host}: {e}"))?
        .next()
        .ok_or_else(|| format!("No se pudo resolver {host}"))?;
    let mut ftp = RustlsFtpStream::connect_timeout(addr, CONNECT).map_err(err_text)?;
    ftp.get_ref().set_read_timeout(Some(IO)).ok();
    ftp.get_ref().set_write_timeout(Some(IO)).ok();
    // Pasivo con la IP del canal de control (ignora la IP que anuncie el servidor).
    ftp.set_mode(Mode::Passive);
    ftp.set_passive_nat_workaround(true);
    ftp = ftp.passive_stream_builder(|addr| {
        let s = TcpStream::connect_timeout(&addr, CONNECT).map_err(FtpError::ConnectionError)?;
        s.set_read_timeout(Some(IO)).ok();
        s.set_write_timeout(Some(IO)).ok();
        Ok(s)
    });
    if p.tls {
        ftp = ftp.into_secure(tls_connector()?, &host).map_err(err_text)?;
    }
    let user = if p.user.trim().is_empty() { "anonymous" } else { p.user.trim() };
    ftp.login(user, p.pass.as_str()).map_err(err_text)?;
    ftp.transfer_type(FileType::Binary).map_err(err_text)?;
    if let Some(path) = p.path.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        check_remote(path)?;
        ftp.cwd(path).map_err(err_text)?;
    }
    Ok(ftp)
}

/// LIST con tope de bytes. Lo que exceda MAX_LIST_BYTES se descarta con ABOR.
pub(crate) fn list_bounded(ftp: &mut RustlsFtpStream) -> Result<Vec<String>, String> {
    use suppaftp::Status;
    let (_, mut stream) = ftp.custom_data_command("LIST", &[Status::AboutToSend, Status::AlreadyOpen]).map_err(err_text)?;
    let mut buf = Vec::new();
    let read = (&mut stream).take(MAX_LIST_BYTES + 1).read_to_end(&mut buf);
    if read.is_err() || buf.len() as u64 > MAX_LIST_BYTES {
        let _ = ftp.abort(stream);
        return Err(match read {
            Err(e) => format!("Error de conexión: {e}"),
            Ok(_) => "El listado del servidor es demasiado grande".into(),
        });
    }
    stream.finish().map_err(err_text)?;
    Ok(split_lines(&buf))
}

/// Líneas no vacías del listado, sin el CR final.
fn split_lines(buf: &[u8]) -> Vec<String> {
    String::from_utf8_lossy(buf).lines().map(|l| l.trim_end_matches('\r')).filter(|l| !l.is_empty()).map(str::to_owned).collect()
}

pub(crate) fn parse_entries(lines: &[String]) -> Vec<Entry> {
    lines
        .iter()
        .take(MAX_LIST)
        .filter_map(|l| suppaftp::list::File::try_from(l.as_str()).ok())
        .filter(|f| f.name() != "." && f.name() != "..")
        .map(|f| Entry {
            name: f.name().to_string(),
            size: f.size() as u64,
            dir: f.is_directory(),
            date: chrono::DateTime::<chrono::Local>::from(f.modified()).format("%Y-%m-%d %H:%M").to_string(),
        })
        .collect()
}

#[tauri::command(async)]
pub fn ftp_list(params: FtpParams) -> Result<Listing, String> {
    let mut ftp = open(&params)?;
    let cwd = ftp.pwd().unwrap_or_default();
    let mut entries = parse_entries(&list_bounded(&mut ftp)?);
    entries.sort_by(|a, b| b.dir.cmp(&a.dir).then(a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    let _ = ftp.quit();
    Ok(Listing { cwd, entries, tls: params.tls })
}

/// Progreso en el mismo evento "transfer" que TFTP/HTTP (lista de transferencias).
struct Ev<'a> {
    app: &'a AppHandle,
    id: &'a str,
    host: &'a str,
    file: &'a str,
    dir: &'static str,
}

impl Ev<'_> {
    fn send(&self, bytes: u64, total: Option<u64>, error: Option<String>, done: bool) {
        let _ = self.app.emit(
            "transfer",
            json!({ "id": self.id, "proto": "ftp", "client": self.host, "file": self.file, "dir": self.dir, "bytes": bytes, "total": total, "done": done, "error": error }),
        );
    }
}

/// Copia con progreso y cancelación.
fn pump(r: &mut dyn Read, w: &mut dyn Write, cancel: &AtomicBool, mut progress: impl FnMut(u64)) -> Result<u64, String> {
    let mut buf = vec![0u8; 64 * 1024];
    let mut n = 0u64;
    let mut last = Instant::now();
    loop {
        if cancel.load(Ordering::SeqCst) {
            return Err("Cancelado".into());
        }
        let k = r.read(&mut buf).map_err(|e| e.to_string())?;
        if k == 0 {
            return Ok(n);
        }
        w.write_all(&buf[..k]).map_err(|e| e.to_string())?;
        n += k as u64;
        if last.elapsed() > Duration::from_millis(300) {
            progress(n);
            last = Instant::now();
        }
    }
}

/// Descarga un archivo del servidor a la carpeta compartida (job cancelable con tool_stop).
#[tauri::command(async)]
pub fn ftp_get(params: FtpParams, name: String, app: AppHandle) -> Result<String, String> {
    check_remote(&name)?;
    let base = Path::new(&name.replace('\\', "/")).file_name().map(|f| f.to_string_lossy().into_owned()).ok_or("Nombre inválido")?;
    let root = app.state::<crate::AppState>().data_dir.join("tftp");
    std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    let dest = safe_path(&root, &base).filter(|_| !base.starts_with('.')).ok_or("Nombre inválido")?;
    let (job, cancel, finish) = app.state::<crate::AppState>().jobs.cancelable();
    let id = job.clone();
    std::thread::spawn(move || {
        let host = params.host.clone();
        let ev = Ev { app: &app, id: &id, host: &host, file: &base, dir: "get" };
        let tmp = dest.with_file_name(format!(".{base}.{}.part", uuid::Uuid::new_v4().simple()));
        let res = (|| -> Result<u64, String> {
            let mut ftp = open(&params)?;
            let total = ftp.size(&name).ok().map(|n| n as u64);
            ev.send(0, total, None, false);
            let mut file = std::fs::File::create(&tmp).map_err(|e| e.to_string())?;
            let mut stream = ftp.retr_as_stream(&name).map_err(err_text)?;
            let n = pump(&mut stream, &mut file, &cancel, |n| ev.send(n, total, None, false));
            match n {
                Ok(n) => {
                    stream.finish().map_err(err_text)?;
                    let _ = ftp.quit();
                    drop(file);
                    std::fs::rename(&tmp, &dest).map_err(|e| e.to_string())?;
                    Ok(n)
                }
                Err(e) => {
                    let _ = ftp.abort(stream);
                    Err(e)
                }
            }
        })();
        match res {
            Ok(n) => ev.send(n, Some(n), None, true),
            Err(e) => {
                let _ = std::fs::remove_file(&tmp);
                ev.send(0, None, Some(e.clone()), true);
                emit(&app, &id, "error", e, None);
            }
        }
        finish();
        emit(&app, &id, "done", String::new(), None);
    });
    Ok(job)
}

/// Sube un archivo de la carpeta compartida al servidor (job cancelable con tool_stop).
#[tauri::command(async)]
pub fn ftp_put(params: FtpParams, name: String, app: AppHandle) -> Result<String, String> {
    let root = app.state::<crate::AppState>().data_dir.join("tftp");
    let src = safe_path(&root, &name).filter(|p| p.is_file()).ok_or_else(|| format!("No existe {name} en la carpeta compartida"))?;
    let base = src.file_name().map(|f| f.to_string_lossy().into_owned()).ok_or("Nombre inválido")?;
    check_remote(&base)?;
    let (job, cancel, finish) = app.state::<crate::AppState>().jobs.cancelable();
    let id = job.clone();
    std::thread::spawn(move || {
        let host = params.host.clone();
        let ev = Ev { app: &app, id: &id, host: &host, file: &base, dir: "put" };
        let res = (|| -> Result<u64, String> {
            let mut file = std::fs::File::open(&src).map_err(|e| e.to_string())?;
            let total = file.metadata().map(|m| m.len()).ok();
            let mut ftp = open(&params)?;
            ev.send(0, total, None, false);
            let mut stream = ftp.put_with_stream(&base).map_err(err_text)?;
            match pump(&mut file, &mut stream, &cancel, |n| ev.send(n, total, None, false)) {
                Ok(n) => {
                    stream.finish().map_err(err_text)?;
                    let _ = ftp.quit();
                    Ok(n)
                }
                Err(e) => {
                    let _ = ftp.abort(stream);
                    Err(e)
                }
            }
        })();
        match res {
            Ok(n) => ev.send(n, Some(n), None, true),
            Err(e) => {
                ev.send(0, None, Some(e.clone()), true);
                emit(&app, &id, "error", e, None);
            }
        }
        finish();
        emit(&app, &id, "done", String::new(), None);
    });
    Ok(job)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_inputs() {
        assert!(check_host("ftp.example.com").is_ok());
        assert!(check_host("-oX").is_err());
        assert!(check_host("a b").is_err());
        assert!(check_remote("firmware/ios.bin").is_ok());
        assert!(check_remote("x\r\nDELE y").is_err());
    }

    #[test]
    fn parses_unix_and_dos_listings() {
        let lines = vec![
            "-rw-r--r-- 1 ftp ftp 33591768 Mar 01 2024 c2960.bin".to_string(),
            "drwxr-xr-x 2 ftp ftp 4096 Jan 10 10:00 configs".to_string(),
            "10-02-23  09:14AM               1024 respaldo.cfg".to_string(),
        ];
        let e = parse_entries(&lines);
        assert_eq!(e.len(), 3);
        assert_eq!((e[0].name.as_str(), e[0].size, e[0].dir), ("c2960.bin", 33591768, false));
        assert!(e[1].dir);
        assert_eq!(e[2].name, "respaldo.cfg");
    }

    #[test]
    fn fuzz_listing_parser_from_hostile_server() {
        assert_eq!(split_lines(b"a\r\n\r\nb\n\xff"), vec!["a", "b", "\u{fffd}"]);
        let mut rng = crate::snmp::tests::Rng(0x1357_9BDF_2468_ACE0);
        let words = ["-rw-r--r--", "drwxr-xr-x", "lrwxrwxrwx", "1", "ftp", "99999999999999999999", "-1", "Feb", "31", "29", "1969", "99999", "25:61", "10-02-23", "09:14AM", "<DIR>", "->", "é", " ", "\t"];
        for _ in 0..20_000 {
            let n = rng.below(12);
            let line: String = (0..n).map(|_| words[rng.below(words.len())]).collect::<Vec<_>>().join(" ");
            let _ = parse_entries(&[line]);
            let n = rng.below(64);
            let raw = rng.bytes(n);
            let _ = parse_entries(&split_lines(&raw));
        }
    }
}
