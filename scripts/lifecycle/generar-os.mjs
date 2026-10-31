// Genera src/lib/osData.json (versión recomendada y última del sistema operativo por familia) desde
// los .json de una carpeta: `node scripts/lifecycle/generar-os.mjs <carpeta>`.
//
// Cada archivo: {"vendor": "...", "entries": [{family, match[], os, recommended, latest,
// lastAvailable, notes, source, checked}]}. Se valida antes de escribir: expresiones que compilan,
// versiones con dígitos, fuente en un dominio oficial del fabricante y familias que no se pisan
// (cada PID de la base de ciclo de vida debe caer a lo más en una familia).
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2];
if (!dir) {
  console.error("Uso: node scripts/lifecycle/generar-os.mjs <carpeta-con-json>");
  process.exit(1);
}
const OFFICIAL = /^https:\/\/([a-z0-9-]+\.)*(cisco\.com|meraki\.com|fortinet\.com|juniper\.net|arubanetworks\.com|hpe\.com|huawei\.com)\//;
const VERSION = /^[\w.()\-]{1,40}$/;
const errors = [];
const entries = [];
for (const f of readdirSync(dir).filter((x) => x.endsWith(".json")).sort()) {
  const data = JSON.parse(readFileSync(join(dir, f), "utf8"));
  for (const [i, e] of (data.entries ?? []).entries()) {
    const where = `${f}#${i} ${e.family}`;
    const vendor = e.vendor ?? data.vendor;
    if (!vendor || !e.family || !e.os || !Array.isArray(e.match) || !e.match.length) errors.push(`${where}: faltan campos`);
    for (const k of ["recommended", "latest", "lastAvailable"]) {
      const v = e[k];
      if (v !== null && v !== undefined && (typeof v !== "string" || !VERSION.test(v) || !/\d/.test(v) || /x$/i.test(v))) errors.push(`${where}: ${k} no es una versión exacta: ${v}`);
    }
    if (!OFFICIAL.test(e.source ?? "")) errors.push(`${where}: fuente no oficial: ${e.source}`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(e.checked ?? "")) errors.push(`${where}: fecha de revisión inválida`);
    for (const m of e.match ?? []) {
      try {
        new RegExp(m);
      } catch {
        errors.push(`${where}: expresión inválida ${m}`);
      }
    }
    if (!e.recommended && !e.latest && !e.lastAvailable) continue; // sin datos verificados: no aporta
    entries.push({
      vendor,
      family: e.family,
      match: e.match,
      os: e.os,
      recommended: e.recommended ?? null,
      latest: e.latest ?? null,
      lastAvailable: e.lastAvailable ?? null,
      ...(e.notes ? { notes: String(e.notes).slice(0, 300) } : {}),
      source: e.source,
      checked: e.checked,
    });
  }
}
// Solapes: cada PID conocido (base de ciclo de vida y ejemplos) en a lo más una familia.
const life = JSON.parse(readFileSync(new URL("../../src/lib/lifecycleData.json", import.meta.url), "utf8"));
const samples = [...Object.keys(life.rows), "FORTIGATE-60F", "FORTIGATE-100E", "FORTIWIFI-61F", "C9300-48P", "C9200L-24P-4G", "EX4300-48T", "MS225-48LP", "MR46"];
const res = entries.map((e) => e.match.map((m) => new RegExp(m)));
const overlaps = new Map();
for (const pid of samples) {
  const hit = res.flatMap((list, i) => (list.some((re) => re.test(pid)) ? [i] : []));
  if (hit.length > 1) overlaps.set(hit.map((i) => entries[i].family).join(" / "), pid);
}
for (const [fams, pid] of overlaps) errors.push(`solape (${pid}): ${fams}`);
if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
const matched = samples.filter((pid) => res.some((list) => list.some((re) => re.test(pid)))).length;
writeFileSync(new URL("../../src/lib/osData.json", import.meta.url), JSON.stringify({ generated: new Date().toISOString().slice(0, 10), entries }, null, 1));
console.log(`${entries.length} familias; ${matched} de ${samples.length} modelos conocidos tienen versión.`);
