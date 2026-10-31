// Pruebas del resaltado por fabricante: `node scripts/tests/highlight.test.mjs` (Node 22.15+ con tipos TS).
// Cada caso es una línea real de salida y los tramos que deben quedar pintados, con el nombre de la
// regla que los pinta (el esquema del fabricante va antes que el común, como en la app).
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { fastEnough } from "./timing.mjs";

// highlight.ts importa ./hlPalette sin extensión (como lo resuelve Vite): se completa con .ts.
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

const { compile, effectiveRules, runs, schemes } = await import("../../src/lib/highlight.ts");

const rulesFor = (id) => compile(effectiveRules({ enabled: true, schemes: [id, "common"], custom: [] }));
/** Tramos pintados de una línea: [[texto, regla], ...]. */
function painted(line, rules) {
  return runs(line, rules).map(([s, e, i]) => [line.slice(s, e), rules[i].style]);
}
function expectSpans(id, line, want) {
  const rules = rulesFor(id);
  const got = runs(line, rules).map(([s, e]) => line.slice(s, e));
  for (const w of want) assert.ok(got.includes(w), `${id}: "${w}" sin pintar en ${JSON.stringify(line)} (pintado: ${JSON.stringify(got)})`);
}
function expectPlain(id, line, text) {
  const got = painted(line, rulesFor(id)).map(([t]) => t);
  assert.ok(!got.some((t) => t.includes(text)), `${id}: "${text}" no debería pintarse en ${JSON.stringify(line)} (pintado: ${JSON.stringify(got)})`);
}

// ---------- Cisco (IOS, IOS-XE, NX-OS, IOS-XR, ASA) ----------
expectSpans("cisco", "core-sw01#show interfaces status", ["core-sw01#"]);
expectSpans("cisco", "RP/0/RSP0/CPU0:xr01#show ipv4 interface brief", ["RP/0/RSP0/CPU0:xr01#"]);
expectSpans("cisco", "AppGigabitEthernet1/0/1 is up, line protocol is up", ["AppGigabitEthernet1/0/1", "up"]);
expectSpans("cisco", "port-channel10  1    eth  trunk  up      none", ["port-channel10"]);
expectSpans("cisco", "MgmtEth0/RSP0/CPU0/0  192.0.2.20  Up  Up  default", ["MgmtEth0/RSP0/CPU0/0", "192.0.2.20"]);
expectSpans("cisco", "FourHundredGigE0/0/0/0  unassigned  Shutdown  Down  default", ["FourHundredGigE0/0/0/0", "Down"]);
expectSpans("cisco", "*Oct 14 09:12:44: %LINK-3-UPDOWN: Interface GigabitEthernet1/0/3, changed state to down", ["%LINK-3-UPDOWN", "GigabitEthernet1/0/3", "down"]);
expectSpans("cisco", "%ASA-4-106023: Deny tcp src outside:198.51.100.7/443", ["%ASA-4-106023", "Deny"]);
// Una línea de salida que solo contiene "#" más adelante no es un prompt.
expectPlain("cisco", "  enlace #2 a core", "enlace #");

// ---------- Huawei VRP / H3C Comware ----------
expectSpans("huawei", "<HUAWEI>display interface brief", ["<HUAWEI>"]);
expectSpans("huawei", "MultiGE0/0/1  up  up", ["MultiGE0/0/1"]);
expectSpans("huawei", "Vbdif100  up  up", ["Vbdif100"]);
expectSpans("huawei", "Ten-GigabitEthernet1/0/49  DOWN", ["Ten-GigabitEthernet1/0/49", "DOWN"]);
expectSpans("huawei", "Bridge-Aggregation1  UP   2G(a)   F(a)   T    1", ["Bridge-Aggregation1"]);
expectSpans("huawei", "Vlan-interface10     UP   UP       192.0.2.1", ["Vlan-interface10"]);
expectSpans("huawei", "M-GigabitEthernet0/0/0  UP  UP  192.0.2.2", ["M-GigabitEthernet0/0/0"]);
expectSpans("huawei", "Oct 14 2026 09:12:44 HUAWEI %%01IFNET/4/LINK_STATE(l)[0]:The line protocol", ["%%01IFNET/4/LINK_STATE"]);
expectSpans("huawei", "%Oct 14 09:12:44:123 2026 H3C IFNET/3/PHY_UPDOWN: Physical state changed to down.", ["IFNET/3/PHY_UPDOWN"]);

// ---------- Fortinet (FortiGate, FortiSwitch, FortiAP, FortiExtender) ----------
expectSpans("fortinet", "S524DF4K15000024 # diagnose switch physical-ports summary", ["S524DF4K15000024 #"]);
expectSpans("fortinet", "   port1      up      1000-full     on", ["port1", "up"]);
expectSpans("fortinet", "        ==[wan1]", ["wan1"]);
expectSpans("fortinet", 'date=2026-10-14 level="warning" action="login" status="failed"', ['level="warning"']);
expectSpans("fortinet", 'date=2026-10-14 level="error" logdesc="Admin login failed"', ['level="error"']);
expectPlain("fortinet", "debug value 0x7fff", "x7");

