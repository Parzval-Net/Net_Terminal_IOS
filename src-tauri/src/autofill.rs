//! Autocompletado de la contraseña guardada al conectar. Mira solo la línea final de la
//! salida limpia (texto sin ANSI) y responde una única vez por conexión. Ante cualquier
//! señal de fallo o de un flujo distinto al login normal, se detiene para no bloquear
//! cuentas (TACACS/RADIUS) ni entregar la contraseña a un segundo prompt.

use std::time::{Duration, Instant};
use zeroize::Zeroizing;

/// Ventana desde la conexión en la que se acepta el prompt.
pub const WINDOW: Duration = Duration::from_secs(60);
const LINE_MAX: usize = 512;

/// Textos que cancelan el autocompletado: credencial rechazada o posible MITM.
const ABORT: [&str; 8] = [
    "permission denied",
    "access denied",
    "authentication failed",
    "% login invalid",
    "login incorrect",
    "% bad passwords",
    "remote host identification has changed",
    "possible dns spoofing",
];

/// Prompts de contraseña que no son el login: cambio de clave vencida, confirmaciones.
const NOT_LOGIN: [&str; 6] = ["new ", "old ", "current", "retype", "again", "confirm"];

const HOSTKEY: &str = "are you sure you want to continue connecting";

pub struct AutoFill {
    secret: Zeroizing<String>,
    /// Usuario para Telnet/Serial/TCP (SSH lo pasa con -l).
    user: Option<String>,
    newline: &'static str,
    started: Instant,
    line: String,
    user_sent: bool,
    done: bool,
    /// Con salto por un bastión (ProxyJump), host de destino que debe nombrar el prompt.
    /// El bastión pide su propia contraseña antes ("noc@bastion's password:") y no debe
    /// recibir la del equipo.
    only_host: Option<String>,
}

impl AutoFill {
    pub fn new(secret: Zeroizing<String>, user: Option<String>, newline: &'static str, started: Instant) -> Self {
        AutoFill { secret, user, newline, started, line: String::new(), user_sent: false, done: false, only_host: None }
    }

    /// Responde solo prompts de OpenSSH que nombran este host ("u@host's password:" o
    /// "(u@host) Password:"). Uno de otro host se deja al operador sin cancelar.
    pub fn only_host(mut self, host: Option<String>) -> Self {
        self.only_host = host.map(|h| h.trim().to_lowercase()).filter(|h| !h.is_empty());
        self
    }

    pub fn done(&self) -> bool {
        self.done
    }

    fn stop(&mut self) {
        self.done = true;
        self.line.clear();
    }

    /// Procesa texto limpio. Devuelve los bytes a enviar al equipo, si corresponde.
    pub fn feed(&mut self, text: &str, now: Instant) -> Option<Zeroizing<Vec<u8>>> {
        if self.done {
            return None;
        }
        if now.duration_since(self.started) > WINDOW {
            self.stop();
            return None;
        }
        for c in text.chars() {
            if c == '\n' {
                if aborts(&self.line) {
                    self.stop();
                    return None;
                }
                self.line.clear();
            } else {
                self.line.extend(c.to_lowercase());
            }
        }
        if self.line.len() > LINE_MAX {
            let mut cut = self.line.len() - LINE_MAX;
            while !self.line.is_char_boundary(cut) {
                cut += 1;
            }
            self.line.drain(..cut);
        }
        let line = self.line.trim_end();
        if aborts(line) {
            self.stop();
            return None;
        }
        // Confirmación de llave de host pendiente: nunca se responde.
        if line.contains(HOSTKEY) {
            return None;
        }
        if line.ends_with("password:") || line.ends_with("contraseña:") {
            if line.contains("passphrase") || NOT_LOGIN.iter().any(|w| line.contains(w)) {
                self.stop();
                return None;
            }
            if let Some(host) = self.only_host.as_deref() {
                if !names_host(line, host) {
                    return None;
                }
            }
            let mut out = Zeroizing::new(Vec::with_capacity(self.secret.len() + 2));
            out.extend_from_slice(self.secret.as_bytes());
            out.extend_from_slice(self.newline.as_bytes());
            // Una sola vez: un segundo prompt (enable, reintento, prompt falso) no se responde.
            self.stop();
            return Some(out);
        }
        if let Some(user) = self.user.as_deref() {
            if ["username:", "login:", "user name:", "usuario:"].iter().any(|p| line.ends_with(p)) {
                if self.user_sent {
                    // Volvió a pedir usuario: el login anterior falló.
                    self.stop();
                    return None;
                }
                self.user_sent = true;
                self.line.clear();
                return Some(Zeroizing::new(format!("{user}{}", self.newline).into_bytes()));
            }
        }
        None
    }
}

