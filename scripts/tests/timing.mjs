// Mediciones de tiempo para las pruebas de rendimiento, robustas ante carga ajena.
//
// Mismo criterio que la prueba de sugerencias (suggest.test.mjs): una medición sobre el límite
// no falla de inmediato. Se vuelve a medir varias veces y vale la mejor (descarta pausas del GC
// y procesos que compiten por la CPU un instante). Si la máquina está cargada de forma sostenida
// (el proceso recibe menos CPU que el tiempo transcurrido o el promedio de carga supera los
// núcleos), el límite se duplica: sigue atrapando una regresión de orden (cuadrática o con
// retroceso catastrófico) sin fallar porque otro build o test corre en paralelo.
import assert from "node:assert/strict";
import { cpus, loadavg } from "node:os";

/** Tiempo de `fn` en ms. */
export function measure(fn) {
  const t0 = performance.now();
  const r = fn();
  return { ms: performance.now() - t0, r };
}

/** Máquina con carga sostenida durante una medición (CPU propia vs tiempo transcurrido). */
export function loadedDuring(fn) {
  const cpu0 = process.cpuUsage();
  const wall0 = performance.now();
  fn();
  const wall = performance.now() - wall0;
  const { user, system } = process.cpuUsage(cpu0);
  return (wall > 50 && (user + system) / 1000 < wall * 0.9) || loadavg()[0] > cpus().length * 0.75;
}

/**
 * Falla si `fn` tarda más de `ms`, tras volver a medir hasta `retries` veces. Devuelve el
 * resultado de la primera ejecución; el mejor tiempo queda en `fastEnough.lastMs`.
 */
export function fastEnough(label, ms, fn, { retries = 4 } = {}) {
  const first = measure(fn);
  let best = first.ms;
  let loaded = false;
  if (best >= ms) {
    loaded = loadedDuring(() => {
      for (let i = 0; i < retries && best >= ms; i++) best = Math.min(best, measure(fn).ms);
    });
  }
  const limit = loaded ? ms * 2 : ms;
  fastEnough.lastMs = best;
  assert.ok(best < limit, `${label}: ${best.toFixed(0)} ms (máximo ${limit} ms${loaded ? ", máquina con carga" : ""})`);
  return first.r;
}
