// Pruebas de topología: `node scripts/tests/topology.test.mjs` (Node 22.15+ con tipos TS).
// Salidas de ejemplo con direcciones de documentación (RFC 5737) y nombres ficticios.
import assert from "node:assert/strict";
import { fastEnough } from "./timing.mjs";
import { registerHooks } from "node:module";

// packs.ts importa "./highlight" sin extensión (como lo resuelve Vite): se completa con .ts.
registerHooks({
  resolve(specifier, context, next) {
    if (/^\.\.?\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier) && context.parentURL?.endsWith(".ts")) {
      try {
        return next(`${specifier}.ts`, context);
      } catch {
        /* sigue con la resolución normal */
      }
    }
    return next(specifier, context);
  },
});

const T = await import("../../src/lib/topology.ts");
const nodeId = T.nodeId;
const { computeRisk } = await import("../../src/lib/packs.ts");

// ---------- Parsers de ruteo ----------

const iosOspf = `R1#show ip ospf neighbor

Neighbor ID     Pri   State           Dead Time   Address         Interface
192.0.2.2         1   FULL/DR         00:00:36    198.51.100.2    GigabitEthernet0/1
192.0.2.3         0   FULL/  -        00:00:33    198.51.100.6    GigabitEthernet0/2
192.0.2.4         1   2WAY/DROTHER    00:00:39    198.51.100.10   Vlan10
192.0.2.9         1   DOWN/  -           -        198.51.100.14   GigabitEthernet0/3
R1#`;
const ospf = T.parseCiscoOspf(iosOspf);
assert.equal(ospf.length, 3, "DOWN no se dibuja");
assert.deepEqual(
  ospf.map((n) => [n.name, n.ip, n.localPort, n.proto, n.byAddr]),
  [
    ["192.0.2.2", "198.51.100.2", "GigabitEthernet0/1", "OSPF", true],
    ["192.0.2.3", "198.51.100.6", "GigabitEthernet0/2", "OSPF", true],
    ["192.0.2.4", "198.51.100.10", "Vlan10", "OSPF", true],
  ],
);
assert.deepEqual(ospf[0].addrs, ["192.0.2.2", "198.51.100.2"]);

// NX-OS: Up Time en vez de Dead Time, con encabezado por VRF.
const nxOspf = ` OSPF Process ID 1 VRF default
 Total number of neighbors: 1
 Neighbor ID     Pri State            Up Time  Address         Interface
 192.0.2.21        1 FULL/DR          02:11:05 203.0.113.2     Eth1/49
`;
assert.deepEqual(T.parseCiscoOspf(nxOspf).map((n) => [n.name, n.ip, n.localPort]), [["192.0.2.21", "203.0.113.2", "Eth1/49"]]);

const junosOspf = `user@borde-01> show ospf neighbor
Address          Interface              State     ID               Pri  Dead
198.51.100.1     ge-0/0/0.0             Full      192.0.2.1        128    36
198.51.100.5     ge-0/0/1.0             2Way      192.0.2.5        128    38
198.51.100.9     ge-0/0/2.0             Init      192.0.2.6        128    31
`;
const jo = T.parseJunosOspf(junosOspf);
assert.deepEqual(jo.map((n) => [n.name, n.ip, n.localPort]), [
  ["192.0.2.1", "198.51.100.1", "ge-0/0/0.0"],
  ["192.0.2.5", "198.51.100.5", "ge-0/0/1.0"],
  ["192.0.2.6", "198.51.100.9", "ge-0/0/2.0"],
]);

const huaweiOspf = `<agg-hw01>display ospf peer brief

          OSPF Process 1 with Router ID 192.0.2.30
                  Peer Statistic Information
 ----------------------------------------------------------------------------
 Area Id          Interface                        Neighbor id      State
 0.0.0.0          GigabitEthernet1/0/0             192.0.2.31       Full
 0.0.0.1          Vlanif100                        192.0.2.32       Full
 ----------------------------------------------------------------------------
 Total Peer(s):     2
<agg-hw01>`;
const hw = T.parseHuaweiOspf(huaweiOspf);
assert.deepEqual(hw.map((n) => [n.name, n.ip, n.localPort]), [
  ["192.0.2.31", "192.0.2.31", "GigabitEthernet1/0/0"],
  ["192.0.2.32", "192.0.2.32", "Vlanif100"],
]);
assert.deepEqual(T.parseHuaweiOspf("Area Id no es tabla\n 0.0.0.0 x 192.0.2.1 Full"), [], "sin encabezado no se interpreta");

// EIGRP: formato actual (columna H) y antiguo (sin H).
const eigrpNew = `R1#show ip eigrp neighbors
EIGRP-IPv4 Neighbors for AS(100)
H   Address                 Interface              Hold Uptime   SRTT   RTO  Q  Seq
                                                   (sec)         (ms)       Cnt Num
1   198.51.100.18           Gi0/3                    13 01:02:03    1   100  0  42
0   198.51.100.22           Tu10                     11 3d04h      20   200  0  17
`;
const eigrpOld = `IP-EIGRP Neighbors for process 77
Address                 Interface     Holdtime Uptime   Q      Seq  SRTT  RTO
                                      (secs)   (h:m:s)  Count  Num  (ms)  (ms)
203.0.113.28            Ethernet1     13       0:00:41  0      11   4     20
`;
assert.deepEqual(T.parseEigrp(eigrpNew).map((n) => [n.name, n.localPort, n.proto]), [
  ["198.51.100.18", "Gi0/3", "EIGRP"],
  ["198.51.100.22", "Tu10", "EIGRP"],
]);
assert.deepEqual(T.parseEigrp(eigrpOld).map((n) => [n.name, n.localPort]), [["203.0.113.28", "Ethernet1"]]);
assert.deepEqual(T.parseEigrp(iosOspf), [], "solo con encabezado EIGRP");

const iosBgp = `R1#show ip bgp summary
BGP router identifier 192.0.2.1, local AS number 65010
BGP table version is 120, main routing table version 120
12 network entries using 2976 bytes of memory

Neighbor        V           AS MsgRcvd MsgSent   TblVer  InQ OutQ Up/Down  State/PfxRcd
192.0.2.2       4        65010     812     809      120    0    0 12:01:44       35
198.51.100.2    4        65010     500     498      120    0    0 1d02h          10
203.0.113.1     4        64500    1022     990      120    0    0 3d01h          12
203.0.113.5     4        64501       0       0        1    0    0 never    Idle (Admin)
`;
const b = T.parseBgpSummary(iosBgp);
assert.equal(b.routerId, "192.0.2.1");
assert.equal(b.localAs, "65010");
assert.deepEqual(b.peers.map((p) => [p.ip, p.remoteAs, p.state]), [
  ["192.0.2.2", "65010", "35"],
  ["198.51.100.2", "65010", "10"],
  ["203.0.113.1", "64500", "12"],
  ["203.0.113.5", "64501", "Idle (Admin)"],
]);
const nxBgp = `BGP summary information for VRF default, address family IPv4 Unicast
BGP router identifier 192.0.2.21, local AS number 65020
BGP table version is 67, IPv4 Unicast config peers 1, capable peers 1

Neighbor        V    AS MsgRcvd MsgSent   TblVer  InQ OutQ Up/Down  State/PfxRcd
203.0.113.9     4 65021     346     334       67    0    0 05:25:12 8
`;
assert.deepEqual(T.parseBgpSummary(nxBgp).peers.map((p) => p.ip), ["203.0.113.9"]);

// Combinado: BGP con IGP en común es directo (toma su interfaz); iBGP sin IGP es lógico; eBGP es directo.
const r = T.parseRoutingNeighbors([
  { cmd: "show ip ospf neighbor", out: iosOspf },
  { cmd: "show ip eigrp neighbors", out: "" },
  { cmd: "show ip bgp summary", out: iosBgp },
]);
assert.deepEqual(r.selfAddrs, ["192.0.2.1"]);
const bgpN = r.neighbors.filter((n) => n.proto === "BGP");
assert.deepEqual(
  bgpN.map((n) => [n.name, n.localPort, !!n.logical]),
  [
    ["192.0.2.2", "", true], // iBGP entre loopbacks
    ["198.51.100.2", "GigabitEthernet0/1", false], // misma IP que el vecino OSPF
    ["203.0.113.1", "", false], // eBGP (TTL 1)
  ],
  "Idle no se incluye",
);
// Comando con error o protocolo apagado: sin vecinos ni excepción.
assert.deepEqual(T.parseRoutingNeighbors([{ cmd: "show ip bgp summary", out: "% BGP not active\nR1#" }]).neighbors, []);
const hwR = T.parseRoutingNeighbors([{ cmd: "display ospf peer brief", out: huaweiOspf }]);
assert.deepEqual(hwR.selfAddrs, ["192.0.2.30"]);
const jR = T.parseRoutingNeighbors([{ cmd: "show ospf neighbor", out: junosOspf }]);
assert.equal(jR.neighbors.length, 3);

// CDP/LLDP deshabilitados se detectan como error (y activan el aviso en la interfaz).
assert.ok(T.isCliError("% CDP is not enabled\nR1#"));
assert.ok(T.isCliError("R1#show lldp neighbors detail\n% LLDP is not enabled\nR1#"));
assert.ok(T.isCliError("% BGP not active"));
assert.ok(!T.isCliError("Gi1/0/1  connected  descripcion: CDP is not enabled en el remoto"), "texto en una descripción no es error");
assert.deepEqual(T.parseNeighbors("cisco", ["% CDP is not enabled", "% LLDP is not enabled"]), []);

// Direcciones propias (IOS, NX-OS, Huawei, Junos).
const own = T.parseOwnAddresses([
  `Interface              IP-Address      OK? Method Status                Protocol
GigabitEthernet0/1     198.51.100.1    YES NVRAM  up                    up
GigabitEthernet0/2     unassigned      YES NVRAM  administratively down down
Loopback0              192.0.2.1       YES NVRAM  up                    up
R1#`,
  `IP Interface Status for VRF "default"(1)
Interface            IP Address      Interface Status
Eth1/49              203.0.113.1     protocol-up/link-up/admin-up`,
  `Interface                         IP Address/Mask      Physical   Protocol
Vlanif100                         198.51.100.33/29     up         up
NULL0                             unassigned           up         up(s)`,
  `Interface               Admin Link Proto    Local                 Remote
ge-0/0/0.0              up    up   inet     198.51.100.5/30
lo0.0                   up    up   inet     192.0.2.5           --> 0/0
em1.0                   up    up   inet     128.0.0.1/2
                                   inet     10.0.0.4/8
lo0.16384               up    up   inet     127.0.0.1           --> 0/0`,
]);
assert.deepEqual(own.sort(), ["10.0.0.4", "192.0.2.1", "192.0.2.5", "198.51.100.1", "198.51.100.33", "198.51.100.5", "203.0.113.1"].sort());

// ---------- Fusión por IP ----------

let t = { nodes: [], links: [] };
// R1 (CDP apagado) ve a R2 por OSPF y a un par iBGP.
t = T.mergeNeighbors(t, { name: "R1", ip: "192.0.2.1", addrs: ["198.51.100.1", "192.0.2.1"] }, r.neighbors);
const r2 = t.nodes.find((n) => n.id === "192.0.2.2");
assert.ok(r2?.addrOnly, "vecino por router-id, sin hostname");
assert.equal(r2.name, "192.0.2.2", "se rotula por IP");
assert.equal(r2.ip, "198.51.100.2");
assert.equal(t.links.filter((l) => l.proto === "OSPF").length, 3);
// El par iBGP 192.0.2.2 es el mismo router que el vecino OSPF: comparte nodo, enlace lógico aparte.
assert.equal(t.nodes.filter((n) => T.knownAddrs(n).includes("192.0.2.2")).length, 1, "sin duplicar el nodo");
const logical = t.links.find((l) => l.proto === "BGP" && l.logical);
assert.ok(logical && logical.b === "192.0.2.2");
// El BGP directo por 198.51.100.2 queda cubierto por el enlace OSPF del mismo puerto.
assert.equal(t.links.filter((l) => l.proto === "BGP" && !l.logical && l.b === "192.0.2.2").length, 0);
// Luego se explora R2: su nombre real reemplaza al nodo por IP, sin duplicar.
const before = t.nodes.length;
const r2Ospf = `Neighbor ID     Pri   State           Dead Time   Address         Interface
192.0.2.1         1   FULL/BDR        00:00:31    198.51.100.1    GigabitEthernet0/0
`;
t = T.mergeNeighbors(t, { name: "R2", ip: "192.0.2.2", addrs: ["198.51.100.2"] }, T.parseCiscoOspf(r2Ospf));
assert.equal(t.nodes.length, before, "R2 absorbe al nodo 192.0.2.2 y R1 se reconoce por su IP");
assert.ok(!t.nodes.some((n) => n.id === "192.0.2.2"));
const r2Node = t.nodes.find((n) => n.id === "r2");
assert.ok(r2Node.explored && !r2Node.addrOnly);
const r1r2 = t.links.filter((l) => l.proto === "OSPF" && [l.a, l.b].sort().join() === "r1,r2");
assert.equal(r1r2.length, 1, "el enlace OSPF visto desde ambos lados es uno solo");
assert.deepEqual([r1r2[0].aPort, r1r2[0].bPort], ["Gi0/1", "Gi0/0"], "completa la interfaz del otro extremo");
assert.equal(t.links.find((l) => l.logical)?.b, "r2", "la sesión lógica también se movió");
// CDP posterior confirma el enlace: pasa a CDP (más confiable), sin duplicarse.
t = T.mergeNeighbors(t, { name: "R2" }, [{ name: "R1.lab.example", localPort: "GigabitEthernet0/0", remotePort: "GigabitEthernet0/1", proto: "CDP" }]);
const confirmed = t.links.filter((l) => [l.a, l.b].sort().join() === "r1,r2" && !l.logical);
assert.equal(confirmed.length, 1);
assert.equal(confirmed[0].proto, "CDP");
// Un vecino CDP con IP absorbe un nodo conocido solo por esa dirección.
let t2 = T.mergeNeighbors({ nodes: [], links: [] }, { name: "R5" }, T.parseEigrp(eigrpOld));
assert.ok(t2.nodes.some((n) => n.id === "203.0.113.28"));
t2 = T.mergeNeighbors(t2, { name: "SW9" }, [{ name: "R6", localPort: "Gi1/0/1", remotePort: "Gi0/0", ip: "203.0.113.28", proto: "CDP" }]);
assert.ok(!t2.nodes.some((n) => n.id === "203.0.113.28"));
assert.ok(t2.links.some((l) => l.proto === "EIGRP" && (l.a === "r6" || l.b === "r6")));
// nodeId conserva las IPv4 completas (antes cortaba en el primer punto).
assert.equal(T.nodeId("192.0.2.7"), "192.0.2.7");
assert.equal(T.nodeId("sw01.lab.example"), "sw01");

// Ruta: la sesión lógica no es un salto físico mientras exista otro camino.
const lt = {
  nodes: ["a", "b", "c"].map((id, i) => ({ id, name: id, explored: true, x: i * 100 + 1, y: 1 })),
  links: [
    { a: "a", aPort: "Gi0/1", b: "b", bPort: "Gi0/1", proto: "OSPF" },
    { a: "b", aPort: "Gi0/2", b: "c", bPort: "Gi0/2", proto: "OSPF" },
    { a: "a", aPort: "", b: "c", bPort: "", proto: "BGP", logical: true },
  ],
};
assert.equal(T.shortestPath(lt, "a", "c").links.length, 2);
assert.equal(T.shortestPath({ ...lt, links: [lt.links[2]] }, "a", "c").links.length, 1, "sin otro camino se usa la sesión");
assert.match(T.pathToText(lt, T.shortestPath({ ...lt, links: [lt.links[2]] }, "a", "c")), /\? → \? {2}c {2}\(BGP lógica\)/);

// ---------- Equipos y enlaces manuales ----------

