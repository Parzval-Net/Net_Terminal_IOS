// Pruebas de revisiones, filtros, búsqueda, L2 desconocido y alcance de la topología:
// `node scripts/tests/topoInsights.test.mjs` (Node 22.15+ con tipos TS).
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { fastEnough } from "./timing.mjs";

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
const I = await import("../../src/lib/topoInsights.ts");

// ---------- Lectura de puertos: dúplex, VLAN, miembros de agregado y errores ----------
const STATUS = `
Port      Name               Status       Vlan       Duplex  Speed Type
Gi1/0/1   uplink-core        connected    trunk      a-full a-1000 10/100/1000BaseTX
Gi1/0/2   impresora piso 2   connected    10         a-full a-1000 10/100/1000BaseTX
Gi1/0/3                      notconnect   1            auto   auto 10/100/1000BaseTX
Gi1/0/4                      connected    20         a-full  a-100 10/100/1000BaseTX
Gi1/0/5                      connected    trunk      a-full a-1000 10/100/1000BaseTX
Gi1/0/6                      connected    trunk      a-full a-1000 10/100/1000BaseTX
Vl10                         connected    routed       auto   auto
sw1#`;
const ETHERCHANNEL = `
Group  Port-channel  Protocol    Ports
------+-------------+-----------+-----------------------------------------------
1      Po1(SU)         LACP      Gi1/0/5(D)  Gi1/0/6(P)
sw1#`;
const ERRORS = `
Port        Align-Err     FCS-Err    Xmit-Err     Rcv-Err  UnderSize  OutDiscards
Gi1/0/1             0           0           0           0          0            0
Gi1/0/6             0         152           0         152          0            0

Port      Single-Col  Multi-Col   Late-Col  Excess-Col  Carri-Sen      Runts     Giants
Gi1/0/1            0          0          0          77          0          0          0
sw1#`;
const ports = T.parsePortInfo([STATUS, ETHERCHANNEL, ERRORS]);
assert.deepEqual(
  { ...ports["gi1/0/1"] },
  { status: "connected", speed: "a-1000", desc: "uplink-core", vlan: "trunk", duplex: "a-full", crc: "0" },
);
assert.equal(ports["gi1/0/5"].lag, "D");
assert.equal(ports["gi1/0/6"].lag, "P");
assert.equal(ports["gi1/0/6"].crc, "152");
// La segunda tabla (colisiones) no pisa los FCS.
assert.equal(ports["gi1/0/1"].crc, "0");

const HUAWEI_BRIEF = `
Interface                   PHY   Protocol  InUti OutUti   inErrors  outErrors
GigabitEthernet0/0/1        up    up           0%     0%          12          0
GigabitEthernet0/0/2        down  down         0%     0%           0          0
<HW>`;
const hw = T.parsePortInfo([HUAWEI_BRIEF]);
assert.equal(hw["gi0/0/1"].inErr, "12");
assert.equal(hw["gi0/0/1"].status, "up/up");

// ---------- CDP/LLDP: VLAN nativa, dúplex y capacidades del vecino ----------
const cdp = (dev, ip, platform, caps, local, remote, extra = "") => `-------------------------
Device ID: ${dev}
Entry address(es):
  IP address: ${ip}
Platform: ${platform},  Capabilities: ${caps}
Interface: ${local},  Port ID (outgoing port): ${remote}
Holdtime : 150 sec
${extra}
`;
const SW1_CDP =
  cdp("sw2.lab", "10.0.0.2", "cisco WS-C2960X-48", "Switch IGMP", "GigabitEthernet1/0/1", "GigabitEthernet0/1", "Native VLAN: 10\nDuplex: half") +
  cdp("SEP001122334455", "10.0.0.50", "Cisco IP Phone 8845", "Host Phone Two-port Mac Relay", "GigabitEthernet1/0/4", "Port 1") +
  cdp("sw3", "192.168.1.5", "cisco C9300-48P", "Router Switch IGMP", "GigabitEthernet1/0/5", "TenGigabitEthernet1/1/1", "Native VLAN: 1\nDuplex: full") +
  cdp("sw3", "192.168.1.5", "cisco C9300-48P", "Router Switch IGMP", "GigabitEthernet1/0/6", "TenGigabitEthernet1/1/2", "Native VLAN: 1\nDuplex: full");
