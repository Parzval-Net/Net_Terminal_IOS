/**
 * Sugerencias de comandos: lógica pura, sin DOM ni xterm, para poder probarla.
 *
 * - InputTracker: estado de lo tecleado desde el último Enter. Solo sugiere cuando la
 *   pantalla confirma que la línea es prompt + lo tecleado (sincronía). Si la línea se
 *   redibuja (mensaje asíncrono) o el prompt llega después de teclear, vuelve a
 *   sincronizar cuando la pantalla termina otra vez en prompt + lo tecleado. Una tecla de
 *   control o un pegado lo dejan "perdido" hasta el próximo Enter o salto de línea. Con un
 *   pedido de credenciales en pantalla no se guarda nada de lo tecleado.
 * - Índice por plataforma: arreglo ordenado por comando, con las palabras (tokens) de cada
 *   uno precalculadas. Se busca por prefijo exacto y por abreviatura de cada palabra
 *   (`sh ip int br` → `show ip interface brief`) con búsqueda binaria por nivel de palabra.
 * - Ranking: prefijo exacto primero, luego abreviaturas; dentro de cada grupo pesa el uso
 *   local (plantillas aceptadas o ejecutadas, nunca argumentos) y los favoritos.
 * - Modo: el prompt dice si la CLI está en configuración (`(config-if)#`, `[HUAWEI]`, `#` de
 *   Junos, `FGT (interface) #`). Ahí una abreviatura puede ser otro comando (`sh` es `shutdown`),
 *   así que solo se sugiere tras `do `/`run ` o con `display`/`show` completo (Huawei, ASA).
 * - Tab nativo y ayuda `?`: el equipo reescribe la línea; lo tecleado se vuelve a leer de la
 *   pantalla (prompt conocido + resto) cuando responde, y las sugerencias siguen en esa línea.
 * - Seguridad: la sugerencia solo ofrece consultas; lo que inserta una sugerencia nunca
 *   incluye Enter, saltos de línea ni caracteres de control, y se corta en el primer
 *   marcador ({{interfaz}} o <interfaz>).
 */
import { type CatalogVendor, type Risk, appliesTo, commandFor, computeRisk } from "./packs";

