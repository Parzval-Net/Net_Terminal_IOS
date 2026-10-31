//! Comandos de archivo sobre una sesión abierta (listar el flash, copy desde/hacia el
//! servidor TFTP/HTTP local) respondiendo automáticamente las confirmaciones típicas
//! del equipo y la paginación "--More--".

use crate::expect;
use regex::Regex;
use serde::Serialize;
use serde_json::json;
use std::collections::HashMap;
use std::net::ToSocketAddrs;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

#[derive(Serialize, Clone)]
struct JobEvent {
    job: String,
    kind: &'static str,
    text: String,
    data: Option<serde_json::Value>,
}

struct Patterns {
    more: Regex,
    prompt: Regex,
    confirm: Regex,
    yes_no: Regex,
    error: Regex,
}

fn patterns() -> &'static Patterns {
    static P: OnceLock<Patterns> = OnceLock::new();
    P.get_or_init(|| Patterns {
        more: Regex::new(r"(?i)(--\s*more\s*--|-{2,}\s*more\s*-{2,}|\(more\)|press any key)\s*$").unwrap(),
        // Los mismos prompts que src/lib/cliText.ts (lista común en scripts/tests/fixtures/prompts.json):
        // Huawei/H3C <SW>, [~SW], [*SW-GE1/0/1]; MikroTik [admin@MikroTik] >; shell RHEL
        // [user@host ~]$; Junos, PAN-OS y shells user@host>, user@host:~$; Cisco/Arista/Aruba
        // Router#, Router(config-if)#, IOS-XR RP/0/RSP0/CPU0:asr9k#, ASA ciscoasa/admin#; FortiOS fw01 #, con VDOM
        // fw01 (root) (interface) #.
        prompt: Regex::new(concat!(
            r"(?m)^<[\w.\-]+>\s*$",
            r"|^\[[\w.\-]+@[\w.\-]+\](?: /[\w/\-]*)? ?>\s*$",
            r"|^\[[\w.\-]+@[\w.\-]+(?: [^\]\n]*)?\][#$]\s*$",
            r"|^\[[~*]{0,2}[\w.\-]+(?:[^\]\w.\-\s][^\]\s]*)?\]\s*$",
            r"|^[\w.\-]+@[\w.\-]+(?::\S*)?[>#%$]\s*$",
            r"|^(?:[\w/]+:)?[\w.\-]+(?:/[\w.\-]+){0,2}(?: ?\([^()\n]*\)){0,3} ?[#>$%]\s*$",
        ))
        .unwrap(),
        // "Destination filename [ios.bin]?", "[confirm]", "Address or name of remote host []?"
        confirm: Regex::new(r"(?i)(\[confirm\]|\[[^\]\n]*\]\s*\?)\s*$").unwrap(),
        // Huawei / H3C: "(y/n)[n]:", "[Y/N]:"
        yes_no: Regex::new(r"(?i)(\(y/n\)(\[\w\])?|\[y/n\])\s*:?\s*$").unwrap(),
        error: Regex::new(r"(?im)^\s*(%\s*error|%\s*invalid|error:|.*timed out|.*no such file|.*permission denied|.*not enough space|.*failed)").unwrap(),
    })
}

/// Ejecuta un comando en la sesión y transmite su salida. Responde Enter a
/// confirmaciones con valor por defecto, "y" a preguntas sí/no y espacio a "--More--".
/// Termina cuando vuelve a aparecer el prompt o vence el plazo.
/// Tope de la salida de un comando: evita agotar memoria si el equipo no deja de enviar datos.
const MAX_OUTPUT: usize = 16 * 1024 * 1024;
/// Texto final que se conserva para reconocer preguntas de confirmación.
const TAIL_KEEP: usize = 4096;

