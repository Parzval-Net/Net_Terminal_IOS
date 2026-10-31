// Pruebas de las sugerencias de comandos: `node scripts/tests/suggest.test.mjs` (Node 22.15+ con tipos TS).
// Usa el catálogo incluido (src/packs/*.json) y mide el tiempo de búsqueda sobre todas las plataformas.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { registerHooks } from "node:module";
import { cpus, loadavg } from "node:os";

// suggest.ts y packs.ts importan sin extensión (como lo resuelve Vite): se completa con .ts.
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

const S = await import("../../src/lib/suggest.ts");
const { buildCatalog, validatePack, computeRisk } = await import("../../src/lib/packs.ts");

// ---------- Catálogo incluido, igual que builtinPacks.ts ----------

const dir = new URL("../../src/packs/", import.meta.url);
const packs = readdirSync(dir)
  .filter((f) => f.endsWith(".json"))
  .map((f) => {
    const r = JSON.parse(readFileSync(new URL(f, dir), "utf8"));
    const id = f.replace(/\.json$/, "");
    return validatePack({ format: "netterminal-commands", formatVersion: 1, id: `builtin-${id}`, name: r.name, vendor: id, vendorName: r.name, detectCommand: r.detectCommand, platforms: r.platforms ?? [], commands: r.commands }).pack;
  })
  .filter(Boolean);
const catalog = buildCatalog(packs, []);
const platforms = catalog.flatMap((v) => v.platforms.map((p) => p.id));
assert.ok(platforms.includes("iosxe") && platforms.includes("vrp8"));

// Ayudantes: un prompt de Cisco y teclas como las entrega term.onData.
const tail = (t) => () => t;
function atPrompt() {
  const t = new S.InputTracker();
  t.output("\r\ncore-sw01#", tail("\ncore-sw01#"));
  assert.equal(t.active, true);
  return t;
}
const type = (t, s) => {
  for (const ch of s) t.input(ch);
};

// ---------- Estado de la línea: sincronía ----------

{
  const t = new S.InputTracker();
  assert.equal(t.active, false, "sin prompt no se sugiere");
  t.input("s");
  assert.equal(t.active, false, "lo tecleado antes del prompt no activa nada por sí solo");
}
{
  const t = atPrompt();
  type(t, "show ver");
  assert.equal(t.buf, "show ver");
  // El eco del equipo (sin saltos de línea) no corta el seguimiento.
  t.output("show ver", tail("core-sw01#show ver"));
  assert.equal(t.active, true);
  t.input("\x7f");
  t.input("\x7f");
  assert.equal(t.buf, "show v");
  t.input("\r");
  assert.equal(t.buf, "", "Enter limpia");
  assert.equal(t.active, false, "tras Enter se espera el próximo prompt");
  t.output("\r\nCisco IOS XE Software\r\ncore-sw01#", tail("Cisco IOS XE Software\ncore-sw01#"));
  assert.equal(t.active, true, "vuelve con el prompt");
  assert.equal(t.buf, "");
}
// Teclas de control y navegación: desincronizan hasta el próximo prompt.
for (const [name, key] of [
  ["flecha izquierda", "\x1b[D"],
  ["flecha derecha", "\x1b[C"],
  ["flecha arriba", "\x1b[A"],
  ["Inicio", "\x1b[H"],
  ["Fin", "\x1b[F"],
  ["Ctrl+A", "\x01"],
  ["Ctrl+E", "\x05"],
  ["Ctrl+U", "\x15"],
  ["Ctrl+W", "\x17"],
  ["Ctrl+R", "\x12"],
  ["Tab", "\t"],
  ["Esc", "\x1b"],
  ["Ctrl+C", "\x03"],
  ["pegado", "show clock"],
  ["pegado entre corchetes", "\x1b[200~show clock\x1b[201~"],
]) {
  const t = atPrompt();
  type(t, "sh");
  t.input(key);
  assert.equal(t.active, false, `${name} desincroniza`);
  assert.equal(t.buf, "", `${name} vacía el búfer`);
  // Un "#" tecleado o escrito en el eco no se confunde con un prompt nuevo.
  t.input("#");
  t.output("sh#", tail("core-sw01#sh#"));
  assert.equal(t.active, false, `${name}: un # en la misma línea no es prompt`);
  // El próximo prompt (tras un salto de línea) vuelve a habilitar. Tras Tab se relee la línea
  // real de la pantalla (lo que hace la terminal en cada cuadro), no el texto crudo.
  t.output("\r\ncore-sw01#", tail("\ncore-sw01#"));
  if (key === "\t") t.resync("core-sw01#");
  assert.equal(t.active, true, `${name}: vuelve con el prompt`);
}
// ---------- Re-sincronía ----------

// Salida que redibuja la línea (mensaje de syslog con "logging synchronous"): vuelve sola.
{
  const t = atPrompt();
  type(t, "show ip");
  t.output("\r\n%LINK-3-UPDOWN: Interface Gi1/0/3, changed state to down\r\n", tail("down\n"));
  assert.equal(t.active, false, "el mensaje asíncrono corta la sincronía");
  assert.equal(t.canResync, true, "lo tecleado sigue conocido");
  t.output("core-sw01#show ip", tail("down\ncore-sw01#show ip"));
  assert.equal(t.active, true, "la línea redibujada con prompt + lo tecleado re-sincroniza");
  assert.equal(t.buf, "show ip");
  type(t, " int");
  assert.equal(t.buf, "show ip int");
}
// Mensaje que redibuja la línea con otro contenido: no re-sincroniza.
{
  const t = atPrompt();
  type(t, "show ip");
  t.output("\r\n%SYS-5-CONFIG_I: Configured from console\r\ncore-sw01#show i", tail("console\ncore-sw01#show i"));
  assert.equal(t.active, false);
  // La terminal confirma con la línea real (por ejemplo tras borrar con "\b \b").
  assert.equal(t.resync("core-sw01#show i"), false);
  assert.equal(t.resync("core-sw01#show ip"), true, "la pantalla confirma prompt + lo tecleado");
}
// Prompt que llega después de teclear (typeahead): se recupera si la línea termina con lo tecleado.
{
  const t = atPrompt();
  type(t, "terminal length 0\r");
  type(t, "sh ver");
  assert.equal(t.active, false);
  t.output("\r\ncore-sw01#", tail("\ncore-sw01#"));
  assert.equal(t.active, false, "el prompt sin el eco todavía no basta");
  t.output("sh ver", tail("\ncore-sw01#sh ver"));
  assert.equal(t.active, true, "con el eco tras el prompt se sincroniza");
  assert.equal(t.buf, "sh ver");
}
{
  // Prompt y eco en el mismo bloque.
  const t = atPrompt();
  type(t, "\r");
  type(t, "dis cl");
  t.output("\r\n<HUAWEI>dis cl", tail("\n<HUAWEI>dis cl"));
  assert.equal(t.active, true);
  assert.equal(t.buf, "dis cl");
}
{
  // Tecla de control antes del prompt: lo tecleado es desconocido, no se adivina.
  const t = atPrompt();
  type(t, "\r");
  type(t, "sh");
  t.input("\x1b[A");
  type(t, "ow");
  t.output("\r\ncore-sw01#show", tail("\ncore-sw01#show"));
  assert.equal(t.active, false, "tras una flecha no se re-sincroniza con texto desconocido");
}
// Desplazamiento horizontal de IOS ("$") y caracteres anchos en el prompt.
{
  assert.equal(S.endsWithTyped("core-sw01#$terface brief", "show ip interface brief"), true);
  assert.equal(S.atPrompt("core-sw01#$terface brief", "show ip interface brief"), true);
  assert.equal(S.endsWithTyped("core-sw01#$rief", "show ip interface brief"), true);
  assert.equal(S.endsWithTyped("core-sw01#$xyz", "show ip interface brief"), false);
  assert.equal(S.atPrompt("用户@主机:~$ ip a", "ip a"), true, "prompt con caracteres anchos");
  assert.equal(S.atPrompt("Building configuration... ip a", "ip a"), false);
  const t = atPrompt();
  type(t, "show ip interface brief");
  t.output("\r\n", tail("\n"));
  assert.equal(t.resync("core-sw01#$terface brief"), true);
}
// Línea demasiado larga: se deja de seguir.
{
  const t = atPrompt();
  type(t, "x".repeat(300));
  assert.equal(t.active, false);
}

// ---------- Credenciales: nunca se sigue ----------

{
  // Contraseña tecleada antes de que aparezca el pedido: se descarta al verlo.
  const t = atPrompt();
  type(t, "enable\r");
  type(t, "Secreto123");
  t.output("\r\nPassword: ", tail("\nPassword: "));
  assert.equal(t.cred, true);
  assert.equal(t.buf, "", "lo tecleado se borra al aparecer el pedido de credenciales");
  assert.equal(t.resync("Password: Secreto123"), false, "con credenciales no se re-sincroniza");
  type(t, "#");
  assert.equal(t.buf, "");
}

for (const prompt of ["Password:", "Password: ", "Enter passphrase for key '/home/u/.ssh/id_ed25519':", "[sudo] password for admin:", "Username:", "login:", "Contraseña:"]) {
  const t = new S.InputTracker();
  t.output(`\r\n${prompt}`, tail(`\n${prompt}`));
  assert.equal(t.cred, true, `credenciales: ${prompt}`);
  assert.equal(t.active, false);
  type(t, "secreto#");
  assert.equal(t.buf, "", "la contraseña no se guarda");
  // Ni aunque lo tecleado termine en algo con pinta de prompt.
  t.output("", tail(`\n${prompt}`));
  assert.equal(t.active, false);
}
{
  // Una contraseña cuyo eco oculto deja un prompt "#" en pantalla tras el salto de línea sí vuelve.
  const t = new S.InputTracker();
  t.output("\r\nPassword:", tail("\nPassword:"));
  type(t, "abc\r");
  t.output("\r\nrouter#", tail("\nrouter#"));
  assert.equal(t.cred, false);
  assert.equal(t.active, true);
  assert.equal(t.buf, "");
}

// ---------- Índice y búsqueda ----------

const ios = S.getIndex(catalog, "iosxe");
assert.ok(ios && ios.entries.length > 50);
assert.equal(S.getIndex(catalog, "iosxe"), ios, "el índice queda en caché");
assert.equal(S.getIndex(catalog, "no-existe"), null, "plataforma desconocida: nada");
for (let i = 1; i < ios.entries.length; i++) assert.ok(ios.entries[i - 1].key <= ios.entries[i].key, "índice ordenado");
assert.ok(ios.entries.every((e) => !/[\r\n]/.test(e.cmd)), "sin comandos de varias líneas");

