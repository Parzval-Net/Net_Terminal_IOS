/**
 * Ciclo de vida del equipo (fin de venta, fin de software, último día de soporte) y modelo y
 * versión leídos de la pantalla. Sin comandos: el modelo sale de un "show version" (o equivalente)
 * que el usuario ya ejecutó. La base (src/lib/lifecycleData.json, generada con
 * scripts/lifecycle/generar-lifecycle.mjs) se carga aparte, recién cuando hay un modelo que buscar.
 */
import { promptName } from "./cliText";

/** [fin de venta, fin de software, último día de soporte, anuncio, reemplazo, boletín, fuente] */
type Row = [string, string, string, string, number, number, number];

export interface LifecycleDb {
  generated: string;
  sources: { file: string; vendor: string; url: string; date: string }[];
  repl: string[];
  bulletins: string[];
  rows: Record<string, Row>;
}

export interface Lifecycle {
  /** Clave con la que se encontró (PID, SKU o serie). */
  key: string;
  eos?: string;
  eosw?: string;
  ldos?: string;
  announced?: string;
  replacement?: string;
  bulletin?: string;
  bulletinUrl?: string;
  source: { vendor: string; url: string; date: string };
}

let dbPromise: Promise<LifecycleDb> | null = null;
/** Base de ciclo de vida, en un módulo aparte que se descarga una sola vez. */
export function loadLifecycle(): Promise<LifecycleDb> {
  dbPromise ??= import("./lifecycleData.json").then((m) => (m.default ?? m) as unknown as LifecycleDb);
  return dbPromise;
}

/** Productos Meraki: el modelo (MS225-48LP) también se busca por su SKU (-HW) y su serie. */
const MERAKI = /^(MS|MR|MX|MG|MV|MT|Z|GS|GR|GX)(\d+)/;

/** Claves a probar para un modelo, de la más precisa a la más general. */
export function lookupKeys(model: string): string[] {
  const m = model.trim().toUpperCase();
  const keys = [m, m.replace(/=$/, "")];
  const mk = m.replace(/-HW(-[A-Z]{2})?$/, "");
  const mer = mk.match(MERAKI);
  if (mer) keys.push(`${mk}-HW`, mk, `${mer[1]}${mer[2]} SERIES`, `${mer[1]}${mer[2]}SERIES`);
  return [...new Set(keys)];
}

export function findLifecycle(db: LifecycleDb, model: string): Lifecycle | null {
  for (const key of lookupKeys(model)) {
    if (!Object.hasOwn(db.rows, key)) continue;
    const [eos, eosw, ldos, announced, r, b, s] = db.rows[key];
    const bul = b >= 0 ? db.bulletins[b] : "";
    const [bulletin, bulletinUrl] = bul.includes(" http") ? bul.split(" ") : [bul, undefined];
    const src = db.sources[s];
    return {
      key,
      eos: eos || undefined,
      eosw: eosw || undefined,
      ldos: ldos || undefined,
      announced: announced || undefined,
      replacement: r >= 0 ? db.repl[r] : undefined,
      bulletin: bulletin || undefined,
      bulletinUrl,
      source: { vendor: src?.vendor ?? "", url: src?.url ?? "", date: src?.date ?? "" },
    };
  }
  return null;
}

export type LifeLevel = "ldos" | "eosw" | "eos" | "announced" | "none" | "unknown";

/** Etapa del ciclo de vida a la fecha `today` (AAAA-MM-DD). */
export function lifeLevel(l: Lifecycle | null, today: string): LifeLevel {
  if (!l) return "none";
  if (l.ldos && l.ldos <= today) return "ldos";
  if (l.eosw && l.eosw <= today) return "eosw";
  if (l.eos && l.eos <= today) return "eos";
  if (l.eos || l.announced || l.ldos) return "announced";
  return "unknown";
}

