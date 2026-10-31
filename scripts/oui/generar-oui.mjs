// Genera src/lib/ouiData.ts: mapa OUI -> fabricante acotado a equipos de red e infraestructura,
// más un grupo pequeño de fabricantes de tarjetas de red de PC, servidores y máquinas virtuales.
//
// Fuente: registro público MA-L (MAC Address Block Large) de la IEEE Registration Authority.
//   Archivo completo: https://standards-oui.ieee.org/oui/oui.csv
//   Mismo registro vía la API de búsqueda del IEEE RA (se usa si el anterior no responde):
//   https://regauth.standards.ieee.org/standards-ra-web/rest/assignments/?registry=MA-L
// Se ejecuta solo en desarrollo; la copia del registro se descarga fuera del repositorio.
//
// Uso:
//   node scripts/oui/generar-oui.mjs <ruta/oui.csv> [AAAA-MM-DD]
//   node scripts/oui/generar-oui.mjs --descargar <carpeta-temporal>
// La fecha es la de la copia del registro (por defecto, la fecha de modificación del archivo).
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = fileURLToPath(new URL("../../src/lib/ouiData.ts", import.meta.url));
const CSV_URL = "https://standards-oui.ieee.org/oui/oui.csv";
const API_URL = "https://regauth.standards.ieee.org/standards-ra-web/rest/assignments/?registry=MA-L&size=60000";

/**
 * Fabricantes incluidos: [etiqueta, tipo, patrón sobre "Organization Name"].
 * net: equipos de red e infraestructura. host: tarjetas de red de PC, servidores y virtualización.
 * Criterio: solo razones sociales cuyo negocio principal es ese tipo de equipo. Se excluyen las
 * divisiones de consumo (Huawei Device, Cisco-Linksys, Cisco SPVTG, Motorola, Microsoft Mobile).
 */
const VENDORS = [
  ["Cisco", "net", /^Cisco Systems/i],
  ["Meraki", "net", /^(Cisco )?Meraki/i],
  ["Juniper", "net", /^Juniper Networks/i],
  ["Huawei", "net", /^Huawei (Technologies|Symantec)/i],
  ["Arista", "net", /^Arista Network/i],
  ["Fortinet", "net", /^Fortinet/i],
  ["Palo Alto Networks", "net", /^Palo Alto Networks/i],
  ["Check Point", "net", /^Check Point Software/i],
  // Aruba figura hoy en el registro como Hewlett Packard Enterprise.
  ["HPE/Aruba", "net", /^(Hewlett Packard Enterprise|Aruba)/i],
  ["Extreme", "net", /^(Extreme Networks|Enterasys)/i],
  ["Ubiquiti", "net", /^Ubiquiti/i],
  ["MikroTik", "net", /^(Routerboard\.com|Mikrotik)/i],
  ["Dell Networking", "net", /^Force10/i],
  ["Nokia", "net", /^(Nokia$|Nokia Solutions|Nokia Shanghai Bell|Nokia Siemens Networks|Nokia Bell|Alcatel[- ]Lucent)/i],
  ["Ericsson", "net", /^(Ericsson(?! Television)|Telefonaktiebolaget LM Ericsson)/i],
  ["ZTE", "net", /^zte corporation/i],
  ["H3C", "net", /H3C Technologies/i],
  ["Ruijie", "net", /Ruijie/i],
  ["TP-Link", "net", /^TP-Link/i],
  ["Netgear", "net", /^NETGEAR/i],
  ["Sophos", "net", /^Sophos/i],
  ["SonicWall", "net", /^SonicWall/i],
  ["WatchGuard", "net", /^WatchGuard Technologies/i],
  ["F5", "net", /^F5 (Networks|Inc)/i],
  ["Brocade", "net", /^Brocade/i],
  ["Allied Telesis", "net", /^Allied[- ]?Telesis/i],
  ["Ruckus", "net", /^Ruckus/i],
  ["Zyxel", "net", /^Zyxel/i],
  ["Cambium", "net", /^Cambium Networks/i],
  ["Ciena", "net", /^Ciena/i],
  ["Intel", "host", /^Intel Corporat/i],
  ["Realtek", "host", /^Realtek/i],
  ["VMware", "host", /^VMware/i],
  ["Microsoft", "host", /^Microsoft(?! Mobile)/i],
  ["Apple", "host", /^Apple,? Inc/i],
  ["Dell", "host", /^Dell (Inc|EMC|Technologies|Computer)/i],
  ["HP", "host", /^(HP Inc|Hewlett[- ]Packard( Company)?$)/i],
  ["Lenovo", "host", /^(Lenovo(?! Mobile)|LCFC)/i],
  ["Supermicro", "host", /^Super Micro Computer/i],
  ["Xen", "host", /^Xensource/i],
  ["VirtualBox", "host", /^PCS Systemtechnik GmbH/i],
];

