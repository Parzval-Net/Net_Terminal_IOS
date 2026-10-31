//! Cliente SSH nativo (russh) para iOS, donde el sandbox no permite lanzar el binario ssh.
//! Encaja en el mismo modelo que la PTY de connection.rs: la salida va al `Sink`, lo tecleado
//! llega por un `Write` (hilo de escritura de siempre) y el tamaño de la terminal se informa
//! con window-change. Los pedidos de usuario, contraseña, keyboard-interactive y frase de la
//! llave se muestran en la propia terminal con el formato de OpenSSH, así el autocompletado y
//! `type_saved_password` de los scripts los reconocen igual que en escritorio.
// En el PC el módulo solo se compila para sus pruebas.
#![cfg_attr(not(target_os = "ios"), allow(dead_code))]

use crate::connection::Sink;
use crate::models::Session;
use russh::client::{self, Handle, KeyboardInteractiveAuthResponse};
use russh::keys::known_hosts::known_host_keys_path;
use russh::keys::{Algorithm, HashAlg, PrivateKey, PrivateKeyWithHashAlg, PublicKey, PublicKeyOrCertificate};
use russh::{cipher, kex, mac, ChannelMsg, Disconnect, MethodKind, MethodSet, Preferred, Pty};
use std::borrow::Cow;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::mpsc::{unbounded_channel, UnboundedReceiver, UnboundedSender};
use tokio::sync::Notify;
use zeroize::{Zeroize, Zeroizing};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
/// Tope para el intercambio de llaves y para cada respuesta del servidor durante el login
/// (no cuenta el tiempo que el operador tarda en teclear).
const NET_TIMEOUT: Duration = Duration::from_secs(20);
/// Rondas keyboard-interactive sin preguntas aceptadas antes de abandonar (servidor en bucle).
const MAX_EMPTY_ROUNDS: usize = 10;
const CANCELLED: &str = "Autenticación cancelada";
/// Intentos interactivos de contraseña, como NumberOfPasswordPrompts de OpenSSH.
const PASSWORD_TRIES: usize = 3;

/// Carpeta de datos de la app en iOS: la misma que arma Tauri (`app_config_dir`, que en iOS
/// es `$HOME/Library/Application Support/<identificador>`). connection.rs no recibe el
/// AppHandle, así que se reconstruye aquí.
pub fn data_dir() -> PathBuf {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir)
        .join("Library/Application Support/cl.netterminal.app")
}

/// known_hosts propio de la app (iOS no tiene ~/.ssh compartido).
pub fn known_hosts_path() -> PathBuf {
    data_dir().join("known_hosts")
}

enum Cmd {
    Data(Vec<u8>),
    Resize(u16, u16),
}

/// Conexión SSH nativa abierta. Se cierra con `close` o al soltar el último emisor.
pub struct NativeSsh {
    tx: UnboundedSender<Cmd>,
    cancel: Arc<Notify>,
}

impl NativeSsh {
    /// Escritor para el hilo de escritura de connection.rs (mismo orden que en la PTY).
    pub fn writer(&self) -> Box<dyn Write + Send> {
        Box::new(ChanWriter(self.tx.clone()))
    }

    pub fn resize(&self, cols: u16, rows: u16) {
        let _ = self.tx.send(Cmd::Resize(cols, rows));
    }

    /// Corta la sesión (y la conexión TCP) aunque esté a mitad de conectar o autenticar.
    pub fn close(&self) {
        self.cancel.notify_one();
    }
}

struct ChanWriter(UnboundedSender<Cmd>);