export const LIFE_LABEL: Record<LifeLevel, string> = {
  ldos: "Sin soporte (LDoS)",
  eosw: "Fin de soporte SW",
  eos: "Fin de venta",
  announced: "EoL anunciado",
  none: "Sin anuncio EoL",
  unknown: "Fechas por definir",
};

/** Fecha AAAA-MM-DD a DD-MM-AAAA (formato de Chile). */
export const fmtDate = (d: string | undefined) => (d ? d.split("-").reverse().join("-") : "N/D");

/** Detalle para el tooltip: fechas, reemplazo, boletín y fuente. */
export function lifeDetail(model: string, l: Lifecycle | null, version?: string): string {
  const lines = [`Modelo: ${model}${version ? ` · versión ${version}` : ""}`];
  if (!l) {
    lines.push("Sin anuncio de fin de vida en la base cargada. Valida en la fuente oficial del fabricante antes de informarlo vigente.");
    return lines.join("\n");
  }
  if (l.key !== model.toUpperCase()) lines.push(`Encontrado como: ${l.key}`);
  if (l.announced) lines.push(`Anuncio EoL: ${fmtDate(l.announced)}`);
  lines.push(`Fin de venta (EoS): ${fmtDate(l.eos)}`);
  if (l.eosw || l.source.vendor === "Cisco") lines.push(`Fin de mantenimiento de software (EoSW): ${fmtDate(l.eosw)}`);
  lines.push(`Último día de soporte (LDoS): ${fmtDate(l.ldos)}`);
  if (l.replacement) lines.push(`Reemplazo sugerido: ${l.replacement}`);
  if (l.bulletin) lines.push(`Boletín: ${l.bulletin}`);
  lines.push(`Fuente: ${l.bulletinUrl ?? l.source.url}${l.source.date ? ` (base del ${fmtDate(l.source.date)})` : ""}`);
  return lines.join("\n");
}

// ---------- Modelo y versión desde la pantalla ----------

export interface DeviceInfo {
  model?: string;
  version?: string;
  /** Nombre del prompt cuando se leyó (para no mezclar equipos tras un salto). */
  name?: string;
}

const PID = /^[A-Z0-9][A-Z0-9./+=_-]{2,40}$/i;
/** Líneas de "show version" y equivalentes; cada patrón se prueba por línea (sin regex multilínea). */
const MODEL_LINE: [RegExp, (m: RegExpMatchArray) => string][] = [
  // IOS / IOS-XE: "Model Number : WS-C2960X-48FPD-L", "Model number : C9300-48P"
  [/^\s*Model [Nn]umber\s*:\s*(\S+)/, (m) => m[1]],
  // show inventory: "PID: ISR4331/K9 , VID: V04 , SN: ..."
  [/^\s*PID:\s*([^\s,]+)/, (m) => m[1]],
  // IOS / IOS-XE: "cisco ISR4331/K9 (1RU) processor with ...", "cisco WS-C3750X-24 (PowerPC405) processor"
  [/^\s*[Cc]isco (\S+) \([^)]*\) processor/, (m) => m[1]],
  // NX-OS: "cisco Nexus9000 C93180YC-EX chassis" -> N9K-C93180YC-EX
  [/^\s*cisco Nexus\s?(\d)\d{3} (C\S+) [Cc]hassis/, (m) => `N${m[1]}K-${m[2]}`],
  // FortiOS: "Version: FortiGate-60F v7.2.5,build1517,230606 (GA.F)"
  [/^\s*Version:\s*(Forti\w+-\w+)\s/, (m) => m[1]],
  // Huawei VRP: "HUAWEI S5720-28X-SI-AC Routing Switch uptime is ..."
  [/^\s*(?:HUAWEI|Huawei)\s+(\S+)\s+(?:Routing Switch|Router|Terminal|Switch)\s+uptime/, (m) => m[1]],
  // Junos: "Model: ex4300-48t"
  [/^\s*Model:\s*(\S+)/, (m) => m[1].toUpperCase()],
];
const VERSION_LINE: RegExp[] = [
  /Cisco IOS[ -]XE Software, Version\s+([^\s,]+)/,
  /Cisco IOS XR Software, Version\s+([^\s,[]+)/,
  /Cisco IOS Software.*?, Version\s+([^\s,]+)/,
  /^\s*NXOS:\s*version\s+(\S+)/,
  /^\s*system:\s+version\s+(\S+)/,
  /^\s*Version:\s*Forti\w+-\w+\s+v(\d+\.\d+\.\d+)/,
  /^\s*VRP \(R\) software, Version\s+[\d.]+\s+\(\S+\s+(V\d{3}R\d{3}\S*)\)/,
  /^\s*Junos:\s*(\S+)/,
];

/**
 * Modelo y versión en las últimas líneas de la pantalla (las más recientes ganan). Solo lee lo
 * que el equipo ya mostró: no envía nada.
 */
export function detectDeviceInfo(text: string): DeviceInfo {
  const info: DeviceInfo = {};
  const lines = text.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0 && !(info.model && info.version); i--) {
    // Una línea larga no es de show version: se corta para que ninguna regex se demore.
    const l = lines[i].length > 300 ? lines[i].slice(0, 300) : lines[i];
    if (!info.model)
      for (const [re, pick] of MODEL_LINE) {
        const m = l.match(re);
        if (m) {
          const v = pick(m);
          if (PID.test(v)) {
            info.model = v;
            break;
          }
        }
      }
    if (!info.version)
      for (const re of VERSION_LINE) {
        const m = l.match(re);
        if (m) {
          info.version = m[1].slice(0, 40);
          break;
        }
      }
  }
  return info;
}