{
  const g = S.ghostFor(ios, "show ver");
  assert.ok(g, "show ver tiene sugerencia");
  assert.equal(g.entry.risk, "read");
  assert.ok(("show ver" + g.rest).startsWith("show version"));
  assert.equal(S.ghostFor(ios, "s"), null, "un carácter no basta para el texto gris");
  assert.ok(S.ghostFor(ios, "SHOW VER"), "sin distinguir mayúsculas");
  assert.equal(S.ghostFor(ios, "zzzz"), null);
}
// Lista: máximo 8, todas empiezan con lo tecleado. Sin uso: menos palabras, menos texto
// agregado, sin filtro "|" y luego el orden del catálogo.
{
  const list = S.lookup(ios, "show ", 8);
  assert.equal(list.length, 8);
  for (const e of list) assert.ok(e.key.startsWith("show "));
  const len = (e) => (e.placeholder ? e.insert.length : e.cmd.length);
  const rank = (a, b) => a.toks.length - b.toks.length || len(a) - len(b) || Number(a.pipe) - Number(b.pipe) || a.order - b.order;
  const all = ios.entries.filter((e) => e.key.startsWith("show ") && e.toks.length > 1 && (!e.placeholder || e.insert.length >= 5)).sort(rank);
  assert.deepEqual(list.map((e) => e.cmd), all.slice(0, 8).map((e) => e.cmd), "las 8 mejores según el desempate");
  assert.equal(S.lookup(ios, "", 8).length, 8, "con la línea vacía también lista");
}
// Desempate del texto gris con igual uso: el comando más corto que completa lo tecleado.
{
  const has = (cmd) => ios.entries.some((e) => e.key === cmd);
  const ghost = (q) => {
    const g = S.ghostFor(ios, q);
    return g && (q + g.rest).replace(/^\S+/, "");
  };
  const full = (q) => S.ghostFor(ios, q)?.entry.cmd;
  assert.ok(has("show running-config") && has("show interfaces {{interfaz}}") && has("show logging"), "el catálogo IOS-XE trae los comandos base");
  assert.equal(full("sh run"), "show running-config", "sh run: sin | include");
  assert.equal(full("sh int"), "show interfaces {{interfaz}}", "sh int: inserta show interfaces, no transceiver detail");
  assert.equal(full("sh log"), "show logging", "sh log: no login failures");
  assert.equal(full("show running"), "show running-config");
  assert.ok(ghost("sh run") !== null);
  // El uso sigue mandando: un comando usado gana aunque sea más largo.
  const target = ios.entries.find((e) => e.key.startsWith("show interfaces ") && e.risk === "read" && !e.placeholder);
  const w = new Int32Array(ios.entries.length);
  w[target.pos] = 5;
  assert.equal(S.ghostFor(ios, "sh int", w).entry.cmd, target.cmd, "con historial gana el usado");
}

// ---------- Marcadores: se inserta hasta el marcador ----------