/// Un solo comando a la vez por sesión: dos trabajos en paralelo escribirían su comando mientras el
/// otro responde "--More--" o espera el prompt, y el equipo se comería el primer carácter
/// ("how interfaces"). Los trabajos de una misma sesión se encolan; el plazo corre desde que
/// empiezan, no desde que se pidieron.
fn session_lock(conn: &str) -> Arc<Mutex<()>> {
    static LOCKS: OnceLock<Mutex<HashMap<String, Arc<Mutex<()>>>>> = OnceLock::new();
    let mut map = LOCKS.get_or_init(Default::default).lock().unwrap_or_else(|e| e.into_inner());
    // Sesiones cerradas: solo quedan las entradas que alguien usa.
    if map.len() > 64 {
        map.retain(|_, l| Arc::strong_count(l) > 1);
    }
    map.entry(conn.to_string()).or_default().clone()
}

/// `answer = false`: no confirma nada; ante una pregunta responde que no (Ctrl+C en "[confirm]"),
/// espera el prompt y lo informa en el resultado (`declined`).
pub fn run(app: AppHandle, conn: String, command: String, timeout_secs: u64, answer: bool) -> Result<String, String> {
    if command.contains(['\r', '\n']) {
        return Err("Un solo comando por operación".into());
    }
    let state = app.state::<crate::AppState>();
    state.conns.info(&conn).ok_or("La sesión no está conectada")?;
    let job = uuid::Uuid::new_v4().to_string();
    let id = job.clone();
    let deadline = Duration::from_secs(timeout_secs.clamp(5, 7200));

    std::thread::spawn(move || {
        let emit = |kind: &'static str, text: String, data: Option<serde_json::Value>| {
            let _ = app.emit("tool-job", JobEvent { job: id.clone(), kind, text, data });
        };
        let conns = &app.state::<crate::AppState>().conns;
        let p = patterns();
        let lock = session_lock(&conn);
        let _turn = lock.lock().unwrap_or_else(|e| e.into_inner());
        // La suscripción se toma recién al tocar el turno: antes acumularía la salida del trabajo anterior.
        let Some(rx) = conns.tap(&conn) else {
            emit("error", "La sesión no está conectada".into(), None);
            return emit("done", String::new(), None);
        };
        expect::drain(&rx);
        if let Err(e) = conns.write(&conn, format!("{command}\r").as_bytes()) {
            emit("error", e, None);
            return emit("done", String::new(), None);
        }
        let start = Instant::now();
        let mut output = String::new();
        let mut tail = String::new(); // texto desde la última respuesta automática
        let mut answered = 0;
        let mut declined: Option<String> = None;
        let mut echo = EchoScan::default();
        // Líneas completas hacia la interfaz: un fragmento puede cortar una línea a la mitad.
        let mut partial = String::new();
        let flush = |partial: &mut String, all: bool| {
            while let Some(i) = partial.find('\n') {
                let line = partial[..i].trim_end().to_string();
                partial.drain(..=i);
                if !line.is_empty() {
                    emit("line", line, None);
                }
            }
            // Sin salto de línea tras una pausa (prompts, preguntas de confirmación).
            if all && !partial.trim().is_empty() {
                emit("line", partial.trim_end().to_string(), None);
                partial.clear();
            }
        };
        loop {
            if start.elapsed() > deadline {
                flush(&mut partial, true);
                leave_pager(conns, &conn, p, &tail);
                emit("error", "Tiempo agotado esperando al equipo".into(), None);
                break;
            }
            let chunk = match rx.recv_timeout(Duration::from_millis(500)) {
                Ok(c) => c,
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                    flush(&mut partial, true);
                    continue;
                }
                // La sesión se cerró: sin esto el hilo giraba hasta el plazo con el turno tomado y
                // bloqueaba los siguientes trabajos de la pestaña al reconectar.
                Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                    flush(&mut partial, true);
                    emit("error", "La sesión se cerró".into(), None);
                    break;
                }
            };
            if output.len() + chunk.len() > MAX_OUTPUT {
                flush(&mut partial, true);
                leave_pager(conns, &conn, p, &tail);
                emit("error", "La salida del equipo superó el máximo permitido; se detuvo la lectura".into(), None);
                break;
            }
            output.push_str(&chunk);
            tail.push_str(&chunk);
            // Las preguntas del equipo están al final: basta con lo último, sin releer todo en cada bloque.
            if tail.len() > TAIL_KEEP * 2 {
                let mut cut = tail.len() - TAIL_KEEP;
                while !tail.is_char_boundary(cut) {
                    cut += 1;
                }
                tail.drain(..cut);
            }
            partial.push_str(&chunk);
            flush(&mut partial, false);
            let t = tail.trim_end_matches([' ', '\t']);
            let question = || t.lines().last().unwrap_or("").trim().chars().take(200).collect::<String>();
            let reply = if p.more.is_match(t) {
                Some(" ")
            } else if p.yes_no.is_match(t) {
                if answer {
                    Some("y\r")
                } else {
                    declined.get_or_insert_with(question);
                    Some("n\r")
                }
            } else if p.confirm.is_match(t) {
                if answer {
                    Some("\r")
                } else {
                    declined.get_or_insert_with(question);
                    Some("\x03")
                }
            } else {
                None
            };
            if let Some(r) = reply {
                answered += 1;
                if answered > 200 {
                    leave_pager(conns, &conn, p, &tail);
                    emit("error", "Demasiadas confirmaciones; se detuvo por seguridad".into(), None);
                    break;
                }
                let _ = conns.write(&conn, r.as_bytes());
                tail.clear();
                continue;
            }
            if echo.finished(p, &output, command.trim()) {
                break;
            }
        }
        flush(&mut partial, true);
        let failed = p.error.is_match(&output) || declined.is_some();
        emit("result", String::new(), Some(json!({ "ok": !failed, "output": output, "declined": declined })));
        emit("done", String::new(), None);
    });
    Ok(job)
}

