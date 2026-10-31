/**
 * Backend simulado para capturas de pantalla (solo `npm run dev` + /scripts/screenshots/demo.html).
 * Todos los datos son ficticios: IPs de documentación (RFC 5737) y nombres genéricos.
 */
const cbs = new Map();
let nextId = 1;
let busyVerifies = 0;
const listeners = new Map(); // evento -> [callbackId]
const channels = new Map(); // conexión -> canales de datos
const enc = new TextEncoder();

function emit(event, payload) {
  for (const id of listeners.get(event) ?? []) cbs.get(id)?.({ event, id: 0, payload });
}

const now = Date.now();
const sessions = [
  ["core-sw01", "ssh", "Sitio Central/Core", "192.0.2.1", "admin", "cisco"],
  ["core-sw02", "ssh", "Sitio Central/Core", "192.0.2.2", "admin", "cisco"],
  ["dist-sw01", "ssh", "Sitio Central/Distribución", "192.0.2.11", "admin", "cisco"],
  ["ar-wan01", "ssh", "Sitio Central/WAN", "198.51.100.1", "netops", "huawei"],
  ["fw-perimetro", "ssh", "Sitio Central/Seguridad", "198.51.100.10", "admin", "fortinet"],
  ["mx-borde01", "ssh", "Sucursales/Norte", "203.0.113.1", "netops", "juniper"],
  ["sw-acceso-norte", "telnet", "Sucursales/Norte", "203.0.113.20", "", "cisco"],
  ["sw-acceso-sur", "ssh", "Sucursales/Sur", "203.0.113.40", "admin", "huawei"],
  ["Consola USB", "serial", "Laboratorio", "", "", ""],
  ["router-antiguo", "ssh", "Laboratorio", "192.0.2.99", "admin", "cisco"],
  ["Shell local", "local", "", "", "", ""],
].map(([name, type, folder, host, username, highlight], i) => ({
  id: `s${i}`, name, type, folder, host, username, highlight: highlight || "default",
  port: type === "telnet" ? 23 : 22, serial_port: "/dev/tty.usbserial-0001", baud_rate: 9600,
  created_at: new Date(now - i * 86400000).toISOString(),
  // Demo: una sesión con contraseña guardada (indicador de llave en la barra de estado).
  ...(name === "sw-acceso-norte" ? { save_password: true } : {}),
}));

// ?nodist=1: dist-sw01 sin sesión guardada (solo se alcanza saltando desde core-sw01): la ruta es core-sw01 › dist-sw01 › sw-acceso-01.
if (location.search.includes("nodist") || new URLSearchParams(location.search).has("chain")) sessions.splice(sessions.findIndex((x) => x.name === "dist-sw01"), 1);

const CISCO = `
\x1b[2mUltimo acceso: hace 2 horas desde 192.0.2.250\x1b[0m

core-sw01#show ip interface brief
Interface              IP-Address      OK? Method Status                Protocol
Vlan1                  unassigned      YES NVRAM  administratively down down
Vlan10                 192.0.2.1       YES NVRAM  up                    up
Vlan20                 192.0.2.65      YES NVRAM  up                    up
GigabitEthernet1/0/1   unassigned      YES unset  up                    up
GigabitEthernet1/0/2   unassigned      YES unset  up                    up
GigabitEthernet1/0/3   unassigned      YES unset  down                  down
GigabitEthernet1/0/4   unassigned      YES unset  administratively down down
TenGigabitEthernet1/1/1 unassigned     YES unset  up                    up
Port-channel1          unassigned      YES unset  up                    up
core-sw01#show running-config interface GigabitEthernet1/0/1
Building configuration...

Current configuration : 312 bytes
!
interface GigabitEthernet1/0/1
 description UPLINK a dist-sw01 Gi1/0/48
 switchport trunk allowed vlan 10,20,30
 switchport mode trunk
 channel-group 1 mode active
 spanning-tree guard root
 no shutdown
!
interface GigabitEthernet1/0/4
 description RESERVA
 shutdown
!
end

core-sw01#show logging | include LINK
*Oct 14 09:12:44.123: %LINK-3-UPDOWN: Interface GigabitEthernet1/0/3, changed state to down
*Oct 14 09:12:45.130: %LINEPROTO-5-UPDOWN: Line protocol on Interface GigabitEthernet1/0/3, changed state to down
*Oct 14 09:20:02.441: %LINK-3-UPDOWN: Interface TenGigabitEthernet1/1/1, changed state to up
core-sw01#`;

const HUAWEI = `
Info: The max number of VTY users is 15, the number of current VTY users online is 1.
<ar-wan01>display interface brief
PHY: Physical
*down: administratively down
(l): loopback
(s): spoofing
InUti/OutUti: input utility/output utility
Interface                   PHY   Protocol  InUti OutUti   inErrors  outErrors
GigabitEthernet0/0/0        up    up        12%    8%          0          0
GigabitEthernet0/0/1        up    up         3%    2%          0          0
GigabitEthernet0/0/2        down  down        0%    0%          0          0
GigabitEthernet0/0/3        *down down        0%    0%          0          0
LoopBack0                   up    up(s)       0%    0%          0          0
NULL0                       up    up(s)       0%    0%          0          0
<ar-wan01>display ip routing-table protocol bgp
Route Flags: R - relay, D - download to fib
------------------------------------------------------------------------------
Public routing table : BGP
         Destinations : 2        Routes : 2

BGP routing table status : <Active>
         Destinations : 2        Routes : 2

Destination/Mask    Proto   Pre  Cost      Flags NextHop         Interface

     0.0.0.0/0      EBGP    255  0           D   198.51.100.254  GigabitEthernet0/0/0
   203.0.113.0/24   EBGP    255  0           D   198.51.100.254  GigabitEthernet0/0/0

<ar-wan01>`;

let terminalFor = (s) => {
  if (s.highlight === "huawei") return HUAWEI;
  if (s.type === "local") return "\x1b[32muser@laptop\x1b[0m:\x1b[34m~\x1b[0m$ ";
  return CISCO.replaceAll("core-sw01", s.name);
};

const notes = {
  "plantilla-vlan.txt": `! Alta de VLAN en acceso (variables con {{...}})
vlan {{vlan}}
 name {{nombre}}
!
interface {{interfaz}}
 description {{descripcion}}
 switchport mode access
 switchport access vlan {{vlan}}
 spanning-tree portfast
 no shutdown
!
end
write memory`,
  "checklist-cambio.txt": "1. Respaldo de configuración\n2. show ip int brief (antes)\n3. Aplicar cambio\n4. Validar\n",
};
// Notas protegidas simuladas: el contenido solo se entrega con la contraseña correcta
// (contraseña de demo, nunca vuelve al frontend). La llave "abierta" es solo el nombre.
const secureNotes = {
  "accesos-sitio-central": {
    password: "demo-clave-2026",
    content: `! Accesos de emergencia (datos ficticios)
! Consola fuera de banda
ssh admin@192.0.2.250
enable secret {{enable}}
!
snmp-server community {{comunidad}} RO 10
tacacs-server host 192.0.2.50 key {{tacacs}}`,
  },
};
let unlockedNote = null;
const NOTE_LOCKED = "La nota está bloqueada. Ingresa su contraseña para abrirla";

const settings = {
  monitors: [
    { id: "m1", name: "Gateway sitio central", kind: "icmp", host: "192.0.2.1", intervalMs: 1000, timeoutMs: 1000, threshold: 3, sound: true, repeatSec: 0, active: true },
    { id: "m2", name: "Firewall HTTPS", kind: "tcp", host: "198.51.100.10", port: 443, intervalMs: 1000, timeoutMs: 1000, threshold: 3, sound: false, repeatSec: 0, active: true },
    { id: "m3", name: "Enlace sucursal norte", kind: "icmp", host: "203.0.113.1", intervalMs: 1000, timeoutMs: 1000, threshold: 3, sound: true, repeatSec: 0, active: true },
  ],
  speedHistory: [
    { ts: new Date(now - 3 * 86400000).toISOString(), download_mbps: 412.3, upload_mbps: 188.1, latency_ms: 9.4, jitter_ms: 1.2, server: { colo: "SCL" } },
    { ts: new Date(now - 86400000).toISOString(), download_mbps: 448.9, upload_mbps: 201.7, latency_ms: 8.7, jitter_ms: 0.9, server: { colo: "SCL" } },
  ],
  updateLastCheck: now,
};

