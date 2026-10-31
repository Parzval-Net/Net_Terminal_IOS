/**
 * Lectura del diagrama ya armado, sin enviar comandos: revisiones sobre enlaces (dúplex, velocidad,
 * VLAN nativa, miembros de agregados, errores, asimetrías), rol y fabricante de cada equipo, filtros,
 * búsqueda, puertos activos sin vecino y reglas de alcance del descubrimiento.
 */
import { LEVEL_RANK, type LinkLevel, type TrafficLevel, dirLevel, trafficLevel } from "./topoTraffic";
import {
  type LinkTraffic,
  type MacPort,
  type Neighbor,
  type PortInfo,
  type TopoLink,
  type TopoNode,
  type Topology,
  canonPort,
  isIpv4,
  isPhysicalProto,
  knownAddrs,
  linkKey,
  nodeId,
  portOf,
} from "./topology";

// ---------- Revisiones sobre enlaces ----------

export type IssueKind = "duplex" | "speed" | "native" | "mode" | "lag" | "errors" | "down" | "asym";
export type IssueSev = "warn" | "crit";

export interface LinkIssue {
  kind: IssueKind;
  sev: IssueSev;
  /** Frase completa, con el equipo y el puerto de cada extremo. */
  text: string;
  /** Frase corta para la ficha y la lista de atención ("12 errores CRC en Gi1/0/48"). */
  short: string;
  /** Extremo afectado: "a" o "b" (un puerto) o "both" (algo que difiere entre ambos). */
  end: "a" | "b" | "both";
}

export const ISSUE_LABEL: Record<IssueKind, string> = {
  duplex: "Dúplex",
  speed: "Velocidad",
  native: "VLAN nativa",
  mode: "Modo de puerto",
  lag: "Agregado",
  errors: "Errores",
  down: "Puerto caído",
  asym: "Asimetría",
};

/** Dúplex normalizado: "a-full", "Full", "full-duplex" -> full. */
export function normDuplex(s: string | undefined): "full" | "half" | undefined {
  if (!s) return undefined;
  if (/half/i.test(s)) return "half";
  if (/full/i.test(s)) return "full";
  return undefined;
}

/** Velocidad en Mb/s: "a-1000", "1000", "10G", "a-10G", "100M"; "auto" o vacío -> undefined. */
export function speedMbps(s: string | undefined): number | undefined {
  const m = s?.trim().replace(/^a-/i, "").match(/^(\d+(?:\.\d+)?)\s*([GMK])?(?:b(?:ps|\/s)?)?$/i);
  if (!m) return undefined;
  const v = Number(m[1]);
  const unit = (m[2] ?? "M").toUpperCase();
  return unit === "G" ? v * 1000 : unit === "K" ? v / 1000 : v;
}

/** Velocidad corta: 1e9 -> "1G", 2.5e9 -> "2.5G", 100e6 -> "100M". */
export function speedShort(bps: number): string {
  if (bps >= 1e9) return `${+(bps / 1e9).toFixed(1)}G`;
  if (bps >= 1e6) return `${+(bps / 1e6).toFixed(1)}M`;
  return `${Math.round(bps / 1e3)}k`;
}

/** Miembro fuera del agregado: Cisco D (down), s (suspendido), I (individual), r (módulo fuera); Huawei Down o Unselect. */
const LAG_OUT = /^(?:D|s|I|r)$/;
const LAG_OUT_HUAWEI = /^(?:down|unselect(?:ed)?)$/i;
export const lagOut = (flag: string | undefined) => !!flag && (LAG_OUT.test(flag) || LAG_OUT_HUAWEI.test(flag));

/** Estado de interfaz caída: notconnect, disabled, down/down, *down (admin). err-disabled va aparte. */
const DOWN = /^(?:notconnect|disabled|\*?down|admin(?:istratively)?[ -]?down|lowerlayerdown)/i;
const ERRDIS = /^err-?disabled/i;

/** Puerto caído según su estado: "err-disabled" (cuenta como caído), "down" o undefined. */
export const portDown = (status: string | undefined): "err-disabled" | "down" | undefined =>
  status && ERRDIS.test(status) ? "err-disabled" : status && DOWN.test(status) ? "down" : undefined;

const num = (s: string | undefined) => (s && /^\d+$/.test(s) ? Number(s) : 0);

/** Estado de interfaz leído en vivo (show interfaces de la lectura de tráfico): por equipo y puerto (canonPort). */
export type LivePorts = Map<string, Map<string, PortInfo>>;