/// Por qué no se escribe la contraseña guardada que pide un script.
pub const NO_PROMPT: &str = "La pantalla no muestra un pedido de contraseña";
pub const NOT_LOGIN_PROMPT: &str = "El pedido no es el de inicio de sesión (passphrase, cambio de clave o confirmación)";
pub const AFTER_DENIED: &str = "El equipo acaba de rechazar una contraseña: no se reintenta";
pub const OTHER_HOST: &str = "El pedido de contraseña es de otro equipo, no del destino de la sesión";
/// Líneas anteriores al pedido que se revisan en busca de un rechazo.
const RECENT_LINES: usize = 4;

/// Pedido de contraseña que la pantalla muestra ahora (última línea del texto limpio), para que
/// un script escriba la contraseña guardada sin verla (`type_saved_password`). Mismas reglas que
/// el autocompletado: termina en "password:" o "contraseña:", no es una passphrase de llave ni
/// un cambio de clave, ninguna de las líneas recién anteriores es un rechazo ("Permission
/// denied", "% Login invalid") o una advertencia de llave de host, y si nombra un host al estilo
/// OpenSSH ("u@host's password:", "(u@host) Password:") debe ser `host`. Con `strict` (sesión
/// con bastión) el pedido tiene que nombrar al host. Devuelve el byte de `tail` donde empieza
/// la línea del pedido, que identifica ese pedido (se responde una sola vez).
pub fn screen_prompt(tail: &str, host: Option<&str>, strict: bool) -> Result<usize, &'static str> {
    let start = tail.rfind('\n').map_or(0, |i| i + 1);
    let line = tail[start..].trim().to_lowercase();
    if !(line.ends_with("password:") || line.ends_with("contraseña:")) {
        return Err(NO_PROMPT);
    }
    if line.contains("passphrase") || line.contains(HOSTKEY) || NOT_LOGIN.iter().any(|w| line.contains(w)) {
        return Err(NOT_LOGIN_PROMPT);
    }
    let recent = tail[..start].lines().rev().filter(|l| !l.trim().is_empty()).take(RECENT_LINES);
    if recent.map(str::to_lowercase).any(|l| aborts(&l)) {
        return Err(AFTER_DENIED);
    }
    let host = host.map(|h| h.trim().to_lowercase()).filter(|h| !h.is_empty());
    match host.as_deref() {
        Some(h) if names_host(&line, h) => {}
        Some(_) if strict || names_some_host(&line) => return Err(OTHER_HOST),
        None if names_some_host(&line) => return Err(OTHER_HOST),
        _ => {}
    }
    Ok(start)
}

/// El pedido nombra un host al estilo OpenSSH (de cualquier equipo).
fn names_some_host(line: &str) -> bool {
    let line = line.trim_start();
    (line.ends_with("'s password:") && line.contains('@')) || (line.starts_with('(') && line.contains('@') && line.contains(") "))
}

