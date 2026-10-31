// Prompts y errores de CLI compartidos (topología, ciclo de vida, respaldos, CLI Lab):
// `node scripts/tests/cliText.test.mjs`. La misma lista de prompts la prueba filexfer.rs.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fastEnough } from "./timing.mjs";

const T = await import("../../src/lib/cliText.ts");
const fx = JSON.parse(readFileSync(new URL("./fixtures/prompts.json", import.meta.url), "utf8"));

for (const [line, name] of fx.prompts) {
  assert.equal(T.promptName(`show clock\n*10:42:17 UTC\n${line}`), name, JSON.stringify(line));
  assert.ok(T.isPrompt(line), JSON.stringify(line));
}
for (const line of fx.not_prompts) assert.equal(T.promptName(line), null, JSON.stringify(line));

const errors = [
  ["sw01#show ip intx\n              ^\n% Invalid input detected at '^' marker.\nsw01#", "% Invalid input detected at '^' marker."],
  ["sw01#show\n% Incomplete command.\n", "% Incomplete command."],
  ["sw01#sh i\n% Ambiguous command:  \"sh i\"\n", '% Ambiguous command:  "sh i"'],
  ["<HW>dis vlan x\nError: Unrecognized command found at '^' position.\n<HW>", "Error: Unrecognized command found at '^' position."],
  ["[HW]vlan 5000\nError: Wrong parameter found at '^' position.", "Error: Wrong parameter found at '^' position."],
  ["fw01 # set foo\ncommand parse error before 'foo'\nCommand fail. Return code -61", "command parse error before 'foo'"],
  ["fw01 # diagnose x\nUnknown action 0\n", "Unknown action 0"],
  ["user@mx> show bogus\n                ^\nsyntax error.\nuser@mx>", "syntax error."],
  ["user@mx> foo\n        ^\nunknown command.\nuser@mx>", "unknown command."],
  ["user@mx# commit\nerror: configuration check-out failed\n", "error: configuration check-out failed"],
  ["[admin@MikroTik] > /foo\nbad command name foo (line 1 column 2)\n", "bad command name foo (line 1 column 2)"],
  ["admin@PA> show foo\nUnknown command: foo\n", "Unknown command: foo"],
  ["admin@PA> set x\nInvalid syntax.\n", "Invalid syntax."],
];
for (const [out, want] of errors) assert.equal(T.cliErrorLine(out), want, out);
assert.equal(T.cliErrorLine("sw01#show interfaces\nGi1/0/1 is up, 0 input errors, 0 CRC\nsw01#"), null);
// El eco del comando no cuenta: un filtro "| i error:" no es un error.
assert.equal(T.commandError("error: show logging | i error:\nsw01#", "show logging | i error:"), null);
assert.equal(T.commandError("sw01#show logging | i error:\nerror: real\n", "show logging | i error:"), "error: real");

// Errores tras borrar "--More--" con retrocesos y colores ANSI (ProCurve, Huawei).
assert.equal(T.cliErrorLine("sw# show x\n -- MORE --\b\b\b\b\b\b\b\b\b\b\b% Invalid input: x\n"), "% Invalid input: x");
assert.equal(T.cliErrorLine("\x1b[31m% Invalid input detected\x1b[0m\n"), "% Invalid input detected");
// isRejected (topología): estricto, no cuenta "error:" ni "% Error" de una salida válida.
assert.equal(T.isRejected("sw01#show logging\nerror: link flap on Gi1/0/3\n% Error counters cleared\nsw01#"), false);
assert.equal(T.isRejected("sw01#show lldp neighbors\n                ^\n% Invalid input detected at '^' marker."), true);

// Sin backtracking caro en líneas largas o mal formadas.
const long = "[" + "a".repeat(20000) + " (" + "(x) ".repeat(5000);
fastEnough("promptName en línea larga", 5, () => T.promptName(long));
const big = "x ".repeat(200000);
fastEnough("cliErrorLine en salida grande", 50, () => T.cliErrorLine(big));

console.log("cliText: ok");