/** Puerto guardado más lo leído en vivo (lo más reciente manda). */
function portWithLive(n: TopoNode, port: string, live: LivePorts | undefined): PortInfo | undefined {
  if (!port) return undefined;
  const p = portOf(n, port);
  const q = live?.get(n.id)?.get(canonPort(port));
  return p && q ? { ...p, ...q } : (q ?? p);
}

/**
 * Revisiones por enlace (clave linkKey). Usa solo lo leído: estado de puertos de cada extremo y lo
 * que anunció el vecino por CDP/LLDP, más (si se pasa `live`) lo que informó "show interfaces" en la
 * lectura de tráfico por consola. Sin datos de un lado, esa revisión no se informa.
 */
export function linkChecks(t: Topology, live?: LivePorts): Map<string, LinkIssue[]> {
  const byId = new Map(t.nodes.map((n) => [n.id, n]));
  const res = new Map<string, LinkIssue[]>();
  for (const l of t.links) {
    if (!isPhysicalProto(l.proto) && l.proto !== "manual") continue;
    const a = byId.get(l.a);
    const b = byId.get(l.b);
    if (!a || !b) continue;
    const pa = portWithLive(a, l.aPort, live);
    const pb = portWithLive(b, l.bPort, live);
    const issues: LinkIssue[] = [];
    const end = (n: TopoNode, port: string) => `${n.name} ${port}`;
    const da = normDuplex(pa?.duplex);
    const db = normDuplex(pb?.duplex);
    if (da && db && da !== db)
      issues.push({ kind: "duplex", sev: "crit", end: "both", text: `Dúplex distinto: ${end(a, l.aPort)} ${da}, ${end(b, l.bPort)} ${db}`, short: `Dúplex distinto: ${da}/${db}` });
    else if (da === "half" || db === "half") {
      const half = da === "half" ? "a" : "b";
      issues.push({ kind: "duplex", sev: "warn", end: half, text: `Half dúplex en ${half === "a" ? end(a, l.aPort) : end(b, l.bPort)}`, short: `Half dúplex en ${half === "a" ? l.aPort : l.bPort}` });
    }
    const sa = speedMbps(pa?.speed);
    const sb = speedMbps(pb?.speed);
    if (sa && sb && sa !== sb)
      issues.push({
        kind: "speed",
        sev: "warn",
        end: "both",
        text: `Velocidad distinta: ${end(a, l.aPort)} ${pa!.speed}, ${end(b, l.bPort)} ${pb!.speed}`,
        short: `Velocidad distinta: ${pa!.speed}/${pb!.speed}`,
      });
    if (pa?.native && pb?.native && pa.native !== pb.native)
      issues.push({
        kind: "native",
        sev: "warn",
        end: "both",
        text: `VLAN nativa distinta: ${end(a, l.aPort)} ${pa.native}, ${end(b, l.bPort)} ${pb.native}`,
        short: `VLAN nativa distinta: ${pa.native}/${pb.native}`,
      });
    const trunkA = pa?.vlan === "trunk";
    const trunkB = pb?.vlan === "trunk";
    if (pa?.vlan && pb?.vlan && trunkA !== trunkB && (/^\d+$/.test(pa.vlan) || /^\d+$/.test(pb.vlan)))
      issues.push({
        kind: "mode",
        sev: "warn",
        end: "both",
        text: `Un extremo es trunk y el otro access: ${end(a, l.aPort)} ${pa.vlan}, ${end(b, l.bPort)} ${pb.vlan}`,
        short: "Trunk contra access",
      });
    for (const [n, port, p, side] of [
      [a, l.aPort, pa, "a"],
      [b, l.bPort, pb, "b"],
    ] as [TopoNode, string, PortInfo | undefined, "a" | "b"][]) {
      if (!p) continue;
      if (lagOut(p.lag))
        issues.push({ kind: "lag", sev: "crit", end: side, text: `${end(n, port)} fuera de ${p.group ?? "su agregado"} (${p.lag})`, short: `${port} fuera de ${p.group ?? "su agregado"}` });
      const down = portDown(p.status);
      if (down === "err-disabled") issues.push({ kind: "down", sev: "crit", end: side, text: `${end(n, port)} en err-disabled`, short: `${port} err-disabled` });
      else if (down) issues.push({ kind: "down", sev: "warn", end: side, text: `${end(n, port)} caído (${p.status}); el vecino puede venir de la caché de CDP/LLDP`, short: `${port} down` });
      const crc = num(p.crc);
      const inErr = num(p.inErr);
      if (crc)
        issues.push({ kind: "errors", sev: "warn", end: side, text: `${end(n, port)}: ${crc.toLocaleString("es-CL")} errores CRC/FCS acumulados`, short: `${crc.toLocaleString("es-CL")} errores CRC en ${port}` });
      else if (inErr)
        issues.push({ kind: "errors", sev: "warn", end: side, text: `${end(n, port)}: ${inErr.toLocaleString("es-CL")} errores de entrada acumulados`, short: `${inErr.toLocaleString("es-CL")} errores de entrada en ${port}` });
    }
    // Asimetría: ambos explorados por CDP/LLDP y solo uno informa el enlace.
    if (isPhysicalProto(l.proto) && a.explored && b.explored && l.seenBy?.length === 1) {
      const [who, other] = l.seenBy[0] === a.id ? [a, b] : [b, a];
      issues.push({
        kind: "asym",
        sev: "warn",
        end: other === a ? "a" : "b",
        text: `${who.name} ve a ${other.name}, pero ${other.name} no informa a ${who.name} (CDP/LLDP apagado en un puerto o solo recepción)`,
        short: `${other.name} no informa el enlace`,
      });
    }
    if (issues.length) res.set(linkKey(l), issues);
  }
  return res;
}