impl Write for ChanWriter {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        self.0
            .send(Cmd::Data(buf.to_vec()))
            .map_err(|_| std::io::Error::from(std::io::ErrorKind::BrokenPipe))?;
        Ok(buf.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

/// Opciones de la conexión, ya validadas desde la sesión.
pub struct Options {
    pub host: String,
    pub port: u16,
    pub user: Option<String>,
    pub identity_file: Option<PathBuf>,
    pub jump: Option<String>,
    pub legacy: bool,
    /// Carácter de borrado (VERASE) que se informa en el pedido de PTY.
    pub erase: Option<u8>,
    /// Contraseña guardada en la bóveda: se usa una sola vez y solo con el host de destino.
    pub secret: Option<Zeroizing<String>>,
    pub known_hosts: PathBuf,
}

impl Options {
    pub fn from_session(s: &Session, erase: Option<u8>, secret: Option<Zeroizing<String>>) -> Result<Self, String> {
        let host = clean_host(s.host.as_deref().unwrap_or(""))?;
        let user = s.username.as_deref().map(str::trim).filter(|u| !u.is_empty()).map(str::to_owned);
        let identity_file = s.identity_file.as_deref().map(str::trim).filter(|k| !k.is_empty()).map(resolve_key_path);
        let jump = s.jump_host.as_deref().map(str::trim).filter(|j| !j.is_empty()).map(str::to_owned);
        Ok(Options {
            host,
            port: s.port.filter(|p| *p != 0).unwrap_or(22),
            user,
            identity_file,
            jump,
            legacy: s.legacy_ssh.unwrap_or(false),
            erase,
            secret,
            known_hosts: known_hosts_path(),
        })
    }
}

fn clean_host(value: &str) -> Result<String, String> {
    let v = value.trim();
    let v = v.strip_prefix('[').and_then(|x| x.strip_suffix(']')).unwrap_or(v);
    if v.is_empty() {
        return Err("Falta el host".into());
    }
    if v.starts_with('-') || v.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return Err(format!("Host inválido: {v}"));
    }
    Ok(v.to_ascii_lowercase())
}

/// Ruta de la llave: "~" es el home del contenedor; una ruta relativa se busca en la carpeta
/// de datos de la app (p. ej. "keys/id_ed25519").
fn resolve_key_path(p: &str) -> PathBuf {
    if let Some(rest) = p.strip_prefix("~/") {
        if let Some(home) = std::env::var_os("HOME") {
            return PathBuf::from(home).join(rest);
        }
    }
    let path = PathBuf::from(p);
    if path.is_absolute() {
        path
    } else {
        data_dir().join(path)
    }
}

/// "usuario@host:puerto" (IPv6 entre corchetes) del jump host.
fn parse_jump(spec: &str) -> Result<(Option<String>, String, u16), String> {
    let (user, rest) = match spec.rsplit_once('@') {
        Some((u, r)) => (Some(u.to_string()).filter(|u| !u.is_empty()), r),
        None => (None, spec),
    };
    let (host, port) = if let Some(v6) = rest.strip_prefix('[') {
        let (h, tail) = v6.split_once(']').ok_or("Jump host inválido")?;
        (h, tail.strip_prefix(':'))
    } else if rest.matches(':').count() == 1 {
        let (h, p) = rest.split_once(':').unwrap_or((rest, ""));
        (h, Some(p))
    } else {
        (rest, None)
    };
    let port = match port {
        Some(p) => p.parse::<u16>().ok().filter(|p| *p != 0).ok_or("Puerto del jump host inválido")?,
        None => 22,
    };
    Ok((user, clean_host(host)?, port))
}

/// Algoritmos ofrecidos. Por defecto, los de OpenSSH actual (russh deja fuera ECDH NIST y
/// HMAC-SHA1, que OpenSSH sí ofrece y que muchos equipos de red necesitan). Con "legacy" se
/// suman los que OpenSSH apaga: DH con SHA-1, CBC, 3DES, firmas ssh-rsa (SHA-1) y ssh-dss.
/// Los algoritmos de host que known_hosts ya tiene para el equipo van primero, como hace
/// OpenSSH, para que el servidor presente la llave guardada y no otra.
fn preferred(legacy: bool, known: &[Algorithm]) -> Preferred {
    let mut kex_list = vec![
        kex::MLKEM768X25519_SHA256,
        kex::CURVE25519,
        kex::CURVE25519_PRE_RFC_8731,
        kex::ECDH_SHA2_NISTP256,
        kex::ECDH_SHA2_NISTP384,
        kex::ECDH_SHA2_NISTP521,
        kex::DH_GEX_SHA256,
        kex::DH_G16_SHA512,
        kex::DH_G18_SHA512,
        kex::DH_G14_SHA256,
    ];
    if legacy {
        kex_list.extend([kex::DH_GEX_SHA1, kex::DH_G14_SHA1, kex::DH_G1_SHA1]);
    }
    kex_list.extend([kex::EXTENSION_SUPPORT_AS_CLIENT, kex::EXTENSION_OPENSSH_STRICT_KEX_AS_CLIENT]);

    let mut ciphers = vec![
        cipher::CHACHA20_POLY1305,
        cipher::AES_128_CTR,
        cipher::AES_192_CTR,
        cipher::AES_256_CTR,
        cipher::AES_128_GCM,
        cipher::AES_256_GCM,
    ];
    if legacy {
        ciphers.extend([cipher::AES_128_CBC, cipher::AES_192_CBC, cipher::AES_256_CBC, cipher::TRIPLE_DES_CBC]);
    }

    let macs = vec![
        mac::HMAC_SHA256_ETM,
        mac::HMAC_SHA512_ETM,
        mac::HMAC_SHA1_ETM,
        mac::HMAC_SHA256,
        mac::HMAC_SHA512,
        mac::HMAC_SHA1,
    ];

    let mut keys: Vec<Algorithm> = Preferred::DEFAULT
        .key
        .iter()
        .filter(|a| legacy || **a != Algorithm::Rsa { hash: None })
        .cloned()
        .collect();
    if legacy {
        keys.push(Algorithm::Dsa);
    }
    // Orden estable: primero los conocidos (todas las variantes RSA cuentan como ssh-rsa).
    keys.sort_by_key(|a| !known.iter().any(|k| same_key_type(k, a)));
    Preferred {
        kex: Cow::Owned(kex_list),
        key: Cow::Owned(keys),
        cipher: Cow::Owned(ciphers),
        mac: Cow::Owned(macs),
        ..Preferred::DEFAULT
    }
}

/// Mismo tipo de llave: RSA es uno solo aunque se firme con SHA-1, SHA-256 o SHA-512.
fn same_key_type(a: &Algorithm, b: &Algorithm) -> bool {
    matches!((a, b), (Algorithm::Rsa { .. }, Algorithm::Rsa { .. })) || a == b
}

fn config(legacy: bool, known: &[Algorithm]) -> Arc<client::Config> {
    Arc::new(client::Config {
        preferred: preferred(legacy, known),
        // Como ServerAliveInterval=30 de escritorio: 3 sin respuesta cortan la sesión.
        keepalive_interval: Some(Duration::from_secs(30)),
        keepalive_max: 3,
        nodelay: true,
        ..Default::default()
    })
}

/// Texto que manda el servidor antes del login (banner, keyboard-interactive): sin controles
/// que la terminal interprete (ESC, CSI de 8 bits, DEL); solo quedan \n, \r y \t.
fn sanitize(text: &str) -> String {
    text.chars()
        .filter(|&c| matches!(c, '\n' | '\r' | '\t') || !(c < ' ' || c == '\u{7f}' || ('\u{80}'..='\u{9f}').contains(&c)))
        .collect()
}

/// Texto para la terminal: saltos de línea como CRLF.
fn crlf(text: &str) -> Vec<u8> {
    text.replace("\r\n", "\n").replace('\n', "\r\n").into_bytes()
}

struct Client {
    host: String,
    port: u16,
    known_hosts: PathBuf,
    sink: Sink,
}

impl client::Handler for Client {
    type Error = russh::Error;

    async fn auth_banner(&mut self, banner: &str, _session: &mut client::Session) -> Result<(), Self::Error> {
        self.sink.push(&crlf(&sanitize(banner)));
        Ok(())
    }