/** Lee las filas "Registry,Assignment,Organization Name,..." respetando comillas. */
function parseCsv(text) {
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line) continue;
    const cells = [];
    let cur = "";
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (quoted) {
        if (c === '"' && line[i + 1] === '"') (cur += '"'), i++;
        else if (c === '"') quoted = false;
        else cur += c;
      } else if (c === '"') quoted = true;
      else if (c === ",") cells.push(cur), (cur = "");
      else cur += c;
    }
    cells.push(cur);
    rows.push(cells);
  }
  return rows;
}

async function download(dir) {
  mkdirSync(dir, { recursive: true });
  const dest = join(dir, "oui.csv");
  try {
    const r = await fetch(CSV_URL, { signal: AbortSignal.timeout(30000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    writeFileSync(dest, await r.text());
    return { dest, source: CSV_URL };
  } catch (e) {
    console.warn(`${CSV_URL} no respondió (${e.message}); se usa la API del IEEE RA.`);
  }
  const j = await fetch(API_URL).then((r) => r.json());
  const q = (s) => `"${String(s ?? "").replace(/"/g, '""')}"`;
  const lines = j.data.hits.map((h) => ["MA-L", h.assignmentNumberHex, q(h.organizationName), '""'].join(","));
  writeFileSync(dest, ["Registry,Assignment,Organization Name,Organization Address", ...lines].join("\n") + "\n");
  return { dest, source: API_URL };
}

let csvPath;
let source = CSV_URL;
let date;
if (process.argv[2] === "--descargar") {
  ({ dest: csvPath, source } = await download(process.argv[3] ?? "oui-tmp"));
  date = new Date().toISOString().slice(0, 10);
} else {
  csvPath = process.argv[2];
  if (!csvPath) {
    console.error("Uso: node scripts/oui/generar-oui.mjs <oui.csv> [AAAA-MM-DD] | --descargar <carpeta>");
    process.exit(1);
  }
  date = process.argv[3] ?? statSync(csvPath).mtime.toISOString().slice(0, 10);
  if (process.argv[4]) source = process.argv[4];
}

const rows = parseCsv(readFileSync(csvPath, "utf8")).filter((r) => r[0] === "MA-L" && /^[0-9A-F]{6}$/i.test(r[1]));
const byVendor = new Map(VENDORS.map(([label, kind]) => [label, { kind, ouis: new Set() }]));
for (const [, oui, org] of rows) {
  const name = org.trim();
  const v = VENDORS.find(([, , re]) => re.test(name));
  if (v) byVendor.get(v[0]).ouis.add(oui.toUpperCase());
}
const data = [...byVendor].filter(([, v]) => v.ouis.size).map(([label, v]) => [label, v.kind, [...v.ouis].sort().join("")]);
const total = data.reduce((n, [, , s]) => n + s.length / 6, 0);
const body = [
  "// Archivo generado por scripts/oui/generar-oui.mjs: no editar a mano.",
  `// Fuente: registro MA-L de la IEEE Registration Authority (${source}).`,
  `// Copia del registro: ${date}. ${rows.length} asignaciones leídas, ${total} incluidas.`,
  "// Solo fabricantes de red e infraestructura (net) y de tarjetas de PC, servidores y virtualización (host).",
  "",
  `export const OUI_SNAPSHOT = ${JSON.stringify(date)};`,
  "",
  "/** [fabricante, tipo, OUI concatenados de 6 dígitos hexadecimales, ordenados]. */",
  'export const OUI_DATA: [string, "net" | "host", string][] = [',
  ...data.map(([l, k, s]) => `  [${JSON.stringify(l)}, ${JSON.stringify(k)}, ${JSON.stringify(s)}],`),
  "];",
  "",
].join("\n");
writeFileSync(OUT, body);
console.log(`${OUT}: ${data.length} fabricantes, ${total} OUI, ${(Buffer.byteLength(body) / 1024).toFixed(1)} KB (copia ${date})`);
for (const [l, k, s] of data) console.log(`  ${k.padEnd(4)} ${l}: ${s.length / 6}`);