/** Prompt típico de equipos y shells (también lo usan los comandos al conectar). */
export const PROMPT = /[>#$%\]]\s*$/;
/**
 * Pedido de usuario, contraseña, passphrase o segundo factor: ahí no se sigue lo tecleado.
 * Incluye los de RADIUS/TACACS+ (PASSCODE, PIN, token, OTP, código de verificación).
 */
export const CREDENTIALS =
  /(password|passphrase|passcode|pass code|contraseña|clave|username|user name|usuario|login|\bpin\b|\btoken\b|\botp\b|one-time|verification code|código|\bsecret\b|\bresponse\b)[^\n]*:\s*$/i;

/** Tope de la línea seguida: una línea más larga deja de sugerir. */
const MAX_BUF = 256;

/**
 * La línea en pantalla (hasta el cursor) termina con lo tecleado. Acepta el desplazamiento
 * horizontal de Cisco IOS, que muestra "prompt#$" y solo el final de una línea larga.
 */
export function endsWithTyped(line: string, buf: string): boolean {
  if (line.endsWith(buf)) return true;
  const i = line.lastIndexOf("$");
  if (i < 1) return false;
  const visible = line.slice(i + 1);
  return visible.length >= 4 && buf.length > visible.length && buf.endsWith(visible) && PROMPT.test(line.slice(0, i));
}

/** La línea (hasta el cursor) es un prompt seguido exactamente de lo tecleado. */
export function atPrompt(line: string, buf: string): boolean {
  if (line.endsWith(buf)) return PROMPT.test(line.slice(0, line.length - buf.length));
  return buf.length > 0 && endsWithTyped(line, buf);
}

/** El prompt de una línea que es prompt + lo tecleado (sin el "$" del desplazamiento de IOS). */
function promptPart(line: string, buf: string): string {
  return line.endsWith(buf) ? line.slice(0, line.length - buf.length) : line.slice(0, line.lastIndexOf("$"));
}

// ---------- Modo de la CLI (según el prompt) ----------

/**
 * exec: modo de consulta (Cisco `>`/`#`, Huawei `<...>`, Junos `>`, FortiOS `FGT #`).
 * config: configuración o un modo que no es la CLI de consulta, donde una abreviatura
 * puede ser otro comando (`sh` es `shutdown` en una interfaz de Cisco).
 */
export type CliMode = "exec" | "config";

/** Cisco `(config...)#`, `(config-if)#`, `(dhcp-config)#`; FortiOS `FGT (interface) #`; WatchGuard `WG(config)#`. */
const PAREN_MODE = /\([^()]*\)\s*#\s*$/;
/** Huawei: vista de sistema o de interfaz `[HUAWEI]`, `[~HUAWEI-GigabitEthernet0/0/1]`, `[*HUAWEI]`. */
const BRACKET_MODE = /\[[^[\]]*\]\s*$/;

/**
 * Modo según el prompt. Ante la duda se elige config: apagar la sugerencia nunca es un riesgo.
 * Junos usa `#` en configuración y `%`/`$` en la shell de FreeBSD: solo `>` es modo operacional.
 */
export function cliMode(prompt: string, vendor: string): CliMode {
  const p = prompt.trimEnd();
  if (PAREN_MODE.test(p) || BRACKET_MODE.test(p)) return "config";
  if (vendor === "juniper" && !p.endsWith(">")) return "config";
  return "exec";
}

/**
 * En configuración solo se sugiere lo que el fabricante ejecuta igual que en modo consulta:
 * después de `do ` (Cisco IOS, IOS-XE, NX-OS, IOS-XR) o `run ` (Junos), o un comando que
 * empieza con la palabra completa `display` (Huawei, válida en todas las vistas) o `show`
 * (ASA, que acepta show en configuración). Cada entrada: prefijo de escape o palabra
 * exigida, y si el escape se quita de la búsqueda.
 */
const CONFIG_ESCAPE: Record<string, { re: RegExp; strip: boolean; hint: string }> = {
  cisco: { re: /^\s*do\s+/i, strip: true, hint: "Modo configuración: escribe «do » antes de una consulta para ver sugerencias" },
  juniper: { re: /^\s*run\s+/i, strip: true, hint: "Modo configuración: escribe «run » antes de una consulta para ver sugerencias" },
  huawei: { re: /^\s*display(\s|$)/i, strip: false, hint: "Vista de configuración: solo se sugieren comandos que empiezan con «display» completo" },
};
const ASA_ESCAPE = { re: /^\s*show(\s|$)/i, strip: false, hint: "Modo configuración: solo se sugieren comandos que empiezan con «show» completo" };

/** La regla de escape de configuración para la plataforma (null: en configuración no se sugiere nada). */
function configEscape(vendor: string, platform: string) {
  if (platform === "asa") return ASA_ESCAPE;
  return CONFIG_ESCAPE[vendor] ?? null;
}

/**
 * Lo que se busca en el catálogo según el modo: en exec, lo tecleado; en configuración, solo
 * lo que va detrás de un escape (`do `, `run `) o un `display`/`show` completo; si no, null
 * (ni sugerencia ni lista).
 */
export function suggestQuery(buf: string, prompt: string, idx: Pick<SuggestIndex, "vendor" | "platform">): string | null {
  if (cliMode(prompt, idx.vendor) === "exec") return buf;
  const esc = configEscape(idx.vendor, idx.platform);
  const m = esc?.re.exec(buf);
  if (!esc || !m) return null;
  return esc.strip ? buf.slice(m[0].length) : buf;
}

/** Aviso para la tecla de lista en configuración. */
export function configHint(idx: Pick<SuggestIndex, "vendor" | "platform">): string {
  return configEscape(idx.vendor, idx.platform)?.hint ?? "Modo configuración: las sugerencias solo funcionan en modo consulta";
}

// ---------- Estado de la línea ----------

export class InputTracker {
  /** Lo tecleado desde el último Enter (válido mientras no esté `lost`). */
  buf = "";
  /** La pantalla confirmó que la línea es prompt + buf. */
  sync = false;
  /** Pantalla con pedido de credenciales: no se sigue nada. */
  cred = false;
  /** Hubo una tecla de control o un pegado: lo tecleado es desconocido hasta el próximo Enter. */
  lost = false;
  /** Prompt de la línea sincronizada (define el modo: consulta o configuración). Solo en memoria. */
  prompt = "";
  /**
   * El equipo cambió la línea por su cuenta (Tab nativo o ayuda `?`): lo tecleado se vuelve a
   * leer de la pantalla (prompt conocido + resto) cuando el equipo responde.
   */
  reread = false;
  /** Llegó salida del equipo desde la última tecla (la pantalla ya refleja la respuesta). */
  private fresh = false;
  /** Lo tecleado mientras se espera la respuesta del equipo (la pantalla debe terminar así). */
  private after = "";
  /** Esc descartó la sugerencia de esta línea: no se muestra otra hasta el próximo Enter. */
  dismissed = false;
  /** Número de línea (cambia con cada Enter): la ayuda cuenta una vez por línea. */
  line = 0;

  /** Deja de seguir la línea hasta el próximo Enter o salto de línea. */
  reset() {
    this.buf = "";
    this.sync = false;
    this.lost = true;
    this.reread = false;
  }

  /** Estado inicial (conexión nueva). */
  clear() {
    this.buf = "";
    this.sync = false;
    this.cred = false;
    this.lost = false;
    this.prompt = "";
    this.reread = false;
    this.dismissed = false;
    this.line++;
  }

  /** Se puede sugerir sobre la línea actual. */
  get active() {
    return this.sync && !this.cred;
  }

  /** Falta sincronizar, pero lo tecleado es conocido (o se puede leer de la pantalla). */
  get canResync() {
    return !this.sync && !this.lost && !this.cred;
  }

  /** Lo que la terminal envía al equipo por teclado (term.onData). */
  input(data: string) {
    if (data === "\r" || data === "\n" || data === "\r\n") {
      // Enter limpia; se vuelve a seguir cuando aparezca el próximo prompt.
      this.buf = "";
      this.sync = false;
      this.lost = false;
      this.reread = false;
      this.dismissed = false;
      this.line++;
      return;
    }
    if (this.cred || this.lost) {
      // Con credenciales en pantalla (o sin seguimiento) no se guarda nada de lo tecleado.
      this.reset();
      return;
    }
    // Retroceso: DEL (0x7f) o BS (0x08), según lo que envíe la sesión.
    const back = data === "\x7f" || data === "\b";
    if (this.reread) {
      // Esperando la respuesta del equipo: lo tecleado se confirma con la pantalla.
      this.fresh = false;
      // Otro Tab o "?" (doble Tab de las shells): se sigue esperando la línea que redibuje.
      if (data === "\t" || data === "?") this.after = "";
      else if (back) this.after = dropLast(this.after);
      else if (isPrintable(data) && this.after.length + data.length <= MAX_BUF) this.after += data;
      else this.reset();
      return;
    }
    if (back) {
      this.buf = dropLast(this.buf);
      return;
    }
    // Tab nativo del equipo o ayuda "?" sobre una línea sincronizada: el equipo reescribe la
    // línea (completa la palabra o imprime la ayuda y repite prompt + lo tecleado).
    if ((data === "\t" || data === "?") && this.sync) {
      this.startReread();
      return;
    }
    if (isPrintable(data) && this.buf.length + data.length <= MAX_BUF) {
      this.buf += data;
      return;
    }
    // Flechas, Esc, Ctrl+A/E/U/W/R, Inicio/Fin, pegado o texto compuesto (IME).
    this.reset();
  }

  private startReread() {
    this.buf = "";
    this.sync = false;
    this.reread = true;
    this.fresh = false;
    this.after = "";
  }

  /** Texto insertado por una sugerencia (ya saneado con safeInsert). */
  insert(text: string) {
    if (!this.active || !text) return;
    if (!isPlainText(text) || this.buf.length + text.length > MAX_BUF) return this.reset();
    this.buf += text;
  }

  /**
   * Salida del equipo. El eco de lo tecleado no trae saltos de línea; un salto de línea
   * (salida nueva, mensaje asíncrono, línea redibujada) corta la sincronía, que vuelve si
   * la pantalla termina otra vez en prompt + lo tecleado. `tail` entrega el final limpio
   * de la salida y solo se llama si hace falta.
   */
  output(chunk: string, tail: () => string) {
    const nl = /[\r\n]/.test(chunk);
    if (this.sync && !nl) return;
    this.sync = false;
    if (this.reread) this.fresh = true;
    // Tras una tecla de control, una línea nueva del equipo vuelve a partir de cero.
    if (this.lost && chunk.includes("\n")) {
      this.lost = false;
      this.buf = "";
      this.dismissed = false;
    }
    if (this.lost) return;
    const t = tail();
    this.cred = CREDENTIALS.test(t);
    if (this.cred) {
      this.buf = "";
      this.reread = false;
      return;
    }
    // Releyendo tras Tab o "?": solo vale la línea real de la pantalla (resync desde la
    // terminal), no el texto crudo, que puede traer retrocesos o redibujos.
    if (this.reread) return;
    this.resync(t.slice(t.lastIndexOf("\n") + 1));
  }

  /**
   * Vuelve a sincronizar si la línea en pantalla (hasta el cursor) es prompt + lo
   * tecleado. La usa la terminal tras cada escritura, con la línea real de xterm.
   * Tras Tab o "?" lee lo tecleado de la pantalla: la línea debe empezar con el prompt
   * conocido, haber recibido respuesta del equipo y terminar con lo tecleado después.
   */
  resync(line: string): boolean {
    if (!this.canResync) return false;
    if (this.reread) {
      if (!this.fresh || !line.startsWith(this.prompt) || !line.endsWith(this.after)) return false;
      const rest = line.slice(this.prompt.length);
      // "$" tras el prompt es el desplazamiento horizontal de IOS: el inicio no se ve.
      if (rest.startsWith("$") || rest.length > MAX_BUF || !isPlainText(rest)) return false;
      this.buf = rest;
      this.reread = false;
      this.sync = true;
      return true;
    }
    if (!atPrompt(line, this.buf)) return false;
    this.sync = true;
    this.prompt = promptPart(line, this.buf);
    return true;
  }
}

/** Quita el último carácter (o par sustituto). */
function dropLast(s: string): string {
  const n = s.length;
  const low = n > 1 && /[\udc00-\udfff]/.test(s[n - 1]);
  return s.slice(0, low ? n - 2 : n - 1);
}

/** Una tecla imprimible (un carácter, o un par sustituto). */
function isPrintable(data: string): boolean {
  if (data.length === 1) {
    const c = data.charCodeAt(0);
    return c >= 0x20 && c !== 0x7f && !(c >= 0x80 && c < 0xa0) && !(c >= 0xd800 && c <= 0xdfff);
  }
  return data.length === 2 && /^[\ud800-\udbff][\udc00-\udfff]$/.test(data);
}

/** Sin caracteres de control (C0, DEL, C1) ni saltos de línea. */
const CONTROL = /[\x00-\x1f\x7f-\x9f]/;
const isPlainText = (s: string) => !CONTROL.test(s);

// ---------- Índice por plataforma ----------

export interface SuggestEntry {
  /** Comando completo para la plataforma, con espacios simples (puede traer marcadores). */
  cmd: string;
  /** cmd en minúsculas: clave de orden y de comparación. */
  key: string;
  /** Palabras de `key`. */
  toks: string[];
  /** Posición en `key` donde empieza cada palabra. */
  starts: number[];
  /** Dónde empieza el marcador en cada palabra (-1 si no tiene). */
  ph: number[];
  /** Parte que se puede insertar: hasta el primer marcador, sin él. */
  insert: string;
  /** Hay un marcador después de `insert`. */
  placeholder: boolean;
  risk: Risk;
  desc: string;
  /** Posición en el catálogo (desempate estable). */
  order: number;
  /** Comando base del catálogo: id estable para favoritos e historial (nunca trae argumentos). */
  tpl: string;
  /** Posición en `entries` (para los pesos de uso). */
  pos: number;
  /** Lleva un filtro de salida ("| include"): con igual uso pierde ante el comando sin filtro. */
  pipe: boolean;
  /**
   * Desempate precalculado (menor es mejor): palabras, largo hasta el marcador y filtro "|".
   * Un solo número para que comparar no agregue costo por tecla.
   */
  tie: number;
  /** `tie` y `order` en un solo número (order es único por plataforma): una comparación. */
  rank: number;
}

export interface SuggestIndex {
  platform: string;
  vendor: string;
  /** La CLI acepta palabras abreviadas (Cisco, Huawei, Junos, FortiOS). */
  abbrev: boolean;
  /** Ordenado por `key`. */
  entries: SuggestEntry[];
  /** Los que no son consulta: lo tecleado no debe poder ser uno de ellos si se ofrece sugerencia. */
  risky: SuggestEntry[];
}

/**
 * Fabricantes cuya CLI resuelve palabras abreviadas por prefijo único. Las shells de
 * sistemas operativos, Check Point, WatchGuard y la shell de FortiAP quedan fuera: ahí `sh`
 * no es `show`. FortiSwitchOS y FortiExtender usan la CLI de FortiOS; los switches GWN de
 * Grandstream y Aruba (AOS-CX, ArubaOS-Switch, ArubaOS), una tipo Cisco. Ante la duda se
 * marcan: así lo abreviado no puede ser un comando riesgoso.
 */
export const ABBREV_VENDORS = new Set(["cisco", "huawei", "juniper", "fortinet", "fortiswitch", "fortiextender", "grandstream", "aruba"]);

/** {{variable}} de las plantillas o <marcador> de la documentación de los fabricantes. */
const PLACEHOLDER = /\{\{[^}]*\}\}|<[A-Za-z][\w .:/-]*>/;
const RANK: Record<Risk, number> = { read: 0, change: 1, disruptive: 2 };
/**
 * Filtros de salida que escriben a disco (Junos `| save`, IOS `| redirect`, `| append`,
 * `| tee`): computeRisk los deja como consulta, pero aquí cuentan como cambio.
 */
