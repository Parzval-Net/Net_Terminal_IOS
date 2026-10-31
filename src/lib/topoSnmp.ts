/**
 * Descubrimiento de topología por SNMP (alternativa a los comandos de consola): plan de lectura
 * con OIDs verificados y conversión de los varbinds a las mismas estructuras de la topología por
 * CLI (Neighbor, PortInfo, filas MAC y ARP), para reutilizar fusión, sugerencias, exportaciones
 * y validaciones. Todo lo que informa el equipo es no confiable: se limpia y se valida.
 *
 * Fuentes de cada OID (archivos MIB oficiales):
 * - IF-MIB, RFC 2863 https://www.rfc-editor.org/rfc/rfc2863
 * - LLDP-MIB, IEEE Std 802.1AB-2005 cláusula 12.1
 *   https://www.ieee802.org/1/files/public/MIBs/LLDP-MIB-200505060000Z.txt
 * - LLDP-V2-MIB, IEEE Std 802.1AB-2009 (raíz en LLDP-V2-TC-MIB: ieee802dot1mibs = 1.3.111.2.802.1.1)
 *   https://www.ieee802.org/1/files/public/MIBs/LLDP-V2-MIB-200906080000Z.txt
 * - CISCO-VTP-MIB, Cisco https://github.com/cisco/cisco-mibs/blob/main/v2/CISCO-VTP-MIB.my
 * - CISCO-CDP-MIB, Cisco https://github.com/cisco/cisco-mibs/blob/main/v2/CISCO-CDP-MIB.my
 * - OSPF-MIB, RFC 4750 (y RFC 1850) https://www.rfc-editor.org/rfc/rfc4750
 * - BGP4-MIB, RFC 4273 https://www.rfc-editor.org/rfc/rfc4273
 * - IP-MIB, RFC 4293 https://www.rfc-editor.org/rfc/rfc4293
 * - BRIDGE-MIB, RFC 4188 https://www.rfc-editor.org/rfc/rfc4188
 * - Q-BRIDGE-MIB, RFC 4363 https://www.rfc-editor.org/rfc/rfc4363
 * - SNMPv2-MIB, RFC 3418 https://www.rfc-editor.org/rfc/rfc3418
 * La misma lista está en src-tauri/src/snmp.rs (TOPO_WALK_ROOTS, TOPO_GET_COLUMNS,
 * TOPO_GET_SCALARS): el backend rechaza cualquier otro OID.
 */
import type { ArpRow, BgpPeer, MacRow, Neighbor, PortInfo } from "./topology";
import {
  bgpNeighbors,
  canonPort,
  cleanDeviceText,
  isIpv4,
  isSafeIface,
  isSelfPort,
  isSharedAddr,
  normMac,
  shortPort,
} from "./topology";

/** Fila devuelta por snmp_topo_read: valor legible y, en cadenas de octetos, también en hex. */
export interface TopoRow {
  oid: string;
  type: string;
  value: string;
  hex?: string;
}
export interface TopoWalk {
  oid: string;
  rows: TopoRow[];
  truncated: boolean;
  timedOut: boolean;
  error: string | null;
}
export interface TopoRead {
  gets: TopoRow[];
  getError: string | null;
  walks: TopoWalk[];
  ms: number;
}

const IFT = "1.3.6.1.2.1.2.2.1"; // IF-MIB ifEntry (RFC 2863)
const IFX = "1.3.6.1.2.1.31.1.1.1"; // IF-MIB ifXEntry (RFC 2863)
const LLDP = "1.0.8802.1.1.2.1"; // lldpObjects (IEEE 802.1AB-2005)
const LLDP2 = "1.3.111.2.802.1.1.13.1"; // lldpV2Objects (IEEE 802.1AB-2009)
const CDP = "1.3.6.1.4.1.9.9.23.1.2.1.1"; // cdpCacheEntry (CISCO-CDP-MIB)

