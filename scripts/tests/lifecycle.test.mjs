// Pruebas del ciclo de vida (modelo y versión desde la pantalla, búsqueda en la base y etapa):
// `node scripts/tests/lifecycle.test.mjs` (Node 22.15+ con tipos TS).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { fastEnough } from "./timing.mjs";

// lifecycle.ts importa módulos sin extensión (como lo resuelve Vite): se completa con .ts.
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

const L = await import("../../src/lib/lifecycle.ts");
const db = JSON.parse(readFileSync(new URL("../../src/lib/lifecycleData.json", import.meta.url), "utf8"));

// ---------- Modelo y versión desde la pantalla ----------
const filler = "Gi1/0/1   connected  10  a-full a-1000 10/100/1000BaseTX\n".repeat(120);
const cases = [
  [
    "Cisco IOS Software, C2960X Software (C2960X-UNIVERSALK9-M), Version 15.2(7)E4, RELEASE SOFTWARE (fc2)\ncisco WS-C2960X-48FPD-L (APM86XXX) processor (revision B0) with 524288K bytes of memory.\nModel number                    : WS-C2960X-48FPD-L\nsw-acceso#",
    { model: "WS-C2960X-48FPD-L", version: "15.2(7)E4" },
  ],
  [
    "Cisco IOS XE Software, Version 17.03.08a\ncisco ISR4331/K9 (1RU) processor with 1795999K/6147K bytes of memory.\nrt-sucursal#",
    { model: "ISR4331/K9", version: "17.03.08a" },
  ],
  ["  NXOS: version 9.3(10)\n  cisco Nexus9000 C93180YC-EX chassis\nn9k-01#", { model: "N9K-C93180YC-EX", version: "9.3(10)" }],
  ["Version: FortiGate-60F v7.2.5,build1517,230606 (GA.F)\nFGT60F #", { model: "FortiGate-60F", version: "7.2.5" }],
  [
    "VRP (R) software, Version 5.170 (S5720 V200R011C10SPC500)\nHUAWEI S5720-28X-SI-AC Routing Switch uptime is 10 weeks\n<HW-01>",
    { model: "S5720-28X-SI-AC", version: "V200R011C10SPC500" },
  ],
  ["Model: ex4300-48t\nJunos: 21.4R3-S5\nuser@ex01>", { model: "EX4300-48T", version: "21.4R3-S5" }],
  ['NAME: "Chassis", DESCR: "Cisco ISR4451 Chassis"\nPID: ISR4451-X/K9      , VID: V07  , SN: FDO1234\nrt#', { model: "ISR4451-X/K9" }],
];
for (const [text, want] of cases) {
  const got = L.detectDeviceInfo(filler + text);
  assert.deepEqual({ model: got.model, ...(want.version ? { version: got.version } : {}) }, want, text.slice(0, 40));
}
assert.deepEqual(L.detectDeviceInfo(filler), {});
fastEnough("detección de modelo en 150 líneas", 3, () => L.detectDeviceInfo(filler + cases[0][0]));
// Una línea enorme no la demora.
fastEnough("detección con línea larga", 3, () => L.detectDeviceInfo("cisco " + "x(".repeat(50000)));

assert.equal(L.promptHost("...\nsw-acceso#"), "sw-acceso");
assert.equal(L.promptHost("...\n<HW-01>"), "hw-01");
assert.equal(L.promptHost("...\nuser@ex01>"), "ex01");
assert.equal(L.promptHost("...\nFGT60F # "), "fgt60f");
assert.equal(L.promptHost("salida sin prompt"), undefined);

assert.equal(L.modelFromPlatform("cisco WS-C2960X-48FPD-L"), "WS-C2960X-48FPD-L");
assert.equal(L.modelFromPlatform("Meraki MS225-48LP Cloud Managed Switch"), "MS225-48LP");
assert.equal(L.modelFromPlatform("Linux"), undefined);

