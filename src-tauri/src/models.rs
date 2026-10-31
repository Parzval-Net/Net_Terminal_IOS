use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum SessionType {
    Local,
    Ssh,
    Serial,
    Telnet,
    /// TCP sin negociación Telnet (servidores de consola, puertos 2001+).
    Raw,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Session {
    #[serde(default)]
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub session_type: SessionType,
    #[serde(default)]
    pub folder: Option<String>,
    #[serde(default)]
    pub host: Option<String>,
    #[serde(default)]
    pub port: Option<u16>,
    #[serde(default)]
    pub username: Option<String>,
    /// Ruta a la llave privada SSH (opcional, si no se usa ~/.ssh/config o el agente).
    #[serde(default)]
    pub identity_file: Option<String>,
    /// Habilita algoritmos antiguos (equipos de red legacy).
    #[serde(default)]
    pub legacy_ssh: Option<bool>,
    /// Bastión intermedio (ProxyJump), ej. usuario@bastion:22.
    #[serde(default)]
    pub jump_host: Option<String>,
    /// Argumentos extra para ssh (túneles -L/-D, -A, -o ...).
    #[serde(default)]
    pub ssh_args: Option<String>,
    /// Túneles SSH estructurados (-L, -R, -D). Se validan antes de pasarlos a ssh.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tunnels: Option<Vec<Tunnel>>,
    #[serde(default)]
    pub serial_port: Option<String>,
    #[serde(default)]
    pub baud_rate: Option<u32>,
    #[serde(default)]
    pub data_bits: Option<u8>,
    #[serde(default)]
    pub stop_bits: Option<u8>,
    #[serde(default)]
    pub parity: Option<String>,
    #[serde(default)]
    pub flow_control: Option<String>,
    #[serde(default)]
    pub highlight: Option<String>,
    /// Comandos que se envían al conectar (uno por línea).
    #[serde(default)]
    pub on_connect: Option<String>,
    /// Qué envía Enter: "cr" (por defecto), "lf" o "crlf".
    #[serde(default)]
    pub newline: Option<String>,
    /// Qué envía Retroceso: "del" (^?) o "bs" (^H). Sin valor: automático (BS en Huawei).
    /// La traducción la hace la terminal; aquí solo se guarda con la sesión.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub backspace: Option<String>,
    #[serde(default)]
    pub local_echo: Option<bool>,
    /// Codificación de la salida: "utf-8" (por defecto), "iso-8859-1", "windows-1252".
    #[serde(default)]
    pub encoding: Option<String>,
    #[serde(default)]
    pub auto_reconnect: Option<bool>,
    /// Plataforma detectada para el catálogo de comandos (ej. "vrp5", "iosxe").
    #[serde(default)]
    pub platform: Option<String>,
    /// Transferencia SCP en una pestaña de terminal (solo pestañas temporales).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scp: Option<ScpSpec>,
    /// Autocompletar la contraseña guardada en la bóveda (nunca va en este archivo).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub save_password: Option<bool>,
    #[serde(default)]
    pub created_at: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum TunnelKind {
    /// -L: puerto local hacia un destino visto desde el servidor.
    Local,
    /// -R: puerto en el servidor hacia un destino visto desde el PC.
    Remote,
    /// -D: proxy SOCKS local.
    Dynamic,
}

/// Regla de túnel SSH.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tunnel {
    pub kind: TunnelKind,
    /// Dirección donde escucha (por defecto 127.0.0.1).
    #[serde(default)]
    pub bind: Option<String>,
    pub listen_port: u16,
    /// Destino (no aplica a -D).
    #[serde(default)]
    pub dest_host: Option<String>,
    #[serde(default)]
    pub dest_port: Option<u16>,
}

impl Session {
    /// Sesión vacía (para importadores): solo nombre y tipo.
    pub fn blank(name: String, session_type: SessionType) -> Self {
        Session {
            id: String::new(),
            name,
            session_type,
            folder: None,
            host: None,
            port: None,
            username: None,
            identity_file: None,
            legacy_ssh: None,
            jump_host: None,
            ssh_args: None,
            tunnels: None,
            serial_port: None,
            baud_rate: None,
            data_bits: None,
            stop_bits: None,
            parity: None,
            flow_control: None,
            highlight: None,
            on_connect: None,
            newline: None,
            backspace: None,
            local_echo: None,
            encoding: None,
            auto_reconnect: None,
            platform: None,
            scp: None,
            save_password: None,
            created_at: String::new(),
        }
    }
}

/// Copia SCP entre la carpeta compartida del PC y el equipo.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScpSpec {
    /// true: PC -> equipo. false: equipo -> PC.
    pub upload: bool,
    /// Nombres de archivo (en la carpeta compartida o en el equipo).
    pub files: Vec<String>,
    /// Carpeta o sistema de archivos remoto (ej. "flash:", "/var/tmp/").
    pub remote_dir: String,
    /// Rutas locales absolutas: las resuelve el backend, nunca el frontend.
    #[serde(default, skip_deserializing)]
    pub local_paths: Vec<String>,
    #[serde(default)]
    pub local_dir: String,
    /// "scp" (por defecto, protocolo SCP clásico), "sftp" (scp sobre el protocolo SFTP)
    /// o "shell" (cliente sftp interactivo en la carpeta compartida).
    #[serde(default)]
    pub mode: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SerialPortInfo {
    pub port_name: String,
    pub port_type: String,
}
