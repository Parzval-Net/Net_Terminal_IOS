// Escenario del video: láminas, código con escritura animada y diagramas. API en window.E;
// la usa grabar.mjs por CDP. Sin dependencias.
const stage = document.getElementById("stage");
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const LOGO = "/src/assets/logo.svg";

let actual = null;
function vista(clase, html) {
  const v = document.createElement("section");
  v.className = `vista ${clase}`;
  v.innerHTML = html;
  stage.appendChild(v);
  const prev = actual;
  actual = v;
  requestAnimationFrame(() => requestAnimationFrame(() => v.classList.add("on")));
  if (prev) setTimeout(() => prev.remove(), 600);
  return v;
}
const encabezado = (o) => `${o.kicker ? `<div class="kicker">${esc(o.kicker)}</div>` : ""}${o.titulo ? `<h2>${o.titulo}</h2>` : ""}`;

// ---------- Resaltado ----------
const PY_KW = new Set("import from as def return if elif else for in not and or None True False with while try except raise lambda is pass class".split(" "));
const PY_FN = new Set("print len sum range open".split(" "));
function pyLinea(linea, estado) {
  let out = "";
  let i = 0;
  while (i < linea.length) {
    if (estado.triple) {
      const fin = linea.indexOf('"""', i);
      const hasta = fin < 0 ? linea.length : fin + 3;
      out += `<span class="s">${esc(linea.slice(i, hasta))}</span>`;
      if (fin >= 0) estado.triple = false;
      i = hasta;
      continue;
    }
    const resto = linea.slice(i);
    let m;
    if (resto.startsWith('"""')) {
      estado.triple = true;
      const fin = linea.indexOf('"""', i + 3);
      const hasta = fin < 0 ? linea.length : fin + 3;
      out += `<span class="s">${esc(linea.slice(i, hasta))}</span>`;
      if (fin >= 0) estado.triple = false;
      i = hasta;
    } else if (resto[0] === "#") {
      out += `<span class="c">${esc(resto)}</span>`;
      i = linea.length;
    } else if ((m = resto.match(/^[rf]?("(?:[^"\\]|\\.)*"?|'(?:[^'\\]|\\.)*'?)/))) {
      out += `<span class="s">${esc(m[0])}</span>`;
      i += m[0].length;
    } else if ((m = resto.match(/^[A-Za-z_]\w*/))) {
      const w = m[0];
      const prevDef = /def\s+$/.test(linea.slice(0, i));
      out += PY_KW.has(w) ? `<span class="k">${w}</span>` : prevDef || PY_FN.has(w) ? `<span class="f">${w}</span>` : esc(w);
      i += w.length;
    } else if ((m = resto.match(/^\d+(\.\d+)?/))) {
      out += `<span class="m">${m[0]}</span>`;
      i += m[0].length;
    } else {
      out += esc(resto[0]);
      i++;
    }
  }
  return out;
}
function jsonLinea(linea) {
  return linea.replace(/("(?:[^"\\]|\\.)*"?)(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?)|([{}[\],])|([^"{}[\],\d]+)/g, (m, str, colon, kw, num, punct, other) => {
    if (str) return colon ? `<span class="key">${esc(str)}</span>${colon}` : `<span class="s">${esc(str)}</span>`;
    if (kw) return `<span class="k">${kw}</span>`;
    if (num) return `<span class="m">${num}</span>`;
    if (punct) return `<span class="p">${esc(punct)}</span>`;
    return esc(other ?? m);
  });
}
function resaltar(texto, lenguaje) {
  const estado = { triple: false };
  return texto.split("\n").map((l) => (lenguaje === "json" ? jsonLinea(l) : lenguaje === "python" ? pyLinea(l, estado) : esc(l)));
}

// ---------- Código ----------
let codigo = null; // { pre, cuerpo, lenguaje, texto, marcas }
function pintar(caret = false) {
  const c = codigo;
  const lineas = resaltar(c.texto, c.lenguaje);
  c.pre.innerHTML = lineas
    .map((h, i) => {
      const n = i + 1;
      const cls = c.marcas.add.includes(n) ? " add" : c.marcas.hl.includes(n) ? " hl" : "";
      return `<div class="ln${cls}"><span class="n">${n}</span><span class="t">${h}${caret && i === lineas.length - 1 ? '<span class="caret"></span>' : ""}</span></div>`;
    })
    .join("");
  seguir(c.seguir ?? lineas.length);
}
/** Desplaza para que la línea n quede visible (a ~70 % de la altura). */
function seguir(n) {
  const c = codigo;
  const alto = c.cuerpo.clientHeight;
  const fila = c.pre.querySelector(".ln")?.offsetHeight ?? 30;
  const y = 18 + n * fila;
  const dy = Math.max(0, Math.min(y - alto * 0.72, c.pre.scrollHeight - alto + 10));
  c.pre.style.transform = `translateY(${-Math.max(0, dy)}px)`;
}

