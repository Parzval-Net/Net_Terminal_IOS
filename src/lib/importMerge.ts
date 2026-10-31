/**
 * Plan de importación: qué sesiones son nuevas, cuáles ya existen iguales y cuáles cambian.
 * Una sesión importada "es la misma" que una existente si coinciden carpeta y nombre (sin
 * distinguir mayúsculas): así, al reimportar un XML más nuevo de SecureCRT, el host o el puerto
 * que cambió actualiza la sesión en vez de crear una copia.
 */
import type { Session } from "../types";
import { normPath } from "./folders";

/** Campos de conexión que trae la importación. El resto (plataforma, resaltado, SSH legacy…) es
 * configuración local y se conserva. Un campo vacío en el archivo no borra el valor local: el
 * formato de origen puede no traerlo (usuario en Telnet, llave en MobaXterm). */
export const IMPORTED_FIELDS = [
  "type",
  "host",
  "port",
  "username",
  "identity_file",
  "jump_host",
  "serial_port",
  "baud_rate",
  "data_bits",
  "stop_bits",
  "parity",
  "flow_control",
] as const satisfies readonly (keyof Session)[];

export type ImportStatus = "new" | "same" | "update";

export interface PlanItem {
  status: ImportStatus;
  /** Sesión existente que coincide (same/update). */
  existing?: Session;
  /** Campos que cambian (update). */
  changes: string[];
  /** Cambia el destino (tipo, host, puerto, serial, usuario o jump host). */
  retarget: boolean;
  /** Al cambiar el destino se quitan contraseña guardada, túneles o comandos al conectar. */
  drops: boolean;
}

/** Campos que definen a dónde se conecta: si cambian, la sesión deja de ser "la misma". */
const DEST_FIELDS: readonly string[] = ["type", "host", "port", "serial_port", "username", "jump_host"];

const slot = (s: Pick<Session, "folder" | "name">) => `${normPath(s.folder).toLowerCase()}|${s.name.trim().toLowerCase()}`;
const target = (s: Session) => [s.type, s.host ?? "", s.port ?? "", s.serial_port ?? "", s.name.trim().toLowerCase()].join("|");
const norm = (v: unknown) => (v === "" || v === null ? undefined : v);

/** Campos de conexión que el archivo trae con un valor distinto al guardado. */
export function diffFields(existing: Session, imported: Session): (typeof IMPORTED_FIELDS)[number][] {
  return IMPORTED_FIELDS.filter((f) => norm(imported[f]) !== undefined && norm(existing[f]) !== norm(imported[f]));
}

/** Lo local que no debe seguir a un destino nuevo: la contraseña de la bóveda se escribiría en
 * otro equipo, los túneles le abrirían la red local y los comandos al conectar se le enviarían. */
const hasSecrets = (s: Session) => !!(s.save_password || s.tunnels?.length || s.on_connect?.trim());

/** Clasifica cada sesión importada (con su carpeta final ya resuelta). */
export function planImport(existing: Session[], list: Session[]): PlanItem[] {
  const bySlot = new Map(existing.map((s) => [slot(s), s]));
  const byTarget = new Set(existing.map(target));
  const seen = new Set<string>();
  return list.map((s) => {
    const k = slot(s);
    const match = bySlot.get(k);
    if (seen.has(k) || (!match && byTarget.has(target(s)))) {
      // Repetida dentro del mismo archivo o idéntica a una existente en otra carpeta.
      return { status: "same", changes: [], retarget: false, drops: false };
    }
    seen.add(k);
    if (!match) return { status: "new", changes: [], retarget: false, drops: false };
    const changes = diffFields(match, s);
    const retarget = changes.some((f) => DEST_FIELDS.includes(f));
    return { status: changes.length ? "update" : "same", existing: match, changes, retarget, drops: retarget && hasSecrets(match) };
  });
}

/** Sesión existente con los campos de conexión importados; conserva id y configuración local.
 * Si cambia el destino se quitan contraseña guardada, túneles, comandos al conectar y plataforma
 * (quien llama borra además la credencial de la bóveda). */
export function mergeImported(existing: Session, imported: Session): Session {
  const out: Session = { ...existing };
  const changes = diffFields(existing, imported);
  for (const f of changes) (out as unknown as Record<string, unknown>)[f] = imported[f];
  if (changes.some((f) => DEST_FIELDS.includes(f))) {
    delete out.save_password;
    delete out.tunnels;
    delete out.on_connect;
    delete out.platform;
  }
  return out;
}
