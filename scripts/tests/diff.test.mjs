// Pruebas del diff de configuraciones: `node scripts/tests/diff.test.mjs` (Node 22.6+ con tipos TS).
import assert from "node:assert/strict";
import { fastEnough } from "./timing.mjs";
import { diffLines, diffStats, foldBlocks, markSecretChanges, splitLines, unifiedDiff } from "../../src/lib/diff.ts";

/** Reconstruye A y B desde las filas: valida que el diff sea consistente. */
function check(a, b) {
  const rows = diffLines(a, b);
  const ra = rows.filter((r) => r.kind !== 2).map((r) => a[r.a]);
  const rb = rows.filter((r) => r.kind !== 1).map((r) => b[r.b]);
  assert.deepEqual(ra, a);
  assert.deepEqual(rb, b);
  for (const r of rows) if (r.kind === 0) assert.equal(a[r.a], b[r.b]);
  return rows;
}

// Casos básicos.
assert.deepEqual(diffStats(check([], [])), { added: 0, removed: 0, same: 0 });
assert.deepEqual(diffStats(check(["a"], [])), { added: 0, removed: 1, same: 0 });
assert.deepEqual(diffStats(check([], ["a"])), { added: 1, removed: 0, same: 0 });
assert.deepEqual(diffStats(check(["a", "b", "c"], ["a", "x", "c"])), { added: 1, removed: 1, same: 2 });
// Mínimo con líneas repetidas (sin anclas únicas: lo resuelve Myers).
assert.deepEqual(diffStats(check(["!", "!", "x", "!"], ["!", "x", "!", "!"])), { added: 1, removed: 1, same: 3 });
assert.deepEqual(splitLines("a\r\nb\n"), ["a", "b"]);

// Aleatorios: consistencia y cercanía al óptimo frente a un LCS por programación dinámica.
function lcs(a, b) {
  const dp = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
  return dp[a.length][b.length];
}
let seed = 7;
const rnd = (n) => ((seed = (seed * 1103515245 + 12345) % 2 ** 31), seed % n);
let optimal = 0;
for (let t = 0; t < 300; t++) {
  const a = Array.from({ length: rnd(30) }, () => "l" + rnd(6));
  const b = Array.from({ length: rnd(30) }, () => "l" + rnd(6));
  const same = diffStats(check(a, b)).same;
  // Patience no siempre es mínimo; Myers sí lo es cuando no hay anclas únicas.
  if (same === lcs(a, b)) optimal++;
  assert.ok(same >= lcs(a, b) - 3, `caso ${t}: ${same} vs ${lcs(a, b)}`);
}

// Configuración realista de 10.000 líneas con cambios dispersos: rápida y exacta.
const cfg = [];
for (let i = 0; i < 2000; i++) cfg.push(`interface Gi1/0/${i}`, ` description puerto ${i}`, " switchport mode access", " no shutdown", "!");
const changed = cfg.slice();
changed[501] = " description CAMBIADO";
changed.splice(4000, 0, " spanning-tree portfast");
changed.splice(9000, 5);
// Tiempos con fastEnough: sobre el límite se vuelve a medir y con carga el límite se duplica.
const rows = fastEnough("diff de 10.000 líneas", 500, () => check(cfg, changed));
const ms = fastEnough.lastMs;
assert.deepEqual(diffStats(rows), { added: 2, removed: 6, same: cfg.length - 6 });

// Dos equipos distintos (mucho cambio): debe terminar acotado.
const other = cfg.map((l, i) => (i % 3 === 0 ? l + " x" : l));
fastEnough("diff con mucho cambio", 3000, () => check(cfg, other));
const ms2 = fastEnough.lastMs;

// Peor caso: sin líneas únicas y muy distinto (activa el tope de Myers).
const noisyA = Array.from({ length: 6000 }, () => (rnd(2) ? "!" : " exit"));
const noisyB = Array.from({ length: 6000 }, () => (rnd(2) ? "!" : " exit"));
fastEnough("diff peor caso", 3000, () => check(noisyA, noisyB));

// Plegado y diff unificado.
assert.ok(foldBlocks(rows, 3).some((b) => b.type === "fold"));
const u = unifiedDiff(["a", "b", "c"], ["a", "x", "c"], diffLines(["a", "b", "c"], ["a", "x", "c"]), "A", "B");
assert.equal(u, "--- A\n+++ B\n@@ -1,3 +1,3 @@\n a\n-b\n+x\n c\n");
const u2 = unifiedDiff([], ["n"], diffLines([], ["n"]), "A", "B");
assert.equal(u2, "--- A\n+++ B\n@@ -0,0 +1 @@\n+n\n");

// Secretos enmascarados: misma línea "****" con huella distinta = secreto cambiado.
{
  const a = ["hostname sw1", "enable secret 5 ****", "username admin secret 9 ****", "end"];
  const b = ["hostname sw1", "enable secret 5 ****", "username admin secret 9 ****", "end"];
  const rows = markSecretChanges(diffLines(a, b), { 1: ["aa"], 2: ["bb"] }, { 1: ["aa"], 2: ["cc"] });
  assert.deepEqual(diffStats(rows), { added: 1, removed: 1, same: 3 });
  assert.deepEqual(rows.filter((r) => r.secret).map((r) => [r.kind, r.a, r.b]), [[1, 2, -1], [2, -1, 2]]);
  assert.match(unifiedDiff(a, b, rows, "A", "B"), /\+username admin secret 9 \*\*\*\* {4}\[secreto cambiado\]/);
  assert.ok(!/aa|bb|cc/.test(unifiedDiff(a, b, rows, "A", "B")), "las huellas no se exportan");
  // Sin huellas en un lado (respaldo anterior a la función): sin marcas.
  assert.equal(markSecretChanges(diffLines(a, b), null, { 2: ["cc"] }).filter((r) => r.secret).length, 0);
  assert.equal(markSecretChanges(diffLines(a, b), {}, { 2: ["cc"] }).filter((r) => r.secret).length, 0);
  // Una línea cambiada de verdad no se duplica.
  const c = ["hostname sw2", ...b.slice(1)];
  assert.deepEqual(diffStats(markSecretChanges(diffLines(a, c), { 1: ["aa"] }, { 1: ["aa"] })), { added: 1, removed: 1, same: 3 });
}

console.log(`diff OK · óptimos ${optimal}/300 · 10k líneas: ${ms.toFixed(1)} ms · muy distinto: ${ms2.toFixed(1)} ms`);
