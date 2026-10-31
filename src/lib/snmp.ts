/** SNMP: perfiles, catálogo de OIDs, conjuntos de telemetría y armado de tablas. */

export type SnmpVersion = "1" | "2c" | "3";
export type SnmpLevel = "noAuthNoPriv" | "authNoPriv" | "authPriv";
export type AuthProto = "md5" | "sha" | "sha224" | "sha256" | "sha384" | "sha512";
export type PrivProto = "des" | "aes" | "aes192" | "aes256" | "aes192c" | "aes256c";

/** Perfil guardado en ajustes. Los secretos nunca van aquí: solo en la bóveda (opcional). */
export interface SnmpProfile {
  id: string;
  name: string;
  host: string;
  port: number;
  version: SnmpVersion;
  user: string;
  level: SnmpLevel;
  authProto: AuthProto;
  privProto: PrivProto;
  context: string;
  timeoutMs: number;
  retries: number;
  /** Los secretos de este perfil están en la bóveda cifrada. */
  saved: boolean;
}

export const newProfile = (): SnmpProfile => ({
  id: `p${Date.now().toString(36)}`,
  name: "",
  host: "",
  port: 161,
  version: "3",
  user: "",
  level: "authPriv",
  authProto: "sha256",
  privProto: "aes",
  context: "",
  timeoutMs: 2000,
  retries: 1,
  saved: false,
});

export interface Secrets {
  community: string;
  authPass: string;
  privPass: string;
}

export interface Row {
  oid: string;
  type: string;
  value: string;
}

export const AUTH_PROTOS: { id: AuthProto; label: string; legacy?: boolean }[] = [
  { id: "sha256", label: "SHA-256" },
  { id: "sha384", label: "SHA-384" },
  { id: "sha512", label: "SHA-512" },
  { id: "sha224", label: "SHA-224" },
  { id: "sha", label: "SHA-1 (antiguo)" },
  { id: "md5", label: "MD5 (legado)", legacy: true },
];

export const PRIV_PROTOS: { id: PrivProto; label: string; legacy?: boolean }[] = [
  { id: "aes", label: "AES-128" },
  { id: "aes256c", label: "AES-256 (Cisco)" },
  { id: "aes256", label: "AES-256 (net-snmp)" },
  { id: "aes192c", label: "AES-192 (Cisco)" },
  { id: "aes192", label: "AES-192 (net-snmp)" },
  { id: "des", label: "DES (legado)", legacy: true },
];

/** Advertencias de seguridad de la configuración actual (texto para mostrar). */
export function securityWarnings(p: SnmpProfile, community: string, usingSaved: boolean): string[] {
  const w: string[] = [];
  if (p.version !== "3") {
    w.push(`SNMP${p.version === "1" ? "v1" : "v2c"} envía la community en texto claro: cualquiera en la ruta puede leerla. Prefiere SNMPv3 con authPriv.`);
    const c = community.trim().toLowerCase();
    if (!usingSaved && (c === "" || c === "public" || c === "private"))
      w.push(c ? `La community "${c}" es un valor por defecto conocido: cámbiala en el equipo.` : "Community vacía.");
  } else {
    if (p.level === "noAuthNoPriv") w.push("noAuthNoPriv: sin autenticación ni cifrado. Cualquiera puede suplantar al equipo o leer las respuestas.");
    if (p.level === "authNoPriv") w.push("authNoPriv: las respuestas viajan sin cifrar (solo autenticadas).");
    if (p.level !== "noAuthNoPriv" && p.authProto === "md5") w.push("MD5 está obsoleto para autenticación: úsalo solo con equipos que no soporten SHA.");
    if (p.level === "authPriv" && p.privProto === "des") w.push("DES (56 bits) se considera roto: úsalo solo con equipos que no soporten AES.");
  }
  return w;
}

// ---------- Catálogo de OIDs ----------

