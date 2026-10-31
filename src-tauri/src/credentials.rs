//! Contraseñas guardadas por sesión, en una bóveda cifrada dentro de la carpeta de datos
//! (`credentials.vault`, XChaCha20-Poly1305). La llave de 256 bits vive:
//! - Instalada: en el llavero del sistema (una sola entrada "NetTerminal" / "vault-key").
//!   El archivo copiado a otro equipo no sirve sin ese llavero.
//! - Portable, o sin llavero disponible: derivada de una contraseña maestra con Argon2id.
//!
//! Ninguna función devuelve una contraseña al frontend: solo `get` (uso interno del
//! autocompletado al conectar). La llave queda en memoria en un búfer que se borra al
//! bloquear y al salir.

use crate::seal::{self, derive, random, write_atomic, Throttle};
use crate::seal::{Kdf, KDF_DEFAULT};
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use zeroize::{Zeroize, Zeroizing};

const MAGIC: &[u8; 7] = b"NTVAULT";
const VERSION: u8 = 1;
const HEADER_LEN: usize = 7 + 1 + 1 + 12 + 16 + 24;
const MAX_FILE: u64 = 4 * 1024 * 1024;

pub const MAX_PASSWORD: usize = 1024;
const MIN_MASTER: usize = 8;
const MAX_ID: usize = 128;

/// Prefijo de entradas que no son de sesiones (secretos SNMP por perfil). La limpieza de
/// entradas huérfanas al guardar la contraseña de una sesión no las toca.
pub const NS_SNMP: &str = "snmp:";

/// Prefijo de las contraseñas de vecinos alcanzados por salto (Topología): una entrada por
/// equipo y usuario, con clave `hop:<IP>|<usuario>` (IP canónica). El valor es un JSON propio
/// (`{"pw":…,"used":…}`); las bóvedas anteriores no los tienen y se abren igual (el formato del
/// archivo no cambia: es el mismo mapa texto a texto). Tampoco las toca la limpieza de huérfanas.
pub const NS_HOP: &str = "hop:";
/// Tope de vecinos guardados: no es una libreta de contraseñas masiva.
pub const MAX_HOP_ENTRIES: usize = 100;

pub const LOCKED: &str = "La bóveda está bloqueada. Desbloquéala en Ajustes › Credenciales";

#[derive(Clone, Copy, PartialEq, Debug)]
enum Mode {
    /// Llave aleatoria guardada en el llavero del sistema.
    Keyring = 0,
    /// Llave derivada de la contraseña maestra (Argon2id).
    Master = 1,
}

#[derive(Clone, Debug)]
struct Header {
    mode: Mode,
    kdf: Kdf,
    salt: [u8; 16],
    nonce: [u8; 24],
}

impl Header {
    fn encode(&self) -> [u8; HEADER_LEN] {
        let mut h = [0u8; HEADER_LEN];
        h[..7].copy_from_slice(MAGIC);
        h[7] = VERSION;
        h[8] = self.mode as u8;
        self.kdf.encode(&mut h[9..21]);
        h[21..37].copy_from_slice(&self.salt);
        h[37..61].copy_from_slice(&self.nonce);
        h
    }

    fn decode(b: &[u8]) -> Result<Header, String> {
        let bad = || "El archivo de credenciales no es válido".to_string();
        if b.len() < HEADER_LEN + 16 || &b[..7] != MAGIC {
            return Err(bad());
        }
        if b[7] != VERSION {
            return Err("La bóveda es de una versión más nueva de NetTerminal".into());
        }
        let mode = match b[8] {
            0 => Mode::Keyring,
            1 => Mode::Master,
            _ => return Err(bad()),
        };
        let kdf = Kdf::decode(&b[9..21]);
        if mode == Mode::Master && !kdf.sane() {
            return Err(bad());
        }
        let mut salt = [0u8; 16];
        salt.copy_from_slice(&b[21..37]);
        let mut nonce = [0u8; 24];
        nonce.copy_from_slice(&b[37..61]);
        Ok(Header { mode, kdf, salt, nonce })
    }
}

/// Dónde se guarda la llave de la bóveda en modo instalado. Detrás de un trait para
/// probar sin llavero (CI sin sesión gráfica).
pub trait KeyStore: Send + Sync {
    /// Ok(None): no hay llave guardada. Err: llavero no disponible.
    fn get(&self) -> Result<Option<Zeroizing<Vec<u8>>>, String>;
    fn set(&self, key: &[u8]) -> Result<(), String>;
    fn delete(&self) -> Result<(), String>;
}

/// Llavero del sistema: Keychain (macOS), Administrador de credenciales (Windows) o
/// Secret Service (Linux). Sin Secret Service no hay respaldo en archivo: se usa la
/// contraseña maestra.
pub struct OsKeyStore;

#[cfg(any(target_os = "macos", windows, target_os = "linux"))]
impl OsKeyStore {
    fn entry() -> Result<keyring::Entry, String> {
        keyring::Entry::new("NetTerminal", "vault-key").map_err(|e| e.to_string())
    }
}

#[cfg(any(target_os = "macos", windows, target_os = "linux"))]
impl KeyStore for OsKeyStore {
    fn get(&self) -> Result<Option<Zeroizing<Vec<u8>>>, String> {
        match Self::entry()?.get_secret() {
            Ok(k) => Ok(Some(Zeroizing::new(k))),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }
    fn set(&self, key: &[u8]) -> Result<(), String> {
        Self::entry()?.set_secret(key).map_err(|e| e.to_string())
    }
    fn delete(&self) -> Result<(), String> {
        match Self::entry()?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(e.to_string()),
        }
    }
}

#[cfg(not(any(target_os = "macos", windows, target_os = "linux")))]
impl KeyStore for OsKeyStore {
    fn get(&self) -> Result<Option<Zeroizing<Vec<u8>>>, String> {
        Err("Llavero no disponible".into())
    }
    fn set(&self, _: &[u8]) -> Result<(), String> {
        Err("Llavero no disponible".into())
    }
    fn delete(&self) -> Result<(), String> {
        Ok(())
    }
}

/// Mapa id de sesión -> contraseña, borrado de memoria al soltarse.
#[derive(Default)]
struct Entries(HashMap<String, String>);

