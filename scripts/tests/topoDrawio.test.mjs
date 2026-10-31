// Pruebas de la exportación a draw.io con íconos de red: `node scripts/tests/topoDrawio.test.mjs`.
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { fastEnough } from "./timing.mjs";

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
const D = await import("../../src/lib/topoDrawio.ts");

const topo = {
  nodes: [
    { id: "core", name: "core-sw01", ip: "192.0.2.1", platform: "cisco C9500-24Y4C", explored: true, x: 400, y: 80, ports: { "gi1/0/1": { duplex: "full" } } },
    { id: "acc", name: "sw-<acceso>&1", ip: "192.0.2.21", platform: "cisco C9200L-24P-4G", explored: true, x: 200, y: 260, ports: { "gi1/0/24": { duplex: "half" }, "gi1/0/5": { status: "connected" } } },
    { id: "fw", name: "fw-perimetro", platform: "FortiGate-200F", explored: false, x: 600, y: 260 },
    { id: "rt", name: "rt-borde", platform: "cisco ISR4331/K9", explored: false, x: 800, y: 260 },
    { id: "ap", name: "ap-piso2", platform: "cisco AIR-AP2802I-A-K9", explored: false, x: 200, y: 420 },
    { id: "x", name: "desconocido", explored: false, x: 400, y: 420, manual: true },
  ],
  links: [
    { a: "core", aPort: "Gi1/0/1", b: "acc", bPort: "Gi1/0/24", proto: "CDP" },
    { a: "core", aPort: "Gi1/0/10", b: "fw", bPort: "port1", proto: "LLDP" },
    { a: "core", aPort: "", b: "rt", bPort: "", proto: "OSPF" },
  ],
};

// Ícono por rol: núcleo L3, acceso, firewall, router, AP; sin rol, recuadro.
assert.equal(D.iconFor(topo.nodes[0]).shape, "mxgraph.cisco.switches.layer_3_switch");
assert.equal(D.iconFor(topo.nodes[1]).shape, "mxgraph.cisco.switches.workgroup_switch");
assert.equal(D.iconFor(topo.nodes[2]).shape, "mxgraph.cisco.security.firewall");
assert.equal(D.iconFor(topo.nodes[3]).shape, "mxgraph.cisco.routers.router");
assert.equal(D.iconFor(topo.nodes[4]).shape, "mxgraph.cisco.misc.access_point");
assert.equal(D.iconFor(topo.nodes[5]), null);

const xml = D.toDrawioIcons(topo, { zones: new Map([["core", "Sitio Central"], ["acc", "Sitio Central"]]), notes: new Map([["rt", "Fin de soporte SW"]]), l2: true });
// XML bien formado en lo que importa: cada celda cerrada, sin "<" ni comillas sin escapar en atributos.
const cells = xml.match(/<mxCell\b[^>]*>/g);
assert.equal(xml.match(/<mxCell\b/g).length, xml.match(/<\/mxCell>|<mxCell\b[^>]*\/>/g).length);
for (const c of cells) for (const [, v] of c.matchAll(/="([^"]*)"/g)) assert.ok(!v.includes("<"), `atributo sin escapar: ${v}`);
// El nombre con < & > llega como texto (doble escape: HTML dentro de XML).
assert.match(xml, /&lt;b&gt;sw-&amp;lt;acceso&amp;gt;&amp;amp;1&lt;\/b&gt;/);
// Zona, nota de ciclo de vida, revisión (dúplex crítico en rojo) y nube L2.
assert.match(xml, /value="Sitio Central"/);
assert.match(xml, /Fin de soporte SW/);
assert.match(xml, /value="! Dúplex" style="[^"]*strokeColor=#cf222e/);
assert.match(xml, /mxgraph\.cisco\.storage\.cloud/);
assert.match(xml, /value="OSPF"/);
// Sin opciones: sin zonas ni nube.
const plain = D.toDrawioIcons(topo);
assert.ok(!plain.includes('id="z0"') && !plain.includes("storage.cloud"));

const big = { nodes: [], links: [] };
for (let i = 0; i < 2000; i++) {
  big.nodes.push({ id: `n${i}`, name: `n${i}`, ip: `10.0.${i >> 8}.${i & 255}`, platform: "cisco C9300-48P", explored: true, x: i, y: i });
  if (i) big.links.push({ a: `n${i - 1}`, aPort: "Gi1/0/1", b: `n${i}`, bPort: "Gi1/0/2", proto: "CDP" });
}
fastEnough("draw.io con íconos, 2000 equipos", 150, () => D.toDrawioIcons(big, { l2: true }));

console.log("topoDrawio: ok");
