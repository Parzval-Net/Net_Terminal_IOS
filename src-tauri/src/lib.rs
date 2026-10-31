mod autofill;
mod backups;
mod cmdpacks;
mod connection;
mod credentials;
mod expect;
mod filexfer;
mod ftpclient;
mod ftpserver;
mod history;
mod importers;
mod logfile;
mod updates;
mod mcp;
mod monitor;
mod nettools;
mod plugins;
mod servers;
mod snmp;
mod scripts;
mod seal;
mod models;
mod notes;
mod session_store;
mod telnet;
mod toolpath;
mod triggers;

use connection::ConnectionManager;
use models::{SerialPortInfo, Session};
use session_store::SessionStore;
use std::path::PathBuf;
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{Emitter, Manager, State};
use tauri_plugin_opener::OpenerExt;

struct AppState {
    store: SessionStore,
    conns: ConnectionManager,
    scripts: scripts::ScriptRunner,
    mcp: mcp::McpServer,
    monitor: monitor::Monitor,
    jobs: nettools::Jobs,
    servers: servers::Servers,
    creds: credentials::Credentials,
    secure_notes: notes::SecureNotes,
    data_dir: PathBuf,
    /// Carpeta de logs elegida por el usuario (validada); None: `data/logs`.
    logs_root: std::sync::Mutex<Option<PathBuf>>,
}

impl AppState {
    fn logs_dir(&self) -> PathBuf {
        let custom = self.logs_root.lock().unwrap_or_else(|e| e.into_inner()).clone();
        custom.unwrap_or_else(|| self.data_dir.join("logs"))
    }

    fn notes_dir(&self) -> PathBuf {
        self.data_dir.join("notes")
    }
}

#[tauri::command]
fn list_sessions(state: State<'_, AppState>) -> Vec<Session> {
    state.store.list()
}

#[tauri::command]
fn save_session(session: Session, state: State<'_, AppState>) -> Result<Session, String> {
    state.store.save(session)
}

#[tauri::command]
fn update_sessions(sessions: Vec<Session>, state: State<'_, AppState>) -> Result<Vec<Session>, String> {
    state.store.update_many(sessions)
}

/// Agrega sesiones importadas en una sola escritura.
#[tauri::command]
fn add_sessions(sessions: Vec<Session>, state: State<'_, AppState>) -> Result<Vec<Session>, String> {
    state.store.add_many(sessions)
}

#[tauri::command(async)]
fn delete_session(id: String, state: State<'_, AppState>) -> Result<(), String> {
    state.store.delete(&id)?;
    // Con la bóveda bloqueada la entrada queda huérfana y se limpia al guardar otra.
    let _ = state.creds.delete(&id);
    Ok(())
}

// ---------- Contraseñas guardadas ----------
// Ningún comando devuelve una contraseña: solo se guardan, se consultan (sí/no) o se borran.

#[tauri::command(async)]
fn cred_status(state: State<'_, AppState>) -> credentials::Status {
    state.creds.status()
}

#[tauri::command(async)]
fn cred_set(session_id: String, password: String, state: State<'_, AppState>) -> Result<(), String> {
    let password = zeroize::Zeroizing::new(password);
    if state.store.get(&session_id).is_none() {
        return Err("Guarda la sesión antes de su contraseña".into());
    }
    state.creds.set(&session_id, &password, &state.store.ids())
}

#[tauri::command(async)]
fn cred_has(session_id: String, state: State<'_, AppState>) -> Result<bool, String> {
    state.creds.has(&session_id)
}

#[tauri::command(async)]
fn cred_delete(session_id: String, state: State<'_, AppState>) -> Result<(), String> {
    state.creds.delete(&session_id)
}

// ---------- Contraseñas de vecinos (saltos de Topología) ----------
// Igual que las de sesión: ninguna se devuelve. Se guardan desde un campo oculto, se listan sin
// valor y solo se escriben en una conexión con `hop_type_password`.

#[tauri::command(async)]
fn hop_cred_set(ip: String, user: String, password: String, state: State<'_, AppState>) -> Result<(), String> {
    let password = zeroize::Zeroizing::new(password);
    state.creds.hop_set(&ip, &user, &password)
}

#[tauri::command(async)]
fn hop_cred_has(ip: String, user: String, state: State<'_, AppState>) -> Result<bool, String> {
    state.creds.hop_has(&ip, &user)
}

#[tauri::command(async)]
fn hop_cred_delete(ip: String, user: String, state: State<'_, AppState>) -> Result<(), String> {
    state.creds.hop_delete(&ip, &user)
}

#[tauri::command(async)]
fn hop_cred_list(state: State<'_, AppState>) -> Result<Vec<credentials::HopInfo>, String> {
    state.creds.hop_list()
}

/// Escribe una contraseña en el pedido de login de un salto, una sola vez por paso (`token`).
/// `source`: "saved" (la guardada del vecino, por IP y usuario) o "pivot" (la de la sesión guardada
/// del pivote, solo si la conexión es una copia de esa sesión). El pedido tiene que aparecer en la
/// pantalla después del comando de salto (`cmd`) y, si nombra un host, ser el del vecino. Nada vuelve
/// al frontend ni pasa por el log o el historial.
#[tauri::command(async)]
#[allow(clippy::too_many_arguments)]
fn hop_type_password(
    conn: String,
    source: String,
    pivot_id: Option<String>,
    ip: String,
    user: String,
    cmd: String,
    token: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let addr: std::net::IpAddr = ip.trim().parse().map_err(|_| "IP del vecino no válida")?;
    let host = addr.to_string();
    if cmd.is_empty() || cmd.len() > 200 || cmd.chars().any(|c| c.is_control()) || !hop_cmd_targets(&cmd, &host, user.trim()) {
        return Err("Comando de salto no válido".into());
    }
    if token.is_empty() || token.len() > 160 {
        return Err("Salto no válido".into());
    }
    let (_, session) = state.conns.info(&conn).ok_or("Sesión no conectada")?;
    let secret = match source.as_str() {
        "saved" => {
            // Las pestañas de salto son copias de una sesión guardada (la del pivote): la clave del
            // vecino no se escribe en una conexión cualquiera.
            let base = state.store.get(&session.id).ok_or("La pestaña de salto no es una copia de una sesión guardada")?;
            if !same_destination(&base, &session) {
                return Err("La pestaña de salto no coincide con su sesión guardada".into());
            }
            state
                .creds
                .hop_get(&host, &user)
            .ok_or("No hay contraseña guardada para este vecino, o la bóveda está bloqueada")?
        }
        "pivot" => {
            let id = pivot_id.filter(|i| !i.is_empty()).ok_or("El pivote no es una sesión guardada")?;
            let saved = state.store.get(&id).ok_or("El pivote no es una sesión guardada")?;
            // La pestaña de salto tiene que ser una copia de la sesión del pivote: la contraseña solo
            // se escribe en un equipo al que se llegó desde ese pivote.
            let same = saved.save_password == Some(true) && session.id == saved.id && same_destination(&saved, &session);
            if !same {
                return Err("La pestaña no es una copia de la sesión del pivote con contraseña guardada".into());
            }
            state.creds.get(&saved.id).ok_or("El pivote no tiene contraseña guardada, o la bóveda está bloqueada")?
        }
        _ => return Err("Origen de contraseña no válido".into()),
    };
    state.conns.type_hop(&conn, &secret, &host, cmd.trim(), &token)?;
    if source == "saved" {
        let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs());
        state.creds.hop_touch(&host, &user, now);
    }
    Ok(())
}

#[tauri::command(async)]
fn vault_create(master: String, state: State<'_, AppState>) -> Result<(), String> {
    let master = zeroize::Zeroizing::new(master);
    state.creds.create(&master)
}