impl Drop for Entries {
    fn drop(&mut self) {
        for v in self.0.values_mut() {
            v.zeroize();
        }
    }
}

#[derive(Serialize)]
pub struct Status {
    /// "keychain" (llave en el llavero del sistema) o "vault" (contraseña maestra).
    pub backend: &'static str,
    pub exists: bool,
    pub unlocked: bool,
    pub portable: bool,
}

#[derive(Default)]
struct Inner {
    key: Option<Zeroizing<[u8; 32]>>,
    throttle: Throttle,
}

pub struct Credentials {
    path: PathBuf,
    portable: bool,
    keys: Box<dyn KeyStore>,
    kdf: Kdf,
    /// Disponibilidad del llavero, consultada una sola vez y solo si se usa la función.
    keyring_ok: OnceLock<bool>,
    inner: Mutex<Inner>,
}

fn lock<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

fn check_master(master: &str) -> Result<(), String> {
    let n = master.chars().count();
    if n < MIN_MASTER {
        return Err(format!("La contraseña maestra debe tener al menos {MIN_MASTER} caracteres"));
    }
    if master.len() > MAX_PASSWORD {
        return Err("La contraseña maestra es demasiado larga".into());
    }
    Ok(())
}

fn check_id(id: &str) -> Result<(), String> {
    // Las entradas de vecinos solo se tocan con hop_*: un id de sesión con ese prefijo podría
    // leerlas (autocompletado) o pisarlas.
    if id.is_empty() || id.len() > MAX_ID || id.chars().any(|c| c.is_control()) || id.starts_with(NS_HOP) {
        return Err("Sesión inválida".into());
    }
    Ok(())
}

/// Un id de sesión nunca usa los prefijos reservados de la bóveda ("snmp:", "hop:").
pub fn reserved_id(id: &str) -> bool {
    id.starts_with(NS_SNMP) || id.starts_with(NS_HOP)
}

impl Credentials {
    pub fn new(data_dir: &Path, portable: bool) -> Self {
        Self::with(data_dir, portable, Box::new(OsKeyStore), KDF_DEFAULT)
    }

    pub fn with(data_dir: &Path, portable: bool, keys: Box<dyn KeyStore>, kdf: Kdf) -> Self {
        Credentials {
            path: data_dir.join("credentials.vault"),
            portable,
            keys,
            kdf,
            keyring_ok: OnceLock::new(),
            inner: Mutex::default(),
        }
    }

    fn keyring_available(&self) -> bool {
        !self.portable && *self.keyring_ok.get_or_init(|| self.keys.get().is_ok())
    }

    fn read(&self) -> Result<Option<(Header, Vec<u8>)>, String> {
        let meta = match std::fs::metadata(&self.path) {
            Ok(m) => m,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(e) => return Err(e.to_string()),
        };
        if meta.len() > MAX_FILE {
            return Err("El archivo de credenciales no es válido".into());
        }
        let bytes = std::fs::read(&self.path).map_err(|e| e.to_string())?;
        Ok(Some((Header::decode(&bytes)?, bytes)))
    }

    /// Modo vigente: el del archivo si existe; si no, llavero cuando hay uno disponible.
    fn mode(&self) -> Mode {
        match self.read() {
            Ok(Some((h, _))) => h.mode,
            _ if self.keyring_available() => Mode::Keyring,
            _ => Mode::Master,
        }
    }

    fn decrypt(key: &[u8; 32], bytes: &[u8]) -> Result<Entries, String> {
        let header = Header::decode(bytes)?;
        let plain = seal::decrypt(key, &header.nonce, &bytes[HEADER_LEN..], &bytes[..HEADER_LEN])
            .map_err(|_| "Contraseña maestra incorrecta o archivo de credenciales alterado".to_string())?;
        serde_json::from_slice::<HashMap<String, String>>(&plain)
            .map(Entries)
            .map_err(|_| "El archivo de credenciales no es válido".into())
    }

    fn encrypt_write(&self, key: &[u8; 32], mode: Mode, kdf: Kdf, salt: [u8; 16], entries: &Entries) -> Result<(), String> {
        let header = Header { mode, kdf, salt, nonce: random() }.encode();
        // Capacidad de sobra (el peor escape JSON es \uXXXX, 6 bytes por byte): `to_vec`
        // realocaría y dejaría copias del texto en claro sin borrar en memoria liberada.
        let cap = 2 + entries.0.iter().map(|(k, v)| 6 * (k.len() + v.len()) + 6).sum::<usize>();
        let mut plain = Zeroizing::new(Vec::with_capacity(cap));
        serde_json::to_writer(&mut *plain, &entries.0).map_err(|e| e.to_string())?;
        let mut nonce = [0u8; 24];
        nonce.copy_from_slice(&header[37..61]);
        let ct = seal::encrypt(key, &nonce, &plain, &header).map_err(|_| "No se pudo cifrar la bóveda".to_string())?;
        let mut out = Vec::with_capacity(HEADER_LEN + ct.len());
        out.extend_from_slice(&header);
        out.extend_from_slice(&ct);
        write_atomic(&self.path, &out)
    }

    /// Asegura la llave en memoria. En modo llavero la lee (o la crea con la bóveda si
    /// `create`); en modo maestra exige haber desbloqueado antes.
    fn ensure_key(&self, inner: &mut Inner, create: bool) -> Result<Option<(Header, Vec<u8>)>, String> {
        let file = self.read()?;
        if inner.key.is_some() {
            return Ok(file);
        }
        match &file {
            Some((h, _)) if h.mode == Mode::Master => Err(LOCKED.into()),
            Some(_) => {
                let raw = self.keys.get()?.ok_or(
                    "La llave de la bóveda no está en el llavero de este equipo. Restablece la bóveda en Ajustes › Credenciales",
                )?;
                if raw.len() != 32 {
                    return Err("La llave de la bóveda en el llavero no es válida".into());
                }
                let mut key = Zeroizing::new([0u8; 32]);
                key.copy_from_slice(&raw);
                inner.key = Some(key);
                Ok(file)
            }
            None if !create => Ok(None),
            None if self.keyring_available() => {
                let key = Zeroizing::new(random::<32>());
                self.keys.set(key.as_ref())?;
                self.encrypt_write(&key, Mode::Keyring, Kdf { m: 0, t: 0, p: 0 }, random(), &Entries::default())?;
                inner.key = Some(key);
                self.read()
            }
            None => Err("Primero crea la bóveda con una contraseña maestra en Ajustes › Credenciales".into()),
        }
    }