export const worstSev = (issues: LinkIssue[] | undefined): IssueSev | undefined =>
  !issues?.length ? undefined : issues.some((i) => i.sev === "crit") ? "crit" : "warn";

/** Estado del enlace en el mapa: caído (algún extremo down o err-disabled) o el de su carga. */
export function linkLevelOf(issues: LinkIssue[] | undefined, lt: LinkTraffic | undefined): LinkLevel {
  return issues?.some((i) => i.kind === "down") ? "down" : trafficLevel(lt?.util);
}

/** Extremos con un problema que se marca con "!" en el mapa (el caído ya se ve en el trazo y la píldora). */
export function markEnds(issues: LinkIssue[] | undefined): { a: boolean; b: boolean } {
  const m = { a: false, b: false };
  for (const i of issues ?? []) {
    if (i.kind === "down") continue;
    if (i.end === "a" || i.end === "both") m.a = true;
    if (i.end === "b" || i.end === "both") m.b = true;
  }
  return m;
}

/** Cuántos enlaces físicos tienen datos de puertos para revisarse (y cuántos en ambos extremos). */
export function checkCoverage(t: Topology, live?: LivePorts): { links: number; withData: number; both: number } {
  const byId = new Map(t.nodes.map((n) => [n.id, n]));
  let links = 0;
  let withData = 0;
  let both = 0;
  for (const l of t.links) {
    if (!isPhysicalProto(l.proto) && l.proto !== "manual") continue;
    const a = byId.get(l.a);
    const b = byId.get(l.b);
    if (!a || !b) continue;
    links++;
    const pa = portWithLive(a, l.aPort, live);
    const pb = portWithLive(b, l.bPort, live);
    if (pa || pb) withData++;
    if (pa && pb) both++;
  }
  return { links, withData, both };
}

/** "hace 8 s", "hace 3 min", "hace 2 h". */
export function ageText(ts: number, now: number): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  return s < 60 ? `hace ${s} s` : s < 3600 ? `hace ${Math.round(s / 60)} min` : `hace ${Math.round(s / 3600)} h`;
}

// ---------- Ficha de un enlace y lista de atención ----------

export interface LinkDetail {
  key: string;
  aName: string;
  bName: string;
  aPort: string;
  bPort: string;
  proto: string;
  level: LinkLevel;
  /** Port-channel (o Eth-Trunk, ae) y sus miembros entre el mismo par, si el enlace es uno de varios. */
  group?: string;
  members: { aPort: string; bPort: string; lag?: string }[];
  /** "puerto · velocidad · estado": una línea si ambos extremos coinciden, dos si difieren. */
  ends: { name?: string; text: string }[];
  /** Sentido A→B ("Baja") y B→A ("Sube") con su tasa, % de uso y estado. Vacío sin lectura de tráfico. */
  dirs: { label: "Baja" | "Sube"; from: string; to: string; bps: number | null; util?: number; level: TrafficLevel }[];
  speed?: number;
  approx?: boolean;
  findings: { sev: IssueSev; text: string }[];
  /** Hay datos de interfaz de al menos un extremo (si no, "Sin errores" sería engañoso). */
  hasPortData: boolean;
  source?: "SNMP" | "Consola";
  ts?: number;
  state?: "removed" | "added";
  logical?: boolean;
}

/**
 * Datos de la ficha que se muestra al pasar el mouse o enfocar un enlace. Función pura: el mapa solo
 * la llama para el enlace bajo el puntero.
 */