/// El prompt de contraseña es de OpenSSH para `host` (ya en minúsculas).
fn names_host(line: &str, host: &str) -> bool {
    let line = line.trim_start();
    line.ends_with(&format!("@{host}'s password:"))
        || (line.starts_with('(') && line.ends_with("password:") && line.contains(&format!("@{host}) ")))
}

fn aborts(line: &str) -> bool {
    ABORT.iter().any(|a| line.contains(a))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn af(user: Option<&str>) -> (AutoFill, Instant) {
        let t = Instant::now();
        (AutoFill::new(Zeroizing::new("S3cret".into()), user.map(Into::into), "\r", t), t)
    }

    fn sent(v: Option<Zeroizing<Vec<u8>>>) -> Option<String> {
        v.map(|b| String::from_utf8(b.to_vec()).unwrap())
    }

    #[test]
    fn fills_ssh_prompt_once() {
        let (mut a, t) = af(None);
        assert_eq!(sent(a.feed("Warning: banner\nnoc@10.0.0.1's pass", t)), None);
        assert_eq!(sent(a.feed("word: ", t)).as_deref(), Some("S3cret\r"));
        assert!(a.done());
        // Segundo prompt (enable, reintento o prompt falso): nada.
        assert_eq!(sent(a.feed("\nrouter>enable\nPassword: ", t)), None);
    }

    #[test]
    fn spanish_prompt_and_case() {
        let (mut a, t) = af(None);
        assert_eq!(sent(a.feed("CONTRASEÑA: ", t)).as_deref(), Some("S3cret\r"));
    }

    #[test]
    fn never_after_denied() {
        for denied in [
            "Permission denied, please try again.\n",
            "% Login invalid\n\n",
            "Access denied\n",
            "Authentication failed.\n",
        ] {
            let (mut a, t) = af(None);
            assert_eq!(sent(a.feed(denied, t)), None);
            assert_eq!(sent(a.feed("Password: ", t)), None, "{denied}");
        }
    }

    #[test]
    fn never_on_key_passphrase_or_hostkey() {
        let (mut a, t) = af(None);
        assert_eq!(sent(a.feed("Enter passphrase for key '/home/u/.ssh/id_ed25519': ", t)), None);
        let (mut a, t) = af(None);
        assert_eq!(
            sent(a.feed("Are you sure you want to continue connecting (yes/no/[fingerprint])? ", t)),
            None
        );
        assert!(!a.done());
        // Tras responder (línea completa), el prompt de contraseña sí se completa.
        assert_eq!(sent(a.feed("yes\nWarning: Permanently added.\nPassword: ", t)).as_deref(), Some("S3cret\r"));
        // Cambio de contraseña vencida: no se responde.
        let (mut a, t) = af(None);
        assert_eq!(sent(a.feed("(current) UNIX password: ", t)), None);
        assert!(a.done());
    }

    #[test]
    fn jump_host_prompt_is_not_answered() {
        let t = Instant::now();
        let mut a = AutoFill::new(Zeroizing::new("S3cret".into()), None, "\r", t).only_host(Some("10.0.0.1".into()));
        // El bastión pide su contraseña primero: no recibe la del equipo y no se cancela.
        assert_eq!(sent(a.feed("noc@bastion.example's password: ", t)), None);
        assert_eq!(sent(a.feed("\n(noc@bastion.example) Password: ", t)), None);
        assert!(!a.done());
        // Un "Password:" sin host (o de otro) tampoco.
        assert_eq!(sent(a.feed("\nPassword: ", t)), None);
        assert_eq!(sent(a.feed("\nnoc@10.0.0.10's password: ", t)), None);
        assert_eq!(sent(a.feed("\nnoc@10.0.0.1's password: ", t)).as_deref(), Some("S3cret\r"));
        // Keyboard-interactive de OpenSSH con prefijo (usuario@host).
        let mut a = AutoFill::new(Zeroizing::new("S3cret".into()), None, "\r", t).only_host(Some("Router1".into()));
        assert_eq!(sent(a.feed("(noc@router1) Password: ", t)).as_deref(), Some("S3cret\r"));
    }

    #[test]
    fn never_after_window() {
        let (mut a, t) = af(None);
        assert_eq!(sent(a.feed("Password: ", t + WINDOW + Duration::from_secs(1))), None);
        assert!(a.done());
    }

    #[test]
    fn screen_prompt_for_scripts() {
        // Pedidos de login: el que no nombra host y el de OpenSSH del destino.
        assert_eq!(screen_prompt("router con\nPassword: ", None, false), Ok(11));
        assert!(screen_prompt("Contraseña:", None, false).is_ok());
        assert!(screen_prompt("banner\nnoc@10.0.0.1's password: ", Some("10.0.0.1"), false).is_ok());
        assert!(screen_prompt("(noc@Router1) Password: ", Some("router1"), true).is_ok());
        // Sin pedido en la última línea: un prompt de comandos o un pedido ya respondido.
        for tail in ["router#", "Password: \nrouter>", "", "show run | i password:\nrouter#"] {
            assert_eq!(screen_prompt(tail, None, false), Err(NO_PROMPT), "{tail:?}");
        }
        // Passphrase de llave, cambio de clave, confirmación de llave de host.
        for tail in ["Enter passphrase for key '/home/u/.ssh/id_ed25519': password:", "(current) UNIX password:", "Retype new password:"] {
            assert_eq!(screen_prompt(tail, None, false), Err(NOT_LOGIN_PROMPT), "{tail:?}");
        }
        // Justo después de un rechazo (también con líneas vacías de por medio): nunca.
        for tail in [
            "Permission denied, please try again.\nnoc@10.0.0.1's password: ",
            "% Login invalid\n\nUsername: noc\nPassword: ",
            "Password: \n% Bad passwords\n\nPassword: ",
            "Access denied\nPassword:",
        ] {
            assert_eq!(screen_prompt(tail, Some("10.0.0.1"), false), Err(AFTER_DENIED), "{tail:?}");
        }
        // Un rechazo antiguo (varias líneas atrás) no impide un login nuevo.
        assert!(screen_prompt("% Login invalid\na\nb\nc\nd\ne\nPassword: ", None, false).is_ok());
        // Pedido de otro equipo: un ssh lanzado dentro de la sesión, o el bastión.
        assert_eq!(screen_prompt("noc@evil.example's password: ", Some("10.0.0.1"), false), Err(OTHER_HOST));
        assert_eq!(screen_prompt("(noc@evil.example) Password: ", None, false), Err(OTHER_HOST));
        assert_eq!(screen_prompt("noc@bastion's password: ", Some("10.0.0.1"), true), Err(OTHER_HOST));
        // Con bastión, un "Password:" que no nombra al destino tampoco.
        assert_eq!(screen_prompt("Password: ", Some("10.0.0.1"), true), Err(OTHER_HOST));
        assert!(screen_prompt("Password: ", Some("10.0.0.1"), false).is_ok());
    }

    #[test]
    fn telnet_username_then_password() {
        let (mut a, t) = af(Some("noc"));
        assert_eq!(sent(a.feed("\r\nUser Access Verification\n\nUsername: ", t)).as_deref(), Some("noc\r"));
        assert_eq!(sent(a.feed("noc\n", t)), None);
        assert_eq!(sent(a.feed("Password: ", t)).as_deref(), Some("S3cret\r"));
        // Login fallido: vuelve a pedir usuario y no se reintenta.
        let (mut a, t) = af(Some("noc"));
        a.feed("login: ", t);
        assert_eq!(sent(a.feed("noc\nlogin: ", t)), None);
        assert!(a.done());
        // Sin usuario configurado, el prompt de usuario se deja al operador.
        let (mut a, t) = af(None);
        assert_eq!(sent(a.feed("Username: ", t)), None);
        assert!(!a.done());
    }
}