/**
 * Nombre del equipo según el prompt de la última línea con texto (Router#, <SW>, [~SW], user@host>,
 * FGT #). Sirve para no atribuir a la sesión un show version hecho tras saltar a otro equipo.
 */
export function promptHost(text: string): string | undefined {
  return promptName(text.slice(-400))?.toLowerCase();
}

/** Modelo desde la plataforma que anuncia CDP/LLDP ("cisco WS-C2960X-48FPD-L", "Meraki MS225-48LP"). */
export function modelFromPlatform(platform: string | undefined): string | undefined {
  if (!platform) return undefined;
  const t = platform.trim().replace(/^(cisco|meraki|cisco meraki)\s+/i, "");
  const first = t.split(/[\s,]+/)[0];
  return first && PID.test(first) && /\d/.test(first) ? first : undefined;
}

/** Máximo de equipos recordados (modelo y versión por destino). */
export const MAX_DEVICE_INFO = 2000;
export type DeviceInfoMap = Record<string, DeviceInfo & { ts: number }>;

/** Guarda el modelo y versión de un destino; descarta los más antiguos sobre el tope. */
export function rememberDevice(map: DeviceInfoMap, key: string, info: DeviceInfo, now = Date.now()): DeviceInfoMap {
  const prev = map[key];
  if (prev && prev.model === (info.model ?? prev.model) && prev.version === (info.version ?? prev.version) && prev.name === (info.name ?? prev.name)) return map;
  const next: DeviceInfoMap = { ...map, [key]: { ...prev, ...info, ts: now } };
  const keys = Object.keys(next);
  if (keys.length > MAX_DEVICE_INFO) {
    for (const k of keys.sort((a, b) => next[a].ts - next[b].ts).slice(0, keys.length - MAX_DEVICE_INFO)) delete next[k];
  }
  return next;
}

/** Clave del equipo para recordar su modelo: el host de una sesión SSH o Telnet (por serie no se recuerda). */
export const deviceKey = (s: { type: string; host?: string }) => ((s.type === "ssh" || s.type === "telnet") && s.host ? s.host.trim().toLowerCase() : null);

// ---------- Versión recomendada y última del sistema operativo ----------

