// Datos del video 3 a partir de ejecuciones reales: cada script y cada acción del plugin de
// docs/ejemplos corre con Python 3 y el netterminal.py de la app contra el campus simulado
// (equipos-campus.js), con el arnés python-simulado.mjs (mismo protocolo JSON que scripts.rs).
// De cada ejecución salen los comandos por sesión, los mensajes (print) y las confirmaciones;
// aquí se ordenan en una línea de tiempo que mock-v3.js reproduce en la app.
// La carpeta de datos de las ejecuciones es temporal; en pantalla se muestra como
// /Users/operador/NetTerminal/data (ver RUTA_DATOS).
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ROOT, ejecutar } from "../../plugins/python-simulado.mjs";
import { EQUIPOS, respuestaCampus } from "./equipos-campus.js";

const EJ = `${ROOT}docs/ejemplos/`;
const AQUI = `${ROOT}scripts/video/v2/v3-automatizacion/`;
export const RUTA_DATOS = "/Users/operador/NetTerminal/data";
export const RUTA_PLUGIN = "/Users/operador/proyectos/revision-puertos";
export const RUTA_PACKS = "/Users/operador/Documentos";

export const archivos = {
  primer: readFileSync(`${EJ}scripts/primer_script.py`, "utf8"),
  ping: readFileSync(`${EJ}scripts/ping_destinos.py`, "utf8"),
  inventario: readFileSync(`${EJ}scripts/inventario_csv.py`, "utf8"),
  manifiesto: readFileSync(`${EJ}plugins/revision-puertos/plugin.json`, "utf8"),
  main: readFileSync(`${EJ}plugins/revision-puertos/main.py`, "utf8"),
  analisis: readFileSync(`${EJ}plugins/revision-puertos/analisis.py`, "utf8"),
  plantilla: readFileSync(`${EJ}plantillas/revision-puerto.txt`, "utf8"),
  turno: readFileSync(`${EJ}packs/turno-puertos.json`, "utf8"),
  malDeclarado: readFileSync(`${AQUI}pack-riesgo-mal-declarado.json`, "utf8"),
  readme: readFileSync(`${EJ}README.md`, "utf8"),
  secreto: readFileSync(`${AQUI}fixtures/pedir_secreto.py`, "utf8"),
  consola: readFileSync(`${AQUI}fixtures/consola_login.py`, "utf8"),
};

/** Fragmento de docs/ejemplos/README.md con type_saved_password (tal cual). */
export function fragmentoBoveda() {
  const m = archivos.readme.match(/```python\n([\s\S]*?type_saved_password[\s\S]*?)```/);
  assert.ok(m, "README sin el ejemplo de type_saved_password");
  return m[1].trimEnd();
}

const sesion = (nombre) => ({ name: nombre, type: "ssh", host: EQUIPOS[nombre]?.host ?? "192.0.2.5", port: 22, username: "operador" });

/** Lo que entrega plugin_stage/plugin_code de plugins.rs para estos archivos (code_listing). */
function vistaPlugin({ manifiesto, main, analisis }) {
  const files = [
    ["analisis.py", Buffer.byteLength(analisis)],
    ["main.py", Buffer.byteLength(main)],
    ["plugin.json", Buffer.byteLength(manifiesto)],
  ];
  const lineas = (t) => t.split("\n").filter((_, i, a) => i < a.length - 1 || a[i] !== "");
  const code = ["# ===== main.py =====", ...lineas(main), "# ===== analisis.py =====", ...lineas(analisis)].join("\n");
  return { manifest: { entry: "main.py", ...JSON.parse(manifiesto) }, files, code };
}

/** Plugin de demostración con el permiso vault-type (solo para la tarjeta y su casilla). */
const PLUGIN_BOVEDA = {
  manifest: {
    id: "reingreso-consola",
    name: "Reingreso a consola",
    version: "0.1.0",
    description: "Vuelve a entrar a una consola que expiró usando la contraseña guardada de la sesión. El plugin nunca la ve.",
    author: "Equipo de redes",
    entry: "main.py",
    permissions: ["session", "vault-type"],
    actions: [{ id: "reingresar", label: "Reingresar", description: "login y show clock" }],
  },
  files: [["main.py", 412], ["plugin.json", 498]],
  code: "# ===== main.py =====\nimport netterminal as nt\n",
};