    /// Confianza en el primer uso, como OpenSSH con StrictHostKeyChecking=accept-new: una
    /// llave de un tipo que el equipo aún no tiene guardado se guarda y se informa con su huella
    /// SHA256; una distinta a la guardada del mismo tipo se rechaza.
    async fn check_server_key(&mut self, key: &PublicKeyOrCertificate) -> Result<bool, Self::Error> {
        let PublicKeyOrCertificate::PublicKey { key, .. } = key else {
            self.sink.push("\r\nEl servidor presentó un certificado de host; no se admite en iOS.\r\n".as_bytes());
            return Ok(false);
        };
        let fp = key.fingerprint(HashAlg::Sha256);
        let alg = key.algorithm();
        let known = match read_known(&self.host, self.port, &self.known_hosts) {
            Ok(k) => k,
            Err(e) => {
                self.sink.push(&crlf(&format!("\n{e}\n")));
                return Ok(false);
            }
        };
        let line = match verdict(&known, key) {
            Verdict::Known => return Ok(true),
            Verdict::Changed(line) => line,
            Verdict::New => 0,
        };
        if line > 0 {
            self.sink.push(&crlf(&format!(
                "\n@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@\n\
                 @    WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!     @\n\
                 @@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@\n\
                 La llave de host de {} cambió (posible ataque de intermediario).\n\
                 Llave recibida: {alg} {fp}\n\
                 La guardada está en known_hosts, línea {line}. Conexión rechazada.\n",
                self.host
            )));
            return Ok(false);
        }
        if let Err(e) = learn(&self.host, self.port, key, &self.known_hosts) {
            self.sink.push(&crlf(&format!("\nNo se pudo guardar la llave en known_hosts: {e}\n")));
            return Ok(false);
        }
        crate::session_store::restrict(&self.known_hosts);
        self.sink.push(&crlf(&format!(
            "Llave de host nueva para {}: {alg} {fp}\nSe guardó en known_hosts (confianza en el primer uso).\n",
            self.host
        )));
        Ok(true)
    }
}

#[derive(Debug, PartialEq)]
enum Verdict {
    Known,
    New,
    /// Hay otra llave del mismo tipo guardada (línea de known_hosts).
    Changed(usize),
}

fn verdict(known: &[(usize, PublicKey)], key: &PublicKey) -> Verdict {
    if known.iter().any(|(_, k)| k == key) {
        return Verdict::Known;
    }
    match known.iter().find(|(_, k)| same_key_type(&k.algorithm(), &key.algorithm())) {
        Some((line, _)) => Verdict::Changed(*line),
        None => Verdict::New,
    }
}

/// Llaves guardadas del equipo. russh trata un archivo que no se puede abrir como vacío; aquí
/// eso es un error (si no, una lectura fallida aprendería cualquier llave).
fn read_known(host: &str, port: u16, path: &Path) -> Result<Vec<(usize, PublicKey)>, String> {
    match std::fs::File::open(path) {
        Ok(_) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(format!("No se pudo leer known_hosts: {e}")),
    }
    known_host_keys_path(host, port, path).map_err(|e| format!("No se pudo leer known_hosts: {e}"))
}

/// Agrega la llave a known_hosts (formato OpenSSH). A diferencia de la de russh, informa un
/// error de escritura al vaciar el búfer y llega al disco antes de dar la llave por guardada.
fn learn(host: &str, port: u16, key: &PublicKey, path: &Path) -> Result<(), String> {
    use std::io::{Read, Seek, SeekFrom};
    let e = |e: std::io::Error| e.to_string();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(e)?;
    }
    let mut f = std::fs::OpenOptions::new().read(true).append(true).create(true).open(path).map_err(e)?;
    let mut last = [0u8; 1];
    let newline = f.seek(SeekFrom::End(-1)).is_ok() && f.read_exact(&mut last).is_ok() && last[0] != b'\n';
    let name = if port == 22 { host.to_string() } else { format!("[{host}]:{port}") };
    let line = format!(
        "{}{name} {}\n",
        if newline { "\n" } else { "" },
        key.to_openssh().map_err(|x| x.to_string())?
    );
    f.write_all(line.as_bytes()).map_err(e)?;
    f.flush().map_err(e)?;
    f.sync_all().map_err(e)
}

/// Respuesta del servidor con tope de tiempo.
async fn net<T>(f: impl std::future::Future<Output = Result<T, russh::Error>>) -> Result<T, String> {
    match tokio::time::timeout(NET_TIMEOUT, f).await {
        Ok(r) => r.map_err(|e| format!("ssh: {e}")),
        Err(_) => Err("ssh: el servidor no respondió a tiempo".into()),
    }
}

/// Lado de la terminal durante el login: lee líneas de lo tecleado (sin eco para secretos).
struct Term {
    rx: UnboundedReceiver<Cmd>,
    sink: Sink,
    /// Lo tecleado aún sin leer (`pos` marca lo consumido). Puede traer secretos: se borra.
    pending: Zeroizing<Vec<u8>>,
    pos: usize,
    cols: u16,
    rows: u16,
    /// Tras un CR se descarta el LF que lo acompañe (Enter "crlf").
    skip_lf: bool,
    /// 0 normal, 1 tras ESC, 2 dentro de CSI (ESC [ …), 3 tras SS3 (ESC O x): las flechas
    /// y teclas de función se ignoran.
    esc: u8,
}

impl Term {
    async fn read_line(&mut self, echo: bool) -> Result<Zeroizing<String>, String> {
        let mut line = Zeroizing::new(Vec::with_capacity(256));
        loop {
            while let Some(&b) = self.pending.get(self.pos) {
                self.pos += 1;
                if std::mem::take(&mut self.skip_lf) && b == b'\n' {
                    continue;
                }
                match (self.esc, b) {
                    (1, b'[') => self.esc = 2,
                    (1, b'O') => self.esc = 3,
                    (1, _) | (3, _) => self.esc = 0,
                    (2, 0x40..=0x7e) => self.esc = 0,
                    (2, _) => {}
                    (_, 0x1b) => self.esc = 1,
                    (_, b'\r' | b'\n') => {
                        self.skip_lf = b == b'\r';
                        self.sink.push(b"\r\n");
                        // Se mueve el búfer sin copiarlo; solo un UTF-8 inválido se reescribe.
                        let text = match String::from_utf8(std::mem::take(&mut *line)) {
                            Ok(t) => t,
                            Err(err) => {
                                let bytes = Zeroizing::new(err.into_bytes());
                                String::from_utf8_lossy(&bytes).into_owned()
                            }
                        };
                        return Ok(Zeroizing::new(text));
                    }
                    (_, 0x7f | 0x08) => {
                        // Borra un carácter UTF-8 completo.
                        while let Some(c) = line.pop() {
                            if c & 0xc0 != 0x80 {
                                break;
                            }
                        }
                        if echo {
                            self.sink.push(b"\x08 \x08");
                        }
                    }
                    (_, 0x03 | 0x04) => {
                        self.sink.push(b"\r\n");
                        return Err(CANCELLED.into());
                    }
                    (_, 0x15) => line.clear(),
                    (_, c) if c < 0x20 => {}
                    (_, c) => {
                        line.push(c);
                        if echo {
                            self.sink.push(&[c]);
                        }
                    }
                }
            }
            // Todo leído: se borra antes de recibir más (la contraseña no queda en memoria).
            self.pending.zeroize();
            self.pos = 0;
            match self.rx.recv().await {
                Some(Cmd::Data(d)) => {
                    let d = Zeroizing::new(d);
                    self.pending.extend_from_slice(&d);
                }
                Some(Cmd::Resize(c, r)) => (self.cols, self.rows) = (c, r),
                None => return Err(CANCELLED.into()),
            }
        }
    }

