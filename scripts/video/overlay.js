// Capa del video que se inyecta en cada carga de demo.html (Page.addScriptToEvaluateOnNewDocument):
// cursor, recuadro de resaltado, subtítulos, tarjeta de capítulo y zoom. No intercepta clics.
// También reemplaza en los textos de ejemplo de la interfaz las IPs que no son de documentación.
(() => {
  if (window.__v) return;
  const css = `
  #ntv{position:fixed;inset:0;z-index:2147483000;pointer-events:none;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",sans-serif}
  #ntv .cur{position:absolute;left:0;top:0;width:26px;height:26px;transition:transform .55s cubic-bezier(.3,.7,.25,1),opacity .3s;filter:drop-shadow(0 2px 3px rgba(0,0,0,.35))}
  #ntv .rip{position:absolute;width:34px;height:34px;margin:-17px 0 0 -17px;border-radius:50%;border:3px solid #2f6bff;opacity:.9;animation:ntvrip .5s ease-out forwards}
  @keyframes ntvrip{from{transform:scale(.3);opacity:.9}to{transform:scale(1.6);opacity:0}}
  #ntv .hl{position:absolute;border:3px solid #2f6bff;border-radius:10px;box-shadow:0 0 0 4px rgba(47,107,255,.18),0 0 24px rgba(47,107,255,.35);opacity:0;transition:opacity .3s,left .4s,top .4s,width .4s,height .4s}
  #ntv .cap{position:absolute;left:50%;bottom:44px;transform:translateX(-50%);max-width:880px;padding:9px 18px 10px;border-radius:10px;background:rgba(17,22,32,.82);color:#fff;font-size:21px;line-height:1.38;text-align:center;font-weight:500;letter-spacing:.005em;opacity:0;transition:opacity .18s;text-wrap:balance}
  #ntv .card{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity .45s;background:radial-gradient(900px 500px at 30% 30%,rgba(47,107,255,.20),transparent 70%),radial-gradient(700px 420px at 80% 80%,rgba(30,47,140,.16),transparent 70%),rgba(246,247,251,.94);backdrop-filter:blur(6px)}
  #ntv .card .box{display:flex;align-items:center;gap:26px}
  #ntv .card img{width:96px;height:96px;filter:drop-shadow(0 10px 20px rgba(47,107,255,.35))}
  #ntv .card .k{color:#2f6bff;font-weight:700;font-size:16px;letter-spacing:.12em;text-transform:uppercase}
  #ntv .card .t{color:#141821;font-weight:700;font-size:44px;letter-spacing:-.02em;margin-top:4px}
  #ntv .card .s{color:#5b6475;font-size:19px;margin-top:6px}
  `;
  let root, cur, hl, cap, card, capTimers = [];
  let cx = 1100, cy = 520;
  const IPS = [
    [/\b10\.\d{1,3}\.\d{1,3}\.(\d{1,3})\b/g, "192.0.2.$1"],
    [/\b8\.8\.8\.8\b/g, "192.0.2.53"],
    [/\b192\.168\.\d{1,3}\.(\d{1,3})\b/g, "192.0.2.$1"],
    [/\b172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.(\d{1,3})\b/g, "192.0.2.$2"],
  ];
  const fix = (s) => IPS.reduce((acc, [re, to]) => acc.replace(re, to), s);
  const needs = (s) => s && IPS.some(([re]) => ((re.lastIndex = 0), re.test(s)));
  function sanitize(node = document.body) {
    if (!node) return;
    for (const el of node.querySelectorAll?.("[placeholder]") ?? []) {
      const p = el.getAttribute("placeholder");
      if (needs(p)) el.setAttribute("placeholder", fix(p));
    }
    const w = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    for (let t = w.nextNode(); t; t = w.nextNode()) {
      if (t.parentElement?.closest(".xterm, #ntv")) continue;
      if (needs(t.data)) t.data = fix(t.data);
    }
  }
  function sanitizeValues() {
    const set = (el, v) => {
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value").set.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    };
    for (const el of document.querySelectorAll("input, textarea")) if (needs(el.value)) set(el, fix(el.value));
  }
  function mount() {
    if (root) return;
    const st = document.createElement("style");
    st.textContent = css;
    document.head.appendChild(st);
    root = document.createElement("div");
    root.id = "ntv";
    root.innerHTML = `<div class="hl"></div><div class="cap"></div><div class="card"><div class="box"><img src="/assets/icon.svg" alt=""><div><div class="k"></div><div class="t"></div><div class="s"></div></div></div></div>
      <svg class="cur" viewBox="0 0 26 26"><path d="M4 2 L4 21 L9 16.5 L12.5 24 L15.6 22.6 L12.2 15.3 L19 15.3 Z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
    document.documentElement.appendChild(root);
    [hl, cap, card, cur] = ["hl", "cap", "card", "cur"].map((c) => root.querySelector("." + c));
    cur.style.transform = `translate(${cx - 4}px,${cy - 2}px)`;
    new MutationObserver((ms) => {
      for (const m of ms) {
        if (m.type === "attributes" && m.attributeName === "placeholder") {
          const p = m.target.getAttribute("placeholder");
          if (needs(p)) m.target.setAttribute("placeholder", fix(p));
        }
        for (const n of m.addedNodes ?? []) n.nodeType === 1 ? sanitize(n) : n.nodeType === 3 && !n.parentElement?.closest(".xterm, #ntv") && needs(n.data) && (n.data = fix(n.data));
        if (m.type === "characterData" && !m.target.parentElement?.closest(".xterm, #ntv") && needs(m.target.data)) m.target.data = fix(m.target.data);
      }
    }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["placeholder"] });
    sanitize();
  }
  // loose: solo exige tamaño y estilo visibles (para desplazar hasta un elemento oculto por scroll).
  let loose = false;
  const visible = (e, hit = true) => {
    const r = e.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    const s = getComputedStyle(e);
    if (s.visibility === "hidden" || s.display === "none" || +s.opacity <= 0.05) return false;
    if (loose) return true;
    if (r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth) return false;
    if (!hit) return true;
    // Que de verdad se vea: el punto central no está tapado (modal, scroll del contenedor).
    const cx = Math.min(innerWidth - 1, Math.max(0, r.left + r.width / 2));
    const cy = Math.min(innerHeight - 1, Math.max(0, r.top + Math.min(r.height / 2, 12)));
    const h = document.elementFromPoint(cx, cy);
    return !!h && (e.contains(h) || h.contains(e) || (e.tagName === "LABEL" && h.closest("label") === e));
  };
  /** Busca un elemento: "css:<selector>", "ph:<placeholder>", "text:<texto exacto>", "svg:<texto en SVG>" o, por defecto, título/aria-label o texto. */
  function find(spec, isLoose = false) {
    loose = isLoose;
    try {
      return findIn(spec);
    } finally {
      loose = false;
    }
  }
  function findIn(spec) {
    if (spec.startsWith("opt:")) return [...document.querySelectorAll("select")].find((s) => visible(s) && [...s.options].some((o) => o.value === spec.slice(4))) ?? null;
    if (spec.startsWith("tp:")) return [...document.querySelectorAll("[title]")].find((e) => visible(e) && !e.closest("#ntv") && e.title.startsWith(spec.slice(3))) ?? null;
    const [kind, val] = /^(css|ph|text|svg|title|has):/.test(spec) ? [spec.slice(0, spec.indexOf(":")), spec.slice(spec.indexOf(":") + 1)] : ["any", spec];
    const pick = (list) => list.filter(visible).sort((a, b) => a.getBoundingClientRect().width * a.getBoundingClientRect().height - b.getBoundingClientRect().width * b.getBoundingClientRect().height)[0] ?? null;
    if (kind === "css") return [...document.querySelectorAll(val)].find(visible) ?? null;
    if (kind === "ph") return [...document.querySelectorAll("input, textarea")].find((e) => visible(e) && (e.placeholder ?? "").startsWith(val)) ?? null;
    if (kind === "svg") return [...document.querySelectorAll("svg text")].find((e) => e.textContent === val && visible(e, false))?.parentElement ?? null;
    const all = [...document.querySelectorAll("body *")].filter((e) => !e.closest("#ntv"));
    if (kind === "title" || kind === "any") {
      const t = all.find((e) => visible(e) && (e.title === val || e.title?.startsWith(val + " (") || e.title?.startsWith(val + "\n") || e.getAttribute("aria-label") === val));
      if (t || kind === "title") return t ?? null;
    }
    if (kind === "has") return pick(all.filter((e) => e.textContent?.includes(val) && e.children.length <= 3));
    return pick(all.filter((e) => e.textContent?.trim() === val));
  }
  function rectOf(spec) {
    const e = typeof spec === "string" ? find(spec) : spec;
    if (!e) return null;
    const r = e.getBoundingClientRect();
    return { x: r.left, y: r.top, w: r.width, h: r.height };
  }
  window.__v = {
    find,
    rectOf,
    sanitize: () => (sanitize(), sanitizeValues()),
    scrollTo(spec, block = "center") {
      const e = find(spec, true);
      e?.scrollIntoView({ behavior: "smooth", block });
      return !!e;
    },
    cursorTo(x, y, ms = 550) {
      cur.style.transition = `transform ${ms}ms cubic-bezier(.3,.7,.25,1),opacity .3s`;
      cur.style.transform = `translate(${x - 4}px,${y - 2}px)`;
      cx = x;
      cy = y;
    },
    cursorShow(on) {
      cur.style.opacity = on ? "1" : "0";
    },
    ripple(x, y) {
      const d = document.createElement("div");
      d.className = "rip";
      d.style.left = x + "px";
      d.style.top = y + "px";
      root.appendChild(d);
      setTimeout(() => d.remove(), 600);
    },
    hl(r, pad = 6) {
      if (!r) return (hl.style.opacity = "0");
      Object.assign(hl.style, { left: r.x - pad + "px", top: r.y - pad + "px", width: r.w + pad * 2 + "px", height: r.h + pad * 2 + "px", opacity: "1" });
    },
    caption(chunks) {
      capTimers.forEach(clearTimeout);
      capTimers = [];
      cap.style.opacity = "0";
      for (const [at, text, until] of chunks) {
        capTimers.push(setTimeout(() => ((cap.textContent = text), (cap.style.opacity = "1")), at));
        if (until) capTimers.push(setTimeout(() => (cap.style.opacity = "0"), until));
      }
    },
    card(kicker, title, sub) {
      if (!kicker) return (card.style.opacity = "0");
      card.querySelector(".k").textContent = kicker;
      card.querySelector(".t").textContent = title;
      card.querySelector(".s").textContent = sub ?? "";
      card.style.transition = "none";
      card.style.opacity = "1";
      requestAnimationFrame(() => (card.style.transition = "opacity .45s"));
    },
    zoom(r, s = 1.5, ms = 900) {
      const b = document.body;
      b.style.transformOrigin = "0 0";
      b.style.transition = `transform ${ms}ms cubic-bezier(.4,0,.2,1)`;
      if (!r) return (b.style.transform = "");
      const W = innerWidth, H = innerHeight;
      // El rectángulo dado está en coordenadas visibles: se pasa a coordenadas sin zoom.
      const cur0 = new DOMMatrix(getComputedStyle(b).transform === "none" ? undefined : getComputedStyle(b).transform);
      const inv = cur0.inverse();
      const p = inv.transformPoint(new DOMPoint(r.x + r.w / 2, r.y + r.h / 2));
      let tx = W / 2 - s * p.x, ty = H / 2 - s * p.y;
      tx = Math.min(0, Math.max(W - s * W, tx));
      ty = Math.min(0, Math.max(H - s * H, ty));
      b.style.transform = `translate(${tx}px,${ty}px) scale(${s})`;
    },
    get cursor() {
      return [cx, cy];
    },
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();
})();