// ---------- Aruba (AOS-CX, ArubaOS-Switch, ArubaOS) ----------
expectSpans("aruba", "core-cx(config-if)# no shutdown", ["core-cx(config-if)#", "no shutdown"]);
expectSpans("aruba", "1/1/48     --      routed  --       no      down    Administratively down", ["1/1/48", "down"]);
expectSpans("aruba", "lag1       10      trunk   --       yes     up      --", ["lag1", "up"]);
expectSpans("aruba", "2026-10-14T09:12:45 core-cx vsx-syncd[555]: Event|7911|LOG_ERR|AMM|-|VSX ISL is down", ["LOG_ERR", "down"]);
expectSpans("aruba", "  Trk1                | No        Yes     Down   1000FDx", ["Trk1", "Down"]);
expectSpans("aruba", "  1/A1     SFP+SR     | No        Yes     Up     10GigFD", ["1/A1"]);
expectSpans("aruba", "W 10/14/26 09:12:45 00077 ports: port 2 is now off-line", ["W"]);
expectSpans("aruba", "(Aruba7005) [mynode] (config) #ap-group default", ["(Aruba7005) [mynode] (config) #"]);
// Las fechas del log de ArubaOS-Switch no son puertos de AOS-CX.
expectPlain("aruba", "I 10/14/26 09:12:44 00076 ports: port 1 is now on-line", "10/14/26");

// ---------- Grandstream GWN78xx ----------
expectSpans("grandstream", "GWN7813# show interface brief", ["GWN7813#"]);
expectSpans("grandstream", "Ethernet 1/0/1    up      1000M-full   access  1", ["Ethernet 1/0/1", "up"]);
expectSpans("grandstream", "lag 1             up      2000M-full   trunk   1", ["lag 1"]);

// ---------- Check Point Gaia ----------
expectSpans("checkpoint", "[Expert@gw-01:0]# cphaprob state", ["[Expert@gw-01:0]#"]);
expectSpans("checkpoint", "gw-01:0> show interfaces all", ["gw-01:0>"]);
expectSpans("checkpoint", "1 (local)  192.0.2.1   100%   ACTIVE    gw-01", ["ACTIVE", "192.0.2.1"]);
expectSpans("checkpoint", "1 (local)  192.0.2.1   100%   ACTIVE(!)  gw-01", ["ACTIVE(!)"]);
expectSpans("checkpoint", "2          192.0.2.2   0%     STANDBY   gw-02", ["STANDBY"]);
expectSpans("checkpoint", "eth1-01  UP  10.1.1.1/24", ["eth1-01", "UP", "10.1.1.1/24"]);

// ---------- Reglas: salidas típicas, falsos positivos y negativos ----------
const styleOf = (id, line, text) => painted(line, rulesFor(id)).find(([t]) => t === text)?.[1];
expectSpans("cisco", "Gi1/0/1  uplink  connected  1  a-full  a-1000  10/100/1000BaseTX", ["connected", "full"]);
expectSpans("cisco", "Gi1/0/2  user    notconnect 10 auto   auto    10/100/1000BaseTX", ["notconnect"]);
expectSpans("cisco", "Gi1/0/3  loop    err-disabled 10 auto auto", ["err-disabled"]);
expectSpans("cisco", "Gi1/0/4  x       not connected 10", ["not connected"]);
expectPlain("cisco", "Interface  IP-Address  OK? Method Status  Protocol", "OK?");
expectSpans("cisco", "     12 CRC, 0 frame, 3 overrun, 0 ignored", ["12 CRC"]);
expectPlain("cisco", "     0 input errors, 0 CRC, 0 frame, 0 overrun, 0 ignored", "0 CRC");
expectSpans("cisco", "  Total output drops: 15", ["Total output drops: 15"]);
expectPlain("cisco", "  Total output drops: 0", "Total output drops: 0");
expectSpans("cisco", "RP/0/RSP0/CPU0:Oct 14 09:12:44 : ifmgr[225]: %PKT_INFRA-LINK-3-UPDOWN : Interface Gi0/0/0/1, changed state to Down", ["%PKT_INFRA-LINK-3-UPDOWN", "Down"]);
expectPlain("cisco", "Press up a line to scroll", "up");
expectPlain("cisco", "Uptime is 3 weeks", "Uptime");
expectSpans("cisco", "Gi1/0/5  x  connected  1  half  100", ["half"]);
expectSpans("juniper", "error: syntax error, expecting <command>", ["error: syntax error, expecting <command>"]);
expectSpans("juniper", "ge-0/0/0  up  down", ["up", "down"]);
expectSpans("huawei", "[~HUAWEI-GigabitEthernet0/0/1]", ["[~HUAWEI-GigabitEthernet0/0/1]"]);
expectSpans("huawei", "[*HUAWEI]", ["[*HUAWEI]"]);
expectSpans("huawei", "% Unrecognized command found at '^' position.", ["% Unrecognized command found at '^' position."]);
expectSpans("fortinet", 'date=2026-10-14 action="login" status="failed" reason="passwd_invalid"', ["failed"]);
expectSpans("fortinet", "Command fail. Return code -3", ["Command fail. Return code -3"]);