    async fn prompt(&mut self, text: &str, echo: bool) -> Result<Zeroizing<String>, String> {
        self.sink.push(text.as_bytes());
        self.read_line(echo).await
    }

    /// Lo tecleado después del último Enter del login (va al shell) y borra el búfer.
    fn take_rest(&mut self) -> Vec<u8> {
        let rest = self.pending.get(self.pos..).unwrap_or_default().to_vec();
        self.pending.zeroize();
        self.pos = 0;
        rest
    }
}

/// Abre la sesión en segundo plano. Los errores de red o de login se muestran en la terminal
/// y cierran la pestaña, como cuando el proceso ssh termina.
pub fn open(opts: Options, cols: u16, rows: u16, sink: &Sink) -> NativeSsh {
    let (tx, rx) = unbounded_channel();
    let cancel = Arc::new(Notify::new());
    let term = Term { rx, sink: sink.clone(), pending: Zeroizing::new(Vec::with_capacity(1024)), pos: 0, cols, rows, skip_lf: false, esc: 0 };
    let s = sink.clone();
    let c = cancel.clone();
    tauri::async_runtime::spawn(async move {
        let msg = tokio::select! {
            r = run(opts, term) => match r {
                Ok(0) => "Sesión finalizada".to_string(),
                Ok(code) => format!("Proceso terminado (código {code})"),
                Err(e) => {
                    s.push(&crlf(&format!("\n{e}\n")));
                    "Proceso terminado (código 255)".to_string()
                }
            },
            _ = c.notified() => "Sesión finalizada".to_string(),
        };
        tokio::time::sleep(Duration::from_millis(150)).await;
        s.close(msg);
    });
    NativeSsh { tx, cancel }
}

async fn tcp_connect(host: &str, port: u16) -> Result<tokio::net::TcpStream, String> {
    let addrs: Vec<_> = tokio::net::lookup_host((host, port))
        .await
        .map_err(|e| format!("ssh: no se pudo resolver {host}: {e}"))?
        .collect();
    let mut last = String::from("sin direcciones");
    for a in addrs {
        match tokio::time::timeout(CONNECT_TIMEOUT, tokio::net::TcpStream::connect(a)).await {
            Ok(Ok(st)) => return Ok(st),
            Ok(Err(e)) => last = e.to_string(),
            Err(_) => last = "tiempo de espera agotado".into(),
        }
    }
    Err(format!("ssh: no se pudo conectar a {host} puerto {port}: {last}"))
}

/// Conecta, autentica y atiende el shell. Devuelve el código de salida remoto.
async fn run(opts: Options, mut term: Term) -> Result<u32, String> {
    // Tipos de llave ya guardados para cada equipo (destino y bastión), primero en la oferta.
    let known_algs = |host: &str, port: u16| -> Result<Vec<Algorithm>, String> {
        Ok(read_known(host, port, &opts.known_hosts)?.iter().map(|(_, k)| k.algorithm()).collect())
    };
    let cfg_for = |host: &str, port: u16| -> Result<Arc<client::Config>, String> { Ok(config(opts.legacy, &known_algs(host, port)?)) };
    let (known_hosts, sink) = (opts.known_hosts.clone(), term.sink.clone());
    let client = |host: &str, port: u16| Client { host: host.to_string(), port, known_hosts: known_hosts.clone(), sink: sink.clone() };
    let key_err = |e: russh::Error| match e {
        russh::Error::UnknownKey => "Host key verification failed.".to_string(),
        e => format!("ssh: {e}"),
    };
    // Intercambio de llaves con tope: un servidor que acepta TCP y no habla SSH no cuelga la pestaña.
    let handshake = |r: Result<Result<Handle<Client>, russh::Error>, tokio::time::error::Elapsed>| match r {
        Ok(r) => r.map_err(key_err),
        Err(_) => Err("ssh: tiempo de espera agotado en el intercambio de llaves".to_string()),
    };

    // Con jump host: la conexión al destino viaja por un canal direct-tcpip del bastión.
    // El bastión se conserva vivo mientras dure la sesión.
    let mut _bastion: Option<Handle<Client>> = None;
    let mut handle = if let Some(spec) = opts.jump.as_deref() {
        let (juser, jhost, jport) = parse_jump(spec)?;
        let stream = tcp_connect(&jhost, jport).await?;
        let cfg = cfg_for(&jhost, jport)?;
        let mut jh = handshake(tokio::time::timeout(NET_TIMEOUT, client::connect_stream(cfg, stream, client(&jhost, jport))).await)?;
        let juser = match juser.or_else(|| opts.user.clone()) {
            Some(u) => u,
            None => term.prompt(&format!("login as ({jhost}): "), true).await?.to_string(),
        };
        // La contraseña guardada es del destino: el bastión nunca la recibe.
        authenticate(&mut jh, &mut term, &juser, &jhost, opts.identity_file.as_deref(), None, opts.legacy).await?;
        let ch = net(jh.channel_open_direct_tcpip(opts.host.clone(), opts.port as u32, "127.0.0.1", 0))
            .await
            .map_err(|e| format!("channel 0: open failed: {e}"))?;
        let cfg = cfg_for(&opts.host, opts.port)?;
        let h = handshake(
            tokio::time::timeout(NET_TIMEOUT, client::connect_stream(cfg, ch.into_stream(), client(&opts.host, opts.port))).await,
        )?;
        _bastion = Some(jh);
        h
    } else {
        let stream = tcp_connect(&opts.host, opts.port).await?;
        let cfg = cfg_for(&opts.host, opts.port)?;
        handshake(tokio::time::timeout(NET_TIMEOUT, client::connect_stream(cfg, stream, client(&opts.host, opts.port))).await)?
    };

    let user = match opts.user.clone() {
        Some(u) => u,
        None => term.prompt("login as: ", true).await?.to_string(),
    };
    authenticate(&mut handle, &mut term, &user, &opts.host, opts.identity_file.as_deref(), opts.secret, opts.legacy).await?;

    let mut channel = net(handle.channel_open_session()).await?;
    let mut modes = Vec::new();
    if let Some(erase) = opts.erase {
        modes.push((Pty::VERASE, erase as u32));
    }
    channel
        .request_pty(false, "xterm-256color", term.cols as u32, term.rows as u32, 0, 0, &modes)
        .await
        .map_err(|e| format!("ssh: PTY allocation request failed: {e}"))?;
    channel.request_shell(false).await.map_err(|e| format!("ssh: {e}"))?;
    // Lo tecleado durante el login que sobró después del último Enter.
    let rest = term.take_rest();
    if !rest.is_empty() {
        let _ = channel.data_bytes(rest).await;
    }

    let mut code = 0u32;
    loop {
        tokio::select! {
            msg = channel.wait() => match msg {
                Some(ChannelMsg::Data { data }) => term.sink.push(&data),
                Some(ChannelMsg::ExtendedData { data, .. }) => term.sink.push(&data),
                Some(ChannelMsg::ExitStatus { exit_status }) => code = exit_status,
                Some(ChannelMsg::Close) | None => break,
                _ => {}
            },
            cmd = term.rx.recv() => match cmd {
                Some(Cmd::Data(d)) => {
                    if channel.data_bytes(d).await.is_err() {
                        break;
                    }
                }
                Some(Cmd::Resize(c, r)) => {
                    let _ = channel.window_change(c as u32, r as u32, 0, 0).await;
                }
                None => break,
            },
        }
    }
    let _ = handle.disconnect(Disconnect::ByApplication, "", "en").await;
    Ok(code)
}