/** OIDs por nombre. Cada valor se verificó contra el MIB citado arriba. */
export const OID = {
  // IF-MIB (RFC 2863)
  ifDescr: `${IFT}.2`,
  ifSpeed: `${IFT}.5`,
  ifOperStatus: `${IFT}.8`,
  ifInOctets: `${IFT}.10`,
  ifOutOctets: `${IFT}.16`,
  ifName: `${IFX}.1`,
  ifHCInOctets: `${IFX}.6`,
  ifHCOutOctets: `${IFX}.10`,
  ifHighSpeed: `${IFX}.15`,
  ifAlias: `${IFX}.18`,
  // LLDP-MIB (IEEE 802.1AB-2005): lldpLocPortTable { lldpLocalSystemData 7 }; lldpRemEntry y
  // lldpRemManAddrEntry bajo lldpRemoteSystemsData (lldpObjects 4).
  lldpLocPortTable: `${LLDP}.3.7`,
  lldpRemChassisIdSubtype: `${LLDP}.4.1.1.4`,
  lldpRemChassisId: `${LLDP}.4.1.1.5`,
  lldpRemPortIdSubtype: `${LLDP}.4.1.1.6`,
  lldpRemPortId: `${LLDP}.4.1.1.7`,
  lldpRemPortDesc: `${LLDP}.4.1.1.8`,
  lldpRemSysName: `${LLDP}.4.1.1.9`,
  lldpRemSysDesc: `${LLDP}.4.1.1.10`,
  lldpRemManAddrIfSubtype: `${LLDP}.4.2.1.3`,
  // LLDP-V2-MIB (IEEE 802.1AB-2009): lldpV2RemEntry { lldpV2RemTable 1 } con columnas 5 a 11 y
  // lldpV2RemManAddrEntry { lldpV2RemManAddrTable 1 }, ambas bajo lldpV2RemoteSystemsData (4).
  lldpV2RemChassisIdSubtype: `${LLDP2}.4.1.1.5`,
  lldpV2RemChassisId: `${LLDP2}.4.1.1.6`,
  lldpV2RemPortIdSubtype: `${LLDP2}.4.1.1.7`,
  lldpV2RemPortId: `${LLDP2}.4.1.1.8`,
  lldpV2RemPortDesc: `${LLDP2}.4.1.1.9`,
  lldpV2RemSysName: `${LLDP2}.4.1.1.10`,
  lldpV2RemSysDesc: `${LLDP2}.4.1.1.11`,
  lldpV2RemManAddrIfSubtype: `${LLDP2}.4.2.1.3`,
  // CISCO-CDP-MIB: cdpCacheEntry columnas 3, 4, 6, 7 y 8.
  cdpCacheAddressType: `${CDP}.3`,
  cdpCacheAddress: `${CDP}.4`,
  cdpCacheDeviceId: `${CDP}.6`,
  cdpCacheDevicePort: `${CDP}.7`,
  cdpCachePlatform: `${CDP}.8`,
  // OSPF-MIB (RFC 4750): ospfNbrEntry { ospfNbrTable 1 }, ospfRouterId { ospfGeneralGroup 1 }.
  ospfNbrRtrId: "1.3.6.1.2.1.14.10.1.3",
  ospfNbrState: "1.3.6.1.2.1.14.10.1.6",
  ospfRouterId: "1.3.6.1.2.1.14.1.1.0",
  // BGP4-MIB (RFC 4273): bgpPeerEntry { bgpPeerTable 1 }, bgpLocalAs { bgp 2 }, bgpIdentifier { bgp 4 }.
  bgpPeerState: "1.3.6.1.2.1.15.3.1.2",
  bgpPeerRemoteAs: "1.3.6.1.2.1.15.3.1.9",
  bgpLocalAs: "1.3.6.1.2.1.15.2.0",
  bgpIdentifier: "1.3.6.1.2.1.15.4.0",
  // IP-MIB (RFC 4293): ipAddrEntry, ipNetToPhysicalEntry y ipNetToMediaEntry (obsoleta, alternativa).
  ipAdEntIfIndex: "1.3.6.1.2.1.4.20.1.2",
  ipAdEntNetMask: "1.3.6.1.2.1.4.20.1.3",
  ipNetToPhysicalPhysAddress: "1.3.6.1.2.1.4.35.1.4",
  ipNetToPhysicalType: "1.3.6.1.2.1.4.35.1.6",
  ipNetToMediaPhysAddress: "1.3.6.1.2.1.4.22.1.2",
  ipNetToMediaType: "1.3.6.1.2.1.4.22.1.4",
  // BRIDGE-MIB (RFC 4188) y Q-BRIDGE-MIB (RFC 4363).
  dot1dBasePortIfIndex: "1.3.6.1.2.1.17.1.4.1.2",
  dot1dTpFdbPort: "1.3.6.1.2.1.17.4.3.1.2",
  dot1dTpFdbStatus: "1.3.6.1.2.1.17.4.3.1.3",
  dot1qTpFdbPort: "1.3.6.1.2.1.17.7.1.2.2.1.2",
  dot1qTpFdbStatus: "1.3.6.1.2.1.17.7.1.2.2.1.3",
  // CISCO-VTP-MIB: vtpVlanState { vtpVlanEntry 2 }, vtpVlanEntry = { vtpVlanTable 1 } bajo
  // vlanInfo { vtpMIBObjects 3 } de ciscoVtpMIB { ciscoMgmt 46 }.
  vtpVlanState: "1.3.6.1.4.1.9.9.46.1.3.1.1.2",
  // SNMPv2-MIB (RFC 3418): sysObjectID { system 2 } y sysName { system 5 }.
  sysObjectID: "1.3.6.1.2.1.1.2.0",
  sysName: "1.3.6.1.2.1.1.5.0",
} as const;

export type OidName = keyof typeof OID;
const NAME_OF = new Map(Object.entries(OID).map(([k, v]) => [v as string, k]));
export const oidLabel = (oid: string) => NAME_OF.get(oid) ?? oid;

/** Lo que el backend permite (espejo de snmp.rs; un test compara ambas listas). */
export const WALK_ALLOWED: string[] = [
  OID.ifDescr, OID.ifOperStatus, OID.ifName, OID.ifHighSpeed, OID.ifAlias,
  OID.lldpLocPortTable, OID.lldpRemChassisIdSubtype, OID.lldpRemChassisId, OID.lldpRemPortIdSubtype, OID.lldpRemPortId,
  OID.lldpRemPortDesc, OID.lldpRemSysName, OID.lldpRemSysDesc, OID.lldpRemManAddrIfSubtype,
  OID.cdpCacheAddressType, OID.cdpCacheAddress, OID.cdpCacheDeviceId, OID.cdpCacheDevicePort, OID.cdpCachePlatform,
  OID.ospfNbrRtrId, OID.ospfNbrState, OID.bgpPeerState, OID.bgpPeerRemoteAs,
  OID.ipAdEntIfIndex, OID.ipAdEntNetMask, OID.ipNetToPhysicalPhysAddress, OID.ipNetToPhysicalType,
  OID.ipNetToMediaPhysAddress, OID.ipNetToMediaType,
  OID.dot1dBasePortIfIndex, OID.dot1dTpFdbPort, OID.dot1dTpFdbStatus, OID.dot1qTpFdbPort, OID.dot1qTpFdbStatus,
  OID.lldpV2RemChassisIdSubtype, OID.lldpV2RemChassisId, OID.lldpV2RemPortIdSubtype, OID.lldpV2RemPortId,
  OID.lldpV2RemPortDesc, OID.lldpV2RemSysName, OID.lldpV2RemSysDesc, OID.lldpV2RemManAddrIfSubtype,
  OID.vtpVlanState,
];
export const GET_COLUMNS: string[] = [OID.ifSpeed, OID.ifInOctets, OID.ifOutOctets, OID.ifHCInOctets, OID.ifHCOutOctets, OID.ifHighSpeed];
export const GET_SCALARS: string[] = [OID.sysObjectID, OID.sysName, OID.ospfRouterId, OID.bgpLocalAs, OID.bgpIdentifier];

