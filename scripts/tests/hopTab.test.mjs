// Pruebas de "Saltar desde X" en pestaña propia (src/lib/hopTab.ts), la rueda del mapa
// (src/lib/mapZoom.ts) y las lecturas de tráfico por consola que no deben enviar a ciegas.
// Direcciones de documentación (RFC 5737) y nombres ficticios.
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, next) {
    if (/^\.\.?\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier) && context.parentURL?.endsWith(".ts")) {
      try {
        return next(`${specifier}.ts`, context);
      } catch {
        /* sigue con la resolución normal */
      }
    }
    return next(specifier, context);
  },
});

const H = await import("../../src/lib/hopTab.ts");
const T = await import("../../src/lib/topology.ts");
const R = await import("../../src/lib/topoTraffic.ts");
const Z = await import("../../src/lib/mapZoom.ts");
const { atPrompt } = await import("../../src/lib/cliText.ts");

// ---------- Pantalla: prompt o pregunta ----------

const kind = (t) => H.classifyHopScreen(t).kind;
assert.deepEqual(H.classifyHopScreen("banner\r\ncore-sw01#"), { kind: "prompt", name: "core-sw01" });
assert.deepEqual(H.classifyHopScreen("<ar-wan01>"), { kind: "prompt", name: "ar-wan01" });
assert.equal(kind("Password: "), "password");
assert.equal(kind("Enter password:"), "password");
assert.equal(kind("Please input the password:"), "password");
assert.equal(kind("Username:"), "username");
assert.equal(kind("Please input the username:"), "username");
assert.equal(kind("core-sw01 login:"), "username");
assert.equal(kind("Authorized access only. Banner"), "none");
assert.equal(kind(" --More-- "), "none", "el paginador no es un prompt");
assert.equal(kind(""), "none");
assert.deepEqual(H.classifyHopScreen("Are you sure you want to continue connecting (yes/no/[fingerprint])? "), {
  kind: "hostkey",
  line: "Are you sure you want to continue connecting (yes/no/[fingerprint])?",
  answer: "yes",
});
assert.equal(H.classifyHopScreen("The server is not authenticated. Continue to access it? [Y/N]:").answer, "y", "Huawei contesta y");

// ---------- Eco y errores ----------

assert.equal(H.afterEcho("core#ssh -l noc 192.0.2.11\r\nPassword: ", "ssh -l noc 192.0.2.11"), "Password: ");
assert.equal(H.afterEcho("core#ssh -l noc 192.0.2.11", "ssh -l noc 192.0.2.11"), "", "sin salto de línea aún");
assert.equal(H.afterEcho("sin eco\nPassword:", "ssh x"), "sin eco\nPassword:");
assert.equal(H.afterEcho("core#telnet 192.0.2.5\nconnection refused\ncore#telnet 192.0.2.5\r\nTrying", "telnet 192.0.2.5"), "Trying", "el último intento");
assert.match(H.hopError("% Connection refused by remote host"), /conexión rechazada/);
assert.match(H.hopError("% Connection timed out; remote host not responding"), /tiempo de espera/);
assert.match(H.hopError("ssh: connect to host 192.0.2.9 port 22: No route to host"), /sin ruta/);
assert.match(H.hopError("Permission denied, please try again."), /autenticación/);
assert.match(H.hopError("[Connection to 192.0.2.5 closed by foreign host]"), /cerró/);
assert.equal(H.hopError("dist-sw01 uptime is 3 weeks"), null);

// ---------- Sesión de la pestaña de salto ----------

const base = { id: "s1", name: "core-sw01", type: "ssh", host: "192.0.2.1", port: 2222, username: "noc", identity_file: "~/.ssh/id", jump_host: "198.51.100.9", legacy_ssh: true, save_password: true, on_connect: "terminal length 0", auto_reconnect: true, created_at: "x" };
const hs = H.hopTabSession(base, H.hopTabTitle("dist-sw01", "core-sw01"));
assert.equal(hs.name, "dist-sw01 vía core-sw01");
assert.deepEqual([hs.id, hs.host, hs.port, hs.username, hs.identity_file, hs.jump_host, hs.legacy_ssh, hs.save_password], ["s1", "192.0.2.1", 2222, "noc", "~/.ssh/id", "198.51.100.9", true, true], "misma sesión y credenciales");
assert.deepEqual([hs.on_connect, hs.auto_reconnect], [undefined, false]);
assert.equal(base.on_connect, "terminal length 0", "la sesión original no cambia");
assert.ok(H.isReplayable({ type: "ssh" }) && H.isReplayable({ type: "telnet" }));
assert.ok(!H.isReplayable({ type: "serial" }) && !H.isReplayable({ type: "local" }));

// ---------- Flujo: esperar el prompt, enviar, preguntas ----------

const cmd = T.hopCommand("cisco", "iosxe", "ssh", "noc", "192.0.2.11");
assert.equal(cmd, "ssh -l noc 192.0.2.11");
const run = (job, frames, t0 = 0) => {
  // frames: [ms desde el inicio, pantalla]; devuelve las acciones en orden.
  const acts = [];
  for (const [ms, screen] of frames) {
    const r = H.stepHop(job, screen, t0 + ms);
    job = r.job;
    acts.push(...r.actions.map((a) => ({ ...a, ms })));
  }
  return { job, acts };
};
const fresh = (pivot = "core-sw01") => H.newHopJob({ cmd, neighbor: "dist-sw01", pivot, now: 0 });

// Nada se envía mientras el pivote no muestra su prompt (login, contraseña, banner).
let r = run(fresh(), [
  [0, ""],
  [400, "Connecting to 192.0.2.1..."],
  [800, "noc@192.0.2.1's password: "],
  [1200, "noc@192.0.2.1's password: "],
  [5000, "Last login: x\r\n --More-- "],
]);
assert.equal(r.acts.filter((a) => a.kind === "send").length, 0, "no se envía a ciegas");
assert.equal(r.acts.filter((a) => a.kind === "notify").length, 1, "un aviso de autenticación, una vez");
assert.equal(r.job.phase, "await-prompt");

// Con el prompt, se espera a que se estabilice y se envía una sola vez.
const prompt = "Welcome\r\ncore-sw01#";
r = run(fresh(), [
  [0, ""],
  [400, prompt],
  [800, prompt],
  [1100, prompt],
  [1500, prompt],
  [1900, prompt],
]);
const sends = r.acts.filter((a) => a.kind === "send");
assert.equal(sends.length, 1);
assert.equal(sends[0].data, "ssh -l noc 192.0.2.11\r");
assert.ok(sends[0].ms >= 400 + H.PROMPT_STABLE_MS, "después de PROMPT_STABLE_MS sin cambios");
assert.equal(r.job.phase, "sent");

// Un redibujo que cambia la pantalla reinicia la espera.
r = run(fresh(), [[0, "x\ncore-sw01#"], [300, "x\ncore-sw01#"], [500, "x\ny\ncore-sw01#"], [900, "x\ny\ncore-sw01#"]]);
assert.equal(r.acts.filter((a) => a.kind === "send").length, 0);

