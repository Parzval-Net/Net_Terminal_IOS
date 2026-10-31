//! Llaves privadas SSH guardadas por la app (pensado para iOS, donde no hay ~/.ssh y la carpeta
//! de datos no se ve en Archivos). Se importan desde el selector de documentos o se generan
//! aquí, quedan en `<datos>/keys/<nombre>` con permisos 0600 y la sesión guarda la ruta
//! relativa `keys/<nombre>`, que es la que resuelve ssh_native.

use std::path::{Path, PathBuf};
use zeroize::Zeroizing;

/// Tamaño máximo de una llave (una RSA 16384 en formato OpenSSH ronda los 13 KB).
const MAX_KEY: u64 = 64 * 1024;
const DIR: &str = "keys";

#[derive(serde::Serialize)]
pub struct KeyInfo {
    pub name: String,
    /// Ruta relativa para `identity_file` ("keys/<nombre>").
    pub path: String,
}

#[derive(serde::Serialize)]
pub struct Generated {
    pub path: String,
    /// Llave pública en formato authorized_keys.
    pub public: String,
}

fn keys_dir(data_dir: &Path) -> PathBuf {
    data_dir.join(DIR)
}

/// Nombre de archivo seguro: solo letras, dígitos, ".", "-" y "_", sin empezar con ".".
fn safe_name(name: &str) -> Result<String, String> {
    let n: String = name
        .trim()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_') { c } else { '_' })
        .collect();
    let n = n.trim_start_matches('.').chars().take(64).collect::<String>();
    if n.is_empty() || n.ends_with(".pub") {
        return Err("Nombre de llave inválido".into());
    }
    Ok(n)
}

/// Primer nombre libre en la carpeta: "id", "id-2", "id-3"…
fn free_name(dir: &Path, base: &str) -> String {
    if !dir.join(base).exists() {
        return base.to_string();
    }
    (2..).map(|i| format!("{base}-{i}")).find(|n| !dir.join(n).exists()).unwrap_or_default()
}

/// Ruta que entrega el selector: una ruta o una URL file:// (iOS) con %XX.
fn picked_path(p: &str) -> PathBuf {
    let Some(rest) = p.strip_prefix("file://") else {
        return PathBuf::from(p);
    };
    let bytes = rest.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        let hex = |b: u8| (b as char).to_digit(16);
        match (bytes[i], bytes.get(i + 1).and_then(|b| hex(*b)), bytes.get(i + 2).and_then(|b| hex(*b))) {
            (b'%', Some(h), Some(l)) => {
                out.push((h * 16 + l) as u8);
                i += 3;
            }
            (b, _, _) => {
                out.push(b);
                i += 1;
            }
        }
    }
    PathBuf::from(String::from_utf8_lossy(&out).into_owned())
}

/// El contenido parece una llave privada OpenSSH o PEM (PKCS#1/#8, EC, DSA).
fn check_key(text: &str) -> Result<(), String> {
    let t = text.trim();
    if t.starts_with("PuTTY-User-Key-File") {
        return Err("Las llaves .ppk de PuTTY no se admiten: conviértela a formato OpenSSH con PuTTYgen".into());
    }
    if t.starts_with("ssh-") || t.starts_with("ecdsa-") || t.contains("PUBLIC KEY-----") {
        return Err("Es una llave pública: importa la privada (sin .pub)".into());
    }
    let begin = t.lines().next().unwrap_or("");
    let ok = begin.starts_with("-----BEGIN ")
        && begin.ends_with("PRIVATE KEY-----")
        && t.lines().last().is_some_and(|l| l.starts_with("-----END ") && l.ends_with("PRIVATE KEY-----"));
    if !ok {
        return Err("El archivo no parece una llave privada OpenSSH o PEM".into());
    }
    // Donde está russh, se decodifica de verdad (una cifrada se acepta: la frase se pide al conectar).
    #[cfg(any(target_os = "ios", test))]
    match russh::keys::decode_secret_key(t, None) {
        Ok(_) | Err(russh::keys::Error::KeyIsEncrypted) => {}
        Err(e) => return Err(format!("Llave inválida: {e}")),
    }
    Ok(())
}