/** Nombre, MIB y fuente. Solo objetos de MIB estándar o documentados por el fabricante. */
export const OIDS: { oid: string; name: string; mib: string }[] = [
  // SNMPv2-MIB, RFC 3418 (grupo system 1.3.6.1.2.1.1)
  { oid: "1.3.6.1.2.1.1.1", name: "sysDescr", mib: "SNMPv2-MIB" },
  { oid: "1.3.6.1.2.1.1.2", name: "sysObjectID", mib: "SNMPv2-MIB" },
  { oid: "1.3.6.1.2.1.1.3", name: "sysUpTime", mib: "SNMPv2-MIB" },
  { oid: "1.3.6.1.2.1.1.4", name: "sysContact", mib: "SNMPv2-MIB" },
  { oid: "1.3.6.1.2.1.1.5", name: "sysName", mib: "SNMPv2-MIB" },
  { oid: "1.3.6.1.2.1.1.6", name: "sysLocation", mib: "SNMPv2-MIB" },
  // IF-MIB, RFC 2863: ifTable 1.3.6.1.2.1.2.2.1
  { oid: "1.3.6.1.2.1.2.1", name: "ifNumber", mib: "IF-MIB" },
  { oid: "1.3.6.1.2.1.2.2.1.1", name: "ifIndex", mib: "IF-MIB" },
  { oid: "1.3.6.1.2.1.2.2.1.2", name: "ifDescr", mib: "IF-MIB" },
  { oid: "1.3.6.1.2.1.2.2.1.3", name: "ifType", mib: "IF-MIB" },
  { oid: "1.3.6.1.2.1.2.2.1.4", name: "ifMtu", mib: "IF-MIB" },
  { oid: "1.3.6.1.2.1.2.2.1.5", name: "ifSpeed", mib: "IF-MIB" },
  { oid: "1.3.6.1.2.1.2.2.1.6", name: "ifPhysAddress", mib: "IF-MIB" },
  { oid: "1.3.6.1.2.1.2.2.1.7", name: "ifAdminStatus", mib: "IF-MIB" },
  { oid: "1.3.6.1.2.1.2.2.1.8", name: "ifOperStatus", mib: "IF-MIB" },
  { oid: "1.3.6.1.2.1.2.2.1.9", name: "ifLastChange", mib: "IF-MIB" },
  { oid: "1.3.6.1.2.1.2.2.1.10", name: "ifInOctets", mib: "IF-MIB" },
  { oid: "1.3.6.1.2.1.2.2.1.13", name: "ifInDiscards", mib: "IF-MIB" },
  { oid: "1.3.6.1.2.1.2.2.1.14", name: "ifInErrors", mib: "IF-MIB" },
  { oid: "1.3.6.1.2.1.2.2.1.16", name: "ifOutOctets", mib: "IF-MIB" },
  { oid: "1.3.6.1.2.1.2.2.1.19", name: "ifOutDiscards", mib: "IF-MIB" },
  { oid: "1.3.6.1.2.1.2.2.1.20", name: "ifOutErrors", mib: "IF-MIB" },
  // IF-MIB, RFC 2863: ifXTable 1.3.6.1.2.1.31.1.1.1 (contadores de 64 bits)
  { oid: "1.3.6.1.2.1.31.1.1.1.1", name: "ifName", mib: "IF-MIB" },
  { oid: "1.3.6.1.2.1.31.1.1.1.6", name: "ifHCInOctets", mib: "IF-MIB" },
  { oid: "1.3.6.1.2.1.31.1.1.1.10", name: "ifHCOutOctets", mib: "IF-MIB" },
  { oid: "1.3.6.1.2.1.31.1.1.1.15", name: "ifHighSpeed", mib: "IF-MIB" },
  { oid: "1.3.6.1.2.1.31.1.1.1.18", name: "ifAlias", mib: "IF-MIB" },
  // ENTITY-MIB, RFC 6933: entPhysicalTable 1.3.6.1.2.1.47.1.1.1.1
  { oid: "1.3.6.1.2.1.47.1.1.1.1.2", name: "entPhysicalDescr", mib: "ENTITY-MIB" },
  { oid: "1.3.6.1.2.1.47.1.1.1.1.5", name: "entPhysicalClass", mib: "ENTITY-MIB" },
  { oid: "1.3.6.1.2.1.47.1.1.1.1.7", name: "entPhysicalName", mib: "ENTITY-MIB" },
  { oid: "1.3.6.1.2.1.47.1.1.1.1.10", name: "entPhysicalSoftwareRev", mib: "ENTITY-MIB" },
  { oid: "1.3.6.1.2.1.47.1.1.1.1.11", name: "entPhysicalSerialNum", mib: "ENTITY-MIB" },
  { oid: "1.3.6.1.2.1.47.1.1.1.1.13", name: "entPhysicalModelName", mib: "ENTITY-MIB" },
  // HOST-RESOURCES-MIB, RFC 2790
  { oid: "1.3.6.1.2.1.25.1.1", name: "hrSystemUptime", mib: "HOST-RESOURCES-MIB" },
  { oid: "1.3.6.1.2.1.25.2.3.1.2", name: "hrStorageType", mib: "HOST-RESOURCES-MIB" },
  { oid: "1.3.6.1.2.1.25.2.3.1.3", name: "hrStorageDescr", mib: "HOST-RESOURCES-MIB" },
  { oid: "1.3.6.1.2.1.25.2.3.1.4", name: "hrStorageAllocationUnits", mib: "HOST-RESOURCES-MIB" },
  { oid: "1.3.6.1.2.1.25.2.3.1.5", name: "hrStorageSize", mib: "HOST-RESOURCES-MIB" },
  { oid: "1.3.6.1.2.1.25.2.3.1.6", name: "hrStorageUsed", mib: "HOST-RESOURCES-MIB" },
  { oid: "1.3.6.1.2.1.25.3.3.1.2", name: "hrProcessorLoad", mib: "HOST-RESOURCES-MIB" },
  { oid: "1.3.6.1.2.1.25.4.2.1.2", name: "hrSWRunName", mib: "HOST-RESOURCES-MIB" },
  { oid: "1.3.6.1.2.1.25.4.2.1.5", name: "hrSWRunParameters", mib: "HOST-RESOURCES-MIB" },
  { oid: "1.3.6.1.2.1.25.4.2.1.7", name: "hrSWRunStatus", mib: "HOST-RESOURCES-MIB" },
  // UCD-SNMP-MIB (net-snmp, 1.3.6.1.4.1.2021): carga y memoria en kB
  { oid: "1.3.6.1.4.1.2021.10.1.2", name: "laNames", mib: "UCD-SNMP-MIB" },
  { oid: "1.3.6.1.4.1.2021.10.1.3", name: "laLoad", mib: "UCD-SNMP-MIB" },
  { oid: "1.3.6.1.4.1.2021.4.3", name: "memTotalSwap", mib: "UCD-SNMP-MIB" },
  { oid: "1.3.6.1.4.1.2021.4.4", name: "memAvailSwap", mib: "UCD-SNMP-MIB" },
  { oid: "1.3.6.1.4.1.2021.4.5", name: "memTotalReal", mib: "UCD-SNMP-MIB" },
  { oid: "1.3.6.1.4.1.2021.4.6", name: "memAvailReal", mib: "UCD-SNMP-MIB" },
  { oid: "1.3.6.1.4.1.2021.4.14", name: "memBuffer", mib: "UCD-SNMP-MIB" },
  { oid: "1.3.6.1.4.1.2021.4.15", name: "memCached", mib: "UCD-SNMP-MIB" },
  // CISCO-PROCESS-MIB y CISCO-MEMORY-POOL-MIB (Cisco, notas técnicas 15215 y 15216)
  { oid: "1.3.6.1.4.1.9.9.109.1.1.1.1.6", name: "cpmCPUTotal5secRev", mib: "CISCO-PROCESS-MIB" },
  { oid: "1.3.6.1.4.1.9.9.109.1.1.1.1.7", name: "cpmCPUTotal1minRev", mib: "CISCO-PROCESS-MIB" },
  { oid: "1.3.6.1.4.1.9.9.109.1.1.1.1.8", name: "cpmCPUTotal5minRev", mib: "CISCO-PROCESS-MIB" },
  { oid: "1.3.6.1.4.1.9.9.48.1.1.1.2", name: "ciscoMemoryPoolName", mib: "CISCO-MEMORY-POOL-MIB" },
  { oid: "1.3.6.1.4.1.9.9.48.1.1.1.5", name: "ciscoMemoryPoolUsed", mib: "CISCO-MEMORY-POOL-MIB" },
  { oid: "1.3.6.1.4.1.9.9.48.1.1.1.6", name: "ciscoMemoryPoolFree", mib: "CISCO-MEMORY-POOL-MIB" },
  // HUAWEI-ENTITY-EXTENT-MIB (hwEntityStateTable, índice = entPhysicalIndex)
  { oid: "1.3.6.1.4.1.2011.5.25.31.1.1.1.1.5", name: "hwEntityCpuUsage", mib: "HUAWEI-ENTITY-EXTENT-MIB" },
  { oid: "1.3.6.1.4.1.2011.5.25.31.1.1.1.1.7", name: "hwEntityMemUsage", mib: "HUAWEI-ENTITY-EXTENT-MIB" },
  // Notificaciones: snmpTraps (RFC 3418) y linkDown/linkUp (RFC 2863)
  { oid: "1.3.6.1.6.3.1.1.4.1", name: "snmpTrapOID", mib: "SNMPv2-MIB" },
  { oid: "1.3.6.1.6.3.1.1.5.1", name: "coldStart", mib: "SNMPv2-MIB" },
  { oid: "1.3.6.1.6.3.1.1.5.2", name: "warmStart", mib: "SNMPv2-MIB" },
  { oid: "1.3.6.1.6.3.1.1.5.3", name: "linkDown", mib: "IF-MIB" },
  { oid: "1.3.6.1.6.3.1.1.5.4", name: "linkUp", mib: "IF-MIB" },
  { oid: "1.3.6.1.6.3.1.1.5.5", name: "authenticationFailure", mib: "SNMPv2-MIB" },
];