export function linkDetail(
  t: Topology,
  l: TopoLink,
  o: { lt?: LinkTraffic; issues?: LinkIssue[]; live?: LivePorts; state?: "removed" | "added" | null; byId?: Map<string, TopoNode> } = {},
): LinkDetail {
  const byId = o.byId ?? new Map(t.nodes.map((n) => [n.id, n]));
  const a = byId.get(l.a);
  const b = byId.get(l.b);
  const aName = a?.name ?? l.a;
  const bName = b?.name ?? l.b;
  const pa = a ? portWithLive(a, l.aPort, o.live) : undefined;
  const pb = b ? portWithLive(b, l.bPort, o.live) : undefined;
  const lt = o.lt;
  const speedOf = (p: PortInfo | undefined) => {
    const m = speedMbps(p?.speed);
    return m ? speedShort(m * 1e6) : lt?.speed ? speedShort(lt.speed) : "";
  };
  const info = (p: PortInfo | undefined) => [speedOf(p), p?.status].filter(Boolean).join(" · ");
  const ia = info(pa);
  const ib = info(pb);
  const ends =
    ia === ib
      ? [{ text: [`${l.aPort || "?"} ↔ ${l.bPort || "?"}`, ia].filter(Boolean).join(" · ") }]
      : [
          { name: aName, text: [l.aPort || "?", ia].filter(Boolean).join(" · ") },
          { name: bName, text: [l.bPort || "?", ib].filter(Boolean).join(" · ") },
        ];
  const group = pa?.group ?? pb?.group;
  const members: LinkDetail["members"] = [];
  if (group) {
    for (const m of t.links) {
      if (!((m.a === l.a && m.b === l.b) || (m.a === l.b && m.b === l.a))) continue;
      const fwd = m.a === l.a;
      const ma = a && portWithLive(a, fwd ? m.aPort : m.bPort, o.live);
      const mb = b && portWithLive(b, fwd ? m.bPort : m.aPort, o.live);
      if ((ma?.group ?? mb?.group) !== group) continue;
      members.push({ aPort: fwd ? m.aPort : m.bPort, bPort: fwd ? m.bPort : m.aPort, lag: ma?.lag ?? mb?.lag });
    }
  }
  const dirs: LinkDetail["dirs"] = lt
    ? [
        { label: "Baja", from: aName, to: bName, bps: lt.ab, util: lt.speed && lt.ab != null ? lt.ab / lt.speed : undefined, level: dirLevel(lt.ab, lt.speed) },
        { label: "Sube", from: bName, to: aName, bps: lt.ba, util: lt.speed && lt.ba != null ? lt.ba / lt.speed : undefined, level: dirLevel(lt.ba, lt.speed) },
      ]
    : [];
  return {
    key: linkKey(l),
    aName,
    bName,
    aPort: l.aPort,
    bPort: l.bPort,
    proto: l.logical ? `${l.proto} lógica` : l.proto,
    level: linkLevelOf(o.issues, lt),
    ...(group && members.length > 1 ? { group } : {}),
    members: group && members.length > 1 ? members : [],
    ends,
    dirs,
    ...(lt?.speed ? { speed: lt.speed } : {}),
    ...(lt?.approx ? { approx: true } : {}),
    findings: (o.issues ?? []).map((i) => ({ sev: i.sev, text: i.short })),
    hasPortData: !!(pa || pb),
    ...(lt?.src ? { source: lt.src === "snmp" ? ("SNMP" as const) : ("Consola" as const) } : {}),
    ...(lt?.ts ? { ts: lt.ts } : {}),
    ...(o.state ? { state: o.state } : {}),
    ...(l.logical ? { logical: true } : {}),
  };
}

/** Una fila de "Requieren atención": enlace alto, saturado, caído o con problemas de interfaz. */
export interface AttentionRow {
  key: string;
  l: TopoLink;
  aName: string;
  bName: string;
  level: LinkLevel | "issues";
  /** Utilización del sentido más cargado (si hay velocidad). */
  util?: number;
  speed?: number;
  phrase: string;
  rank: number;
}

/**
 * Enlaces que requieren atención, por severidad (caído y saturado primero, luego alto y luego los
 * que solo tienen problemas de interfaz) y, a igual severidad, por utilización. Lo normal no entra.
 */
