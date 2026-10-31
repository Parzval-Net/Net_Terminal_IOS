//! Notas en texto plano dentro de `<datos>/notes`, editables también con cualquier editor.
//!
//! Una nota puede protegerse con contraseña: pasa a `<nombre>.ntenc` (XChaCha20-Poly1305 con
//! llave Argon2id propia de la nota) y se borra el `.txt`. Si por un corte quedan ambos
//! archivos, manda el cifrado: el `.txt` se ignora y se borra al desbloquear la nota.
//! Las notas protegidas no entran en la búsqueda ni las expone ninguna otra función.

use crate::seal::{self, derive, random, write_atomic, Kdf, Throttle, KDF_DEFAULT};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use zeroize::Zeroizing;

#[derive(Serialize)]
pub struct NoteInfo {
    pub name: String,
    pub modified: u64,
    /// Cifrada con contraseña: el contenido no se lista, no se busca ni se lee sin desbloquear.
    pub protected: bool,
}

const TXT: &str = "txt";
const ENC: &str = "ntenc";
pub const PROTECTED: &str = "La nota está protegida con contraseña";

fn file_for(dir: &Path, name: &str) -> Result<PathBuf, String> {
    path_for(dir, name, TXT)
}

fn enc_for(dir: &Path, name: &str) -> Result<PathBuf, String> {
    path_for(dir, name, ENC)
}

pub fn is_protected(dir: &Path, name: &str) -> bool {
    enc_for(dir, name).map(|p| p.exists()).unwrap_or(false)
}

/// Nombre seguro: sin separadores de ruta ni caracteres reservados en Windows.
fn path_for(dir: &Path, name: &str, ext: &str) -> Result<PathBuf, String> {
    let clean: String = name
        .trim()
        .chars()
        .filter(|c| !matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') && !c.is_control())
        .collect();
    let clean = clean.trim_matches('.').trim();
    if clean.is_empty() {
        return Err("Nombre de nota inválido".into());
    }
    Ok(dir.join(format!("{clean}.{ext}")))
}

pub fn list(dir: &Path) -> Vec<NoteInfo> {
    let _ = fs::create_dir_all(dir);
    let mut notes: Vec<NoteInfo> = fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|e| {
            let path = e.path();
            let protected = match path.extension()?.to_str()? {
                TXT => false,
                ENC => true,
                _ => return None,
            };
            // Restos de un corte entre cifrar y borrar el original: manda el cifrado.
            if !protected && path.with_extension(ENC).exists() {
                return None;
            }
            let modified = e
                .metadata()
                .ok()?
                .modified()
                .ok()?
                .duration_since(std::time::UNIX_EPOCH)
                .ok()?
                .as_secs();
            Some(NoteInfo {
                name: path.file_stem()?.to_string_lossy().into_owned(),
                modified,
                protected,
            })
        })
        .collect();
    notes.sort_by_key(|n| std::cmp::Reverse(n.modified));
    notes
}

pub fn read(dir: &Path, name: &str) -> Result<String, String> {
    if is_protected(dir, name) {
        return Err(PROTECTED.into());
    }
    // Lectura tolerante: una nota guardada en Windows-1252 por otro editor no debe verse vacía
    // (y sobrescribirse con la primera tecla).
    let bytes = fs::read(file_for(dir, name)?).map_err(|e| e.to_string())?;
    Ok(String::from_utf8(bytes).unwrap_or_else(|e| e.into_bytes().iter().map(|&b| b as char).collect()))
}

pub fn save(dir: &Path, name: &str, content: &str) -> Result<(), String> {
    // Nunca se escribe en claro una nota protegida (p. ej. un autoguardado tardío).
    if is_protected(dir, name) {
        return Err(PROTECTED.into());
    }
    write_txt(dir, name, content)
}

fn write_txt(dir: &Path, name: &str, content: &str) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let path = file_for(dir, name)?;
    let tmp = path.with_extension("txt.tmp");
    fs::write(&tmp, content).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

