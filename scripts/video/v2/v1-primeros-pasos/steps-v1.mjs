// Pasos de las tomas del video 1 (vocabulario de scripts/video/storyboard.mjs más las extensiones del
// storyboard: drag, co, tip, label, chips, keys, side, title, lam, reveal, clear). Los usa record-v1.mjs
// y sirven para probar una escena a mano.
import { sleep } from "../../cdp.mjs";

/** Crea los pasos sobre un cliente CDP. Devuelve { steps, runSteps, setFast, missing }. */
export function makeSteps(c) {
  let fast = false; // en la preparación (no grabada) el cursor no se anima
  const rectOf = async (spec, timeout = 3500) => {
    if (spec && typeof spec === "object") return spec;
    const t = Date.now();
    do {
      const r = await c.evaluate(`window.__v?.rectOf(${JSON.stringify(spec)})`);
      if (r) return r;
      await sleep(120);
    } while (Date.now() - t < timeout);
    console.warn(`  no encontrado: ${spec}`);
    missing.push(spec);
    return null;
  };
  const missing = [];
  const pointOf = (r, at = [0.5, 0.5]) => [Math.round(r.x + r.w * at[0]), Math.round(r.y + r.h * at[1])];
  async function moveTo(x, y, msOverride) {
    const [cx, cy] = await c.evaluate("window.__v.cursor");
    const ms = fast ? 0 : (msOverride ?? Math.round(Math.min(900, Math.max(360, 250 + Math.hypot(x - cx, y - cy) * 0.5))));
    await c.evaluate(`window.__v.cursorTo(${x}, ${y}, ${ms})`);
    await sleep(ms);
    await c.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  }
  async function mouse(x, y, button = "left", count = 1) {
    if (!fast) await c.evaluate(`window.__v.ripple(${x}, ${y})`);
    for (let n = 1; n <= count; n++) {
      await c.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button, clickCount: n });
      await c.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button, clickCount: n });
    }
  }
  // REC+3: flechas izquierda/derecha y punto (Ctrl+. abre la lista de sugerencias).
  const KEYS = {
    Enter: [13, "Enter", "\r"],
    Escape: [27, "Escape"],
    Tab: [9, "Tab"],
    Backspace: [8, "Backspace"],
    ArrowDown: [40, "ArrowDown"],
    ArrowUp: [38, "ArrowUp"],
    ArrowRight: [39, "ArrowRight"],
    ArrowLeft: [37, "ArrowLeft"],
    Delete: [46, "Delete"],
  };
  async function key(combo) {
    const parts = combo.length > 1 && combo.endsWith("+.") ? [...combo.slice(0, -2).split("+"), "."] : combo.split("+");
    const k = parts.pop();
    const mods = parts.reduce((m, p) => m | { alt: 1, ctrl: 2, cmd: 4, meta: 4, shift: 8 }[p], 0);
    let ev;
    if (KEYS[k]) ev = { key: KEYS[k][1], code: KEYS[k][1], windowsVirtualKeyCode: KEYS[k][0], text: mods & 6 ? undefined : KEYS[k][2] };
    else if (k === ",") ev = { key: ",", code: "Comma", windowsVirtualKeyCode: 188 };
    else if (k === ".") ev = { key: ".", code: "Period", windowsVirtualKeyCode: 190, text: mods & 6 ? undefined : "." };
    else if (k === "/") ev = { key: "/", code: "Slash", windowsVirtualKeyCode: 191, text: mods & 6 ? undefined : "/" };
    else {
      const shifted = mods & 8 && /[a-z]/i.test(k);
      ev = { key: shifted ? k.toUpperCase() : k.toLowerCase(), code: /\d/.test(k) ? `Digit${k}` : `Key${k.toUpperCase()}`, windowsVirtualKeyCode: k.toUpperCase().charCodeAt(0), text: mods & 6 ? undefined : k };
    }
    await c.send("Input.dispatchKeyEvent", { type: ev.text ? "keyDown" : "rawKeyDown", modifiers: mods, ...ev });
    await c.send("Input.dispatchKeyEvent", { type: "keyUp", modifiers: mods, ...ev, text: undefined });
  }
  async function type(text, delay = 60) {
    for (const ch of text) {
      if (ch === "\n") await key("Enter");
      else if (ch === "\t") await key("Tab");
      else {
        await c.send("Input.dispatchKeyEvent", { type: "keyDown", text: ch, key: ch, unmodifiedText: ch });
        await c.send("Input.dispatchKeyEvent", { type: "keyUp", key: ch });
      }
      if (!fast) await sleep(delay + Math.random() * delay * 0.5);
    }
  }
  const v1 = (expr) => c.evaluate(`window.__v1.${expr}`);
  const J = JSON.stringify;
  const steps = {
    async click(spec, o = {}) {
      const r = await rectOf(spec, o.timeout);
      if (!r) return;
      const [x, y] = pointOf(r, o.at);
      await moveTo(x, y);
      await sleep(fast ? 0 : 90);
      await mouse(x, y, o.right ? "right" : "left", o.dbl ? 2 : 1);
      await sleep(fast ? 120 : 260);
    },
    dbl: (spec, o = {}) => steps.click(spec, { ...o, dbl: true }),
    right: (spec, o = {}) => steps.click(spec, { ...o, right: true }),
    async hover(spec, o = {}) {
      const r = await rectOf(spec);
      if (r) await moveTo(...pointOf(r, o.at));
    },
    move: (x, y) => moveTo(x, y),
    type: (text, delay) => type(text, delay),
    async field(spec, text, o = {}) {
      await steps.set(spec, "");
      await steps.click(spec, o);
      await type(text, o.delay);
    },
    key: async (combo, n = 1) => {
      for (let i = 0; i < n; i++) {
        await key(combo);
        if (n > 1 && !fast) await sleep(90);
      }
    },
    async hl(spec, pad = 6) {
      const r = spec ? await rectOf(spec) : null;
      await c.evaluate(`window.__v.hl(${J(r)}, ${pad})`);
    },
    async zoom(spec, s = 1.5) {
      const r = await rectOf(spec);
      await c.evaluate(`window.__v.hl(null); window.__v1.clearCallouts(); window.__v.zoom(${J(r)}, ${s}, ${fast ? 0 : 900})`);
      await sleep(fast ? 50 : 950);
    },
    async unzoom() {
      await c.evaluate(`window.__v.hl(null); window.__v1.clearCallouts(); window.__v.zoom(null, 1, ${fast ? 0 : 800})`);
      await sleep(fast ? 50 : 850);
    },
    wait: (ms) => sleep(fast ? 0 : ms),
    js: (code) => c.evaluate(`(async () => { ${code} })()`),
    async set(spec, value) {
      await c.evaluate(`(() => { const el = window.__v.find(${J(spec)}); if (!el) return console.warn("set: no encontrado"); const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, "value").set.call(el, ${J(value)}); el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true })); })()`);
      await sleep(fast ? 50 : 250);
    },
    async scrollto(spec, block = "center") {
      if (!(await c.evaluate(`window.__v.scrollTo(${J(spec)}, ${J(block)})`))) console.warn(`  no encontrado: ${spec}`);
      await sleep(fast ? 100 : 650);
    },
    cursor: (on) => c.evaluate(`window.__v.cursorShow(${on})`),
    // REC+2: arrastrar y soltar con eventos HTML5 (DataTransfer) y el cursor moviéndose entre ambos.
    async drag(from, to, mime = "application/x-nt-session") {
      const a = await rectOf(from);
      const b = await rectOf(to);
      if (!a || !b) return;
      const [ax, ay] = pointOf(a, [0.3, 0.5]);
      const [bx, by] = pointOf(b, [0.3, 0.5]);
      await moveTo(ax, ay);
      await sleep(fast ? 0 : 200);
      await c.evaluate(`window.__v.ripple(${ax}, ${ay})`);
      await c.evaluate(`(() => {
        const src = window.__v.find(${J(from)}).closest("[draggable=true]");
        const dt = new DataTransfer();
        window.__ntDrag = { src, dt };
        src.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: dt, clientX: ${ax}, clientY: ${ay} }));
      })()`);
      const tgtJs = `document.elementFromPoint(${bx}, ${by})`;
      await moveTo(bx, by, fast ? 0 : 900);
      await c.evaluate(`(() => { const { dt } = window.__ntDrag; const t = ${tgtJs}; for (const type of ["dragenter", "dragover"]) t.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt, clientX: ${bx}, clientY: ${by} })); })()`);
      await sleep(fast ? 0 : 450);
      await c.evaluate(`(() => { const { src, dt } = window.__ntDrag; const t = ${tgtJs}; t.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt, clientX: ${bx}, clientY: ${by} })); src.dispatchEvent(new DragEvent("dragend", { bubbles: true, dataTransfer: dt })); delete window.__ntDrag; })()`);
      await sleep(fast ? 50 : 300);
    },
    // REC+1 / REC+4: capa del video 1 (overlay-v1.js).
    async co(spec, text, o = {}) {
      const r = spec ? await rectOf(spec) : null;
      await v1(`callout(${J(r)}, ${J(text)}, ${J(o)})`);
    },
    async tip(spec, text) {
      const r = await rectOf(spec);
      if (r) await moveTo(...pointOf(r));
      await v1(`callout(${J(r)}, ${J(text)}, ${J({ tip: true, side: "below" })})`);
    },
    coclear: () => v1("clearCallouts()"),
    label: (text, kind = "") => v1(`label(${J(text)}, ${J(kind)})`),
    chips: (rows) => v1(`chips(${J(rows)})`),
    keys: (groups) => v1(`keys(${J(groups)})`),
    side: (title, items = []) => v1(`side(${J(title)}, ${J(items)})`),
    title: (text) => v1(`title(${J(text)})`),
    async lam(tipo, data) {
      await v1(`lamina(${J(tipo)}, ${J(data ?? null)})`);
      await c.evaluate(`window.__v.cursorShow(${!tipo})`);
      await sleep(fast ? 0 : 450);
    },
    reveal: (n) => v1(`reveal(${n})`),
    // Cámara sobre la línea del cursor de la terminal visible (zoom de 1.6 a 1.8 en el capítulo 7).
    async zoomcursor(s = 1.7, dx = 0) {
      const r = await c.evaluate(`(() => {
        const t = [...document.querySelectorAll(".xterm")].find((x) => x.getBoundingClientRect().width > 50 && x.checkVisibility({ visibilityProperty: true }))?.querySelector(".xterm-helper-textarea");
        if (!t) return null;
        const b = t.getBoundingClientRect();
        const sc = t.closest(".xterm").querySelector(".xterm-screen").getBoundingClientRect(); const cx = sc.left + (innerWidth / 2 - 24) / ${s} + ${dx}; return { x: cx - 1, y: b.top - 30, w: 2, h: 60 };
      })()`);
      if (!r) return console.warn("  zoomcursor: sin terminal");
      await c.evaluate(`window.__v.hl(null); window.__v1.clearCallouts(); window.__v.zoom(${J(r)}, ${s}, ${fast ? 0 : 900})`);
      await sleep(fast ? 50 : 950);
    },
    // Clic en la línea n (desde 1) del editor de Notas: el textarea es transparente y las líneas
    // visibles son los div del <pre> de abajo.
    async noteline(n) {
      const r = await c.evaluate(`(() => { const d = [...document.querySelectorAll("pre[aria-hidden] > div")][${n - 1}]; if (!d) return null; const b = d.getBoundingClientRect(); return { x: b.left, y: b.top, w: Math.min(b.width, 260), h: b.height }; })()`);
      if (!r) return console.warn(`  noteline ${n}: no encontrada`);
      await steps.click(r, { at: [0.9, 0.5] });
    },
    // Clic en el elemento n (desde 0) visible que cumple un selector CSS.
    async clickcss(sel, n = 0, o = {}) {
      const r = await c.evaluate(`(() => { const l = [...document.querySelectorAll(${J(sel)})].filter((e) => { const b = e.getBoundingClientRect(); return b.width > 1 && b.height > 1 && e.checkVisibility({ visibilityProperty: true }); }); const e = l.at(${n}); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; })()`);
      if (!r) {
        console.warn(`  no encontrado: ${sel} [${n}]`);
        return missing.push(`${sel}[${n}]`);
      }
      await steps.click(r, o);
    },
    // Rectángulo del cursor de texto de la terminal visible (para callouts).
    async cocursor(text, o = {}) {
      const r = await c.evaluate(`(() => { const t = [...document.querySelectorAll(".xterm")].find((x) => x.getBoundingClientRect().width > 50 && x.checkVisibility({ visibilityProperty: true }))?.querySelector(".xterm-helper-textarea"); if (!t) return null; const b = t.getBoundingClientRect(); return { x: b.left, y: b.top, w: 12, h: b.height || 20 }; })()`);
      await v1(`callout(${J(r)}, ${J(text)}, ${J(o)})`);
    },
    clear: () => c.evaluate("window.__v1.clearAll(); window.__v.hl(null)"),
  };
  async function runSteps(list, t0, dur = 0) {
    for (const s of list ?? []) {
      const [name, ...args] = s;
      if (name === "@" || name === "@end") {
        // Punto de sincronía: hasta `ms` desde el inicio de la frase ("@end": `ms` antes de que termine).
        const left = t0 + (name === "@" ? args[0] : dur * 1000 - args[0]) - Date.now();
        if (left > 0 && !fast) await sleep(left);
        continue;
      }
      if (!steps[name]) throw new Error(`Paso desconocido: ${name}`);
      await steps[name](...args);
    }
  }

  return { steps, runSteps, missing, setFast: (v) => (fast = v) };
}