// Otro prompt (otro equipo): no se envía, se avisa y vence con un mensaje claro.
r = run(fresh("core-sw01"), [[0, "ar-wan01#"], [1000, "ar-wan01#"], [2000, "ar-wan01#"], [H.PROMPT_WAIT_MS + 1, "ar-wan01#"]]);
assert.equal(r.acts.filter((a) => a.kind === "send").length, 0);
assert.ok(r.acts.some((a) => a.kind === "notify" && /ar-wan01/.test(a.text) && /core-sw01/.test(a.text)));
const timeout = r.acts.find((a) => a.kind === "fail");
assert.match(timeout.reason, /No apareció el prompt de core-sw01/);
assert.match(timeout.reason, /no se envió el salto a dist-sw01/);
assert.equal(r.job.phase, "failed");

// Sin prompt conocido del pivote, sirve el primero que aparezca y queda registrado.
r = run(H.newHopJob({ cmd, neighbor: "dist-sw01", now: 0 }), [[0, "sw-x>"], [700, "sw-x>"]]);
assert.equal(r.job.pivot, "sw-x");

// Pregunta de la llave: se le pregunta al usuario una sola vez (no se contesta sola).
const sentJob = (j) => ({ ...j, phase: "sent", sentAt: 1000, pivot: "core-sw01", tail: "", changedAt: 1000 });
const echo = "core-sw01#ssh -l noc 192.0.2.11\r\n";
r = run(sentJob(fresh()), [
  [1500, `${echo}Are you sure you want to continue connecting (yes/no)? `],
  [1900, `${echo}Are you sure you want to continue connecting (yes/no)? `],
]);
assert.equal(r.acts.filter((a) => a.kind === "ask").length, 1);
assert.equal(r.acts.filter((a) => a.kind === "send").length, 0, "nunca se contesta sola");

// Usuario y contraseña del vecino: los escribe el usuario; solo se avisa.
r = run(sentJob(fresh()), [[1500, `${echo}Password: `], [1900, `${echo}Password: `]]);
assert.equal(r.acts.filter((a) => a.kind === "notify" && /contraseña de dist-sw01/.test(a.text)).length, 1);
assert.ok(!r.acts.some((a) => a.kind === "send" || a.kind === "ask"));
assert.equal(r.job.phase, "sent");

// Éxito: el prompt es de otro equipo y está quieto.
r = run(sentJob(fresh()), [[1500, `${echo}Password: `], [2500, `${echo}Password: \r\nBanner\r\ndist-sw01#`], [2600, `${echo}Password: \r\nBanner\r\ndist-sw01#`], [3300, `${echo}Password: \r\nBanner\r\ndist-sw01#`]]);
assert.deepEqual(r.acts.filter((a) => a.kind === "done").map((a) => a.at), ["dist-sw01"]);
assert.equal(r.job.phase, "done");

// Rechazo: vuelve el prompt del pivote con el error.
r = run(sentJob(fresh()), [[1500, `${echo}% Connection refused by remote host\r\ncore-sw01#`]]);
assert.match(r.acts.find((a) => a.kind === "fail").reason, /conexión rechazada/);
// Tiempo agotado: error sin prompt, con la pantalla quieta.
r = run(sentJob(fresh()), [[1500, `${echo}Trying 192.0.2.11 ...`], [2000, `${echo}Trying 192.0.2.11 ...\r\n% Connection timed out; remote host not responding`], [4000, `${echo}Trying 192.0.2.11 ...\r\n% Connection timed out; remote host not responding`]]);
assert.match(r.acts.find((a) => a.kind === "fail").reason, /tiempo de espera/);
// Sin respuesta ni error: vence por inactividad.
r = run(sentJob(fresh()), [[1500, `${echo}Trying 192.0.2.11 ...`], [1500 + H.HOP_IDLE_MS + 10, `${echo}Trying 192.0.2.11 ...`]]);
assert.match(r.acts.find((a) => a.kind === "fail").reason, /no respondió/);
// Volvió al pivote sin error ni entrar al vecino.
r = run(sentJob(fresh()), [[1500, `${echo}core-sw01#`], [3200, `${echo}core-sw01#`]]);
assert.match(r.acts.find((a) => a.kind === "fail").reason, /volvió a core-sw01/);
// Un trabajo terminado no vuelve a actuar.
assert.deepEqual(H.stepHop(r.job, "core-sw01#", 9e9).actions, []);

// Huawei: stelnet, usuario y contraseña en el equipo.
const hw = T.hopCommand("huawei", "vrp8", "ssh", "", "192.0.2.21");
assert.equal(hw, "stelnet 192.0.2.21");
r = run(H.newHopJob({ cmd: hw, neighbor: "ar-sur01", pivot: "ar-wan01", now: 0 }), [[0, "<ar-wan01>"], [700, "<ar-wan01>"]]);
assert.equal(r.acts.find((a) => a.kind === "send").data, "stelnet 192.0.2.21\r");

// ---------- Rueda del mapa ----------

const w = (o) => ({ deltaX: 0, deltaY: 0, deltaMode: 0, shiftKey: false, ctrlKey: false, metaKey: false, ...o });
for (const dy of [100, -100, 4.000244140625 * 3, 12, 3, 7.3, 1, -250]) assert.equal(Z.wheelIntent(w({ deltaY: dy })), "zoom", `rueda ${dy}`);
assert.equal(Z.wheelIntent(w({ deltaY: -5, ctrlKey: true })), "pinch");
assert.equal(Z.wheelIntent(w({ deltaY: -5, metaKey: true })), "pinch");
assert.equal(Z.wheelIntent(w({ deltaY: 100, shiftKey: true })), "pan");
assert.equal(Z.wheelIntent(w({ deltaX: 30, deltaY: 4 })), "pan", "deslizar de lado");
assert.ok(Z.wheelFactor({ deltaY: -100, deltaMode: 0 }, false) > 1.15 && Z.wheelFactor({ deltaY: -100, deltaMode: 0 }, false) < 1.17, "un paso de rueda: 16 %");
assert.ok(Z.wheelFactor({ deltaY: 100, deltaMode: 0 }, false) < 1);
assert.ok(Z.wheelFactor({ deltaY: -1e6, deltaMode: 0 }, false) < 1.6, "con tope");
assert.ok(Z.wheelFactor({ deltaY: -3, deltaMode: 1 }, false) > 1.1, "por líneas");
// Pellizco de Windows (ctrl + rueda con pasos pequeños, deltaMode 0): suave, simétrico y acumulable.
const pz = (d) => Z.wheelFactor({ deltaY: d, deltaMode: 0 }, true);
assert.ok(pz(-1) > 1 && pz(-1) < 1.02 && pz(1) < 1 && pz(1) > 0.98, "un paso mínimo cambia ~1 %");
assert.ok(Math.abs(pz(-4) * pz(4) - 1) < 1e-9, "abrir y cerrar se compensan");
assert.ok(Math.abs(pz(-2) * pz(-2) - pz(-4)) < 1e-9, "los pasos se acumulan en proporción");
assert.ok(pz(-1e6) <= Math.exp(0.5) + 1e-9, "con tope");
// Dos dedos (pantalla táctil)
assert.deepEqual(Z.pinchMetrics({ x: 0, y: 0 }, { x: 30, y: 40 }), { dist: 50, mid: { x: 15, y: 20 } });
assert.equal(Z.pinchZoom(1, 100, 200, 0.4, 3), 2, "separar los dedos al doble duplica el zoom");
assert.equal(Z.pinchZoom(2, 100, 50, 0.4, 3), 1, "juntarlos lo reduce a la mitad");
assert.equal(Z.pinchZoom(1, 100, 1000, 0.4, 3), 3, "tope máximo");
assert.equal(Z.pinchZoom(1, 100, 1, 0.4, 3), 0.4, "tope mínimo");
assert.equal(Z.pinchZoom(1.5, 0, 100, 0.4, 3), 1.5, "dedos juntos al inicio: sin zoom");
assert.equal(Z.pinchZoom(1.5, 100, NaN, 0.4, 3), 1.5, "distancia inválida: sin zoom");

