// Prueba los ejemplos del video 3 (automatización) con las reglas reales de la app, sin equipos
// ni red:
//  - cada script y cada acción del plugin corren con Python 3 y el netterminal.py de la app
//    contra un campus simulado (equipos-campus.js), con el mismo protocolo JSON que scripts.rs,
//    incluidos el tiempo agotado (ScriptTimeout) y la lectura del resto con read();
//  - los CSV se escriben en una carpeta de datos temporal y se revisan fila por fila;
//  - los packs pasan por validatePack() y buildCatalog() junto al pack Cisco incluido;
//  - todo comando que envían los ejemplos y los que muestra el video se clasifican con
//    computeRisk() (src/lib/packs.ts).
// La revisión de instalación del plugin la cubre el test de Rust
// `plugins::tests::example_plugins_pass_review`.
// Uso: node scripts/video/v2/v3-automatizacion/probar-ejemplos.mjs   (Node 22.6+ y python3; en
// Node anterior a 22.18 agrega --experimental-strip-types para importar packs.ts)
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { register } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT, ejecutar } from "../../plugins/python-simulado.mjs";
import { EQUIPOS, respuestaCampus } from "./equipos-campus.js";

const EJ = `${ROOT}docs/ejemplos/`;
const AQUI = `${ROOT}scripts/video/v2/v3-automatizacion/`;

// packs.ts importa "./highlight" sin extensión (lo resuelve vite): se agrega ".ts".
register(
  "data:text/javascript," +
    encodeURIComponent(
      `export async function resolve(s, c, next) { try { return await next(s, c); } catch (e) { if (s.startsWith(".") && !/\\.ts$/.test(s)) return next(s + ".ts", c); throw e; } }`,
    ),
);
const { validatePack, computeRisk, buildCatalog } = await import(`${ROOT}src/lib/packs.ts`);

const soloLectura = (cmds) => cmds.forEach((c) => assert.equal(computeRisk(c), "read", `No es de lectura: ${c}`));
const datos = mkdtempSync(join(tmpdir(), "nt-v3-"));
const sesion = (nombre) => ({ name: nombre, type: "ssh", host: EQUIPOS[nombre].host, port: 22, username: "operador" });
const correr = (archivo, nombre, extra = {}) =>
  ejecutar(archivo, { host: nombre, responder: respuestaCampus, dataDir: datos, sessionInfo: sesion(nombre), ...extra });
/** CSV con comillas (RFC 4180), como lo escribe el módulo csv de Python. */
const leerCsv = (ruta) => {
  const filas = [];
  let fila = [];
  let celda = "";
  let comillas = false;
  const texto = readFileSync(ruta, "utf8");
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (comillas) {
      if (c === '"' && texto[i + 1] === '"') (celda += '"'), i++;
      else if (c === '"') comillas = false;
      else celda += c;
    } else if (c === '"') comillas = true;
    else if (c === ",") fila.push(celda), (celda = "");
    else if (c === "\n") fila.push(celda), filas.push(fila), (fila = []), (celda = "");
    else if (c !== "\r") celda += c;
  }
  const [cab, ...resto] = filas;
  return resto.map((f) => Object.fromEntries(f.map((v, i) => [cab[i], v])));
};
const enviados = [];