#[tauri::command(async)]
fn vault_unlock(master: String, state: State<'_, AppState>) -> Result<(), String> {
    let master = zeroize::Zeroizing::new(master);
    state.creds.unlock(&master)
}

#[tauri::command]
fn vault_lock(state: State<'_, AppState>) {
    state.creds.lock()
}

#[tauri::command(async)]
fn vault_change(old: String, new: String, state: State<'_, AppState>) -> Result<(), String> {
    let (old, new) = (zeroize::Zeroizing::new(old), zeroize::Zeroizing::new(new));
    state.creds.change(&old, &new)
}

#[tauri::command(async)]
fn vault_reset(state: State<'_, AppState>) -> Result<(), String> {
    state.creds.reset()
}

/// La conexión va al mismo destino que la sesión guardada: un frontend comprometido no puede
/// redirigir una contraseña cambiando host, puerto, usuario, jump host o argumentos de ssh.
fn same_destination(saved: &Session, session: &Session) -> bool {
    saved.session_type == session.session_type
        && session.session_type != models::SessionType::Local
        && saved.host == session.host
        && saved.port == session.port
        && saved.serial_port == session.serial_port
        && saved.username == session.username
        && saved.jump_host == session.jump_host
        // Los argumentos extra también fijan el destino (-o HostName=, -o ProxyJump=, -J, -p, -l).
        && saved.ssh_args == session.ssh_args
}

/// El comando de salto apunta a `ip` como argumento propio (no como parte de otra IP) y, si
/// nombra un usuario ("-l usuario" o "usuario@ip"), es `user`.
fn hop_cmd_targets(cmd: &str, ip: &str, user: &str) -> bool {
    let toks: Vec<&str> = cmd.split_whitespace().collect();
    let mut hit = false;
    for (i, t) in toks.iter().enumerate() {
        let (u, h) = t.rsplit_once('@').map_or((None, *t), |(u, h)| (Some(u), h));
        if h.parse::<std::net::IpAddr>().is_ok_and(|a| a.to_string() == ip) {
            hit = true;
            if u.is_some_and(|u| u != user) {
                return false;
            }
        }
        if *t == "-l" && toks.get(i + 1).is_some_and(|u| *u != user) {
            return false;
        }
    }
    hit
}

/// Contraseña a autocompletar: solo si la sesión guardada lo tiene activo y el destino
/// pedido es el mismo que el guardado (un frontend comprometido no puede redirigirla a
/// otro host cambiando el objeto de sesión).
fn fill_for(session: &Session, state: &AppState) -> Option<connection::FillSpec> {
    use models::SessionType::*;
    if session.save_password != Some(true) || session.scp.is_some() || session.session_type == Local {
        return None;
    }
    let saved = state.store.get(&session.id)?;
    if saved.save_password != Some(true) || !same_destination(&saved, session) {
        return None;
    }
    let secret = state.creds.get(&saved.id)?;
    let only_host = (saved.session_type == Ssh && uses_jump(&saved)).then(|| prompt_host(saved.host.as_deref().unwrap_or("")));
    let user = match saved.session_type {
        Telnet | Raw | Serial => saved.username.filter(|u| !u.trim().is_empty()),
        _ => None,
    };
    Some(connection::FillSpec { secret, user, only_host })
}

/// Contraseña guardada que un script escribe sin verla (`nt.type_saved_password()`, con la
/// aprobación del usuario al lanzarlo). Mismas condiciones que el autocompletado: la sesión
/// guardada tiene la contraseña activa y su destino coincide con el de la conexión, y la
/// pantalla muestra ahora un pedido de login del equipo de destino (en SSH, si el pedido nombra
/// un host debe ser el de la sesión; con bastión, tiene que nombrarlo). Nada vuelve al script.
pub(crate) fn type_saved_password(state: &AppState, conn: &str) -> Result<(), String> {
    let (_, session) = state.conns.info(conn).ok_or("Sesión no conectada")?;
    let fill = fill_for(&session, state)
        .ok_or("La sesión no tiene una contraseña guardada para este destino, o la bóveda está bloqueada")?;
    let ssh = session.session_type == models::SessionType::Ssh;
    let host = ssh.then(|| prompt_host(session.host.as_deref().unwrap_or("")));
    state.conns.type_saved(conn, fill, host.as_deref(), ssh && uses_jump(&session))
}

/// La sesión SSH pasa por un bastión (campo jump host, -J o -o ProxyJump/ProxyCommand en
/// los argumentos extra). Conservador: ante la duda se exige que el prompt nombre al host.
fn uses_jump(s: &Session) -> bool {
    let jump = s.jump_host.as_deref().is_some_and(|j| !j.trim().is_empty());
    let args = s.ssh_args.as_deref().unwrap_or("");
    let lower = args.to_ascii_lowercase();
    jump || lower.contains("proxyjump")
        || lower.contains("proxycommand")
        || args.split_whitespace().any(|a| a.starts_with('-') && !a.starts_with("--") && a.contains('J'))
}

/// Host tal como lo muestra el prompt de OpenSSH: sin usuario ni corchetes de IPv6.
fn prompt_host(host: &str) -> String {
    let h = host.trim();
    let h = h.rsplit_once('@').map_or(h, |(_, x)| x);
    h.trim_start_matches('[').trim_end_matches(']').to_lowercase()
}

#[tauri::command(async)]
fn list_serial_ports() -> Vec<SerialPortInfo> {
    connection::list_serial_ports()
}

/// Asíncrono para no bloquear la UI mientras Telnet resuelve/conecta.
#[tauri::command]
async fn connect(
    id: String,
    mut session: Session,
    cols: u16,
    rows: u16,
    on_data: Channel<InvokeResponseBody>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    // SCP: las rutas locales se resuelven aquí, solo dentro de la carpeta compartida.
    if let Some(spec) = session.scp.as_mut() {
        let root = app.state::<AppState>().data_dir.join("tftp");
        std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
        if spec.upload {
            spec.local_paths = spec
                .files
                .iter()
                .map(|f| {
                    servers::safe_path(&root, f)
                        .filter(|p| p.is_file())
                        .map(|p| p.to_string_lossy().into_owned())
                        .ok_or_else(|| format!("No existe {f} en la carpeta compartida"))
                })
                .collect::<Result<_, _>>()?;
        } else {
            spec.local_dir = root.to_string_lossy().into_owned();
        }
    }
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let fill = fill_for(&session, &state);
        state.conns.connect(id, &session, cols, rows, on_data, fill)
    })
    .await
    .map_err(|e| e.to_string())?
}

// async: corre fuera del hilo principal, que entrega la salida al webview; así una
// ráfaga de salida no deja las teclas en cola.
#[tauri::command(async)]
fn write(id: String, data: String, app: tauri::AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    // Una sesión tomada por un script no recibe lo tecleado: se mezclaría con el script.
    if state.scripts.owner(&id).is_some() {
        let _ = app.emit("script-input-blocked", &id);
        return Err(scripts::BUSY.into());
    }
    state.conns.write(&id, data.as_bytes())
}

#[tauri::command(async)]
fn resize(id: String, cols: u16, rows: u16, state: State<'_, AppState>) -> Result<(), String> {
    state.conns.resize(&id, cols, rows)
}

#[tauri::command]
fn disconnect(id: String, state: State<'_, AppState>) {
    state.conns.disconnect(&id)
}