export function attentionRows(
  t: Topology,
  checks: Map<string, LinkIssue[]>,
  rates: Map<string, LinkTraffic>,
  skip?: Set<string>,
): AttentionRow[] {
  const byId = new Map(t.nodes.map((n) => [n.id, n]));
  const rows: AttentionRow[] = [];
  for (const l of t.links) {
    const key = linkKey(l);
    if (skip?.has(key)) continue;
    const issues = checks.get(key);
    const lt = rates.get(key);
    const traffic = trafficLevel(lt?.util);
    const level: AttentionRow["level"] = issues?.some((i) => i.kind === "down") ? "down" : traffic !== "normal" ? traffic : issues?.length ? "issues" : "normal";
    if (level === "normal") continue;
    const word = traffic === "saturated" ? "Saturado" : "Alto";
    const first = issues?.[0];
    const more = issues && issues.length > 1 ? ` (+${issues.length - 1})` : "";
    const dir = (lt?.ab ?? 0) >= (lt?.ba ?? 0) ? "bajando" : "subiendo";
    const downIssue = issues?.find((i) => i.kind === "down");
    const phrase =
      level === "down"
        ? `${downIssue!.short}${issues!.length > 1 ? ` (+${issues!.length - 1})` : ""}`
        : level === "issues"
          ? `${first!.short}${more}`
          : first
            ? `${word} · ${first.short}${more}`
            : `${word} ${dir}${lt?.speed ? ` · ${speedShort(lt.speed)}` : ""}`;
    rows.push({
      key,
      l,
      aName: byId.get(l.a)?.name ?? l.a,
      bName: byId.get(l.b)?.name ?? l.b,
      level,
      ...(lt?.util !== undefined ? { util: lt.util } : {}),
      ...(lt?.speed ? { speed: lt.speed } : {}),
      phrase,
      rank: LEVEL_RANK[level],
    });
  }
  return rows.sort(
    (x, y) =>
      y.rank - x.rank ||
      Number(y.level === "down") - Number(x.level === "down") ||
      (y.util ?? -1) - (x.util ?? -1) ||
      `${x.aName}${x.bName}`.localeCompare(`${y.aName}${y.bName}`),
  );
}

// ---------- Rol y fabricante ----------

export type NodeRole = "router" | "switch" | "firewall" | "ap" | "phone" | "host" | "otro";
export const ROLE_LABEL: Record<NodeRole, string> = {
  router: "Router",
  switch: "Switch",
  firewall: "Firewall",
  ap: "Access point",
  phone: "Teléfono",
  host: "Servidor o PC",
  otro: "Sin clasificar",
};

const PHONE = /phone|\bsep[0-9a-f]{12}\b|polycom|yealink|avaya|mitel|\bcp-\d{4}|\bgxp\d|\bgrp\d/i;
const AP = /\bair-|access point|fortiap|\bfap-|\bc91\d\d|\bcw91|\bmr\d{2}\b|aruba ap|\biap-|\bap-?\d{3}\b|\bgwn76|\bwlanaccesspoint\b/i;
const FIREWALL = /fortigate|\bfgt|\basa\b|adaptive security|palo ?alto|\bpa-\d|\bsrx|check ?point|firepower|\bftd\b|sonicwall/i;
const SWITCH = /catalyst|\bws-c|\bc9[2-6]\d{2}|\bc[23]\d{3}\b|nexus|\bn[3579]k|\bs\d{4}\b|\bce\d{4}|\bex\d{4}|\bqfx|fortiswitch|\bgwn78|\baruba ?\d{4}|\bcx ?\d{4}|switch/i;
const ROUTER = /\bisr|\basr|\bcsr|\bc8[0-9]{3}|\bc1[01]\d{2}|ios[ -]?xr|\bne\d{2}|\bar\d{3,4}|\bmx\d|router/i;
const HOST = /linux|windows|vmware|esxi|server|ubuntu/i;

/** Capacidades como tokens: CDP "Router Switch IGMP", LLDP "B,R", Huawei "bridge,router". */
const capTokens = (caps: string | undefined) => new Set((caps ?? "").toLowerCase().split(/[\s,;]+/).filter(Boolean));

/** Rol estimado desde plataforma, nombre y capacidades anunciadas (sin comandos). */
export function nodeRole(n: Pick<TopoNode, "name" | "platform" | "caps">): NodeRole {
  const text = `${n.platform ?? ""} ${n.name}`;
  const caps = capTokens(n.caps);
  if (PHONE.test(text) || caps.has("phone") || caps.has("t") || caps.has("telephone")) return "phone";
  if (AP.test(text) || caps.has("w") || caps.has("wlanaccesspoint")) return "ap";
  if (FIREWALL.test(text)) return "firewall";
  if (SWITCH.test(n.platform ?? "")) return "switch";
  if (ROUTER.test(n.platform ?? "")) return "router";
  if (caps.has("switch") || caps.has("s") || caps.has("b") || caps.has("bridge")) return "switch";
  if (caps.has("router") || caps.has("r")) return "router";
  if (caps.has("host") || HOST.test(n.platform ?? "")) return "host";
  return "otro";
}

export type NodeVendor = "cisco" | "huawei" | "juniper" | "fortinet" | "aruba" | "grandstream" | "otro";
export const VENDOR_LABEL: Record<NodeVendor, string> = {
  cisco: "Cisco",
  huawei: "Huawei / H3C",
  juniper: "Juniper",
  fortinet: "Fortinet",
  aruba: "Aruba / HPE",
  grandstream: "Grandstream",
  otro: "Desconocido",
};