export interface SnmpPlanOptions {
  /** Fuente "Vecinos de ruteo": OSPF-MIB, BGP4-MIB e ipAddrTable. */
  routing: boolean;
  /** Fuente "MAC/OUI": BRIDGE-MIB, Q-BRIDGE-MIB e IP-MIB (ARP). */
  mac: boolean;
  /** "Estado de puertos": ifAlias, ifOperStatus e ifHighSpeed. */
  ports: boolean;
}

/** OIDs a leer: LLDP y CDP siempre; el resto solo con su fuente activa. */
export function snmpDiscoveryPlan(o: SnmpPlanOptions): { gets: string[]; walks: string[] } {
  const gets: string[] = [OID.sysObjectID, OID.sysName];
  const walks: string[] = [
    OID.ifName, OID.ifDescr,
    OID.lldpLocPortTable, OID.lldpRemChassisIdSubtype, OID.lldpRemChassisId, OID.lldpRemPortIdSubtype, OID.lldpRemPortId,
    OID.lldpRemPortDesc, OID.lldpRemSysName, OID.lldpRemSysDesc, OID.lldpRemManAddrIfSubtype,
    OID.cdpCacheAddressType, OID.cdpCacheAddress, OID.cdpCacheDeviceId, OID.cdpCacheDevicePort, OID.cdpCachePlatform,
    // Puerto del bridge -> ifIndex: en un bridge, lldpRemLocalPortNum es un dot1dBasePort.
    OID.dot1dBasePortIfIndex,
  ];
  if (o.ports) walks.push(OID.ifAlias, OID.ifOperStatus, OID.ifHighSpeed);
  if (o.routing) {
    gets.push(OID.ospfRouterId, OID.bgpLocalAs, OID.bgpIdentifier);
    walks.push(OID.ospfNbrRtrId, OID.ospfNbrState, OID.bgpPeerState, OID.bgpPeerRemoteAs);
  }
  if (o.routing || o.mac) walks.push(OID.ipAdEntIfIndex, OID.ipAdEntNetMask);
  if (o.mac) walks.push(OID.dot1dTpFdbPort, OID.dot1dTpFdbStatus, OID.dot1qTpFdbPort, OID.dot1qTpFdbStatus, OID.ipNetToPhysicalPhysAddress, OID.ipNetToPhysicalType);
  return { gets, walks };
}

/** ARP por la tabla obsoleta, solo si ipNetToPhysicalTable no respondió (agentes antiguos). */
export const ARP_FALLBACK = [OID.ipNetToMediaPhysAddress, OID.ipNetToMediaType];

/** LLDP-V2-MIB (802.1AB-2009), solo si LLDP-MIB (2005) no trajo vecinos. */
export const LLDP_V2_FALLBACK = [
  OID.lldpV2RemChassisIdSubtype, OID.lldpV2RemChassisId, OID.lldpV2RemPortIdSubtype, OID.lldpV2RemPortId,
  OID.lldpV2RemPortDesc, OID.lldpV2RemSysName, OID.lldpV2RemSysDesc, OID.lldpV2RemManAddrIfSubtype,
];

/** Lista de VLAN de Cisco (CISCO-VTP-MIB) y tablas MAC de BRIDGE-MIB que se leen por VLAN. */
export const VLAN_LIST = [OID.vtpVlanState];
export const VLAN_FDB_WALKS = [OID.dot1dBasePortIfIndex, OID.dot1dTpFdbPort, OID.dot1dTpFdbStatus];
/** Máximo de VLAN que se leen una por una. */
export const MAX_VLAN_READS = 64;

// ---------- Lectura de varbinds ----------

const BAD_TYPES = new Set(["noSuchObject", "noSuchInstance", "endOfMibView"]);
const ok = (r: TopoRow | undefined): r is TopoRow => !!r && !BAD_TYPES.has(r.type);

/** Filas de una columna por su índice (sufijo del OID). */
export function column(r: TopoRead, oid: string): Map<string, TopoRow> {
  const m = new Map<string, TopoRow>();
  const pre = `${oid}.`;
  for (const w of r.walks) {
    if (w.oid !== oid) continue;
    for (const row of w.rows) if (row.oid.startsWith(pre) && ok(row)) m.set(row.oid.slice(pre.length), row);
  }
  return m;
}

