// Pruebas del plan de importación: `node scripts/tests/import.test.mjs` (Node 22.15+ con tipos TS).
// Cubre la reimportación de un archivo más nuevo: misma carpeta y nombre actualiza la sesión
// existente y conserva su configuración local; las idénticas se omiten.
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
const { planImport, mergeImported } = await import("../../src/lib/importMerge.ts");

const base = { id: "a1", name: "core-r1", type: "ssh", folder: "Importado/SecureCRT/WAN", host: "192.0.2.1", port: 22, username: "noc", created_at: "x" };
const existing = [
  { ...base, save_password: true, on_connect: "terminal length 0", platform: "iosxe", highlight: "cisco" },
  { id: "a2", name: "sw-tel", type: "telnet", folder: "Otra", host: "192.0.2.2", port: 23, created_at: "x" },
];

// Reimportación: cambia el host de core-r1, sw-tel igual en otra carpeta, una nueva y una repetida.
const list = [
  { ...base, id: "", name: "Core-R1", host: "192.0.2.10", created_at: "" },
  { id: "", name: "sw-tel", type: "telnet", folder: "Importado/SecureCRT", host: "192.0.2.2", port: 23, created_at: "" },
  { id: "", name: "nuevo", type: "ssh", folder: "Importado/SecureCRT", host: "192.0.2.3", created_at: "" },
  { id: "", name: "nuevo", type: "ssh", folder: "Importado/SecureCRT", host: "192.0.2.4", created_at: "" },
];
const plan = planImport(existing, list);
assert.deepEqual(plan.map((p) => p.status), ["update", "same", "new", "same"]);
assert.deepEqual(plan[0].changes, ["host"]);

assert.equal(plan[0].retarget, true);
assert.equal(plan[0].drops, true);

// Cambio de destino: la contraseña guardada, los túneles y los comandos al conectar no siguen al host nuevo.
const merged = mergeImported(plan[0].existing, list[0]);
assert.equal(merged.id, "a1");
assert.equal(merged.name, "core-r1");
assert.equal(merged.host, "192.0.2.10");
assert.equal(merged.save_password, undefined);
assert.equal(merged.on_connect, undefined);
assert.equal(merged.highlight, "cisco");
assert.equal(merged.platform, undefined, "cambió el host: la plataforma se vuelve a detectar");

// Un campo vacío en el archivo no borra el valor local, y legacy_ssh es configuración local.
const local = { ...existing[0], legacy_ssh: true, identity_file: "~/.ssh/id_ed25519" };
const m2 = mergeImported(local, { ...base, username: "", identity_file: undefined });
assert.equal(m2.username, "noc");
assert.equal(m2.identity_file, "~/.ssh/id_ed25519");
assert.equal(m2.legacy_ssh, true);
assert.equal(m2.save_password, true);
assert.equal(m2.platform, "iosxe");
assert.deepEqual(planImport([local], [{ ...base, id: "", username: "" }]).map((p) => p.status), ["same"]);

// Cambio que no es de destino (llave nueva): se actualiza y conserva la contraseña.
const p3 = planImport([local], [{ ...base, id: "", identity_file: "~/.ssh/otra" }])[0];
assert.equal(p3.status, "update");
assert.equal(p3.retarget, false);
assert.equal(mergeImported(local, { ...base, identity_file: "~/.ssh/otra" }).save_password, true);
console.log("import OK");
