//! Logs de sesión en texto plano: nombre por patrón, anexar o archivo nuevo, rotación
//! diaria y enmascarado de secretos. Todo queda dentro de la carpeta de logs.

use regex::bytes::Regex;
use std::collections::HashMap;
use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

/// Patrón por defecto: el nombre que la app usó siempre (sesion_AAAAMMDD-HHMMSS.log).
pub const DEFAULT_PATTERN: &str = "{session}_{date}-{time}";
const MAX_PATTERN: usize = 200;
/// Largo máximo de cada parte de la ruta generada.
const MAX_PART: usize = 80;
/// Una línea sin fin (barra de progreso, binario) se enmascara y escribe pasado este tamaño.
const MAX_LINE: usize = 16 * 1024;

#[derive(Clone, Debug)]
pub struct LogOptions {
    pub timestamps: bool,
    pub pattern: String,
    /// Anexar al archivo si ya existe (si no, se crea uno nuevo con sufijo -2, -3…).
    pub append: bool,
    pub rotate_daily: bool,
    pub mask: bool,
}

impl Default for LogOptions {
    fn default() -> Self {
        Self { timestamps: false, pattern: DEFAULT_PATTERN.into(), append: false, rotate_daily: false, mask: true }
    }
}

/// Datos de la sesión que el patrón puede usar.
#[derive(Clone, Debug, Default)]
pub struct LogVars {
    pub session: String,
    pub host: String,
    pub folder: String,
}

/// Valida una carpeta de logs elegida por el usuario: ruta absoluta, carpeta existente
/// (se resuelven enlaces simbólicos), no la raíz del disco y con permiso de escritura
/// (se prueba creando y borrando un archivo).
pub fn validate_dir(path: &str) -> Result<PathBuf, String> {
    let p = Path::new(path);
    if !p.is_absolute() {
        return Err("La carpeta debe ser una ruta absoluta".into());
    }
    let dir = p.canonicalize().map_err(|_| "La carpeta no existe".to_string())?;
    if !dir.is_dir() {
        return Err("La ruta no es una carpeta".into());
    }
    if dir.parent().is_none() {
        return Err("No se puede usar la raíz del disco como carpeta de logs".into());
    }
    let probe = dir.join(format!(".netterminal-{}.tmp", uuid::Uuid::new_v4()));
    match OpenOptions::new().write(true).create_new(true).open(&probe) {
        Ok(_) => {
            let _ = std::fs::remove_file(&probe);
            Ok(dir)
        }
        Err(e) => Err(format!("Sin permiso de escritura en la carpeta: {e}")),
    }
}

/// Una parte saneada: letras, dígitos, "-", "_" y "."; sin "." inicial (ni "..").
fn sanitize_part(s: &str) -> String {
    let out: String = s
        .trim()
        .chars()
        .map(|c| if c.is_alphanumeric() || matches!(c, '-' | '_' | '.') { c } else { '_' })
        .take(MAX_PART)
        .collect();
    out.trim_start_matches('.').to_string()
}