const scalar = (r: TopoRead, oid: string) => r.gets.find((g) => g.oid === oid && ok(g));
const int = (row: TopoRow | undefined) => {
  const n = row ? Number(row.value) : NaN;
  return Number.isInteger(n) ? n : undefined;
};
/** Bytes de una cadena de octetos (desde el hex del backend). */
export function octets(row: TopoRow | undefined): number[] | undefined {
  const h = row?.hex;
  if (!h || !/^(?:[0-9a-f]{2})*$/i.test(h)) return undefined;
  return h.match(/../g)?.map((x) => parseInt(x, 16)) ?? [];
}
/** Texto de una cadena de octetos imprimible, limpio (control y bidi fuera, largo acotado). */
function text(row: TopoRow | undefined, max = 255): string | undefined {
  if (!row || row.type !== "OCTET STRING") return undefined;
  return cleanDeviceText(row.value, max).trim() || undefined;
}
const macOf = (row: TopoRow | undefined) => {
  const b = octets(row);
  return b && b.length === 6 ? normMac(b.map((x) => x.toString(16).padStart(2, "0")).join("")) ?? undefined : undefined;
};
const ipv4Of = (b: number[] | undefined) => (b && b.length === 4 && b.every((x) => x >= 0 && x <= 255) ? b.join(".") : undefined);
/** Valor IpAddress (o cadena de 4 octetos) como IPv4 válida. */
const ipValue = (row: TopoRow | undefined) => {
  if (!row) return undefined;
  const v = row.type === "IpAddress" ? row.value : ipv4Of(octets(row));
  return v && isIpv4(v) ? v : undefined;
};
const nums = (suffix: string) => suffix.split(".").map(Number);

/** Nombre de interfaz por ifIndex: ifName y, si falta, ifDescr. Limpio y acotado. */
export function ifNames(r: TopoRead): Map<number, string> {
  const res = new Map<number, string>();
  for (const oid of [OID.ifDescr, OID.ifName]) {
    for (const [idx, row] of column(r, oid)) {
      const name = text(row, 64);
      const i = Number(idx);
      if (name && Number.isInteger(i)) res.set(i, name);
    }
  }
  return res;
}

/** ifIndex por interfaz (clave canonPort), para pedir los contadores de tráfico con GET. */
export function ifIndexByPort(names: Map<number, string>): Map<string, number> {
  const res = new Map<string, number>();
  for (const [i, n] of names) {
    for (const k of [canonPort(n), canonPort(shortPort(n))]) if (!res.has(k)) res.set(k, i);
  }
  return res;
}

const portName = (names: Map<number, string>, ifIndex: number | undefined) => (ifIndex === undefined ? undefined : names.get(ifIndex));

/** Subtipos de LLDP-MIB (IEEE 802.1AB-2005, LldpChassisIdSubtype y LldpPortIdSubtype). */
const CHASSIS_MAC = 4;
const CHASSIS_NET = 5;
const PORT_ALIAS = 1;
const PORT_MAC = 3;
const PORT_IFNAME = 5;
const PORT_LOCAL = 7;

/**
 * Vecinos LLDP desde lldpRemTable, lldpRemManAddrTable y lldpLocPortTable. El índice de
 * lldpRemTable es lldpRemTimeMark.lldpRemLocalPortNum.lldpRemIndex; si un vecino aparece con
 * varios TimeMark se usa el más reciente. lldpRemLocalPortNum es un LldpPortNumber: en un bridge
 * coincide con dot1dBasePort y si no, con ifIndex (IEEE 802.1AB-2005, LldpPortNumber).
 */
export function lldpFromSnmp(r: TopoRead, names: Map<number, string>, basePortIf: Map<number, number>): Neighbor[] {
  const cols = {
    chSub: column(r, OID.lldpRemChassisIdSubtype),
    ch: column(r, OID.lldpRemChassisId),
    ptSub: column(r, OID.lldpRemPortIdSubtype),
    pt: column(r, OID.lldpRemPortId),
    ptDesc: column(r, OID.lldpRemPortDesc),
    sys: column(r, OID.lldpRemSysName),
    desc: column(r, OID.lldpRemSysDesc),
  };
  // Clave localPort.remIndex -> sufijo con el TimeMark más reciente.
  const latest = new Map<string, { tm: number; suffix: string }>();
  for (const m of Object.values(cols)) {
    for (const suffix of m.keys()) {
      const p = nums(suffix);
      if (p.length !== 3 || p.some((x) => !Number.isInteger(x))) continue;
      const key = `${p[1]}.${p[2]}`;
      const cur = latest.get(key);
      if (!cur || p[0] > cur.tm) latest.set(key, { tm: p[0], suffix });
    }
  }
  const man = new Map<string, string>();
  for (const suffix of column(r, OID.lldpRemManAddrIfSubtype).keys()) {
    // TimeMark.LocalPortNum.RemIndex.Subtype(IANA AddressFamilyNumbers, 1 = IPv4).Largo.Bytes
    const p = nums(suffix);
    if (p.length >= 9 && p[3] === 1 && p[4] === 4) {
      const ip = ipv4Of(p.slice(5, 9));
      const key = `${p[1]}.${p[2]}`;
      if (ip && isIpv4(ip) && ip !== "0.0.0.0" && !man.has(key)) man.set(key, ip);
    }
  }
  const loc = column(r, OID.lldpLocPortTable);
  const localName = (n: number): string => {
    const sub = int(loc.get(`1.2.${n}`));
    const id = text(loc.get(`1.3.${n}`), 64);
    const desc = text(loc.get(`1.4.${n}`), 64);
    const cand = [
      sub === PORT_IFNAME ? id : undefined,
      desc && isSafeIface(desc) ? desc : undefined,
      portName(names, basePortIf.get(n)),
      basePortIf.size ? undefined : portName(names, n),
      sub === PORT_LOCAL && id && !/^\d+$/.test(id) ? id : undefined,
      desc,
    ];
    return cand.find(Boolean) ?? `puerto ${n}`;
  };
  const res: Neighbor[] = [];
  for (const [key, { suffix }] of latest) {
    const n = lldpNeighbor(cols, suffix, localName(Number(key.split(".")[0])), man.get(key));
    if (n) res.push(n);
  }
  return res;
}