// ---------- Tráfico por consola: pestaña del equipo y prompt ----------

assert.ok(atPrompt("core-sw01#show interfaces\r\ncore-sw01#   \r\n\r\n"));
assert.ok(atPrompt(undefined), "sin lectura de pantalla no se bloquea");
assert.ok(!atPrompt("Gi1/0/1 is up\r\n --More-- "), "el paginador come el primer carácter");
assert.ok(!atPrompt("noc@192.0.2.1's password: "));
assert.ok(!atPrompt("core-sw01#show int"), "comando del usuario a medias");

const node = (id, ip) => ({ id, name: id, ip, explored: true, x: 0, y: 0 });
const SESSION = { id: "s1", name: "core-sw01", type: "ssh", host: "192.0.2.1", port: 22, username: "noc", created_at: "x" };
const route3 = {
  origin: "core-sw01",
  session: SESSION,
  steps: [
    { name: "dist-sw01", ip: "192.0.2.11", cmd: "ssh -l noc 192.0.2.11", user: "noc" },
    { name: "acc-sw01", ip: "192.0.2.21", cmd: "ssh -l noc 192.0.2.21", user: "noc" },
  ],
};
const pane = (prompt) => () => `banner\r\n${prompt}`;
// Una pestaña por equipo de la ruta: cada una se lee por su propio prompt.
const tabs = [
  { connId: "c1", tabId: "t1", name: "core-sw01", host: "192.0.2.1", screen: pane("core-sw01#") },
  { connId: "c2", tabId: "t2", name: "dist-sw01 vía core-sw01", host: "192.0.2.1", screen: pane("dist-sw01#") },
  { connId: "c3", tabId: "t3", name: "acc-sw01 vía dist-sw01", host: "192.0.2.1", screen: pane("acc-sw01#") },
];
const routes = { t2: H.truncateRoute(route3, 1), t3: route3 };
assert.equal(R.terminalFor(node("core-sw01", "192.0.2.1"), tabs, routes)?.connId, "c1", "el pivote lee por su pestaña");
assert.equal(R.terminalFor(node("dist-sw01", "192.0.2.11"), tabs, routes)?.connId, "c2", "cada equipo de la ruta, su pestaña");
assert.equal(R.terminalFor(node("acc-sw01", "192.0.2.21"), tabs, routes)?.connId, "c3");
// Una pestaña que cambió de equipo nunca se lee: la del pivote ya no está en el pivote.
const moved = [{ ...tabs[0], screen: pane("dist-sw01#") }, ...tabs.slice(1)];
assert.equal(R.terminalFor(node("core-sw01", "192.0.2.1"), moved, routes), undefined, "su sesión apunta al pivote pero el prompt es de otro");
assert.equal(R.terminalFor(node("dist-sw01", "192.0.2.11"), moved, routes)?.connId, "c2", "dos verificadas en el mismo equipo: la más reciente");
// La pestaña de la ruta que volvió con "exit" al equipo anterior deja de ser la del último.
const exited = [tabs[0], tabs[1], { ...tabs[2], screen: pane("dist-sw01#") }];
assert.equal(R.terminalFor(node("acc-sw01", "192.0.2.21"), exited, routes), undefined);
// Prompt de un equipo ajeno a la ruta (el usuario saltó a mano a otro): no es de ninguno de la ruta.
const foreign = [tabs[0], tabs[1], { ...tabs[2], screen: pane("edge-sw09#") }];
assert.equal(R.terminalFor(node("acc-sw01", "192.0.2.21"), foreign, routes), undefined);
assert.equal(R.terminalFor(node("edge-sw09", "192.0.2.99"), foreign, routes), undefined, "ni de ese otro: su ruta no lo conoce");
// Sin prompt a la vista (login, paginador): se usa el último equipo de la ruta, sin verificar.
const busy = [tabs[0], tabs[1], { ...tabs[2], screen: () => "Password: " }];
assert.equal(R.terminalFor(node("acc-sw01", "192.0.2.21"), busy, routes)?.connId, "c3");
// Sin lectura de pantalla: por nombre o IP como antes; la pestaña de una ruta nunca por la IP del pivote.
const noScreen = tabs.map(({ screen, ...t }) => t);
assert.equal(R.terminalFor(node("core-sw01", "192.0.2.1"), noScreen, routes)?.connId, "c1");
assert.equal(R.terminalFor(node("core-sw01", "192.0.2.1"), noScreen.slice(1), routes), undefined, "las de salto no son la del pivote");
assert.equal(R.terminalFor(node("core-sw01", "192.0.2.1"), noScreen.slice(1), {})?.connId, "c3", "sin ruta registrada vuelve a valer la IP (la más reciente)");
// Dos pestañas en el mismo equipo: la más reciente verificada.
assert.equal(R.terminalFor(node("dist-sw01", "192.0.2.11"), [...tabs, { connId: "c4", tabId: "t4", name: "otra", screen: pane("dist-sw01#") }], routes)?.connId, "c4");

// ---------- Ruta de la pestaña ----------

assert.deepEqual(H.routeNames(route3), ["core-sw01", "dist-sw01", "acc-sw01"]);
assert.equal(H.routeTooltip(route3), "core-sw01 › dist-sw01 › acc-sw01");
assert.equal(H.routeTitle(route3), "acc-sw01 vía dist-sw01");
assert.equal(H.routeTitle(H.truncateRoute(route3, 0)), "core-sw01");
assert.equal(H.routeHere(route3), "acc-sw01");
assert.equal(H.routePosition(route3, "x\ndist-sw01#"), 1);
assert.equal(H.routePosition(route3, "x\nedge-sw09#"), -1);
assert.equal(H.routePosition(route3, "Password: "), null);
assert.equal(H.reconcileRoute(route3, "acc-sw01#"), route3, "misma referencia si no cambia");
assert.deepEqual(H.routeNames(H.reconcileRoute(route3, "dist-sw01#")), ["core-sw01", "dist-sw01"], "un exit a mano acorta la ruta");
assert.deepEqual(H.routeNames(H.reconcileRoute(route3, "core-sw01#")), ["core-sw01"]);
assert.equal(H.reconcileRoute(route3, "edge-sw09#"), route3, "un equipo ajeno no cambia la ruta");
assert.deepEqual(H.tabDevice({ name: "x", screen: pane("dist-sw01#") }, route3), { name: "dist-sw01", verified: true, index: 1 });
assert.equal(H.tabDevice({ name: "x", screen: pane("otro#") }, route3), null);
assert.deepEqual(H.tabDevice({ name: "x", screen: () => "--More--" }, route3), { name: "acc-sw01", verified: false, index: 2 });
assert.deepEqual(H.tabDevice({ name: "Core principal", screen: pane("core-sw01#") }), { name: "core-sw01", verified: true, index: 0 });

// ---------- Contadores con el rastro del paginador ----------

