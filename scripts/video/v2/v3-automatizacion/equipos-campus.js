// Equipos ficticios del video 3 (automatización): un campus con IPs de documentación (RFC 5737)
// y números de serie inventados. Responden solo comandos de consulta, con el formato de Cisco
// IOS-XE. Los usan la prueba de los ejemplos (Node + Python) y el backend simulado del video.
// Sin dependencias.

const STATUS_COLS = [10, 19, 13, 11, 8, 7];
const fila = (cols) => cols.map((c, i) => (i < STATUS_COLS.length ? c.padEnd(STATUS_COLS[i]) : c)).join("").trimEnd();
const STATUS_HEADER = fila(["Port", "Name", "Status", "Vlan", "Duplex", "Speed", "Type"]);

/** Puertos de acceso: [puerto, nombre, estado, vlan]. */
const puertos = (lista) => [
  STATUS_HEADER,
  ...lista.map(([p, n, s, v]) =>
    fila([p, n, s, v, s === "connected" ? "a-full" : "auto", s === "connected" ? "a-1000" : "auto", "10/100/1000BaseTX"]),
  ),
];

export const EQUIPOS = {
  "core-sw01": {
    host: "192.0.2.1",
    modelo: "C9300-48P",
    serie: "FOC0000A0C1",
    version: "17.12.04",
    uptime: "47 days, 17 hours, 30 minutes",
    puertos: [
      ["Gi1/0/1", "UPLINK acc-sw01", "connected", "trunk"],
      ["Gi1/0/2", "UPLINK acc-sw02", "connected", "trunk"],
      ["Gi1/0/3", "", "notconnect", "1"],
      ["Gi1/0/4", "Reservado", "disabled", "1"],
      ["Te1/1/1", "UPLINK rtr-borde01", "connected", "trunk"],
    ],
    errores: {},
  },
  "acc-sw01": {
    host: "192.0.2.11",
    modelo: "C9200L-24P-4G",
    serie: "JAE0000B1A1",
    version: "17.09.05",
    uptime: "12 days, 3 hours, 5 minutes",
    puertos: [
      ["Gi1/0/1", "Puesto 101", "connected", "10"],
      ["Gi1/0/2", "Puesto 102", "connected", "10"],
      ["Gi1/0/3", "Puesto 103", "notconnect", "10"],
      ["Gi1/0/4", "Telefono 104", "connected", "20"],
      ["Gi1/0/5", "Impresora piso 1", "err-disabled", "10"],
      ["Gi1/0/6", "", "notconnect", "10"],
      ["Gi1/0/7", "AP piso 1", "connected", "30"],
      ["Gi1/0/8", "Reservado", "disabled", "1"],
      ["Gi1/0/24", "UPLINK core-sw01", "connected", "trunk"],
    ],
    errores: { "Gi1/0/7": [0, 152, 0, 152, 0, 0], "Gi1/0/2": [3, 0, 0, 3, 0, 0] },
  },
  "acc-sw02": {
    host: "192.0.2.12",
    modelo: "C9200L-24P-4G",
    serie: "JAE0000B2A2",
    version: "17.09.05",
    uptime: "12 days, 2 hours, 58 minutes",
    puertos: [
      ["Gi1/0/1", "Puesto 201", "connected", "10"],
      ["Gi1/0/2", "Puesto 202", "notconnect", "10"],
      ["Gi1/0/3", "Puesto 203", "notconnect", "10"],
      ["Gi1/0/4", "Sala reuniones", "connected", "10"],
      ["Gi1/0/24", "UPLINK core-sw01", "connected", "trunk"],
    ],
    errores: {},
  },
  // Router: no tiene "show interfaces status" (el script lo informa en vez de fallar).
  "rtr-borde01": {
    host: "198.51.100.1",
    modelo: "ISR4331/K9",
    serie: "FLM0000C3B3",
    version: "17.09.05",
    uptime: "130 days, 6 hours, 12 minutes",
    router: true,
  },
  // Equipo que no responde: sirve para probar el manejo de tiempo agotado.
  "sw-lab09": { host: "192.0.2.99", mudo: true },
};

const VERSION = (nombre, e) => [
  `Cisco IOS XE Software, Version ${e.version}`,
  `Cisco IOS Software, ${e.router ? "ISR" : "Catalyst L3 Switch"} Software, Version ${e.version.replace(/\.0(\d)/g, ".$1")}, RELEASE SOFTWARE (fc2)`,
  `${nombre} uptime is ${e.uptime}`,
  'System image file is "bootflash:packages.conf"',
  `cisco ${e.modelo} (X86) processor with 1331521K/6147K bytes of memory.`,
  `Processor board ID ${e.serie}`,
  ...(e.router ? [] : [`Model Number                       : ${e.modelo}`, `System Serial Number               : ${e.serie}`]),
];