#[tauri::command]
fn send_break(id: String, state: State<'_, AppState>) -> Result<(), String> {
    state.conns.send_break(&id)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
fn set_logging(
    id: String,
    enabled: bool,
    timestamps: Option<bool>,
    resume: Option<String>,
    pattern: Option<String>,
    append: Option<bool>,
    rotate: Option<bool>,
    mask: Option<bool>,
    state: State<'_, AppState>,
) -> Result<Option<String>, String> {
    let opts = logfile::LogOptions {
        timestamps: timestamps.unwrap_or(false),
        pattern: pattern.unwrap_or_else(|| logfile::DEFAULT_PATTERN.into()),
        append: append.unwrap_or(false),
        rotate_daily: rotate.unwrap_or(false),
        // Sin indicación se enmascara: es lo seguro.
        mask: mask.unwrap_or(true),
    };
    state.conns.set_logging(&id, enabled, opts, &state.logs_dir(), resume.as_deref())
}

/// Reglas de alerta por palabra clave (solo las activas). Lista vacía: apagadas.
#[tauri::command]
fn alerts_configure(rules: Vec<triggers::Rule>, app: tauri::AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    state.conns.triggers().configure(
        rules,
        std::sync::Arc::new(move |hit| {
            let _ = app.emit("alert-hit", hit);
        }),
    )
}

/// Carpeta de logs en uso. `custom`: la eligió el usuario; `portable`: los logs fuera de
/// `data/` no viajan con la carpeta portable.
#[derive(serde::Serialize)]
struct LogsDirInfo {
    path: String,
    default: String,
    custom: bool,
    portable: bool,
}

fn logs_dir_info(state: &AppState) -> LogsDirInfo {
    LogsDirInfo {
        path: state.logs_dir().to_string_lossy().into_owned(),
        default: state.data_dir.join("logs").to_string_lossy().into_owned(),
        custom: state.logs_root.lock().unwrap_or_else(|e| e.into_inner()).is_some(),
        portable: session_store::is_portable(),
    }
}

#[tauri::command]
fn logs_dir_get(state: State<'_, AppState>) -> LogsDirInfo {
    logs_dir_info(&state)
}

/// Fija la carpeta de logs (None o vacío: la predeterminada). Solo acepta una carpeta
/// absoluta, existente y con permiso de escritura; nunca la raíz del disco.
#[tauri::command(async)]
fn logs_dir_set(path: Option<String>, state: State<'_, AppState>) -> Result<LogsDirInfo, String> {
    let dir = match path.as_deref().map(str::trim).filter(|p| !p.is_empty()) {
        Some(p) => Some(logfile::validate_dir(p)?),
        None => None,
    };
    *state.logs_root.lock().unwrap_or_else(|e| e.into_inner()) = dir;
    Ok(logs_dir_info(&state))
}

/// Abre la carpeta de logs ("logs") o la de datos ("data") en el explorador del sistema.
#[tauri::command]
fn open_dir(which: String, app: tauri::AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    let dir = match which.as_str() {
        "logs" => state.logs_dir(),
        "notes" => state.notes_dir(),
        "scripts" => scripts::scripts_dir(&state.data_dir),
        "tftp" => state.data_dir.join("tftp"),
        "plugins" => state.data_dir.join("plugins"),
        "syslog" => state.data_dir.join("syslog"),
        "backups" => backups::root(&state.data_dir),
        _ => state.data_dir.clone(),
    };
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    app.opener()
        .open_path(dir.to_string_lossy(), None::<&str>)
        .map_err(|e| {
            if cfg!(target_os = "android") {
                format!(
                    "No se pudo abrir la carpeta en Android: no hay un explorador de archivos disponible o faltan permisos ({e}). Ruta: {}",
                    dir.display()
                )
            } else {
                e.to_string()
            }
        })
}

#[tauri::command(async)]
fn list_notes(state: State<'_, AppState>) -> Vec<notes::NoteInfo> {
    notes::list(&state.notes_dir())
}

#[tauri::command(async)]
fn read_note(name: String, state: State<'_, AppState>) -> Result<String, String> {
    notes::read(&state.notes_dir(), &name)
}

#[tauri::command]
fn save_note(name: String, content: String, state: State<'_, AppState>) -> Result<(), String> {
    notes::save(&state.notes_dir(), &name, &content)
}

#[tauri::command]
fn rename_note(from: String, to: String, state: State<'_, AppState>) -> Result<String, String> {
    let name = notes::rename(&state.notes_dir(), &from, &to)?;
    state.secure_notes.renamed(&from, &name);
    Ok(name)
}

#[tauri::command]
fn delete_note(name: String, state: State<'_, AppState>) -> Result<(), String> {
    state.secure_notes.forget(&name);
    notes::delete(&state.notes_dir(), &name)
}

// Notas protegidas: la contraseña solo entra (nunca vuelve al frontend) y la llave queda en
// memoria del backend mientras la nota está abierta.

#[tauri::command(async)]
fn note_protect(name: String, password: String, idle_secs: u64, state: State<'_, AppState>) -> Result<(), String> {
    let password = zeroize::Zeroizing::new(password);
    state.secure_notes.protect(&state.notes_dir(), &name, &password, idle_secs)
}

#[tauri::command(async)]
fn note_unlock(name: String, password: String, idle_secs: u64, state: State<'_, AppState>) -> Result<String, String> {
    let password = zeroize::Zeroizing::new(password);
    let text = state.secure_notes.unlock(&state.notes_dir(), &name, &password, idle_secs)?;
    Ok(String::clone(&text))
}

#[tauri::command(async)]
fn note_save_secure(name: String, content: String, state: State<'_, AppState>) -> Result<(), String> {
    let content = zeroize::Zeroizing::new(content);
    state.secure_notes.save(&state.notes_dir(), &name, &content)
}

#[tauri::command]
fn note_touch(name: String, state: State<'_, AppState>) -> bool {
    state.secure_notes.touch(&name)
}

#[tauri::command]
fn note_lock(state: State<'_, AppState>) {
    state.secure_notes.lock()
}

#[tauri::command(async)]
fn note_unprotect(name: String, state: State<'_, AppState>) -> Result<(), String> {
    state.secure_notes.unprotect(&state.notes_dir(), &name)
}

#[tauri::command(async)]
fn note_change_password(name: String, old: String, new: String, state: State<'_, AppState>) -> Result<(), String> {
    let (old, new) = (zeroize::Zeroizing::new(old), zeroize::Zeroizing::new(new));
    state.secure_notes.change(&state.notes_dir(), &name, &old, &new)
}

#[tauri::command(async)]
fn search_notes(query: String, state: State<'_, AppState>) -> Vec<notes::NoteMatch> {
    notes::search(&state.notes_dir(), &query)
}

// ---------- Importación de sesiones e historial ----------

/// Analiza un archivo de otro cliente (elegido por el usuario) y devuelve la vista previa.
#[tauri::command(async)]
fn import_sessions_file(path: String, format: Option<String>) -> Result<importers::ImportPreview, String> {
    importers::parse_file(std::path::Path::new(&path), format.as_deref())
}

#[tauri::command(async)]
fn recent_targets(state: State<'_, AppState>) -> Vec<String> {
    history::recent_list(&state.data_dir)
}

#[tauri::command(async)]
fn recent_target_add(target: String, state: State<'_, AppState>) -> Result<Vec<String>, String> {
    history::recent_add(&state.data_dir, &target)
}

#[tauri::command(async)]
fn recent_targets_clear(state: State<'_, AppState>) -> Result<(), String> {
    history::recent_clear(&state.data_dir)
}

#[tauri::command(async)]
fn cmd_history(key: String, state: State<'_, AppState>) -> Vec<history::CmdEntry> {
    history::cmd_list(&state.data_dir, &key)
}

#[tauri::command(async)]
fn cmd_history_add(key: String, command: String, state: State<'_, AppState>) -> Result<bool, String> {
    history::cmd_add(&state.data_dir, &key, &command)
}

#[tauri::command(async)]
fn cmd_history_clear(key: Option<String>, state: State<'_, AppState>) -> Result<(), String> {
    history::cmd_clear(&state.data_dir, key.as_deref())
}

#[tauri::command(async)]
fn list_scripts(state: State<'_, AppState>) -> Vec<String> {
    scripts::list(&state.data_dir)
}

/// Trae a la carpeta de scripts un .py que el usuario elige en el diálogo del sistema. El diálogo
/// se abre aquí: la ruta nunca viene del frontend. `None` si se canceló.
#[tauri::command(async)]
fn import_script(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let Some(file) = app.dialog().file().set_title("Script de Python").add_filter("Python", &["py"]).blocking_pick_file() else {
        return Ok(None);
    };
    let path = file.into_path().map_err(|e| e.to_string())?;
    scripts::import(&state.data_dir, &path).map(Some)
}

/// Scripts eliminados (recuperables).
#[tauri::command(async)]
fn list_deleted_scripts(state: State<'_, AppState>) -> Vec<String> {
    scripts::list_deleted(&state.data_dir)
}

/// Devuelve un script eliminado a la lista.
#[tauri::command(async)]
fn restore_script(name: String, state: State<'_, AppState>) -> Result<String, String> {
    scripts::restore(&state.data_dir, &name)
}

/// Quita un script de la lista (lo mueve a scripts/eliminados).
#[tauri::command(async)]
fn delete_script(name: String, state: State<'_, AppState>) -> Result<(), String> {
    scripts::remove(&state.data_dir, &name)
}

#[tauri::command(async)]
fn run_script(
    script: String,
    targets: Vec<scripts::TargetReq>,
    options: Option<scripts::RunOptions>,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<String, String> {
    state.scripts.run(app.clone(), script, targets, options.unwrap_or_default(), &state.data_dir)
}

/// Intérprete de Python que usan scripts y plugins (versión y ruta).
#[tauri::command(async)]
fn python_status() -> Result<String, String> {
    scripts::python_status()
}

/// Vuelve a buscar Python sin reiniciar la app (por ejemplo, tras instalarlo).
#[tauri::command(async)]
fn python_redetect() -> Result<String, String> {
    scripts::redetect_python()
}

/// Respuesta del usuario a un diálogo de un script: confirmación de un comando o secreto.
/// El secreto no se registra en ningún lado: viaja solo al stdin del script.
#[tauri::command]
fn script_prompt_reply(run: String, id: String, approve: bool, value: Option<String>, state: State<'_, AppState>) {
    state.scripts.answer(&run, &id, approve, value)
}

#[tauri::command]
fn stop_script(run: String, state: State<'_, AppState>) {
    state.scripts.stop(&run)
}

#[tauri::command]
fn mcp_configure(
    enabled: bool,
    port: u16,
    token: String,
    require_approval: bool,
    read_only: bool,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<String, String> {
    state.mcp.configure(
        app.clone(),
        mcp::McpConfig { enabled, port, token, require_approval, read_only },
    )
}

#[tauri::command]
fn mcp_decide(id: String, approved: bool, state: State<'_, AppState>) {
    state.mcp.decide(&id, approved)
}

// ---------- Herramientas de red ----------

#[tauri::command]
fn monitor_start(cfg: monitor::ProbeConfig, app: tauri::AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    state.monitor.start(app.clone(), cfg)
}

#[tauri::command]
fn monitor_stop(id: String, state: State<'_, AppState>) {
    state.monitor.stop(&id)
}

#[tauri::command]
fn monitor_running(state: State<'_, AppState>) -> Vec<String> {
    state.monitor.running()
}

#[tauri::command(async)]
fn tool_traceroute(host: String, app: tauri::AppHandle, state: State<'_, AppState>) -> Result<String, String> {
    state.jobs.traceroute(app.clone(), &host)
}

#[tauri::command(async)]
fn tool_iperf(params: nettools::IperfParams, app: tauri::AppHandle, state: State<'_, AppState>) -> Result<String, String> {
    state.jobs.iperf(app.clone(), params)
}

#[tauri::command(async)]
fn tool_iperf_version(custom: Option<String>) -> Option<toolpath::Found> {
    nettools::iperf_version(custom.as_deref())
}

#[tauri::command]
fn tool_speedtest(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<String, String> {
    state.jobs.speedtest(app.clone())
}

#[tauri::command]
fn tool_stop(job: String, state: State<'_, AppState>) {
    state.jobs.stop(&job)
}

#[tauri::command]
async fn tool_ports(host: String, ports: Vec<u16>, timeout_ms: u64) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        nettools::check_ports(&host, ports, timeout_ms).map(|r| serde_json::to_value(r).unwrap_or_default())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command(async)]
fn local_ips() -> serde_json::Value {
    serde_json::to_value(nettools::local_ips()).unwrap_or_default()
}

#[tauri::command(async)]
fn server_start(
    kind: String,
    port: u16,
    allow_write: Option<bool>,
    save: Option<bool>,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let root = state.data_dir.join("tftp");
    match kind.as_str() {
        "tftp" => state.servers.start_tftp(app.clone(), root, port, allow_write.unwrap_or(false)),
        "http" => state.servers.start_http(app.clone(), root, port),
        "syslog" => state.servers.start_syslog(
            app.clone(),
            port,
            save.unwrap_or(false).then(|| state.data_dir.join("syslog")),
        ),
        _ => Err("Servidor desconocido".into()),
    }
}

#[tauri::command]
fn server_stop(kind: String, state: State<'_, AppState>) {
    state.servers.stop(&kind)
}

/// Habilita o quita las subidas de TFTP o FTP en caliente; devuelve el valor anterior.
#[tauri::command]
fn server_set_write(kind: String, allow: bool, state: State<'_, AppState>) -> Result<bool, String> {
    state.servers.set_write(&kind, allow)
}

/// Escritura del servidor en marcha (null si está detenido).
#[tauri::command]
fn server_write(kind: String, state: State<'_, AppState>) -> Option<bool> {
    state.servers.write_allowed(&kind)
}

#[tauri::command]
fn server_running(state: State<'_, AppState>) -> Vec<String> {
    state.servers.running()
}

#[tauri::command(async)]
fn tftp_files(state: State<'_, AppState>) -> Vec<(String, u64)> {
    let dir = state.data_dir.join("tftp");
    let _ = std::fs::create_dir_all(&dir);
    let mut v: Vec<(String, u64)> = std::fs::read_dir(dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter(|e| e.path().is_file())
        .map(|e| (e.file_name().to_string_lossy().into_owned(), e.metadata().map(|m| m.len()).unwrap_or(0)))
        .collect();
    v.sort();
    v
}

/// Copia un archivo elegido por el usuario a la carpeta servida por TFTP/HTTP.
#[tauri::command(async)]
fn tftp_add(path: String, state: State<'_, AppState>) -> Result<String, String> {
    let src = std::path::PathBuf::from(&path);
    let name = src.file_name().ok_or("Ruta inválida")?.to_owned();
    let dir = state.data_dir.join("tftp");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    std::fs::copy(&src, dir.join(&name)).map_err(|e| e.to_string())?;
    Ok(name.to_string_lossy().into_owned())
}

/// MD5 de un archivo de la carpeta compartida (para verificar firmware en el equipo).
#[tauri::command]
async fn tftp_md5(name: String, app: tauri::AppHandle) -> Result<String, String> {
    let root = app.state::<AppState>().data_dir.join("tftp");
    let path = servers::safe_path(&root, &name).ok_or("Nombre inválido")?;
    tauri::async_runtime::spawn_blocking(move || {
        let f = std::fs::File::open(path).map_err(|e| e.to_string())?;
        md5_hex(f).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// MD5 en hexadecimal, leyendo de a 1 MB (los firmware pesan cientos de MB).
fn md5_hex(mut r: impl std::io::Read) -> std::io::Result<String> {
    use md5::{Digest, Md5};
    let mut h = Md5::new();
    let mut buf = vec![0u8; 1 << 20];
    loop {
        let n = r.read(&mut buf)?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
    }
    Ok(h.finalize().iter().map(|b| format!("{b:02x}")).collect())
}

#[tauri::command]
fn tftp_delete(name: String, state: State<'_, AppState>) -> Result<(), String> {
    let root = state.data_dir.join("tftp");
    let path = servers::safe_path(&root, &name).ok_or("Nombre inválido")?;
    std::fs::remove_file(path).map_err(|e| e.to_string())
}

#[tauri::command]
fn device_run(conn: String, command: String, timeout_secs: u64, answer: Option<bool>, app: tauri::AppHandle) -> Result<String, String> {
    if app.state::<AppState>().scripts.owner(&conn).is_some() {
        return Err(scripts::BUSY.into());
    }
    filexfer::run(app, conn, command, timeout_secs, answer.unwrap_or(true))
}

#[tauri::command(async)]
fn source_ip(host: String) -> Result<String, String> {
    filexfer::source_ip_for(&host)
}

/// Consulta el último release del repositorio de la app (latest.json firmado).
#[tauri::command]
async fn update_check(app: tauri::AppHandle) -> Result<updates::UpdateInfo, String> {
    updates::check(&app).await
}

/// Instala la versión encontrada en la última consulta y reinicia. Solo con confirmación.
#[tauri::command]
async fn update_install(app: tauri::AppHandle) -> Result<(), String> {
    updates::install(app).await
}

/// Repositorio desde el que se publica y actualiza la app (dueño/nombre).
#[tauri::command]
fn app_repo() -> &'static str {
    updates::repo()
}

#[tauri::command]
fn app_version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

/// Guarda un texto (exportaciones de diagramas, tablas) en la ruta elegida por el usuario.
#[tauri::command(async)]
fn save_text(dest: String, content: String) -> Result<(), String> {
    let ok_ext = ["svg", "csv", "md", "mmd", "txt", "json", "drawio", "xml"];
    let ext = std::path::Path::new(&dest)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default();
    if !ok_ext.contains(&ext.as_str()) {
        return Err(format!("Extensión no permitida: .{ext}"));
    }
    if content.len() > 10 * 1024 * 1024 {
        return Err("El archivo supera 10 MB".into());
    }
    std::fs::write(&dest, content).map_err(|e| e.to_string())
}

// ---------- Respaldos de configuración ----------

#[tauri::command(async)]
fn backup_save(device: String, content: String, mask: bool, state: State<'_, AppState>) -> Result<String, String> {
    backups::save(&state.data_dir, &device, &content, mask)
}

#[tauri::command(async)]
fn backup_list(state: State<'_, AppState>) -> serde_json::Value {
    serde_json::to_value(backups::list(&state.data_dir)).unwrap_or_default()
}

/// Huellas de los secretos enmascarados de un respaldo (para avisar "secreto cambiado").
#[tauri::command(async)]
fn backup_secrets(device: String, file: String, state: State<'_, AppState>) -> Result<std::collections::BTreeMap<usize, Vec<String>>, String> {
    backups::read_secrets(&state.data_dir, &device, &file)
}

#[tauri::command(async)]
fn backup_read(device: String, file: String, state: State<'_, AppState>) -> Result<String, String> {
    backups::read(&state.data_dir, &device, &file)
}

// ---------- Packs de comandos ----------

#[tauri::command(async)]
fn cmdpacks_list(state: State<'_, AppState>) -> Vec<serde_json::Value> {
    cmdpacks::list(&state.data_dir)
}

#[tauri::command(async)]
fn cmdpack_read(path: String) -> Result<serde_json::Value, String> {
    cmdpacks::read_external(&path)
}

#[tauri::command]
fn cmdpack_save(pack: serde_json::Value, state: State<'_, AppState>) -> Result<String, String> {
    cmdpacks::save(&state.data_dir, &pack)
}

#[tauri::command]
fn cmdpack_delete(id: String, state: State<'_, AppState>) -> Result<(), String> {
    cmdpacks::delete(&state.data_dir, &id)
}

#[tauri::command]
fn cmdpack_export(id: String, dest: String, state: State<'_, AppState>) -> Result<(), String> {
    cmdpacks::export(&state.data_dir, &id, &dest)
}

// ---------- Plugins ----------

#[tauri::command(async)]
fn plugins_list(state: State<'_, AppState>) -> serde_json::Value {
    serde_json::to_value(plugins::list(&state.data_dir)).unwrap_or_default()
}

#[tauri::command(async)]
fn plugin_stage(path: String, state: State<'_, AppState>) -> Result<serde_json::Value, String> {
    plugins::stage(&state.data_dir, std::path::Path::new(&path)).map(|p| serde_json::to_value(p).unwrap_or_default())
}

#[tauri::command(async)]
fn plugin_confirm(staging: String, state: State<'_, AppState>) -> Result<String, String> {
    plugins::confirm(&state.data_dir, &staging)
}

#[tauri::command]
fn plugin_cancel(staging: String, state: State<'_, AppState>) {
    plugins::cancel(&state.data_dir, &staging)
}

#[tauri::command(async)]
fn plugin_set_enabled(id: String, enabled: bool, state: State<'_, AppState>) -> Result<(), String> {
    plugins::set_enabled(&state.data_dir, &id, enabled)
}

#[tauri::command]
fn plugin_uninstall(id: String, state: State<'_, AppState>) -> Result<(), String> {
    plugins::uninstall(&state.data_dir, &id)
}

#[tauri::command(async)]
fn plugin_code(id: String, state: State<'_, AppState>) -> Result<String, String> {
    plugins::read_code(&state.data_dir, &id)
}

#[tauri::command(async)]
fn plugin_run(
    id: String,
    action: String,
    conn: Option<String>,
    vault_type: Option<bool>,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<String, String> {
    plugins::run(&state.scripts, app.clone(), &state.data_dir, &id, &action, conn, vault_type.unwrap_or(false))
}

#[tauri::command]
fn data_dir(state: State<'_, AppState>) -> String {
    state.data_dir.to_string_lossy().into_owned()
}

/// Los ajustes son de la UI: el backend solo los persiste como JSON opaco.
#[tauri::command(async)]
fn get_settings(state: State<'_, AppState>) -> serde_json::Value {
    let settings = load_settings(&state.data_dir.join("settings.json"));
    merge_topology(settings, load_settings(&state.data_dir.join(TOPOLOGY_FILE)))
}

/// La topología y sus snapshots viven en su propio archivo: pueden pesar varios MB y antes se
/// reescribían con cada ajuste (un interruptor, el orden de la barra lateral).
const TOPOLOGY_FILE: &str = "topology.json";
const TOPOLOGY_KEYS: [&str; 2] = ["topology", "topoSnapshots"];
const MAX_TOPOLOGY_BYTES: usize = 64 * 1024 * 1024;

/// Agrega a los ajustes lo guardado en topology.json (que manda) y marca `__topoStore` para que
/// la app sepa que ya no tiene que migrarlo desde settings.json.
fn merge_topology(settings: serde_json::Value, topo: serde_json::Value) -> serde_json::Value {
    let serde_json::Value::Object(t) = topo else { return settings };
    let mut out = match settings {
        serde_json::Value::Object(o) => o,
        _ => serde_json::Map::new(),
    };
    for (k, v) in t {
        if TOPOLOGY_KEYS.contains(&k.as_str()) {
            out.insert(k, v);
        }
    }
    out.insert("__topoStore".into(), serde_json::Value::Bool(true));
    serde_json::Value::Object(out)
}

/// Escribe JSON de forma atómica (temporal y rename) y con permisos restringidos. Legible con
/// sangría si es chico; compacto si pasa de 512 KB (la mitad de bytes y de tiempo).
fn write_json(path: &std::path::Path, value: &serde_json::Value) -> Result<(), String> {
    let compact = serde_json::to_string(value).map_err(|e| e.to_string())?;
    let json = if compact.len() < 512 * 1024 { serde_json::to_string_pretty(value).map_err(|e| e.to_string())? } else { compact };
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, json).map_err(|e| e.to_string())?;
    session_store::restrict(&tmp);
    std::fs::rename(&tmp, path).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_topology(data: serde_json::Value, state: State<'_, AppState>) -> Result<(), String> {
    let serde_json::Value::Object(o) = data else { return Err("topología inválida".into()) };
    // Tope de tamaño: un diagrama de miles de equipos con 20 snapshots no llena el disco.
    if serde_json::to_string(&o).map(|s| s.len()).unwrap_or(0) > MAX_TOPOLOGY_BYTES {
        return Err("La topología supera 64 MB: elimina snapshots antiguos o equipos que no uses.".into());
    }
    let kept: serde_json::Map<String, serde_json::Value> = o.into_iter().filter(|(k, _)| TOPOLOGY_KEYS.contains(&k.as_str())).collect();
    write_json(&state.data_dir.join(TOPOLOGY_FILE), &serde_json::Value::Object(kept))
}

/// Lee settings.json. Null si no existe o no sirve; en ese caso la app usa los valores por
/// defecto y los guarda en el próximo cambio.
fn load_settings(path: &std::path::Path) -> serde_json::Value {
    let bytes = match std::fs::read(path) {
        Ok(b) => b,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return serde_json::Value::Null,
        Err(_) => {
            // Existe pero no se lee (permisos, disco): se intenta respaldar igual que uno dañado.
            session_store::backup_corrupt(path);
            return serde_json::Value::Null;
        }
    };
    match serde_json::from_slice::<serde_json::Value>(&bytes) {
        Ok(v) if v.is_object() => v,
        // Ajustes ilegibles (JSON inválido, bytes que no son UTF-8 o algo que no es un objeto):
        // se respaldan antes de que la app los reemplace por los valores por defecto, para no
        // perder macros, monitores ni el token MCP.
        _ => {
            session_store::backup_corrupt(path);
            serde_json::Value::Null
        }
    }
}

#[tauri::command]
fn save_settings(settings: serde_json::Value, state: State<'_, AppState>) -> Result<(), String> {
    write_json(&state.data_dir.join("settings.json"), &settings)
}

/// Menú nativo de macOS sin "Cerrar ventana" (⌘W), que la app usa para cerrar pestañas.
#[cfg(target_os = "macos")]
fn macos_menu(app: &tauri::AppHandle) -> tauri::Result<tauri::menu::Menu<tauri::Wry>> {
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem as P, Submenu};
    Menu::with_items(
        app,
        &[
            &Submenu::with_items(
                app,
                "NetTerminal",
                true,
                &[
                    &P::about(
                        app,
                        None,
                        Some(tauri::menu::AboutMetadata {
                            name: Some("NetTerminal".into()),
                            version: Some(env!("CARGO_PKG_VERSION").into()),
                            credits: Some("Creado por Nicolás Rivera\nDesarrollado en conjunto con Claude".into()),
                            ..Default::default()
                        }),
                    )?,
                    &P::separator(app)?,
                    &MenuItem::with_id(app, "settings", "Ajustes…", true, Some("CmdOrCtrl+,"))?,
                    &P::separator(app)?,
                    &P::hide(app, None)?,
                    &P::hide_others(app, None)?,
                    &P::separator(app)?,
                    &P::quit(app, None)?,
                ],
            )?,
            &Submenu::with_items(
                app,
                "Edición",
                true,
                &[
                    &P::undo(app, None)?,
                    &P::redo(app, None)?,
                    &P::separator(app)?,
                    &P::cut(app, None)?,
                    &P::copy(app, None)?,
                    &P::paste(app, None)?,
                    &P::select_all(app, None)?,
                ],
            )?,
            &Submenu::with_items(app, "Ventana", true, &[&P::minimize(app, None)?, &P::fullscreen(app, None)?])?,
        ],
    )
}

/// Agrega `extra` al final de `current` sin duplicar carpetas: lo que ya había mantiene su
/// orden y prioridad.
fn merge_path(current: &std::ffi::OsStr, extra: &[std::path::PathBuf]) -> std::ffi::OsString {
    let mut dirs: Vec<std::path::PathBuf> = std::env::split_paths(current).filter(|d| !d.as_os_str().is_empty()).collect();
    for d in extra {
        if !dirs.iter().any(|x| x == d) {
            dirs.push(d.clone());
        }
    }
    std::env::join_paths(dirs).unwrap_or_else(|_| current.to_os_string())
}

/// Carpeta de configuración del sistema o, si no se puede obtener (HOME sin definir, perfil
/// dañado), una alternativa con un aviso para el usuario. Antes `setup` fallaba y la app se
/// cerraba sin decir por qué. Primero `~/.netterminal` (la carpeta de versiones anteriores),
/// luego una carpeta temporal, que el aviso indica que puede perderse.
fn config_dir_or_fallback(
    dir: Result<PathBuf, String>,
    home: Option<std::ffi::OsString>,
    temp: PathBuf,
) -> (PathBuf, Option<String>) {
    let err = match dir {
        Ok(d) => return (d, None),
        Err(e) => e,
    };
    match home.filter(|h| !h.is_empty()) {
        Some(h) => {
            let d = PathBuf::from(h).join(".netterminal");
            let text = format!("No se pudo obtener la carpeta de configuración del sistema ({err}). Los datos se guardan en {}.", d.display());
            (d, Some(text))
        }
        None => {
            let d = temp.join("netterminal-datos");
            let text = format!(
                "No se pudo obtener la carpeta de configuración del sistema ({err}) ni la carpeta personal. Los datos se guardan en {}, que el sistema puede borrar: exporta tus sesiones antes de cerrar.",
                d.display()
            );
            (d, Some(text))
        }
    }
}

/// Abierta desde el Dock o el Finder, la app hereda el PATH mínimo de launchd
/// (/usr/bin:/bin:/usr/sbin:/sbin) y no ve iperf3 de Homebrew ni el Python de python.org.
/// En Linux, un lanzador de escritorio puede no incluir ~/.local/bin (pip --user, pipx).
fn extend_path() {
    let mut extra: Vec<std::path::PathBuf> = Vec::new();
    if cfg!(target_os = "macos") {
        extra.extend(["/opt/homebrew/bin", "/usr/local/bin", "/Library/Frameworks/Python.framework/Versions/Current/bin"].map(Into::into));
    }
    if cfg!(target_os = "linux") {
        if let Some(home) = std::env::var_os("HOME") {
            extra.push(std::path::Path::new(&home).join(".local/bin"));
        }
    }
    if cfg!(target_os = "android") {
        extra.extend([
            "/system/bin",
            "/system/xbin",
            "/data/data/com.termux/files/usr/bin",
        ].map(Into::into));
    }
    let extra: Vec<_> = extra.into_iter().filter(|d| d.is_dir()).collect();
    if extra.is_empty() {
        return;
    }
    let current = std::env::var_os("PATH").unwrap_or_default();
    // Al arrancar, antes de crear hilos: set_var es seguro en ese momento.
    std::env::set_var("PATH", merge_path(&current, &extra));
}

/// WebView2 trae zoom propio: el pellizco del touchpad o de la pantalla táctil (`IsPinchZoomEnabled`,
/// ICoreWebView2Settings5) y Ctrl + rueda (`IsZoomControlEnabled`) escalan toda la página y pueden
/// consumir el gesto antes de que llegue como evento `wheel` o de puntero. Se apagan para que el
/// mapa de Topología haga su propio zoom. Solo Windows; macOS y Linux no se tocan.
#[cfg(windows)]
fn disable_native_zoom(app: &tauri::AppHandle) {
    use tauri::Manager;
    use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings5;
    use windows_core::Interface;
    for (label, window) in app.webview_windows() {
        let name = label.clone();
        let res = window.with_webview(move |wv| {
            let run = || unsafe {
                let settings = wv.controller().CoreWebView2().and_then(|c| c.Settings())?;
                settings.SetIsZoomControlEnabled(false)?;
                // Settings5 exige WebView2 Runtime 1.0.864.35 o superior; en uno anterior solo queda lo primero.
                if let Ok(s5) = settings.cast::<ICoreWebView2Settings5>() {
                    s5.SetIsPinchZoomEnabled(false)?;
                }
                Ok::<(), windows_core::Error>(())
            };
            if let Err(e) = run() {
                eprintln!("NetTerminal: no se pudo apagar el zoom nativo de '{name}': {e}");
            }
        });
        if let Err(e) = res {
            eprintln!("NetTerminal: no se pudo ajustar el zoom nativo de '{label}': {e}");
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    extend_path();
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init());

    #[cfg(not(any(target_os = "android", target_os = "ios")))]
    let builder = builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .on_menu_event(|app, event| {
            if event.id() == "settings" {
                let _ = app.emit("open-settings", ());
            }
        });

    let app = builder
        .setup(|app| {
            // Un error de `setup` hace fallar `build` y, con panic=abort, la app se cerraba sin
            // aviso. Sin menú la app funciona igual: el error se registra y se sigue.
            #[cfg(target_os = "macos")]
            if let Err(e) = macos_menu(app.handle()).and_then(|m| app.set_menu(m)) {
                eprintln!("NetTerminal: no se pudo crear el menú de macOS: {e}");
            }
            #[cfg(windows)]
            disable_native_zoom(app.handle());
            let (os_dir, warning) = config_dir_or_fallback(
                app.path().app_config_dir().map_err(|e| e.to_string()),
                std::env::var_os("HOME").or_else(|| std::env::var_os("USERPROFILE")),
                std::env::temp_dir(),
            );
            if let Some(text) = warning {
                eprintln!("NetTerminal: {text}");
                use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
                app.dialog().message(text).title("NetTerminal").kind(MessageDialogKind::Warning).show(|_| {});
            }
            let data_dir = session_store::resolve_data_dir(os_dir);
            // Corrige permisos de archivos creados por versiones anteriores.
            for f in ["settings.json", "sessions.json", TOPOLOGY_FILE] {
                session_store::restrict(&data_dir.join(f));
            }
            app.manage(updates::Pending::default());
            app.manage(AppState {
                store: SessionStore::new(&data_dir),
                conns: ConnectionManager::default(),
                scripts: scripts::ScriptRunner::default(),
                mcp: mcp::McpServer::default(),
                monitor: monitor::Monitor::default(),
                jobs: nettools::Jobs::default(),
                servers: servers::Servers::default(),
                creds: credentials::Credentials::new(&data_dir, session_store::is_portable()),
                secure_notes: notes::SecureNotes::default(),
                data_dir,
                logs_root: std::sync::Mutex::new(None),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_sessions,
            save_session,
            delete_session,
            update_sessions,
            add_sessions,
            list_serial_ports,
            connect,
            write,
            resize,
            disconnect,
            send_break,
            set_logging,
            logs_dir_get,
            logs_dir_set,
            alerts_configure,
            open_dir,
            data_dir,
            get_settings,
            save_settings,
            save_topology,
            list_notes,
            read_note,
            save_note,
            rename_note,
            delete_note,
            search_notes,
            note_protect,
            note_unlock,
            note_save_secure,
            note_touch,
            note_lock,
            note_unprotect,
            note_change_password,
            import_sessions_file,
            recent_targets,
            recent_target_add,
            recent_targets_clear,
            cmd_history,
            cmd_history_add,
            cmd_history_clear,
            list_scripts,
            import_script,
            delete_script,
            list_deleted_scripts,
            restore_script,
            run_script,
            stop_script,
            script_prompt_reply,
            python_status,
            python_redetect,
            mcp_configure,
            mcp_decide,
            monitor_start,
            monitor_stop,
            monitor_running,
            tool_traceroute,
            tool_iperf,
            tool_iperf_version,
            tool_speedtest,
            tool_stop,
            tool_ports,
            local_ips,
            server_start,
            server_stop,
            server_set_write,
            server_write,
            server_running,
            tftp_files,
            tftp_add,
            tftp_delete,
            tftp_md5,
            save_text,
            cmdpacks_list,
            cmdpack_read,
            cmdpack_save,
            cmdpack_delete,
            cmdpack_export,
            device_run,
            source_ip,
            app_version,
            update_check,
            update_install,
            app_repo,
            plugins_list,
            plugin_stage,
            plugin_confirm,
            plugin_cancel,
            plugin_set_enabled,
            plugin_uninstall,
            plugin_code,
            plugin_run,
            backup_save,
            backup_list,
            backup_read,
            backup_secrets,
            cred_status,
            cred_set,
            cred_has,
            cred_delete,
            hop_cred_set,
            hop_cred_has,
            hop_cred_delete,
            hop_cred_list,
            hop_type_password,
            vault_create,
            vault_unlock,
            vault_lock,
            vault_change,
            vault_reset,
            snmp::snmp_request,
            snmp::snmp_walk,
            snmp::snmp_walk_many,
            snmp::snmp_topo_read,
            snmp::snmp_trap_start,
            snmp::snmp_secret_set,
            snmp::snmp_secret_has,
            snmp::snmp_secret_delete,
            ftpserver::ftp_server_start,
            ftpserver::ftp_server_info,
            ftpclient::ftp_list,
            ftpclient::ftp_get,
            ftpclient::ftp_put
        ])
        .build(tauri::generate_context!());
    // Sin `expect`: con panic=abort un fallo al iniciar (WebView, ventana) cerraba la app sin
    // ningún mensaje. Se registra y se termina con código de error.
    let app = match app {
        Ok(app) => app,
        Err(e) => {
            eprintln!("NetTerminal: error al iniciar: {e}");
            std::process::exit(1);
        }
    };
    app.run(|app, event| {
        // La llave de la bóveda y la de la nota abierta se borran de memoria al salir.
        if let tauri::RunEvent::Exit = event {
            if let Some(state) = app.try_state::<AppState>() {
                state.creds.lock();
                state.secure_notes.lock();
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hop_command_must_target_the_neighbor() {
        assert!(hop_cmd_targets("ssh -l noc 192.0.2.1", "192.0.2.1", "noc"));
        assert!(hop_cmd_targets("ssh noc@192.0.2.1", "192.0.2.1", "noc"));
        assert!(hop_cmd_targets("telnet 192.0.2.1", "192.0.2.1", "noc"));
        // Otra IP que contiene a la del vecino, otro usuario o sin IP: no.
        assert!(!hop_cmd_targets("ssh -l noc 192.0.2.12", "192.0.2.1", "noc"));
        assert!(!hop_cmd_targets("ssh -l otro 192.0.2.1", "192.0.2.1", "noc"));
        assert!(!hop_cmd_targets("ssh otro@192.0.2.1", "192.0.2.1", "noc"));
        assert!(!hop_cmd_targets("show version", "192.0.2.1", "noc"));
        assert!(hop_cmd_targets("ssh -l noc 2001:db8::1", "2001:db8::1", "noc"));
    }

    #[test]
    fn reserved_vault_ids_are_not_session_ids() {
        assert!(credentials::reserved_id("hop:192.0.2.1|noc"));
        assert!(credentials::reserved_id("snmp:core"));
        assert!(!credentials::reserved_id("0b9e0c7e-1f7b-4d5e-9d3a-8c2f6a1b2c3d"));
    }

    #[test]
    fn tftp_md5_known_vectors() {
        // RFC 1321 A.5 y un archivo de 3 MB + 17 bytes (varias lecturas de 1 MB), contrastado con hashlib.
        assert_eq!(md5_hex(&b""[..]).unwrap(), "d41d8cd98f00b204e9800998ecf8427e");
        assert_eq!(md5_hex(&b"abc"[..]).unwrap(), "900150983cd24fb0d6963f7d28e17f72");
        let big: Vec<u8> = (0..3 * 1_048_576 + 17).map(|i| (i % 251) as u8).collect();
        assert_eq!(md5_hex(&big[..]).unwrap(), "7114d559ffda7029526064baa992a30d");
    }

    #[test]
    fn merge_path_appends_without_duplicates_and_keeps_order() {
        use std::path::PathBuf;
        let cur = std::env::join_paths(["/usr/bin", "/bin", "/usr/local/bin"]).unwrap();
        let extra: Vec<PathBuf> = ["/opt/homebrew/bin", "/usr/local/bin", "/opt/homebrew/bin"].map(PathBuf::from).to_vec();
        let got: Vec<PathBuf> = std::env::split_paths(&merge_path(&cur, &extra)).collect();
        assert_eq!(got, ["/usr/bin", "/bin", "/usr/local/bin", "/opt/homebrew/bin"].map(PathBuf::from));
        let empty: Vec<PathBuf> = std::env::split_paths(&merge_path(std::ffi::OsStr::new(""), &extra[..1])).collect();
        assert_eq!(empty, [PathBuf::from("/opt/homebrew/bin")]);
    }

    fn ssh(jump: Option<&str>, args: Option<&str>) -> Session {
        serde_json::from_value(serde_json::json!({
            "name": "t", "type": "ssh", "host": "noc@[2001:DB8::1]", "jump_host": jump, "ssh_args": args
        }))
        .unwrap()
    }

    fn temp_dir(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("nt-{tag}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    fn backups(dir: &std::path::Path, prefix: &str) -> usize {
        std::fs::read_dir(dir)
            .unwrap()
            .flatten()
            .filter(|e| e.file_name().to_string_lossy().starts_with(prefix))
            .count()
    }

    /// topology.json manda sobre settings.json y solo aporta sus dos claves; sin archivo (o dañado)
    /// los ajustes quedan como estaban, sin la marca de migración.
    #[test]
    fn topology_store_merges_over_settings() {
        use serde_json::json;
        let s = json!({"fontSize": 14, "topology": {"nodes": [1]}});
        let merged = merge_topology(s.clone(), json!({"topology": {"nodes": [2]}, "topoSnapshots": [], "otro": 1}));
        assert_eq!(merged["topology"]["nodes"][0], 2);
        assert_eq!(merged["fontSize"], 14);
        assert!(merged.get("otro").is_none());
        assert_eq!(merged["__topoStore"], true);
        assert_eq!(merge_topology(s.clone(), serde_json::Value::Null), s);
        assert_eq!(merge_topology(serde_json::Value::Null, json!({"topoSnapshots": []}))["__topoStore"], true);
        let d = temp_dir("topojson");
        let small = d.join("a.json");
        write_json(&small, &json!({"a": 1})).unwrap();
        assert!(std::fs::read_to_string(&small).unwrap().contains('\n'), "chico: con sangría");
        let big = d.join("b.json");
        write_json(&big, &json!({"x": "y".repeat(600 * 1024)})).unwrap();
        assert!(!std::fs::read_to_string(&big).unwrap().contains('\n'), "grande: compacto");
        std::fs::remove_dir_all(&d).unwrap();
    }

    /// Arranque con settings.json ausente, dañado, con bytes que no son UTF-8 o que no es un
    /// objeto: nunca falla, devuelve Null (valores por defecto) y respalda lo que había.
    #[test]
    fn settings_load_tolerates_missing_and_corrupt_files() {
        let d = temp_dir("settings");
        let path = d.join("settings.json");
        assert!(load_settings(&path).is_null());
        assert_eq!(backups(&d, "settings.corrupt-"), 0, "sin archivo no hay nada que respaldar");

        std::fs::write(&path, r#"{"fontSize": 15, "futuro": true}"#).unwrap();
        assert_eq!(load_settings(&path)["fontSize"], 15);
        assert_eq!(backups(&d, "settings.corrupt-"), 0);

        let cases: [&[u8]; 4] = [br#"{"fontSize": 1"#, b"[1, 2]", b"null", &[0xff, 0xfe, b'{']];
        for (i, bad) in cases.into_iter().enumerate() {
            let sub = d.join(format!("c{i}"));
            std::fs::create_dir_all(&sub).unwrap();
            let p = sub.join("settings.json");
            std::fs::write(&p, bad).unwrap();
            assert!(load_settings(&p).is_null(), "caso {i}");
            assert_eq!(backups(&sub, "settings.corrupt-"), 1, "caso {i}");
            // El original sigue intacto hasta que la app guarde.
            assert_eq!(std::fs::read(&p).unwrap(), bad);
        }
        std::fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn config_dir_falls_back_instead_of_failing() {
        let tmp = PathBuf::from("/tmp");
        let (d, w) = config_dir_or_fallback(Ok(PathBuf::from("/cfg/NetTerminal")), None, tmp.clone());
        assert_eq!((d, w), (PathBuf::from("/cfg/NetTerminal"), None));
        let (d, w) = config_dir_or_fallback(Err("sin HOME".into()), Some("/home/noc".into()), tmp.clone());
        assert_eq!(d, PathBuf::from("/home/noc/.netterminal"));
        assert!(w.unwrap().contains("sin HOME"));
        for home in [None, Some(std::ffi::OsString::new())] {
            let (d, w) = config_dir_or_fallback(Err("x".into()), home, tmp.clone());
            assert_eq!(d, tmp.join("netterminal-datos"));
            assert!(w.unwrap().contains("puede borrar"));
        }
    }

    #[test]
    fn detects_jump_and_prompt_host() {
        assert!(!uses_jump(&ssh(None, None)));
        assert!(!uses_jump(&ssh(Some("  "), Some("-L 8080:localhost:80 -A"))));
        assert!(uses_jump(&ssh(Some("bastion"), None)));
        assert!(uses_jump(&ssh(None, Some("-J bastion"))));
        assert!(uses_jump(&ssh(None, Some("-AJ bastion"))));
        assert!(uses_jump(&ssh(None, Some("-o ProxyJump=bastion"))));
        assert_eq!(prompt_host("noc@[2001:DB8::1]"), "2001:db8::1");
        assert_eq!(prompt_host(" Router1 "), "router1");
    }
}