const PIPE_WRITE = /\|\s*(save|redirect|append|tee)\b/i;

/** Texto que se puede insertar de un comando: se corta en el primer marcador. */
export function insertablePart(cmd: string): { insert: string; placeholder: boolean } {
  const m = PLACEHOLDER.exec(cmd);
  return m ? { insert: cmd.slice(0, m.index), placeholder: true } : { insert: cmd, placeholder: false };
}

/** Construye el índice de una plataforma (null si ningún fabricante la declara). */
export function buildIndex(vendors: CatalogVendor[], platform: string): SuggestIndex | null {
  const vendor = vendors.find((v) => v.platforms.some((p) => p.id === platform));
  if (!vendor) return null;
  const seen = new Set<string>();
  const entries: SuggestEntry[] = [];
  vendor.commands.forEach((c, order) => {
    if (!appliesTo(c, platform)) return;
    const raw = commandFor(c, platform).trim();
    // Un comando de varias líneas exige Enter entre ellas: no se sugiere.
    if (!raw || CONTROL.test(raw)) return;
    const cmd = raw.replace(/\s+/g, " ");
    const key = cmd.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    const computed = PIPE_WRITE.test(cmd) && computeRisk(cmd) === "read" ? "change" : computeRisk(cmd);
    const risk = RANK[computed] > RANK[c.risk] ? computed : c.risk;
    const toks = key.split(" ");
    const starts: number[] = [];
    let at = 0;
    for (const t of toks) {
      starts.push(at);
      at += t.length + 1;
    }
        const part = insertablePart(cmd);
    const pipe = key.includes("|");
    const len = Math.min(part.placeholder ? part.insert.length : cmd.length, 0xfffff);
    const tie = toks.length * 0x200000 + len * 2 + (pipe ? 1 : 0);
    // Todas las entradas con la misma forma (mismos campos y orden): el recorrido por tecla
    // queda monomórfico en V8.
    entries.push({
      cmd,
      key,
      toks,
      starts,
      ph: toks.map((t) => PLACEHOLDER.exec(t)?.index ?? -1),
      insert: part.insert,
      placeholder: part.placeholder,
      risk,
      desc: c.desc,
      order,
      tpl: c.cmd,
      pos: 0,
      pipe,
      tie,
      rank: tie * 0x10000 + order,
    });
  });
  // El espacio es menor que cualquier carácter visible: ordenar por `key` ordena por palabras.
  entries.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : a.order - b.order));
  entries.forEach((e, i) => (e.pos = i));
  const risky = entries.filter((e) => e.risk !== "read");
  return { platform, vendor: vendor.id, abbrev: ABBREV_VENDORS.has(vendor.id), entries, risky };
}

const cache = new WeakMap<CatalogVendor[], Map<string, SuggestIndex | null>>();

/** Índice de la plataforma, construido la primera vez y guardado mientras el catálogo no cambie. */
export function getIndex(vendors: CatalogVendor[], platform: string): SuggestIndex | null {
  let byPlatform = cache.get(vendors);
  if (!byPlatform) cache.set(vendors, (byPlatform = new Map()));
  let idx = byPlatform.get(platform);
  if (idx === undefined) {
    idx = buildIndex(vendors, platform);
    byPlatform.set(platform, idx);
  }
  return idx;
}