type LldpCols = Record<"chSub" | "ch" | "ptSub" | "pt" | "ptDesc" | "sys" | "desc", Map<string, TopoRow>>;

/** Un vecino LLDP desde las columnas de lldpRemTable o lldpV2RemTable (mismos subtipos). */
function lldpNeighbor(cols: LldpCols, suffix: string, localPort: string, ip: string | undefined): Neighbor | undefined {
  const chSub = int(cols.chSub.get(suffix));
  const chRow = cols.ch.get(suffix);
  const chassis =
    chSub === CHASSIS_MAC
      ? macOf(chRow)
      : chSub === CHASSIS_NET
        ? ((b) => (b && b[0] === 1 ? ipv4Of(b.slice(1)) : undefined))(octets(chRow))
        : text(chRow, 64);
  const name = text(cols.sys.get(suffix), 255) ?? chassis;
  if (!name) return undefined;
  const ptSub = int(cols.ptSub.get(suffix));
  const ptRow = cols.pt.get(suffix);
  const ptText = text(ptRow, 64);
  const ptDesc = text(cols.ptDesc.get(suffix), 64);
  const remote =
    ptSub === PORT_IFNAME || (ptSub === PORT_LOCAL && ptText && !/^\d+$/.test(ptText))
      ? ptText
      : ptSub === PORT_MAC
        ? ptDesc ?? macOf(ptRow)
        : ptSub === PORT_ALIAS
          ? ptDesc ?? ptText
          : ptDesc ?? ptText;
  return {
    name,
    localPort,
    remotePort: remote ?? "",
    ip,
    // Primera línea de lldpRemSysDesc (antes de limpiar: los saltos de línea también se quitan).
    platform: ((row) => (row ? text({ ...row, value: row.value.split(/\r?\n/)[0] }, 255) : undefined))(cols.desc.get(suffix)),
    proto: "LLDP",
  };
}

/**
 * Vecinos LLDP desde LLDP-V2-MIB (IEEE 802.1AB-2009), para agentes que no publican LLDP-MIB de
 * 2005. El índice de lldpV2RemTable es lldpV2RemTimeMark.lldpV2RemLocalIfIndex.
 * lldpV2RemLocalDestMACAddress.lldpV2RemIndex: el puerto local ya es un ifIndex. Los subtipos
 * de chassis y puerto tienen los mismos valores que en 2005 (LLDP-V2-TC-MIB).
 */
export function lldpV2FromSnmp(r: TopoRead, names: Map<number, string>): Neighbor[] {
  const cols = {
    chSub: column(r, OID.lldpV2RemChassisIdSubtype),
    ch: column(r, OID.lldpV2RemChassisId),
    ptSub: column(r, OID.lldpV2RemPortIdSubtype),
    pt: column(r, OID.lldpV2RemPortId),
    ptDesc: column(r, OID.lldpV2RemPortDesc),
    sys: column(r, OID.lldpV2RemSysName),
    desc: column(r, OID.lldpV2RemSysDesc),
  };
  // Clave ifIndex.destino.remIndex -> sufijo con el TimeMark más reciente.
  const latest = new Map<string, { tm: number; suffix: string; ifIndex: number }>();
  for (const m of Object.values(cols)) {
    for (const suffix of m.keys()) {
      const p = nums(suffix);
      if (p.length !== 4 || p.some((x) => !Number.isInteger(x))) continue;
      const key = `${p[1]}.${p[2]}.${p[3]}`;
      const cur = latest.get(key);
      if (!cur || p[0] > cur.tm) latest.set(key, { tm: p[0], suffix, ifIndex: p[1] });
    }
  }
  const man = new Map<string, string>();
  for (const suffix of column(r, OID.lldpV2RemManAddrIfSubtype).keys()) {
    // TimeMark.IfIndex.Destino.RemIndex.Subtype(1 = IPv4).Largo.Bytes
    const p = nums(suffix);
    if (p.length >= 10 && p[4] === 1 && p[5] === 4) {
      const ip = ipv4Of(p.slice(6, 10));
      const key = `${p[1]}.${p[2]}.${p[3]}`;
      if (ip && isIpv4(ip) && ip !== "0.0.0.0" && !man.has(key)) man.set(key, ip);
    }
  }
  const res: Neighbor[] = [];
  for (const [key, { suffix, ifIndex }] of latest) {
    const n = lldpNeighbor(cols, suffix, portName(names, ifIndex) ?? `puerto ${ifIndex}`, man.get(key));
    if (n) res.push(n);
  }
  return res;
}

/**
 * Vecinos CDP desde cdpCacheTable (índice cdpCacheIfIndex.cdpCacheDeviceIndex). La dirección es
 * una CiscoNetworkAddress; con cdpCacheAddressType ip(1) son 4 octetos IPv4.
 */
