//! Historial acotado en la carpeta de datos: destinos recientes de conexión rápida y
//! comandos enviados explícitamente (Notas, catálogo, botones) por equipo. Nunca se
//! registran pulsaciones de teclado.

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::sync::Mutex;

/// Serializa lecturas y escrituras de ambos archivos (lectura-modificación-escritura).
static LOCK: Mutex<()> = Mutex::new(());

const RECENT_FILE: &str = "recent_targets.json";
const CMD_FILE: &str = "command_history.json";
pub const RECENT_MAX: usize = 20;
pub const CMD_PER_DEVICE: usize = 50;
const MAX_DEVICES: usize = 300;
const MAX_CMD_LEN: usize = 4096;
const MAX_KEY_LEN: usize = 200;
const MAX_TARGET_LEN: usize = 300;
/// Un archivo más grande que esto se considera dañado y se ignora.
const MAX_FILE: u64 = 4 * 1024 * 1024;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct CmdEntry {
    pub cmd: String,
    /// Milisegundos desde 1970.
    pub ts: i64,
}

#[derive(Serialize, Deserialize, Default)]
struct CmdFile {
    #[serde(default)]
    devices: HashMap<String, Vec<CmdEntry>>,
}

fn lock() -> std::sync::MutexGuard<'static, ()> {
    LOCK.lock().unwrap_or_else(|e| e.into_inner())
}

fn load<T: DeserializeOwned + Default>(path: &Path) -> T {
    if fs::metadata(path).map(|m| m.len() > MAX_FILE).unwrap_or(true) {
        return T::default();
    }
    fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn store<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, serde_json::to_string(value).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    crate::session_store::restrict(&tmp);
    fs::rename(&tmp, path).map_err(|e| e.to_string())
}

fn clean(value: &str, max: usize) -> Option<String> {
    let v = value.trim();
    (!v.is_empty() && v.len() <= max && !v.chars().any(|c| c.is_control())).then(|| v.to_string())
}

// ---------- Conexión rápida ----------

pub fn recent_list(dir: &Path) -> Vec<String> {
    let _g = lock();
    let mut v: Vec<String> = load(&dir.join(RECENT_FILE));
    v.retain(|t| clean(t, MAX_TARGET_LEN).is_some());
    v.truncate(RECENT_MAX);
    v
}

/// Agrega un destino al inicio (sin duplicados, sin distinguir mayúsculas).
pub fn recent_add(dir: &Path, target: &str) -> Result<Vec<String>, String> {
    let target = clean(target, MAX_TARGET_LEN).ok_or("Destino inválido")?;
    let _g = lock();
    let path = dir.join(RECENT_FILE);
    let mut v: Vec<String> = load(&path);
    v.retain(|t| !t.eq_ignore_ascii_case(&target));
    v.insert(0, target);
    v.truncate(RECENT_MAX);
    store(&path, &v)?;
    Ok(v)
}

pub fn recent_clear(dir: &Path) -> Result<(), String> {
    let _g = lock();
    match fs::remove_file(dir.join(RECENT_FILE)) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.to_string()),
        _ => Ok(()),
    }
}

// ---------- Comandos por equipo ----------

/// Comandos que probablemente llevan una contraseña o secreto: no se guardan.
pub fn looks_secret(cmd: &str) -> bool {
    const WORDS: [&str; 9] = [
        "password",
        "passwd",
        "secret",
        "community",
        "key-string",
        "pre-shared-key",
        "psksecret",
        "authentication-key",
        "set psk",
    ];
    let lower = cmd.to_lowercase();
    WORDS.iter().any(|w| {
        lower.match_indices(w).any(|(i, _)| {
            // Debe venir seguido de un valor (ej. "enable secret X"), no solo mencionarse.
            let after = &lower[i + w.len()..];
            after.starts_with(char::is_whitespace) && !after.trim().is_empty()
        })
    })
}

pub fn cmd_list(dir: &Path, key: &str) -> Vec<CmdEntry> {
    let _g = lock();
    let mut file: CmdFile = load(&dir.join(CMD_FILE));
    file.devices.remove(key).unwrap_or_default()
}

