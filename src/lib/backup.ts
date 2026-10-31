/**
 * Respaldo de configuración: comando de solo lectura por fabricante y limpieza de la
 * salida (eco, paginación, prompt final) antes de guardarla.
 */
import { cliErrorLine } from "./cliText";
import type { Session } from "../types";
import { computeRisk } from "./packs";

export interface BackupProfile {
  id: string;
  label: string;
  cmd: string;
}

/** Comandos tomados de los packs incluidos (fuente oficial en cada pack). */
export const BACKUP_PROFILES: BackupProfile[] = [
  { id: "cisco", label: "Cisco / Arista", cmd: "show running-config" },
  { id: "huawei", label: "Huawei VRP / H3C", cmd: "display current-configuration" },
  { id: "juniper", label: "Juniper Junos (set)", cmd: "show configuration | display set" },
  { id: "fortinet", label: "FortiOS (cambios)", cmd: "show" },
  { id: "fortinet-full", label: "FortiOS (completa)", cmd: "show full-configuration" },
  { id: "checkpoint", label: "Check Point Gaia (clish)", cmd: "show configuration" },
];

export const profileById = (id: string) => BACKUP_PROFILES.find((p) => p.id === id) ?? BACKUP_PROFILES[0];

/** Perfil sugerido según el resaltado o la plataforma detectada de la sesión. */
export function guessBackupProfile(s: Session): string {
  if (/^r8\d/.test(s.platform ?? "")) return "checkpoint";
  if (/^fos/.test(s.platform ?? "")) return "fortinet";
  if (s.platform === "junos") return "juniper";
  if (/^(vrp|yunshan)/.test(s.platform ?? "")) return "huawei";
  switch (s.highlight) {
    case "huawei":
      return "huawei";
    case "juniper":
      return "juniper";
    case "fortinet":
      return "fortinet";
    default:
      return "cisco";
  }
}

/** Un comando propio solo se acepta si el motor de riesgo lo clasifica como consulta. */
export function isReadOnly(cmd: string): boolean {
  const c = cmd.trim();
  return !!c && !/[\r\n]/.test(c) && computeRisk(c) === "read";
}

/** Huawei: "---- More ----", retrocede el cursor, lo borra con espacios y vuelve a la columna 0. */
const HUAWEI_MORE = /[ ]*-{2,}\s*More\s*-{2,}\x1b\[\d+D[ ]*\x1b\[\d+D/g;
const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b[()][A-Z0-9]|\x1b[=>]/g;
/** Marcas de paginación que quedan en la salida (Cisco, Huawei, Juniper, FortiOS). */
const MORE = /[ ]*(--\s*more\s*--|-{2,}\s*more\s*-{2,}|---\(more[^)]*\)---)/gi;
const PROMPT = /^\S{1,80}?\s?[>#$\]]\s*$/;

/** Aplica retrocesos (\b) como lo haría la terminal: al paginar, el equipo borra "--More--". */
function applyBackspaces(line: string): string {
  if (!line.includes("\b")) return line;
  const out: string[] = [];
  for (const ch of line) {
    if (ch === "\b") out.pop();
    else out.push(ch);
  }
  return out.join("");
}

/**
 * Deja solo la configuración: sin eco del comando, sin marcas de paginación, sin el
 * prompt final ni la cabecera variable de Cisco ("Building configuration", bytes).
 */
export function cleanConfig(raw: string, cmd: string): string {
  const lines = raw
    .replace(HUAWEI_MORE, "")
    .replace(ANSI, "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => applyBackspaces(l).replace(MORE, "").replace(/\s+$/, ""));
  // Todo lo anterior al eco del comando (y el eco) se descarta.
  const echo = lines.findIndex((l) => l.includes(cmd.trim()));
  let body = echo >= 0 ? lines.slice(echo + 1) : lines;
  while (body.length && !body[body.length - 1].trim()) body.pop();
  if (body.length && PROMPT.test(body[body.length - 1])) body.pop();
  while (body.length && !body[body.length - 1].trim()) body.pop();
  // Cabecera variable de IOS: cambia en cada respaldo y ensucia las comparaciones.
  let start = 0;
  while (
    start < body.length &&
    start < 4 &&
    (!body[start].trim() || /^(Building configuration\.\.\.|Current configuration\s*:\s*\d+ bytes)$/i.test(body[start].trim()))
  )
    start++;
  body = body.slice(start);
  return body.join("\n") + (body.length ? "\n" : "");
}

/** Mensaje de error si la salida no parece una configuración. */
export function configProblem(clean: string): string | null {
  if (!clean.trim()) return "El equipo no devolvió configuración";
  const head = clean.split("\n").slice(0, 5).join("\n");
  const failed = cliErrorLine(head);
  if (failed) return failed;
  if (clean.split("\n").length < 3) return "Salida demasiado corta para ser una configuración";
  return null;
}

/** Ejecuta tareas con concurrencia máxima `limit`; `stopped()` evita iniciar nuevas. */
export async function pool<T>(items: T[], limit: number, run: (item: T) => Promise<void>, stopped: () => boolean) {
  let next = 0;
  const worker = async () => {
    while (next < items.length && !stopped()) await run(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

/** "2026-10-21_143005.txt" → "21-10-2026 14:30:05". */
export function backupLabel(file: string): string {
  const m = file.match(/^(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})(\d{2})(-\d+)?\.txt$/);
  return m ? `${m[3]}-${m[2]}-${m[1]} ${m[4]}:${m[5]}:${m[6]}${m[7] ?? ""}` : file;
}