const n1 = T.parseNeighbors("cisco", [SW1_CDP]);
const sw2nb = n1.find((n) => n.name === "sw2.lab");
assert.equal(sw2nb.remoteNative, "10");
assert.equal(sw2nb.remoteDuplex, "half");
assert.equal(sw2nb.caps, "Switch IGMP");

const HUAWEI_LLDP = `GigabitEthernet0/0/1 has 1 neighbor(s):

Neighbor index : 1
Chassis type   :macAddress
Chassis ID     :00e0-fc12-3456
Port ID type   :interfaceName
Port ID        :GigabitEthernet0/0/24
System name    :core-hw
System description :Huawei Versatile Routing Platform Software VRP (R) software, Version 5.170 (S5720 V200R011C10SPC500)
System capabilities enabled   :bridge
Port VLAN ID(PVID)  :99
Management address  :10.0.0.9
`;
const hn = T.parseNeighbors("huawei", [HUAWEI_LLDP])[0];
assert.equal(hn.remoteNative, "99");
assert.equal(hn.caps, "bridge");

// ---------- Revisiones sobre enlaces ----------
let t = T.mergeNeighbors({ nodes: [], links: [] }, { name: "sw1", ip: "10.0.0.1", ports }, n1);
let checks = I.linkChecks(t);
const keyOf = (b, aPort) => T.linkKey(t.links.find((l) => (l.b === b || l.a === b) && (l.aPort === aPort || l.bPort === aPort)));
const kinds = (k) => (checks.get(k) ?? []).map((i) => `${i.kind}:${i.sev}`).sort();
// sw2 anuncia half dúplex; sw1 está en full.
assert.deepEqual(kinds(keyOf("sw2", "Gi1/0/1")), ["duplex:crit"]);
// Gi1/0/5 fuera del Po1; Gi1/0/6 con CRC.
assert.deepEqual(kinds(keyOf("sw3", "Gi1/0/5")), ["lag:crit"]);
assert.deepEqual(kinds(keyOf("sw3", "Gi1/0/6")), ["errors:warn"]);
assert.match(checks.get(keyOf("sw3", "Gi1/0/6"))[0].text, /152 errores CRC/);
// El teléfono: access (20) a 100 Mb/s, sin datos del otro lado: nada que comparar.
assert.equal(checks.get(keyOf("sep001122334455", "Gi1/0/4")), undefined);
// Asimetría: sw2 explorado sin informar a sw1.
t = T.mergeNeighbors(t, { name: "sw2" }, []);
checks = I.linkChecks(t);
assert.deepEqual(kinds(keyOf("sw2", "Gi1/0/1")), ["asym:warn", "duplex:crit"]);
// sw2 informa el enlace (y la VLAN nativa 1 de sw1): ya no hay asimetría, sí VLAN nativa distinta.
const SW2_CDP = cdp("sw1", "10.0.0.1", "cisco C9200L-24P", "Switch IGMP", "GigabitEthernet0/1", "GigabitEthernet1/0/1", "Native VLAN: 1\nDuplex: full");
t = T.mergeNeighbors(t, { name: "sw2" }, T.parseNeighbors("cisco", [SW2_CDP]));
checks = I.linkChecks(t);
assert.deepEqual(kinds(keyOf("sw2", "Gi1/0/1")), ["duplex:crit", "native:warn"]);
// Volver a leer sw1 conserva lo que anunció sw2 de su puerto (VLAN nativa 1 en Gi1/0/1).
t = T.mergeNeighbors(t, { name: "sw1", ip: "10.0.0.1", ports }, n1);
assert.equal(T.portOf(t.nodes.find((n) => n.id === "sw1"), "Gi1/0/1").native, "1");
assert.equal(I.worstSev(I.linkChecks(t).get(keyOf("sw2", "Gi1/0/1"))), "crit");

