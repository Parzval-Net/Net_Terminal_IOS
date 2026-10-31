//! Plugins instalables: carpeta con `plugin.json` + script Python que usa la API de
//! `netterminal.py`.
//!
//! Seguridad:
//! - Instalar siempre pasa por una revisión: se muestran manifiesto, permisos, archivos
//!   y el código de entrada antes de confirmar.
//! - Al aprobar se guarda el SHA-256 de todos los archivos. Si cambian después, el
//!   plugin queda bloqueado hasta que el usuario lo revise y lo vuelva a habilitar.
//! - Sin el permiso "session" el plugin no puede leer ni escribir en la sesión.
//! - Los .zip se extraen sin rutas fuera de la carpeta (zip slip) y con límites de
//!   tamaño. Los permisos son declarativos: Python corre con los privilegios del
//!   usuario, por eso la revisión es obligatoria.

use crate::scripts::{RunSpec, ScriptRunner};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

const MAX_FILES: usize = 200;
const MAX_TOTAL: u64 = 20 * 1024 * 1024;
/// "vault-type": pedir que la app escriba la contraseña guardada en un pedido de login de la
/// sesión (`type_saved_password`), sin que el plugin la vea. Exige "session" y además la
/// aprobación del usuario en cada ejecución.
const PERMISSIONS: [&str; 4] = ["session", "network", "files", "vault-type"];