/** Fabricante según la plataforma informada (sin plataforma: desconocido). */
export function nodeVendor(n: Pick<TopoNode, "platform">): NodeVendor {
  const p = n.platform ?? "";
  if (/cisco|catalyst|nexus|\bios\b|ws-c|\bair-|\bc9\d{3}|\bisr|\basr|meraki/i.test(p)) return "cisco";
  if (/huawei|\bvrp\b|h3c|comware|yunshan/i.test(p)) return "huawei";
  if (/juniper|junos|\bex\d{4}|\bqfx|\bsrx|\bmx\d/i.test(p)) return "juniper";
  if (/forti/i.test(p)) return "fortinet";
  if (/aruba|procurve|\bhpe?\b/i.test(p)) return "aruba";
  if (/grandstream|\bgwn/i.test(p)) return "grandstream";
  return "otro";
}

export type NodeState = "explorado" | "pendiente" | "manual" | "ruteo";
export const STATE_LABEL: Record<NodeState, string> = { explorado: "Explorado", pendiente: "Sin explorar", manual: "Manual", ruteo: "Visto por ruteo" };
export const nodeState = (n: TopoNode): NodeState => (n.explored ? "explorado" : n.manual ? "manual" : n.addrOnly ? "ruteo" : "pendiente");

// ---------- Filtros y vista a N saltos ----------

export interface TopoFilter {
  roles: NodeRole[];
  vendors: NodeVendor[];
  protos: string[];
  states: NodeState[];
  /** Solo equipos a N saltos del equipo foco (0: sin límite). */
  hops: number;
  focus?: string;
}
export const NO_FILTER: TopoFilter = { roles: [], vendors: [], protos: [], states: [], hops: 0 };
export const filterActive = (f: TopoFilter) => !!(f.roles.length || f.vendors.length || f.protos.length || f.states.length || (f.hops && f.focus));

/** Equipos a lo más `max` saltos de `from` (por los enlaces dados). */
export function withinHops(links: TopoLink[], from: string, max: number): Set<string> {
  const adj = new Map<string, string[]>();
  for (const l of links) {
    adj.set(l.a, [...(adj.get(l.a) ?? []), l.b]);
    adj.set(l.b, [...(adj.get(l.b) ?? []), l.a]);
  }
  const seen = new Set([from]);
  let frontier = [from];
  for (let d = 0; d < max && frontier.length; d++) {
    const next: string[] = [];
    for (const id of frontier) for (const o of adj.get(id) ?? []) if (!seen.has(o)) (seen.add(o), next.push(o));
    frontier = next;
  }
  return seen;
}

/** Subconjunto visible del diagrama. Los criterios de una misma lista se suman (o), las listas se cruzan (y). */
export function filterView(t: Topology, f: TopoFilter): Topology {
  if (!filterActive(f)) return t;
  let links = f.protos.length ? t.links.filter((l) => f.protos.includes(String(l.proto))) : t.links;
  let nodes = t.nodes.filter(
    (n) =>
      n.id === f.focus ||
      ((!f.roles.length || f.roles.includes(nodeRole(n))) &&
        (!f.vendors.length || f.vendors.includes(nodeVendor(n))) &&
        (!f.states.length || f.states.includes(nodeState(n)))),
  );
  let ids = new Set(nodes.map((n) => n.id));
  links = links.filter((l) => ids.has(l.a) && ids.has(l.b));
  if (f.hops && f.focus && ids.has(f.focus)) {
    const near = withinHops(links, f.focus, f.hops);
    nodes = nodes.filter((n) => near.has(n.id));
    ids = near;
    links = links.filter((l) => ids.has(l.a) && ids.has(l.b));
  }
  return { nodes, links };
}

// ---------- Búsqueda ----------

export interface SearchHit {
  id: string;
  /** Qué coincidió: "nombre", "IP", "interfaz", "MAC" o "descripción". */
  what: string;
  /** Texto a mostrar junto al equipo (la IP, la interfaz o la MAC encontrada). */
  detail: string;
}

/** Clave canónica para mostrar: "gi1/0/5" -> "Gi1/0/5". */
const portLabel = (k: string) => k.charAt(0).toUpperCase() + k.slice(1);

const hexOnly = (s: string) => s.replace(/[.:\-\s]/g, "").toLowerCase();

