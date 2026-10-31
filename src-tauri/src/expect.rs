//! Espera de salida al estilo "expect": hasta un patrón o hasta que el equipo deja de
//! enviar datos. Lo usan los scripts (con cancelación) y las herramientas MCP.

use regex::Regex;
use std::sync::mpsc::{Receiver, RecvTimeoutError};
use std::time::{Duration, Instant};

/// Por qué terminó una espera sin coincidencia. Cada variante lleva lo recibido.
#[derive(Debug, PartialEq)]
pub enum WaitEnd {
    Timeout(String),
    /// La sesión se cerró.
    Closed(String),
    /// `cancel` devolvió true (script detenido).
    Cancelled(String),
}

/// Cada cuánto una espera revisa `cancel`.
const CHECK: Duration = Duration::from_millis(200);

/// Acumula salida hasta que `re` coincide y la devuelve completa (el búfer queda vacío).
/// Sin coincidencia devuelve lo recibido según la causa: plazo vencido, sesión cerrada o
/// `cancel`.
pub fn wait_for(
    rx: &Receiver<String>,
    re: &Regex,
    timeout: Duration,
    buf: &mut String,
    cancel: &dyn Fn() -> bool,
) -> Result<String, WaitEnd> {
    let deadline = Instant::now() + timeout;
    loop {
        if re.is_match(buf) {
            return Ok(std::mem::take(buf));
        }
        if cancel() {
            return Err(WaitEnd::Cancelled(std::mem::take(buf)));
        }
        let left = deadline.saturating_duration_since(Instant::now());
        if left.is_zero() {
            return Err(WaitEnd::Timeout(std::mem::take(buf)));
        }
        match rx.recv_timeout(left.min(CHECK)) {
            Ok(chunk) => {
                buf.push_str(&chunk);
                // Lo que ya está en cola se agrega antes de buscar: un PTY entrega a menudo
                // una línea por fragmento y buscar en todo el búfer con cada una es cuadrático.
                while let Ok(more) = rx.try_recv() {
                    buf.push_str(&more);
                }
            }
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => return Err(WaitEnd::Closed(std::mem::take(buf))),
        }
    }
}

/// Acumula salida hasta que pasan `idle` sin datos nuevos o se cumple `timeout`.
pub fn collect(rx: &Receiver<String>, idle: Duration, timeout: Duration) -> String {
    let deadline = Instant::now() + timeout;
    let mut out = String::new();
    loop {
        let left = deadline.saturating_duration_since(Instant::now());
        if left.is_zero() {
            return out;
        }
        match rx.recv_timeout(idle.min(left)) {
            Ok(chunk) => out.push_str(&chunk),
            Err(_) => return out,
        }
    }
}

/// Descarta lo pendiente en el canal.
pub fn drain(rx: &Receiver<String>) {
    while rx.try_recv().is_ok() {}
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc::channel;
    use std::thread;

    #[test]
    fn waits_for_prompt_across_chunks() {
        let (tx, rx) = channel();
        thread::spawn(move || {
            for part in ["show ver\nCisco IOS", " XE\nRouter", "#"] {
                thread::sleep(Duration::from_millis(20));
                tx.send(part.to_string()).unwrap();
            }
        });
        let re = Regex::new(r"[#>]\s*$").unwrap();
        let mut buf = String::new();
        let out = wait_for(&rx, &re, Duration::from_secs(2), &mut buf, &|| false).unwrap();
        assert!(out.ends_with("Router#"));
    }

    /// cargo test --release -- --ignored --nocapture bench_
    #[test]
    #[ignore]
    fn bench_wait_for_many_small_chunks() {
        let n = 20_000;
        let mut chunks: Vec<String> = (0..n).map(|i| format!("Gi1/0/{i} connected 10 a-full\n")).collect();
        chunks.push("Router-core#".to_string());
        for (name, pat) in [("anclado", r"[#>]\s*$"), ("sin anclar", r"Router-core#")] {
            let (tx, rx) = channel();
            for c in &chunks {
                tx.send(c.clone()).unwrap();
            }
            let re = Regex::new(pat).unwrap();
            let mut buf = String::new();
            let t = Instant::now();
            let out = wait_for(&rx, &re, Duration::from_secs(120), &mut buf, &|| false).unwrap();
            println!("wait_for {name}: {} fragmentos, {} KB en {:?}", n + 1, out.len() / 1024, t.elapsed());
        }
    }

    #[test]
    fn times_out_with_partial_output() {
        let (tx, rx) = channel();
        tx.send("parcial".to_string()).unwrap();
        let re = Regex::new("nunca").unwrap();
        let mut buf = String::new();
        let err = wait_for(&rx, &re, Duration::from_millis(80), &mut buf, &|| false).unwrap_err();
        assert_eq!(err, WaitEnd::Timeout("parcial".into()));
        drop(tx);
    }

    #[test]
    fn collect_stops_when_idle() {
        let (tx, rx) = channel();
        tx.send("a".into()).unwrap();
        tx.send("b".into()).unwrap();
        let start = Instant::now();
        assert_eq!(collect(&rx, Duration::from_millis(50), Duration::from_secs(5)), "ab");
        assert!(start.elapsed() < Duration::from_secs(1));
        drop(tx);
    }
}