// ---------- Búsqueda ----------

/** Lo tecleado, normalizado: sin espacios iniciales, en minúsculas y con espacios simples. */
export const queryOf = (buf: string) => buf.trimStart().toLowerCase().replace(/\s+/g, " ");

const tokAt = (e: SuggestEntry, d: number) => e.toks[d] ?? "";

/** Primera posición en [lo, hi) cuya palabra d es >= t. */
function lowerTok(entries: SuggestEntry[], lo: number, hi: number, d: number, t: string): number {
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (tokAt(entries[mid], d) < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Desde `lo` (palabra d >= t), primera posición cuya palabra d ya no empieza con t. */
function endPrefix(entries: SuggestEntry[], lo: number, hi: number, d: number, t: string): number {
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (tokAt(entries[mid], d).startsWith(t)) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Desde `lo` (palabra d === v), primera posición con otra palabra d. */
function endEqual(entries: SuggestEntry[], lo: number, hi: number, d: number, v: string): number {
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (tokAt(entries[mid], d) === v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Recorre los comandos donde cada palabra tecleada es prefijo de la palabra del comando
 * en la misma posición (o igual, si la CLI no abrevia). La última palabra puede estar a
 * medias. Cada rama cuesta O(log n) y solo se visitan las ramas que coinciden. Entrega
 * rangos [a, b) con su marca de prefijo exacto: texto gris y lista recorren cada rango con un
 * ciclo propio (con prefijos amplios como "show", cientos de comandos, una llamada por
 * comando costaba más que la comparación misma).
 */
function visitRanges(idx: SuggestIndex, toks: string[], cb: (a: number, b: number, exact: boolean) => void) {
  const { entries, abbrev } = idx;
  const m = toks.length - 1;
  const rec = (lo: number, hi: number, d: number, exact: boolean) => {
    const t = toks[d];
    let a = lo;
    let b = hi;
    if (t) {
      a = lowerTok(entries, lo, hi, d, t);
      b = endPrefix(entries, a, hi, d, t);
    }
    if (d === m) {
      if (a < b) cb(a, b, exact);
      return;
    }
    if (!abbrev) {
      // La palabra completa debe coincidir: va primero dentro del rango.
      if (a < b && tokAt(entries[a], d) === t) rec(a, endEqual(entries, a, b, d, t), d + 1, exact);
      return;
    }
    for (let j = a; j < b; ) {
      const v = tokAt(entries[j], d);
      const k = endEqual(entries, j, b, d, v);
      rec(j, k, d + 1, exact && v === t);
      j = k;
    }
  };
  rec(0, entries.length, 0, true);
}

/** Desde dónde completar `entry` según lo tecleado (posición en `cmd`). */
const offsetFor = (e: SuggestEntry, toks: string[]) => e.starts[toks.length - 1] + toks[toks.length - 1].length;

/** Lo tecleado no pasa más allá del primer marcador. */
const fits = (e: SuggestEntry, off: number) => !e.placeholder || off <= e.insert.length;

/** Pesos de uso por `pos` (historial y favoritos); sin pesos, todo vale 0. */
export type Weights = ArrayLike<number> | null | undefined;

/**
 * Prefijo exacto primero, luego más uso (historial y favoritos). Con igual uso, el comando que
 * termina lo tecleado con menos palabras y menos texto agregado (`sh int` → `show interfaces `
 * antes que `show interfaces transceiver detail`; con marcador cuenta hasta el marcador), luego
 * el que no tiene filtro `|` y al final el orden del catálogo. El desempate es un número
 * precalculado (`tie`): no agrega costo por tecla.
 */
function better(a: SuggestEntry, ax: boolean, b: SuggestEntry, bx: boolean, w: Weights): boolean {
  if (ax !== bx) return ax;
  if (w) {
    const wa = w[a.pos];
    const wb = w[b.pos];
    if (wa !== wb) return wa > wb;
  }
  return a.rank < b.rank || (a.rank === b.rank && a.cmd.length < b.cmd.length);
}

export interface LookupOptions {
  readOnly?: boolean;
  weights?: Weights;
}

/** Hasta `limit` comandos que coinciden con lo tecleado, del mejor al peor. */
export function lookup(idx: SuggestIndex, buf: string, limit: number, opts: LookupOptions | boolean = {}): SuggestEntry[] {
  const { readOnly = false, weights } = typeof opts === "boolean" ? { readOnly: opts } : opts;
  const toks = queryOf(buf).split(" ");
  const d = toks.length - 1;
  const lastLen = toks[d].length;
  const entries = idx.entries;
  const out: SuggestEntry[] = [];
  const ex: boolean[] = [];
  visitRanges(idx, toks, (a, b, exact) => {
    for (let i = a; i < b; i++) {
      const e = entries[i];
      if (e.toks.length <= d || (readOnly && e.risk !== "read")) continue;
      if (e.placeholder && e.starts[d] + lastLen > e.insert.length) continue;
      // Inserción ordenada en una lista corta (sin ordenar el rango completo).
      let j = out.length;
      if (j === limit && !better(e, exact, out[j - 1], ex[j - 1], weights)) continue;
      if (j === limit) out.pop(), ex.pop(), j--;
      while (j > 0 && better(e, exact, out[j - 1], ex[j - 1], weights)) j--;
      out.splice(j, 0, e);
      ex.splice(j, 0, exact);
    }
  });
  return out;
}

export interface Ghost {
  entry: SuggestEntry;
  /** Lo que se ve en color (resto del comando, con su marcador). */
  rest: string;
  /** Lo que inserta Flecha derecha ("" si ya se llegó al marcador). */
  insert: string;
}

/** Mínimo de caracteres tecleados para mostrar sugerencia. */
export const GHOST_MIN = 2;

/**
 * Sugerencia en línea: la mejor consulta que extiende lo tecleado. Lo que cambia
 * configuración o puede cortar servicio nunca se ofrece así.
 */
export function ghostFor(idx: SuggestIndex, buf: string, weights?: Weights): Ghost | null {
  const q = queryOf(buf);
  if (q.length < GHOST_MIN) return null;
  // Si lo tecleado, tal como está, ya puede ser un comando con riesgo, no se sugiere nada:
  // la sugerencia haría creer que Enter ejecuta la consulta.
  if (riskyAsTyped(idx, buf)) return null;
  const toks = q.split(" ");
  const d = toks.length - 1;
  const lastLen = toks[d].length;
  const entries = idx.entries;
  let best: SuggestEntry | null = null;
  let bestExact = false;
  // Mismo criterio que better(), en línea: prefijo exacto, uso y luego `rank`.
  let bestW = 0;
  let bestRank = Infinity;
  visitRanges(idx, toks, (a, b, exact) => {
    if (best && bestExact && !exact) return;
    for (let i = a; i < b; i++) {
      const e = entries[i];
      if (e.risk !== "read" || e.toks.length <= d) continue;
      const we = weights ? weights[e.pos] : 0;
      if (best && exact === bestExact && (we < bestW || (we === bestW && e.rank >= bestRank))) continue;
      const off = e.starts[d] + lastLen;
      if (off >= e.cmd.length || (e.placeholder && off > e.insert.length)) continue;
      best = e;
      bestExact = exact;
      bestW = we;
      bestRank = e.rank;
    }
  });
  if (!best) return null;
  const c = completionFor(best, buf)!;
  return { entry: best, rest: c.rest, insert: c.insert };
}

/**
 * Cómo completar `entry` desde lo tecleado, si coincide (prefijo o abreviatura). Solo se
 * agrega texto al final: las palabras abreviadas quedan como se escribieron.
 */
export function completionFor(entry: SuggestEntry, buf: string, abbrev = true): { rest: string; insert: string } | null {
  const toks = queryOf(buf).split(" ");
  const m = toks.length - 1;
  if (m >= entry.toks.length) return null;
  for (let i = 0; i <= m; i++) {
    const ok = i < m && !abbrev ? entry.toks[i] === toks[i] : entry.toks[i].startsWith(toks[i]);
    if (!ok) return null;
  }
  const off = offsetFor(entry, toks);
  if (!fits(entry, off)) return null;
  return { rest: entry.cmd.slice(off), insert: off < entry.insert.length ? safeInsert(entry.insert.slice(off)) : "" };
}

/** Texto que falta escribir para completar `entry` desde lo tecleado (nunca Enter). */
export function remainderToInsert(entry: SuggestEntry, buf: string): string {
  return completionFor(entry, buf)?.insert ?? "";
}

/** Siguiente palabra dla sugerencia (con el espacio que la sigue), para Ctrl/Alt+→. */
export function nextWord(insert: string): string {
  return /^\s*\S+\s?/.exec(insert)?.[0] ?? insert;
}

/** Tramos de un comando a resaltar en la lista: lo que coincide con lo tecleado. */
export function matchSpans(entry: SuggestEntry, buf: string): { text: string; hit: boolean }[] {
  const toks = queryOf(buf).split(" ");
  const out: { text: string; hit: boolean }[] = [];
  let at = 0;
  for (let i = 0; i < toks.length && i < entry.toks.length; i++) {
    const s = entry.starts[i];
    const n = entry.toks[i].startsWith(toks[i]) ? toks[i].length : 0;
    if (s > at) out.push({ text: entry.cmd.slice(at, s), hit: false });
    if (n) out.push({ text: entry.cmd.slice(s, s + n), hit: true });
    at = s + n;
  }
  if (at < entry.cmd.length) out.push({ text: entry.cmd.slice(at), hit: false });
  return out;
}

/**
 * Comando del catálogo que corresponde a una línea ejecutada completa, para el historial.
 * Cada marcador vale por una palabra cualquiera (el valor no se guarda: solo la plantilla).
 * Se llama solo al presionar Enter.
 */
export function matchExecuted(idx: SuggestIndex, buf: string): SuggestEntry | null {
  const toks = lineToks(buf);
  if (!toks) return null;
  let best: SuggestEntry | null = null;
  let bestScore = -1;
  for (const e of idx.entries) {
    const score = lineScore(e, toks, idx.abbrev);
    if (score > bestScore || (score >= 0 && score === bestScore && best && e.order < best.order)) (best = e), (bestScore = score);
  }
  return best;
}

/** Palabras de una línea completa (null si está vacía). */
const lineToks = (buf: string) => {
  const q = queryOf(buf).trimEnd();
  return q ? q.split(" ") : null;
};

/**
 * Qué tan bien una línea completa corresponde a `e` (-1 si no corresponde): cada palabra
 * igual vale 2 y cada abreviatura 1; un marcador acepta cualquier palabra (su valor no
 * se guarda ni se compara).
 */
function lineScore(e: SuggestEntry, toks: string[], abbrev: boolean): number {
  if (e.toks.length !== toks.length) return -1;
  // Se evalúa en cada tecla contra todos los comandos con riesgo: sin regex por palabra.
  const phs = e.ph;
  let score = 0;
  for (let i = 0; i < toks.length; i++) {
    const et = e.toks[i];
    const ph = phs[i];
    if (et === toks[i]) score += 2;
    else if (ph >= 0) {
      if (!(toks[i].length > ph && toks[i].startsWith(et.slice(0, ph)))) return -1;
    } else if (abbrev && et.startsWith(toks[i])) score += 1;
    else return -1;
  }
  return score;
}

/**
 * Lo tecleado, si se presionara Enter tal como está, podría ser un comando del catálogo que
 * no es consulta (escrito completo o abreviado, con o sin argumentos). Pocos comandos por
 * plataforma: cuesta menos que la búsqueda.
 */
export function riskyAsTyped(idx: SuggestIndex, buf: string): boolean {
  const toks = lineToks(buf);
  if (!toks) return false;
  for (const e of idx.risky) if (lineScore(e, toks, idx.abbrev) >= 0) return true;
  return false;
}

/** Última barrera: corta en el primer salto de línea y quita cualquier carácter de control. */
export function safeInsert(text: string): string {
  const cut = text.search(/[\r\n]/);
  return (cut >= 0 ? text.slice(0, cut) : text).replace(/[\x00-\x1f\x7f-\x9f]/g, "");
}

// ---------- Historial de uso (local y privado) ----------

/** Plataforma → plantilla del catálogo → [veces, día del último uso]. */
type UsageMap = Record<string, Record<string, [number, number]>>;

const MAX_PER_PLATFORM = 60;
const MAX_PLATFORMS = 40;
const MAX_TPL = 300;
/** Tope del historial guardado (JSON): con plantillas típicas de 30 a 60 caracteres sobra. */
export const MAX_USAGE_BYTES = 32 * 1024;
export const USAGE_KEY = "nt.suggestUsage.v1";
/** Objeto sin prototipo: una plataforma o plantilla "__proto__" no altera nada. */
const dict = <T>(): Record<string, T> => Object.create(null);
const today = () => Math.floor(Date.now() / 86_400_000);

/**
 * Memoria de uso: solo guarda plantillas del catálogo (por ejemplo
 * "show interfaces {{interfaz}} status"), nunca lo tecleado, argumentos, nombres de equipo
 * ni secretos. Con tope por plataforma; se borra desde Ajustes.
 */
export class SuggestUsage {
  private data: UsageMap = dict();
  /** Cambia en cada registro o borrado (invalida los pesos en caché). */
  version = 0;
  private cached = new WeakMap<SuggestIndex, { v: number; favs: unknown; w: Int32Array }>();

  constructor(raw?: string | null) {
    if (raw) this.load(raw);
  }

  /** Carga validando forma y contenido (un archivo alterado no inyecta nada raro). */
  load(raw: string) {
    this.data = dict();
    try {
      // Un valor más grande que el tope no lo escribió esta app: se descarta sin leerlo.
      if (raw.length > MAX_USAGE_BYTES * 2) throw new Error("historial demasiado grande");
      const parsed = JSON.parse(raw);
      const p = parsed?.v === 1 && parsed.p && typeof parsed.p === "object" ? parsed.p : null;
      for (const [plat, m] of Object.entries(p ?? {}).slice(0, MAX_PLATFORMS)) {
        if (!/^[\w.-]{1,40}$/.test(plat) || !m || typeof m !== "object") continue;
        const out = dict<[number, number]>();
        for (const [tpl, v] of Object.entries(m as Record<string, unknown>).slice(0, MAX_PER_PLATFORM)) {
          if (tpl.length > MAX_TPL || CONTROL.test(tpl) || !Array.isArray(v)) continue;
          const [n, d] = v;
          if (Number.isFinite(n) && Number.isFinite(d) && n > 0) out[tpl] = [Math.min(9999, Math.floor(n)), Math.floor(d)];
        }
        this.data[plat] = out;
      }
    } catch {
      this.data = dict();
    }
    this.trim();
    this.version++;
  }

  serialize(): string {
    return JSON.stringify({ v: 1, p: this.data });
  }

  /** Bajo el tope de bytes: salen las plantillas menos usadas (y, si empatan, las más antiguas). */
  private trim() {
    let size = this.serialize().length;
    while (size > MAX_USAGE_BYTES) {
      let worst: [string, string] | null = null;
      let w: [number, number] = [Infinity, Infinity];
      for (const [plat, m] of Object.entries(this.data))
        for (const [tpl, v] of Object.entries(m)) if (v[0] < w[0] || (v[0] === w[0] && v[1] < w[1])) (worst = [plat, tpl]), (w = v);
      if (!worst) break;
      const [plat, tpl] = worst;
      delete this.data[plat][tpl];
      // Lo liberado: "plantilla":[n,d] y su coma (o la plataforma entera si quedó vacía).
      size -= JSON.stringify(tpl).length + JSON.stringify(w).length + 2;
      if (!Object.keys(this.data[plat]).length) {
        delete this.data[plat];
        size -= JSON.stringify(plat).length + 3;
      }
    }
  }

  /** Registra el uso de un comando del catálogo (aceptado o ejecutado). */
  record(platform: string, entry: SuggestEntry, day = today()) {
    const tpl = entry.tpl;
    if (!tpl || tpl.length > MAX_TPL || CONTROL.test(tpl)) return;
    let m = this.data[platform];
    if (!m) {
      const plats = Object.keys(this.data);
      if (plats.length >= MAX_PLATFORMS) delete this.data[plats[0]];
      m = this.data[platform] = dict();
    }
    const prev = m[tpl];
    m[tpl] = [(prev?.[0] ?? 0) + 1, day];
    const keys = Object.keys(m);
    if (keys.length > MAX_PER_PLATFORM) {
      // Sale el menos usado (y, si empata, el más antiguo).
      let drop = keys[0];
      for (const k of keys) if (k !== tpl && (m[k][0] < m[drop][0] || (m[k][0] === m[drop][0] && m[k][1] < m[drop][1]))) drop = k;
      delete m[drop];
    }
    this.trim();
    this.version++;
  }

  clear() {
    this.data = dict();
    this.version++;
  }

  /** Veces que se usó una plantilla en la plataforma. */
  count(platform: string, tpl: string): number {
    return this.data[platform]?.[tpl]?.[0] ?? 0;
  }

  /**
   * Peso por comando del índice: uso (con tope), uso reciente y favoritos. Se calcula una
   * vez por cambio y queda en caché: buscar no cuesta más por tener historial.
   */
  weights(idx: SuggestIndex, favs: ReadonlySet<string>, day = today()): Int32Array {
    const c = this.cached.get(idx);
    if (c && c.v === this.version && c.favs === favs) return c.w;
    const w = new Int32Array(idx.entries.length);
    const m = this.data[idx.platform] ?? dict();
    for (const e of idx.entries) {
      const u = m[e.tpl];
      let s = favs.has(`${idx.vendor}:${e.tpl}`) ? 4 : 0;
      if (u) s += Math.min(u[0], 8) + (day - u[1] <= 7 ? 2 : 0);
      w[e.pos] = s;
    }
    this.cached.set(idx, { v: this.version, favs, w });
    return w;
  }
}

/** Historial compartido por todas las pestañas (en localStorage; sin él, solo en memoria). */
let shared: SuggestUsage | null = null;
let saveTimer: ReturnType<typeof setTimeout> | undefined;

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function usageStore(): SuggestUsage {
  if (!shared) {
    let raw: string | null = null;
    try {
      raw = storage()?.getItem(USAGE_KEY) ?? null;
    } catch {
      /* sin almacenamiento: queda en memoria */
    }
    shared = new SuggestUsage(raw);
  }
  return shared;
}

/** Guarda el historial con un pequeño retardo (varios usos seguidos, una escritura). */
export function saveUsageSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      storage()?.setItem(USAGE_KEY, usageStore().serialize());
    } catch {
      /* sin almacenamiento */
    }
  }, 1000);
}

/** "Borrar historial de sugerencias". */
export function clearUsage() {
  usageStore().clear();
  // La ayuda "Tab o → acepta" vuelve a mostrarse sus primeras veces.
  tipStore().clear();
  clearTimeout(tipTimer);
  clearTimeout(saveTimer);
  try {
    storage()?.removeItem(USAGE_KEY);
    storage()?.removeItem(TIP_KEY);
  } catch {
    /* sin almacenamiento */
  }
}

// ---------- Dónde se sigue lo tecleado ----------

/** Solo sesiones remotas (SSH, Telnet, Serial, TCP) con el ajuste activo: nunca la terminal local ni SCP. */
export const suggestAllowed = (enabled: boolean, s: { type: string; scp?: unknown }) => enabled && s.type !== "local" && !s.scp;

// ---------- Ajuste: migración desde la beta ----------

/** Encendidas por defecto: las pruebas de seguridad (scripts/tests/suggest.test.mjs) pasan. */
export const SUGGEST_DEFAULT = true;

/**
 * Valor del ajuste al cargar. Si el usuario eligió en la versión actual, se respeta. De la
 * beta (apagada por defecto) solo `true` es una elección explícita segura; `false` puede ser
 * el valor por defecto guardado sin tocarlo, así que pasa al nuevo valor por defecto.
 */
export function migrateSuggest(stored: Record<string, unknown> | null | undefined): { commandSuggest: boolean; commandSuggestSet: boolean } {
  if (stored?.commandSuggestSet === true && typeof stored.commandSuggest === "boolean") {
    return { commandSuggest: stored.commandSuggest, commandSuggestSet: true };
  }
  if (stored?.commandSuggest === true) return { commandSuggest: true, commandSuggestSet: true };
  return { commandSuggest: SUGGEST_DEFAULT, commandSuggestSet: false };
}

// ---------- Teclado ----------

export interface KeyLike {
  key: string;
  code?: string;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  isComposing?: boolean;
}

/** Tecla para abrir la lista. Ctrl+Espacio choca con el cambio de fuente de entrada de macOS. */
export type ListKey = "ctrl+period" | "alt+slash" | "ctrl+space";

export const LIST_KEYS: Record<ListKey, string> = {
  "ctrl+period": "Ctrl+.",
  "alt+slash": "Alt+/",
  "ctrl+space": "Ctrl+Espacio",
};

/** La tecla de lista configurada (por código físico, así funciona en teclados latinoamericanos). */
export function isListKey(e: KeyLike, k: ListKey): boolean {
  if (e.metaKey || e.shiftKey) return false;
  switch (k) {
    case "ctrl+period":
      return e.ctrlKey && !e.altKey && (e.key === "." || e.code === "Period");
    case "alt+slash":
      return e.altKey && !e.ctrlKey && (e.key === "/" || e.code === "Slash");
    case "ctrl+space":
      return e.ctrlKey && !e.altKey && (e.key === " " || e.code === "Space");
  }
}

/** Un segundo Tab antes de este plazo (ms) tras uno que aceptó va al equipo (autocompletado nativo). */
export const TAB_CHAIN_MS = 400;

/** El Tab anterior aceptó la sugerencia hace menos de TAB_CHAIN_MS. */
export const tabChained = (lastTabAccept: number, now: number) => lastTabAccept > 0 && now - lastTabAccept >= 0 && now - lastTabAccept < TAB_CHAIN_MS;

/**
 * Qué hace una tecla con las sugerencias activas:
 * pass (va al equipo), accept (inserta la sugerencia), word (inserta la siguiente palabra),
 * dismiss (Esc: oculta la sugerencia de esta línea), open (abre la lista), up/down (mueve
 * la selección), pick (inserta el elegido), close.
 */
export type KeyAction = "pass" | "accept" | "word" | "dismiss" | "open" | "up" | "down" | "pick" | "close";

export interface KeyContext {
  enabled: boolean;
  listOpen: boolean;
  /** Hay una sugerencia visible con texto para insertar, y es la que el usuario está viendo. */
  canAccept: boolean;
  /** Hay una sugerencia visible (aunque ya no inserte nada, como en un marcador). */
  ghostVisible?: boolean;
  /** Ajuste "Tab acepta la sugerencia". */
  tabAccept?: boolean;
  /** El Tab anterior aceptó hace menos de TAB_CHAIN_MS: este va al equipo. */
  tabChain?: boolean;
  listKey?: ListKey;
}

export function suggestKey(e: KeyLike, ctx: KeyContext): KeyAction {
  if (!ctx.enabled || e.isComposing) return "pass";
  // Enter nunca lo toma una sugerencia, salvo para elegir de la lista (que tampoco lo envía).
  const plain = !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey;
  if (ctx.listOpen) {
    if (plain && e.key === "ArrowUp") return "up";
    if (plain && e.key === "ArrowDown") return "down";
    if (plain && e.key === "Enter") return "pick";
    if (e.key === "Escape") return "close";
    // Tab y cualquier otra tecla van al equipo (y cierran la lista).
    return "pass";
  }
  // Tab acepta solo lo que se ve; sin sugerencia visible (o con el ajuste apagado, o justo
  // después de un Tab que aceptó) va al equipo y se conserva su autocompletado.
  if (e.key === "Tab") return plain && ctx.tabAccept && ctx.canAccept && !ctx.tabChain ? "accept" : "pass";
  // Esc descarta la sugerencia visible; sin sugerencia llega al equipo.
  if (e.key === "Escape") return plain && (ctx.ghostVisible ?? ctx.canAccept) ? "dismiss" : "pass";
  if (isListKey(e, ctx.listKey ?? "ctrl+period")) return "open";
  if (e.key === "ArrowRight" && ctx.canAccept) {
    if (plain) return "accept";
    // Ctrl+→ (Windows/Linux) u Option+→ (macOS): solo la siguiente palabra.
    if (!e.metaKey && !e.shiftKey && e.ctrlKey !== e.altKey) return "word";
  }
  return "pass";
}

// ---------- Color de la sugerencia ----------

/** "#rgb", "#rrggbb" o "rgb(r, g, b)" a [r, g, b] (null si no se reconoce). */
function parseColor(c: string | undefined): [number, number, number] | null {
  if (!c) return null;
  let m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c.trim());
  if (m) {
    const h = m[1].length === 3 ? [...m[1]].map((x) => x + x).join("") : m[1];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }
  m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(c.trim());
  return m ? [+m[1], +m[2], +m[3]] : null;
}