fn methods_of(r: &client::AuthResult) -> Option<MethodSet> {
    match r {
        client::AuthResult::Success => None,
        client::AuthResult::Failure { remaining_methods, .. } => Some(remaining_methods.clone()),
    }
}

/// Orden de OpenSSH: none, llave (si la sesión tiene una), contraseña guardada (una vez) y
/// luego keyboard-interactive o password tecleados en la terminal.
async fn authenticate(
    h: &mut Handle<Client>,
    term: &mut Term,
    user: &str,
    host: &str,
    key: Option<&Path>,
    secret: Option<Zeroizing<String>>,
    legacy: bool,
) -> Result<(), String> {
    let Some(mut methods) = methods_of(&net(h.authenticate_none(user)).await?) else {
        return Ok(());
    };
    let has = |m: &MethodSet, k: MethodKind| m.is_empty() || m.contains(&k);

    if let Some(path) = key.filter(|_| has(&methods, MethodKind::PublicKey)) {
        match load_key(term, path).await {
            Ok(k) => {
                let hash = net(h.best_supported_rsa_hash()).await?.flatten();
                // Sin rsa-sha2 en el servidor, una llave RSA firmaría con SHA-1 (ssh-rsa): solo con legacy.
                if k.algorithm().is_rsa() && hash.is_none() && !legacy {
                    term.sink.push(
                        "El servidor solo acepta firmas ssh-rsa (SHA-1) para la llave RSA. Activa \"SSH legacy\" en la sesión para usarla.\r\n"
                            .as_bytes(),
                    );
                } else {
                    let r = net(h.authenticate_publickey(user, PrivateKeyWithHashAlg::new(Arc::new(k), hash))).await?;
                    match methods_of(&r) {
                        None => return Ok(()),
                        Some(m) => methods = m,
                    }
                }
            }
            Err(msg) if msg == CANCELLED => return Err(msg),
            Err(msg) => term.sink.push(&crlf(&format!("{msg}\n"))),
        }
    }

    if let Some(secret) = secret {
        let r = if has(&methods, MethodKind::Password) {
            methods_of(&net(h.authenticate_password(user, secret.as_str())).await?)
        } else if methods.contains(&MethodKind::KeyboardInteractive) {
            kbd_interactive(h, term, user, Some(&secret)).await?.0
        } else {
            Some(methods.clone())
        };
        match r {
            None => return Ok(()),
            Some(m) => {
                methods = m;
                term.sink.push(b"Permission denied, please try again.\r\n");
            }
        }
    }

    // Un servidor que rechaza keyboard-interactive sin preguntar nada pasa a password,
    // como OpenSSH.
    let mut kbd = true;
    let mut tries = 0;
    while tries < PASSWORD_TRIES {
        let r = if kbd && methods.contains(&MethodKind::KeyboardInteractive) {
            let (r, asked) = kbd_interactive(h, term, user, None).await?;
            if !asked {
                kbd = false;
                if let Some(m) = r {
                    methods = m;
                    continue;
                }
            }
            r
        } else if has(&methods, MethodKind::Password) {
            let pw = term.prompt(&format!("{user}@{host}'s password: "), false).await?;
            methods_of(&net(h.authenticate_password(user, pw.as_str())).await?)
        } else {
            break;
        };
        match r {
            None => return Ok(()),
            Some(m) => {
                methods = m;
                tries += 1;
                if tries < PASSWORD_TRIES {
                    term.sink.push(b"Permission denied, please try again.\r\n");
                }
            }
        }
    }
    let names: Vec<&str> = methods.iter().map(<&str>::from).collect();
    Err(format!("{user}@{host}: Permission denied ({}).", names.join(",")))
}