assert.equal(I.speedMbps("a-1000"), 1000);
assert.equal(I.speedMbps("10G"), 10000);
assert.equal(I.speedMbps("auto"), undefined);
assert.equal(I.normDuplex("a-half"), "half");

// ---------- Rol, fabricante y filtros ----------
const byId = (id) => t.nodes.find((n) => n.id === id);
assert.equal(I.nodeRole(byId("sw2")), "switch");
assert.equal(I.nodeRole(byId("sep001122334455")), "phone");
assert.equal(I.nodeRole({ name: "ap-01", platform: "cisco AIR-AP2802I-A-K9" }), "ap");
assert.equal(I.nodeRole({ name: "fw", platform: "FortiGate-100F" }), "firewall");
assert.equal(I.nodeRole({ name: "x", caps: "B,W" }), "ap");
assert.equal(I.nodeVendor(byId("sw3")), "cisco");
assert.equal(I.nodeVendor({ platform: "Huawei Versatile Routing Platform" }), "huawei");

const f = { ...I.NO_FILTER };
assert.equal(I.filterView(t, f), t);
assert.deepEqual(I.filterView(t, { ...f, roles: ["phone"] }).nodes.map((n) => n.id), ["sep001122334455"]);
const near = I.filterView(t, { ...f, hops: 1, focus: "sw2" });
assert.deepEqual(near.nodes.map((n) => n.id).sort(), ["sw1", "sw2"]);
assert.equal(near.links.length, 1);
assert.equal(I.filterView(t, { ...f, states: ["pendiente"] }).links.length, 0);

// ---------- Búsqueda ----------
assert.deepEqual(I.searchTopo(t, "10.0.0.2").map((h) => [h.id, h.what]), [["sw2", "IP"]]);
assert.deepEqual(I.searchTopo(t, "GigabitEthernet1/0/5").map((h) => [h.id, h.what]), [["sw1", "interfaz"]]);
assert.equal(I.searchTopo(t, "sw")[0].what, "nombre");
assert.equal(I.searchTopo(t, "sw2")[0].id, "sw2");
assert.deepEqual(I.searchTopo(t, "impresora").map((h) => h.id), ["sw1"]);
assert.deepEqual(I.searchTopo(t, "x"), []);
const withMac = {
  ...t,
  nodes: t.nodes.map((n) => (n.id === "sw1" ? { ...n, macs: { "gi1/0/2": { port: "Gi1/0/2", total: 1, macs: [{ mac: "a0b1.c2d3.e4f5", vendor: "HP" }] } } } : n)),
};
assert.deepEqual(I.searchTopo(withMac, "A0:B1:C2:D3:E4:F5").map((h) => [h.id, h.what, h.detail]), [["sw1", "MAC", "a0b1.c2d3.e4f5 en Gi1/0/2"]]);

// ---------- Puertos activos sin vecino ----------
const l2 = I.unknownL2(withMac);
// Gi1/0/2 está activo sin vecino (y tiene una MAC HP); Gi1/0/3 está caído, Vl10 es lógica.
assert.deepEqual(l2.get("sw1"), { ports: ["Gi1/0/2"], macs: 1, vendors: ["HP"] });
assert.equal(l2.has("sw2"), false);