fn write_private(path: &Path, text: &[u8]) -> Result<(), String> {
    use std::io::Write;
    let mut o = std::fs::OpenOptions::new();
    o.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        o.mode(0o600);
    }
    let mut f = o.open(path).map_err(|e| format!("No se pudo guardar la llave: {e}"))?;
    let r = f.write_all(text).and_then(|_| f.sync_all());
    if let Err(e) = r {
        let _ = std::fs::remove_file(path);
        return Err(format!("No se pudo guardar la llave: {e}"));
    }
    Ok(())
}

fn prepare_dir(data_dir: &Path) -> Result<PathBuf, String> {
    let dir = keys_dir(data_dir);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    crate::session_store::restrict(&dir);
    Ok(dir)
}

/// Copia la llave elegida a la carpeta de llaves. Devuelve "keys/<nombre>".
pub fn import(data_dir: &Path, source: &str) -> Result<String, String> {
    let src = picked_path(source);
    let meta = std::fs::metadata(&src).map_err(|e| format!("No se pudo leer el archivo: {e}"))?;
    if !meta.is_file() {
        return Err("Elige un archivo".into());
    }
    if meta.len() > MAX_KEY {
        return Err("El archivo es demasiado grande para ser una llave (máximo 64 KB)".into());
    }
    let bytes = Zeroizing::new(std::fs::read(&src).map_err(|e| format!("No se pudo leer el archivo: {e}"))?);
    if bytes.len() as u64 > MAX_KEY {
        return Err("El archivo es demasiado grande para ser una llave (máximo 64 KB)".into());
    }
    let text = std::str::from_utf8(&bytes).map_err(|_| "El archivo no parece una llave privada OpenSSH o PEM".to_string())?;
    check_key(text)?;
    let dir = prepare_dir(data_dir)?;
    let base = safe_name(src.file_name().and_then(|n| n.to_str()).unwrap_or("id_key"))?;
    let name = free_name(&dir, &base);
    write_private(&dir.join(&name), &bytes)?;
    Ok(format!("{DIR}/{name}"))
}

pub fn list(data_dir: &Path) -> Vec<KeyInfo> {
    let Ok(rd) = std::fs::read_dir(keys_dir(data_dir)) else {
        return Vec::new();
    };
    let mut out: Vec<KeyInfo> = rd
        .flatten()
        .filter(|e| e.file_type().is_ok_and(|t| t.is_file()))
        .filter_map(|e| e.file_name().to_str().map(str::to_owned))
        .filter(|n| safe_name(n).as_deref() == Ok(n.as_str()))
        .map(|name| KeyInfo { path: format!("{DIR}/{name}"), name })
        .collect();
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    out
}

/// Borra una llave importada (acepta el nombre o "keys/<nombre>").
pub fn delete(data_dir: &Path, name: &str) -> Result<(), String> {
    let name = name.strip_prefix("keys/").unwrap_or(name);
    if safe_name(name).as_deref() != Ok(name) {
        return Err("Nombre de llave inválido".into());
    }
    let path = keys_dir(data_dir).join(name);
    std::fs::remove_file(&path).map_err(|e| format!("No se pudo borrar la llave: {e}"))?;
    Ok(())
}

/// Genera un par ed25519 (RNG del sistema). La privada queda en la carpeta de llaves.
#[cfg(any(target_os = "ios", test))]
pub fn generate(data_dir: &Path, name: &str) -> Result<Generated, String> {
    use russh::keys::ssh_key::{private::Ed25519Keypair, LineEnding, PrivateKey};
    let mut seed = Zeroizing::new([0u8; 32]);
    getrandom::fill(seed.as_mut()).map_err(|e| e.to_string())?;
    let mut key = PrivateKey::from(Ed25519Keypair::from_seed(&seed));
    let base = safe_name(if name.trim().is_empty() { "id_ed25519" } else { name })?;
    key.set_comment(format!("netterminal-{base}"));
    let private = key.to_openssh(LineEnding::LF).map_err(|e| e.to_string())?;
    let public = key.public_key().to_openssh().map_err(|e| e.to_string())?;
    let dir = prepare_dir(data_dir)?;
    let name = free_name(&dir, &base);
    write_private(&dir.join(&name), private.as_bytes())?;
    Ok(Generated { path: format!("{DIR}/{name}"), public })
}