#[derive(Serialize, Deserialize, Clone)]
pub struct Action {
    pub id: String,
    pub label: String,
    #[serde(default)]
    pub description: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct Manifest {
    pub id: String,
    pub name: String,
    pub version: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub author: String,
    #[serde(default = "default_entry")]
    pub entry: String,
    #[serde(default)]
    pub permissions: Vec<String>,
    pub actions: Vec<Action>,
}

fn default_entry() -> String {
    "main.py".into()
}

#[derive(Serialize, Deserialize, Default)]
struct State {
    /// id -> hash aprobado (presente = habilitado)
    approved: BTreeMap<String, String>,
}

#[derive(Serialize)]
pub struct PluginInfo {
    #[serde(flatten)]
    manifest: Manifest,
    enabled: bool,
    /// Archivos modificados desde la aprobación.
    tampered: bool,
}

#[derive(Serialize)]
pub struct Preview {
    staging: String,
    manifest: Manifest,
    files: Vec<(String, u64)>,
    code: String,
    replaces: Option<String>,
}

fn dir(data: &Path) -> PathBuf {
    let d = data.join("plugins");
    let _ = fs::create_dir_all(&d);
    d
}

fn state_path(data: &Path) -> PathBuf {
    dir(data).join(".state.json")
}

fn load_state(data: &Path) -> State {
    fs::read_to_string(state_path(data)).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

fn save_state(data: &Path, st: &State) -> Result<(), String> {
    let p = state_path(data);
    fs::write(&p, serde_json::to_string_pretty(st).unwrap()).map_err(|e| e.to_string())?;
    crate::session_store::restrict(&p);
    Ok(())
}

fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn read_manifest(root: &Path) -> Result<Manifest, String> {
    let raw = fs::read_to_string(root.join("plugin.json")).map_err(|_| "Falta plugin.json".to_string())?;
    let m: Manifest = serde_json::from_str(&raw).map_err(|e| format!("plugin.json inválido: {e}"))?;
    if !valid_id(&m.id) {
        return Err("id inválido (solo letras, números, - y _)".into());
    }
    if m.entry.contains(['/', '\\']) || !m.entry.ends_with(".py") || !root.join(&m.entry).is_file() {
        return Err(format!("Archivo de entrada inválido: {}", m.entry));
    }
    if let Some(p) = m.permissions.iter().find(|p| !PERMISSIONS.contains(&p.as_str())) {
        return Err(format!("Permiso desconocido: {p}"));
    }
    if m.permissions.iter().any(|p| p == "vault-type") && !m.permissions.iter().any(|p| p == "session") {
        return Err("El permiso 'vault-type' requiere también 'session'".into());
    }
    if m.actions.is_empty() || m.actions.iter().any(|a| !valid_id(&a.id)) {
        return Err("Se requiere al menos una acción con id válido".into());
    }
    Ok(m)
}

/// Lista de archivos (ruta relativa, tamaño), sin seguir enlaces simbólicos.
fn walk(root: &Path) -> Result<Vec<(String, u64)>, String> {
    let mut out = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(d) = stack.pop() {
        for e in fs::read_dir(&d).map_err(|e| e.to_string())?.flatten() {
            let ft = e.file_type().map_err(|e| e.to_string())?;
            let path = e.path();
            if ft.is_symlink() {
                return Err("Los plugins no pueden contener enlaces simbólicos".into());
            }
            if ft.is_dir() {
                if e.file_name() != "__pycache__" {
                    stack.push(path);
                }
            } else {
                let rel = path.strip_prefix(root).unwrap().to_string_lossy().replace('\\', "/");
                out.push((rel, e.metadata().map(|m| m.len()).unwrap_or(0)));
            }
        }
        if out.len() > MAX_FILES {
            return Err("Demasiados archivos en el plugin".into());
        }
    }
    out.sort();
    if out.iter().map(|f| f.1).sum::<u64>() > MAX_TOTAL {
        return Err("El plugin supera 20 MB".into());
    }
    Ok(out)
}

/// Extensiones que Python carga como código sin que la revisión pueda mostrarlo: bytecode
/// (`import x` usa x.pyc si no hay x.py), extensiones nativas y archivos .pth.
const OPAQUE_CODE: [&str; 8] = ["pyc", "pyo", "so", "pyd", "dylib", "dll", "pth", "exe"];

/// Declaración de codificación de PEP 263 en una de las dos primeras líneas.
fn coding_cookie(line: &str) -> Option<String> {
    static RE: std::sync::OnceLock<regex::Regex> = std::sync::OnceLock::new();
    let re = RE.get_or_init(|| regex::Regex::new(r"^[ \t\x0c]*#.*?coding[:=][ \t]*([-\w.]+)").unwrap());
    re.captures(line).map(|c| c[1].to_ascii_lowercase().replace('_', "-"))
}

/// Todo el código que Python ejecutará debe verse tal cual en la revisión: sin bytecode ni
/// binarios, y los .py en UTF-8 sin otra codificación declarada (con `coding: utf-7`, un
/// comentario como `# +AAo-print(1)` se ejecuta aunque en pantalla parezca inofensivo).
fn check_reviewable(root: &Path, files: &[(String, u64)]) -> Result<(), String> {
    for (rel, _) in files {
        let ext = Path::new(rel).extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
        if OPAQUE_CODE.contains(&ext.as_str()) {
            return Err(format!("El plugin incluye código que no se puede revisar: {rel}"));
        }
        if ext != "py" {
            continue;
        }
        let bytes = fs::read(root.join(rel)).map_err(|e| e.to_string())?;
        let text = std::str::from_utf8(&bytes).map_err(|_| format!("{rel} no está en UTF-8"))?;
        if let Some(enc) = text.lines().take(2).find_map(coding_cookie) {
            if enc != "utf-8" && enc != "utf8" {
                return Err(format!("{rel} declara la codificación {enc}: solo se acepta UTF-8"));
            }
        }
    }
    Ok(())
}

/// SHA-256 sobre rutas y contenidos (orden estable).
fn hash(root: &Path) -> Result<String, String> {
    let mut h = Sha256::new();
    for (rel, _) in walk(root)? {
        h.update(rel.as_bytes());
        h.update([0]);
        h.update(fs::read(root.join(&rel)).map_err(|e| e.to_string())?);
        h.update([0]);
    }
    Ok(h.finalize().iter().map(|b| format!("{b:02x}")).collect())
}

/// Huella barata de los archivos (ruta, tamaño, fechas y, en Unix, inodo y ctime). El
/// ctime no se puede fijar a mano: cualquier escritura lo cambia aunque se restaure mtime.
fn fingerprint(root: &Path) -> Result<Vec<u8>, String> {
    let mut h = Sha256::new();
    for (rel, len) in walk(root)? {
        let meta = fs::symlink_metadata(root.join(&rel)).map_err(|e| e.to_string())?;
        h.update(rel.as_bytes());
        h.update(len.to_le_bytes());
        let mtime = meta.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok());
        h.update(mtime.map(|d| d.as_nanos()).unwrap_or(0).to_le_bytes());
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            h.update(meta.ino().to_le_bytes());
            h.update(meta.ctime().to_le_bytes());
            h.update(meta.ctime_nsec().to_le_bytes());
        }
        #[cfg(windows)]
        {
            use std::os::windows::fs::MetadataExt;
            h.update(meta.creation_time().to_le_bytes());
        }
    }
    Ok(h.finalize().to_vec())
}