const byOid = new Map(OIDS.map((o) => [o.oid, o.name]));

/** Nombre simbólico por el prefijo más largo conocido: 1.3.6.1.2.1.2.2.1.2.5 -> ifDescr.5 */
export function oidName(oid: string): string {
  const parts = oid.split(".");
  for (let n = parts.length; n >= 4; n--) {
    const name = byOid.get(parts.slice(0, n).join("."));
    if (name) return n === parts.length ? name : `${name}.${parts.slice(n).join(".")}`;
  }
  return "";
}

/** Consultas rápidas para la lista de OIDs. */
export const QUICK: { label: string; oid: string; op: "get" | "walk" }[] = [
  { label: "sysDescr", oid: "1.3.6.1.2.1.1.1.0", op: "get" },
  { label: "sysName", oid: "1.3.6.1.2.1.1.5.0", op: "get" },
  { label: "sysUpTime", oid: "1.3.6.1.2.1.1.3.0", op: "get" },
  { label: "system", oid: "1.3.6.1.2.1.1", op: "walk" },
  { label: "ifDescr", oid: "1.3.6.1.2.1.2.2.1.2", op: "walk" },
  { label: "ifOperStatus", oid: "1.3.6.1.2.1.2.2.1.8", op: "walk" },
  { label: "ifName", oid: "1.3.6.1.2.1.31.1.1.1.1", op: "walk" },
  { label: "ifAlias", oid: "1.3.6.1.2.1.31.1.1.1.18", op: "walk" },
  { label: "entPhysicalModelName", oid: "1.3.6.1.2.1.47.1.1.1.1.13", op: "walk" },
  { label: "entPhysicalSerialNum", oid: "1.3.6.1.2.1.47.1.1.1.1.11", op: "walk" },
  { label: "CPU Cisco 5 min", oid: "1.3.6.1.4.1.9.9.109.1.1.1.1.8", op: "walk" },
  { label: "CPU Huawei", oid: "1.3.6.1.4.1.2011.5.25.31.1.1.1.1.5", op: "walk" },
];

