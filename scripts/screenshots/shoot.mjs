// Genera las capturas del README con datos ficticios, controlando Chrome por DevTools Protocol.
// Uso: `npx vite --port 1430` en otra terminal y luego `node scripts/screenshots/shoot.mjs`.
// Variables opcionales: PORT (puerto de vite), OUT (carpeta de salida), CHROME (binario).
// Cada captura: [archivo, escena, tema, { query?, hover?, type?, keys?, wait?, motion? }]; `hover` es un selector CSS
// sobre el que se deja el mouse antes de capturar (estados hover, p. ej. la X de una pestaña);
// `type` se escribe tecla por tecla en la terminal y `keys` son teclas especiales ("ctrl+period").
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const BASE = process.env.BASE ?? `http://localhost:${process.env.PORT ?? 1430}/scripts/screenshots/demo.html`;
const OUT = process.env.OUT ?? fileURLToPath(new URL("../../docs/screenshots/", import.meta.url));
const SHOTS = [
  // Todas en modo claro para que sean uniformes; el modo oscuro y los temas van aparte.
  ["terminal", "terminal", "light"],
  ["notas", "notes", "light"],
  ["monitoreo", "monitor", "light"],
  ["topologia", "topology", "light"],
  ["topologia-cambios", "compare", "light"],
  ["topologia-fuentes", "topology-mac", "light", { query: "&topoOpen=fuentes,sugerencias" }],
  // La tasa necesita dos lecturas de contadores (intervalo mínimo 15 s): se espera más.
  ["topologia-trafico", "topology-traffic", "light", { query: "&topoPanel=0&topoOpen=leyenda", wait: 19000, motion: true }],
  ["comandos-so", "oscmds", "light"],
  ["subredes", "subnet", "light"],
  ["velocidad", "speed", "light"],
  ["ajustes", "settings", "light"],
  ["packs", "packs", "light"],
  ["acerca", "about", "light"],
  ["vista-dividida", "split", "light"],
  ["respaldos", "backup", "light"],
  ["difusion", "broadcast", "light"],
  ["alertas", "alerts", "light"],
  ["importar", "import", "light"],
  ["pestanas-verticales", "vertical", "light"],
  ["credenciales", "credentials", "light"],
  ["notas-protegidas", "secure-note", "light"],
  ["snmp", "snmp", "light"],
  ["transferencias", "transfer", "light"],
  ["snmp-generador", "snmpgen", "light"],
  ["modo-oscuro", "terminal", "dark"],
  ["pestanas-verticales-oscuro", "vertical", "dark"],
  ["modo-oscuro-dividida", "split", "dark"],
  ["conexion-rapida", "quick", "light"],
  ["conexion-rapida-serial", "quickserial", "dark"],
  ["conexion-rapida-pestana", "quicktab", "light"],
  ["conexion-rapida-pestana-oscuro", "quicktab", "dark"],
  ["ajustes-oscuro", "settings", "dark"],
  ["ajustes-logs", "logs", "light", { query: "&logsdir=1" }],
  ["acerca-oscuro", "about", "dark"],
  ["tema-ambar", "settings", "dark", { query: "&term=amber" }],
  ["tema-ambar-terminal", "terminal", "dark", { query: "&term=amber" }],
  ["pestanas-x-oscuro", "terminal", "dark", { hover: '[title^="core-sw01"]' }],
  ["pestanas-x-oscuro-tema-claro", "terminal", "dark", { query: "&term=nt-light", hover: '[title^="core-sw01"]' }],
  ["pestanas-verticales-x-oscuro", "vertical", "dark", { hover: '[role="tab"][data-id="t3"]' }],
  // Sugerencia en color con la ayuda «Tab o → acepta · Esc descarta» (primeras líneas por plataforma).
  ["sugerencias-comandos", "suggest", "light", { query: "&video=1", type: "sh ip int b" }],
  ["sugerencias-lista", "suggest", "light", { query: "&video=1", type: "sh ip int", keys: ["ctrl+period"] }],
  // Modo configuración de interfaz: `sh` sería `shutdown`, así que no hay texto gris; la tecla de
  // lista explica cómo pedir sugerencias, y con `do ` vuelven.
  ["sugerencias-config", "suggest-config", "light", { query: "&video=1", type: "sh", keys: ["ctrl+period"] }],
  ["sugerencias-config-do", "suggest-config", "dark", { query: "&video=1&term=solarized-dark", type: "do sh ip int b" }],
];
/** Teclas especiales para `keys`: [key, code, keyCode, modificadores CDP (2 = Ctrl)]. */
const KEYS = { "ctrl+space": [" ", "Space", 32, 2], "ctrl+period": [".", "Period", 190, 2], right: ["ArrowRight", "ArrowRight", 39, 0], down: ["ArrowDown", "ArrowDown", 40, 0], tab: ["Tab", "Tab", 9, 0], esc: ["Escape", "Escape", 27, 0] };
const only = process.argv.slice(2);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const profile = mkdtempSync(join(tmpdir(), "nt-shots-"));
// Puerto de DevTools propio por ejecución: dos scripts a la vez no se pisan la misma pestaña.
const port = Number(process.env.CDP_PORT ?? 9333);
const chrome = spawn(CHROME, ["--headless=new", "--hide-scrollbars", "--window-size=1440,880", "--force-device-scale-factor=2", `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });

try {
  let target;
  for (let i = 0; i < 50 && !target; i++) {
    await sleep(200);
    target = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json()).then((l) => l.find((t) => t.type === "page")).catch(() => null);
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  let seq = 0;
  const pending = new Map();
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) pending.get(m.id)(m), pending.delete(m.id);
  });
  const send = (method, params = {}) => new Promise((r) => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });

  await send("Page.enable");
  // Sin foco real la terminal no recibe teclas en headless.
  await send("Emulation.setFocusEmulationEnabled", { enabled: true });
  await send("Runtime.enable");
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data);
    if (m.method === "Runtime.exceptionThrown") console.error("ERROR en página:", m.params.exceptionDetails?.exception?.description?.split("\n")[0]);
    if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") console.error("console.error:", m.params.args?.map((a) => a.value ?? a.description).join(" ").slice(0, 200));
  });
  mkdirSync(OUT, { recursive: true });
  for (const [name, scene, theme, extra = {}] of SHOTS) {
    if (only.length && !only.includes(name)) continue;
    // `motion`: sin "reducir movimiento" (Chrome headless lo informa activo), para ver animaciones.
    const motion = extra.motion ? [{ name: "prefers-reduced-motion", value: "no-preference" }] : [];
    await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: theme }, ...motion] });
    await send("Page.navigate", { url: `${BASE}?scene=${scene}&theme=${theme}${extra.query ?? ""}` });
    await sleep(extra.wait ?? 5000);
    if (extra.hover) {
      const { result: r } = await send("Runtime.evaluate", {
        expression: `(() => { const e = document.querySelector(${JSON.stringify(extra.hover)}); if (!e) return null; const b = e.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; })()`,
        returnByValue: true,
      });
      const at = r.result?.value;
      if (at) await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: at[0], y: at[1] });
      else console.warn(`${name}: no se encontró ${extra.hover}`);
      await sleep(400);
    }
    for (const ch of extra.type ?? "") {
      await send("Input.dispatchKeyEvent", { type: "keyDown", key: ch, text: ch, unmodifiedText: ch });
      await send("Input.dispatchKeyEvent", { type: "keyUp", key: ch });
      await sleep(80);
    }
    for (const k of extra.keys ?? []) {
      const [key, code, vk, modifiers] = KEYS[k];
      await send("Input.dispatchKeyEvent", { type: "rawKeyDown", key, code, windowsVirtualKeyCode: vk, modifiers });
      await send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: vk, modifiers });
      await sleep(150);
    }
    if (extra.type || extra.keys) await sleep(600);
    const { result } = await send("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(OUT, `${name}.png`), Buffer.from(result.data, "base64"));
    console.log(`${name}.png`);
  }
  ws.close();
} finally {
  chrome.kill();
  await sleep(500);
  rmSync(profile, { recursive: true, force: true });
}