/// Registra un comando enviado. Devuelve false si se omitió (vacío o con secretos).
pub fn cmd_add(dir: &Path, key: &str, cmd: &str) -> Result<bool, String> {
    let key = clean(key, MAX_KEY_LEN).ok_or("Clave de equipo inválida")?;
    let cmd = cmd.trim_end_matches(['\r', '\n', ' ', '\t']).trim_start_matches(['\r', '\n']);
    if cmd.trim().is_empty() || cmd.len() > MAX_CMD_LEN || looks_secret(cmd) {
        return Ok(false);
    }
    let _g = lock();
    let path = dir.join(CMD_FILE);
    let mut file: CmdFile = load(&path);
    let list = file.devices.entry(key).or_default();
    list.retain(|e| e.cmd != cmd);
    list.insert(0, CmdEntry { cmd: cmd.to_string(), ts: chrono::Utc::now().timestamp_millis() });
    list.truncate(CMD_PER_DEVICE);
    // Tope de equipos: se descartan los usados hace más tiempo.
    if file.devices.len() > MAX_DEVICES {
        let mut by_age: Vec<(String, i64)> =
            file.devices.iter().map(|(k, v)| (k.clone(), v.first().map(|e| e.ts).unwrap_or(0))).collect();
        by_age.sort_by_key(|(_, ts)| *ts);
        for (k, _) in by_age.into_iter().take(file.devices.len() - MAX_DEVICES) {
            file.devices.remove(&k);
        }
    }
    store(&path, &file)?;
    Ok(true)
}

/// Borra el historial de un equipo o, sin clave, el de todos.
pub fn cmd_clear(dir: &Path, key: Option<&str>) -> Result<(), String> {
    let _g = lock();
    let path = dir.join(CMD_FILE);
    match key {
        Some(k) => {
            let mut file: CmdFile = load(&path);
            if file.devices.remove(k).is_some() {
                store(&path, &file)?;
            }
            Ok(())
        }
        None => match fs::remove_file(&path) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.to_string()),
            _ => Ok(()),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(tag: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!("nt-hist-{tag}-{}", uuid::Uuid::new_v4()))
    }

    #[test]
    fn recent_targets_are_deduped_and_bounded() {
        let dir = tmp("recent");
        for i in 0..25 {
            recent_add(&dir, &format!("ssh admin@192.0.2.{i} 22")).unwrap();
        }
        recent_add(&dir, "SSH admin@192.0.2.24 22").unwrap();
        let v = recent_list(&dir);
        assert_eq!(v.len(), RECENT_MAX);
        assert_eq!(v[0], "SSH admin@192.0.2.24 22");
        assert_eq!(v.iter().filter(|t| t.ends_with(".24 22")).count(), 1);
        assert!(recent_add(&dir, "a\nb").is_err());
        recent_clear(&dir).unwrap();
        assert!(recent_list(&dir).is_empty());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn command_history_per_device() {
        let dir = tmp("cmd");
        for i in 0..60 {
            assert!(cmd_add(&dir, "s1", &format!("show interface Gi1/0/{i}\n")).unwrap());
        }
        cmd_add(&dir, "s1", "show interface Gi1/0/3").unwrap();
        let v = cmd_list(&dir, "s1");
        assert_eq!(v.len(), CMD_PER_DEVICE);
        assert_eq!(v[0].cmd, "show interface Gi1/0/3");
        assert_eq!(v.iter().filter(|e| e.cmd == "show interface Gi1/0/3").count(), 1);
        // Secretos y vacíos no se guardan.
        assert!(!cmd_add(&dir, "s1", "enable secret 0 MiClave").unwrap());
        assert!(!cmd_add(&dir, "s1", "username noc password 0 x").unwrap());
        assert!(!cmd_add(&dir, "s1", "snmp-server community publico RO").unwrap());
        assert!(!cmd_add(&dir, "s1", "   \n").unwrap());
        assert!(cmd_add(&dir, "s1", "show running-config | include password").unwrap());
        assert!(cmd_list(&dir, "otro").is_empty());
        cmd_clear(&dir, Some("s1")).unwrap();
        assert!(cmd_list(&dir, "s1").is_empty());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn detects_secrets_only_with_value() {
        assert!(looks_secret("enable secret 5 $1$abc"));
        assert!(looks_secret("set psksecret ENC xyz"));
        assert!(!looks_secret("show password-policy"));
        assert!(!looks_secret("show snmp community"));
    }
}
