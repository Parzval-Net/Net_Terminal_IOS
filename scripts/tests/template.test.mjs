// Pruebas de variables secretas en plantillas: `node scripts/tests/template.test.mjs` (Node 22.15+ con tipos TS).
import assert from "node:assert/strict";

const { isSecretVar } = await import("../../src/lib/templateSecrets.ts");

// Se piden ocultas, no se recuerdan y se enmascaran en la vista previa.
for (const name of [
  "password",
  "enable_password",
  "comunidad",
  "comunidad_ro",
  "enable",
  "enable_secret",
  "tacacs",
  "tacacs_key",
  "radius",
  "radius_server_key",
  "snmp",
  "snmp_ro",
  "key",
  "secret",
  "psk",
  "pin",
  "PIN",
  "sim_pin",
  "pin-2",
  "simPin",
  "community",
  "clave",
  "contraseña",
  "token",
])
  assert.ok(isSecretVar(name), `${name} debe ser secreto`);

// Variables comunes que se siguen recordando.
for (const name of ["vlan", "interfaz", "hostname", "ip", "descripcion", "ping_destino", "spine", "spinner", "mapping", "shipping", "opinion"])
  assert.ok(!isSecretVar(name), `${name} no es secreto`);

console.log("template: ok");
