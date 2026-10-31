// Exportación de sesiones a XML (esquema SecureCRT): `node scripts/tests/sessionXml.test.mjs`.
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

const { sessionsToXml } = await import("../../src/lib/sessionXml.ts");

const xml = sessionsToXml([
  { id: "1", name: "core<1>", type: "ssh", host: "192.0.2.1", port: 2222, username: "netops", folder: "Sitio & Core/WAN", save_password: true, on_connect: "conf t", created_at: "" },
  { id: "2", name: "core<1>", type: "telnet", host: "192.0.2.2", folder: "Sitio & Core/WAN", created_at: "" },
  { id: "3", name: "consola", type: "serial", serial_port: "COM3", baud_rate: 115200, stop_bits: 2, parity: "even", flow_control: "hardware", created_at: "" },
  { id: "4", name: "Shell local", type: "local", created_at: "" },
]);

assert.match(xml, /^<\?xml version="1.0" encoding="UTF-8"\?>\n<VanDyke version="3.0">/);
assert.match(xml, /<key name="Sitio &amp; Core">\n\s+<key name="WAN">/);
assert.match(xml, /<key name="core&lt;1&gt;">/);
assert.match(xml, /<key name="core&lt;1&gt; \(2\)">/, "nombre repetido numerado");
assert.match(xml, /<dword name="\[SSH2\] Port">2222<\/dword>/);
assert.match(xml, /<dword name="Port">23<\/dword>/);
assert.match(xml, /<string name="Com Port">COM3<\/string>/);
assert.match(xml, /<dword name="Stop Bits">2<\/dword>/);
assert.match(xml, /<dword name="Parity">2<\/dword>/);
assert.match(xml, /<dword name="CTS Flow">1<\/dword>/);
assert.doesNotMatch(xml, /Shell local|conf t|assword/i, "sin locales, comandos ni contraseñas");
assert.equal((xml.match(/<key /g) || []).length, (xml.match(/<\/key>/g) || []).length);

const reserved = sessionsToXml([
  { id: "a", name: "Default", type: "ssh", host: "192.0.2.9" },
  { id: "b", name: "__oculta", type: "ssh", host: "192.0.2.10" },
  { id: "c", name: "Default", type: "ssh", host: "192.0.2.11", folder: "Lab" },
]);
assert.match(reserved, /<key name="Default \(sesión\)">/);
assert.match(reserved, /<key name="_oculta">/);
assert.match(reserved, /<key name="Lab">\n\s+<key name="Default">/, "fuera de la raíz se conserva");

console.log("sessionXml: ok");