/// Ruta relativa (dentro de la carpeta de logs) que genera el patrón, sin extensión.
/// Solo {folder} crea subcarpetas: cualquier "/" o "\" escrito en el patrón se reemplaza.
pub fn render(pattern: &str, vars: &LogVars, now: &chrono::DateTime<chrono::Local>) -> PathBuf {
    let pattern = if pattern.trim().is_empty() { DEFAULT_PATTERN } else { pattern };
    let mut dirs: Vec<String> = Vec::new();
    let mut name = String::new();
    // Corte en un límite de carácter: cortar en medio de un carácter multibyte abortaría la app.
    let mut cut = pattern.len().min(MAX_PATTERN);
    while !pattern.is_char_boundary(cut) {
        cut -= 1;
    }
    let mut rest: &str = &pattern[..cut];
    while let Some(c) = rest.chars().next() {
        if c == '{' {
            if let Some(end) = rest.find('}') {
                let value = match &rest[1..end] {
                    "session" => Some(sanitize_part(&vars.session)),
                    "host" => Some(sanitize_part(&vars.host)),
                    "date" => Some(now.format("%Y%m%d").to_string()),
                    "time" => Some(now.format("%H%M%S").to_string()),
                    "folder" => {
                        // Subcarpetas: cada nivel de la carpeta de la sesión, saneado. Lo escrito
                        // antes de {folder} queda como prefijo de la primera.
                        let mut parts = vars.folder.split(['/', '\\']).map(sanitize_part).filter(|p| !p.is_empty());
                        if let Some(first) = parts.next() {
                            dirs.push(sanitize_part(&(std::mem::take(&mut name) + &first)));
                            dirs.extend(parts);
                        }
                        rest = &rest[end + 1..];
                        // "{folder}/" equivale a "{folder}".
                        rest = rest.strip_prefix(['/', '\\']).unwrap_or(rest);
                        continue;
                    }
                    _ => None,
                };
                if let Some(v) = value {
                    name.push_str(&v);
                    rest = &rest[end + 1..];
                    continue;
                }
            }
        }
        name.push(if c.is_alphanumeric() || matches!(c, '-' | '_' | '.') { c } else { '_' });
        rest = &rest[c.len_utf8()..];
    }
    let mut file = sanitize_part(&name);
    if file.is_empty() {
        file = sanitize_part(&vars.session);
    }
    if file.is_empty() {
        file = "sesion".into();
    }
    let mut path: PathBuf = dirs.into_iter().filter(|d| !d.is_empty()).collect();
    path.push(file);
    path
}

/// Abre (o crea) el archivo de log que corresponde a `now`. Devuelve la ruta y si el archivo
/// ya tenía contenido (al anexar).
fn open_log(dir: &Path, opts: &LogOptions, vars: &LogVars, now: &chrono::DateTime<chrono::Local>) -> Result<(File, PathBuf, bool), String> {
    let rel = render(&opts.pattern, vars, now);
    // Defensa en profundidad: solo componentes normales, nunca "..", raíz ni unidad.
    if !rel.components().all(|c| matches!(c, Component::Normal(_))) {
        return Err("Nombre de log inválido".into());
    }
    let base = dir.join(&rel);
    let parent = base.parent().unwrap_or(dir);
    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    // Un enlace simbólico dentro de la carpeta de logs no puede sacar el archivo de ella.
    let root = dir.canonicalize().map_err(|e| e.to_string())?;
    if !parent.canonicalize().map_err(|e| e.to_string())?.starts_with(&root) {
        return Err("La ruta del log sale de la carpeta de logs".into());
    }
    let file_name = base.file_name().map(|f| f.to_string_lossy().into_owned()).unwrap_or_default();
    let with_ext = |suffix: &str| parent.join(format!("{file_name}{suffix}.log"));
    if opts.append {
        let path = with_ext("");
        let file = OpenOptions::new().create(true).append(true).open(&path).map_err(|e| e.to_string())?;
        crate::session_store::restrict(&path);
        let had = file.metadata().map(|m| m.len() > 0).unwrap_or(false);
        return Ok((file, path, had));
    }
    // Archivo nuevo: nunca se sobrescribe uno existente (dos sesiones en el mismo segundo).
    for n in 1..1000 {
        let path = if n == 1 { with_ext("") } else { with_ext(&format!("-{n}")) };
        match OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(file) => {
                // Salida de equipos: solo el usuario actual (600), también fuera de data/.
                crate::session_store::restrict(&path);
                return Ok((file, path, false));
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e.to_string()),
        }
    }
    Err("No se pudo crear un nombre de log libre".into())
}

/// Logs que rotaron: ruta anterior -> nueva. Al reconectar, el frontend pide continuar en la
/// ruta que conoce y se sigue en la última de la cadena.
fn rotated() -> &'static Mutex<HashMap<PathBuf, PathBuf>> {
    static R: OnceLock<Mutex<HashMap<PathBuf, PathBuf>>> = OnceLock::new();
    R.get_or_init(Mutex::default)
}