// El estado malo siempre va en negrita (no depende solo del rojo) y el bueno no.
for (const [id, line, bad, good] of [
  ["cisco", "Gi1/0/1  connected   Gi1/0/2  notconnect", "notconnect", "connected"],
  ["huawei", "GE0/0/1  up  up   GE0/0/2  down  down", "down", "up"],
  ["aruba", "1/1/1  up   1/1/2  down", "down", "up"],
]) {
  assert.equal(styleOf(id, line, bad)?.bold, true, `${id}: "${bad}" debe ir en negrita`);
  assert.ok(!styleOf(id, line, good)?.bold, `${id}: "${good}" no debe ir en negrita`);
  assert.notEqual(styleOf(id, line, bad)?.color, styleOf(id, line, good)?.color);
}

// ---------- Paleta de resaltado por tema: contraste y distinción ----------
const { presets } = await import("../../src/lib/theme.ts");
const pal = await import("../../src/lib/hlPalette.ts");
const { cssColor } = await import("../../src/lib/highlight.ts");
const NAMES = ["red", "green", "yellow", "blue", "magenta", "cyan", "white", "gray", "brightRed", "brightGreen", "brightYellow", "brightBlue", "brightMagenta", "brightCyan"];
for (const p of presets) {
  const th = p.theme;
  const pl = pal.resolvePalette(th);
  for (const n of NAMES) {
    const c = pl[n];
    const min = n === "gray" ? pal.MIN_CONTRAST_MUTED : pal.MIN_CONTRAST;
    assert.ok(pal.contrast(c, th.background) >= min - 0.01, `${p.id}: ${n} ${c} contraste ${pal.contrast(c, th.background).toFixed(2)} < ${min}`);
    if (n !== "white") assert.ok(pal.deltaE(c, th.foreground) >= pal.MIN_DELTA_E - 0.005, `${p.id}: ${n} ${c} demasiado parecido al texto (ΔE ${pal.deltaE(c, th.foreground).toFixed(3)})`);
    assert.equal(cssColor(n, th), c, `${p.id}: la vista previa y la terminal usan la misma paleta`);
  }
  for (const [r, g] of [["red", "green"], ["brightRed", "brightGreen"]]) {
    assert.ok(Math.abs(pal.lightness(pl[r]) - pal.lightness(pl[g])) >= pal.MIN_RG_LIGHTNESS - 0.005, `${p.id}: ${r}/${g} solo se distinguen por tono`);
  }
  // Bueno, malo y advertencia distintos entre sí.
  for (const [a, b] of [["red", "green"], ["red", "yellow"], ["green", "yellow"]]) {
    assert.ok(pal.deltaE(pl[a], pl[b]) >= 0.07, `${p.id}: ${a} y ${b} se confunden (ΔE ${pal.deltaE(pl[a], pl[b]).toFixed(3)})`);
  }
  // Con tema, la salida lleva color real (truecolor) y no el ANSI crudo del tema.
  const c = compile([{ id: "b0", name: "x", pattern: "down", style: { color: "red", bold: true } }], th);
  assert.match(c[0].on, /38;2;\d+;\d+;\d+/, `${p.id}: el color con nombre debe resolverse contra el tema`);
}
assert.ok(pal.isMonochrome(presets.find((p) => p.id === "amber").theme), "el tema ámbar debe detectarse como monocromo");
assert.ok(!pal.isMonochrome(presets.find((p) => p.id === "dracula").theme));

// ---------- Todos los esquemas: patrones válidos y rápidos con líneas largas ----------
for (const sc of schemes) {
  const rules = rulesFor(sc.id);
  assert.equal(rules.length, sc.id === "common" ? sc.rules.length : sc.rules.length + schemes.find((x) => x.id === "common").rules.length, `${sc.id}: alguna regla no compila`);
  const long = "GigabitEthernet1/0/1 " + "a1/b2:c3 ".repeat(110);
  fastEnough(`resaltado ${sc.id} con línea larga`, 20, () => runs(long.slice(0, 999), rules));
}

console.log("highlight: ok");

// BGP: Active/Idle/Connect en el resumen de vecinos es una sesión caída; Active de HSRP no.
expectSpans("cisco", "198.51.100.2    4 65002     120     118        0    0    0 00:03:12 Active", ["Active"]);
expectSpans("cisco", "192.0.2.9       4 65001       0       0        0    0    0 never    Idle (Admin)", ["Idle (Admin)"]);
assert.equal(styleOf("cisco", "198.51.100.2    4 65002     120     118        0    0    0 00:03:12 Active", "Active")?.bold, true);
expectPlain("cisco", "Vl10        1    100 P Active  local           192.0.2.3       192.0.2.1", "Active");
console.log("highlight bgp: ok");

