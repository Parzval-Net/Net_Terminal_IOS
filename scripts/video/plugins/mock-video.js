// Extiende el backend simulado de las capturas (scripts/screenshots/mock.js) para el video de
// scripts y plugins. Todo es ficticio: el equipo responde con equipo-ficticio.js, y las salidas
// del script y del plugin vienen de ejecutar los archivos reales de docs/ejemplos con Python
// (las prepara grabar.mjs en window.__videoData antes de cargar la página).
import { respuesta } from "./equipo-ficticio.js";

const M = window.__mock;
const D = window.__videoData ?? {};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Sin WebGL: xterm usa su renderizador DOM, nítido con la cámara (zoom por CSS) y en headless.
const getContext = HTMLCanvasElement.prototype.getContext;
HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
  return /webgl/.test(type) ? null : getContext.call(this, type, ...rest);
};

// Solo IPs de documentación en pantalla: algunos ejemplos de la interfaz usan 10.0.0.1.
new MutationObserver(() => {
  for (const el of document.querySelectorAll('[placeholder*="10.0.0.1"]')) el.placeholder = el.placeholder.replaceAll("10.0.0.1", "192.0.2.10");
}).observe(document.documentElement, { subtree: true, childList: true });

// ---- Ajustes y datos de partida ----
M.settings.appTheme = "light";
M.settings.confirmClose = false;
M.settings.fontSize = 15;
M.settings.macros = [
  { id: "m1", label: "Versión", kind: "send", text: "show version" },
  { id: "m2", label: "Interfaces", kind: "send", text: "show interfaces | include line protocol" },
  { id: "m3", label: "Ping gestión", kind: "send", text: "ping 192.0.2.1" },
];
M.notes["riesgo-encadenado.txt"] = "show version; reload";

// ---- Terminal: banner limpio y eco de comandos con el equipo ficticio ----
const prompts = new Map(); // conexión -> prompt
function out(conn, text) {
  const ch = M.channels.get(conn);
  if (ch) M.cbs.get(ch.data)?.({ index: ch.index++, message: M.enc.encode(text).buffer });
}
M.handlers.connect = ({ id, session, onData }) => {
  M.connSessions.set(id, session);
  M.channels.set(id, { data: onData.id, index: 0 });
  const prompt = session.type === "local" ? "operador@portatil ~ % " : `${session.name}#`;
  prompts.set(id, prompt);
  const banner =
    session.type === "local"
      ? prompt
      : `\r\n\x1b[2mAcceso solo para personal autorizado. Equipo de laboratorio.\x1b[0m\r\n\r\n${prompt}`;
  setTimeout(() => out(id, banner), 200);
  return null;
};
const queue = new Map(); // conexión -> promesa en curso (respuestas en orden)
async function answer(conn, cmd) {
  const s = M.connSessions.get(conn);
  const lines = respuesta(cmd, s?.name ?? "equipo") ?? (cmd ? [`% Comando no simulado en el video: ${cmd}`] : []);
  out(conn, "\r\n");
  for (const l of lines) {
    await wait(60);
    out(conn, l + "\r\n");
  }
  out(conn, prompts.get(conn) ?? "#");
}
M.handlers.write = ({ id, data }) => {
  // Eco local de lo que escribe la app (botones, notas, comandos al conectar, scripts).
  const parts = String(data).split(/\r\n|\r|\n/);
  const cmds = parts.slice(0, -1);
  const prev = queue.get(id) ?? Promise.resolve();
  queue.set(
    id,
    prev.then(async () => {
      for (const c of cmds) {
        for (const ch of c) {
          out(id, ch);
          await wait(12);
        }
        await wait(120);
        await answer(id, c.trim());
      }
    }),
  );
  return null;
};
M.handlers.save_session = ({ session }) => {
  const i = M.sessions.findIndex((x) => x.id === session.id);
  const saved = { ...session, id: session.id || `v${Date.now()}` };
  if (i >= 0) M.sessions[i] = saved;
  else M.sessions.push(saved);
  return saved;
};