/// Hash para mostrar el estado en la lista, reutilizado mientras la huella no cambie:
/// listar ya no lee todos los archivos de cada plugin en cada llamada. Ejecutar un
/// plugin (`run`) siempre recalcula el hash completo.
fn hash_cached(root: &Path) -> Result<String, String> {
    /// Ruta del plugin -> (huella, hash).
    type Cache = std::sync::Mutex<std::collections::HashMap<PathBuf, (Vec<u8>, String)>>;
    static CACHE: std::sync::OnceLock<Cache> = std::sync::OnceLock::new();
    let cache = CACHE.get_or_init(Default::default);
    let before = fingerprint(root)?;
    if let Some((fp, h)) = cache.lock().unwrap_or_else(|e| e.into_inner()).get(root) {
        if *fp == before {
            return Ok(h.clone());
        }
    }
    let h = hash(root)?;
    // Solo se guarda si nada cambió mientras se calculaba.
    if fingerprint(root)? == before {
        cache.lock().unwrap_or_else(|e| e.into_inner()).insert(root.to_path_buf(), (before, h.clone()));
    }
    Ok(h)
}

pub fn list(data: &Path) -> Vec<PluginInfo> {
    let st = load_state(data);
    let mut out: Vec<PluginInfo> = fs::read_dir(dir(data))
        .into_iter()
        .flatten()
        .flatten()
        .filter(|e| e.path().is_dir() && !e.file_name().to_string_lossy().starts_with('.'))
        .filter_map(|e| {
            let m = read_manifest(&e.path()).ok()?;
            let approved = st.approved.get(&m.id);
            let tampered = approved.map(|h| hash_cached(&e.path()).ok().as_ref() != Some(h)).unwrap_or(false);
            Some(PluginInfo { enabled: approved.is_some() && !tampered, tampered, manifest: m })
        })
        .collect();
    out.sort_by(|a, b| a.manifest.name.cmp(&b.manifest.name));
    out
}

/// Prepara la instalación desde carpeta o .zip en un área temporal y devuelve la vista
/// previa para que el usuario la revise.
pub fn stage(data: &Path, source: &Path) -> Result<Preview, String> {
    let staging_id = uuid::Uuid::new_v4().to_string();
    let staging = dir(data).join(".staging").join(&staging_id);
    fs::create_dir_all(&staging).map_err(|e| e.to_string())?;
    let result = (|| {
        if source.is_dir() {
            copy_dir(source, &staging)?;
        } else if source.extension().is_some_and(|e| e.eq_ignore_ascii_case("zip")) {
            extract_zip(source, &staging)?;
        } else {
            return Err("Selecciona una carpeta o un archivo .zip".into());
        }
        // Un zip suele traer una carpeta raíz: se usa si plugin.json está dentro.
        let root = plugin_root(&staging)?;
        let manifest = read_manifest(&root)?;
        let files = walk(&root)?;
        check_reviewable(&root, &files)?;
        let code = code_listing(&root, &manifest.entry, &files);
        let replaces = dir(data).join(&manifest.id).is_dir().then(|| manifest.id.clone());
        Ok(Preview { staging: staging_id.clone(), manifest, files, code, replaces })
    })();
    if result.is_err() {
        let _ = fs::remove_dir_all(&staging);
    }
    result
}

fn plugin_root(staging: &Path) -> Result<PathBuf, String> {
    if staging.join("plugin.json").is_file() {
        return Ok(staging.to_path_buf());
    }
    let subdirs: Vec<_> = fs::read_dir(staging).map_err(|e| e.to_string())?.flatten().filter(|e| e.path().is_dir()).collect();
    match subdirs.as_slice() {
        [one] if one.path().join("plugin.json").is_file() => Ok(one.path()),
        _ => Err("No se encontró plugin.json".into()),
    }
}

