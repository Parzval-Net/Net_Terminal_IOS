// Vite para grabar el video 3: la misma configuración de la app, con la raíz del repositorio,
// puerto 1483 y una caché de dependencias propia (no se mezcla con otras grabaciones en curso).
// Uso: node node_modules/vite/bin/vite.js --config scripts/video/v2/v3-automatizacion/vite.config.mjs
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const root = fileURLToPath(new URL("../../../../", import.meta.url));

export default {
  root,
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  cacheDir: process.env.VITE_CACHE ?? join(tmpdir(), "nt-video-v3-vite"),
  server: { port: Number(process.env.PORT ?? 1483), strictPort: true, watch: { ignored: ["**/src-tauri/**", "**/videos/**"] } },
};