// ---------- Conjuntos de OIDs (tablas) ----------

export interface Column {
  oid: string;
  label: string;
  /** Formato de la celda. */
  fmt?: "status" | "speedMbps" | "bytesKb" | "pct" | "counter";
}

export interface Preset {
  id: string;
  label: string;
  hint: string;
  /** Escalares (.0) se muestran como lista; las columnas como tabla por índice. */
  scalars?: Column[];
  columns?: Column[];
  /** Columnas alternativas si las principales no responden (contadores de 32 bits). */
  fallback?: Column[];
  rates?: boolean;
}

const IFX = "1.3.6.1.2.1.31.1.1.1";
const IFT = "1.3.6.1.2.1.2.2.1";
const HR = "1.3.6.1.2.1.25";
const UCD = "1.3.6.1.4.1.2021";

export const PRESETS: Preset[] = [
  {
    id: "identity",
    label: "Identidad",
    hint: "SNMPv2-MIB (RFC 3418): descripción, objeto, uptime, contacto, nombre y ubicación",
    scalars: [
      { oid: "1.3.6.1.2.1.1.5.0", label: "Nombre" },
      { oid: "1.3.6.1.2.1.1.1.0", label: "Descripción" },
      { oid: "1.3.6.1.2.1.1.2.0", label: "sysObjectID" },
      { oid: "1.3.6.1.2.1.1.3.0", label: "Uptime" },
      { oid: "1.3.6.1.2.1.1.4.0", label: "Contacto" },
      { oid: "1.3.6.1.2.1.1.6.0", label: "Ubicación" },
    ],
  },
  {
    id: "interfaces",
    label: "Interfaces",
    hint: "IF-MIB (RFC 2863): ifXTable con contadores de 64 bits; ifTable si el agente no la tiene",
    columns: [
      { oid: `${IFX}.1`, label: "Nombre" },
      { oid: `${IFX}.18`, label: "Descripción" },
      { oid: `${IFT}.7`, label: "Admin", fmt: "status" },
      { oid: `${IFT}.8`, label: "Oper", fmt: "status" },
      { oid: `${IFX}.15`, label: "Velocidad", fmt: "speedMbps" },
      { oid: `${IFX}.6`, label: "Entrada (octetos)", fmt: "counter" },
      { oid: `${IFX}.10`, label: "Salida (octetos)", fmt: "counter" },
    ],
    fallback: [
      { oid: `${IFT}.2`, label: "Nombre" },
      { oid: `${IFT}.7`, label: "Admin", fmt: "status" },
      { oid: `${IFT}.8`, label: "Oper", fmt: "status" },
      { oid: `${IFT}.5`, label: "Velocidad (bps)" },
      { oid: `${IFT}.10`, label: "Entrada (octetos)", fmt: "counter" },
      { oid: `${IFT}.16`, label: "Salida (octetos)", fmt: "counter" },
    ],
    rates: true,
  },
  {
    id: "storage",
    label: "Almacenamiento",
    hint: "HOST-RESOURCES-MIB (RFC 2790): hrStorageTable (tamaño y uso por unidades de asignación)",
    columns: [
      { oid: `${HR}.2.3.1.3`, label: "Descripción" },
      { oid: `${HR}.2.3.1.4`, label: "Unidad (bytes)" },
      { oid: `${HR}.2.3.1.5`, label: "Tamaño (unidades)" },
      { oid: `${HR}.2.3.1.6`, label: "Usado (unidades)" },
    ],
  },
  {
    id: "cpu",
    label: "CPU",
    hint: "hrProcessorLoad (RFC 2790), CISCO-PROCESS-MIB y HUAWEI-ENTITY-EXTENT-MIB",
    columns: [
      { oid: `${HR}.3.3.1.2`, label: "hrProcessorLoad", fmt: "pct" },
      { oid: "1.3.6.1.4.1.9.9.109.1.1.1.1.7", label: "Cisco 1 min", fmt: "pct" },
      { oid: "1.3.6.1.4.1.9.9.109.1.1.1.1.8", label: "Cisco 5 min", fmt: "pct" },
      { oid: "1.3.6.1.4.1.2011.5.25.31.1.1.1.1.5", label: "Huawei CPU", fmt: "pct" },
      { oid: "1.3.6.1.4.1.2011.5.25.31.1.1.1.1.7", label: "Huawei memoria", fmt: "pct" },
    ],
  },
  {
    id: "processes",
    label: "Procesos",
    hint: "HOST-RESOURCES-MIB (RFC 2790): hrSWRunTable, solo nombres por defecto",
    columns: [
      { oid: `${HR}.4.2.1.2`, label: "Proceso" },
      { oid: `${HR}.4.2.1.7`, label: "Estado" },
    ],
  },
  {
    id: "ucd",
    label: "Carga y memoria (Linux)",
    hint: "UCD-SNMP-MIB (net-snmp): laLoad 1/5/15 min y memoria en kB",
    scalars: [
      { oid: `${UCD}.10.1.3.1`, label: "Carga 1 min" },
      { oid: `${UCD}.10.1.3.2`, label: "Carga 5 min" },
      { oid: `${UCD}.10.1.3.3`, label: "Carga 15 min" },
      { oid: `${UCD}.4.5.0`, label: "Memoria total", fmt: "bytesKb" },
      { oid: `${UCD}.4.6.0`, label: "Memoria disponible", fmt: "bytesKb" },
      { oid: `${UCD}.4.14.0`, label: "Búfer", fmt: "bytesKb" },
      { oid: `${UCD}.4.15.0`, label: "Caché", fmt: "bytesKb" },
      { oid: `${UCD}.4.3.0`, label: "Swap total", fmt: "bytesKb" },
      { oid: `${UCD}.4.4.0`, label: "Swap disponible", fmt: "bytesKb" },
    ],
  },
];