const page = (erase) => `core#show interfaces\r\nGigabitEthernet1/0/1 is up, line protocol is up\r\n  Full-duplex, 1000Mb/s, media type is X\r\n 10 packets input, 100 bytes, 0 no buffer\r\n 20 packets output, 200 bytes, 0 underruns\r\n --More-- ${erase}GigabitEthernet1/0/2 is up, line protocol is up\r\n  Full-duplex, 1000Mb/s, media type is X\r\n 11 packets input, 111 bytes, 0 no buffer\r\n 22 packets output, 222 bytes, 0 underruns\r\ncore#`;
for (const erase of ["\r         \r", "\b\b\b\b\b\b\b\b\b         \b\b\b\b\b\b\b\b\b", "\x1b[K"]) {
  const c = R.parseCliCounters(page(erase));
  assert.deepEqual([...c.keys()], ["gi1/0/1", "gi1/0/2"], "la interfaz que abre la página no se pierde");
  assert.equal(c.get("gi1/0/1").outOctets, 200n, "y sus contadores no se atribuyen a la anterior");
  assert.equal(c.get("gi1/0/2").inOctets, 111n);
}
// Dos lecturas separadas por el intervalo dan la tasa por sentido (1000 Mb/s, +30 MB en 30 s).
const rd = (a, b, ts) => ({ inOctets: a, outOctets: b, bits: 64, speed: 1e9, ts });
const rate = R.portRate(rd(1_000_000_000n, 2_000_000_000n, 0), rd(1_030_000_000n, 2_075_000_000n, 30_000));
assert.deepEqual([rate.inBps, rate.outBps], [8e6, 20e6]);


// ---------- Salto encadenado: una pestaña nueva reproduce toda la ruta ----------

const C1 = "ssh -l noc 192.0.2.11";
const C2 = "ssh -l noc 192.0.2.21";
const C3 = "ssh -l noc 192.0.2.31";
const chain = (extra = {}) =>
  H.newHopChain({
    now: 0,
    pivot: "core-sw01",
    steps: [
      { cmd: C1, to: "dist-sw01", ip: "192.0.2.11", user: "noc", ...extra.s1 },
      { cmd: C2, to: "acc-sw01", ip: "192.0.2.21", user: "noc", ...extra.s2 },
      { cmd: C3, to: "edge-sw01", ip: "192.0.2.31", user: "noc", ...extra.s3 },
    ],
  });
/** Avanza el trabajo con pantallas sucesivas, cada una quieta el tiempo indicado. */
const play = (job, frames, t0 = 0) => {
  const acts = [];
  let t = t0;
  for (const [scr, quiet] of frames) {
    for (let ms = 0; ms <= quiet; ms += 200) {
      const rr = H.stepHop(job, scr, t + ms);
      job = rr.job;
      acts.push(...rr.actions.map((a) => ({ ...a, ms: t + ms })));
    }
    t += quiet + 200;
  }
  return { job, acts, t };
};

// Éxito: pivote, h1, h2 y destino; cada comando solo con el prompt del equipo anterior estable.
const home = "core-sw01#";
const e1 = `core-sw01#${C1}\r\nPassword: \r\nBanner dist\r\ndist-sw01#`;
const e2 = `${e1}${C2}\r\nPassword: \r\nBanner acc\r\nacc-sw01#`;
const e3 = `${e2}${C3}\r\nPassword: \r\nBanner edge\r\nedge-sw01#`;
r = play(chain(), [
  [home, 1000],
  [`core-sw01#${C1}\r\n`, 300],
  [`core-sw01#${C1}\r\nPassword: `, 1000],
  [e1, 1500],
  [`${e1}${C2}\r\nPassword: `, 1000],
  [e2, 1500],
  [`${e2}${C3}\r\nPassword: `, 1000],
  [e3, 1500],
]);
assert.deepEqual(r.acts.filter((a) => a.kind === "send").map((a) => a.data), [`${C1}\r`, `${C2}\r`, `${C3}\r`], "un comando por paso, en orden, cada uno una sola vez");
assert.deepEqual(r.acts.filter((a) => a.kind === "send").map((a) => a.from), ["core-sw01", "dist-sw01", "acc-sw01"], "cada uno desde el equipo anterior");
assert.deepEqual(r.acts.filter((a) => a.kind === "step").map((a) => a.at), ["dist-sw01", "acc-sw01"]);
assert.deepEqual(r.acts.filter((a) => a.kind === "done").map((a) => a.at), ["edge-sw01"]);
assert.equal(r.job.phase, "done");
assert.deepEqual(r.acts.filter((a) => a.kind === "done")[0].manual.map((m) => m.to), ["dist-sw01", "acc-sw01", "edge-sw01"], "la contraseña de cada vecino la escribió el usuario");
assert.equal(r.acts.filter((a) => a.kind === "notify" && /Escribe la contraseña de/.test(a.text)).length, 3, "un aviso por vecino, una vez");
assert.ok(!r.acts.some((a) => a.kind === "fill"), "sin credencial no se escribe nada");
const sendAt = r.acts.filter((a) => a.kind === "send").map((a) => a.ms);
const stepAt = r.acts.filter((a) => a.kind === "step").map((a) => a.ms);
assert.ok(sendAt[1] >= stepAt[0] && sendAt[2] >= stepAt[1], "el siguiente comando sale tras llegar al equipo");

// Con un banner a medias (sin prompt) no se envía el siguiente salto.
r = play(chain(), [[home, 1000], [e1.replace("dist-sw01#", "Welcome to dist"), 1500]]);
assert.equal(r.acts.filter((a) => a.kind === "send").length, 1);

// Fallo en el paso 2: la pestaña queda en el último equipo alcanzado y el mensaje dice cuál paso.
r = play(chain(), [
  [home, 1000],
  [`core-sw01#${C1}\r\nPassword: `, 300],
  [e1, 1500],
  [`${e1}${C2}\r\n% Connection refused by remote host\r\ndist-sw01#`, 2000],
]);
const f = r.acts.find((a) => a.kind === "fail");
assert.equal(f.step, 1);
assert.equal(f.sent, true);
assert.match(f.reason, /^Paso 2 de 3 \(dist-sw01 › acc-sw01\): No se pudo saltar a acc-sw01: conexión rechazada/);
assert.equal(r.acts.filter((a) => a.kind === "send").length, 2, "no sigue con el tercero");
assert.equal(r.job.phase, "failed");
assert.deepEqual(H.routeNames(H.routeAfterFail(route3, f.step)), ["core-sw01", "dist-sw01"], "la ruta de la pestaña termina en dist-sw01");
// Fallo en el paso 1 (sin salir del pivote): la pestaña queda en el pivote.
r = play(chain(), [[home, 1000], [`core-sw01#${C1}\r\n% Connection timed out; remote host not responding\r\ncore-sw01#`, 2000]]);
assert.equal(r.acts.find((a) => a.kind === "fail").step, 0);
assert.deepEqual(H.routeNames(H.routeAfterFail(route3, 0)), ["core-sw01"]);

