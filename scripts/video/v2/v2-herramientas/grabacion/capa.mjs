// Capa de explicación del video 2 sobre la página (app o escenario): recuadro de resaltado,
// globo de texto (callout), zoom a un elemento y búsquedas extra. Extiende la página de
// scripts/video/plugins/cdp.mjs sin cambiarla. El recuadro y el globo viven dentro de <body>
// (position: fixed), así siguen a la cámara (transform del body) igual que el cursor.
import { sleep } from "../../../plugins/cdp.mjs";

const CSS = `
#__hl { position: fixed; left: 0; top: 0; z-index: 2147483600; pointer-events: none; border: 3px solid #1d5be0; border-radius: 10px;
  box-shadow: 0 0 0 4px rgba(29, 91, 224, .16), 0 0 26px rgba(29, 91, 224, .32); opacity: 0; transition: opacity .3s, transform .45s cubic-bezier(.3,.7,.25,1), width .45s, height .45s; }
#__call { position: fixed; left: 0; top: 0; z-index: 2147483601; pointer-events: none; width: max-content; max-width: 560px; padding: 8px 14px 9px; border-radius: 10px;
  background: #1d5be0; color: #fff; font: 600 15px/1.35 system-ui, -apple-system, "Segoe UI", sans-serif; box-shadow: 0 8px 22px rgba(15, 23, 42, .25);
  opacity: 0; transition: opacity .3s; white-space: normal; text-wrap: balance; }
#__call.ok { background: #1a7f37; } #__call.warn { background: #8a5a00; } #__call.bad { background: #d1242f; } #__call.neutro { background: #1b1f24; }
`;