/// Si el trabajo se corta con el equipo esperando en "--More--", la sesión queda en el paginador y se
/// comería el primer carácter del comando siguiente: "q" lo cierra (IOS, NX-OS, VRP, Junos).
fn leave_pager(conns: &crate::connection::ConnectionManager, conn: &str, p: &Patterns, tail: &str) {
    if p.more.is_match(tail.trim_end_matches([' ', '\t'])) {
        let _ = conns.write(conn, b"q");
    }
}

/// El comando terminó si, después de su eco, la última línea es un prompt del equipo.
/// Si el eco no aparece tal cual (líneas largas que el equipo recorta), se usa toda la
/// salida, exigiendo al menos un salto de línea.
#[cfg(test)]
fn finished(p: &Patterns, output: &str, command: &str) -> bool {
    EchoScan::default().finished(p, output, command)
}

/// Recuerda dónde terminó el eco del comando (o hasta dónde ya se buscó): la salida solo
/// crece, así que no se vuelve a recorrer completa con cada fragmento.
#[derive(Default)]
struct EchoScan {
    end: Option<usize>,
    searched: usize,
}

impl EchoScan {
    fn finished(&mut self, p: &Patterns, output: &str, command: &str) -> bool {
        if self.end.is_none() {
            // El eco puede haber quedado partido entre el fragmento anterior y este.
            let mut from = self.searched.saturating_sub(command.len());
            while !output.is_char_boundary(from) {
                from -= 1;
            }
            self.end = output[from..].find(command).map(|i| from + i + command.len());
            self.searched = output.len();
        }
        let after = &output[self.end.unwrap_or(0)..];
        if !after.contains('\n') {
            return false;
        }
        let last = after.trim_end_matches([' ', '\t']).rsplit('\n').next().unwrap_or("");
        p.prompt.is_match(last)
    }
}