// Un equipo intermedio equivocado detiene la ruta (los saltos siguientes saldrían de otro equipo).
r = play(chain(), [[home, 1000], [`core-sw01#${C1}\r\nBanner\r\nother-sw77#`, 1500]]);
assert.match(r.acts.find((a) => a.kind === "fail").reason, /Llegó a other-sw77 y se esperaba dist-sw01/);
assert.equal(r.acts.filter((a) => a.kind === "send").length, 1);
// En el último paso una diferencia de nombre se acepta y se avisa.
r = play(H.newHopJob({ cmd: C1, neighbor: "dist-sw01", pivot: "core-sw01", now: 0 }), [[home, 1000], [`core-sw01#${C1}\r\nBanner\r\nDIST-SW01-b#`, 1500]]);
assert.match(r.acts.find((a) => a.kind === "done").mismatch, /se esperaba dist-sw01/);
// El nombre con dominio coincide con el del prompt; un destino dado por IP no se compara.
r = play(H.newHopJob({ cmd: C1, neighbor: "dist-sw01.example.net", pivot: "core-sw01", now: 0 }), [[home, 1000], [`core-sw01#${C1}\r\ndist-sw01#`, 1500]]);
assert.equal(r.acts.find((a) => a.kind === "done").mismatch, undefined);
r = play(H.newHopJob({ cmd: C1, neighbor: "192.0.2.11", pivot: "core-sw01", now: 0 }), [[home, 1000], [`core-sw01#${C1}\r\ndist-sw01#`, 1500]]);
assert.equal(r.acts.find((a) => a.kind === "done").mismatch, undefined);

// La llave de cada equipo se pregunta al usuario en su paso (una vez), sin contestarse sola.
r = play(chain(), [
  [home, 1000],
  [`core-sw01#${C1}\r\nPassword: `, 300],
  [e1, 1500],
  [`${e1}${C2}\r\nAre you sure you want to continue connecting (yes/no/[fingerprint])? `, 1500],
]);
assert.equal(r.acts.filter((a) => a.kind === "ask").length, 1);
assert.equal(r.acts.filter((a) => a.kind === "send").length, 2, "no se contesta sola ni se pasa al siguiente");

// Plazos: el prompt del equipo alcanzado se espera por paso; la ruta entera tiene un tope absoluto.
r = play(chain(), [[home, 1000], [`core-sw01#${C1}\r\nPassword: \r\ndist-sw01#`, 700], ["--More--", 100]]);
assert.equal(r.job.phase, "await-prompt");
assert.equal(r.job.index, 1, "esperando el prompt de dist-sw01 para el paso 2");
const late = H.stepHop(r.job, "--More--", r.job.stepStartedAt + H.PROMPT_WAIT_MS + 1);
assert.match(late.actions.find((a) => a.kind === "fail").reason, /Paso 2 de 3/);
assert.match(late.actions.find((a) => a.kind === "fail").reason, /No apareció el prompt de dist-sw01/);
const forever = H.stepHop(chain(), "core-sw01#", H.HOP_TOTAL_MS + 1);
assert.match(forever.actions.find((a) => a.kind === "fail").reason, /no terminó en 30 min/);
// Una pantalla que cambia sin parar tras enviar tampoco espera para siempre.
let jb = { ...chain(), phase: "sent", sentAt: 0, pivot: "core-sw01" };
const spin = H.stepHop(jb, `core-sw01#${C1}\r\nTrying…`, H.USER_WAIT_MS + 1);
assert.match(spin.actions.find((a) => a.kind === "fail").reason, /Paso 1 de 3.*no terminó en 10 min/);

// ---------- Credenciales: se escriben por el backend, una vez por paso, sin reintentos ----------

const sentCred = (cred) => ({ ...H.newHopJob({ cmd: C1, neighbor: "dist-sw01", pivot: "core-sw01", now: 0, cred, ip: "192.0.2.11", user: "noc" }), phase: "sent", sentAt: 1000, tail: "", changedAt: 1000 });
const pwScreen = `core-sw01#${C1}\r\nPassword: `;
for (const src of ["saved", "pivot"]) {
  // Con el pedido recién aparecido no se escribe: debe estar quieto.
  r = play(sentCred(src), [[pwScreen, 100]], 1000);
  assert.ok(!r.acts.some((a) => a.kind === "fill"), "pedido sin estabilizar");
  // Quieto: se pide al backend una sola vez, con el origen y un token del paso.
  r = play(sentCred(src), [[pwScreen, 2000]], 1000);
  const fills = r.acts.filter((a) => a.kind === "fill");
  assert.equal(fills.length, 1, `${src}: un solo intento aunque la pantalla siga igual`);
  assert.equal(fills[0].source, src);
  assert.match(fills[0].token, /^0\|0$/);
  assert.equal(r.job.cred, "asking");
  assert.ok(!r.acts.some((a) => a.kind === "notify"), "con credencial no se pide nada al usuario");
  assert.equal(H.hopWaiting(r.job, pwScreen), "reply", "no necesita al usuario mientras la app la escribe");
  // Escrita: sigue esperando; si el equipo la acepta, el salto termina.
  const typed = H.hopCredResult(r.job, true);
  assert.equal(typed.cred, "typed");
  r = play(typed, [[pwScreen, 1000], [`${pwScreen}\r\nBanner\r\ndist-sw01#`, 1500]], 4000);
  assert.deepEqual(r.acts.map((a) => a.kind), ["done"]);
  assert.deepEqual(r.acts[0].manual, [], "no hay contraseña tecleada por el usuario que ofrecer guardar");
  // Rechazada: nuevo "Password:" -> se avisa una vez, no se reintenta y la escribe el usuario.
  const again = `${pwScreen}\r\nPassword: `;
  r = play(typed, [[again, 3000]], 4000);
  assert.equal(r.acts.filter((a) => a.kind === "cred-rejected").length, 1);
  assert.ok(!r.acts.some((a) => a.kind === "fill"), "no hay segundo intento");
  assert.match(r.acts.find((a) => a.kind === "cred-rejected").text, /fue rechazada: no se reintenta/);
  assert.equal(r.job.cred, "rejected");
  assert.equal(r.acts.filter((a) => a.kind === "notify" && /Escribe la contraseña de dist-sw01/.test(a.text)).length, 1, "y se le pide al usuario, una vez");
  assert.equal(H.hopWaiting(r.job, again), "password", "ahora sí necesita al usuario");
  r = play(r.job, [[again, 3000]], 8000);
  assert.ok(!r.acts.some((a) => a.kind === "fill" || a.kind === "cred-rejected" || a.kind === "notify"), "ni al repetirse la pantalla");
  // Rechazo con mensaje del equipo (sin nuevo pedido en pantalla aún).
  for (const msg of ["Permission denied, please try again.", "% Authentication failed.", "% Login invalid", "Access denied"]) {
    r = play(typed, [[`${pwScreen}\r\n${msg}\r\nconnecting`, 3000]], 4000);
    assert.equal(r.acts.filter((a) => a.kind === "cred-rejected").length, 1, msg);
  }
  // El backend no la escribió (bóveda bloqueada, pedido de otro equipo): la escribe el usuario, sin reintento.
  const fr = H.hopCredResult({ ...sentCred(src), cred: "asking" }, false);
  assert.equal(fr.cred, "failed");
  r = play(fr, [[pwScreen, 3000]], 4000);
  assert.ok(!r.acts.some((a) => a.kind === "fill"));
  assert.equal(r.acts.filter((a) => a.kind === "notify").length, 1);
  assert.deepEqual(r.job.manual, [0]);
}
// La credencial no se aplica a un pedido de usuario.
r = play(sentCred("saved"), [[`core-sw01#${C1}\r\nUsername: `, 2000]], 1000);
assert.ok(!r.acts.some((a) => a.kind === "fill"));
assert.equal(r.acts.filter((a) => a.kind === "notify").length, 1);
// hopCredResult solo actúa si se había pedido.
assert.equal(H.hopCredResult(sentCred("saved"), true).cred, "idle");