let m = { nodes: [], links: [] };
let res = T.addManualNode(m, { name: "sw-bodega-01", ip: "192.0.2.50", platform: "C9200L" });
assert.ok(res.topo, res.error);
m = res.topo;
assert.ok(m.nodes[0].manual && !m.nodes[0].explored);
assert.ok(T.addManualNode(m, { name: "SW-BODEGA-01" }).error, "nombre repetido");
assert.ok(T.addManualNode(m, { name: "otro", ip: "192.0.2.50" }).error, "IP repetida");
assert.ok(T.addManualNode(m, { name: "x", ip: "192.0.2.256" }).error, "IP fuera de rango");
assert.ok(T.addManualNode(m, { name: "x", ip: "192.0.2.010" }).error, "ceros a la izquierda");
assert.ok(T.addManualNode(m, { name: "x", ip: "hola" }).error);
assert.ok(T.addManualNode(m, { name: "x", ip: "2001:db8::1" }).topo, "IPv6 válida");
assert.ok(T.addManualNode(m, { name: "x", ip: "2001:db8:::1" }).error, "IPv6 inválida");
assert.ok(T.addManualNode(m, { name: "mal\nnombre" }).error, "salto de línea");
assert.ok(T.addManualNode(m, { name: "mal‮nombre" }).error, "override de dirección");
assert.ok(T.addManualNode(m, { name: "  " }).error, "vacío");
assert.ok(T.addManualNode(m, { name: "a".repeat(65) }).error, "largo");
assert.ok(T.addManualNode(m, { name: "ok", platform: "p".repeat(121) }).error, "plataforma larga");
m = T.addManualNode(m, { name: "ap-patio" }).topo;
res = T.addManualLink(m, { a: "sw-bodega-01", aPort: "GigabitEthernet1/0/5", b: "ap-patio", bPort: "" });
assert.ok(res.topo, res.error);
m = res.topo;
assert.deepEqual(m.links[0], { a: "sw-bodega-01", aPort: "Gi1/0/5", b: "ap-patio", bPort: "", proto: "manual" });
assert.ok(T.addManualLink(m, { a: "ap-patio", aPort: "", b: "sw-bodega-01", bPort: "Gi1/0/5" }).error, "duplicado en el otro sentido");
assert.ok(T.addManualLink(m, { a: "ap-patio", aPort: "", b: "ap-patio", bPort: "" }).error, "mismo equipo");
assert.ok(T.addManualLink(m, { a: "ap-patio", aPort: "Gi 1", b: "sw-bodega-01", bPort: "" }).error, "espacios");
assert.ok(T.addManualLink(m, { a: "nada", aPort: "", b: "sw-bodega-01", bPort: "" }).error, "equipo inexistente");
assert.ok(T.addManualLink(m, { a: "ap-patio", aPort: "x\u0007", b: "sw-bodega-01", bPort: "" }).error, "control");
// Editar enlace y equipo (renombrar mueve sus enlaces).
res = T.updateManualLink(m, m.links[0], { a: "sw-bodega-01", aPort: "Gi1/0/6", b: "ap-patio", bPort: "eth0" });
assert.ok(res.topo, res.error);
m = res.topo;
assert.equal(m.links[0].aPort, "Gi1/0/6");
res = T.updateManualNode(m, "ap-patio", { name: "ap-patio-02", ip: "198.51.100.77" });
assert.ok(res.topo, res.error);
m = res.topo;
assert.equal(m.links[0].b, "ap-patio-02");
assert.equal(m.nodes.find((n) => n.id === "ap-patio-02").ip, "198.51.100.77");
// Los descubiertos no se editan ni borran como manuales.
assert.ok(T.deleteManualNode(t, "r1").error);
assert.ok(T.deleteManualLink(t, t.links[0]).error);
// Ruta y diff incluyen lo manual.
assert.equal(T.shortestPath(m, "sw-bodega-01", "ap-patio-02").links.length, 1);
const d = T.diffTopology({ nodes: [], links: [] }, m);
assert.equal(d.addedLinks.length, 1);
assert.equal(d.addedNodes.length, 2);
// Borrar enlace y equipo.
assert.equal(T.deleteManualLink(m, m.links[0]).topo.links.length, 0);
const del = T.deleteManualNode(m, "sw-bodega-01").topo;
assert.equal(del.nodes.length, 1);
assert.equal(del.links.length, 0, "se van sus enlaces");
// Un equipo manual que luego se explora deja de ser manual.
const ex = T.mergeNeighbors(m, { name: "sw-bodega-01" }, []);
assert.ok(!ex.nodes.find((n) => n.id === "sw-bodega-01").manual);

// ---------- Heurística de descripciones ----------

const yes = [
  ["UPLINK a dist-sw01 Gi1/0/48", "dist-sw01", "Gi1/0/48"],
  ["to core-sw02 Te1/1/1", "core-sw02", "Te1/1/1"],
  ["Hacia fw-borde01 port2", "fw-borde01", "port2"],
  ["hacia sw-acceso-3", "sw-acceso-3", undefined],
  ["Enlace a rt_wan01 ge-0/0/1", "rt_wan01", "ge-0/0/1"],
  ["TRUNK TO dist-sw02", "dist-sw02", undefined],
  ["[to:core01]", "core01", undefined],
  ["Conexión con sw03-piso2, puerto Gi0/1", "sw03-piso2", undefined],
  ["uplink-to-agg01", "agg01", undefined],
  ["link to 192.0.2.9", "192.0.2.9", undefined],
];
for (const [desc, host, port] of yes) assert.deepEqual(T.parseDescriptionHint(desc), { host, port }, desc);
const no = [
  "Access to printers",
  "VLAN 10 a usuarios",
  "Puerto a impresora 3",
  "to be removed",
  "Reservado",
  "Uplink",
  "Trunk Gi1/0/1",
  "Enlace a ISP",
  "conectado a la red",
  "Hacia 2do piso",
  "Trunk a VLAN10",
  "to wi-fi users",
  "Hacia X",
  "",
];
for (const desc of no) assert.equal(T.parseDescriptionHint(desc), null, desc);

// Sugerencias: solo puertos sin enlace, nunca se dibujan solas, y se confirman como "descripción".
const s0 = {
  nodes: [
    {
      id: "acc-sw01", name: "acc-sw01", explored: true, x: 1, y: 1,
      ports: {
        "gi1/0/48": { desc: "UPLINK a dist-sw01 Gi1/0/1" },
        "gi1/0/47": { desc: "to core-sw09" },
        "gi1/0/1": { desc: "to dist-sw01 Gi1/0/2" },
        "gi1/0/2": { desc: "Access to printers" },
      },
    },
    { id: "dist-sw01", name: "dist-sw01", explored: true, x: 2, y: 2 },
  ],
  links: [{ a: "acc-sw01", aPort: "Gi1/0/1", b: "dist-sw01", bPort: "Gi1/0/2", proto: "CDP" }],
};
const sug = T.collectSuggestions(s0, { descriptions: true });
assert.deepEqual(
  sug.map((s) => [s.aPort, s.target, s.bPort, s.confidence, s.source, s.proto]),
  [
    ["Gi1/0/48", "dist-sw01", "Gi1/0/1", "alta", "descriptions", "descripción"],
    ["Gi1/0/47", "core-sw09", "", "baja", "descriptions", "descripción"],
  ],
);
assert.equal(s0.links.length, 1, "no dibuja nada por sí sola");
assert.deepEqual(T.collectSuggestions(s0, {}), [], "fuente apagada: sin sugerencias");
assert.deepEqual(T.collectSuggestions(s0, { descriptions: true }, new Set([sug[0].id])).length, 1, "descartadas");
let acc = T.acceptSuggestion(s0, sug[1]);
assert.ok(acc.topo, acc.error);
const nn = acc.topo.nodes.find((n) => n.id === "core-sw09");
assert.ok(nn?.manual, "el equipo nuevo queda como manual");
assert.equal(acc.topo.links.at(-1).proto, "descripción");
acc = T.acceptSuggestion(acc.topo, sug[0]);
assert.equal(T.collectSuggestions(acc.topo, { descriptions: true }).length, 0, "confirmadas ya no se sugieren");

// ---------- Exportaciones con elementos manuales (escape) ----------

