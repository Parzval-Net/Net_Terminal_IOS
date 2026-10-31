//! Sondas de disponibilidad: ICMP (ping del sistema, sin privilegios) o TCP (acceso a
//! un puerto, p. ej. 22/23/443). Emiten una muestra por intervalo al frontend, que
//! calcula estado, pérdida, jitter y alarmas.

use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::{TcpStream, ToSocketAddrs};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter};

#[derive(Deserialize, Clone)]
pub struct ProbeConfig {
    pub id: String,
    pub kind: String, // "icmp" | "tcp"
    pub host: String,
    pub port: Option<u16>,
    pub interval_ms: u64,
    pub timeout_ms: u64,
}

#[derive(Serialize, Clone)]
pub struct Sample {
    pub id: String,
    pub ts: i64,
    pub ok: bool,
    pub rtt: Option<f64>,
    pub error: Option<String>,
}

#[derive(Default)]
pub struct Monitor {
    running: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

impl Monitor {
    pub fn start(&self, app: AppHandle, cfg: ProbeConfig) -> Result<(), String> {
        validate_host(&cfg.host)?;
        if cfg.kind == "tcp" && cfg.port.is_none() {
            return Err("La sonda TCP requiere puerto".into());
        }
        self.stop(&cfg.id);
        let flag = Arc::new(AtomicBool::new(true));
        self.running.lock().unwrap().insert(cfg.id.clone(), flag.clone());
        std::thread::spawn(move || {
            let interval = Duration::from_millis(cfg.interval_ms.clamp(200, 3_600_000));
            while flag.load(Ordering::SeqCst) {
                let start = Instant::now();
                let (ok, rtt, error) = probe(&cfg);
                if !flag.load(Ordering::SeqCst) {
                    break;
                }
                let _ = app.emit(
                    "monitor-sample",
                    Sample { id: cfg.id.clone(), ts: chrono::Utc::now().timestamp_millis(), ok, rtt, error },
                );
                // Duerme el resto del intervalo en tramos cortos para detenerse rápido.
                while start.elapsed() < interval && flag.load(Ordering::SeqCst) {
                    std::thread::sleep(Duration::from_millis(100).min(interval.saturating_sub(start.elapsed())));
                }
            }
        });
        Ok(())
    }

    pub fn stop(&self, id: &str) {
        if let Some(flag) = self.running.lock().unwrap().remove(id) {
            flag.store(false, Ordering::SeqCst);
        }
    }

    pub fn running(&self) -> Vec<String> {
        self.running.lock().unwrap().keys().cloned().collect()
    }
}

/// Host seguro para pasarlo a comandos del sistema: sin espacios ni "-" inicial.
/// Los corchetes solo se aceptan envolviendo el host completo (IPv6): ping los quita y
/// "[-f]" llegaría como opción.
pub fn validate_host(host: &str) -> Result<(), String> {
    let h = host.trim();
    let inner = h.strip_prefix('[').and_then(|x| x.strip_suffix(']')).unwrap_or(h);
    let ok = !inner.is_empty()
        && h.len() <= 253
        && !inner.starts_with('-')
        && inner.chars().all(|c| c.is_ascii_alphanumeric() || ".-:_%".contains(c));
    if ok {
        Ok(())
    } else {
        Err(format!("Host inválido: {host}"))
    }
}

pub fn probe(cfg: &ProbeConfig) -> (bool, Option<f64>, Option<String>) {
    let timeout = Duration::from_millis(cfg.timeout_ms.clamp(100, 30_000));
    if cfg.kind == "tcp" {
        tcp_probe(cfg.host.trim(), cfg.port.unwrap_or(22), timeout)
    } else {
        icmp_probe(cfg.host.trim(), timeout)
    }
}

pub fn tcp_probe(host: &str, port: u16, timeout: Duration) -> (bool, Option<f64>, Option<String>) {
    match resolve(host, port) {
        Ok(addrs) => tcp_probe_addrs(&addrs, timeout),
        Err(e) => (false, None, Some(e)),
    }
}

/// Direcciones del host (acepta IPv6 entre corchetes). El error ya viene con el prefijo "DNS:".
pub fn resolve(host: &str, port: u16) -> Result<Vec<std::net::SocketAddr>, String> {
    let host = host.trim_matches(|c| c == '[' || c == ']');
    (host, port).to_socket_addrs().map(Iterator::collect).map_err(|e| format!("DNS: {e}"))
}

/// Conecta a la primera dirección que responda.
pub fn tcp_probe_addrs(addrs: &[std::net::SocketAddr], timeout: Duration) -> (bool, Option<f64>, Option<String>) {
    let mut last = String::from("sin dirección");
    for addr in addrs {
        let t0 = Instant::now();
        match TcpStream::connect_timeout(addr, timeout) {
            Ok(_) => return (true, Some(t0.elapsed().as_secs_f64() * 1000.0), None),
            Err(e) => last = e.to_string(),
        }
    }
    (false, None, Some(last))
}

/// Comando del sistema sin ventana de consola en Windows.
pub fn command(bin: &str) -> Command {
    #[allow(unused_mut)]
    let mut c = Command::new(bin);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x0800_0000);
    }
    #[cfg(not(windows))]
    c.env("LC_ALL", "C");
    c
}

