// Pruebas del árbol y el orden manual de la lista de sesiones: `node scripts/tests/folders.test.mjs`.
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

// settings.ts importa módulos sin extensión (como lo resuelve Vite): se completa con .ts.
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

const F = await import("../../src/lib/folders.ts");

const s = (id, name, folder) => ({ id, name, folder, type: id === "local" ? "local" : "ssh", host: "192.0.2.1", created_at: "" });
const sessions = [s("a", "core-sw01", "Core"), s("b", "dist-sw01", "Core/Dist"), s("c", "ar-wan01"), s("local", "Shell local"), s("d", "fw01")];
const tree = F.buildTree(sessions, []);
const keys = (node, order) => F.orderedItems(node, order).map(F.itemKey);

// Sin orden manual: carpetas primero y luego sesiones, alfabético (como antes).
assert.deepEqual(keys(tree), ["f:Core", "s:c", "s:d", "s:local"]);
// "Shell local" arriba de todo, intercalada con carpetas.
assert.deepEqual(keys(tree, ["s:local"]), ["s:local", "f:Core", "s:c", "s:d"]);
assert.deepEqual(keys(tree, ["s:d", "f:Core"]), ["s:d", "f:Core", "s:c", "s:local"], "lo no ordenado sigue después, como antes");
assert.deepEqual(keys(tree, ["s:borrada", "s:local"]), ["s:local", "f:Core", "s:c", "s:d"], "claves de elementos que ya no existen se ignoran");

// Mover dentro de una carpeta.
const cur = keys(tree);
assert.deepEqual(F.placeKey(cur, "s:local", null, "start"), ["s:local", "f:Core", "s:c", "s:d"]);
assert.deepEqual(F.placeKey(cur, "s:local", "s:c", "before"), ["f:Core", "s:local", "s:c", "s:d"]);
assert.deepEqual(F.placeKey(cur, "f:Core", "s:d", "after"), ["s:c", "s:d", "f:Core", "s:local"]);
assert.deepEqual(F.placeKey(cur, "s:c", null, "end"), ["f:Core", "s:d", "s:local", "s:c"]);
// Una sesión que llega desde otra carpeta.
assert.deepEqual(F.placeKey(cur, "s:a", "s:c", "after"), ["f:Core", "s:c", "s:a", "s:d", "s:local"]);
// Ancla que no existe: al final.
assert.deepEqual(F.placeKey(cur, "s:a", "s:x", "before"), [...cur, "s:a"]);

// Subcarpetas.
assert.equal(F.findFolder(tree, "Core/Dist")?.sessions[0].id, "b");
assert.equal(F.findFolder(tree, "")?.path, "");
assert.equal(F.findFolder(tree, "No/Existe"), undefined);

// El orden manual se guarda en settings.json y sobrevive a la carga (y uno inválido se descarta).
const { mergeSettings } = await import("../../src/lib/settings.ts");
assert.deepEqual(mergeSettings({ sidebarOrder: { "": ["s:local", "f:Core"] } }).sidebarOrder, { "": ["s:local", "f:Core"] });
assert.deepEqual(mergeSettings({ sidebarOrder: null }).sidebarOrder, {});
assert.deepEqual(mergeSettings({ sidebarOrder: ["x"] }).sidebarOrder, {});

// Carpetas con nombres de Object.prototype (archivo de sesiones compartido): no rompen el orden.
const proto = F.buildTree([{ id: "c", name: "c", type: "ssh", folder: "constructor", created_at: "" }], []);
assert.equal(F.own({ "": ["x"] }, "constructor"), undefined);
assert.equal(F.own(undefined, "x"), undefined);
assert.deepEqual(F.orderedItems(proto, F.own({}, "constructor")).map(F.itemKey), ["f:constructor"]);
assert.deepEqual(F.orderedItems(proto, /** @type {any} */ (Object.prototype.constructor)).map(F.itemKey), ["f:constructor"]);
assert.deepEqual(F.orderedItems(proto, /** @type {any} */ (["f:constructor", 3, null])).map(F.itemKey), ["f:constructor"]);

// Topología y equipos recordados mal formados (archivo compartido o editado): se descartan sin romper.
const bad = mergeSettings({
  topology: { nodes: "x", links: [] },
  topoSnapshots: [{ id: "s", name: "ok", ts: 1, topo: { nodes: [{ id: "a", name: "a", x: 1, y: 2 }, { id: 3 }], links: [{ a: "a" }] } }, "basura", { id: "s2", name: "sin topo" }],
  deviceInfo: { "10.0.0.1": { model: "ISR4331/K9" }, "10.0.0.2": "x", "10.0.0.3": { model: 5 } },
});
assert.deepEqual(bad.topology, { nodes: [], links: [] });
assert.equal(bad.topoSnapshots.length, 1);
assert.deepEqual(bad.topoSnapshots[0].topo, { nodes: [{ id: "a", name: "a", x: 1, y: 2 }], links: [] });
assert.deepEqual(Object.keys(bad.deviceInfo), ["10.0.0.1"]);
const good = { nodes: [{ id: "a", name: "a", x: 0, y: 0, explored: true }], links: [{ a: "a", aPort: "", b: "b", bPort: "", proto: "CDP" }] };
assert.deepEqual(mergeSettings({ topology: good }).topology, good);

console.log("folders: ok");
