// Genera src/lib/lifecycleData.json (fechas de fin de venta y soporte por modelo) desde las bases
// de ciclo de vida en Markdown: `node scripts/lifecycle/generar-lifecycle.mjs <carpeta-con-md>`.
//
// Cada .md trae una cabecera "FUENTE Y VIGENCIA" (fabricante, URL oficial, fecha) y tablas con el
// PID o SKU en la primera columna. Las columnas se reconocen por su encabezado, así que sirven las
// tablas de Cisco (EoS, EoSW, LDoS, reemplazo, boletín) y las de Meraki (anuncio, EoS, EoSupport).
// Un archivo con "PRIORIDAD" en la cabecera reemplaza las filas de los demás para sus PID.
// Solo se copian datos de producto y fechas: las notas internas de la cabecera no pasan a la app.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2];
if (!dir) {
  console.error("Uso: node scripts/lifecycle/generar-lifecycle.mjs <carpeta-con-md>");
  process.exit(1);
}
const out = new URL("../../src/lib/lifecycleData.json", import.meta.url);

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const date = (s) => (DATE.test(s) ? s : "");
const strip = (s) => s.replace(/\*\*/g, "").trim();

const sources = [];
const repl = [];
const bulletins = [];
const idx = (list, v) => {
  if (!v) return -1;
  let i = list.indexOf(v);
  if (i < 0) i = list.push(v) - 1;
  return i;
};
/** pid -> [eos, eosw, ldos, anuncio, reemplazo, boletín, fuente, prioridad] */
const rows = new Map();
let conflicts = 0;

for (const f of readdirSync(dir).filter((x) => x.endsWith(".md")).sort()) {
  const text = readFileSync(join(dir, f), "utf8");
  // Cabecera: las líneas de cita (">") del comienzo, antes o después del título.
  const head = text.split("\n").slice(0, 25).filter((l) => l.startsWith(">")).join("\n");
  const vendor = head.match(/Fabricante:\s*(.+)/)?.[1].trim() ?? "?";
  // La URL de Meraki lleva paréntesis: se quita solo el ")" final que cierra la cita.
  let url = head.match(/Fuente oficial:.*?(https?:\/\/\S+)/)?.[1] ?? "";
  url = url.replace(/[.,;]+$/, "");
  while (url.endsWith(")") && url.split("(").length < url.split(")").length) url = url.slice(0, -1);
  url = url.replace(/[.,;]+$/, "");
  const when = head.match(/(\d{4}-\d{2}-\d{2})/g)?.pop() ?? "";
  const priority = /PRIORIDAD/.test(head) ? 1 : 0;
  const src = sources.push({ file: f.replace(/^[0-9a-f]{8}-/, ""), vendor, url, date: when }) - 1;
  let cols = null;
  for (const line of text.split("\n")) {
    if (!line.startsWith("|")) {
      if (line.trim() && !line.startsWith(">")) cols = cols && /^#/.test(line) ? null : cols;
      continue;
    }
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    if (/Product ID|Producto \/ SKU/i.test(cells[0])) {
      const find = (re) => cells.findIndex((c) => re.test(c));
      cols = {
        eos: find(/Fin de Venta|End-of-Sale/i),
        eosw: find(/Fin Soporte SW/i),
        ldos: find(/Último Día Soporte|End-of-Support/i),
        ann: find(/Anuncio/i),
        base: find(/Modelo base/i),
        repl: find(/Reemplazo/i),
        bul: find(/Boletín/i),
      };
      continue;
    }
    if (!cols || /^:?-+/.test(cells[0])) continue;
    const pid = strip(cells[0]).toUpperCase();
    if (!pid || pid.startsWith("(")) continue;
    const get = (i) => (i >= 0 ? strip(cells[i] ?? "") : "");
    const r = get(cols.repl).replace(/^Sin reemplazo( directo)?$/i, "");
    const bulCell = get(cols.bul);
    const bul = bulCell.match(/\[([^\]]+)\]\((https?:[^)]+)\)/);
    const row = [
      date(get(cols.eos)),
      date(get(cols.eosw)),
      date(get(cols.ldos)),
      date(get(cols.ann)),
      idx(repl, r),
      idx(bulletins, bul ? `${bul[1]} ${bul[2]}` : bulCell),
      src,
      priority,
    ];
    if (!row[0] && !row[1] && !row[2]) continue;
    const keys = [pid];
    // Meraki: el modelo base (MS225 Series, MR42) también sirve de clave.
    const base = get(cols.base).toUpperCase();
    if (base && base !== pid) keys.push(base);
    for (const k of keys) {
      const prev = rows.get(k);
      const filled = (x) => x.slice(0, 3).filter(Boolean).length;
      if (!prev || row[7] > prev[7] || (row[7] === prev[7] && filled(row) > filled(prev))) {
        if (prev && row[7] === prev[7] && prev.slice(0, 3).join() !== row.slice(0, 3).join()) conflicts++;
        rows.set(k, row);
      }
    }
  }
}

const data = {
  generated: new Date().toISOString().slice(0, 10),
  sources,
  repl,
  bulletins,
  rows: Object.fromEntries([...rows].sort(([a], [b]) => a.localeCompare(b)).map(([k, r]) => [k, r.slice(0, 7)])),
};
writeFileSync(out, JSON.stringify(data));
console.log(`${rows.size} claves, ${repl.length} reemplazos, ${bulletins.length} boletines, ${conflicts} PID con fechas distintas entre filas (se dejó la más completa).`);