// Cadena con credenciales por paso: el paso 2 usa la suya sola; el 1 lo teclea el usuario.
r = play(chain({ s2: { cred: "saved" } }), [
  [home, 1000],
  [`core-sw01#${C1}\r\nPassword: `, 300],
  [e1, 1500],
  [`${e1}${C2}\r\nPassword: `, 1500],
]);
const fill2 = r.acts.filter((a) => a.kind === "fill");
assert.deepEqual(fill2.map((a) => a.step), [1]);
assert.equal(r.acts.filter((a) => a.kind === "notify" && /contraseña de dist-sw01/.test(a.text)).length, 1);
assert.deepEqual(r.job.manual, [0]);

// Rechazo con SSH que termina: el fallo dice autenticación rechazada y no hay otro intento.
r = play(sentCred("saved"), [[pwScreen, 2000]], 1000);
r = play(H.hopCredResult(r.job, true), [[`${pwScreen}\r\n% Authentication failed.\r\ncore-sw01#`, 2000]], 4000);
assert.ok(r.acts.some((a) => a.kind === "fail" && /autenticación rechazada/.test(a.reason)));
assert.ok(!r.acts.some((a) => a.kind === "fill"));

// Detección de pedidos y rechazos (lo que mira el salto en la pantalla).
assert.equal(H.passwordPrompts("Password: \r\nbad\r\nPassword: "), 2);
assert.equal(H.passwordPrompts("core#show running-config | include password\r\n"), 0);
assert.ok(H.authRejected("Permission denied (publickey,password)."));
assert.ok(H.authRejected("% Authentication failed"));
assert.ok(H.authRejected("% Login invalid"));
assert.ok(H.authRejected("Access denied"));
assert.ok(!H.authRejected("Last login: Mon\r\nBanner: authorized access only"));
assert.equal(kind("noc@192.0.2.11's password: "), "password");
assert.equal(kind("(noc@192.0.2.11) Password: "), "password");
assert.equal(kind("Enter passphrase for key '/home/u/.ssh/id_ed25519':"), "password");

// Qué espera el salto, para ofrecer ir a la pestaña.
assert.equal(H.hopWaiting(fresh(), "core-sw01#"), "prompt");
assert.equal(H.hopWaiting(fresh(), "Password: "), "password");
assert.equal(H.hopWaiting(fresh(), "Username: "), "username");
assert.equal(H.hopWaiting(sentJob(fresh()), `${echo}Are you sure you want to continue connecting (yes/no)? `), "hostkey");
assert.equal(H.hopWaiting(sentJob(fresh()), `${echo}Trying 192.0.2.11 ...`), "reply");
assert.equal(H.hopWaiting({ ...fresh(), phase: "done" }, ""), "done");

// ---------- Plan: qué hace "Abrir terminal" y qué ofrece el menú ----------

const N = (id, ip, platform) => ({ id, name: id, ip, platform });
const nodes = [N("core-sw01", "192.0.2.1", "cisco WS-C3850"), N("dist-sw01", "192.0.2.11"), N("acc-sw01", "192.0.2.21"), N("iso-sw01", undefined)];
const links = [
  { a: "core-sw01", b: "dist-sw01" },
  { a: "dist-sw01", b: "acc-sw01" },
  { a: "acc-sw01", b: "iso-sw01" },
  { a: "core-sw01", b: "acc-sw01", logical: true },
];
const cmdFor = (_from, to) => ({ cmd: `ssh -l noc ${to.ip}`, user: "noc" });
const PT = (id, name, route, screenName, extra = {}) => ({
  tabId: id,
  name,
  session: SESSION,
  status: "connected",
  route,
  device: H.tabDevice({ name, screen: pane(screenName) }, route),
  free: true,
  ...extra,
});
const base2 = { nodes, links, saved: new Map(), needsPivot: false, directOk: true, cmdFor };
const plan = (target, o = {}) => H.planOpen({ ...base2, target: nodes.find((n) => n.id === target), tabs: [PT("t1", "core-sw01", undefined, "core-sw01#")], ...o });