/** hrSWRunParameters puede exponer argumentos con secretos: solo con permiso explícito. */
export const SWRUN_PARAMS: Column = { oid: `${HR}.4.2.1.5`, label: "Parámetros" };

export interface Table {
  columns: Column[];
  /** índice (sufijo del OID) -> valores por columna */
  rows: { index: string; cells: (Row | undefined)[] }[];
}

/** Agrupa columnas recorridas por su índice (sufijo tras el OID de la columna). */
export function buildTable(columns: Column[], results: Row[][]): Table {
  const map = new Map<string, (Row | undefined)[]>();
  results.forEach((rows, c) => {
    const prefix = columns[c].oid + ".";
    for (const r of rows) {
      if (!r.oid.startsWith(prefix)) continue;
      const idx = r.oid.slice(prefix.length);
      if (!map.has(idx)) map.set(idx, Array(columns.length).fill(undefined));
      map.get(idx)![c] = r;
    }
  });
  const rows = [...map.entries()].map(([index, cells]) => ({ index, cells }));
  const key = (s: string) => s.split(".").map((n) => n.padStart(10, "0")).join(".");
  rows.sort((a, b) => (key(a.index) < key(b.index) ? -1 : 1));
  return { columns, rows };
}

const STATUS: Record<string, string> = { "1": "up", "2": "down", "3": "testing", "4": "unknown", "5": "dormant", "6": "notPresent", "7": "lowerLayerDown" };

