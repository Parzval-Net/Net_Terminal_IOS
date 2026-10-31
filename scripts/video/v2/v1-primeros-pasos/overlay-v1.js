// Capa extra del video 1, sobre scripts/video/overlay.js (window.__v): callouts con flecha, rótulos,
// chips, atajos en teclas, panel lateral, láminas a pantalla completa y réplicas de tooltips.
// Se inyecta después de overlay.js en cada carga (Page.addScriptToEvaluateOnNewDocument).
(() => {
  if (window.__v1) return;
  // El zoom de cámara de overlay.js transforma <body>. La terminal ubica el texto gris, la lista de
  // sugerencias y el aviso de plataforma con getBoundingClientRect de .xterm-screen y de su
  // contenedor, y con la transformación quedaban escalados dos veces (fuera de la línea). Para esos
  // dos elementos se devuelve el rectángulo sin zoom, que es el que la app espera.
  const rect0 = Element.prototype.getBoundingClientRect;
  const isTermBox = (el) => el.classList?.contains("xterm-screen") || !!el.querySelector?.(":scope > div.whitespace-pre.pointer-events-none");
  Element.prototype.getBoundingClientRect = function () {
    const r = rect0.call(this);
    const b = document.body;
    if (!b?.style.transform || !isTermBox(this)) return r;
    const t = getComputedStyle(b).transform;
    if (!t || t === "none") return r;
    const inv = new DOMMatrix(t).inverse();
    const a = inv.transformPoint(new DOMPoint(r.left, r.top));
    const z = inv.transformPoint(new DOMPoint(r.right, r.bottom));
    return new DOMRect(a.x, a.y, z.x - a.x, z.y - a.y);
  };
  const css = `
  #ntv1{position:fixed;inset:0;z-index:2147482999;pointer-events:none;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",sans-serif;color:#141821}
  #ntv1 .fade{opacity:0;transition:opacity .35s ease, transform .35s ease}
  #ntv1 .fade.on{opacity:1}
  #ntv1 .co{position:absolute;max-width:340px;padding:9px 14px 10px;border-radius:10px;background:#2f6bff;color:#fff;font-size:16px;font-weight:600;line-height:1.3;box-shadow:0 8px 24px rgba(20,40,120,.35);transform:translateY(6px)}
  #ntv1 .co.on{transform:none}
  #ntv1 .co.warn{background:#d6363f;box-shadow:0 8px 24px rgba(140,20,30,.35)}
  #ntv1 .co.tip{background:#1d2230;color:#f3f5f9;font-weight:500;font-size:14px;padding:6px 10px;border-radius:6px}
  #ntv1 svg.arrow{position:absolute;inset:0;width:100%;height:100%;overflow:visible}
  #ntv1 .lab{position:absolute;left:50%;bottom:132px;transform:translateX(-50%) translateY(8px);max-width:1100px;padding:10px 22px;border-radius:12px;background:rgba(255,255,255,.97);border:2px solid #2f6bff;color:#14306e;font-size:20px;font-weight:650;text-align:center;box-shadow:0 10px 30px rgba(20,40,120,.22);white-space:pre-line}
  #ntv1 .lab.on{transform:translateX(-50%)}
  #ntv1 .lab.warn{border-color:#d6363f;color:#9b1c24;background:#fff5f5}
  #ntv1 .lab.big{font-size:26px;padding:14px 28px}
  #ntv1 .chips{position:absolute;left:50%;top:92px;transform:translateX(-50%);display:flex;flex-direction:column;gap:10px;align-items:center}
  #ntv1 .chips .row{display:flex;gap:10px}
  #ntv1 .chip{padding:7px 16px;border-radius:999px;background:#fff;border:2px solid #2f6bff;color:#1d3fa8;font-weight:650;font-size:18px;box-shadow:0 6px 18px rgba(20,40,120,.18)}
  #ntv1 .keys{position:absolute;right:28px;bottom:100px;display:flex;align-items:center;gap:10px;padding:10px 16px;border-radius:12px;background:rgba(20,24,33,.9);color:#fff;font-size:17px;font-weight:600;box-shadow:0 8px 24px rgba(0,0,0,.25);transform:translateY(6px)}
  #ntv1 .keys.on{transform:none}
  #ntv1 .kbd{display:inline-block;min-width:30px;padding:4px 10px;border-radius:7px;background:#fff;color:#141821;font-family:"SF Mono",Menlo,monospace;font-size:18px;font-weight:700;text-align:center;box-shadow:inset 0 -3px 0 #c9cfdb}
  #ntv1 .keys .sep{opacity:.6;font-weight:500}
  #ntv1 .side{position:absolute;right:28px;top:150px;width:430px;padding:18px 20px;border-radius:14px;background:rgba(255,255,255,.98);border:1px solid #d5dbe8;box-shadow:0 18px 40px rgba(20,30,60,.22);transform:translateX(16px)}
  #ntv1 .side.on{transform:none}
  #ntv1 .side h4{margin:0 0 10px;font-size:15px;letter-spacing:.08em;text-transform:uppercase;color:#2f6bff}
  #ntv1 .side li{font-size:17px;line-height:1.45;margin:4px 0 4px 2px;list-style:none;padding-left:18px;position:relative}
  #ntv1 .side li::before{content:"";position:absolute;left:0;top:.62em;width:7px;height:7px;border-radius:50%;background:#2f6bff}
  #ntv1 .side ul{margin:0;padding:0}
  #ntv1 .side code,#ntv1 .lam code{font-family:"SF Mono",Menlo,monospace;font-size:.92em;background:#eef2fb;padding:1px 6px;border-radius:5px}
  #ntv1 .ttl{position:absolute;left:50%;top:40%;transform:translate(-50%,-50%);padding:16px 30px;border-radius:14px;background:rgba(255,255,255,.96);border:2px solid #2f6bff;font-size:30px;font-weight:750;letter-spacing:-.01em;color:#14306e;box-shadow:0 18px 40px rgba(20,40,120,.25)}
  #ntv1 .lam{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:radial-gradient(900px 500px at 25% 20%,rgba(47,107,255,.16),transparent 70%),radial-gradient(700px 420px at 85% 85%,rgba(30,47,140,.12),transparent 70%),#f6f7fb}
  #ntv1 .lam .in{width:1080px}
  #ntv1 .lam .k{color:#2f6bff;font-weight:700;font-size:16px;letter-spacing:.12em;text-transform:uppercase}
  #ntv1 .lam h2{margin:6px 0 26px;font-size:42px;letter-spacing:-.02em}
  #ntv1 .lam table{width:100%;border-collapse:separate;border-spacing:0 10px;font-size:22px}
  #ntv1 .lam td{background:#fff;padding:16px 22px;border-top:1px solid #e1e6f0;border-bottom:1px solid #e1e6f0}
  #ntv1 .lam td:first-child{border-left:1px solid #e1e6f0;border-radius:12px 0 0 12px;font-weight:700;width:220px}
  #ntv1 .lam td:last-child{border-right:1px solid #e1e6f0;border-radius:0 12px 12px 0;color:#4a5366}
  #ntv1 .lam tr,#ntv1 .lam .tree div,#ntv1 .lam .cols>div{opacity:0;transform:translateY(10px);transition:opacity .45s,transform .45s}
  #ntv1 .lam tr.on,#ntv1 .lam .tree div.on,#ntv1 .lam .cols>div.on{opacity:1;transform:none}
  #ntv1 .lam .tree{font-family:"SF Mono",Menlo,monospace;font-size:24px;line-height:1.75;background:#fff;border:1px solid #e1e6f0;border-radius:14px;padding:22px 30px}
  #ntv1 .lam .tree span{color:#7a8396;font-family:-apple-system,BlinkMacSystemFont,sans-serif;font-size:19px;margin-left:14px}
  #ntv1 .lam .note{margin-top:22px;font-size:20px;color:#14306e;font-weight:600}
  #ntv1 .lam .cols{display:flex;gap:28px}
  #ntv1 .lam .cols>div{flex:1;background:#fff;border:1px solid #e1e6f0;border-radius:16px;padding:28px 30px}
  #ntv1 .lam .cols .n{color:#2f6bff;font-weight:700;font-size:16px;letter-spacing:.1em;text-transform:uppercase}
  #ntv1 .lam .cols .t{font-size:34px;font-weight:750;margin-top:6px}
  #ntv1 .lam .cols .s{font-size:19px;color:#5b6475;margin-top:8px}
  #ntv1 .lam .logo{display:flex;flex-direction:column;align-items:center;gap:18px}
  #ntv1 .lam .logo img{width:132px;height:132px;filter:drop-shadow(0 12px 26px rgba(47,107,255,.35))}
  #ntv1 .lam .logo .t{font-size:52px;font-weight:800;letter-spacing:-.02em}
  #ntv1 .lam .logo .s{font-size:21px;color:#5b6475}
  `;
  let root, svg, lam;
  const layers = { co: [], lab: null, chips: null, keys: null, side: null, ttl: null };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  // `código` entre acentos graves se muestra como código.
  const rich = (s) => esc(s).replace(/`([^`]+)`/g, "<code>$1</code>");
  function mount() {
    if (root) return;
    const st = document.createElement("style");
    st.textContent = css;
    document.head.appendChild(st);
    root = document.createElement("div");
    root.id = "ntv1";
    root.innerHTML = `<svg class="arrow"><defs><marker id="ntv1h" markerWidth="10" markerHeight="10" refX="7" refY="5" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#2f6bff"/></marker><marker id="ntv1hw" markerWidth="10" markerHeight="10" refX="7" refY="5" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="#d6363f"/></marker></defs></svg>`;
    svg = root.querySelector("svg");
    // La capa del video 1 va debajo del cursor y los subtítulos de overlay.js (#ntv).
    const base = document.getElementById("ntv");
    document.documentElement.insertBefore(root, base ?? null);
  }
  function add(cls, html) {
    const d = document.createElement("div");
    d.className = `${cls} fade`;
    d.innerHTML = html;
    root.appendChild(d);
    requestAnimationFrame(() => requestAnimationFrame(() => d.classList.add("on")));
    return d;
  }
  function drop(el) {
    if (!el) return;
    el.classList.remove("on");
    setTimeout(() => el.remove(), 400);
  }
  /** Callout con flecha hacia el rectángulo r ({x,y,w,h} en coordenadas visibles). */
  function callout(r, text, o = {}) {
    mount();
    const d = add(`co${o.warn ? " warn" : ""}${o.tip ? " tip" : ""}`, rich(text));
    const W = innerWidth, H = innerHeight;
    const bw = Math.min(d.offsetWidth || 300, 340), bh = d.offsetHeight || 44;
    let side = o.side;
    if (!side && r) side = r.y + r.h + 26 + bh < H - 150 ? "below" : r.y - 26 - bh > 60 ? "above" : r.x + r.w + 30 + bw < W ? "right" : "left";
    let x, y;
    if (!r) (x = W / 2 - bw / 2), (y = 120);
    else if (side === "below") (x = r.x + r.w / 2 - bw / 2 + (o.dx ?? 0)), (y = r.y + r.h + (o.tip ? 10 : 30) + (o.dy ?? 0));
    else if (side === "above") (x = r.x + r.w / 2 - bw / 2 + (o.dx ?? 0)), (y = r.y - bh - (o.tip ? 10 : 30) + (o.dy ?? 0));
    else if (side === "right") (x = r.x + r.w + 34 + (o.dx ?? 0)), (y = r.y + r.h / 2 - bh / 2 + (o.dy ?? 0));
    else (x = r.x - bw - 34 + (o.dx ?? 0)), (y = r.y + r.h / 2 - bh / 2 + (o.dy ?? 0));
    x = Math.max(16, Math.min(W - bw - 16, x));
    y = Math.max(16, Math.min(H - bh - 16, y));
    Object.assign(d.style, { left: x + "px", top: y + "px" });
    let line = null;
    if (r && !o.tip) {
      // Flecha desde el borde del globo al borde del elemento.
      const cx = x + bw / 2, cy = y + bh / 2;
      const tx = Math.max(r.x, Math.min(r.x + r.w, cx)), ty = Math.max(r.y, Math.min(r.y + r.h, cy));
      const ex = side === "below" ? cx : side === "above" ? cx : side === "right" ? x : x + bw;
      const ey = side === "below" ? y : side === "above" ? y + bh : cy;
      line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      Object.entries({ x1: ex, y1: ey, x2: tx + (ex - tx) * 0.06, y2: ty + (ey - ty) * 0.06, stroke: o.warn ? "#d6363f" : "#2f6bff", "stroke-width": 3, "marker-end": `url(#ntv1h${o.warn ? "w" : ""})` }).forEach(([k, v]) => line.setAttribute(k, v));
      line.style.opacity = "0";
      line.style.transition = "opacity .35s";
      svg.appendChild(line);
      requestAnimationFrame(() => requestAnimationFrame(() => (line.style.opacity = "1")));
    }
    layers.co.push([d, line]);
  }
  function clearCallouts() {
    for (const [d, l] of layers.co) {
      drop(d);
      if (l) (l.style.opacity = "0"), setTimeout(() => l.remove(), 400);
    }
    layers.co = [];
  }
  const swap = (k, el) => {
    drop(layers[k]);
    layers[k] = el;
  };
  window.__v1 = {
    callout,
    clearCallouts,
    label(text, kind = "") {
      mount();
      swap("lab", text ? add(`lab ${kind}`, rich(text)) : null);
    },
    chips(rows) {
      mount();
      swap("chips", rows ? add("chips", rows.map((r) => `<div class="row">${r.map((c) => `<span class="chip">${esc(c)}</span>`).join("")}</div>`).join("")) : null);
    },
    /** Atajo en teclas: ["⌘N", "Ctrl+Shift+N"] → dos grupos separados por "·". */
    keys(groups) {
      mount();
      const kb = (g) => g.split(/(?<=[^+])\+(?=.)/).map((k) => `<span class="kbd">${esc(k)}</span>`).join("+");
      swap("keys", groups ? add("keys", groups.map((g) => (g.startsWith("~") ? `<span>${esc(g.slice(1))}</span>` : kb(g))).join('<span class="sep">·</span>')) : null);
    },
    side(title, items) {
      mount();
      swap("side", title ? add("side", `<h4>${esc(title)}</h4><ul>${items.map((i) => `<li>${rich(i)}</li>`).join("")}</ul>`) : null);
    },
    title(text) {
      mount();
      swap("ttl", text ? add("ttl", esc(text)) : null);
    },
    /** Lámina a pantalla completa. tipo: tabla | arbol | columnas | logo. Las filas aparecen con reveal(). */
    lamina(tipo, d) {
      mount();
      if (!tipo) return (drop(lam), (lam = null));
      let body = "";
      if (tipo === "tabla") body = `<table>${d.filas.map(([a, b]) => `<tr><td>${rich(a)}</td><td>${rich(b)}</td></tr>`).join("")}</table>`;
      if (tipo === "arbol") body = `<div class="tree">${d.filas.map(([a, b, n]) => `<div style="padding-left:${(n ?? 0) * 34}px">${esc(a)}${b ? `<span>${esc(b)}</span>` : ""}</div>`).join("")}</div>${d.nota ? `<div class="note">${rich(d.nota)}</div>` : ""}`;
      if (tipo === "columnas") body = `<div class="cols">${d.cols.map(([n, t, s]) => `<div><div class="n">${esc(n)}</div><div class="t">${esc(t)}</div><div class="s">${esc(s)}</div></div>`).join("")}</div>`;
      if (tipo === "logo") body = `<div class="logo"><img src="/assets/icon.svg" alt=""><div class="t">${esc(d.titulo)}</div><div class="s">${esc(d.sub ?? "")}</div></div>`;
      const html = `<div class="in">${d.kicker ? `<div class="k">${esc(d.kicker)}</div>` : ""}${d.titulo && tipo !== "logo" ? `<h2>${esc(d.titulo)}</h2>` : ""}${body}</div>`;
      const prev = lam;
      lam = add("lam", html);
      if (prev) setTimeout(() => prev.remove(), 450);
    },
    /** Muestra la fila n (0..) de la lámina; -1 muestra todas. */
    reveal(n) {
      const rows = lam ? [...lam.querySelectorAll("tr, .tree div, .cols>div")] : [];
      rows.forEach((r, i) => (n < 0 || i === n) && r.classList.add("on"));
    },
    clearAll() {
      clearCallouts();
      for (const k of ["lab", "chips", "keys", "side", "ttl"]) swap(k, null);
    },
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount);
  else mount();
})();