// ---------- Alcance ----------
assert.equal(I.parseCidrs("10.0.0.0/8, 192.168.1.0/24").ranges.length, 2);
assert.match(I.parseCidrs("10.0.0.0/33").error, /no válida/);
assert.equal(I.inRanges("10.200.1.1", I.parseCidrs("10.0.0.0/8").ranges), true);
const empty = { nodes: [], links: [] };
let sc = I.scopeNeighbors(empty, "sw1", n1, { skipEndpoints: true, cidrs: "", maxDepth: 0 });
assert.deepEqual(sc.kept.map((n) => n.name).sort(), ["sw2.lab", "sw3", "sw3"]);
assert.match(sc.skipped[0], /SEP001122334455 \(teléfono\)/);
sc = I.scopeNeighbors(empty, "sw1", n1, { skipEndpoints: false, cidrs: "10.0.0.0/24", maxDepth: 0 });
assert.deepEqual(sc.kept.map((n) => n.name).sort(), ["SEP001122334455", "sw2.lab"]);
// Un equipo que ya está en el diagrama no se descarta.
sc = I.scopeNeighbors(t, "sw1", n1, { skipEndpoints: true, cidrs: "10.0.0.0/24", maxDepth: 0 });
assert.equal(sc.skipped.length, 0);
// Profundidad: sw2 está a 1 salto de sw1; con tope 1, sus vecinos nuevos quedan fuera.
sc = I.scopeNeighbors(t, "sw2", [{ name: "sw9", localPort: "Gi0/2", remotePort: "Gi0/1", proto: "CDP" }], { skipEndpoints: false, cidrs: "", maxDepth: 1 });
assert.deepEqual(sc.kept, []);
assert.match(sc.skipped[0], /más de 1 saltos/);