    pub fn status(&self) -> Status {
        let exists = self.path.exists();
        Status {
            backend: if self.mode() == Mode::Keyring { "keychain" } else { "vault" },
            exists,
            unlocked: exists && lock(&self.inner).key.is_some(),
            portable: self.portable,
        }
    }

    pub fn create(&self, master: &str) -> Result<(), String> {
        check_master(master)?;
        if self.path.exists() {
            return Err("La bóveda ya existe".into());
        }
        if self.mode() != Mode::Master {
            return Err("Esta instalación guarda la llave en el llavero del sistema".into());
        }
        let salt = random::<16>();
        let key = derive(master, &salt, self.kdf)?;
        self.encrypt_write(&key, Mode::Master, self.kdf, salt, &Entries::default())?;
        lock(&self.inner).key = Some(key);
        Ok(())
    }

    pub fn unlock(&self, master: &str) -> Result<(), String> {
        if master.len() > MAX_PASSWORD {
            return Err("Contraseña demasiado larga".into());
        }
        let mut inner = lock(&self.inner);
        inner.throttle.check()?;
        let (h, bytes) = self.read()?.ok_or("No hay bóveda creada")?;
        if h.mode != Mode::Master {
            return self.ensure_key(&mut inner, false).map(|_| ());
        }
        let key = derive(master, &h.salt, h.kdf)?;
        match Self::decrypt(&key, &bytes) {
            Ok(_) => {
                inner.key = Some(key);
                inner.throttle.reset();
                Ok(())
            }
            Err(e) => {
                inner.throttle.fail();
                Err(e)
            }
        }
    }

    pub fn lock(&self) {
        lock(&self.inner).key = None;
    }

    pub fn change(&self, old: &str, new: &str) -> Result<(), String> {
        check_master(new)?;
        let mut inner = lock(&self.inner);
        inner.throttle.check()?;
        let (h, bytes) = self.read()?.ok_or("No hay bóveda creada")?;
        if h.mode != Mode::Master {
            return Err("Esta bóveda usa el llavero del sistema: no tiene contraseña maestra".into());
        }
        let old_key = derive(old, &h.salt, h.kdf)?;
        let entries = match Self::decrypt(&old_key, &bytes) {
            Ok(e) => e,
            Err(e) => {
                inner.throttle.fail();
                return Err(e);
            }
        };
        let salt = random::<16>();
        let key = derive(new, &salt, self.kdf)?;
        self.encrypt_write(&key, Mode::Master, self.kdf, salt, &entries)?;
        inner.key = Some(key);
        inner.throttle.reset();
        Ok(())
    }

