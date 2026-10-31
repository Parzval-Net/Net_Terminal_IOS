// Backend simulado del video 3 (automatización), sobre scripts/screenshots/mock.js y
// scripts/video/plugins/mock-video.js. Todo es ficticio: campus con IPs de documentación
// (equipos-campus.js), usuario "operador" y rutas /Users/operador/...
//
// Las ejecuciones de scripts y plugins reproducen en la app las líneas de tiempo que arma
// datos.mjs con ejecuciones reales (Python + netterminal.py contra el mismo campus): los mismos
// comandos, en las mismas sesiones, y los mismos mensajes. El grabador las deja en
// window.__videoData antes de cargar la página.
import { EQUIPOS, respuestaCampus } from "./equipos-campus.js";

const M = window.__mock;
const D = window.__videoData ?? {};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
/** Estado que el grabador ajusta por toma (CDP). */
const V = (window.__v3 = {
  python: "ok", // "ok" | "none"
  iperf: "iperf 3.17.1",
  ritmo: 1, // multiplica las pausas de las ejecuciones simuladas
  scripts: ["ejemplo_respaldo.py", "inventario_csv.py", "ping_destinos.py", "primer_script.py"],
  /** Script que se reproduce en vez del elegido (p. ej. "inventario_csv.py@colgado"). */
  sustituto: {},
});

// ---------- Solo datos ficticios en pantalla ----------
const IPS = [
  [/\b10\.\d{1,3}\.\d{1,3}\.(\d{1,3})\b/g, "192.0.2.$1"],
  [/\b192\.168\.\d{1,3}\.(\d{1,3})\b/g, "192.0.2.$1"],
  [/\b172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.(\d{1,3})\b/g, "192.0.2.$2"],
];
const fix = (s) => IPS.reduce((a, [re, to]) => a.replace(re, to), s);
const needs = (s) => s && IPS.some(([re]) => ((re.lastIndex = 0), re.test(s)));
new MutationObserver(() => {
  for (const el of document.querySelectorAll("[placeholder]")) {
    const p = el.getAttribute("placeholder");
    if (needs(p)) el.setAttribute("placeholder", fix(p));
  }
}).observe(document.documentElement, { subtree: true, childList: true });

// Token MCP de relleno: al activar el servidor la app lo genera con crypto.getRandomValues
// (24 bytes). Para la toma se usa un valor fijo; además se muestra enmascarado.
const grv = crypto.getRandomValues.bind(crypto);
crypto.getRandomValues = (a) => (a instanceof Uint8Array && a.length === 24 ? (a.fill(0x5a), a) : grv(a));

// ---------- Campus ----------
const CAMPUS = [
  ["core-sw01", "Campus/Núcleo"],
  ["acc-sw01", "Campus/Acceso"],
  ["acc-sw02", "Campus/Acceso"],
  ["rtr-borde01", "Campus/Borde"],
  ["sw-lab09", "Campus/Laboratorio"],
];
const now = Date.now();
const nuevas = [
  ...CAMPUS.map(([name, folder]) => ({ name, folder, host: EQUIPOS[name].host })),
  { name: "consola-core", folder: "Consolas", host: "192.0.2.250", save_password: true },
  { name: "Terminal local", type: "local", folder: "", host: "" },
].map((s, i) => ({
  id: `c${i}`,
  type: "ssh",
  username: s.type === "local" ? "" : "operador",
  port: 22,
  highlight: "cisco",
  serial_port: "",
  baud_rate: 9600,
  created_at: new Date(now - i * 86400000).toISOString(),
  ...s,
}));
M.sessions.splice(0, M.sessions.length, ...nuevas);
for (const s of M.sessions) if (s.type === "local") s.highlight = "default";