const quitarRuta = (t, dir) => t.split(dir).join(RUTA_DATOS);

/**
 * Línea de tiempo: pasos { tipo: "cmd", sesion, cmd } | { tipo: "log", msg } | { tipo: "gate", ... }
 * | { tipo: "secreto", etiqueta } | { tipo: "boveda", sesion } | { tipo: "pausa", ms }.
 * Los comandos y mensajes son los de la ejecución real; el orden sigue al script.
 */
export async function datosVideo() {
  const dir = mkdtempSync(join(tmpdir(), "nt-v3-video-"));
  const correr = (archivo, nombre, extra = {}) =>
    ejecutar(archivo, { host: nombre, responder: respuestaCampus, dataDir: dir, sessionInfo: sesion(nombre), ...extra });
  const L = (r) => r.logs.map((l) => quitarRuta(l, dir));
  try {
    const scripts = {};

    // 1. primer_script.py en core-sw01: el primer print va antes de run().
    const s1 = await correr(`${EJ}scripts/primer_script.py`, "core-sw01");
    const l1 = L(s1);
    assert.deepEqual(s1.porSesion["core-sw01"], ["show version | include Version|uptime"]);
    scripts["primer_script.py"] = {
      sesiones: ["core-sw01"],
      pasos: [{ tipo: "log", msg: l1[0] }, { tipo: "cmd", sesion: "core-sw01", cmd: s1.commands[0] }, ...l1.slice(1).map((msg) => ({ tipo: "log", msg }))],
    };

    // 2. ping_destinos.py: cada ping y sus mensajes; el tercero vence la espera de 8 s.
    const s2 = await correr(`${EJ}scripts/ping_destinos.py`, "core-sw01");
    const l2 = L(s2);
    const pasos2 = [];
    for (const cmd of s2.commands) {
      const ip = cmd.split(" ")[1];
      pasos2.push({ tipo: "cmd", sesion: "core-sw01", cmd });
      for (const msg of l2.filter((l) => l.startsWith(`${ip}:`))) pasos2.push({ tipo: "log", msg, ...(msg.includes("más de 8 s") ? { tras: "parcial" } : {}) });
    }
    pasos2.push(...l2.filter((l) => !/^\d+\.\d+\.\d+\.\d+:/.test(l)).map((msg) => ({ tipo: "log", msg })));
    assert.equal(pasos2.filter((p) => p.tipo === "log").length, l2.length);
    scripts["ping_destinos.py"] = { sesiones: ["core-sw01"], pasos: pasos2 };

    // 3. inventario_csv.py con los cinco equipos del campus, dos en paralelo.
    const todos = ["core-sw01", "acc-sw01", "acc-sw02", "rtr-borde01", "sw-lab09"];
    const s3 = await correr(`${EJ}scripts/inventario_csv.py`, "core-sw01", { sesiones: todos.map(sesion), sessionInfo: undefined, paralelo: 2 });
    assert.equal(s3.estado, "ok");
    assert.ok(s3.enVueloMax <= 2);
    const l3 = L(s3);
    const csv = readFileSync(join(dir, "reportes", "inventario.csv"), "utf8");
    scripts["inventario_csv.py"] = {
      sesiones: todos,
      paralelo: true,
      porSesion: Object.fromEntries(
        todos.map((n) => [n, [...s3.porSesion[n].map((cmd) => ({ tipo: "cmd", sesion: n, cmd })), ...l3.filter((l) => l.startsWith(`${n}: no devolvió`)).map((msg) => ({ tipo: "log", msg }))]]),
      ),
      pasos: l3.filter((l) => !l.includes("no devolvió")).map((msg) => ({ tipo: "log", msg })),
    };

    // 4. Detener script: el mismo inventario en un equipo que no responde y la espera no vence.
    const s4 = await correr(`${EJ}scripts/inventario_csv.py`, "sw-lab09", {
      responder: (cmd, n) => (n === "sw-lab09" ? { colgado: true } : respuestaCampus(cmd, n)),
      detenerTras: 1500,
    });
    assert.equal(s4.estado, "detenido");
    scripts["inventario_csv.py@colgado"] = { sesiones: ["sw-lab09"], colgado: true, pasos: s4.commands.map((cmd) => ({ tipo: "cmd", sesion: "sw-lab09", cmd, colgado: true })), motivo: s4.motivo };

    // 5. ask_secret: diálogo de contraseña; el valor vuelve enmascarado en los mensajes.
    const s5 = await correr(`${AQUI}fixtures/pedir_secreto.py`, "core-sw01", { secreto: "demo-clave-2026" });
    const l5 = L(s5);
    assert.ok(l5.every((l) => !l.includes("demo-clave-2026")) && l5.some((l) => l.includes("••••••")), l5.join("\n"));
    scripts["pedir_secreto.py"] = { sesiones: ["core-sw01"], pasos: [{ tipo: "secreto", etiqueta: "Clave de enable" }, ...l5.map((msg) => ({ tipo: "log", msg }))] };

    // 6. type_saved_password en una consola (el ejemplo de docs/ejemplos/README.md).
    const consola = (cmd, n) => (cmd.trim() === "login" ? { pide: "Password: " } : cmd.trim() === "show clock" ? ["*10:42:17.311 UTC Sat Oct 24 2026"] : respuestaCampus(cmd, n));
    const s6 = await correr(`${AQUI}fixtures/consola_login.py`, "consola-core", {
      responder: consola,
      sesiones: [{ name: "consola-core", host: "192.0.2.250", type: "ssh" }],
      sessionInfo: undefined,
      boveda: true,
      confirmar: () => true,
    });
    assert.deepEqual(s6.escritas, ["consola-core"]);
    const l6 = L(s6);
    scripts["consola_login.py"] = {
      sesiones: ["consola-core"],
      pasos: [
        ...s6.confirmaciones.map((c) => ({ tipo: "gate", sesion: c.session, linea: c.line, opaque: c.opaque, targets: c.targets })),
        { tipo: "cmd", sesion: "consola-core", cmd: "login", pide: "Password: " },
        { tipo: "boveda", sesion: "consola-core" },
        { tipo: "log", msg: l6.find((l) => l.startsWith("Contraseña guardada")) },
        { tipo: "cmd", sesion: "consola-core", cmd: "show clock", salida: ["*10:42:17.311 UTC Sat Oct 24 2026"] },
        ...l6.filter((l) => !l.startsWith("Contraseña guardada")).map((msg) => ({ tipo: "log", msg })),
      ],
    };

    // 7. Plugin revision-puertos: cada acción en acc-sw01.
    const manifest = JSON.parse(archivos.manifiesto);
    const pluginRuns = { [manifest.id]: {} };
    for (const a of manifest.actions) {
      const r = await correr(`${EJ}plugins/revision-puertos/main.py`, "acc-sw01", { action: a.id });
      pluginRuns[manifest.id][a.id] = { sesiones: ["acc-sw01"], pasos: [...r.commands.map((cmd) => ({ tipo: "cmd", sesion: "acc-sw01", cmd })), ...L(r).map((msg) => ({ tipo: "log", msg }))] };
    }

    const v100 = { manifiesto: archivos.manifiesto, main: archivos.main, analisis: archivos.analisis };
    const v101 = { ...v100, manifiesto: archivos.manifiesto.replace('"version": "1.0.0"', '"version": "1.0.1"') };
    assert.notEqual(v101.manifiesto, v100.manifiesto);
    return {
      scripts,
      pluginRuns,
      csv,
      plugins: {
        [`${RUTA_PLUGIN}@1.0.0`]: vistaPlugin(v100),
        [`${RUTA_PLUGIN}@1.0.1`]: vistaPlugin(v101),
        "/Users/operador/proyectos/reingreso-consola": PLUGIN_BOVEDA,
      },
      files: {
        [`${RUTA_PACKS}/turno-puertos.json`]: archivos.turno,
        [`${RUTA_PACKS}/pack-riesgo-mal-declarado.json`]: archivos.malDeclarado,
      },
      plantilla: archivos.plantilla,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Filas del CSV del inventario (para la lámina). */
export function filasCsv(texto) {
  const [cab, ...filas] = texto.trim().split(/\r?\n/).map((l) => l.split(","));
  return { cab, filas };
}

if (process.argv[1]?.endsWith("datos.mjs")) {
  const d = await datosVideo();
  for (const [k, v] of Object.entries(d.scripts)) console.log(k, JSON.stringify(v.pasos ?? v).slice(0, 400));
  console.log(d.csv);
  console.log(JSON.stringify(d.pluginRuns).slice(0, 800));
}