/// Keyboard-interactive. Con `saved`, solo se responde un pedido de un único campo oculto
/// (la contraseña); cualquier otra cosa (OTP, varias preguntas) se pide al operador.
/// Devuelve además si el servidor llegó a preguntar algo.
async fn kbd_interactive(
    h: &mut Handle<Client>,
    term: &mut Term,
    user: &str,
    saved: Option<&Zeroizing<String>>,
) -> Result<(Option<MethodSet>, bool), String> {
    let mut saved = saved;
    let mut asked = false;
    let mut empty_rounds = 0;
    let mut r = net(h.authenticate_keyboard_interactive_start(user, None)).await?;
    loop {
        match r {
            KeyboardInteractiveAuthResponse::Success => return Ok((None, true)),
            KeyboardInteractiveAuthResponse::Failure { remaining_methods, .. } => return Ok((Some(remaining_methods), asked)),
            KeyboardInteractiveAuthResponse::InfoRequest { name, instructions, prompts } => {
                asked |= !prompts.is_empty();
                if prompts.is_empty() {
                    empty_rounds += 1;
                    if empty_rounds > MAX_EMPTY_ROUNDS {
                        return Err("ssh: el servidor repite pedidos keyboard-interactive vacíos".into());
                    }
                }
                // Las respuestas se borran de memoria si algo falla antes de entregarlas a russh.
                let mut answers: Zeroizing<Vec<String>> = Zeroizing::new(Vec::with_capacity(prompts.len()));
                if let (Some(secret), [p]) = (saved.take(), prompts.as_slice()) {
                    if !p.echo {
                        answers.push(secret.to_string());
                    }
                }
                if answers.is_empty() {
                    for text in [&name, &instructions].into_iter().filter(|t| !t.is_empty()) {
                        term.sink.push(&crlf(&format!("{}\n", sanitize(text))));
                    }
                    for p in &prompts {
                        let prompt = if p.prompt.is_empty() { format!("({user}) Password: ") } else { sanitize(&p.prompt) };
                        let mut answer = term.prompt(&prompt, p.echo).await?;
                        // Se mueve el String sin copiarlo (el Zeroizing vacío no deja rastro).
                        answers.push(std::mem::take(&mut *answer));
                    }
                }
                r = net(h.authenticate_keyboard_interactive_respond(std::mem::take(&mut *answers))).await?;
            }
        }
    }
}