export interface OsEntry {
  vendor: string;
  family: string;
  /** Expresiones (texto) contra el modelo en mayúsculas. */
  match: string[];
  os: string;
  /** Versión que recomienda el fabricante (null si no publica una). */
  recommended: string | null;
  /** Versión más nueva publicada para la plataforma. */
  latest: string | null;
  /** Última versión que tendrá la plataforma (desarrollo terminado o rama tope). */
  lastAvailable: string | null;
  notes?: string;
  source: string;
  checked: string;
}

export interface OsDb {
  generated: string;
  entries: OsEntry[];
}

let osPromise: Promise<{ db: OsDb; res: RegExp[][] }> | null = null;
/** Base de versiones de sistema operativo por familia (módulo aparte, con sus expresiones compiladas una vez). */
export function loadOs(): Promise<{ db: OsDb; res: RegExp[][] }> {
  osPromise ??= import("./osData.json").then((m) => {
    const db = (m.default ?? m) as unknown as OsDb;
    return { db, res: compileOs(db) };
  });
  return osPromise;
}

export function compileOs(db: OsDb): RegExp[][] {
  return db.entries.map((e) =>
    e.match.flatMap((src) => {
      try {
        return [new RegExp(src)];
      } catch {
        return [];
      }
    }),
  );
}

export function findOs(db: OsDb, res: RegExp[][], model: string): OsEntry | null {
  const m = model.trim().toUpperCase().slice(0, 64);
  const i = res.findIndex((list) => list.some((re) => re.test(m)));
  return i >= 0 ? db.entries[i] : null;
}

/**
 * Compara versiones de distinto formato (17.09.04a, 15.2(7)E4, 9.3(10), 7.4.8, 21.4R3-S5,
 * V200R011C10SPC500): por tramos numéricos y de letras. null si alguna no tiene números.
 */
export function compareVersions(a: string, b: string): number | null {
  const tok = (v: string) => v.toLowerCase().match(/\d+|[a-z]+/g) ?? [];
  const x = tok(a);
  const y = tok(b);
  if (!x.some((t) => /\d/.test(t)) || !y.some((t) => /\d/.test(t))) return null;
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const p = x[i];
    const q = y[i];
    if (p === undefined) return -1;
    if (q === undefined) return 1;
    const pn = /^\d/.test(p);
    const qn = /^\d/.test(q);
    if (pn && qn) {
      const d = Number(p) - Number(q);
      if (d) return Math.sign(d);
    } else if (pn !== qn) return pn ? 1 : -1;
    else if (p !== q) return p < q ? -1 : 1;
  }
  return 0;
}

/** Versión a la que conviene llegar: la recomendada, o la última publicada si no hay recomendada. */
export const osTarget = (o: OsEntry) => o.recommended ?? o.lastAvailable ?? o.latest;

/** El equipo corre una versión anterior a la objetivo (null si no se puede comparar). */
export function behind(o: OsEntry | null, version: string | undefined): boolean | null {
  const target = o && osTarget(o);
  if (!target || !version) return null;
  const c = compareVersions(version, target);
  return c === null ? null : c < 0;
}

/** Líneas de detalle del sistema operativo para el tooltip. */
export function osDetail(o: OsEntry | null, version: string | undefined): string[] {
  if (!o) return [];
  const lines = [`Sistema: ${o.os} (${o.family})`];
  if (version) lines.push(`Versión del equipo: ${version}`);
  if (o.recommended) lines.push(`Recomendada por el fabricante: ${o.recommended}`);
  if (o.latest) lines.push(`Última publicada: ${o.latest}`);
  if (o.lastAvailable && o.lastAvailable !== o.latest) lines.push(`Última para este modelo: ${o.lastAvailable}`);
  else if (o.lastAvailable) lines.push("El modelo ya no recibe ramas nuevas");
  const late = behind(o, version);
  if (late === true) lines.push(`Actualizable: corre ${version}, objetivo ${osTarget(o)}`);
  if (late === false) lines.push("Al día respecto de la versión objetivo");
  if (o.notes) lines.push(o.notes);
  lines.push(`Fuente: ${o.source} (revisado ${fmtDate(o.checked)})`);
  return lines;
}