/// Último archivo de la cadena de rotación que empieza en `path`.
pub fn latest(path: PathBuf) -> PathBuf {
    let map = rotated().lock().unwrap_or_else(|e| e.into_inner());
    let mut cur = path;
    for _ in 0..10_000 {
        match map.get(&cur) {
            Some(next) if *next != cur => cur = next.clone(),
            _ => break,
        }
    }
    cur
}

/// Medianoche local siguiente al día `date`, en segundos Unix.
fn midnight_after(date: chrono::NaiveDate) -> Option<u64> {
    let next = date.succ_opt()?.and_hms_opt(0, 0, 0)?;
    let t = next.and_local_timezone(chrono::Local).earliest()?;
    u64::try_from(t.timestamp()).ok()
}

fn now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

/// Valores de credenciales en configuraciones de Cisco, Huawei, Juniper, Fortinet, Arista y
/// similares: se conserva la palabra clave y el tipo (5, 7, cipher, ENC…) y se oculta el valor.
/// Sin modo Unicode: funciona igual con logs en Latin-1 y el motor es de tiempo lineal.
fn secret_regex() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| {
        Regex::new(
            r#"(?i-u)\b(password|passwd|secret|psksecret|community|key-string|pre-shared-key|wpa-psk|authentication-key|auth-key|md5|key|auth|priv)(\s*[:=]\s*|\s+)((?:(?:[0-9]{1,3}|cipher|simple|irreversible-cipher|plain-text|encrypted|hidden|enc|ascii|hex|read|write|sha[0-9-]*|md5|aes[0-9-]*|3des|des)\s+)*)("[^"\n]*"|[^\s;]+)"#,
        )
        .expect("regex de enmascarado")
    })
}

/// Reemplaza por **** los valores secretos de una línea.
pub fn mask_line(line: &[u8]) -> std::borrow::Cow<'_, [u8]> {
    secret_regex().replace_all(line, &b"${1}${2}${3}****"[..])
}

/// Escritor del log: quita ANSI, agrega la hora, enmascara y rota.
pub struct LogWriter {
    file: File,
    path: PathBuf,
    dir: PathBuf,
    vars: LogVars,
    opts: LogOptions,
    stripper: crate::connection::AnsiStripper,
    line_start: bool,
    clean: Vec<u8>,
    out: Vec<u8>,
    /// Línea en curso cuando se enmascara (se procesa al completarse).
    line: Vec<u8>,
    line_stamp: Vec<u8>,
    /// Hora ya formateada para el segundo en curso (se formatea una vez por segundo).
    stamp: (u64, String),
    /// Segundo Unix en que cambia el día (solo con rotación diaria).
    rotate_at: Option<u64>,
}

impl LogWriter {
    /// Crea el archivo según el patrón. Devuelve el escritor y su ruta.
    pub fn create(dir: &Path, opts: LogOptions, vars: LogVars) -> Result<Self, String> {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        let opts = normalize(opts);
        let now = chrono::Local::now();
        let (file, path, had) = open_log(dir, &opts, &vars, &now)?;
        let mut w = Self::with_file(file, path, dir, opts, vars);
        w.rotate_at = w.opts.rotate_daily.then(|| midnight_after(now.date_naive())).flatten();
        if had {
            w.marker(&format!("\n── Sesión iniciada {} ──\n", now.format("%Y-%m-%d %H:%M:%S")));
        }
        Ok(w)
    }