// Con pestaña en el equipo: la enfoca.
let pl = plan("core-sw01");
assert.equal(pl.primary.kind, "focus");
assert.equal(pl.primary.tabId, "t1");
// Alcanzable directo (por defecto): conecta directo y ofrece abrir vía el anterior de la ruta.
pl = plan("acc-sw01");
assert.equal(pl.primary.kind, "direct");
assert.deepEqual(pl.alternatives.map((a) => a.kind), ["route"]);
assert.equal(pl.alternatives[0].label, "Abrir vía dist-sw01");
assert.equal(pl.alternatives[0].detail, "core-sw01 › dist-sw01 › acc-sw01");
assert.deepEqual(pl.names, ["core-sw01", "dist-sw01", "acc-sw01"]);
// Marcado "solo por pivote": abre por la ruta (salto encadenado) y deja directo como alternativa.
pl = plan("acc-sw01", { needsPivot: true });
assert.equal(pl.primary.kind, "route");
assert.deepEqual(H.routeNames(pl.primary.route), ["core-sw01", "dist-sw01", "acc-sw01"]);
assert.deepEqual(pl.primary.route.steps.map((s) => s.cmd), ["ssh -l noc 192.0.2.11", "ssh -l noc 192.0.2.21"]);
assert.equal(pl.primary.route.session, SESSION, "se reconecta la sesión del pivote");
assert.deepEqual(pl.alternatives.map((a) => a.kind), ["direct"]);
assert.equal(pl.alternatives[0].label, "Conectar directo desde este PC");
// Sin sesión base directa: por la ruta aunque no esté marcado. Las sesiones lógicas (BGP) no son un salto.
pl = plan("acc-sw01", { directOk: false });
assert.equal(pl.primary.kind, "route");
assert.equal(pl.primary.route.steps.length, 2);
// Con una pestaña ya en el equipo anterior (ruta core › dist): se reutiliza esa ruta y se ofrece saltar en ella.
const tDist = PT("t2", "dist-sw01 vía core-sw01", H.truncateRoute(route3, 1), "dist-sw01#");
pl = plan("acc-sw01", { needsPivot: true, tabs: [PT("t1", "core-sw01", undefined, "core-sw01#"), tDist] });
assert.equal(pl.primary.kind, "route");
assert.deepEqual(pl.primary.route.steps.map((s) => s.name), ["dist-sw01", "acc-sw01"], "la ruta conocida de la pestaña de dist-sw01, más el salto nuevo");
assert.deepEqual(pl.alternatives.map((a) => [a.kind, a.label]), [["direct", "Conectar directo desde este PC"], ["inplace", "Saltar en la pestaña de dist-sw01"]]);
assert.equal(pl.alternatives[1].tabId, "t2");
assert.deepEqual(pl.alternatives[1].route.steps.map((s) => s.name), ["dist-sw01", "acc-sw01"], "la ruta de la pestaña más el salto; en ella solo se da el último");
// La pestaña de dist-sw01 ocupada (comando en curso): no se ofrece saltar en ella.
pl = plan("acc-sw01", { needsPivot: true, tabs: [PT("t1", "core-sw01", undefined, "core-sw01#"), { ...tDist, free: false }] });
assert.ok(!pl.alternatives.some((a) => a.kind === "inplace"));
// Con una pestaña de la ruta en el propio equipo destino: enfoca esa y el breadcrumb es su ruta.
pl = plan("acc-sw01", { tabs: [PT("t1", "core-sw01", undefined, "core-sw01#"), tDist, PT("t3", "acc-sw01 vía dist-sw01", route3, "acc-sw01#")] });
assert.equal(pl.primary.kind, "focus");
assert.equal(pl.primary.tabId, "t3");
assert.deepEqual(pl.names, ["core-sw01", "dist-sw01", "acc-sw01"]);
// Pestaña caída en el equipo: se ofrece reconectar y se abre de nuevo (no se enfoca una muerta).
pl = plan("acc-sw01", { tabs: [PT("t1", "core-sw01", undefined, "core-sw01#"), PT("t3", "acc-sw01 vía dist-sw01", route3, "acc-sw01#", { status: "closed" })] });
assert.equal(pl.primary.kind, "direct");
assert.ok(pl.alternatives.some((a) => a.kind === "reconnect" && a.tabId === "t3"));
// Una pestaña que cambió de equipo no cuenta como la del equipo.
pl = plan("acc-sw01", { tabs: [PT("t1", "core-sw01", undefined, "core-sw01#"), PT("t3", "acc-sw01 vía dist-sw01", route3, "otro-sw#")] });
assert.notEqual(pl.primary.kind, "focus");
// Sin IP, sin ruta: sin acción y con el motivo.
pl = plan("iso-sw01", { directOk: false, tabs: [] });
assert.equal(pl.primary, undefined);
assert.match(pl.reason, /IP de gestión/);
// El comando que no se puede armar (usuario inválido) descarta la ruta.
pl = plan("acc-sw01", { directOk: false, cmdFor: () => null });
assert.equal(pl.primary, undefined);
// Tope de la ruta: más de MAX_ROUTE_STEPS saltos no se arman, y se dice (no cae en silencio).
assert.equal(H.MAX_ROUTE_STEPS, 8);
const longNodes = Array.from({ length: 13 }, (_, i) => N(`n${i}`, `192.0.2.${i + 1}`));
const longLinks = longNodes.slice(1).map((n, i) => ({ a: longNodes[i].id, b: n.id }));
pl = H.planOpen({ ...base2, nodes: longNodes, links: longLinks, target: longNodes[H.MAX_ROUTE_STEPS + 2], directOk: false, tabs: [PT("t1", "n0", undefined, "n0#")] });
assert.equal(pl.primary, undefined, "más saltos que el tope no se arman");
assert.match(pl.reason, /10 saltos y el tope es 8/);
pl = H.planOpen({ ...base2, nodes: longNodes, links: longLinks, target: longNodes[H.MAX_ROUTE_STEPS], directOk: false, tabs: [PT("t1", "n0", undefined, "n0#")] });
assert.equal(pl.primary.route.steps.length, H.MAX_ROUTE_STEPS);
// La IP del vecino y el usuario solo entran validados: lo hace hopCommand, nunca el nombre CDP.
assert.equal(T.hopCommand("cisco", "iosxe", "ssh", "noc", "192.0.2.11; reload"), null);
assert.equal(T.hopCommand("cisco", "iosxe", "ssh", "noc -o ProxyCommand=x", "192.0.2.11"), null);
assert.equal(H.vendorOfPlatform("cisco WS-C3850-24P"), "cisco");
assert.equal(H.vendorOfPlatform("Huawei S5720"), "huawei");
assert.equal(H.vendorOfPlatform("FortiGate-100F"), "fortinet");
assert.equal(H.vendorOfPlatform("Juniper EX4300"), "juniper");
assert.equal(H.vendorOfPlatform("MikroTik"), undefined);
assert.ok(H.isNxos("Cisco Nexus9000 C93180") && !H.isNxos("cisco WS-C3850"));


