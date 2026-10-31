// Pruebas de la tecla Retroceso y del eco de borrado: `node scripts/tests/backspace.test.mjs`
// (Node 22.15+ con tipos TS). Cubre el modo DEL/BS por sesión, la traducción de la tecla, el
// seguimiento de lo tecleado (sugerencias) y que el resaltado entregue el eco de borrado de
// Huawei VRP ("\b \b", "\x08\x1b[K", DEL) sin cambios y en orden.
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

// suggest.ts importa sin extensión (como lo resuelve Vite): se completa con .ts.
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

// StreamHighlighter usa window.setTimeout (corre en el navegador).
globalThis.window ??= globalThis;

const B = await import("../../src/lib/backspace.ts");
const { InputTracker } = await import("../../src/lib/suggest.ts");
const H = await import("../../src/lib/highlight.ts");

const DEL = "\x7f";
const BS = "\b";
const key = (mods = {}) => ({ ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods });

// ---------- Modo por sesión ----------

assert.equal(B.backspaceMode({}), "del", "sin plataforma: DEL, como xterm y PuTTY");
assert.equal(B.backspaceMode({ platform: "iosxe" }), "del");
for (const p of ["vrp5", "vrp8", "yunshan"]) assert.equal(B.backspaceMode({ platform: p }), "bs", `Huawei ${p}: BS automático`);
assert.equal(B.backspaceMode({ platform: "vrp8", backspace: "del" }), "del", "la sesión manda sobre el automático");
assert.equal(B.backspaceMode({ platform: "iosxe", backspace: "bs" }), "bs");
assert.equal(B.backspaceMode({ backspace: "otro" }), "del", "valor desconocido: automático");
assert.equal(B.backspaceOptions("vrp8")[0][0], "", "primera opción: automático");
assert.match(B.backspaceOptions("vrp8")[0][1], /BS/);

// ---------- Secuencia por tecla ----------

for (const [mode, main, other] of [
  ["del", DEL, BS],
  ["bs", BS, DEL],
]) {
  assert.equal(B.backspaceSeq(key(), mode, true), main, `${mode}: Retroceso`);
  assert.equal(B.backspaceSeq(key({ shiftKey: true }), mode, true), other, `${mode}: Shift envía el otro código (PuTTY)`);
  assert.equal(B.backspaceSeq(key({ ctrlKey: true }), mode, true), "\x17", `${mode}: Ctrl borra palabra (^W)`);
  assert.equal(B.backspaceSeq(key({ altKey: true }), mode, true), "\x17", `${mode}: Alt/Option borra palabra (^W)`);
  // Pantalla completa (vim, nano): convención de xterm.
  assert.equal(B.backspaceSeq(key(), mode, false), main);
  assert.equal(B.backspaceSeq(key({ ctrlKey: true }), mode, false), other);
  assert.equal(B.backspaceSeq(key({ altKey: true }), mode, false), "\x1b" + main);
  assert.equal(B.backspaceSeq(key({ metaKey: true }), mode, true), null, "Cmd+Retroceso queda como lo maneje xterm");
}

// translateBackspace solo toca lo que xterm envía para Retroceso.
assert.equal(B.translateBackspace(DEL, BS), BS);
assert.equal(B.translateBackspace("\x1b\x7f", "\x17"), "\x17");
assert.equal(B.translateBackspace(BS, DEL), DEL);
assert.equal(B.translateBackspace(DEL, null), DEL, "sin pulsación de Retroceso no se toca");
assert.equal(B.translateBackspace("a", BS), "a", "otra tecla no se toca");
assert.equal(B.translateBackspace("ab\x7f", BS), "ab\x7f", "un pegado no se toca");

// ---------- Seguimiento de lo tecleado (sugerencias) ----------

