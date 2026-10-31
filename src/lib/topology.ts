/**
 * Topología desde CDP/LLDP y vecinos de ruteo (OSPF, EIGRP, BGP): comandos por fabricante,
 * lectura de salidas, grafo, elementos manuales y sugerencias desde descripciones y tablas MAC.
 */
import { isRejected, promptName } from "./cliText";

/** Origen de un enlace. */
export type LinkProto = "CDP" | "LLDP" | "OSPF" | "EIGRP" | "BGP" | "manual" | "descripción" | "MAC/OUI";

export const isPhysicalProto = (p: string) => p === "CDP" || p === "LLDP";
export const isRoutingProto = (p: string) => p === "OSPF" || p === "EIGRP" || p === "BGP";
/** Enlaces que el usuario puede editar o borrar (no vienen de un equipo). */
export const isUserProto = (p: string) => p === "manual" || p === "descripción" || p === "MAC/OUI";
/** Confianza del origen: un enlace descubierto reemplaza a uno manual en el mismo puerto. */
const protoRank = (p: string) => (isPhysicalProto(p) ? 3 : isRoutingProto(p) ? 2 : p === "manual" ? 1 : 0);

export interface Neighbor {
  name: string;
  localPort: string;
  remotePort: string;
  ip?: string;
  platform?: string;
  proto: LinkProto;
  /** Agregado local (Port-channel, Eth-Trunk, ae) informado junto al vecino. */
  group?: string;
  /** Vecino de ruteo: se conoce solo por router-id o dirección, sin hostname. */
  byAddr?: boolean;
  /** Direcciones conocidas del vecino (router-id, IP de la interfaz). */
  addrs?: string[];
  /** Sesión BGP que no es un enlace físico (iBGP entre loopbacks, multihop). */
  logical?: boolean;
  /** VLAN nativa (CDP) o PVID (LLDP) que anuncia el vecino en su puerto. */
  remoteNative?: string;
  /** Dúplex que anuncia el vecino en su puerto (CDP). */
  remoteDuplex?: string;
  /** Capacidades anunciadas (CDP "Capabilities", LLDP "Enabled Capabilities"). */
  caps?: string;
}

/** Estado de una interfaz local, leído con comandos de consulta. */
export interface PortInfo {
  status?: string;
  speed?: string;
  desc?: string;
  /** Port-channel / Eth-Trunk / ae al que pertenece. */
  group?: string;
  /** Dúplex (full, half, a-full) según el propio equipo o lo que anuncia el vecino por CDP. */
  duplex?: string;
  /** VLAN de acceso o "trunk" (columna Vlan de show interfaces status). */
  vlan?: string;
  /** VLAN nativa o PVID, anunciada por el vecino conectado (CDP/LLDP). */
  native?: string;
  /** Estado como miembro del agregado: P (en el bundle), D, s, I, H o Up/Down/Unselect (Huawei). */
  lag?: string;
  /** Errores FCS/CRC acumulados (Cisco show interfaces counters errors). */
  crc?: string;
  /** Errores de entrada acumulados (Huawei display interface brief). */
  inErr?: string;
}

export interface TopoNode {
  id: string; // nombre normalizado
  name: string;
  ip?: string;
  platform?: string;
  /** Equipo del que ya se leyeron sus vecinos. */
  explored: boolean;
  x: number;
  y: number;
  /** Interfaces locales indexadas por canonPort. */
  ports?: Record<string, PortInfo>;
  /** Direcciones conocidas (router-id, interfaces) para reconocer al equipo entre fuentes. */
  addrs?: string[];
  /** Equipo visto solo por un vecino de ruteo: su nombre es una IP hasta que se explore. */
  addrOnly?: boolean;
  /** Agregado a mano por el usuario (se puede editar y borrar). */
  manual?: boolean;
  /** Tabla MAC por interfaz local (clave canonPort), leída con la fuente MAC/OUI. */
  macs?: Record<string, MacPort>;
  /** Capacidades anunciadas por CDP/LLDP (Router, Switch, Phone, W, T…), para el rol. */
  caps?: string;
}

export interface TopoLink {
  a: string;
  aPort: string;
  b: string;
  bPort: string;
  /** LinkProto; string para aceptar diagramas guardados por versiones anteriores. */
  proto: LinkProto | string;
  /** Sesión lógica (BGP no directamente conectado): no es un salto físico. */
  logical?: boolean;
  /** Equipos explorados que informaron este enlace (CDP/LLDP), para detectar asimetrías. */
  seenBy?: string[];
}

export interface Topology {
  nodes: TopoNode[];
  links: TopoLink[];
}

export interface TopoSnapshot {
  id: string;
  name: string;
  ts: number;
  topo: Topology;
}

export type TopoVendor = "cisco" | "huawei" | "juniper" | "fortinet";

/** Comandos de vecinos por fabricante (todos de solo lectura). */
export const NEIGHBOR_COMMANDS: Record<TopoVendor, string[]> = {
  cisco: ["show cdp neighbors detail", "show lldp neighbors detail"],
  huawei: ["display lldp neighbor"],
  juniper: ["show lldp neighbors"],
  // FortiOS 7.6.3+ cambió a "diagnose lldp rx neighbor": se prueba primero el clásico.
  fortinet: ["diagnose lldprx neighbor summary", "diagnose lldprx neighbor details"],
};

/** Comandos alternativos cuando el principal no existe en esa versión. */
export const FALLBACK_COMMANDS: Record<string, string> = {
  "diagnose lldprx neighbor summary": "diagnose lldp rx neighbor summary",
  "diagnose lldprx neighbor details": "diagnose lldp rx neighbor details",
  "show interfaces status": "show interfaces description",
  "show etherchannel summary": "show port-channel summary",
  // NX-OS: sintaxis por familia de direcciones (Cisco, documento 220604).
  "show ip bgp summary": "show bgp ipv4 unicast summary",
};

/**
 * Vecinos de ruteo (solo consulta). Sirven cuando CDP/LLDP está deshabilitado: el vecino se
 * conoce por router-id o dirección. Formatos verificados en la documentación citada en cada parser.
 */
export const ROUTING_COMMANDS: Record<TopoVendor, string[]> = {
  cisco: ["show ip ospf neighbor", "show ip eigrp neighbors", "show ip bgp summary"],
  huawei: ["display ospf peer brief"],
  juniper: ["show ospf neighbor"],
  fortinet: [],
};

/**
 * Direcciones propias del equipo explorado, para reconocerlo cuando otro lo reporta por IP.
 * Solo se ejecuta si hubo vecinos de ruteo o hay equipos conocidos solo por dirección.
 */
export const ADDRESS_COMMANDS: Record<TopoVendor, string | undefined> = {
  cisco: "show ip interface brief",
  huawei: "display ip interface brief",
  juniper: "show interfaces terse",
  fortinet: undefined,
};

/** Comandos de estado de interfaces y agregados (opcionales, de solo lectura). */
export const PORT_COMMANDS: Record<TopoVendor, string[]> = {
  // "show interfaces trunk" trae la VLAN nativa de cada trunk propio (IOS/IOS-XE): sin ella solo se comparaba si ambos extremos estaban explorados.
  cisco: ["show interfaces status", "show etherchannel summary", "show interfaces counters errors", "show interfaces trunk"],
  huawei: ["display interface brief", "display interface description", "display eth-trunk"],
  juniper: ["show interfaces descriptions"],
  fortinet: [],
};

/**
 * Nombre de interfaz que se puede devolver al equipo dentro de un comando: viene de su salida,
 * así que se rechaza todo lo que no sea letras, dígitos y / . : - _ (un "|" agregaría "| save").
 */
export const isSafeIface = (s: string) => /^[A-Za-z][\w/.:-]{0,63}$/.test(s);

/** Detalle de Junos por interfaz: trae la IP de gestión que la tabla resumida no muestra. */
export const junosDetailCommand = (iface: string): string | null => (isSafeIface(iface) ? `show lldp neighbors interface ${iface}` : null);

/**
 * Respuesta de error del equipo: comando inexistente en esa versión o plataforma, o protocolo
 * deshabilitado (IOS responde "% CDP is not enabled", "% LLDP is not enabled", "% BGP not active").
 */
export function isCliError(out: string): boolean {
  return isRejected(out) || /^\s*% ?(CDP|LLDP) is not enabled|^\s*% ?BGP not active/im.test(out);
}

const IP_RE = String.raw`\d{1,3}(?:\.\d{1,3}){3}`;

/** IPv4 válida (cuatro octetos de 0 a 255, sin ceros a la izquierda). */
export function isIpv4(s: string): boolean {
  const p = s.split(".");
  return p.length === 4 && p.every((o) => /^(0|[1-9]\d{0,2})$/.test(o) && Number(o) <= 255);
}

/** IPv6 válida (incluye "::" y sufijo IPv4). */
export function isIpv6(s: string): boolean {
  if (!/^[0-9a-f:.]{2,45}$/i.test(s) || !s.includes(":")) return false;
  // El analizador de URL (WHATWG) valida la sintaxis completa de IPv6.
  try {
    return new URL(`http://[${s}]/`).hostname.length > 2;
  } catch {
    return false;
  }
}

/** Nombre normalizado: sin dominio ni número de serie entre paréntesis (CDP de NX-OS). */
export const nodeId = (name: string) => {
  const s = name.trim().replace(/\(.*\)$/, "");
  // Un vecino de ruteo se identifica por su dirección: no se corta en el primer punto.
  if (isIpv4(s)) return s;
  return s.split(".")[0].toLowerCase();
};

/** Abrevia interfaces largas para las etiquetas: GigabitEthernet1/0/1 -> Gi1/0/1. */
export function shortPort(p: string): string {
  const map: [RegExp, string][] = [
    [/^HundredGig(abit)?E(thernet)?/i, "Hu"],
    [/^FortyGig(abit)?E(thernet)?/i, "Fo"],
    [/^TwentyFiveGig(abit)?E(thernet)?/i, "Twe"],
    [/^TenGig(abit)?E(thernet)?/i, "Te"],
    [/^XGigabitEthernet/i, "XGE"],
    [/^GigabitEthernet/i, "Gi"],
    [/^FastEthernet/i, "Fa"],
    [/^Ethernet/i, "Eth"],
    [/^Port-channel/i, "Po"],
  ];
  // Junos agrega la unidad lógica ".0" que no aporta en el diagrama.
  const p2 = /^(ge|xe|et|ae|mge)-[\d/]+\.0$/.test(p) ? p.slice(0, -2) : p;
  for (const [re, s] of map) if (re.test(p2)) return p2.replace(re, s);
  return p2;
}

/**
 * Forma canónica de una interfaz para comparar entre fabricantes:
 * GE0/0/1 (Huawei) = GigabitEthernet0/0/1 (Cisco) = Gi0/0/1 -> "gi0/0/1".
 */
/** Caché de canonPort: el mismo puerto se normaliza miles de veces por render (claves, revisiones). */
const canonCache = new Map<string, string>();

export function canonPort(p: string): string {
  const hit = canonCache.get(p);
  if (hit !== undefined) return hit;
  const r = canonPortRaw(p);
  if (canonCache.size > 20000) canonCache.clear();
  canonCache.set(p, r);
  return r;
}

function canonPortRaw(p: string): string {
  const s = p
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/^((?:ge|xe|et|ae|mge)-[\d/]+)\.0$/, "$1");
  // Cada familia con su nombre completo y las abreviaturas de Cisco: "show interfaces" usa el
  // nombre completo, LLDP la forma corta (Gi1/0/1, Tw1/0/1) y "show cdp neighbors" la de tres
  // letras (Gig 1/0/1, Ten, Fas, For, Hun). Sin unificarlas, el enlace no encuentra sus
  // contadores. Todas exigen un dígito después, y las más largas van primero.
  const families: [RegExp, string][] = [
    [/^(fourhundredgig(abit)?e(thernet)?|fou|400ge)(?=\d)/, "fou"],
    [/^(hundredgig(abit)?e(thernet)?|hun|hu|100ge)(?=\d)/, "hu"],
    [/^(fiftygig(abit)?e(thernet)?|fif|50ge)(?=\d)/, "fif"],
    [/^(fortygig(abit)?e(thernet)?|for|fo|40ge)(?=\d)/, "fo"],
    [/^(twentyfivegig(abit)?e(thernet)?|twe|25ge)(?=\d)/, "twe"],
    [/^(tengig(abit)?e(thernet)?|xgigabitethernet|xge|ten|te|10ge)(?=\d)/, "te"],
    [/^(fivegig(abit)?e(thernet)?|fiv|fi)(?=\d)/, "fi"],
    [/^(twogig(abit)?e(thernet)?|two|tw)(?=\d)/, "tw"],
    [/^(appgig(abit)?e(thernet)?|app|ap)(?=\d)/, "ap"],
    [/^(gigabitethernet|gige|gig|gi|ge)(?=\d)/, "gi"],
    [/^(fastethernet|fas|fa)(?=\d)/, "fa"],
    [/^(port-channel|po|eth-trunk|bundle-ether|be)(?=\d)/, "po"],
    [/^(ethernet|eth|et)(?=\d)/, "eth"],
    [/^(vlan|vl)(?=\d)/, "vl"],
  ];
  for (const [re, fam] of families) if (re.test(s)) return s.replace(re, fam);
  return s;
}

/**
 * Fabricante según el prompt al final de la salida: <SW> o [SW] Huawei/H3C, usuario@equipo>
 * Junos, "FGT #" (espacio antes de #) FortiOS y Router# o Router> Cisco. Tras saltar a otro
 * equipo desde la misma sesión, la topología cambia sola la sintaxis de los comandos.
 */
