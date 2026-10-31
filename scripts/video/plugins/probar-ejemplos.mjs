// Prueba los ejemplos de docs/ejemplos con las reglas reales de la app, sin equipos ni red:
//  - el script y cada acción del plugin corren con Python 3 y el netterminal.py de la app,
//    contra un NetTerminal simulado por stdin/stdout (mismo protocolo JSON que scripts.rs);
//  - el pack pasa por validatePack() y su riesgo por computeRisk() (src/lib/packs.ts);
//  - los comandos que muestra el video se clasifican como en la app.
// La revisión del plugin (manifiesto, código revisable) la cubre el test de Rust
// `plugins::tests::example_plugins_pass_review`.
// Uso: node scripts/video/plugins/probar-ejemplos.mjs   (Node 22.6+ y python3)
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "node:module";
import { ROOT, ejecutar } from "./python-simulado.mjs";

const EJ = `${ROOT}docs/ejemplos/`;

// packs.ts importa "./highlight" sin extensión (lo resuelve vite): se agrega ".ts".
register(
  "data:text/javascript," +
    encodeURIComponent(
      `export async function resolve(s, c, next) { try { return await next(s, c); } catch (e) { if (s.startsWith(".") && !/\\.ts$/.test(s)) return next(s + ".ts", c); throw e; } }`,
    ),
);
const { validatePack, computeRisk, buildCatalog } = await import(`${ROOT}src/lib/packs.ts`);

const soloLectura = (cmds) => cmds.forEach((c) => assert.equal(computeRisk(c), "read", `No es de lectura: ${c}`));

// 1. Script de ejemplo.
const s = await ejecutar(`${EJ}scripts/resumen_equipo.py`);
soloLectura(s.commands);
assert.ok(s.logs.some((l) => l.includes("6 interfaces arriba, 2 abajo")), s.logs.join("\n"));
assert.ok(s.logs.some((l) => l.includes("Ping 192.0.2.1: 100 %")));
console.log("script resumen_equipo.py:", s.commands.join(" · "));
for (const l of s.logs) console.log("   ", l);

// 2. Plugin de ejemplo: cada acción declarada.
const dir = `${EJ}plugins/diagnostico-basico/`;
const manifest = JSON.parse(readFileSync(`${dir}plugin.json`, "utf8"));
assert.deepEqual(manifest.permissions, ["session"]);
for (const a of manifest.actions) {
  const r = await ejecutar(`${dir}${manifest.entry}`, { action: a.id });
  soloLectura(r.commands);
  assert.ok(r.logs.length && !r.logs.some((l) => l.startsWith("Acción desconocida")), `${a.id}: ${r.logs}`);
  console.log(`plugin ${manifest.id} · ${a.id}:`, r.logs.join(" | "));
}
// Sin el permiso "session" la app rechaza leer o escribir en la sesión.
await assert.rejects(ejecutar(`${dir}${manifest.entry}`, { action: "version", session: false }));

// 3. Pack de comandos.
const v = validatePack(JSON.parse(readFileSync(`${EJ}packs/consultas-campus.json`, "utf8")));
assert.deepEqual(v.errors, []);
assert.deepEqual(v.warnings, []);
const cat = buildCatalog([v.pack], [])[0];
assert.ok(cat.commands.every((c) => c.risk === "read" && !c.escalated));
console.log(`pack ${v.pack.id}: ${v.pack.commands.length} comandos válidos, todos de consulta`);

// 4. Clasificación que muestra el video.
const riesgos = {
  "show version": "read",
  "show interfaces": "read",
  "ping 192.0.2.1": "read",
  "show interfaces {{interfaz}}": "read",
  "show version ; reload": "disruptive",
  "show clock && reload": "disruptive",
  "configure terminal": "change",
};
for (const [cmd, r] of Object.entries(riesgos)) assert.equal(computeRisk(cmd), r, cmd);
console.log("riesgo calculado:", Object.entries(riesgos).map(([c, r]) => `${c} = ${r}`).join(" · "));
console.log("OK: ejemplos validados");