export function formatCell(col: Column, r: Row | undefined): string {
  if (!r) return "—";
  if (r.type === "noSuchObject" || r.type === "noSuchInstance") return "—";
  const n = Number(r.value);
  switch (col.fmt) {
    case "status":
      return STATUS[r.value] ?? r.value;
    case "speedMbps":
      return Number.isFinite(n) ? (n >= 1000 ? `${n / 1000} Gbps` : `${n} Mbps`) : r.value;
    case "bytesKb":
      return Number.isFinite(n) ? fmtKb(n) : r.value;
    case "pct":
      return Number.isFinite(n) ? `${n} %` : r.value;
    default:
      return r.value;
  }
}

/** Kilobytes (UCD-SNMP-MIB informa en kB de 1024 bytes) a MB o GB. */
export function fmtKb(kb: number): string {
  return kb >= 1024 * 1024 ? `${(kb / 1024 / 1024).toFixed(1)} GB` : kb >= 1024 ? `${(kb / 1024).toFixed(0)} MB` : `${kb} kB`;
}

/** Bits por segundo con prefijo decimal (convención de redes). */
export function fmtBits(bps: number): string {
  const u = ["bps", "kbps", "Mbps", "Gbps", "Tbps"];
  let i = 0;
  let v = bps;
  while (v >= 1000 && i < u.length - 1) {
    v /= 1000;
    i++;
  }
  return `${v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2)} ${u[i]}`;
}