export function vendorFromPrompt(output: string): TopoVendor | null {
  const last = output.trimEnd().split("\n").pop()?.trim() ?? "";
  if (/^<[\w.\-]+>$/.test(last) || /^\[~?\*?[\w.\-]+(?:[^\]\w.\-][^\]]*)?\]$/.test(last)) return "huawei";
  if (/^[\w.\-]+@[\w.\-]+[>#%]$/.test(last)) return "juniper";
  if (/^[\w.\-]+(?:\s\([^)]*\))?\s[#$]$/.test(last)) return "fortinet";
  if (/^[\w.\-]+(?:\([^)]*\))?[#>]$/.test(last)) return "cisco";
  return null;
}

/** Usuario que se puede escribir en un comando de salto (sin espacios ni opciones). */
const HOP_USER = /^[A-Za-z0-9][\w.@\\-]{0,63}$/;

/**
 * Comando para saltar al vecino desde la consola del equipo actual (la misma pestaña), cuando
 * el vecino solo es alcanzable desde ese equipo y no desde el PC. La IP viene de un vecino
 * (dato del equipo): solo una IPv4/IPv6 literal. El usuario, sin espacios ni guiones al inicio.
 * - Cisco IOS/IOS-XE: "ssh -l usuario IP"; NX-OS: "ssh usuario@IP"; Telnet: "telnet IP".
 * - Huawei VRP: "stelnet IP" (pide el usuario en el equipo) o "telnet IP".
 * - Junos: "ssh usuario@IP" o "telnet IP".
 * - FortiOS: "execute ssh usuario@IP" o "execute telnet IP".
 */
export function hopCommand(vendor: TopoVendor, platform: string | undefined, proto: "ssh" | "telnet", user: string, ip: string): string | null {
  if (!isIpv4(ip) && !isIpv6(ip)) return null;
  const u = user.trim();
  const needsUser = proto === "ssh" && vendor !== "huawei";
  if (needsUser && !HOP_USER.test(u)) return null;
  if (proto === "telnet") return vendor === "fortinet" ? `execute telnet ${ip}` : `telnet ${ip}`;
  switch (vendor) {
    case "huawei":
      return `stelnet ${ip}`;
    case "juniper":
      return `ssh ${u}@${ip}`;
    case "fortinet":
      return `execute ssh ${u}@${ip}`;
    default:
      return platform === "nxos" ? `ssh ${u}@${ip}` : `ssh -l ${u} ${ip}`;
  }
}

/** Hostname desde el prompt al final de la salida (Router#, <SW>, user@host>, FGT #). */
export { promptName };

function field(block: string, re: RegExp): string | undefined {
  return block.match(re)?.[1]?.trim() || undefined;
}

const usableIp = (ip?: string) => (ip && ip !== "0.0.0.0" ? ip : undefined);

/** Cisco "show cdp neighbors detail" (IOS, IOS-XE, NX-OS). */
export function parseCdp(out: string): Neighbor[] {
  return out
    .split(/^-{5,}\s*$/m)
    .flatMap((b): Neighbor[] => {
      const name = field(b, /Device ID:\s*(\S+)/);
      const local = field(b, /Interface:\s*([^,\n]+),/);
      const remote = field(b, /Port ID \(outgoing port\):\s*(\S+)/);
      if (!name || !local || !remote) return [];
      return [
        {
          name,
          localPort: local,
          remotePort: remote,
          ip: usableIp(field(b, /(?:IP(?:v4)? [Aa]ddress|IP address):\s*(\d+\.\d+\.\d+\.\d+)/)),
          platform: field(b, /Platform:\s*([^,\n]+)/),
          proto: "CDP",
          remoteNative: field(b, /Native VLAN:\s*(\d+)/),
          remoteDuplex: field(b, /Duplex:\s*(\S+)/),
          caps: field(b, /Capabilities:\s*([^\n]+)/),
        },
      ];
    });
}

const mgmtAt = (b: string) => b.indexOf("Management Addresses:");

/** Cisco "show lldp neighbors detail". */
export function parseCiscoLldp(out: string): Neighbor[] {
  return out
    .split(/^-{5,}\s*$/m)
    .flatMap((b): Neighbor[] => {
      const local = field(b, /Local Intf:\s*(\S+)/);
      const remote = field(b, /Port id:\s*(\S+)/);
      const name = field(b, /System Name:\s*(\S+)/) ?? field(b, /Chassis id:\s*(\S+)/);
      if (!name || !local || !remote) return [];
      return [
        {
          name,
          localPort: local,
          remotePort: remote,
          // Desde el primer encabezado: "Management Addresses:[\s\S]*?IP:" era cuadrático si se repetía.
          ip: usableIp(mgmtAt(b) >= 0 ? field(b.slice(mgmtAt(b)), /IP:\s*(\d+\.\d+\.\d+\.\d+)/) : undefined),
          platform: field(b, /System Description:\s*\n\s*([^\n]+)/),
          proto: "LLDP",
          remoteNative: field(b, /Vlan ID:\s*(\d+)/),
          caps: field(b, /Enabled Capabilities:\s*([^\n]+)/),
        },
      ];
    });
}

/** Huawei VRP "display lldp neighbor" (detalle por interfaz). */
export function parseHuaweiLldp(out: string): Neighbor[] {
  const res: Neighbor[] = [];
  const blocks = out.split(/^(?=\S+ has \d+ neighbor)/m);
  for (const b of blocks) {
    const local = field(b, /^(\S+) has \d+ neighbor/m);
    if (!local) continue;
    for (const nb of b.split(/Neighbor index\s*:/).slice(1)) {
      const name = field(nb, /System name\s*:\s*(\S+)/) ?? field(nb, /Chassis ID\s*:\s*(\S+)/);
      const remote = field(nb, /Port ID\s*:\s*(\S+)/);
      if (!name || !remote) continue;
      res.push({
        name,
        localPort: local,
        remotePort: remote,
        ip: usableIp(field(nb, /Management address\s*:\s*(\d+\.\d+\.\d+\.\d+)/)),
        platform: field(nb, /System description\s*:\s*([^\n]+)/),
        proto: "LLDP",
        remoteNative: field(nb, /Port VLAN ID\(PVID\)\s*:\s*(\d+)/i),
        caps: field(nb, /System capabilities enabled\s*:\s*([^\n]+)/i),
      });
    }
  }
  return res;
}

/** Junos "show lldp neighbors" (tabla resumida). La columna Parent Interface indica el ae. */
export function parseJunosLldp(out: string): Neighbor[] {
  const res: Neighbor[] = [];
  for (const line of out.split("\n")) {
    // Local Interface  Parent Interface  Chassis Id  Port info  System Name
    const m = line.match(/^(\S+)\s+(\S+)\s+([0-9a-f]{2}(?::[0-9a-f]{2}){5})\s+(\S+)\s+(\S+)\s*$/i);
    if (!m) continue;
    const parent = m[2] === "-" ? undefined : m[2].replace(/\.0$/, "");
    res.push({ name: m[5], localPort: m[1], remotePort: m[4], proto: "LLDP", group: parent });
  }
  return res;
}

/** Junos "show lldp neighbors interface X": vecino con IP de gestión. */
export function parseJunosLldpDetail(out: string): Neighbor | null {
  const local = field(out, /Local Interface\s*:\s*(\S+)/);
  const name = field(out, /System name\s*:\s*(\S+)/);
  const portId = field(out, /Port ID\s*:\s*(\S+)/);
  const portDesc = field(out, /Port description\s*:\s*(\S+)/);
  if (!local || !name) return null;
  const parent = field(out, /Parent Interface\s*:\s*(\S+)/);
  const mgmt = out.split(/Management Info/i)[1];
  // El Port ID de Junos suele ser el índice SNMP: si es numérico, la descripción es más útil.
  const remote = portId && !/^\d+$/.test(portId) ? portId : (portDesc ?? portId ?? "?");
  return {
    name,
    localPort: local,
    remotePort: remote,
    ip: usableIp(mgmt ? field(mgmt, /Address\s*:\s*(\d+\.\d+\.\d+\.\d+)/) : undefined),
    platform: field(out, /System Description\s*:\s*([^\n]+)/),
    proto: "LLDP",
    group: parent && parent !== "-" ? parent.replace(/\.0$/, "") : undefined,
  };
}

/**
 * FortiOS "diagnose lldprx neighbor summary" y "details" (también la sintaxis 7.6.3+).
 * Resumen: 1 port 'wan1' 5 mac … chassis … port 'Te1/0/1' system 'Switch'
 * Detalle: lldprx.neighbor.1.address.1.addr: 192.0.2.1
 */
export function parseFortiLldp(outputs: string[]): Neighbor[] {
  const all = outputs.join("\n");
  const byIdx = new Map<string, Neighbor>();
  // Sin saltos de línea dentro de las comillas: un nombre no puede abarcar varias líneas.
  for (const m of all.matchAll(/^[ \t]*(\d+)[ \t]+port[ \t]+'([^'\n]+)'.*?\bport[ \t]+'([^'\n]+)'(?:[ \t]+system[ \t]+'([^'\n]*)')?/gm)) {
    const [, idx, local, remote, system] = m;
    // Solo en la misma línea: buscar en todo el resto de la salida era cuadrático.
    const chassis = m[0].match(/chassis\s+(\S+)/)?.[1];
    byIdx.set(idx, { name: system || chassis || `vecino-${idx}`, localPort: local, remotePort: remote, proto: "LLDP" });
  }
  for (const m of all.matchAll(/lldprx\.neighbor\.(\d+)\.address\.\d+\.addr:\s*(\S+)/g)) {
    const n = byIdx.get(m[1]);
    if (n && !n.ip && isIpv4(m[2])) n.ip = usableIp(m[2]);
  }
  for (const m of all.matchAll(/lldprx\.neighbor\.(\d+)\.system\.desc\.data:\s*([^\n]+)/g)) {
    const n = byIdx.get(m[1]);
    if (n && !n.platform) n.platform = m[2].trim();
  }
  return [...byIdx.values()];
}

export function parseNeighbors(vendor: string, outputs: string[]): Neighbor[] {
  const valid = outputs.filter((o) => !isCliError(o));
  const all =
    vendor === "huawei"
      ? valid.flatMap(parseHuaweiLldp)
      : vendor === "juniper"
        ? [...valid.flatMap(parseJunosLldp), ...valid.flatMap((o) => parseJunosLldpDetail(o) ?? [])]
        : vendor === "fortinet"
          ? parseFortiLldp(valid)
          : valid.flatMap((o) => [...parseCdp(o), ...parseCiscoLldp(o)]);
  // CDP y LLDP (o resumen y detalle) pueden reportar el mismo enlace: uno por puerto local,
  // completando con los datos que traiga el duplicado (IP, plataforma, agregado).
  const byKey = new Map<string, Neighbor>();
  for (const n of all) {
    const k = `${canonPort(n.localPort)}|${nodeId(n.name)}`;
    const prev = byKey.get(k);
    if (!prev) byKey.set(k, { ...n });
    else {
      prev.ip ??= n.ip;
      prev.platform ??= n.platform;
      prev.group ??= n.group;
      prev.remoteNative ??= n.remoteNative;
      prev.remoteDuplex ??= n.remoteDuplex;
      prev.caps ??= n.caps;
      if (/^\d+$/.test(prev.remotePort) && !/^\d+$/.test(n.remotePort)) prev.remotePort = n.remotePort;
    }
  }
  return [...byKey.values()];
}

// ---------- Vecinos de ruteo ----------

/** Estados OSPF sin adyacencia: el vecino no se dibuja. */
const OSPF_DOWN = /^(down|attempt)\b/i;

const ospfNeighbor = (rid: string, addr: string | undefined, iface: string): Neighbor => ({
  name: rid,
  localPort: iface,
  remotePort: "",
  ip: addr ?? rid,
  addrs: [...new Set([rid, addr].filter((x): x is string => !!x && isIpv4(x)))],
  proto: "OSPF",
  byAddr: true,
});

/**
 * Cisco IOS, IOS-XE y NX-OS "show ip ospf neighbor".
 * Columnas: Neighbor ID, Pri, State, Dead Time (Up Time en NX-OS), Address, Interface.
 * Fuente: Cisco, "Understand Show IP OSPF Neighbor Command Output", Document ID 13688,
 * https://www.cisco.com/c/en/us/support/docs/ip/open-shortest-path-first-ospf/13688-16.html
 * En enlaces punto a punto el estado se imprime "FULL/  -" (con espacios), por eso se admite.
 */
export function parseCiscoOspf(out: string): Neighbor[] {
  const re = new RegExp(String.raw`^\s*(${IP_RE})\s+\d+\s+([A-Za-z0-9-]+(?:\/\s*[A-Za-z-]+)?)\s+(\S+)\s+(${IP_RE})\s+(\S+)\s*$`, "gm");
  return [...out.matchAll(re)].filter((m) => isIpv4(m[1]) && !OSPF_DOWN.test(m[2])).map((m) => ospfNeighbor(m[1], m[4], m[5]));
}

/**
 * Junos "show ospf neighbor": Address, Interface, State, ID (router-id), Pri, Dead.
 * Fuente: Juniper, "show (ospf | ospf3) neighbor",
 * https://juniper.net/documentation/en_US/junos13.1/topics/reference/command-summary/show-ospf-ospf3-neighbor.html
 */
export function parseJunosOspf(out: string): Neighbor[] {
  const re = new RegExp(String.raw`^\s*(${IP_RE})\s+(\S+)\s+([A-Za-z0-9]+)\s+(${IP_RE})\s+\d+\s+\d+\s*$`, "gm");
  return [...out.matchAll(re)].filter((m) => isIpv4(m[4]) && !OSPF_DOWN.test(m[3])).map((m) => ospfNeighbor(m[4], m[1], m[2]));
}

/**
 * Huawei VRP "display ospf peer brief": Area Id, Interface, Neighbor id (router-id), State.
 * No informa la IP de la interfaz del vecino, solo su router-id.
 * Fuente: Huawei, "display ospf peer", WLAN AC V200R008C10 Command Reference,
 * https://support.huawei.com/enterprise/en/doc/EDOC1100008283/9dc18ce0/display-ospf-peer
 */
export function parseHuaweiOspf(out: string): Neighbor[] {
  if (!/Area\s*Id\s+Interface\s+Neighbor\s*id\s+State/i.test(out)) return [];
  const re = new RegExp(String.raw`^\s*${IP_RE}\s+(\S+)\s+(${IP_RE})\s+(\S+)\s*$`, "gm");
  return [...out.matchAll(re)].filter((m) => isIpv4(m[2]) && !OSPF_DOWN.test(m[3])).map((m) => ospfNeighbor(m[2], undefined, m[1]));
}

/**
 * Cisco "show ip eigrp neighbors" (IOS, IOS-XE, NX-OS). El formato antiguo empieza en Address y
 * el actual antepone la columna H; luego Interface, Hold, Uptime, SRTT, RTO, Q, Seq.
 * Fuente: Cisco IOS Command Reference, "show ip eigrp neighbors",
 * https://www.cisco.com/E-Learning/bulk/public/tac/cim/cib/using_cisco_ios_software/cmdrefs/show_ip_eigrp_neighbors.htm
 */
export function parseEigrp(out: string): Neighbor[] {
  if (!/EIGRP/i.test(out)) return [];
  const re = new RegExp(String.raw`^\s*(?:\d+\s+)?(${IP_RE})\s+(\S+)\s+\d+\s+\S+`, "gm");
  return [...out.matchAll(re)]
    .filter((m) => isIpv4(m[1]))
    .map((m) => ({ name: m[1], localPort: m[2], remotePort: "", ip: m[1], addrs: [m[1]], proto: "EIGRP" as const, byAddr: true }));
}

export interface BgpPeer {
  ip: string;
  remoteAs: string;
  state: string;
}

/**
 * Cisco "show ip bgp summary" (IOS/IOS-XE) y "show bgp ipv4 unicast summary" (NX-OS).
 * Columnas: Neighbor, V, AS, MsgRcvd, MsgSent, TblVer, InQ, OutQ, Up/Down, State/PfxRcd.
 * State/PfxRcd numérico = sesión establecida; Idle, Active, etc. = caída (se omite).
 * Fuente: Cisco, "Understand Basic BGP Troubleshoot", Document ID 220604,
 * https://www.cisco.com/c/en/us/support/docs/ip/border-gateway-protocol-bgp/220604-understand-basic-bgp-troubleshoot.html
 */
export function parseBgpSummary(out: string): { routerId?: string; localAs?: string; peers: BgpPeer[] } {
  // Estado hasta el fin de línea y se recorta después: "(.+?)\s*$" era cuadrático con muchos espacios.
  const re = new RegExp(String.raw`^\s*(${IP_RE})\s+4\s+(\d+(?:\.\d+)?)\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+\S+\s+(\S[^\n]*)$`, "gm");
  const routerId = out.match(new RegExp(String.raw`BGP router identifier (${IP_RE})`))?.[1];
  return {
    routerId: routerId && isIpv4(routerId) ? routerId : undefined,
    localAs: out.match(/local AS number (\d+(?:\.\d+)?)/)?.[1],
    peers: [...out.matchAll(re)].filter((m) => isIpv4(m[1])).map((m) => ({ ip: m[1], remoteAs: m[2], state: m[3].trim() })),
  };
}

/** Comando de ruteo y su salida (el parser se elige por el comando). */
export interface CommandOutput {
  cmd: string;
  out: string;
}

/**
 * Vecinos de ruteo a partir de las salidas de ROUTING_COMMANDS. Un par BGP cuya IP es la de un
 * vecino OSPF/EIGRP está directamente conectado (se usa esa interfaz); si no, un par iBGP
 * (mismo AS) se marca como sesión lógica. Un eBGP sin IGP en común se asume directo: es lo
 * predeterminado (TTL 1); un eBGP multihop no se distingue con el resumen.
 */
export function parseRoutingNeighbors(results: CommandOutput[]): { neighbors: Neighbor[]; selfAddrs: string[] } {
  const igp: Neighbor[] = [];
  const selfAddrs: string[] = [];
  const bgp: ReturnType<typeof parseBgpSummary>[] = [];
  for (const { cmd, out } of results) {
    if (!out || isCliError(out)) continue;
    const c = cmd.trim().toLowerCase();
    if (c.startsWith("display ospf")) {
      igp.push(...parseHuaweiOspf(out));
      const rid = out.match(new RegExp(String.raw`Router ID\s+(${IP_RE})`, "i"))?.[1];
      if (rid && isIpv4(rid)) selfAddrs.push(rid);
    } else if (c.startsWith("show ospf")) igp.push(...parseJunosOspf(out));
    else if (c.startsWith("show ip ospf")) igp.push(...parseCiscoOspf(out));
    else if (c.includes("eigrp")) igp.push(...parseEigrp(out));
    else if (c.includes("bgp")) bgp.push(parseBgpSummary(out));
  }
  const neighbors = [...igp];
  for (const b of bgp) {
    if (b.routerId) selfAddrs.push(b.routerId);
    // State/PfxRcd numérico = sesión establecida.
    neighbors.push(...bgpNeighbors(igp, b.localAs, b.peers.filter((p) => /^\d+$/.test(p.state))));
  }
  return { neighbors, selfAddrs: [...new Set(selfAddrs)] };
}

/**
 * Pares BGP establecidos como vecinos (CLI y SNMP). Directo si la IP del par es la de la
 * interfaz de un vecino IGP (no su router-id) o, por SNMP, si cae en una subred propia
 * (`ifaceOf`); si no, un iBGP (mismo AS) es una sesión lógica.
 */
export function bgpNeighbors(igp: Neighbor[], localAs: string | undefined, peers: BgpPeer[], ifaceOf?: (ip: string) => string | undefined): Neighbor[] {
  return peers.map((p) => {
    const via = igp.find((n) => n.ip === p.ip && n.localPort)?.localPort ?? ifaceOf?.(p.ip);
    return {
      name: p.ip,
      localPort: via ?? "",
      remotePort: "",
      ip: p.ip,
      addrs: [p.ip],
      proto: "BGP" as const,
      byAddr: true,
      logical: !via && !!localAs && p.remoteAs === localAs,
    };
  });
}

/** Rangos que se repiten en todos los equipos (loopback, link-local, interno de Junos 128.0.0.0/16). */
const SHARED_ADDR = /^(0\.|127\.|169\.254\.|128\.0\.|255\.)/;
export const isSharedAddr = (ip: string) => SHARED_ADDR.test(ip);

/**
 * Direcciones IPv4 propias desde "show ip interface brief" (Cisco), "display ip interface brief"
 * (Huawei) o "show interfaces terse" (Junos). Lectura genérica: la primera IPv4 de cada fila de
 * interfaz (o de la línea "inet" de Junos), sin máscara ni la dirección remota tras "-->".
 */
export function parseOwnAddresses(outputs: string[]): string[] {
  const res = new Set<string>();
  for (const out of outputs.filter((o) => o && !isCliError(o))) {
    for (const line of out.split(/\r?\n/)) {
      if (!/^\S*\d/.test(line) && !/^\s+inet\s/.test(line)) continue;
      const ip = line.split("-->")[0].match(new RegExp(String.raw`(?:^|\s)(${IP_RE})(?:\/\d{1,2})?(?=\s|$)`))?.[1];
      if (ip && isIpv4(ip) && !SHARED_ADDR.test(ip)) res.add(ip);
    }
  }
  return [...res];
}

/** Columnas de una tabla de ancho fijo a partir de su encabezado. */
function fixedColumns(header: string, names: string[]): { name: string; start: number }[] {
  return names
    .map((name) => ({ name, start: header.search(new RegExp(`\\b${name}\\b`)) }))
    .filter((c) => c.start >= 0)
    .sort((a, b) => a.start - b.start);
}

function sliceRow(line: string, cols: { name: string; start: number }[]): Record<string, string> {
  const row: Record<string, string> = {};
  cols.forEach((c, i) => {
    const end = i + 1 < cols.length ? cols[i + 1].start : line.length;
    row[c.name] = line.slice(c.start, end).trim();
  });
  return row;
}

/** Claves que no se usan como índice de un objeto con datos del equipo (prototype pollution). */
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/** Interpreta las salidas de PORT_COMMANDS y devuelve el estado por interfaz (clave canonPort). */
export function parsePortInfo(outputs: string[]): Record<string, PortInfo> {
  const ports: Record<string, PortInfo> = {};
  const put = (iface: string, info: PortInfo) => {
    const k = canonPort(iface);
    // La interfaz viene del equipo: "__proto__" como clave contaminaría Object.prototype.
    if (!iface || UNSAFE_KEYS.has(k)) return;
    const cur = (ports[k] ??= {});
    for (const [key, v] of Object.entries(info) as [keyof PortInfo, string | undefined][]) if (v && !cur[key]) cur[key] = v;
  };
  for (const out of outputs.filter((o) => !isCliError(o))) {
    const lines = out.split(/\r?\n/);
    // Cisco "show interfaces status" (IOS/NX-OS): Port Name Status Vlan Duplex Speed Type
    let hi = lines.findIndex((l) => /^Port\s+Name\s+Status\s+Vlan/.test(l));
    if (hi >= 0) {
      // Port/Name/Status van alineadas a la izquierda; Duplex y Speed a la derecha, así que
      // desde Vlan en adelante se separa por espacios: vlan duplex speed tipo.
      const cols = fixedColumns(lines[hi], ["Port", "Name", "Status", "Vlan"]);
      const vlanAt = cols.find((c) => c.name === "Vlan")?.start ?? 0;
      for (const l of lines.slice(hi + 1)) {
        if (!/^\S/.test(l) || /^-+/.test(l) || /[#>]\s*$/.test(l)) continue;
        const r = sliceRow(l.slice(0, vlanAt), cols.filter((c) => c.name !== "Vlan"));
        const [vlan, duplex, speed] = l.slice(vlanAt).trim().split(/\s+/);
        put(r.Port, { status: r.Status, speed, desc: r.Name, vlan, duplex });
      }
      continue;
    }
    // Cisco "show interfaces description": Interface Status Protocol Description
    hi = lines.findIndex((l) => /^Interface\s+Status\s+Protocol\s+Description/.test(l));
    if (hi >= 0) {
      const cols = fixedColumns(lines[hi], ["Interface", "Status", "Protocol", "Description"]);
      for (const l of lines.slice(hi + 1)) {
        if (!/^\S/.test(l) || /[#>]\s*$/.test(l)) continue;
        const r = sliceRow(l, cols);
        put(r.Interface, { status: r.Protocol ? `${r.Status}/${r.Protocol}` : r.Status, desc: r.Description });
      }
      continue;
    }
    // Cisco "show etherchannel summary" / NX-OS "show port-channel summary"
    if (/\bPo\d+\(\w+\)/.test(out)) {
      let group: string | undefined;
      for (const l of lines) {
        const po = l.match(/\b(Po\d+)\(\w+\)/);
        if (po) group = po[1];
        // Las líneas que continúan la lista de miembros solo traen interfaces.
        // Miembros sin paréntesis en el nombre: "(\S+\(\w+\)\s*)+" era exponencial (ReDoS).
        else if (!/^\s+(?:[^\s()]+\(\w+\)\s*)+$/.test(l)) {
          group = undefined;
          continue;
        }
        if (!group) continue;
        for (const m of l.matchAll(/(\S+)\((\w+)\)/g)) if (!/^Po\d+$/.test(m[1])) put(m[1], { group, lag: m[2] });
      }
      continue;
    }
    // Huawei "display interface description": Interface PHY Protocol Description
    hi = lines.findIndex((l) => /^Interface\s+PHY\s+Protocol\s+Description/i.test(l));
    if (hi >= 0) {
      for (const l of lines.slice(hi + 1)) {
        // "(?=\S*\d)(\S+)" en vez de "(\S*\d\S*)", que era cuadrático en una línea larga.
        const m = l.match(/^(?=\S*\d)(\S+)\s+(\S+)\s+(\S+)\s*(.*)$/);
        if (m) put(m[1], { status: `${m[2]}/${m[3]}`, desc: m[4].trim() || undefined });
      }
      continue;
    }
    // Huawei "display interface brief": Interface PHY Protocol InUti OutUti inErrors outErrors
    hi = lines.findIndex((l) => /^Interface\s+PHY\s+Protocol/.test(l));
    if (hi >= 0) {
      for (const l of lines.slice(hi + 1)) {
        const m = l.match(/^(?=\S*\d)(\S+)\s+(\S+)\s+(\S+)(?:\s+\S+\s+\S+\s+(\d+)\b)?/);
        if (m) put(m[1], { status: `${m[2]}/${m[3]}`, inErr: m[4] });
      }
      continue;
    }
    // Cisco IOS/IOS-XE "show interfaces trunk": Port Mode Encapsulation Status Native vlan (primera tabla;
    // las siguientes, "Vlans allowed", repiten el puerto con listas de VLAN).
    hi = lines.findIndex((l) => /^Port\s+Mode\s+Encapsulation\s+Status\s+Native vlan/i.test(l));
    if (hi >= 0) {
      for (const l of lines.slice(hi + 1)) {
        if (!l.trim() || /^Port\s/.test(l)) break;
        const m = l.match(/^(\S+)\s+\S+\s+\S+\s+(\S+)\s+(\d{1,4})\s*$/);
        if (m && /^trunking$/i.test(m[2])) put(m[1], { native: m[3], vlan: "trunk" });
      }
      continue;
    }
    // Cisco "show interfaces counters errors" (IOS/IOS-XE/NX-OS): Port Align-Err FCS-Err Xmit-Err Rcv-Err ...
    hi = lines.findIndex((l) => /^Port\s+Align-Err\s+FCS-Err/.test(l));
    if (hi >= 0) {
      for (const l of lines.slice(hi + 1)) {
        // La segunda tabla (Single-Col, Multi-Col…) tiene otro encabezado: ahí termina la primera.
        if (/^Port\s/.test(l)) break;
        const m = l.match(/^(?=\S*\d)(\S+)\s+\d+\s+(\d+)\b/);
        if (m) put(m[1], { crc: m[2] });
      }
      continue;
    }
    // Huawei "display eth-trunk"
    if (/Eth-Trunk\d+'s state information/i.test(out)) {
      let group: string | undefined;
      for (const l of lines) {
        const g = l.match(/(Eth-Trunk\d+)'s state information/i);
        if (g) group = g[1];
        // Prefijo en un lookahead: "(?:…|\S*Ethernet)\S*\d" era cuadrático en una línea larga.
        const m = l.match(/^(?=\d+GE|XGE|GE|MultiGE|\S*Ethernet)(\S*\d)\s+(Up|Down|Selected|Unselect|Unselected|Indep)\b/i);
        if (m && group) put(m[1], { group, lag: m[2] });
      }
      continue;
    }
    // Junos "show interfaces descriptions": Interface Admin Link Description
    hi = lines.findIndex((l) => /^Interface\s+Admin\s+Link\s+Description/.test(l));
    if (hi >= 0) {
      for (const l of lines.slice(hi + 1)) {
        const m = l.match(/^(\S+)\s+(up|down)\s+(up|down)\s+(.*)$/);
        if (m) put(m[1], { status: `${m[2]}/${m[3]}`, desc: m[4].trim() });
      }
    }
  }
  return ports;
}

/** Puerto de un nodo: información conocida (si se leyó su estado). */
export const portOf = (n: TopoNode | undefined, port: string): PortInfo | undefined => n?.ports?.[canonPort(port)];

/** Máximo de direcciones que se guardan por equipo (un L3 con cientos de SVI no infla los datos). */
const MAX_ADDRS = 256;

/** Direcciones conocidas de un equipo: la de gestión y las aprendidas. */
export const knownAddrs = (n: TopoNode): string[] => [...new Set([n.ip, ...(n.addrs ?? [])].filter((x): x is string => !!x))];

const unionAddrs = (a: string[] | undefined, b: (string | undefined)[]) => {
  const all = [...new Set([...(a ?? []), ...b.filter((x): x is string => !!x)])];
  return all.length ? all.slice(0, MAX_ADDRS) : undefined;
};

/** Máximo de vecinos que se incorporan por equipo explorado (miles de pares BGP no congelan la vista). */
export const MAX_NEIGHBORS = 2000;
/** Largo máximo de nombres, plataformas y descripciones que llegan de un equipo. */
const MAX_DEVICE_TEXT = 255;
/** Control, formato invisible y dirección: el mismo conjunto que CONTROL_RANGES. */
const CONTROL_RE = /[\x00-\x1f\x7f-\x9f\u200b-\u200f\u2028-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g;
/** Texto que viene de un equipo: sin caracteres de control ni de dirección y con largo acotado. */
const clean = (s: string, max = MAX_DEVICE_TEXT) => s.replace(CONTROL_RE, "").slice(0, max);
/** Texto de un equipo (también por SNMP) limpio de control y dirección, con largo acotado. */
export const cleanDeviceText = clean;
const cleanOpt = (s: string | undefined, max = MAX_DEVICE_TEXT) => (s ? clean(s, max) || undefined : undefined);

function cleanNeighbor(n: Neighbor): Neighbor {
  return {
    ...n,
    name: clean(n.name),
    localPort: clean(n.localPort, LIMITS.port),
    remotePort: clean(n.remotePort, LIMITS.port),
    ip: n.ip && (isIpv4(n.ip) || isIpv6(n.ip)) ? n.ip : undefined,
    platform: cleanOpt(n.platform),
    group: cleanOpt(n.group, LIMITS.port),
    addrs: n.addrs?.filter(isIpv4),
    remoteNative: cleanOpt(n.remoteNative, 8),
    remoteDuplex: cleanOpt(n.remoteDuplex, 16),
    caps: cleanOpt(n.caps, 120),
  };
}

const PORT_FIELDS = ["status", "speed", "desc", "group", "duplex", "vlan", "native", "lag", "crc", "inErr"] as const;

function cleanPorts(ports: Record<string, PortInfo> | undefined): Record<string, PortInfo> | undefined {
  if (!ports) return undefined;
  const res: Record<string, PortInfo> = {};
  for (const [k, p] of Object.entries(ports)) {
    const key = clean(k, LIMITS.port);
    if (!key || UNSAFE_KEYS.has(key)) continue;
    const info: PortInfo = {};
    for (const f of PORT_FIELDS) {
      const v = cleanOpt(p[f], f === "desc" ? MAX_DEVICE_TEXT : LIMITS.port);
      if (v) info[f] = v;
    }
    res[key] = info;
  }
  return res;
}

/** Quita bucles y enlaces repetidos (mismo par de puertos y origen) tras fusionar equipos. */
function dedupeLinks(links: TopoLink[]): TopoLink[] {
  const seen = new Set<string>();
  return links.filter((l) => {
    if (l.a === l.b) return false;
    const k = `${linkKey(l)}|${l.proto}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * Incorpora los vecinos de un equipo al grafo (sin duplicar enlaces en ambos sentidos).
 * Los vecinos de ruteo (byAddr) se reconocen por cualquier dirección conocida; cuando un equipo
 * se explora, los nodos que solo se conocían por una de sus direcciones se fusionan con él.
 */
export function mergeNeighbors(
  t: Topology,
  device: { name: string; ip?: string; platform?: string; ports?: Record<string, PortInfo>; addrs?: string[]; macs?: Record<string, MacPort> },
  neighbors: Neighbor[],
): Topology {
  // Todo lo que informa el equipo se limpia aquí, antes de guardarse, exportarse o copiarse.
  device = { ...device, name: clean(device.name) || "?", ports: cleanPorts(device.ports), addrs: device.addrs?.filter(isIpv4) };
  neighbors = neighbors.map(cleanNeighbor).filter((n) => nodeId(n.name)).slice(0, MAX_NEIGHBORS);
  let nodes = t.nodes.map((n) => ({ ...n }));
  let links = t.links.map((l) => ({ ...l }));
  /** Absorbe los nodos conocidos solo por dirección que coinciden con alguna de `addrs`. */
  const absorb = (target: TopoNode, addrs: (string | undefined)[]) => {
    const set = new Set(addrs.filter(Boolean));
    if (!set.size) return;
    const found = nodes.filter((x) => x !== target && x.addrOnly && knownAddrs(x).some((a) => set.has(a)));
    // Sin nada que fusionar no se recorren los enlaces: con miles de vecinos era cuadrático.
    if (!found.length) return;
    for (const n of found) {
      target.addrs = unionAddrs(target.addrs, knownAddrs(n));
      if (!target.x && !target.y) {
        target.x = n.x;
        target.y = n.y;
      }
      for (const l of links) {
        if (l.a === n.id) l.a = target.id;
        if (l.b === n.id) l.b = target.id;
      }
      nodes = nodes.filter((x) => x !== n);
    }
    links = dedupeLinks(links);
  };
  const ensure = (name: string, extra: Partial<TopoNode> = {}) => {
    const id = nodeId(name);
    let n = nodes.find((x) => x.id === id);
    if (!n) {
      n = { id, name: name.replace(/\(.*\)$/, ""), explored: false, x: 0, y: 0 };
      nodes.push(n);
    }
    if (extra.ip && !n.ip) n.ip = extra.ip;
    if (extra.platform && !n.platform) n.platform = extra.platform;
    if (extra.caps) n.caps = extra.caps;
    if (extra.explored) {
      n.explored = true;
      // Un equipo explorado ya no es una suposición: deja de ser manual o solo-dirección.
      delete n.manual;
      delete n.addrOnly;
    }
    if (n.ip && !n.addrOnly) absorb(n, [n.ip]);
    return n;
  };
  const self = ensure(device.name, { ip: device.ip, platform: device.platform, explored: true });
  // Por puerto: lo que anunció un vecino (VLAN nativa, dúplex) se conserva junto a la lectura nueva.
  if (device.ports) {
    const merged: Record<string, PortInfo> = { ...self.ports };
    for (const [k, p] of Object.entries(device.ports)) merged[k] = { ...merged[k], ...p };
    self.ports = merged;
  }
  // La tabla MAC es una foto del momento: una lectura nueva reemplaza la anterior.
  if (device.macs) self.macs = device.macs;
  if (device.addrs?.length) self.addrs = unionAddrs(self.addrs, device.addrs);
  absorb(self, [device.ip, ...(device.addrs ?? [])]);
  const selfAddrs = new Set(knownAddrs(self));

  /** Vecino de ruteo: se busca por cualquier dirección conocida antes de crear un nodo nuevo. */
  const ensureAddr = (nb: Neighbor): TopoNode | null => {
    const addrs = nb.addrs?.length ? nb.addrs : [nb.ip ?? nb.name];
    if (addrs.some((a) => selfAddrs.has(a))) return null;
    const id = nodeId(nb.name);
    let n = nodes.find((x) => x.id === id) ?? nodes.find((x) => knownAddrs(x).some((a) => addrs.includes(a)));
    if (!n) {
      n = { id, name: nb.name, ip: nb.ip, explored: false, addrOnly: true, x: 0, y: 0 };
      nodes.push(n);
    }
    if (!n.ip) n.ip = nb.ip;
    n.addrs = unionAddrs(n.addrs, addrs);
    return n;
  };

  const same = (x: string, y: string) => !!x && !!y && canonPort(x) === canonPort(y);
  // Lo que este equipo informa se vuelve a anotar desde cero: un vecino que dejó de ver no queda como visto.
  for (const l of links) if (l.seenBy && (l.a === self.id || l.b === self.id)) l.seenBy = l.seenBy.filter((x) => x !== self.id);
  for (const nb of neighbors) {
    const other = nb.byAddr ? ensureAddr(nb) : ensure(nb.name, { ip: nb.ip, platform: nb.platform, caps: nb.caps });
    if (!other || other.id === self.id) continue;
    const aPort = nb.localPort ? shortPort(nb.localPort) : "";
    const bPort = nb.remotePort ? shortPort(nb.remotePort) : "";
    // VLAN nativa y dúplex que el vecino anuncia de su propio puerto.
    if (bPort && (nb.remoteNative || nb.remoteDuplex)) {
      const k = canonPort(bPort);
      if (!UNSAFE_KEYS.has(k)) {
        const cur = other.ports?.[k] ?? {};
        other.ports = {
          ...other.ports,
          [k]: { ...cur, ...(nb.remoteNative ? { native: nb.remoteNative } : {}), ...(nb.remoteDuplex ? { duplex: nb.remoteDuplex } : {}) },
        };
      }
    }
    if (nb.group && aPort) {
      const k = canonPort(aPort);
      self.ports = { ...self.ports, [k]: { ...self.ports?.[k], group: self.ports?.[k]?.group ?? shortPort(nb.group) } };
    }
    const pair = links.filter((l) => (l.a === self.id && l.b === other.id) || (l.a === other.id && l.b === self.id));
    const selfPort = (l: TopoLink) => (l.a === self.id ? l.aPort : l.bPort);
    const otherPort = (l: TopoLink) => (l.a === self.id ? l.bPort : l.aPort);
    // El mismo enlace visto desde el otro extremo (con otra nomenclatura de puertos).
    let dup = pair.find((l) => same(selfPort(l), aPort) || (l.a === other.id && same(otherPort(l), bPort)));
    // Un enlace de ruteo conocido desde el otro equipo, sin el puerto de este lado.
    if (!dup && aPort && !isPhysicalProto(nb.proto)) dup = pair.find((l) => l.proto === nb.proto && !selfPort(l) && l.a === other.id);
    // BGP sin interfaz: una sesión por par; si es directa y el par ya está unido, no aporta.
    if (!dup && nb.proto === "BGP" && !aPort) dup = pair.find((l) => l.proto === "BGP") ?? (nb.logical ? undefined : pair[0]);
    const link: TopoLink = { a: self.id, aPort, b: other.id, bPort, proto: nb.proto, ...(nb.logical ? { logical: true } : {}) };
    const seen = (l: TopoLink) => {
      if (isPhysicalProto(nb.proto)) l.seenBy = [...new Set([...(l.seenBy ?? []), self.id])];
    };
    seen(dup ?? link);
    if (!dup) links.push(link);
    else if (protoRank(nb.proto) > protoRank(dup.proto)) {
      // Un origen más confiable reemplaza al anterior (manual o ruteo confirmado por CDP/LLDP).
      const keepA = selfPort(dup);
      const keepB = otherPort(dup);
      Object.assign(dup, link, { aPort: aPort || keepA, bPort: bPort || keepB });
      if (!link.logical) delete dup.logical;
    } else if (aPort && !selfPort(dup)) {
      if (dup.a === self.id) dup.aPort = aPort;
      else dup.bPort = aPort;
    }
  }
  return layout({ nodes, links: dedupeLinks(links) });
}

/** Disposición por niveles desde el primer equipo explorado; respeta nodos ya movidos. */
export function layout(t: Topology): Topology {
  const placed = t.nodes.filter((n) => n.x || n.y);
  if (placed.length === t.nodes.length) return t;
  const root = t.nodes.find((n) => n.explored) ?? t.nodes[0];
  if (!root) return t;
  const level = new Map<string, number>([[root.id, 0]]);
  const queue = [root.id];
  while (queue.length) {
    const id = queue.shift()!;
    for (const l of t.links) {
      const other = l.a === id ? l.b : l.b === id ? l.a : null;
      if (other && !level.has(other)) {
        level.set(other, level.get(id)! + 1);
        queue.push(other);
      }
    }
  }
  // Equipos sin camino a la raíz (otra isla) quedan en una fila al final.
  const maxLevel = Math.max(0, ...level.values());
  const byLevel = new Map<number, string[]>();
  for (const n of t.nodes) {
    const lv = level.get(n.id) ?? maxLevel + 1;
    byLevel.set(lv, [...(byLevel.get(lv) ?? []), n.id]);
  }
  const nodes = t.nodes.map((n) => {
    if (n.x || n.y) return n;
    const lv = level.get(n.id) ?? maxLevel + 1;
    const row = byLevel.get(lv)!;
    const i = row.indexOf(n.id);
    return { ...n, x: 140 + i * 240 - ((row.length - 1) * 240) / 2 + 400, y: 80 + lv * 170 };
  });
  return { nodes, links: t.links };
}

/** Grupo (Port-channel, Eth-Trunk, ae) de un enlace, visto desde cualquiera de sus extremos. */
export function linkGroup(t: Topology, l: TopoLink, byId?: Map<string, TopoNode>): string | undefined {
  const a = byId ? byId.get(l.a) : t.nodes.find((n) => n.id === l.a);
  const b = byId ? byId.get(l.b) : t.nodes.find((n) => n.id === l.b);
  return portOf(a, l.aPort)?.group ?? portOf(b, l.bPort)?.group;
}

/** Ruta más corta (en saltos) entre dos equipos. Devuelve los enlaces en orden, o null. */
export function shortestPath(t: Topology, from: string, to: string): { nodes: string[]; links: TopoLink[] } | null {
  if (from === to) return { nodes: [from], links: [] };
  // Las sesiones BGP lógicas no son saltos físicos: solo se usan si no hay otro camino.
  const hops = t.links.filter((l) => !l.logical);
  return bfsPath(hops, from, to) ?? (hops.length < t.links.length ? bfsPath(t.links, from, to) : null);
}

function bfsPath(all: TopoLink[], from: string, to: string): { nodes: string[]; links: TopoLink[] } | null {
  const prev = new Map<string, { node: string; link: TopoLink }>();
  const seen = new Set([from]);
  const queue = [from];
  while (queue.length) {
    const id = queue.shift()!;
    for (const l of all) {
      const other = l.a === id ? l.b : l.b === id ? l.a : null;
      if (!other || seen.has(other)) continue;
      seen.add(other);
      prev.set(other, { node: id, link: l });
      if (other === to) {
        const nodes = [to];
        const links: TopoLink[] = [];
        let cur = to;
        while (cur !== from) {
          const p = prev.get(cur)!;
          links.unshift(p.link);
          nodes.unshift(p.node);
          cur = p.node;
        }
        return { nodes, links };
      }
      queue.push(other);
    }
  }
  return null;
}

/** Ruta en texto: equipo puerto → puerto equipo … (para pegar en un ticket). */
export function pathToText(t: Topology, path: { nodes: string[]; links: TopoLink[] }): string {
  const name = (id: string) => t.nodes.find((n) => n.id === id)?.name ?? id;
  const lines = [name(path.nodes[0])];
  path.links.forEach((l, i) => {
    const from = path.nodes[i];
    const [out, inn] = l.a === from ? [l.aPort, l.bPort] : [l.bPort, l.aPort];
    const via = isPhysicalProto(l.proto) ? "" : `  (${protoLabel(l)})`;
    lines.push(`  ${out || "?"} → ${inn || "?"}  ${name(path.nodes[i + 1])}${via}`);
  });
  return lines.join("\n");
}

/** Origen del enlace para etiquetas y exportaciones. */
export const protoLabel = (l: Pick<TopoLink, "proto" | "logical">) => (l.logical ? `${l.proto} lógica` : l.proto);

/** Estilo de línea por origen (SVG en pantalla y exportado, draw.io). */
export function linkDash(l: Pick<TopoLink, "proto" | "logical">): string | undefined {
  if (isPhysicalProto(l.proto)) return undefined;
  if (l.logical) return "3 5";
  if (isRoutingProto(l.proto)) return "8 5";
  if (l.proto === "manual") return "1.5 4";
  if (l.proto === "descripción") return "9 4 2 4";
  if (l.proto === "MAC/OUI") return "12 3 2 3 2 3";
  return "4 4";
}

/** Leyenda de estilos: [etiqueta, ejemplo de enlace]. */
export const LINK_LEGEND: [string, Pick<TopoLink, "proto" | "logical">][] = [
  ["CDP / LLDP", { proto: "CDP" }],
  ["Ruteo (OSPF, EIGRP, BGP)", { proto: "OSPF" }],
  ["Sesión BGP lógica", { proto: "BGP", logical: true }],
  ["Manual", { proto: "manual" }],
  ["Descripción", { proto: "descripción" }],
  ["MAC/OUI", { proto: "MAC/OUI" }],
];

/** Clave de un enlace independiente del sentido y de la nomenclatura de puertos. */
export const linkKey = (l: TopoLink) =>
  [`${l.a}|${canonPort(l.aPort)}`, `${l.b}|${canonPort(l.bPort)}`].sort().join("~");

export interface TopoDiff {
  addedLinks: TopoLink[];
  removedLinks: TopoLink[];
  addedNodes: string[];
  removedNodes: TopoNode[];
}

/** Diferencias entre una topología anterior (snapshot) y la actual. */
export function diffTopology(before: Topology, now: Topology): TopoDiff {
  const nowKeys = new Set(now.links.map(linkKey));
  const beforeKeys = new Set(before.links.map(linkKey));
  const nowIds = new Set(now.nodes.map((n) => n.id));
  const beforeIds = new Set(before.nodes.map((n) => n.id));
  return {
    addedLinks: now.links.filter((l) => !beforeKeys.has(linkKey(l))),
    removedLinks: before.links.filter((l) => !nowKeys.has(linkKey(l))),
    addedNodes: now.nodes.filter((n) => !beforeIds.has(n.id)).map((n) => n.id),
    removedNodes: before.nodes.filter((n) => !nowIds.has(n.id)),
  };
}

/** Diagrama en Mermaid (Confluence, GitLab, GitHub, Obsidian). */
export function toMermaid(t: Topology): string {
  // Nombres y puertos vienen de los equipos: sin comillas, HTML ni saltos de línea que cierren
  // la etiqueta y agreguen directivas (click, href) o marcado al renderizar el diagrama.
  // "#" primero: Mermaid decodifica entidades como "#60;" a "<" y reabriría el marcado.
  const safe = (s: string) =>
    s.replace(/[\r\n]+/g, " ").replace(XML_STRIP, "").replace(/#/g, "#35;").replace(/"/g, "'").replace(/</g, "#lt;").replace(/>/g, "#gt;");
  // Identificadores por posición: un nombre como "end" o una IP no rompen la sintaxis.
  const idx = new Map(t.nodes.map((n, i) => [n.id, `n${i}`]));
  const lines = ["graph TD"];
  for (const n of t.nodes) lines.push(`  ${idx.get(n.id)}["${safe(n.name)}${n.ip ? `<br/>${safe(n.ip)}` : ""}"]`);
  /** Índice de cada arista dibujada (linkStyle cuenta en orden de definición). */
  const macEdges: number[] = [];
  let edge = 0;
  for (const l of t.links) {
    const s = idx.get(l.a);
    const d = idx.get(l.b);
    if (!s || !d) continue;
    if (l.proto === "MAC/OUI") macEdges.push(edge);
    edge++;
    const g = linkGroup(t, l);
    const extra = [g, isPhysicalProto(l.proto) ? "" : protoLabel(l)].filter(Boolean).map((x) => safe(x!)).join(", ");
    // Línea punteada para lo que no es un enlace CDP/LLDP (ruteo, manual, descripción).
    const line = isPhysicalProto(l.proto) ? "---" : "-.-";
    lines.push(`  ${s} ${line}|"${safe(l.aPort || "?")} ↔ ${safe(l.bPort || "?")}${extra ? ` (${extra})` : ""}"| ${d}`);
  }
  // Enlaces sugeridos por MAC/OUI y confirmados: trazo propio para distinguirlos del resto.
  if (macEdges.length) lines.push(`  linkStyle ${macEdges.join(",")} stroke-dasharray:12 3 2 3 2 3`);
  return lines.join("\n");
}

/** CSV de enlaces y puertos; con `traffic`, agrega las últimas tasas y la utilización de cada enlace. */
export function toCsv(t: Topology, traffic?: Map<string, LinkTraffic>): string {
  const node = (id: string) => t.nodes.find((n) => n.id === id);
  // Nombres y descripciones vienen de los equipos (CDP/LLDP): una celda que empieza con
  // = + - @ sería una fórmula al abrir el CSV en Excel. Se antepone ' (OWASP CSV injection).
  const q = (s: string | undefined) => {
    const v = s ?? "";
    const formula = /^[=@\t\r]/.test(v) || /^[+-](?!\d+(\.\d+)?$)./.test(v);
    return `"${(formula ? `'${v}` : v).replace(/"/g, '""')}"`;
  };
  const withTraffic = !!traffic?.size;
  const num = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? "" : String(Math.round(n)));
  return [
    "equipo_a,ip_a,puerto_a,estado_a,velocidad_a,descripcion_a,equipo_b,ip_b,puerto_b,estado_b,velocidad_b,descripcion_b,agregado,protocolo" +
      (withTraffic ? ",trafico_a_b_bps,trafico_b_a_bps,velocidad_enlace_bps,utilizacion_pct,lectura,utilizacion_aproximada" : ""),
    ...t.links.map((l) => {
      const a = node(l.a);
      const b = node(l.b);
      const pa = portOf(a, l.aPort);
      const pb = portOf(b, l.bPort);
      const lt = traffic?.get(linkKey(l));
      return [
        a?.name ?? l.a, a?.ip, l.aPort, pa?.status, pa?.speed, pa?.desc,
        b?.name ?? l.b, b?.ip, l.bPort, pb?.status, pb?.speed, pb?.desc,
        linkGroup(t, l), protoLabel(l),
        ...(withTraffic
          ? [num(lt?.ab), num(lt?.ba), num(lt?.speed), lt?.util == null ? "" : (lt.util * 100).toFixed(1), lt ? new Date(lt.ts).toISOString() : "", lt?.approx ? "si" : ""]
          : []),
      ]
        .map(q)
        .join(",");
    }),
  ].join("\n");
}

/** Archivo .drawio (diagrams.net) editable, con los puertos como etiquetas en cada extremo. */
export function toDrawio(t: Topology, w = 170, h = 54): string {
  const esc = (s: string) =>
    xmlEsc(s).replace(/\n/g, "&#xa;");
  const idx = new Map(t.nodes.map((n, i) => [n.id, `n${i}`]));
  const cells = ['<mxCell id="0"/>', '<mxCell id="1" parent="0"/>'];
  for (const n of t.nodes) {
    const label = esc(n.ip ? `${n.name}\n${n.ip}` : n.name);
    const style = `rounded=1;whiteSpace=wrap;html=0;fillColor=${n.explored ? "#eaf1ff" : "#f4f5f7"};strokeColor=${n.explored ? "#2563eb" : "#9aa1ab"};fontStyle=1;`;
    cells.push(
      `<mxCell id="${idx.get(n.id)}" value="${label}" style="${style}" vertex="1" parent="1"><mxGeometry x="${Math.round(n.x - w / 2)}" y="${Math.round(n.y - h / 2)}" width="${w}" height="${h}" as="geometry"/></mxCell>`,
    );
  }
  t.links.forEach((l, i) => {
    const s = idx.get(l.a);
    const d = idx.get(l.b);
    if (!s || !d) return;
    const label = [linkGroup(t, l), isPhysicalProto(l.proto) ? "" : protoLabel(l)].filter(Boolean).join(" · ");
    const dash = linkDash(l);
    cells.push(
      `<mxCell id="e${i}" value="${esc(label)}" style="endArrow=none;html=0;strokeColor=#6a7280;fontSize=10;${dash ? `dashed=1;dashPattern=${dash};` : ""}" edge="1" parent="1" source="${s}" target="${d}"><mxGeometry relative="1" as="geometry"/></mxCell>`,
      `<mxCell id="e${i}a" value="${esc(l.aPort)}" style="edgeLabel;html=0;fontSize=10;" vertex="1" connectable="0" parent="e${i}"><mxGeometry x="-0.7" relative="1" as="geometry"><mxPoint as="offset"/></mxGeometry></mxCell>`,
      `<mxCell id="e${i}b" value="${esc(l.bPort)}" style="edgeLabel;html=0;fontSize=10;" vertex="1" connectable="0" parent="e${i}"><mxGeometry x="0.7" relative="1" as="geometry"><mxPoint as="offset"/></mxGeometry></mxCell>`,
    );
  });
  return [
    '<mxfile host="NetTerminal">',
    '<diagram name="Topologia" id="topologia">',
    '<mxGraphModel dx="1200" dy="800" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1600" pageHeight="1200" math="0" shadow="0">',
    `<root>${cells.join("")}</root>`,
    "</mxGraphModel>",
    "</diagram>",
    "</mxfile>",
  ].join("\n");
}

// ---------- Tráfico en enlaces ----------

/** Tráfico de un enlace en ambos sentidos, en bits/s, con la velocidad y la utilización. */
export interface LinkTraffic {
  /** De A hacia B (sale por aPort o entra por bPort). */
  ab: number | null;
  /** De B hacia A. */
  ba: number | null;
  /** Velocidad del enlace en bits/s (la menor informada por sus extremos). */
  speed?: number;
  /** Utilización (0 a 1) del sentido más cargado; sin velocidad conocida queda indefinida. */
  util?: number;
  /** La velocidad salió del "BW" configurado (consola), no de la velocidad física: utilización aproximada. */
  approx?: boolean;
  /** Momento de la lectura (ms). */
  ts: number;
  /** De dónde salió la lectura: contadores SNMP (IF-MIB) o comando de consulta por consola. */
  src?: "snmp" | "cli";
}

export type UtilLevel = "ok" | "warn" | "crit" | "none";
/** Umbrales de utilización: amarillo desde 70 %, rojo desde 90 %. */
export const UTIL_WARN = 0.7;
export const UTIL_CRIT = 0.9;
/** Distancia entre los puntos del flujo animado, en px (igual que el stroke-dasharray del CSS). */
export const FLOW_GAP = 16;

/**
 * Ritmo de la animación de un sentido del enlace: más tráfico, puntos más rápidos. Con la velocidad
 * del enlace se usa la utilización; sin ella, el volumen en escala logarítmica (1 kbps lento, 1 Gbps
 * rápido). Avanza en pasos de 30 por segundo (fluido a la vista, la mitad de repintados que a 60).
 */
export function flowTiming(bps: number | null | undefined, speed?: number): { dur: number; steps: number } {
  const b = Math.max(0, bps ?? 0);
  const rate = speed && speed > 0 ? Math.min(1, b / speed) : Math.min(1, Math.max(0, (Math.log10(b + 1) - 3) / 6));
  // Velocidad visual de 40 a 160 px/s sobre un ciclo de FLOW_GAP px (la distancia entre puntos).
  const dur = Math.round((FLOW_GAP / (40 + 120 * Math.sqrt(rate))) * 100) / 100;
  return { dur, steps: Math.max(3, Math.round(dur * 30)) };
}

export const utilLevel = (u: number | undefined): UtilLevel =>
  u === undefined || !Number.isFinite(u) ? "none" : u >= UTIL_CRIT ? "crit" : u >= UTIL_WARN ? "warn" : "ok";
/**
 * Colores fijos para el SVG exportado (en pantalla se usan los del tema). "none" (velocidad
 * desconocida) es gris violeta: distinto del azul de selección y ruta, con contraste 5,6:1
 * sobre blanco.
 */
export const UTIL_COLORS: Record<UtilLevel, string> = { ok: "#1a7f37", warn: "#bf8700", crit: "#cf222e", none: "#6e5f99" };
export const UTIL_LEGEND: [string, UtilLevel][] = [
  ["Utilización bajo 70 %", "ok"],
  ["Utilización de 70 % a 89 %", "warn"],
  ["Utilización de 90 % o más", "crit"],
];

/** Bits por segundo legibles: 950 b/s, 35 Mb/s, 1.2 Gb/s. */
export function fmtBps(bps: number | null | undefined): string {
  if (bps == null || !Number.isFinite(bps) || bps < 0) return "?";
  const u = ["b/s", "kb/s", "Mb/s", "Gb/s", "Tb/s"];
  let i = 0;
  let v = bps;
  while (v >= 999.5 && i < u.length - 1) {
    v /= 1000;
    i++;
  }
  return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)} ${u[i]}`;
}

/** Nombre corto para rótulos: hasta `max` caracteres con "…". */
export const shortName = (name: string, max = 16) => (name.length > max ? `${name.slice(0, max - 1)}…` : name);

/**
 * Etiqueta de un enlace con el equipo A explícito: "core-sw01 → 120 Mb/s · ← 35 Mb/s · 12 %".
 * "→" es lo que sale de A hacia el otro extremo y "←" lo que llega a A. Con la utilización
 * aproximada (velocidad desde el BW configurado) el porcentaje lleva "≈".
 */
/**
 * Rótulo corto para el mapa: el % de uso del sentido más cargado, o la tasa mayor si no se conoce
 * la velocidad del enlace. El detalle por sentido va en el tooltip y en la tabla del panel.
 */
export function trafficShort(lt: LinkTraffic): string {
  if (lt.util !== undefined) return `${lt.approx ? "≈" : ""}${Math.round(lt.util * 100)} %`;
  return fmtBps(Math.max(lt.ab ?? 0, lt.ba ?? 0));
}

export function trafficLabel(lt: LinkTraffic, aName?: string): string {
  const pct = lt.util === undefined ? "" : ` · ${lt.approx ? "≈" : ""}${Math.round(lt.util * 100)} %`;
  return `${aName ? `${shortName(aName)} ` : ""}→ ${fmtBps(lt.ab)} · ← ${fmtBps(lt.ba)}${pct}`;
}

// ---------- Geometría y SVG ----------

export type Pt = { x: number; y: number };

/** Punto de una curva cuadrática A-C-B en t. */
export const quad = (a: Pt, c: Pt, b: Pt, t: number): Pt => ({
  x: (1 - t) ** 2 * a.x + 2 * (1 - t) * t * c.x + t ** 2 * b.x,
  y: (1 - t) ** 2 * a.y + 2 * (1 - t) * t * c.y + t ** 2 * b.y,
});

/** Geometría de cada enlace: los paralelos entre el mismo par se separan en curvas. */
export function linkGeometry(t: Topology, links: TopoLink[], gap = 26) {
  const byPair = new Map<string, TopoLink[]>();
  for (const l of links) {
    const k = [l.a, l.b].sort().join("~");
    const list = byPair.get(k);
    if (list) list.push(l);
    else byPair.set(k, [l]);
  }
  const pos = new Map(t.nodes.map((n) => [n.id, n]));
  return links.flatMap((l) => {
    const a = pos.get(l.a);
    const b = pos.get(l.b);
    if (!a || !b) return [];
    const sibs = byPair.get([l.a, l.b].sort().join("~"))!;
    const i = sibs.indexOf(l);
    // El sentido de la normal se fija por el orden alfabético del par, no del enlace.
    const [p, q] = l.a < l.b ? [a, b] : [b, a];
    const dx = q.x - p.x;
    const dy = q.y - p.y;
    const len = Math.hypot(dx, dy) || 1;
    const off = (i - (sibs.length - 1) / 2) * gap;
    const c = { x: (a.x + b.x) / 2 + (-dy / len) * off * 2, y: (a.y + b.y) / 2 + (dx / len) * off * 2 };
    return [{ l, a, b, c, d: `M ${a.x} ${a.y} Q ${c.x} ${c.y} ${b.x} ${b.y}`, pa: quad(a, c, b, sibs.length > 1 ? 0.3 : 0.22), pb: quad(a, c, b, sibs.length > 1 ? 0.7 : 0.78), mid: quad(a, c, b, 0.5), pair: sibs }];
  });
}

/** Texto seguro dentro de un SVG/XML. */
export const xmlEsc = (s: string) =>
  s.replace(XML_STRIP, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** Caracteres que XML 1.0 no admite o que invierten el texto: se quitan (salto de línea y tab se conservan). */
const XML_STRIP = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f\u200b-\u200f\u2028-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g;

/**
 * SVG autónomo (colores fijos claros) para documentación, con leyenda si hay enlaces no CDP/LLDP.
 * Con `traffic`, cada enlace con datos lleva su color de utilización y la última tasa por sentido.
 */
export function toSvg(t: Topology, W = 170, H = 54, traffic?: Map<string, LinkTraffic>): string {
  if (!t.nodes.length) return "";
  const xs = t.nodes.map((n) => n.x);
  const ys = t.nodes.map((n) => n.y);
  const allKinds = LINK_LEGEND.filter(([, s]) => t.links.some((l) => linkDash(l) === linkDash(s)));
  const kinds = allKinds.some(([, s]) => linkDash(s)) ? allKinds : [];
  const withTraffic = t.links.some((l) => traffic?.has(linkKey(l)));
  const trafficRows: [string, string][] = withTraffic
    ? [
        ...UTIL_LEGEND.map(([text, lv]): [string, string] => [text, UTIL_COLORS[lv]]),
        ["Velocidad desconocida", UTIL_COLORS.none],
        ["Rótulo: % de uso del sentido más cargado (≈: aproximada); sin velocidad, la tasa mayor", "#8a919c"],
      ]
    : [];
  // Tabla de enlaces por carga bajo la leyenda (como el botón "Enlaces" de la app): el SVG no tiene tooltip.
  const loadRows = withTraffic
    ? t.links
        .flatMap((l) => {
          const lt = traffic!.get(linkKey(l));
          if (!lt) return [];
          const nm = (id: string) => t.nodes.find((n) => n.id === id)?.name ?? id;
          return [{ lt, text: `${nm(l.a)} ${l.aPort || "?"} ↔ ${nm(l.b)} ${l.bPort || "?"}: ${trafficLabel(lt)}` }];
        })
        .sort((x, y) => (y.lt.util ?? -1) - (x.lt.util ?? -1) || Math.max(y.lt.ab ?? 0, y.lt.ba ?? 0) - Math.max(x.lt.ab ?? 0, x.lt.ba ?? 0))
    : [];
  const legendRows = kinds.length + trafficRows.length + (loadRows.length ? loadRows.length + 1 : 0);
  const legendH = legendRows ? legendRows * 18 + 16 : 0;
  const minX = Math.min(...xs) - W / 2 - 40;
  const minY = Math.min(...ys) - H / 2 - 40;
  // Ancho para la fila más larga de la tabla de enlaces (en mapas chicos no cabría).
  const w = Math.max(Math.max(...xs) - minX + W / 2 + 40, 80 + Math.max(0, ...loadRows.map((r) => r.text.length)) * 6.2);
  const h = Math.max(...ys) - minY + H / 2 + 40 + legendH;
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${minX} ${minY} ${w} ${h}" width="${w}" height="${h}" font-family="Helvetica, Arial, sans-serif">`,
    `<rect x="${minX}" y="${minY}" width="${w}" height="${h}" fill="#ffffff"/>`,
  ];
  const label = (p: Pt, text: string, weight = 400, fill = "#1f2328") =>
    `<text x="${p.x}" y="${p.y}" font-size="11" font-weight="${weight}" fill="${fill}" text-anchor="middle" paint-order="stroke" stroke="#fff" stroke-width="4">${xmlEsc(text)}</text>`;
  const pill = (p: Pt, text: string, color: string) => {
    const w = text.length * 6.4 + 12;
    return `<rect x="${(p.x - w / 2).toFixed(1)}" y="${p.y - 9}" width="${w.toFixed(1)}" height="18" rx="9" fill="#fff" stroke="${color}" stroke-width="1.25"/><text x="${p.x}" y="${p.y + 3.8}" font-size="11" font-weight="600" fill="${color}" text-anchor="middle">${xmlEsc(text)}</text>`;
  };
  const geo = linkGeometry(t, t.links);
  // Un rótulo de tráfico por par de equipos (los paralelos comparten uno, con el agregado y el peor uso).
  const pairOf = (l: TopoLink) => [l.a, l.b].sort().join("~");
  const pills = new Map<string, { mids: Pt[]; worst?: LinkTraffic; grp?: string; n: number }>();
  for (const g of geo) {
    const lt = traffic?.get(linkKey(g.l));
    const e = pills.get(pairOf(g.l)) ?? { mids: [], n: g.pair.length, grp: g.pair.length > 1 ? linkGroup(t, g.l) : undefined };
    e.mids.push(g.mid);
    if (lt && (!e.worst || (lt.util ?? -1) > (e.worst.util ?? -1))) e.worst = lt;
    pills.set(pairOf(g.l), e);
  }
  const groups = new Set<string>();
  for (const g of geo) {
    const dash = linkDash(g.l);
    const lt = traffic?.get(linkKey(g.l));
    const stroke = lt ? UTIL_COLORS[utilLevel(lt.util)] : "#8a919c";
    const width = lt ? (2 + 3 * Math.min(1, lt.util ?? 0)).toFixed(1) : "2";
    parts.push(`<path d="${g.d}" fill="none" stroke="${stroke}" stroke-width="${width}"${dash ? ` stroke-dasharray="${dash}" stroke-linecap="round"` : ""}/>`);
    if (g.l.aPort) parts.push(label(g.pa, g.l.aPort));
    if (g.l.bPort) parts.push(label(g.pb, g.l.bPort));
    const grp = linkGroup(t, g.l);
    const gk = `${[g.l.a, g.l.b].sort().join("~")}|${grp}`;
    if (pills.get(pairOf(g.l))?.worst) continue;
    if (grp && g.pair.length > 1 && !groups.has(gk)) {
      groups.add(gk);
      parts.push(label(g.mid, `${grp} ×${g.pair.length}`, 600));
    } else if (isRoutingProto(g.l.proto) || g.l.proto === "MAC/OUI") parts.push(label(g.mid, protoLabel(g.l), 600, "#636b78"));
  }
  for (const e of pills.values()) {
    if (!e.worst) continue;
    const p = { x: e.mids.reduce((a, m) => a + m.x, 0) / e.mids.length, y: e.mids.reduce((a, m) => a + m.y, 0) / e.mids.length };
    const short = trafficShort(e.worst);
    parts.push(pill(p, e.n > 1 ? `${e.grp ? `${e.grp} ×${e.n}` : "máx"} · ${short}` : short, UTIL_COLORS[utilLevel(e.worst.util)]));
  }
  for (const n of t.nodes) {
    parts.push(
      `<rect x="${n.x - W / 2}" y="${n.y - H / 2}" width="${W}" height="${H}" rx="10" fill="${n.explored ? "#eaf1ff" : "#f4f5f7"}" stroke="${n.explored ? "#2563eb" : "#c3c8d0"}" stroke-width="1.5"${n.manual || n.addrOnly ? ' stroke-dasharray="4 3"' : ""}/>`,
      `<text x="${n.x}" y="${n.y - 4}" font-size="13" font-weight="600" fill="#1f2328" text-anchor="middle">${xmlEsc(n.name)}</text>`,
    );
    if (n.ip && n.ip !== n.name) parts.push(`<text x="${n.x}" y="${n.y + 14}" font-size="11" fill="#636b78" text-anchor="middle">${xmlEsc(n.ip)}</text>`);
  }
  if (legendH) {
    const y0 = minY + h - legendH + 8;
    const row = (i: number, text: string, stroke: string, dash?: string, width = 2) => {
      const y = y0 + i * 18 + 6;
      parts.push(
        `<line x1="${minX + 16}" y1="${y}" x2="${minX + 56}" y2="${y}" stroke="${stroke}" stroke-width="${width}"${dash ? ` stroke-dasharray="${dash}" stroke-linecap="round"` : ""}/>`,
        `<text x="${minX + 64}" y="${y + 4}" font-size="11" fill="#1f2328">${xmlEsc(text)}</text>`,
      );
    };
    kinds.forEach(([text, s], i) => row(i, text, "#8a919c", linkDash(s)));
    trafficRows.forEach(([text, color], i) => row(kinds.length + i, text, color, undefined, 4));
    if (loadRows.length) {
      const base = kinds.length + trafficRows.length;
      parts.push(`<text x="${minX + 16}" y="${y0 + base * 18 + 10}" font-size="11" font-weight="600" fill="#1f2328">Enlaces por carga (→ sale del primer equipo · ← llega a él)</text>`);
      loadRows.forEach((r, i) => row(base + 1 + i, r.text, UTIL_COLORS[utilLevel(r.lt.util)], undefined, 4));
    }
  }
  parts.push("</svg>");
  return parts.join("\n");
}

// ---------- Equipos y enlaces manuales ----------

export const LIMITS = { name: 64, port: 64, platform: 120 } as const;

/** Caracteres de control, de formato invisibles o de dirección (spoofing de texto). */
const CONTROL_RANGES: [number, number][] = [[0x00, 0x1f], [0x7f, 0x9f], [0x200b, 0x200f], [0x2028, 0x202e], [0x2060, 0x2064], [0x2066, 0x2069], [0xfeff, 0xfeff]];
const hasControl = (s: string) =>
  [...s].some((ch) => {
    const c = ch.codePointAt(0)!;
    return CONTROL_RANGES.some(([a, b]) => c >= a && c <= b);
  });

export type TopoResult = { topo: Topology; error?: undefined } | { topo?: undefined; error: string };

function checkText(label: string, v: string, max: number, required: boolean): string | null {
  if (!v) return required ? `${label}: obligatorio` : null;
  if (v.length > max) return `${label}: máximo ${max} caracteres`;
  if (hasControl(v)) return `${label}: tiene caracteres de control`;
  return null;
}

export interface ManualNodeInput {
  name: string;
  ip?: string;
  platform?: string;
}

/** Valida y normaliza un equipo manual. */
export function validateManualNode(input: ManualNodeInput): { value?: ManualNodeInput; error?: string } {
  const name = input.name.trim();
  const ip = input.ip?.trim() ?? "";
  const platform = input.platform?.trim() ?? "";
  const err =
    checkText("Nombre", name, LIMITS.name, true) ??
    (!nodeId(name) ? "Nombre: no válido" : null) ??
    checkText("Plataforma", platform, LIMITS.platform, false) ??
    (ip && !isIpv4(ip) && !isIpv6(ip) ? "IP de gestión: formato no válido (IPv4 o IPv6)" : null);
  if (err) return { error: err };
  return { value: { name, ip: ip || undefined, platform: platform || undefined } };
}

export function addManualNode(t: Topology, input: ManualNodeInput): TopoResult {
  const { value, error } = validateManualNode(input);
  if (!value) return { error: error! };
  const id = nodeId(value.name);
  if (t.nodes.some((n) => n.id === id)) return { error: `Ya existe un equipo "${value.name}"` };
  if (value.ip && t.nodes.some((n) => knownAddrs(n).includes(value.ip!))) return { error: `La IP ${value.ip} ya pertenece a otro equipo` };
  const node: TopoNode = { id, name: value.name, explored: false, manual: true, x: 0, y: 0 };
  if (value.ip) node.ip = value.ip;
  if (value.platform) node.platform = value.platform;
  return { topo: layout({ ...t, nodes: [...t.nodes, node] }) };
}

/** Edita un equipo manual; si cambia el nombre, cambia su id y se actualizan sus enlaces. */
export function updateManualNode(t: Topology, id: string, input: ManualNodeInput): TopoResult {
  const cur = t.nodes.find((n) => n.id === id);
  if (!cur?.manual) return { error: "Solo se pueden editar equipos agregados a mano" };
  const { value, error } = validateManualNode(input);
  if (!value) return { error: error! };
  const nid = nodeId(value.name);
  if (nid !== id && t.nodes.some((n) => n.id === nid)) return { error: `Ya existe un equipo "${value.name}"` };
  if (value.ip && t.nodes.some((n) => n.id !== id && knownAddrs(n).includes(value.ip!))) return { error: `La IP ${value.ip} ya pertenece a otro equipo` };
  const nodes = t.nodes.map((n) => (n.id === id ? { ...n, id: nid, name: value.name, ip: value.ip, platform: value.platform } : n));
  const links = t.links.map((l) => ({ ...l, a: l.a === id ? nid : l.a, b: l.b === id ? nid : l.b }));
  return { topo: { ...t, nodes, links } };
}

/** Borra un equipo manual y todos sus enlaces. */
export function deleteManualNode(t: Topology, id: string): TopoResult {
  if (!t.nodes.find((n) => n.id === id)?.manual) return { error: "Solo se pueden borrar equipos agregados a mano" };
  return { topo: { ...t, nodes: t.nodes.filter((n) => n.id !== id), links: t.links.filter((l) => l.a !== id && l.b !== id) } };
}

export interface ManualLinkInput {
  a: string;
  aPort: string;
  b: string;
  bPort: string;
}

export const sameLink = (x: TopoLink, y: TopoLink) => x.a === y.a && x.b === y.b && x.aPort === y.aPort && x.bPort === y.bPort && x.proto === y.proto;

function buildManualLink(t: Topology, input: ManualLinkInput, proto: LinkProto, except?: TopoLink): { link?: TopoLink; error?: string } {
  const aPort = input.aPort.trim();
  const bPort = input.bPort.trim();
  if (!t.nodes.some((n) => n.id === input.a)) return { error: "Equipo A: elige un equipo del diagrama" };
  if (!t.nodes.some((n) => n.id === input.b)) return { error: "Equipo B: elige un equipo del diagrama" };
  if (input.a === input.b) return { error: "Los extremos deben ser equipos distintos" };
  const err = checkText("Interfaz A", aPort, LIMITS.port, false) ?? checkText("Interfaz B", bPort, LIMITS.port, false);
  if (err) return { error: err };
  if (/\s/.test(aPort) || /\s/.test(bPort)) return { error: "Las interfaces no llevan espacios (ej: Gi1/0/1)" };
  const link: TopoLink = { a: input.a, aPort: aPort ? shortPort(aPort) : "", b: input.b, bPort: bPort ? shortPort(bPort) : "", proto };
  const k = linkKey(link);
  if (t.links.some((l) => (!except || !sameLink(l, except)) && linkKey(l) === k)) return { error: "Ese enlace ya existe en el diagrama" };
  return { link };
}

export function addManualLink(t: Topology, input: ManualLinkInput, proto: LinkProto = "manual"): TopoResult {
  const { link, error } = buildManualLink(t, input, proto);
  if (!link) return { error: error! };
  return { topo: { ...t, links: [...t.links, link] } };
}

/** Edita un enlace manual o confirmado desde una sugerencia (conserva su origen). */
export function updateManualLink(t: Topology, old: TopoLink, input: ManualLinkInput): TopoResult {
  const i = t.links.findIndex((l) => sameLink(l, old));
  if (i < 0 || !isUserProto(old.proto)) return { error: "Solo se pueden editar enlaces agregados a mano" };
  const { link, error } = buildManualLink(t, input, old.proto as LinkProto, old);
  if (!link) return { error: error! };
  return { topo: { ...t, links: t.links.map((l, j) => (j === i ? link : l)) } };
}

export function deleteManualLink(t: Topology, old: TopoLink): TopoResult {
  if (!isUserProto(old.proto) || !t.links.some((l) => sameLink(l, old))) return { error: "Solo se pueden borrar enlaces agregados a mano" };
  return { topo: { ...t, links: t.links.filter((l) => !sameLink(l, old)) } };
}

// ---------- Fuentes de descubrimiento y sugerencias ----------

/**
 * Fuentes opcionales (CDP/LLDP y lo manual están siempre disponibles). Cada una se habilita por
 * separado en Topología y se guarda en los ajustes; apagada, no envía ningún comando.
 * Para sumar una fuente: agrega su id aquí, su definición en TOPO_SOURCES y, si propone
 * enlaces, un generador en SUGGESTERS que devuelva LinkSuggestion con su `source`.
 */
export type TopoSourceId = "routing" | "descriptions" | "mac";
export type TopoSources = Partial<Record<TopoSourceId, boolean>>;

export interface TopoSourceDef {
  id: TopoSourceId;
  label: string;
  /** Nombre corto para rotular sugerencias. */
  short: string;
  hint: string;
  /**
   * discovery: ejecuta comandos al descubrir (y puede proponer enlaces en SUGGESTERS);
   * suggestions: no ejecuta comandos, solo propone enlaces por confirmar.
   */
  kind: "discovery" | "suggestions";
}

export const TOPO_SOURCES: TopoSourceDef[] = [
  {
    id: "routing",
    label: "Vecinos de ruteo (OSPF/EIGRP/BGP)",
    short: "Ruteo",
    hint: "Para equipos con CDP/LLDP apagado: suma consultas de ruteo y direcciones al descubrir.",
    kind: "discovery",
  },
  {
    id: "descriptions",
    label: "Sugerencias por descripción de interfaz",
    short: "Descripción",
    hint: "Propone enlaces desde descripciones como \"UPLINK a dist-sw01 Gi1/0/48\" (requiere Estado de puertos). Tú confirmas cada uno.",
    kind: "suggestions",
  },
  {
    id: "mac",
    label: "Sugerencias por MAC/fabricante (OUI)",
    short: "MAC/OUI",
    hint: "Lee tablas MAC y ARP al descubrir y propone enlaces en puertos sin CDP/LLDP (HSRP/VRRP, fabricante, cantidad de MAC). Tú confirmas cada uno.",
    kind: "discovery",
  },
];

export const sourceOn = (s: TopoSources | undefined, id: TopoSourceId) => s?.[id] === true;

export type SuggestionConfidence = "alta" | "media" | "baja";

/** Enlace propuesto por una fuente de sugerencias; nunca se dibuja hasta que el usuario lo confirma. */
export interface LinkSuggestion {
  /** Estable entre lecturas: sirve para descartarla. */
  id: string;
  source: TopoSourceId;
  /** Origen con que queda el enlace al confirmarlo. */
  proto: LinkProto;
  confidence: SuggestionConfidence;
  a: string;
  aPort: string;
  /** Nombre o IP del otro extremo (puede no existir aún en el diagrama). */
  target: string;
  bPort: string;
  /** Texto que la originó (por ejemplo, la descripción de la interfaz). */
  reason: string;
  /** Resumen del puerto (fuente MAC/OUI): fabricantes, cantidad de MAC e IP según ARP. */
  detail?: { vendors: string[]; macs: number; ip?: string };
  /** Equipo que se crea al confirmar, con id propio (fuente MAC/OUI). */
  node?: { id: string; name: string; ip?: string; platform?: string };
}

const HOST_RE = String.raw`([A-Za-z][\w.-]{1,62}|\d{1,3}(?:\.\d{1,3}){3})`;
const PORT_RE =
  /^(?:gi(?:gabitethernet)?|gige|te(?:ngig\w*)?|fa(?:stethernet)?|fo(?:rtygig\w*)?|hu(?:ndredgig\w*)?|twe(?:ntyfivegig\w*)?|eth(?:ernet)?|ge|xe|et|mge|ae|po(?:rt-channel)?|port|eth-trunk|xge|\d{2,3}ge|multige|be|bundle-ether|wan|lan|mgmt|dmz)-?\d+(?:[/:.]\d+)*$/i;
/** Nombres que parecen interfaces o VLAN, no equipos. */
const IFACE_LIKE = /^(?:gi|gig|te|fa|fo|hu|twe|eth|ethernet|ge|xe|et|mge|ae|po|port|vlan|vlanif|vl|lo|loopback|mgmt|tunnel|tu|be|xge|irb|em|fxp|me|wan|lan|dmz|ckt|cid)-?\d/i;
const NOT_HOST = new Set(["wi-fi", "e-mail", "n-a", "to-do", "end-user", "end-users"]);
const LINK_WORD = String.raw`(?:up|down)?link|enlace|conexi[oó]n|conectad[oa]|troncal|trunk|isl|peer-?link`;
const DESC_RES = [
  // Palabra de enlace + preposición opcional + equipo: "UPLINK a dist-sw01 Gi1/0/48".
  new RegExp(String.raw`(?<![\w-])(?:${LINK_WORD})(?![\w])[\s:_-]*(?:(?:to|a|al|hacia|con|towards)(?![\w])[\s:_-]*)?${HOST_RE}(?![\w/])(?:[\s:_,-]+(\S+))?`, "gi"),
  // Preposición direccional sola: "to core-sw02 Te1/1/1", "hacia fw-borde01".
  new RegExp(String.raw`(?:^|[\s\[(<:_-])(?:to|hacia|towards)(?![\w])[\s:_-]*${HOST_RE}(?![\w/])(?:[\s:_,-]+(\S+))?`, "gi"),
];

const looksLikeHost = (h: string) =>
  isIpv4(h) || (h.length >= 3 && /[\d_-]/.test(h) && !/^\d/.test(h) && !IFACE_LIKE.test(h) && !NOT_HOST.has(h.toLowerCase()));

/**
 * Equipo (y puerto) mencionado en una descripción de interfaz. Heurística conservadora en
 * español e inglés: exige una palabra de enlace o una preposición direccional, y que el nombre
 * parezca un hostname (con dígito, guion o guion bajo) o una IPv4.
 */
export function parseDescriptionHint(desc: string): { host: string; port?: string } | null {
  if (!desc || desc.length > 240) return null;
  for (const re of DESC_RES) {
    for (const m of desc.matchAll(re)) {
      const host = m[1].replace(/[.-]+$/, "");
      if (!looksLikeHost(host)) continue;
      const p = m[2]?.replace(/[),.;]+$/, "");
      return { host, port: p && PORT_RE.test(p) ? p : undefined };
    }
  }
  return null;
}

/** Interfaz legible desde su forma canónica: "gi1/0/48" -> "Gi1/0/48". */
function prettyPort(k: string): string {
  return /^(hu|fo|twe|te|gi|fa|po|eth)\d/.test(k) ? k[0].toUpperCase() + k.slice(1) : k;
}

/** Equipo del diagrama que corresponde a un nombre o IP. */
export const findNode = (t: Topology, nameOrIp: string) =>
  t.nodes.find((n) => n.id === nodeId(nameOrIp)) ?? (isIpv4(nameOrIp) ? t.nodes.find((n) => knownAddrs(n).includes(nameOrIp)) : undefined);

/** Sugerencias desde las descripciones de interfaz ya leídas (no ejecuta comandos). */
export function suggestFromDescriptions(t: Topology): LinkSuggestion[] {
  const res: LinkSuggestion[] = [];
  const onPort = (id: string, port: string) =>
    t.links.some((l) => (l.a === id && canonPort(l.aPort) === canonPort(port)) || (l.b === id && canonPort(l.bPort) === canonPort(port)));
  for (const n of t.nodes) {
    for (const [k, info] of Object.entries(n.ports ?? {})) {
      if (!info.desc) continue;
      const hint = parseDescriptionHint(info.desc);
      if (!hint) continue;
      const target = findNode(t, hint.host);
      if (target?.id === n.id || nodeId(hint.host) === n.id) continue;
      // Ya hay un enlace en ese puerto (de cualquier origen), o el otro extremo ya lo informa.
      if (onPort(n.id, k) || (target && hint.port && onPort(target.id, hint.port))) continue;
      res.push({
        id: `descriptions|${n.id}|${k}`,
        source: "descriptions",
        proto: "descripción",
        confidence: target && hint.port ? "alta" : target || hint.port ? "media" : "baja",
        a: n.id,
        aPort: prettyPort(k),
        target: target?.name ?? hint.host,
        bPort: hint.port ? shortPort(hint.port) : "",
        reason: info.desc,
      });
    }
  }
  return res;
}

// ---------- Sugerencias por MAC/fabricante (OUI) ----------

/**
 * Tablas MAC y ARP (solo consulta). Se ejecutan al descubrir únicamente con la fuente "mac" activa.
 * Formatos verificados en la documentación de cada fabricante:
 * - Cisco IOS/IOS-XE "show mac address-table" (Vlan, Mac Address, Type, Ports; la MAC propia de
 *   una SVI aparece STATIC en "Vl100"): Cisco, "Troubleshoot Mac Address Table Manager on Catalyst
 *   9000 Switches", Document ID 222060,
 *   https://www.cisco.com/c/en/us/support/docs/switches/catalyst-9300-series-switches/222060-troubleshoot-mac-address-table-manager-o.html
 * - Cisco IOS "show ip arp" (Protocol, Address, Age (min), Hardware Addr, Type, Interface; "a hyphen
 *   (-) means the address is local"): Cisco IOS Command Reference, "show ip arp",
 *   https://www.cisco.com/E-Learning/bulk/public/tac/cim/cib/using_cisco_ios_software/cmdrefs/show_ip_arp.htm
 * - Cisco NX-OS "show mac address-table" (leyenda "G - Gateway MAC, (R) - Routed MAC"; VLAN, MAC
 *   Address, Type, age, Secure, NTFY, Ports) y "show ip arp" (Address, Age, MAC Address, Interface,
 *   Flags): Cisco, "Verify Nexus 9000 Series ARP and MAC Table Sync Behavior", Document ID 213962,
 *   https://www.cisco.com/c/en/us/support/docs/switches/nexus-9000-series-switches/213962-nexus-9000-arp-mac-table-sync-behavio.html
 * - Huawei VRP "display mac-address" (MAC Address, VLAN/VSI/BD, Learned-From, Type) y "display arp"
 *   (IP ADDRESS, MAC ADDRESS, EXPIRE(M), TYPE, INTERFACE; TYPE "I" = MAC de la propia interfaz):
 *   Huawei, S1720, S2700, S5700, and S6720 V200R011C10 Command Reference, capítulos "MAC Address
 *   Table Configuration Commands" y "ARP Configuration Commands",
 *   https://support.huawei.com/enterprise/en/doc/EDOC1000178165/7404084d/mac-address-table-configuration-commands
 *   https://support.huawei.com/enterprise/en/doc/EDOC1000178165/bbf12ab5/arp-configuration-commands
 * - Junos "show ethernet-switching table": formato clásico de EX (VLAN, MAC address, Type, Age,
 *   Interfaces; la MAC propia figura como "Router") y formato ELS (Vlan name, MAC address, MAC
 *   flags, Age, Logical interface):
 *   https://juniper.net/documentation/en_US/junos13.2/topics/reference/command-summary/show-ethernet-switching-table-bridging-ex-series.html
 *   https://www.juniper.net/documentation/us/en/software/junos/ovsdb-vxlan/topics/task/vxlan-mac-learning-qfx-series.html
 * - Junos "show arp no-resolve" (MAC Address, Address, Interface, Flags; en IRB la interfaz física
 *   va entre corchetes): https://www.juniper.net/documentation/us/en/software/junos/cli-reference/topics/ref/command/show-arp.html
 * FortiOS queda fuera: no hay un comando de consulta equivalente verificado para la tabla MAC del
 * FortiGate.
 */
export const MAC_COMMANDS: Record<TopoVendor, string[]> = {
  cisco: ["show mac address-table", "show ip arp"],
  huawei: ["display mac-address", "display arp"],
  juniper: ["show ethernet-switching table", "show arp no-resolve"],
  fortinet: [],
};

/** Fabricante de un OUI (prefijo de 24 bits) según el registro MA-L del IEEE. */
export interface OuiInfo {
  vendor: string;
  /** net: equipo de red o infraestructura; host: tarjeta de PC, servidor o máquina virtual. */
  kind: "net" | "host";
}
export type OuiLookup = (mac: string) => OuiInfo | undefined;

/** Una MAC vista en un puerto local. */
export interface MacEntry {
  /** Formato aaaa.bbbb.cccc en minúsculas. */
  mac: string;
  vlan?: string;
  /** IP según la tabla ARP del mismo equipo. */
  ip?: string;
  vendor?: string;
  kind?: OuiInfo["kind"];
  /** MAC virtual de HSRP o VRRP (descripción legible). */
  fhrp?: string;
}

export interface MacPort {
  /** Interfaz como la informa el equipo, abreviada (Gi1/0/5, GE0/0/1, ge-0/0/3). */
  port: string;
  /** MAC únicas vistas en el puerto (puede ser mayor que las guardadas). */
  total: number;
  /** Primero las FHRP, luego las de equipos de red, el resto hasta MAX_MACS_PER_PORT. */
  macs: MacEntry[];
}

/** Desde cuántas MAC en un puerto se presume un switch u otro equipo aguas abajo. */
export const MANY_MACS = 4;
/** Límites de lo que se guarda con el diagrama (una tabla de miles de MAC no infla los datos). */
const MAX_MACS_PER_PORT = 16;
const MAX_MAC_PORTS = 256;

/** MAC en cualquier formato a aaaa.bbbb.cccc; null si no son 12 dígitos hexadecimales. */
export function normMac(s: string): string | null {
  const hex = s.replace(/[.:-]/g, "").toLowerCase();
  if (!/^[0-9a-f]{12}$/.test(hex)) return null;
  return `${hex.slice(0, 4)}.${hex.slice(4, 8)}.${hex.slice(8)}`;
}

const firstOctet = (mac: string) => parseInt(mac.replace(/[^0-9a-f]/gi, "").slice(0, 2), 16);
/** Bit I/G (0x01 del primer octeto): multicast o broadcast (IEEE Std 802, sección 8.2). */
export const isMulticastMac = (mac: string) => (firstOctet(mac) & 0x01) === 0x01;
/** Bit U/L (0x02 del primer octeto): administrada localmente o aleatoria (IEEE Std 802, sección 8.2). */
export const isLocalMac = (mac: string) => (firstOctet(mac) & 0x02) === 0x02;

/**
 * MAC virtual de un protocolo de redundancia de gateway:
 * - HSRP v1 0000.0c07.acXX y v2 0000.0c9f.fXXX (XX/XXX = grupo). Fuente: Cisco, "Configuring HSRP",
 *   https://www.cisco.com/en/US/docs/switches/datacenter/nexus3000/sw/unicast/l3_hsrp.html
 * - VRRP IPv4 0000.5e00.01XX e IPv6 0000.5e00.02XX (XX = VRID). Fuente: RFC 5798, sección 7.3,
 *   https://www.rfc-editor.org/rfc/rfc5798#section-7.3
 */
export function fhrpOf(mac: string): string | undefined {
  const m = normMac(mac);
  if (!m) return undefined;
  const hex = m.replace(/\./g, "");
  if (hex.startsWith("00000c07ac")) return `HSRP v1 grupo ${parseInt(hex.slice(10), 16)}`;
  if (hex.startsWith("00000c9ff")) return `HSRP v2 grupo ${parseInt(hex.slice(9), 16)}`;
  if (hex.startsWith("00005e0001")) return `VRRP grupo ${parseInt(hex.slice(10), 16)}`;
  if (hex.startsWith("00005e0002")) return `VRRP IPv6 grupo ${parseInt(hex.slice(10), 16)}`;
  return undefined;
}

const MAC_ANY = /(?:^|\s)([0-9a-f]{4}\.[0-9a-f]{4}\.[0-9a-f]{4}|[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}|[0-9a-f]{2}(?::[0-9a-f]{2}){5})(?=\s|$)/i;
/** Token con forma de interfaz: al menos dos letras y un dígito (Gi1/0/1, GE0/0/1, ge-0/0/1.0). */
const IFACE_TOKEN = /^[A-Za-z]{2}[\w\-/.:()]*\d/;
/** Entradas del propio equipo: CPU, SVI, supervisor, IRB, túneles de overlay. */
const SELF_PORT = /^(cpu|router|switch|drop|sup-eth|vl\d|vlan\d|vlanif|irb|vtep|vme|lo\d|null|all-members)|\(R\)$/i;

export interface MacRow {
  mac: string;
  port: string;
  vlan?: string;
}

/**
 * Tabla MAC de Cisco (IOS, IOS-XE, NX-OS), Huawei o Junos: una fila por MAC con su puerto.
 * Se omiten las entradas propias (CPU, SVI, "Router", sup-eth, G = Gateway MAC de NX-OS),
 * las blackhole y las aprendidas por el peer-link de vPC.
 */
export function parseMacTable(out: string): MacRow[] {
  const rows: MacRow[] = [];
  for (const line of out.split(/\r?\n/)) {
    const m = line.match(MAC_ANY);
    if (!m) continue;
    // NX-OS: "G" marca la MAC del propio equipo; "vPC Peer-Link" no es un puerto de acceso.
    if (/^\s*G\s/.test(line) || /Peer-Link/i.test(line) || /\bblackhole\b/i.test(line)) continue;
    const mac = normMac(m[1]);
    if (!mac) continue;
    const at = (m.index ?? 0) + m[0].length;
    const before = line.slice(0, m.index).trim().split(/\s+/).filter(Boolean);
    const after = line.slice(at).trim().split(/\s+/).filter(Boolean);
    const port = after.find((x) => IFACE_TOKEN.test(x));
    if (!port || SELF_PORT.test(port)) continue;
    // VLAN: antes de la MAC en Cisco/Junos; después en Huawei ("100/-/-").
    const last = before.at(-1) ?? "";
    const vlan = /^\d{1,4}$/.test(last) ? last : after[0]?.match(/^(\d{1,4})(?:\/|$)/)?.[1];
    rows.push(vlan ? { mac, port, vlan } : { mac, port });
  }
  return rows;
}

export interface ArpRow {
  mac: string;
  ip: string;
  /** Dirección del propio equipo (edad "-" en IOS, tipo "I" en Huawei). */
  self: boolean;
}

/** Tabla ARP de Cisco (IOS, NX-OS), Huawei o Junos ("no-resolve"). */
export function parseArpTable(out: string): ArpRow[] {
  const rows: ArpRow[] = [];
  for (const line of out.split(/\r?\n/)) {
    const m = line.match(MAC_ANY);
    const ipm = line.match(new RegExp(String.raw`(?:^|\s)(${IP_RE})(?=\s|$)`));
    if (!m || !ipm || !isIpv4(ipm[1])) continue;
    const mac = normMac(m[1]);
    if (!mac) continue;
    const ipEnd = (ipm.index ?? 0) + ipm[0].length;
    const macAt = m.index ?? 0;
    const between = ipEnd <= macAt ? line.slice(ipEnd, macAt).trim() : "";
    const after = line.slice(macAt + m[0].length).trim().split(/\s+/).filter(Boolean);
    const type = after.find((x) => !/^\d+$/.test(x));
    rows.push({ mac, ip: ipm[1], self: between === "-" || type === "I" });
  }
  return rows;
}

/** Fabricantes de las MAC de un puerto, sin repetir; sin OUI conocido: "MAC local" u "otro". */
export function macVendors(mp: MacPort): string[] {
  const v = mp.macs.map((e) => e.fhrp?.split(" ")[0] ?? e.vendor ?? (isLocalMac(e.mac) ? "MAC local" : "otro"));
  return [...new Set(v)];
}

/**
 * Agrupa por interfaz local las salidas de MAC_COMMANDS (el parser se elige por el comando).
 * Excluye las MAC del propio equipo, multicast y broadcast; completa IP (ARP) y fabricante (OUI).
 */
export function buildMacPorts(results: CommandOutput[], lookup: OuiLookup): Record<string, MacPort> {
  const rows: MacRow[] = [];
  const arp: ArpRow[] = [];
  for (const { cmd, out } of results) {
    if (!out || isCliError(out)) continue;
    if (/\barp\b/i.test(cmd)) arp.push(...parseArpTable(out));
    else rows.push(...parseMacTable(out));
  }
  return macPortsFromRows(rows, arp, lookup);
}

/** Puerto propio del equipo (CPU, SVI, Router, IRB): sus MAC no indican un vecino. */
export const isSelfPort = (port: string) => SELF_PORT.test(port);

/** Agrupa filas MAC y ARP ya leídas (por CLI o SNMP) por interfaz local. */
export function macPortsFromRows(rows: MacRow[], arp: ArpRow[], lookup: OuiLookup): Record<string, MacPort> {
  const selfMacs = new Set(arp.filter((a) => a.self).map((a) => a.mac));
  const ipOf = new Map<string, string>();
  for (const a of arp) if (!a.self && !ipOf.has(a.mac)) ipOf.set(a.mac, a.ip);
  const byPort = new Map<string, { port: string; macs: Map<string, MacEntry> }>();
  for (const r of rows) {
    if (isMulticastMac(r.mac) || selfMacs.has(r.mac)) continue;
    const k = canonPort(r.port);
    // El nombre viene del equipo (también por SNMP): "__proto__" no se usa como clave.
    if (UNSAFE_KEYS.has(k)) continue;
    let p = byPort.get(k);
    if (!p) {
      if (byPort.size >= MAX_MAC_PORTS) continue;
      p = { port: shortPort(r.port), macs: new Map() };
      byPort.set(k, p);
    }
    if (p.macs.has(r.mac)) continue;
    const fhrp = fhrpOf(r.mac);
    // La MAC virtual usa el OUI de Cisco o de IANA: no indica el fabricante del equipo.
    const oui = fhrp ? undefined : lookup(r.mac);
    const e: MacEntry = { mac: r.mac };
    if (r.vlan) e.vlan = r.vlan;
    const ip = ipOf.get(r.mac);
    if (ip) e.ip = ip;
    if (oui) Object.assign(e, { vendor: oui.vendor, kind: oui.kind });
    if (fhrp) e.fhrp = fhrp;
    p.macs.set(r.mac, e);
  }
  const rank = (e: MacEntry) => (e.fhrp ? 0 : e.kind === "net" ? 1 : isLocalMac(e.mac) ? 2 : e.kind === "host" ? 4 : 3);
  const res: Record<string, MacPort> = {};
  for (const [k, p] of byPort) {
    const macs = [...p.macs.values()].sort((a, b) => rank(a) - rank(b));
    res[k] = { port: p.port, total: macs.length, macs: macs.slice(0, MAX_MACS_PER_PORT) };
  }
  return res;
}

/** Interfaz local con algún enlace (de cualquier origen), también si es el agregado de uno. */
export function macPortLinked(t: Topology, n: TopoNode, k: string): boolean {
  const mine = t.links.flatMap((l) => [l.a === n.id ? l.aPort : "", l.b === n.id ? l.bPort : ""]).filter(Boolean);
  return mine.some((p) => {
    const c = canonPort(p);
    // La tabla MAC informa el Port-channel/Eth-Trunk/ae; CDP/LLDP, sus miembros.
    const g = n.ports?.[c]?.group;
    return c === k || (!!g && canonPort(g) === k);
  });
}

export interface MacVerdict {
  confidence: SuggestionConfidence;
  reason: string;
  /** MAC que da nombre al equipo sugerido (ninguna si son muchas sin equipo de red). */
  rep?: MacEntry;
}

/**
 * Clasificación de un puerto sin enlace:
 * - alta: MAC virtual HSRP/VRRP (gateway o router presente);
 * - media: MANY_MACS o más MAC (switch u otro equipo aguas abajo), o una sola MAC de un fabricante
 *   de red (posible equipo de red);
 * - baja: MAC de red junto a pocas MAC más (puede ser un teléfono con un PC detrás), o MAC
 *   administrada localmente o aleatoria (no se puede presumir);
 * - sin sugerencia: solo PC, servidores, máquinas virtuales u OUI no incluidos (quedan en el detalle).
 */
export function classifyMacPort(mp: MacPort): MacVerdict | null {
  const fh = mp.macs.find((e) => e.fhrp);
  if (fh) return { confidence: "alta", reason: `${fh.fhrp}: gateway/router presente`, rep: fh };
  const net = mp.macs.find((e) => e.kind === "net");
  if (mp.total >= MANY_MACS) return { confidence: "media", reason: `${mp.total} MAC en el puerto: switch u otro equipo aguas abajo`, rep: net };
  if (net && mp.total === 1) return { confidence: "media", reason: `Posible equipo de red (${net.vendor})`, rep: net };
  if (net) return { confidence: "baja", reason: `Posible equipo de red (${net.vendor}) con ${mp.total - 1} MAC más`, rep: net };
  const local = mp.macs.find((e) => isLocalMac(e.mac));
  if (local) return { confidence: "baja", reason: "MAC administrada localmente o aleatoria: no se puede presumir", rep: local };
  return null;
}

/** Sugerencias desde las tablas MAC y ARP ya leídas (no ejecuta comandos). */
export function suggestFromMacs(t: Topology): LinkSuggestion[] {
  const res: LinkSuggestion[] = [];
  for (const n of t.nodes) {
    for (const [k, mp] of Object.entries(n.macs ?? {})) {
      if (macPortLinked(t, n, k)) continue;
      const v = classifyMacPort(mp);
      if (!v) continue;
      const rep = v.rep;
      // Con muchas MAC solo la FHRP identifica a un equipo; si no, el equipo es "lo que cuelga" del puerto.
      const single = rep && (rep.fhrp || mp.total < MANY_MACS) ? rep : undefined;
      const label = single?.fhrp ? `Gateway ${single.fhrp.split(" ")[0]}` : single?.vendor ?? "MAC local";
      const name = (single ? `${label} ${single.ip ?? single.mac}` : `Aguas abajo de ${mp.port}`).slice(0, LIMITS.name);
      const vendors = macVendors(mp);
      res.push({
        id: `mac|${n.id}|${k}`,
        source: "mac",
        proto: "MAC/OUI",
        confidence: v.confidence,
        a: n.id,
        aPort: mp.port,
        target: name,
        bPort: "",
        reason: v.reason,
        detail: { vendors, macs: mp.total, ...(single?.ip ? { ip: single.ip } : {}) },
        // Una MAC concreta identifica al equipo aunque se vea desde otro switch; muchas, solo el puerto.
        node: {
          id: single ? `mac-${single.mac}` : `mac-${n.id}-${k}`,
          name,
          ...(single?.ip ? { ip: single.ip } : {}),
          platform: single?.fhrp ?? `${vendors.join(", ")} (por OUI)`,
        },
      });
    }
  }
  return res;
}

/** Generadores de sugerencias por fuente (solo leen el diagrama; no ejecutan comandos). */
export const SUGGESTERS: Partial<Record<TopoSourceId, (t: Topology) => LinkSuggestion[]>> = {
  descriptions: suggestFromDescriptions,
  mac: suggestFromMacs,
};

/** Sugerencias de las fuentes activas, sin las descartadas. */
export function collectSuggestions(t: Topology, sources: TopoSources | undefined, dismissed: Set<string> = new Set()): LinkSuggestion[] {
  return (Object.entries(SUGGESTERS) as [TopoSourceId, (t: Topology) => LinkSuggestion[]][])
    .filter(([id]) => sourceOn(sources, id))
    .flatMap(([, fn]) => fn(t))
    .filter((s) => !dismissed.has(s.id));
}

/** Confirma una sugerencia: crea el equipo si no existe (como manual) y el enlace con su origen. */
export function acceptSuggestion(t: Topology, s: LinkSuggestion): TopoResult {
  if (s.node) return acceptNodeSuggestion(t, s, s.node);
  let topo = t;
  if (!findNode(topo, s.target)) {
    const r = addManualNode(topo, isIpv4(s.target) ? { name: s.target, ip: s.target } : { name: s.target });
    if (!r.topo) return r;
    topo = r.topo;
  }
  const target = findNode(topo, s.target);
  if (!target) return { error: "No se pudo crear el equipo" };
  return addManualLink(topo, { a: s.a, aPort: s.aPort, b: target.id, bPort: s.bPort }, s.proto);
}

/**
 * Confirma una sugerencia que trae su propio equipo (MAC/OUI): se reutiliza si ya existe por id o
 * por IP; si no, se crea como manual. Con IP queda además como "conocido por dirección" para que,
 * al explorarlo, se fusione con su nombre real (igual que un vecino de ruteo).
 */
function acceptNodeSuggestion(t: Topology, s: LinkSuggestion, spec: NonNullable<LinkSuggestion["node"]>): TopoResult {
  let topo = t;
  let target = topo.nodes.find((n) => n.id === spec.id) ?? (spec.ip ? topo.nodes.find((n) => knownAddrs(n).includes(spec.ip!)) : undefined);
  if (!target) {
    const node: TopoNode = { id: spec.id, name: spec.name, explored: false, manual: true, x: 0, y: 0 };
    if (spec.ip) Object.assign(node, { ip: spec.ip, addrs: [spec.ip], addrOnly: true });
    if (spec.platform) node.platform = spec.platform;
    topo = layout({ ...topo, nodes: [...topo.nodes, node] });
    target = node;
  }
  return addManualLink(topo, { a: s.a, aPort: s.aPort, b: target.id, bPort: s.bPort }, s.proto);
}

// ---------- Seguir la ruta y sugerencias descartadas ----------

/** Sesión que se abrió con "Conectar y seguir la ruta" y aún no aparece conectada. */
export interface PendingFollow {
  host?: string;
  sessionId?: string;
  /** Conexiones que ya existían al pulsar "Conectar": no cuentan como la nueva. */
  known: string[];
}

/** La conexión nueva que corresponde al equipo que se siguió (por sesión guardada o por host). */
export function followedTerminal<T extends { connId: string; host?: string; session: { id: string } }>(terms: T[], p: PendingFollow): T | undefined {
  return terms.find((t) => !p.known.includes(t.connId) && ((!!p.sessionId && t.session.id === p.sessionId) || (!!p.host && t.host === p.host)));
}

/** Sugerencias descartadas por equipo (el id lleva "fuente|equipo|clave"). */
export type DismissedMap = Record<string, string[]>;
export const MAX_DISMISSED_PER_DEVICE = 200;
export const MAX_DISMISSED_DEVICES = 200;

const deviceOfSuggestion = (id: string) => id.split("|")[1] ?? "";

/** Agrega un descarte con topes: por equipo se olvidan los más antiguos y, por cantidad de equipos, los menos recientes. */
export function addDismissed(map: DismissedMap, id: string): DismissedMap {
  const dev = deviceOfSuggestion(id);
  if (!dev || dev === "__proto__" || dev === "constructor" || dev === "prototype") return map;
  const list = [...(map[dev] ?? []).filter((x) => x !== id), id].slice(-MAX_DISMISSED_PER_DEVICE);
  const next: DismissedMap = { ...map };
  delete next[dev];
  next[dev] = list;
  const devs = Object.keys(next);
  for (const d of devs.slice(0, Math.max(0, devs.length - MAX_DISMISSED_DEVICES))) delete next[d];
  return next;
}

/** Lee lo guardado sin confiar en su forma (localStorage editable). */
export function parseDismissed(raw: unknown): DismissedMap {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  let out: DismissedMap = {};
  for (const [dev, ids] of Object.entries(raw as Record<string, unknown>)) {
    if (!Array.isArray(ids) || dev === "__proto__") continue;
    for (const id of ids) if (typeof id === "string" && id.length <= 512 && deviceOfSuggestion(id) === dev) out = addDismissed(out, id);
  }
  return out;
}

export const dismissedSet = (map: DismissedMap) => new Set(Object.values(map).flat());