let e = { nodes: [], links: [] };
e = T.addManualNode(e, { name: '=cmd|"/c calc"!A1<b>&', ip: "192.0.2.60", platform: "<script>" }).topo;
e = T.addManualNode(e, { name: "end" }).topo;
const evil = e.nodes[0].id;
e = T.addManualLink(e, { a: evil, aPort: "Gi1/0/1", b: "end", bPort: "<x>" }).topo;
e.links.push({ a: evil, aPort: "Gi1/0/2", b: "end", bPort: "", proto: "BGP", logical: true });
const csv = T.toCsv(e);
assert.match(csv, /^"'=cmd\|""\/c calc""!A1<b>&"/m, "CSV: fórmula neutralizada y comillas duplicadas");
assert.match(csv, /"manual"$/m);
assert.match(csv, /"BGP lógica"$/m);
const mer = T.toMermaid(e);
assert.ok(!/<b>|<x>|"\/c/.test(mer), "Mermaid sin HTML ni comillas que cierren la etiqueta");
assert.match(mer, /n0 -\.-\|"Gi1\/0\/1 ↔ #lt;x#gt; \(manual\)"\| n1/);
assert.match(mer, /^ {2}n1\["end"\]$/m, "id por posición: 'end' no rompe la sintaxis");
const dio = T.toDrawio(e);
assert.ok(!/<b>|<x>|<script>/.test(dio), "draw.io escapado");
assert.match(dio, /value="=cmd\|&quot;\/c calc&quot;!A1&lt;b&gt;&amp;&#xa;192\.0\.2\.60"/);
assert.match(dio, /dashed=1;dashPattern=1\.5 4;/);
const svg = T.toSvg(e);
assert.ok(!/<b>|<x>|<script>/.test(svg), "SVG escapado");
assert.match(svg, /&lt;b&gt;&amp;/);
assert.match(svg, /Sesión BGP lógica/, "leyenda en el SVG exportado");
assert.match(svg, /stroke-dasharray="4 3"/, "equipo manual con borde punteado");

// ---------- Riesgo: todo comando que envía la herramienta es de consulta ----------

const sent = new Set([
  ...Object.values(T.NEIGHBOR_COMMANDS).flat(),
  ...Object.values(T.PORT_COMMANDS).flat(),
  ...Object.values(T.ROUTING_COMMANDS).flat(),
  ...Object.values(T.ADDRESS_COMMANDS).filter(Boolean),
  ...Object.values(T.FALLBACK_COMMANDS),
  T.junosDetailCommand("ge-0/0/0"),
]);
for (const cmd of sent) assert.equal(computeRisk(cmd), "read", cmd);
for (const cmd of ["show ip ospf neighbor", "show ip eigrp neighbors", "show ip bgp summary", "show bgp ipv4 unicast summary", "display ospf peer brief", "show ospf neighbor", "show ip interface brief", "display ip interface brief", "show interfaces terse"])
  assert.ok(sent.has(cmd), `falta ${cmd}`);

// ---------- Fuzz: salidas maliciosas o aleatorias de un equipo (no confiable) ----------

/**
 * Falla si fn tarda más de `ms` (backtracking catastrófico o crecimiento cuadrático). Sobre el
 * límite se vuelve a medir y, con la máquina cargada, el límite se duplica (timing.mjs).
 */
const fast = (label, ms, fn) => fastEnough(label, ms, fn);
const BIG = 100_000;
fast("promptName con '[' sin cierre", 300, () => T.promptName("[" + "a".repeat(BIG)));
fast("BGP con muchos espacios", 300, () => T.parseBgpSummary(`192.0.2.1 4 65000 1 1 1 0 0 00:01 a${" ".repeat(BIG)}x`));
fast("etherchannel con paréntesis anidables", 300, () => T.parsePortInfo([`Po1(SU)\n  ${"a(b)".repeat(40)}!`]));
fast("Huawei descripción con dígitos", 300, () => T.parsePortInfo([`Interface PHY Protocol Description\n${"1".repeat(BIG)}x`]));
fast("Huawei brief con dígitos", 300, () => T.parsePortInfo([`Interface PHY Protocol InUti\n${"1".repeat(BIG)}x`]));
fast("Eth-Trunk con Ethernet repetido", 300, () => T.parsePortInfo([`Eth-Trunk1's state information\n${"Ethernet".repeat(BIG / 4)}1x`]));
fast("LLDP con encabezados repetidos", 300, () => T.parseCiscoLldp(`Local Intf: Gi1\nPort id: x\nSystem Name: a\n${"Management Addresses:\n".repeat(BIG / 10)}`));
fast("FortiOS con muchas filas sin chassis", 300, () => T.parseFortiLldp([`${"1 port 'a' x port 'b'\n".repeat(BIG / 20)}${"z".repeat(BIG)}`]));
fast("descripción larga", 50, () => T.parseDescriptionHint(`uplink to ${"a-".repeat(115)}`));
for (const [label, out] of [
  ["OSPF", `192.0.2.1 1 FULL/${" ".repeat(BIG)}x`],
  ["EIGRP", `EIGRP\n${"1 ".repeat(BIG)}`],
  ["Junos OSPF", `192.0.2.1 ${"a ".repeat(BIG)}`],
  ["Huawei OSPF", `Area Id Interface Neighbor id State\n0.0.0.0 ${"a ".repeat(BIG)}`],
  ["direcciones", `1 ${"192.0.2.1".repeat(BIG / 9)}`],
])
  fast(label, 300, () => T.parseRoutingNeighbors([{ cmd: "show ip ospf neighbor", out }, { cmd: "show ip eigrp neighbors", out }, { cmd: "show ospf neighbor", out }, { cmd: "display ospf peer brief", out }]));

// Miles de vecinos: la fusión no es cuadrática y se acota la cantidad.
const many = Array.from({ length: 5000 }, (_, i) => ({ name: `sw${i}`, localPort: `Gi1/0/${i}`, remotePort: "Gi0/1", ip: `10.${(i >> 8) & 255}.${i & 255}.1`, proto: "CDP" }));
const big = fast("fusión de 5000 vecinos CDP", 2000, () => T.mergeNeighbors({ nodes: [], links: [] }, { name: "core" }, many));
assert.equal(big.links.length, T.MAX_NEIGHBORS, "vecinos acotados por equipo");
const peers = many.map((n) => ({ ...n, name: n.ip, remotePort: "", addrs: [n.ip], proto: "OSPF", byAddr: true }));
fast("fusión de 5000 vecinos OSPF", 2000, () => T.mergeNeighbors(big, { name: "core2" }, peers));

// Prototype pollution: una interfaz llamada "__proto__" no toca Object.prototype.
T.parsePortInfo([
  "Port      Name               Status       Vlan       Duplex  Speed Type\n__proto__ evil               connected    1          a-full  a-1000 x\n",
  "Interface PHY Protocol Description\n__proto__1 up up x\n",
  "Interface Admin Link Description\n__proto__ up up evil\n",
]);
T.mergeNeighbors({ nodes: [], links: [] }, { name: "x", ports: JSON.parse('{"__proto__":{"status":"evil"}}') }, []);
assert.equal({}.status, undefined, "Object.prototype intacto");
assert.equal({}.desc, undefined, "Object.prototype intacto");

// Junos: la interfaz del equipo solo vuelve en un comando si es un nombre válido.
for (const bad of ["ge-0/0/0|save:/tmp/x", "ge-0/0/0 | save x", "ge-0/0/0;request", "ge-0/0/0\u0015reload", "-x", "", "a".repeat(80), "ge-0/0/0\nrequest system reboot"])
  assert.equal(T.junosDetailCommand(bad), null, JSON.stringify(bad));
for (const ok of ["ge-0/0/0", "ge-0/0/0.0", "xe-1/2/3:1", "et-0/0/49", "me0", "fxp0"]) {
  const cmd = T.junosDetailCommand(ok);
  assert.equal(cmd, `show lldp neighbors interface ${ok}`);
  assert.equal(computeRisk(cmd), "read", cmd);
}

// IP para "Conectar y seguir la ruta": solo IPv4/IPv6 literales.
for (const bad of ["-oProxyCommand=sh", "-p22", "192.0.2.1 -oX", "192.0.2.1;id", "host.example", "999.1.1.1", "01.2.3.4", "1.2.3", "[::1]", "::1;rm", "::1 -o", "", " "])
  assert.ok(!T.isIpv4(bad) && !T.isIpv6(bad), JSON.stringify(bad));
for (const ok of ["192.0.2.1", "2001:db8::1", "::ffff:192.0.2.1"]) assert.ok(T.isIpv4(ok) || T.isIpv6(ok), ok);

// FortiOS: la IP de gestión debe ser una IPv4 exacta y el nombre no abarca líneas.
const fz = T.parseFortiLldp(["1 port 'wan1' 5 mac x chassis y port 'p1' system 'a\nreload\nb'\nlldprx.neighbor.1.address.1.addr: -oProxyCommand=x;192.0.2.1"]);
assert.equal(fz[0].ip, undefined, "IP con texto alrededor rechazada");
assert.ok(!/\n/.test(fz[0].name), "nombre de una sola línea");

// Lo que informa el equipo se guarda sin control ni dirección y con largo acotado.
const dirty = T.mergeNeighbors({ nodes: [], links: [] }, { name: "core\u0007", ports: { "gi1/0/1": { desc: "to\u202e x\u0000", status: "up" } } }, [
  { name: "sw\u202e1\u0000", localPort: "Gi1/0/1\u001b[31m", remotePort: "Gi0/1", ip: "-oProxyCommand=x", platform: "p\u2066".repeat(300), proto: "CDP" },
]);
const allText = JSON.stringify(dirty);
assert.ok(!/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/.test(JSON.parse(allText).nodes.map((n) => n.name + (n.platform ?? "") + JSON.stringify(n.ports ?? {})).join("") + dirty.links.map((l) => l.aPort + l.bPort).join("")), "sin control ni bidi");
assert.equal(dirty.nodes.find((n) => n.id === "sw1")?.ip, undefined, "IP de vecino no válida descartada");
assert.ok(dirty.nodes.every((n) => (n.platform ?? "").length <= 255), "plataforma acotada");

// Aleatorio: entradas con caracteres peligrosos no rompen parsers ni exportaciones.
let seed = 1234567;
const rnd = (n) => ((seed = (seed * 1103515245 + 12345) % 2 ** 31), seed % n);
const ALPHA = ["a", "Z", "0", "9", ".", "-", "/", ":", " ", "\t", "\n", "\r", "(", ")", "[", "]", "<", ">", "&", '"', "'", "#", "|", "=", "+", "@", "%", "`", "$", ";", "\\", "\u0000", "\u001b", "\u0085", "\u200b", "\u202e", "\u2066", "\ufeff", "é", "→", "Gi1/0/1", "192.0.2.1", "FULL", "port '", "system '", "Device ID: ", "Interface: ", ",", "Port ID (outgoing port): ", "-----\n", "EIGRP", " 4 65000 ", "__proto__", "#60;", "]]>", "<!--", "{{", "}}"];
const junk = (len) => Array.from({ length: len }, () => ALPHA[rnd(ALPHA.length)]).join("");
const CTRL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/;
for (let i = 0; i < 300; i++) {
  const outs = [junk(rnd(400)), junk(rnd(400)), junk(rnd(400))];
  const nbs = fast(`fuzz ${i} parsers`, 200, () => [
    ...T.parseNeighbors("cisco", outs),
    ...T.parseNeighbors("huawei", outs),
    ...T.parseNeighbors("juniper", outs),
    ...T.parseNeighbors("fortinet", outs),
    ...T.parseRoutingNeighbors(outs.map((out, j) => ({ cmd: T.ROUTING_COMMANDS.cisco[j], out }))).neighbors,
  ]);
  T.parsePortInfo(outs);
  T.parseOwnAddresses(outs);
  T.promptName(outs[0]);
  // Vecinos inventados directamente, además de los que salgan de los parsers.
  const forged = Array.from({ length: 5 }, () => ({ name: junk(1 + rnd(20)), localPort: junk(rnd(10)), remotePort: junk(rnd(10)), ip: junk(rnd(10)), platform: junk(rnd(30)), proto: "LLDP" }));
  const t = T.mergeNeighbors({ nodes: [], links: [] }, { name: junk(1 + rnd(12)), ports: T.parsePortInfo(outs) }, [...nbs, ...forged]);
  for (const n of t.nodes) {
    assert.ok(!CTRL.test(n.name) && !CTRL.test(n.platform ?? ""), `fuzz ${i}: control en ${JSON.stringify(n.name)}`);
    assert.ok(!n.ip || T.isIpv4(n.ip) || T.isIpv6(n.ip), `fuzz ${i}: IP ${JSON.stringify(n.ip)}`);
  }
  for (const l of t.links) assert.ok(!CTRL.test(l.aPort + l.bPort), `fuzz ${i}: control en puertos`);
  T.collectSuggestions(t, { descriptions: true, routing: true });
  // SVG y draw.io: XML bien formado (sin etiquetas ni entidades del equipo, sin caracteres inválidos).
  for (const xml of [T.toSvg(t), T.toDrawio(t)]) {
    assert.ok(!CTRL.test(xml), `fuzz ${i}: carácter inválido en XML`);
    const tags = xml.match(/<\/?[a-zA-Z][^>]*>/g) ?? [];
    assert.ok(tags.every((tag) => /^<\/?(svg|rect|path|text|line|mxfile|diagram|mxGraphModel|root|mxCell|mxGeometry|mxPoint)\b/.test(tag)), `fuzz ${i}: etiqueta inesperada`);
    assert.ok(!/&(?!amp;|lt;|gt;|quot;|#xa;)/.test(xml), `fuzz ${i}: & sin escapar`);
  }
  // Mermaid: una línea por equipo y por enlace (ningún dato abre otra línea o directiva).
  const mm = T.toMermaid(t);
  assert.equal(mm.split("\n").length, 1 + t.nodes.length + t.links.length, `fuzz ${i}: líneas Mermaid`);
  assert.ok(!/<(?!br\/>)|>(?<!<br\/>)|#(?!lt;|gt;|35;)/.test(mm.replace(/^graph TD$/m, "").replace(/ -\.?-+\|| ---\|/g, "").replace(/\| n\d+$/gm, "")), `fuzz ${i}: Mermaid sin < > ni entidades del equipo`);
  // CSV: ninguna celda empieza con un carácter de fórmula.
  for (const cell of T.toCsv(t).split("\n").slice(1).join(",").match(/"(?:[^"]|"")*"/g) ?? [])
    assert.ok(!/^"[=@\t\r]/.test(cell) && !/^"[+-](?!(\d+(\.\d+)?)?"$)/.test(cell), `fuzz ${i}: celda ${cell}`);
  // Copiar ruta: texto sin control ni saltos dentro de un salto.
  const ids = t.nodes.map((n) => n.id);
  const p = T.shortestPath(t, ids[0], ids.at(-1));
  if (p) assert.equal(T.pathToText(t, p).split("\n").length, p.nodes.length, `fuzz ${i}: ruta`);
}

// Mermaid: una entidad numérica del equipo no se decodifica a "<".
assert.match(T.toMermaid({ nodes: [{ id: "a", name: "#60;img src=x#62;", explored: true, x: 0, y: 0 }], links: [] }), /#35;60;img src=x#35;62;/);

// Fuentes: apagadas o con valores que no son true, no hay sugerencias ni consultas de ruteo.
for (const s of [undefined, {}, { routing: false }, { routing: "true" }, { routing: 1 }]) assert.equal(T.sourceOn(s, "routing"), false, JSON.stringify(s));
assert.deepEqual(T.collectSuggestions(s0, { descriptions: "true" }), [], "solo true habilita");
{
// ---------- Sugerencias por MAC/fabricante (OUI) ----------

const O = await import("../../src/lib/oui.ts");
const { lookupOui } = O;

// Comandos de la fuente: todos de consulta, y Fortinet sin comandos (no verificado).
const macCmds = Object.values(T.MAC_COMMANDS).flat();
assert.deepEqual(macCmds.sort(), ["display arp", "display mac-address", "show arp no-resolve", "show ethernet-switching table", "show ip arp", "show mac address-table"].sort());
for (const cmd of macCmds) assert.equal(computeRisk(cmd), "read", cmd);
assert.deepEqual(T.MAC_COMMANDS.fortinet, []);

// Datos OUI: compactos, con fecha de la copia del registro y solo fabricantes curados.
const { statSync } = await import("node:fs");
const ouiBytes = statSync(new URL("../../src/lib/ouiData.ts", import.meta.url)).size;
assert.ok(ouiBytes < 60 * 1024, `ouiData.ts pesa ${ouiBytes} bytes`);
assert.match(O.OUI_SNAPSHOT, /^\d{4}-\d{2}-\d{2}$/);
assert.deepEqual(lookupOui("00:00:0c:12:34:56"), { vendor: "Cisco", kind: "net" });
assert.deepEqual(lookupOui("00e0-fc12-3456"), { vendor: "Huawei", kind: "net" });
assert.deepEqual(lookupOui("0050.56aa.0001"), { vendor: "VMware", kind: "host" });
assert.deepEqual(lookupOui("001b.2100.0001"), { vendor: "Intel", kind: "host" });
assert.equal(lookupOui("0000.5e00.0101"), undefined, "IANA (VRRP) no es un fabricante");
assert.equal(lookupOui("zz"), undefined);

// MAC: formato, multicast/broadcast y bit de administración local (0x02 del primer octeto).
assert.equal(T.normMac("00:E0:FC:12:34:56"), "00e0.fc12.3456");
assert.equal(T.normMac("00e0-fc12-3456"), "00e0.fc12.3456");
assert.equal(T.normMac("00e0.fc12.345"), null);
assert.ok(T.isMulticastMac("0100.5e00.0001") && T.isMulticastMac("ffff.ffff.ffff") && T.isMulticastMac("3333.0000.0001"));
assert.ok(!T.isMulticastMac("00e0.fc12.3456"));
for (const m of ["0223.e957.6a3a", "5254.0012.3456", "da:a1:19:00:00:01", "x2:00".replace("x", "f") + ":00:00:00:01"]) assert.ok(T.isLocalMac(m), m);
for (const m of ["00e0.fc12.3456", "0000.0c07.ac0a", "3c8a.b000.0001", "f8bc.1200.0001"]) assert.ok(!T.isLocalMac(m), m);

// HSRP v1/v2 y VRRP IPv4/IPv6 (RFC 5798, sección 7.3).
assert.equal(T.fhrpOf("0000.0c07.ac0a"), "HSRP v1 grupo 10");
assert.equal(T.fhrpOf("00:00:0c:9f:f0:14"), "HSRP v2 grupo 20");
assert.equal(T.fhrpOf("0000.0c9f.ffff"), "HSRP v2 grupo 4095");
assert.equal(T.fhrpOf("0000-5e00-0105"), "VRRP grupo 5");
assert.equal(T.fhrpOf("0000.5e00.0201"), "VRRP IPv6 grupo 1");
assert.equal(T.fhrpOf("0000.0c07.ad00"), undefined);
assert.equal(T.fhrpOf("0000.0c12.3456"), undefined);
assert.equal(T.fhrpOf("0000.5e00.0301"), undefined);

// Cisco IOS/IOS-XE: entradas CPU, SVI propia (Vl10) y multicast fuera.
const iosMac = `acc-sw01#show mac address-table
          Mac Address Table
-------------------------------------------

Vlan    Mac Address       Type        Ports
----    -----------       --------    -----
 All    0100.0ccc.cccc    STATIC      CPU
 All    0180.c200.0000    STATIC      CPU
 All    ffff.ffff.ffff    STATIC      CPU
  10    706b.b929.f751    STATIC      Vl10
  10    0011.2233.4455    DYNAMIC     Gi1/0/1
  10    0000.0c07.ac0a    DYNAMIC     Gi1/0/48
  10    0000.0c9f.f014    DYNAMIC     Gi1/0/47
  10    00e0.fc12.3456    DYNAMIC     Gi1/0/10
  10    5254.0012.3456    DYNAMIC     Gi1/0/11
  10    0050.56aa.0001    DYNAMIC     Gi1/0/12
  10    0050.56aa.0002    DYNAMIC     Gi1/0/12
  20    3c8a.b000.0001    DYNAMIC     Gi1/0/13
  20    001b.2100.0013    DYNAMIC     Gi1/0/13
  20    001b.2100.0001    DYNAMIC     Gi1/0/20
  20    3c07.5400.0001    DYNAMIC     Gi1/0/20
  20    f8bc.1200.0001    DYNAMIC     Gi1/0/20
  20    0050.56aa.0003    DYNAMIC     Gi1/0/20
  20    0100.5e00.0001    DYNAMIC     Gi1/0/5
  20    00e0.fc00.0abc    DYNAMIC     Po1
Total Mac Addresses for this criterion: 19
acc-sw01#`;
const iosRows = T.parseMacTable(iosMac);
assert.ok(!iosRows.some((r) => /cpu|vl10/i.test(r.port)), "sin CPU ni SVI propia");
assert.deepEqual(iosRows[0], { mac: "0011.2233.4455", port: "Gi1/0/1", vlan: "10" });
assert.equal(iosRows.length, 15);
const iosArp = `acc-sw01#show ip arp
Protocol  Address          Age (min)  Hardware Addr   Type   Interface
Internet  192.0.2.1               -   706b.b929.f751  ARPA   Vlan10
Internet  192.0.2.254             3   0000.0c07.ac0a  ARPA   Vlan10
Internet  192.0.2.30             12   00e0.fc12.3456  ARPA   Vlan10
Internet  192.0.2.40              0   Incomplete      ARPA
acc-sw01#`;
assert.deepEqual(T.parseArpTable(iosArp), [
  { mac: "706b.b929.f751", ip: "192.0.2.1", self: true },
  { mac: "0000.0c07.ac0a", ip: "192.0.2.254", self: false },
  { mac: "00e0.fc12.3456", ip: "192.0.2.30", self: false },
]);

// NX-OS: G (Gateway MAC), sup-eth1(R) y vPC Peer-Link fuera.
const nxMac = `Legend:
        * - primary entry, G - Gateway MAC, (R) - Routed MAC, O - Overlay MAC
        age - seconds since last seen,+ - primary entry using vPC Peer-Link,
        (T) - True, (F) - False, C - ControlPlane MAC, ~ - vsan
   VLAN     MAC Address      Type      age     Secure NTFY Ports
---------+-----------------+--------+---------+------+----+------------------
*  150     0223.e957.6a3a   dynamic  0         F      F    Po21
G  150     5254.0011.2233   static   -         F      F    sup-eth1(R)
+  150     0000.0c9f.f096   dynamic  0         F      F    vPC Peer-Link
*  150     00e0.fc00.0001   dynamic  0         F      F    Eth1/5
`;
assert.deepEqual(T.parseMacTable(nxMac), [
  { mac: "0223.e957.6a3a", port: "Po21", vlan: "150" },
  { mac: "00e0.fc00.0001", port: "Eth1/5", vlan: "150" },
]);
const nxArp = `IP ARP Table for context default
Total number of entries: 1
Address         Age       MAC Address     Interface       Flags
192.0.2.100     00:01:07  0223.e957.6a3a  Vlan150
`;
assert.deepEqual(T.parseArpTable(nxArp), [{ mac: "0223.e957.6a3a", ip: "192.0.2.100", self: false }]);

// Huawei VRP: blackhole fuera; en ARP, TYPE "I" es la propia interfaz.
const hwMac = `<agg-hw01>display mac-address
-------------------------------------------------------------------------------
MAC Address          VLAN/VSI/BD                 Learned-From        Type
-------------------------------------------------------------------------------
0000-5e00-0101       100/-/-                     GE0/0/1             dynamic
0019-e200-0001       100/-/-                     GE0/0/2             dynamic
00e0-fc99-0001       100/-/-                     GE0/0/9             static
0000-0000-0001       200/-/-                     GE0/0/3             blackhole
-------------------------------------------------------------------------------
Total items displayed = 4
<agg-hw01>`;
assert.deepEqual(T.parseMacTable(hwMac), [
  { mac: "0000.5e00.0101", port: "GE0/0/1", vlan: "100" },
  { mac: "0019.e200.0001", port: "GE0/0/2", vlan: "100" },
  { mac: "00e0.fc99.0001", port: "GE0/0/9", vlan: "100" },
]);
const hwArp = `<agg-hw01>display arp
IP ADDRESS      MAC ADDRESS     EXPIRE(M) TYPE        INTERFACE   VPN-INSTANCE
                                          VLAN/CEVLAN(SIP/DIP)
------------------------------------------------------------------------------
192.0.2.30      00e0-fc99-0001            I -         Vlanif100
192.0.2.1       0000-5e00-0101  20        D-0         GE0/0/1
                                          100/-
192.0.2.20      0019-e200-0001  19        D-0         GE0/0/2
                                          100/-
------------------------------------------------------------------------------
Total:3         Dynamic:2       Static:0     Interface:1
<agg-hw01>`;
assert.deepEqual(T.parseArpTable(hwArp).map((a) => [a.ip, a.self]), [["192.0.2.30", true], ["192.0.2.1", false], ["192.0.2.20", false]]);
const hwPorts = T.buildMacPorts([{ cmd: "display mac-address", out: hwMac }, { cmd: "display arp", out: hwArp }], lookupOui);
assert.deepEqual(Object.keys(hwPorts).sort(), ["gi0/0/1", "gi0/0/2"], "la MAC propia (ARP tipo I) no cuenta aunque figure en la tabla");
assert.equal(hwPorts["gi0/0/1"].macs[0].fhrp, "VRRP grupo 1");
assert.equal(hwPorts["gi0/0/1"].macs[0].ip, "192.0.2.1");
assert.deepEqual(T.classifyMacPort(hwPorts["gi0/0/2"]), { confidence: "media", reason: "Posible equipo de red (Juniper)", rep: hwPorts["gi0/0/2"].macs[0] });

// Junos: formato clásico (Router, All-members) y ELS (vtep fuera); ARP con IRB.
const junosMac = `user@acc-ex01> show ethernet-switching table
Ethernet-switching table: 5 entries, 2 learned
  VLAN              MAC address       Type         Age Interfaces
  v100              *                 Flood          - All-members
  v100              00:19:e2:50:7d:e0 Static         - Router
  v100              00:00:5e:00:01:09 Learn          0 ge-0/0/44.0
  v100              00:50:56:aa:00:03 Learn          0 ge-0/0/45.0
`;
assert.deepEqual(T.parseMacTable(junosMac), [
  { mac: "0000.5e00.0109", port: "ge-0/0/44.0" },
  { mac: "0050.56aa.0003", port: "ge-0/0/45.0" },
]);
const junosEls = `MAC flags (S - static MAC, D - dynamic MAC, L - locally learned, P - Persistent static
           SE - statistics enabled, NM - non configured MAC, R - remote PE MAC)
Ethernet switching table : 2 entries, 2 learned
Routing instance : default-switch
    Vlan                MAC                 MAC         Age    Logical
    name                address             flags              interface
    VLAN1                00:00:00:ff:ff:ff   D             -   vtep.12345
    VLAN1                3c:8a:b0:00:00:02   D         -       xe-0/0/0.0
`;
assert.deepEqual(T.parseMacTable(junosEls), [{ mac: "3c8a.b000.0002", port: "xe-0/0/0.0" }]);
const junosArp = `user@acc-ex01> show arp no-resolve
MAC Address       Address         Interface                Flags
00:00:5e:00:01:09 192.0.2.9       irb.100 [ge-0/0/44.0]    none
3c:8a:b0:00:00:02 192.0.2.12      xe-0/0/0.0               none
Total entries: 2
`;
assert.deepEqual(T.parseArpTable(junosArp), [
  { mac: "0000.5e00.0109", ip: "192.0.2.9", self: false },
  { mac: "3c8a.b000.0002", ip: "192.0.2.12", self: false },
]);
const jPorts = T.buildMacPorts([
  { cmd: "show ethernet-switching table", out: junosMac + junosEls },
  { cmd: "show arp no-resolve", out: junosArp },
], lookupOui);
assert.deepEqual(Object.entries(jPorts).map(([k, p]) => [k, p.port, p.total]), [
  ["ge-0/0/44", "ge-0/0/44", 1],
  ["ge-0/0/45", "ge-0/0/45", 1],
  ["xe-0/0/0", "xe-0/0/0", 1],
]);
assert.equal(jPorts["xe-0/0/0"].macs[0].ip, "192.0.2.12");
// Error del equipo (sin tabla de switching): sin puertos ni excepción.
assert.deepEqual(T.buildMacPorts([{ cmd: "show ethernet-switching table", out: "error: syntax error, expecting <command>: ethernet-switching" }], lookupOui), {});

// Cisco completo: agrupación por puerto, IP desde ARP y fabricante.
const iosPorts = T.buildMacPorts([{ cmd: "show mac address-table", out: iosMac }, { cmd: "show ip arp", out: iosArp }], lookupOui);
assert.ok(!iosPorts["gi1/0/5"], "multicast fuera");
assert.equal(iosPorts["gi1/0/12"].total, 2);
assert.equal(iosPorts["gi1/0/10"].macs[0].ip, "192.0.2.30");
assert.equal(iosPorts["gi1/0/48"].macs[0].ip, "192.0.2.254");
assert.equal(iosPorts["gi1/0/48"].macs[0].vendor, undefined, "la MAC HSRP no se atribuye a Cisco");
const verdict = (k) => {
  const v = T.classifyMacPort(iosPorts[k]);
  return v && [v.confidence, v.reason];
};
assert.deepEqual(verdict("gi1/0/48"), ["alta", "HSRP v1 grupo 10: gateway/router presente"]);
assert.deepEqual(verdict("gi1/0/47"), ["alta", "HSRP v2 grupo 20: gateway/router presente"]);
assert.deepEqual(verdict("gi1/0/10"), ["media", "Posible equipo de red (Huawei)"]);
assert.deepEqual(verdict("gi1/0/11"), ["baja", "MAC administrada localmente o aleatoria: no se puede presumir"]);
assert.equal(verdict("gi1/0/12"), null, "solo máquinas virtuales: sin sugerencia");
assert.deepEqual(verdict("gi1/0/13"), ["baja", "Posible equipo de red (Juniper) con 1 MAC más"]);
assert.deepEqual(verdict("gi1/0/20"), ["media", "4 MAC en el puerto: switch u otro equipo aguas abajo"]);
// Umbral: 3 MAC de PC no sugieren; la cuarta sí.
const hostPort = (n) => ({ port: "Gi1/0/30", total: n, macs: Array.from({ length: n }, (_, i) => ({ mac: `001b.2100.00${String(i).padStart(2, "0")}`, vendor: "Intel", kind: "host" })) });
assert.equal(T.MANY_MACS, 4);
assert.equal(T.classifyMacPort(hostPort(3)), null);
assert.equal(T.classifyMacPort(hostPort(T.MANY_MACS)).confidence, "media");
assert.deepEqual(T.macVendors(iosPorts["gi1/0/20"]), ["Intel", "Apple", "Dell", "VMware"]);

// Sugerencias: puertos con CDP (o el Port-channel de miembros con CDP) quedan fuera.
let mt = T.mergeNeighbors(
  { nodes: [], links: [] },
  { name: "acc-sw01", ip: "192.0.2.1", ports: { "gi1/0/49": { group: "Po1" } }, macs: iosPorts },
  [
    { name: "dist-sw01", localPort: "GigabitEthernet1/0/1", remotePort: "Gi1/0/24", proto: "CDP" },
    { name: "dist-sw02", localPort: "GigabitEthernet1/0/49", remotePort: "Gi1/0/24", proto: "LLDP" },
  ],
);
assert.ok(iosPorts["gi1/0/1"] && iosPorts["po1"], "la tabla sí trae Gi1/0/1 y Po1");
let ms = T.collectSuggestions(mt, { mac: true });
assert.deepEqual(
  ms.map((s) => [s.aPort, s.confidence, s.proto, s.source]).sort(),
  [
    ["Gi1/0/10", "media", "MAC/OUI", "mac"],
    ["Gi1/0/11", "baja", "MAC/OUI", "mac"],
    ["Gi1/0/13", "baja", "MAC/OUI", "mac"],
    ["Gi1/0/20", "media", "MAC/OUI", "mac"],
    ["Gi1/0/47", "alta", "MAC/OUI", "mac"],
    ["Gi1/0/48", "alta", "MAC/OUI", "mac"],
  ],
  "sin Gi1/0/1 (CDP), Po1 (miembro con LLDP) ni Gi1/0/12 (solo hosts)",
);
assert.deepEqual(T.collectSuggestions(mt, {}), [], "fuente apagada por defecto: sin sugerencias");
assert.equal(T.TOPO_SOURCES.find((s) => s.id === "mac")?.label, "Sugerencias por MAC/fabricante (OUI)");
assert.equal(mt.links.length, 2, "nunca se dibujan solas");
const hsrp = ms.find((s) => s.aPort === "Gi1/0/48");
assert.equal(hsrp.target, "Gateway HSRP 192.0.2.254");
assert.deepEqual(hsrp.detail, { vendors: ["HSRP"], macs: 1, ip: "192.0.2.254" });
const many = ms.find((s) => s.aPort === "Gi1/0/20");
assert.equal(many.target, "Aguas abajo de Gi1/0/20");
assert.equal(many.node.ip, undefined, "muchas MAC: el equipo sugerido no hereda la IP de un host");
assert.equal(ms.find((s) => s.aPort === "Gi1/0/11").target, "MAC local 5254.0012.3456");
// Confirmar: equipo nuevo (vendor + IP) con IP para seguir la ruta, y enlace MAC/OUI.
const hwSug = ms.find((s) => s.aPort === "Gi1/0/10");
assert.equal(hwSug.target, "Huawei 192.0.2.30");
let ma = T.acceptSuggestion(mt, hwSug);
assert.ok(ma.topo, ma.error);
const hwNode = ma.topo.nodes.find((n) => n.id === "mac-00e0.fc12.3456");
assert.ok(hwNode.manual && !hwNode.explored && hwNode.ip === "192.0.2.30", "nodo con IP: 'Conectar y seguir la ruta' disponible");
assert.equal(hwNode.name, "Huawei 192.0.2.30");
assert.deepEqual(ma.topo.links.at(-1), { a: "acc-sw01", aPort: "Gi1/0/10", b: "mac-00e0.fc12.3456", bPort: "", proto: "MAC/OUI" });
assert.ok(T.isUserProto("MAC/OUI"), "editable y borrable como los manuales");
assert.equal(T.collectSuggestions(ma.topo, { mac: true }).length, ms.length - 1, "confirmada ya no se sugiere");
// La misma MAC vista desde otro switch reutiliza el equipo.
ma = { topo: T.mergeNeighbors(ma.topo, { name: "acc-sw02", macs: { "gi0/1": { port: "Gi0/1", total: 1, macs: [iosPorts["gi1/0/10"].macs[0]] } } }, []) };
const again = T.collectSuggestions(ma.topo, { mac: true }).find((s) => s.a === "acc-sw02");
ma = T.acceptSuggestion(ma.topo, again);
assert.equal(ma.topo.nodes.filter((n) => n.id === "mac-00e0.fc12.3456").length, 1);
// Al explorar ese equipo (misma IP), se fusiona con su nombre real.
const explored = T.mergeNeighbors(ma.topo, { name: "agg-hw01", ip: "192.0.2.30" }, []);
assert.ok(!explored.nodes.some((n) => n.id === "mac-00e0.fc12.3456"), "absorbido por el equipo explorado");
assert.ok(explored.links.some((l) => l.proto === "MAC/OUI" && l.b === "agg-hw01"));
// Descartar.
assert.equal(T.collectSuggestions(mt, { mac: true }, new Set([hsrp.id])).length, ms.length - 1);

// Exportaciones: fabricante con caracteres especiales escapado; estilo propio y leyenda.
const evilLookup = (m) => (m.startsWith("00e0") ? { vendor: '=cmd|"<b>&', kind: "net" } : undefined);
const evilPorts = T.buildMacPorts([{ cmd: "show mac address-table", out: " 10    00e0.fc12.3456    DYNAMIC     Gi1/0/10" }, { cmd: "show ip arp", out: iosArp }], evilLookup);
let ev = T.mergeNeighbors({ nodes: [], links: [] }, { name: "acc-sw09", macs: evilPorts }, []);
const evs = T.collectSuggestions(ev, { mac: true });
assert.equal(evs[0].target, '=cmd|"<b>& 192.0.2.30');
ev = T.acceptSuggestion(ev, evs[0]).topo;
const evCsv = T.toCsv(ev);
assert.match(evCsv, /"'=cmd\|""<b>& 192\.0\.2\.30"/, "CSV: fórmula neutralizada y comillas duplicadas");
assert.match(evCsv, /"MAC\/OUI"$/m);
const evMer = T.toMermaid(ev);
assert.ok(!/<b>|"<|cmd\|"/.test(evMer), "Mermaid sin HTML ni comillas");
assert.match(evMer, /n1\["=cmd\|'#lt;b#gt;& 192\.0\.2\.30<br\/>192\.0\.2\.30"\]/);
assert.match(evMer, /n0 -\.-\|"Gi1\/0\/10 ↔ \? \(MAC\/OUI\)"\| n1/);
assert.match(evMer, /^ {2}linkStyle 0 stroke-dasharray:12 3 2 3 2 3$/m);
const evDio = T.toDrawio(ev);
assert.ok(!/<b>/.test(evDio), "draw.io escapado");
assert.match(evDio, /value="=cmd\|&quot;&lt;b&gt;&amp; 192\.0\.2\.30&#xa;192\.0\.2\.30"/);
assert.match(evDio, /dashed=1;dashPattern=12 3 2 3 2 3;/);
const evSvg = T.toSvg(ev);
assert.ok(!/<b>/.test(evSvg), "SVG escapado");
assert.match(evSvg, /=cmd\|&quot;&lt;b&gt;&amp; 192\.0\.2\.30/);
assert.match(evSvg, /stroke-dasharray="12 3 2 3 2 3"/);
assert.match(evSvg, />MAC\/OUI<\/text>/, "leyenda en el SVG exportado");
assert.ok(T.LINK_LEGEND.some(([t, s]) => t === "MAC/OUI" && T.linkDash(s) === "12 3 2 3 2 3"));
assert.equal(new Set(T.LINK_LEGEND.map(([, s]) => T.linkDash(s))).size, T.LINK_LEGEND.length, "cada estilo es distinto");
}

{
// ---------- Descubrimiento por SNMP: OIDs permitidos y varbinds sintéticos ----------

const S = await import("../../src/lib/topoSnmp.ts");
const R = await import("../../src/lib/topoTraffic.ts");
const { lookupOui } = await import("../../src/lib/oui.ts");
const { readFileSync } = await import("node:fs");

// La lista del backend (snmp.rs) y la del frontend son la misma, y todo lo que se pide está en ella.
const rust = readFileSync(new URL("../../src-tauri/src/snmp.rs", import.meta.url), "utf8");
const rustList = (name) => {
  const body = rust.slice(rust.indexOf(`pub const ${name}:`), rust.indexOf("];", rust.indexOf(`pub const ${name}:`)));
  return [...body.matchAll(/\("([\d.]+)", "\w+"\)/g)].map((m) => m[1]).sort();
};
assert.deepEqual(rustList("TOPO_WALK_ROOTS"), [...S.WALK_ALLOWED].sort(), "WALK: snmp.rs = topoSnmp.ts");
assert.deepEqual(rustList("TOPO_GET_COLUMNS"), [...S.GET_COLUMNS].sort(), "GET columnas: snmp.rs = topoSnmp.ts");
assert.deepEqual(rustList("TOPO_GET_SCALARS"), [...S.GET_SCALARS].sort(), "GET escalares: snmp.rs = topoSnmp.ts");
const rustVlan = () => {
  const at = rust.indexOf("pub const TOPO_VLAN_WALKS:");
  return [...rust.slice(at, rust.indexOf("];", at)).matchAll(/"([\d.]+)"/g)].map((m) => m[1]).sort();
};
for (const routing of [false, true])
  for (const mac of [false, true])
    for (const ports of [false, true]) {
      const plan = S.snmpDiscoveryPlan({ routing, mac, ports });
      for (const w of plan.walks) assert.ok(S.WALK_ALLOWED.includes(w), w);
      for (const g of plan.gets) assert.ok(S.GET_SCALARS.includes(g), g);
      assert.ok(plan.walks.length <= 40 && new Set(plan.walks).size === plan.walks.length);
      // LLDP y CDP siempre; ruteo y MAC solo con su fuente.
      assert.ok(plan.walks.includes(S.OID.lldpRemSysName) && plan.walks.includes(S.OID.cdpCacheDeviceId));
      assert.equal(plan.walks.includes(S.OID.ospfNbrState), routing);
      assert.equal(plan.walks.includes(S.OID.dot1dTpFdbPort), mac);
      assert.equal(plan.walks.includes(S.OID.ifAlias), ports);
    }
for (const w of S.ARP_FALLBACK) assert.ok(S.WALK_ALLOWED.includes(w));
for (const o of R.counterOids([1, 10101], true).concat(R.counterOids([3], false)))
  assert.ok(S.GET_COLUMNS.some((c) => o.startsWith(`${c}.`) && /^\d+$/.test(o.slice(c.length + 1))), o);
assert.equal(R.counterOids(Array.from({ length: 100 }, (_, i) => i + 1), true).length, 3 * R.MAX_TRAFFIC_IFACES, "tope de interfaces");
// OIDs verificados contra los MIB (valores literales de cada RFC / IEEE / Cisco).
assert.equal(S.OID.lldpRemSysName, "1.0.8802.1.1.2.1.4.1.1.9");
assert.equal(S.OID.lldpLocPortTable, "1.0.8802.1.1.2.1.3.7");
assert.equal(S.OID.cdpCacheDeviceId, "1.3.6.1.4.1.9.9.23.1.2.1.1.6");
assert.equal(S.OID.ospfNbrState, "1.3.6.1.2.1.14.10.1.6");
assert.equal(S.OID.bgpPeerState, "1.3.6.1.2.1.15.3.1.2");
assert.equal(S.OID.dot1dTpFdbPort, "1.3.6.1.2.1.17.4.3.1.2");
assert.equal(S.OID.dot1qTpFdbPort, "1.3.6.1.2.1.17.7.1.2.2.1.2");
assert.equal(S.OID.ipNetToPhysicalPhysAddress, "1.3.6.1.2.1.4.35.1.4");
assert.equal(S.OID.ifHCInOctets, "1.3.6.1.2.1.31.1.1.1.6");
assert.equal(S.OID.ifHighSpeed, "1.3.6.1.2.1.31.1.1.1.15");

// Varbinds sintéticos (IPs de documentación).
const hexOf = (s) => [...Buffer.from(s, "latin1")].map((b) => b.toString(16).padStart(2, "0").toUpperCase()).join("");
const str = (oid, v) => ({ oid, type: "OCTET STRING", value: v, hex: hexOf(v) });
const hex = (oid, h) => ({ oid, type: "Hex-STRING", value: h.match(/../g).join(":"), hex: h.toUpperCase() });
const int = (oid, v) => ({ oid, type: "INTEGER", value: String(v) });
const ip = (oid, v) => ({ oid, type: "IpAddress", value: v });
const read = (rows, gets = []) => {
  const walks = new Map();
  for (const r of rows) {
    const root = [...S.WALK_ALLOWED].filter((w) => r.oid.startsWith(`${w}.`)).sort((a, b) => b.length - a.length)[0];
    assert.ok(root, `sin raíz permitida: ${r.oid}`);
    walks.set(root, [...(walks.get(root) ?? []), r]);
  }
  return { gets, getError: null, walks: [...walks].map(([oid, rows]) => ({ oid, rows, truncated: false, timedOut: false, error: null })), ms: 120 };
};
const O_ = S.OID;
const L = "1.0.8802.1.1.2.1";
const rows = [
  // IF-MIB: ifName por ifIndex.
  str(`${O_.ifName}.3`, "Gi0/0"),
  str(`${O_.ifName}.10101`, "Te1/1/1"),
  str(`${O_.ifName}.10102`, "Gi1/0/2"),
  str(`${O_.ifName}.10146`, "Gi1/0/46"),
  str(`${O_.ifName}.10147`, "Gi1/0/47‮"),
  str(`${O_.ifDescr}.10101`, "TenGigabitEthernet1/1/1"),
  // dot1dBasePortTable: puerto del bridge -> ifIndex.
  int(`${O_.dot1dBasePortIfIndex}.2`, 10102),
  int(`${O_.dot1dBasePortIfIndex}.46`, 10146),
  int(`${O_.dot1dBasePortIfIndex}.5`, 10105),
  // lldpLocPortTable: puerto 5 con nombre (subtipo 5), puerto 6 con MAC y descripción.
  int(`${L}.3.7.1.2.5`, 5),
  str(`${L}.3.7.1.3.5`, "Gi1/0/1"),
  str(`${L}.3.7.1.4.5`, "GigabitEthernet1/0/1"),
  int(`${L}.3.7.1.2.6`, 3),
  hex(`${L}.3.7.1.3.6`, "001122334455"),
  str(`${L}.3.7.1.4.6`, "GigabitEthernet1/0/2"),
  // lldpRemTable: vecino en puerto 5 visto con dos TimeMark (se usa el más reciente).
  str(`${L}.4.1.1.9.0.5.1`, "viejo"),
  int(`${L}.4.1.1.6.0.5.1`, 5),
  str(`${L}.4.1.1.7.0.5.1`, "Gi9/9"),
  str(`${L}.4.1.1.9.1200.5.1`, "dist-sw01.example.com"),
  int(`${L}.4.1.1.6.1200.5.1`, 5),
  str(`${L}.4.1.1.7.1200.5.1`, "Gi1/0/48"),
  str(`${L}.4.1.1.10.1200.5.1`, "Cisco IOS XE Software\r\nCopyright"),
  // Vecino Junos sin nombre: chassis MAC, Port ID local numérico y descripción.
  int(`${L}.4.1.1.4.1300.6.3`, 4),
  hex(`${L}.4.1.1.5.1300.6.3`, "00e0fc123456"),
  int(`${L}.4.1.1.6.1300.6.3`, 7),
  str(`${L}.4.1.1.7.1300.6.3`, "523"),
  str(`${L}.4.1.1.8.1300.6.3`, "ge-0/0/1"),
  // Nombre con caracteres de dirección (spoofing) y muy largo: se limpian y acotan.
  str(`${L}.4.1.1.9.1400.5.2`, `ap‮-${"x".repeat(400)}`),
  int(`${L}.4.1.1.6.1400.5.2`, 5),
  str(`${L}.4.1.1.7.1400.5.2`, "eth0"),
  // lldpRemManAddrTable: índice con la dirección (IPv4 = familia 1, largo 4).
  int(`${L}.4.2.1.3.1200.5.1.1.4.192.0.2.11`, 2),
  int(`${L}.4.2.1.3.1300.6.3.2.16.32.1.13.184.0.0.0.0.0.0.0.0.0.0.0.1`, 2),
  // cdpCacheTable: dirección IP en 4 octetos (aunque parezca texto: 65.66.67.68 = "ABCD").
  str(`${O_.cdpCacheDeviceId}.10101.1`, "core-sw02(FOC1234X)"),
  str(`${O_.cdpCacheDevicePort}.10101.1`, "TenGigabitEthernet1/1/1"),
  str(`${O_.cdpCachePlatform}.10101.1`, "cisco C9500-24Y4C"),
  int(`${O_.cdpCacheAddressType}.10101.1`, 1),
  hex(`${O_.cdpCacheAddress}.10101.1`, "c0000202"),
  str(`${O_.cdpCacheDeviceId}.10147.2`, "fw-01"),
  str(`${O_.cdpCacheDevicePort}.10147.2`, "port1"),
  int(`${O_.cdpCacheAddressType}.10147.2`, 1),
  str(`${O_.cdpCacheAddress}.10147.2`, "ABCD"),
  // Sin interfaz local conocida: se descarta.
  str(`${O_.cdpCacheDeviceId}.999.1`, "fantasma"),
  str(`${O_.cdpCacheDevicePort}.999.1`, "Gi0/1"),
  // OSPF: FULL en Gi0/0 por subred; DOWN se omite.
  ip(`${O_.ospfNbrRtrId}.198.51.100.2.0`, "192.0.2.41"),
  int(`${O_.ospfNbrState}.198.51.100.2.0`, 8),
  ip(`${O_.ospfNbrRtrId}.198.51.100.6.0`, "192.0.2.42"),
  int(`${O_.ospfNbrState}.198.51.100.6.0`, 1),
  int(`${O_.ipAdEntIfIndex}.198.51.100.1`, 3),
  ip(`${O_.ipAdEntNetMask}.198.51.100.1`, "255.255.255.252"),
  int(`${O_.ipAdEntIfIndex}.192.0.2.1`, 10101),
  ip(`${O_.ipAdEntNetMask}.192.0.2.1`, "255.255.255.0"),
  int(`${O_.ipAdEntIfIndex}.127.0.0.1`, 1),
  ip(`${O_.ipAdEntNetMask}.127.0.0.1`, "255.0.0.0"),
  // BGP: eBGP directo (vecino OSPF), iBGP lógico y uno caído.
  int(`${O_.bgpPeerState}.198.51.100.2`, 6),
  int(`${O_.bgpPeerRemoteAs}.198.51.100.2`, 65001),
  int(`${O_.bgpPeerState}.192.0.2.50`, 6),
  int(`${O_.bgpPeerRemoteAs}.192.0.2.50`, 65000),
  int(`${O_.bgpPeerState}.203.0.113.9`, 3),
  int(`${O_.bgpPeerRemoteAs}.203.0.113.9`, 65009),
  // FDB: dot1d (índice = MAC) y dot1q (FID + MAC); self(4) se omite; puerto sin mapeo también.
  int(`${O_.dot1dTpFdbPort}.0.224.252.18.52.86`, 2),
  int(`${O_.dot1dTpFdbStatus}.0.224.252.18.52.86`, 3),
  int(`${O_.dot1dTpFdbPort}.0.17.34.51.68.85`, 2),
  int(`${O_.dot1dTpFdbStatus}.0.17.34.51.68.85`, 4),
  int(`${O_.dot1dTpFdbPort}.0.80.86.170.0.1`, 99),
  int(`${O_.dot1dTpFdbStatus}.0.80.86.170.0.1`, 3),
  int(`${O_.dot1qTpFdbPort}.10.0.0.12.7.172.10`, 46),
  int(`${O_.dot1qTpFdbStatus}.10.0.0.12.7.172.10`, 3),
  // ARP: IPv4 del gateway HSRP, una propia (local) y una inválida.
  hex(`${O_.ipNetToPhysicalPhysAddress}.3.1.4.192.0.2.254`, "00000c07ac0a"),
  int(`${O_.ipNetToPhysicalType}.3.1.4.192.0.2.254`, 3),
  hex(`${O_.ipNetToPhysicalPhysAddress}.3.1.4.192.0.2.30`, "00e0fc123456"),
  int(`${O_.ipNetToPhysicalType}.3.1.4.192.0.2.30`, 3),
  hex(`${O_.ipNetToPhysicalPhysAddress}.3.1.4.192.0.2.1`, "001122334455"),
  int(`${O_.ipNetToPhysicalType}.3.1.4.192.0.2.1`, 5),
  hex(`${O_.ipNetToPhysicalPhysAddress}.3.1.4.192.0.2.77`, "0011223344aa"),
  int(`${O_.ipNetToPhysicalType}.3.1.4.192.0.2.77`, 2),
  // Estado de puertos.
  int(`${O_.ifOperStatus}.10101`, 1),
  { oid: `${O_.ifHighSpeed}.10101`, type: "Gauge32", value: "10000" },
  str(`${O_.ifAlias}.10101`, "ISL core-sw02"),
  int(`${O_.ifOperStatus}.3`, 2),
];
const gets = [
  str(O_.sysName, "core-sw01.example.com"),
  ip(O_.ospfRouterId, "192.0.2.40"),
  int(O_.bgpLocalAs, 65000),
  ip(O_.bgpIdentifier, "192.0.2.40"),
];
const all = { routing: true, mac: true, ports: true };
const d = S.parseSnmpDiscovery(read(rows, gets), all);
assert.equal(d.name, "core-sw01.example.com");
assert.ok(!d.l2Empty);
const nb = (name) => d.neighbors.find((n) => n.name === name);
assert.deepEqual(
  [nb("dist-sw01.example.com").localPort, nb("dist-sw01.example.com").remotePort, nb("dist-sw01.example.com").ip, nb("dist-sw01.example.com").platform, nb("dist-sw01.example.com").proto],
  ["Gi1/0/1", "Gi1/0/48", "192.0.2.11", "Cisco IOS XE Software", "LLDP"],
);
assert.ok(!d.neighbors.some((n) => n.name === "viejo"), "TimeMark antiguo descartado");
assert.deepEqual([nb("00e0.fc12.3456").localPort, nb("00e0.fc12.3456").remotePort, nb("00e0.fc12.3456").ip], ["GigabitEthernet1/0/2", "ge-0/0/1", undefined], "chassis MAC, Port ID numérico -> descripción, IPv6 no es IPv4");
const evil = d.neighbors.find((n) => n.remotePort === "eth0");
assert.ok(!/[‮]/.test(evil.name) && evil.name.length <= 255, "nombre limpio y acotado");
assert.deepEqual([nb("core-sw02(FOC1234X)").localPort, nb("core-sw02(FOC1234X)").remotePort, nb("core-sw02(FOC1234X)").ip, nb("core-sw02(FOC1234X)").proto], ["Te1/1/1", "TenGigabitEthernet1/1/1", "192.0.2.2", "CDP"]);
assert.equal(nb("fw-01").ip, "65.66.67.68", "IP desde el hex aunque parezca texto");
assert.equal(nb("fw-01").localPort, "Gi1/0/47", "ifName con bidi limpiado");
assert.ok(!nb("fantasma"), "CDP sin interfaz local conocida");
// Ruteo: OSPF por subred, BGP directo por el vecino OSPF, iBGP lógico, caídos fuera.
const rt = (name, proto) => d.routing.find((n) => n.name === name && n.proto === proto);
assert.deepEqual([rt("192.0.2.41", "OSPF").localPort, rt("192.0.2.41", "OSPF").ip, rt("192.0.2.41", "OSPF").addrs], ["Gi0/0", "198.51.100.2", ["192.0.2.41", "198.51.100.2"]]);
assert.ok(!rt("192.0.2.42", "OSPF"), "OSPF down omitido");
assert.deepEqual([rt("198.51.100.2", "BGP").localPort, rt("198.51.100.2", "BGP").logical], ["Gi0/0", false]);
assert.deepEqual([rt("192.0.2.50", "BGP").localPort, rt("192.0.2.50", "BGP").logical], ["Te1/1/1", false], "por SNMP la subred propia ubica la interfaz");
assert.ok(!rt("203.0.113.9", "BGP"), "BGP no establecido omitido");
assert.deepEqual(d.addrs.sort(), ["192.0.2.1", "192.0.2.40", "198.51.100.1"], "sin 127/8; con router-id");
// Puertos.
assert.deepEqual(d.ports["te1/1/1"], { status: "up", speed: "10G", desc: "ISL core-sw02" });
assert.deepEqual(d.ports["gi0/0"], { status: "down" });
// FDB y ARP -> sugerencias MAC/OUI con HSRP y fabricante.
assert.deepEqual(d.macRows.map((r) => [r.mac, r.port]).sort(), [["0000.0c07.ac0a", "Gi1/0/46"], ["00e0.fc12.3456", "Gi1/0/2"]], "self y puerto sin mapeo fuera");
assert.deepEqual(
  d.arpRows.map((r) => [r.ip, r.self]).sort(),
  [["192.0.2.1", true], ["192.0.2.254", false], ["192.0.2.30", false]],
);
const macs = T.macPortsFromRows(d.macRows, d.arpRows, lookupOui);
assert.equal(macs["gi1/0/46"].macs[0].fhrp, "HSRP v1 grupo 10");
assert.equal(macs["gi1/0/46"].macs[0].ip, "192.0.2.254");
assert.equal(macs["gi1/0/2"].macs[0].vendor, "Huawei");
// ifIndex por interfaz para los contadores.
assert.equal(d.ifIndex.get("te1/1/1"), 10101);
assert.equal(d.ifIndex.get(T.canonPort("TenGigabitEthernet1/1/1")), 10101);
// Fusión con las estructuras de siempre: enlaces, nodos limpios y sugerencias.
let st = T.mergeNeighbors({ nodes: [], links: [] }, { name: d.name, ip: "192.0.2.1", ports: d.ports, addrs: d.addrs, macs }, [...d.neighbors, ...d.routing]);
assert.ok(st.nodes.find((n) => n.id === "core-sw01").explored);
assert.ok(st.links.some((l) => l.a === "core-sw01" && l.aPort === "Gi1/0/1" && l.b === "dist-sw01" && l.bPort === "Gi1/0/48" && l.proto === "LLDP"));
assert.ok(st.links.some((l) => l.b === "core-sw02" && l.aPort === "Te1/1/1" && l.proto === "CDP"));
assert.ok(st.links.some((l) => l.proto === "OSPF" && l.aPort === "Gi0/0"));
assert.ok(T.collectSuggestions(st, { mac: true }).some((s) => s.aPort === "Gi1/0/46" && s.confidence === "alta"));
assert.ok(st.nodes.every((n) => !/[‮\u0000-\u001f]/.test(n.name)));
// Tablas vacías: LLDP/CDP apagado; avisos de tiempo, tope y error.
const empty = S.parseSnmpDiscovery(read([str(`${O_.ifName}.1`, "Gi0/1")]), all);
assert.ok(empty.l2Empty && !empty.neighbors.length);
const partial = {
  gets: [], getError: "El equipo respondió noSuchName (varbind 1)",
  walks: [
    { oid: O_.lldpRemSysName, rows: [], truncated: false, timedOut: true, error: null },
    { oid: O_.dot1dTpFdbPort, rows: [], truncated: true, timedOut: false, error: null },
    { oid: O_.ospfNbrState, rows: [], truncated: false, timedOut: false, error: "Sin respuesta‮" },
  ],
  ms: 20000,
};
const notes = S.walkNotes(partial);
assert.match(notes[0], /^lldpRemSysName: tiempo agotado, resultado parcial/);
assert.match(notes[1], /^dot1dTpFdbPort: tope de 10\.000 filas/);
assert.equal(notes[2], "ospfNbrState: Sin respuesta", "error del backend limpio");
assert.match(notes[3], /^GET: /);
assert.ok(S.needsArpFallback(read([str(`${O_.ifName}.1`, "Gi0/1")])));
// ipNetToMediaTable (alternativa): índice ifIndex.IPv4.
const media = S.arpFromSnmp(read([hex(`${O_.ipNetToMediaPhysAddress}.3.192.0.2.9`, "001b21000001"), int(`${O_.ipNetToMediaType}.3.192.0.2.9`, 3), hex(`${O_.ipNetToMediaPhysAddress}.3.192.0.2.1`, "001122334455")]), new Set(["192.0.2.1"]));
assert.deepEqual(media, [{ mac: "001b.2100.0001", ip: "192.0.2.9", self: false }, { mac: "0011.2233.4455", ip: "192.0.2.1", self: true }]);
// Hostil: índices malformados, noSuchObject, "__proto__" como interfaz y miles de filas sin bloquear.
const hostile = read([
  str(`${O_.ifName}.7`, "__proto__"),
  { oid: `${O_.ifName}.8`, type: "noSuchInstance", value: "" },
  int(`${O_.ifOperStatus}.7`, 1),
  str(`${L}.4.1.1.9.1.2`, "corto"),
  int(`${O_.dot1dTpFdbPort}.1.2.3`, 1),
  int(`${O_.dot1dBasePortIfIndex}.1`, 7),
  int(`${O_.dot1dTpFdbPort}.0.17.34.51.68.86`, 1),
]);
const hd = S.parseSnmpDiscovery(hostile, all);
assert.equal(Object.getPrototypeOf(hd.ports), Object.prototype);
assert.equal({}.status, undefined, "Object.prototype intacto");
assert.equal(T.macPortsFromRows(hd.macRows, [], lookupOui).__proto__, Object.prototype);
assert.ok(!hd.neighbors.length, "índice LLDP malformado descartado");
// LLDP-V2-MIB (802.1AB-2009): OIDs del MIB oficial y alternativa solo si LLDP-MIB vino vacía.
assert.equal(O_.lldpV2RemSysName, "1.3.111.2.802.1.1.13.1.4.1.1.10");
assert.equal(O_.lldpV2RemChassisIdSubtype, "1.3.111.2.802.1.1.13.1.4.1.1.5");
assert.equal(O_.lldpV2RemManAddrIfSubtype, "1.3.111.2.802.1.1.13.1.4.2.1.3");
for (const w of S.LLDP_V2_FALLBACK) assert.ok(S.WALK_ALLOWED.includes(w) && w.startsWith("1.3.111.2.802.1.1.13.1.4."), w);
assert.ok(!S.needsLldpV2Fallback(read(rows, gets)), "con LLDP-MIB no se pide la V2");
const L2 = "1.3.111.2.802.1.1.13.1.4";
const v2rows = [
  str(`${O_.ifName}.10105`, "Gi1/0/5"),
  // Índice TimeMark.ifIndex.destino.remIndex; dos TimeMark del mismo vecino.
  str(`${L2}.1.1.10.0.10105.1.4`, "viejo"),
  str(`${L2}.1.1.10.900.10105.1.4`, "acc-sw07"),
  int(`${L2}.1.1.7.900.10105.1.4`, 5),
  str(`${L2}.1.1.8.900.10105.1.4`, "ge-0/0/3"),
  str(`${L2}.1.1.11.900.10105.1.4`, "Juniper EX2300\nJUNOS"),
  // Sin nombre: chassis MAC; puerto local sin ifName conocido.
  int(`${L2}.1.1.5.950.77.1.2`, 4),
  hex(`${L2}.1.1.6.950.77.1.2`, "3c61040a0b0c"),
  int(`${L2}.1.1.7.950.77.1.2`, 3),
  hex(`${L2}.1.1.8.950.77.1.2`, "3c61040a0b0d"),
  // Dirección de gestión IPv4 (familia 1, largo 4) e índice corto (descartado).
  int(`${L2}.2.1.3.900.10105.1.4.1.4.192.0.2.70`, 2),
  str(`${L2}.1.1.10.5.6.7`, "corto"),
];
const v1empty = read([str(`${O_.ifName}.1`, "Gi0/1")]);
assert.ok(S.needsLldpV2Fallback(v1empty), "LLDP-MIB vacía: se pide la V2");
const dv2 = S.parseSnmpDiscovery(read(v2rows), all);
assert.deepEqual(
  dv2.neighbors.map((n) => [n.name, n.localPort, n.remotePort, n.ip, n.platform, n.proto]).sort((a, b) => b[0].localeCompare(a[0])),
  [
    ["acc-sw07", "Gi1/0/5", "ge-0/0/3", "192.0.2.70", "Juniper EX2300", "LLDP"],
    ["3c61.040a.0b0c", "puerto 77", "3c61.040a.0b0d", undefined, undefined, "LLDP"],
  ],
);
assert.ok(!dv2.l2Empty);
// Con LLDP-MIB y V2 a la vez manda la de 2005 (sin duplicar vecinos).
assert.equal(S.parseSnmpDiscovery(read([...rows, ...v2rows], gets), all).neighbors.filter((n) => n.name === "acc-sw07").length, 0);

// Cisco: tabla MAC por VLAN. vtpVlanState (CISCO-VTP-MIB) y lectura por VLAN de BRIDGE-MIB.
assert.equal(O_.vtpVlanState, "1.3.6.1.4.1.9.9.46.1.3.1.1.2");
assert.equal(O_.sysObjectID, "1.3.6.1.2.1.1.2.0");
assert.ok(S.WALK_ALLOWED.includes(O_.vtpVlanState) && S.VLAN_LIST.every((w) => S.WALK_ALLOWED.includes(w)));
assert.deepEqual(S.VLAN_FDB_WALKS, [O_.dot1dBasePortIfIndex, O_.dot1dTpFdbPort, O_.dot1dTpFdbStatus]);
assert.deepEqual([...S.VLAN_FDB_WALKS].sort(), rustVlan(), "VLAN: snmp.rs = topoSnmp.ts");
const oidVal = (oid, v) => ({ oid, type: "OID", value: v });
const cisco = [oidVal(O_.sysObjectID, "1.3.6.1.4.1.9.1.2494"), str(O_.sysName, "acc-sw01")];
const ciscoNoFdb = read([str(`${O_.ifName}.10102`, "Gi1/0/2")], cisco);
assert.ok(S.isCiscoAgent(ciscoNoFdb) && S.needsVlanFdb(ciscoNoFdb));
assert.ok(!S.needsVlanFdb(read(rows, cisco)), "con FDB general no se lee por VLAN");
assert.ok(!S.isCiscoAgent(read([], [oidVal(O_.sysObjectID, "1.3.6.1.4.1.2011.2.23.1")])), "Huawei no es Cisco");
assert.ok(!S.isCiscoAgent(read([], [oidVal(O_.sysObjectID, "1.3.6.1.4.1.99.1")])), "enterprises.99 no es Cisco");
assert.ok(!S.needsVlanFdb(read([], [str(O_.sysName, "x")])), "sin sysObjectID no se asume Cisco");
// Índice managementDomainIndex.vtpVlanIndex; solo operational(1), sin 1002 a 1005 ni repetidos.
const vtp = read([
  int(`${O_.vtpVlanState}.1.1`, 1),
  int(`${O_.vtpVlanState}.1.20`, 1),
  int(`${O_.vtpVlanState}.1.30`, 2),
  int(`${O_.vtpVlanState}.2.20`, 1),
  int(`${O_.vtpVlanState}.1.1002`, 1),
  int(`${O_.vtpVlanState}.1.4095`, 1),
  int(`${O_.vtpVlanState}.1`, 1),
]);
assert.deepEqual(S.activeVlans(vtp), { vlans: [1, 20], total: 2 });
const manyVlans = read(Array.from({ length: 100 }, (_, i) => int(`${O_.vtpVlanState}.1.${i + 2}`, 1)));
assert.deepEqual([S.activeVlans(manyVlans).vlans.length, S.activeVlans(manyVlans).total, S.activeVlans(manyVlans).vlans[0]], [S.MAX_VLAN_READS, 100, 2], "tope de 64 VLAN");
assert.equal(S.MAX_VLAN_READS, 64);
// Cada VLAN trae su dot1dBasePortTable; una MAC vista en dos VLAN por el mismo puerto va una vez.
const vlan20 = read([int(`${O_.dot1dBasePortIfIndex}.2`, 10102), int(`${O_.dot1dTpFdbPort}.0.224.252.18.52.86`, 2), int(`${O_.dot1dTpFdbStatus}.0.224.252.18.52.86`, 3)]);
const vlan30 = read([int(`${O_.dot1dBasePortIfIndex}.7`, 10146), int(`${O_.dot1dTpFdbPort}.0.0.12.7.172.30`, 7), int(`${O_.dot1dTpFdbPort}.0.224.252.18.52.86`, 9)]);
const ciscoRead = read([str(`${O_.ifName}.10102`, "Gi1/0/2"), str(`${O_.ifName}.10146`, "Gi1/0/46")], cisco);
const dv = S.parseSnmpDiscovery(ciscoRead, all, [{ vlan: 20, read: vlan20 }, { vlan: 30, read: vlan30 }, { vlan: 40, read: vlan20 }]);
assert.deepEqual(dv.macRows.map((r) => [r.mac, r.port]).sort(), [["0000.0c07.ac1e", "Gi1/0/46"], ["00e0.fc12.3456", "Gi1/0/2"]], "puerto 9 sin mapeo fuera");
const vlanNotes = S.parseSnmpDiscovery(ciscoRead, all, [{ vlan: 50, read: { ...vlan20, walks: [{ oid: O_.dot1dTpFdbPort, rows: [], truncated: false, timedOut: true, error: null }] } }]).notes;
assert.match(vlanNotes[0], /^VLAN 50: dot1dTpFdbPort: tiempo agotado/);
assert.ok(S.snmpDiscoveryPlan(all).gets.includes(O_.sysObjectID));

const bigRead = read(Array.from({ length: 10000 }, (_, i) => str(`${L}.4.1.1.9.${i}.${i % 50}.${i}`, `sw${i}`)).concat(Array.from({ length: 10000 }, (_, i) => int(`${O_.dot1dTpFdbPort}.0.17.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}.1`, 1))));
fast("SNMP con 20.000 filas", 1500, () => S.parseSnmpDiscovery(bigRead, all));

// ---------- Tráfico: tasas, vueltas de 32 bits, reinicios y umbrales ----------

const W32 = 2n ** 32n;
assert.deepEqual(R.counterDelta(100n, 350n, 64), { d: 250n, wrapped: false });
assert.deepEqual(R.counterDelta(W32 - 1000n, 500n, 32), { d: 1500n, wrapped: true }, "vuelta de 32 bits");
assert.equal(R.counterDelta(5_000_000n, 10n, 64), null, "64 bits hacia atrás = reinicio");
assert.equal(R.counterDelta(W32 + 5n, 10n, 32), null, "fuera de rango de 32 bits = reinicio");
// 1.500 octetos en 1 s = 12.000 b/s.
assert.equal(R.rateBps(W32 - 1000n, 500n, 32, 1), 12000);
// Reinicio de un contador de 32 bits que parece vuelta: tasa imposible para la velocidad, se descarta.
assert.equal(R.rateBps(1000n, 10n, 32, 30, 1e6), null);
assert.equal(R.rateBps(100n, 200n, 64, 0), null, "sin tiempo transcurrido");
assert.equal(R.rateBps(0n, 3_750_000_000n, 64, 30, 1e9), 1e9, "100 % de 1 Gb/s");
const s0_ = { inOctets: 1_000n, outOctets: 2_000n, bits: 64, speed: 1e9, ts: 0 };
const s1_ = { inOctets: 1_000n + 131_250_000n, outOctets: 2_000n + 450_000_000n, bits: 64, speed: 1e9, ts: 30_000 };
assert.deepEqual(R.portRate(undefined, s1_), { inBps: null, outBps: null, speed: 1e9, ts: 30_000 }, "primera lectura sin tasa");
assert.deepEqual(R.portRate(s0_, s1_), { inBps: 35e6, outBps: 120e6, speed: 1e9, ts: 30_000 });
assert.equal(R.portRate({ ...s0_, bits: 32 }, s1_).inBps, null, "cambio de 32 a 64 bits: sin tasa");
const reset = R.portRate(s1_, { ...s1_, inOctets: 10n, ts: 60_000 });
assert.equal(reset.inBps, null, "clear counters / reinicio");
assert.equal(reset.outBps, 0);
// Por enlace: A→B = salida de A (o entrada de B si A no se lee); velocidad menor; utilización máxima.
const lk = { a: "core", aPort: "Gi1/0/1", b: "dist", bPort: "GigabitEthernet1/0/48", proto: "CDP" };
const rates = new Map([["core", new Map([["gi1/0/1", { inBps: 35e6, outBps: 120e6, speed: 1e9, ts: 1 }]])]]);
assert.deepEqual(R.linkTraffic(lk, rates), { ab: 120e6, ba: 35e6, speed: 1e9, util: 0.12, ts: 1 });
const onlyB = new Map([["dist", new Map([["gi1/0/48", { inBps: 800e6, outBps: 10e6, speed: 1e9, ts: 2 }]])]]);
assert.deepEqual(R.linkTraffic(lk, onlyB), { ab: 800e6, ba: 10e6, speed: 1e9, util: 0.8, ts: 2 });
assert.equal(R.linkTraffic(lk, new Map([["core", new Map([["gi1/0/1", { inBps: null, outBps: null, ts: 1 }]])]])), null, "sin segunda lectura");
assert.equal(R.linkTraffic(lk, new Map([["core", new Map([["gi1/0/1", { inBps: 5, outBps: 6, ts: 1 }]])]])).util, undefined, "sin velocidad");
// Umbrales: verde, amarillo desde 70 %, rojo desde 90 %.
assert.deepEqual([0, 0.69, 0.7, 0.899, 0.9, 1.2, undefined, NaN].map(T.utilLevel), ["ok", "ok", "warn", "warn", "crit", "crit", "none", "none"]);
assert.deepEqual([0, 950, 999_499, 35e6, 120e6, 1.2e9, null, -1].map(T.fmtBps), ["0 b/s", "950 b/s", "999 kb/s", "35 Mb/s", "120 Mb/s", "1.2 Gb/s", "?", "?"]);
assert.equal(T.trafficLabel({ ab: 120e6, ba: 35e6, speed: 1e9, util: 0.12, ts: 0 }), "→ 120 Mb/s · ← 35 Mb/s · 12 %");
// Rótulo corto del mapa: % de uso; sin velocidad, la tasa mayor de los dos sentidos.
assert.equal(T.trafficShort({ ab: 120e6, ba: 35e6, speed: 1e9, util: 0.12, ts: 0 }), "12 %");
assert.equal(T.trafficShort({ ab: 120e6, ba: 35e6, speed: 1e9, util: 0.12, approx: true, ts: 0 }), "≈12 %");
assert.equal(T.trafficShort({ ab: 12e6, ba: 45e6, ts: 0 }), "45 Mb/s");
assert.equal(T.trafficShort({ ab: null, ba: null, ts: 0 }), "0 b/s");
assert.equal(T.trafficLabel({ ab: 120e6, ba: null, ts: 0 }), "→ 120 Mb/s · ← ?");
// Con el equipo A explícito (nombre largo recortado) y utilización aproximada.
assert.equal(T.trafficLabel({ ab: 120e6, ba: 35e6, speed: 1e9, util: 0.12, ts: 0 }, "core-sw01"), "core-sw01 → 120 Mb/s · ← 35 Mb/s · 12 %");
assert.equal(T.trafficLabel({ ab: 1e6, ba: 2e6, speed: 1e6, util: 2, approx: true, ts: 0 }, "nucleo-campus-edificio-a"), "nucleo-campus-e… → 1.0 Mb/s · ← 2.0 Mb/s · ≈200 %");
assert.notEqual(T.UTIL_COLORS.none, "#2563eb", "velocidad desconocida no usa el azul de selección");

// BW configurado menor que la velocidad real: la tasa no se descarta y la utilización queda aproximada.
const bw0 = { inOctets: 0n, outOctets: 0n, bits: 64, speed: 10e6, approx: true, ts: 0 };
const bw1 = { ...bw0, inOctets: 375_000_000n, outOctets: 0n, ts: 30_000 };
assert.deepEqual(R.portRate(bw0, bw1), { inBps: 100e6, outBps: 0, speed: 10e6, approx: true, ts: 30_000 }, "100 Mb/s con BW 10 Mbit");
assert.equal(R.portRate({ ...bw0, approx: undefined }, { ...bw1, approx: undefined }).inBps, null, "con velocidad física sí se descarta");
const approxRates = new Map([["core", new Map([["gi1/0/1", R.portRate(bw0, bw1)]])]]);
assert.deepEqual(R.linkTraffic(lk, approxRates), { ab: 0, ba: 100e6, speed: 10e6, util: 10, approx: true, ts: 30_000 });
// Una velocidad física en el otro extremo gana sobre el BW.
approxRates.set("dist", new Map([["gi1/0/48", { inBps: null, outBps: null, speed: 1e9, ts: 30_000 }]]));
assert.deepEqual(R.linkTraffic(lk, approxRates), { ab: 0, ba: 100e6, speed: 1e9, util: 0.1, ts: 30_000 });
// GET de contadores: 64 bits, 32 bits y agente sin ifXTable.
const hcRows = [
  { oid: `${O_.ifHCInOctets}.10101`, type: "Counter64", value: "18446744073709551000" },
  { oid: `${O_.ifHCOutOctets}.10101`, type: "Counter64", value: "42" },
  { oid: `${O_.ifHighSpeed}.10101`, type: "Gauge32", value: "10000" },
  { oid: `${O_.ifHCInOctets}.3`, type: "noSuchInstance", value: "" },
];
const g64 = R.parseCounterGets(hcRows, [10101, 3], true, 5);
assert.deepEqual(g64.samples.get(10101), { inOctets: 18446744073709551000n, outOctets: 42n, bits: 64, speed: 1e10, ts: 5, src: "snmp" }, "Counter64 sin perder precisión");
assert.ok(!g64.samples.has(3) && !g64.hcMissing);
assert.ok(R.parseCounterGets([{ oid: `${O_.ifHCInOctets}.1`, type: "noSuchObject", value: "" }], [1], true, 0).hcMissing, "sin ifXTable: pedir 32 bits");
const g32 = R.parseCounterGets([{ oid: `${O_.ifInOctets}.1`, type: "Counter32", value: "4294967295" }, { oid: `${O_.ifOutOctets}.1`, type: "Counter32", value: "7" }, { oid: `${O_.ifSpeed}.1`, type: "Gauge32", value: "100000000" }], [1], false, 0);
assert.deepEqual(g32.samples.get(1), { inOctets: 4294967295n, outOctets: 7n, bits: 32, speed: 1e8, ts: 0, src: "snmp" });
assert.equal(R.parseCounterGets([{ oid: `${O_.ifInOctets}.1`, type: "OCTET STRING", value: "1e9" }, { oid: `${O_.ifOutOctets}.1`, type: "Counter32", value: "-5" }], [1], false, 0).samples.size, 0, "valores no numéricos descartados");

// ---------- Tráfico por consola ----------

const iosIf = `core-sw01#show interfaces
GigabitEthernet1/0/1 is up, line protocol is up (connected)
  Hardware is Gigabit Ethernet, address is 0011.2233.4401 (bia 0011.2233.4401)
  Description: UPLINK dist-sw01
  MTU 1500 bytes, BW 100000 Kbit/sec, DLY 10 usec,
  Full-duplex, 1000Mb/s, media type is 10/100/1000BaseTX
  5 minute input rate 35000000 bits/sec, 2900 packets/sec
     123456 packets input, 987654321 bytes, 0 no buffer
     654321 packets output, 1234567890123 bytes, 0 underruns
TenGigabitEthernet1/1/1 is administratively down, line protocol is down (disabled)
  MTU 1500 bytes, BW 10000000 Kbit/sec, DLY 10 usec,
     0 packets input, 0 bytes, 0 no buffer
     0 packets output, 0 bytes, 0 underruns
core-sw01#`;
const ios = R.parseCliCounters(iosIf);
assert.deepEqual(ios.get("gi1/0/1"), { name: "GigabitEthernet1/0/1", inOctets: 987654321n, outOctets: 1234567890123n, speed: 1e9, status: "connected", duplex: "full" }, "la velocidad física gana sobre un bandwidth configurado");
assert.equal(ios.get("te1/1/1").speed, 1e10);
assert.equal(ios.get("te1/1/1").speedApprox, true, "solo BW: aproximada");
assert.equal(R.parseCliCounters("Gi0/1 is up\n  full-duplex, 10 Gb/s, media type is 10G\n 1 packets input, 2 bytes\n 3 packets output, 4 bytes").get("gi0/1").speed, 1e10, "NX-OS");
assert.equal(R.parseCliCounters("Gi0/1 is up\n  Full Duplex, 100Mbps, link type is auto\n 1 packets input, 2 bytes\n 3 packets output, 4 bytes").get("gi0/1").speed, 1e8, "IOS-XE");
const nxIf = `Ethernet1/49 is up
admin state is up, Dedicated Interface
  MTU 9216 bytes, BW 100000000 Kbit , DLY 10 usec
  RX
    1000 unicast packets  0 multicast packets  0 broadcast packets
    1000 input packets  64000 bytes
  TX
    2000 unicast packets  0 multicast packets  0 broadcast packets
    2000 output packets  128000 bytes
`;
assert.deepEqual(R.parseCliCounters(nxIf).get("eth1/49"), { name: "Ethernet1/49", inOctets: 64000n, outOctets: 128000n, speed: 1e11, speedApprox: true });
const hwIf = `<ar-wan01>display interface
GigabitEthernet0/0/1 current state : UP
Line protocol current state : UP
Description:WAN
Speed : 100,  Loopback: NONE
Duplex: FULL,  Negotiation: ENABLE
Input:  3697368 packets, 264104568 bytes
Output:  1234 packets, 99999 bytes
<ar-wan01>`;
assert.deepEqual(R.parseCliCounters(hwIf).get("gi0/0/1"), { name: "GigabitEthernet0/0/1", inOctets: 264104568n, outOctets: 99999n, speed: 1e8 });
const jnIf = `user@mx> show interfaces extensive
Physical interface: ge-0/0/1, Enabled, Physical link is Up
  Link-level type: Ethernet, MTU: 1514, Speed: 1000mbps, BPDU Error: None,
  Traffic statistics:
   Input  bytes  :          5000000000          35000000 bps
   Output bytes  :          7000000000         120000000 bps
  Logical interface ge-0/0/1.0 (Index 70)
    Traffic statistics:
     Input  bytes  :                   1
     Output bytes  :                   2
Physical interface: xe-0/1/0, Enabled, Physical link is Up
  Link-level type: Ethernet, MTU: 1514, Speed: 10Gbps,
  Traffic statistics:
   Input  bytes  :                  10
   Output bytes  :                  20
`;
const jn = R.parseCliCounters(jnIf);
assert.deepEqual(jn.get("gi0/0/1") ?? jn.get(T.canonPort("ge-0/0/1")), { name: "ge-0/0/1", inOctets: 5000000000n, outOctets: 7000000000n, speed: 1e9 }, "solo la interfaz física");
assert.equal(jn.get(T.canonPort("xe-0/1/0")).speed, 1e10);
assert.equal(R.parseCliCounters("% Invalid input detected at '^' marker.").size, 0);
fast("contadores con línea enorme", 300, () => R.parseCliCounters(`Gi1 is up\n${"1 packets input, ".repeat(BIG / 16)}x`));
fast("contadores con miles de interfaces", 1500, () => R.parseCliCounters(Array.from({ length: 5000 }, (_, i) => `Gi1/0/${i} is up\n 1 packets input, 2 bytes\n 3 packets output, 4 bytes`).join("\n")));

// Riesgo: todo comando de contadores (y su alternativa NX-OS) es de consulta.
const trafficCmds = [...Object.values(R.TRAFFIC_COMMANDS).filter(Boolean), ...Object.values(R.TRAFFIC_FALLBACK)];
assert.deepEqual(trafficCmds.sort(), ["display interface", "show interface", "show interfaces", "show interfaces extensive"]);
for (const cmd of trafficCmds) assert.equal(computeRisk(cmd), "read", cmd);
assert.equal(R.TRAFFIC_COMMANDS.fortinet, undefined);

// ---------- Vista por excepción: umbrales, estados y origen de la lectura ----------
{
  // Mismos umbrales que el color continuo de la vista detallada.
  assert.equal(R.UTIL_HIGH, T.UTIL_WARN);
  assert.equal(R.UTIL_SATURATED, T.UTIL_CRIT);
  assert.equal(R.UTIL_HIGH, 0.7);
  assert.equal(R.UTIL_SATURATED, 0.9);
  assert.equal(R.trafficLevel(0.69), "normal");
  assert.equal(R.trafficLevel(0.7), "high");
  assert.equal(R.trafficLevel(0.89), "high");
  assert.equal(R.trafficLevel(0.9), "saturated");
  assert.equal(R.trafficLevel(1.2), "saturated");
  assert.equal(R.trafficLevel(undefined), "normal", "sin dato no se distingue de normal");
  assert.equal(R.trafficLevel(NaN), "normal");
  // Por sentido: el estado de cada sentido sale de su tasa contra la velocidad.
  assert.equal(R.dirLevel(960e6, 1e9), "saturated");
  assert.equal(R.dirLevel(120e6, 1e9), "normal");
  assert.equal(R.dirLevel(780e6, 1e9), "high");
  assert.equal(R.dirLevel(null, 1e9), "normal");
  assert.equal(R.dirLevel(5e9, undefined), "normal");
  assert.ok(R.LEVEL_RANK.down === R.LEVEL_RANK.saturated && R.LEVEL_RANK.saturated > R.LEVEL_RANK.high && R.LEVEL_RANK.high > R.LEVEL_RANK.issues && R.LEVEL_RANK.issues > R.LEVEL_RANK.normal);

  // El origen de la lectura (SNMP o consola) llega hasta el enlace.
  const base = { inOctets: 0n, outOctets: 0n, bits: 64, speed: 1e9 };
  const r0 = R.portRate({ ...base, ts: 0, src: "cli" }, { ...base, inOctets: 1000n, outOctets: 2000n, ts: 1000, src: "cli" });
  assert.equal(r0.src, "cli");
  const lk = { a: "x", aPort: "Gi1", b: "y", bPort: "Gi2", proto: "CDP" };
  assert.equal(R.linkTraffic(lk, new Map([["x", new Map([["gi1", r0]])]])).src, "cli");
  const rs = { ...r0, ts: 5000, src: "snmp" };
  assert.equal(R.linkTraffic(lk, new Map([["x", new Map([["gi1", r0]])], ["y", new Map([["gi2", rs]])]])).src, "snmp", "manda la lectura más reciente");
  assert.equal(R.linkTraffic(lk, new Map([["x", new Map([["gi1", { ...r0, src: undefined }]])]])).src, undefined);

  // show interfaces (Cisco): estado, dúplex y errores de la misma lectura de tráfico.
  const ci = R.parseCliCounters(`GigabitEthernet1/0/5 is down, line protocol is down (err-disabled)
  Full-duplex, 1000Mb/s, media type is 10/100/1000BaseTX
     5 minute input rate 0 bits/sec, 0 packets/sec
     100 packets input, 2000 bytes, 0 no buffer
     12 input errors, 12 CRC, 0 frame, 0 overrun, 0 ignored
     50 packets output, 3000 bytes, 0 underruns
GigabitEthernet1/0/6 is up, line protocol is up (connected)
  Half-duplex, 100Mb/s, media type is 10/100/1000BaseTX
     200 packets input, 4000 bytes, 0 no buffer
     0 input errors, 0 CRC, 0 frame, 0 overrun, 0 ignored
     60 packets output, 5000 bytes, 0 underruns
GigabitEthernet1/0/7 is administratively down, line protocol is down
  Auto-duplex, Auto-speed
     1 packets input, 2 bytes, 0 no buffer
     1 packets output, 2 bytes, 0 underruns
`);
  const e5 = ci.get("gi1/0/5");
  assert.deepEqual({ status: e5.status, duplex: e5.duplex, crc: e5.crc, inErr: e5.inErr }, { status: "err-disabled", duplex: "full", crc: "12", inErr: "12" });
  assert.equal(ci.get("gi1/0/6").status, "connected");
  assert.equal(ci.get("gi1/0/6").duplex, "half");
  assert.equal(ci.get("gi1/0/6").crc, "0");
  assert.equal(ci.get("gi1/0/7").status, "administratively down");
  assert.equal(ci.get("gi1/0/7").duplex, undefined);
  // Sin el motivo entre paréntesis (IOS antiguo): enlace/protocolo.
  assert.equal(R.parseCliCounters("Gi0/1 is up, line protocol is up\n  100 packets input, 2000 bytes\n  100 packets output, 2000 bytes").get("gi0/1").status, "up/up");

  // show interfaces trunk (IOS): VLAN nativa de cada trunk propio; solo la primera tabla.
  const trunk = T.parsePortInfo([`Port        Mode             Encapsulation  Status        Native vlan
Gi1/0/1     on               802.1q         trunking      99
Gi1/0/2     on               802.1q         not-trunking  1
Po1         on               802.1q         trunking      1

Port        Vlans allowed on trunk
Gi1/0/1     1-4094
Gi1/0/3     1-4094
sw1#`]);
  assert.deepEqual({ ...trunk["gi1/0/1"] }, { native: "99", vlan: "trunk" });
  assert.equal(trunk["gi1/0/2"], undefined, "not-trunking no informa");
  assert.equal(trunk["po1"].native, "1");
  assert.equal(trunk["gi1/0/3"], undefined);
  assert.ok(T.PORT_COMMANDS.cisco.includes("show interfaces trunk"));
}

// ---------- Exportaciones con tráfico ----------

const tt = {
  nodes: [
    { id: "a", name: '=cmd|"<b>&', ip: "192.0.2.1", explored: true, x: 100, y: 100 },
    { id: "b", name: "b<x>", explored: true, x: 400, y: 100 },
    { id: "c", name: "c", explored: false, x: 250, y: 300 },
  ],
  links: [
    { a: "a", aPort: "Gi1/0/1", b: "b", bPort: "Gi0/1", proto: "CDP" },
    { a: "a", aPort: "Gi1/0/2", b: "c", bPort: "", proto: "LLDP" },
  ],
};
const tmap = new Map([[T.linkKey(tt.links[0]), { ab: 950e6, ba: 35e6, speed: 1e9, util: 0.95, ts: Date.UTC(2026, 9, 23, 12) }]]);
const tsvg = T.toSvg(tt, 170, 54, tmap);
assert.ok(!/<b>|<x>/.test(tsvg), "SVG escapado");
assert.match(tsvg, /stroke="#cf222e" stroke-width="1\.25"\/><text [^>]*>95 %<\/text>/, "rótulo corto con el % sobre el enlace");
assert.match(tsvg, />=cmd\|&quot;&lt;b&gt;&amp; Gi1\/0\/1 ↔ b&lt;x&gt; Gi0\/1: → 950 Mb\/s · ← 35 Mb\/s · 95 %<\/text>/, "tabla de enlaces con nombres escapados");
assert.match(tsvg, /stroke="#cf222e" stroke-width="4\.8"/, "rojo desde 90 %");
assert.match(tsvg, /Utilización de 90 % o más/);
assert.match(tsvg, /Rótulo: % de uso del sentido más cargado/);
assert.match(tsvg, /Enlaces por carga/);
assert.match(tsvg, /Velocidad desconocida/);
assert.match(tsvg, new RegExp(`stroke="${T.UTIL_COLORS.none}"`), "leyenda con el color de velocidad desconocida");
assert.equal((tsvg.match(/· ← /g) ?? []).length, 2, "solo el enlace con datos va en la tabla (más su encabezado)");
assert.equal((tsvg.match(/rx="9"/g) ?? []).length, 1, "solo el enlace con datos lleva rótulo");
assert.ok(!/Utilización/.test(T.toSvg(tt, 170, 54)), "sin tráfico, sin leyenda de tráfico");
const tcsv = T.toCsv(tt, tmap).split("\n");
assert.match(tcsv[0], /,protocolo,trafico_a_b_bps,trafico_b_a_bps,velocidad_enlace_bps,utilizacion_pct,lectura,utilizacion_aproximada$/);
assert.match(tcsv[1], /^"'=cmd\|""<b>&",/, "fórmula neutralizada");
assert.match(tcsv[1], /,"CDP","950000000","35000000","1000000000","95\.0","2026-10-23T12:00:00\.000Z",""$/);
assert.match(tcsv[2], /,"LLDP","","","","","",""$/, "enlace sin datos: celdas vacías");
assert.match(T.toCsv(tt, new Map([[T.linkKey(tt.links[0]), { ab: 1, ba: 1, speed: 1e6, util: 0, approx: true, ts: 0 }]])).split("\n")[1], /,"si"$/);
assert.equal(T.toCsv(tt).split("\n")[0].split(",").length, 14, "sin tráfico, columnas de siempre");
assert.equal(T.toMermaid(tt), T.toMermaid(tt), "Mermaid no cambia");
assert.ok(!/→ |↑/.test(T.toMermaid(tt)));

// ---------- Seguir la ruta: la sesión nueva se elige sola ----------

const terms = [
  { connId: "c1", host: "192.0.2.1", session: { id: "s1" } },
  { connId: "c2", host: "192.0.2.9", session: { id: "" } },
  { connId: "c3", host: "192.0.2.7", session: { id: "s7" } },
];
assert.equal(T.followedTerminal(terms, { host: "192.0.2.9", known: ["c1"] })?.connId, "c2", "sesión nueva por IP");
assert.equal(T.followedTerminal(terms, { sessionId: "s7", known: ["c1", "c2"] })?.connId, "c3", "sesión guardada");
assert.equal(T.followedTerminal(terms, { host: "192.0.2.1", known: ["c1"] }), undefined, "una conexión que ya existía no cuenta");
assert.equal(T.followedTerminal(terms, { known: [] }), undefined);

// ---------- Sugerencias descartadas: por equipo, con tope y sin confiar en lo guardado ----------

let dm = {};
dm = T.addDismissed(dm, "mac|core|gi1/0/5");
dm = T.addDismissed(dm, "descriptions|core|gi1/0/6");
dm = T.addDismissed(dm, "mac|core|gi1/0/5");
assert.deepEqual(dm, { core: ["descriptions|core|gi1/0/6", "mac|core|gi1/0/5"] }, "sin duplicados, el más reciente al final");
assert.ok(T.dismissedSet(dm).has("mac|core|gi1/0/5"));
for (let i = 0; i < T.MAX_DISMISSED_PER_DEVICE + 5; i++) dm = T.addDismissed(dm, `mac|dist|p${i}`);
assert.equal(dm.dist.length, T.MAX_DISMISSED_PER_DEVICE, "tope por equipo");
assert.equal(dm.dist[0], "mac|dist|p5", "se olvidan los más antiguos");
let many = {};
for (let i = 0; i < T.MAX_DISMISSED_DEVICES + 3; i++) many = T.addDismissed(many, `mac|sw${i}|x`);
assert.equal(Object.keys(many).length, T.MAX_DISMISSED_DEVICES, "tope de equipos");
assert.ok(!("sw0" in many) && "sw202" in many);
const hostileDm = T.parseDismissed(JSON.parse('{"__proto__":["mac|__proto__|x"],"core":["mac|core|a",5,"mac|otro|b"],"x":"no"}'));
assert.deepEqual(hostileDm, { core: ["mac|core|a"] }, "forma validada, sin __proto__ ni ids de otro equipo");
assert.equal({}.polluted, undefined);
assert.deepEqual(T.parseDismissed(null), {});
assert.deepEqual(T.parseDismissed([1, 2]), {});
}

// ---------- Tráfico: nombres de puerto de CDP/LLDP contra show interfaces ----------
{
  const R = await import("../../src/lib/topoTraffic.ts");
  // Un mismo puerto aparece con nombre completo (show interfaces), corto (LLDP, CDP detail en
  // algunos equipos) o de tres letras con espacio (show cdp neighbors). Si no se unifican, el
  // enlace no encuentra sus contadores y queda sin tráfico, color ni animación.
  const same = [
    ["Gig 1/0/1", "GigabitEthernet1/0/1"], ["Gi1/0/1", "GigabitEthernet1/0/1"],
    ["Ten 1/1/1", "TenGigabitEthernet1/1/1"], ["Te1/1/1", "TenGigabitEthernet1/1/1"],
    ["Fas 0/1", "FastEthernet0/1"], ["For 1/1/1", "FortyGigabitEthernet1/1/1"], ["Hun 1/0/49", "HundredGigE1/0/49"],
    ["Tw1/0/1", "TwoGigabitEthernet1/0/1"], ["Two 1/0/1", "TwoGigabitEthernet1/0/1"], ["Fi1/0/1", "FiveGigabitEthernet1/0/1"],
    ["Twe 1/0/1", "TwentyFiveGigE1/0/1"], ["App1/0/1", "AppGigabitEthernet1/0/1"], ["Vl10", "Vlan10"],
    ["Eth 1/1", "Ethernet1/1"], ["Po1", "Port-channel1"], ["GE0/0/1", "GigabitEthernet0/0/1"], ["XGE0/0/1", "XGigabitEthernet0/0/1"],
  ];
  for (const [a, b] of same) assert.equal(T.canonPort(a), T.canonPort(b), `${a} = ${b}`);
  // Distintos siguen distintos (Huawei Vlanif, Eth-Trunk; Junos ge-).
  assert.notEqual(T.canonPort("Vlanif10"), T.canonPort("Vlan10"));
  assert.equal(T.canonPort("Eth-Trunk1"), T.canonPort("Port-channel1"));
  assert.equal(T.canonPort("ge-0/0/1"), "ge-0/0/1");

  // Comando por plataforma detectada, luego por resaltado; sin ninguno, Cisco y después Huawei.
  assert.deepEqual(R.trafficCommands("vrp8", undefined), ["display interface"]);
  assert.deepEqual(R.trafficCommands("yunshan", "cisco"), ["display interface"], "la plataforma manda sobre el resaltado");
  assert.deepEqual(R.trafficCommands("nxos", undefined), ["show interfaces", "show interface"]);
  assert.deepEqual(R.trafficCommands(undefined, "juniper"), ["show interfaces extensive"]);
  assert.deepEqual(R.trafficCommands(undefined, undefined), ["show interfaces", "show interface", "display interface"]);
  assert.deepEqual(R.trafficCommands("fos72", undefined), [], "FortiOS sin comando de contadores verificado");
  for (const c of R.trafficCommands(undefined, undefined)) assert.equal(computeRisk(c), "read", c);

  // De punta a punta: enlace con el nombre de "show cdp neighbors" y dos lecturas de show interfaces.
  const show = (inB, outB) =>
    [
      "GigabitEthernet1/0/1 is up, line protocol is up (connected)",
      "  Full-duplex, 1000Mb/s, media type is 10/100/1000BaseTX",
      `     1000 packets input, ${inB} bytes, 0 no buffer`,
      `     2000 packets output, ${outB} bytes, 0 underruns`,
    ].join("\n");
  const link = { a: "core", aPort: "Gig 1/0/1", b: "dist", bPort: "Gig 1/0/48" };
  const sample = (out, ts) => {
    const c = R.parseCliCounters(out).get(T.canonPort(link.aPort));
    assert.ok(c, "el puerto del enlace aparece en los contadores");
    return { inOctets: c.inOctets, outOctets: c.outOctets, bits: 64, speed: c.speed, ts };
  };
  const rate = R.portRate(sample(show(1_000_000, 2_000_000), 0), sample(show(16_000_000, 4_000_000), 15_000));
  const lt = R.linkTraffic(link, new Map([["core", new Map([[T.canonPort(link.aPort), rate]])]]));
  assert.deepEqual(lt, { ab: (2_000_000 * 8) / 15, ba: (15_000_000 * 8) / 15, speed: 1e9, util: 0.008, ts: 15_000 });
}

// ---------- Salto dentro de la misma pestaña (vecino que solo se alcanza desde el equipo) ----------
{
  const prompts = [["core-sw01#", "cisco"], ["core-sw01>", "cisco"], ["Router(config)#", "cisco"], ["<HUAWEI>", "huawei"], ["[~CE6800]", "huawei"], ["admin@mx01>", "juniper"], ["FGT-60F #", "fortinet"], ["FGT (global) #", "fortinet"], ["user@laptop:~$", null]];
  for (const [p, want] of prompts) assert.equal(T.vendorFromPrompt(`salida\n${p}`), want, p);
  const hops = [
    [["cisco", "iosxe", "ssh", "admin", "10.1.1.2"], "ssh -l admin 10.1.1.2"],
    [["cisco", "nxos", "ssh", "admin", "10.1.1.2"], "ssh admin@10.1.1.2"],
    [["cisco", "ios", "telnet", "", "10.1.1.2"], "telnet 10.1.1.2"],
    [["huawei", "vrp8", "ssh", "", "10.1.1.2"], "stelnet 10.1.1.2"],
    [["juniper", undefined, "ssh", "netops", "2001:db8::2"], "ssh netops@2001:db8::2"],
    [["fortinet", "fos72", "ssh", "admin", "10.1.1.2"], "execute ssh admin@10.1.1.2"],
    [["fortinet", "fos72", "telnet", "", "10.1.1.2"], "execute telnet 10.1.1.2"],
  ];
  for (const [args, want] of hops) {
    assert.equal(T.hopCommand(...args), want, JSON.stringify(args));
    // Abre una sesión hacia el vecino: no cambia configuración.
    assert.equal(computeRisk(want), "read", want);
  }
  // La IP y el usuario vienen de datos del equipo o de un campo: nada de opciones ni comandos extra.
  for (const args of [
    ["cisco", "ios", "ssh", "-oProxyCommand=x", "10.1.1.2"],
    ["cisco", "ios", "ssh", "a b", "10.1.1.2"],
    ["cisco", "ios", "ssh", "", "10.1.1.2"],
    ["cisco", "ios", "ssh", "admin", "10.1.1.2; reload"],
    ["cisco", "ios", "ssh", "admin", "core-sw02"],
    ["huawei", "vrp8", "telnet", "", "10.1.1.2\nreboot"],
  ])
    assert.equal(T.hopCommand(...args), null, JSON.stringify(args));
}

// Ritmo de la animación de tráfico: más tráfico, puntos más rápidos (40 a 160 px/s); 30 pasos por segundo.
{
  const idle = T.flowTiming(0, 1e9);
  const half = T.flowTiming(5e8, 1e9);
  const full = T.flowTiming(1e9, 1e9);
  assert.equal(idle.dur, 0.4);
  assert.ok(half.dur < idle.dur && full.dur < half.dur, JSON.stringify({ idle, half, full }));
  assert.equal(full.dur, 0.1);
  assert.equal(T.flowTiming(2e9, 1e9).dur, 0.1, "sobre el 100 % no acelera más");
  assert.equal(full.steps, 3);
  assert.equal(idle.steps, 12);
  // Sin velocidad del enlace: escala logarítmica del volumen (1 kbps lento, 1 Gbps rápido).
  assert.ok(T.flowTiming(1e3).dur > T.flowTiming(1e6).dur && T.flowTiming(1e6).dur > T.flowTiming(1e9).dur);
  assert.equal(T.flowTiming(1e9).dur, 0.1);
  assert.equal(T.flowTiming(null).dur, 0.4);
}


// ---------- Descubrir desde pestañas de salto (cadena core › dist › agg › acc1 › acc2 › acc3) ----------
// El CDP de cada equipo trae nombres con dominio y mayúsculas; el prompt va en minúsculas. Cada descubrimiento se hace
// con la pestaña del equipo alcanzado y debe sumar sus vecinos sin duplicar equipos, con la ruta heredada.
{
  const { discoveryIdentity, newCameFrom, routeNames, extendRoute, planOpen, tabDevice } = await import("../../src/lib/hopTab.ts");
  const ids = ["core-sw01", "dist-sw01", "agg-sw01", "acc-sw01", "acc-sw02", "acc-sw03"];
  const cdpName = (i) => `${ids[i].toUpperCase()}.lab.ejemplo`;
  const cdpBlock = (i, local, remote) =>
    `-------------------------\nDevice ID: ${cdpName(i)}\nEntry address(es): \n  IP address: 192.0.2.${i + 1}\nPlatform: cisco C9300-48P,  Capabilities: Router Switch IGMP\nInterface: ${local},  Port ID (outgoing port): ${remote}\nHoldtime : 150 sec\n`;
  const cdpOf = (i) => [i > 0 && cdpBlock(i - 1, "GigabitEthernet1/0/1", "GigabitEthernet1/0/48"), i < ids.length - 1 && cdpBlock(i + 1, "GigabitEthernet1/0/48", "GigabitEthernet1/0/1")].filter(Boolean).join("");
  const sess = { id: "s-core", name: "core-sw01", type: "ssh", host: "192.0.2.1", port: 22, username: "noc" };
  const screenOf = (i) => () => `${ids[i]}#`;
  let topo = { nodes: [], links: [] };
  let route; // ruta de la pestaña del equipo actual (undefined: la pestaña del pivote)
  const cameFrom = new Map();
  const tabs = [];
  for (let i = 0; i < ids.length; i++) {
    const tabInfo = { name: `${ids[i]} vía x`, host: "192.0.2.1", session: sess, hasTabId: true };
    const who = discoveryIdentity(tabInfo, route, ids[i]);
    assert.equal(nodeId(who.name), ids[i]);
    assert.equal(who.ip, `192.0.2.${i + 1}`, `salto ${i}: la IP es la del equipo de la ruta, no la de la sesión del PC`);
    assert.deepEqual(routeNames(who.upto).map(nodeId), ids.slice(0, i + 1));
    const nbs = T.parseCdp(cdpOf(i)).map((n) => ({ ...n }));
    assert.equal(nbs.length, i === 0 || i === ids.length - 1 ? 1 : 2, `salto ${i}: CDP con vecinos`);
    // Sin alcance: todos los vecinos del equipo se agregan, también en el salto 4, 5 y 6.
    const fresh = newCameFrom({ ids: new Set(topo.nodes.map((n) => n.id)), addrs: topo.nodes.flatMap((n) => T.knownAddrs(n)) }, nbs, nodeId(who.name), who.upto, cameFrom);
    for (const [id, cf] of fresh) cameFrom.set(id, cf);
    topo = T.mergeNeighbors(topo, { name: who.name, ip: who.ip }, nbs);
    assert.equal(topo.nodes.length, Math.min(i + 2, ids.length), `salto ${i}: sin equipos duplicados (${topo.nodes.map((n) => n.id).join(", ")})`);
    if (i + 1 < ids.length) {
      const next = ids[i + 1];
      assert.deepEqual([...fresh.keys()], [next], `salto ${i}: solo el vecino de abajo es nuevo`);
      assert.equal(cameFrom.get(next).from, ids[i]);
      // Saltar a N desde M: la ruta de la pestaña de M más un paso.
      const tab = { tabId: `t${i}`, name: ids[i], session: sess, status: "connected", route, device: tabDevice({ name: ids[i], screen: screenOf(i) }, route), free: true };
      tabs.push(tab);
      const target = topo.nodes.find((n) => n.id === next);
      const p = planOpen({
        target: { id: target.id, name: target.name, ip: target.ip },
        nodes: topo.nodes.map((n) => ({ id: n.id, name: n.name, ip: n.ip })),
        links: topo.links,
        tabs,
        saved: new Map(),
        cameFrom,
        needsPivot: false,
        directOk: true,
        cmdFor: (_f, to) => ({ cmd: `ssh -l noc ${to.ip}`, user: "noc" }),
      });
      const via = i === 0 ? p.alternatives.find((a) => a.kind === "route") : p.primary;
      assert.deepEqual(routeNames(via.route).map(nodeId), ids.slice(0, i + 2), `salto ${i + 1}: la ruta parte del equipo anterior`);
      route = via.route;
      // La pestaña llega al equipo y su prompt (minúsculas) coincide con el nombre del diagrama (con dominio).
      assert.equal(route.steps.at(-1).name, cdpName(i + 1));
    }
  }
  // Un prompt que la ruta no conoce no se asigna a otro equipo.
  assert.equal(discoveryIdentity({ name: "t", host: "192.0.2.1", session: sess, hasTabId: true }, route, "otro-sw").upto, undefined);
  // Con alcance de profundidad, un vecino nuevo fuera de alcance se informa (no se descarta en silencio).
  const I = await import("../../src/lib/topoInsights.ts");
  const deep = I.scopeNeighbors(topo, "acc-sw02", [{ name: "NUEVO.lab.ejemplo", localPort: "Gi1/0/2", remotePort: "Gi1/0/1", proto: "CDP" }], { skipEndpoints: false, cidrs: "", maxDepth: 3 });
  assert.equal(deep.kept.length, 0);
  assert.match(deep.skipped[0], /más de 3 saltos/);
}

console.log("topology: ok");