// ---------- Vista por excepción: marcadores, estado del enlace, ficha y lista de atención ----------
{
  const mk = (id, ports) => ({ id, name: id, explored: true, x: 1, y: 1, ports });
  const topo = {
    nodes: [
      mk("core", {
        "gi1/0/1": { status: "connected", speed: "a-1000", duplex: "a-full", vlan: "trunk", group: "Po1", lag: "P" },
        "gi1/0/2": { status: "connected", speed: "a-1000", duplex: "a-full", vlan: "trunk", group: "Po1", lag: "s" },
        "gi1/0/3": { status: "err-disabled", speed: "auto" },
        "gi1/0/4": { status: "connected", speed: "a-1000", duplex: "a-full", crc: "12" },
        "gi1/0/5": { status: "connected", speed: "a-1000", duplex: "a-full" },
      }),
      mk("dist", {
        "gi1/0/48": { status: "connected", speed: "a-1000", duplex: "a-full", vlan: "trunk", group: "Po1", lag: "P" },
        "gi1/0/47": { status: "connected", speed: "a-1000", duplex: "a-full", vlan: "trunk", group: "Po1", lag: "P" },
        "gi1/0/24": { status: "connected", speed: "a-1000", duplex: "a-full" },
      }),
      mk("acc1", { "gi1/0/24": { status: "connected", speed: "a-1000", duplex: "a-full" } }),
      mk("acc2", { "gi1/0/24": { duplex: "half" } }),
      { id: "ghost", name: "ghost", explored: false, x: 1, y: 1 },
    ],
    links: [
      { a: "core", aPort: "Gi1/0/1", b: "dist", bPort: "Gi1/0/48", proto: "CDP", seenBy: ["core", "dist"] },
      { a: "core", aPort: "Gi1/0/2", b: "dist", bPort: "Gi1/0/47", proto: "CDP", seenBy: ["core", "dist"] },
      { a: "core", aPort: "Gi1/0/3", b: "acc1", bPort: "Gi1/0/24", proto: "CDP", seenBy: ["core", "acc1"] },
      { a: "core", aPort: "Gi1/0/4", b: "ghost", bPort: "", proto: "LLDP", seenBy: ["core"] },
      { a: "dist", aPort: "Gi1/0/24", b: "acc2", bPort: "Gi1/0/24", proto: "CDP", seenBy: ["dist", "acc2"] },
      { a: "core", aPort: "Gi1/0/5", b: "acc2", bPort: "Gi1/0/23", proto: "CDP", seenBy: ["core", "acc2"] },
    ],
  };
  const key = (i) => T.linkKey(topo.links[i]);
  const ck = I.linkChecks(topo);
  // Cada hallazgo trae su frase corta y el extremo afectado.
  const lag = ck.get(key(1)).find((i) => i.kind === "lag");
  assert.equal(lag.end, "a");
  assert.equal(lag.short, "Gi1/0/2 fuera de Po1");
  const err = ck.get(key(2)).find((i) => i.kind === "down");
  assert.deepEqual({ end: err.end, sev: err.sev, short: err.short }, { end: "a", sev: "crit", short: "Gi1/0/3 err-disabled" });
  const crc = ck.get(key(3)).find((i) => i.kind === "errors");
  assert.equal(crc.short, "12 errores CRC en Gi1/0/4");
  assert.equal(crc.end, "a");
  const dup = ck.get(key(4)).find((i) => i.kind === "duplex");
  assert.deepEqual({ end: dup.end, short: dup.short }, { end: "both", short: "Dúplex distinto: full/half" });
  // Marcadores: "!" en el extremo afectado; el caído se ve en el trazo y no lleva marcador.
  assert.deepEqual(I.markEnds(ck.get(key(1))), { a: true, b: false });
  assert.deepEqual(I.markEnds(ck.get(key(3))), { a: true, b: false });
  assert.deepEqual(I.markEnds(ck.get(key(4))), { a: true, b: true });
  assert.deepEqual(I.markEnds(ck.get(key(2))), { a: false, b: false });
  assert.deepEqual(I.markEnds(undefined), { a: false, b: false });
  // err-disabled y puerto caído cuentan como caído; el rojo no se usa para eso.
  assert.equal(I.portDown("err-disabled"), "err-disabled");
  assert.equal(I.portDown("notconnect"), "down");
  assert.equal(I.portDown("administratively down"), "down");
  assert.equal(I.portDown("connected"), undefined);
  assert.equal(I.portDown("up/up"), undefined);
  assert.equal(I.linkLevelOf(ck.get(key(2)), undefined), "down");
  assert.equal(I.linkLevelOf(ck.get(key(2)), { ab: 1e9, ba: 0, speed: 1e9, util: 1, ts: 1 }), "down", "caído gana sobre la carga");
  assert.equal(I.linkLevelOf(undefined, { ab: 0.8e9, ba: 0, speed: 1e9, util: 0.8, ts: 1 }), "high");
  assert.equal(I.linkLevelOf(undefined, { ab: 0.95e9, ba: 0, speed: 1e9, util: 0.95, ts: 1 }), "saturated");
  assert.equal(I.linkLevelOf(undefined, { ab: 0.5e9, ba: 0, speed: 1e9, util: 0.5, ts: 1 }), "normal");
  assert.equal(I.linkLevelOf(ck.get(key(3)), undefined), "normal", "un problema de interfaz no cambia el trazo");
  assert.equal(I.linkLevelOf(undefined, undefined), "normal");

  // Estado leído en vivo (show interfaces): se suma al guardado y manda lo más reciente.
  const live = new Map([["acc1", new Map([["gi1/0/24", { duplex: "half", crc: "7" }]])]]);
  const ck2 = I.linkChecks(topo, live);
  assert.deepEqual(ck2.get(key(2)).map((i) => i.kind).sort(), ["down", "duplex", "errors"]);
  assert.equal(I.linkChecks(topo).get(key(2)).some((i) => i.kind === "duplex"), false, "sin lectura en vivo no cambia");
  assert.equal(topo.nodes[2].ports["gi1/0/24"].duplex, "a-full", "no se escribe en el diagrama");

  // Ficha del enlace.
  const rates = new Map([
    [key(0), { ab: 960e6, ba: 120e6, speed: 1e9, util: 0.96, ts: 1000, src: "snmp" }],
    [key(1), { ab: 400e6, ba: 100e6, speed: 1e9, util: 0.4, ts: 1000, src: "snmp" }],
    [key(4), { ab: 5e6, ba: 9e6, speed: 1e9, util: 0.009, ts: 2000, src: "cli" }],
  ]);
  const d0 = I.linkDetail(topo, topo.links[0], { lt: rates.get(key(0)), issues: ck.get(key(0)) });
  assert.equal(d0.aName, "core");
  assert.equal(d0.level, "saturated");
  assert.equal(d0.group, "Po1");
  assert.deepEqual(d0.members.map((m) => m.aPort), ["Gi1/0/1", "Gi1/0/2"]);
  assert.equal(d0.members[1].lag, "s");
  assert.deepEqual(d0.ends, [{ text: "Gi1/0/1 ↔ Gi1/0/48 · 1G · connected" }], "ambos extremos iguales: una línea");
  assert.deepEqual(d0.dirs.map((x) => [x.label, x.from, x.to, x.level]), [["Baja", "core", "dist", "saturated"], ["Sube", "dist", "core", "normal"]]);
  assert.equal(Math.round(d0.dirs[0].util * 100), 96);
  assert.equal(d0.source, "SNMP");
  assert.equal(d0.ts, 1000);
  assert.deepEqual(d0.findings, []);
  assert.equal(d0.hasPortData, true);
  // Extremos distintos: dos líneas, con el equipo de cada una.
  const d4 = I.linkDetail(topo, topo.links[4], { lt: rates.get(key(4)), issues: ck.get(key(4)) });
  assert.equal(d4.ends.length, 2);
  assert.equal(d4.ends[0].name, "dist");
  assert.equal(d4.source, "Consola");
  assert.deepEqual(d4.findings, [{ sev: "crit", text: "Dúplex distinto: full/half" }]);
  assert.equal(d4.dirs[0].level, "normal");
  assert.equal(d4.level, "normal");
  // Sin lectura de tráfico: sin barras ni fuente; caído y hallazgos igual.
  const d2 = I.linkDetail(topo, topo.links[2], { issues: ck.get(key(2)) });
  assert.deepEqual(d2.dirs, []);
  assert.equal(d2.source, undefined);
  assert.equal(d2.level, "down");
  assert.match(d2.findings[0].text, /Gi1\/0\/3 err-disabled/);
  // Sin datos de puertos de ningún extremo no se puede decir "Sin errores".
  const d3 = I.linkDetail({ nodes: [mk("p", undefined), mk("q", undefined)], links: [] }, { a: "p", aPort: "Gi1", b: "q", bPort: "Gi2", proto: "CDP" });
  assert.equal(d3.hasPortData, false);
  assert.equal(d3.proto, "CDP");
  assert.equal(I.linkDetail(topo, { ...topo.links[0], logical: true }).proto, "CDP lógica");

  // Lista "Requieren atención": solo alto, saturado, caído o con problemas; caído y saturado primero, luego por uso.
  const rates2 = new Map([
    ...rates,
    [key(5), { ab: 780e6, ba: 100e6, speed: 1e9, util: 0.78, ts: 1000, src: "snmp" }],
  ]);
  const rows = I.attentionRows(topo, ck, rates2);
  assert.deepEqual(rows.map((r) => [r.key === key(2) ? "err-disabled" : r.key === key(0) ? "po1-sat" : r.key === key(5) ? "alto" : r.key === key(1) ? "po1-miembro" : r.key === key(3) ? "crc" : "dup", r.level]), [
    ["err-disabled", "down"],
    ["po1-sat", "saturated"],
    ["alto", "high"],
    ["po1-miembro", "issues"],
    ["dup", "issues"],
    ["crc", "issues"],
  ]);
  assert.equal(rows[0].phrase, "Gi1/0/3 err-disabled");
  assert.equal(rows[1].phrase, "Saturado bajando · 1G");
  assert.equal(rows[2].phrase, "Alto bajando · 1G");
  assert.equal(rows[3].phrase, "Gi1/0/2 fuera de Po1");
  assert.equal(rows[4].phrase, "Dúplex distinto: full/half");
  assert.equal(rows[5].phrase, "12 errores CRC en Gi1/0/4");
  // Alto con un problema de interfaz: "Alto · 12 errores CRC en Gi1/0/4".
  const hi = I.attentionRows(topo, ck, new Map([[key(3), { ab: 8e8, ba: 1e6, speed: 1e9, util: 0.8, ts: 1 }]]));
  assert.equal(hi.find((r) => r.key === key(3)).phrase, "Alto · 12 errores CRC en Gi1/0/4");
  // Lo normal no entra, y un enlace quitado (skip) tampoco.
  assert.equal(I.attentionRows(topo, new Map(), new Map([[key(0), { ab: 1e8, ba: 1e8, speed: 1e9, util: 0.1, ts: 1 }]])).length, 0, "todo normal");
  assert.equal(I.attentionRows(topo, new Map(), new Map([[key(0), { ab: 1e8, ba: 1e8, util: undefined, ts: 1 }]])).length, 0, "sin velocidad: como normal");
  assert.equal(I.attentionRows(topo, ck, rates2, new Set([key(2)])).some((r) => r.key === key(2)), false);
  // Entre dos saturados, el de más uso primero; entre dos caídos, orden por nombre.
  const two = I.attentionRows(topo, new Map(), new Map([[key(0), { ab: 920e6, ba: 0, speed: 1e9, util: 0.92, ts: 1 }], [key(5), { ab: 990e6, ba: 0, speed: 1e9, util: 0.99, ts: 1 }]]));
  assert.deepEqual(two.map((r) => r.key), [key(5), key(0)]);
  // Cobertura: enlaces con datos de puertos (y en ambos extremos).
  const cov = I.checkCoverage(topo);
  assert.equal(cov.links, 6);
  assert.equal(cov.withData, 6);
  assert.equal(cov.both, 4, "dos enlaces tienen datos de un solo extremo");

  // Textos auxiliares.
  assert.equal(I.speedShort(1e9), "1G");
  assert.equal(I.speedShort(10e9), "10G");
  assert.equal(I.speedShort(2.5e9), "2.5G");
  assert.equal(I.speedShort(100e6), "100M");
  assert.equal(I.ageText(10_000, 18_000), "hace 8 s");
  assert.equal(I.ageText(0, 150_000), "hace 3 min");
  assert.equal(I.ageText(0, 7_300_000), "hace 2 h");
  assert.equal(I.ageText(5000, 1000), "hace 0 s");
}