window.E = {
  portada(o) {
    vista(
      "portada",
      `<img class="logo" src="${LOGO}" alt="">${encabezado(o)}<h1>${o.h1}</h1><div class="sub">${o.sub ?? ""}</div>
       <div class="chips">${(o.chips ?? []).map((c) => `<span class="chip aparece">${esc(c)}</span>`).join("")}</div>`,
    );
  },
  capitulo(o) {
    vista("capitulo", `<div class="num">${esc(o.num)}</div><h1>${esc(o.titulo)}</h1><div class="sub">${o.sub ?? ""}</div>`);
  },
  lista(o) {
    vista(
      "lista",
      `${encabezado(o)}<div class="items">${o.items
        .map((it, i) => `<div class="item aparece"><span class="ico ${it.ico ?? "num"}">${it.ico === "ok" ? "✓" : it.ico === "no" ? "✕" : it.ico === "warn" ? "!" : it.ico === "dot" ? "•" : i + 1}</span><span>${it.texto}${it.nota ? `<span class="nota">${it.nota}</span>` : ""}</span></div>`)
        .join("")}</div>${o.pie ? `<div class="pie">${o.pie}</div>` : ""}`,
    );
  },
  columnas(o) {
    vista(
      "columnas",
      `${encabezado(o)}<div class="cols">${o.cols
        .map((c) => `<div class="col aparece"><h3>${c.titulo}${c.tag ? `<span class="tag" style="background:${c.tagFondo};color:${c.tagColor}">${c.tag}</span>` : ""}</h3>${c.html}</div>`)
        .join("")}</div>`,
    );
  },
  tabla(o) {
    vista(
      "tabla-v",
      `${encabezado(o)}<table class="tabla"><thead><tr>${o.columnas.map((c) => `<th>${c}</th>`).join("")}</tr></thead><tbody>${o.filas
        .map((f) => `<tr class="aparece">${f.map((c) => `<td>${c}</td>`).join("")}</tr>`)
        .join("")}</tbody></table>${o.pie ? `<div class="pie">${o.pie}</div>` : ""}`,
    );
  },
  arbol(o) {
    vista(
      "arbol-v",
      `${encabezado(o)}<div class="arbol">${o.nodos
        .map((n) => `<div class="nodo aparece" style="padding-left:${(n.nivel ?? 0) * 40}px"><span class="nombre">${esc(n.nombre)}</span>${n.nota ? `<span class="nota2">${n.nota}</span>` : ""}</div>`)
        .join("")}</div>${o.pie ? `<div class="pie">${o.pie}</div>` : ""}`,
    );
  },
  flujo(o) {
    vista(
      "flujo-v",
      `${encabezado(o)}<div class="flujo">${o.pasos
        .map((p, i) => `${i ? '<div class="flecha aparece">→</div>' : ""}<div class="paso aparece ${p.clase ?? ""}"><b>${p.b}</b>${p.t}</div>`)
        .join("")}</div>${o.pie ? `<div class="pie aparece">${o.pie}</div>` : ""}`,
    );
  },
  /** Muestra los primeros n elementos que aparecen (todos si n se omite). */
  revelar(n) {
    const els = [...actual.querySelectorAll(".aparece")];
    els.slice(0, n ?? els.length).forEach((e) => e.classList.add("on"));
  },
  codigo(o) {
    const v = vista(
      "codigo",
      `${encabezado(o)}<div class="${o.notas ? "lado" : ""}" style="flex:1;min-height:0;display:${o.notas ? "grid" : "flex"}">
        <div class="ventana"><div class="barra"><span class="pto"></span><span class="pto"></span><span class="pto"></span><span class="arch">${esc(o.archivo)}</span><span class="ruta">${esc(o.ruta ?? "")}</span></div>
        <div class="cuerpo"><pre></pre></div></div>
        ${o.notas ? `<div class="notas">${o.notas.map((n) => `<div class="nota-c aparece"><b>${esc(n.b)}</b>${n.t}</div>`).join("")}</div>` : ""}
      </div>`,
    );
    const pre = v.querySelector("pre");
    if (o.fs) pre.style.setProperty("--fs", `${o.fs}px`);
    codigo = { pre, cuerpo: v.querySelector(".cuerpo"), lenguaje: o.lenguaje, texto: o.texto ?? "", marcas: { add: [], hl: [] } };
    pintar(!!o.caret);
  },
  /** Escribe texto al final del código, a `cps` caracteres por segundo (la indentación va de una vez). */
  escribir(texto, cps = 30) {
    const base = codigo.texto;
    // Bloques: cada carácter, salvo espacios iniciales de línea que van juntos.
    const pasos = [];
    for (let i = 0; i < texto.length; ) {
      const m = (i === 0 || texto[i - 1] === "\n") && texto.slice(i).match(/^ +/);
      const len = m ? m[0].length : 1;
      pasos.push(i + len);
      i += len;
    }
    return new Promise((resolve) => {
      const t0 = performance.now();
      const tick = () => {
        const k = Math.min(pasos.length, Math.floor(((performance.now() - t0) / 1000) * cps));
        codigo.texto = base + texto.slice(0, k ? pasos[k - 1] : 0);
        pintar(true);
        if (k < pasos.length) requestAnimationFrame(tick);
        else resolve();
      };
      tick();
    });
  },
  mostrar(texto, caret = false) {
    codigo.texto = texto;
    pintar(caret);
  },
  marcar({ add = [], hl = [], seguir: n } = {}) {
    codigo.marcas = { add, hl };
    codigo.seguir = n;
    pintar(false);
  },
};