#[cfg(not(any(target_os = "ios", test)))]
pub fn generate(_data_dir: &Path, _name: &str) -> Result<Generated, String> {
    Err("Generar llaves solo está disponible en iOS (en el PC usa ssh-keygen)".into())
}

/// Llave pública de una llave guardada (para copiarla a authorized_keys).
#[cfg(any(target_os = "ios", test))]
pub fn public_of(data_dir: &Path, name: &str) -> Result<String, String> {
    let name = name.strip_prefix("keys/").unwrap_or(name);
    if safe_name(name).as_deref() != Ok(name) {
        return Err("Nombre de llave inválido".into());
    }
    let text = Zeroizing::new(std::fs::read_to_string(keys_dir(data_dir).join(name)).map_err(|e| e.to_string())?);
    match russh::keys::decode_secret_key(&text, None) {
        Ok(k) => k.public_key().to_openssh().map_err(|e| e.to_string()),
        Err(russh::keys::Error::KeyIsEncrypted) => Err("La llave está cifrada: su pública no se puede obtener sin la frase".into()),
        Err(e) => Err(format!("Llave inválida: {e}")),
    }
}

#[cfg(not(any(target_os = "ios", test)))]
pub fn public_of(_data_dir: &Path, _name: &str) -> Result<String, String> {
    Err("Solo disponible en iOS".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp() -> PathBuf {
        let d = std::env::temp_dir().join(format!("nt_keys_{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn imports_validates_lists_and_deletes() {
        let data = tmp();
        let src = tmp();
        let gen = generate(&data, "").unwrap();
        assert_eq!(gen.path, "keys/id_ed25519");
        assert!(gen.public.starts_with("ssh-ed25519 "));
        assert_eq!(public_of(&data, "keys/id_ed25519").unwrap(), gen.public);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(data.join(&gen.path)).unwrap().permissions().mode();
            assert_eq!(mode & 0o777, 0o600);
        }

        // Importar la misma llave desde una URL file:// con espacios codificados.
        let key = std::fs::read(data.join(&gen.path)).unwrap();
        let f = src.join("mi llave");
        std::fs::write(&f, &key).unwrap();
        let url = format!("file://{}", f.to_string_lossy().replace(' ', "%20"));
        assert_eq!(import(&data, &url).unwrap(), "keys/mi_llave");
        assert_eq!(import(&data, f.to_str().unwrap()).unwrap(), "keys/mi_llave-2");
        let names: Vec<_> = list(&data).into_iter().map(|k| k.name).collect();
        assert_eq!(names, ["id_ed25519", "mi_llave", "mi_llave-2"]);

        // Rechazos: pública, basura, demasiado grande, PuTTY.
        for (content, msg) in [
            (gen.public.clone().into_bytes(), "pública"),
            (b"hola".to_vec(), "no parece"),
            (b"PuTTY-User-Key-File-3: ssh-ed25519\n".to_vec(), "PuTTY"),
            (vec![b'a'; 70 * 1024], "grande"),
            (b"-----BEGIN OPENSSH PRIVATE KEY-----\nAAAA\n-----END OPENSSH PRIVATE KEY-----\n".to_vec(), "inválida"),
        ] {
            std::fs::write(&f, &content).unwrap();
            let err = import(&data, f.to_str().unwrap()).unwrap_err();
            assert!(err.contains(msg), "{msg}: {err}");
        }

        delete(&data, "keys/mi_llave-2").unwrap();
        assert!(delete(&data, "../sessions.json").is_err());
        assert_eq!(list(&data).len(), 2);
        let _ = std::fs::remove_dir_all(&data);
        let _ = std::fs::remove_dir_all(&src);
    }

    #[test]
    fn names_are_sanitized() {
        assert_eq!(safe_name("../../etc/passwd").unwrap(), "_.._etc_passwd");
        assert_eq!(safe_name(".hidden").unwrap(), "hidden");
        assert!(safe_name("id.pub").is_err());
        assert!(safe_name("...").is_err());
    }
}