const tail = (t) => () => t;
for (const bsByte of [DEL, BS]) {
  const t = new InputTracker();
  t.output("\r\n<HUAWEI>", tail("\n<HUAWEI>"));
  assert.equal(t.active, true);
  for (const ch of "disx") t.input(ch);
  t.input(bsByte);
  assert.equal(t.buf, "dis", `${JSON.stringify(bsByte)} borra un carácter en el seguimiento`);
  assert.equal(t.active, true, "Retroceso no corta el seguimiento");
  t.input(bsByte);
  t.input(bsByte);
  t.input(bsByte);
  t.input(bsByte);
  assert.equal(t.buf, "", "Retroceso con la línea vacía no falla");
}
{
  const t = new InputTracker();
  t.output("\r\n<HUAWEI>", tail("\n<HUAWEI>"));
  for (const ch of "dis int") t.input(ch);
  t.input("\x17");
  assert.equal(t.active, false, "^W deja de seguir la línea hasta el próximo prompt");
}

// ---------- Resaltado: el eco de borrado llega igual y en orden ----------

/** Pantalla mínima: imprimibles, \b, \r, \n, ESC[K y ESC[D; ignora SGR. */
function screen(text) {
  const lines = [[]];
  let row = 0;
  let col = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "\x1b") {
      const m = /^\x1b\[([0-9;]*)([A-Za-z])/.exec(text.slice(i));
      assert.ok(m, `secuencia ESC incompleta en ${JSON.stringify(text.slice(i, i + 8))}`);
      if (m[2] === "K") lines[row].length = col;
      else if (m[2] === "D") col = Math.max(0, col - Number(m[1] || 1));
      i += m[0].length - 1;
    } else if (c === "\b") col = Math.max(0, col - 1);
    else if (c === "\r") col = 0;
    else if (c === "\n") {
      row++;
      lines[row] ??= [];
    } else if (c !== DEL) {
      lines[row][col++] = c;
    }
  }
  return lines.map((l) => Array.from(l, (x) => x ?? " ").join("").trimEnd());
}
const stripSgr = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rules = H.compile(H.effectiveRules({ enabled: true, schemes: ["huawei", "common"], custom: [] }));
assert.ok(rules.length > 0);

async function feed(chunks, withRules = true) {
  const out = [];
  const hl = new H.StreamHighlighter((s) => out.push(s), () => (withRules ? rules : []), () => false);
  for (const c of chunks) {
    hl.push(c);
    await sleep(1);
  }
  await sleep(30);
  hl.flush();
  hl.dispose();
  return out;
}

const cases = {
  // VRP 5: eco "\b \b" por cada Retroceso (o ^H).
  "\\b \\b": ["\r\n<HUAWEI>", "d", "i", "s", "x", "\b \b", " ", "i", "n", "t", "\r\n"],
  // Borrado con borrar-hasta-fin-de-línea.
  "\\x08\\x1b[K": ["\r\n<HUAWEI>", "d", "i", "s", "x", "\x08\x1b[K", "p", "\r\n"],
  // Equipo que devuelve DEL tal cual (sin efecto visible en xterm).
  DEL: ["\r\n<HUAWEI>", "a", DEL, "b"],
  // Trozos mezclados: eco de varias teclas y borrados en un solo paquete (tecleo rápido).
  mezclado: ["\r\n<HUAWEI>", "dix\b \bs\b \bsplay", " int\b \b\b \b\b \bversion", "\r\n"],
  // Borrado y prompt en el mismo paquete que la salida anterior.
  "salida + prompt + eco": ["Interface GigabitEthernet0/0/1 up\r\n<HUAWEI>", "x", "\b \b", "\x08\x1b[K"],
  // Línea redibujada por VRP (CTRL_R o mensaje asíncrono).
  redibujo: ["\r\n<HUAWEI>dis", "\r\n%%01IFNET/4/LINK_STATE(l): The line protocol on GE0/0/1 turns DOWN.\r\n<HUAWEI>dis", "\b \b"],
};
for (const [name, chunks] of Object.entries(cases)) {
  const input = chunks.join("");
  for (const withRules of [true, false]) {
    const out = await feed(chunks, withRules);
    const written = out.join("");
    assert.equal(stripSgr(written), input, `${name} (${withRules ? "con" : "sin"} resaltado): mismos bytes y en orden`);
    assert.deepEqual(screen(written), screen(input), `${name}: la pantalla queda igual`);
  }
}