// Cada carga parte limpia.
localStorage.clear();
settings.appTheme = new URLSearchParams(location.search).get("theme") ?? "dark";
settings.showMobileKeyBar = /Android/i.test(navigator.userAgent) || location.search.includes("keybar=1");
if (location.search.includes("big=")) settings.confirmClose = false;
if (location.search.includes("autolegacy=1")) settings.autoLegacySsh = true;
// ?scene=suggest: sugerencias de comandos activas y core-sw01 con plataforma IOS-XE (con
// &video=1 la terminal hace eco de lo que se escribe; &noplatform=1 deja la plataforma sin
// detectar para ver el aviso). window.__ntSuggestPerf recibe la latencia tecla → texto gris y
// window.__ntSuggestCost el costo de cada cuadro de sugerencias (ms).
if (location.search.includes("scene=suggest")) {
  settings.commandSuggest = true;
  settings.commandSuggestSet = true;
  if (!location.search.includes("noplatform=1")) sessions[0].platform = "iosxe";
  window.__ntSuggestPerf = [];
  window.__ntSuggestCost = [];
}
// ?scene=vrp (con &video=1): ar-wan01 como Huawei VRP para probar Retroceso; &vrpplatform=1 le
// asigna la plataforma vrp8 (Retroceso en automático envía BS) y &bs=del|bs fija el modo.
if (location.search.includes("scene=vrp")) {
  const q = new URLSearchParams(location.search);
  if (q.has("vrpplatform")) sessions[3].platform = "vrp8";
  if (q.get("bs") === "del" || q.get("bs") === "bs") sessions[3].backspace = q.get("bs");
}
if (location.search.includes("scene=vertical") || location.search.includes("layout=vertical")) settings.tabLayout = "vertical";
// &floating=1: barra de sesiones flotante; &nomacros=1: sin botones (la barra de botones se oculta sola).
if (location.search.includes("floating=1")) settings.floatingSidebar = true;
if (location.search.includes("nomacros=1")) settings.macros = [];
// ?toast=1: una alerta por palabra clave activa que dispara un aviso (toast) y marca la primera pestaña.
if (location.search.includes("toast=1")) {
  settings.alertRules = [{ id: "qa-updown", name: "Interfaz cambió de estado", pattern: "%LINK-3-UPDOWN", regex: false, caseSensitive: true, enabled: true, folder: "", toast: true, sound: false, markTab: true, highlight: false }];
  const fire = setInterval(() => {
    if (channels.size < 2) return;
    clearInterval(fire);
    emit("alert-hit", { conn: [...channels.keys()][0], rule: "qa-updown", line: "%LINK-3-UPDOWN: Interface GigabitEthernet1/0/3, changed state to down" });
  }, 300);
}
// ?term=<id>: tema de terminal preseleccionado (capturas de temas).
settings.terminalTheme = new URLSearchParams(location.search).get("term") ?? "auto";
// ?logsdir=1: carpeta de logs elegida por el usuario (modo portable, con su aviso).
let logsDir = location.search.includes("logsdir=1") ? "/Volumes/USB/Logs-NOC" : "";
if (logsDir) settings.logsDir = logsDir;
// &lifecycle=1: ciclo de vida del equipo activado (opcional, apagado por defecto).
if (location.search.includes("lifecycle=1")) settings.lifecycleInfo = true;
const logsDirInfo = () => ({ path: logsDir || "~/NetTerminal/data/logs", default: "~/NetTerminal/data/logs", custom: !!logsDir, portable: !!logsDir });
if (location.search.includes("collapsed=1")) localStorage.setItem("vtabsCollapsed", "true");
const topology = {
  nodes: [
    { id: "core-sw01", name: "core-sw01", ip: "192.0.2.1", platform: "C9500-24Y4C", explored: true, x: 420, y: 80 },
    { id: "core-sw02", name: "core-sw02", ip: "192.0.2.2", platform: "C9500-24Y4C", explored: true, x: 720, y: 80 },
    { id: "dist-sw01", name: "dist-sw01", ip: "192.0.2.11", platform: "C9300-48P", explored: true, x: 260, y: 250 },
    { id: "ar-wan01", name: "ar-wan01", ip: "198.51.100.1", platform: "AR6140", explored: false, x: 820, y: 250 },
    { id: "fw-perimetro", name: "fw-perimetro", ip: "198.51.100.10", platform: "FortiGate-200F", explored: false, x: 540, y: 250 },
    { id: "sw-acceso-01", name: "sw-acceso-01", ip: "192.0.2.21", platform: "C9200L-24P", explored: false, x: 130, y: 420 },
    { id: "sw-acceso-02", name: "sw-acceso-02", ip: "192.0.2.22", platform: "C9200L-24P", explored: false, x: 390, y: 420 },
  ],
  links: [
    { a: "core-sw01", aPort: "Te1/1/1", b: "core-sw02", bPort: "Te1/1/1", proto: "CDP" },
    { a: "core-sw01", aPort: "Gi1/0/1", b: "dist-sw01", bPort: "Gi1/0/48", proto: "CDP" },
    { a: "core-sw01", aPort: "Gi1/0/10", b: "fw-perimetro", bPort: "port1", proto: "LLDP" },
    { a: "core-sw02", aPort: "Gi1/0/11", b: "ar-wan01", bPort: "GE0/0/1", proto: "LLDP" },
    { a: "dist-sw01", aPort: "Gi1/0/1", b: "sw-acceso-01", bPort: "Gi1/0/24", proto: "CDP" },
    { a: "dist-sw01", aPort: "Gi1/0/2", b: "sw-acceso-02", bPort: "Gi1/0/24", proto: "CDP" },
  ],
};
// Segundo enlace del Port-channel y estado de puertos de ejemplo.
topology.links.push({ a: "core-sw01", aPort: "Gi1/0/2", b: "dist-sw01", bPort: "Gi1/0/47", proto: "CDP" });
topology.nodes[0].ports = {
  "gi1/0/1": { status: "connected", speed: "a-1000", desc: "UPLINK dist-sw01", group: "Po1" },
  "gi1/0/2": { status: "connected", speed: "a-1000", desc: "UPLINK dist-sw01", group: "Po1" },
  "te1/1/1": { status: "connected", speed: "10G", desc: "ISL core-sw02" },
};
settings.topology = topology;
// Snapshot anterior: tenía un acceso más que hoy ya no aparece.
settings.topoSnapshots = [{
  id: "s1", name: "Antes de la ventana de cambio", ts: now - 7 * 86400000,
  topo: {
    nodes: [...topology.nodes.filter((n) => n.id !== "ar-wan01"), { id: "sw-acceso-03", name: "sw-acceso-03", ip: "192.0.2.23", explored: false, x: 520, y: 420 }],
    links: [...topology.links.filter((l) => l.b !== "ar-wan01"), { a: "dist-sw01", aPort: "Gi1/0/3", b: "sw-acceso-03", bPort: "Gi1/0/24", proto: "CDP" }],
  },
}];
// Topología con fuentes adicionales: un ejemplo de cada tipo de enlace (CDP, LLDP, OSPF, EIGRP,
// BGP directo y lógico, manual y descripción) y una sugerencia pendiente de confirmar.
const topoSources = {
  nodes: [
    { id: "core-sw01", name: "core-sw01", ip: "192.0.2.1", platform: "C9500-24Y4C", explored: true, x: 340, y: 80, addrs: ["192.0.2.1", "198.51.100.1"] },
    { id: "rt-borde01", name: "rt-borde01", ip: "192.0.2.40", platform: "ISR4451", explored: true, x: 720, y: 80, addrs: ["192.0.2.40", "198.51.100.2", "198.51.100.17"] },
    { id: "dist-sw01", name: "dist-sw01", ip: "192.0.2.11", platform: "C9300-48P", explored: true, x: 200, y: 250,
      ports: {
        "gi1/0/10": { status: "connected", speed: "a-1000", desc: "AP bodega" },
        "gi1/0/12": { status: "connected", speed: "a-1000", desc: "UPLINK a sw-patio-01 Gi0/1" },
        "gi1/0/20": { status: "connected", speed: "a-1000", desc: "hacia sw-taller-02 Gi0/24" },
      } },
    { id: "fw-perimetro", name: "fw-perimetro", ip: "198.51.100.10", platform: "FortiGate-200F", explored: false, x: 420, y: 250 },
    { id: "192.0.2.41", name: "192.0.2.41", ip: "198.51.100.6", explored: false, addrOnly: true, addrs: ["192.0.2.41", "198.51.100.6"], x: 680, y: 250 },
    { id: "198.51.100.18", name: "198.51.100.18", ip: "198.51.100.18", explored: false, addrOnly: true, addrs: ["198.51.100.18"], x: 920, y: 250 },
    { id: "203.0.113.1", name: "203.0.113.1", ip: "203.0.113.1", explored: false, addrOnly: true, addrs: ["203.0.113.1"], x: 980, y: 80 },
    { id: "ap-bodega", name: "ap-bodega", platform: "AP de pared", explored: false, manual: true, x: 90, y: 420 },
    { id: "sw-patio-01", name: "sw-patio-01", ip: "192.0.2.61", explored: false, manual: true, x: 310, y: 420 },
  ],
  links: [
    { a: "core-sw01", aPort: "Gi1/0/1", b: "dist-sw01", bPort: "Gi1/0/48", proto: "CDP" },
    { a: "core-sw01", aPort: "Gi1/0/10", b: "fw-perimetro", bPort: "port1", proto: "LLDP" },
    { a: "rt-borde01", aPort: "Gi0/0", b: "core-sw01", bPort: "Te1/1/2", proto: "OSPF" },
    { a: "rt-borde01", aPort: "", b: "core-sw01", bPort: "", proto: "BGP", logical: true },
    { a: "rt-borde01", aPort: "Gi0/1", b: "192.0.2.41", bPort: "", proto: "OSPF" },
    { a: "rt-borde01", aPort: "Gi0/2", b: "198.51.100.18", bPort: "", proto: "EIGRP" },
    { a: "rt-borde01", aPort: "", b: "203.0.113.1", bPort: "", proto: "BGP" },
    { a: "dist-sw01", aPort: "Gi1/0/10", b: "ap-bodega", bPort: "eth0", proto: "manual" },
    { a: "dist-sw01", aPort: "Gi1/0/12", b: "sw-patio-01", bPort: "Gi0/1", proto: "descripción" },
  ],
};
// Equipo con CDP/LLDP apagado: solo vecinos de ruteo, rotulados por IP.
const topoOspf = {
  nodes: [
    { id: "rt-borde01", name: "rt-borde01", ip: "192.0.2.40", platform: "ISR4451", explored: true, x: 560, y: 80, addrs: ["192.0.2.40", "198.51.100.1", "198.51.100.5"] },
    { id: "192.0.2.41", name: "192.0.2.41", ip: "198.51.100.2", explored: false, addrOnly: true, addrs: ["192.0.2.41", "198.51.100.2"], x: 260, y: 250 },
    { id: "192.0.2.42", name: "192.0.2.42", ip: "198.51.100.6", explored: false, addrOnly: true, addrs: ["192.0.2.42", "198.51.100.6"], x: 500, y: 250 },
    { id: "198.51.100.18", name: "198.51.100.18", ip: "198.51.100.18", explored: false, addrOnly: true, addrs: ["198.51.100.18"], x: 740, y: 250 },
    { id: "192.0.2.50", name: "192.0.2.50", ip: "192.0.2.50", explored: false, addrOnly: true, addrs: ["192.0.2.50"], x: 980, y: 250 },
  ],
  links: [
    { a: "rt-borde01", aPort: "Gi0/0", b: "192.0.2.41", bPort: "", proto: "OSPF" },
    { a: "rt-borde01", aPort: "Gi0/1", b: "192.0.2.42", bPort: "", proto: "OSPF" },
    { a: "rt-borde01", aPort: "Gi0/2", b: "198.51.100.18", bPort: "", proto: "EIGRP" },
    { a: "rt-borde01", aPort: "", b: "192.0.2.50", bPort: "", proto: "BGP", logical: true },
  ],
};
// Diagrama con equipos y enlaces agregados a mano, más sugerencias desde descripciones.
const topoManual = {
  nodes: [
    ...topology.nodes.filter((n) => !["ar-wan01", "fw-perimetro"].includes(n.id)),
    { id: "ap-bodega", name: "ap-bodega", platform: "AP de pared", explored: false, manual: true, x: 130, y: 590 },
    { id: "cam-acceso", name: "cam-acceso", ip: "192.0.2.80", explored: false, manual: true, x: 390, y: 590 },
  ].map((n) => (n.id === "sw-acceso-01" ? { ...n, explored: true, ports: { "gi1/0/10": { desc: "AP bodega" }, "gi1/0/20": { desc: "hacia sw-taller-02 Gi0/24" } } } : n)),
  links: [
    ...topology.links.filter((l) => !["ar-wan01", "fw-perimetro"].includes(l.b)),
    { a: "sw-acceso-01", aPort: "Gi1/0/10", b: "ap-bodega", bPort: "eth0", proto: "manual" },
    { a: "sw-acceso-02", aPort: "Gi1/0/5", b: "cam-acceso", bPort: "", proto: "manual" },
  ],
};
// Fuentes con tablas MAC/ARP leídas en dist-sw01: un enlace MAC/OUI ya confirmado y sugerencias
// pendientes (HSRP alta, varias MAC media, MAC local baja); las VM quedan solo en el detalle.
const vmw = (n) => ({ mac: `0050.56aa.000${n}`, vlan: "20", vendor: "VMware", kind: "host" });
const topoMac = {
  nodes: [
    ...topoSources.nodes.map((n) =>
      n.id !== "dist-sw01"
        ? n
        : {
            ...n,
            ports: { "gi1/0/10": n.ports["gi1/0/10"], "gi1/0/12": n.ports["gi1/0/12"] },
            macs: {
              "gi1/0/46": { port: "Gi1/0/46", total: 1, macs: [{ mac: "0000.0c07.ac0a", vlan: "10", ip: "192.0.2.254", fhrp: "HSRP v1 grupo 10" }] },
              "gi1/0/30": { port: "Gi1/0/30", total: 1, macs: [{ mac: "00e0.fc12.3456", vlan: "10", ip: "192.0.2.30", vendor: "Huawei", kind: "net" }] },
              "gi1/0/40": {
                port: "Gi1/0/40",
                total: 6,
                macs: [
                  { mac: "001b.2100.0001", vlan: "20", ip: "192.0.2.101", vendor: "Intel", kind: "host" },
                  { mac: "3c07.5400.0001", vlan: "20", vendor: "Apple", kind: "host" },
                  { mac: "f8bc.1200.0001", vlan: "20", ip: "192.0.2.103", vendor: "Dell", kind: "host" },
                  { mac: "0011.2233.4401", vlan: "20" },
                  vmw(4),
                  vmw(5),
                ],
              },
              "gi1/0/11": { port: "Gi1/0/11", total: 1, macs: [{ mac: "5254.0012.3456", vlan: "10" }] },
              "gi1/0/12": { port: "Gi1/0/12", total: 1, macs: [{ mac: "00e0.fc00.0abc", vlan: "10", vendor: "Huawei", kind: "net" }] },
              "gi1/0/15": { port: "Gi1/0/15", total: 2, macs: [vmw(1), vmw(2)] },
            },
          },
    ),
    { id: "mac-00e0.fc12.3456", name: "Huawei 192.0.2.30", ip: "192.0.2.30", platform: "Huawei (por OUI)", explored: false, manual: true, addrOnly: true, addrs: ["192.0.2.30"], x: 530, y: 420 },
  ],
  links: [...topoSources.links, { a: "dist-sw01", aPort: "Gi1/0/30", b: "mac-00e0.fc12.3456", bPort: "", proto: "MAC/OUI" }],
};
// Revisiones de enlaces: dúplex y VLAN nativa distintos, miembro fuera del Po, CRC, asimetría y
// puertos activos sin vecino (L2 desconocido).
const topoChecks = {
  nodes: topology.nodes.map((n) => ({ ...n })),
  links: topology.links.map((l) => ({ ...l, seenBy: [l.a, ...(topology.nodes.find((x) => x.id === l.b)?.explored ? [l.b] : [])] })),
};
const nodeOf = (id) => topoChecks.nodes.find((n) => n.id === id);
nodeOf("core-sw01").ports = {
  "gi1/0/1": { status: "connected", speed: "a-1000", duplex: "a-full", vlan: "trunk", desc: "UPLINK dist-sw01", group: "Po1", lag: "P", native: "1" },
  "gi1/0/2": { status: "connected", speed: "a-1000", duplex: "a-full", vlan: "trunk", desc: "UPLINK dist-sw01", group: "Po1", lag: "s" },
  "te1/1/1": { status: "connected", speed: "10G", duplex: "full", vlan: "trunk", desc: "ISL core-sw02", crc: "1843" },
  "gi1/0/10": { status: "connected", speed: "a-1000", duplex: "a-full", vlan: "trunk" },
  "gi1/0/20": { status: "connected", speed: "a-100", duplex: "a-full", vlan: "30", desc: "camara acceso" },
  "gi1/0/21": { status: "connected", speed: "a-1000", duplex: "a-full", vlan: "30" },
};
nodeOf("dist-sw01").ports = {
  "gi1/0/48": { status: "connected", speed: "a-1000", duplex: "a-full", vlan: "trunk", native: "99", group: "Po1", lag: "P" },
  "gi1/0/47": { status: "connected", speed: "a-1000", duplex: "a-full", vlan: "trunk", group: "Po1", lag: "P" },
  "gi1/0/1": { status: "connected", speed: "a-100", duplex: "a-half", vlan: "trunk" },
  "gi1/0/2": { status: "connected", speed: "a-1000", duplex: "a-full", vlan: "10" },
};
nodeOf("sw-acceso-01").ports = { "gi1/0/24": { duplex: "full" } };
nodeOf("sw-acceso-02").ports = { "gi1/0/24": { vlan: "trunk" } };
nodeOf("fw-perimetro").caps = "Router";
// core-sw02 no informa a core-sw01: asimetría.
topoChecks.links.find((l) => l.b === "core-sw02").seenBy = ["core-sw01"];
topoChecks.nodes.push({ id: "sep001122334455", name: "SEP001122334455", ip: "192.0.2.150", platform: "Cisco IP Phone 8845", caps: "Host Phone", explored: false, x: 130, y: 560 });
topoChecks.links.push({ a: "sw-acceso-01", aPort: "Gi1/0/5", b: "sep001122334455", bPort: "Port 1", proto: "CDP" });
// Topología grande (medición de rendimiento): 400 equipos explorados en malla, con estado de puertos.
function topoBig(n = 400) {
  const nodes = [];
  const links = [];
  for (let i = 0; i < n; i++) {
    const ports = {};
    for (let p = 1; p <= 48; p++) ports[`gi1/0/${p}`] = { status: p % 3 ? "connected" : "notconnect", duplex: "a-full", speed: "a-1000", vlan: p < 3 ? "trunk" : "10" };
    nodes.push({ id: `sw${i}`, name: `sw${i}`, ip: `10.1.${i >> 8}.${i & 255}`, platform: "cisco C9300-48P", explored: true, x: 200 + (i % 20) * 240, y: 80 + Math.floor(i / 20) * 170, ports });
    if (i) links.push({ a: `sw${i - 1}`, aPort: "Gi1/0/1", b: `sw${i}`, bPort: "Gi1/0/2", proto: "CDP", seenBy: [`sw${i - 1}`, `sw${i}`] });
    if (i >= 20) links.push({ a: `sw${i - 20}`, aPort: "Gi1/0/47", b: `sw${i}`, bPort: "Gi1/0/48", proto: "LLDP" });
  }
  return { nodes, links };
}
// ?scene=topology-*: diagrama y fuentes de cada demo (activadas o apagadas).
const topoScene = new URLSearchParams(location.search).get("scene");
const TOPO_SCENES = {
  "topology-sources": [topoSources, { routing: true, descriptions: true }],
  "topology-sources-off": [topoSources, {}],
  "topology-ospf": [topoOspf, { routing: true }],
  "topology-manual": [topoManual, { descriptions: true }],
  "topology-mac": [topoMac, { routing: true, descriptions: true, mac: true }],
  "topology-checks": [topoChecks, {}],
  "topology-big": [topoBig(), {}],
  // Cadena de 6 equipos (?chain=1): parte sin diagrama, se descubre desde core-sw01 y se salta de a uno.
  "topology-hop-chain": [{ nodes: [], links: [] }, {}],
};
if (TOPO_SCENES[topoScene]) [settings.topology, settings.topoSources] = TOPO_SCENES[topoScene];
// Estado visual de Topología (panel y secciones) para cada captura, sin arrastrar el de la anterior:
// &topoPanel=0 oculta el panel; &topoOpen=fuentes,sugerencias,leyenda abre esas secciones.
if (/topology|compare/.test(topoScene ?? "")) {
  const q = new URLSearchParams(location.search);
  const open = (q.get("topoOpen") ?? "").split(",").filter(Boolean);
  const sec = { fuentes: false, sugerencias: false, detalle: true, ruta: true, manual: false, snapshots: false, leyenda: false };
  for (const k of open) sec[k] = true;
  try {
    localStorage.setItem("topoUi", JSON.stringify({ panel: q.get("topoPanel") !== "0", sec }));
  } catch {}
}