// ---------- Base y etapas ----------
const isr = L.findLifecycle(db, "ISR4331/K9");
assert.equal(isr.ldos, "2028-11-30");
assert.equal(isr.eosw, "2025-08-31");
assert.equal(isr.replacement, "C8200-1N-4T");
assert.equal(isr.bulletin, "EOL14896");
assert.equal(L.lifeLevel(isr, "2026-10-28"), "eosw");
assert.equal(L.lifeLevel(isr, "2029-01-01"), "ldos");
assert.equal(L.lifeLevel(isr, "2024-01-01"), "eos");
// Meraki: el modelo se encuentra por su serie.
const ms = L.findLifecycle(db, "MS225-48LP");
assert.equal(ms.key, "MS225 SERIES");
assert.equal(ms.ldos, "2031-04-30");
assert.equal(L.findLifecycle(db, "mr42").key, "MR42");
// Sin anuncio en la base.
assert.equal(L.findLifecycle(db, "C9300-48P"), null);
assert.equal(L.lifeLevel(null, "2026-10-28"), "none");
assert.equal(L.findLifecycle(db, "__proto__"), null);
assert.match(L.lifeDetail("ISR4331/K9", isr, "17.03.08a"), /Último día de soporte \(LDoS\): 30-11-2028/);
fastEnough("búsqueda en la base", 1, () => L.findLifecycle(db, "WS-C2960X-48FPD-L"));

// ---------- Recordar por host, con tope ----------
let map = {};
map = L.rememberDevice(map, "10.0.0.1", { model: "ISR4331/K9", name: "rt" }, 1);
assert.equal(L.rememberDevice(map, "10.0.0.1", { model: "ISR4331/K9" }, 2), map);
for (let i = 0; i < L.MAX_DEVICE_INFO + 5; i++) map = L.rememberDevice(map, `h${i}`, { model: "X1" }, 10 + i);
assert.equal(Object.keys(map).length, L.MAX_DEVICE_INFO);
assert.equal(map["10.0.0.1"], undefined);
assert.equal(L.deviceKey({ type: "ssh", host: " 10.0.0.1 " }), "10.0.0.1");
assert.equal(L.deviceKey({ type: "serial" }), null);

// ---------- Versión del sistema operativo ----------
assert.equal(L.compareVersions("17.09.04a", "17.12.5"), -1);
assert.equal(L.compareVersions("17.12.05", "17.12.5"), 0);
assert.equal(L.compareVersions("15.2(7)E4", "15.2(7)E12"), -1);
assert.equal(L.compareVersions("9.3(10)", "9.3(9)"), 1);
assert.equal(L.compareVersions("21.4R3-S5", "21.4R3-S10"), -1);
assert.equal(L.compareVersions("abc", "1.0"), null);
const osDb = {
  generated: "",
  entries: [
    { vendor: "Cisco", family: "Catalyst 9300", match: ["^C9300"], os: "IOS-XE", recommended: "17.12.5", latest: "17.15.4", lastAvailable: null, source: "https://www.cisco.com/x", checked: "2026-10-28" },
    { vendor: "Fortinet", family: "FortiGate E", match: ["^FORTIGATE-(60|100)E$", "[invalida"], os: "FortiOS", recommended: null, latest: "7.2.11", lastAvailable: "7.2.11", source: "https://docs.fortinet.com/x", checked: "2026-10-28" },
  ],
};
const res = L.compileOs(osDb);
assert.equal(res[1].length, 1);
const c93 = L.findOs(osDb, res, "c9300-48p");
assert.equal(c93.family, "Catalyst 9300");
assert.equal(L.behind(c93, "17.09.04a"), true);
assert.equal(L.behind(c93, "17.12.5"), false);
assert.equal(L.behind(c93, undefined), null);
const fg = L.findOs(osDb, res, "FortiGate-60E");
assert.equal(L.osTarget(fg), "7.2.11");
assert.match(L.osDetail(fg, "6.4.9").join("\n"), /Actualizable: corre 6.4.9, objetivo 7.2.11/);
assert.equal(L.findOs(osDb, res, "MX68"), null);
// La base real (generada) compila completa y cada familia trae fuente oficial.
const realOs = JSON.parse(readFileSync(new URL("../../src/lib/osData.json", import.meta.url), "utf8"));
const realRes = L.compileOs(realOs);
realOs.entries.forEach((e, i) => {
  assert.equal(realRes[i].length, e.match.length, `${e.family}: expresión inválida`);
  assert.match(e.source, /^https:\/\//);
});
fastEnough("versión por modelo", 2, () => L.findOs(realOs, realRes, "WS-C2960X-48FPD-L"));

console.log("lifecycle: ok");
