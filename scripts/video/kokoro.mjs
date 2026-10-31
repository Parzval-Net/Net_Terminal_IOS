// Motor de voz compartido por los pipelines de video (tts.mjs y plugins/narracion.mjs).
// NT_TTS=kokoro|say (por defecto kokoro), NT_VOICE (por defecto ef_dora), NT_SPEED (por defecto 1.0),
// KOKORO_PY (por defecto ~/.venvs/kokoro/bin/python). Si Kokoro no está disponible o falla,
// se vuelve a `say` y se avisa por consola.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = fileURLToPath(new URL(".", import.meta.url));
export const MOTOR = (process.env.NT_TTS ?? "kokoro").toLowerCase();
export const VOZ_KOKORO = process.env.NT_VOICE ?? "ef_dora";
export const VELOCIDAD = process.env.NT_SPEED ?? "1.0";
export const PYTHON = process.env.KOKORO_PY ?? join(homedir(), ".venvs", "kokoro", "bin", "python");
const SCRIPT = join(DIR, "tts_kokoro.py");
const LEXICO = join(DIR, "pronunciacion.json");

/** true si se debe usar Kokoro (pedido y con el entorno instalado). */
export function usarKokoro() {
  if (MOTOR === "say") return false;
  if (MOTOR !== "kokoro") throw new Error(`NT_TTS debe ser kokoro o say, no ${MOTOR}`);
  if (!existsSync(PYTHON)) {
    console.warn(`⚠ Kokoro no disponible (${PYTHON} no existe): se usa say. Ver scripts/video/README.md`);
    return false;
  }
  return true;
}

/** Huella de la configuración: si cambia el léxico, la voz o la velocidad, se regeneran los clips. */
export function huellaKokoro() {
  const h = createHash("sha1");
  h.update(readFileSync(LEXICO));
  h.update(readFileSync(SCRIPT));
  return `kokoro|${VOZ_KOKORO}|${VELOCIDAD}|${h.digest("hex").slice(0, 12)}`;
}

/**
 * Genera varios clips con un solo arranque del modelo.
 * trabajos: [{ texto, salida, tiempos? }]. sr: frecuencia del WAV de salida.
 * Devuelve true si todo salió bien; false si hubo que volver a `say`.
 */
export function generarKokoro(trabajos, { sr = 48000, inicio = 0.05, cola = 0.1, lote } = {}) {
  if (!trabajos.length) return true;
  const archivo = lote ?? join(dirname(trabajos[0].salida), "lote-kokoro.json");
  mkdirSync(dirname(archivo), { recursive: true });
  writeFileSync(archivo, JSON.stringify(trabajos, null, 1));
  try {
    // -I aísla el intérprete; cwd en la carpeta de scripts, que solo contiene código propio.
    execFileSync(PYTHON, ["-I", SCRIPT, "--lote", archivo, "-v", VOZ_KOKORO, "-s", VELOCIDAD, "--sr", String(sr), "--inicio", String(inicio), "--cola", String(cola)], {
      cwd: DIR,
      stdio: ["ignore", "inherit", "pipe"],
      maxBuffer: 1 << 26,
    });
    return true;
  } catch (e) {
    const err = String(e.stderr ?? e.message).split("\n").filter((l) => !/Warning|warn|W\d{4}/.test(l)).slice(-5).join("\n");
    console.warn(`⚠ Kokoro falló, se usa say para estos clips:\n${err}`);
    return false;
  }
}