fn copy_dir(from: &Path, to: &Path) -> Result<(), String> {
    for (rel, _) in walk(from)? {
        let dst = to.join(&rel);
        if let Some(p) = dst.parent() {
            fs::create_dir_all(p).map_err(|e| e.to_string())?;
        }
        fs::copy(from.join(&rel), dst).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn extract_zip(zip_path: &Path, to: &Path) -> Result<(), String> {
    let f = fs::File::open(zip_path).map_err(|e| e.to_string())?;
    let mut z = zip::ZipArchive::new(f).map_err(|e| format!("Zip inválido: {e}"))?;
    if z.len() > MAX_FILES * 2 {
        return Err("Demasiados archivos en el zip".into());
    }
    let mut total = 0u64;
    for i in 0..z.len() {
        let mut entry = z.by_index(i).map_err(|e| e.to_string())?;
        // enclosed_name() descarta rutas absolutas y con ".." (zip slip).
        let Some(rel) = entry.enclosed_name() else {
            return Err(format!("Ruta peligrosa en el zip: {}", entry.name().unwrap_or_default()));
        };
        if entry.is_symlink() {
            return Err("El zip contiene enlaces simbólicos".into());
        }
        let dst = to.join(rel);
        if entry.is_dir() {
            fs::create_dir_all(&dst).map_err(|e| e.to_string())?;
            continue;
        }
        if let Some(p) = dst.parent() {
            fs::create_dir_all(p).map_err(|e| e.to_string())?;
        }
        // Límite real de bytes descomprimidos (protege contra zip bombs).
        let mut buf = Vec::new();
        entry.by_ref().take(MAX_TOTAL - total + 1).read_to_end(&mut buf).map_err(|e| e.to_string())?;
        total += buf.len() as u64;
        if total > MAX_TOTAL {
            return Err("El contenido descomprimido supera 20 MB".into());
        }
        fs::write(&dst, buf).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Confirma la instalación revisada: mueve a plugins/<id> y la aprueba con su hash.
pub fn confirm(data: &Path, staging_id: &str) -> Result<String, String> {
    if !valid_id(&staging_id.replace('-', "")) {
        return Err("Instalación inválida".into());
    }
    let staging = dir(data).join(".staging").join(staging_id);
    let root = plugin_root(&staging)?;
    let m = read_manifest(&root)?;
    let target = dir(data).join(&m.id);
    if target.exists() {
        fs::remove_dir_all(&target).map_err(|e| e.to_string())?;
    }
    fs::rename(&root, &target).or_else(|_| copy_dir(&root, &target)).map_err(|e| e.to_string())?;
    let _ = fs::remove_dir_all(&staging);
    let mut st = load_state(data);
    st.approved.insert(m.id.clone(), hash(&target)?);
    save_state(data, &st)?;
    Ok(m.name)
}

pub fn cancel(data: &Path, staging_id: &str) {
    if valid_id(&staging_id.replace('-', "")) {
        let _ = fs::remove_dir_all(dir(data).join(".staging").join(staging_id));
    }
}

/// Habilitar = aprobar el contenido actual (vuelve a calcular el hash).
pub fn set_enabled(data: &Path, id: &str, enabled: bool) -> Result<(), String> {
    if !valid_id(id) {
        return Err("id inválido".into());
    }
    let mut st = load_state(data);
    if enabled {
        let root = dir(data).join(id);
        read_manifest(&root)?;
        st.approved.insert(id.into(), hash(&root)?);
    } else {
        st.approved.remove(id);
    }
    save_state(data, &st)
}

pub fn uninstall(data: &Path, id: &str) -> Result<(), String> {
    if !valid_id(id) {
        return Err("id inválido".into());
    }
    let mut st = load_state(data);
    st.approved.remove(id);
    save_state(data, &st)?;
    fs::remove_dir_all(dir(data).join(id)).map_err(|e| e.to_string())
}

pub fn read_code(data: &Path, id: &str) -> Result<String, String> {
    if !valid_id(id) {
        return Err("id inválido".into());
    }
    let root = dir(data).join(id);
    let m = read_manifest(&root)?;
    Ok(code_listing(&root, &m.entry, &walk(&root)?))
}

/// Todo el código Python del plugin para revisarlo: primero el punto de entrada y luego el
/// resto de los .py, con un tope de líneas que se avisa explícitamente.
fn code_listing(root: &Path, entry: &str, files: &[(String, u64)]) -> String {
    const MAX_LINES: usize = 4000;
    let mut order: Vec<&str> = vec![entry];
    order.extend(files.iter().map(|f| f.0.as_str()).filter(|f| f.ends_with(".py") && *f != entry));
    let mut out = Vec::new();
    for rel in order {
        let text = fs::read_to_string(root.join(rel)).unwrap_or_else(|e| format!("(no se pudo leer: {e})"));
        if out.len() > MAX_LINES {
            break;
        }
        out.push(format!("# ===== {rel} ====="));
        out.extend(text.lines().map(str::to_string));
    }
    if out.len() > MAX_LINES {
        out.truncate(MAX_LINES);
        out.push(format!("# … código truncado a {MAX_LINES} líneas: revisa la carpeta completa del plugin antes de aprobarlo"));
    }
    out.join("\n")
}

pub fn run(
    runner: &ScriptRunner,
    app: AppHandle,
    data: &Path,
    id: &str,
    action: &str,
    conn: Option<String>,
    vault_type: bool,
) -> Result<String, String> {
    if !valid_id(id) || !valid_id(action) {
        return Err("Plugin o acción inválida".into());
    }
    let root = dir(data).join(id);
    let m = read_manifest(&root)?;
    let st = load_state(data);
    let approved = st.approved.get(id).ok_or("El plugin está deshabilitado")?;
    if &hash(&root)? != approved {
        return Err("El plugin cambió desde que lo aprobaste. Revísalo y vuelve a habilitarlo.".into());
    }
    // Plugins aprobados con versiones anteriores, antes de esta validación.
    check_reviewable(&root, &walk(&root)?)?;
    // Bytecode no verificado por el hash: se borra y Python corre con -B para no regenerarlo.
    remove_pycache(&root);
    if !m.actions.iter().any(|a| a.id == action) {
        return Err("Acción no declarada en plugin.json".into());
    }
    let allow_session = m.permissions.iter().any(|p| p == "session");
    // La casilla de esta ejecución solo vale si el plugin declaró (y el usuario aprobó) el permiso.
    if vault_type && !m.permissions.iter().any(|p| p == "vault-type") {
        return Err("El plugin no declaró el permiso 'vault-type'".into());
    }
    runner.run_spec(
        app,
        RunSpec {
            label: m.name.clone(),
            path: root.join(&m.entry),
            cwd: root.clone(),
            // Un plugin opera sobre la pestaña activa, con el mismo control de riesgo.
            targets: if allow_session {
                conn.map(|c| vec![crate::scripts::TargetReq { conn: c, platform: None }]).unwrap_or_default()
            } else {
                vec![]
            },
            allow_session,
            options: crate::scripts::RunOptions { vault_type, ..Default::default() },
            env: vec![("NT_ACTION".into(), action.into()), ("NT_PLUGIN_DIR".into(), root.to_string_lossy().into())],
        },
        data,
    )
}



fn remove_pycache(root: &Path) {
    let mut stack = vec![root.to_path_buf()];
    while let Some(d) = stack.pop() {
        for e in fs::read_dir(&d).into_iter().flatten().flatten() {
            let Ok(ft) = e.file_type() else { continue };
            if ft.is_dir() && !ft.is_symlink() {
                if e.file_name() == "__pycache__" {
                    let _ = fs::remove_dir_all(e.path());
                } else {
                    stack.push(e.path());
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(dir: &Path) {
        fs::create_dir_all(dir).unwrap();
        fs::write(
            dir.join("plugin.json"),
            r#"{"id":"demo","name":"Demo","version":"1.0","permissions":["session"],
               "actions":[{"id":"run","label":"Ejecutar"}]}"#,
        )
        .unwrap();
        fs::write(dir.join("main.py"), "print('hola')\n").unwrap();
    }

    #[test]
    fn content_hash_is_stable() {
        // SHA-256 de (ruta || 0 || contenido || 0) en orden de ruta; contrastado con hashlib.
        // Es el hash aprobado que se guarda: no puede cambiar entre versiones de la app.
        let dir = std::env::temp_dir().join(format!("nt-plug-hash-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("sub")).unwrap();
        fs::write(dir.join("sub/b.py"), "print(2)\n").unwrap();
        fs::write(dir.join("a.txt"), "uno").unwrap();
        assert_eq!(hash(&dir).unwrap(), "6b26f90a31a4117c4ef27a204cb61c184173cf3ee52235d0b3c99003bb4c668c");
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn install_approve_and_detect_tampering() {
        let base = std::env::temp_dir().join(format!("nt-plug-{}", std::process::id()));
        let data = base.join("data");
        let src = base.join("src");
        sample(&src);
        let preview = stage(&data, &src).unwrap();
        assert_eq!(preview.manifest.id, "demo");
        assert!(preview.code.contains("hola"));
        confirm(&data, &preview.staging).unwrap();
        let l = list(&data);
        assert!(l[0].enabled && !l[0].tampered);
        // Modificación posterior -> bloqueado
        fs::write(data.join("plugins/demo/main.py"), "import os\n").unwrap();
        let l = list(&data);
        assert!(!l[0].enabled && l[0].tampered);
        // Mismo tamaño y misma fecha de modificación: la caché no debe ocultar el cambio.
        set_enabled(&data, "demo", true).unwrap();
        assert!(list(&data)[0].enabled);
        let main = data.join("plugins/demo/main.py");
        let mtime = fs::metadata(&main).unwrap().modified().unwrap();
        fs::write(&main, "import sy\n").unwrap();
        fs::File::options().write(true).open(&main).unwrap().set_modified(mtime).unwrap();
        let l = list(&data);
        assert!(!l[0].enabled && l[0].tampered);
        // Re-aprobar
        set_enabled(&data, "demo", true).unwrap();
        assert!(list(&data)[0].enabled);
        uninstall(&data, "demo").unwrap();
        assert!(list(&data).is_empty());
        let _ = fs::remove_dir_all(base);
    }

    /// cargo test --release -- --ignored --nocapture bench_
    #[test]
    #[ignore]
    fn bench_list_with_large_plugins() {
        let base = std::env::temp_dir().join(format!("nt-plug-bench-{}", std::process::id()));
        let data = base.join("data");
        for i in 0..5 {
            let src = base.join(format!("src{i}"));
            sample(&src);
            let manifest = fs::read_to_string(src.join("plugin.json")).unwrap().replace("\"demo\"", &format!("\"demo{i}\""));
            fs::write(src.join("plugin.json"), manifest).unwrap();
            for f in 0..40 {
                fs::write(src.join(format!("lib{f}.py")), vec![b'#'; 100 * 1024]).unwrap();
            }
            confirm(&data, &stage(&data, &src).unwrap().staging).unwrap();
        }
        let t = std::time::Instant::now();
        assert_eq!(list(&data).len(), 5);
        let first = t.elapsed();
        let t = std::time::Instant::now();
        for _ in 0..20 {
            assert!(list(&data).iter().all(|p| p.enabled));
        }
        println!("plugins_list (5 plugins x 4 MB): primera {first:?}, siguientes {:?} c/u", t.elapsed() / 20);
        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn rejects_code_hidden_from_review() {
        let base = std::env::temp_dir().join(format!("nt-plug3-{}", std::process::id()));
        let data = base.join("data");
        // UTF-7: el "comentario" ejecuta print() en Python.
        let src = base.join("utf7");
        sample(&src);
        fs::write(src.join("main.py"), "# -*- coding: utf-7 -*-\n# nada +AAo-print(1)\n").unwrap();
        assert!(stage(&data, &src).err().unwrap().contains("utf-7"));
        // Bytecode sin fuente: `import helper` cargaría helper.pyc sin mostrarlo.
        let src = base.join("pyc");
        sample(&src);
        fs::write(src.join("helper.pyc"), b"\x00\x00").unwrap();
        assert!(stage(&data, &src).err().unwrap().contains("helper.pyc"));
        // Latin-1 no se puede mostrar íntegro.
        let src = base.join("latin1");
        sample(&src);
        fs::write(src.join("lib.py"), b"x = '\xe1'\n").unwrap();
        assert!(stage(&data, &src).is_err());
        // UTF-8 declarado explícitamente sigue funcionando.
        let src = base.join("ok");
        sample(&src);
        fs::write(src.join("main.py"), "# -*- coding: utf-8 -*-\nprint('ñ')\n").unwrap();
        assert!(stage(&data, &src).is_ok());
        let _ = fs::remove_dir_all(base);
    }

    /// Los plugins de ejemplo del repositorio pasan la misma revisión que una instalación real.
    #[test]
    fn example_plugins_pass_review() {
        let repo = Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap();
        let data = std::env::temp_dir().join(format!("nt-plug-ej-{}", std::process::id()));
        for (rel, id) in [
            ("plugins/ejemplo-inventario", "ejemplo-inventario"),
            ("docs/ejemplos/plugins/diagnostico-basico", "diagnostico-basico"),
            ("docs/ejemplos/plugins/revision-puertos", "revision-puertos"),
        ] {
            let preview = stage(&data, &repo.join(rel)).unwrap_or_else(|e| panic!("{rel}: {e}"));
            assert_eq!(preview.manifest.id, id);
            assert!(preview.code.starts_with("# ===== main.py ====="), "{rel}");
            assert!(preview.replaces.is_none());
            // Todo .py del plugin aparece en la revisión, no solo el archivo de entrada.
            for (file, _) in preview.files.iter().filter(|f| f.0.ends_with(".py")) {
                assert!(preview.code.contains(&format!("# ===== {file} =====")), "{rel}: falta {file} en la revisión");
            }
            cancel(&data, &preview.staging);
        }
        // El de varios archivos: entrada primero, luego el módulo que importa, y los permisos tal cual.
        let preview = stage(&data, &repo.join("docs/ejemplos/plugins/revision-puertos")).unwrap();
        let files: Vec<&str> = preview.files.iter().map(|f| f.0.as_str()).collect();
        assert_eq!(files, ["analisis.py", "main.py", "plugin.json"]);
        assert!(preview.code.find("# ===== main.py").unwrap() < preview.code.find("# ===== analisis.py").unwrap());
        assert_eq!(preview.manifest.permissions, ["session", "files"]);
        assert_eq!(preview.manifest.actions.iter().map(|a| a.id.as_str()).collect::<Vec<_>>(), ["resumen", "errores", "exportar"]);
        cancel(&data, &preview.staging);
        let _ = fs::remove_dir_all(data);
    }

    #[test]
    fn rejects_bad_manifests_and_zip_slip() {
        let base = std::env::temp_dir().join(format!("nt-plug2-{}", std::process::id()));
        let src = base.join("bad");
        sample(&src);
        fs::write(src.join("plugin.json"), r#"{"id":"../x","name":"x","version":"1","actions":[{"id":"a","label":"a"}]}"#).unwrap();
        assert!(stage(&base.join("data"), &src).is_err());
        // "vault-type" es un permiso conocido, pero exige "session"; se muestra en la revisión.
        let manifest = |perms: &str| format!(r#"{{"id":"demo","name":"Demo","version":"1","permissions":[{perms}],"actions":[{{"id":"a","label":"a"}}]}}"#);
        fs::write(src.join("plugin.json"), manifest(r#""vault-type""#)).unwrap();
        assert!(stage(&base.join("data"), &src).err().unwrap().contains("requiere también 'session'"));
        fs::write(src.join("plugin.json"), manifest(r#""session","vault-type""#)).unwrap();
        let preview = stage(&base.join("data"), &src).unwrap();
        assert_eq!(preview.manifest.permissions, ["session", "vault-type"]);
        cancel(&base.join("data"), &preview.staging);

        // zip con ruta "../evil.py"
        let zpath = base.join("evil.zip");
        let f = fs::File::create(&zpath).unwrap();
        let mut w = zip::ZipWriter::new(f);
        w.start_file("../evil.py", zip::write::SimpleFileOptions::default()).unwrap();
        std::io::Write::write_all(&mut w, b"x").unwrap();
        w.finish().unwrap();
        let err = stage(&base.join("data"), &zpath).err().unwrap();
        assert!(err.contains("peligrosa"), "{err}");
        assert!(!base.join("data/plugins/evil.py").exists() && !base.join("data/evil.py").exists());
        let _ = fs::remove_dir_all(base);
    }
}