// El eco de Retroceso sale de inmediato (sin esperar el plazo de 12 ms) y detrás del prompt retenido.
{
  const out = [];
  const hl = new H.StreamHighlighter((s) => out.push(s), () => rules, () => false);
  hl.push("\r\n<HUAWEI>");
  hl.push("dis");
  hl.push("\b \b");
  hl.push("\x08\x1b[K");
  // Sin esperar timers: todo ya se escribió, el prompt primero y cada eco tal cual.
  assert.equal(stripSgr(out.join("")), "\r\n<HUAWEI>dis\b \b\x08\x1b[K", "flush() antes del eco conserva el orden");
  assert.deepEqual(out.slice(-3), ["dis", "\b \b", "\x08\x1b[K"], "cada eco sale en su propia escritura, sin cambios");
  hl.dispose();
}

// Lo visible tras teclear, borrar y volver a escribir en un VRP.
assert.deepEqual(screen((await feed(cases["\\b \\b"])).join("")), ["", "<HUAWEI>dis int", ""]);
assert.deepEqual(screen((await feed(cases.mezclado)).join("")), ["", "<HUAWEI>display version", ""]);

// ---------- Fabricantes y transportes ----------
// Equipo simulado por fabricante: qué bytes borran (según su documentación; ver docs/TECNICO.md,
// "Tecla Retroceso") y una forma de eco de borrado. Las formas de eco son representativas (no
// capturadas de cada equipo): cubren "\b \b", "\b\x1b[K" y "\x1b[D\x1b[K" en todos los esquemas
// de resaltado. Se teclea "show versx", Retroceso, "ion" con el modo por defecto de la app.
const EITHER = [DEL, BS];
const DEVICES = [
  { name: "Cisco IOS", platform: "ios", scheme: "cisco", prompt: "sw1#", erase: EITHER, echo: "\b \b" },
  { name: "Cisco IOS-XE", platform: "iosxe", scheme: "cisco", prompt: "sw1#", erase: EITHER, echo: "\b \b" },
  { name: "Cisco NX-OS", platform: "nxos", scheme: "cisco", prompt: "n9k#", erase: EITHER, echo: "\b\x1b[K" },
  { name: "Cisco IOS-XR", platform: "iosxr", scheme: "cisco", prompt: "RP/0/RSP0/CPU0:xr#", erase: EITHER, echo: "\x1b[D\x1b[K" },
  { name: "Cisco ASA", platform: "asa", scheme: "cisco", prompt: "asa#", erase: [DEL], echo: "\b \b" },
  { name: "Juniper Junos", platform: "junos", scheme: "juniper", prompt: "noc@mx1> ", erase: EITHER, echo: "\b \b" },
  { name: "Fortinet FortiOS", platform: "fos74", scheme: "fortinet", prompt: "FGT # ", erase: [DEL], echo: "\b \b" },
  { name: "Check Point clish", platform: "r82", scheme: "common", prompt: "gw> ", erase: EITHER, echo: "\b\x1b[K" },
  { name: "Check Point expert (bash)", platform: "r82", scheme: "common", prompt: "[Expert@gw:0]# ", erase: EITHER, echo: "\b\x1b[K" },
  { name: "WatchGuard Fireware", platform: "fw12", scheme: "common", prompt: "WG#", erase: [DEL], echo: "\b \b" },
  { name: "Linux bash (readline)", platform: "ubuntu", scheme: "common", prompt: "noc@srv:~$ ", erase: EITHER, echo: "\b\x1b[K" },
  { name: "Linux tty canónico (login, stty erase ^?)", platform: "debian", scheme: "common", prompt: "login: ", erase: [DEL], echo: "\b \b" },
  { name: "macOS zsh", platform: "macos15", scheme: "common", prompt: "noc@mac ~ % ", erase: EITHER, echo: "\b \b" },
  { name: "Huawei VRP5", platform: "vrp5", scheme: "huawei", prompt: "<HUAWEI>", erase: [BS], echo: "\b \b" },
  { name: "Huawei VRP8", platform: "vrp8", scheme: "huawei", prompt: "<HUAWEI>", erase: [BS], echo: "\b\x1b[K" },
  { name: "Huawei YunShan", platform: "yunshan", scheme: "huawei", prompt: "<HUAWEI>", erase: [BS], echo: "\b\x1b[K" },
];
// Lo que hace cada transporte con lo tecleado: SSH pasa por la PTY de ssh en modo crudo (sin
// cambios), Telnet duplica IAC y manda CR como CR NUL (telnet.rs), Serial escribe tal cual.
const TRANSPORTS = {
  ssh: (s) => s,
  telnet: (s) => s.replace(/\xff/g, "\xff\xff").replace(/\r/g, "\r\0"),
  serial: (s) => s,
};

