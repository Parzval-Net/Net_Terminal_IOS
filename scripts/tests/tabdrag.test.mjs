// Pruebas del reordenamiento de pestañas: `node scripts/tests/tabdrag.test.mjs` (Node 22.15+).
import assert from "node:assert/strict";
const { moveItem } = await import("../../src/lib/tabDrag.ts");

const l = ["a", "b", "c", "d"].map((id) => ({ id }));
const ids = (x) => x.map((t) => t.id).join("");
assert.equal(ids(moveItem(l, "a", "c", true)), "bcad");
assert.equal(ids(moveItem(l, "a", "c", false)), "bacd");
assert.equal(ids(moveItem(l, "d", "a", false)), "dabc");
assert.equal(ids(moveItem(l, "b", "d", true)), "acdb");
// Sin cambio real: mismo arreglo (no rerender).
assert.equal(moveItem(l, "a", "b", false), l);
assert.equal(moveItem(l, "b", "a", true), l);
assert.equal(moveItem(l, "a", "a", true), l);
assert.equal(moveItem(l, "x", "a", true), l);
console.log("tabdrag OK");
