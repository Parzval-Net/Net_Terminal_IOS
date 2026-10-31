//! Ubicación de herramientas externas (iperf3) instaladas fuera del PATH con que arrancó la app.
//!
//! La app solo veía `iperf3` en el PATH heredado al abrirse. Eso falla en casos comunes:
//! - Windows: el zip de iperf3 descomprimido en Descargas o en C:\, instalaciones con winget,
//!   Chocolatey o Scoop, y cualquier cambio del PATH hecho después de abrir la app (el proceso
//!   conserva el PATH viejo hasta reiniciarse).
//! - macOS abierto desde el Dock: PATH mínimo de launchd (MacPorts en /opt/local/bin).
//! - Linux desde el menú de escritorio: sin /snap/bin ni Homebrew de Linux.
//!
//! Se prueban, en orden: la ruta elegida por el usuario, el PATH actual, el PATH vigente del
//! registro (Windows) y las carpetas habituales de cada sistema. Cada candidato se confirma
//! ejecutando `--version`.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// Nombre del ejecutable en este sistema.
fn exe(bin: &str) -> String {
    if cfg!(windows) {
        format!("{bin}.exe")
    } else {
        bin.to_string()
    }
}

/// Carpetas que empiezan con `prefix` dentro de `dir` (sin distinguir mayúsculas), hasta
/// `depth` niveles: el zip de iperf3 trae una carpeta con versión (iperf-3.1.3-win64).
fn dirs_like(dir: &Path, prefix: &str, depth: usize, out: &mut Vec<PathBuf>) {
    if depth == 0 {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for e in entries.flatten().take(500) {
        let p = e.path();
        if !p.is_dir() {
            continue;
        }
        let name = e.file_name().to_string_lossy().to_lowercase();
        if name.starts_with(prefix) {
            out.push(p.clone());
            // Subcarpetas de la misma descarga (iperf3.17_64\iperf3.17_64\iperf3.exe).
            dirs_like(&p, "", depth - 1, out);
        } else if prefix.is_empty() {
            out.push(p.clone());
        }
    }
}

/// %VAR% de Windows expandidas con las variables del proceso.
#[cfg_attr(not(windows), allow(dead_code))]
fn expand_vars(s: &str, get: &dyn Fn(&str) -> Option<String>) -> String {
    let mut out = String::new();
    let mut rest = s;
    while let Some(i) = rest.find('%') {
        out.push_str(&rest[..i]);
        let after = &rest[i + 1..];
        match after.find('%') {
            Some(j) => {
                let name = &after[..j];
                match get(name) {
                    Some(v) if !name.is_empty() => out.push_str(&v),
                    _ => {
                        out.push('%');
                        out.push_str(name);
                        out.push('%');
                    }
                }
                rest = &after[j + 1..];
            }
            None => {
                out.push('%');
                rest = after;
            }
        }
    }
    out.push_str(rest);
    out
}

/// Valor "Path" de una salida de `reg query … /v Path` (REG_SZ o REG_EXPAND_SZ).
#[cfg_attr(not(windows), allow(dead_code))]
fn parse_reg_path(text: &str) -> Option<String> {
    text.lines().find_map(|l| {
        let l = l.trim();
        let rest = l.strip_prefix("Path").or_else(|| l.strip_prefix("PATH"))?.trim_start();
        let rest = rest.strip_prefix("REG_EXPAND_SZ").or_else(|| rest.strip_prefix("REG_SZ"))?;
        Some(rest.trim().to_string())
    })
}

/// PATH vigente en el registro (usuario y sistema): incluye lo que agregó un instalador
/// después de abrir la app.
#[cfg(windows)]
fn registry_path() -> Vec<PathBuf> {
    let keys = [r"HKCU\Environment", r"HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment"];
    let get = |n: &str| std::env::var(n).ok();
    keys.iter()
        .filter_map(|k| crate::monitor::command("reg").args(["query", k, "/v", "Path"]).output().ok())
        .filter_map(|o| parse_reg_path(&String::from_utf8_lossy(&o.stdout)))
        .flat_map(|v| v.split(';').map(|d| expand_vars(d.trim(), &get)).collect::<Vec<_>>())
        .filter(|d| !d.is_empty())
        .map(PathBuf::from)
        .collect()
}

#[cfg(not(windows))]
fn registry_path() -> Vec<PathBuf> {
    Vec::new()
}

/// Carpetas de instalación donde buscar `bin` y ejecutarlo para leer su versión, en orden y sin
/// repetir. Las carpetas personales y de usuario (Descargas, `C:\`…) van aparte, en
/// `suggestion_dirs`: allí cualquiera puede dejar un iperf3.exe y no se ejecuta sin confirmación.
fn search_dirs(bin: &str) -> Vec<PathBuf> {
    let env = |n: &str| std::env::var_os(n).map(PathBuf::from);
    let mut dirs: Vec<PathBuf> = std::env::var_os("PATH").map(|p| std::env::split_paths(&p).collect()).unwrap_or_default();
    dirs.extend(registry_path());
    if cfg!(windows) {
        // Junto a NetTerminal.exe (lo que sugería la ayuda).
        if let Some(d) = std::env::current_exe().ok().and_then(|p| p.parent().map(Path::to_path_buf)) {
            dirs.push(d);
        }
        if let Some(local) = env("LOCALAPPDATA") {
            dirs.push(local.join(r"Microsoft\WinGet\Links"));
            // winget sin enlace: Packages\<id del paquete>\<carpeta del zip>\iperf3.exe
            let mut pk = Vec::new();
            if let Ok(entries) = std::fs::read_dir(local.join(r"Microsoft\WinGet\Packages")) {
                for e in entries.flatten() {
                    if e.file_name().to_string_lossy().to_lowercase().contains(bin) {
                        pk.push(e.path());
                        dirs_like(&e.path(), "", 2, &mut pk);
                    }
                }
            }
            dirs.extend(pk);
        }
        dirs.push(PathBuf::from(r"C:\ProgramData\chocolatey\bin"));
        if let Some(home) = env("USERPROFILE") {
            dirs.push(home.join(r"scoop\shims"));
        }
        // Archivos de programa: escribir ahí requiere administrador.
        for root in [env("ProgramFiles"), env("ProgramFiles(x86)")].into_iter().flatten() {
            dirs_like(&root, "iperf", 3, &mut dirs);
        }
    } else {
        let mut extra: Vec<PathBuf> = ["/opt/homebrew/bin", "/usr/local/bin", "/opt/local/bin", "/usr/bin", "/snap/bin", "/home/linuxbrew/.linuxbrew/bin"]
            .map(PathBuf::from)
            .to_vec();
        if cfg!(target_os = "android") {
            extra.extend([
                PathBuf::from("/system/bin"),
                PathBuf::from("/system/xbin"),
                PathBuf::from("/data/data/com.termux/files/usr/bin"),
            ]);
        }
        if let Some(home) = env("HOME") {
            extra.push(home.join(".local/bin"));
            extra.push(home.join(".linuxbrew/bin"));
            extra.push(home.join("bin"));
        }
        dirs.extend(extra);
    }
    let mut seen = std::collections::HashSet::new();
    dirs.retain(|d| seen.insert(d.clone()));
    dirs
}

/// Carpetas donde iperf3 suele quedar descomprimido a mano (Descargas, Escritorio, Documentos, la
/// carpeta personal, `C:\` y `C:\Tools`). Lo que se encuentra aquí solo se sugiere: cualquier
/// usuario del equipo puede crear `C:\iperf\iperf3.exe`, así que no se ejecuta sin confirmación.
fn suggestion_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if cfg!(windows) {
        let env = |n: &str| std::env::var_os(n).map(PathBuf::from);
        if let Some(home) = env("USERPROFILE") {
            for sub in ["Downloads", "Desktop", "Documents"] {
                dirs_like(&home.join(sub), "iperf", 3, &mut dirs);
            }
            dirs_like(&home, "iperf", 3, &mut dirs);
        }
        for root in [PathBuf::from(r"C:\"), PathBuf::from(r"C:\Tools")] {
            dirs_like(&root, "iperf", 3, &mut dirs);
        }
    }
    dirs
}

/// Ejecuta `bin --version` con plazo y devuelve la salida (stdout y stderr).
fn version_output(bin: &Path) -> Option<String> {
    let mut c = crate::monitor::command(&bin.to_string_lossy());
    c.arg("--version").stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = c.spawn().ok()?;
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        match child.try_wait() {
            Ok(Some(_)) => {
                let mut text = String::new();
                if let Some(mut o) = child.stdout.take() {
                    let _ = std::io::Read::read_to_string(&mut o, &mut text);
                }
                if let Some(mut e) = child.stderr.take() {
                    let _ = std::io::Read::read_to_string(&mut e, &mut text);
                }
                return Some(text);
            }
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(20)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    }
}

/// Primera línea "iperf 3.x" de la salida de `--version` (algunas compilaciones de Windows
/// la escriben en stderr o después de una línea en blanco).
pub fn iperf_line(text: &str) -> Option<String> {
    text.lines().map(str::trim).find(|l| l.starts_with("iperf 3") || l.starts_with("iperf3")).map(|l| l.chars().take(80).collect())
}

#[derive(serde::Serialize, Clone)]
pub struct Found {
    pub path: String,
    pub version: String,
    /// Encontrado en una carpeta de usuario y no ejecutado: la app pide confirmarlo.
    pub suggested: bool,
}

static IPERF: Mutex<Option<Found>> = Mutex::new(None);

/// Busca iperf3: primero `custom` (ruta elegida por el usuario: el ejecutable o su carpeta),
/// luego el PATH y las carpetas habituales. Solo se recuerda un resultado positivo.
pub fn find_iperf(custom: Option<&str>) -> Option<Found> {
    let name = exe("iperf3");
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Some(c) = custom.map(str::trim).filter(|c| !c.is_empty()) {
        let p = PathBuf::from(c);
        // Solo un ejecutable que se llame iperf3: la ruta viene de un ajuste editable.
        let file = if p.is_dir() { p.join(&name) } else { p };
        if file.file_stem().map(|s| s.to_string_lossy().to_lowercase()).as_deref() == Some("iperf3") {
            candidates.push(file);
        }
    }
    candidates.extend(search_dirs("iperf3").into_iter().map(|d| d.join(&name)));
    let found = candidates.into_iter().filter(|p| p.is_file()).find_map(|p| {
        let version = iperf_line(&version_output(&p)?)?;
        Some(Found { path: p.to_string_lossy().into_owned(), version, suggested: false })
    });
    let mut cached = IPERF.lock().unwrap_or_else(|e| e.into_inner());
    if found.is_some() {
        cached.clone_from(&found);
    }
    found.or_else(|| cached.clone()).or_else(|| {
        // Solo se comprueba que el archivo exista: no se ejecuta ni se recuerda.
        suggestion_dirs().into_iter().map(|d| d.join(&name)).find(|p| p.is_file()).map(|p| Found {
            path: p.to_string_lossy().into_owned(),
            version: String::new(),
            suggested: true,
        })
    })
}

/// Ruta de iperf3 para ejecutarlo: la detectada o, si aún no se buscó, se busca ahora.
pub fn iperf_path() -> Option<String> {
    let cached = IPERF.lock().unwrap_or_else(|e| e.into_inner()).clone();
    cached.or_else(|| find_iperf(None)).filter(|f| !f.suggested).map(|f| f.path)
}

/// Comando para iperf3 con su ruta completa.
pub fn iperf_command() -> Option<Command> {
    iperf_path().map(|p| crate::monitor::command(&p))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_iperf_version_from_any_line() {
        assert_eq!(iperf_line("iperf 3.17.1 (cJSON 1.7.15)\nLinux x 6.1\n").as_deref(), Some("iperf 3.17.1 (cJSON 1.7.15)"));
        assert_eq!(iperf_line("\n  iperf 3.1.3\n").as_deref(), Some("iperf 3.1.3"));
        assert_eq!(iperf_line("iperf3: error - unknown option").as_deref(), Some("iperf3: error - unknown option"));
        assert_eq!(iperf_line("iperf version 2.1.9"), None);
        assert_eq!(iperf_line("comando no encontrado"), None);
    }

    #[test]
    fn parses_registry_path_and_expands_vars() {
        let out = "\r\nHKEY_CURRENT_USER\\Environment\r\n    Path    REG_EXPAND_SZ    %USERPROFILE%\\bin;C:\\Tools\\iperf3;%NOEXISTE%\\x\r\n\r\n";
        let v = parse_reg_path(out).unwrap();
        let get = |n: &str| (n == "USERPROFILE").then(|| r"C:\Users\ana".to_string());
        let dirs: Vec<String> = v.split(';').map(|d| expand_vars(d, &get)).collect();
        assert_eq!(dirs, [r"C:\Users\ana\bin", r"C:\Tools\iperf3", r"%NOEXISTE%\x"]);
        assert_eq!(parse_reg_path("    Path    REG_SZ    C:\\a;C:\\b").as_deref(), Some("C:\\a;C:\\b"));
        assert_eq!(parse_reg_path("ERROR: no se encontró"), None);
        assert_eq!(expand_vars("sin%cierre", &|_| None), "sin%cierre");
    }

    #[test]
    fn finds_iperf_inside_versioned_download_folders() {
        let base = std::env::temp_dir().join(format!("nt-iperf-{}", std::process::id()));
        let deep = base.join("Downloads").join("iperf-3.1.3-win64").join("iperf-3.1.3-win64");
        std::fs::create_dir_all(&deep).unwrap();
        std::fs::create_dir_all(base.join("Downloads").join("otra")).unwrap();
        let mut out = Vec::new();
        dirs_like(&base.join("Downloads"), "iperf", 3, &mut out);
        assert!(out.contains(&base.join("Downloads").join("iperf-3.1.3-win64")));
        assert!(out.contains(&deep));
        assert!(!out.iter().any(|d| d.ends_with("otra")));
        std::fs::remove_dir_all(&base).unwrap();
    }

    /// Un iperf3 fuera del PATH (carpeta elegida por el usuario) se encuentra y se recuerda.
    #[cfg(unix)]
    #[test]
    fn finds_iperf_in_custom_folder() {
        use std::os::unix::fs::PermissionsExt;
        let dir = std::env::temp_dir().join(format!("nt-iperf-dir-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let bin = dir.join("iperf3");
        std::fs::write(&bin, "#!/bin/sh\necho\necho 'iperf 3.99.0 (cJSON 1.7.15)'\n").unwrap();
        std::fs::set_permissions(&bin, std::fs::Permissions::from_mode(0o755)).unwrap();
        let f = find_iperf(Some(&dir.to_string_lossy())).expect("iperf3 en la carpeta elegida");
        assert_eq!(f.version, "iperf 3.99.0 (cJSON 1.7.15)");
        assert_eq!(f.path, bin.to_string_lossy());
        assert_eq!(iperf_path().as_deref(), Some(&*bin.to_string_lossy()));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    /// Con un PATH mínimo (app abierta desde el Dock o un lanzador): se ejecuta aparte con
    /// `env -i` sobre el binario de pruebas, ver la validación del PR.
    #[test]
    #[ignore]
    fn real_iperf_without_path() {
        let f = find_iperf(None).expect("iperf3 instalado en una carpeta habitual");
        println!("encontrado: {} · {}", f.path, f.version);
    }

    #[test]
    fn custom_path_must_be_named_iperf3() {
        // Un ajuste editado a mano no puede hacer que la app ejecute otro programa.
        let base = std::env::temp_dir().join(format!("nt-iperf-custom-{}", std::process::id()));
        std::fs::create_dir_all(&base).unwrap();
        let other = base.join("calc");
        std::fs::write(&other, "").unwrap();
        // Sin iperf3 real en la carpeta: no se encuentra con esa ruta (y no se ejecuta "calc").
        let found = find_iperf(Some(&other.to_string_lossy()));
        assert!(found.is_none_or(|f| !f.path.ends_with("calc")));
        std::fs::remove_dir_all(&base).unwrap();
    }
}