/// iOS: el sandbox no permite lanzar `ping`, así que el echo ICMP se envía con un socket
/// de datagramas propio (ver `icmp`). Si el sistema no deja abrir ese socket, se cae a
/// un "TCP ping" (conexión a 443/80/22) y la muestra lo indica en `error`.
#[cfg(target_os = "ios")]
fn icmp_probe(host: &str, timeout: Duration) -> (bool, Option<f64>, Option<String>) {
    let addrs = match resolve(host, 0) {
        Ok(a) => a,
        Err(e) => return (false, None, Some(e)),
    };
    // Misma preferencia que ping: IPv4 primero, salvo que el host solo tenga IPv6.
    let Some(ip) = addrs.iter().map(|a| a.ip()).find(|a| a.is_ipv4()).or_else(|| addrs.first().map(|a| a.ip())) else {
        return (false, None, Some("DNS: sin dirección".into()));
    };
    match icmp::ping(ip, timeout) {
        Ok(rtt) => (true, Some(rtt), None),
        Err(icmp::Error::Timeout) => (false, None, Some("Sin respuesta".into())),
        Err(icmp::Error::Unreachable { from, code }) => (false, None, Some(format!("Destino inaccesible (código {code}, desde {from})"))),
        Err(icmp::Error::Socket(e)) => {
            const PORTS: [u16; 3] = [443, 80, 22];
            for port in PORTS {
                let (ok, rtt, _) = tcp_probe_addrs(&[std::net::SocketAddr::new(ip, port)], timeout);
                if ok {
                    return (true, rtt, Some(format!("ICMP no disponible ({e}); medido con TCP al puerto {port}")));
                }
            }
            (false, None, Some(format!("ICMP no disponible ({e}) y sin respuesta TCP en 443/80/22")))
        }
    }
}

#[cfg(not(target_os = "ios"))]
fn icmp_probe(host: &str, timeout: Duration) -> (bool, Option<f64>, Option<String>) {
    let ms = timeout.as_millis().max(100);
    let v6 = host.contains(':');
    let mut cmd = if cfg!(windows) {
        let mut c = command("ping");
        c.args(["-n", "1", "-w", &ms.to_string()]);
        c
    } else if cfg!(target_os = "macos") {
        // ping6 de macOS no acepta -W; el tiempo lo limita el propio ping con -c 1.
        let mut c = command(if v6 { "ping6" } else { "ping" });
        c.args(["-c", "1"]);
        if !v6 {
            c.args(["-W", &ms.to_string()]);
        }
        c
    } else {
        let ping_bin = if cfg!(target_os = "android") && std::path::Path::new("/system/bin/ping").exists() {
            "/system/bin/ping"
        } else {
            "ping"
        };
        let mut c = command(ping_bin);
        c.args(["-c", "1", "-W", &ms.div_ceil(1000).to_string()]);
        c
    };
    // "[2001:db8::1]" es válido como host, pero ping no acepta los corchetes.
    cmd.arg(host.trim_matches(|c| c == '[' || c == ']'));
    let t0 = Instant::now();
    let out = match cmd.output() {
        Ok(o) => o,
        Err(e) => return (false, None, Some(format!("No se pudo ejecutar ping: {e}"))),
    };
    let wall = t0.elapsed().as_secs_f64() * 1000.0;
    let text = String::from_utf8_lossy(&out.stdout).to_string() + &String::from_utf8_lossy(&out.stderr);
    parse_ping(out.status.success(), &text, wall)
}