// Respaldos de configuración (Herramientas › Respaldos): dos versiones previas de core-sw01.
const connSessions = new Map(); // conexión -> sesión
const backupRuns = new Map(); // equipo -> respaldos hechos en esta carga
function fakeConfig(name, vendor, rev) {
  if (vendor === "huawei")
    return `#\n sysname ${name}\n#\nvlan batch 10 20${rev ? " 30" : ""}\n#\naaa\n local-user admin password irreversible-cipher $1a$demo$\n#\ninterface GigabitEthernet0/0/0\n ip address 198.51.100.1 255.255.255.0\n#\nsnmp-agent community read cipher %^%#demo%^%#\n#\nreturn`;
  const lines = [
    "!", `hostname ${name}`, "!", "enable secret 9 $9$demo$demo", "username admin privilege 15 secret 9 $9$demo", "!",
    "vlan 10", " name USUARIOS", "vlan 20", " name VOZ", ...(rev ? ["vlan 30", " name CAMARAS"] : []), "!",
  ];
  for (let i = 1; i <= 24; i++)
    lines.push(`interface GigabitEthernet1/0/${i}`, ` description ${i === 1 ? "UPLINK dist-sw01" : rev && i === 7 ? "CAMARA PISO 2" : "USUARIO"}`, ` switchport access vlan ${rev && i === 7 ? 30 : 10}`, " switchport mode access", i === 4 ? " shutdown" : " no shutdown", "!");
  lines.push("snmp-server community DEMO RO 10", "tacacs-server host 192.0.2.50 key 7 0822455D0A16", "!", "line vty 0 15", " transport input ssh", "!", "end");
  return lines.join("\n");
}
const backups = {
  "core-sw01": {
    "2026-10-14_093000.txt": fakeConfig("core-sw01", "cisco", 0).replace("enable secret 9 $9$demo$demo", "enable secret 9 ****").replace("DEMO", "****").replace("0822455D0A16", "****"),
    "2026-10-20_181500.txt": fakeConfig("core-sw01", "cisco", 1).replace("enable secret 9 $9$demo$demo", "enable secret 9 ****").replace("DEMO", "****").replace("0822455D0A16", "****"),
  },
};
const stamp = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

const monitorTimers = new Map();
function rtt(id, i) {
  const base = { m1: 2, m2: 6, m3: 28 }[id] ?? 10;
  return base + Math.abs(Math.sin(i / 7)) * base * 0.4 + Math.random() * base * 0.3;
}
function startMonitor(cfg) {
  // Solo la escena de monitoreo genera muestras (evita avisos de caída en otras capturas).
  if (monitorTimers.has(cfg.id) || !location.search.includes("scene=monitor")) return;
  // Historia previa de 5 minutos para que el gráfico se vea poblado.
  setTimeout(() => {
    for (let i = 300; i > 0; i--) {
      const down = cfg.id === "m3" && i > 120 && i < 135;
      emit("monitor-sample", { id: cfg.id, ts: Date.now() - i * 1000, ok: !down, rtt: down ? null : rtt(cfg.id, i), error: down ? "Tiempo de espera agotado" : null });
    }
  }, 300);
  let i = 0;
  monitorTimers.set(cfg.id, setInterval(() => emit("monitor-sample", { id: cfg.id, ts: Date.now(), ok: true, rtt: rtt(cfg.id, i++), error: null }), 1000));
}

// SNMP simulado (Herramientas › SNMP): un switch con ifXTable y traps de ejemplo.
settings.snmpProfiles = [
  { id: "pcore", name: "core-sw01", host: "192.0.2.1", port: 161, version: "3", user: "monitoreo", level: "authPriv", authProto: "sha256", privProto: "aes", context: "", timeoutMs: 2000, retries: 1, saved: true },
];
const running = new Set();
const writes = new Map();
const IFNAMES = ["Gi1/0/1", "Gi1/0/2", "Gi1/0/3", "Gi1/0/4", "Te1/1/1", "Te1/1/2", "Vlan10", "Vlan20"];
const IFDESC = ["UPLINK dist-sw01", "UPLINK dist-sw01", "Camara piso 2", "", "ISL core-sw02", "ISL core-sw02", "USUARIOS", "VOZ"];
const counterBase = IFNAMES.map((_, i) => 9_000_000_000 + i * 1_234_567_890);
const snmpStart = Date.now();
function snmpColumn(oid) {
  const col = (vals, type = "OCTET STRING") => vals.map((v, i) => ({ oid: `${oid}.${i + 1}`, type, value: String(v) }));
  const t = (Date.now() - snmpStart) / 1000;
  const map = {
    "1.3.6.1.2.1.31.1.1.1.1": () => col(IFNAMES),
    "1.3.6.1.2.1.31.1.1.1.18": () => col(IFDESC),
    "1.3.6.1.2.1.2.2.1.7": () => col(IFNAMES.map((_, i) => (i === 3 ? 2 : 1)), "INTEGER"),
    "1.3.6.1.2.1.2.2.1.8": () => col(IFNAMES.map((_, i) => (i === 3 || i === 2 ? 2 : 1)), "INTEGER"),
    "1.3.6.1.2.1.31.1.1.1.15": () => col(IFNAMES.map((n) => (n.startsWith("Te") ? 10000 : n.startsWith("Vlan") ? 1000 : 1000)), "Gauge32"),
    "1.3.6.1.2.1.31.1.1.1.6": () => col(counterBase.map((b, i) => Math.round(b + t * (i + 1) * 3_100_000)), "Counter64"),
    "1.3.6.1.2.1.31.1.1.1.10": () => col(counterBase.map((b, i) => Math.round(b / 2 + t * (i + 1) * 1_250_000)), "Counter64"),
    "1.3.6.1.2.1.25.3.3.1.2": () => col([12, 9], "INTEGER"),
  };
  return (map[oid] ?? (() => []))();
}
const SYS = {
  "1.3.6.1.2.1.1.1.0": "Cisco IOS XE Software, Version 17.12.4, Catalyst L3 Switch Software (CAT9K_IOSXE)",
  "1.3.6.1.2.1.1.2.0": "1.3.6.1.4.1.9.1.2494",
  "1.3.6.1.2.1.1.3.0": "412345600 (47d 17h 30m 56.00s)",
  "1.3.6.1.2.1.1.4.0": "noc@example.com",
  "1.3.6.1.2.1.1.5.0": "core-sw01",
  "1.3.6.1.2.1.1.6.0": "Sala de equipos, piso 3",
};
function emitTraps() {
  const list = [
    { trap_oid: "1.3.6.1.6.3.1.1.5.3", version: "v2c", kind: "trap", src: "192.0.2.21", vbs: [{ oid: "1.3.6.1.2.1.2.2.1.1.3", type: "INTEGER", value: "3" }, { oid: "1.3.6.1.2.1.2.2.1.2.3", type: "OCTET STRING", value: "GigabitEthernet1/0/3" }] },
    { trap_oid: "1.3.6.1.6.3.1.1.5.4", version: "v3", kind: "trap", src: "192.0.2.21", user: "traps", note: "authPriv verificado · engine 800000090300aabbccddee", vbs: [{ oid: "1.3.6.1.2.1.2.2.1.1.3", type: "INTEGER", value: "3" }, { oid: "1.3.6.1.2.1.2.2.1.2.3", type: "OCTET STRING", value: "GigabitEthernet1/0/3" }] },
    { trap_oid: "1.3.6.1.6.3.1.1.5.1", version: "v2c", kind: "inform", src: "198.51.100.1", vbs: [] },
    { trap_oid: "1.3.6.1.6.3.1.1.5.3", version: "v1", kind: "v1", src: "192.0.2.22", vbs: [{ oid: "agent-addr", type: "IpAddress", value: "192.0.2.22" }, { oid: "1.3.6.1.2.1.2.2.1.1.24", type: "INTEGER", value: "24" }] },
  ];
  emit("snmp-trap", list.map((t, i) => ({ ts: Date.now() - (list.length - i) * 4000, uptime: "412345600 (47d 17h 30m 56.00s)", user: null, note: null, ...t })));
}

let recentTargets = ["ssh admin@192.0.2.50 22", "telnet 203.0.113.9 23"];
const cmdHistory = { s0: [{ cmd: "show ip interface brief", ts: now - 60000 }, { cmd: "show version", ts: now - 3600000 }] };