pub fn rename(dir: &Path, from: &str, to: &str) -> Result<String, String> {
    let (src, dst) = if is_protected(dir, from) {
        // Un .txt sobrante del mismo nombre se descarta: manda el cifrado.
        let _ = fs::remove_file(file_for(dir, from)?);
        (enc_for(dir, from)?, enc_for(dir, to)?)
    } else {
        (file_for(dir, from)?, file_for(dir, to)?)
    };
    if file_for(dir, to)?.exists() || enc_for(dir, to)?.exists() {
        return Err("Ya existe una nota con ese nombre".into());
    }
    fs::rename(&src, &dst).map_err(|e| e.to_string())?;
    Ok(dst.file_stem().unwrap_or_default().to_string_lossy().into_owned())
}

pub fn delete(dir: &Path, name: &str) -> Result<(), String> {
    let enc = enc_for(dir, name)?;
    let txt = file_for(dir, name)?;
    if enc.exists() {
        fs::remove_file(&enc).map_err(|e| e.to_string())?;
        let _ = fs::remove_file(&txt);
        return Ok(());
    }
    fs::remove_file(txt).map_err(|e| e.to_string())
}

/// Coincidencia de búsqueda en una nota.
#[derive(Serialize, Debug)]
pub struct NoteMatch {
    pub name: String,
    /// Línea (desde 1).
    pub line: usize,
    pub snippet: String,
    /// Nota protegida cuyo nombre coincide: su contenido no se busca (línea 0, sin fragmento).
    pub protected: bool,
}

/// Máximo de resultados y tamaño de nota que se revisa (las notas grandes se omiten).
const SEARCH_MAX_RESULTS: usize = 200;
const SEARCH_MAX_FILE: u64 = 2 * 1024 * 1024;
const SNIPPET_CHARS: usize = 160;

/// Busca texto plano sin distinguir mayúsculas en todas las notas (las más recientes primero).
pub fn search(dir: &Path, query: &str) -> Vec<NoteMatch> {
    let q: Vec<char> = query.trim().to_lowercase().chars().collect();
    if q.is_empty() || q.len() > 200 {
        return Vec::new();
    }
    let mut out = Vec::new();
    for note in list(dir) {
        if note.protected {
            if note.name.to_lowercase().contains(&q.iter().collect::<String>()) {
                out.push(NoteMatch { name: note.name, line: 0, snippet: String::new(), protected: true });
            }
            continue;
        }
        let Ok(path) = file_for(dir, &note.name) else { continue };
        if fs::metadata(&path).map(|m| m.len() > SEARCH_MAX_FILE).unwrap_or(true) {
            continue;
        }
        let Ok(text) = read(dir, &note.name) else { continue };
        for (i, line) in text.lines().enumerate() {
            let chars: Vec<char> = line.chars().collect();
            // Comparación carácter a carácter: la posición sirve directo para el fragmento.
            let lower: Vec<char> = chars.iter().map(|c| c.to_lowercase().next().unwrap_or(*c)).collect();
            let Some(pos) = lower.windows(q.len()).position(|w| w == q.as_slice()) else { continue };
            out.push(NoteMatch { name: note.name.clone(), line: i + 1, snippet: snippet(&chars, pos, q.len()), protected: false });
            if out.len() >= SEARCH_MAX_RESULTS {
                return out;
            }
        }
    }
    out
}

/// Fragmento de la línea alrededor de la coincidencia, sin espacios iniciales.
fn snippet(chars: &[char], pos: usize, len: usize) -> String {
    if chars.len() <= SNIPPET_CHARS {
        return chars.iter().collect::<String>().trim().to_string();
    }
    let start = pos.saturating_sub((SNIPPET_CHARS.saturating_sub(len)) / 2).min(chars.len() - SNIPPET_CHARS);
    let end = start + SNIPPET_CHARS;
    let mut s: String = chars[start..end].iter().collect();
    if start > 0 {
        s = format!("…{}", s.trim_start());
    }
    if end < chars.len() {
        s.push('…');
    }
    s
}

// ---------- Notas protegidas con contraseña ----------
//
// Formato `.ntenc` (v1): "NTNOTES" | versión | Argon2id m,t,p (u32 LE) | sal (16) | nonce (24)
// seguido del texto cifrado con XChaCha20-Poly1305. La cabecera completa va como AAD: cambiar
// los parámetros, la sal o el nonce invalida el archivo.