// ---------- Cadena de 6 equipos: cada salto parte del equipo anterior ----------
// core › dist › agg › acc1 › acc2 › acc3 (solo cada uno alcanzable desde el anterior). Los nombres del diagrama llevan
// dominio y mayúsculas (CDP) y los prompts van en minúsculas; hay enlaces redundantes que acortarían la ruta por BFS.
{
  const ids = ["core-sw01", "dist-sw01", "agg-sw01", "acc-sw01", "acc-sw02", "acc-sw03", "acc-sw04"];
  const cdp = (i) => (i === 0 ? ids[0] : `${ids[i].toUpperCase()}.lab.ejemplo`);
  const chainNodes = ids.map((id, i) => ({ id, name: cdp(i), ip: `192.0.2.${i + 1}` }));
  const chainLinks = ids.slice(1).map((id, i) => ({ a: ids[i], b: id }));
  const sess = { id: "s-core", name: "core-sw01", type: "ssh", host: "192.0.2.1", port: 22, username: "noc", save_password: true };
  const chainCmd = (_f, to) => ({ cmd: `ssh -l noc ${to.ip}`, user: "noc" });
  const tabAt = (k, route, extra = {}) => ({
    tabId: `t${k}`,
    name: ids[k],
    session: sess,
    status: "connected",
    route,
    device: H.tabDevice({ name: ids[k], screen: pane(`${ids[k]}#`) }, route),
    free: true,
    ...extra,
  });
  const common = { saved: new Map(), needsPivot: false, directOk: true, cmdFor: chainCmd };
  let tabs = [tabAt(0, undefined)];
  const cameFrom = new Map();
  for (let k = 1; k <= 6; k++) {
    // Descubierto desde la pestaña del equipo anterior (ruta = la de esa pestaña).
    const parentTab = tabs[k - 1];
    cameFrom.set(ids[k], { from: ids[k - 1], route: parentTab.route ?? { origin: ids[0], session: sess, steps: [] } });
    const p = H.planOpen({ ...common, nodes: chainNodes.slice(0, k + 1), links: chainLinks.slice(0, k), target: chainNodes[k], tabs, cameFrom });
    // Por defecto va por la ruta (un equipo descubierto desde un salto no se alcanza directo), el directo queda en el menú.
    if (k > 1) assert.equal(p.primary.kind, "route", `salto ${k}: abre por la ruta heredada`);
    const route = (p.primary.kind === "route" ? p.primary : p.alternatives.find((a) => a.kind === "route")).route;
    assert.deepEqual(route.steps.length, k, `salto ${k}: ${k} pasos`);
    assert.equal(route.session, sess);
    // Exactamente la ruta de la pestaña que está en el equipo anterior más el paso nuevo.
    assert.deepEqual(H.routeNames(route).slice(0, k).map(T.nodeId), ids.slice(0, k));
    assert.equal(route.steps[k - 1].cmd, `ssh -l noc 192.0.2.${k + 1}`);
    assert.equal(route.steps[k - 1].ip, `192.0.2.${k + 1}`);
    if (k > 1) assert.ok(p.alternatives.some((a) => a.kind === "inplace" && a.tabId === `t${k - 1}`));
    // La pestaña nueva queda en el equipo (prompt en minúsculas, nombre del diagrama con dominio).
    tabs = [...tabs, tabAt(k, route)];
  }
  // 6 saltos (más que el antiguo tope de 5) siguen sin recalcularse ni quedar en silencio.
  assert.equal(tabs[6].route.steps.length, 6);

  // Enlaces redundantes (core ↔ acc-sw02, dist ↔ acc-sw02) acortarían la ruta por BFS: no se usan.
  const mesh = [...chainLinks, { a: "core-sw01", b: "acc-sw02" }, { a: "dist-sw01", b: "acc-sw02" }];
  const tabs5 = tabs.slice(0, 4);
  const cf = new Map([["acc-sw02", { from: "acc-sw01", route: tabs5[3].route }]]);
  let q = H.planOpen({ ...common, nodes: chainNodes, links: mesh, target: chainNodes[4], tabs: tabs5, cameFrom: cf });
  assert.deepEqual(H.routeNames(q.primary.route).map(T.nodeId), ids.slice(0, 5), "herencia: core › dist › agg › acc1 › acc2");
  const sh = q.alternatives.find((a) => a.kind === "shortest");
  assert.ok(sh, "la ruta más corta se ofrece, solo en el menú");
  assert.deepEqual(H.routeNames(sh.route).map(T.nodeId), ["core-sw01", "acc-sw02"]);
  // Sin procedencia (equipo agregado a mano) se mantiene la más corta de siempre.
  q = H.planOpen({ ...common, nodes: chainNodes, links: mesh, target: chainNodes[4], tabs: tabs5, needsPivot: true });
  assert.deepEqual(H.routeNames(q.primary.route).map(T.nodeId), ["core-sw01", "acc-sw02"]);
  // Si la pestaña del equipo anterior se cerró, se usa la ruta que tenía al descubrirlo.
  q = H.planOpen({ ...common, nodes: chainNodes, links: chainLinks, target: chainNodes[4], tabs: [tabs5[0]], cameFrom: cf });
  assert.deepEqual(H.routeNames(q.primary.route).map(T.nodeId), ids.slice(0, 5));
  assert.ok(!q.alternatives.some((a) => a.kind === "inplace"), "sin pestaña no se salta en ella");
  // Con dos pestañas en el equipo anterior se usa la de la ruta con que se descubrió.
  const otherRoute = { origin: "core-sw01", session: sess, steps: [{ name: "acc-sw01", ip: "192.0.2.4", cmd: "ssh -l noc 192.0.2.4", user: "noc" }] };
  const dup = { ...tabAt(3, otherRoute), tabId: "tx" };
  q = H.planOpen({ ...common, nodes: chainNodes, links: mesh, target: chainNodes[4], tabs: [dup, ...tabs5], cameFrom: cf });
  assert.deepEqual(H.routeNames(q.primary.route).map(T.nodeId), ids.slice(0, 5));
  assert.equal(q.alternatives.find((a) => a.kind === "inplace")?.tabId, "t3");

  // Sobre el tope: se avisa, no cae en una ruta distinta ni en directo en silencio.
  const deepIds = Array.from({ length: 11 }, (_, i) => `h${i}`);
  const deepNodes = deepIds.map((id, i) => ({ id, name: id, ip: `192.0.2.${i + 1}` }));
  const deepLinks = deepIds.slice(1).map((id, i) => ({ a: deepIds[i], b: id }));
  const deepRoute = { origin: "h0", session: sess, steps: deepIds.slice(1, 9).map((id, i) => ({ name: id, ip: `192.0.2.${i + 2}`, cmd: `ssh -l noc 192.0.2.${i + 2}`, user: "noc" })) };
  const deepTab = { ...tabAt(0, deepRoute), tabId: "td", name: "h8", device: H.tabDevice({ name: "h8", screen: pane("h8#") }, deepRoute) };
  const far = H.planOpen({ ...common, directOk: false, nodes: deepNodes, links: deepLinks, target: deepNodes[9], tabs: [deepTab], cameFrom: new Map([["h9", { from: "h8", route: deepRoute }]]) });
  assert.equal(far.primary, undefined);
  assert.match(far.reason, /9 saltos y el tope es 8/);
}

// Prompt distinto del nombre del diagrama (guion bajo, otro dominio): misma ruta y misma pestaña.
{
  const sess = { id: "s", name: "core-sw01", type: "ssh", host: "192.0.2.1", port: 22, username: "noc" };
  const route = {
    origin: "core-sw01",
    session: sess,
    steps: [
      { name: "ACC-SW01.lab.ejemplo", ip: "192.0.2.4", cmd: "ssh -l noc 192.0.2.4", user: "noc", prompt: "ACC_SW01" },
      { name: "Acc-Sw02.lab.ejemplo", ip: "192.0.2.5", cmd: "ssh -l noc 192.0.2.5", user: "noc" },
    ],
  };
  assert.deepEqual(H.routePrompts(route), ["core-sw01", "ACC_SW01", "Acc-Sw02.lab.ejemplo"]);
  assert.equal(H.routePosition(route, "ACC_SW01#"), 1, "el prompt con guion bajo ubica el equipo");
  assert.equal(H.routePosition(route, "acc-sw01#"), 1, "y su nombre de diagrama también");
  assert.equal(H.routePosition(route, "acc_sw02#"), 2, "guion bajo y guion son lo mismo");
  assert.equal(H.routePosition(route, "otro-sw#"), -1);
  const d = H.tabDevice({ name: "t", screen: pane("ACC_SW01#") }, route);
  assert.equal(d.name, "ACC-SW01.lab.ejemplo", "el equipo es el del diagrama");
  assert.equal(d.index, 1);
  assert.equal(H.tabAtDevice("acc-sw01", ["192.0.2.4"], [{ name: "t", tabId: "t1", screen: pane("ACC_SW01#") }], { t1: route })?.verified, true);
  // El salto encadenado espera el prompt del alias, no el nombre del diagrama.
  const job = H.newHopChain({
    steps: [
      { cmd: "ssh -l noc 192.0.2.4", to: "ACC_SW01" },
      { cmd: "ssh -l noc 192.0.2.5", to: "Acc-Sw02.lab.ejemplo" },
    ],
    pivot: "core-sw01",
    now: 0,
  });
  let r = H.stepHop(job, "core-sw01#", 0);
  r = H.stepHop(r.job, "core-sw01#", 1_000);
  assert.equal(r.actions[0].kind, "send");
  r = H.stepHop({ ...r.job, tail: "" }, "core-sw01#ssh -l noc 192.0.2.4\r\nACC_SW01#", 2_000);
  r = H.stepHop(r.job, "core-sw01#ssh -l noc 192.0.2.4\r\nACC_SW01#", 4_000);
  assert.ok(r.actions.some((a) => a.kind === "step"), "llega al intermedio con prompt distinto del diagrama y sigue");
  assert.equal(r.job.phase, "await-prompt");
}

console.log("hopTab: ok");

// Clave de credencial de vecino: misma IP escrita distinto = misma clave (igual que el backend).
{
  const { hopCredKey } = await import("../../src/lib/hopCred.ts");
  assert.equal(hopCredKey("2001:DB8:0::1", "noc"), hopCredKey("2001:db8::1", "noc"));
  assert.equal(hopCredKey("::ffff:192.0.2.1", "noc"), hopCredKey("192.0.2.1", "noc"));
  assert.equal(hopCredKey(" 192.0.2.1 ", "noc"), "192.0.2.1|noc");
}