const handlers = {
  "plugin:event|listen": ({ event, handler }) => {
    listeners.set(event, [...(listeners.get(event) ?? []), handler]);
    return handler;
  },
  "plugin:event|unlisten": () => null,
  // &sessions=N: inventario grande (medición de la barra lateral), en 40 carpetas por sitio.
  list_sessions: () => {
    const n = Number(new URLSearchParams(location.search).get("sessions") || 0);
    if (!n) return sessions;
    return [
      ...sessions,
      ...Array.from({ length: n }, (_, i) => ({ id: `big${i}`, name: `sw-sitio${i % 40}-${i}`, type: "ssh", host: `10.${(i >> 8) & 255}.${i & 255}.1`, port: 22, username: "netops", folder: `Sitios/Sitio ${i % 40}`, created_at: "" })),
    ];
  },
  update_sessions: ({ sessions: changed }) => {
    for (const c of changed) {
      const i = sessions.findIndex((x) => x.id === c.id);
      if (i >= 0) sessions[i] = c;
    }
    return sessions;
  },
  get_settings: () => settings,
  save_settings: () => null,
  save_topology: () => null,
  app_version: () => "0.9.19",
  update_check: () => ({ current: "0.9.19", latest: "0.9.19", newer: false, url: "", notes: "", published: "", supported: true, reason: null }),
  app_repo: () => "Parzval-Net/Net_Terminal",
  cmdpacks_list: () => [],
  list_notes: () => [
    ...Object.keys(notes).map((name) => ({ name, modified: now, protected: false })),
    ...Object.keys(secureNotes).map((name) => ({ name, modified: now - 3600000, protected: true })),
  ],
  read_note: ({ name }) => {
    if (secureNotes[name]) throw "La nota está protegida con contraseña";
    return notes[name] ?? "";
  },
  // Notas protegidas: mismas reglas que el backend (contraseña mínima, nunca se devuelve).
  note_unlock: ({ name, password }) => {
    const n = secureNotes[name];
    unlockedNote = null;
    if (!n || n.password !== password) throw "Contraseña incorrecta o archivo de la nota alterado";
    unlockedNote = name;
    return n.content;
  },
  note_protect: ({ name, password }) => {
    if ([...password].length < 8) throw "La contraseña debe tener al menos 8 caracteres";
    secureNotes[name] = { password, content: notes[name] ?? "" };
    delete notes[name];
    unlockedNote = name;
    return null;
  },
  note_save_secure: ({ name, content }) => {
    if (unlockedNote !== name) throw NOTE_LOCKED;
    secureNotes[name].content = content;
    return null;
  },
  note_touch: ({ name }) => unlockedNote === name,
  note_lock: () => ((unlockedNote = null), null),
  note_unprotect: ({ name }) => {
    if (unlockedNote !== name) throw NOTE_LOCKED;
    notes[name] = secureNotes[name].content;
    delete secureNotes[name];
    unlockedNote = null;
    return null;
  },
  note_change_password: ({ name, old, new: next }) => {
    if (secureNotes[name]?.password !== old) throw "Contraseña incorrecta o archivo de la nota alterado";
    secureNotes[name].password = next;
    return null;
  },
  // ?scripts: un script para probar el diálogo de lanzamiento.
  list_scripts: () => (location.search.includes("scripts") ? ["ejemplo_respaldo.py"] : []),
  // Búsqueda en notas: texto plano sin distinguir mayúsculas, como el backend.
  search_notes: ({ query }) => {
    const q = (query ?? "").trim().toLowerCase();
    if (q.length < 2) return [];
    // Las protegidas solo coinciden por nombre y sin contenido.
    const locked = Object.keys(secureNotes).filter((n) => n.toLowerCase().includes(q)).map((name) => ({ name, line: 0, snippet: "", protected: true }));
    return Object.entries(notes).flatMap(([name, text]) =>
      text.split("\n").flatMap((l, i) => (l.toLowerCase().includes(q) ? [{ name, line: i + 1, snippet: l.trim().slice(0, 160), protected: false }] : [])),
    ).concat(locked).slice(0, 200);
  },
  // Importación: vista previa ficticia (IPs de documentación).
  import_sessions_file: () => ({
    format: "putty",
    sessions: [
      { id: "", name: "core-sw03", type: "ssh", host: "192.0.2.3", port: 22, username: "admin", folder: "PuTTY", created_at: "" },
      { id: "", name: "consola-lab", type: "serial", serial_port: "COM3", baud_rate: 9600, folder: "PuTTY", created_at: "" },
      // Con destino "Sucursales/Norte" coincide con una sesión existente que cambia de host.
      { id: "", name: "sw-acceso-norte", type: "telnet", host: "203.0.113.99", created_at: "" },
    ],
    warnings: ["core-sw03: la llave .ppk de PuTTY no se importa (OpenSSH usa otro formato)"],
  }),
  add_sessions: ({ sessions: list }) => (sessions.push(...list.map((x, i) => ({ ...x, id: `imp${Date.now()}${i}` }))), [...sessions]),
  recent_targets: () => [...recentTargets],
  recent_target_add: ({ target }) => {
    recentTargets = [target, ...recentTargets.filter((t) => t.toLowerCase() !== target.toLowerCase())].slice(0, 20);
    return recentTargets;
  },
  recent_targets_clear: () => ((recentTargets = []), null),
  cmd_history: ({ key }) => cmdHistory[key] ?? [],
  cmd_history_add: ({ key, command }) => {
    cmdHistory[key] = [{ cmd: command, ts: Date.now() }, ...(cmdHistory[key] ?? []).filter((e) => e.cmd !== command)].slice(0, 50);
    return true;
  },
  cmd_history_clear: ({ key }) => (key ? delete cmdHistory[key] : Object.keys(cmdHistory).forEach((k) => delete cmdHistory[k]), null),
  plugins_list: () => [],
  tftp_files: () => [["c9300-universalk9.17.12.04.SPA.bin", 1_163_845_632], ["AR6100-V300R022C10SPC100.cc", 168_820_736], ["FGT_200F-v7.4.5.out", 92_340_224]],
  // Como el backend: primero la de la ruta por defecto, luego físicas y al final virtuales.
  local_ips: () => [
    { name: "en0", ip: "192.0.2.250", default: true },
    { name: "en7", ip: "198.51.100.20", default: false },
    { name: "bridge100", ip: "198.51.100.200", default: false },
    { name: "utun4", ip: "203.0.113.9", default: false },
  ],
  server_running: () => [...running],
  server_start: ({ kind, allowWrite }) => (running.add(kind), writes.set(kind, !!allowWrite), `${kind} activo`),
  server_write: ({ kind }) => (running.has(kind) ? (writes.get(kind) ?? false) : null),
  server_set_write: ({ kind, allow }) => {
    if (!running.has(kind)) throw "El servidor no está activo";
    const before = writes.get(kind) ?? false;
    writes.set(kind, allow);
    return before;
  },
  server_stop: ({ kind }) => (running.delete(kind), writes.delete(kind), null),
  snmp_request: ({ oids }) => oids.map((oid) => (SYS[oid] ? { oid, type: oid.endsWith(".2.0") ? "OID" : oid.endsWith(".3.0") ? "Timeticks" : "OCTET STRING", value: SYS[oid] } : { oid, type: "noSuchObject", value: "No existe el objeto en este agente" })),
  snmp_walk_many: ({ oids }) => oids.map((oid) => ({ oid, rows: snmpColumn(oid), truncated: false, error: null })),
  snmp_walk: ({ oid }) => {
    const job = `job-${nextId++}`;
    setTimeout(() => {
      const rows = snmpColumn(oid);
      emit("tool-job", { job, kind: "line", text: "", data: { rows } });
      emit("tool-job", { job, kind: "result", text: "", data: { count: rows.length, truncated: false, cancelled: false, ms: 84 } });
      emit("tool-job", { job, kind: "done", text: "" });
    }, 300);
    return job;
  },
  snmp_secret_set: () => null,
  snmp_secret_has: () => true,
  snmp_secret_delete: () => null,
  snmp_trap_start: ({ port, bind }) => {
    running.add("snmptrap");
    setTimeout(emitTraps, 400);
    return `Receptor de traps escuchando en ${bind}:${port} (UDP)`;
  },
  ftp_server_info: () => (running.has("ftp") ? { user: "nt", pass: "k7m2q9xh4p", port: 21, write: writes.get("ftp") ?? false } : null),
  ftp_server_start: ({ port, allowWrite }) => (running.add("ftp"), writes.set("ftp", !!allowWrite), { user: "nt", pass: "k7m2q9xh4p", port, write: allowWrite }),
  ftp_list: () => ({ cwd: "/firmware", tls: true, entries: [{ name: "cisco", size: 0, dir: true, date: "2026-10-01 09:00" }, { name: "c9300-universalk9.17.12.04.SPA.bin", size: 1_163_845_632, dir: false, date: "2026-09-12 18:20" }, { name: "AR6100-V300R022C10SPC100.cc", size: 168_820_736, dir: false, date: "2026-08-30 11:02" }] }),
  monitor_start: ({ cfg }) => startMonitor(cfg),
  monitor_stop: ({ id }) => (clearInterval(monitorTimers.get(id)), monitorTimers.delete(id), null),
  list_serial_ports: () => [{ port_name: "/dev/tty.usbserial-0001", port_type: "USB" }],
  // &iperf=0: iperf3 fuera del PATH; solo aparece al elegir un archivo llamado iperf3(.exe).
  tool_iperf_version: ({ custom } = {}) =>
    location.search.includes("iperf=0") && !/iperf3(\.exe)?$/i.test(custom ?? "")
      ? null
      : { version: "iperf 3.17.1 (cJSON 1.7.15)", path: custom || "/opt/homebrew/bin/iperf3" },
  data_dir: () => "~/NetTerminal/data",
  logs_dir_get: () => logsDirInfo(),
  logs_dir_set: ({ path }) => ((logsDir = path ?? ""), logsDirInfo()),
  // MD5 de la copia del PC; el equipo devuelve el mismo en "verify /md5" (o ?md5bad, otro).
  tftp_md5: () => "3f2a9c1e5b7d4a6f8e0c2b4d6f8a1c3e",
  device_run: ({ conn, command }) => {
    // ?scpbusy: la sesión está tomada por un script en las dos primeras verificaciones.
    if (/^verify \/md5/.test(command) && location.search.includes("scpbusy") && busyVerifies++ < 2)
      throw "Un script está usando esta sesión. Espera a que termine o usa Detener script.";
    if (/^verify \/md5/.test(command)) {
      const job = `job-${nextId++}`;
      const md5 = location.search.includes("md5bad") ? "00000000000000000000000000000000" : "3f2a9c1e5b7d4a6f8e0c2b4d6f8a1c3e";
      setTimeout(() => {
        emit("tool-job", { job, kind: "result", text: "", data: { ok: true, output: `${command}\r\n.......Done!\r\n${command.slice(7)} = ${md5}\r\ncore-sw01#` } });
        emit("tool-job", { job, kind: "done", text: "" });
      }, 400);
      return job;
    }
    const s = connSessions.get(conn);
    const job = `job-${nextId++}`;
    const name = s?.name ?? "equipo";
    const rev = (backupRuns.get(name) ?? 0) % 2;
    backupRuns.set(name, (backupRuns.get(name) ?? 0) + 1);
    const prompt = s?.highlight === "huawei" ? `<${name}>` : `${name}#`;
    const body = /running-config|current-configuration/.test(command)
      ? `${s?.highlight === "huawei" ? "" : "Building configuration...\n\nCurrent configuration : 4211 bytes\n"}${fakeConfig(name, s?.highlight, rev)}`
      : "";
    const output = `${prompt}${command}\r\n${body.replace(/\n/g, "\r\n")}\r\n${prompt}`;
    setTimeout(() => {
      emit("tool-job", { job, kind: "result", text: "", data: { ok: true, output } });
      emit("tool-job", { job, kind: "done", text: "" });
    }, 600 + Math.random() * 600);
    return job;
  },
  backup_save: ({ device, content, mask }) => {
    const dev = device.replace(/[^\w.-]/g, "_");
    const file = `${stamp()}.txt`;
    const text = mask ? content.replace(/(secret \d |community |key 7 )\S+/g, "$1****") : content;
    backups[dev] = { ...(backups[dev] ?? {}), [file]: text };
    return file;
  },
  backup_list: () =>
    Object.entries(backups).map(([device, files]) => ({
      device,
      files: Object.keys(files).sort().reverse().map((name) => ({ name, size: files[name].length, modified: now / 1000 })),
    })),
  backup_read: ({ device, file }) => backups[device]?.[file] ?? "",
  // Huellas de secretos: entre las dos fechas de core-sw01 cambió la community SNMP (línea con "community").
  backup_secrets: ({ device, file }) => {
    const text = backups[device]?.[file] ?? "";
    const out = {};
    text.split("\n").forEach((l, i) => {
      if (/\*\*\*\*/.test(l)) out[i] = [/community/.test(l) && file.startsWith("2026-10-20") ? "b2" : "a1"];
    });
    return out;
  },
  save_note: ({ name, content }) => {
    if (secureNotes[name]) throw "La nota está protegida con contraseña";
    notes[name] = content;
    return null;
  },
  // Bóveda de contraseñas simulada: como el backend real, nunca devuelve una contraseña.
  // ?vault=portable simula el modo con contraseña maestra.
  cred_status: () => ({ ...vault, unlocked: vault.exists && vault.unlocked }),
  cred_set: ({ sessionId }) => ((vault.exists = true), vaultIds.add(sessionId), null),
  cred_has: ({ sessionId }) => vaultIds.has(sessionId),
  cred_delete: ({ sessionId }) => (vaultIds.delete(sessionId), null),
  vault_create: () => ((vault.exists = vault.unlocked = true), null),
  vault_unlock: ({ master }) => {
    if (master.length < 8) throw "Contraseña maestra incorrecta o archivo de credenciales alterado";
    vault.unlocked = true;
    return null;
  },
  vault_lock: () => ((vault.unlocked = false), null),
  vault_change: () => null,
  vault_reset: () => ((vault.exists = vault.unlocked = false), vaultIds.clear(), null),
  set_logging: ({ enabled }) => (enabled ? "~/NetTerminal/data/logs/core-sw01_20261021-101500.log" : null),
  // ?alert: simula un aviso de la primera alerta activa sobre la última sesión abierta.
  alerts_configure: ({ rules }) => {
    if (location.search.includes("alert") && rules.length)
      setTimeout(() => {
        const conn = [...channels.keys()].pop();
        if (conn) emit("alert-hit", { conn, rule: rules[0].id, line: "%LINK-3-UPDOWN: Interface GigabitEthernet1/0/3, changed state to down" });
      }, 1500);
    return null;
  },
  // Como el backend real: datos en binario y el cierre como texto por el mismo canal.
  connect: ({ id, session: sess, onData }) => {
    // Pestaña de salto de Topología ("vecino vía pivote"): el equipo al conectar es el pivote.
    // El nombre de la sesión de esa pestaña es la ruta completa "pivote › h1 › … › N": al conectar se llega al pivote.
    const session = / › /.test(sess.name ?? "") ? { ...sess, name: sess.name.split(" › ")[0] } : / vía /.test(sess.name ?? "") ? { ...sess, name: sess.name.replace(/^.* vía /, "") } : sess;
    connSessions.set(id, session);
    const text = terminalFor(session).replace(/\r?\n/g, "\r\n");
    const ch = { data: onData.id, index: 0 };
    channels.set(id, ch);
    const send = (t) => cbs.get(ch.data)?.({ index: ch.index++, message: enc.encode(t).buffer });
    // Equipo antiguo: sin "algoritmos legacy" OpenSSH rechaza la negociación.
    if (session.name === "router-antiguo" && !session.legacy_ssh) {
      setTimeout(() => {
        send("Unable to negotiate with 192.0.2.99 port 22: no matching host key type found. Their offer: ssh-rsa\r\n");
        cbs.get(ch.data)?.({ index: ch.index++, message: "El proceso terminó (código 255)" });
      }, 300);
      return null;
    }
    // Pestaña SCP/SFTP del gestor de archivos: copia simulada y fin del proceso como el backend
    // (spawn_pty). ?scpfail: termina con código 1. SFTP interactivo (shell) no termina solo.
    if (session.scp && session.scp.mode !== "shell") {
      const files = session.scp.files.join(" ");
      setTimeout(() => send(`noc@${session.host}'s password: \r\n${files}    100%  160MB  11.2MB/s   00:14\r\n`), 300);
      const fail = location.search.includes("scpfail");
      setTimeout(() => cbs.get(ch.data)?.({ index: ch.index++, message: fail ? "Proceso terminado (código 1)" : "Sesión finalizada" }), 1500);
      return null;
    }
    setTimeout(() => send(text), 150);
    // ?big=N: salida pesada (N líneas) para medir memoria y fugas.
    const big = Number(new URLSearchParams(location.search).get("big") ?? 0);
    for (let i = 0; i < big; i += 5000) {
      const lines = Array.from({ length: Math.min(5000, big - i) }, (_, k) => `linea ${i + k} GigabitEthernet1/0/${k % 48} up up 192.0.2.${k % 254}`);
      setTimeout(() => send(lines.join("\r\n") + "\r\n"), 300 + i / 50);
    }
    return null;
  },
  write: ({ id, data }) => {
    const ch = channels.get(id);
    if (!ch) return null;
    const send = (t) => cbs.get(ch.data)?.({ index: ch.index++, message: enc.encode(t).buffer });
    if (data === "\x03") {
      send("^C\r\ncore-sw01# ");
    } else if (data === "\x1a") {
      send("^Z\r\ncore-sw01# ");
    } else if (data === "\r" || data === "\n" || data === "\r\n") {
      send("\r\ncore-sw01# ");
    } else if (data === "?") {
      send("?\r\nExec commands:\r\n  show     Show running system information\r\n  ping     Send echo messages\r\n  traceroute Trace route to destination\r\ncore-sw01# ");
    } else {
      send(data);
    }
    return null;
  },
  resize: () => null,
  python_status: () => "Python 3.12.2",
  python_redetect: () => "Python 3.12.2",
  monitor_running: () => [],
  // Como el backend real: al cerrar se suelta el canal y el frontend recibe "end".
  disconnect: ({ id }) => {
    const ch = channels.get(id);
    if (ch) {
      if (!location.search.includes("noend")) {
        cbs.get(ch.data)?.({ end: true, index: ch.index });
      }
      channels.delete(id);
    }
    return null;
  },
};