/** Busca equipos por nombre, IP, interfaz (o su descripción) o MAC. Hasta `limit` resultados, los exactos primero. */
export function searchTopo(t: Topology, query: string, limit = 8): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const hits: (SearchHit & { rank: number })[] = [];
  const qPort = canonPort(q);
  const qHex = /^[0-9a-f.:\-\s]{4,}$/i.test(q) ? hexOnly(q) : "";
  // Interfaz con enlace (como se dibuja), indexada una vez: recorrer los enlaces por equipo era cuadrático.
  const linkPorts = new Map<string, string>();
  for (const l of t.links) {
    if (l.aPort && canonPort(l.aPort) === qPort) linkPorts.set(l.a, l.aPort);
    if (l.bPort && canonPort(l.bPort) === qPort) linkPorts.set(l.b, l.bPort);
  }
  for (const n of t.nodes) {
    const name = n.name.toLowerCase();
    if (name.includes(q)) {
      hits.push({ id: n.id, what: "nombre", detail: n.ip ?? "", rank: name === q ? 0 : name.startsWith(q) ? 1 : 3 });
      continue;
    }
    const ip = knownAddrs(n).find((a) => a.startsWith(q) || a === q);
    if (ip) {
      hits.push({ id: n.id, what: "IP", detail: ip, rank: ip === q ? 0 : 2 });
      continue;
    }
    const linkPort = linkPorts.get(n.id);
    const portKey = linkPort || !n.ports || !Object.hasOwn(n.ports, qPort) ? undefined : qPort;
    if (linkPort || portKey) {
      hits.push({ id: n.id, what: "interfaz", detail: linkPort ?? portLabel(portKey!), rank: 2 });
      continue;
    }
    if (qHex) {
      const found = Object.values(n.macs ?? {}).flatMap((mp) => mp.macs.map((e) => [mp.port, e.mac] as const)).find(([, mac]) => hexOnly(mac).includes(qHex));
      if (found) {
        hits.push({ id: n.id, what: "MAC", detail: `${found[1]} en ${found[0]}`, rank: hexOnly(found[1]) === qHex ? 0 : 2 });
        continue;
      }
    }
    if (q.length >= 3) {
      const desc = Object.entries(n.ports ?? {}).find(([, p]) => p.desc?.toLowerCase().includes(q));
      if (desc) hits.push({ id: n.id, what: "descripción", detail: `${portLabel(desc[0])}: ${desc[1].desc}`, rank: 4 });
    }
  }
  return hits
    .sort((x, y) => x.rank - y.rank)
    .slice(0, limit)
    .map(({ rank: _r, ...h }) => h);
}

// ---------- Puertos activos sin vecino ("L2 desconocido") ----------

/** Interfaces lógicas o de gestión: no llevan un vecino físico. */
const LOGICAL_PORT = /^(?:vl|vlanif|vlan-interface|lo|loopback|inloopback|tu|tunnel|po|nve|mgmt|null|nu|bdi|vbdif|meth|m-gigabitethernet|ae|irb|me|fxp|em|dialer|virtual|cpu|sup|ap|bvi|vi|bridge-aggregation)\d/;
const PORT_UP = /^(?:connected|up\b)/i;
/** Un solo comparador: localeCompare con opciones crea uno por llamada (lento con miles de puertos). */
const NUMERIC = new Intl.Collator(undefined, { numeric: true });

export interface UnknownL2 {
  /** Interfaces activas sin vecino, como las informa el equipo. */
  ports: string[];
  /** MAC vistas en esos puertos (si se leyó la tabla MAC). */
  macs: number;
  vendors: string[];
}

/**
 * Por equipo explorado, las interfaces físicas activas sin enlace en el diagrama (ni su agregado):
 * ahí hay algo conectado que no habla CDP/LLDP. No se guarda: se calcula al dibujar.
 */
export function unknownL2(t: Topology): Map<string, UnknownL2> {
  const linked = new Map<string, Set<string>>();
  for (const l of t.links) {
    if (l.aPort) linked.set(l.a, (linked.get(l.a) ?? new Set()).add(canonPort(l.aPort)));
    if (l.bPort) linked.set(l.b, (linked.get(l.b) ?? new Set()).add(canonPort(l.bPort)));
  }
  const res = new Map<string, UnknownL2>();
  for (const n of t.nodes) {
    if (!n.explored || !n.ports) continue;
    const mine = linked.get(n.id) ?? new Set<string>();
    const groups = new Set(Object.entries(n.ports).filter(([k, p]) => p.group && mine.has(k)).map(([, p]) => canonPort(p.group!)));
    for (const g of [...mine]) groups.add(g);
    const ports: string[] = [];
    let macs = 0;
    const vendors = new Set<string>();
    for (const [k, p] of Object.entries(n.ports)) {
      if (mine.has(k) || LOGICAL_PORT.test(k) || !p.status || !PORT_UP.test(p.status)) continue;
      if (p.group && groups.has(canonPort(p.group))) continue;
      const mp: MacPort | undefined = n.macs?.[k];
      ports.push(mp?.port ?? portLabel(k));
      if (mp) {
        macs += mp.total;
        for (const e of mp.macs) if (e.vendor) vendors.add(e.vendor);
      }
    }
    if (ports.length) res.set(n.id, { ports: ports.sort(NUMERIC.compare), macs, vendors: [...vendors].slice(0, 6) });
  }
  return res;
}