/// Lee la llave privada; si está cifrada, pide la frase en la terminal (hasta 3 veces).
async fn load_key(term: &mut Term, path: &Path) -> Result<PrivateKey, String> {
    let text = Zeroizing::new(
        std::fs::read_to_string(path).map_err(|e| format!("No se pudo leer la llave {}: {e}", path.display()))?,
    );
    match russh::keys::decode_secret_key(&text, None) {
        Ok(k) => return Ok(k),
        Err(russh::keys::Error::KeyIsEncrypted) => {}
        Err(e) => return Err(format!("Llave {} inválida: {e}", path.display())),
    }
    for _ in 0..3 {
        let pass = term.prompt(&format!("Enter passphrase for key '{}': ", path.display()), false).await?;
        if let Ok(k) = russh::keys::decode_secret_key(&text, Some(pass.as_str())) {
            return Ok(k);
        }
        term.sink.push(b"Bad passphrase, try again.\r\n");
    }
    Err(format!("No se pudo descifrar la llave {}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use russh::server::{self, Auth, Msg, Server as _, Session as SrvSession};
    use russh::{Channel, ChannelId};
    use std::sync::Mutex;
    use tauri::ipc::{Channel as IpcChannel, InvokeResponseBody};

    #[derive(Clone)]
    struct Srv;

    fn reject() -> Auth {
        let methods = MethodSet::from(&[MethodKind::Password, MethodKind::KeyboardInteractive][..]);
        Auth::Reject { proceed_with_methods: Some(methods), partial_success: false }
    }

    impl server::Server for Srv {
        type Handler = Srv;
        fn new_client(&mut self, _: Option<std::net::SocketAddr>) -> Srv {
            Srv
        }
    }

    impl server::Handler for Srv {
        type Error = russh::Error;

        async fn auth_password(&mut self, user: &str, password: &str) -> Result<Auth, Self::Error> {
            Ok(if user == "noc" && password == "s3creta" { Auth::Accept } else { reject() })
        }

        /// Como OpenSSH con PAM: un único pedido "Password:" sin eco.
        async fn auth_keyboard_interactive<'a>(
            &'a mut self,
            user: &str,
            _: &str,
            response: Option<server::Response<'a>>,
        ) -> Result<Auth, Self::Error> {
            Ok(match response {
                None => Auth::Partial {
                    name: "".into(),
                    instructions: "".into(),
                    prompts: vec![("Password: ".into(), false)].into(),
                },
                Some(mut r) => {
                    let ok = user == "noc" && r.next().as_deref() == Some(&b"s3creta"[..]);
                    if ok { Auth::Accept } else { reject() }
                }
            })
        }

        async fn channel_open_session(
            &mut self,
            _: Channel<Msg>,
            reply: server::ChannelOpenHandle,
            _: &mut SrvSession,
        ) -> Result<(), Self::Error> {
            reply.accept().await;
            Ok(())
        }

        async fn pty_request(
            &mut self,
            ch: ChannelId,
            _: &str,
            cols: u32,
            rows: u32,
            _: u32,
            _: u32,
            _: &[(Pty, u32)],
            s: &mut SrvSession,
        ) -> Result<(), Self::Error> {
            s.data(ch, format!("pty {cols}x{rows}\r\n").into_bytes())?;
            Ok(())
        }

        async fn shell_request(&mut self, ch: ChannelId, s: &mut SrvSession) -> Result<(), Self::Error> {
            s.data(ch, b"router# ".to_vec())?;
            Ok(())
        }

        async fn window_change_request(
            &mut self,
            ch: ChannelId,
            cols: u32,
            rows: u32,
            _: u32,
            _: u32,
            s: &mut SrvSession,
        ) -> Result<(), Self::Error> {
            s.data(ch, format!("[win {cols}x{rows}]").into_bytes())?;
            Ok(())
        }

        async fn data(&mut self, ch: ChannelId, data: &[u8], s: &mut SrvSession) -> Result<(), Self::Error> {
            if data == b"exit\r" {
                s.exit_status_request(ch, 0)?;
                s.close(ch)?;
            } else {
                s.data(ch, data.to_vec())?;
            }
            Ok(())
        }
    }

    fn sink() -> (Sink, Arc<Mutex<Vec<u8>>>, Arc<Mutex<bool>>) {
        let out: Arc<Mutex<Vec<u8>>> = Arc::default();
        let closed: Arc<Mutex<bool>> = Arc::default();
        let (o, c) = (out.clone(), closed.clone());
        let data = IpcChannel::new(move |b| {
            match b {
                InvokeResponseBody::Raw(v) => o.lock().unwrap().extend(v),
                InvokeResponseBody::Json(_) => *c.lock().unwrap() = true,
            }
            Ok(())
        });
        (Sink::new(data), out, closed)
    }

    fn wait_for(out: &Arc<Mutex<Vec<u8>>>, text: &str) -> String {
        for _ in 0..200 {
            let s = String::from_utf8_lossy(&out.lock().unwrap()).into_owned();
            if s.contains(text) {
                return s;
            }
            std::thread::sleep(Duration::from_millis(25));
        }
        panic!("no llegó {text:?}; salida: {:?}", String::from_utf8_lossy(&out.lock().unwrap()));
    }

    fn start_server() -> u16 {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        listener.set_nonblocking(true).unwrap();
        tauri::async_runtime::spawn(async move {
            let key = key(HOST_KEY);
            let methods = MethodSet::from(&[MethodKind::Password, MethodKind::KeyboardInteractive][..]);
            let cfg = Arc::new(server::Config { keys: vec![key], methods, ..Default::default() });
            let l = tokio::net::TcpListener::from_std(listener).unwrap();
            let _ = Srv.run_on_socket(cfg, &l).await;
        });
        port
    }

    /// Llaves ed25519 fijas de prueba (generadas con ssh-keygen, sin uso fuera de aquí).
    const HOST_KEY: &str = "-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW
QyNTUxOQAAACAdLIDGkpiRx9iF5vNKR1KZY5zk2Dsxo2pluAytbI7cYwAAAIiynfNhsp3z
YQAAAAtzc2gtZWQyNTUxOQAAACAdLIDGkpiRx9iF5vNKR1KZY5zk2Dsxo2pluAytbI7cYw
AAAEAWJcePSj87Qh4VR8zhpJv7L7JEtDgfCLOjsrKD2qnaTx0sgMaSmJHH2IXm80pHUplj
nOTYOzGjamW4DK1sjtxjAAAAAAECAwQF
-----END OPENSSH PRIVATE KEY-----
";
    const OTHER_KEY: &str = "-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW
QyNTUxOQAAACBtrabWb9uiDi7grjJg3z0VnKH1g6ccwfMRtYZuQ0aBHwAAAIg0ZVkONGVZ
DgAAAAtzc2gtZWQyNTUxOQAAACBtrabWb9uiDi7grjJg3z0VnKH1g6ccwfMRtYZuQ0aBHw
AAAEBJOnpS+td9BJFb7dxAqOL63KCSpoPdfFEXorLSCC8Js22tptZv26IOLuCuMmDfPRWc
ofWDpxzB8xG1hm5DRoEfAAAAAAECAwQF
-----END OPENSSH PRIVATE KEY-----
";

    fn key(text: &str) -> PrivateKey {
        russh::keys::decode_secret_key(text, None).unwrap()
    }

    fn opts(port: u16, kh: &Path, secret: Option<&str>) -> Options {
        Options {
            host: "127.0.0.1".into(),
            port,
            user: Some("noc".into()),
            identity_file: None,
            jump: None,
            legacy: true,
            erase: Some(0x08),
            secret: secret.map(|s| Zeroizing::new(s.to_string())),
            known_hosts: kh.to_path_buf(),
        }
    }

    #[test]
    fn saved_password_shell_resize_and_exit() {
        let port = start_server();
        let kh = std::env::temp_dir().join(format!("nt_kh_{}", uuid::Uuid::new_v4()));
        let (snk, out, closed) = sink();
        let ssh = open(opts(port, &kh, Some("s3creta")), 100, 30, &snk);
        let s = wait_for(&out, "router# ");
        assert!(s.contains("Llave de host nueva para 127.0.0.1") && s.contains("SHA256:"));
        assert!(s.contains("pty 100x30"));
        assert!(!s.contains("password"), "con la contraseña guardada no se pide nada: {s}");
        ssh.resize(120, 40);
        wait_for(&out, "[win 120x40]");
        let mut w = ssh.writer();
        w.write_all(b"show ver").unwrap();
        wait_for(&out, "show ver");
        w.write_all(b"exit\r").unwrap();
        for _ in 0..100 {
            if *closed.lock().unwrap() {
                break;
            }
            std::thread::sleep(Duration::from_millis(25));
        }
        assert!(*closed.lock().unwrap());
        // Segunda vez: la llave ya es conocida y no se vuelve a avisar.
        let (sink2, out2, _) = sink();
        let _ssh2 = open(opts(port, &kh, Some("s3creta")), 80, 24, &sink2);
        let s2 = wait_for(&out2, "router# ");
        assert!(!s2.contains("Llave de host nueva"));
        let _ = std::fs::remove_file(&kh);
    }

    #[test]
    fn wrong_saved_password_falls_back_to_prompt() {
        let port = start_server();
        let kh = std::env::temp_dir().join(format!("nt_kh_{}", uuid::Uuid::new_v4()));
        let (snk, out, _) = sink();
        // Sin legacy: también prueba la oferta de algoritmos por defecto.
        let ssh = open(Options { legacy: false, ..opts(port, &kh, Some("mala")) }, 80, 24, &snk);
        // La guardada falla por password; el reintento va por keyboard-interactive.
        wait_for(&out, "Password: ");
        let mut w = ssh.writer();
        w.write_all(b"s3creta\r").unwrap();
        let s = wait_for(&out, "router# ");
        assert!(!s.contains("s3creta"), "la contraseña tecleada no tiene eco");
        let _ = std::fs::remove_file(&kh);
    }

    #[test]
    fn changed_host_key_is_rejected() {
        let port = start_server();
        let kh = std::env::temp_dir().join(format!("nt_kh_{}", uuid::Uuid::new_v4()));
        // Otra llave registrada para el mismo host y puerto.
        let other = key(OTHER_KEY);
        learn("127.0.0.1", port, other.public_key(), &kh).unwrap();
        let (snk, out, _) = sink();
        let _ssh = open(opts(port, &kh, Some("s3creta")), 80, 24, &snk);
        let s = wait_for(&out, "Host key verification failed.");
        assert!(s.contains("REMOTE HOST IDENTIFICATION HAS CHANGED") && !s.contains("router# "));
        let _ = std::fs::remove_file(&kh);
    }

    const ECDSA_PUB: &str = "ecdsa-sha2-nistp256 AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBDAH2Qom5wM+hu+Ai++TC3wFwLb92+KbFA/RnCGaHat3F1Fn1clBnNUy1rjkaJyukzcmpwXYYISy6/Wr6RRWNoE=";

    #[test]
    fn host_key_rule_is_per_key_type() {
        let a = key(HOST_KEY).public_key().clone();
        let b = key(OTHER_KEY).public_key().clone();
        let ec = PublicKey::from_openssh(ECDSA_PUB).unwrap();
        assert_eq!(verdict(&[], &a), Verdict::New);
        assert_eq!(verdict(&[(1, a.clone())], &a), Verdict::Known);
        // Otra ed25519 para el mismo equipo: cambio real.
        assert_eq!(verdict(&[(1, ec.clone()), (2, a.clone())], &b), Verdict::Changed(2));
        // Solo hay una ECDSA guardada: una ed25519 es un tipo nuevo, no un cambio.
        assert_eq!(verdict(&[(1, ec.clone())], &a), Verdict::New);
    }

    #[test]
    fn learn_writes_and_reads_back() {
        let kh = std::env::temp_dir().join(format!("nt_kh_{}", uuid::Uuid::new_v4()));
        let a = key(HOST_KEY).public_key().clone();
        let ec = PublicKey::from_openssh(ECDSA_PUB).unwrap();
        learn("10.0.0.1", 22, &a, &kh).unwrap();
        learn("10.0.0.1", 2222, &ec, &kh).unwrap();
        let k22 = read_known("10.0.0.1", 22, &kh).unwrap();
        assert_eq!(k22.len(), 1);
        assert_eq!(k22[0].1, a);
        assert_eq!(read_known("10.0.0.1", 2222, &kh).unwrap()[0].1, ec);
        assert!(read_known("10.0.0.2", 22, &kh).unwrap().is_empty());
        // Un known_hosts que existe pero no se puede abrir no cuenta como vacío.
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&kh, std::fs::Permissions::from_mode(0o000)).unwrap();
            let unreadable = std::fs::File::open(&kh).is_err(); // root sí puede abrirlo
            if unreadable {
                assert!(read_known("10.0.0.1", 22, &kh).is_err());
            }
            std::fs::set_permissions(&kh, std::fs::Permissions::from_mode(0o600)).unwrap();
        }
        let _ = std::fs::remove_file(&kh);
    }

    #[test]
    fn preferred_keys_filter_sha1_and_put_known_first() {
        let plain = preferred(false, &[]);
        assert!(!plain.key.contains(&Algorithm::Rsa { hash: None }));
        assert!(!plain.key.contains(&Algorithm::Dsa));
        let legacy = preferred(true, &[]);
        assert!(legacy.key.contains(&Algorithm::Rsa { hash: None }) && legacy.key.contains(&Algorithm::Dsa));
        // Con una RSA guardada, las variantes RSA van primero (en su orden original).
        let known = preferred(false, &[Algorithm::Rsa { hash: None }]);
        assert_eq!(known.key[0], Algorithm::Rsa { hash: Some(HashAlg::Sha512) });
        assert_eq!(known.key[1], Algorithm::Rsa { hash: Some(HashAlg::Sha256) });
        assert_eq!(known.key[2], Algorithm::Ed25519);
    }

    #[test]
    fn sanitizes_server_text() {
        assert_eq!(sanitize("Hola\x1b[2J\x1b]0;x\x07 mundo\r\n\tok\x7f\u{9b}31m"), "Hola[2J]0;x mundo\r\n\tok31m");
        assert_eq!(sanitize("Contraseña: "), "Contraseña: ");
    }

    #[test]
    fn password_line_ignores_arrow_and_function_keys() {
        let (snk, out, _) = sink();
        let (tx, rx) = unbounded_channel();
        let mut term = Term { rx, sink: snk, pending: Zeroizing::new(Vec::new()), pos: 0, cols: 80, rows: 24, skip_lf: false, esc: 0 };
        // Flecha arriba (CSI), F1 (SS3) y flecha en modo aplicación (SS3 A), luego la clave.
        tx.send(Cmd::Data(b"\x1b[A\x1bOP\x1bOAs3c\x7fcreta\rshow ver".to_vec())).unwrap();
        let line = tauri::async_runtime::block_on(term.read_line(false)).unwrap();
        assert_eq!(line.as_str(), "s3creta");
        assert_eq!(term.take_rest(), b"show ver");
        assert!(term.pending.is_empty());
        std::thread::sleep(Duration::from_millis(50));
        assert!(!String::from_utf8_lossy(&out.lock().unwrap()).contains("s3"), "sin eco");
    }

    #[test]
    fn parses_jump_specs() {
        assert_eq!(parse_jump("noc@bastion:2222").unwrap(), (Some("noc".into()), "bastion".into(), 2222));
        assert_eq!(parse_jump("bastion").unwrap(), (None, "bastion".into(), 22));
        assert_eq!(parse_jump("[2001:db8::1]:22").unwrap(), (None, "2001:db8::1".into(), 22));
        assert_eq!(parse_jump("2001:db8::1").unwrap(), (None, "2001:db8::1".into(), 22));
        assert!(parse_jump("-oProxyCommand=x").is_err());
    }
}
