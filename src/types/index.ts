export type SessionType = "local" | "ssh" | "serial" | "telnet" | "raw";

export interface Session {
  id: string;
  name: string;
  type: SessionType;
  folder?: string;
  host?: string;
  port?: number;
  username?: string;
  identity_file?: string;
  legacy_ssh?: boolean;
  jump_host?: string;
  ssh_args?: string;
  /** Túneles SSH estructurados (-L, -R, -D). */
  tunnels?: Tunnel[];
  serial_port?: string;
  baud_rate?: number;
  data_bits?: number;
  stop_bits?: number;
  parity?: "none" | "odd" | "even";
  flow_control?: "none" | "software" | "hardware";
  /** Perfil de resaltado: "default" (según ajustes), "off" o id de fabricante. */
  highlight?: string;
  /** Comandos que se envían al conectar (uno por línea). */
  on_connect?: string;
  /** Qué envía Enter: "cr" (por defecto), "lf" o "crlf". */
  newline?: "cr" | "lf" | "crlf";
  /** Qué envía Retroceso: "del" (^?) o "bs" (^H). Sin valor: automático (BS en Huawei, DEL en el resto). */
  backspace?: "del" | "bs";
  local_echo?: boolean;
  /** Codificación de la salida del equipo. */
  encoding?: string;
  auto_reconnect?: boolean;
  /** Plataforma detectada para el catálogo (ej. "vrp5", "iosxe"). */
  platform?: string;
  /** Pestaña temporal de transferencia SCP. */
  scp?: { upload: boolean; files: string[]; remote_dir: string; mode?: "scp" | "sftp" | "shell" };
  /** Autocompletar la contraseña guardada en la bóveda cifrada (nunca viaja al frontend). */
  save_password?: boolean;
  created_at: string;
}

export type TunnelKind = "local" | "remote" | "dynamic";

export interface Tunnel {
  kind: TunnelKind;
  /** Dirección de escucha; vacío = 127.0.0.1. */
  bind?: string;
  listen_port: number;
  dest_host?: string;
  dest_port?: number;
}

/** Forma corta de un túnel: L 8443→192.0.2.10:443, D 1080, R 9000→localhost:22. */
export function tunnelLabel(t: Tunnel): string {
  const flag = { local: "L", remote: "R", dynamic: "D" }[t.kind];
  const bind = t.bind && t.bind !== "127.0.0.1" ? `${t.bind}:` : "";
  return t.kind === "dynamic"
    ? `${flag} ${bind}${t.listen_port}`
    : `${flag} ${bind}${t.listen_port}→${t.dest_host ?? ""}:${t.dest_port ?? ""}`;
}

/** Clave del historial de comandos: id de la sesión guardada o tipo+destino. */
export function historyKey(s: Session): string {
  if (s.id && !s.id.startsWith("scp-")) return s.id;
  return `${s.type}:${s.host ?? s.serial_port ?? "local"}`;
}

export interface SerialPortInfo {
  port_name: string;
  port_type: string;
}

export type ConnStatus = "connecting" | "connected" | "closed";

export interface Tab {
  id: string;
  session: Session;
  /** Nombre puesto por el usuario solo para esta pestaña. */
  title?: string;
}

export const tabTitle = (t: Tab) => t.title?.trim() || t.session.name;

export interface TabState {
  status: ConnStatus;
  logPath: string | null;
}

/** Descripción corta del destino: user@host:port, COM3 · 9600 8N1, etc. */
export function sessionTarget(s: Session): string {
  switch (s.type) {
    case "ssh": {
      const user = s.username ? `${s.username}@` : "";
      const port = s.port && s.port !== 22 ? `:${s.port}` : "";
      return `${user}${s.host ?? ""}${port}`;
    }
    case "telnet":
      return `${s.host ?? ""}${s.port && s.port !== 23 ? `:${s.port}` : ""}`;
    case "raw":
      return `${s.host ?? ""}:${s.port ?? ""}`;
    case "serial": {
      const parity = (s.parity ?? "none")[0].toUpperCase();
      return `${s.serial_port ?? ""} · ${s.baud_rate ?? 9600} ${s.data_bits ?? 8}${parity}${s.stop_bits ?? 1}`;
    }
    default:
      return "Shell del sistema";
  }
}
