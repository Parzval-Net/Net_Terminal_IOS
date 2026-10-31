/**
 * Exportación de sesiones a XML con el esquema de SecureCRT (Tools › Export Settings):
 * se abre en SecureCRT y se reimporta en Net Terminal con Importar › Desde archivo.
 * Solo datos de conexión: nunca contraseñas, comandos al conectar ni argumentos extra.
 */
import type { Session } from "../types";
import { normPath } from "./folders";

const esc = (v: string) =>
  v
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

interface Dir {
  dirs: Map<string, Dir>;
  items: [string, Session][];
}

const PROTO: Record<string, string> = { ssh: "SSH2", telnet: "Telnet", raw: "Raw", serial: "Serial" };

function fields(s: Session): [kind: "string" | "dword", name: string, value: string | number][] {
  const out: [kind: "string" | "dword", name: string, value: string | number][] = [
    ["dword", "Is Session", 1],
    ["string", "Protocol Name", PROTO[s.type]],
  ];
  if (s.type === "serial") {
    out.push(["string", "Com Port", s.serial_port ?? ""]);
    out.push(["dword", "Baud Rate", s.baud_rate ?? 9600]);
    out.push(["dword", "Data Bits", s.data_bits ?? 8]);
    // Convención de Windows (DCB): 0 = 1 bit, 2 = 2 bits.
    out.push(["dword", "Stop Bits", s.stop_bits === 2 ? 2 : 0]);
    out.push(["dword", "Parity", s.parity === "odd" ? 1 : s.parity === "even" ? 2 : 0]);
    out.push(["dword", "CTS Flow", s.flow_control === "hardware" ? 1 : 0]);
    out.push(["dword", "XON Flow", s.flow_control === "software" ? 1 : 0]);
    return out;
  }
  out.push(["string", "Hostname", s.host ?? ""]);
  if (s.username) out.push(["string", "Username", s.username]);
  const port = s.port ?? (s.type === "ssh" ? 22 : s.type === "telnet" ? 23 : undefined);
  if (port) out.push(["dword", s.type === "ssh" ? "[SSH2] Port" : "Port", port]);
  return out;
}

/** XML de las sesiones (las locales se omiten). Mantiene la jerarquía de carpetas. */
export function sessionsToXml(sessions: Session[]): string {
  const root: Dir = { dirs: new Map(), items: [] };
  for (const s of sessions) {
    if (!PROTO[s.type]) continue;
    let d = root;
    for (const part of normPath(s.folder).split("/").filter(Boolean)) {
      let next = d.dirs.get(part);
      if (!next) d.dirs.set(part, (next = { dirs: new Map(), items: [] }));
      d = next;
    }
    // SecureCRT reserva "Default" en la raíz (plantilla) y oculta los nombres con "__" al inicio.
    let base = (s.name.trim() || s.host || s.serial_port || "Sesión").replace(/^_{2,}/, "_");
    if (d === root && /^Default(_|$)/i.test(base)) base = `${base} (sesión)`;
    // SecureCRT identifica la sesión por su nombre dentro de la carpeta: los repetidos se numeran.
    const taken = new Set([...d.items.map(([n]) => n), ...d.dirs.keys()]);
    let name = base;
    for (let i = 2; taken.has(name); i++) name = `${base} (${i})`;
    d.items.push([name, s]);
  }
  const lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<VanDyke version="3.0">', '  <key name="Sessions">'];
  const walk = (d: Dir, pad: string) => {
    for (const [name, sub] of d.dirs) {
      lines.push(`${pad}<key name="${esc(name)}">`);
      walk(sub, pad + "  ");
      lines.push(`${pad}</key>`);
    }
    for (const [name, s] of d.items) {
      lines.push(`${pad}<key name="${esc(name)}">`);
      for (const [kind, k, v] of fields(s)) lines.push(`${pad}  <${kind} name="${esc(k)}">${esc(String(v))}</${kind}>`);
      lines.push(`${pad}</key>`);
    }
  };
  walk(root, "    ");
  lines.push("  </key>", "</VanDyke>", "");
  return lines.join("\n");
}