// ---------- Ajustes, notas y datos de partida ----------
const S = M.settings;
S.appTheme = "light";
S.confirmClose = false;
S.fontSize = 15;
delete S.macros; // botones de fábrica: "terminal length 0" e "Interfaces"
S.alertRules = [];
S.monitors = [];
S.commandSuggest = false;
S.commandSuggestSet = true;
// ?mcp=1: servidor MCP ya activo, sin Solo lectura y con el token de relleno de la toma.
if (location.search.includes("mcp=1")) Object.assign(S, { mcpEnabled: true, mcpReadOnly: false, mcpApproval: true, mcpToken: "5a".repeat(24) });
for (const k of Object.keys(M.notes)) delete M.notes[k];
Object.assign(M.notes, {
  "revision-puerto.txt": D.plantilla ?? "",
  "riesgo-encadenado.txt": "show version; reload",
  "accesos-consola.txt": "enable\n{{enable}}\nsnmp-server community {{comunidad}} RO\n",
  "contadores.txt": "clear counters {{interfaz}}\n",
  "turno-noche.txt": "Pendientes del turno:\n- Gi1/0/5 de acc-sw01 en err-disabled\n- Revisar errores de Gi1/0/7\n",
});
M.handlers.list_notes = () => Object.keys(M.notes).sort().map((name) => ({ name, modified: now, protected: false }));
localStorage.setItem("broadcastDelay", "1500");
localStorage.setItem("notesWidth", "600");

// ---------- Terminal ----------
const out = (conn, text) => {
  const ch = M.channels.get(conn);
  if (ch) M.cbs.get(ch.data)?.({ index: ch.index++, message: M.enc.encode(text).buffer });
};
const nombre = (conn) => M.connSessions.get(conn)?.name ?? "equipo";
const connDe = (n) => [...M.connSessions.entries()].reverse().find(([c, s]) => s.name === n && M.channels.has(c))?.[0];
const promptDe = (conn) => (M.connSessions.get(conn)?.type === "local" ? "operador@portatil ~ % " : `${nombre(conn)}#`);
const linea = new Map(); // conexión -> texto tecleado
const pidePassword = new Set(); // conexiones con "Password:" en pantalla
const tomadas = new Map(); // conexión -> run del script que la usa

const LOCAL = {
  "python3 --version": ["Python 3.12.7"],
  "iperf3 --version": ["iperf 3.17.1 (cJSON 1.7.15)", "Optional features available: CPU affinity setting, TCP congestion algorithm setting, sendfile / zerocopy, socket pacing, authentication, bind to device, support IPv4 don't fragment"],
  "ssh -V": ["OpenSSH_9.9p2, LibreSSL 3.3.6"],
  "command -v traceroute": ["/usr/sbin/traceroute"],
  "which python3": ["/opt/homebrew/bin/python3"],
};
const EXTRA = {
  // Botón de fábrica "Interfaces".
  "show ip interface brief": (n) => [
    "Interface              IP-Address      OK? Method Status                Protocol",
    `Vlan10                 ${EQUIPOS[n]?.host ?? "192.0.2.1"}      YES NVRAM  up                    up`,
    "GigabitEthernet1/0/1   unassigned      YES unset  up                    up",
    "GigabitEthernet1/0/5   unassigned      YES unset  down                  down",
  ],
};

/** Salida del equipo para una línea (arreglo, { lento }, { mudo }, { colgado } o null). */
function respuestaDe(conn, cmd) {
  const s = M.connSessions.get(conn);
  const c = cmd.trim();
  if (s?.type === "local") {
    if (!c) return [];
    if (c === "clear") return { limpiar: true };
    return LOCAL[c] ?? [`zsh: command not found: ${c.split(" ")[0]}`];
  }
  if (!c) return [];
  if (EXTRA[c]) return EXTRA[c](s.name);
  if (s.name === "consola-core") return c === "show clock" ? ["*10:42:17.311 UTC Sat Oct 24 2026"] : respuestaCampus(c, "core-sw01");
  return respuestaCampus(c, s.name) ?? ["                   ^", "% Invalid input detected at '^' marker."];
}

/** Escribe la respuesta de un comando y el prompt. */
async function responder(conn, cmd, { lento = 1 } = {}) {
  const r = respuestaDe(conn, cmd);
  out(conn, "\r\n");
  if (r?.limpiar) return out(conn, "\x1b[2J\x1b[H" + promptDe(conn));
  if (r?.mudo || r?.colgado) return; // el equipo no contesta
  if (r?.lento) {
    for (const l of r.parcial.slice(0, -1)) out(conn, l + "\r\n"), await wait(80);
    // Ping sin respuesta: un punto cada 2 s en Cisco; aquí más rápido (V.ritmo).
    for (const _ of r.parcial.at(-1)) out(conn, "."), await wait(700 * lento * V.ritmo);
    return { pendiente: async () => {
      for (const ch of r.resto[0]) out(conn, ch), await wait(700 * lento * V.ritmo);
      out(conn, "\r\n" + r.resto.slice(1).join("\r\n") + "\r\n" + promptDe(conn));
    } };
  }
  for (const l of r ?? []) {
    out(conn, l + "\r\n");
    await wait(30);
  }
  out(conn, promptDe(conn));
}