// ?scene=topology-snmp / topology-traffic: agentes SNMP simulados para Topología (descubrimiento
// por perfil y contadores de tráfico que cambian con el tiempo). Datos ficticios (RFC 5737).
const TOPO_SNMP_SCENE = topoScene === "topology-snmp" || topoScene === "topology-traffic";
const enc8 = new TextEncoder();
const hexStr = (s) => [...enc8.encode(s)].map((b) => b.toString(16).padStart(2, "0").toUpperCase()).join("");
const vStr = (oid, v) => ({ oid, type: "OCTET STRING", value: v, hex: hexStr(v) });
const vHex = (oid, h) => ({ oid, type: "Hex-STRING", value: h.match(/../g).join(":").toUpperCase(), hex: h.toUpperCase() });
const vInt = (oid, v) => ({ oid, type: "INTEGER", value: String(v) });
const vIp = (oid, v) => ({ oid, type: "IpAddress", value: v });
const vGauge = (oid, v) => ({ oid, type: "Gauge32", value: String(v) });
const IFN = "1.3.6.1.2.1.31.1.1.1";
const LLDPM = "1.0.8802.1.1.2.1";
const CDPM = "1.3.6.1.4.1.9.9.23.1.2.1.1";
/** Interfaces por equipo: [ifIndex, ifName, Mb/s, entrada b/s, salida b/s]. */
const SNMP_IFS = {
  "192.0.2.1": [
    [10101, "Te1/1/1", 10000, 1.1e9, 2.4e9],
    [10102, "Te1/1/2", 10000, 0.2e9, 0.3e9],
    [10001, "Gi1/0/1", 1000, 0.12e9, 0.96e9],
    [10002, "Gi1/0/2", 1000, 0.2e9, 0.55e9],
    [10010, "Gi1/0/10", 1000, 35e6, 120e6],
    [10030, "Gi1/0/30", 1000, 2e6, 1e6],
    [10046, "Gi1/0/46", 1000, 8e6, 4e6],
  ],
  "192.0.2.2": [
    [10101, "Te1/1/1", 10000, 2.4e9, 1.1e9],
    [10011, "Gi1/0/11", 1000, 120e6, 780e6],
  ],
  "192.0.2.11": [
    [10048, "Gi1/0/48", 1000, 0.96e9, 0.12e9],
    [10047, "Gi1/0/47", 1000, 0.55e9, 0.2e9],
    [10001, "Gi1/0/1", 1000, 12e6, 45e6],
    [10002, "Gi1/0/2", 1000, 140e6, 610e6],
  ],
};
const SNMP_NAMES = { "192.0.2.1": "core-sw01", "192.0.2.2": "core-sw02", "192.0.2.11": "dist-sw01" };
const trafficStart = Date.now() / 1000;
/** Octetos acumulados con una tasa que varía suave (siempre crecientes). */
function octetsAt(bps, phase) {
  const t = Date.now() / 1000 - trafficStart;
  const k = 0.03;
  const integral = t - k * 20 * Math.cos(t / 20 + phase) + k * 20 * Math.cos(phase);
  return String(Math.round(5e9 + (bps / 8) * integral));
}
/** Tablas de core-sw01 para el descubrimiento (LLDP, CDP, OSPF, BGP, FDB, ARP e IF-MIB). */
function coreSnmpRows() {
  const rows = [];
  for (const [i, n, sp] of SNMP_IFS["192.0.2.1"]) {
    rows.push(vStr(`${IFN}.1.${i}`, n), vStr(`1.3.6.1.2.1.2.2.1.2.${i}`, n.replace(/^Te/, "TenGigabitEthernet").replace(/^Gi/, "GigabitEthernet")));
    rows.push(vInt(`1.3.6.1.2.1.2.2.1.8.${i}`, 1), vGauge(`${IFN}.15.${i}`, sp));
  }
  rows.push(vStr(`${IFN}.18.10101`, "ISL core-sw02"), vStr(`${IFN}.18.10001`, "UPLINK dist-sw01"), vStr(`${IFN}.18.10002`, "UPLINK dist-sw01"), vStr(`${IFN}.18.10102`, "WAN rt-borde01"));
  // dot1dBasePort -> ifIndex y lldpLocPortTable (subtipo 5: nombre de interfaz).
  for (const [bp, i, n] of [[1, 10001, "Gi1/0/1"], [2, 10002, "Gi1/0/2"], [10, 10010, "Gi1/0/10"], [30, 10030, "Gi1/0/30"], [46, 10046, "Gi1/0/46"], [101, 10101, "Te1/1/1"]]) {
    rows.push(vInt(`1.3.6.1.2.1.17.1.4.1.2.${bp}`, i), vInt(`${LLDPM}.3.7.1.2.${bp}`, 5), vStr(`${LLDPM}.3.7.1.3.${bp}`, n));
  }
  // LLDP: el firewall en Gi1/0/10.
  rows.push(
    vInt(`${LLDPM}.4.1.1.4.500.10.1`, 4), vHex(`${LLDPM}.4.1.1.5.500.10.1`, "00090f000001"),
    vInt(`${LLDPM}.4.1.1.6.500.10.1`, 5), vStr(`${LLDPM}.4.1.1.7.500.10.1`, "port1"),
    vStr(`${LLDPM}.4.1.1.9.500.10.1`, "fw-perimetro"), vStr(`${LLDPM}.4.1.1.10.500.10.1`, "FortiGate-200F v7.4.5"),
    vInt(`${LLDPM}.4.2.1.3.500.10.1.1.4.198.51.100.10`, 2),
  );
  // CDP: core-sw02 por Te1/1/1 y dist-sw01 por Gi1/0/1 y Gi1/0/2.
  for (const [i, d, id, port, plat, ipHex] of [
    [10101, 1, "core-sw02", "TenGigabitEthernet1/1/1", "cisco C9500-24Y4C", "c0000202"],
    [10001, 2, "dist-sw01", "GigabitEthernet1/0/48", "cisco C9300-48P", "c000020b"],
    [10002, 3, "dist-sw01", "GigabitEthernet1/0/47", "cisco C9300-48P", "c000020b"],
  ])
    rows.push(vInt(`${CDPM}.3.${i}.${d}`, 1), vHex(`${CDPM}.4.${i}.${d}`, ipHex), vStr(`${CDPM}.6.${i}.${d}`, id), vStr(`${CDPM}.7.${i}.${d}`, port), vStr(`${CDPM}.8.${i}.${d}`, plat));
  // OSPF y eBGP con rt-borde01 por Te1/1/2 (198.51.100.4/30).
  rows.push(
    vIp("1.3.6.1.2.1.14.10.1.3.198.51.100.6.0", "192.0.2.40"), vInt("1.3.6.1.2.1.14.10.1.6.198.51.100.6.0", 8),
    vInt("1.3.6.1.2.1.15.3.1.2.198.51.100.6", 6), vInt("1.3.6.1.2.1.15.3.1.9.198.51.100.6", 65010),
    vInt("1.3.6.1.2.1.4.20.1.2.198.51.100.5", 10102), vIp("1.3.6.1.2.1.4.20.1.3.198.51.100.5", "255.255.255.252"),
    vInt("1.3.6.1.2.1.4.20.1.2.192.0.2.1", 10), vIp("1.3.6.1.2.1.4.20.1.3.192.0.2.1", "255.255.255.0"),
  );
  // Tabla MAC (Q-BRIDGE, FID 10) y ARP: gateway HSRP y un equipo Huawei sin LLDP.
  rows.push(
    vInt("1.3.6.1.2.1.17.7.1.2.2.1.2.10.0.0.12.7.172.10", 46), vInt("1.3.6.1.2.1.17.7.1.2.2.1.3.10.0.0.12.7.172.10", 3),
    vInt("1.3.6.1.2.1.17.7.1.2.2.1.2.10.0.224.252.18.52.86", 30), vInt("1.3.6.1.2.1.17.7.1.2.2.1.3.10.0.224.252.18.52.86", 3),
    vHex("1.3.6.1.2.1.4.35.1.4.10.1.4.192.0.2.254", "00000c07ac0a"), vInt("1.3.6.1.2.1.4.35.1.6.10.1.4.192.0.2.254", 3),
    vHex("1.3.6.1.2.1.4.35.1.4.10.1.4.192.0.2.30", "00e0fc123456"), vInt("1.3.6.1.2.1.4.35.1.6.10.1.4.192.0.2.30", 3),
  );
  return rows;
}
function snmpTopoRead({ target, gets = [], walks = [] }) {
  const host = target?.host;
  const ifs = SNMP_IFS[host];
  if (!ifs) throw `Sin respuesta de ${host}:161 (timeout 2000 ms, 1 reintentos). Revisa IP, puerto, usuario, ACL del agente y que UDP 161 esté permitido.`;
  const all = host === "192.0.2.1" ? coreSnmpRows() : ifs.map(([i, n]) => vStr(`${IFN}.1.${i}`, n));
  const byIdx = new Map(ifs.map(([i, , sp, inB, outB], k) => [String(i), { sp, inB, outB, k }]));
  const getRows = gets.map((oid) => {
    if (oid === "1.3.6.1.2.1.1.5.0") return vStr(oid, SNMP_NAMES[host]);
    if (oid === "1.3.6.1.2.1.15.2.0") return vInt(oid, 65000);
    if (oid === "1.3.6.1.2.1.14.1.1.0" || oid === "1.3.6.1.2.1.15.4.0") return vIp(oid, "192.0.2.1");
    const m = oid.match(/^(.*)\.(\d+)$/);
    const d = m && byIdx.get(m[2]);
    if (d && m[1] === `${IFN}.6`) return { oid, type: "Counter64", value: octetsAt(d.inB, d.k) };
    if (d && m[1] === `${IFN}.10`) return { oid, type: "Counter64", value: octetsAt(d.outB, d.k + 1) };
    if (d && m[1] === `${IFN}.15`) return vGauge(oid, d.sp);
    return { oid, type: "noSuchInstance", value: "No existe la instancia" };
  });
  const walkRows = walks.map((root) => ({ oid: root, rows: all.filter((r) => r.oid.startsWith(`${root}.`)), truncated: false, timedOut: false, error: null }));
  return new Promise((r) => setTimeout(() => r({ gets: getRows, getError: null, walks: walkRows, ms: 640 + walks.length * 35 }), 250));
}
handlers.snmp_topo_read = snmpTopoRead;
if (TOPO_SNMP_SCENE) {
  settings.snmpProfiles = [
    ...settings.snmpProfiles,
    { id: "pcore2", name: "core-sw02", host: "192.0.2.2", port: 161, version: "3", user: "monitoreo", level: "authPriv", authProto: "sha256", privProto: "aes", context: "", timeoutMs: 2000, retries: 1, saved: true },
    { id: "pdist", name: "dist-sw01", host: "192.0.2.11", port: 161, version: "2c", user: "", level: "authPriv", authProto: "sha256", privProto: "aes", context: "", timeoutMs: 2000, retries: 1, saved: true },
  ];
  if (topoScene === "topology-snmp") {
    settings.topology = { nodes: [], links: [] };
    settings.topoSources = { routing: true, mac: true };
  } else {
    // Más separación que el diagrama base: cada enlace lleva su tasa.
    // Estado de puertos de ejemplo: un Po1 al 96 % bajando (asimétrico), un enlace al 78 %, uno caído
    // (err-disabled), uno con 12 errores CRC y otro con dúplex distinto (full contra half).
    const trafficPorts = {
      "core-sw01": {
        "gi1/0/1": { status: "connected", speed: "a-1000", duplex: "a-full", vlan: "trunk", group: "Po1", lag: "P" },
        "gi1/0/2": { status: "connected", speed: "a-1000", duplex: "a-full", vlan: "trunk", group: "Po1", lag: "P" },
        "te1/1/1": { status: "connected", speed: "10G", duplex: "full", vlan: "trunk", desc: "ISL core-sw02" },
        "gi1/0/10": { status: "connected", speed: "a-1000", duplex: "a-full", vlan: "trunk", crc: "12" },
      },
      "core-sw02": { "gi1/0/11": { status: "connected", speed: "a-1000", duplex: "a-full" } },
      "dist-sw01": {
        "gi1/0/48": { status: "connected", speed: "a-1000", duplex: "a-full", vlan: "trunk", group: "Po1", lag: "P" },
        "gi1/0/47": { status: "connected", speed: "a-1000", duplex: "a-full", vlan: "trunk", group: "Po1", lag: "P" },
        "gi1/0/1": { status: "err-disabled", speed: "auto", vlan: "trunk" },
        "gi1/0/2": { status: "connected", speed: "a-1000", duplex: "a-full", vlan: "trunk" },
      },
      "sw-acceso-02": { "gi1/0/24": { duplex: "half" } },
    };
    settings.topology = {
      nodes: topology.nodes.map((n) => ({ ...n, ports: trafficPorts[n.id], x: 480 + (n.x - 480) * 1.35, y: n.y * 1.2 })),
      links: topology.links.map((l) => ({ ...l, ...(topology.nodes.find((x) => x.id === l.b)?.explored ? { seenBy: [l.a, l.b] } : { seenBy: [l.a] }) })),
    };
    settings.topoSources = {};
  }
  const q = new URLSearchParams(location.search);
  const ui = JSON.parse(localStorage.getItem("topoUi") ?? "{}");
  Object.assign(ui, { ver: 4, mode: topoScene === "topology-snmp" ? "snmp" : "cli", snmpProfile: "pcore", interval: 15, anim: q.get("anim") !== "0", detail: q.get("detail") === "1" });
  localStorage.setItem("topoUi", JSON.stringify(ui));
}

// ?topoUi={"traffic":true,"cli":true,"interval":15}: preferencias de Topología al abrir (recuerda el tráfico).
{
  const tu = new URLSearchParams(location.search).get("topoUi");
  if (tu) localStorage.setItem("topoUi", JSON.stringify({ ver: 4, panel: true, ...JSON.parse(localStorage.getItem("topoUi") ?? "{}"), ...JSON.parse(tu) }));
}

