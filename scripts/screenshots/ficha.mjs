// Captura de página completa de la ficha (docs/index.html) para generar el PDF.
// Uso: `node scripts/screenshots/ficha.mjs <url> <salida.png>`; luego PNG → JPEG → PDF con `sips` (macOS).
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [url, out] = process.argv.slice(2);
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = mkdtempSync(join(tmpdir(), "nt-ficha-"));
const port = Number(process.env.CDP_PORT ?? 9352);
const chrome = spawn(
  CHROME,
  ["--headless=new", "--hide-scrollbars", "--window-size=1440,900", "--force-device-scale-factor=2", "--allow-file-access-from-files", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "about:blank"],
  { stdio: "ignore" },
);
try {
  let t;
  for (let i = 0; i < 50 && !t; i++) {
    await sleep(200);
    t = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json()).then((l) => l.find((x) => x.type === "page")).catch(() => null);
  }
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  let seq = 0;
  const pend = new Map();
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) {
      pend.get(m.id)(m);
      pend.delete(m.id);
    }
  });
  const send = (method, params = {}) => new Promise((r) => { const id = ++seq; pend.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
  await send("Page.enable");
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
  await send("Page.navigate", { url });
  await sleep(2500);
  // Fuerza la carga de imágenes diferidas.
  await send("Runtime.evaluate", { expression: "document.documentElement.classList.add('ficha'); document.querySelectorAll('img[loading=lazy]').forEach(i=>i.loading='eager'); window.scrollTo(0, document.body.scrollHeight);" });
  await sleep(2500);
  await send("Runtime.evaluate", { expression: "window.scrollTo(0,0)" });
  const { result: m } = await send("Page.getLayoutMetrics");
  // Alto real del documento (el carrusel en modo ficha cambia el layout; cssContentSize puede quedar desfasado).
  const { result: dh } = await send("Runtime.evaluate", { expression: "Math.ceil(document.documentElement.getBoundingClientRect().height)", returnByValue: true });
  const h = Math.min(Math.ceil(m.cssContentSize.height), dh.result.value || Infinity);
  // Chrome no captura más de ~16.000 px de alto real: con páginas largas baja la escala.
  const dpr = Math.min(2, Math.floor((16000 / h) * 100) / 100);
  await send("Emulation.setDeviceMetricsOverride", { width: 1440, height: h, deviceScaleFactor: dpr, mobile: false });
  await sleep(1000);
  const { result } = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width: 1440, height: h, scale: 1 } });
  writeFileSync(out, Buffer.from(result.data, "base64"));
  console.log("ok", h);
  ws.close();
} finally {
  chrome.kill();
  await sleep(500);
  rmSync(profile, { recursive: true, force: true });
}
