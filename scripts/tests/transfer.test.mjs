// Transferencias: MD5 automático tras SCP/SFTP (scpVerify.ts) y comandos syslog por fabricante
// (devicefs.ts). Uso: node scripts/tests/transfer.test.mjs (Node 22.15+ con tipos TS).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const V = await import("../../src/lib/scpVerify.ts");
const D = await import("../../src/lib/devicefs.ts");

// ---------- Fin de la pestaña SCP/SFTP ----------

// Los motivos que interpreta el gestor son los que escribe connection.rs al terminar el proceso.
const rust = readFileSync(new URL("../../src-tauri/src/connection.rs", import.meta.url), "utf8");
assert.ok(rust.includes('"Sesión finalizada"'), "motivo de salida 0 en connection.rs");
assert.ok(rust.includes('"Proceso terminado (código {})"'), "motivo con código en connection.rs");
assert.equal(V.scpExitCode("Sesión finalizada"), 0);
assert.equal(V.scpExitCode("Proceso terminado (código 1)"), 1);
assert.equal(V.scpExitCode("Proceso terminado (código -1)"), -1);
assert.equal(V.scpExitCode("Proceso terminado: Broken pipe"), null);
assert.equal(V.scpExitCode(null), null);

const job = { upload: true, mode: "scp", files: ["fw.bin", "boot.bin"], verify: true, canVerify: true };
const exit = (reason, closed = false) => ({ transfer: "scp-1", reason, closed });
// Código 0 en una subida con "Verificar MD5": se verifican todos los archivos.
assert.deepEqual(V.scpOutcome(job, exit("Sesión finalizada")), { action: "verify", files: ["fw.bin", "boot.bin"], text: "SCP terminó bien: verificando MD5" });
// Código distinto de 0: se avisa y no se verifica.
assert.deepEqual(V.scpOutcome(job, exit("Proceso terminado (código 1)")), { action: "failed", text: "SCP terminó con código 1: no se verifica el MD5" });
assert.equal(V.scpOutcome({ ...job, mode: "sftp" }, exit("Proceso terminado: x")).text, "SFTP terminó con error: no se verifica el MD5");
// Pestaña cerrada antes de terminar.
assert.equal(V.scpOutcome(job, exit(null, true)).action, "failed");
// Bajadas, sin la casilla o sin comando MD5 en la plataforma: termina sin verificar.
for (const j of [{ ...job, upload: false }, { ...job, verify: false }, { ...job, canVerify: false }, { ...job, files: [] }])
  assert.deepEqual(V.scpOutcome(j, exit("Sesión finalizada")), { action: "done", text: "SCP terminó bien" });
// SFTP interactivo: no hay un fin claro, solo el aviso para verificar a mano.
for (const e of [exit("Sesión finalizada"), exit("Proceso terminado (código 1)"), exit(null, true)])
  assert.equal(V.scpOutcome({ ...job, mode: "shell" }, e).action, "manual");

// Sesión del equipo tomada por un script: se reintenta cada 5 s hasta 2 minutos, sin escribir en ella.
const busy = readFileSync(new URL("../../src-tauri/src/scripts.rs", import.meta.url), "utf8").match(/pub const BUSY: &str = "([^"]+)"/)[1];
assert.ok(V.isBusyError(busy) && V.isBusyError(new Error(busy)));
assert.ok(!V.isBusyError("Sesión no conectada"));
assert.equal(V.busyRetry(0), 5000);
assert.equal(V.busyRetry(V.BUSY_RETRIES - 1), 5000);
assert.equal(V.busyRetry(V.BUSY_RETRIES), null);
assert.equal((V.BUSY_RETRIES * V.BUSY_RETRY_MS) / 1000, 120);

// ---------- Syslog: comandos por fabricante ----------

assert.deepEqual(D.loghostCommands("192.0.2.10", 514), {
  cisco: "logging host 192.0.2.10",
  huawei: "info-center loghost 192.0.2.10",
  huaweiPortNote: false,
});
// Puerto distinto de 514: Huawei "port N" (CloudEngine V300R026C00, S5700/S6700 V200R024C10) con aviso.
assert.deepEqual(D.loghostCommands("192.0.2.10", 1514), {
  cisco: "logging host 192.0.2.10 transport udp port 1514",
  huawei: "info-center loghost 192.0.2.10 port 1514",
  huaweiPortNote: true,
});
const ui = readFileSync(new URL("../../src/components/tools/SyslogTool.tsx", import.meta.url), "utf8");
assert.match(ui, /verificar en tu\s+versión/, "la interfaz pide verificar el parámetro port en la versión del equipo");

console.log("transfer: ok");