export function cdpFromSnmp(r: TopoRead, names: Map<number, string>): Neighbor[] {
  const id = column(r, OID.cdpCacheDeviceId);
  const port = column(r, OID.cdpCacheDevicePort);
  const plat = column(r, OID.cdpCachePlatform);
  const at = column(r, OID.cdpCacheAddressType);
  const addr = column(r, OID.cdpCacheAddress);
  const res: Neighbor[] = [];
  for (const [suffix, row] of id) {
    const p = nums(suffix);
    const name = text(row, 255);
    const remote = text(port.get(suffix), 64);
    const local = p.length === 2 ? portName(names, p[0]) : undefined;
    if (!name || !remote || !local) continue;
    const ip = int(at.get(suffix)) === 1 ? ipv4Of(octets(addr.get(suffix))) : undefined;
    res.push({ name, localPort: local, remotePort: remote, ip: ip && isIpv4(ip) && ip !== "0.0.0.0" ? ip : undefined, platform: text(plat.get(suffix), 255), proto: "CDP" });
  }
  return res;
}

interface OwnAddr {
  ip: string;
  ifIndex: number;
  mask?: string;
}

const ipInt = (ip: string) => ip.split(".").reduce((a, o) => ((a << 8) | Number(o)) >>> 0, 0);

/** Direcciones propias desde ipAddrTable (índice = ipAdEntAddr). */
export function ownAddrs(r: TopoRead): OwnAddr[] {
  const masks = column(r, OID.ipAdEntNetMask);
  const res: OwnAddr[] = [];
  for (const [suffix, row] of column(r, OID.ipAdEntIfIndex)) {
    const ifIndex = int(row);
    if (!isIpv4(suffix) || ifIndex === undefined) continue;
    res.push({ ip: suffix, ifIndex, mask: ipValue(masks.get(suffix)) });
  }
  return res;
}

/** Interfaz propia cuya subred contiene `ip` (excluye /32 y la propia dirección). */
function subnetIface(own: OwnAddr[], names: Map<number, string>, ip: string): string | undefined {
  if (!isIpv4(ip)) return undefined;
  const x = ipInt(ip);
  const hit = own.find((o) => o.mask && o.mask !== "255.255.255.255" && o.ip !== ip && (ipInt(o.ip) & ipInt(o.mask)) === (x & ipInt(o.mask)));
  return hit ? names.get(hit.ifIndex) : undefined;
}

/** OSPF-MIB ospfNbrState: down(1) y attempt(2) no son adyacencia (igual que por CLI). */
const OSPF_DOWN_STATES = new Set([1, 2]);
/** BGP4-MIB bgpPeerState: established(6). */
const BGP_ESTABLISHED = 6;

/**
 * Vecinos de ruteo desde ospfNbrTable (índice ospfNbrIpAddr.ospfNbrAddressLessIndex) y
 * bgpPeerTable (índice bgpPeerRemoteAddr). La interfaz local sale de ospfNbrAddressLessIndex
 * (ifIndex en interfaces sin dirección) o de la subred propia que contiene la dirección del vecino.
 */
export function routingFromSnmp(r: TopoRead, names: Map<number, string>, own: OwnAddr[]): Neighbor[] {
  const state = column(r, OID.ospfNbrState);
  const igp: Neighbor[] = [];
  for (const [suffix, row] of column(r, OID.ospfNbrRtrId)) {
    const p = nums(suffix);
    const rid = ipValue(row);
    const st = int(state.get(suffix));
    if (p.length !== 5 || !rid || (st !== undefined && OSPF_DOWN_STATES.has(st))) continue;
    const addr = p.slice(0, 4).join(".");
    const usable = isIpv4(addr) && addr !== "0.0.0.0" ? addr : undefined;
    const iface = (p[4] > 0 ? names.get(p[4]) : undefined) ?? (usable ? subnetIface(own, names, usable) : undefined);
    igp.push({
      name: rid,
      localPort: iface ?? "",
      remotePort: "",
      ip: usable ?? rid,
      addrs: [...new Set([rid, usable].filter((x): x is string => !!x))],
      proto: "OSPF",
      byAddr: true,
    });
  }
  const bState = column(r, OID.bgpPeerState);
  const bAs = column(r, OID.bgpPeerRemoteAs);
  const peers: BgpPeer[] = [];
  for (const [suffix, row] of bState) {
    if (int(row) !== BGP_ESTABLISHED || !isIpv4(suffix)) continue;
    peers.push({ ip: suffix, remoteAs: String(int(bAs.get(suffix)) ?? ""), state: "established" });
  }
  const localAs = int(scalar(r, OID.bgpLocalAs));
  return [...igp, ...bgpNeighbors(igp, localAs === undefined ? undefined : String(localAs), peers, (ip) => subnetIface(own, names, ip))];
}

/** Estado de interfaces (IF-MIB): ifOperStatus, ifHighSpeed (Mb/s) e ifAlias. */
const OPER: Record<number, string> = { 1: "up", 2: "down", 3: "testing", 4: "unknown", 5: "dormant", 6: "notPresent", 7: "lowerLayerDown" };
const MAX_SNMP_PORTS = 1024;

export function portsFromSnmp(r: TopoRead, names: Map<number, string>): Record<string, PortInfo> {
  const oper = column(r, OID.ifOperStatus);
  const speed = column(r, OID.ifHighSpeed);
  const alias = column(r, OID.ifAlias);
  const res: Record<string, PortInfo> = {};
  let n = 0;
  for (const [i, name] of names) {
    if (n >= MAX_SNMP_PORTS) break;
    const k = canonPort(name);
    if (k === "__proto__" || k === "constructor" || k === "prototype") continue;
    const s = int(speed.get(String(i)));
    const info: PortInfo = {};
    const st = int(oper.get(String(i)));
    if (st !== undefined && OPER[st]) info.status = OPER[st];
    if (s) info.speed = s >= 1000 && s % 1000 === 0 ? `${s / 1000}G` : `${s}M`;
    const d = text(alias.get(String(i)), 255);
    if (d) info.desc = d;
    if (Object.keys(info).length) {
      res[k] = info;
      n++;
    }
  }
  return res;
}