    /// Borra la bóveda completa (y la llave del llavero). Para contraseña maestra olvidada
    /// o llavero perdido: las contraseñas guardadas se pierden.
    pub fn reset(&self) -> Result<(), String> {
        let mut inner = lock(&self.inner);
        inner.key = None;
        match std::fs::remove_file(&self.path) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(e.to_string()),
        }
        if !self.portable {
            let _ = self.keys.delete();
        }
        Ok(())
    }

    /// Modifica las entradas con la llave en memoria y reescribe el archivo.
    fn update(&self, create: bool, f: impl FnOnce(&mut Entries)) -> Result<(), String> {
        let mut inner = lock(&self.inner);
        let Some((h, bytes)) = self.ensure_key(&mut inner, create)? else {
            return Ok(());
        };
        let key = inner.key.as_ref().ok_or(LOCKED)?;
        let mut entries = Self::decrypt(key, &bytes)?;
        f(&mut entries);
        self.encrypt_write(key, h.mode, h.kdf, h.salt, &entries)
    }

    /// Guarda la contraseña de una sesión. `valid` (ids de sesiones existentes) permite
    /// limpiar entradas huérfanas de sesiones borradas con la bóveda bloqueada.
    pub fn set(&self, id: &str, password: &str, valid: &[String]) -> Result<(), String> {
        check_id(id)?;
        if password.is_empty() || password.len() > MAX_PASSWORD {
            return Err(format!("La contraseña debe tener entre 1 y {MAX_PASSWORD} bytes"));
        }
        if password.chars().any(|c| matches!(c, '\r' | '\n' | '\0')) {
            return Err("La contraseña no puede contener saltos de línea".into());
        }
        self.update(true, |e| {
            if let Some(mut old) = e.0.insert(id.to_string(), password.to_string()) {
                old.zeroize();
            }
            let stale: Vec<String> =
                e.0.keys().filter(|k| *k != id && !k.starts_with(NS_SNMP) && !k.starts_with(NS_HOP) && !valid.contains(k)).cloned().collect();
            for k in stale {
                if let Some(mut v) = e.0.remove(&k) {
                    v.zeroize();
                }
            }
        })
    }

    pub fn delete(&self, id: &str) -> Result<(), String> {
        check_id(id)?;
        self.update(false, |e| {
            if let Some(mut v) = e.0.remove(id) {
                v.zeroize();
            }
        })
    }

    pub fn has(&self, id: &str) -> Result<bool, String> {
        check_id(id)?;
        let mut inner = lock(&self.inner);
        let Some((_, bytes)) = self.ensure_key(&mut inner, false)? else {
            return Ok(false);
        };
        let key = inner.key.as_ref().ok_or(LOCKED)?;
        Ok(Self::decrypt(key, &bytes)?.0.contains_key(id))
    }

    /// Solo para el autocompletado del backend. None si no hay, o si está bloqueada.
    pub(crate) fn get(&self, id: &str) -> Option<Zeroizing<String>> {
        check_id(id).ok()?;
        let mut inner = lock(&self.inner);
        let (_, bytes) = self.ensure_key(&mut inner, false).ok()??;
        let mut entries = Self::decrypt(inner.key.as_ref()?, &bytes).ok()?;
        entries.0.remove(id).map(Zeroizing::new)
    }

    // ---------- Vecinos alcanzados por salto ----------

    /// Lee las entradas con la llave en memoria (sin escribir). Ok(None): no hay bóveda.
    fn read_entries<R>(&self, f: impl FnOnce(&Entries) -> R) -> Result<Option<R>, String> {
        let mut inner = lock(&self.inner);
        let Some((_, bytes)) = self.ensure_key(&mut inner, false)? else {
            return Ok(None);
        };
        let key = inner.key.as_ref().ok_or(LOCKED)?;
        Ok(Some(f(&Self::decrypt(key, &bytes)?)))
    }

    /// Guarda (o reemplaza) la contraseña de un vecino. Con tope de entradas.
    pub fn hop_set(&self, ip: &str, user: &str, password: &str) -> Result<(), String> {
        let key = hop_key(ip, user)?;
        if password.is_empty() || password.len() > MAX_PASSWORD {
            return Err(format!("La contraseña debe tener entre 1 y {MAX_PASSWORD} bytes"));
        }
        if password.chars().any(|c| matches!(c, '\r' | '\n' | '\0')) {
            return Err("La contraseña no puede contener saltos de línea".into());
        }
        let mut full = false;
        self.update(true, |e| {
            let prior = e.0.get(&key).and_then(|v| HopRec::parse(v)).and_then(|r| r.used);
            if prior.is_none() && !e.0.contains_key(&key) && e.0.keys().filter(|k| k.starts_with(NS_HOP)).count() >= MAX_HOP_ENTRIES {
                full = true;
                return;
            }
            let rec = Zeroizing::new(HopRec { pw: password.to_string(), used: prior }.encode());
            if let Some(mut old) = e.0.insert(key.clone(), rec.to_string()) {
                old.zeroize();
            }
        })?;
        if full {
            return Err(format!("Ya hay {MAX_HOP_ENTRIES} vecinos con contraseña guardada: elimina alguno en Ajustes › Credenciales"));
        }
        Ok(())
    }

    pub fn hop_delete(&self, ip: &str, user: &str) -> Result<(), String> {
        let key = hop_key(ip, user)?;
        self.update(false, |e| {
            if let Some(mut v) = e.0.remove(&key) {
                v.zeroize();
            }
        })
    }

    pub fn hop_has(&self, ip: &str, user: &str) -> Result<bool, String> {
        let key = hop_key(ip, user)?;
        Ok(self.read_entries(|e| e.0.contains_key(&key))?.unwrap_or(false))
    }

    /// Vecinos guardados, sin contraseñas, por IP y usuario.
    pub fn hop_list(&self) -> Result<Vec<HopInfo>, String> {
        let mut out = self
            .read_entries(|e| {
                e.0.iter()
                    .filter_map(|(k, v)| {
                        let (ip, user) = k.strip_prefix(NS_HOP)?.split_once('|')?;
                        Some(HopInfo { ip: ip.to_string(), user: user.to_string(), last_used: HopRec::parse(v).and_then(|r| r.used) })
                    })
                    .collect::<Vec<_>>()
            })?
            .unwrap_or_default();
        out.sort_by(|a, b| (&a.ip, &a.user).cmp(&(&b.ip, &b.user)));
        Ok(out)
    }

    /// Solo para escribir la contraseña en un salto (nunca vuelve al frontend).
    pub(crate) fn hop_get(&self, ip: &str, user: &str) -> Option<Zeroizing<String>> {
        let key = hop_key(ip, user).ok()?;
        let rec = self.read_entries(|e| e.0.get(&key).and_then(|v| HopRec::parse(v))).ok()???;
        Some(Zeroizing::new(rec.pw.clone()))
    }

    /// Anota el último uso (segundos Unix). Un fallo no importa: es solo informativo.
    pub(crate) fn hop_touch(&self, ip: &str, user: &str, now: u64) {
        let Ok(key) = hop_key(ip, user) else { return };
        let _ = self.update(false, |e| {
            if let Some(mut rec) = e.0.get(&key).and_then(|v| HopRec::parse(v)) {
                rec.used = Some(now);
                let enc = Zeroizing::new(rec.encode());
                if let Some(mut old) = e.0.insert(key.clone(), enc.to_string()) {
                    old.zeroize();
                }
            }
        });
    }
}

/// Un vecino con contraseña guardada (para Ajustes › Credenciales). Sin la contraseña.
#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct HopInfo {
    pub ip: String,
    pub user: String,
    /// Último uso en un salto (segundos Unix); None si nunca se usó.
    pub last_used: Option<u64>,
}

/// Valor de una entrada `hop:`: la contraseña y cuándo se usó por última vez.
struct HopRec {
    pw: String,
    used: Option<u64>,
}

impl Drop for HopRec {
    fn drop(&mut self) {
        self.pw.zeroize();
    }
}

impl HopRec {
    fn parse(v: &str) -> Option<HopRec> {
        let j: serde_json::Value = serde_json::from_str(v).ok()?;
        Some(HopRec { pw: j.get("pw")?.as_str()?.to_string(), used: j.get("used").and_then(|u| u.as_u64()) })
    }
    fn encode(&self) -> String {
        serde_json::json!({ "pw": self.pw, "used": self.used }).to_string()
    }
}

/// Usuario de un comando de salto: mismas reglas que la interfaz (HOP_USER).
pub fn valid_hop_user(u: &str) -> bool {
    let mut cs = u.chars();
    let ok_first = cs.next().is_some_and(|c| c.is_ascii_alphanumeric());
    ok_first && u.len() <= 64 && cs.all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '@' | '\\' | '-'))
}

