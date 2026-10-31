// API de scripts: varias sesiones, control de riesgo, ask_secret, cancelación y tiempos.
// Corre el netterminal.py real con Python 3 contra el NetTerminal simulado
// (scripts/video/plugins/python-simulado.mjs), que clasifica cada línea con scriptGate.ts y
// computeRisk como la app. La lógica de Rust equivalente tiene sus pruebas en
// `cargo test scripts::`.
// Uso: node scripts/tests/scripts-api.test.mjs   (Node 22.15+ con tipos TS, python3)
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { ejecutar } from "../video/plugins/python-simulado.mjs";

const { scriptLineRisk, scriptNeedsConfirm, autoDecision } = await import("../../src/lib/scriptGate.ts");
const FX = fileURLToPath(new URL("./fixtures/scripts/", import.meta.url));
const SECRETO = "Cl4ve-Sup3r";

// ---------- Clasificación de líneas ----------
{
  const casos = {
    "show clock": "read",
    "terminal length 0": "read",
    "": "read",
    end: "read",
    "configure terminal": "change",
    "interface Gi1/0/5": "change",
    reload: "disruptive",
    // Sin contexto se pierde que esto va dentro de una interfaz: se trata como corte.
    shutdown: "disruptive",
    "no ip address": "disruptive",
    "show clock ; reload": "disruptive",
  };
  for (const [l, r] of Object.entries(casos)) assert.equal(scriptLineRisk(l, false), r, l);
  assert.equal(scriptLineRisk("show ver⇥", true), "disruptive", "una línea opaca se confirma siempre");
  assert.deepEqual(
    ["read", "change", "disruptive"].map((r) => [scriptNeedsConfirm(r, false), scriptNeedsConfirm(r, true)]),
    [[false, false], [true, false], [true, true]],
  );
  const p = { run: "r", id: "1", script: "s", kind: "gate", session: "a", targets: ["a"], opaque: false };
  assert.equal(autoDecision({ ...p, line: "show version", allowChanges: false }), true);
  assert.equal(autoDecision({ ...p, line: "interface Gi1/0/1", allowChanges: false }), null);
  assert.equal(autoDecision({ ...p, line: "interface Gi1/0/1", allowChanges: true }), true);
  assert.equal(autoDecision({ ...p, line: "reload", allowChanges: true }), null);
}

// ---------- Tres equipos ficticios ----------
const TRES = ["dist-a", "dist-b", "dist-c"].map((name, i) => ({ name, host: `192.0.2.${21 + i}`, platform: "iosxe" }));
const equipos = (cmd, nombre) => {
  if (nombre === "mudo") return { mudo: true };
  if (cmd === "show tech-support") return { colgado: true };
  return cmd.startsWith("show ") ? [`${nombre}: ${cmd}`] : [];
};
const correr = (fx, extra = {}) => ejecutar(`${FX}${fx}`, { sesiones: TRES, responder: equipos, ...extra });

// 1. Varias sesiones: destinos sin credenciales, for_each, on(), expect y sesión principal.
{
  const r = await correr("multi.py", { paralelo: 3, latencia: 30 });
  assert.equal(r.estado, "ok");
  assert.deepEqual(r.logs, [
    "destinos: dist-a,dist-b,dist-c",
    "campos: host,name,platform,port,type",
    "dist-a = dist-a: show clock",
    "dist-b = dist-b: show clock",
    "dist-c = dist-c: show clock",
    "expect: 'show version\\r\\ndist-b: '",
    "resto: 'show version\\r\\ndist-b#'",
    "principal: dist-a dist-a: show users",
    "ajena: La sesión 'ajena' no está entre los destinos elegidos al lanzar el script",
  ]);
  assert.deepEqual(r.porSesion, { "dist-a": ["show clock", "show users"], "dist-b": ["show clock", "show version"], "dist-c": ["show clock"] });
  assert.deepEqual(r.confirmaciones, []);
  assert.equal(r.enVueloMax, 3, "for_each usa el paralelismo elegido al lanzar");
  const seq = await correr("multi.py", { paralelo: 1, latencia: 30 });
  assert.equal(seq.enVueloMax, 1, "por defecto, de a una sesión");
  console.log("varias sesiones: ok (3 destinos, paralelo 3 y secuencial)");
}

