//! Packs de comandos del usuario: archivos JSON en `<datos>/command-packs`. Son solo
//! datos; la validación de contenido y el cálculo de riesgo ocurren en el frontend.

use std::fs;
use std::path::{Path, PathBuf};

const MAX_BYTES: u64 = 2 * 1024 * 1024;

fn dir(data: &Path) -> PathBuf {
    let d = data.join("command-packs");
    let _ = fs::create_dir_all(&d);
    d
}

fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || "-_.".contains(c))
        && !id.starts_with('.')
}

fn read_json(path: &Path) -> Result<serde_json::Value, String> {
    let meta = fs::metadata(path).map_err(|e| e.to_string())?;
    if meta.len() > MAX_BYTES {
        return Err("El pack supera 2 MB".into());
    }
    let text = fs::read_to_string(path).map_err(|e| e.to_string())?;
    serde_json::from_str(&text).map_err(|e| format!("JSON inválido: {e}"))
}

pub fn list(data: &Path) -> Vec<serde_json::Value> {
    let mut out: Vec<serde_json::Value> = fs::read_dir(dir(data))
        .into_iter()
        .flatten()
        .flatten()
        .filter(|e| e.path().extension().is_some_and(|x| x == "json"))
        .filter_map(|e| read_json(&e.path()).ok())
        .collect();
    out.sort_by(|a, b| a["name"].as_str().cmp(&b["name"].as_str()));
    out
}

/// Lee un archivo elegido por el usuario (no lo instala: el frontend lo valida primero).
pub fn read_external(path: &str) -> Result<serde_json::Value, String> {
    read_json(Path::new(path))
}

pub fn save(data: &Path, pack: &serde_json::Value) -> Result<String, String> {
    let id = pack["id"].as_str().filter(|i| valid_id(i)).ok_or("id de pack inválido")?;
    let json = serde_json::to_string_pretty(pack).map_err(|e| e.to_string())?;
    if json.len() as u64 > MAX_BYTES {
        return Err("El pack supera 2 MB".into());
    }
    let path = dir(data).join(format!("{id}.json"));
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, json).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
    Ok(id.to_string())
}

pub fn delete(data: &Path, id: &str) -> Result<(), String> {
    if !valid_id(id) {
        return Err("id inválido".into());
    }
    fs::remove_file(dir(data).join(format!("{id}.json"))).map_err(|e| e.to_string())
}

/// Guarda una copia del pack en la ruta que el usuario eligió en el diálogo.
pub fn export(data: &Path, id: &str, dest: &str) -> Result<(), String> {
    if !valid_id(id) {
        return Err("id inválido".into());
    }
    if !dest.to_lowercase().ends_with(".json") {
        return Err("El archivo debe terminar en .json".into());
    }
    fs::copy(dir(data).join(format!("{id}.json")), dest).map(|_| ()).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn saves_lists_and_rejects_bad_ids() {
        let data = std::env::temp_dir().join(format!("nt-packs-{}", std::process::id()));
        let pack = serde_json::json!({"id": "mi-pack", "name": "Mi pack", "commands": []});
        assert_eq!(save(&data, &pack).unwrap(), "mi-pack");
        assert_eq!(list(&data).len(), 1);
        for bad in ["../x", "Mayus", ".oculto", ""] {
            assert!(save(&data, &serde_json::json!({"id": bad})).is_err(), "{bad}");
        }
        assert!(delete(&data, "../../etc").is_err());
        delete(&data, "mi-pack").unwrap();
        assert!(list(&data).is_empty());
        let _ = fs::remove_dir_all(data);
    }
}