M.handlers.connect = ({ id, session, onData }) => {
  M.connSessions.set(id, session);
  M.channels.set(id, { data: onData.id, index: 0 });
  linea.set(id, "");
  if (session.type === "local") {
    setTimeout(() => out(id, promptDe(id)), 200);
    return null;
  }
  const banner = "\r\n\x1b[2mAcceso solo para personal autorizado. Equipo de laboratorio.\x1b[0m\r\n";
  // Con "comandos al conectar" el equipo pide la contraseña: se escribe en la terminal.
  if (session.on_connect && !session.save_password) {
    setTimeout(() => {
      out(id, banner + "\r\nPassword: ");
      pidePassword.add(id);
    }, 900 * V.ritmo);
    return null;
  }
  setTimeout(() => out(id, banner + "\r\n" + promptDe(id)), 200);
  return null;
};
M.handlers.disconnect = ({ id }) => {
  const ch = M.channels.get(id);
  if (ch) M.cbs.get(ch.data)?.({ end: true, index: ch.index });
  M.channels.delete(id);
  return null;
};

const colas = new Map(); // conexión -> promesa (respuestas en orden)
M.handlers.write = ({ id, data }) => {
  const run = tomadas.get(id);
  if (run) {
    M.emit("script-input-blocked", id);
    throw "Un script está usando esta sesión. Espera a que termine o usa Detener script.";
  }
  const texto = String(data);
  const tecla = texto.length === 1 || texto === "\r";
  const prev = colas.get(id) ?? Promise.resolve();
  colas.set(
    id,
    prev.then(async () => {
      for (let i = 0; i < texto.length; i++) {
        const ch = texto[i];
        if (ch === "\n" && texto[i - 1] === "\r") continue;
        if (pidePassword.has(id)) {
          // Contraseña: sin eco; con Enter el equipo muestra el prompt.
          if (ch === "\r" || ch === "\n") {
            pidePassword.delete(id);
            await wait(500);
            out(id, "\r\n\r\n" + promptDe(id));
          }
          continue;
        }
        if (ch === "\r" || ch === "\n") {
          const cmd = linea.get(id) ?? "";
          linea.set(id, "");
          await wait(tecla ? 60 : 120);
          const r = await responder(id, cmd);
          if (r?.pendiente) await r.pendiente();
        } else if (ch === "\x7f" || ch === "\b") {
          const l = linea.get(id) ?? "";
          if (l) linea.set(id, l.slice(0, -1)), out(id, "\b \b");
        } else if (ch === "\x03") {
          linea.set(id, ""), out(id, "^C\r\n" + promptDe(id));
        } else if (ch >= " ") {
          linea.set(id, (linea.get(id) ?? "") + ch);
          out(id, ch);
          if (!tecla) await wait(10);
        }
      }
    }),
  );
  return null;
};

// ---------- Scripts: lanzamiento, destinos tomados, control de riesgo, secretos ----------
M.handlers.list_scripts = () => [...V.scripts];
M.handlers.open_dir = () => null;
let runSeq = 0;
const runs = new Map(); // run -> { stop, script }
const prompts = new Map(); // `${run}/${id}` -> resolve
M.handlers.script_prompt_reply = ({ run, id, approve, value }) => {
  prompts.get(`${run}/${id}`)?.({ approve, hasValue: typeof value === "string" && value.length > 0 });
  prompts.delete(`${run}/${id}`);
  return null;
};
function preguntar(run, script, p) {
  const id = `q${++runSeq}`;
  return new Promise((resolve) => {
    prompts.set(`${run}/${id}`, resolve);
    M.emit("script-prompt", { run, id, script, ...p });
  }).finally(() => M.emit("script-prompt-closed", { run, id }));
}

