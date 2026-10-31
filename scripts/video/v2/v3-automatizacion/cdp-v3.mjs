// Extensiones del grabador para el video 3 sobre scripts/video/plugins/cdp.mjs: rótulos con
// recuadro (callouts), escritura con teclas de atajo y ayudas para formularios de React.
import { lanzar as lanzarBase, pagina as paginaBase, grabar, sleep, VIEW } from "../../plugins/cdp.mjs";

export { grabar, sleep, VIEW };
export const lanzar = (port) => lanzarBase(port);

const MOD = { alt: 1, ctrl: 2, meta: 4, shift: 8 };

export function pagina(cdp) {
  const p = paginaBase(cdp);
  const instalarBase = p.instalarCursor;
  const encuadrarBase = p.encuadrar;
  const camaraBase = p.camara;
  Object.assign(p, {
    /**
     * Rectángulo de un elemento en pantalla. Con zoom no se usa scrollIntoView: desplazaría el
     * documento (el body escalado es más grande que la vista) y movería todo el encuadre.
     */
    async rect1(sel) {
      return await p.ev(
        `(() => { const e = window.__q(a); if (!e) return null; const z = (window.__cam || { z: 1 }).z; if (z === 1) e.scrollIntoView({ block: "nearest", inline: "nearest" }); const s = document.scrollingElement; if (s.scrollTop || s.scrollLeft) { s.scrollTop = 0; s.scrollLeft = 0; } const b = e.getBoundingClientRect(); return [b.left, b.top, b.width, b.height]; })()`,
        sel,
      );
    },
    /** Cámara: además espera un cuadro extra para que el transform quede aplicado. */
    async camara(z, cx, cy, ms = 900, esperar = true) {
      await camaraBase(z, cx, cy, ms, esperar);
      if (esperar) await sleep(90);
    },
    /** Espera a que el elemento deje de moverse (animación de entrada de los diálogos). */
    async quieto(sel, ms = 1500) {
      let prev = null;
      for (let t = 0; t < ms; t += 80) {
        const r = await p.rect1(sel).catch(() => null);
        if (r && prev && r.every((v, i) => Math.abs(v - prev[i]) < 0.5)) return r;
        prev = r;
        await sleep(80);
      }
      return prev;
    },
    async encuadrar(sel, opts) {
      await p.quieto(sel);
      return encuadrarBase(sel, opts);
    },
    /** Además del cursor: selectores con ámbito, "SELECTOR texto:…" o "SELECTOR titulo:…". */
    async instalarCursor() {
      await instalarBase();
      await p.ev(`(() => {
        if (window.__q.ambito) return 1;
        window.__qBase = window.__q;
        window.__q = (s) => {
          const m = typeof s === "string" && s.match(/^(.+?)\\s+((?:texto|titulo):.*)$/);
          if (!m) return window.__qBase(s);
          const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
          const scope = [...document.querySelectorAll(m[1])].find(vis);
          if (!scope) return null;
          const t = m[2].replace(/^(texto|titulo):/, "");
          if (m[2].startsWith("titulo:")) return [...scope.querySelectorAll("[title],[aria-label]")].filter(vis).find((e) => e.title === t || e.title?.startsWith(t) || e.getAttribute("aria-label") === t) ?? null;
          const all = [...scope.querySelectorAll("button, label, summary, a, span, div, li, h2, h3, option, code, pre, p")].filter(vis);
          return all.find((e) => e.textContent.trim() === t && e.children.length <= 3) ?? all.find((e) => e.textContent.trim().startsWith(t) && e.children.length <= 3) ?? null;
        };
        window.__q.ambito = true;
        return 1;
      })()`);
    },
    /** Rótulo junto a un elemento (selector de window.__q) o un rectángulo [x, y, w, h]. */
    async rotulo(sel, texto, opts = {}) {
      let r;
      if (Array.isArray(sel)) r = sel; // coordenadas de pantalla (p. ej. de rectDe)
      else if (sel?.base) {
        // Coordenadas de la vista sin zoom: se llevan a pantalla con la cámara actual.
        const k = await p.ev("window.__cam || { z: 1, tx: 0, ty: 0 }");
        const [x, y, w, h] = sel.base;
        r = [x * k.z + k.tx, y * k.z + k.ty, w * k.z, h * k.z];
      } else r = await p.rect(sel);
      return p.ev(`window.__rotulo(a[0], a[1], a[2])`, [r, texto, opts]);
    },
    async sinRotulos(id) {
      await p.ev(`(window.__sinRotulos && window.__sinRotulos(a), 1)`, id ?? null);
    },
    /** Atajo de teclado: combo "meta+j", "meta+Enter", "Escape"… */
    async atajo(combo) {
      const partes = combo.split("+");
      const key = partes.pop();
      const modifiers = partes.reduce((m, k) => m | MOD[k], 0);
      const code = key.length === 1 ? `Key${key.toUpperCase()}` : key;
      const vk = key.length === 1 ? key.toUpperCase().charCodeAt(0) : { Enter: 13, Escape: 27, Tab: 9 }[key] ?? 0;
      await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode: vk, modifiers, ...(key === "Enter" && !modifiers ? { text: "\r" } : {}) });
      await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: vk, modifiers });
    },
    /** Fija el valor de un input/select/textarea como lo haría el usuario (evento de React). */
    async valor(sel, v) {
      return p.ev(
        `(() => { const el = window.__q(a[0]); if (!el) throw new Error("sin " + a[0]); const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, "value").set.call(el, a[1]); el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true })); return true; })()`,
        [sel, v],
      );
    },
    /** Zoom a un rectángulo de pantalla [x, y, w, h] (por ejemplo, de rectDe). */
    async zoomA(r, { margen = 40, max = 1.6, ms = 800 } = {}) {
      const k = await p.ev("window.__cam || { z: 1, tx: 0, ty: 0 }");
      const [x, y, w, h] = [(r[0] - k.tx) / k.z, (r[1] - k.ty) / k.z, r[2] / k.z, r[3] / k.z];
      const z = Math.max(1, Math.min(max, VIEW.width / (w + margen * 2), VIEW.height / (h + margen * 2)));
      await p.camara(z, x + w / 2, y + h / 2, ms);
    },
    /** Rectángulo (vista) que encierra varios elementos. */
    async rectDe(...sels) {
      const rs = [];
      for (const s of sels) rs.push(await p.rect(s));
      const x = Math.min(...rs.map((r) => r[0])), y = Math.min(...rs.map((r) => r[1]));
      const x2 = Math.max(...rs.map((r) => r[0] + r[2])), y2 = Math.max(...rs.map((r) => r[1] + r[3]));
      return [x, y, x2 - x, y2 - y];
    },
  });
  return p;
}
