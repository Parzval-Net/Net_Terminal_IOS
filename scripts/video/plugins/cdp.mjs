// Chrome headless controlado por DevTools Protocol: navegación, mouse y teclado reales, cursor
// visible dibujado en la página, cámara (zoom con transform) y grabación por screencast con la
// marca de tiempo de cada cuadro.
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Vista de 1440x810 px CSS con escala 4/3: cuadros de 1920x1080. */
export const VIEW = { width: 1440, height: 810, scale: 4 / 3 };

export async function lanzar(port) {
  const profile = mkdtempSync(join(tmpdir(), "nt-video-"));
  const chrome = spawn(
    CHROME,
    ["--headless=new", "--hide-scrollbars", "--disable-gpu-vsync", "--font-render-hinting=none", `--window-size=${VIEW.width},${VIEW.height}`, `--force-device-scale-factor=${VIEW.scale}`, `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, "about:blank"],
    { stdio: "ignore" },
  );
  let target;
  for (let i = 0; i < 60 && !target; i++) {
    await sleep(200);
    target = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json()).then((l) => l.find((t) => t.type === "page")).catch(() => null);
  }
  if (!target) throw new Error("Chrome no respondió por CDP");
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r, { once: true }));
  let seq = 0;
  const pending = new Map();
  const handlers = new Set();
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      pending.get(m.id)(m);
      pending.delete(m.id);
    } else if (m.method) for (const h of handlers) h(m);
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++seq;
      pending.set(id, (m) => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result)));
      ws.send(JSON.stringify({ id, method, params }));
    });
  handlers.add((m) => {
    if (m.method === "Runtime.exceptionThrown") console.error("  ERROR en página:", m.params.exceptionDetails?.exception?.description?.split("\n")[0]);
    if (m.method === "Runtime.consoleAPICalled" && ["error", "warning"].includes(m.params.type))
      console.error(`  console.${m.params.type}:`, m.params.args?.map((a) => a.value ?? a.description).join(" ").slice(0, 200));
  });
  await send("Page.enable");
  await send("Runtime.enable");
  // Solo el tamaño: la escala va por bandera (con escala emulada, las capturas desplazan el mouse).
  await send("Emulation.setDeviceMetricsOverride", { width: VIEW.width, height: VIEW.height, deviceScaleFactor: 0, mobile: false });
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
  const close = async () => {
    ws.close();
    chrome.kill();
    await sleep(400);
    rmSync(profile, { recursive: true, force: true });
  };
  return { send, on: (h) => handlers.add(h), off: (h) => handlers.delete(h), close };
}

/** Página con utilidades: evaluar, esperar, cursor, clics, escritura y cámara. */
export function pagina(cdp) {
  const { send } = cdp;
  let initScript = null;
  const ev = async (expr, arg) => {
    const expression = arg === undefined ? `(async () => (${expr}))()` : `(async (a) => (${expr}))(${JSON.stringify(arg)})`;
    const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(`evaluate: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}\n${expr.slice(0, 200)}`);
    return r.result.value;
  };
  const p = {
    ev,
    async datos(obj) {
      if (initScript) await send("Page.removeScriptToEvaluateOnNewDocument", { identifier: initScript });
      initScript = (await send("Page.addScriptToEvaluateOnNewDocument", { source: `window.__videoData = ${JSON.stringify(obj)};` })).identifier;
    },
    async ir(url, esperar = "#root > *") {
      await send("Page.navigate", { url });
      for (let i = 0; i < 100; i++) {
        await sleep(100);
        if (await ev(`!!document.querySelector(${JSON.stringify(esperar)}) && document.readyState === "complete"`).catch(() => false)) break;
      }
      await sleep(500);
      await p.instalarCursor();
    },
    /** Espera un selector o texto visible. */
    async esperar(sel, ms = 5000) {
      for (let t = 0; t < ms; t += 100) {
        if (await ev(`!!window.__q(a)`, sel).catch(() => false)) return true;
        await sleep(100);
      }
      throw new Error(`No apareció: ${sel}`);
    },
    async instalarCursor() {
      await ev(`(() => {
        // Busca un elemento por selector CSS o por texto/título visible ("texto:..." / "titulo:...").
        window.__q = (s) => {
          if (typeof s !== "string") return null;
          const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
          if (s.startsWith("titulo:")) { const t = s.slice(7); return [...document.querySelectorAll("[title],[aria-label]")].filter(vis).find((e) => e.title === t || e.title?.startsWith(t) || e.getAttribute("aria-label") === t) ?? null; }
          if (s.startsWith("texto:")) { const t = s.slice(6); const all = [...document.querySelectorAll("button, label, summary, a, span, div, li, h2, h3, option, code, pre, p")].filter(vis); return all.find((e) => e.textContent.trim() === t && e.children.length <= 3) ?? all.find((e) => e.textContent.trim().startsWith(t) && e.children.length <= 3) ?? null; }
          return [...document.querySelectorAll(s)].find(vis) ?? null;
        };
        if (document.getElementById("__cursor")) return;
        const c = document.createElement("div");
        c.id = "__cursor";
        c.innerHTML = '<svg width="26" height="26" viewBox="0 0 24 24"><path d="M4 2 L4 19 L8.5 14.8 L11.6 21.6 L14.6 20.3 L11.6 13.6 L17.8 13.6 Z" fill="#111" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/></svg><span></span>';
        Object.assign(c.style, { position: "fixed", left: "0", top: "0", zIndex: 2147483647, pointerEvents: "none", transform: "translate(720px, 860px)", transition: "transform 0.7s cubic-bezier(.4,.0,.2,1)", filter: "drop-shadow(0 1px 2px rgba(0,0,0,.35))" });
        const ring = c.querySelector("span");
        Object.assign(ring.style, { position: "absolute", left: "-14px", top: "-14px", width: "30px", height: "30px", borderRadius: "50%", border: "3px solid #1d5be0", opacity: "0", transform: "scale(.4)", transition: "all .35s ease-out" });
        // Dentro de body: sigue a la cámara (transform de body). Recibe coordenadas de la vista.
        document.body.appendChild(c);
        window.__cam = window.__cam || { z: 1, tx: 0, ty: 0 };
        window.__cursorAt = (x, y, ms) => { const k = window.__cam; c.style.transition = "transform " + ms + "ms cubic-bezier(.4,.0,.2,1)"; c.style.transform = "translate(" + (x - k.tx) / k.z + "px," + (y - k.ty) / k.z + "px)"; };
        window.__pulse = () => { ring.style.transition = "none"; ring.style.opacity = "1"; ring.style.transform = "scale(.4)"; requestAnimationFrame(() => { ring.style.transition = "all .45s ease-out"; ring.style.opacity = "0"; ring.style.transform = "scale(1.6)"; }); };
        window.__hideCursor = (h) => { c.style.opacity = h ? "0" : "1"; };
      })()`);
    },
    async captura(file) {
      const r = await send("Page.captureScreenshot", { format: "png" });
      writeFileSync(file, Buffer.from(r.data, "base64"));
    },
    async rect(sel, intentos = 30) {
      for (let i = 0; i < intentos; i++) {
        const r = await p.rect1(sel);
        if (r) return r;
        await sleep(100);
      }
      throw new Error(`No encontrado: ${sel}`);
    },
    async rect1(sel) {
      return await ev(`(() => { const e = window.__q(a); if (!e) return null; e.scrollIntoView({ block: "nearest", inline: "nearest" }); const b = e.getBoundingClientRect(); return [b.left, b.top, b.width, b.height]; })()`, sel);
    },
    /** Mueve el cursor visible al centro del elemento (o a [x, y]). */
    async mover(target, ms = 700, dx = 0.5, dy = 0.5) {
      const [x, y] = Array.isArray(target) ? target : await p.rect(target).then(([l, t, w, h]) => [l + w * dx, t + h * dy]);
      await ev(`window.__cursorAt(${x}, ${y}, ${ms})`);
      await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
      await sleep(ms + 60);
      return [x, y];
    },
    async clic(target, { ms = 700, button = "left", dx, dy } = {}) {
      const [x, y] = await p.mover(target, ms, dx, dy);
      await ev(`window.__pulse()`);
      await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button, clickCount: 1 });
      await sleep(70);
      await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button, clickCount: 1 });
      await sleep(250);
    },
    async dobleClic(target, opts = {}) {
      const [x, y] = await p.mover(target, opts.ms ?? 700);
      await ev(`window.__pulse()`);
      for (const clickCount of [1, 2]) {
        await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount });
        await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount });
        await sleep(60);
      }
      await sleep(250);
    },
    /** Escribe con el teclado (texto real en el campo enfocado), carácter por carácter. */
    async escribir(texto, cps = 18) {
      for (const ch of texto) {
        if (ch === "\n") {
          await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" });
          await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
        } else await send("Input.insertText", { text: ch });
        await sleep(1000 / cps);
      }
    },
    async tecla(key, code = key, vk = 0, modifiers = 0) {
      await send("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode: vk, modifiers });
      await send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: vk, modifiers });
    },
    /** Cámara: escala y centra un punto (coordenadas CSS de la vista sin zoom). */
    async camara(z = 1, cx = VIEW.width / 2, cy = VIEW.height / 2, ms = 900, esperar = true) {
      await ev(`(() => {
        const b = document.body;
        const z = ${z}, W = ${VIEW.width}, H = ${VIEW.height};
        let tx = W / 2 - ${cx} * z, ty = H / 2 - ${cy} * z;
        tx = Math.min(0, Math.max(W - W * z, tx)); ty = Math.min(0, Math.max(H - H * z, ty));
        b.style.transformOrigin = "0 0";
        b.style.transition = "transform ${ms}ms cubic-bezier(.4,0,.2,1)";
        if (z === 1) tx = ty = 0;
        b.style.transform = z === 1 ? "" : "translate(" + tx + "px," + ty + "px) scale(" + z + ")";
        window.__cam = { z, tx, ty };
      })()`);
      if (esperar) await sleep(ms);
    },
    /** Zoom sobre un elemento: lo encuadra con margen. */
    async encuadrar(sel, { margen = 40, max = 1.9, ms = 900 } = {}) {
      const k0 = await ev("window.__cam || { z: 1, tx: 0, ty: 0 }");
      const [l, t, w0, h0] = await p.rect(sel);
      const w = w0 / k0.z, h = h0 / k0.z;
      const z = Math.min(max, VIEW.width / (w + margen * 2), VIEW.height / (h + margen * 2));
      // Coordenadas sin zoom: se deshace la cámara actual.
      await p.camara(Math.max(1, z), (l + w0 / 2 - k0.tx) / k0.z, (t + h0 / 2 - k0.ty) / k0.z, ms);
    },
  };
  return p;
}

/**
 * Graba con capturas continuas (1920x1080, escala real del dispositivo; el screencast de
 * headless entrega cuadros en px CSS) hasta que se llama a `parar()`. Devuelve los cuadros con
 * su tiempo relativo al inicio, en segundos (marca tomada a mitad de cada captura).
 */
export async function grabar(cdp, dir) {
  mkdirSync(dir, { recursive: true });
  const frames = [];
  let n = 0;
  let stop = false;
  const t0 = performance.now();
  const loop = (async () => {
    while (!stop) {
      const a = performance.now();
      const r = await cdp.send("Page.captureScreenshot", { format: "jpeg", quality: 93, optimizeForSpeed: true });
      const t = ((a + performance.now()) / 2 - t0) / 1000;
      const file = join(dir, `f${String(n++).padStart(5, "0")}.jpg`);
      writeFileSync(file, Buffer.from(r.data, "base64"));
      frames.push({ file, t: frames.length ? t : 0 });
    }
  })();
  return {
    async parar() {
      stop = true;
      await loop;
      return frames;
    },
  };
}