/** dot1dTpFdbStatus / dot1qTpFdbStatus: invalid(2) y self(4) no son de un vecino (RFC 4188, RFC 4363). */
const FDB_SKIP = new Set([2, 4]);

/**
 * Tabla MAC desde dot1dTpFdbTable (índice = MAC de 6 octetos) y dot1qTpFdbTable (índice =
 * dot1qFdbId + MAC). El puerto es un dot1dBasePort: se pasa a ifIndex con dot1dBasePortTable;
 * sin esa tabla no se adivina (el número de puerto del bridge no es necesariamente el ifIndex).
 */
export function fdbFromSnmp(r: TopoRead, names: Map<number, string>, basePortIf: Map<number, number>): MacRow[] {
  const rows: MacRow[] = [];
  for (const [portOid, statusOid, macAt] of [
    [OID.dot1dTpFdbPort, OID.dot1dTpFdbStatus, 0],
    [OID.dot1qTpFdbPort, OID.dot1qTpFdbStatus, 1],
  ] as const) {
    const status = column(r, statusOid);
    for (const [suffix, row] of column(r, portOid)) {
      const p = nums(suffix);
      if (p.length !== macAt + 6 || p.slice(macAt).some((x) => !(x >= 0 && x <= 255))) continue;
      const st = int(status.get(suffix));
      if (st !== undefined && FDB_SKIP.has(st)) continue;
      const mac = normMac(p.slice(macAt).map((x) => x.toString(16).padStart(2, "0")).join(""));
      const port = portName(names, basePortIf.get(int(row) ?? -1));
      if (!mac || !port || isSelfPort(port)) continue;
      rows.push({ mac, port });
    }
  }
  return rows;
}

/** ipNetToPhysicalType: invalid(2) se omite y local(5) es una dirección propia (RFC 4293). */
const ARP_INVALID = 2;
const ARP_LOCAL = 5;

/**
 * ARP desde ipNetToPhysicalTable (índice ifIndex.tipo.largo.dirección; tipo 1 = IPv4) o, si no
 * respondió, desde ipNetToMediaTable (índice ifIndex.dirección IPv4). Las direcciones propias
 * (ipAddrTable) se marcan como del equipo.
 */
export function arpFromSnmp(r: TopoRead, self: Set<string>): ArpRow[] {
  const rows: ArpRow[] = [];
  const phy = column(r, OID.ipNetToPhysicalPhysAddress);
  const phyType = column(r, OID.ipNetToPhysicalType);
  for (const [suffix, row] of phy) {
    const p = nums(suffix);
    if (p.length !== 7 || p[1] !== 1 || p[2] !== 4) continue;
    const ip = ipv4Of(p.slice(3));
    const mac = macOf(row);
    const t = int(phyType.get(suffix));
    if (!ip || !isIpv4(ip) || !mac || t === ARP_INVALID) continue;
    rows.push({ mac, ip, self: t === ARP_LOCAL || self.has(ip) });
  }
  const media = column(r, OID.ipNetToMediaPhysAddress);
  const mediaType = column(r, OID.ipNetToMediaType);
  for (const [suffix, row] of media) {
    const p = nums(suffix);
    if (p.length !== 5) continue;
    const ip = ipv4Of(p.slice(1));
    const mac = macOf(row);
    if (!ip || !isIpv4(ip) || !mac || int(mediaType.get(suffix)) === ARP_INVALID) continue;
    rows.push({ mac, ip, self: self.has(ip) });
  }
  return rows;
}

export interface SnmpDiscovery {
  /** sysName limpio (sin él se usa el nombre del perfil). */
  name?: string;
  /** LLDP y CDP. */
  neighbors: Neighbor[];
  /** OSPF y BGP (solo con la fuente de ruteo). */
  routing: Neighbor[];
  ports?: Record<string, PortInfo>;
  /** Direcciones propias para reconocer al equipo (ipAddrTable, router-id, identificador BGP). */
  addrs: string[];
  macRows: MacRow[];
  arpRows: ArpRow[];
  /** ifIndex por interfaz (canonPort), reutilizable para leer contadores de tráfico. */
  ifIndex: Map<string, number>;
  /** LLDP y CDP vacíos: el protocolo está apagado en el equipo (o el agente no expone la MIB). */
  l2Empty: boolean;
  /** Avisos legibles: tablas parciales, topes y errores. */
  notes: string[];
}

/** Avisos por tabla: tiempo agotado, tope de filas o error (sin repetir el mismo error). */
export function walkNotes(r: TopoRead): string[] {
  const notes: string[] = [];
  const seen = new Set<string>();
  for (const w of r.walks) {
    const name = oidLabel(w.oid);
    if (w.timedOut) notes.push(`${name}: tiempo agotado, resultado parcial (${w.rows.length} ${w.rows.length === 1 ? "fila" : "filas"})`);
    else if (w.truncated) notes.push(`${name}: tope de 10.000 filas, resultado parcial`);
    else if (w.error && !seen.has(w.error)) {
      seen.add(w.error);
      notes.push(`${name}: ${cleanDeviceText(w.error, 160)}`);
    }
  }
  if (r.getError) notes.push(`GET: ${cleanDeviceText(r.getError, 160)}`);
  return notes;
}

