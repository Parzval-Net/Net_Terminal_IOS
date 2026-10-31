// Corre todas las pruebas de Node (scripts/tests/*.test.mjs) de a una, en orden alfabético, y
// termina con error si alguna falla. Uso: npm test (o node scripts/tests/run-all.mjs [filtro]).
//
// Las pruebas importan los .ts de src/lib directamente: requieren Node 22.15 o superior
// (module.registerHooks). Antes de 22.18 los tipos de TypeScript no se quitan solos y se agrega
// --experimental-strip-types a cada prueba.
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const dir = fileURLToPath(new URL(".", import.meta.url));
const [major, minor] = process.versions.node.split(".").map(Number);
const at = (a, b) => major > a || (major === a && minor >= b);
if (!at(22, 15)) {
  console.error(`Node ${process.versions.node}: las pruebas requieren Node 22.15 o superior (ver .nvmrc: nvm use).`);
  process.exit(1);
}
const flags = at(22, 18) ? [] : ["--experimental-strip-types", "--no-warnings=ExperimentalWarning"];
const filter = process.argv[2] ?? "";
const files = readdirSync(dir)
  .filter((f) => f.endsWith(".test.mjs") && f.includes(filter))
  .sort();
if (!files.length) {
  console.error(`No hay pruebas que coincidan con "${filter}"`);
  process.exit(1);
}

const failed = [];
for (const f of files) {
  console.log(`\n▶ ${f}`);
  const t0 = performance.now();
  const r = spawnSync(process.execPath, [...flags, `${dir}${f}`], { stdio: "inherit" });
  const s = ((performance.now() - t0) / 1000).toFixed(1);
  if (r.status === 0) console.log(`✓ ${f} (${s} s)`);
  else {
    console.log(`✗ ${f} (${s} s, código ${r.status ?? r.signal})`);
    failed.push(f);
  }
}
console.log(`\n${files.length - failed.length} de ${files.length} pruebas OK${failed.length ? `; fallaron: ${failed.join(", ")}` : ""}`);
process.exit(failed.length ? 1 : 0);
