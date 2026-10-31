// Pruebas de la detección de plataforma: `node scripts/tests/detect.test.mjs` (Node 22.15+ con tipos TS).
// La app la usa sin enviar nada al equipo (lee las últimas 150 líneas de la pantalla al conectar,
// tras un "show version" del usuario y al abrir el catálogo) y con el botón "Detectar". Cada caso
// es la línea característica de la salida real, al final de una pantalla llena de otra salida.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { registerHooks } from "node:module";
import { fastEnough } from "./timing.mjs";

// packs.ts importa sin extensión (como lo resuelve Vite): se completa con .ts.
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

const { buildCatalog, validatePack, detectPlatform, appliesTo, commandFor, orderPacks } = await import("../../src/lib/packs.ts");

const dir = new URL("../../src/packs/", import.meta.url);
const packs = readdirSync(dir)
  .filter((f) => f.endsWith(".json"))
  .map((f) => {
    const r = JSON.parse(readFileSync(new URL(f, dir), "utf8"));
    const id = f.replace(/\.json$/, "");
    return validatePack({ format: "netterminal-commands", formatVersion: 1, id: `builtin-${id}`, name: r.name, vendor: id, vendorName: r.name, detectCommand: r.detectCommand, platforms: r.platforms ?? [], commands: r.commands }).pack;
  })
  .filter(Boolean);
const catalog = buildCatalog(packs, []);

/** Igual que App: primero el fabricante preferido, luego el resto del catálogo. */
function detect(text, preferred) {
  const order = [...catalog].sort((a, b) => Number(b.id === preferred) - Number(a.id === preferred));
  for (const v of order) {
    const p = detectPlatform(v, text);
    if (p) return `${v.id}:${p.id}`;
  }
  return null;
}

// Pantalla llena (148 líneas de otra salida) y la línea de versión al final.
const filler = "GigabitEthernet1/0/1   unassigned  YES unset  up   up\n".repeat(148);
const CASES = [
  ["Cisco IOS XE Software, Version 17.09.04a", "cisco:iosxe"],
  ["Cisco IOS Software, C2960X Software (C2960X-UNIVERSALK9-M), Version 15.2(7)E4", "cisco:ios"],
  ["Cisco Nexus Operating System (NX-OS) Software", "cisco:nxos"],
  ["Junos: 21.4R3-S5", "juniper:junos"],
  ["Junos OS Evolved 22.4R1", "juniper:junos-evo"],
  ["Version: FortiGate-60F v7.2.5,build1517,230606 (GA.F)", "fortinet:fos72"],
  // FortiGate 30E: no pasa de FortiOS 6.2.
  ["Version: FortiGate-30E v6.2.16,build1392,240129 (GA)", "fortinet:fos62"],
  ["Version: FortiSwitch-448E-FPOE v7.2.5,build0453", "fortiswitch:fswos"],
  ["Huawei YunShan OS Version 1.24.0.1 (S6700 V600R024C00)", "huawei:yunshan"],
  ["ArubaOS (MODEL: Aruba7005), Version 8.10.0.9 LSR", "aruba:aos8"],
  ["Device Model     : GWN7813P", "grandstream:gwn-sw"],
];
for (const [line, want] of CASES) {
  const text = filler + line;
  assert.equal(detect(text, "cisco"), want, line);
  // Toda la lectura (todos los fabricantes) va fuera del camino de las teclas, pero igual debe ser
  // corta: una regex con ^ y [\s\S]* en modo multilínea la volvía cuadrática (5 ms por fabricante).
  fastEnough(`detección ${want}`, 3, () => detect(text, "cisco"));
}
// Una pantalla sin versión no inventa plataforma.
assert.equal(detect(filler, "cisco"), null);

// FortiOS 6.2: SD-WAN con virtual-wan-link, IKE con log-filter y sin los comandos solo 7.x.
const forti = JSON.parse(readFileSync(new URL("fortinet.json", dir), "utf8"));
const by = (cmd) => forti.commands.find((c) => c.cmd === cmd);
assert.equal(commandFor(by("diagnose sys sdwan health-check"), "fos62"), "diagnose sys virtual-wan-link health-check");
assert.equal(appliesTo(by("diagnose sys sdwan service"), "fos62"), true);
assert.equal(appliesTo(by("diagnose sys sdwan zone"), "fos62"), false);
assert.equal(commandFor(by("diagnose vpn ike log filter clear"), "fos62"), "diagnose vpn ike log-filter clear");

// "Mis comandos" sobreviven a una actualización que agrega el mismo comando a los incluidos:
// gana la versión del usuario (su descripción y su riesgo), y un importado no pisa a un incluido.
const builtinCisco = packs.find((p) => p.vendor === "cisco");
const mine = { ...builtinCisco, id: "user-cisco", builtin: false, name: "Mis comandos (Cisco)", commands: [{ cmd: "show version", desc: "Mi versión con notas propias", risk: "read" }] };
const fake = { ...builtinCisco, id: builtinCisco.id, builtin: false, name: "Importado con id de fábrica", commands: [{ cmd: "show clock", desc: "pisado", risk: "read" }] };
const ordered = orderPacks(packs, [fake, mine]);
assert.equal(ordered[0].id, "user-cisco");
assert.ok(!ordered.includes(fake));
const cisco = buildCatalog(ordered, []).find((v) => v.id === "cisco");
assert.equal(cisco.commands.find((c) => c.cmd === "show version").desc, "Mi versión con notas propias");
assert.notEqual(cisco.commands.find((c) => c.cmd === "show clock")?.desc, "pisado");

console.log("detect: ok");