/** dot1dBasePortTable: puerto del bridge -> ifIndex. */
function basePorts(r: TopoRead): Map<number, number> {
  const res = new Map<number, number>();
  for (const [suffix, row] of column(r, OID.dot1dBasePortIfIndex)) {
    const bp = Number(suffix);
    const i = int(row);
    if (Number.isInteger(bp) && i !== undefined) res.set(bp, i);
  }
  return res;
}

/** Agente de Cisco: sysObjectID bajo enterprises.cisco (1.3.6.1.4.1.9, SNMPv2-SMI y CISCO-SMI). */
export function isCiscoAgent(r: TopoRead): boolean {
  const id = scalar(r, OID.sysObjectID);
  return !!id && id.type === "OID" && /^\.?1\.3\.6\.1\.4\.1\.9(\.|$)/.test(id.value);
}

/**
 * En Cisco la tabla MAC de BRIDGE-MIB es por VLAN: sin indicar la VLAN (community@vlan o
 * contexto v3 vlan-N) dot1dTpFdbTable vuelve vacía o solo con la VLAN 1. Se lee por VLAN cuando
 * el agente es Cisco y la tabla general no trajo filas.
 */
export const needsVlanFdb = (r: TopoRead) => isCiscoAgent(r) && column(r, OID.dot1dTpFdbPort).size === 0;

/** VLAN 1002 a 1005: las de FDDI y Token Ring que Cisco crea por defecto, sin tabla MAC útil. */
const VLAN_DEFAULT_LEGACY = new Set([1002, 1003, 1004, 1005]);
/** vtpVlanState operational(1) (CISCO-VTP-MIB). */
const VLAN_OPERATIONAL = 1;

/**
 * VLAN activas desde vtpVlanState (índice managementDomainIndex.vtpVlanIndex), sin repetir, en
 * orden y con el tope MAX_VLAN_READS. `total` es cuántas había antes del tope.
 */
export function activeVlans(r: TopoRead): { vlans: number[]; total: number } {
  const set = new Set<number>();
  for (const [suffix, row] of column(r, OID.vtpVlanState)) {
    const p = nums(suffix);
    const v = p[1];
    if (p.length !== 2 || !Number.isInteger(v) || v < 1 || v > 4094 || VLAN_DEFAULT_LEGACY.has(v)) continue;
    if (int(row) === VLAN_OPERATIONAL) set.add(v);
  }
  const all = [...set].sort((a, b) => a - b);
  return { vlans: all.slice(0, MAX_VLAN_READS), total: all.length };
}

/** Lectura de la tabla MAC de una VLAN (snmp_topo_read con `vlan`). */
export interface VlanRead {
  vlan: number;
  read: TopoRead;
}

/**
 * Filas MAC de las lecturas por VLAN. Cada contexto trae su propia dot1dBasePortTable (los
 * puertos de esa VLAN); si no vino, se usa la general.
 */
export function vlanFdbRows(reads: VlanRead[], names: Map<number, string>, fallback: Map<number, number>): MacRow[] {
  const seen = new Set<string>();
  const rows: MacRow[] = [];
  for (const { read } of reads) {
    const own = basePorts(read);
    for (const row of fdbFromSnmp(read, names, own.size ? own : fallback)) {
      const k = `${row.mac} ${row.port}`;
      if (!seen.has(k)) {
        seen.add(k);
        rows.push(row);
      }
    }
  }
  return rows;
}

/** Convierte una lectura SNMP a las estructuras de la topología. */
export function parseSnmpDiscovery(r: TopoRead, o: SnmpPlanOptions, vlanReads: VlanRead[] = []): SnmpDiscovery {
  const names = ifNames(r);
  const basePortIf = basePorts(r);
  // LLDP-V2-MIB solo si LLDP-MIB de 2005 no trajo vecinos (agentes que solo publican la de 2009).
  const lldp1 = lldpFromSnmp(r, names, basePortIf);
  const lldp = lldp1.length ? lldp1 : lldpV2FromSnmp(r, names);
  const cdp = cdpFromSnmp(r, names);
  const own = ownAddrs(r);
  const routing = o.routing ? routingFromSnmp(r, names, own) : [];
  const ids = [scalar(r, OID.ospfRouterId), scalar(r, OID.bgpIdentifier)].map(ipValue);
  const addrs = [...new Set([...own.map((a) => a.ip), ...ids].filter((x): x is string => !!x && isIpv4(x) && x !== "0.0.0.0" && !isSharedAddr(x)))];
  const self = new Set(own.map((a) => a.ip));
  return {
    name: text(scalar(r, OID.sysName), 255),
    neighbors: [...cdp, ...lldp],
    routing,
    ports: o.ports ? portsFromSnmp(r, names) : undefined,
    addrs,
    macRows: o.mac ? [...fdbFromSnmp(r, names, basePortIf), ...vlanFdbRows(vlanReads, names, basePortIf)] : [],
    arpRows: o.mac ? arpFromSnmp(r, self) : [],
    ifIndex: ifIndexByPort(names),
    l2Empty: !lldp.length && !cdp.length,
    notes: [...walkNotes(r), ...vlanReads.flatMap((v) => walkNotes(v.read).map((n) => `VLAN ${v.vlan}: ${n}`))],
  };
}

/** LLDP-MIB (2005) sin vecinos: se pide LLDP-V2-MIB (2009). */
export const needsLldpV2Fallback = (r: TopoRead) => column(r, OID.lldpRemSysName).size === 0 && column(r, OID.lldpRemChassisId).size === 0;

/** ipNetToPhysicalTable vacía: se pide la tabla obsoleta ipNetToMediaTable. */
export const needsArpFallback = (r: TopoRead) => column(r, OID.ipNetToPhysicalPhysAddress).size === 0;