    /// Continúa un log existente (reconexión). Si rotó mientras tanto, sigue en el último.
    pub fn resume(path: &Path, dir: &Path, opts: LogOptions, vars: LogVars) -> Result<Self, String> {
        let path = latest(path.to_path_buf());
        let file = OpenOptions::new().append(true).open(&path).map_err(|e| e.to_string())?;
        // El día del archivo es el de su última escritura: si cambió, se rota al escribir.
        let day = file
            .metadata()
            .and_then(|m| m.modified())
            .map(|t| chrono::DateTime::<chrono::Local>::from(t).date_naive())
            .unwrap_or_else(|_| chrono::Local::now().date_naive());
        let opts = normalize(opts);
        let mut w = Self::with_file(file, path, dir, opts, vars);
        w.rotate_at = w.opts.rotate_daily.then(|| midnight_after(day)).flatten();
        w.marker(&format!("\n── Reconectado {} ──\n", chrono::Local::now().format("%Y-%m-%d %H:%M:%S")));
        Ok(w)
    }

    fn with_file(file: File, path: PathBuf, dir: &Path, opts: LogOptions, vars: LogVars) -> Self {
        Self {
            file,
            path,
            dir: dir.to_path_buf(),
            vars,
            opts,
            stripper: Default::default(),
            line_start: true,
            clean: Vec::new(),
            out: Vec::new(),
            line: Vec::new(),
            line_stamp: Vec::new(),
            stamp: (u64::MAX, String::new()),
            rotate_at: None,
        }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    fn stamp(&mut self) -> &[u8] {
        let secs = now_secs();
        if self.stamp.0 != secs {
            self.stamp = (secs, chrono::Local::now().format("[%Y-%m-%d %H:%M:%S] ").to_string());
        }
        self.stamp.1.as_bytes()
    }

    /// Texto propio de la app (separadores): sin hora ni enmascarado.
    fn marker(&mut self, text: &str) {
        self.check_rotation();
        let _ = self.file.write_all(text.as_bytes());
    }

    /// Cambio de día: se continúa en un archivo nuevo con la fecha nueva.
    fn check_rotation(&mut self) {
        let Some(at) = self.rotate_at else { return };
        if now_secs() < at {
            return;
        }
        let now = chrono::Local::now();
        self.rotate_at = midnight_after(now.date_naive());
        let Ok((file, path, _)) = open_log(&self.dir, &self.opts, &self.vars, &now) else {
            return; // sin espacio o sin permisos: se sigue en el archivo actual
        };
        if path == self.path {
            return;
        }
        let name = |p: &Path| p.file_name().map(|f| f.to_string_lossy().into_owned()).unwrap_or_default();
        let _ = writeln!(self.file, "\n── Sigue en {} ──", name(&path));
        self.file = file;
        let _ = writeln!(self.file, "── Continúa de {} ──", name(&self.path));
        rotated().lock().unwrap_or_else(|e| e.into_inner()).insert(self.path.clone(), path.clone());
        self.path = path;
    }

    pub fn write(&mut self, bytes: &[u8]) {
        let mut clean = std::mem::take(&mut self.clean);
        clean.clear();
        self.stripper.strip_into(bytes, &mut clean);
        if !clean.is_empty() {
            self.check_rotation();
            if self.opts.mask {
                self.write_masked(&clean);
            } else {
                self.write_plain(&clean);
            }
        }
        self.clean = clean;
    }

    fn write_plain(&mut self, clean: &[u8]) {
        if self.opts.timestamps {
            let mut out = std::mem::take(&mut self.out);
            out.clear();
            for &b in clean {
                if self.line_start {
                    out.extend_from_slice(self.stamp());
                }
                self.line_start = b == b'\n';
                out.push(b);
            }
            let _ = self.file.write_all(&out);
            self.out = out;
        } else {
            if let Some(&last) = clean.last() {
                self.line_start = last == b'\n';
            }
            let _ = self.file.write_all(clean);
        }
    }

    /// Enmascarado por línea completa: un secreto que llega en varios fragmentos se ve entero.
    /// Las líneas del fragmento se escriben juntas (una sola escritura al disco).
    fn write_masked(&mut self, clean: &[u8]) {
        self.out.clear();
        let mut rest = clean;
        while !rest.is_empty() {
            if self.line.is_empty() && self.opts.timestamps {
                self.stamp();
                self.line_stamp.clear();
                self.line_stamp.extend_from_slice(self.stamp.1.as_bytes());
            }
            match rest.iter().position(|&b| b == b'\n') {
                Some(i) => {
                    self.line.extend_from_slice(&rest[..=i]);
                    rest = &rest[i + 1..];
                    self.emit_line();
                }
                None => {
                    self.line.extend_from_slice(rest);
                    rest = &[];
                    if self.line.len() >= MAX_LINE {
                        self.emit_line();
                    }
                }
            }
        }
        if !self.out.is_empty() {
            let _ = self.file.write_all(&self.out);
        }
    }

    /// Agrega la línea en curso, enmascarada, a `out`.
    fn emit_line(&mut self) {
        if self.line.is_empty() {
            return;
        }
        self.out.extend_from_slice(&self.line_stamp);
        self.out.extend_from_slice(&mask_line(&self.line));
        self.line.clear();
        self.line_stamp.clear();
    }
}

impl Drop for LogWriter {
    /// La línea a medias (por ejemplo el prompt final) también queda en el archivo.
    fn drop(&mut self) {
        self.out.clear();
        self.emit_line();
        let _ = self.file.write_all(&self.out);
    }
}

fn normalize(mut opts: LogOptions) -> LogOptions {
    if opts.pattern.trim().is_empty() || opts.pattern.len() > MAX_PATTERN {
        opts.pattern = DEFAULT_PATTERN.into();
    }
    // Rotar sin {date} repetiría el nombre: se agrega la fecha al final.
    if opts.rotate_daily && !opts.pattern.contains("{date}") {
        opts.pattern.push_str("_{date}");
    }
    opts
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vars() -> LogVars {
        LogVars { session: "core sw/01".into(), host: "10.0.0.1".into(), folder: "Clientes/Sitio A".into() }
    }

    fn tmp() -> PathBuf {
        let d = std::env::temp_dir().join(format!("nt-logfile-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn renders_pattern_variables() {
        let now = chrono::Local::now();
        let date = now.format("%Y%m%d").to_string();
        let time = now.format("%H%M%S").to_string();
        assert_eq!(render(DEFAULT_PATTERN, &vars(), &now), PathBuf::from(format!("core_sw_01_{date}-{time}")));
        assert_eq!(render("{host}_{date}", &vars(), &now), PathBuf::from(format!("10.0.0.1_{date}")));
        assert_eq!(
            render("{folder}/{session}", &vars(), &now),
            ["Clientes", "Sitio_A", "core_sw_01"].iter().collect::<PathBuf>()
        );
        // Variables desconocidas y llaves sueltas quedan como texto saneado.
        assert_eq!(render("x{nope}{", &vars(), &now), PathBuf::from("x_nope__"));
        assert_eq!(render("", &vars(), &now), render(DEFAULT_PATTERN, &vars(), &now));
        // Un patrón largo con caracteres multibyte se corta sin abortar.
        let long = format!("a{}", "ñ".repeat(150));
        assert!(!render(&long, &vars(), &now).as_os_str().is_empty());
    }

    #[test]
    fn pattern_cannot_escape_the_logs_folder() {
        let now = chrono::Local::now();
        let mut v = vars();
        for p in ["../../etc/passwd", "/etc/passwd", "..\\..\\x", "C:\\x", "{session}/../x"] {
            let r = render(p, &v, &now);
            assert!(r.components().all(|c| matches!(c, Component::Normal(_))), "{p} -> {r:?}");
            assert_eq!(r.components().count(), 1, "{p} -> {r:?}");
        }
        v.folder = "../../../tmp/x".into();
        v.session = "..".into();
        v.host = "../h".into();
        let r = render("{folder}{session}{host}", &v, &now);
        assert!(r.components().all(|c| matches!(c, Component::Normal(_))), "{r:?}");
        assert!(!r.to_string_lossy().contains(".."), "{r:?}");
        let dir = tmp();
        let w = LogWriter::create(&dir, LogOptions { pattern: "{folder}{session}".into(), ..Default::default() }, v).unwrap();
        assert!(w.path().starts_with(&dir));
        drop(w);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn validate_dir_rejects_relative_missing_and_root() {
        assert!(validate_dir("logs").is_err());
        assert!(validate_dir("/").is_err());
        let dir = tmp();
        assert!(validate_dir(&dir.join("no-existe").to_string_lossy()).is_err());
        let ok = validate_dir(&dir.to_string_lossy()).unwrap();
        assert_eq!(ok, dir.canonicalize().unwrap());
        // La prueba de escritura no deja rastro.
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 0);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn log_files_are_private() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tmp();
        let w = LogWriter::create(&dir, LogOptions { pattern: "p".into(), ..Default::default() }, vars()).unwrap();
        let mode = std::fs::metadata(w.path()).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
        drop(w);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn new_file_never_overwrites_and_append_reuses() {
        let dir = tmp();
        let o = LogOptions { pattern: "{host}".into(), ..Default::default() };
        let mut a = LogWriter::create(&dir, o.clone(), vars()).unwrap();
        a.write(b"uno\n");
        let b = LogWriter::create(&dir, o.clone(), vars()).unwrap();
        assert_eq!(a.path().file_name().unwrap(), "10.0.0.1.log");
        assert_eq!(b.path().file_name().unwrap(), "10.0.0.1-2.log");
        drop((a, b));
        let mut c = LogWriter::create(&dir, LogOptions { append: true, ..o }, vars()).unwrap();
        c.write(b"dos\n");
        let p = c.path().to_path_buf();
        drop(c);
        let text = std::fs::read_to_string(p).unwrap();
        assert!(text.starts_with("uno\n") && text.contains("Sesión iniciada") && text.ends_with("dos\n"), "{text}");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn rotates_when_the_day_changes() {
        let dir = tmp();
        let o = LogOptions { pattern: "{session}".into(), rotate_daily: true, ..Default::default() };
        let mut w = LogWriter::create(&dir, o, vars()).unwrap();
        let today = chrono::Local::now().format("%Y%m%d").to_string();
        assert_eq!(w.path().file_name().unwrap().to_string_lossy(), format!("core_sw_01_{today}.log"));
        w.write(b"antes\n");
        // Simula que el archivo es de ayer: con la fecha forzada cambia el nombre.
        let old = dir.join("core_sw_01_19990101.log");
        std::fs::rename(w.path(), &old).unwrap();
        w.path = old.clone();
        w.rotate_at = Some(0);
        w.write(b"despues\n");
        assert_eq!(w.path().file_name().unwrap().to_string_lossy(), format!("core_sw_01_{today}.log"));
        let new_path = w.path().to_path_buf();
        drop(w);
        let a = std::fs::read_to_string(&old).unwrap();
        let b = std::fs::read_to_string(&new_path).unwrap();
        assert!(a.starts_with("antes\n") && a.contains("Sigue en") && !a.contains("despues"), "{a}");
        assert!(b.contains("Continúa de core_sw_01_19990101.log") && b.ends_with("despues\n"), "{b}");
        // Reconectar sobre la ruta vieja continúa en la nueva.
        assert_eq!(latest(old.clone()), new_path);
        let r = LogWriter::resume(&old, &dir, LogOptions { rotate_daily: true, ..Default::default() }, vars()).unwrap();
        assert_eq!(r.path(), new_path);
        drop(r);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn masks_secrets_by_vendor() {
        let m = |s: &str| String::from_utf8(mask_line(s.as_bytes()).into_owned()).unwrap();
        let cases = [
            ("enable secret 5 $1$mERr$hx5rVt7rPNoS4wqbXKX7m0", "enable secret 5 ****"),
            ("username admin privilege 15 secret 9 $9$abc", "username admin privilege 15 secret 9 ****"),
            ("username noc password 7 0822455D0A16", "username noc password 7 ****"),
            ("snmp-server community S3cr3t RO 10", "snmp-server community **** RO 10"),
            (" key-string 7 0822455D0A16", " key-string 7 ****"),
            ("crypto isakmp key MiClave address 192.0.2.1", "crypto isakmp key **** address 192.0.2.1"),
            ("tacacs-server key 7 1234ABCD", "tacacs-server key 7 ****"),
            ("ip ospf message-digest-key 1 md5 7 0822", "ip ospf message-digest-key 1 md5 7 ****"),
            ("snmp-server user u g v3 auth sha AuthP4ss priv aes 128 PrivP4ss", "snmp-server user u g v3 auth sha **** priv aes 128 ****"),
            (" local-user admin password irreversible-cipher $1c$x$y", " local-user admin password irreversible-cipher ****"),
            (" pre-shared-key cipher %^%#abc%^%#", " pre-shared-key cipher ****"),
            (" snmp-agent community read cipher %^%#x", " snmp-agent community read cipher ****"),
            ("    set password ENC SH2abc", "    set password ENC ****"),
            ("    set psksecret ENC abc", "    set psksecret ENC ****"),
            ("encrypted-password \"$6$abc\"; ## SECRET-DATA", "encrypted-password ****; ## SECRET-DATA"),
            ("authentication-key \"$9$x\";", "authentication-key ****;"),
            ("Password: hunter2", "Password: ****"),
        ];
        for (input, want) in cases {
            assert_eq!(m(input), want, "{input}");
        }
        // Lo que no es un secreto no cambia.
        for keep in ["no service password-encryption", "Password:", "aaa authentication login default local", "privilege exec level 15 show"] {
            assert_eq!(m(keep), keep);
        }
        // Bytes no UTF-8 (Latin-1) no rompen el enmascarado.
        assert_eq!(&*mask_line(b"secret 0 cl\xe1ve"), b"secret 0 ****");
    }

    #[test]
    fn masking_sees_lines_split_across_chunks() {
        let dir = tmp();
        let o = LogOptions { pattern: "m".into(), timestamps: true, ..Default::default() };
        let mut w = LogWriter::create(&dir, o, vars()).unwrap();
        w.write(b"\x1b[1mRouter#\x1b[0m show run | i sec\r\nenable sec");
        w.write(b"ret 5 $1$abc\r\nRouter#");
        let p = w.path().to_path_buf();
        drop(w);
        let text = std::fs::read_to_string(p).unwrap();
        let lines: Vec<_> = text.lines().collect();
        assert_eq!(lines.len(), 3, "{text}");
        assert!(lines[0].ends_with("] Router# show run | i sec"));
        assert!(lines[1].ends_with("] enable secret 5 ****"), "{}", lines[1]);
        assert!(lines[2].ends_with("] Router#"));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    /// cargo test --release -- --ignored --nocapture bench_log
    #[test]
    #[ignore]
    fn bench_log_masking() {
        let dir = tmp();
        let line = "\x1b[32mGi1/0/1\x1b[0m   connected    10   a-full a-1000 10/100/1000BaseTX áé\r\n";
        let chunk: Vec<u8> = line.repeat(1024 / line.len() + 1).into_bytes()[..1024].to_vec();
        for mask in [false, true] {
            let o = LogOptions { pattern: format!("b{mask}"), timestamps: true, mask, ..Default::default() };
            let mut w = LogWriter::create(&dir, o, vars()).unwrap();
            let total = 16 * 1024;
            let t = std::time::Instant::now();
            for _ in 0..total {
                w.write(&chunk);
            }
            let s = t.elapsed().as_secs_f64();
            println!("log con hora, enmascarado={mask}: {:.0} MB/s", 16.0 / s);
        }
        std::fs::remove_dir_all(&dir).unwrap();
    }
}