// ---- Modo video (?video=1, scripts/video): la terminal responde a lo que se escribe o envía,
// las sesiones nuevas se guardan y ?update=1 simula una versión nueva. Las capturas no lo usan.
if (new URLSearchParams(location.search).has("video")) {
  notes["plantilla-vlan.txt"] = notes["plantilla-vlan.txt"].replace("(variables con {{...}})", "(variables entre llaves dobles)");
  notes["cambio-descripcion.txt"] = "show clock\nconfigure terminal\ninterface GigabitEthernet1/0/7\n description CAMARA PISO 2\nend";
  const out = (id, t) => {
    const ch = channels.get(id);
    if (ch) cbs.get(ch.data)?.({ index: ch.index++, message: enc.encode(t).buffer });
  };
  const lineBuf = new Map();
  const modes = new Map();
  // ---- Salto desde el pivote (Topología › "Saltar desde"): ssh -l / ssh u@ip / telnet / stelnet.
  // 192.0.2.11 pide la llave (solo la primera vez por ssh), usuario (telnet y Huawei) y contraseña;
  // la contraseña "bad" falla; 192.0.2.99 rechaza la conexión y 192.0.2.98 y 192.0.2.22 no responden (?hoptimeout=ms); el resto, rechazo.
  const HOP_HOSTS = { "192.0.2.11": "dist-sw01", "192.0.2.2": "core-sw02", "192.0.2.21": "sw-acceso-01" };
  // ?chain=1: cadena core-sw01 › dist-sw01 › agg-sw01 › acc-sw01 › acc-sw02 › acc-sw03 donde cada equipo solo se
  // alcanza desde el anterior (el resto rechaza la conexión). El prompt va en minúsculas; el CDP de cada uno lista a su
  // vecino anterior y al siguiente con dominio y mayúsculas distintas (Device ID "ACC-SW02.lab.ejemplo").
  const CHAIN = [
    { name: "core-sw01", ip: "192.0.2.1", cdp: "CORE-SW01.lab.ejemplo" },
    { name: "dist-sw01", ip: "192.0.2.11", cdp: "Dist-SW01.lab.ejemplo" },
    { name: "agg-sw01", ip: "192.0.2.12", cdp: "AGG-SW01.lab.ejemplo" },
    { name: "acc-sw01", ip: "192.0.2.13", cdp: "ACC-SW01.lab.ejemplo" },
    { name: "acc-sw02", ip: "192.0.2.14", cdp: "Acc-Sw02.lab.ejemplo" },
    { name: "acc-sw03", ip: "192.0.2.15", cdp: "ACC-SW03.lab.ejemplo" },
  ];
  const chainOn = new URLSearchParams(location.search).has("chain");
  if (chainOn) for (const c of CHAIN.slice(1)) HOP_HOSTS[c.ip] = c.name;
  const chainAt = (id) => CHAIN.findIndex((c) => c.name === (hopOf(id).stack.at(-1) ?? devName(connSessions.get(id) ?? {})));
  const chainCdp = (id) => {
    const i = chainAt(id);
    const blk = (c, local, remote) =>
      `-------------------------\nDevice ID: ${c.cdp}\nEntry address(es): \n  IP address: ${c.ip}\nPlatform: cisco C9300-48P,  Capabilities: Router Switch IGMP\nInterface: ${local},  Port ID (outgoing port): ${remote}\nHoldtime : 150 sec\n`;
    return [CHAIN[i - 1] && blk(CHAIN[i - 1], "GigabitEthernet1/0/1", "GigabitEthernet1/0/48"), CHAIN[i + 1] && blk(CHAIN[i + 1], "GigabitEthernet1/0/48", "GigabitEthernet1/0/1")]
      .filter(Boolean)
      .join("");
  };
  const hopSt = new Map();
  const knownKeys = new Set();
  const hopOf = (id) => hopSt.get(id) ?? (hopSt.set(id, { stack: [], mode: null, target: null }), hopSt.get(id));
  // El prompt es el del equipo (por su IP), no el nombre de la pestaña: las pestañas de salto se llaman "N vía M".
  const devName = (s) => sessions.find((x) => x.host === s.host && x.type !== "local")?.name ?? ({ "192.0.2.11": "dist-sw01" }[s.host] ?? s.name);
  const hopPrompt = (id) => {
    const s = connSessions.get(id) ?? {};
    const st = hopOf(id);
    const name = st.stack.length ? st.stack[st.stack.length - 1] : devName(s);
    return s.highlight === "huawei" ? `<${name}>` : `${name}#`;
  };
  const hopReply = (id, raw) => {
    const s = connSessions.get(id) ?? {};
    if (s.type === "local") return null;
    const st = hopOf(id);
    const c = raw.trim();
    const hw = s.highlight === "huawei";
    if (st.mode === "hostkey") {
      if (c === "yes" || c === "y") return ((st.mode = hw ? "username" : "password"), hw ? "Please input the username:" : "Warning: Permanently added to the list of known hosts.\r\nPassword: ");
      return ((st.mode = null), "Host key verification failed.\r\n");
    }
    if (st.mode === "username") return ((st.mode = "password"), hw ? "Enter password:" : "Password: ");
    if (st.mode === "password") {
      st.mode = null;
      if (c === "bad") {
        // ?retry=1: como un SSH real, vuelve a pedir la contraseña hasta 3 veces.
        if (q0.has("retry") && (st.tries = (st.tries ?? 0) + 1) < 3) return ((st.mode = "password"), "% Authentication failed\r\nPassword: ");
        st.tries = 0;
        return "% Authentication failed\r\n";
      }
      st.tries = 0;
      st.stack.push(st.target);
      return `\r\nUnauthorized access prohibited.\r\n`;
    }
    const m = c.match(/^(?:ssh -l \S+ |ssh \S+@|execute ssh \S+@|stelnet |telnet |execute telnet )(\d+\.\d+\.\d+\.\d+)$/);
    if (m) {
      const ip = m[1];
      const telnet = /telnet/.test(c);
      if (ip === "192.0.2.98" || ip === "192.0.2.22") {
        st.mode = "wait";
        setTimeout(() => {
          st.mode = null;
          out(id, `\r\n% Connection timed out; remote host not responding\r\n${hopPrompt(id)}`);
        }, Number(q0.get("hoptimeout") ?? 4000));
        return `Trying ${ip} ...`;
      }
      if (!HOP_HOSTS[ip] || (chainOn && CHAIN[chainAt(id) + 1]?.ip !== ip)) return "% Connection refused by remote host\r\n";
      st.target = HOP_HOSTS[ip];
      if (telnet) return ((st.mode = "username"), `Trying ${ip} ... Open\r\n\r\nUsername: `);
      if (!knownKeys.has(`${id}|${ip}`) && !hw) {
        knownKeys.add(`${id}|${ip}`);
        st.mode = "hostkey";
        return `The authenticity of host '${ip} (${ip})' can't be established.\r\nRSA key fingerprint is SHA256:3f9aJq0cXk2mZr7LsT1wQe8vNd5yBhU6oPiAxCzE4uM.\r\nAre you sure you want to continue connecting (yes/no)? `;
      }
      return ((st.mode = hw ? "username" : "password"), hw ? "Please input the username:" : "Password: ");
    }
    if (c === "exit" && st.stack.length) {
      st.stack.pop();
      return `[Connection to closed by foreign host]\r\n`;
    }
    return null;
  };
  const q0 = new URLSearchParams(location.search);
  const promptOf = (id) => {
    const s = connSessions.get(id) ?? {};
    const hm = hopOf(id).mode;
    if (hm) return "";
    if (s.type !== "local" && hopOf(id).stack.length) return hopPrompt(id);
    if (s.type === "local") return "\x1b[32muser@laptop\x1b[0m:\x1b[34m~\x1b[0m$ ";
    if (s.highlight === "huawei") return `<${devName(s)}>`;
    const m = modes.get(id);
    return `${devName(s)}${m ? `(${m})` : ""}#`;
  };
  const IPBRIEF = CISCO.split("\n").slice(4, 14).join("\n");
  const reply = (id, raw) => {
    const s = connSessions.get(id) ?? {};
    const h = hopReply(id, raw);
    if (h !== null) return `\r\n${h}`;
    return `\r\n${respond(id, s, raw)}`;
  };
  // Respuesta de ejemplo a un comando (texto con \r\n al final o vacío).
  const respond = (id, s, raw) => {
    const [cmd, filter] = raw.trim().split(/\s*\|\s*(?:include|i)\s+/);
    const c = cmd.toLowerCase();
    let body = "";
    if (s.type === "local") {
      if (/^(ifconfig|ip a)/.test(c)) body = "en0: flags=8863<UP,BROADCAST,RUNNING,MULTICAST> mtu 1500\n\tinet 192.0.2.250 netmask 0xffffff00 broadcast 192.0.2.255";
      else if (/^(ping|traceroute)/.test(c)) body = "PING 192.0.2.1: 56 data bytes\n64 bytes from 192.0.2.1: icmp_seq=0 ttl=255 time=1.92 ms";
    } else if (s.highlight === "huawei") {
      if (/^dis(play)? ver/.test(c)) body = "Huawei Versatile Routing Platform Software\nVRP (R) software, Version 8.220 (AR6100 V300R022C10SPC100)";
      else if (/^dis(play)? clock/.test(c)) body = "2026-10-21 10:42:17\nWednesday";
      else if (/^dis(play)? int(erface)? br/.test(c)) body = HUAWEI.split("\n").slice(3, 15).join("\n");
    } else if (/^sh(ow)? clock/.test(c)) body = "*10:42:17.385 UTC Wed Oct 21 2026";
    else if (/^sh(ow)? ver/.test(c)) {
      // Un router antiguo (ISR 4331, con fin de vida) y switches Catalyst 9500 (sin anuncio EoL).
      const pid = /router|^rt-|^mx-borde/.test(s.name ?? "") ? "ISR4331/K9" : "C9500-24Y4C";
      body = `Cisco IOS XE Software, Version 17.12.04\nCisco IOS Software [Dublin], Catalyst L3 Switch Software (CAT9K_IOSXE)\n${s.name} uptime is 47 weeks, 17 hours, 30 minutes\ncisco ${pid} (1RU) processor with 1795999K/6147K bytes of memory.\nModel Number                       : ${pid}`;
    }
    else if (/^sh(ow)? int(erfaces?)?$/.test(c) && s.highlight !== "huawei") {
      // Contadores de las interfaces del equipo (los mismos que el agente SNMP simulado), como
      // "show interfaces" de IOS-XE: crecen con el tiempo, con la velocidad física y el BW.
      const ifs = SNMP_IFS[Object.keys(SNMP_NAMES).find((ip) => SNMP_NAMES[ip] === (hopOf(id).stack.at(-1) ?? s.name))] ?? [];
      body = ifs
        .map(([i, n, sp, inB, outB], k) => {
          const full = n.replace(/^Te/, "TenGigabitEthernet").replace(/^Gi/, "GigabitEthernet");
          const pk = (o) => Math.round(Number(o) / 700);
          const io = octetsAt(inB, k), oo = octetsAt(outB, k + 1);
          return `${full} is up, line protocol is up (connected)\n  Hardware is Ten Gigabit Ethernet, address is 0011.2233.${i}\n  MTU 1500 bytes, BW ${sp * 1000} Kbit/sec, DLY 10 usec,\n  Full-duplex, ${sp}Mb/s, media type is SFP-10GBase-LR\n  5 minute input rate 0 bits/sec, 0 packets/sec\n     ${pk(io)} packets input, ${io} bytes, 0 no buffer\n     ${pk(oo)} packets output, ${oo} bytes, 0 underruns`;
        })
        .join("\n");
    }
    else if (/^sh(ow)? ip int(erface)? br/.test(c)) body = IPBRIEF;
    else if (chainOn && /^sh(ow)? cdp nei\w* detail/.test(c)) body = chainCdp(id);
    else if (chainOn && /^sh(ow)? lldp nei/.test(c)) body = "% LLDP is not enabled";
    else if (/^sh(ow)? (cdp|lldp) nei/.test(c)) body = "Device ID        Local Intrfce     Holdtme    Capability  Platform  Port ID\ncore-sw02        Ten 1/1/1         142             R S I  C9500-24Y Ten 1/1/1\ndist-sw01        Gig 1/0/1         131             R S I  C9300-48P Gig 1/0/48";
    else if (/^sh(ow)? int(erfaces?)? status/.test(c)) body = "Port      Name               Status       Vlan       Duplex  Speed Type\nGi1/0/1   UPLINK dist-sw01   connected    trunk      a-full a-1000 10/100/1000BaseTX\nGi1/0/3                      notconnect   10           auto   auto 10/100/1000BaseTX\nGi1/0/7   CAMARA PISO 2      connected    30         a-full a-1000 10/100/1000BaseTX";
    else if (/^conf(igure)? t/.test(c)) (body = "Enter configuration commands, one per line.  End with CNTL/Z."), modes.set(id, "config");
    else if (/^int(erface)? /.test(c) && modes.get(id)) modes.set(id, "config-if");
    else if (/^vlan \d/.test(c) && modes.get(id)) modes.set(id, "config-vlan");
    else if (c === "end") modes.delete(id);
    else if (c === "exit") modes.get(id) === "config" ? modes.delete(id) : modes.get(id) && modes.set(id, "config");
    else if (/^(write|wr)( mem)?/.test(c)) body = "Building configuration...\n[OK]";
    if (filter) body = body.split("\n").filter((l) => l.includes(filter)).join("\n");
    body = body.replace(/\n/g, "\r\n");
    return body ? body + "\r\n" : "";
  };
  // Detectar plataforma y otras consultas por la vía de herramientas (device_run).
  const deviceRun = handlers.device_run;
  const fortiCtx = new Map();
  handlers.device_run = (args) => {
    if (/running-config|current-configuration/.test(args.command)) return deviceRun(args);
    const s = connSessions.get(args.conn) ?? {};
    const job = `job-${nextId++}`;
    // FortiOS: el prompt muestra el contexto ("fw01 (port1) # ") y "edit" de una entrada nueva avisa.
    if (s.highlight === "fortinet") {
      const stack = fortiCtx.get(args.conn) ?? [];
      const ctxPrompt = () => `${s.name}${stack.length ? ` (${stack[stack.length - 1]})` : ""} # `;
      const before = ctxPrompt();
      const c = args.command.trim();
      let body = "";
      const m = c.match(/^(config|edit)\s+"?([^"]+?)"?$/);
      if (m) {
        if (m[1] === "edit" && !/^\d+$/.test(m[2])) body = `new entry '${m[2]}' added\r\n\r\n`;
        stack.push(m[1] === "config" ? m[2].split(/\s+/).pop() : m[2]);
      } else if (c === "next" || c === "end") stack.pop();
      else if (!/^(set|unset|get|show|diagnose|execute)\b/.test(c)) body = "command parse error before '" + c.split(/\s+/)[0] + "'\r\nCommand fail. Return code -61\r\n";
      fortiCtx.set(args.conn, stack);
      const output = `${before}${args.command}\r\n${body}${ctxPrompt()}`;
      setTimeout(() => {
        emit("tool-job", { job, kind: "result", text: "", data: { ok: !/Command fail/.test(body), output } });
        emit("tool-job", { job, kind: "done", text: "" });
      }, 250);
      return job;
    }
    const prompt = hopOf(args.conn).stack.length ? hopPrompt(args.conn) : s.highlight === "huawei" ? `<${s.name}>` : `${s.name}#`;
    // CLI Lab: comandos inexistentes dan error de CLI; "reload" pregunta y, sin answer, se rechaza.
    // Un Huawei no entiende la sintaxis de Cisco: el CLI Lab marca error y detiene ese equipo.
    const huaweiBad = s.highlight === "huawei" && /^(conf(igure)? t|interface |description |show )/i.test(args.command.trim());
    const bad = huaweiBad || /^(sh(ow)? bogus|foo)/i.test(args.command.trim());
    const ask = /^reload/i.test(args.command.trim());
    const declined = ask && args.answer === false ? "Proceed with reload? [confirm]" : null;
    // Medición del CLI Lab: "show tech" responde unas 3.000 líneas, como un equipo real.
    if (/^show tech/i.test(args.command.trim())) {
      const big = Array.from({ length: 3000 }, (_, i) =>
        i % 3 === 0 ? `interface GigabitEthernet1/0/${i % 48} description UPLINK ${i}` : i % 3 === 1 ? ` ip address 10.${i % 255}.1.1 255.255.255.0` : " no shutdown",
      ).join("\r\n");
      const output = `${prompt}${args.command}\r\n${big}\r\n${prompt}`;
      setTimeout(() => {
        emit("tool-job", { job, kind: "result", text: "", data: { ok: true, output } });
        emit("tool-job", { job, kind: "done", text: "" });
      }, 300);
      return job;
    }
    const body = huaweiBad
      ? "                ^\r\nError: Unrecognized command found at '^' position.\r\n"
      : bad
      ? "                ^\r\n% Invalid input detected at '^' marker.\r\n\r\n"
      : ask
        ? "Proceed with reload? [confirm]\r\n"
        : respond(args.conn, s, args.command);
    const output = `${prompt}${args.command}\r\n${body}${prompt}`;
    setTimeout(() => {
      emit("tool-job", { job, kind: "result", text: "", data: { ok: !bad && !declined, output, declined } });
      emit("tool-job", { job, kind: "done", text: "" });
    }, 500);
    return job;
  };
  // Mensaje asíncrono (syslog con "logging synchronous"): corta la línea y la redibuja con lo tecleado.
  window.__ntMockAsync = () => {
    for (const id of channels.keys()) out(id, `\r\n*Oct 21 10:42:17: %LINK-3-UPDOWN: Interface GigabitEthernet1/0/3, changed state to down\r\n${promptOf(id)}${lineBuf.get(id) ?? ""}`);
  };
  // Medición: salida masiva (show running-config largo) a todas las pestañas, en bloques como un equipo real.
  window.__ntMockFlood = (lines = 20000) => {
    const row = (i) => `interface GigabitEthernet1/0/${i % 48} description UPLINK ${i} ip address 10.${i % 255}.1.1 255.255.255.0 shutdown\r\n`;
    for (const id of channels.keys()) {
      let chunk = "";
      for (let i = 0; i < lines; i++) {
        chunk += row(i);
        if (chunk.length > 16384) (out(id, chunk), (chunk = ""));
      }
      out(id, chunk + promptOf(id));
    }
  };
  // Pausa entre equipos al enviar a varias sesiones: se ve el avance y el botón Detener.
  localStorage.setItem("broadcastDelay", "3000");
  // Eco y respuestas en orden, con una pausa breve por línea como un equipo real.
  const queues = new Map();
  const later = (id, fn, ms) => {
    // Al menos 1 ms después del anterior: lo tecleado mientras responde sale tras el prompt (typeahead).
    const at = Math.max(Date.now(), queues.get(id) ?? 0) + Math.max(1, ms);
    queues.set(id, at);
    setTimeout(fn, at - Date.now());
  };
  // Huawei VRP simulado: CTRL_H (^H) borra con eco "\b \b" (&vrpecho=k: "\b\x1b[K"); con
  // &vrp=strict el equipo ignora DEL, como el que reportó el usuario; ^W borra la palabra.
  // window.__ntWrites guarda lo que llega al equipo, para revisar los bytes.
  const q = new URLSearchParams(location.search);
  const vrpStrict = q.get("vrp") === "strict";
  const vrpErase = q.get("vrpecho") === "k" ? "\b\x1b[K" : "\b \b";
  window.__ntWrites = [];
  /** Palabras que el equipo simulado completa con Tab. */
  const MOCK_WORDS = ["show", "interface", "interfaces", "brief", "version", "running-config", "clock", "ip", "vlan"];
  handlers.write = ({ id, data }) => {
    window.__ntWrites.push(data);
    const vrp = connSessions.get(id)?.highlight === "huawei";
    const erase = vrp ? vrpErase : "\b \b";
    let buf = lineBuf.get(id) ?? "";
    let echo = "";
    for (const ch of data) {
      if (ch === "\r" || ch === "\n") {
        if (ch === "\n" && data.includes("\r\n")) continue;
        const line = buf;
        const e = echo;
        later(id, () => e && out(id, e), 0);
        later(id, () => out(id, reply(id, line) + promptOf(id)), 200);
        buf = "";
        echo = "";
      } else if (ch === "\x7f" || ch === "\b") {
        if (ch === "\x7f" && vrp && vrpStrict) continue;
        if (buf) (buf = buf.slice(0, -1)), (echo += erase);
      } else if (ch === "\x17") {
        const n = buf.length - buf.replace(/\S*\s*$/, "").length;
        (buf = buf.slice(0, buf.length - n)), (echo += erase.repeat(n));
      } else if (ch === "\t") {
        // Autocompletado del equipo (como IOS): completa la última palabra si es única.
        const last = /(\S+)$/.exec(buf)?.[1] ?? "";
        const hits = last ? MOCK_WORDS.filter((w) => w.startsWith(last.toLowerCase())) : [];
        if (hits.length === 1) {
          const add = `${hits[0].slice(last.length)} `;
          (buf += add), (echo += add);
        }
      } else if (ch === "?") {
        // Ayuda del equipo: opciones y luego prompt + lo escrito (sin el "?").
        echo += `\r\n  brief      Resumen de interfaces\r\n  interface  Estado por interfaz\r\n\r\n${promptOf(id)}${buf}`;
      } else if (ch >= " ") (buf += ch), (echo += ch);
    }
    if (echo) {
      const e = echo;
      later(id, () => out(id, e), 0);
    }
    lineBuf.set(id, buf);
    return null;
  };
  // ---- Contraseñas de vecinos (saltos): como el backend real, la lista no trae contraseñas y la
  // escritura va directo a la conexión (sin eco ni historial). ?hopcred=1 deja guardada la de
  // sw-acceso-01 (admin@192.0.2.21), ?badcred=1 la deja mal escrita y ?pivotpw=1 da contraseña
  // guardada a core-sw01 (credencial del pivote).
  const hopCreds = new Map();
  if (q0.has("hopcred")) hopCreds.set("192.0.2.21|admin", { pw: q0.has("badcred") ? "bad" : "Cl4ve-ficticia", used: null });
  // ?chain=1&hopcred=1: contraseña guardada de cada equipo de la cadena (usuario admin).
  if (chainOn && q0.has("hopcred")) for (const c of CHAIN.slice(1)) hopCreds.set(`${c.ip}|admin`, { pw: "Cl4ve-ficticia", used: null });
  if (q0.has("pivotpw")) {
    const pv = sessions.find((x) => x.name === "core-sw01");
    if (pv) pv.save_password = true;
  }
  window.__hopWrites = [];
  const usedTokens = new Set();
  Object.assign(handlers, {
    hop_cred_list: () => {
      if (vault.backend === "vault" && !vault.unlocked) throw "La bóveda está bloqueada. Desbloquéala en Ajustes › Credenciales";
      return [...hopCreds].map(([k, v]) => ({ ip: k.split("|")[0], user: k.split("|")[1], last_used: v.used })).sort((a, b) => a.ip.localeCompare(b.ip));
    },
    hop_cred_has: ({ ip, user }) => hopCreds.has(`${ip}|${user}`),
    hop_cred_set: ({ ip, user, password }) => {
      if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip.trim())) throw "IP del vecino no válida";
      hopCreds.set(`${ip.trim()}|${user.trim()}`, { pw: password, used: hopCreds.get(`${ip.trim()}|${user.trim()}`)?.used ?? null });
      vault.exists = true;
      return null;
    },
    hop_cred_delete: ({ ip, user }) => (hopCreds.delete(`${ip}|${user}`), null),
    hop_type_password: ({ conn, source, ip, user, cmd, token }) => {
      window.__hopWrites.push({ source, ip, token });
      if (usedTokens.has(token)) throw "La contraseña de este salto ya se intentó una vez: no se reintenta";
      const st = hopOf(conn);
      if (st.mode !== "password" || !cmd.includes(ip)) throw "La pantalla no muestra un pedido de contraseña";
      let pw;
      if (source === "saved") {
        const rec = hopCreds.get(`${ip}|${user}`);
        if (!rec) throw "No hay contraseña guardada para este vecino, o la bóveda está bloqueada";
        pw = rec.pw;
        rec.used = Math.floor(Date.now() / 1000);
      } else pw = q0.has("badpivot") ? "bad" : "Cl4ve-pivote";
      usedTokens.add(token);
      later(conn, () => out(conn, reply(conn, pw) + promptOf(conn)), 200);
      return null;
    },
  });
  // ?scene=suggest-config: core-sw01 parte en modo configuración de interfaz (prueba de que
  // `sh` no se sugiere como `show`, porque ahí es `shutdown`); `end` vuelve a modo consulta.
  if (location.search.includes("scene=suggest-config")) {
    const connect = handlers.connect;
    handlers.connect = (args) => {
      if (args.session?.name === "core-sw01") modes.set(args.id, "config-if");
      return connect(args);
    };
    const base = terminalFor;
    terminalFor = (s) =>
      s.name === "core-sw01"
        ? `${base(s)}configure terminal\nEnter configuration commands, one per line.  End with CNTL/Z.\ncore-sw01(config)#interface GigabitEthernet1/0/4\ncore-sw01(config-if)#`
        : base(s);
  }
  handlers.save_session = ({ session }) => {
    const saved = { ...session, id: session.id || `v${Date.now()}`, created_at: session.created_at || new Date().toISOString() };
    const i = sessions.findIndex((x) => x.id === saved.id);
    i >= 0 ? (sessions[i] = saved) : sessions.push(saved);
    return { ...saved };
  };
  handlers.delete_session = ({ id }) => {
    const i = sessions.findIndex((x) => x.id === id);
    if (i >= 0) sessions.splice(i, 1);
    return null;
  };
  if (location.search.includes("update=1")) {
    // La revisión automática al abrir no encuentra nada; "Buscar ahora" encuentra la 0.9.14.
    let checks = 0;
    handlers.update_check = () => ({
      current: "0.9.1", latest: "0.9.14", newer: checks++ > 0, supported: true, reason: null, published: new Date(now).toISOString(),
      url: "https://github.com/Parzval-Net/Net_Terminal/releases/latest",
      notes: "- Vista dividida: selector de pestaña más rápido\n- Cliente SNMP: exportación CSV de traps\n- Catálogo: nuevos comandos de diagnóstico",
    });
    handlers.update_install = () =>
      new Promise(() => {
        const total = 8_400_000;
        let done = 0;
        const t = setInterval(() => {
          done = Math.min(total, done + 350_000);
          emit("update-progress", { downloaded: done, total });
          if (done >= total) clearInterval(t);
        }, 200);
      });
  }
}