// 2. Riesgo: consultas pasan, cambios y cortes se confirman una vez por ejecución.
{
  const r = await correr("cambios.py", { confirmar: () => true });
  assert.equal(r.estado, "ok");
  assert.deepEqual(
    r.confirmaciones.map((c) => `${c.risk}: ${c.line}`),
    ["change: configure terminal", "change: interface Gi1/0/5", "change: description enlace", "disruptive: shutdown", "disruptive: reload"],
    "cada línea se pregunta una vez aunque vaya a tres sesiones",
  );
  assert.ok(r.confirmaciones.every((c) => c.targets.join() === "dist-a,dist-b,dist-c"), "el diálogo nombra los destinos");
  assert.deepEqual(r.porSesion["dist-c"], ["show clock", "configure terminal", "interface Gi1/0/5", "description enlace", "shutdown", "end"]);
  assert.deepEqual(r.logs, ["modo: lectura", "fin"]);

  // "Permitir cambios": los cambios pasan sin preguntar; lo que corta servicio se confirma igual.
  const c = await correr("cambios.py", { permitirCambios: true, confirmar: () => true });
  assert.deepEqual(c.confirmaciones.map((x) => x.line), ["shutdown", "reload"]);
  assert.equal(c.logs[0], "modo: cambios");

  // Rechazar detiene el script: la línea no llega al equipo y nada más se envía.
  const d = await correr("cambios.py", { confirmar: (p) => p.risk !== "disruptive" });
  assert.equal(d.estado, "rechazado");
  assert.match(d.motivo, /«shutdown» en dist-a/);
  assert.ok(!d.commands.includes("shutdown") && !d.commands.includes("reload"));
  assert.deepEqual(d.porSesion["dist-b"], ["show clock"], "tras el rechazo ninguna otra sesión recibe comandos");
  assert.ok(!d.logs.includes("fin"));

  // Sin respuesta del usuario a un cambio en modo lectura: también se rechaza.
  const n = await correr("cambios.py");
  assert.equal(n.estado, "rechazado");
  assert.deepEqual(n.porSesion["dist-a"], ["show clock"]);

  // Teclas que el equipo interpreta (Tab): se confirma siempre, aun permitiendo cambios.
  const t = await correr("teclas.py", { permitirCambios: true });
  assert.equal(t.estado, "rechazado");
  assert.deepEqual([t.confirmaciones[0].opaque, t.confirmaciones[0].risk, t.commands], [true, "disruptive", []]);
  console.log("riesgo: ok (consulta pasa, cambio y corte preguntan una vez, rechazo detiene)");
}

// 3. ask_secret: el valor llega al script y se enmascara en todo lo que muestra la app.
{
  const r = await correr("secreto.py", { secreto: SECRETO, confirmar: () => true });
  assert.equal(r.estado, "ok");
  assert.deepEqual(r.logs, ["recibida: ••••••", "listo"]);
  assert.deepEqual(r.confirmaciones.map((c) => c.line), ["username ops secret ••••••"], "responder la contraseña no se confirma");
  const visible = JSON.stringify([r.logs, r.confirmaciones, r.motivo, r.stderr]);
  assert.ok(!visible.includes(SECRETO), "el secreto aparece en lo que muestra la app");
  // Al equipo sí llega: como respuesta al pedido de contraseña (sin eco) y dentro del cambio.
  assert.deepEqual(r.commands, ["show privilege", `username ops secret ${SECRETO}`]);
  // También en el error de un script que falla con el secreto en el mensaje.
  await assert.rejects(correr("secreto.py", { secreto: SECRETO, confirmar: () => true, dataDir: "/tmp/nt-prueba-falla" }), (e) => {
    assert.match(e.message, /falla con ••••••/);
    assert.ok(!e.message.includes(SECRETO));
    return true;
  });
  const c = await correr("secreto_cancelado.py");
  assert.deepEqual(c.logs, ["cancelado: El usuario canceló el ingreso del secreto", "sigue"]);
  console.log("ask_secret: ok (enmascarado en mensajes, confirmaciones y errores; cancelar no detiene)");
}

// 3b. type_saved_password: solo con la casilla del lanzamiento y un pedido de contraseña en pantalla.
{
  const conLogin = (cmd, nombre) => (cmd === "login" ? { pide: "Password: " } : equipos(cmd, nombre));
  const r = await correr("boveda.py", { responder: conLogin, boveda: true, confirmar: () => true });
  assert.equal(r.estado, "ok");
  assert.deepEqual(r.escritas, ["dist-b"]);
  assert.deepEqual(r.logs, [
    "Contraseña guardada escrita en dist-b (el script no la ve)",
    "dist-b: escrita",
    "dist-a: La pantalla no muestra un pedido de contraseña",
    "dist-b: show clock",
  ]);
  assert.deepEqual(r.confirmaciones.map((c) => c.line), ["login"], "la contraseña no pasa por el control de líneas");
  const sin = await correr("boveda.py", { responder: conLogin, confirmar: () => true });
  assert.deepEqual(sin.escritas, []);
  assert.match(sin.logs[0], /^dist-b: No se permitió escribir contraseñas guardadas/);
  console.log("type_saved_password: ok (aprobación por ejecución, sin pedido no escribe)");
}

// 4. Cancelación y tiempos.
{
  const t0 = Date.now();
  const c = await correr("colgado.py", { detenerTras: 300 });
  assert.equal(c.estado, "detenido");
  assert.deepEqual(c.logs, ["esperando"]);
  assert.ok(Date.now() - t0 < 5000, "Detener corta una espera larga");

  const sesiones = [...TRES, { name: "mudo", host: "192.0.2.99" }];
  const e = await correr("esperas.py", { sesiones, tiempoMax: 600 });
  assert.equal(e.estado, "tiempo");
  assert.deepEqual(e.logs.slice(0, 2), ["timeout: 'show clock\\r\\n'", "esperando"]);
  assert.ok(e.porSesion["dist-a"].length > 1, "el bucle corrió hasta el tiempo máximo");

  const d = await correr("esperas.py", { sesiones, detenerTras: 300 });
  assert.equal(d.estado, "detenido");
  console.log("cancelación y tiempos: ok (Detener, tiempo máximo y ScriptTimeout)");
}

// 5. Plugin sin el permiso "session": no lista ni alcanza sesiones.
await assert.rejects(correr("multi.py", { session: false }), /permiso 'session'/);

console.log("scripts-api: ok");