const ERRORES = (e) => {
  const tabla = (titulos, desde) => [
    "",
    "Port".padEnd(8) + titulos.map((t) => t.padStart(12)).join(""),
    ...e.puertos.map(([p]) => p.padEnd(8) + (e.errores[p] ?? [0, 0, 0, 0, 0, 0]).slice(desde, desde + 3).map((n) => String(n).padStart(12)).join("")),
  ];
  return [...tabla(["Align-Err", "FCS-Err", "Xmit-Err"], 0), ...tabla(["Rcv-Err", "UnderSize", "OutDiscards"], 3)];
};

const PING = (ip) => {
  const cab = ["Type escape sequence to abort.", `Sending 5, 100-byte ICMP Echos to ${ip}, timeout is 2 seconds:`];
  // 198.51.100.20 no responde: el ping tarda unos 10 s y la primera espera vence.
  if (ip === "198.51.100.20") return { lento: true, parcial: [...cab, "..."], resto: ["..", "Success rate is 0 percent (0/5)"] };
  return [...cab, "!!!!!", "Success rate is 100 percent (5/5), round-trip min/avg/max = 1/1/2 ms"];
};

/** Log de los switches: el puerto Gi1/0/5 de acc-sw01 cayó en err-disabled por BPDU guard. */
const LOG = {
  "acc-sw01": [
    "*Oct 21 08:14:02.311: %LINK-3-UPDOWN: Interface GigabitEthernet1/0/2, changed state to up",
    "*Oct 21 09:30:47.902: %SPANTREE-2-BLOCK_BPDUGUARD: Received BPDU on port Gi1/0/5 with BPDU Guard enabled. Disabling port.",
    "*Oct 21 09:30:47.905: %PM-4-ERR_DISABLE: bpduguard error detected on Gi1/0/5, putting Gi1/0/5 in err-disable state",
    "*Oct 21 09:30:48.910: %LINK-3-UPDOWN: Interface GigabitEthernet1/0/5, changed state to down",
  ],
};

/** Puerto por nombre corto o largo (Gi1/0/5 o GigabitEthernet1/0/5). */
const corto = (s) => s.replace(/^GigabitEthernet/i, "Gi").replace(/^TenGigabitEthernet/i, "Te").toLowerCase();
const largo = (p) => p.replace(/^Gi/, "GigabitEthernet").replace(/^Te/, "TenGigabitEthernet");
const ESTADO_IF = { connected: ["up", "up (connected)"], notconnect: ["down", "down (notconnect)"], disabled: ["administratively down", "down (disabled)"], "err-disabled": ["down", "down (err-disabled)"] };

function interfaz(e, nombre, resto) {
  const p = e.puertos?.find(([x]) => corto(x) === corto(nombre));
  if (!p) return null;
  if (resto === "status") return puertos([p]);
  if (resto !== "") return null;
  const [a, b] = ESTADO_IF[p[2]];
  const err = (e.errores[p[0]] ?? [0, 0, 0, 0, 0, 0]).reduce((s, n) => s + n, 0);
  return [
    `${largo(p[0])} is ${a}, line protocol is ${b}`,
    `  Description: ${p[1]}`,
    `     ${err} input errors, ${e.errores[p[0]]?.[1] ?? 0} CRC, 0 frame, 0 overrun, 0 ignored`,
    "     0 output errors, 0 collisions, 1 interface resets",
  ];
}

const MAC = (p) => [
  "          Mac Address Table",
  "-------------------------------------------",
  "",
  "Vlan    Mac Address       Type        Ports",
  "----    -----------       --------    -----",
  ...(p.toLowerCase() === "gi1/0/1" ? ["  10    0200.5e00.0a01    DYNAMIC     Gi1/0/1"] : []),
  `Total Mac Addresses for this criterion: ${p.toLowerCase() === "gi1/0/1" ? 1 : 0}`,
];

/** Respuesta de un equipo a un comando; null si no lo conoce. Firma de python-simulado.mjs. */
export function respuestaCampus(cmd, nombre) {
  const e = EQUIPOS[nombre];
  if (!e) return null;
  if (e.mudo) return { mudo: true };
  const c = cmd.trim().replace(/\s+/g, " ");
  const [base, filtro] = c.split(" | include ");
  let lineas = null;
  if (base === "terminal length 0") lineas = [];
  else if (base === "show version") lineas = VERSION(nombre, e);
  else if (base === "show interfaces status")
    lineas = e.router ? ["                   ^", "% Invalid input detected at '^' marker."] : puertos(e.puertos);
  else if (base === "show interfaces counters errors" && !e.router) lineas = ERRORES(e);
  else if (/^ping \d+\.\d+\.\d+\.\d+$/.test(base)) return PING(base.split(" ")[1]);
  else if (base === "show logging") lineas = LOG[nombre] ?? [];
  else if (/^show mac address-table interface \S+$/.test(base) && !e.router) lineas = MAC(base.split(" ").pop());
  else if (/^show interfaces \S+( status)?$/.test(base) && !e.router) {
    const [, , nombreIf, resto = ""] = base.split(" ");
    lineas = interfaz(e, nombreIf, resto);
  }
  if (!lineas) return null;
  return filtro ? lineas.filter((l) => new RegExp(filtro).test(l)) : lineas;
}