/// Clave de la entrada de un vecino: IP canónica (minúsculas, sin ceros de más) y usuario.
/// Rechaza nombres, IP no literales, la dirección no especificada y usuarios con caracteres raros.
pub fn hop_key(ip: &str, user: &str) -> Result<String, String> {
    let addr: std::net::IpAddr = ip.trim().parse().map_err(|_| "IP del vecino no válida")?;
    if addr.is_unspecified() || addr.is_multicast() {
        return Err("IP del vecino no válida".into());
    }
    let user = user.trim();
    if !valid_hop_user(user) {
        return Err("Usuario no válido (sin espacios ni símbolos raros)".into());
    }
    Ok(format!("{NS_HOP}{addr}|{user}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Llavero en memoria para pruebas.
    #[derive(Default, Clone)]
    struct MemKeys(std::sync::Arc<Mutex<Option<Vec<u8>>>>, bool);

    impl KeyStore for MemKeys {
        fn get(&self) -> Result<Option<Zeroizing<Vec<u8>>>, String> {
            if self.1 {
                return Err("sin llavero".into());
            }
            Ok(lock(&self.0).clone().map(Zeroizing::new))
        }
        fn set(&self, key: &[u8]) -> Result<(), String> {
            *lock(&self.0) = Some(key.to_vec());
            Ok(())
        }
        fn delete(&self) -> Result<(), String> {
            *lock(&self.0) = None;
            Ok(())
        }
    }

    const FAST: Kdf = Kdf { m: 64, t: 1, p: 1 };

    fn dir() -> PathBuf {
        let d = std::env::temp_dir().join(format!("nt-cred-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn master_vault_roundtrip_and_wrong_master() {
        let d = dir();
        let c = Credentials::with(&d, true, Box::new(MemKeys::default()), FAST);
        assert_eq!(c.status().backend, "vault");
        assert!(c.set("s1", "x", &[]).is_err(), "sin bóveda no se guarda");
        assert!(c.create("corta").is_err());
        c.create("maestra-larga").unwrap();
        c.set("s1", "Cl4ve$ecreta", &["s1".into()]).unwrap();
        assert!(c.has("s1").unwrap());
        assert_eq!(c.get("s1").as_deref().map(|s| s.as_str()), Some("Cl4ve$ecreta"));
        // El archivo no contiene la contraseña en claro.
        let raw = std::fs::read(d.join("credentials.vault")).unwrap();
        assert!(!raw.windows(12).any(|w| w == b"Cl4ve$ecreta"));

        c.lock();
        assert!(c.get("s1").is_none());
        assert_eq!(c.has("s1").unwrap_err(), LOCKED);
        assert!(c.unlock("otra-maestra").is_err());
        // Tras un fallo hay espera antes del siguiente intento.
        assert!(c.unlock("maestra-larga").unwrap_err().contains("Espera"));
        lock(&c.inner).throttle.retry_at = None;
        c.unlock("maestra-larga").unwrap();
        assert!(c.has("s1").unwrap());

        c.change("maestra-larga", "nueva-maestra").unwrap();
        c.lock();
        lock(&c.inner).throttle.retry_at = None;
        assert!(c.unlock("maestra-larga").is_err());
        lock(&c.inner).throttle.retry_at = None;
        c.unlock("nueva-maestra").unwrap();
        assert_eq!(c.get("s1").as_deref().map(|s| s.as_str()), Some("Cl4ve$ecreta"));

        // Entradas huérfanas se limpian al guardar otra; las de SNMP no son de sesiones.
        c.set("snmp:core", "{\"community\":\"x\"}", &[]).unwrap();
        c.set("s2", "otra", &["s2".into()]).unwrap();
        assert!(!c.has("s1").unwrap());
        assert!(c.has("snmp:core").unwrap());
        c.delete("s2").unwrap();
        assert!(!c.has("s2").unwrap());
        std::fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn tampered_vault_is_rejected() {
        let d = dir();
        let c = Credentials::with(&d, true, Box::new(MemKeys::default()), FAST);
        c.create("maestra-larga").unwrap();
        c.set("s1", "secreto", &[]).unwrap();
        let path = d.join("credentials.vault");
        let good = std::fs::read(&path).unwrap();
        // Un byte del texto cifrado y uno de la cabecera (sal): ambos fallan por AEAD/derivación.
        for i in [good.len() - 1, HEADER_LEN + 2, 25] {
            let mut bad = good.clone();
            bad[i] ^= 0x01;
            std::fs::write(&path, &bad).unwrap();
            c.lock();
            lock(&c.inner).throttle.retry_at = None;
            assert!(c.unlock("maestra-larga").is_err(), "byte {i}");
        }
        // Parámetros absurdos en la cabecera: se rechazan sin intentar derivar.
        let mut bad = good.clone();
        bad[9..13].copy_from_slice(&u32::MAX.to_le_bytes());
        std::fs::write(&path, &bad).unwrap();
        lock(&c.inner).throttle.retry_at = None;
        assert!(c.unlock("maestra-larga").unwrap_err().contains("no es válido"));
        std::fs::write(&path, &good).unwrap();
        lock(&c.inner).throttle.retry_at = None;
        c.unlock("maestra-larga").unwrap();
        std::fs::remove_dir_all(&d).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn vault_file_is_private() {
        use std::os::unix::fs::PermissionsExt;
        let d = dir();
        let c = Credentials::with(&d, true, Box::new(MemKeys::default()), FAST);
        c.create("maestra-larga").unwrap();
        c.set("s1", "secreto", &[]).unwrap();
        let mode = std::fs::metadata(d.join("credentials.vault")).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o600);
        std::fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn keyring_mode_needs_no_master_and_file_alone_is_useless() {
        let d = dir();
        let keys = MemKeys::default();
        let c = Credentials::with(&d, false, Box::new(keys.clone()), FAST);
        assert_eq!(c.status().backend, "keychain");
        assert!(c.create("maestra-larga").is_err());
        c.set("s1", "secreto", &[]).unwrap();
        assert_eq!(lock(&keys.0).as_ref().map(Vec::len), Some(32));
        // Tras bloquear (o reiniciar la app) se recupera sola desde el llavero.
        c.lock();
        assert!(c.has("s1").unwrap());
        let c2 = Credentials::with(&d, false, Box::new(keys.clone()), FAST);
        assert_eq!(c2.get("s1").as_deref().map(|s| s.as_str()), Some("secreto"));
        // Sin la llave del llavero (archivo copiado a otro equipo) no se lee.
        let other = Credentials::with(&d, false, Box::new(MemKeys::default()), FAST);
        assert!(other.get("s1").is_none());
        assert!(other.has("s1").is_err());
        c.reset().unwrap();
        assert!(lock(&keys.0).is_none());
        assert!(!d.join("credentials.vault").exists());
        std::fs::remove_dir_all(&d).unwrap();
    }

    /// Bóveda truncada o ajena al abrir la app: nada entra en pánico y el archivo no se
    /// reemplaza al guardar otra contraseña (se podría recuperar desde un respaldo).
    #[test]
    fn corrupt_vault_at_startup_is_not_overwritten() {
        for (garbage, keyring) in [(&b"NTVAULT"[..], true), (&b"no es una boveda"[..], false), (&[0u8; 200][..], true)] {
            let d = dir();
            let path = d.join("credentials.vault");
            std::fs::write(&path, garbage).unwrap();
            let keys = MemKeys(Default::default(), !keyring);
            let c = Credentials::with(&d, false, Box::new(keys), FAST);
            let st = c.status();
            assert!(st.exists && !st.unlocked);
            assert!(c.get("s1").is_none());
            assert!(c.has("s1").is_err());
            assert!(c.set("s1", "x", &[]).is_err());
            assert!(c.unlock("maestra-larga").is_err());
            assert_eq!(std::fs::read(&path).unwrap(), garbage, "la bóveda dañada no se reescribe");
            std::fs::remove_dir_all(&d).unwrap();
        }
    }

    #[test]
    fn without_keyring_falls_back_to_master() {
        let d = dir();
        let c = Credentials::with(&d, false, Box::new(MemKeys(Default::default(), true)), FAST);
        assert_eq!(c.status().backend, "vault");
        assert!(c.set("s1", "x", &[]).is_err());
        c.create("maestra-larga").unwrap();
        c.set("s1", "x", &[]).unwrap();
        std::fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn roundtrips_passwords_that_need_json_escapes() {
        let d = dir();
        let c = Credentials::with(&d, true, Box::new(MemKeys::default()), FAST);
        c.create("maestra-larga").unwrap();
        let pw = "a\"b\\c\u{1}ñ€\t";
        c.set("s1", pw, &[]).unwrap();
        assert_eq!(c.get("s1").as_deref().map(|s| s.as_str()), Some(pw));
        std::fs::remove_dir_all(&d).unwrap();
    }

    // ---------- Archivos de referencia (formato en disco) ----------
    //
    // `tests/fixtures/*.vault` se generaron con chacha20poly1305 0.10 y argon2 0.5. Deben
    // abrir sin cambios con cualquier versión posterior: si una actualización rompe estas
    // pruebas, cambió el formato y las bóvedas de los usuarios dejarían de abrir.

    const GOLDEN_MASTER: &str = "maestra-de-prueba-1";
    /// Llave fija que simula la del llavero del sistema (solo pruebas).
    const GOLDEN_KEY: [u8; 32] = *b"llave-fija-de-prueba-32-bytes-00";
    const GOLDEN_ENTRIES: [(&str, &str); 3] =
        [("sess-1", "Pr0b@nd0-123"), ("snmp:core", "{\"community\":\"publica-test\"}"), ("sess-ñ", "a\"b\\c\u{1}ñ€\t")];

    fn fixture(name: &str) -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures").join(name)
    }

    /// Copia un archivo de referencia como `credentials.vault` de una carpeta temporal.
    fn golden_dir(name: &str) -> (PathBuf, Vec<u8>) {
        let d = dir();
        let bytes = std::fs::read(fixture(name)).unwrap();
        std::fs::write(d.join("credentials.vault"), &bytes).unwrap();
        (d, bytes)
    }

    fn keyring_with(key: &[u8]) -> MemKeys {
        MemKeys(std::sync::Arc::new(Mutex::new(Some(key.to_vec()))), false)
    }

    fn assert_golden_entries(c: &Credentials) {
        for (id, pw) in GOLDEN_ENTRIES {
            assert_eq!(c.get(id).as_deref().map(|s| s.as_str()), Some(pw), "{id}");
        }
        assert!(c.get("no-existe").is_none());
    }

    /// Regenera los archivos de referencia. Solo a mano y con la versión anterior:
    /// `NT_WRITE_GOLDEN=1 cargo test --lib write_golden_vaults -- --ignored`.
    #[test]
    #[ignore]
    fn write_golden_vaults() {
        if std::env::var("NT_WRITE_GOLDEN").as_deref() != Ok("1") {
            return;
        }
        let entries = || Entries(GOLDEN_ENTRIES.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect());
        std::fs::create_dir_all(fixture("")).unwrap();
        // Contraseña maestra, parámetros por defecto.
        let d = dir();
        let c = Credentials::with(&d, true, Box::new(MemKeys::default()), KDF_DEFAULT);
        let salt = random::<16>();
        let key = derive(GOLDEN_MASTER, &salt, KDF_DEFAULT).unwrap();
        c.encrypt_write(&key, Mode::Master, KDF_DEFAULT, salt, &entries()).unwrap();
        std::fs::copy(d.join("credentials.vault"), fixture("credentials-master.vault")).unwrap();
        // Llavero, con la llave fija.
        let d = dir();
        let c = Credentials::with(&d, false, Box::new(keyring_with(&GOLDEN_KEY)), KDF_DEFAULT);
        c.encrypt_write(&GOLDEN_KEY, Mode::Keyring, Kdf { m: 0, t: 0, p: 0 }, random(), &entries()).unwrap();
        std::fs::copy(d.join("credentials.vault"), fixture("credentials-keyring.vault")).unwrap();
    }

    #[test]
    fn golden_master_vault_opens() {
        let (d, bytes) = golden_dir("credentials-master.vault");
        // Cabecera: NTVAULT | v1 | modo 1 | m=65536 t=3 p=1 | sal (16) | nonce (24).
        assert_eq!(&bytes[..9], b"NTVAULT\x01\x01");
        assert_eq!(Kdf::decode(&bytes[9..21]), KDF_DEFAULT);
        let c = Credentials::with(&d, true, Box::new(MemKeys::default()), FAST);
        assert_eq!(c.status().backend, "vault");
        assert!(c.unlock("maestra-de-prueba-2").is_err());
        lock(&c.inner).throttle.retry_at = None;
        c.unlock(GOLDEN_MASTER).unwrap();
        assert_golden_entries(&c);
        // La llave derivada descifra el archivo directamente con la cabecera como AAD.
        let h = Header::decode(&bytes).unwrap();
        let key = derive(GOLDEN_MASTER, &h.salt, h.kdf).unwrap();
        let plain = seal::decrypt(&key, &h.nonce, &bytes[HEADER_LEN..], &bytes[..HEADER_LEN]).unwrap();
        let map: HashMap<String, String> = serde_json::from_slice(&plain).unwrap();
        assert_eq!(map.len(), GOLDEN_ENTRIES.len());
        assert_eq!(std::fs::read(d.join("credentials.vault")).unwrap(), bytes, "leer no reescribe");
        std::fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn golden_keyring_vault_opens() {
        let (d, bytes) = golden_dir("credentials-keyring.vault");
        assert_eq!(&bytes[..9], b"NTVAULT\x01\x00");
        assert_eq!(&bytes[9..21], &[0u8; 12]);
        let c = Credentials::with(&d, false, Box::new(keyring_with(&GOLDEN_KEY)), FAST);
        assert_eq!(c.status().backend, "keychain");
        assert_golden_entries(&c);
        // Otra llave en el llavero: no abre.
        let other = Credentials::with(&d, false, Box::new(keyring_with(&[7u8; 32])), FAST);
        assert!(other.get("sess-1").is_none());
        assert!(other.has("sess-1").is_err());
        std::fs::remove_dir_all(&d).unwrap();
    }

    /// Reescribir una bóveda de referencia con el código actual mantiene la cabecera
    /// (magia, versión, modo, parámetros, sal) y el largo; solo cambia el nonce.
    #[test]
    fn golden_vaults_roundtrip_keeps_format() {
        for (name, portable, keys, master) in [
            ("credentials-master.vault", true, MemKeys::default(), Some(GOLDEN_MASTER)),
            ("credentials-keyring.vault", false, keyring_with(&GOLDEN_KEY), None),
        ] {
            let (d, before) = golden_dir(name);
            let c = Credentials::with(&d, portable, Box::new(keys.clone()), FAST);
            if let Some(m) = master {
                c.unlock(m).unwrap();
            }
            c.set("tmp", "x", &["sess-1".into(), "sess-ñ".into(), "tmp".into()]).unwrap();
            c.delete("tmp").unwrap();
            let after = std::fs::read(d.join("credentials.vault")).unwrap();
            assert_eq!(after.len(), before.len(), "{name}");
            assert_eq!(&after[..37], &before[..37], "{name}: cabecera sin el nonce");
            assert_ne!(&after[37..61], &before[37..61], "{name}: nonce nuevo");
            let c2 = Credentials::with(&d, portable, Box::new(keys), FAST);
            if let Some(m) = master {
                c2.unlock(m).unwrap();
            }
            assert_golden_entries(&c2);
            std::fs::remove_dir_all(&d).unwrap();
        }
    }

    /// Una bóveda nueva tiene exactamente el diseño v1: cabecera de 61 bytes + JSON + etiqueta.
    #[test]
    fn new_vault_layout_is_v1() {
        let d = dir();
        let c = Credentials::with(&d, true, Box::new(MemKeys::default()), FAST);
        c.create("maestra-larga").unwrap();
        let b = std::fs::read(d.join("credentials.vault")).unwrap();
        assert_eq!(HEADER_LEN, 61);
        assert_eq!(b.len(), HEADER_LEN + 2 + 16, "\"{{}}\" cifrado + etiqueta de 16 bytes");
        assert_eq!(&b[..9], b"NTVAULT\x01\x01");
        assert_eq!(Kdf::decode(&b[9..21]), FAST);
        let h = Header::decode(&b).unwrap();
        let key = derive("maestra-larga", &h.salt, h.kdf).unwrap();
        assert_eq!(seal::decrypt(&key, &h.nonce, &b[HEADER_LEN..], &b[..HEADER_LEN]).unwrap().as_slice(), b"{}");
        std::fs::remove_dir_all(&d).unwrap();
    }

    // ---------- Vecinos alcanzados por salto ----------

    #[test]
    fn hop_key_is_normalized_and_strict() {
        assert_eq!(hop_key("192.0.2.12", "noc").unwrap(), "hop:192.0.2.12|noc");
        assert_eq!(hop_key(" 192.0.2.12 ", " noc ").unwrap(), "hop:192.0.2.12|noc");
        // IPv6: la forma canónica es única (mayúsculas y ceros de más no crean entradas distintas).
        assert_eq!(hop_key("2001:DB8:0:0:0:0:0:1", "noc").unwrap(), hop_key("2001:db8::1", "noc").unwrap());
        // El usuario distingue mayúsculas: son cuentas distintas.
        assert_ne!(hop_key("192.0.2.12", "Noc").unwrap(), hop_key("192.0.2.12", "noc").unwrap());
        for ip in ["", "core-sw01", "192.0.2.256", "0.0.0.0", "::", "192.0.2.1|x", "192.0.2.1 -o x", "224.0.0.1"] {
            assert!(hop_key(ip, "noc").is_err(), "{ip:?}");
        }
        for user in ["", "-l", "a b", "a|b", "a\nb", "noc;reboot", &"u".repeat(65)] {
            assert!(hop_key("192.0.2.12", user).is_err(), "{user:?}");
        }
        for user in ["noc", "a", "DOM\\noc", "noc@corp.example", "svc_1-b.c"] {
            assert!(valid_hop_user(user), "{user:?}");
        }
    }

    #[test]
    fn hop_credentials_roundtrip_without_leaking() {
        let d = dir();
        let c = Credentials::with(&d, true, Box::new(MemKeys::default()), FAST);
        assert!(c.hop_set("192.0.2.12", "noc", "x").is_err(), "sin bóveda no se guarda");
        c.create("maestra-larga").unwrap();
        assert!(c.hop_list().unwrap().is_empty());
        c.hop_set("192.0.2.12", "noc", "V3cino-Cl4ve").unwrap();
        c.hop_set("192.0.2.13", "admin", "Otra-Cl4ve").unwrap();
        assert!(c.hop_has("192.0.2.12", "noc").unwrap());
        assert!(!c.hop_has("192.0.2.12", "admin").unwrap(), "la clave incluye el usuario");
        assert_eq!(c.hop_get("192.0.2.12", "noc").as_deref().map(|s| s.as_str()), Some("V3cino-Cl4ve"));
        // La lista no trae contraseñas y el archivo no las tiene en claro.
        let list = c.hop_list().unwrap();
        assert_eq!(
            list,
            vec![
                HopInfo { ip: "192.0.2.12".into(), user: "noc".into(), last_used: None },
                HopInfo { ip: "192.0.2.13".into(), user: "admin".into(), last_used: None },
            ]
        );
        assert!(!format!("{list:?}").contains("Cl4ve"));
        let raw = std::fs::read(d.join("credentials.vault")).unwrap();
        assert!(!raw.windows(8).any(|w| w == b"V3cino-C"));
        // Último uso; reemplazar la contraseña lo conserva.
        c.hop_touch("192.0.2.12", "noc", 1_700_000_000);
        c.hop_set("192.0.2.12", "noc", "Nueva-Cl4ve").unwrap();
        assert_eq!(c.hop_list().unwrap()[0].last_used, Some(1_700_000_000));
        assert_eq!(c.hop_get("192.0.2.12", "noc").as_deref().map(|s| s.as_str()), Some("Nueva-Cl4ve"));
        // Una entrada de vecino no se mezcla con las de sesión (ni las limpia como huérfanas).
        c.set("s1", "sesion", &["s1".into()]).unwrap();
        c.set("s2", "otra", &["s1".into(), "s2".into()]).unwrap();
        assert!(c.hop_has("192.0.2.13", "admin").unwrap());
        assert_eq!(c.get("s2").as_deref().map(|s| s.as_str()), Some("otra"));
        // Bloqueada: no se lista, no se lee ni se pide.
        c.lock();
        assert!(c.hop_get("192.0.2.12", "noc").is_none());
        assert_eq!(c.hop_list().unwrap_err(), LOCKED);
        assert_eq!(c.hop_has("192.0.2.12", "noc").unwrap_err(), LOCKED);
        assert_eq!(c.hop_set("192.0.2.12", "noc", "x").unwrap_err(), LOCKED);
        lock(&c.inner).throttle.retry_at = None;
        c.unlock("maestra-larga").unwrap();
        c.hop_delete("192.0.2.12", "noc").unwrap();
        assert!(!c.hop_has("192.0.2.12", "noc").unwrap());
        assert_eq!(c.hop_list().unwrap().len(), 1);
        // Entradas inválidas.
        assert!(c.hop_set("192.0.2.12", "noc", "").is_err());
        assert!(c.hop_set("192.0.2.12", "noc", "a\nb").is_err());
        assert!(c.hop_set("core-sw01", "noc", "x").is_err());
        std::fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn hop_credentials_have_a_cap() {
        let d = dir();
        let c = Credentials::with(&d, true, Box::new(MemKeys::default()), FAST);
        c.create("maestra-larga").unwrap();
        for i in 0..MAX_HOP_ENTRIES {
            c.hop_set(&format!("198.51.100.{}", i + 1), "noc", "x").unwrap();
        }
        assert!(c.hop_set("203.0.113.1", "noc", "x").unwrap_err().contains("100"));
        // Reemplazar una existente sí se puede.
        c.hop_set("198.51.100.1", "noc", "y").unwrap();
        assert_eq!(c.hop_list().unwrap().len(), MAX_HOP_ENTRIES);
        std::fs::remove_dir_all(&d).unwrap();
    }

    /// Las bóvedas de referencia (sin entradas de vecinos) abren igual: se les agregan vecinos sin
    /// tocar la cabecera ni las contraseñas de sesión y SNMP, y las entradas de vecinos
    /// sobreviven a guardar una sesión (que limpia huérfanas).
    #[test]
    fn golden_vaults_accept_hop_entries_and_keep_compat() {
        for (name, portable, keys, master) in [
            ("credentials-master.vault", true, MemKeys::default(), Some(GOLDEN_MASTER)),
            ("credentials-keyring.vault", false, keyring_with(&GOLDEN_KEY), None),
        ] {
            let (d, before) = golden_dir(name);
            let c = Credentials::with(&d, portable, Box::new(keys.clone()), FAST);
            if let Some(m) = master {
                c.unlock(m).unwrap();
            }
            assert!(c.hop_list().unwrap().is_empty(), "{name}: sin vecinos al inicio");
            assert_eq!(std::fs::read(d.join("credentials.vault")).unwrap(), before, "{name}: listar no reescribe");
            c.hop_set("192.0.2.12", "noc", "V3cino").unwrap();
            c.set("sess-1", "Pr0b@nd0-123", &["sess-1".into(), "sess-ñ".into()]).unwrap();
            let after = std::fs::read(d.join("credentials.vault")).unwrap();
            assert_eq!(&after[..37], &before[..37], "{name}: cabecera sin el nonce");
            let c2 = Credentials::with(&d, portable, Box::new(keys), FAST);
            if let Some(m) = master {
                c2.unlock(m).unwrap();
            }
            assert_golden_entries(&c2);
            assert_eq!(c2.hop_get("192.0.2.12", "noc").as_deref().map(|s| s.as_str()), Some("V3cino"));
            // El mapa descifrado sigue siendo texto a texto: una versión que no conoce `hop:` lo lee.
            let (h, bytes) = c2.read().unwrap().unwrap();
            assert_eq!(h.mode as u8, if portable { 1 } else { 0 });
            assert!(bytes.len() > before.len());
            std::fs::remove_dir_all(&d).unwrap();
        }
    }

    #[test]
    fn rejects_bad_inputs() {
        let d = dir();
        let c = Credentials::with(&d, false, Box::new(MemKeys::default()), FAST);
        assert!(c.set("s1", "", &[]).is_err());
        assert!(c.set("s1", &"x".repeat(MAX_PASSWORD + 1), &[]).is_err());
        assert!(c.set("s1", "a\rb", &[]).is_err());
        assert!(c.set(&"i".repeat(200), "x", &[]).is_err());
        assert!(c.set("", "x", &[]).is_err());
        std::fs::remove_dir_all(&d).unwrap();
    }
}