/// IP local que el sistema usaría para llegar a `host` (la que el equipo debe usar
/// para descargar desde este PC). No envía tráfico: solo consulta la tabla de rutas.
pub fn source_ip_for(host: &str) -> Result<String, String> {
    crate::monitor::validate_host(host)?;
    let addr = (host.trim_matches(['[', ']']), 9)
        .to_socket_addrs()
        .map_err(|e| e.to_string())?
        .find(|a| a.is_ipv4())
        .ok_or("El host no tiene dirección IPv4")?;
    crate::nettools::route_source(addr).ok_or_else(|| "Sin ruta hacia el equipo".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn jobs_of_one_session_share_a_turn() {
        let a = session_lock("conn-a");
        assert!(Arc::ptr_eq(&a, &session_lock("conn-a")), "misma sesión, mismo turno");
        assert!(!Arc::ptr_eq(&a, &session_lock("conn-b")), "otra sesión no espera");
        let _held = a.lock().unwrap();
        assert!(session_lock("conn-a").try_lock().is_err(), "un segundo trabajo espera su turno");
        assert!(session_lock("conn-b").try_lock().is_ok());
    }

    #[test]
    fn recognizes_prompts_and_confirmations() {
        let p = patterns();
        assert!(p.confirm.is_match("Destination filename [c2960.bin]?"));
        assert!(p.confirm.is_match("Do you want to over write? [confirm]"));
        assert!(p.confirm.is_match("Address or name of remote host [10.0.0.5]? "));
        assert!(!p.confirm.is_match("copy tftp://10.0.0.5/a.bin flash:"));
        assert!(p.yes_no.is_match("Are you sure to download file? (y/n)[n]:"));
        assert!(p.more.is_match(" --More-- "));
        assert!(p.more.is_match("  ---- More ----"));
        for prompt in ["Router#", "SW-CORE(config)#", "<HUAWEI>", "[HUAWEI]", "noc@mx01>", "fw01 #"] {
            assert!(p.prompt.is_match(prompt), "{prompt}");
        }
        assert!(!p.prompt.is_match("Accessing tftp://10.0.0.5/ios.bin..."));
        // Lista común con src/lib/cliText.ts.
        let fx: serde_json::Value = serde_json::from_str(include_str!("../../scripts/tests/fixtures/prompts.json")).unwrap();
        for pair in fx["prompts"].as_array().unwrap() {
            let line = pair[0].as_str().unwrap();
            assert!(p.prompt.is_match(line), "debería ser prompt: {line:?}");
        }
        for line in fx["not_prompts"].as_array().unwrap() {
            let line = line.as_str().unwrap();
            assert!(!p.prompt.is_match(line), "no es prompt: {line:?}");
        }
        assert!(p.error.is_match("%Error opening tftp://10.0.0.5/x.bin (Timed out)"));
        assert!(!p.error.is_match("[OK - 33591768 bytes]"));
    }

    #[test]
    fn detects_command_completion() {
        let p = patterns();
        let cmd = "dir flash:";
        assert!(!finished(p, "Router#dir flash:", cmd));
        assert!(!finished(p, "Router#dir flash:\nDirectory of flash:/\n  1  -rw-  33591768  ios.bin", cmd));
        assert!(finished(p, "Router#dir flash:\nDirectory of flash:/\n  1  -rw- 1 a.bin\nRouter#", cmd));
        assert!(finished(p, "<HUAWEI>dir\n  0  -rw-  1  x.cc\n<HUAWEI>", "dir"));
        // Incremental: eco partido entre fragmentos y salida que llega por partes.
        let mut e = EchoScan::default();
        let mut out = String::from("Router#dir fl");
        assert!(!e.finished(p, &out, cmd));
        out.push_str("ash:\nDirectory of flash:/\n");
        assert!(!e.finished(p, &out, cmd));
        out.push_str("  1  -rw- 1 a.bin\nRouter#");
        assert!(e.finished(p, &out, cmd));
    }

    #[test]
    fn source_ip_uses_routing_table() {
        assert_eq!(source_ip_for("127.0.0.1").unwrap(), "127.0.0.1");
        assert!(source_ip_for("-x").is_err());
    }
}