/**
 * Tasa en bits/s entre dos lecturas de un contador. Con 32 bits se corrige una vuelta
 * (2^32); con 64 bits una vuelta es imposible en la práctica. Null si el agente reinició.
 */
export function rate(prev: string | undefined, cur: string | undefined, seconds: number, bits64: boolean): number | null {
  if (prev == null || cur == null || seconds <= 0) return null;
  let a: bigint, b: bigint;
  try {
    a = BigInt(prev);
    b = BigInt(cur);
  } catch {
    return null;
  }
  let d = b - a;
  if (d < 0n) {
    if (bits64) return null;
    d += 1n << 32n;
  }
  return (Number(d) * 8) / seconds;
}

// ---------- Traps ----------

export interface Trap {
  ts: number;
  src: string;
  version: string;
  kind: "trap" | "inform" | "v1" | "invalid";
  trap_oid: string;
  uptime: string | null;
  user: string | null;
  note: string | null;
  vbs: Row[];
}

/** Resumen legible: "linkDown · Gi0/1 (ifIndex 3)". */
export function trapSummary(t: Trap): { title: string; tone: "danger" | "ok" | "warn" | "muted"; detail: string } {
  const name = oidName(t.trap_oid) || t.trap_oid || (t.kind === "invalid" ? "No decodificado" : "Trap v3");
  const tone = name === "linkDown" || name === "authenticationFailure" ? "danger" : name === "linkUp" ? "ok" : name === "coldStart" || name === "warmStart" ? "warn" : "muted";
  const find = (prefix: string) => t.vbs.find((v) => v.oid.startsWith(prefix + "."));
  const ifIndex = find(`${IFT}.1`)?.value;
  const ifName = find(`${IFT}.2`)?.value ?? find(`${IFX}.1`)?.value;
  const detail =
    name === "linkDown" || name === "linkUp"
      ? [ifName, ifIndex ? `ifIndex ${ifIndex}` : ""].filter(Boolean).join(" · ")
      : name === "coldStart"
        ? "El equipo se reinició (configuración puede haber cambiado)"
        : name === "warmStart"
          ? "El agente se reinició sin cambiar configuración"
          : "";
  return { title: name, tone, detail };
}

// ---------- CSV ----------

/** Celdas con = + - @ se anteponen con ' (los valores vienen del equipo; OWASP CSV injection). */
export function csvCell(v: string): string {
  const formula = /^[=@\t\r]/.test(v) || /^[+-](?!\d+(\.\d+)?$)./.test(v);
  return `"${(formula ? `'${v}` : v).replace(/"/g, '""')}"`;
}

export function rowsToCsv(rows: Row[]): string {
  return ["oid,nombre,tipo,valor", ...rows.map((r) => [r.oid, oidName(r.oid), r.type, r.value].map(csvCell).join(","))].join("\n");
}

export function tableToCsv(t: Table): string {
  return [
    ["indice", ...t.columns.map((c) => c.label)].map(csvCell).join(","),
    ...t.rows.map((r) => [r.index, ...r.cells.map((c, i) => formatCell(t.columns[i], c))].map(csvCell).join(",")),
  ].join("\n");
}

/** Parámetros para el backend. Los secretos vacíos se completan desde la bóveda si el perfil los tiene. */
export function targetParams(p: SnmpProfile, s: Secrets) {
  return {
    host: p.host.trim(),
    port: p.port,
    version: p.version,
    community: s.community || null,
    user: p.user,
    level: p.level,
    authProto: p.authProto,
    authPass: s.authPass || null,
    privProto: p.privProto,
    privPass: s.privPass || null,
    context: p.context,
    timeoutMs: p.timeoutMs,
    retries: p.retries,
    profile: p.saved ? p.id : null,
  };
}
