// Datos del video a partir de los archivos reales de docs/ejemplos: versiones 1.0.0 y 1.1.0 del
// plugin (con el listado de código igual al de plugins.rs), salidas reales del script y de cada
// acción ejecutadas con Python contra el equipo ficticio, y el pack de comandos.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ROOT, ejecutar } from "./python-simulado.mjs";

const EJ = `${ROOT}docs/ejemplos/`;
const PLUGIN = `${EJ}plugins/diagnostico-basico/`;
export const RUTA_PLUGIN = "/Users/operador/proyectos/diagnostico-basico";
export const RUTA_PACK = "/Users/operador/Documentos/consultas-campus.json";

export const archivos = {
  manifiesto: readFileSync(`${PLUGIN}plugin.json`, "utf8"),
  main: readFileSync(`${PLUGIN}main.py`, "utf8"),
  script: readFileSync(`${EJ}scripts/resumen_equipo.py`, "utf8"),
  pack: readFileSync(`${EJ}packs/consultas-campus.json`, "utf8"),
};

/** Versión 1.0.0 (la que se escribe en vivo): sin la acción de ping. */
export function version100() {
  const manifiesto = archivos.manifiesto
    .replace('"version": "1.1.0"', '"version": "1.0.0"')
    .replace(" y prueba conectividad", "")
    .replace(/,\n\s*\{ "id": "ping"[^\n]*\}/, "");
  const main = archivos.main
    .replace("import re\n\n", "\n")
    .replace(/\ndef ping\(\):\n(?: {4}.*\n)+\n/, "")
    .replace(', "ping": ping', "");
  assert.notEqual(manifiesto, archivos.manifiesto);
  assert.ok(!main.includes("ping") && !manifiesto.includes("ping") && !manifiesto.includes("conectividad"), "La versión 1.0.0 no debe tener ping");
  JSON.parse(manifiesto);
  return { manifiesto, main };
}

/** Lo que entrega plugin_stage/plugin_code en plugins.rs para estos archivos. */
function vista({ manifiesto, main }) {
  const files = [
    ["main.py", Buffer.byteLength(main)],
    ["plugin.json", Buffer.byteLength(manifiesto)],
  ];
  const code = ["# ===== main.py =====", ...main.split("\n").filter((_, i, a) => i < a.length - 1 || a[i] !== "")].join("\n");
  return { manifest: { entry: "main.py", ...JSON.parse(manifiesto) }, files, code };
}

export async function datosVideo() {
  const script = await ejecutar(`${EJ}scripts/resumen_equipo.py`);
  const manifest = JSON.parse(archivos.manifiesto);
  const pluginRuns = { [manifest.id]: {} };
  for (const a of manifest.actions) pluginRuns[manifest.id][a.id] = await ejecutar(`${PLUGIN}main.py`, { action: a.id });
  return {
    scripts: { "resumen_equipo.py": script },
    pluginRuns,
    plugins: {
      [`${RUTA_PLUGIN}@1.0.0`]: vista(version100()),
      [`${RUTA_PLUGIN}@1.1.0`]: vista({ manifiesto: archivos.manifiesto, main: archivos.main }),
    },
    files: { [RUTA_PACK]: archivos.pack },
  };
}