function simulate(dev, transport, mode) {
  let line = "";
  const echoes = [];
  const device = (bytes) => {
    let echo = "";
    for (const c of bytes) {
      if (c === "\0") continue;
      if (dev.erase.includes(c)) {
        if (line) (line = line.slice(0, -1)), (echo += dev.echo);
      } else if (c >= " " && c !== DEL) (line += c), (echo += c);
    }
    if (echo) echoes.push(echo);
  };
  const press = (data) => device(TRANSPORTS[transport](data));
  for (const c of "show versx") press(c);
  press(B.translateBackspace(DEL, B.backspaceSeq(key(), mode, true)));
  for (const c of "ion") press(c);
  return { line, echoes };
}

const vendorRules = (scheme) => H.compile(H.effectiveRules({ enabled: true, schemes: [scheme, "common"], custom: [] }));
const matrix = [];
for (const dev of DEVICES) {
  const mode = B.backspaceMode({ platform: dev.platform });
  const rulesFor = vendorRules(dev.scheme);
  for (const transport of Object.keys(TRANSPORTS)) {
    const { line, echoes } = simulate(dev, transport, mode);
    assert.equal(line, "show version", `${dev.name} por ${transport} (Retroceso = ${mode}): el equipo borra`);
    const chunks = [`\r\n${dev.prompt}`, ...echoes];
    const out = [];
    const hl = new H.StreamHighlighter((s) => out.push(s), () => rulesFor, () => false);
    for (const c of chunks) hl.push(c);
    hl.flush();
    hl.dispose();
    const written = out.join("");
    assert.equal(stripSgr(written), chunks.join(""), `${dev.name} por ${transport}: eco sin cambios y en orden`);
    assert.deepEqual(screen(written), ["", `${dev.prompt}show version`.trimEnd()], `${dev.name} por ${transport}: pantalla`);
    matrix.push(`${dev.name.padEnd(42)} ${transport.padEnd(6)} envía ${mode === "bs" ? "BS " : "DEL"} OK`);
  }
}
// El caso reportado: un VRP que solo borra con ^H no borra si se fuerza DEL.
assert.equal(simulate(DEVICES.find((d) => d.platform === "vrp8"), "ssh", "del").line, "show versxion", "VRP con DEL: no borra");
if (process.env.VERBOSE) console.log(matrix.join("\n"));

// Sin plataforma detectada: el prompt de Huawei en la línea activa BS en automático.
{
  const { looksHuaweiPrompt, backspaceMode } = await import("../../src/lib/backspace.ts");
  for (const l of ["<ar-wan01>dis ver", "[ar-wan01]int g0/0/1", "[~HUAWEI]commit", "[*CE-01]"]) {
    assert.ok(looksHuaweiPrompt(l), l);
    assert.equal(backspaceMode({}, l), "bs", l);
  }
  for (const l of ["[user@host ~]$ ls", "router#show ver", "admin@sw> show", "FGT # get", ""]) {
    assert.ok(!looksHuaweiPrompt(l), l);
    assert.equal(backspaceMode({}, l), "del", l);
  }
  // La plataforma conocida y la elección explícita mandan sobre el prompt.
  assert.equal(backspaceMode({ platform: "iosxe" }, "<x>"), "del");
  assert.equal(backspaceMode({ backspace: "del" }, "<x>"), "del");
  assert.equal(backspaceMode({ backspace: "bs" }, "router#"), "bs");
}

console.log("backspace: OK");
