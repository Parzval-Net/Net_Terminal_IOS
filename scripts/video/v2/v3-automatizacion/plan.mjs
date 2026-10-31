// Duración planificada del video 3 (sin grabar): voz de narracion.mjs + tomas de guion.mjs, con
// las mismas reglas que grabar.mjs. Uso: node scripts/video/v2/v3-automatizacion/plan.mjs
import { generar } from "./narracion.mjs";
import { TOMAS } from "./guion.mjs";
import { PAUSAS } from "./grabar-plan.mjs";

const { caps } = generar();
const cap = Object.fromEntries(caps.map((c) => [c.id, c]));
let total = 0;
const porCap = {};
for (const t of TOMAS) {
  let d;
  if (!t.bloques?.length) d = t.dur;
  else {
    let x = t.entrada ?? PAUSAS.ENTRADA;
    for (const b of t.bloques) x += cap[t.cap].bloques[b].dur + PAUSAS.BLOQUE;
    d = Math.max(x - PAUSAS.BLOQUE + (t.salida ?? PAUSAS.SALIDA) + (t.extra ?? 0), t.min ?? 0);
  }
  total += d;
  porCap[t.cap] = (porCap[t.cap] ?? 0) + d;
}
for (const [k, v] of Object.entries(porCap)) console.log(k.padEnd(22), v.toFixed(1), "s");
console.log(`Total planificado: ${total.toFixed(1)} s (${Math.floor(total / 60)}:${String(Math.round(total % 60)).padStart(2, "0")})`);