// ---------- Alcance del descubrimiento ----------

export interface TopoScope {
  /** No agrega teléfonos IP ni access points. */
  skipEndpoints: boolean;
  /** Redes permitidas (CIDR IPv4 separados por coma o espacio); vacío: todas. */
  cidrs: string;
  /** Profundidad máxima desde el primer equipo explorado (0: sin límite). */
  maxDepth: number;
}
export const NO_SCOPE: TopoScope = { skipEndpoints: false, cidrs: "", maxDepth: 0 };

const ipNum = (ip: string) => ip.split(".").reduce((a, o) => a * 256 + Number(o), 0);

/** "10.0.0.0/8, 192.168.1.0/24" -> rangos; error con el primer valor inválido. */
export function parseCidrs(s: string): { ranges: [number, number][]; error?: string } {
  const ranges: [number, number][] = [];
  for (const raw of s.split(/[\s,;]+/).filter(Boolean)) {
    const [ip, bits = "32"] = raw.split("/");
    const b = Number(bits);
    if (!isIpv4(ip) || !/^\d{1,2}$/.test(bits) || b > 32) return { ranges, error: `Red no válida: ${raw.slice(0, 40)}` };
    const size = 2 ** (32 - b);
    const start = Math.floor(ipNum(ip) / size) * size;
    ranges.push([start, start + size - 1]);
  }
  return { ranges };
}

export const inRanges = (ip: string, ranges: [number, number][]) => {
  const v = ipNum(ip);
  return ranges.some(([a, b]) => v >= a && v <= b);
};

/** Profundidad (saltos) de cada equipo desde el primer explorado. */
function depths(t: Topology): Map<string, number> {
  const root = t.nodes.find((n) => n.explored);
  const d = new Map<string, number>();
  if (!root) return d;
  const adj = new Map<string, string[]>();
  for (const l of t.links) {
    adj.set(l.a, [...(adj.get(l.a) ?? []), l.b]);
    adj.set(l.b, [...(adj.get(l.b) ?? []), l.a]);
  }
  d.set(root.id, 0);
  let frontier = [root.id];
  while (frontier.length) {
    const next: string[] = [];
    for (const id of frontier) for (const o of adj.get(id) ?? []) if (!d.has(o)) (d.set(o, d.get(id)! + 1), next.push(o));
    frontier = next;
  }
  return d;
}

/**
 * Aplica el alcance a los vecinos leídos de `self` antes de incorporarlos. Solo descarta vecinos
 * nuevos: un equipo que ya está en el diagrama (manual o de otra lectura) conserva su enlace.
 */
export function scopeNeighbors(t: Topology, self: string, neighbors: Neighbor[], scope: TopoScope): { kept: Neighbor[]; skipped: string[] } {
  const { ranges } = parseCidrs(scope.cidrs);
  const known = new Set(t.nodes.map((n) => n.id));
  const selfId = nodeId(self);
  const d = scope.maxDepth ? depths(t) : undefined;
  // Un equipo que aún no está en el diagrama es la raíz (profundidad 0).
  const tooDeep = !!d && d.size > 0 && (d.get(selfId) ?? 0) + 1 > scope.maxDepth;
  const kept: Neighbor[] = [];
  const skipped: string[] = [];
  for (const nb of neighbors) {
    if (known.has(nodeId(nb.name)) || (nb.ip && t.nodes.some((n) => knownAddrs(n).includes(nb.ip!)))) {
      kept.push(nb);
      continue;
    }
    const role = nodeRole({ name: nb.name, platform: nb.platform, caps: nb.caps });
    if (scope.skipEndpoints && (role === "phone" || role === "ap")) skipped.push(`${nb.name} (${ROLE_LABEL[role].toLowerCase()})`);
    else if (ranges.length && nb.ip && isIpv4(nb.ip) && !inRanges(nb.ip, ranges)) skipped.push(`${nb.name} (${nb.ip} fuera de las redes)`);
    else if (tooDeep) skipped.push(`${nb.name} (más de ${scope.maxDepth} saltos)`);
    else kept.push(nb);
  }
  return { kept, skipped };
}
