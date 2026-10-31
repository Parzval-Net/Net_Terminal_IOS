// Conexión mínima a Chrome por DevTools Protocol, compartida por los scripts del video.
// Lanza Chrome headless con un perfil temporal o se conecta a uno ya abierto en CDP_PORT.
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
export const CDP_PORT = Number(process.env.CDP_PORT ?? 9361);
export const VITE_PORT = Number(process.env.PORT ?? 1461);
export const BASE = process.env.BASE ?? `http://localhost:${VITE_PORT}/scripts/screenshots/demo.html`;
// Lienzo: 1440x810 CSS con escala 4/3 da 1920x1080 px exactos.
export const VIEW = { width: 1440, height: 810, deviceScaleFactor: 4 / 3 };

// Carpeta de trabajo (audio, cuadros, tomas) y carpeta de salida; `videos/` está en .gitignore.
export const WORK = process.env.WORK ?? "videos/.build";
export const OUT_DIR = process.env.OUT_DIR ?? "videos";
export const FFMPEG = process.env.FFMPEG ?? "/opt/homebrew/bin/ffmpeg";
export const FFPROBE = process.env.FFPROBE ?? "/opt/homebrew/bin/ffprobe";

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Lanza Chrome headless. Devuelve { proc, close() }. */
export function launchChrome() {
  const profile = mkdtempSync(join(tmpdir(), "nt-video-"));
  const proc = spawn(
    CHROME,
    ["--headless=new", "--hide-scrollbars", "--mute-audio", "--disable-webgl", "--window-size=1440,810", `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${profile}`, "about:blank"],
    { stdio: "ignore" },
  );
  return {
    proc,
    async close() {
      proc.kill();
      await sleep(400);
      rmSync(profile, { recursive: true, force: true });
    },
  };
}

/** Se conecta a la primera página de Chrome y devuelve un cliente CDP sencillo. */
export async function connect() {
  let target;
  for (let i = 0; i < 60 && !target; i++) {
    target = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)
      .then((r) => r.json())
      .then((l) => l.find((t) => t.type === "page"))
      .catch(() => null);
    if (!target) await sleep(200);
  }
  if (!target) throw new Error(`Chrome no responde en el puerto ${CDP_PORT}`);
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => {
    ws.addEventListener("open", r, { once: true });
    ws.addEventListener("error", j, { once: true });
  });
  let seq = 0;
  const pending = new Map();
  const handlers = new Map();
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? reject(new Error(`${m.error.message}`)) : resolve(m.result);
    } else if (m.method) for (const h of handlers.get(m.method) ?? []) h(m.params);
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
  const on = (method, fn) => handlers.set(method, [...(handlers.get(method) ?? []), fn]);
  const off = (method) => handlers.delete(method);
  /** Evalúa una expresión (admite await) y devuelve su valor. */
  const evaluate = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(`Error en la página: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    return r.result?.value;
  };
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { ...VIEW, mobile: false });
  return { ws, send, on, off, evaluate, close: () => ws.close() };
}