/// Interpreta la salida de ping en cualquier idioma. "TTL=" aparece en todas las
/// localizaciones y distingue una respuesta real de "host inaccesible" (Windows
/// devuelve código 0 aunque el gateway responda que el destino no es alcanzable).
pub fn parse_ping(success: bool, text: &str, wall_ms: f64) -> (bool, Option<f64>, Option<String>) {
    static RTT: OnceLock<Regex> = OnceLock::new();
    let lower = text.to_lowercase();
    let replied = success && (lower.contains("ttl=") || lower.contains("hlim="));
    if !replied {
        let reason = text
            .lines()
            .map(str::trim)
            .find(|l| {
                let l = l.to_lowercase();
                ["timeout", "timed out", "tiempo de espera", "unreachable", "inaccesible", "no se pudo", "unknown host", "cannot resolve", "could not find", "100% packet loss", "100% perdidos"]
                    .iter()
                    .any(|k| l.contains(k))
            })
            .unwrap_or("Sin respuesta")
            .to_string();
        return (false, None, Some(reason));
    }
    let re = RTT.get_or_init(|| Regex::new(r"(?i)(?:time|tiempo|zeit|temps|tempo|durée)\s*[=<]\s*([\d.,]+)\s*ms").unwrap());
    let rtt = re
        .captures(text)
        .and_then(|c| c[1].replace(',', ".").parse::<f64>().ok())
        .unwrap_or(wall_ms);
    (true, Some(rtt), None)
}

/// Echo ICMP nativo con socket de datagramas (`SOCK_DGRAM`/`IPPROTO_ICMP`): iOS y macOS lo
/// permiten sin privilegios y es la única vía en iOS, donde el sandbox no deja lanzar
/// `ping` ni `traceroute`. En macOS la app sigue usando los comandos del sistema; aquí el
/// módulo se compila solo para probarlo con el mismo API que iOS.
///
/// Particularidades de Darwin: el socket devuelve los paquetes IPv4 con su cabecera IP
/// (se descarta por IHL), el id del echo se conserva tal cual (no lo reescribe el kernel
/// como en Linux) y los errores ICMP (time exceeded, inalcanzable) llegan al mismo socket,
/// lo que permite el traceroute con TTL creciente.
#[cfg(any(target_os = "ios", target_os = "macos"))]
pub mod icmp {
    // En macOS solo lo usan los tests: la app sigue con ping/traceroute del sistema.
    #![cfg_attr(target_os = "macos", allow(dead_code))]
    use std::io;
    use std::net::IpAddr;
    use std::sync::atomic::{AtomicBool, AtomicU16, Ordering};
    use std::time::{Duration, Instant};

    const ECHO_REQUEST: u8 = 8;
    const ECHO_REPLY: u8 = 0;
    const DEST_UNREACH: u8 = 3;
    const TIME_EXCEEDED: u8 = 11;
    const ECHO6_REQUEST: u8 = 128;
    const ECHO6_REPLY: u8 = 129;
    const DEST6_UNREACH: u8 = 1;
    const TIME6_EXCEEDED: u8 = 3;
    /// Carga del echo (como ping: 56 bytes).
    const PAYLOAD: usize = 56;

    #[derive(Debug)]
    pub enum Error {
        /// No se pudo abrir o usar el socket ICMP (sandbox, red sin IPv6, etc.).
        Socket(io::Error),
        Timeout,
        Unreachable { from: IpAddr, code: u8 },
    }