const lin = (v: number) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);

/** Luminancia relativa (WCAG 2.x). */
function luminance([r, g, b]: number[]): number {
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function ratioOf(a: number[], b: number[]): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (l1 + 0.05) / (l2 + 0.05);
}

/** Contraste WCAG entre dos colores (0 si alguno no se reconoce). */
export function contrastRatio(a: string, b: string): number {
  const x = parseColor(a);
  const y = parseColor(b);
  return x && y ? ratioOf(x, y) : 0;
}

/** sRGB a CIELAB (D65). */
function lab([r, g, b]: number[]): [number, number, number] {
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const x = f((0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047);
  const y = f(0.2126 * R + 0.7152 * G + 0.0722 * B);
  const z = f((0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

/** Diferencia de color percibida (CIE76, ΔE*ab): sobre 30 se distinguen a simple vista sin compararlos lado a lado. */
export function colorDistance(a: string, b: string): number {
  const x = parseColor(a);
  const y = parseColor(b);
  if (!x || !y) return 0;
  const [p, q] = [lab(x), lab(y)];
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

/** Croma (C*ab): bajo 25 el color se lee como gris. */
export function chroma(c: string): number {
  const x = parseColor(c);
  if (!x) return 0;
  const [, a, b] = lab(x);
  return Math.hypot(a, b);
}

/** Diferencia de tono (h*ab, en grados, 0 a 180). */
export function hueDifference(a: string, b: string): number {
  const x = parseColor(a);
  const y = parseColor(b);
  if (!x || !y) return 0;
  const [, a1, b1] = lab(x);
  const [, a2, b2] = lab(y);
  const d = Math.abs(Math.atan2(b1, a1) - Math.atan2(b2, a2)) * (180 / Math.PI);
  return d > 180 ? 360 - d : d;
}

/**
 * La sugerencia se distingue de otro color (texto o cursor): ΔE de al menos 30 y, si el otro
 * tiene color propio (temas monocromo como Ámbar o Fósforo), otro tono (40° o más).
 */
export function distinctFrom(c: string, other: string | undefined): boolean {
  if (!parseColor(other)) return true;
  if (colorDistance(c, other!) < GHOST_DISTANCE) return false;
  return chroma(other!) < GHOST_CHROMA || hueDifference(c, other!) >= GHOST_HUE;
}

/** Contraste mínimo de la sugerencia con el fondo (WCAG 1.4.11, componentes no textuales). */
export const GHOST_CONTRAST = 3;
/** Croma mínimo: la sugerencia nunca es gris. */
export const GHOST_CHROMA = 25;
/** Distancia mínima (ΔE) con el texto normal y con el cursor. */
export const GHOST_DISTANCE = 30;
/** Diferencia mínima de tono con un texto o cursor de color (grados). */
export const GHOST_HUE = 40;

/** Color de la sugerencia: automático o un tono fijo (que se ajusta a cada tema). */
export type GhostColor = "auto" | "cyan" | "amber" | "magenta" | "blue";
export const GHOST_COLORS: Record<GhostColor, string> = {
  auto: "Automático",
  cyan: "Cian",
  amber: "Ámbar",
  magenta: "Magenta",
  blue: "Azul",
};
/** Estilo extra de la sugerencia. */
export type GhostStyle = "none" | "italic" | "underline";
export const GHOST_STYLES: Record<GhostStyle, string> = {
  none: "Solo color",
  italic: "Cursiva",
  underline: "Subrayado punteado",
};

/** Colores del tema de terminal que usa la sugerencia (subconjunto de ITheme de xterm). */
export interface GhostTheme {
  background?: string;
  foreground?: string;
  cursor?: string;
  cyan?: string;
  brightCyan?: string;
  yellow?: string;
  brightYellow?: string;
  magenta?: string;
  brightMagenta?: string;
  blue?: string;
  brightBlue?: string;
}

type Tone = Exclude<GhostColor, "auto">;
/** Colores ANSI del tema para cada tono (primero el normal, luego el brillante). */
const SLOTS: Record<Tone, (keyof GhostTheme)[]> = {
  cyan: ["cyan", "brightCyan"],
  amber: ["yellow", "brightYellow"],
  magenta: ["magenta", "brightMagenta"],
  blue: ["blue", "brightBlue"],
};
/** Tono (HSL) de respaldo cuando el tema no trae uno que sirva. */
const HUE: Record<Tone, number> = { cyan: 188, amber: 38, magenta: 315, blue: 215 };
/** Orden de preferencia en automático: cian se confunde menos con el texto y con los avisos. */
const AUTO_ORDER: Tone[] = ["cyan", "blue", "magenta", "amber"];

const hex = (c: number[]) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;

function hsl(h: number, s: number, l: number): number[] {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  return [0, 8, 4].map((n) => 255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))));
}

/**
 * Un tono con la luminosidad justa para llegar a 3:1 con el fondo (más claro en fondos
 * oscuros, más oscuro en fondos claros). null si ni el extremo alcanza.
 */
function synth(tone: Tone, bg: number[]): string | null {
  const dark = luminance(bg) < 0.18;
  for (let i = 0; i <= 24; i++) {
    const l = dark ? 0.55 + i * 0.015 : 0.42 - i * 0.012;
    const c = hsl(HUE[tone], 0.8, l);
    if (ratioOf(c, bg) >= GHOST_CONTRAST + 0.2) return hex(c);
  }
  return null;
}

/** El color sirve para la sugerencia: contraste con el fondo y no es gris. */
const legible = (c: string, bg: string) => contrastRatio(c, bg) >= GHOST_CONTRAST && chroma(c) >= GHOST_CHROMA;

/** Además se distingue del texto normal y del cursor. */
const distinct = (c: string, t: GhostTheme) => distinctFrom(c, t.foreground) && distinctFrom(c, t.cursor);

/** Candidatos de un tono: los del tema (normal y brillante) y el de respaldo. */
function candidates(tone: Tone, t: GhostTheme, bg: number[]): string[] {
  const out: string[] = [];
  for (const k of SLOTS[tone]) if (parseColor(t[k])) out.push(t[k]!);
  const s = synth(tone, bg);
  if (s) out.push(s);
  return out;
}

const colorCache = new WeakMap<GhostTheme, Map<string, string | null>>();

/**
 * Color de la sugerencia para un tema. Automático: el primer color del tema (cian, azul,
 * magenta, ámbar) con al menos 3:1 con el fondo, que no sea gris y que se distinga del texto
 * y del cursor (ΔE y tono); si ninguno del tema sirve, el mismo tono ajustado al fondo. Un
 * tono elegido usa el del tema o el ajustado, prefiriendo el que se distingue del texto y del
 * cursor; si ninguno se distingue, el primero legible. null si el fondo no se reconoce (la
 * terminal usa entonces el color de acento con opacidad fija).
 */
export function ghostColor(theme: GhostTheme | undefined, choice: GhostColor | string = "auto"): string | null {
  const bg = parseColor(theme?.background);
  if (!theme || !bg || !parseColor(theme.foreground)) return null;
  let byChoice = colorCache.get(theme);
  if (!byChoice) colorCache.set(theme, (byChoice = new Map()));
  const hit = byChoice.get(choice);
  if (hit !== undefined) return hit;
  const tones: Tone[] = choice in SLOTS ? [choice as Tone] : AUTO_ORDER;
  const all = tones.flatMap((tone) => candidates(tone, theme, bg)).filter((c) => legible(c, theme.background!));
  // Un tono elegido a mano se respeta aunque se parezca al texto (por ejemplo, ámbar en el tema Ámbar).
  const color = all.find((c) => distinct(c, theme)) ?? all[0] ?? null;
  byChoice.set(choice, color);
  return color;
}

// ---------- Ayuda junto a la sugerencia ----------

/** Veces (líneas) que se muestra la ayuda "Tab o → acepta · Esc descarta" por plataforma. */
export const TIP_TIMES = 5;
export const TIP_KEY = "nt.suggestTips.v1";

/** Texto de la ayuda según si Tab acepta. */
export const tipText = (tabAccepts: boolean) => (tabAccepts ? "Tab o → acepta · Esc descarta" : "→ acepta · Esc descarta");

/**
 * Cuenta en cuántas líneas se mostró la ayuda, por plataforma: cada línea (entre Enter y
 * Enter) cuenta una vez, y tras TIP_TIMES líneas deja de mostrarse. Solo guarda números.
 */
export class TipCounter {
  private seen: Record<string, number> = dict();
  private line = "";
  private readonly times: number;
  constructor(raw?: string | null, times = TIP_TIMES) {
    this.times = times;
    try {
      const p = raw ? JSON.parse(raw) : null;
      if (p && typeof p === "object" && !Array.isArray(p))
        for (const [k, v] of Object.entries(p).slice(0, MAX_PLATFORMS))
          if (/^[\w.-]{1,40}$/.test(k) && Number.isFinite(v)) this.seen[k] = Math.max(0, Math.min(times, Math.floor(v as number)));
    } catch {
      /* valor dañado: se parte de cero */
    }
  }

  /** Se puede mostrar la ayuda en esta línea; la primera vez en una línea nueva la cuenta. */
  allow(platform: string, line: string): boolean {
    const key = `${platform}\u0000${line}`;
    if (key === this.line) return true;
    const n = this.seen[platform] ?? 0;
    if (n >= this.times) return false;
    this.seen[platform] = n + 1;
    this.line = key;
    return true;
  }

  /** Veces que ya se mostró en la plataforma. */
  count(platform: string): number {
    return this.seen[platform] ?? 0;
  }

  serialize(): string {
    return JSON.stringify(this.seen);
  }

  clear() {
    this.seen = dict();
    this.line = "";
  }
}

let tips: TipCounter | null = null;
let tipTimer: ReturnType<typeof setTimeout> | undefined;

/** Contador compartido por todas las pestañas (en localStorage; sin él, solo en memoria). */
export function tipStore(): TipCounter {
  if (!tips) {
    let raw: string | null = null;
    try {
      raw = storage()?.getItem(TIP_KEY) ?? null;
    } catch {
      /* sin almacenamiento */
    }
    tips = new TipCounter(raw);
  }
  return tips;
}

export function saveTipsSoon() {
  clearTimeout(tipTimer);
  tipTimer = setTimeout(() => {
    try {
      storage()?.setItem(TIP_KEY, tipStore().serialize());
    } catch {
      /* sin almacenamiento */
    }
  }, 1000);
}