try {
  // 1. Primer script: datos de la sesión y run().
  const s1 = await correr(`${EJ}scripts/primer_script.py`, "core-sw01");
  enviados.push(...s1.commands);
  assert.deepEqual(s1.logs.slice(0, 2), ["Sesión: core-sw01 (ssh a 192.0.2.1)", "Cisco IOS XE Software, Version 17.12.04"]);
  assert.ok(s1.logs.some((l) => l.includes("uptime is 47 days")));
  console.log("primer_script.py:", s1.logs.join(" | "));

  // 2. Ping a varios destinos: wait_for, ScriptTimeout y read().
  const s2 = await correr(`${EJ}scripts/ping_destinos.py`, "core-sw01");
  enviados.push(...s2.commands);
  assert.deepEqual(s2.logs, [
    "192.0.2.1: 100 %",
    "192.0.2.10: 100 %",
    "198.51.100.20: más de 8 s, esperando el final",
    "198.51.100.20: 0 %",
    "Sin respuesta: 198.51.100.20",
  ]);
  console.log("ping_destinos.py:", s2.logs.join(" | "));

  // 3. Inventario a CSV.
  const inv = `${EJ}scripts/inventario_csv.py`;
  // 3a. Una ejecución con cinco destinos (API de varias sesiones), dos a la vez.
  const todos = ["core-sw01", "acc-sw01", "acc-sw02", "rtr-borde01", "sw-lab09"];
  const multi = await correr(inv, "core-sw01", { sesiones: todos.map(sesion), sessionInfo: undefined, paralelo: 2 });
  enviados.push(...multi.commands);
  assert.equal(multi.estado, "ok");
  assert.deepEqual(multi.confirmaciones, [], "Un inventario de solo lectura no pide confirmaciones");
  assert.ok(multi.enVueloMax <= 2, `más de 2 sesiones a la vez: ${multi.enVueloMax}`);
  for (const n of todos.slice(0, 4)) assert.ok(multi.porSesion[n].includes("show version"), `${n} no recibió show version`);
  // sw-lab09 no responde: se corta en el primer comando y el resto de los equipos sigue.
  assert.deepEqual(multi.porSesion["sw-lab09"], ["terminal length 0"]);
  console.log(`inventario_csv.py en ${todos.length} sesiones:`, multi.logs.join(" | "));
  // 3b. Una sola sesión: vuelve a escribir la fila de ese equipo en el mismo archivo.
  const uno = await correr(inv, "acc-sw01");
  enviados.push(...uno.commands);
  assert.deepEqual(uno.porSesion, { "acc-sw01": ["terminal length 0", "show version", "show interfaces status"] });
  // 3c. netterminal.py anterior (sin for_each ni ids): el script usa la sesión activa.
  const viejo = await correr(inv, "acc-sw02", { helperDir: `${ROOT}scripts/tests/fixtures/legacy` });
  enviados.push(...viejo.commands);
  assert.deepEqual(viejo.commands, ["terminal length 0", "show version", "show interfaces status"]);
  console.log("inventario_csv.py con la API anterior en acc-sw02:", viejo.logs.join(" | "));
  const csv = leerCsv(join(datos, "reportes", "inventario.csv"));
  assert.deepEqual(csv.map((r) => r.equipo), ["acc-sw01", "acc-sw02", "core-sw01", "rtr-borde01", "sw-lab09"]);
  const fila = (n) => csv.find((r) => r.equipo === n);
  assert.deepEqual(
    [fila("acc-sw01").modelo, fila("acc-sw01").serie, fila("acc-sw01").version, fila("acc-sw01").conectados, fila("acc-sw01").libres, fila("acc-sw01").deshabilitados, fila("acc-sw01").err_disabled, fila("acc-sw01").resultado],
    ["C9200L-24P-4G", "JAE0000B1A1", "17.09.05", "5", "2", "1", "1", "ok"],
  );
  assert.equal(fila("core-sw01").conectados, "3");
  assert.deepEqual([fila("rtr-borde01").modelo, fila("rtr-borde01").serie, fila("rtr-borde01").resultado], ["ISR4331/K9", "FLM0000C3B3", "sin show interfaces status"]);
  assert.equal(fila("sw-lab09").resultado, "sin respuesta a tiempo");
  assert.equal(fila("sw-lab09").host, "192.0.2.99");
  console.log(`inventario.csv: ${csv.length} filas, columnas ${Object.keys(csv[0]).join(",")}`);

  // 4. Plugin revisión de puertos: cada acción declarada.
  const dir = `${EJ}plugins/revision-puertos/`;
  const manifest = JSON.parse(readFileSync(`${dir}plugin.json`, "utf8"));
  assert.deepEqual(manifest.permissions, ["session", "files"]);
  assert.deepEqual(manifest.actions.map((a) => a.id), ["resumen", "errores", "exportar"]);
  const accion = async (id, n) => {
    const r = await correr(`${dir}${manifest.entry}`, n, { action: id });
    enviados.push(...r.commands);
    assert.ok(!r.logs.some((l) => l.startsWith("Acción desconocida")), r.logs.join());
    console.log(`plugin ${manifest.id} · ${id} en ${n}:`, r.logs.join(" | "));
    return r.logs;
  };
  assert.deepEqual(await accion("resumen", "acc-sw01"), [
    "acc-sw01: 9 puertos · 5 connected, 1 disabled, 1 err-disabled, 2 notconnect",
    "err-disabled: Gi1/0/5",
  ]);
  assert.deepEqual(await accion("errores", "acc-sw01"), ["Gi1/0/7: 304 errores", "Gi1/0/2: 6 errores"]);
  assert.deepEqual(await accion("errores", "core-sw01"), ["core-sw01: sin errores en los contadores"]);
  const exp = await accion("exportar", "acc-sw01");
  assert.match(exp[0], /^9 puertos exportados a .*puertos-acc-sw01\.csv$/);
  const tabla = leerCsv(join(datos, "reportes", "puertos-acc-sw01.csv"));
  assert.deepEqual(tabla[4], { puerto: "Gi1/0/5", nombre: "Impresora piso 1", estado: "err-disabled", vlan: "10" });
  assert.deepEqual(await accion("resumen", "rtr-borde01"), ["rtr-borde01 no responde a show interfaces status (¿es un switch Cisco?)"]);
  assert.deepEqual(await accion("resumen", "sw-lab09"), ["sw-lab09 no devolvió el prompt a tiempo. Revisa la sesión y vuelve a intentar."]);
  // Sin el permiso "session" la app rechaza leer o escribir en la sesión.
  await assert.rejects(correr(`${dir}${manifest.entry}`, "acc-sw01", { action: "resumen", session: false }));

  soloLectura(enviados);
  console.log(`comandos enviados por los ejemplos: ${new Set(enviados).size} distintos, todos de consulta`);

  // 5. Packs: el de ejemplo junto al pack Cisco incluido (no debe quedar oculto por duplicado).
  // Mismo armado que src/lib/builtinPacks.ts para el catálogo investigado de Cisco.
  const investigado = JSON.parse(readFileSync(`${ROOT}src/packs/cisco.json`, "utf8"));
  const cisco = validatePack({ ...investigado, format: "netterminal-commands", formatVersion: 1, id: "cisco", vendorName: "Cisco" }).pack;
  assert.ok(cisco.commands.length > 100);
  const v = validatePack(JSON.parse(readFileSync(`${EJ}packs/turno-puertos.json`, "utf8")));
  assert.deepEqual([v.errors, v.warnings], [[], []]);
  const cat = buildCatalog([{ ...cisco, builtin: true }, v.pack], [])[0];
  const mios = cat.commands.filter((c) => c.packId === "turno-puertos");
  assert.equal(mios.length, 3);
  assert.ok(mios.every((c) => c.risk === "read" && !c.escalated));
  console.log(`pack turno-puertos: ${mios.length} comandos visibles en el catálogo Cisco, todos de consulta`);

  // 6. Pack mal declarado: la app usa el mayor riesgo y lo avisa al importar.
  const m = validatePack(JSON.parse(readFileSync(`${AQUI}pack-riesgo-mal-declarado.json`, "utf8")));
  assert.deepEqual(m.errors, []);
  const mc = buildCatalog([m.pack], [])[0].commands;
  const clear = mc.find((c) => c.cmd.startsWith("clear counters"));
  assert.deepEqual([clear.declaredRisk, clear.risk, clear.escalated], ["read", "change", true]);
  assert.equal(mc.filter((c) => c.escalated).length, 1);
  console.log("pack mal declarado: clear counters declarado read, la app lo trata como change");

  // 7. Plantilla de Notas: variables válidas y solo consultas.
  const plantilla = readFileSync(`${EJ}plantillas/revision-puerto.txt`, "utf8");
  assert.deepEqual([...new Set([...plantilla.matchAll(/\{\{\s*([\w.-]+)\s*\}\}/g)].map((x) => x[1]))], ["interfaz"]);
  const llena = plantilla.replaceAll("{{interfaz}}", "Gi1/0/5");
  assert.equal(computeRisk(llena), "read");
  // El campus simulado responde cada línea de la plantilla (escenas de botones y Notas).
  const salida = llena.trim().split("\n").map((c) => respuestaCampus(c, "acc-sw01"));
  assert.ok(salida.every((s) => Array.isArray(s) && s.length), "Una línea de la plantilla no tiene respuesta");
  assert.match(salida[0][1], /^Gi1\/0\/5\s+Impresora piso 1\s+err-disabled/);
  assert.ok(salida[3].some((l) => l.includes("%PM-4-ERR_DISABLE")));
  console.log(`plantilla revision-puerto.txt en acc-sw01: ${salida.map((s) => s.length).join(" + ")} líneas de salida, todo consulta`);

  // 8. Clasificación que muestra el video.
  const riesgos = {
    "show interfaces Gi1/0/5 status": "read",
    "show interfaces status": "read",
    "terminal length 0": "read",
    "show version ; reload": "disruptive",
    "show clock && reload": "disruptive",
    "configure terminal": "change",
    "clear counters Gi1/0/7": "change",
    "interface Gi1/0/5\nshutdown": "disruptive",
  };
  for (const [cmd, r] of Object.entries(riesgos)) assert.equal(computeRisk(cmd), r, cmd);
  console.log("riesgo calculado:", Object.entries(riesgos).map(([c, r]) => `${c.replace("\n", " ⏎ ")} = ${r}`).join(" · "));
  console.log("OK: ejemplos del video 3 validados");
} finally {
  rmSync(datos, { recursive: true, force: true });
}
