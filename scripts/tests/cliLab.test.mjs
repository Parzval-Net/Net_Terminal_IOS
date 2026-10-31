// CLI Lab: líneas del script, errores de CLI y ejecución por equipo: `node scripts/tests/cliLab.test.mjs`.
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

const L = await import("../../src/lib/cliLab.ts");

assert.deepEqual(L.scriptLines("config system interface\n  edit port1  \n\n# comentario\n! cisco\n// nota\n    set alias wan\nend\n"), [
  "config system interface",
  "  edit port1",
  "    set alias wan",
  "end",
]);

assert.equal(L.cliError("sw01#show ip intx\n              ^\n% Invalid input detected at '^' marker.\nsw01#", "show ip intx"), "% Invalid input detected at '^' marker.");
assert.equal(L.cliError("<HW>dis vlan x\n              ^\nError: Unrecognized command found at '^' position.\n<HW>", "dis vlan x"), "Error: Unrecognized command found at '^' position.");
assert.equal(L.cliError("fw01 # set foo\ncommand parse error before 'foo'\nCommand fail. Return code -61\nfw01 #", "set foo"), "command parse error before 'foo'");
assert.equal(L.cliError("user@mx> show bogus\n                ^\nsyntax error.\nuser@mx>", "show bogus"), "syntax error.");
assert.equal(L.cliError("sw01#show logging | i error:\nerror: línea después del eco\n", "show logging | i error:"), "error: línea después del eco");
assert.equal(L.cliError("sw01#show interfaces\nGi1/0/1 is up, 0 input errors, 0 CRC\nsw01#", "show interfaces"), null);
assert.equal(L.cliError("sw01#show version\n% Incomplete command.\n", "show version"), "% Incomplete command.");

// Ejecución: dos equipos, el segundo falla en la línea 2 y se detiene; el primero termina.
const calls = [];
const conns = { a: "c-a", b: "c-b", c: undefined };
const exec = async (conn, cmd, answer) => {
  calls.push([conn, cmd, answer]);
  await new Promise((r) => setTimeout(r, 1));
  if (conn === "c-b" && cmd === "set bad") return { ok: true, output: `${cmd}\ncommand parse error before 'bad'\n` };
  if (cmd === "reboot") return { ok: false, output: "reboot\nDo you want to continue? (y/n)n\n", declined: "Do you want to continue? (y/n)" };
  return { ok: true, output: `${cmd}\nfw #` };
};
const targets = [
  { tabId: "a", name: "fw-a" },
  { tabId: "b", name: "fw-b" },
  { tabId: "c", name: "fw-c" },
];
const run = await L.runLab(targets, ["config system global", "set bad", "end", "write memory"], {
  stopOnError: true,
  parallel: 2,
  answer: false,
  conn: (id) => conns[id],
  exec,
});
assert.equal(run.running, false);
assert.deepEqual(run.items.map((i) => i.status), ["ok", "error", "skipped"]);
assert.equal(run.items[0].steps.length, 4);
assert.equal(run.items[1].steps.length, 2);
assert.match(run.items[1].reason, /^Línea 2: command parse error/);
assert.equal(run.items[2].reason, "Se desconectó");
assert.equal(calls.find(([c, cmd]) => c === "c-a" && cmd === "write memory")[2], true, "guardado responde confirmaciones");
assert.equal(calls.find(([c, cmd]) => c === "c-a" && cmd === "end")[2], false);

// Pregunta rechazada = error; sin stopOnError sigue con la línea siguiente.
const r2 = await L.runLab([targets[0]], ["reboot", "get system status"], { stopOnError: false, parallel: 4, answer: false, conn: (id) => conns[id], exec });
assert.equal(r2.items[0].status, "error");
assert.equal(r2.items[0].steps.length, 2);
assert.match(r2.items[0].steps[0].note, /se respondió que no/);
assert.match(L.labReport(r2), /^===== fw-a: ERROR/);

// Detener: no se ejecutan más líneas.
const slow = async (conn, cmd) => {
  await new Promise((r) => setTimeout(r, 20));
  return { ok: true, output: cmd };
};
const p = L.runLab([targets[0]], ["a", "b", "c", "d"], { stopOnError: true, parallel: 1, answer: false, conn: (id) => conns[id], exec: slow });
await new Promise((r) => setTimeout(r, 30));
L.stopLab();
const r3 = await p;
assert.equal(r3.items[0].status, "stopped");
assert.ok(r3.items[0].steps.length < 4);
await assert.rejects(async () => {
  const a = L.runLab([targets[0]], ["x"], { stopOnError: true, parallel: 1, answer: false, conn: (id) => conns[id], exec: slow });
  try {
    await L.runLab([targets[0]], ["x"], { stopOnError: true, parallel: 1, answer: false, conn: (id) => conns[id], exec: slow });
  } finally {
    await a;
  }
}, /Ya hay un script/);

// Los secretos tampoco quedan en el eco del equipo (visor, Copiar y Guardar).
assert.equal(L.maskSecrets("username noc secret Clave#2026\nR1(config)#", ["Clave#2026"]), "username noc secret ••••••\nR1(config)#");
assert.equal(L.maskSecrets("ab ab", ["ab"]), "ab ab", "valores muy cortos no se reemplazan");

// Respuesta como en la consola: prompt del eco y líneas del equipo, sin el prompt final.
assert.deepEqual(L.splitStep("FGT901G (profile) # edit \"Block\"\r\nnew entry 'Block' added\r\n\r\nFGT901G (Block) # ", 'edit "Block"'), {
  prompt: "FGT901G (profile) #",
  body: ["new entry 'Block' added"],
});
assert.deepEqual(L.splitStep("sw01(config)#interface Gi1/0/7\r\nsw01(config-if)#", "interface Gi1/0/7"), { prompt: "sw01(config)#", body: [] });
assert.deepEqual(L.splitStep("", "end"), { prompt: "", body: [] });

console.log("cliLab: ok");
