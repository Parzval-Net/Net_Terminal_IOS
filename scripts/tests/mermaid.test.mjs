// Pruebas de los diagramas Mermaid en notas: `node scripts/tests/mermaid.test.mjs`.
import assert from "node:assert/strict";
import { fastEnough } from "./timing.mjs";

const M = await import("../../src/lib/mermaidBlocks.ts");

const note = `Ventana de cambio 14/10
show ip route
\`\`\`mermaid
flowchart LR
  a --- b
\`\`\`
texto

~~~mermaid
sequenceDiagram
  PC->>FW: SYN
~~~
\`\`\`
no es mermaid
\`\`\`
\`\`\`mermaid
\`\`\``;
const b = M.extractMermaid(note);
assert.deepEqual(b.map((x) => [x.line, x.code.split("\n")[0]]), [[4, "flowchart LR"], [10, "sequenceDiagram"]]);
// La nota entera como diagrama (sin bloques), con comentarios %% al inicio.
assert.equal(M.extractMermaid("%% red sitio\n\ngraph TD\n A-->B")[0].code.startsWith("%% red sitio"), true);
assert.deepEqual(M.extractMermaid("show version\nflowchart está en el texto"), []);
// Bloque sin cerrar: se toma hasta el final.
assert.equal(M.extractMermaid("```mermaid\npie\n \"a\": 1")[0].code, 'pie\n "a": 1');
// Topes.
const many = Array.from({ length: 30 }, () => "```mermaid\ngraph LR\nA-->B\n```").join("\n");
assert.equal(M.extractMermaid(many).length, M.MAX_DIAGRAMS);
assert.equal(M.extractMermaid("```mermaid\ngraph LR\n" + "A-->B\n".repeat(10000) + "```")[0].code.length, M.MAX_DIAGRAM_CHARS);
// La plantilla es un bloque válido.
assert.equal(M.extractMermaid(M.NETWORK_TEMPLATE).length, 1);
fastEnough("extraer diagramas de una nota de 20.000 líneas", 20, () => M.extractMermaid("show run\n".repeat(20000) + note));

console.log("mermaid: ok");