const MAGIC: &[u8; 7] = b"NTNOTES";
const VERSION: u8 = 1;
const HEADER_LEN: usize = 7 + 1 + 12 + 16 + 24;
const MAX_ENC_FILE: u64 = 8 * 1024 * 1024;
const MAX_CONTENT: usize = 4 * 1024 * 1024;
const MIN_PASSWORD: usize = 8;
const MAX_PASSWORD: usize = 1024;
/// Inactividad permitida (la elige el usuario) y margen del backend sobre el temporizador
/// del frontend: si la interfaz no bloquea (recarga, error), la llave caduca igual.
const IDLE_MIN: u64 = 60;
const IDLE_MAX: u64 = 60 * 60;
const IDLE_GRACE: Duration = Duration::from_secs(60);

pub const NOTE_LOCKED: &str = "La nota está bloqueada. Ingresa su contraseña para abrirla";
const BAD_PASSWORD: &str = "Contraseña incorrecta o archivo de la nota alterado";
const BAD_FILE: &str = "El archivo de la nota protegida no es válido";

struct EncHeader {
    kdf: Kdf,
    salt: [u8; 16],
    nonce: [u8; 24],
}

impl EncHeader {
    fn encode(&self) -> [u8; HEADER_LEN] {
        let mut h = [0u8; HEADER_LEN];
        h[..7].copy_from_slice(MAGIC);
        h[7] = VERSION;
        self.kdf.encode(&mut h[8..20]);
        h[20..36].copy_from_slice(&self.salt);
        h[36..60].copy_from_slice(&self.nonce);
        h
    }

    fn decode(b: &[u8]) -> Result<EncHeader, String> {
        if b.len() < HEADER_LEN + 16 || &b[..7] != MAGIC {
            return Err(BAD_FILE.into());
        }
        if b[7] != VERSION {
            return Err("La nota se protegió con una versión más nueva de NetTerminal".into());
        }
        let kdf = Kdf::decode(&b[8..20]);
        if !kdf.sane() {
            return Err(BAD_FILE.into());
        }
        let mut salt = [0u8; 16];
        salt.copy_from_slice(&b[20..36]);
        let mut nonce = [0u8; 24];
        nonce.copy_from_slice(&b[36..60]);
        Ok(EncHeader { kdf, salt, nonce })
    }
}

fn check_password(p: &str) -> Result<(), String> {
    if p.chars().count() < MIN_PASSWORD {
        return Err(format!("La contraseña debe tener al menos {MIN_PASSWORD} caracteres"));
    }
    if p.len() > MAX_PASSWORD {
        return Err("La contraseña es demasiado larga".into());
    }
    Ok(())
}

fn read_enc(path: &Path) -> Result<(EncHeader, Vec<u8>), String> {
    let meta = fs::metadata(path).map_err(|_| "La nota no existe".to_string())?;
    if meta.len() > MAX_ENC_FILE {
        return Err(BAD_FILE.into());
    }
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    Ok((EncHeader::decode(&bytes)?, bytes))
}

fn open_with(key: &[u8; 32], h: &EncHeader, bytes: &[u8]) -> Result<Zeroizing<String>, String> {
    let plain = seal::decrypt(key, &h.nonce, &bytes[HEADER_LEN..], &bytes[..HEADER_LEN]).map_err(|_| BAD_PASSWORD.to_string())?;
    let text = std::str::from_utf8(&plain).map_err(|_| BAD_FILE.to_string())?;
    Ok(Zeroizing::new(text.to_string()))
}

/// Cifra con nonce nuevo en cada escritura (misma llave y sal) y guarda con permisos 600.
fn seal_write(path: &Path, key: &[u8; 32], kdf: Kdf, salt: [u8; 16], content: &str) -> Result<(), String> {
    if content.len() > MAX_CONTENT {
        return Err("La nota protegida supera el máximo de 4 MB".into());
    }
    let header = EncHeader { kdf, salt, nonce: random() };
    let head = header.encode();
    let ct = seal::encrypt(key, &header.nonce, content.as_bytes(), &head)?;
    let mut out = Vec::with_capacity(HEADER_LEN + ct.len());
    out.extend_from_slice(&head);
    out.extend_from_slice(&ct);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    write_atomic(path, &out)
}

/// Nota desbloqueada: solo una a la vez (abrir otra bloquea la anterior).
struct Unlocked {
    name: String,
    key: Zeroizing<[u8; 32]>,
    kdf: Kdf,
    salt: [u8; 16],
    idle: Duration,
    last: Instant,
}

#[derive(Default)]
struct SecureInner {
    open: Option<Unlocked>,
    throttle: Throttle,
}