{
  assert.deepEqual(S.insertablePart("show interfaces {{interfaz}} status"), { insert: "show interfaces ", placeholder: true });
  assert.deepEqual(S.insertablePart("display interface <interfaz>"), { insert: "display interface ", placeholder: true });
  assert.deepEqual(S.insertablePart("show clock"), { insert: "show clock", placeholder: false });
  const withVar = ios.entries.find((e) => e.placeholder && e.risk === "read");
  assert.ok(withVar, "el catálogo tiene consultas con variables");
  const typed = withVar.insert.slice(0, 4);
  const rest = S.remainderToInsert(withVar, typed);
  assert.equal(typed + rest, withVar.insert, "inserta justo hasta el marcador");
  assert.ok(!/\{\{|</.test(rest));
  assert.equal(S.remainderToInsert(withVar, withVar.insert), "", "en el marcador no inserta nada más");
  // Más allá del marcador ya no coincide.
  assert.ok(!S.lookup(ios, withVar.insert + "{{", 50).includes(withVar));
  const g = S.ghostFor(ios, withVar.insert.slice(0, withVar.insert.length - 1));
  if (g && g.entry === withVar) assert.ok(!g.insert.includes("{"));
}

// ---------- Riesgo: lo que cambia o corta servicio nunca va en gris ----------

let ghosts = 0;
for (const p of platforms) {
  const idx = S.getIndex(catalog, p);
  for (const e of idx.entries) {
    // Cada prefijo de cada comando del catálogo.
    for (let n = S.GHOST_MIN; n < e.cmd.length; n++) {
      const g = S.ghostFor(idx, e.cmd.slice(0, n));
      if (!g) continue;
      ghosts++;
      assert.equal(g.entry.risk, "read", `${p}: ${g.entry.cmd} no es consulta`);
      assert.equal(computeRisk(g.entry.cmd), "read", `${p}: computeRisk(${g.entry.cmd})`);
    }
  }
}
assert.ok(ghosts > 1000);
{
  // reload, write erase y shutdown aparecen en la lista con su riesgo, pero nunca en gris.
  for (const [p, q] of [["iosxe", "reload"], ["iosxe", "write erase"], ["vrp8", "reboot"], ["junos", "request system reboot"]]) {
    const idx = S.getIndex(catalog, p);
    const listed = S.lookup(idx, q, 8);
    const g = S.ghostFor(idx, q.slice(0, -1));
    assert.ok(!g || g.entry.risk === "read", `${q} no va en gris`);
    for (const e of listed) if (e.key.startsWith(q)) assert.notEqual(e.risk, "read", `${q} lleva riesgo`);
  }
  // Un pack que declara "reload" como consulta: el índice usa el riesgo calculado.
  const evil = validatePack({ format: "netterminal-commands", formatVersion: 1, id: "evil", name: "x", vendor: "evil", platforms: [{ id: "evilos", label: "x" }], commands: [{ cmd: "reload in 1", desc: "x", cat: "Sistema", risk: "read" }, { cmd: "show clock", desc: "x", cat: "Sistema", risk: "read" }] }).pack;
  const idx = S.buildIndex(buildCatalog([evil], []), "evilos");
  assert.equal(S.ghostFor(idx, "rel"), null);
  assert.equal(S.lookup(idx, "rel", 8)[0].risk, "disruptive");
  assert.equal(S.lookup(idx, "rel", 8, true).length, 0);
}

// ---------- Nunca se produce Enter ----------

{
  assert.equal(S.safeInsert("show clock\r\nreload\r"), "show clock");
  assert.equal(S.safeInsert("show\x1b[Aclock\x00\x7f"), "show[Aclock");
  assert.equal(S.safeInsert("a\nb"), "a");
  for (const p of platforms) {
    const idx = S.getIndex(catalog, p);
    for (const e of idx.entries) {
      for (const buf of ["", e.cmd.slice(0, 1), e.cmd.slice(0, 3)]) {
        const r = S.remainderToInsert(e, buf);
        assert.ok(!/[\x00-\x1f\x7f-\x9f]/.test(r), `${p}: ${JSON.stringify(r)}`);
      }
    }
  }
  // Un pack con un "\r" escondido se rechaza al validar; el índice tampoco lo aceptaría.
  const t = atPrompt();
  type(t, "sh");
  t.insert("ow clock\r");
  assert.equal(t.active, false, "insertar texto con control desincroniza");
}

// ---------- Teclado ----------

const k = (key, mods = {}) => ({ key, ctrlKey: false, altKey: false, metaKey: false, shiftKey: false, ...mods });
const on = { enabled: true, listOpen: false, canAccept: true };
assert.equal(S.suggestKey(k("Tab"), on), "pass", "Tab va al equipo");
assert.equal(S.suggestKey(k("Tab"), { ...on, listOpen: true }), "pass", "Tab va al equipo con la lista abierta");
assert.equal(S.suggestKey(k("Tab", { shiftKey: true }), on), "pass");
assert.equal(S.suggestKey(k("ArrowRight"), on), "accept");
assert.equal(S.suggestKey(k("ArrowRight"), { ...on, canAccept: false }), "pass", "sin texto gris la flecha va al equipo");
assert.equal(S.suggestKey(k("ArrowRight", { shiftKey: true }), on), "pass");
// Tecla de lista: Ctrl+. por defecto (libre en xterm y en macOS); Alt+/ y Ctrl+Espacio a elección.
assert.equal(S.suggestKey(k(".", { ctrlKey: true, code: "Period" }), on), "open");
assert.equal(S.suggestKey(k(":", { ctrlKey: true, shiftKey: true, code: "Period" }), on), "pass", "con Shift no");
assert.equal(S.suggestKey(k(" ", { ctrlKey: true }), on), "pass", "Ctrl+Espacio no abre por defecto (macOS lo usa)");
assert.equal(S.suggestKey(k(" ", { ctrlKey: true }), { ...on, listKey: "ctrl+space" }), "open");
assert.equal(S.suggestKey(k("/", { altKey: true, code: "Slash" }), { ...on, listKey: "alt+slash" }), "open");
assert.equal(S.suggestKey(k("/", { altKey: true, code: "Slash" }), on), "pass");
assert.equal(S.suggestKey(k(".", { ctrlKey: true }), { ...on, enabled: false }), "pass", "apagado no intercepta nada");
for (const lk of Object.keys(S.LIST_KEYS)) assert.equal(S.suggestKey(k("Tab"), { ...on, listKey: lk }), "pass");
// Aceptar una palabra: Ctrl+→ (Windows/Linux) u Option+→ (macOS), solo con texto gris visible.
assert.equal(S.suggestKey(k("ArrowRight", { ctrlKey: true }), on), "word");
assert.equal(S.suggestKey(k("ArrowRight", { altKey: true }), on), "word");
assert.equal(S.suggestKey(k("ArrowRight", { ctrlKey: true }), { ...on, canAccept: false }), "pass", "sin texto gris va al equipo");
assert.equal(S.suggestKey(k("ArrowRight", { ctrlKey: true, altKey: true }), on), "pass");
assert.equal(S.suggestKey(k("ArrowRight", { metaKey: true }), on), "pass");
assert.equal(S.nextWord("erface brief"), "erface ");
assert.equal(S.nextWord(" brief"), " brief");
assert.equal(S.nextWord("brief"), "brief");
// Enter solo lo toma la lista (para elegir sin ejecutar); nunca hay una acción que lo envíe.
for (const mods of [{}, { ctrlKey: true }, { altKey: true }, { shiftKey: true }]) {
  assert.equal(S.suggestKey(k("Enter", mods), on), "pass");
  assert.notEqual(S.suggestKey(k("Tab", mods), { ...on, listOpen: true }), "pick");
}
assert.equal(S.suggestKey(k("ArrowRight"), { ...on, enabled: false }), "pass");
assert.equal(S.suggestKey(k("ArrowDown"), { ...on, listOpen: true }), "down");
assert.equal(S.suggestKey(k("ArrowUp"), { ...on, listOpen: true }), "up");
assert.equal(S.suggestKey(k("Enter"), { ...on, listOpen: true }), "pick");
assert.equal(S.suggestKey(k("Escape"), { ...on, listOpen: true }), "close");
assert.equal(S.suggestKey(k("Enter"), on), "pass", "Enter sin lista va al equipo");
assert.equal(S.suggestKey(k("a"), { ...on, listOpen: true }), "pass");
assert.equal(S.suggestKey(k("ArrowRight", { isComposing: true }), on), "pass");

// ---------- Abreviaturas (Cisco, Huawei, Junos, FortiOS) ----------

const mkIndex = (vendor, cmds, platform = "testos") => {
  const pack = validatePack({
    format: "netterminal-commands",
    formatVersion: 1,
    id: `t-${vendor}`,
    name: "t",
    vendor,
    platforms: [{ id: platform, label: "t" }],
    commands: cmds.map((cmd) => ({ cmd, desc: "x", cat: "Sistema", risk: "read" })),
  }).pack;
  assert.ok(pack, "pack de prueba válido");
  return S.buildIndex(buildCatalog([pack], []), platform);
};
{
  const cases = [
    ["iosxe", "sh ip int br", "show ip interface brief", "ief"],
    ["iosxe", "sh ip int", "show ip interface brief", null],
    ["vrp8", "dis int br", "display interface brief", "ief"],
    ["junos", "sh int ter", "show interfaces terse", "se"],
    ["fos74", "get sys sta", "get system status", "tus"],
  ];
  for (const [p, typed, want, insert] of cases) {
    const idx = S.getIndex(catalog, p);
    assert.ok(idx.abbrev, `${p} acepta abreviaturas`);
    const list = S.lookup(idx, typed, 50);
    assert.ok(list.some((e) => e.key === want), `${p}: "${typed}" encuentra "${want}"`);
    if (insert !== null) {
      const g = S.ghostFor(idx, typed);
      assert.ok(g, `${p}: "${typed}" tiene texto gris`);
      assert.equal(g.entry.key, want);
      assert.equal(g.insert, insert, "solo se agrega texto al final");
      assert.equal(g.entry.risk, "read");
    }
  }
  const ios = S.getIndex(catalog, "iosxe");
  // Con espacio final, la siguiente palabra queda libre.
  assert.ok(S.lookup(ios, "sh ip int ", 50).every((e) => e.toks.length > 3 && e.toks[2].startsWith("int")));
  // Una palabra que no es prefijo de ninguna no coincide.
  assert.equal(S.lookup(ios, "sh zz int", 50).length, 0);
  assert.equal(S.ghostFor(ios, "xh ip int br"), null);
  // Espacios dobles al teclear se normalizan.
  assert.equal(S.ghostFor(ios, "sh  ip   int br")?.entry.key, "show ip interface brief");
  // Resaltado en la lista: lo que coincide de cada palabra.
  const e = ios.entries.find((x) => x.key === "show ip interface brief");
  assert.deepEqual(
    S.matchSpans(e, "sh ip int br").map((x) => (x.hit ? `[${x.text}]` : x.text)).join(""),
    "[sh]ow [ip] [int]erface [br]ief",
  );
  assert.equal(S.completionFor(e, "sh ip int br").insert, "ief");
  assert.equal(S.completionFor(e, "sh ip x br"), null);
}
{
  // Prefijo exacto primero, luego abreviaturas (aunque estén antes en el catálogo).
  const idx = mkIndex("cisco", ["show ipv6 rip", "show ipv6 route", "show ip route"]);
  const list = S.lookup(idx, "show ip r", 8);
  assert.equal(list[0].key, "show ip route", "el prefijo exacto va primero");
  assert.deepEqual(list.slice(1).map((x) => x.key), ["show ipv6 rip", "show ipv6 route"], "luego abreviaturas, en el orden del catálogo");
  assert.equal(S.ghostFor(idx, "show ip r").entry.key, "show ip route");
  assert.equal(S.ghostFor(idx, "show ip ri").entry.key, "show ipv6 rip", "sin prefijo exacto, la abreviatura");
  // Marcadores: la abreviatura no pasa del marcador y se inserta hasta él.
  const ph = mkIndex("cisco", ["show interfaces {{interfaz}} status", "show interfaces ae{{n}} extensive"]);
  const g = S.ghostFor(ph, "sh int");
  assert.equal(g.insert, "erfaces ", "inserta hasta el marcador");
  assert.equal(S.lookup(ph, "sh int gi1/0/1", 8).length, 0, "no coincide más allá del marcador");
  assert.equal(S.ghostFor(ph, "sh interfaces ae").insert, "", "en el marcador no inserta nada");
}
{
  // Shells y CLIs sin abreviaturas: solo prefijo exacto por palabra.
  const idx = mkIndex("linux", ["ip address show", "ip route show"]);
  assert.equal(idx.abbrev, false);
  assert.equal(S.ghostFor(idx, "ip addr")?.entry.key, "ip address show");
  assert.equal(S.ghostFor(idx, "i a"), null, "en Linux `i a` no es `ip address`");
  assert.equal(S.lookup(idx, "ip a s", 8).length, 0);
  for (const p of ["debian", "win11", "macos15", "r81", "fw12"]) assert.equal(S.getIndex(catalog, p).abbrev, false, `${p} sin abreviaturas`);
}

// ---------- Historial y favoritos ----------

{
  const idx = mkIndex("cisco", ["show version", "show vlan brief", "show vrf", "username {{usuario}} privilege 15 secret {{clave}}", "ping {{ip}} source {{interfaz}}"]);
  const u = new S.SuggestUsage();
  const none = new Set();
  const first = (w) => S.lookup(idx, "show v", 3, { weights: w }).map((e) => e.key);
  assert.deepEqual(first(u.weights(idx, none)), ["show vrf", "show version", "show vlan brief"], "sin historial: menos palabras y menos texto primero");
  const vlan = idx.entries.find((e) => e.key === "show vlan brief");
  u.record("testos", vlan);
  u.record("testos", vlan);
  assert.equal(u.count("testos", "show vlan brief"), 2);
  assert.equal(first(u.weights(idx, none))[0], "show vlan brief", "lo usado sube");
  assert.equal(S.ghostFor(idx, "show v", u.weights(idx, none)).entry.key, "show vlan brief", "también en el texto gris");
  assert.equal(u.weights(idx, none), u.weights(idx, none), "pesos en caché mientras no cambie nada");
  // Favoritos: "fabricante:comando", igual que el panel de comandos.
  const favs = new Set(["cisco:show version"]);
  const fresh = new S.SuggestUsage();
  assert.equal(first(fresh.weights(idx, favs))[0], "show version", "el favorito sube");
  // Otra plataforma no se ve afectada.
  const other = mkIndex("cisco", ["show version", "show vrf"], "otheros");
  assert.equal(S.lookup(other, "show v", 2, { weights: u.weights(other, none) })[0].key, "show vrf");
  // Borrar.
  u.clear();
  assert.deepEqual(first(u.weights(idx, none)), ["show vrf", "show version", "show vlan brief"]);
  assert.equal(u.serialize(), JSON.stringify({ v: 1, p: {} }));
}
{
  // Ejecutado: se guarda la plantilla, nunca argumentos, nombres de equipo ni secretos.
  const idx = mkIndex("cisco", ["show version", "username {{usuario}} privilege 15 secret {{clave}}", "ping {{ip}} source {{interfaz}}", "show interfaces ae{{n}} extensive"]);
  const u = new S.SuggestUsage();
  const lines = ["username admin privilege 15 secret Sup3rS3cr3t!", "ping 10.20.30.40 source core-sw01-mgmt", "sh ver", "show interfaces ae7 extensive", "copy run tftp://10.9.9.9/core-sw01.cfg"];
  const hits = [];
  for (const line of lines) {
    const e = S.matchExecuted(idx, line);
    if (e) u.record("testos", e), hits.push(e.tpl);
  }
  assert.deepEqual(hits, ["username {{usuario}} privilege 15 secret {{clave}}", "ping {{ip}} source {{interfaz}}", "show version", "show interfaces ae{{n}} extensive"]);
  const stored = u.serialize();
  for (const secret of ["admin", "Sup3rS3cr3t", "10.20.30.40", "core-sw01", "10.9.9.9", "ae7"]) assert.ok(!stored.includes(secret), `el historial no guarda "${secret}"`);
  // Al cargar, se descarta lo que no tiene la forma esperada (o trae caracteres de control).
  const loaded = new S.SuggestUsage(JSON.stringify({ v: 1, p: { testos: { "show version": [3, 20000], "x\r\nreload": [9, 1], bad: "x" }, "../evil": { a: [1, 1] } } }));
  assert.equal(loaded.count("testos", "show version"), 3);
  assert.equal(loaded.count("testos", "x\r\nreload"), 0);
  assert.ok(!loaded.serialize().includes("evil"));
  assert.equal(new S.SuggestUsage("{no es json").serialize(), JSON.stringify({ v: 1, p: {} }));
  // Con tope: nunca crece sin límite.
  const capped = new S.SuggestUsage();
  const many = mkIndex("cisco", Array.from({ length: 120 }, (_, i) => `show test ${i}`));
  for (const e of many.entries) capped.record("testos", e);
  assert.ok(Object.keys(JSON.parse(capped.serialize()).p.testos).length <= 60);
  // Sin localStorage (Node) el almacén compartido funciona en memoria.
  S.usageStore().record("testos", idx.entries[0]);
  S.clearUsage();
  assert.equal(S.usageStore().count("testos", idx.entries[0].tpl), 0);
}

// ---------- Terminal local y SCP: nunca ----------

{
  assert.equal(S.suggestAllowed(true, { type: "local" }), false, "terminal local");
  assert.equal(S.suggestAllowed(true, { type: "ssh", scp: { dir: "up" } }), false, "transferencia SCP");
  assert.equal(S.suggestAllowed(false, { type: "ssh" }), false, "apagado");
  for (const type of ["ssh", "telnet", "serial", "tcp"]) assert.equal(S.suggestAllowed(true, { type }), true, type);
}

// ---------- Ajuste: salida de beta y migración ----------

{
  assert.equal(S.SUGGEST_DEFAULT, true, "encendidas por defecto (las pruebas de seguridad pasan)");
  assert.deepEqual(S.migrateSuggest(null), { commandSuggest: true, commandSuggestSet: false }, "instalación nueva");
  assert.deepEqual(S.migrateSuggest({ commandSuggest: false }), { commandSuggest: true, commandSuggestSet: false }, "beta sin tocar: el false guardado era el valor por defecto");
  assert.deepEqual(S.migrateSuggest({ commandSuggest: true }), { commandSuggest: true, commandSuggestSet: true }, "beta activada a mano: se respeta");
  assert.deepEqual(S.migrateSuggest({ commandSuggest: false, commandSuggestSet: true }), { commandSuggest: false, commandSuggestSet: true }, "apagada a mano: se respeta");
  assert.deepEqual(S.migrateSuggest({ commandSuggest: true, commandSuggestSet: true }), { commandSuggest: true, commandSuggestSet: true });
  assert.deepEqual(S.migrateSuggest({ commandSuggest: "x", commandSuggestSet: true }), { commandSuggest: true, commandSuggestSet: false }, "valor inválido: por defecto");
}

// ---------- Nunca Enter: texto gris, palabra y lista ----------

for (const p of platforms) {
  const idx = S.getIndex(catalog, p);
  for (const e of idx.entries) {
    const abbr = e.toks.map((t) => t.slice(0, 2)).join(" ");
    for (const buf of [abbr, e.cmd.slice(0, 4)]) {
      const g = S.ghostFor(idx, buf);
      if (g) {
        assert.equal(g.entry.risk, "read", `${p}: "${buf}" no ofrece ${g.entry.cmd} en gris`);
        assert.ok(!/[\x00-\x1f\x7f-\x9f]/.test(g.insert + S.nextWord(g.insert)), `${p}: ${JSON.stringify(g.insert)}`);
      }
      for (const x of S.lookup(idx, buf, 8)) assert.ok(!/[\x00-\x1f\x7f-\x9f]/.test(S.remainderToInsert(x, buf)));
    }
  }
}

// ---------- Modo configuración: el texto gris no engaña ----------

// Prompts de configuración (o de shell) y de consulta por fabricante.
const CONFIG_PROMPTS = {
  cisco: ["core-sw01(config)#", "core-sw01(config-if)#", "core-sw01(config-router)#", "core-sw01(dhcp-config)#", "RP/0/RP0/CPU0:xr01(config)#", "nx01(config-if)# ", "asa01(config)# "],
  huawei: ["[~HUAWEI]", "[HUAWEI-GigabitEthernet0/0/1]", "[*ar-wan01]", "[ar-wan01-bgp]"],
  juniper: ["admin@mx01# ", "admin@mx01:RE:0# ", "root@mx01:~ # ", "root@mx01% "],
  fortinet: ["FGT (interface) # ", "FGT (port1) # ", "FGT (global) # ", "FGT (root) # "],
};
const EXEC_PROMPTS = {
  cisco: ["core-sw01#", "core-sw01>", "RP/0/RP0/CPU0:xr01#", "asa01/pri/act# "],
  huawei: ["<HUAWEI>", "<ar-wan01>"],
  juniper: ["admin@mx01> ", "admin@mx01:RE:0> "],
  fortinet: ["FGT # ", "FGT $ "],
};
{
  for (const [vendor, ps] of Object.entries(CONFIG_PROMPTS)) for (const p of ps) assert.equal(S.cliMode(p, vendor), "config", `${vendor}: ${p} es configuración`);
  for (const [vendor, ps] of Object.entries(EXEC_PROMPTS)) for (const p of ps) assert.equal(S.cliMode(p, vendor), "exec", `${vendor}: ${p} es consulta`);
  // El "#" de Junos es configuración, el de Cisco no; shells comunes siguen en consulta.
  assert.equal(S.cliMode("admin@mx01#", "cisco"), "exec");
  for (const p of ["user@host:~$ ", "[root@srv01 ~]# ", "[Expert@gw01:0]# ", "gw01> ", "PS C:\\> "]) assert.equal(S.cliMode(p, "linux"), "exec", p);
}
{
  // Interfaz de Cisco: `sh` es `shutdown`. Ni texto gris ni lista; con `do ` vuelve a la consulta.
  const ios = S.getIndex(catalog, "iosxe");
  const t = new S.InputTracker();
  t.output("\r\ncore-sw01(config-if)#", tail("\ncore-sw01(config-if)#"));
  assert.equal(t.active, true);
  assert.equal(t.prompt, "core-sw01(config-if)#");
  for (const buf of ["sh", "sh ", "shu", "sh ip int br", "show ip int", "de", "no sh", "s", "d", "do", "do"]) {
    type(t, buf);
    assert.equal(S.suggestQuery(t.buf, t.prompt, ios), null, `config-if: "${buf}" no se busca`);
    for (let i = 0; i < buf.length; i++) t.input("\x7f");
  }
  type(t, "do sh ip int br");
  const q = S.suggestQuery(t.buf, t.prompt, ios);
  assert.equal(q, "sh ip int br", "tras `do ` se busca la consulta");
  const g = S.ghostFor(ios, q);
  assert.equal(g?.insert, "ief");
  assert.equal(S.remainderToInsert(g.entry, q), "ief", "se completa al final de la línea, con el `do` incluido");
  // Con el desplazamiento horizontal de IOS el prompt sigue siendo de configuración.
  const u = new S.InputTracker();
  u.output("\r\ncore-sw01(config)#", tail("\ncore-sw01(config)#"));
  type(u, "do show ip interface brief");
  u.output("\r\n", tail("\n"));
  assert.equal(u.resync("core-sw01(config)#$terface brief"), true);
  assert.equal(S.cliMode(u.prompt, "cisco"), "config");
  // Al volver a consulta (end + prompt nuevo) se sugiere otra vez.
  u.input("\r");
  u.output("\r\ncore-sw01#", tail("\ncore-sw01#"));
  assert.equal(S.suggestQuery("sh ip int br", u.prompt, ios), "sh ip int br");
}
{
  // Huawei: en la vista de sistema solo `display` completo (válido en todas las vistas).
  const vrp = S.getIndex(catalog, "vrp8");
  assert.equal(S.suggestQuery("dis int br", "[~HUAWEI-GigabitEthernet0/0/1]", vrp), null, "abreviado no: `dis` podría ser otro comando");
  assert.equal(S.suggestQuery("sh", "[~HUAWEI-GigabitEthernet0/0/1]", vrp), null);
  assert.equal(S.ghostFor(vrp, S.suggestQuery("display int br", "[~HUAWEI]", vrp)).insert, "ief");
  assert.equal(S.suggestQuery("dis int br", "<HUAWEI>", vrp), "dis int br", "vista de usuario: normal");
  // Junos: `run ` en configuración; `sh` ahí muestra configuración, no estado.
  const junos = S.getIndex(catalog, "junos");
  assert.equal(S.suggestQuery("sh int ter", "admin@mx01# ", junos), null);
  assert.equal(S.ghostFor(junos, S.suggestQuery("run sh int ter", "admin@mx01# ", junos)).insert, "se");
  assert.equal(S.suggestQuery("sh int ter", "root@mx01% ", junos), null, "shell de FreeBSD: nada");
  // FortiOS dentro de un bloque config: nada (no hay escape).
  const fos = S.getIndex(catalog, "fos74");
  for (const buf of ["get sys sta", "sh", "show", "diag sys top"]) assert.equal(S.suggestQuery(buf, "FGT (interface) # ", fos), null);
  assert.equal(S.suggestQuery("get sys sta", "FGT # ", fos), "get sys sta");
  // ASA acepta `show` en configuración: solo con la palabra completa.
  const asa = S.getIndex(catalog, "asa");
  assert.equal(S.suggestQuery("sh run", "asa01(config)# ", asa), null);
  assert.equal(S.suggestQuery("show run", "asa01(config)# ", asa), "show run");
  for (const idx of [ios, vrp, junos, fos, asa]) assert.ok(S.configHint(idx).length > 10);
  const ios2 = S.getIndex(catalog, "iosxe");
  assert.match(S.configHint(ios2), /do /);
}
{
  // Barrido: en cualquier prompt de configuración, ningún comando del catálogo tecleado
  // (prefijos y abreviaturas, sin escape) produce texto gris ni lista.
  let checked = 0;
  for (const v of catalog) {
    const prompts = [...(CONFIG_PROMPTS[v.id] ?? []), "host(config)#", "[host]"];
    for (const pl of v.platforms) {
      const idx = S.getIndex(catalog, pl.id);
      for (const e of idx.entries) {
        const abbr = e.toks.map((x) => x.slice(0, 2)).join(" ");
        // "dot1x ..." abreviado a "do ..." es el escape `do` de Cisco: el equipo lo lee igual.
        const bufs = [abbr, e.cmd.slice(0, 2), e.cmd.slice(0, 4), e.cmd].filter((b) => v.id !== "cisco" || !/^do(\s|$)/.test(b) || /^do\s/.test(e.cmd));
        for (const buf of bufs) {
          for (const p of prompts) {
            const q = S.suggestQuery(buf, p, idx);
            checked++;
            if (q === null) continue;
            // Solo pasa lo explícitamente válido en configuración (Huawei `display`, ASA `show`).
            assert.ok(/^\s*(display|show)(\s|$)/i.test(buf) && (v.id === "huawei" || pl.id === "asa"), `${pl.id} ${p}: "${buf}"`);
            const g = S.ghostFor(idx, q);
            if (g) assert.equal(g.entry.risk, "read");
          }
        }
      }
    }
  }
  assert.ok(checked > 10000);
}

// ---------- Lo tecleado ya es un comando con riesgo: sin texto gris ----------

{
  // `request system storage cleanup` borra archivos; la consulta es `... cleanup dry-run`.
  const junos = S.getIndex(catalog, "junos");
  assert.equal(S.riskyAsTyped(junos, "request system storage cleanup"), true);
  assert.equal(S.ghostFor(junos, "request system storage cleanup"), null, "sin `dry-run` en gris: Enter borraría");
  assert.equal(S.ghostFor(junos, "req sys sto clean"), null, "tampoco abreviado");
  assert.equal(S.ghostFor(junos, "request system storage cleanup d")?.insert, "ry-run");
  // FortiOS: `execute s` podría ser `execute shutdown`.
  const fos = S.getIndex(catalog, "fos74");
  assert.equal(S.ghostFor(fos, "execute s"), null);
  // Con argumentos: `delete flash:x` es el comando con riesgo aunque el marcador no se compare.
  const ios = S.getIndex(catalog, "iosxe");
  assert.equal(S.riskyAsTyped(ios, "delete flash:x.bin"), true);
  assert.equal(S.riskyAsTyped(ios, "reload"), true);
  assert.equal(S.riskyAsTyped(ios, "rel"), true, "abreviado");
  assert.equal(S.riskyAsTyped(ios, "sh ip int br"), false);
  // Linux no abrevia: `netplan a` no es `netplan apply`.
  const ub = S.getIndex(catalog, "ubuntu");
  assert.equal(S.riskyAsTyped(ub, "netplan a"), false);
  assert.equal(S.riskyAsTyped(ub, "netplan apply"), true);
  // Filtros que escriben a disco (Junos `| save`): no son consulta aunque computeRisk diga read.
  const save = junos.entries.find((e) => / \| save /.test(e.cmd));
  if (save) assert.notEqual(save.risk, "read", save.cmd);
}

// ---------- Fuzz: teclas al azar sobre todo el catálogo y todas las plataformas ----------

{
  // PRNG con semilla (mulberry32): el mismo recorrido en cada ejecución.
  let seed = 0x5eed1234;
  const rnd = () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const CTRL = /[\x00-\x1f\x7f-\x9f]/;
  const SPECIAL = ["\x7f", "\x7f", "\b", "\t", "\t", "?", "\x1b[A", "\x1b[D", "\x03", "\x15", "\x17", " ", " ", "|", ";", "&", "| ", "; reload", "\x1b[200~x\x1b[201~", "\u00e9", "\u00b4x"];
  const EVENTS = [
    { key: "ArrowRight" },
    { key: "ArrowRight", ctrlKey: true },
    { key: "ArrowRight", altKey: true },
    { key: ".", code: "Period", ctrlKey: true },
    { key: "ArrowDown" },
    { key: "ArrowUp" },
    { key: "Enter" },
    { key: "Escape" },
    { key: "Tab" },
    { key: "Dead", isComposing: true },
  ];
  let steps = 0;
  let ghostsSeen = 0;
  let inserted = 0;
  for (const v of catalog) {
    for (const pl of v.platforms) {
      const idx = S.getIndex(catalog, pl.id);
      const prompts = [...(EXEC_PROMPTS[v.id] ?? ["user@host:~$ "]), ...(CONFIG_PROMPTS[v.id] ?? ["host(config)#"])];
      for (let run = 0; run < 30; run++) {
        const prompt = pick(prompts);
        const t = new S.InputTracker();
        // Equipo simulado: eco de lo imprimible, prompt tras Enter.
        let line = prompt;
        const device = (data) => {
          for (const ch of data) {
            if (ch === "\r") {
              line = prompt;
              t.output(`\r\n${prompt}`, tail(`\n${prompt}`));
            } else if (ch === "\x7f" || ch === "\b") {
              line = line.length > prompt.length ? line.slice(0, -1) : line;
              t.output("\b \b", tail(line));
            } else if (ch === "\t") {
              // Autocompletado del equipo: a veces completa una palabra, a veces nada.
              if (rnd() < 0.5) {
                line += "ab ";
                t.output("ab ", tail(line));
              }
            } else if (ch === "?" && rnd() < 0.5) {
              // Ayuda del equipo: imprime opciones y repite prompt + lo escrito (sin el "?").
              t.output(`\r\n  brief  Resumen\r\n\r\n${line}`, tail(`\n  brief  Resumen\n\n${line}`));
            } else if (!CTRL.test(ch)) {
              line += ch;
              t.output(ch, tail(line));
            }
          }
        };
        t.output(`\r\n${prompt}`, tail(`\n${prompt}`));
        let list = null;
        const fromSuggest = (text) => {
          // Lo que escribe una sugerencia: nunca Enter ni caracteres de control.
          const safe = S.safeInsert(text);
          assert.equal(safe, text, `${pl.id}: la sugerencia ya venía limpia ${JSON.stringify(text)}`);
          assert.ok(!CTRL.test(safe), `${pl.id}: ${JSON.stringify(safe)}`);
          if (!safe) return;
          inserted++;
          t.insert(safe);
          device(safe);
        };
        let lastTabAccept = 0;
        for (let k = 0; k < 40; k++) {
          steps++;
          // Como la terminal en cada cuadro: confirma o relee con la línea real de la pantalla.
          if (t.canResync) t.resync(line);
          // Invariante: con la línea sincronizada, la pantalla termina en lo que se cree tecleado.
          if (t.active) assert.ok(line.endsWith(t.buf), `${pl.id}: pantalla ${JSON.stringify(line)} vs ${JSON.stringify(t.buf)}`);
          const q = t.active ? S.suggestQuery(t.buf, t.prompt, idx) : null;
          const g = q === null || t.dismissed ? null : S.ghostFor(idx, q);
          if (g) {
            ghostsSeen++;
            assert.equal(g.entry.risk, "read", `${pl.id} ${prompt}: "${t.buf}" → ${g.entry.cmd}`);
            assert.equal(computeRisk(g.entry.cmd), "read");
            assert.equal(S.riskyAsTyped(idx, q), false, `${pl.id}: "${q}" ya podría ser un comando con riesgo`);
            assert.ok(!CTRL.test(g.rest + g.insert), JSON.stringify(g.rest));
            if (S.cliMode(prompt, v.id) === "config") assert.ok(/^\s*(do\s|run\s|display(\s|$)|show(\s|$))/i.test(t.buf), `${pl.id} ${prompt}: "${t.buf}"`);
          }
          // Sin seguimiento (tras una tecla de control), Enter vuelve al prompt más seguido.
          const r = !t.active && rnd() < 0.3 ? 0.55 : rnd();
          if (r < 0.45) {
            // Una abreviatura de un comando del catálogo, a veces con escape de configuración y
            // casi siempre sobre la línea borrada (si no, se suma a lo que ya había).
            if (rnd() < 0.7) for (let n = t.buf.length || 3; n > 0; n--) t.input("\x7f"), device("\x7f");
            const e = pick(idx.entries);
            const n = 1 + Math.floor(rnd() * e.toks.length);
            const esc = rnd() < 0.3 ? pick(["do ", "run ", "display ", "show "]) : "";
            // Sin abreviaturas (shells), las palabras anteriores van completas.
            const cut = (x, i) => (idx.abbrev || i === n - 1 ? x.slice(0, 1 + Math.floor(rnd() * x.length)) : x);
            const text = esc + e.toks.slice(0, n).map(cut).join(" ");
            for (const ch of text) t.input(ch), device(ch);
          } else if (r < 0.53) {
            const ch = pick(SPECIAL);
            t.input(ch);
            device(ch);
          } else if (r < 0.6) {
            t.input("\r");
            device("\r");
            list = null;
          } else {
            const ev = { ctrlKey: false, altKey: false, metaKey: false, shiftKey: false, ...pick(EVENTS) };
            const tabChain = ev.key === "Tab" && lastTabAccept > 0 && rnd() < 0.5;
            const tabAccept = rnd() < 0.8;
            const action = S.suggestKey(ev, { enabled: true, listOpen: !!list, canAccept: !!g?.insert, ghostVisible: !!g, tabAccept, tabChain });
            lastTabAccept = ev.key === "Tab" && action === "accept" ? 1 : 0;
            if (ev.key === "Tab" && action === "accept") assert.ok(g?.insert && tabAccept && !tabChain && !list, "Tab acepta solo con sugerencia visible");
            if (action === "dismiss") {
              assert.ok(g && ev.key === "Escape");
              t.dismissed = true;
            } else if (action === "accept") fromSuggest(g.insert);
            else if (action === "word") fromSuggest(S.nextWord(g.insert));
            else if (action === "open") {
              list = q === null ? null : S.lookup(idx, q, 8);
              if (list && !list.length) list = null;
              if (list) list.q = q;
            } else if (action === "down" || action === "up") assert.ok(list);
            else if (action === "pick") {
              // Elegir de la lista escribe el resto (sin Enter); lo que tiene riesgo pide confirmación antes.
              for (const e of list) assert.ok(!CTRL.test(S.remainderToInsert(e, list.q)));
              const e = list[0];
              if (e.risk === "read" && t.buf.endsWith(list.q)) fromSuggest(S.remainderToInsert(e, list.q));
              list = null;
            } else if (action === "close") list = null;
            else {
              // pass: la tecla va al equipo (Tab, Esc o Enter sin sugerencia, Dead): nunca la produce una sugerencia.
              if (ev.key === "Tab") t.input("\t"), device("\t");
              if (ev.key === "Escape") t.input("\x1b"), device("\x1b");
              list = null;
            }
          }
        }
      }
    }
  }
  assert.ok(steps > 40000 && ghostsSeen > 3000 && inserted > 300, `fuzz: ${steps} pasos, ${ghostsSeen} textos grises, ${inserted} inserciones`);
}

// ---------- Credenciales: lo tecleado nunca llega al historial ----------

{
  // Pedidos de equipos y sistemas: enable, sudo, passphrase de SSH, Junos, Huawei, RADIUS/TACACS+.
  const prompts = [
    "Password: ",
    "[sudo] password for netops: ",
    "Enter passphrase for key '/home/netops/.ssh/id_ed25519': ",
    "Enter passphrase (empty for no passphrase): ",
    "admin@192.0.2.1's password: ",
    "Enter PASSCODE: ",
    "Enter PIN: ",
    "Verification code: ",
    "Please configure the login password (8-16)\nEnter Password:",
    "Confirm Password:",
    "Usuario: ",
    "Clave: ",
  ];
  for (const p of prompts) {
    const t = new S.InputTracker();
    t.output(`\r\n${p}`, tail(`\n${p}`));
    assert.equal(t.cred, true, `credenciales: ${JSON.stringify(p)}`);
  }
  const ios = S.getIndex(catalog, "iosxe");
  const vrp = S.getIndex(catalog, "vrp8");
  const junos = S.getIndex(catalog, "junos");
  const ub = S.getIndex(catalog, "ubuntu");
  // Contraseña tecleada antes de que llegue el pedido (en dos bloques: salto de línea y pedido).
  // La contraseña es a propósito un comando válido: aun así no se registra.
  for (const [idx, prompt, cmd, ask, secret] of [
    [ios, "core-sw01>", "enable", "Password: ", "sh ver"],
    [vrp, "<ar-wan01>", "super 3", "Password:", "display version"],
    [junos, "admin@mx01> ", "start shell user root", "Password:", "show version"],
    [ub, "netops@srv01:~$ ", "sudo ip a", "[sudo] password for netops: ", "ip address show"],
  ]) {
    const usage = new S.SuggestUsage();
    const t = new S.InputTracker();
    t.output(`\r\n${prompt}`, tail(`\n${prompt}`));
    // Lo que hace la terminal al presionar Enter: registra solo con la línea sincronizada.
    const enter = () => {
      const q = t.active ? S.suggestQuery(t.buf, t.prompt, idx) : null;
      const e = q ? S.matchExecuted(idx, q) : null;
      if (e) usage.record(idx.platform, e);
      t.input("\r");
    };
    type(t, cmd);
    t.output(cmd, tail(`\n${prompt}${cmd}`));
    enter();
    const before = usage.serialize();
    type(t, secret);
    assert.equal(t.active, false, `${idx.platform}: sin prompt no se sigue`);
    t.output("\r\n", tail(`\n${prompt}${cmd}\n`));
    assert.equal(t.resync(""), false);
    t.output(ask, tail(`\n${prompt}${cmd}\n${ask}`));
    assert.equal(t.cred, true, `${idx.platform}: ${ask}`);
    assert.equal(t.buf, "", `${idx.platform}: lo tecleado antes del pedido se descarta`);
    // Bajo el pedido: nada se sigue aunque el eco sea con asteriscos.
    type(t, "x");
    t.output("*", tail(`\n${ask}*`));
    assert.equal(t.active, false);
    assert.equal(t.resync(`${ask}*`), false);
    enter();
    // Contraseña tecleada justo antes del pedido y Enter antes de que llegue: tampoco.
    type(t, secret);
    enter();
    assert.equal(usage.serialize(), before, `${idx.platform}: la contraseña no cambia el historial`);
  }
}

// ---------- Historial: solo plantillas, nunca argumentos ----------

{
  const ios = S.getIndex(catalog, "iosxe");
  const vrp = S.getIndex(catalog, "vrp8");
  const tpls = new Set(catalog.flatMap((v) => v.commands.map((c) => c.cmd)));
  const usage = new S.SuggestUsage();
  const lines = [
    [ios, "show interfaces Gi1/0/1", "show interfaces {{interfaz}}"],
    [ios, "ping 192.0.2.1 source Loopback0", null],
    [ios, "show run | include username", "show running-config | include username|aaa|snmp-server"],
    [vrp, "display current-configuration | include password", "display current-configuration | include {{texto}}"],
    [ios, "show vlan id 20", "show vlan id {{vlan}}"],
    [ios, "ping core-sw02", "ping {{ip}}"],
    [ios, "sh mac address-table int Te1/1/1", "show mac address-table interface {{interfaz}}"],
  ];
  for (const [idx, line, want] of lines) {
    const e = S.matchExecuted(idx, line);
    assert.equal(e?.tpl ?? null, want, line);
    if (e) usage.record(idx.platform, e);
  }
  const stored = JSON.parse(usage.serialize()).p;
  for (const m of Object.values(stored)) for (const tpl of Object.keys(m)) assert.ok(tpls.has(tpl), `solo plantillas del catálogo: ${tpl}`);
  const raw = usage.serialize();
  for (const secret of ["Gi1/0/1", "192.0.2.1", "Loopback0", "password", "core-sw02", "Te1/1/1", '"20"', "id 20"]) assert.ok(!raw.includes(secret), `el historial no guarda "${secret}"`);
  // Con plantilla inventada en un pack propio: la del pack, no lo tecleado.
  const idx = mkIndex("cisco", ["ping {{ip}} source {{interfaz}}"]);
  assert.equal(S.matchExecuted(idx, "ping 192.0.2.1 source Loopback0").tpl, "ping {{ip}} source {{interfaz}}");
  // En configuración sin escape no se registra nada (y con `do ` sí, la plantilla).
  assert.equal(S.suggestQuery("sh run", "core-sw01(config)#", ios), null);
  assert.equal(S.matchExecuted(ios, S.suggestQuery("do sh run", "core-sw01(config)#", ios)).tpl, "show running-config");
}
{
  // Tope de tamaño: 40 plataformas × 60 plantillas largas quedan bajo MAX_USAGE_BYTES.
  const u = new S.SuggestUsage();
  for (let p = 0; p < 45; p++) {
    const idx = mkIndex("cisco", Array.from({ length: 70 }, (_, i) => `show ${"x".repeat(200)} ${p} ${i}`), `plat${p}`);
    for (const e of idx.entries) u.record(`plat${p}`, e);
  }
  assert.ok(u.serialize().length <= S.MAX_USAGE_BYTES, `historial ${u.serialize().length} bytes`);
  // Lo recién usado se conserva al recortar.
  const last = mkIndex("cisco", ["show nuevo"], "plat-final");
  u.record("plat-final", last.entries[0]);
  assert.equal(u.count("plat-final", "show nuevo"), 1);
  assert.ok(u.serialize().length <= S.MAX_USAGE_BYTES);
  // Al cargar: un valor gigante se descarta y uno grande se recorta al tope.
  assert.equal(new S.SuggestUsage("x".repeat(S.MAX_USAGE_BYTES * 3)).serialize(), JSON.stringify({ v: 1, p: {} }));
  const big = { v: 1, p: {} };
  for (let p = 0; p < 30; p++) big.p[`p${p}`] = Object.fromEntries(Array.from({ length: 50 }, (_, i) => [`show ${"y".repeat(20)} ${i}`, [1 + (i % 5), 20000]]));
  const bigRaw = JSON.stringify(big);
  assert.ok(bigRaw.length > S.MAX_USAGE_BYTES && bigRaw.length < S.MAX_USAGE_BYTES * 2);
  const loaded = new S.SuggestUsage(bigRaw);
  assert.ok(loaded.serialize().length <= S.MAX_USAGE_BYTES);
  assert.ok(loaded.count("p0", `show ${"y".repeat(20)} 4`) > 0, "se conservan las más usadas");
  // "__proto__" como plataforma o plantilla no cambia el prototipo (objetos sin prototipo).
  const evil = new S.SuggestUsage('{"v":1,"p":{"__proto__":{"iosxe":[1,1]},"iosxe":{"__proto__":[5,1],"show clock":[2,1]}}}');
  assert.equal(evil.count("iosxe", "show clock"), 2);
  assert.equal(evil.count("otra", "iosxe"), 0, "la plataforma __proto__ no se hereda");
  assert.ok(S.getIndex(catalog, "iosxe") && evil.weights(S.getIndex(catalog, "iosxe"), new Set()).length > 0);
}

// ---------- Teclado: distribuciones, AltGr e IME ----------

{
  const on2 = { enabled: true, listOpen: false, canAccept: true };
  // Ctrl+. con teclado latinoamericano o español: "." está en la misma tecla (Period), sin Shift.
  assert.equal(S.suggestKey(k(".", { ctrlKey: true, code: "Period" }), on2), "open", "US y latinoamericano");
  // AltGr (Windows lo entrega como Ctrl+Alt) nunca abre la lista ni acepta: escribe @, #, etc.
  for (const key of [".", "@", "#", "ArrowRight"]) assert.equal(S.suggestKey(k(key, { ctrlKey: true, altKey: true, code: "Period" }), on2), "pass", `AltGr+${key}`);
  // Alt+/ por código físico: en latinoamericano esa tecla escribe "-" (la barra es Shift+7).
  assert.equal(S.suggestKey(k("-", { altKey: true, code: "Slash" }), { ...on2, listKey: "alt+slash" }), "open");
  assert.equal(S.suggestKey(k("/", { altKey: true, shiftKey: true, code: "Digit7" }), { ...on2, listKey: "alt+slash" }), "pass");
  // macOS: Option+/ entrega "÷" en e.key; vale por el código físico.
  assert.equal(S.suggestKey(k("÷", { altKey: true, code: "Slash" }), { ...on2, listKey: "alt+slash" }), "open");
  // IME y teclas muertas (tildes): nunca se interceptan.
  for (const key of ["Dead", "Process", "ArrowRight", "Enter", ".", "Tab"]) {
    assert.equal(S.suggestKey(k(key, { isComposing: true, ctrlKey: key === "." }), on2), "pass", `componiendo: ${key}`);
    assert.equal(S.suggestKey(k(key, { isComposing: true }), { ...on2, listOpen: true }), "pass");
  }
  assert.equal(S.suggestKey(k("Dead"), on2), "pass", "tecla muerta sin componer");
  // El texto compuesto llega entero por onData: "é" se sigue; "´x" (tilde sin combinar) desincroniza.
  const t = atPrompt();
  type(t, "show caf");
  t.input("é");
  assert.equal(t.buf, "show café");
  t.input("´x");
  assert.equal(t.active, false);
  // Tab y → sin texto gris siempre llegan al equipo, con cualquier tecla de lista.
  for (const lk of Object.keys(S.LIST_KEYS)) {
    assert.equal(S.suggestKey(k("Tab"), { ...on2, canAccept: false, listKey: lk }), "pass");
    assert.equal(S.suggestKey(k("ArrowRight"), { ...on2, canAccept: false, listKey: lk }), "pass");
    assert.equal(S.suggestKey(k("ArrowRight", { ctrlKey: true }), { ...on2, canAccept: false, listKey: lk }), "pass");
  }
}

// ---------- Color de la sugerencia: se ve y se distingue en los 17 temas ----------

{
  const { presets } = await import("../../src/lib/theme.ts");
  assert.equal(presets.length, 17);
  const rows = [];
  for (const p of presets) {
    const t = p.theme;
    for (const choice of Object.keys(S.GHOST_COLORS)) {
      const g = S.ghostColor(t, choice);
      assert.ok(g, `${p.id} ${choice}`);
      const c = S.contrastRatio(g, t.background);
      // WCAG 1.4.11 (contraste no textual): al menos 3:1 con el fondo, en automático y en cada tono.
      assert.ok(c >= S.GHOST_CONTRAST, `${p.id} ${choice}: ${g} ${c.toFixed(2)}:1`);
      // Nunca gris ni blanco: con croma propio.
      assert.ok(S.chroma(g) >= S.GHOST_CHROMA, `${p.id} ${choice}: ${g} es gris (C* ${S.chroma(g).toFixed(0)})`);
      assert.ok(!/^#(?:ffffff|000000)$/i.test(g));
      if (choice !== "auto") continue;
      // Automático: distinto del texto normal y del cursor (ΔE ≥ 30 y otro tono si son de color).
      assert.ok(S.distinctFrom(g, t.foreground), `${p.id}: ${g} se parece al texto ${t.foreground} (ΔE ${S.colorDistance(g, t.foreground).toFixed(0)})`);
      assert.ok(S.distinctFrom(g, t.cursor), `${p.id}: ${g} se parece al cursor ${t.cursor}`);
      assert.ok(S.colorDistance(g, t.foreground) >= S.GHOST_DISTANCE);
      rows.push(`${p.id} ${g} ${c.toFixed(1)}:1`);
    }
  }
  // Temas monocromo: en Ámbar y Fósforo verde el automático cambia de tono (no ámbar ni verde).
  const byId = Object.fromEntries(presets.map((p) => [p.id, p.theme]));
  assert.ok(S.hueDifference(S.ghostColor(byId.amber), byId.amber.foreground) >= S.GHOST_HUE);
  assert.ok(S.hueDifference(S.ghostColor(byId.phosphor), byId.phosphor.foreground) >= S.GHOST_HUE);
  // El tema propio decide cuando su color sirve (cian de NetTerminal, Dracula y GitHub).
  assert.equal(S.ghostColor(byId["nt-dark"]), byId["nt-dark"].cyan);
  assert.equal(S.ghostColor(byId["nt-light"]), byId["nt-light"].cyan);
  assert.equal(S.ghostColor(byId.dracula), byId.dracula.cyan);
  // Un tono elegido se respeta aunque se parezca al texto (ámbar en el tema Ámbar).
  assert.ok(S.hueDifference(S.ghostColor(byId.amber, "amber"), byId.amber.foreground) < S.GHOST_HUE);
  // Valor desconocido (settings.json editado a mano): como automático.
  assert.equal(S.ghostColor(byId["nt-dark"], "rosado"), S.ghostColor(byId["nt-dark"], "auto"));
  assert.equal(S.ghostColor({ foreground: "#fff", background: "var(--x)" }), null, "fondo no reconocido: la terminal usa opacidad fija");
  assert.equal(S.ghostColor(undefined), null);
  assert.equal(S.contrastRatio("#000", "#fff").toFixed(0), "21");
  console.log(`color automático: ${rows.join(" · ")}`);
}

// ---------- Tab: acepta solo la sugerencia visible; sin ella va al equipo ----------

{
  const ios = S.getIndex(catalog, "iosxe");
  const ctx = { enabled: true, listOpen: false, canAccept: true, ghostVisible: true, tabAccept: true };
  assert.equal(S.suggestKey(k("Tab"), ctx), "accept", "Tab acepta con sugerencia visible");
  assert.equal(S.suggestKey(k("Tab"), { ...ctx, canAccept: false, ghostVisible: false }), "pass", "sin sugerencia, Tab va al equipo");
  // En un marcador ({{interfaz}}) la sugerencia se ve pero ya no inserta nada: Tab va al equipo.
  assert.equal(S.suggestKey(k("Tab"), { ...ctx, canAccept: false, ghostVisible: true }), "pass", "en un marcador, Tab va al equipo");
  assert.equal(S.suggestKey(k("Tab"), { ...ctx, tabAccept: false }), "pass", "ajuste apagado: Tab va al equipo");
  assert.equal(S.suggestKey(k("Tab"), { ...ctx, tabAccept: undefined }), "pass", "sin ajuste, como siempre");
  assert.equal(S.suggestKey(k("Tab"), { ...ctx, listOpen: true }), "pass", "con la lista abierta, Tab va al equipo");
  for (const mods of [{ shiftKey: true }, { ctrlKey: true }, { altKey: true }, { metaKey: true }])
    assert.equal(S.suggestKey(k("Tab", mods), ctx), "pass", `Tab con modificador: ${Object.keys(mods)}`);
  assert.equal(S.suggestKey(k("Tab", { isComposing: true }), ctx), "pass");
  assert.equal(S.suggestKey(k("Tab"), { ...ctx, enabled: false }), "pass");
  // Doble Tab: si el primero aceptó hace menos de 400 ms, el segundo va al equipo.
  assert.equal(S.suggestKey(k("Tab"), { ...ctx, tabChain: true }), "pass", "segundo Tab encadenado va al equipo");
  assert.equal(S.TAB_CHAIN_MS, 400);
  assert.equal(S.tabChained(0, 1000), false, "sin Tab anterior que aceptara");
  assert.equal(S.tabChained(1000, 1100), true);
  assert.equal(S.tabChained(1000, 1399), true);
  assert.equal(S.tabChained(1000, 1400), false, "a los 400 ms ya no");
  assert.equal(S.tabChained(1000, 900), false, "reloj hacia atrás: no encadena");

  // De punta a punta: tracker + sugerencia + Tab. Lo que se envía nunca trae Tab ni Enter.
  const t = atPrompt();
  const sent = [];
  const key = (ev) => {
    const q = t.active ? S.suggestQuery(t.buf, t.prompt, ios) : null;
    const g = q === null || t.dismissed ? null : S.ghostFor(ios, q);
    const a = S.suggestKey(ev, { enabled: true, listOpen: false, canAccept: !!g?.insert, ghostVisible: !!g, tabAccept: true });
    if (a === "accept") {
      const ins = S.safeInsert(g.insert);
      t.insert(ins);
      sent.push(ins);
    } else if (a === "dismiss") t.dismissed = true;
    else if (a === "pass") {
      const data = ev.key === "Tab" ? "\t" : ev.key === "Escape" ? "\x1b" : ev.key;
      t.input(data);
      sent.push(data);
    }
    return a;
  };
  type(t, "sh ip int");
  t.output("sh ip int", tail("\ncore-sw01#sh ip int"));
  const want = S.ghostFor(ios, "sh ip int").insert;
  assert.ok(want);
  assert.equal(key(k("Tab")), "accept");
  assert.equal(t.buf, "sh ip int" + want, "Tab completa igual que →");
  assert.equal(t.active, true, "aceptar no desincroniza");
  assert.ok(sent.every((x) => !/[\r\n\t]/.test(x)), "aceptar no envía Tab ni Enter");
  // Esc con sugerencia visible: la descarta y no llega al equipo; luego Tab va al equipo.
  const t2 = atPrompt();
  t.buf = "";
  type(t2, "sh ver");
  t2.output("sh ver", tail("\ncore-sw01#sh ver"));
  const before = sent.length;
  const tt = t;
  // Reusa el ayudante sobre la segunda línea.
  Object.assign(tt, { buf: t2.buf, sync: true, prompt: t2.prompt, dismissed: false });
  assert.equal(key(k("Escape")), "dismiss");
  assert.equal(sent.length, before, "Esc que descarta no llega al equipo");
  assert.equal(key(k("Tab")), "pass", "tras Esc, Tab va al equipo");
  assert.equal(sent[sent.length - 1], "\t");
  // Sin sugerencia (nombre fuera del catálogo): Tab llega al equipo.
  const u = atPrompt();
  type(u, "zzzz");
  assert.equal(S.ghostFor(ios, S.suggestQuery(u.buf, u.prompt, ios)), null);
  assert.equal(S.suggestKey(k("Tab"), { ...ctx, canAccept: false, ghostVisible: false }), "pass");
  // Aceptar hasta un marcador: la sugerencia que queda ({{interfaz}}) no inserta nada, Tab va al equipo.
  const ph = ios.entries.find((e) => e.placeholder && e.risk === "read" && e.insert.length > 6 && S.ghostFor(ios, e.insert.slice(0, 4))?.entry === e);
  if (ph) {
    const g = S.ghostFor(ios, ph.insert);
    assert.ok(!g || g.entry !== ph || g.insert === "", "en el marcador no queda nada que insertar");
  }
}

// ---------- Esc: descarta la sugerencia de la línea; sin sugerencia llega al equipo ----------

{
  const ctx = { enabled: true, listOpen: false, canAccept: true, ghostVisible: true, tabAccept: true };
  assert.equal(S.suggestKey(k("Escape"), ctx), "dismiss");
  assert.equal(S.suggestKey(k("Escape"), { ...ctx, canAccept: false, ghostVisible: true }), "dismiss", "también en un marcador visible");
  assert.equal(S.suggestKey(k("Escape"), { ...ctx, canAccept: false, ghostVisible: false }), "pass", "sin sugerencia, Esc va al equipo");
  assert.equal(S.suggestKey(k("Escape"), { ...ctx, listOpen: true }), "close", "con la lista abierta, Esc la cierra");
  assert.equal(S.suggestKey(k("Escape", { altKey: true }), ctx), "pass");
  const ios = S.getIndex(catalog, "iosxe");
  const t = atPrompt();
  type(t, "sh ver");
  t.dismissed = true;
  type(t, "s");
  assert.equal(t.dismissed, true, "sigue descartada al seguir escribiendo en la misma línea");
  t.input("\r");
  assert.equal(t.dismissed, false, "Enter vuelve a mostrar sugerencias en la próxima línea");
  t.output("\r\ncore-sw01#", tail("\ncore-sw01#"));
  type(t, "sh ver");
  assert.ok(S.ghostFor(ios, t.buf));
  // Línea perdida (Ctrl+C): el salto de línea del equipo también la libera.
  const u = atPrompt();
  type(u, "sh");
  u.dismissed = true;
  u.input("\x03");
  u.output("\r\ncore-sw01#", tail("\ncore-sw01#"));
  assert.equal(u.dismissed, false);
}

// ---------- Re-sincronía tras el Tab nativo del equipo y la ayuda "?" ----------

{
  const ios = S.getIndex(catalog, "iosxe");
  // IOS completa la palabra: "sh ip int" + Tab → el equipo escribe "erface ".
  const t = atPrompt();
  type(t, "sh ip int");
  t.output("sh ip int", tail("\ncore-sw01#sh ip int"));
  t.input("\t");
  assert.equal(t.active, false, "esperando la respuesta del equipo");
  assert.equal(t.reread, true);
  assert.equal(t.resync("core-sw01#sh ip int"), false, "antes de la respuesta no se lee la pantalla");
  t.output("erface ", tail("\ncore-sw01#sh ip interface "));
  assert.equal(t.active, false, "el texto crudo no basta: puede traer retrocesos o redibujos");
  assert.equal(t.resync("core-sw01#sh ip interface "), true, "la línea real de la pantalla re-sincroniza");
  assert.equal(t.buf, "sh ip interface ");
  assert.equal(t.active, true);
  assert.ok(S.ghostFor(ios, t.buf), "las sugerencias siguen en el resto de la línea");
  type(t, "b");
  assert.equal(t.buf, "sh ip interface b");
  assert.equal(S.ghostFor(ios, t.buf)?.insert, "rief");
  // Teclas escritas antes de que el equipo responda: la pantalla debe terminar con ellas.
  const u = atPrompt();
  type(u, "sh ver");
  u.input("\t");
  type(u, " x");
  u.output("sion", tail("\ncore-sw01#sh version"));
  assert.equal(u.resync("core-sw01#sh version"), false, "falta el eco de lo tecleado después");
  u.output(" x", tail("\ncore-sw01#sh version x"));
  assert.equal(u.resync("core-sw01#sh version x"), true);
  assert.equal(u.buf, "sh version x");
  // Retroceso mientras se espera: BS (0x08).
  const w = atPrompt();
  type(w, "sh");
  w.input("\t");
  type(w, "ab");
  w.input("\b");
  w.output("ow a", tail("\ncore-sw01#show a"));
  assert.equal(w.resync("core-sw01#show a"), true);
  assert.equal(w.buf, "show a");
  // Doble Tab de una shell: lista candidatos con saltos de línea y repite prompt + lo escrito.
  const sh = new S.InputTracker();
  sh.output("\r\nnetops@srv01:~$ ", tail("\nnetops@srv01:~$ "));
  type(sh, "ip ro");
  sh.input("\t");
  sh.input("\t");
  sh.output("\r\nroute  rule\r\nnetops@srv01:~$ ip ro", tail("\nroute  rule\nnetops@srv01:~$ ip ro"));
  assert.equal(sh.resync("netops@srv01:~$ ip ro"), true, "tras el listado de la shell vuelve");
  assert.equal(sh.buf, "ip ro");
  // Protecciones: otro prompt, desplazamiento horizontal de IOS y credenciales no se adoptan.
  const x = atPrompt();
  type(x, "sh");
  x.input("\t");
  x.output("ow", tail("\ncore-sw01#show"));
  assert.equal(x.resync("core-sw01(config)#show"), false, "otro prompt: no se adopta");
  assert.equal(x.resync("core-sw01#$terface brief"), false, "desplazamiento de IOS: el inicio no se ve");
  assert.equal(x.resync("core-sw01#sh\x07ow"), false, "con caracteres de control no se adopta");
  x.output("\r\nPassword: ", tail("\nPassword: "));
  assert.equal(x.cred, true);
  assert.equal(x.reread, false);
  assert.equal(x.resync("core-sw01#show"), false, "con credenciales no se relee nada");
  // Tab sin línea sincronizada (prompt no confirmado): como antes, queda perdida.
  const y = new S.InputTracker();
  type(y, "sh");
  y.input("\t");
  assert.equal(y.lost, true);
  // Ayuda "?" de Cisco: el equipo no hace eco del "?", imprime opciones y repite prompt + lo escrito.
  const h = atPrompt();
  type(h, "show ");
  h.output("show ", tail("\ncore-sw01#show "));
  h.input("?");
  assert.equal(h.active, false);
  h.output("\r\n  version     System hardware and software status\r\n  vlan        VTP VLAN status\r\n\r\ncore-sw01#show ", tail("\n  vlan        VTP VLAN status\n\ncore-sw01#show "));
  assert.equal(h.resync("core-sw01#show "), true, "tras la ayuda vuelve con prompt + lo escrito");
  assert.equal(h.buf, "show ");
  type(h, "ver");
  assert.equal(S.ghostFor(ios, h.buf)?.insert, "sion");
  // En una shell "?" es un carácter más (con eco): también se lee de la pantalla.
  const lx = new S.InputTracker();
  lx.output("\r\nnetops@srv01:~$ ", tail("\nnetops@srv01:~$ "));
  type(lx, "ls fil");
  lx.input("?");
  lx.output("?", tail("\nnetops@srv01:~$ ls fil?"));
  assert.equal(lx.resync("netops@srv01:~$ ls fil?"), true);
  assert.equal(lx.buf, "ls fil?");
  // Enter durante la espera: vuelve al seguimiento normal con el próximo prompt.
  const e = atPrompt();
  type(e, "sh");
  e.input("\t");
  e.input("\r");
  assert.equal(e.reread, false);
  e.output("\r\ncore-sw01#", tail("\ncore-sw01#"));
  assert.equal(e.active, true);
}

// ---------- Retroceso: siempre llega al equipo; DEL (0x7f) y BS (0x08) valen igual ----------

{
  const all = [
    { enabled: true, listOpen: false, canAccept: true, ghostVisible: true, tabAccept: true },
    { enabled: true, listOpen: true, canAccept: false, tabAccept: true },
    { enabled: true, listOpen: false, canAccept: false, tabAccept: false },
    { enabled: false, listOpen: false, canAccept: false },
  ];
  for (const ctx of all) {
    for (const mods of [{}, { ctrlKey: true }, { altKey: true }, { metaKey: true }]) {
      assert.equal(S.suggestKey(k("Backspace", mods), ctx), "pass", "Retroceso nunca lo toma una sugerencia");
      assert.equal(S.suggestKey(k("Delete", mods), ctx), "pass");
    }
  }
  for (const bs of ["\x7f", "\x08"]) {
    const t = atPrompt();
    type(t, "show vx");
    t.input(bs);
    assert.equal(t.buf, "show v", `retroceso ${JSON.stringify(bs)}`);
    assert.equal(t.active, true, "borrar no desincroniza");
    t.input(bs);
    t.input(bs);
    assert.equal(t.buf, "shor".slice(0, 3) + "w");
  }
  const t = atPrompt();
  type(t, "x\u{1F600}");
  t.input("\x08");
  assert.equal(t.buf, "x", "BS borra un par sustituto completo");
}

// ---------- Ayuda "Tab o → acepta · Esc descarta": solo las primeras veces ----------

{
  assert.equal(S.tipText(true), "Tab o → acepta · Esc descarta");
  assert.equal(S.tipText(false), "→ acepta · Esc descarta");
  assert.equal(S.TIP_TIMES, 5);
  const c = new S.TipCounter();
  const shown = [];
  for (let line = 1; line <= 8; line++) {
    // Varios cuadros en la misma línea cuentan una sola vez.
    const a = c.allow("iosxe", `c1:${line}`);
    assert.equal(c.allow("iosxe", `c1:${line}`), a);
    shown.push(a);
  }
  assert.deepEqual(shown, [true, true, true, true, true, false, false, false], "solo las primeras 5 líneas");
  assert.equal(c.count("iosxe"), 5);
  assert.equal(c.allow("vrp8", "c1:9"), true, "cada plataforma cuenta aparte");
  // Se guarda y se carga (solo números por plataforma).
  const back = new S.TipCounter(c.serialize());
  assert.equal(back.allow("iosxe", "c2:1"), false);
  assert.equal(back.count("vrp8"), 1);
  assert.ok(!/c1:/.test(c.serialize()), "no guarda líneas ni texto");
  for (const bad of ["no json", "[1,2]", '{"__proto__":9,"x y":3,"ok":"5"}', "null"]) {
    const d = new S.TipCounter(bad);
    assert.equal(d.allow("iosxe", "z"), true, `valor dañado: ${bad}`);
  }
  assert.equal(new S.TipCounter('{"iosxe":999}').allow("iosxe", "z"), false, "tope en TIP_TIMES");
  c.clear();
  assert.equal(c.allow("iosxe", "c3:1"), true, "borrar el historial la vuelve a mostrar");
}

// ---------- Nunca se produce Enter (Tab, →, palabra y lista) ----------

{
  for (const p of platforms) {
    const idx = S.getIndex(catalog, p);
    for (const e of idx.entries.slice(0, 200)) {
      for (const n of [2, 3, 5]) {
        const g = S.ghostFor(idx, e.cmd.slice(0, n));
        if (!g) continue;
        for (const text of [g.insert, S.nextWord(g.insert), S.remainderToInsert(e, e.cmd.slice(0, n))])
          assert.ok(!/[\r\n\t\x00-\x1f\x7f-\x9f]/.test(S.safeInsert(text)), `${p}: ${JSON.stringify(text)}`);
      }
    }
  }
  // Ninguna tecla, en ningún contexto, se traduce en una acción que envíe Enter.
  for (const key of ["Enter", "Tab", "Escape", "ArrowRight", "Backspace", " ", "a", "?"])
    for (const listOpen of [false, true])
      for (const canAccept of [false, true])
        for (const tabAccept of [false, true])
          for (const tabChain of [false, true]) {
            const a = S.suggestKey(k(key), { enabled: true, listOpen, canAccept, ghostVisible: canAccept, tabAccept, tabChain });
            if (key === "Enter") assert.ok(a === "pass" || a === "pick", "Enter solo elige de la lista (sin enviarlo)");
            if (a === "accept") assert.ok(canAccept && !listOpen && (key !== "Tab" || (tabAccept && !tabChain)));
          }
}

// ---------- Rendimiento ----------

{
  const total = catalog.reduce((n, v) => n + v.commands.length, 0);
  let t0 = performance.now();
  for (const p of platforms) S.buildIndex(catalog, p);
  const build = (performance.now() - t0) / platforms.length;
  // Cada prefijo de cada comando, sus formas abreviadas y consultas patológicas (una letra por palabra).
  const queries = [];
  const usage = new S.SuggestUsage();
  for (const p of platforms) {
    const idx = S.getIndex(catalog, p);
    for (const e of idx.entries.slice(0, 40)) usage.record(p, e);
    const w = usage.weights(idx, new Set());
    for (const e of idx.entries) {
      for (let n = 1; n <= e.cmd.length; n++) queries.push([idx, e.cmd.slice(0, n), w]);
      for (const len of [1, 2, 3]) queries.push([idx, e.toks.map((t) => t.slice(0, len)).join(" "), w]);
    }
    for (const q of ["s", "s ", "s i", "s i i", "d", "d i", "g s", "sh i", "show "]) queries.push([idx, q, w]);
  }
  for (const [idx, q, w] of queries) S.ghostFor(idx, q, w), S.lookup(idx, q, 8, { weights: w });
  t0 = performance.now();
  for (const [idx, q, w] of queries) S.ghostFor(idx, q, w);
  const ghostUs = ((performance.now() - t0) * 1000) / queries.length;
  t0 = performance.now();
  for (const [idx, q, w] of queries) S.lookup(idx, q, 8, { weights: w });
  const listUs = ((performance.now() - t0) * 1000) / queries.length;
  // Peor caso por tecla (texto gris + lista): la mejor de 5 tandas de 4 por consulta, para no medir pausas del GC.
  const LIMIT = 20;
  const perKey = ([idx, q, w], rounds) => {
    let best = Infinity;
    for (let r = 0; r < rounds; r++) {
      const a = performance.now();
      for (let i = 0; i < 4; i++) S.ghostFor(idx, q, w), S.lookup(idx, q, 8, { weights: w });
      best = Math.min(best, ((performance.now() - a) * 1000) / 4);
    }
    return best;
  };
  const measured = queries.map((x) => [perKey(x, 5), x]);
  // Con la máquina ocupada (otro build o test en paralelo) una tanda puede salir lenta. Antes de
  // concluir se vuelven a medir, con más tandas, TODAS las consultas sobre la mitad del límite
  // (no solo la peor: si una segunda también lo pasara de verdad, medir solo la primera la
  // escondería; y desde la mitad, para que el ruido no deje el peor caso al borde del límite).
  const slow = measured.filter(([us]) => us >= LIMIT / 2);
  const cpu0 = process.cpuUsage();
  const wall0 = performance.now();
  for (const m of slow) m[0] = perKey(m[1], 50);
  // Carga sostenida (más procesos que núcleos): el proceso recibe menos CPU que el tiempo
  // transcurrido o el promedio de carga supera los núcleos, y todo corre más lento por igual
  // (en Apple Silicon, además, pasa a núcleos de eficiencia). Ahí el límite se duplica: sigue
  // atrapando una regresión de orden (lineal por tecla) sin fallar por carga ajena.
  const wall = performance.now() - wall0;
  const { user, system } = process.cpuUsage(cpu0);
  const loaded = slow.length > 0 && (wall > 50 && (user + system) / 1000 < wall * 0.9 || loadavg()[0] > cpus().length * 0.75);
  const limit = loaded ? LIMIT * 2 : LIMIT;
  let worst = 0;
  let worstQ = "";
  for (const [us, [idx, q]] of measured) if (us > worst) (worst = us), (worstQ = `${idx.platform} "${q}"`);
  console.log(
    `rendimiento: ${total} comandos, ${platforms.length} plataformas · índice ${build.toFixed(2)} ms/plataforma · ` +
      `texto gris ${ghostUs.toFixed(2)} µs · lista ${listUs.toFixed(2)} µs (${queries.length} búsquedas, con historial) · ` +
      `peor caso por tecla ${worst.toFixed(1)} µs (${worstQ})${loaded ? ` · máquina con carga: límite ${limit} µs` : ""}`,
  );
  assert.ok(worst < limit, `peor caso por tecla bajo ${limit} µs (${worst.toFixed(1)} µs)`);
}

console.log("suggest: OK");