/** Agrega a la página `p` los métodos de la capa. */
export function capa(p) {
  p.instalarCapa = async () => {
    await p.ev(`(() => {
      if (!document.getElementById("__hl")) {
        const st = document.createElement("style");
        st.textContent = ${JSON.stringify(CSS)};
        document.head.appendChild(st);
        for (const id of ["__hl", "__call"]) { const d = document.createElement("div"); d.id = id; document.body.appendChild(d); }
      }
      if (window.__q0) return;
      window.__q0 = window.__q;
      const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== "hidden"; };
      const txt = (e) => (e.textContent ?? "").replace(/\\s+/g, " ").trim();
      // Búsqueda con alcance: "Título de sección>>tipo:valor" busca dentro de esa sección.
      const q = (s, R) => {
        if (typeof s !== "string") return null;
        const all = (sel) => [...R.querySelectorAll(sel)].filter(vis);
        const k = s.indexOf(":"), tipo = s.slice(0, k), v = s.slice(k + 1);
        // Campo (input/select/textarea) dentro del <label> cuyo texto empieza con v.
        if (tipo === "campo") return all("label").find((l) => txt(l.querySelector("span") ?? l).startsWith(v))?.querySelector("input, select, textarea") ?? null;
        // <label> completo cuyo texto empieza con v (interruptores, casillas).
        if (tipo === "label") return all("label").find((l) => txt(l).startsWith(v)) ?? null;
        if (tipo === "opt") return all("select").find((x) => [...x.options].some((o) => o.value === v)) ?? null;
        if (tipo === "svgt") return all("svg text").find((t) => t.textContent === v) ?? null;
        if (tipo === "svg") return all("svg text").find((t) => t.textContent === v)?.closest("g") ?? null;
        // Sección por su título (h2/h3/h4): la tarjeta que la contiene.
        if (tipo === "sec") { const h = all("h2, h3, h4").find((x) => txt(x) === v || txt(x).startsWith(v)); return h ? (h.closest("section, .rounded-xl, details") ?? h.parentElement) : null; }
        if (tipo === "h") return all("h2, h3, h4, summary").find((x) => txt(x).startsWith(v)) ?? null;
        // Elemento más chico que contiene el texto.
        if (tipo === "has") return all("*").filter((e) => !e.id?.startsWith("__") && txt(e).includes(v)).sort((a, b) => a.getBoundingClientRect().width * a.getBoundingClientRect().height - b.getBoundingClientRect().width * b.getBoundingClientRect().height)[0] ?? null;
        if (tipo === "btn") return all("button").find((b) => txt(b) === v) ?? all("button").find((b) => txt(b).startsWith(v)) ?? null;
        // Último elemento con ese texto exacto (por ejemplo, la fila del panel del equipo).
        if (tipo === "ultimo") return all("*").filter((e) => txt(e) === v && e.children.length <= 3).pop() ?? null;
        if (tipo === "tit") return all("[title]").find((e) => e.title === v || e.title.startsWith(v)) ?? null;
        if (tipo === "css") return all(v)[0] ?? null;
        if (R !== document) {
          if (tipo === "texto") return all("*").find((e) => txt(e) === v && e.children.length <= 3) ?? null;
          if (tipo === "titulo") return all("[title],[aria-label]").find((e) => e.title === v || e.title?.startsWith(v) || e.getAttribute("aria-label") === v) ?? null;
        }
        return window.__q0(s);
      };
      window.__q = (s) => {
        if (typeof s !== "string") return null;
        const i = s.indexOf(">>");
        if (i < 0) return q(s, document);
        const h = [...document.querySelectorAll("h2, h3, h4")].filter(vis).find((x) => txt(x) === s.slice(0, i) || txt(x).startsWith(s.slice(0, i)));
        const R = h ? (h.closest("section, .rounded-xl, details") ?? h.parentElement) : null;
        return R ? q(s.slice(i + 2), R) : null;
      };
    })()`);
  };

  /** Rectángulo visible del elemento (sin desplazar la página). */
  p.rectVis = async (sel) => {
    for (let i = 0; i < 30; i++) {
      const r = await p.ev(`(() => { const e = window.__q(a); if (!e) return null; const b = e.getBoundingClientRect(); return [b.left, b.top, b.width, b.height]; })()`, sel);
      if (r) return r;
      await sleep(100);
    }
    throw new Error(`No encontrado: ${sel}`);
  };

  /** Recuadro sobre un elemento con un globo de texto opcional. lado: abajo, arriba, der, izq. */
  p.hl = async (sel, texto = "", { pad = 6, lado = "abajo", tono = "", scroll = true } = {}) => {
    const r = scroll ? await p.rect(sel) : await p.rectVis(sel);
    await p.ev(`(() => {
      const [l, t, w, h] = a.r, k = window.__cam || { z: 1, tx: 0, ty: 0 };
      const x = (l - k.tx) / k.z - a.pad, y = (t - k.ty) / k.z - a.pad, W = w / k.z + a.pad * 2, H = h / k.z + a.pad * 2;
      const hl = document.getElementById("__hl");
      Object.assign(hl.style, { transform: "translate(" + x + "px," + y + "px)", width: W + "px", height: H + "px", opacity: "1" });
      const c = document.getElementById("__call");
      if (!a.texto) { c.style.opacity = "0"; return; }
      c.className = a.tono; c.textContent = a.texto;
      const cw = c.offsetWidth, ch = c.offsetHeight, VW = 1440, VH = 810;
      let cx = x, cy = y + H + 10;
      if (a.lado === "arriba") cy = y - ch - 10;
      if (a.lado === "der") (cx = x + W + 12), (cy = y + H / 2 - ch / 2);
      if (a.lado === "izq") (cx = x - cw - 12), (cy = y + H / 2 - ch / 2);
      // Dentro de la vista visible (con zoom): se acota en coordenadas de pantalla y se vuelve al body.
      const vx = Math.max(8, Math.min(VW - cw * k.z - 8, cx * k.z + k.tx)), vy = Math.max(8, Math.min(VH - ch * k.z - 8, cy * k.z + k.ty));
      cx = (vx - k.tx) / k.z; cy = (vy - k.ty) / k.z;
      c.style.left = cx + "px"; c.style.top = cy + "px"; c.style.opacity = "1";
    })()`, { r, pad, texto, lado, tono });
  };
  /** Globo de texto suelto en una posición de la pantalla (coordenadas visibles, con o sin zoom). */
  p.nota = (texto, x, y, tono = "") =>
    p.ev(`(() => { const k = window.__cam || { z: 1, tx: 0, ty: 0 }; const c = document.getElementById("__call"); c.className = a.tono; c.textContent = a.texto; c.style.left = (a.x - k.tx) / k.z + "px"; c.style.top = (a.y - k.ty) / k.z + "px"; c.style.opacity = "1"; })()`, { texto, x, y, tono });
  p.sinHl = () => p.ev(`(() => { for (const id of ["__hl", "__call"]) { const e = document.getElementById(id); if (e) e.style.opacity = "0"; } })()`);

  /** Zoom z centrado en el elemento. */
  p.zoom = async (sel, z = 1.5, ms = 900) => {
    const k0 = await p.ev("window.__cam || { z: 1, tx: 0, ty: 0 }");
    const [l, t, w, h] = await p.rect(sel);
    await p.camara(z, (l + w / 2 - k0.tx) / k0.z, (t + h / 2 - k0.ty) / k0.z, ms);
  };
  p.unzoom = (ms = 800) => p.camara(1, 720, 405, ms);

  /** Fija el valor de un select o input (con los eventos de React). */
  p.valor = (sel, v) =>
    p.ev(
      `(() => { const el = window.__q(a[0]); if (!el) throw new Error("valor: no encontrado " + a[0]); const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, "value").set.call(el, a[1]); el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true })); return true; })()`,
      [sel, v],
    );
  /** Elige una opción de un select como lo haría el usuario: mueve el cursor, pulsa y cambia el valor. */
  p.elegir = async (sel, v, ms = 600) => {
    await p.mover(sel, ms);
    await p.ev("window.__pulse()");
    await sleep(250);
    await p.valor(sel, v);
    await sleep(200);
  };
  /** Clic sin animar el cursor (preparación). */
  p.clicYa = (sel) => p.clic(sel, { ms: 0 });
  /** Clic en un nodo del diagrama de topología. */
  p.nodo = (nombre, opts) => p.clic(`svg:${nombre}`, opts);
  /** Llama al backend simulado. */
  p.invocar = (cmd, args = {}) => p.ev(`window.__TAURI_INTERNALS__.invoke(a[0], a[1])`, [cmd, args]);
  /** Atajo con Cmd (macOS en headless). */
  p.cmd = (letra) => p.tecla(letra, `Key${letra.toUpperCase()}`, letra.toUpperCase().charCodeAt(0), 4);
  /** Desplaza el contenedor con scroll hasta el elemento (block: start, center). */
  p.ver = async (sel, block = "center", suave = true) => {
    await p.ev(`(() => { const e = window.__q(a[0]); if (!e) throw new Error("ver: no encontrado " + a[0]); e.scrollIntoView({ block: a[1], behavior: a[2] ? "smooth" : "instant" }); return true; })()`, [sel, block, suave]);
    // Espera a que termine el desplazamiento suave (si no, los clics siguientes caen fuera).
    let prev = null;
    for (let i = 0; i < 25; i++) {
      await sleep(70);
      const y = await p.ev(`Math.round(window.__q(a)?.getBoundingClientRect().top ?? 0)`, sel);
      if (y === prev) break;
      prev = y;
    }
  };
  return p;
}