/// Llave en memoria de la nota abierta. Nunca guarda ni devuelve la contraseña.
pub struct SecureNotes {
    kdf: Kdf,
    inner: Mutex<SecureInner>,
}

impl Default for SecureNotes {
    fn default() -> Self {
        Self::with(KDF_DEFAULT)
    }
}

fn idle(secs: u64) -> Duration {
    Duration::from_secs(secs.clamp(IDLE_MIN, IDLE_MAX)) + IDLE_GRACE
}

impl SecureNotes {
    pub fn with(kdf: Kdf) -> Self {
        SecureNotes { kdf, inner: Mutex::default() }
    }

    fn inner(&self) -> std::sync::MutexGuard<'_, SecureInner> {
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Llave de la nota `name` si está desbloqueada y no caducó por inactividad.
    fn active<'a>(inner: &'a mut SecureInner, name: &str) -> Result<&'a mut Unlocked, String> {
        if inner.open.as_ref().is_some_and(|o| o.last.elapsed() > o.idle) {
            inner.open = None;
        }
        match inner.open.as_mut() {
            Some(o) if o.name == name => Ok(o),
            _ => Err(NOTE_LOCKED.into()),
        }
    }

    /// Cifra una nota en texto plano y borra el `.txt`. Queda desbloqueada para seguir editando.
    pub fn protect(&self, dir: &Path, name: &str, password: &str, idle_secs: u64) -> Result<(), String> {
        check_password(password)?;
        let enc = enc_for(dir, name)?;
        if enc.exists() {
            return Err("La nota ya está protegida".into());
        }
        let txt = file_for(dir, name)?;
        let content = Zeroizing::new(read(dir, name)?);
        let salt = random::<16>();
        let key = derive(password, &salt, self.kdf)?;
        seal_write(&enc, &key, self.kdf, salt, &content)?;
        // Se borra el original. En SSD/APFS sobrescribir antes de borrar no garantiza nada
        // (copy-on-write, nivelación de desgaste): para eso está el cifrado de disco del sistema.
        fs::remove_file(&txt).map_err(|e| format!("La nota quedó cifrada, pero no se pudo borrar el original: {e}"))?;
        let mut inner = self.inner();
        inner.open = Some(Unlocked { name: name.to_string(), key, kdf: self.kdf, salt, idle: idle(idle_secs), last: Instant::now() });
        Ok(())
    }

    /// Desbloquea y devuelve el contenido. Espera exponencial tras cada contraseña incorrecta.
    pub fn unlock(&self, dir: &Path, name: &str, password: &str, idle_secs: u64) -> Result<Zeroizing<String>, String> {
        if password.len() > MAX_PASSWORD {
            return Err("La contraseña es demasiado larga".into());
        }
        let mut inner = self.inner();
        inner.open = None;
        inner.throttle.check()?;
        let (h, bytes) = read_enc(&enc_for(dir, name)?)?;
        let key = derive(password, &h.salt, h.kdf)?;
        let text = match open_with(&key, &h, &bytes) {
            Ok(t) => t,
            Err(e) => {
                inner.throttle.fail();
                return Err(e);
            }
        };
        inner.throttle.reset();
        // Restos en claro de un corte anterior (ver encabezado del módulo).
        let _ = fs::remove_file(file_for(dir, name)?);
        inner.open = Some(Unlocked { name: name.to_string(), key, kdf: h.kdf, salt: h.salt, idle: idle(idle_secs), last: Instant::now() });
        Ok(text)
    }

    /// Autoguardado: vuelve a cifrar con la llave en memoria y un nonce nuevo.
    pub fn save(&self, dir: &Path, name: &str, content: &str) -> Result<(), String> {
        let mut inner = self.inner();
        let o = Self::active(&mut inner, name)?;
        seal_write(&enc_for(dir, name)?, &o.key, o.kdf, o.salt, content)?;
        o.last = Instant::now();
        Ok(())
    }

    /// Actividad del usuario con la nota abierta (posterga el bloqueo por inactividad).
    pub fn touch(&self, name: &str) -> bool {
        let mut inner = self.inner();
        Self::active(&mut inner, name).map(|o| o.last = Instant::now()).is_ok()
    }

    pub fn lock(&self) {
        self.inner().open = None;
    }

    /// Quita la protección (la nota debe estar desbloqueada): vuelve a `.txt` y borra el cifrado.
    pub fn unprotect(&self, dir: &Path, name: &str) -> Result<(), String> {
        let mut inner = self.inner();
        let o = Self::active(&mut inner, name)?;
        let enc = enc_for(dir, name)?;
        let (h, bytes) = read_enc(&enc)?;
        let content = open_with(&o.key, &h, &bytes)?;
        write_txt(dir, name, &content)?;
        fs::remove_file(&enc).map_err(|e| e.to_string())?;
        inner.open = None;
        Ok(())
    }

    /// Cambia la contraseña: exige la actual y genera sal nueva.
    pub fn change(&self, dir: &Path, name: &str, old: &str, new: &str) -> Result<(), String> {
        check_password(new)?;
        if old.len() > MAX_PASSWORD {
            return Err("La contraseña es demasiado larga".into());
        }
        let mut inner = self.inner();
        inner.throttle.check()?;
        let enc = enc_for(dir, name)?;
        let (h, bytes) = read_enc(&enc)?;
        let old_key = derive(old, &h.salt, h.kdf)?;
        let content = match open_with(&old_key, &h, &bytes) {
            Ok(c) => c,
            Err(e) => {
                inner.throttle.fail();
                return Err(e);
            }
        };
        inner.throttle.reset();
        let salt = random::<16>();
        let key = derive(new, &salt, self.kdf)?;
        seal_write(&enc, &key, self.kdf, salt, &content)?;
        if let Some(o) = inner.open.as_mut().filter(|o| o.name == name) {
            o.key = key;
            o.kdf = self.kdf;
            o.salt = salt;
            o.last = Instant::now();
        }
        Ok(())
    }

    /// Mantiene desbloqueada la nota tras renombrarla.
    pub fn renamed(&self, from: &str, to: &str) {
        if let Some(o) = self.inner().open.as_mut().filter(|o| o.name == from) {
            o.name = to.to_string();
        }
    }

    pub fn forget(&self, name: &str) {
        let mut inner = self.inner();
        if inner.open.as_ref().is_some_and(|o| o.name == name) {
            inner.open = None;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitizes_names_and_roundtrips() {
        let dir = std::env::temp_dir().join(format!("nt-notes-{}", std::process::id()));
        save(&dir, "../../etc/pass:wd", "hola").unwrap();
        assert!(dir.join("etcpasswd.txt").exists());
        assert_eq!(read(&dir, "etcpasswd").unwrap(), "hola");
        assert_eq!(rename(&dir, "etcpasswd", "cambio CR-123").unwrap(), "cambio CR-123");
        assert_eq!(list(&dir).len(), 1);
        delete(&dir, "cambio CR-123").unwrap();
        assert!(file_for(&dir, "..").is_err());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn searches_all_notes_case_insensitive() {
        let dir = std::env::temp_dir().join(format!("nt-notes-search-{}", std::process::id()));
        save(&dir, "core", "interface Gi1/0/1\n description UPLINK\nshow VLAN brief").unwrap();
        save(&dir, "wan", "ip route 0.0.0.0 0.0.0.0 192.0.2.1\nshow vlan").unwrap();
        let mut hits = search(&dir, "VlAn");
        hits.sort_by(|a, b| a.name.cmp(&b.name));
        assert_eq!(hits.len(), 2);
        assert_eq!((hits[0].name.as_str(), hits[0].line), ("core", 3));
        assert_eq!(hits[1].snippet, "show vlan");
        assert!(search(&dir, "  ").is_empty());
        assert!(search(&dir, "no-existe").is_empty());
        // Fragmento acotado en líneas largas.
        save(&dir, "larga", &format!("{}clave{}", "x".repeat(400), "y".repeat(400))).unwrap();
        let h = search(&dir, "CLAVE");
        assert!(h[0].snippet.contains("clave") && h[0].snippet.chars().count() <= SNIPPET_CHARS + 2);
        let _ = fs::remove_dir_all(&dir);
    }

    // ---------- Notas protegidas ----------

    const FAST: Kdf = Kdf { m: 64, t: 1, p: 1 };
    const SECRET: &str = "enable secret Cl4ve-Sup3r";

    fn tmp() -> PathBuf {
        let d = std::env::temp_dir().join(format!("nt-snotes-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&d).unwrap();
        d
    }

    fn files(dir: &Path) -> Vec<String> {
        let mut v: Vec<String> = fs::read_dir(dir).unwrap().flatten().map(|e| e.file_name().to_string_lossy().into_owned()).collect();
        v.sort();
        v
    }

    fn contains(path: &Path, needle: &str) -> bool {
        fs::read(path).unwrap().windows(needle.len()).any(|w| w == needle.as_bytes())
    }

    /// Simula que pasó la espera tras un intento fallido.
    fn unthrottle(s: &SecureNotes) {
        s.inner().throttle.retry_at = None;
    }

    #[test]
    fn protect_roundtrip_and_no_plaintext_leftover() {
        let d = tmp();
        let s = SecureNotes::with(FAST);
        save(&d, "core", &format!("hostname core\n{SECRET}\n")).unwrap();
        assert!(s.protect(&d, "core", "corta", 300).is_err(), "contraseña mínima");
        s.protect(&d, "core", "contraseña-larga", 300).unwrap();
        // Solo queda el cifrado: ni .txt ni temporales, y sin el secreto en claro.
        assert_eq!(files(&d), vec!["core.ntenc".to_string()]);
        assert!(!contains(&d.join("core.ntenc"), "Cl4ve-Sup3r"));
        let l = list(&d);
        assert!(l.len() == 1 && l[0].protected && l[0].name == "core");
        assert_eq!(read(&d, "core").unwrap_err(), PROTECTED);
        // Un guardado en claro tardío no puede pisar la nota protegida.
        assert_eq!(save(&d, "core", "texto").unwrap_err(), PROTECTED);
        assert!(!d.join("core.txt").exists());

        // Autoguardado cifrado con nonce nuevo en cada escritura.
        let before = fs::read(d.join("core.ntenc")).unwrap();
        s.save(&d, "core", &format!("{SECRET}\nshow run")).unwrap();
        let after = fs::read(d.join("core.ntenc")).unwrap();
        assert_ne!(before[36..60], after[36..60], "nonce nuevo");
        assert_eq!(before[20..36], after[20..36], "misma sal");
        assert_eq!(files(&d), vec!["core.ntenc".to_string()]);

        s.lock();
        assert_eq!(s.save(&d, "core", "x").unwrap_err(), NOTE_LOCKED);
        assert!(!s.touch("core"));
        let text = s.unlock(&d, "core", "contraseña-larga", 300).unwrap();
        assert_eq!(text.as_str(), format!("{SECRET}\nshow run"));
        assert!(s.touch("core"));

        // Renombrar mantiene la protección y el desbloqueo.
        assert_eq!(rename(&d, "core", "core-01").unwrap(), "core-01");
        s.renamed("core", "core-01");
        s.save(&d, "core-01", "nuevo").unwrap();

        // Quitar la protección: vuelve a .txt y desaparece el cifrado.
        s.unprotect(&d, "core-01").unwrap();
        assert_eq!(files(&d), vec!["core-01.txt".to_string()]);
        assert_eq!(read(&d, "core-01").unwrap(), "nuevo");
        assert_eq!(s.save(&d, "core-01", "x").unwrap_err(), NOTE_LOCKED, "queda bloqueada");
        fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn wrong_password_is_rate_limited_and_change_works() {
        let d = tmp();
        let s = SecureNotes::with(FAST);
        save(&d, "wan", SECRET).unwrap();
        s.protect(&d, "wan", "contraseña-larga", 300).unwrap();
        s.lock();
        assert_eq!(s.unlock(&d, "wan", "otra-clave", 300).unwrap_err(), BAD_PASSWORD);
        // La contraseña correcta también espera tras un fallo (espera exponencial).
        assert!(s.unlock(&d, "wan", "contraseña-larga", 300).unwrap_err().contains("Espera"));
        assert!(s.change(&d, "wan", "contraseña-larga", "nueva-clave-1").unwrap_err().contains("Espera"));
        unthrottle(&s);
        assert!(s.change(&d, "wan", "otra-clave", "nueva-clave-1").is_err());
        unthrottle(&s);
        s.change(&d, "wan", "contraseña-larga", "nueva-clave-1").unwrap();
        assert_eq!(s.unlock(&d, "wan", "contraseña-larga", 300).unwrap_err(), BAD_PASSWORD);
        unthrottle(&s);
        assert_eq!(s.unlock(&d, "wan", "nueva-clave-1", 300).unwrap().as_str(), SECRET);
        fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn tampered_note_is_rejected() {
        let d = tmp();
        let s = SecureNotes::with(FAST);
        save(&d, "fw", SECRET).unwrap();
        s.protect(&d, "fw", "contraseña-larga", 300).unwrap();
        let path = d.join("fw.ntenc");
        let good = fs::read(&path).unwrap();
        // Texto cifrado, sal, nonce y parámetros: todo autenticado.
        for i in [good.len() - 1, HEADER_LEN + 1, 25, 40, 12] {
            let mut bad = good.clone();
            bad[i] ^= 0x01;
            fs::write(&path, &bad).unwrap();
            unthrottle(&s);
            assert!(s.unlock(&d, "fw", "contraseña-larga", 300).is_err(), "byte {i}");
        }
        let mut bad = good.clone();
        bad[8..12].copy_from_slice(&u32::MAX.to_le_bytes());
        fs::write(&path, &bad).unwrap();
        unthrottle(&s);
        assert_eq!(s.unlock(&d, "fw", "contraseña-larga", 300).unwrap_err(), BAD_FILE);
        fs::write(&path, &good[..HEADER_LEN]).unwrap();
        assert_eq!(s.unlock(&d, "fw", "contraseña-larga", 300).unwrap_err(), BAD_FILE);
        fs::write(&path, &good).unwrap();
        unthrottle(&s);
        assert_eq!(s.unlock(&d, "fw", "contraseña-larga", 300).unwrap().as_str(), SECRET);
        fs::remove_dir_all(&d).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn protected_note_is_private() {
        use std::os::unix::fs::PermissionsExt;
        let d = tmp();
        let s = SecureNotes::with(FAST);
        save(&d, "lab", "x").unwrap();
        s.protect(&d, "lab", "contraseña-larga", 300).unwrap();
        s.save(&d, "lab", "y").unwrap();
        let mode = fs::metadata(d.join("lab.ntenc")).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o600);
        fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn search_skips_protected_content() {
        let d = tmp();
        let s = SecureNotes::with(FAST);
        save(&d, "claves-vlan", &format!("vlan 10\n{SECRET}")).unwrap();
        save(&d, "abierta", "vlan 20").unwrap();
        s.protect(&d, "claves-vlan", "contraseña-larga", 300).unwrap();
        let hits = search(&d, "secret");
        assert!(hits.is_empty(), "el contenido protegido no se busca");
        let mut hits = search(&d, "vlan");
        hits.sort_by(|a, b| a.name.cmp(&b.name));
        assert_eq!(hits.len(), 2);
        assert_eq!((hits[0].name.as_str(), hits[0].line, hits[0].protected), ("abierta", 1, false));
        // La protegida aparece solo por su nombre, sin línea ni fragmento.
        assert_eq!((hits[1].name.as_str(), hits[1].line, hits[1].protected), ("claves-vlan", 0, true));
        assert!(hits[1].snippet.is_empty());
        fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn idle_key_expires_and_leftover_plaintext_is_removed() {
        let d = tmp();
        let s = SecureNotes::with(FAST);
        save(&d, "sw", SECRET).unwrap();
        s.protect(&d, "sw", "contraseña-larga", 300).unwrap();
        // Inactividad: la llave caduca aunque el frontend no haya bloqueado.
        s.inner().open.as_mut().unwrap().last = Instant::now() - Duration::from_secs(301) - IDLE_GRACE;
        assert_eq!(s.save(&d, "sw", "x").unwrap_err(), NOTE_LOCKED);
        assert!(s.inner().open.is_none(), "llave borrada");
        // Corte entre cifrar y borrar el original: manda el cifrado y el .txt se elimina al abrir.
        fs::write(d.join("sw.txt"), SECRET).unwrap();
        assert_eq!(list(&d).len(), 1);
        assert!(search(&d, "secret").is_empty());
        s.unlock(&d, "sw", "contraseña-larga", 30).unwrap();
        assert!(!d.join("sw.txt").exists());
        // Otra nota con el mismo nombre no se puede crear ni renombrar encima.
        save(&d, "otra", "y").unwrap();
        assert!(rename(&d, "otra", "sw").is_err());
        // Borrar una nota protegida la saca de memoria.
        s.forget("sw");
        assert_eq!(s.save(&d, "sw", "x").unwrap_err(), NOTE_LOCKED);
        delete(&d, "sw").unwrap();
        assert_eq!(files(&d), vec!["otra.txt".to_string()]);
        fs::remove_dir_all(&d).unwrap();
    }

    // ---------- Archivo de referencia (formato en disco) ----------
    //
    // `tests/fixtures/nota.ntenc` se generó con chacha20poly1305 0.10 y argon2 0.5. Debe
    // abrir sin cambios con cualquier versión posterior: si una actualización rompe estas
    // pruebas, cambió el formato y las notas protegidas de los usuarios dejarían de abrir.

    const GOLDEN_PASSWORD: &str = "nota-de-prueba-1";
    const GOLDEN_TEXT: &str = "hostname lab-core\nenable secret Pru3ba-Fija\nñandú € 日本\n\tfin\n";

    fn golden_note() -> (PathBuf, Vec<u8>) {
        let d = tmp();
        let bytes = fs::read(Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/nota.ntenc")).unwrap();
        fs::write(d.join("nota.ntenc"), &bytes).unwrap();
        (d, bytes)
    }

    /// Regenera el archivo de referencia. Solo a mano y con la versión anterior:
    /// `NT_WRITE_GOLDEN=1 cargo test --lib write_golden_note -- --ignored`.
    #[test]
    #[ignore]
    fn write_golden_note() {
        if std::env::var("NT_WRITE_GOLDEN").as_deref() != Ok("1") {
            return;
        }
        let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures");
        let salt = random::<16>();
        let key = derive(GOLDEN_PASSWORD, &salt, KDF_DEFAULT).unwrap();
        seal_write(&dir.join("nota.ntenc"), &key, KDF_DEFAULT, salt, GOLDEN_TEXT).unwrap();
    }

    #[test]
    fn golden_note_opens() {
        let (d, bytes) = golden_note();
        // Cabecera: NTNOTES | v1 | m=65536 t=3 p=1 | sal (16) | nonce (24); luego texto + etiqueta.
        assert_eq!(&bytes[..8], b"NTNOTES\x01");
        assert_eq!(Kdf::decode(&bytes[8..20]), KDF_DEFAULT);
        assert_eq!(bytes.len(), HEADER_LEN + GOLDEN_TEXT.len() + 16);
        let s = SecureNotes::with(FAST);
        assert_eq!(s.unlock(&d, "nota", "nota-de-prueba-2", 300).unwrap_err(), BAD_PASSWORD);
        unthrottle(&s);
        assert_eq!(s.unlock(&d, "nota", GOLDEN_PASSWORD, 300).unwrap().as_str(), GOLDEN_TEXT);
        assert_eq!(fs::read(d.join("nota.ntenc")).unwrap(), bytes, "abrir no reescribe");
        fs::remove_dir_all(&d).unwrap();
    }

    /// Guardar la nota de referencia con el código actual mantiene cabecera (sin el nonce) y largo.
    #[test]
    fn golden_note_roundtrip_keeps_format() {
        let (d, before) = golden_note();
        let s = SecureNotes::with(FAST);
        s.unlock(&d, "nota", GOLDEN_PASSWORD, 300).unwrap();
        s.save(&d, "nota", GOLDEN_TEXT).unwrap();
        let after = fs::read(d.join("nota.ntenc")).unwrap();
        assert_eq!(after.len(), before.len());
        assert_eq!(&after[..36], &before[..36], "magia, versión, parámetros y sal");
        assert_ne!(&after[36..60], &before[36..60], "nonce nuevo");
        assert_eq!(SecureNotes::with(FAST).unlock(&d, "nota", GOLDEN_PASSWORD, 300).unwrap().as_str(), GOLDEN_TEXT);
        // Nota nueva: mismo diseño v1 con los parámetros del llamador.
        save(&d, "nueva", "abc").unwrap();
        s.protect(&d, "nueva", "contraseña-larga", 300).unwrap();
        let b = fs::read(d.join("nueva.ntenc")).unwrap();
        assert_eq!(HEADER_LEN, 60);
        assert_eq!(b.len(), HEADER_LEN + 3 + 16);
        assert_eq!(&b[..8], b"NTNOTES\x01");
        assert_eq!(Kdf::decode(&b[8..20]), FAST);
        fs::remove_dir_all(&d).unwrap();
    }
}