class Detenido extends Error {}
/** Reproduce una línea de tiempo (pasos de datos.mjs) en las sesiones conectadas. */
async function reproducir(run, label, rec, conns, { allowChanges = false } = {}) {
  const st = runs.get(run);
  const vivo = () => {
    if (st.stop) throw new Detenido();
  };
  const log = (msg) => M.emit("script-event", { run, script: label, kind: "log", message: msg });
  const targets = rec.sesiones;
  const paso = async (p) => {
    vivo();
    const conn = p.sesion ? conns[p.sesion] : null;
    if (p.tipo === "log") {
      log(p.msg);
      await wait(650 * V.ritmo);
    } else if (p.tipo === "pausa") await wait(p.ms * V.ritmo);
    else if (p.tipo === "gate") {
      const r = await preguntar(run, label, { kind: "gate", line: p.linea, opaque: !!p.opaque, session: p.sesion, targets: p.targets ?? targets, allowChanges });
      if (!r.approve) {
        st.stop = `Rechazado: «${p.linea}» en ${p.sesion}. Script detenido.`;
        throw new Detenido();
      }
    } else if (p.tipo === "secreto") {
      const r = await preguntar(run, label, { kind: "secret", label: p.etiqueta });
      if (!r.approve) {
        st.stop = "El usuario canceló el ingreso del secreto";
        throw new Detenido();
      }
      await wait(300);
    } else if (p.tipo === "boveda") {
      // La app escribe la contraseña guardada (sin eco ni valor en ningún mensaje).
      await wait(700 * V.ritmo);
      pidePassword.delete(conn);
      out(conn, "\r\n\r\n" + promptDe(conn));
      await wait(400 * V.ritmo);
    } else if (p.tipo === "cmd") {
      for (const ch of p.cmd) {
        out(conn, ch);
        await wait(14);
      }
      await wait(150 * V.ritmo);
      vivo();
      if (p.pide) {
        out(conn, "\r\n" + p.pide);
        pidePassword.add(conn);
        await wait(500 * V.ritmo);
        return;
      }
      if (p.colgado) {
        // El equipo no contesta y la espera del script no vence: solo "Detener script" la corta.
        out(conn, "\r\n");
        await new Promise((res) => (st.colgado = res));
        vivo();
        return;
      }
      if (p.salida) {
        out(conn, "\r\n" + p.salida.join("\r\n") + "\r\n" + promptDe(conn));
        await wait(400 * V.ritmo);
        return;
      }
      const r = await responder(conn, p.cmd);
      const r0 = respuestaDe(conn, p.cmd);
      if (r0?.mudo) await wait(3200 * V.ritmo); // espera hasta el tiempo agotado
      if (r0?.colgado) await new Promise((res) => (st.colgado = res));
      return r;
    }
  };
  try {
    if (rec.paralelo) {
      // Varias sesiones: de a `parallel` a la vez, como for_each.
      const cola = [...rec.sesiones];
      const n = Math.max(1, Math.min(st.parallel ?? 1, cola.length));
      await Promise.all(
        Array.from({ length: n }, async () => {
          while (cola.length) {
            const s = cola.shift();
            for (const p of rec.porSesion[s]) await paso(p);
            await wait(250 * V.ritmo);
          }
        }),
      );
    }
    for (let i = 0; i < rec.pasos.length; i++) {
      const p = rec.pasos[i];
      const r = await paso(p);
      // Ping lento: el aviso de los 8 s sale mientras llegan los puntos; luego el resto.
      if (r?.pendiente) {
        const avisos = [];
        while (rec.pasos[i + 1]?.tras === "parcial") avisos.push(rec.pasos[++i]);
        for (const a of avisos) await paso(a);
        await r.pendiente();
        await wait(300 * V.ritmo);
      }
    }
    M.emit("script-event", { run, script: label, kind: "done", message: "Script finalizado" });
  } catch (e) {
    if (!(e instanceof Detenido)) throw e;
    M.emit("script-event", { run, script: label, kind: "error", message: typeof st.stop === "string" ? st.stop : "Detenido por el usuario" });
  } finally {
    for (const c of Object.values(conns)) if (tomadas.get(c) === run) tomadas.delete(c);
    runs.delete(run);
  }
}

