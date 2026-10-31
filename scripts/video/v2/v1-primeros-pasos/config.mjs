// Configuración del video 1: puertos propios (vite 1481, Chrome CDP 9481) para no chocar con los
// otros videos, carpeta de trabajo y salida. Se fija antes de importar ../../cdp.mjs.
import { join } from "node:path";
import { fileURLToPath } from "node:url";

process.env.PORT ??= "1481";
process.env.CDP_PORT ??= "9481";
process.env.BASE ??= `http://localhost:${process.env.PORT}/scripts/video/v2/v1-primeros-pasos/demo-v1.html`;
process.env.NT_VOICE ??= "ef_dora";
process.env.NT_TTS ??= "kokoro";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
export const WORK = process.env.WORK ?? join(REPO, "videos", ".build-v1");
export const OUT_DIR = process.env.OUT_DIR ?? join(REPO, "videos");
export const NAME = "NetTerminal-v1-primeros-pasos";