// ---------- Rendimiento: 2000 equipos y 4000 enlaces ----------
const big = { nodes: [], links: [] };
for (let i = 0; i < 2000; i++) {
  big.nodes.push({ id: `n${i}`, name: `n${i}`, ip: `10.${i >> 8}.${i & 255}.1`, explored: true, x: i, y: i, platform: "cisco C9300", ports: { "gi1/0/1": { status: "connected", duplex: "full", speed: "1000" }, "gi1/0/2": { status: "connected" } } });
  if (i) big.links.push({ a: `n${i - 1}`, aPort: "Gi1/0/1", b: `n${i}`, bPort: "Gi1/0/1", proto: "CDP", seenBy: [`n${i - 1}`] });
  if (i > 1) big.links.push({ a: `n${i - 2}`, aPort: "Gi1/0/3", b: `n${i}`, bPort: "Gi1/0/4", proto: "LLDP" });
}
fastEnough("revisiones 4000 enlaces", 40, () => I.linkChecks(big));
fastEnough("filtro a 3 saltos", 40, () => I.filterView(big, { ...I.NO_FILTER, roles: ["switch"], hops: 3, focus: "n1000" }));
fastEnough("búsqueda en 2000 equipos", 40, () => I.searchTopo(big, "gi1/0/9"));
fastEnough("L2 desconocido", 40, () => I.unknownL2(big));

console.log("topoInsights: ok");