    impl std::fmt::Display for Error {
        fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            match self {
                Error::Socket(e) => write!(f, "socket ICMP: {e}"),
                Error::Timeout => write!(f, "Sin respuesta"),
                Error::Unreachable { from, code } => write!(f, "Destino inaccesible (código {code}, desde {from})"),
            }
        }
    }

    impl From<io::Error> for Error {
        fn from(e: io::Error) -> Self {
            Error::Socket(e)
        }
    }

    /// Respuesta a un echo con TTL dado.
    #[derive(Debug, PartialEq)]
    pub enum Hop {
        /// El destino contestó.
        Reached { from: IpAddr, rtt: f64 },
        /// Un router intermedio agotó el TTL.
        Exceeded { from: IpAddr, rtt: f64 },
        Unreachable { from: IpAddr, code: u8 },
        Timeout,
    }

    pub struct Socket {
        fd: libc::c_int,
        v6: bool,
        /// Identificador del echo: distinto por socket para no cruzar respuestas entre sondas.
        id: u16,
    }

    impl Drop for Socket {
        fn drop(&mut self) {
            unsafe { libc::close(self.fd) };
        }
    }

    fn io_err<T>(r: libc::c_int, ok: T) -> io::Result<T> {
        if r < 0 {
            Err(io::Error::last_os_error())
        } else {
            Ok(ok)
        }
    }

    /// Suma de comprobación de ICMPv4 (RFC 1071). ICMPv6 la calcula el kernel.
    fn checksum(data: &[u8]) -> u16 {
        let mut sum = 0u32;
        for pair in data.chunks(2) {
            let word = if pair.len() == 2 { u16::from_be_bytes([pair[0], pair[1]]) } else { u16::from_be_bytes([pair[0], 0]) };
            sum += u32::from(word);
        }
        while sum >> 16 != 0 {
            sum = (sum & 0xffff) + (sum >> 16);
        }
        !(sum as u16)
    }

    /// `sockaddr` para `sendto`, con `sin_len`/`sin6_len` como exige Darwin.
    fn sockaddr(ip: IpAddr) -> (libc::sockaddr_storage, libc::socklen_t) {
        let mut st: libc::sockaddr_storage = unsafe { std::mem::zeroed() };
        let len = match ip {
            IpAddr::V4(a) => {
                let sa = &mut st as *mut _ as *mut libc::sockaddr_in;
                unsafe {
                    (*sa).sin_len = std::mem::size_of::<libc::sockaddr_in>() as u8;
                    (*sa).sin_family = libc::AF_INET as libc::sa_family_t;
                    (*sa).sin_addr.s_addr = u32::from(a).to_be();
                }
                std::mem::size_of::<libc::sockaddr_in>()
            }
            IpAddr::V6(a) => {
                let sa = &mut st as *mut _ as *mut libc::sockaddr_in6;
                unsafe {
                    (*sa).sin6_len = std::mem::size_of::<libc::sockaddr_in6>() as u8;
                    (*sa).sin6_family = libc::AF_INET6 as libc::sa_family_t;
                    (*sa).sin6_addr.s6_addr = a.octets();
                }
                std::mem::size_of::<libc::sockaddr_in6>()
            }
        };
        (st, len as libc::socklen_t)
    }

    fn ip_of(st: &libc::sockaddr_storage) -> Option<IpAddr> {
        match libc::c_int::from(st.ss_family) {
            libc::AF_INET => {
                let sa = st as *const _ as *const libc::sockaddr_in;
                Some(IpAddr::V4(u32::from_be(unsafe { (*sa).sin_addr.s_addr }).into()))
            }
            libc::AF_INET6 => {
                let sa = st as *const _ as *const libc::sockaddr_in6;
                Some(IpAddr::V6(unsafe { (*sa).sin6_addr.s6_addr }.into()))
            }
            _ => None,
        }
    }

    impl Socket {
        pub fn new(v6: bool) -> io::Result<Self> {
            static NEXT_ID: AtomicU16 = AtomicU16::new(0);
            let (dom, proto) = if v6 { (libc::AF_INET6, libc::IPPROTO_ICMPV6) } else { (libc::AF_INET, libc::IPPROTO_ICMP) };
            let fd = unsafe { libc::socket(dom, libc::SOCK_DGRAM, proto) };
            if fd < 0 {
                return Err(io::Error::last_os_error());
            }
            let id = (std::process::id() as u16).wrapping_add(NEXT_ID.fetch_add(1, Ordering::Relaxed).wrapping_mul(7919));
            Ok(Self { fd, v6, id })
        }

        pub fn set_ttl(&self, ttl: u8) -> io::Result<()> {
            let (level, name) = if self.v6 { (libc::IPPROTO_IPV6, libc::IPV6_UNICAST_HOPS) } else { (libc::IPPROTO_IP, libc::IP_TTL) };
            let v = libc::c_int::from(ttl);
            let r = unsafe { libc::setsockopt(self.fd, level, name, &v as *const _ as *const libc::c_void, std::mem::size_of_val(&v) as libc::socklen_t) };
            io_err(r, ())
        }

        fn set_recv_timeout(&self, d: Duration) -> io::Result<()> {
            let d = d.max(Duration::from_millis(1));
            let tv = libc::timeval { tv_sec: d.as_secs() as libc::time_t, tv_usec: d.subsec_micros() as libc::suseconds_t };
            let r = unsafe { libc::setsockopt(self.fd, libc::SOL_SOCKET, libc::SO_RCVTIMEO, &tv as *const _ as *const libc::c_void, std::mem::size_of_val(&tv) as libc::socklen_t) };
            io_err(r, ())
        }

        /// Envía un echo con `seq` y espera la respuesta que le corresponda (por id y
        /// secuencia) hasta `timeout`; las demás se descartan.
        pub fn echo(&self, dst: IpAddr, seq: u16, timeout: Duration) -> io::Result<Hop> {
            if dst.is_ipv6() != self.v6 {
                return Err(io::Error::new(io::ErrorKind::InvalidInput, "familia de dirección distinta a la del socket"));
            }
            let mut pkt = vec![0u8; 8 + PAYLOAD];
            pkt[0] = if self.v6 { ECHO6_REQUEST } else { ECHO_REQUEST };
            pkt[4..6].copy_from_slice(&self.id.to_be_bytes());
            pkt[6..8].copy_from_slice(&seq.to_be_bytes());
            for (i, b) in pkt[8..].iter_mut().enumerate() {
                *b = i as u8;
            }
            if !self.v6 {
                let c = checksum(&pkt);
                pkt[2..4].copy_from_slice(&c.to_be_bytes());
            }
            let (sa, salen) = sockaddr(dst);
            let t0 = Instant::now();
            let n = unsafe { libc::sendto(self.fd, pkt.as_ptr() as *const libc::c_void, pkt.len(), 0, &sa as *const _ as *const libc::sockaddr, salen) };
            io_err(n as libc::c_int, ())?;

            let deadline = t0 + timeout;
            let mut buf = vec![0u8; 2048];
            loop {
                let now = Instant::now();
                if now >= deadline {
                    return Ok(Hop::Timeout);
                }
                self.set_recv_timeout(deadline - now)?;
                let mut from: libc::sockaddr_storage = unsafe { std::mem::zeroed() };
                let mut fromlen = std::mem::size_of::<libc::sockaddr_storage>() as libc::socklen_t;
                let n = unsafe {
                    libc::recvfrom(self.fd, buf.as_mut_ptr() as *mut libc::c_void, buf.len(), 0, &mut from as *mut _ as *mut libc::sockaddr, &mut fromlen)
                };
                if n < 0 {
                    let e = io::Error::last_os_error();
                    match e.kind() {
                        io::ErrorKind::WouldBlock | io::ErrorKind::TimedOut => return Ok(Hop::Timeout),
                        io::ErrorKind::Interrupted => continue,
                        _ => return Err(e),
                    }
                }
                let rtt = t0.elapsed().as_secs_f64() * 1000.0;
                let Some(from) = ip_of(&from) else { continue };
                if let Some(h) = self.parse(&buf[..n as usize], seq, from, rtt) {
                    return Ok(h);
                }
            }
        }

        /// Interpreta un paquete recibido; `None` si no corresponde a este echo.
        fn parse(&self, data: &[u8], seq: u16, from: IpAddr, rtt: f64) -> Option<Hop> {
            // Darwin entrega los paquetes IPv4 con cabecera IP; IPv6 llega sin ella.
            let icmp = if !self.v6 && data.first().map(|b| b >> 4) == Some(4) {
                let ihl = usize::from(data[0] & 0x0f) * 4;
                data.get(ihl..)?
            } else {
                data
            };
            if icmp.len() < 8 {
                return None;
            }
            let (ty, code) = (icmp[0], icmp[1]);
            let mine = |hdr: &[u8]| hdr.len() >= 8 && hdr[4..6] == self.id.to_be_bytes() && hdr[6..8] == seq.to_be_bytes();
            let (reply, exceeded, unreach, request) = if self.v6 {
                (ECHO6_REPLY, TIME6_EXCEEDED, DEST6_UNREACH, ECHO6_REQUEST)
            } else {
                (ECHO_REPLY, TIME_EXCEEDED, DEST_UNREACH, ECHO_REQUEST)
            };
            if ty == reply {
                return mine(icmp).then_some(Hop::Reached { from, rtt });
            }
            if ty != exceeded && ty != unreach {
                return None;
            }
            // Los errores ICMP traen la cabecera IP original y los primeros 8 bytes del echo.
            let inner = icmp.get(8..)?;
            let orig = if self.v6 {
                // Cabecera IPv6 fija de 40 bytes; next header 58 = ICMPv6.
                (inner.len() >= 40 && inner[6] == 58).then(|| inner.get(40..)).flatten()?
            } else {
                let ihl = usize::from(inner.first()? & 0x0f) * 4;
                (inner.first()? >> 4 == 4 && inner.len() >= ihl && inner[9] == 1).then(|| inner.get(ihl..)).flatten()?
            };
            if orig.first() != Some(&request) || !mine(orig) {
                return None;
            }
            Some(if ty == exceeded { Hop::Exceeded { from, rtt } } else { Hop::Unreachable { from, code } })
        }
    }

    /// Un echo al destino: RTT en ms si contesta.
    pub fn ping(dst: IpAddr, timeout: Duration) -> Result<f64, Error> {
        let s = Socket::new(dst.is_ipv6())?;
        match s.echo(dst, 1, timeout)? {
            Hop::Reached { rtt, .. } => Ok(rtt),
            // Sin TTL reducido no debería llegar time exceeded; si llega, es un bucle de ruta.
            Hop::Exceeded { .. } | Hop::Timeout => Err(Error::Timeout),
            Hop::Unreachable { from, code } => Err(Error::Unreachable { from, code }),
        }
    }

    /// Traceroute con TTL creciente y una sonda por salto (como `traceroute -n -q 1`).
    /// `on_hop` recibe cada línea ya formateada; `cancel` corta entre saltos.
    pub fn traceroute(dst: IpAddr, max_hops: u8, timeout: Duration, cancel: &AtomicBool, mut on_hop: impl FnMut(String)) -> Result<(), Error> {
        let s = Socket::new(dst.is_ipv6())?;
        for ttl in 1..=max_hops.max(1) {
            if cancel.load(Ordering::SeqCst) {
                return Ok(());
            }
            s.set_ttl(ttl)?;
            let hop = s.echo(dst, u16::from(ttl), timeout)?;
            on_hop(format_hop(ttl, &hop));
            match hop {
                Hop::Reached { .. } | Hop::Unreachable { .. } => return Ok(()),
                Hop::Exceeded { .. } | Hop::Timeout => {}
            }
        }
        Ok(())
    }

    /// Línea con el formato de `traceroute -n`: " 3  10.0.0.1  1.234 ms".
    pub fn format_hop(ttl: u8, hop: &Hop) -> String {
        match hop {
            Hop::Reached { from, rtt } | Hop::Exceeded { from, rtt } => format!("{ttl:>2}  {from}  {rtt:.3} ms"),
            Hop::Unreachable { from, code } => format!("{ttl:>2}  {from}  !U (código {code})"),
            Hop::Timeout => format!("{ttl:>2}  *"),
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn checksum_matches_rfc1071_example() {
            // Ejemplo clásico: 0x0001 0xf203 0xf4f5 0xf6f7 -> complemento 0x220d
            assert_eq!(checksum(&[0x00, 0x01, 0xf2, 0x03, 0xf4, 0xf5, 0xf6, 0xf7]), 0x220d);
            // Un paquete con su checksum puesto suma 0xffff (complemento 0).
            let mut pkt = vec![8, 0, 0, 0, 0x12, 0x34, 0, 1, 9, 9, 9];
            let c = checksum(&pkt);
            pkt[2..4].copy_from_slice(&c.to_be_bytes());
            assert_eq!(checksum(&pkt), 0);
        }

        #[test]
        fn parses_reply_with_and_without_ip_header() {
            let s = Socket::new(false).unwrap();
            let mut icmp = vec![ECHO_REPLY, 0, 0, 0];
            icmp.extend_from_slice(&s.id.to_be_bytes());
            icmp.extend_from_slice(&7u16.to_be_bytes());
            let from: IpAddr = "10.0.0.1".parse().unwrap();
            assert_eq!(s.parse(&icmp, 7, from, 1.0), Some(Hop::Reached { from, rtt: 1.0 }));
            let mut with_ip = vec![0x45u8];
            with_ip.extend_from_slice(&[0; 19]);
            with_ip.extend_from_slice(&icmp);
            assert_eq!(s.parse(&with_ip, 7, from, 1.0), Some(Hop::Reached { from, rtt: 1.0 }));
            // Otra secuencia u otro id: no es nuestro.
            assert_eq!(s.parse(&icmp, 8, from, 1.0), None);
            // Time exceeded con el echo original adentro.
            let mut te = vec![TIME_EXCEEDED, 0, 0, 0, 0, 0, 0, 0, 0x45];
            te.extend_from_slice(&[0; 8]);
            te.push(1); // protocolo ICMP
            te.extend_from_slice(&[0; 10]);
            te.push(ECHO_REQUEST);
            te.extend_from_slice(&[0, 0, 0]);
            te.extend_from_slice(&s.id.to_be_bytes());
            te.extend_from_slice(&7u16.to_be_bytes());
            assert_eq!(s.parse(&te, 7, from, 2.0), Some(Hop::Exceeded { from, rtt: 2.0 }));
        }

        /// Ping real por socket de datagramas (mismo API que iOS). Loopback siempre debe
        /// contestar; 1.1.1.1 se tolera sin red.
        #[test]
        fn datagram_ping_loopback_and_cloudflare() {
            let rtt = ping("127.0.0.1".parse().unwrap(), Duration::from_secs(2)).expect("127.0.0.1 debe responder");
            assert!(rtt >= 0.0 && rtt < 1000.0, "{rtt}");
            match ping("1.1.1.1".parse().unwrap(), Duration::from_secs(3)) {
                Ok(rtt) => {
                    println!("1.1.1.1: {rtt:.3} ms");
                    assert!(rtt > 0.0 && rtt < 3000.0);
                }
                Err(e @ (Error::Timeout | Error::Unreachable { .. })) => println!("1.1.1.1 sin respuesta ({e}); sin red?"),
                Err(e) => panic!("{e}"),
            }
            if let Ok(rtt) = ping("::1".parse().unwrap(), Duration::from_secs(2)) {
                println!("::1: {rtt:.3} ms");
            }
        }

        /// Traceroute real con TTL creciente; se imprime para revisar con --nocapture.
        #[test]
        #[ignore]
        fn datagram_traceroute_cloudflare() {
            let cancel = AtomicBool::new(false);
            traceroute("1.1.1.1".parse().unwrap(), 30, Duration::from_secs(2), &cancel, |l| println!("{l}")).unwrap();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_ping_in_several_languages() {
        let mac = "64 bytes from 1.1.1.1: icmp_seq=0 ttl=57 time=12.345 ms";
        assert_eq!(parse_ping(true, mac, 50.0), (true, Some(12.345), None));
        let win_es = "Respuesta desde 8.8.8.8: bytes=32 tiempo=14ms TTL=117";
        assert_eq!(parse_ping(true, win_es, 50.0).1, Some(14.0));
        let win_lt = "Reply from 10.0.0.1: bytes=32 time<1ms TTL=64";
        assert_eq!(parse_ping(true, win_lt, 50.0).1, Some(1.0));
        // Windows: código 0 pero el gateway informa inaccesible -> caído
        let unreach = "Respuesta desde 10.0.0.254: Host de destino inaccesible.";
        let r = parse_ping(true, unreach, 5.0);
        assert!(!r.0 && r.2.unwrap().contains("inaccesible"));
        let timeout = "Request timeout for icmp_seq 0\n--- 10.9.9.9 ping statistics ---\n1 packets transmitted, 0 packets received, 100.0% packet loss";
        assert!(!parse_ping(false, timeout, 1000.0).0);
    }

    #[test]
    fn rejects_option_injection_in_host() {
        assert!(validate_host("-f").is_err());
        assert!(validate_host("10.0.0.1; rm -rf /").is_err());
        assert!(validate_host("router-core.lab").is_ok());
        assert!(validate_host("2001:db8::1").is_ok());
        assert!(validate_host("[2001:db8::1]").is_ok());
        // ping recibe el host sin corchetes: "[-f]" no puede convertirse en opción.
        for bad in ["[-f]", "[-c99]", "[]", "[[-f]]", "-[x]", "a]b", "[a"] {
            assert!(validate_host(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn tcp_probe_detects_open_and_closed_ports() {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        assert!(tcp_probe("127.0.0.1", port, Duration::from_secs(1)).0);
        drop(listener);
        // Otro test en paralelo puede tomar justo ese puerto efímero: se reintenta con uno
        // nuevo antes de concluir que la detección de "cerrado" falla.
        let closed = (0..5).any(|_| {
            let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            let p = l.local_addr().unwrap().port();
            drop(l);
            !tcp_probe("127.0.0.1", p, Duration::from_millis(300)).0
        });
        assert!(closed || !tcp_probe("127.0.0.1", port, Duration::from_millis(300)).0);
    }
}