const vaultPortable = location.search.includes("vault=portable");
const vault = { backend: vaultPortable ? "vault" : "keychain", exists: !vaultPortable, unlocked: !vaultPortable, portable: vaultPortable };
const vaultIds = new Set(["s6"]);

window.__TAURI_INTERNALS__ = {
  metadata: { currentWindow: { label: "main" }, currentWebview: { windowLabel: "main", label: "main" } },
  transformCallback(fn) {
    const id = nextId++;
    cbs.set(id, fn);
    return id;
  },
  unregisterCallback: (id) => cbs.delete(id),
  convertFileSrc: (p) => p,
  async invoke(cmd, args = {}) {
    const h = handlers[cmd];
    return h ? h(args) : null;
  },
};
window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };

// ---- Escenas para las capturas: demo.html?scene=<nombre> ----
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function find(label) {
  const all = [...document.querySelectorAll("button, [role=button], [title], div, span, a, li")];
  if (label.startsWith("Herramientas")) {
    const mob = all.find((e) => e.getAttribute("aria-label") === "Red" || e.getAttribute("aria-label") === "Herramientas");
    if (mob) return mob;
  }
  return (
    all.find((e) => e.getAttribute("aria-label") === label) ||
    all.find((e) => e.title === label || e.title?.startsWith(label + " (")) ||
    all.find((e) => e.textContent?.trim() === label && e.children.length <= 2)
  );
}
async function act(type, label) {
  for (let i = 0; i < 40; i++) {
    const e = find(label);
    if (e) {
      const opts = { bubbles: true, cancelable: true, view: window, detail: type === "dblclick" ? 2 : 1 };
      e.dispatchEvent(new MouseEvent("mousedown", opts));
      e.dispatchEvent(new MouseEvent("mouseup", opts));
      e.dispatchEvent(new MouseEvent("click", opts));
      if (type === "dblclick") e.dispatchEvent(new MouseEvent("dblclick", opts));
      await wait(250);
      return;
    }
    await wait(100);
  }
  console.warn("escena: no encontrado", label);
}
const click = (l) => act("click", l);
async function svgNode(name) {
  await wait(200);
  const t = [...document.querySelectorAll("svg text")].find((e) => e.textContent === name);
  // Con coordenadas del nodo: Topología decide el arrastre y el clic por la posición del puntero.
  const r = t?.parentElement?.getBoundingClientRect();
  const at = { bubbles: true, pointerId: 1, isPrimary: true, button: 0, clientX: (r?.left ?? 0) + (r?.width ?? 0) / 2, clientY: (r?.top ?? 0) + (r?.height ?? 0) / 2 };
  t?.parentElement?.dispatchEvent(new PointerEvent("pointerdown", { ...at, buttons: 1 }));
  document.querySelector("svg")?.dispatchEvent(new PointerEvent("pointerup", { ...at, buttons: 0 }));
  await wait(250);
}
const open = (l) => act("dblclick", l);
const key = (k) => window.dispatchEvent(new KeyboardEvent("keydown", { key: k, code: `Key${k.toUpperCase()}`, metaKey: true, bubbles: true, cancelable: true }));
async function quickTo(host) {
  await click("Conexión rápida sin guardar");
  typeInto(document.querySelector('input[placeholder="192.0.2.10 o hostname"]'), host);
  await click("Conectar");
}
function typeInto(el, value) {
  if (!el) return console.warn("escena: campo no encontrado");
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

const scenes = {
  terminal: async () => { await open("ar-wan01"); await open("core-sw01"); await click("Catálogo de comandos"); },
  notes: async () => { await open("core-sw01"); await open("ar-wan01"); await click("Notas"); await click("plantilla-vlan.txt"); },
  monitor: async () => { await open("core-sw01"); await click("Herramientas: monitoreo, diagnóstico, TFTP, syslog, plugins"); },
  topology: async () => { await click("Herramientas: monitoreo, diagnóstico, TFTP, syslog, plugins"); await click("Topología"); await svgNode("core-sw01"); await click("Desde aquí"); await svgNode("sw-acceso-02"); await click("Hasta aquí"); },
  compare: async () => { await click("Herramientas: monitoreo, diagnóstico, TFTP, syslog, plugins"); await click("Topología"); await wait(300); const s = [...document.querySelectorAll("select")].find((x) => [...x.options].some((o) => o.value === "s1")); const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set; set.call(s, "s1"); s.dispatchEvent(new Event("change", { bubbles: true })); await wait(300); },
  subnet: async () => { await click("Herramientas: monitoreo, diagnóstico, TFTP, syslog, plugins"); await click("Subredes"); },
  speed: async () => { await click("Herramientas: monitoreo, diagnóstico, TFTP, syslog, plugins"); await click("Velocidad"); },
  oscmds: async () => { await open("Shell local"); await click("Catálogo de comandos"); },
  about: async () => { await click("Ajustes"); await click("Acerca de"); },
  settings: async () => { await open("core-sw01"); await click("Ajustes"); },
  logs: async () => { await open("core-sw01"); await click("Ajustes"); await click("Logs"); },
  quick: async () => { await click("Conexión rápida sin guardar"); const h = document.querySelector('input[placeholder="192.0.2.10 o hostname"]'); if (h) { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(h, "192.0.2.77"); h.dispatchEvent(new Event("input", { bubbles: true })); } },
  quickserial: async () => { await click("Conexión rápida sin guardar"); await click("Serial"); },
  // Pestaña abierta por conexión rápida: "Guardar como sesión…" en la barra de estado.
  quicktab: async () => { await click("Conexión rápida sin guardar"); const h = document.querySelector('input[placeholder="192.0.2.10 o hostname"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(h, "192.0.2.77"); h.dispatchEvent(new Event("input", { bubbles: true })); await click("Conectar"); },
  packs: async () => { await open("core-sw01"); await click("Catálogo de comandos"); await click("Packs de comandos"); },
  split: async () => { await open("core-sw01"); await open("ar-wan01"); await open("dist-sw01"); await open("sw-acceso-sur"); await click("Vista dividida: ver 2 o 4 pestañas a la vez"); await click("4 en cuadrícula (2x2)"); },
  backup: async () => { await open("core-sw01"); await open("ar-wan01"); await click("Herramientas: monitoreo, diagnóstico, TFTP, syslog, plugins"); await click("Respaldos"); await click("Comparar A y B"); },
  legacy: async () => { await open("router-antiguo"); },
  credentials: async () => { await click("Ajustes"); await click("Credenciales"); },
  alerts: async () => { await open("core-sw01"); await click("Ajustes"); await click("Alertas"); },
  import: async () => { await click("Ajustes"); await click("Importar y exportar"); await click("Desde archivo…"); await click("Leer ~/.ssh/config"); },
  vertical: async () => { await open("core-sw01"); await open("ar-wan01"); await open("fw-perimetro"); await open("sw-acceso-norte"); },
  // Nota protegida: se elige, se desbloquea con la contraseña de demo y se abren sus opciones.
  "secure-note": async () => {
    await open("core-sw01");
    await click("Notas");
    await wait(400);
    const sel = [...document.querySelectorAll("select")].find((x) => [...x.options].some((o) => o.value === "accesos-sitio-central"));
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(sel, "accesos-sitio-central");
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    await wait(400);
    const pw = document.querySelector('input[type="password"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(pw, "demo-clave-2026");
    pw.dispatchEvent(new Event("input", { bubbles: true }));
    await wait(100);
    pw.form.requestSubmit();
    await wait(400);
    await click("Más acciones de la nota");
    await click("Protección de la nota");
  },
  snmp: async () => { await click("Herramientas: monitoreo, diagnóstico, TFTP, syslog, plugins"); await click("SNMP"); await click("IF-MIB (RFC 2863): ifXTable con contadores de 64 bits; ifTable si el agente no la tiene"); await wait(400); await click("Iniciar"); await wait(600); [...document.querySelectorAll("h3")].find((h) => h.textContent === "Conjuntos de OIDs")?.scrollIntoView(); },
  // Generador de configuración SNMP: Cisco IOS-XE, v3 authPriv, secretos como marcadores.
  snmpgen: async () => {
    await click("Herramientas: monitoreo, diagnóstico, TFTP, syslog, plugins"); await click("SNMP"); await click("Generador de configuración"); await wait(300);
    const at = (ph) => document.querySelector(`input[placeholder="${ph}"]`);
    setVal(at("192.0.2.10, 198.51.100.0/24"), "192.0.2.10, 198.51.100.0/24");
    setVal(at("192.0.2.20"), "192.0.2.20");
    setVal(at("Loopback0"), "Loopback0");
    setVal(at("Santiago DC1 Rack 12"), "Sitio Central Rack 12");
    await wait(300);
    const h = [...document.querySelectorAll("h3")].find((x) => x.textContent === "Configuración generada");
    h?.scrollIntoView({ block: "center" });
    // Deja visible la fila de plataforma y algoritmos sobre el texto generado.
    let sc = h?.parentElement;
    while (sc && sc.scrollHeight <= sc.clientHeight) sc = sc.parentElement;
    if (sc) sc.scrollTop -= 90;
  },
  transfer: async () => { await click("Herramientas: monitoreo, diagnóstico, TFTP, syslog, plugins"); await click("Transferencias"); await wait(400); [...document.querySelectorAll("h3")].find((h) => h.textContent === "Servidor TFTP")?.scrollIntoView(); },
  // ---- Escenas de QA visual del contenedor de la app ----
  empty: async () => {},
  palette: async () => { await wait(300); key("k"); await wait(300); },
  "palette-q": async () => { await wait(300); key("k"); await wait(300); typeInto(document.querySelector('[role="dialog"] input, .fixed input'), "core"); await wait(300); },
  ctxmenu: async () => { await open("core-sw01"); const row = find("core-sw02"); row?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 120, clientY: 160 })); await wait(300); },
  filter: async () => { typeInto(document.querySelector('input[placeholder^="Filtrar"]'), "sw-acceso"); await wait(300); },
  "filter-none": async () => { typeInto(document.querySelector('input[placeholder^="Filtrar"]'), "zzz"); await wait(300); },
  // Pestañas con estados mezclados: rápida inactiva, alerta, actividad y cerrada.
  quicktabs: async () => {
    await quickTo("192.0.2.77");
    await open("core-sw01");
    await open("router-antiguo");
    await open("ar-wan01");
    await wait(500);
  },
  "quick-active": async () => {
    await quickTo("192.0.2.77");
    await open("core-sw01");
    await wait(300);
    document.querySelector('[title^="192.0.2.77"]')?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    await wait(500);
  },
  "lock-note": async () => {
    await open("core-sw01");
    await click("Notas");
    await wait(400);
    const sel = [...document.querySelectorAll("select")].find((x) => [...x.options].some((o) => o.value === "accesos-sitio-central"));
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set.call(sel, "accesos-sitio-central");
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    await wait(400);
  },
  find: async () => { await open("core-sw01"); await wait(400); key("f"); await wait(300); },
  paste: async () => {
    await open("core-sw01");
    await wait(600);
    const dt = new DataTransfer();
    dt.setData("text/plain", "interface Gi1/0/5\n description PRUEBA\n shutdown\n");
    document.querySelector(".xterm")?.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    await wait(300);
  },
  toasts: async () => { await open("core-sw01"); await open("ar-wan01"); await wait(1200); },
  // Barra de difusión en curso: se arranca un envío ficticio directo en el módulo.
  bcastbar: async () => {
    await open("core-sw01"); await open("core-sw02");
    const m = await import("/src/lib/broadcast.ts");
    const mk = (id, name, host) => ({ id, session: { id, name, host, type: "ssh" } });
    m.runBroadcast([mk("a", "core-sw01", "192.0.2.1"), mk("b", "core-sw02", "192.0.2.2"), mk("c", "dist-sw01", "192.0.2.11")], [{ tab: mk("d", "Shell local"), reason: "Terminal local" }], "show clock", { lineDelayMs: 0, deviceDelayMs: 0 },
      () => ({ isConnected: () => true, send: () => new Promise((r) => setTimeout(r, 600000)) }));
    await wait(300);
    await click("Ver detalle");
  },
  macros: async () => { await open("core-sw01"); await wait(300); },
  broadcast: async () => { await open("core-sw01"); await open("core-sw02"); await open("Shell local"); await click("Notas"); await click("Elegir a qué sesiones se envía"); },
};
// Escenas de QA visual (modales, ajustes y herramientas).
const setVal = (el, v) => {
  const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(el, v);
  el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
};
const TOOLS = "Herramientas: monitoreo, diagnóstico, TFTP, syslog, plugins";
const settingsAt = (label) => async () => { await click("Ajustes"); await wait(300); await click(label); };
const tool = (label) => async () => { await click(TOOLS); await click(label); };
Object.assign(scenes, {
  "s-appearance": settingsAt("Apariencia"),
  "s-terminal": settingsAt("Terminal"),
  "s-highlight": settingsAt("Resaltado"),
  "s-logs": settingsAt("Logs"),
  "s-credentials": settingsAt("Credenciales"),
  "s-sessions": settingsAt("Importar y exportar"),
  "s-modules": settingsAt("Módulos"),
  "s-alerts": settingsAt("Alertas"),
  "s-ai": settingsAt("Agentes IA"),
  "s-about": settingsAt("Acerca de"),
  "s-search": async () => { await click("Ajustes"); await wait(300); setVal(document.querySelector('input[aria-label="Buscar ajuste"]'), "contraseña"); },
  "s-vault": async () => { await click("Ajustes"); await wait(300); await click("Credenciales"); },
  "session-new": async () => { await click("Nueva sesión"); },
  "session-edit": async () => { await wait(300); const row = [...document.querySelectorAll("[title]")].find((e) => e.title.startsWith("192.0.2.1")); row?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true })); const ed = row?.querySelector('[title="Editar"]') ?? find("Editar"); ed?.dispatchEvent(new MouseEvent("click", { bubbles: true })); },
  "quick-telnet": async () => { await click("Conexión rápida sin guardar"); await click("Telnet"); },
  confirm: async () => { await open("core-sw01"); await open("ar-wan01"); await wait(300); window.dispatchEvent(new KeyboardEvent("keydown", { key: "w", metaKey: true, ctrlKey: true, bubbles: true })); },
  approval: async () => { await wait(800); emit("mcp-approval", { id: "a1", tool: "send_command", target: "core-sw01 (192.0.2.1)", detail: "configure terminal\ninterface GigabitEthernet1/0/4\n no shutdown\nend" }); },
  macro: async () => { await open("core-sw01"); await click("Nuevo botón"); },
  "cmd-editor": async () => { await open("core-sw01"); await click("Catálogo de comandos"); await click("Agregar un comando propio"); },
  // Nueva sesión con túneles, contraseña guardada y un error de validación visibles.
  "session-full": async () => {
    await click("Nueva sesión");
    await wait(300);
    const d = [...document.querySelectorAll("details")].find((x) => x.textContent.includes("Túneles SSH"));
    if (d) d.open = true;
    await click("Agregar túnel");
    await click("Agregar túnel");
    const pw = [...document.querySelectorAll("label")].find((l) => l.textContent.trim().startsWith("Guardar contraseña"))?.querySelector("input");
    pw?.click();
    await wait(200);
    document.querySelector("form footer button[type=submit]")?.click();
  },
  // Alerta en edición con una expresión regular inválida (estado de error).
  "s-alerts-edit": async () => {
    await click("Ajustes"); await wait(300); await click("Alertas"); await click("Nueva alerta"); await wait(200);
    const boxes = [...document.querySelectorAll("label")].find((l) => l.textContent.trim() === "Expresión regular")?.querySelector("input");
    boxes?.click(); await wait(100);
    setVal(document.querySelector('input[placeholder="BGP.*Down"]'), "BGP.*(Down");
  },
  // Diálogo de difusión: varias pestañas elegidas y "Enviar todo" desde Notas.
  "bc-dialog": async () => {
    await scenes.broadcast(); await wait(300);
    document.querySelectorAll("input[name=bc-mode]")[1]?.click(); await wait(200);
    for (const c of document.querySelectorAll("input[type=checkbox]")) if (!c.checked && c.closest("label")?.textContent.includes("core-sw0")) c.click();
    await wait(200);
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    [...document.querySelectorAll("button")].find((b) => /⇧Enter|Shift\+Enter/.test(b.title))?.click();
  },
  // Cerrar varias pestañas: conectadas, rápida sin guardar, local, desconectada, log y vista dividida.
  "closeall-setup": async () => {
    await quickTo("192.0.2.77");
    for (const n of ["core-sw01", "ar-wan01", "dist-sw01", "fw-perimetro", "sw-acceso-norte", "sw-acceso-sur", "router-antiguo", "Shell local"]) await open(n);
    await wait(600);
    document.querySelector('[title^="core-sw01"]')?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    await wait(300);
    await click("Grabar la sesión en un archivo de texto");
    await click("Vista dividida: ver 2 o 4 pestañas a la vez");
    await click("2 lado a lado");
    await wait(400);
  },
  closeall: async () => {
    await scenes["closeall-setup"]();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "W", code: "KeyW", metaKey: true, shiftKey: true, bubbles: true, cancelable: true }));
    await wait(300);
  },
  "closeall-menu": async () => {
    for (const n of ["core-sw01", "ar-wan01", "dist-sw01", "Shell local"]) await open(n);
    await wait(400);
    const sel = location.search.includes("layout=vertical") ? '[role="tab"][data-id="t2"]' : '[data-tab="t2"]';
    const el = document.querySelector(sel);
    const r = el?.getBoundingClientRect();
    el?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: (r?.left ?? 300) + 30, clientY: (r?.top ?? 60) + 14 }));
    await wait(300);
  },
  "closeall-palette": async () => {
    for (const n of ["core-sw01", "ar-wan01"]) await open(n);
    await wait(300);
    key("k");
    await wait(300);
    typeInto(document.querySelector('[role="dialog"] input'), "cerrar");
    await wait(300);
  },
  "t-monitor": tool("Monitoreo"),
  "t-diag": tool("Diagnóstico"),
  "t-topology": tool("Topología"),
  // Fuentes de descubrimiento activadas y apagadas (mismo diagrama), solo ruteo y manual.
  "topology-sources": async () => { await tool("Topología")(); await wait(300); },
  "topology-sources-off": async () => { await tool("Topología")(); await svgNode("rt-borde01"); },
  "topology-ospf": async () => { await tool("Topología")(); await svgNode("rt-borde01"); },
  // Revisiones de enlaces: dúplex, VLAN nativa, trunk/access, agregado, CRC y asimetría sobre el mapa.
  "topology-checks": async () => { await tool("Topología")(); await wait(300); },
  "topology-manual": async () => { await tool("Topología")(); await svgNode("ap-bodega"); },
  // Tablas MAC/ARP: enlace MAC/OUI confirmado, sugerencias por confianza y detalle por puerto.
  "topology-mac": async () => {
    await tool("Topología")();
    await svgNode("dist-sw01");
    await wait(300);
  },
  // Descubrimiento con un perfil SNMP (LLDP, CDP, OSPF/BGP y tabla MAC simulados).
  "topology-snmp": async () => {
    await tool("Topología")();
    await wait(300);
    await click("Descubrir por SNMP");
    await wait(900);
  },
  // Tráfico en enlaces por SNMP: la tasa aparece desde la segunda lectura (15 s).
  "topology-traffic": async () => {
    await tool("Topología")();
    await wait(300);
    await click("Mostrar el tráfico de los enlaces (opciones en el panel)");
  },
  // Saltar desde el pivote: abre core-sw01 y deja Topología con dist-sw01 elegido (?video=1).
  "topology-hop": async () => {
    await open("core-sw01");
    await wait(900);
    await tool("Topología")();
    await wait(400);
    await svgNode("dist-sw01");
  },
  // Cadena core › dist › agg › acc1 › acc2 › acc3 (?chain=1&hopcred=1): abre core-sw01 y Topología sin diagrama.
  "topology-hop-chain": async () => {
    await open("core-sw01");
    await wait(900);
    await tool("Topología")();
    await wait(400);
  },
  "t-subnet": tool("Subredes"),
  "t-perf": tool("Velocidad"),
  "t-transfer": tool("Transferencias"),
  "t-syslog": tool("Syslog"),
  "t-backup": scenes.backup,
  "t-plugins": tool("Plugins"),
  suggest: async () => { await open("core-sw01"); },
  vrp: async () => { await open("ar-wan01"); },
  "suggest-config": async () => { await open("core-sw01"); },
  // Revisión de la interfaz: confirmaciones y textos de las herramientas de red.
  "q-syslog": tool("Syslog"),
  "q-traps": async () => { await tool("SNMP")(); await wait(400); [...document.querySelectorAll("h3")].find((h) => h.textContent === "Receptor de traps")?.scrollIntoView(); },
  "q-transfer-files": async () => { await open("core-sw01"); await tool("Transferencias")(); await wait(400); [...document.querySelectorAll("h3")].find((h) => h.textContent === "Archivos compartidos")?.scrollIntoView(); },
  "q-backup-secret": async () => { await scenes.backup(); await wait(900); [...document.querySelectorAll("span")].find((x) => x.textContent === "secreto cambiado")?.scrollIntoView({ block: "center" }); },
  "q-transfer-top": async () => { await open("core-sw01"); await tool("Transferencias")(); },
  "q-reset": async () => { await click("Ajustes"); await wait(300); await click("Restablecer valores"); },
  "q-topo-clear": async () => { await tool("Topología")(); await wait(300); await click("Borrar diagrama"); },
});
// Acceso para el script de QA (CDP): pasos adicionales sobre una escena.
window.__demo = { click, open, wait, svgNode, emit, find, setVal };
// Acceso para backends simulados que extienden este (scripts/video/plugins/mock-video.js).
window.__mock = { handlers, emit, cbs, channels, connSessions, sessions, settings, notes, enc };
const scene = new URLSearchParams(location.search).get("scene");
if (scene && scenes[scene]) window.addEventListener("load", () => wait(600).then(scenes[scene]));