// ---- Scripts ----
M.handlers.list_scripts = () => ["ejemplo_respaldo.py", "resumen_equipo.py"];
M.handlers.open_dir = () => null;
let runSeq = 0;
/** Simula una ejecución: escribe los comandos en la sesión y emite los print() como eventos. */
async function simulate(run, label, conn, rec) {
  for (const c of rec?.commands ?? []) {
    if (conn) M.handlers.write({ id: conn, data: c + "\r" });
    await wait(900);
  }
  if (conn) await queue.get(conn);
  for (const l of rec?.logs ?? []) {
    M.emit("script-event", { run, script: label, kind: "log", message: l });
    await wait(450);
  }
  M.emit("script-event", { run, script: label, kind: "done", message: "Script finalizado" });
}
M.handlers.run_script = ({ id, script }) => {
  const run = `r${++runSeq}`;
  setTimeout(() => simulate(run, script, id, D.scripts?.[script]), 300);
  return run;
};
M.handlers.stop_script = () => null;

// ---- Packs de comandos ----
let userPacks = [...(D.userPacks ?? [])];
M.handlers.cmdpacks_list = () => userPacks;
M.handlers.cmdpack_save = ({ pack }) => ((userPacks = [...userPacks.filter((p) => p.id !== pack.id), pack]), pack.id);
M.handlers.cmdpack_delete = ({ id }) => ((userPacks = userPacks.filter((p) => p.id !== id)), null);
M.handlers.cmdpack_read = ({ path }) => {
  const f = D.files?.[path];
  if (!f) throw `No existe ${path}`;
  return JSON.parse(f);
};
M.handlers.cmdpack_export = () => null;

// ---- Diálogos nativos: la ruta la fija el guion de grabación ----
M.handlers["plugin:dialog|open"] = () => window.__nextOpen ?? null;
M.handlers["plugin:dialog|save"] = ({ options }) => `/Users/operador/Documentos/${options?.defaultPath ?? "pack.json"}`;

// ---- Plugins ----
const installed = new Map(); // id -> { version, enabled, tampered }
for (const p of D.installedPlugins ?? []) installed.set(p.id, p);
const pluginVersions = D.plugins ?? {}; // ruta -> { manifest, files, code }
let stagingSeq = 0;
const staged = new Map();
const info = (id) => {
  const st = installed.get(id);
  const v = pluginVersions[st.path];
  return { ...v.manifest, enabled: st.enabled && !st.tampered, tampered: !!st.tampered };
};
M.handlers.plugins_list = () => [...installed.keys()].map(info).sort((a, b) => a.name.localeCompare(b.name));
M.handlers.plugin_stage = ({ path }) => {
  const v = pluginVersions[path];
  if (!v) throw "No se encontró plugin.json";
  const staging = `0000000${++stagingSeq}-0000-4000-8000-000000000000`;
  staged.set(staging, path);
  return { staging, manifest: v.manifest, files: v.files, code: v.code, replaces: installed.has(v.manifest.id) ? v.manifest.id : null };
};
M.handlers.plugin_confirm = ({ staging }) => {
  const path = staged.get(staging);
  const v = pluginVersions[path];
  installed.set(v.manifest.id, { id: v.manifest.id, path, enabled: true, tampered: false });
  return v.manifest.name;
};
M.handlers.plugin_cancel = () => null;
M.handlers.plugin_code = ({ id }) => pluginVersions[(D.tamperedPath && installed.get(id)?.tampered ? D.tamperedPath : installed.get(id).path)].code;
M.handlers.plugin_set_enabled = ({ id, enabled }) => {
  const st = installed.get(id);
  if (enabled && st.tampered && D.tamperedPath) st.path = D.tamperedPath;
  Object.assign(st, { enabled, tampered: false });
  return null;
};
M.handlers.plugin_uninstall = ({ id }) => (installed.delete(id), null);
M.handlers.plugin_run = ({ id, action, conn }) => {
  const st = installed.get(id);
  if (!st?.enabled || st.tampered) throw "El plugin está deshabilitado";
  const run = `p${++runSeq}`;
  const name = pluginVersions[st.path].manifest.name;
  setTimeout(() => simulate(run, name, conn, D.pluginRuns?.[id]?.[action]), 200);
  return run;
};

// Utilidades para el guion de grabación (CDP).
window.__video = { installed, out, prompts };