M.handlers.run_script = ({ script, targets, options = {} }) => {
  const clave = V.sustituto[script] ?? script;
  const rec = D.scripts?.[clave];
  if (!rec) throw `Script no simulado en el video: ${script}`;
  const run = `r${++runSeq}`;
  // Sesiones por nombre: las de la línea de tiempo deben estar entre los destinos elegidos.
  const conns = {};
  for (const t of targets) conns[nombre(t.conn)] = t.conn;
  for (const s of rec.sesiones) if (!conns[s]) throw `La sesión "${s}" no está entre los destinos elegidos`;
  runs.set(run, { stop: false, script, parallel: options.parallel ?? 1 });
  for (const c of Object.values(conns)) tomadas.set(c, run);
  setTimeout(() => reproducir(run, script, rec, conns, options), 500);
  return run;
};
M.handlers.stop_script = ({ run }) => {
  const st = runs.get(run);
  if (st) {
    st.stop = true;
    st.colgado?.();
  }
  return null;
};

// ---------- Plugins ----------
// mock-video.js ya simula instalar, revisar, habilitar y desinstalar con D.plugins; aquí cambian
// las ejecuciones (líneas de tiempo reales) y el código de un plugin alterado.
M.handlers.plugin_run = ({ id, action, conn }) => {
  const st = window.__video.installed.get(id);
  if (!st?.enabled || st.tampered) throw "El plugin está deshabilitado";
  const rec = D.pluginRuns?.[id]?.[action];
  if (!rec) throw `Acción no simulada: ${action}`;
  const run = `p${++runSeq}`;
  const name = D.plugins[st.path].manifest.name;
  runs.set(run, { stop: false, script: name });
  setTimeout(() => reproducir(run, name, rec, { [nombre(conn)]: conn }), 300);
  return run;
};
M.handlers.python_status = () => {
  if (V.python !== "ok") throw "No se encontró Python 3. Instálalo (python.org o Homebrew en macOS) y usa Volver a detectar.";
  return "Python 3.12.7 (/opt/homebrew/bin/python3)";
};
M.handlers.python_redetect = M.handlers.python_status;

// ---------- Herramientas ----------
M.handlers.tool_iperf_version = () => V.iperf;
M.handlers.local_ips = () => [{ name: "en0", ip: "192.0.2.77" }];

// ---------- MCP ----------
M.handlers.mcp_configure = ({ enabled, port }) => (enabled ? `Escuchando en http://127.0.0.1:${port}/mcp` : "Apagado");
const pedidosIA = new Map();
/** Pedido de un agente (lo dispara el grabador): send_command con el riesgo que calcula la app. */
V.agente = (id, target, detail) => {
  pedidosIA.set(id, { target: target.split(" (")[0], detail });
  M.emit("mcp-approval", { id, tool: "send_command", target, detail });
};
M.handlers.mcp_decide = ({ id, approved }) => {
  const p = pedidosIA.get(id);
  M.emit("mcp-approval-closed", id);
  if (!p) return null;
  M.emit("mcp-activity", { tool: "send_command", target: p.target, detail: p.detail, ok: approved });
  const conn = connDe(p.target);
  if (approved && conn) M.handlers.write({ id: conn, data: p.detail + "\r" });
  return null;
};

// ---------- Rótulos (callouts) para el grabador ----------
// Recuadro y globo dentro de <body>: siguen a la cámara (transform de body).
const css = document.createElement("style");
css.textContent = `
.v3-hl{position:absolute;z-index:2147483600;pointer-events:none;border:3px solid #1d5be0;border-radius:10px;box-shadow:0 0 0 5px rgba(29,91,224,.16),0 6px 22px rgba(29,91,224,.25);opacity:0;transition:opacity .35s ease}
.v3-hl.on{opacity:1}
.v3-rot{position:absolute;z-index:2147483601;pointer-events:none;max-width:380px;padding:9px 14px 10px;border-radius:10px;background:#15233f;color:#fff;font:600 17px/1.3 system-ui,-apple-system,sans-serif;box-shadow:0 8px 24px rgba(15,23,42,.28);opacity:0;transform:translateY(6px);transition:opacity .35s ease,transform .35s ease}
.v3-rot.on{opacity:1;transform:none}
.v3-rot small{display:block;font-weight:500;font-size:14px;color:#c8d3ea;margin-top:2px}
.v3-rot::after{content:"";position:absolute;width:12px;height:12px;background:#15233f;transform:rotate(45deg)}
.v3-rot.abajo::after{top:-6px;left:var(--fx,24px)}
.v3-rot.arriba::after{bottom:-6px;left:var(--fx,24px)}
.v3-rot.izq::after{right:-6px;top:calc(50% - 6px)}
.v3-rot.der::after{left:-6px;top:calc(50% - 6px)}
.v3-rot.warn{background:#7a4a00}.v3-rot.warn::after{background:#7a4a00}
.v3-rot.ok{background:#11603a}.v3-rot.ok::after{background:#11603a}
`;
document.head.appendChild(css);
/**
 * Rótulo junto a un rectángulo de la vista [x, y, w, h] (coordenadas de pantalla, con zoom).
 * lado: "abajo" | "arriba" | "izq" | "der". Devuelve el id para quitarlo.
 */
window.__rotulo = (rect, texto, { lado = "abajo", recuadro = true, tono = "", nota = "", pad = 6 } = {}) => {
  const k = window.__cam ?? { z: 1, tx: 0, ty: 0 };
  const [x, y, w, h] = [(rect[0] - k.tx) / k.z, (rect[1] - k.ty) / k.z, rect[2] / k.z, rect[3] / k.z];
  const id = `r${Math.random().toString(36).slice(2, 8)}`;
  const els = [];
  if (recuadro) {
    const b = document.createElement("div");
    b.className = "v3-hl";
    Object.assign(b.style, { left: `${x - pad}px`, top: `${y - pad}px`, width: `${w + pad * 2}px`, height: `${h + pad * 2}px`, borderWidth: `${3 / k.z}px`, borderRadius: `${10 / k.z}px` });
    els.push(b);
  }
  if (texto) {
    const r = document.createElement("div");
    r.className = `v3-rot ${lado} ${tono}`;
    r.innerHTML = texto + (nota ? `<small>${nota}</small>` : "");
    r.style.fontSize = `${17 / k.z}px`;
    r.style.maxWidth = `${380 / k.z}px`;
    r.style.padding = `${9 / k.z}px ${14 / k.z}px ${10 / k.z}px`;
    document.body.appendChild(r);
    const rw = r.offsetWidth, rh = r.offsetHeight, gap = 14 / k.z;
    const W = 1440 / 1, H = 810;
    let left, top;
    if (lado === "abajo" || lado === "arriba") {
      left = Math.max(8, Math.min(x + w / 2 - 28 / k.z, (W - k.tx) / k.z - rw - 8));
      top = lado === "abajo" ? y + h + pad + gap : y - pad - gap - rh;
      r.style.setProperty("--fx", `${Math.max(10, Math.min(rw - 22, x + w / 2 - left - 6))}px`);
    } else {
      top = y + h / 2 - rh / 2;
      left = lado === "der" ? x + w + pad + gap : x - pad - gap - rw;
    }
    Object.assign(r.style, { left: `${left}px`, top: `${top}px` });
    els.push(r);
  }
  for (const e of els) {
    e.dataset.rot = id;
    if (!e.isConnected) document.body.appendChild(e);
    requestAnimationFrame(() => requestAnimationFrame(() => e.classList.add("on")));
  }
  return id;
};
window.__sinRotulos = (id) => {
  for (const e of document.querySelectorAll(id ? `[data-rot="${id}"]` : "[data-rot]")) {
    e.classList.remove("on");
    setTimeout(() => e.remove(), 400);
  }
};

// ---------- Lámina sobre la app ----------
// El escenario (escenario.html) en un iframe sobre la app, fuera de <body> para que no lo mueva
// la cámara. Sin eventos de puntero: los clics del grabador siguen llegando a la app.
V.lamina = (on) => {
  let f = document.getElementById("v3-lamina");
  if (!f) {
    f = document.createElement("iframe");
    f.id = "v3-lamina";
    f.src = new URL("./escenario.html", import.meta.url).href;
    Object.assign(f.style, { position: "fixed", left: "0", top: "0", width: "1440px", height: "810px", border: "0", zIndex: "2147483500", pointerEvents: "none", opacity: "0", transition: "opacity .45s ease", background: "transparent" });
    document.documentElement.appendChild(f);
  }
  if (on !== undefined) f.style.opacity = on ? "1" : "0";
  return !!f.contentWindow?.E;
};
V.laminaE = () => document.getElementById("v3-lamina").contentWindow.E;

// Avisos (toasts) un poco más largos que en la app (4 s) para leerlos en el video.
const st0 = window.setTimeout;
window.setTimeout = (fn, ms, ...a) => st0(fn, ms === 4000 ? 6500 : ms, ...a);

window.__v3.out = out;
window.__v3.connDe = connDe;
