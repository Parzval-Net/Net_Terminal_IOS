// Tomas del video 3: qué se ve mientras se narra cada bloque (párrafo) de guion/*.txt. Cada toma
// ocupa uno o más bloques de un capítulo; `at(b, o, s)` espera al inicio de la oración `o` del
// bloque `b` (tiempos de tts_kokoro.py) más `s` segundos. Las tomas "app" usan la app real con el
// backend simulado (demo.html) y pueden mostrar una lámina encima (L/lamina); las de "escenario",
// láminas y código (escenario.html).
import { readFileSync } from "node:fs";
import { ROOT } from "../../plugins/python-simulado.mjs";
import { archivos, fragmentoBoveda, RUTA_PACKS, RUTA_PLUGIN } from "./datos.mjs";

export const NOMBRE = "NetTerminal-v3-automatizacion";
const HERR = "titulo:Herramientas: monitoreo";

// ---------- Íconos (lucide, ISC) como SVG interno ----------
function icono(nombre) {
  const src = readFileSync(`${ROOT}node_modules/lucide-react/dist/esm/icons/${nombre}.mjs`, "utf8");
  const nodos = [...src.matchAll(/\["(\w+)", \{([^}]*)\}\]/g)];
  return nodos.map(([, tag, attrs]) => `<${tag} ${[...attrs.matchAll(/(\w+): "([^"]*)"/g)].filter(([, k]) => k !== "key").map(([, k, v]) => `${k}="${v}"`).join(" ")}/>`).join("");
}
const I = {
  botones: icono("mouse-pointer-click"),
  plantillas: icono("braces"),
  conectar: icono("plug-zap"),
  scripts: icono("file-code-2"),
  plugins: icono("package"),
  packs: icono("book-open"),
  agentes: icono("bot"),
  mac: icono("laptop"),
  win: icono("monitor"),
  linux: icono("terminal"),
  candado: icono("shield-check"),
};
const SIETE = [
  { t: "Botones", icono: I.botones },
  { t: "Plantillas", icono: I.plantillas },
  { t: "Al conectar", icono: I.conectar },
  { t: "Scripts", icono: I.scripts },
  { t: "Plugins", icono: I.plugins },
  { t: "Packs", icono: I.packs },
  { t: "Agentes IA", icono: I.agentes },
];

// ---------- Ayudas ----------
const conectar = async (ctx, ...nombres) => {
  for (const n of nombres) {
    await ctx.p.dobleClic(`texto:${n}`, { ms: 0 });
    await ctx.sleep(450);
  }
  await ctx.sleep(500);
};
/** Rectángulo de la pestaña con ese título (barra de pestañas). */
const pestana = (p, nombre) =>
  p.ev(`(() => {
    const vis = (x) => { const b = x.getBoundingClientRect(); return b.width > 0 && b.top < 45 && b.left > 262; };
    const e = [...document.querySelectorAll('[title^="Doble clic: renombrar"]')].find((x) => vis(x) && x.textContent.trim().startsWith(a))
      ?? [...document.querySelectorAll("div, span, button")].filter(vis).find((x) => x.textContent.trim() === a && x.children.length <= 3);
    if (!e) return null; const b = e.getBoundingClientRect(); return [b.left, b.top, b.width, b.height]; })()`, nombre);
const activar = async (p, nombre, ms = 0) => {
  const r = await pestana(p, nombre);
  if (!r) throw new Error(`Sin pestaña ${nombre}`);
  await p.clic([r[0] + r[2] / 2, r[1] + r[3] / 2], { ms });
};
const instalado = (p, estado) =>
  p.ev(`(() => { window.__video.installed.clear(); for (const s of a) window.__video.installed.set(s.id, s); return true; })()`, estado);
const irAPlugins = async (p, ms = 0) => {
  await p.clic(HERR, { ms });
  await p.clic("texto:Plugins", { ms });
};
/** Recarga la lista de plugins (cambia de sección y vuelve). */
const recargarPlugins = async (p) => {
  // La lista se lee al abrir Herramientas: se cierra la pestaña y se vuelve a abrir (⌘W, ⌘E).
  await p.camara(1, 720, 405, 10);
  await p.atajo("meta+w");
  await new Promise((r) => setTimeout(r, 350));
  await p.atajo("meta+e");
  await new Promise((r) => setTimeout(r, 450));
  await p.clic("texto:Plugins", { ms: 300 });
  await new Promise((r) => setTimeout(r, 450));
};
/** Zoom a los avisos (toasts) de la esquina y rótulo junto a ellos. */
const avisos = async (p, texto, opts) => {
  const r = await p.rect("div.fixed.bottom-16");
  await p.zoomA([r[0] - 300, r[1] - 120, r[2] + 300, r[3] + 120], { margen: 20, max: 1.7, ms: 600 });
  await p.rotulo("div.fixed.bottom-16", texto, opts);
};
const centro = (r) => [r[0] + r[2] / 2, r[1] + r[3] / 2];
const V3 = (p, expr, a) => p.ev(`(() => { const V = window.__v3; ${expr}; return 1; })()`, a);
const sinDocstring = (t) => t.replace(/^"""[\s\S]*?"""\n/, "");
const lineaDe = (texto, re) => texto.split("\n").findIndex((l) => re.test(l)) + 1;
const textarea = (p, sel) => p.ev(`(() => { const t = window.__q(a); t.focus(); t.setSelectionRange(0, t.value.length); return 1; })()`, sel);
/** Abre el diálogo de lanzamiento de un script desde el menú Scripts. */
const abrirScript = async (p, script, ms = 500) => {
  await p.clic("texto:Scripts", { ms });
  await p.sleep?.(300);
  await new Promise((r) => setTimeout(r, 350));
  await p.clic(`texto:${script}`, { ms: Math.min(ms, 450) });
  await new Promise((r) => setTimeout(r, 400));
};
const destinoCarpeta = async (p, carpeta, raiz = "", ms = 450) => {
  await p.clic(`${raiz}texto:Todas las de una carpeta`, { ms });
  await new Promise((r) => setTimeout(r, 250));
  await p.valor(`${raiz}[aria-label="Carpeta de sesiones"]`, carpeta);
};
const capitulo = (n, titulo, sub) => ({
  id: `cap${String(n).padStart(2, "0")}`,
  cap: CAPS[n - 1],
  capitulo: titulo,
  pagina: "escenario",
  dur: 1.8,
  async run({ E }) {
    await E("capitulo", { kicker: `Capítulo ${n} de 11`, num: String(n).padStart(2, "0"), titulo, sub, total: 11 });
  },
});
const CAPS = ["01-principios", "02-botones", "03-plantillas", "04-al-conectar", "05-herramientas", "06-scripts", "07-plugins", "08-packs", "09-agentes-mcp", "10-buenas-practicas", "11-cierre"];

const CODIGO_PRIMER = sinDocstring(archivos.primer);
const CODIGO_PING = archivos.ping;
const CODIGO_INV = archivos.inventario;

export const TOMAS = [
  // ===================== 01 · Qué se puede automatizar =====================
  {
    id: "c01-portada", cap: "01-principios", capitulo: "Qué se puede automatizar", pagina: "escenario", bloques: [0], entrada: 0.4,
    async run({ E, at }) {
      await E("portada7", { kicker: "NetTerminal · Tutorial 3", h1: "Automatización: scripts,<br>plugins y programación", sub: "De lo más simple a lo más avanzado, siempre empezando por la lectura.", items: SIETE, sello: "Datos ficticios · IPs de documentación (RFC 5737)" });
      // Las siete funciones se encienden al nombrarlas en la primera oración.
      const marcas = [5.0, 5.6, 6.3, 7.4, 8.4, 9.1, 10.4];
      for (let i = 0; i < 7; i++) {
        await at(0, 0, marcas[i]);
        await E("encender", i + 1);
      }
    },
  },
  {
    id: "c01-semaforo", cap: "01-principios", pagina: "escenario", bloques: [1],
    async run({ E, at, sleep }) {
      await E("semaforo", {
        kicker: "Principio 1",
        titulo: "Cada comando se clasifica en tres niveles",
        niveles: [
          { clase: "read", t: "Consulta", nota: "show, ping, traceroute…" },
          { clase: "change", t: "Cambia config/estado", nota: "pide confirmación" },
          { clase: "disruptive", t: "Puede cortar servicio", nota: "siempre se confirma" },
        ],
        pie: "Etiquetas tal como aparecen en la app.",
      });
      await at(1, 1, 0.8);
      await E("revelar", 1);
      await sleep(500);
      await E("revelar", 2);
      await sleep(500);
      await E("revelar", 3);
      await at(1, 2, 0);
      await E("destacar", 1);
      await at(1, 2, 1.3);
      await E("destacar", 2);
      await at(1, 2, 3.2);
      await E("destacar", 3);
      await E("revelar", 4);
      await at(1, 3, 0);
      await E("destacar", 0);
      await E("caer", 0, "show interfaces status");
      await at(1, 3, 0.4);
      await E("caer", 1, "configure terminal", "no reconocido como consulta");
      await sleep(400);
    },
  },
  {
    id: "c01-encadenado", cap: "01-principios", pagina: "app", bloques: [2], extra: 0.6,
    async preparar(ctx) {
      await conectar(ctx, "acc-sw01");
      await ctx.p.atajo("meta+j");
      await ctx.sleep(500);
      await ctx.p.valor("aside:has(textarea) select", "riesgo-encadenado.txt");
      await ctx.sleep(400);
    },
    async run({ p, at, sleep }) {
      await at(2, 0, 0.3);
      await p.encuadrar("aside:has(textarea)", { margen: 20, max: 1.5, ms: 800 });
      await p.rotulo("aside textarea", "Dos comandos en una línea", { lado: "abajo", pad: 2 });
      await at(2, 1, 0);
      await p.camara(1, 720, 405, 500);
      await p.sinRotulos();
      await p.clic("aside textarea", { ms: 500 });
      await p.atajo("meta+Enter");
      await sleep(500);
      await p.encuadrar('[role="alertdialog"]', { margen: 70, max: 1.6, ms: 700 });
      await p.rotulo('[role="alertdialog"] h2', "Disruptivo: se confirma siempre", { lado: "arriba", tono: "warn", recuadro: false });
      await sleep(3400);
      await p.sinRotulos();
      await p.clic("texto:Cancelar", { ms: 500 });
      await p.camara(1, 720, 405, 500);
    },
  },
  {
    id: "c01-motor", cap: "01-principios", pagina: "escenario", bloques: [3],
    async run({ E, at }) {
      await E("columnas", {
        kicker: "Principio 3",
        titulo: "Casi todo pasa por el motor de riesgo",
        cols: [
          { titulo: "Pasa por el motor", tag: "Consulta · Cambio · Corte", tagFondo: "#e6f4ea", tagColor: "#1a7f37", html: "<ul><li>Botones de texto</li><li>Notas y catálogo</li><li>Envío a varias sesiones</li><li><b>Scripts y plugins:</b> cada línea, antes de su Enter</li></ul>" },
          { titulo: "No pasa", tag: "Se envía tal cual", tagFondo: "#fdf3dc", tagColor: "#8a5a00", html: "<ul><li>Comandos al conectar</li></ul><p style=\"margin:26px 0 0;font-size:21px;color:#5f6773\"><b style=\"color:#1b1f24\">Agentes de IA:</b> cada comando en un diálogo con el riesgo que calcula la app, y tú lo apruebas.</p>" },
        ],
      });
      await at(3, 0, 0.6);
      await E("revelar", 1);
      await at(3, 1, 0);
      await E("revelar", 2);
    },
  },
  {
    id: "c01-regla", cap: "01-principios", pagina: "escenario", bloques: [4], salida: 0.9,
    async run({ E }) {
      await E("frase", { kicker: "La regla de este video", t: "Primero, solo lectura." });
    },
  },

  // ===================== 02 · Botones =====================
  capitulo(2, "Botones de la barra de comandos", "Un clic para lo que repites cada día"),
  {
    id: "c02-barra", cap: "02-botones", pagina: "app", bloques: [0],
    async preparar(ctx) {
      await conectar(ctx, "acc-sw01");
    },
    async run({ p, at, sleep }) {
      await at(0, 0, 0.1);
      await p.camara(1.6, 620, 760, 900);
      const r = await p.rectDe("texto:terminal length 0", "titulo:Nuevo botón");
      await p.rotulo(r, "Barra de botones", { lado: "arriba", nota: "Ajustes › Terminal › Barra de botones (activada)" });
      await sleep(1200);
      await p.mover("texto:Interfaces", 600);
    },
  },
  {
    id: "c02-crear", cap: "02-botones", pagina: "app", bloques: [1], continuar: true,
    async run({ p, at, sleep }) {
      await p.sinRotulos();
      await p.clic("titulo:Nuevo botón", { ms: 600 });
      await p.camara(1, 720, 405, 400);
      await sleep(300);
      await p.encuadrar("form", { margen: 50, max: 1.55, ms: 700 });
      await at(1, 1, 0.1);
      await p.clic('input[placeholder="Ej: Respaldo config"]', { ms: 400 });
      await p.escribir("Revisar puerto", 16);
      await p.rotulo("texto:Enviar texto", "Enviar texto o Script Python", { lado: "abajo" });
      await at(1, 2, 0.2);
      await p.sinRotulos();
      await p.clic("form textarea", { ms: 400 });
      await at(1, 3, 0.4);
      await p.escribir("show interfaces ", 18);
      await p.escribir("{{interfaz}}", 12);
      await p.escribir(" status\nshow logging | include ", 22);
      await p.escribir("{{interfaz}}", 12);
      await at(1, 4, 0.3);
      await p.rotulo("form textarea", "Variable entre llaves dobles", { lado: "abajo", nota: "{{interfaz}} se pide al presionar el botón" });
      await sleep(1800);
      await p.sinRotulos();
      await p.clic("texto:Guardar", { ms: 400 });
      await p.camara(1, 720, 405, 500);
    },
  },
  {
    id: "c02-usar", cap: "02-botones", pagina: "app", bloques: [2], continuar: true, extra: 0.5,
    async run({ p, at, sleep }) {
      await at(2, 0, 0.1);
      await p.rotulo("texto:Revisar puerto", "Activo: hay una sesión conectada", { lado: "arriba", tono: "ok" });
      await at(2, 1, 0);
      await p.sinRotulos();
      await p.clic("texto:Revisar puerto", { ms: 500 });
      await sleep(400);
      await p.encuadrar('form', { margen: 60, max: 1.6, ms: 600 });
      await p.escribir("Gi1/0/5", 10);
      await sleep(500);
      await p.clic("texto:Continuar", { ms: 400 });
      await p.camara(1, 720, 405, 400);
      await at(2, 2, 0.1);
      await p.encuadrar('[role="alertdialog"]', { margen: 70, max: 1.6, ms: 600 });
      await p.rotulo('[role="alertdialog"] h2', "Resumen antes de enviar", { lado: "arriba", recuadro: false });
      await sleep(2600);
      await p.sinRotulos();
      await p.clic('[role="alertdialog"] texto:Enviar', { ms: 400 }).catch(() => p.clic("texto:Enviar", { ms: 300 }));
      await p.camara(1, 720, 405, 500);
      await sleep(900);
      await p.encuadrar(".xterm-screen", { margen: 10, max: 1.35, ms: 700 }).catch(() => {});
    },
  },
  {
    id: "c02-editar", cap: "02-botones", pagina: "app", bloques: [3], continuar: true, salida: 0.9,
    async run({ p, at, sleep }) {
      await p.camara(1.6, 620, 760, 700);
      await at(3, 0, 0.6);
      await p.clic("texto:Revisar puerto", { button: "right", ms: 500 });
      await sleep(400);
      await p.mover("texto:Editar", 400);
    },
  },

  // ===================== 03 · Plantillas =====================
  capitulo(3, "Plantillas con variables", "Notas que piden los valores antes de enviar"),
  {
    id: "c03-notas", cap: "03-plantillas", pagina: "app", bloques: [0],
    async preparar(ctx) {
      await conectar(ctx, "core-sw01", "acc-sw02", "acc-sw01");
    },
    async run({ p, at, sleep }) {
      await at(0, 0, 3.0);
      await p.atajo("meta+j");
      await sleep(400);
      await p.rotulo("aside:has(textarea)", "Notas · ⌘J", { lado: "izq", recuadro: false });
      await at(0, 1, 0);
      await p.valor("aside:has(textarea) select", "revision-puerto.txt");
      await sleep(300);
      await p.sinRotulos();
      await p.encuadrar("aside:has(textarea)", { margen: 16, max: 1.5, ms: 700 });
      await p.rotulo("aside textarea", "Plantilla: cuatro consultas con {{interfaz}}", { lado: "abajo", pad: 2 });
    },
  },
  {
    id: "c03-completar", cap: "03-plantillas", pagina: "app", bloques: [1], continuar: true,
    async run({ p, at, sleep }) {
      await at(1, 0, 0.3);
      await p.sinRotulos();
      await textarea(p, "aside textarea");
      await sleep(500);
      await p.camara(1, 720, 405, 500);
      await p.atajo("meta+Enter");
      await sleep(400);
      await at(1, 1, 0);
      await p.encuadrar('form', { margen: 60, max: 1.6, ms: 600 });
      await p.escribir("Gi1/0/5", 10);
      await p.rotulo('form pre', "Vista previa", { lado: "abajo", recuadro: true }).catch(() => {});
      await sleep(1600);
      await p.sinRotulos();
      await p.clic("texto:Continuar", { ms: 400 });
      await sleep(300);
      await p.clic('texto:Enviar', { ms: 400 });
      await p.camara(1, 720, 405, 400);
      await at(1, 2, 0.6);
      // Variables con pinta de secreto: campos ocultos y vista previa enmascarada (no se envía).
      await p.valor("aside:has(textarea) select", "accesos-consola.txt");
      await sleep(400);
      await textarea(p, "aside textarea");
      await p.atajo("meta+Enter");
      await sleep(500);
      await p.encuadrar('form', { margen: 60, max: 1.6, ms: 600 });
      await p.escribir("demo-clave-2026", 16);
      await p.atajo("Tab");
      await p.escribir("demo-comunidad", 16);
      await p.rotulo('form input[type="password"]', "Se piden ocultos y nunca se guardan", { lado: "abajo", tono: "warn" });
      await sleep(2600);
      await p.sinRotulos();
      await p.clic("texto:Cancelar", { ms: 400 });
      await p.camara(1, 720, 405, 400);
    },
  },
  {
    id: "c03-destino", cap: "03-plantillas", pagina: "app", bloques: [2], continuar: true,
    async run({ p, at, sleep }) {
      await p.valor("aside:has(textarea) select", "revision-puerto.txt");
      await at(2, 0, 0.2);
      await p.clic("aside:has(textarea) titulo:Elegir a qué sesiones se envía", { ms: 600 }).catch(() => p.clic("titulo:Elegir a qué sesiones se envía", { ms: 600 }));
      await sleep(300);
      const r = await p.rectDe("texto:Pestaña actual", "texto:Paneles visibles (vista dividida)");
      await p.rotulo(r, "Destino del envío", { lado: "izq", pad: 8 });
      await sleep(1500);
      await p.mover("texto:Pestañas elegidas", 500);
      await at(2, 0, 4.4);
      await p.sinRotulos();
      await destinoCarpeta(p, "Campus/Acceso");
      await sleep(400);
      await at(2, 1, 0);
      await p.ev(`document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }))`);
      await p.rotulo("aside:has(textarea) titulo:Elegir a qué sesiones se envía", "Carpeta Campus/Acceso: acc-sw01 y acc-sw02", { lado: "arriba" }).catch(() => {});
    },
  },
  {
    id: "c03-envio", cap: "03-plantillas", pagina: "app", bloques: [3], continuar: true, extra: 1.4,
    async preparar() {},
    async run({ p, at, sleep }) {
      await p.sinRotulos();
      await at(3, 0, 0.1);
      // Primero una línea que no es consulta: el diálogo pide la cantidad de equipos.
      await p.ev(`(window.__mock.notes["contadores.txt"] = "clear counters {{interfaz}}", 1)`);
      await p.valor("aside textarea", "clear counters {{interfaz}}");
      await sleep(200);
      await textarea(p, "aside textarea");
      await p.atajo("meta+Enter");
      await sleep(400);
      await p.clic("texto:Continuar", { ms: 400 });
      await sleep(400);
      await p.encuadrar('[aria-labelledby="bc-title"]', { margen: 40, max: 1.3, ms: 600 });
      await p.rotulo('[aria-labelledby="bc-title"] h2', "Equipos, omitidos y riesgo", { lado: "arriba", recuadro: false });
      await at(3, 1, 0.2);
      await p.sinRotulos();
      await p.rotulo("texto:Para confirmar, escribe la cantidad de equipos (2)", "No es consulta: confirmas con la cantidad", { lado: "abajo", tono: "warn" });
      await p.clic('[aria-labelledby="bc-title"] input[inputmode="numeric"]', { ms: 400 }).catch(() => {});
      await p.escribir("2", 4);
      await sleep(1400);
      await p.sinRotulos();
      await p.clic("texto:Cancelar", { ms: 300 });
      await p.camara(1, 720, 405, 300);
      // Ahora la plantilla de consulta: se envía de un equipo a otro.
      await p.valor("aside textarea", archivos.plantilla);
      await at(3, 2, 0);
      await textarea(p, "aside textarea");
      await p.atajo("meta+Enter");
      await sleep(350);
      await p.clic("texto:Continuar", { ms: 300 });
      await sleep(300);
      await p.rotulo("texto:Pausa entre equipos", "Pausa ajustable", { lado: "arriba" }).catch(() => {});
      await sleep(700);
      await p.sinRotulos();
      await p.clic('[aria-labelledby="bc-title"] footer button:last-child', { ms: 400 });
      await sleep(500);
      await p.rotulo("texto:Detener", "Se puede detener", { lado: "arriba" }).catch(() => {});
    },
  },

  // ===================== 04 · Comandos al conectar =====================
  capitulo(4, "Comandos al conectar", "Preparar la sesión apenas se abre"),
  {
    id: "c04-editar", cap: "04-al-conectar", pagina: "app", bloques: [0],
    async run({ p, at, sleep }) {
      await at(0, 0, 0.2);
      await p.mover("texto:acc-sw02", 700);
      await at(0, 1, 0);
      await p.clic('[title^="operador@192.0.2.12"] [title="Editar"]', { ms: 400 });
      await sleep(500);
      await p.clic("texto:Opciones de terminal", { ms: 500 });
      await sleep(300);
      await p.ev(`(() => { [...document.querySelectorAll("details")].find((x) => x.textContent.includes("Opciones de terminal"))?.scrollIntoView({ block: "center" }); return 1; })()`);
      await p.encuadrar('textarea[placeholder^="terminal length"]', { margen: 150, max: 1.6, ms: 600 });
      await p.clic('textarea[placeholder^="terminal length"]', { ms: 400 });
      await at(0, 2, 0.5);
      await p.escribir("terminal length 0", 14);
      await p.rotulo('textarea[placeholder^="terminal length"]', "Cisco: terminal length 0", { lado: "abajo", nota: "Huawei: screen-length 0 temporary" });
      await sleep(1600);
    },
  },
  {
    id: "c04-conectar", cap: "04-al-conectar", pagina: "app", bloques: [1], continuar: true, extra: 0.6,
    async run({ p, at, sleep }) {
      await p.sinRotulos();
      await p.camara(1, 720, 405, 300);
      await p.clic("texto:Guardar y conectar", { ms: 400 });
      await V3(p, "V.ritmo = 2.2");
      await sleep(400);
      await p.camara(1.45, 760, 250, 700);
      await at(1, 1, 0.3);
      await p.rotulo({ base: [266, 129, 90, 22] }, "Espera el prompt: # > $ % ]", { lado: "der", nota: "o 1,5 s de silencio" });
      await at(1, 2, 0.4);
      await p.sinRotulos();
      await p.rotulo({ base: [266, 129, 90, 22] }, "Pedido de contraseña: no envía nada", { lado: "der", tono: "warn", nota: "Espera hasta 2 minutos" });
      await sleep(2600);
      await p.sinRotulos();
      await p.clic(".xterm-screen", { ms: 300, dx: 0.3, dy: 0.2 });
      await p.escribir("demo-clave-2026\n", 14);
      await sleep(900);
      await p.rotulo({ base: [266, 171, 300, 22] }, "Prompt detectado: envía terminal length 0", { lado: "der", tono: "ok" });
      await V3(p, "V.ritmo = 1");
    },
  },
  {
    id: "c04-notas", cap: "04-al-conectar", pagina: "escenario", bloques: [2],
    async run({ E, at }) {
      await E("lista", {
        kicker: "Comandos al conectar",
        titulo: "Úsalos solo para preparar la sesión",
        items: [
          { ico: "dot", texto: "En cada conexión y en cada reconexión" },
          { ico: "warn", texto: "Sin motor de riesgo: se envían tal cual" },
          { ico: "no", texto: "Nunca se importan", nota: "Ni desde otros clientes ni desde archivos JSON" },
        ],
      });
      await at(2, 0, 0.3);
      await E("revelar", 1);
      await at(2, 0, 3.4);
      await E("revelar", 2);
      await at(2, 1, 0.2);
      await E("revelar", 3);
    },
  },

  // ===================== 05 · Instalar las herramientas =====================
  capitulo(5, "Instalar las herramientas", "Python 3, iperf3, OpenSSH y traceroute"),
  {
    id: "c05-terminal", cap: "05-herramientas", pagina: "app", bloques: [0],
    async preparar(ctx) {
      await ctx.lamina();
    },
    async run({ p, at, sleep }) {
      await at(0, 1, 2.6);
      await p.atajo("meta+t");
      await sleep(700);
      await p.rotulo({ base: [266, 46, 420, 26] }, "Terminal local · ⌘T", { lado: "abajo", recuadro: false, nota: "Windows y Linux: Ctrl+Shift+T" });
      await sleep(600);
      await p.escribir("python3 --version\n", 14);
    },
  },
  {
    id: "c05-python", cap: "05-herramientas", pagina: "app", bloques: [1], continuar: true, extra: 0.6,
    async run({ p, L, lamina, at, sleep }) {
      await p.sinRotulos();
      await L("so", {
        kicker: "Python 3 · scripts y plugins",
        cols: [
          { so: "macOS", icono: I.mac, filas: [{ k: "Fuente oficial", t: "python.org/downloads" }, { k: "Comprobar", code: "python3 --version" }, { k: "La app prefiere", t: "Python de Homebrew o de python.org" }] },
          { so: "Windows", icono: I.win, filas: [{ k: "Fuente oficial", t: "python.org/downloads" }, { k: "Comprobar (PowerShell)", code: "py -3 --version" }, { k: "La app usa", t: "el lanzador <code>py</code>" }] },
          { so: "Linux", icono: I.linux, filas: [{ k: "Casi siempre instalado", t: "Si falta, con el gestor de paquetes:" }, { code: "sudo apt install python3\nsudo dnf install python3" }, { k: "Comprobar", code: "python3 --version" }] },
        ],
      });
      await lamina(true);
      await at(1, 0, 0.6);
      await L("revelarCol", 0);
      await L("revelarCol", 1);
      await at(1, 1, 4.6);
      await L("revelarCol", 2);
      await at(1, 2, 0);
      await L("destacar", [7, 3]);
      await at(1, 3, 0);
      // Herramientas › Plugins: sin Python, el aviso real; luego "Volver a detectar".
      await V3(p, `V.python = "none"`);
      await irAPlugins(p);
      await sleep(300);
      await p.zoomA(await p.rectDe("texto:Python: No se encontró", "titulo:Volver a detectar Python"), { margen: 30, max: 1.5, ms: 10 });
      await lamina(false);
      await p.rotulo("titulo:Volver a detectar Python", "Tras instalarlo, sin reiniciar la app", { lado: "abajo" });
      await sleep(1700);
      await V3(p, `V.python = "ok"`);
      await p.sinRotulos();
      await p.clic("titulo:Volver a detectar Python", { ms: 400 });
      await sleep(400);
      await p.rotulo("texto:Python: Python 3.12.7", "Python detectado", { lado: "abajo", tono: "ok" });
    },
  },
  {
    id: "c05-iperf", cap: "05-herramientas", pagina: "app", bloques: [2], continuar: true,
    async run({ p, L, lamina, at, sleep }) {
      await p.sinRotulos();
      await V3(p, "V.iperf = null");
      await p.camara(1, 720, 405, 10);
      await p.clic("texto:Velocidad", { ms: 0 });
      await sleep(300);
      await p.ev(`(() => { [...document.querySelectorAll("h3, div")].find((x) => x.textContent.trim() === "iperf3")?.scrollIntoView({ block: "center" }); return 1; })()`);
      await at(2, 0, 0.3);
      await p.zoomA(await p.rectDe("texto:iperf3 no está instalado", "texto:Windows: búscalo"), { margen: 30, max: 1.6, ms: 700 });
      await at(2, 1, 0.2);
      await p.rotulo("texto:brew install iperf3", "macOS: Homebrew", { lado: "der" });
      await sleep(1700);
      await p.rotulo("texto:sudo apt install iperf3", "Linux: gestor de paquetes", { lado: "abajo" });
      await at(2, 2, 0);
      await p.sinRotulos();
      await L("so", {
        kicker: "iperf3 · prueba de velocidad",
        cols: [
          { so: "macOS", icono: I.mac, filas: [{ k: "Homebrew", code: "brew install iperf3" }, { k: "Comprobar", code: "iperf3 --version" }] },
          { so: "Windows", icono: I.win, filas: [{ k: "Sin binarios oficiales", t: "ESnet (proyecto iperf) no publica binarios." }, { k: "iperf.fr", t: "Enlaza compilaciones de terceros: verifica su origen." }, { k: "Dónde dejarlo", t: "<code>iperf3.exe</code> junto a NetTerminal o en el PATH" }] },
          { so: "Linux", icono: I.linux, filas: [{ k: "Gestor de paquetes", code: "sudo apt install iperf3\nsudo dnf install iperf3" }, { k: "Comprobar", code: "iperf3 --version" }] },
        ],
        pie: "Fuentes: software.es.net/iperf/obtaining.html · iperf.fr/iperf-download.php",
      });
      await L("revelar");
      await lamina(true);
      await sleep(600);
      await L("destacar", 5);
    },
  },
  {
    id: "c05-ssh", cap: "05-herramientas", pagina: "app", bloques: [3], continuar: true,
    async run({ p, L, lamina, at, sleep }) {
      await p.camara(1, 720, 405, 10);
      await activar(p, "Terminal local");
      await lamina(false);
      await sleep(200);
      await at(3, 0, 0.6);
      await p.escribir("ssh -V\n", 12);
      await sleep(700);
      await p.rotulo({ base: [266, 108, 300, 22] }, "macOS ya lo incluye", { lado: "abajo", tono: "ok" });
      await at(3, 1, 0);
      await p.sinRotulos();
      await L("so", {
        kicker: "Cliente OpenSSH · ssh, scp y sftp",
        cols: [
          { so: "macOS", icono: I.mac, filas: [{ k: "Incluido", t: "Viene con el sistema." }, { k: "Comprobar", code: "ssh -V" }] },
          { so: "Windows", icono: I.win, filas: [{ k: "Característica opcional", t: "Configuración › Sistema › Características opcionales › <b>OpenSSH Client</b>" }, { k: "PowerShell como administrador", code: "Add-WindowsCapability -Online -Name OpenSSH.Client~~~~0.0.1.0" }] },
          { so: "Linux", icono: I.linux, filas: [{ k: "Debian y Ubuntu", code: "sudo apt install openssh-client" }, { k: "Fedora y Red Hat", code: "sudo dnf install openssh-clients" }] },
        ],
        pie: "Fuente: Microsoft Learn, «Get started with OpenSSH for Windows».",
      });
      await L("revelar");
      await lamina(true);
      await L("destacar", [9, 10]);
      await at(3, 2, 0);
      await L("destacar", [5, 6]);
    },
  },
  {
    id: "c05-trace", cap: "05-herramientas", pagina: "app", bloques: [4], continuar: true, salida: 0.8,
    async run({ L, at, sleep }) {
      await L("so", {
        kicker: "Traceroute y Telnet",
        cols: [
          { so: "macOS", icono: I.mac, filas: [{ k: "Incluido", code: "traceroute" }] },
          { so: "Windows", icono: I.win, filas: [{ k: "Incluido", code: "tracert" }] },
          { so: "Linux", icono: I.linux, filas: [{ k: "La app usa", code: "traceroute\ntracepath" }] },
        ],
        pie: "Telnet: cliente propio dentro de NetTerminal, sin instalar nada.",
      });
      await sleep(200);
      await L("revelarCol", 1);
      await L("revelarCol", 0);
      await at(4, 1, 0);
      await L("revelarCol", 2);
      await at(4, 2, 0);
      await L("revelar");
      await L("destacar", 10);
    },
  },

  // ===================== 06 · Scripts de Python =====================
  capitulo(6, "Scripts de Python", "La API netterminal: de una sesión a varias"),
  {
    id: "c06-menu", cap: "06-scripts", pagina: "app", bloques: [0],
    async preparar(ctx) {
      await conectar(ctx, "core-sw01");
      await ctx.lamina();
    },
    async run({ p, L, lamina, at, sleep }) {
      await at(0, 0, 0.4);
      await p.clic("texto:Scripts", { ms: 700 });
      await sleep(300);
      await p.zoomA(await p.rectDe("texto:ejemplo_respaldo.py", "texto:Abrir carpeta de scripts", "texto:Scripts"), { margen: 60, max: 1.9, ms: 700 });
      await at(0, 0, 4.3);
      await p.mover("texto:Abrir carpeta de scripts", 500);
      await at(0, 1, 0);
      await L("finder", {
        kicker: "Carpeta de scripts",
        carpeta: "scripts",
        ruta: "/Users/operador/NetTerminal/data/scripts",
        archivos: [
          { n: "netterminal.py", t: "Módulo de la app (no se instala)", marca: true },
          { n: "ejemplo_respaldo.py", t: "Script de Python" },
          { n: "inventario_csv.py", t: "Script de Python" },
          { n: "ping_destinos.py", t: "Script de Python" },
          { n: "primer_script.py", t: "Script de Python" },
        ],
      });
      await L("revelar");
      await p.camara(1, 720, 405, 10);
      await p.atajo("Escape");
      await lamina(true);
    },
  },
  {
    id: "c06-dialogo", cap: "06-scripts", pagina: "app", bloques: [1], continuar: true,
    async run({ p, lamina, at, sleep }) {
      await abrirScript(p, "primer_script.py", 0);
      await lamina(false);
      await at(1, 0, 0.4);
      await p.encuadrar('[aria-labelledby="sl-title"]', { margen: 30, max: 1.55, ms: 800 });
      await at(1, 1, 0);
      const destino = await p.rectDe('[aria-labelledby="sl-title"] texto:Pestaña actual', '[aria-labelledby="sl-title"] texto:Paneles visibles (vista dividida)');
      await p.rotulo(destino, "Destino: el mismo selector del envío", { lado: "der", pad: 6 });
      await at(1, 2, 0);
      await p.sinRotulos();
      await p.rotulo('[aria-labelledby="sl-title"] p[aria-live="polite"]', "Solo puede usar estas sesiones", { lado: "der" });
      await at(1, 3, 0);
      await p.sinRotulos();
      await p.rotulo("texto:Permitir cambios", "Apagado: cada cambio pide confirmación", { lado: "der", nota: "Lo que puede cortar servicio se confirma siempre" });
      await at(1, 4, 0);
      await p.sinRotulos();
      const r = await p.rectDe("texto:En paralelo", "texto:Tiempo máximo");
      await p.rotulo([r[0], r[1], r[2] + 110, r[3]], "Hasta 4 en paralelo · tiempo máximo", { lado: "abajo" });
      await sleep(2600);
      await p.sinRotulos();
      await p.clic("texto:Cancelar", { ms: 400 });
      await p.camara(1, 720, 405, 400);
    },
  },
  {
    id: "c06-tomada", cap: "06-scripts", pagina: "app", bloques: [2], extra: 0.6,
    async preparar(ctx) {
      await conectar(ctx, "sw-lab09");
      await V3(ctx.p, `V.sustituto["inventario_csv.py"] = "inventario_csv.py@colgado"`);
      await abrirScript(ctx.p, "inventario_csv.py", 0);
      await ctx.p.clic('[aria-labelledby="sl-title"] button[type="submit"]', { ms: 0 });
      await ctx.sleep(1500);
    },
    async run({ p, at, sleep }) {
      await at(2, 0, 0.3);
      await p.clic(".xterm-screen", { ms: 400, dx: 0.4, dy: 0.3 });
      await p.escribir("show clock", 12);
      await sleep(400);
      await p.rotulo({ base: [266, 129, 380, 22] }, "Sesión tomada por el script: no se envía", { lado: "abajo", tono: "warn" });
      await at(2, 0, 4.6);
      await p.sinRotulos();
      await p.camara(1.6, 1250, 760, 600);
      await p.rotulo("titulo:Detener script", "Detener script", { lado: "arriba" });
      await sleep(900);
      await p.clic("titulo:Detener script", { ms: 400 });
      await sleep(500);
      await p.sinRotulos();
      await p.camara(1, 720, 405, 600);
    },
  },
  {
    id: "c06-primer", cap: "06-scripts", pagina: "app", bloques: [3], extra: 1.0,
    async preparar(ctx) {
      await conectar(ctx, "core-sw01");
      await ctx.lamina();
      await V3(ctx.p, "V.ritmo = 0.9");
    },
    async run({ p, L, lamina, at, sleep, tiempo }) {
      await L("codigo", { kicker: "Primer script", archivo: "primer_script.py", ruta: "docs/ejemplos/scripts/", lenguaje: "python", fs: 23, texto: "", caret: true });
      await lamina(true);
      await at(3, 0, 0.3);
      const seg = tiempo(3, 1) - tiempo(3, 0) - 1.6;
      await L("escribir", CODIGO_PRIMER, Math.ceil(CODIGO_PRIMER.length / seg));
      await L("marcar", { hl: [lineaDe(CODIGO_PRIMER, /nt\.session\.get\("name"/), lineaDe(CODIGO_PRIMER, /nt\.run\(/)] });
      // Se lanza detrás de la lámina: al quitarla ya llegan los avisos.
      await abrirScript(p, "primer_script.py", 0);
      await p.clic('[aria-labelledby="sl-title"] button[type="submit"]', { ms: 0 });
      await at(3, 1, 0);
      await lamina(false);
      await sleep(900);
      await avisos(p, "print() aparece como aviso", { lado: "izq" });
    },
  },
  {
    id: "c06-piezas", cap: "06-scripts", pagina: "escenario", bloques: [4],
    async run({ E, at, sleep }) {
      await E("diagrama", {
        kicker: "Más control",
        titulo: "run(cmd) se arma con cuatro piezas",
        cajas: [
          { b: "clear()", t: "Descarta la salida anterior" },
          { b: "sendline(cmd)", t: "Envía la línea con Enter" },
          { b: "wait_for(prompt)", t: "Espera el prompt, con <code>timeout</code>" },
          { b: "read()", t: "Lee hasta que el equipo deja de enviar" },
        ],
        flechas: ["", "", ""],
        pie: "<code>expect()</code> es <code>wait_for()</code> que devuelve solo hasta la coincidencia.",
      });
      const t = [1.2, 3.0, 5.2, 7.6, 10.4];
      for (let i = 0; i < 4; i++) {
        await at(4, 0, t[i]);
        await E("revelar", i * 2 + 1);
      }
      await at(4, 0, t[4]);
      await E("revelar");
    },
  },
  {
    id: "c06-ping", cap: "06-scripts", pagina: "app", bloques: [5], extra: 2.4,
    async preparar(ctx) {
      await conectar(ctx, "core-sw01");
      await ctx.lamina();
      await V3(ctx.p, "V.ritmo = 0.6");
    },
    async run({ p, L, lamina, at, sleep }) {
      await L("codigo", { kicker: "Segundo script", archivo: "ping_destinos.py", ruta: "docs/ejemplos/scripts/", lenguaje: "python", fs: 19, texto: CODIGO_PING });
      const ini = lineaDe(CODIGO_PING, /^for destino in DESTINOS/);
      const exc = lineaDe(CODIGO_PING, /except nt\.ScriptTimeout/);
      await L("marcar", { hl: [lineaDe(CODIGO_PING, /^DESTINOS/)], seguir: 16 });
      await lamina(true);
      await at(5, 0, 0.8);
      await L("marcar", { hl: [ini, ini + 1, ini + 2, ini + 3, ini + 4, ini + 5], seguir: ini + 8 });
      await at(5, 1, 0);
      await L("marcar", { hl: [ini + 4, ini + 5], seguir: ini + 8 });
      await at(5, 1, 3.0);
      await L("marcar", { hl: [exc, exc + 1, exc + 2, exc + 3, exc + 4, exc + 5], seguir: exc + 7 });
      await abrirScript(p, "ping_destinos.py", 0);
      await p.clic('[aria-labelledby="sl-title"] button[type="submit"]', { ms: 0 });
      await at(5, 2, 0);
      await lamina(false);
      await sleep(5200);
      await avisos(p, "198.51.100.20: el prompt no vuelve en 8 s", { lado: "izq", tono: "warn", nota: "Pausa acortada en el video" });
    },
  },
  {
    id: "c06-inventario", cap: "06-scripts", pagina: "app", bloques: [6], extra: 2.4,
    async preparar(ctx) {
      await conectar(ctx, "rtr-borde01", "sw-lab09", "acc-sw01", "acc-sw02", "core-sw01");
      await ctx.lamina();
      await V3(ctx.p, "V.ritmo = 0.55");
    },
    async run({ p, L, E, lamina, at, sleep }) {
      const inv = CODIGO_INV;
      await L("codigo", { kicker: "Script avanzado", archivo: "inventario_csv.py", ruta: "docs/ejemplos/scripts/", lenguaje: "python", fs: 18, texto: inv });
      await L("marcar", { hl: [lineaDe(inv, /^def inventariar/)], seguir: lineaDe(inv, /^def inventariar/) + 14 });
      await lamina(true);
      await at(6, 1, 0);
      const s = lineaDe(inv, /destinos = nt\.sessions\(\)/);
      await L("marcar", { hl: [s, s + 1], seguir: s + 8 });
      await at(6, 1, 4.0);
      await L("marcar", { hl: [lineaDe(inv, /def inventariar\(s\)/), lineaDe(inv, /^def inventariar/) + 1], seguir: lineaDe(inv, /^def inventariar/) + 18 });
      await at(6, 1, 6.6);
      await L("marcar", { hl: [s + 1], seguir: s + 8 });
      await at(6, 2, 0);
      const r = lineaDe(inv, /s\.run\("terminal length 0"/);
      await L("marcar", { hl: [r, r + 1, r + 2], seguir: r + 10 });
      await at(6, 2, 1.8);
      // Lanzamiento con destino "Todas las de una carpeta" › Campus y dos en paralelo.
      await abrirScript(p, "inventario_csv.py", 0);
      await lamina(false);
      await p.encuadrar('[aria-labelledby="sl-title"]', { margen: 30, max: 1.45, ms: 500 });
      await destinoCarpeta(p, "Campus", '[aria-labelledby="sl-title"] ', 350);
      await sleep(300);
      await p.valor('[aria-labelledby="sl-title"] select:not([aria-label])', "2");
      await p.rotulo('[aria-labelledby="sl-title"] p[aria-live="polite"]', "5 sesiones · 2 en paralelo", { lado: "der" });
      await sleep(800);
      await p.sinRotulos();
      await p.clic('[aria-labelledby="sl-title"] button[type="submit"]', { ms: 400 });
      await p.camara(1, 720, 405, 400);
      await at(6, 3, 0);
      await activar(p, "rtr-borde01", 400);
      await sleep(300);
      await p.rotulo({ base: [266, 50, 760, 420] }, "Router: sin show interfaces status", { lado: "der", recuadro: false, tono: "warn", nota: "El script lo anota en vez de fallar" });
      await at(6, 3, 4.6);
      await p.sinRotulos();
      await activar(p, "sw-lab09", 400);
      await p.rotulo({ base: [266, 50, 560, 140] }, "Sin respuesta: fila marcada con el motivo", { lado: "der", recuadro: false, tono: "warn" });
      await sleep(2600);
      await p.sinRotulos();
      // El CSV que escribió la ejecución real.
      const { cab, filas } = CSV_INV;
      const ver = ["equipo", "host", "modelo", "version", "conectados", "err_disabled", "resultado"];
      await L("tabla", {
        kicker: "reportes/inventario.csv",
        titulo: "Una fila por equipo",
        columnas: ver,
        filas: filas.map((f) => ver.map((c) => `<span style="font-size:19px">${f[cab.indexOf(c)] || "<span style=\"color:#a3a9b3\">·</span>"}</span>`)),
      });
      await L("revelar");
      await lamina(true);
    },
  },
  {
    id: "c06-secreto", cap: "06-scripts", pagina: "app", bloques: [7], extra: 1.2,
    async preparar(ctx) {
      await conectar(ctx, "core-sw01");
      await V3(ctx.p, `V.scripts = ["ejemplo_respaldo.py", "inventario_csv.py", "pedir_secreto.py", "ping_destinos.py", "primer_script.py"]`);
      await abrirScript(ctx.p, "pedir_secreto.py", 0);
    },
    async run({ p, at, sleep }) {
      await at(7, 0, 0.2);
      await p.clic('[aria-labelledby="sl-title"] button[type="submit"]', { ms: 500 });
      await sleep(900);
      await p.encuadrar('[aria-labelledby="ss-title"]', { margen: 50, max: 1.6, ms: 600 });
      await p.rotulo("texto:Clave de enable", "nt.ask_secret(\"Clave de enable\")", { lado: "arriba", recuadro: false });
      await p.clic('[aria-labelledby="ss-title"] input[type="password"]', { ms: 300 });
      await p.escribir("demo-clave-2026", 16);
      await sleep(300);
      await p.sinRotulos();
      await p.clic("texto:Entregar", { ms: 300 });
      await p.camara(1, 720, 405, 500);
      await sleep(900);
      await avisos(p, "En los mensajes del script: ••••••", { lado: "izq", tono: "ok" });
    },
  },
  {
    id: "c06-porque", cap: "06-scripts", pagina: "escenario", bloques: [8],
    async run({ E, at }) {
      await E("columnas", {
        kicker: "¿Por qué solo consultas?",
        titulo: "El costo de un error",
        cols: [
          { titulo: "Script de consulta con error", tag: "CSV incompleto", tagFondo: "#eef1f5", tagColor: "#5f6773", html: "<p style=\"margin:10px 0 0;color:#5f6773\">Lo corriges y lo vuelves a ejecutar.</p>" },
          { titulo: "Script de cambios con error", tag: "Equipo sin servicio", tagFondo: "#fdecee", tagColor: "#d1242f", html: "<p style=\"margin:10px 0 0;color:#5f6773\">Puede dejar un equipo sin servicio.</p>" },
        ],
      });
      await at(8, 1, 0);
      await E("revelar", 1);
      await at(8, 1, 3.4);
      await E("revelar", 2);
    },
  },

  // ===================== 07 · Plugins =====================
  capitulo(7, "Plugins", "Acciones empaquetadas, revisadas y con permisos"),
  {
    id: "c07-intro", cap: "07-plugins", pagina: "app", bloques: [0],
    async preparar(ctx) {
      await conectar(ctx, "acc-sw01");
      await instalado(ctx.p, [{ id: "revision-puertos", path: `${RUTA_PLUGIN}@1.0.0`, enabled: true, tampered: false }]);
      await ctx.lamina();
      await irAPlugins(ctx.p);
    },
    async run({ p, L, lamina, at, sleep }) {
      await L("arbol", {
        kicker: "Estructura de un plugin",
        titulo: "Una carpeta con manifiesto y código Python",
        nodos: [
          { nombre: "revision-puertos/", nota: "carpeta o .zip" },
          { nombre: "plugin.json", nota: "manifiesto", nivel: 1 },
          { nombre: "main.py", nota: "archivo de entrada: import netterminal as nt", nivel: 1 },
          { nombre: "analisis.py", nota: "módulo propio (sin acceso a la sesión)", nivel: 1 },
        ],
      });
      await lamina(true);
      await at(0, 0, 0.6);
      for (let i = 1; i <= 4; i++) {
        await L("revelar", i);
        await sleep(i === 1 ? 2400 : 900);
      }
      await at(0, 1, 0);
      await lamina(false);
      await sleep(300);
      await p.encuadrar("texto:Resumen de puertos", { margen: 240, max: 1.5, ms: 700 });
      const r = await p.rectDe("texto:Resumen de puertos", "texto:Exportar a CSV");
      await p.rotulo(r, "Acciones como botones", { lado: "abajo" });
    },
  },
  {
    id: "c07-manifiesto", cap: "07-plugins", pagina: "escenario", bloques: [1],
    async run({ E, at, tiempo }) {
      const notas = [
        { b: "revision-puertos/", t: "<code>analisis.py</code><br><code>main.py</code><br><code>plugin.json</code>" },
      ];
      await E("codigo", { kicker: "Manifiesto", archivo: "plugin.json", ruta: "revision-puertos/", lenguaje: "json", fs: 17, texto: "", caret: true, notas });
      await E("revelar");
      await at(1, 0, 0.3);
      const m = archivos.manifiesto;
      await E("escribir", m, Math.ceil(m.length / (tiempo(1, 1) - tiempo(1, 0) - 0.9)));
      const l = (re) => lineaDe(m, re);
      await E("marcar", { hl: [l(/"id"/), l(/"version"/), l(/"entry"/), l(/"permissions"/), l(/"actions"/)], seguir: 1 });
      await at(1, 1, 5.4);
      const main = archivos.main;
      await E("codigo", { kicker: "Código", archivo: "main.py", ruta: "revision-puertos/", lenguaje: "python", fs: 17, texto: main, notas });
      await E("revelar");
      await E("marcar", { hl: [lineaDe(main, /^ACCION = /), lineaDe(main, /^from analisis import/), lineaDe(main, /^ACCIONES = /)], seguir: 18 });
    },
  },
  {
    id: "c07-permisos", cap: "07-plugins", pagina: "app", bloques: [2], extra: 0.5,
    async preparar(ctx) {
      await conectar(ctx, "consola-core");
      await instalado(ctx.p, [{ id: "reingreso-consola", path: "/Users/operador/proyectos/reingreso-consola", enabled: true, tampered: false }]);
      await ctx.lamina();
      await irAPlugins(ctx.p);
    },
    async run({ p, L, lamina, at, sleep }) {
      const m = archivos.manifiesto;
      await L("codigo", {
        kicker: "Permisos",
        archivo: "plugin.json",
        ruta: "revision-puertos/",
        lenguaje: "json",
        fs: 17,
        texto: m,
        notas: [
          { b: "session", t: "Leer y enviar comandos a la sesión conectada. <b>La app lo hace cumplir.</b>" },
          { b: "files", t: "Leer o escribir archivos en tu equipo. <b>Declarativo.</b>" },
          { b: "network", t: "Conectarse a la red por su cuenta. <b>Declarativo.</b>" },
        ],
      });
      await L("marcar", { hl: [lineaDe(m, /"permissions"/)], seguir: 1 });
      await lamina(true);
      await at(2, 1, 0);
      await L("revelar", 1);
      await at(2, 1, 6.2);
      await L("revelar", 3);
      await at(2, 2, 0);
      await lamina(false);
      await sleep(200);
      await p.encuadrar("texto:Reingreso a consola 0.1.0", { margen: 30, max: 1.6, ms: 10 }).catch(() => {});
      await p.encuadrar('input[type="checkbox"]', { margen: 260, max: 1.6, ms: 600 }).catch(() => {});
      await p.rotulo("texto:vault-type", "vault-type", { lado: "arriba" }).catch(() => {});
      await sleep(1800);
      await p.clic('input[type="checkbox"]', { ms: 500 });
      await p.rotulo('input[type="checkbox"]', "Se aprueba en cada ejecución", { lado: "abajo", tono: "ok", nota: "El plugin nunca ve la contraseña" });
    },
  },
  {
    id: "c07-instalar", cap: "07-plugins", pagina: "app", bloques: [3], extra: 1.2,
    async preparar(ctx) {
      await conectar(ctx, "acc-sw01");
      await instalado(ctx.p, []);
      await ctx.p.ev(`(window.__nextOpen = a, 1)`, `${RUTA_PLUGIN}@1.0.0`);
      await ctx.lamina();
      await irAPlugins(ctx.p);
    },
    async run({ p, L, lamina, at, sleep }) {
      await at(3, 0, 0.2);
      await p.mover("texto:Instalar .zip", 700);
      await p.rotulo("texto:Instalar .zip", "Instalar .zip o Desde carpeta", { lado: "abajo", recuadro: false });
      await sleep(900);
      await p.sinRotulos();
      await p.clic("texto:Desde carpeta", { ms: 500 });
      await sleep(400);
      await L("lista", {
        kicker: "Validación antes de la revisión",
        titulo: "Lo que la app rechaza",
        items: [
          { ico: "no", texto: "Manifiestos inválidos" },
          { ico: "no", texto: "Enlaces simbólicos" },
          { ico: "no", texto: "Más de 200 archivos o 20 MB" },
          { ico: "no", texto: "Código que no se puede leer", nota: "Bytecode y binarios (.pyc, .so, .dll, .exe…)" },
        ],
      });
      await at(3, 1, 0);
      await lamina(true);
      const t = [0.3, 2.3, 3.9, 6.4];
      for (let i = 0; i < 4; i++) {
        await at(3, 1, t[i]);
        await L("revelar", i + 1);
      }
      await at(3, 2, 0);
      await lamina(false);
      await p.camara(1.22, 880, 330, 10);
      await p.rotulo("texto:Permisos solicitados", "Permisos", { lado: "izq", recuadro: false });
      await sleep(1600);
      await p.sinRotulos();
      await p.ev(`(() => { const pre = [...document.querySelectorAll("pre")].find((x) => x.textContent.includes("===== main.py")); pre.style.scrollBehavior = "smooth"; window.__pre = pre; return 1; })()`);
      await p.mover("pre", 400);
      for (let i = 0; i < 4; i++) {
        await p.ev(`(window.__pre.scrollTop += 220, 1)`);
        await sleep(450);
      }
      await p.ev(`(() => { const pre = window.__pre; pre.style.scrollBehavior = "auto"; const t = pre.firstChild; const i = t.data.indexOf("# ===== analisis.py"); const r = document.createRange(); r.setStart(t, i); r.setEnd(t, i + 1); const z = (window.__cam || { z: 1 }).z; pre.scrollTop += (r.getBoundingClientRect().top - pre.getBoundingClientRect().top) / z - 8; return 1; })()`);
      await p.rotulo("pre", "Todo el código: main.py y analisis.py", { lado: "arriba", recuadro: false });
      await at(3, 3, 0.2);
      await p.sinRotulos();
      await p.camara(1, 720, 405, 400);
      await p.clic("texto:Instalar y habilitar", { ms: 500 });
      await sleep(400);
      await p.rotulo("h3 texto:Revisión de puertos 1.0.0", "Activo · huella SHA-256", { lado: "abajo", tono: "ok" }).catch(() => {});
      await sleep(1000);
      await p.sinRotulos();
      await p.clic("texto:Resumen de puertos", { ms: 450 });
      await sleep(1400);
      const so = await p.rect("texto:Salida de plugins");
      await p.zoomA([so[0] - 20, so[1] - 10, 820, 250], { margen: 20, max: 1.6, ms: 500 });
    },
  },
  {
    id: "c07-actualizar", cap: "07-plugins", pagina: "app", bloques: [4], extra: 1.8,
    async preparar(ctx) {
      await conectar(ctx, "acc-sw01");
      await instalado(ctx.p, [{ id: "revision-puertos", path: `${RUTA_PLUGIN}@1.0.0`, enabled: true, tampered: false }]);
      await ctx.p.ev(`(window.__nextOpen = a, 1)`, `${RUTA_PLUGIN}@1.0.1`);
      await irAPlugins(ctx.p);
    },
    async run({ p, at, sleep }) {
      await at(4, 0, 0.2);
      await p.clic("texto:Desde carpeta", { ms: 500 });
      await sleep(300);
      await p.camara(1.3, 880, 260, 600);
      await p.rotulo("texto:▲ Reemplazará la versión instalada de este plugin.", "1.0.0 → 1.0.1", { lado: "abajo" });
      await sleep(700);
      await p.sinRotulos();
      await p.camara(1, 720, 405, 300);
      await p.clic("texto:Instalar y habilitar", { ms: 400 });
      await at(4, 1, 0);
      // Alguien editó los archivos en la carpeta de plugins: la app lo bloquea.
      await instalado(p, [{ id: "revision-puertos", path: `${RUTA_PLUGIN}@1.0.1`, enabled: true, tampered: true }]);
      await recargarPlugins(p);
      await sleep(300);
      await p.encuadrar("texto:✕ Sus archivos cambiaron desde que lo aprobaste. Revisa el código y apruébalo solo si reconoces el cambio.", { margen: 140, max: 1.5, ms: 400 });
      await sleep(500);
      await p.clic("texto:Revisar código", { ms: 350 });
      await sleep(500);
      await p.rotulo("texto:Aprobar estos cambios y habilitar", "Solo si reconoces el cambio", { lado: "abajo", tono: "warn" });
      await at(4, 2, 0);
      await p.sinRotulos();
      await p.camara(1, 720, 405, 300);
      await p.clic("titulo:Desinstalar", { ms: 450 });
      await sleep(300);
      await p.encuadrar('[role="alertdialog"]', { margen: 70, max: 1.6, ms: 400 });
      await sleep(1100);
      await p.clic("texto:Cancelar", { ms: 400 });
      await p.camara(1, 720, 405, 400);
    },
  },

  // ===================== 08 · Packs =====================
  capitulo(8, "Packs de comandos", "Comandos y explicaciones para compartir"),
  {
    id: "c08-catalogo", cap: "08-packs", pagina: "app", bloques: [0],
    async preparar(ctx) {
      await conectar(ctx, "acc-sw01");
      await ctx.lamina();
    },
    async run({ p, L, lamina, at, sleep }) {
      await at(0, 0, 3.2);
      await p.atajo("meta+l");
      await sleep(500);
      await p.rotulo({ base: [850, 46, 560, 30] }, "Catálogo · ⌘L", { lado: "abajo", recuadro: false, nota: "Windows y Linux: Ctrl+Shift+L" });
      await at(0, 1, 0);
      await p.sinRotulos();
      await L("codigo", { kicker: "Un pack es solo datos", archivo: "turno-puertos.json", ruta: "docs/ejemplos/packs/", lenguaje: "json", fs: 15, texto: archivos.turno });
      await L("marcar", { hl: [lineaDe(archivos.turno, /"format"/), lineaDe(archivos.turno, /"commands"/)], seguir: 1 });
      await lamina(true);
    },
  },
  {
    id: "c08-propio", cap: "08-packs", pagina: "app", bloques: [1], continuar: true,
    async run({ p, lamina, at, sleep }) {
      await lamina(false);
      await at(1, 0, 0.2);
      await p.clic("titulo:Agregar un comando propio", { ms: 600 });
      await sleep(300);
      await p.encuadrar("form", { margen: 40, max: 1.5, ms: 500 });
      await p.clic("form textarea", { ms: 300 });
      await p.escribir("clear counters {{interfaz}}", 22);
      await p.clic("form label:nth-of-type(2) textarea", { ms: 300 });
      await p.escribir("Pone en cero los contadores.", 30);
      await p.valor("form select", "Interfaces");
      await at(1, 1, 0);
      await p.valor("form label:nth-of-type(4) select, form .grid label:nth-of-type(2) select", "read");
      await sleep(400);
      await p.rotulo('texto:▲ Por su contenido, la app lo tratará como "Cambia config/estado".', "Siempre manda el riesgo mayor", { lado: "abajo", tono: "warn" });
      await sleep(3600);
      await p.sinRotulos();
      await p.valor("form .grid label:nth-of-type(2) select", "change");
      await sleep(500);
      await p.clic("texto:Guardar en Mis comandos", { ms: 400 });
      await p.camara(1, 720, 405, 400);
    },
  },
  {
    id: "c08-mis", cap: "08-packs", pagina: "app", bloques: [2], continuar: true,
    async run({ p, at, sleep }) {
      await at(2, 0, 0.1);
      await p.clic("titulo:Packs de comandos", { ms: 500 });
      await sleep(400);
      await p.encuadrar(".shadow-pop", { margen: 30, max: 1.4, ms: 500 });
      await p.rotulo('[title="Exportar para compartir"]', "Exportar para compartir", { lado: "izq" });
      await sleep(1800);
      await p.clic('[title="Exportar para compartir"]', { ms: 300 });
    },
  },
  {
    id: "c08-importar", cap: "08-packs", pagina: "app", bloques: [3], continuar: true, extra: 1.0,
    async run({ p, at, sleep }) {
      await p.sinRotulos();
      await p.ev(`(window.__nextOpen = a, 1)`, `${RUTA_PACKS}/pack-riesgo-mal-declarado.json`);
      await at(3, 0, 0.1);
      await p.clic("texto:Importar pack", { ms: 500 });
      await sleep(500);
      await p.rotulo("texto:▲ 1 comandos declaraban menos riesgo del real; la app los ajustó.", "Declaraba consulta: era un cambio", { lado: "abajo", tono: "warn" }).catch(() => {});
      await at(3, 1, 0);
      await p.sinRotulos();
      await p.clic("texto:Cancelar", { ms: 400 });
      await sleep(300);
      await p.camara(1, 720, 405, 300);
      await p.ev(`(() => { [...document.querySelectorAll(".shadow-pop p, .shadow-pop div")].find((x) => x.textContent.trim().startsWith("Al compartir un pack"))?.scrollIntoView({ block: "center" }); return 1; })()`);
      await sleep(200);
      await p.encuadrar(".shadow-pop texto:Al compartir un pack no incluyas IPs", { margen: 60, max: 1.7, ms: 600 }).catch(() => {});
      await p.rotulo(".shadow-pop texto:Al compartir un pack no incluyas IPs", "Variables en lugar de IPs, equipos o credenciales", { lado: "arriba" }).catch(() => {});
    },
  },

  // ===================== 09 · Agentes de IA con MCP =====================
  capitulo(9, "Agentes de IA con MCP", "Servidor local, token y tu aprobación"),
  {
    id: "c09-diagrama", cap: "09-agentes-mcp", pagina: "escenario", bloques: [0],
    async run({ E, at }) {
      await E("diagrama", {
        kicker: "MCP: protocolo abierto para conectar herramientas a un asistente",
        titulo: "Tu agente de IA y NetTerminal",
        cajas: [
          { b: "Agente de IA", t: "Claude Code, Gemini CLI o Codex", icono: I.agentes },
          { b: "NetTerminal", t: "Servidor MCP local", icono: I.scripts, clase: "dark" },
          { b: "Equipos", t: "Sesiones abiertas en la app", icono: I.linux },
        ],
        flechas: ["http://127.0.0.1:47821/mcp<br>+ token", "Tu aprobación"],
        pie: "Viene apagado. Solo escucha en tu computador.",
      });
      for (let i = 1; i <= 6; i++) {
        await at(0, 0, i * 1.2);
        await E("revelar", i);
      }
    },
  },
  {
    id: "c09-ajustes", cap: "09-agentes-mcp", pagina: "app", bloques: [1],
    async preparar(ctx) {
      await conectar(ctx, "acc-sw01");
    },
    async run({ p, at, sleep }) {
      await at(1, 1, 0);
      await p.clic("titulo:Ajustes", { ms: 600 });
      await sleep(300);
      await p.clic("texto:Agentes IA", { ms: 500 });
      await sleep(300);
      await p.encuadrar('[role="switch"]', { margen: 400, max: 1.35, ms: 600 }).catch(() => {});
      await at(1, 2, 0);
      const sw = (i) => p.ev(`(() => { const s = [...document.querySelectorAll('[role="switch"]')][a]; const b = s.getBoundingClientRect(); return [b.left, b.top, b.width, b.height]; })()`, i);
      await p.rotulo(await sw(2), "Solo lectura: listar y leer", { lado: "izq", nota: "Viene apagado" });
      await sleep(1200);
      await p.clic(centro(await sw(2)), { ms: 500 });
      await at(1, 3, 0);
      await p.sinRotulos();
      await p.clic(centro(await sw(0)), { ms: 500 });
      await sleep(500);
      await p.rotulo('input[placeholder="Se genera al activar"]', "Token generado (oculto)", { lado: "abajo" });
      await at(1, 4, 0);
      await p.sinRotulos();
      await p.rotulo("texto:Escuchando en http://127.0.0.1:47821/mcp", "Solo 127.0.0.1 y con token", { lado: "abajo", tono: "ok" });
    },
  },
  {
    id: "c09-copiar", cap: "09-agentes-mcp", pagina: "app", bloques: [2], continuar: true,
    async run({ p, at, sleep }) {
      await p.sinRotulos();
      await at(2, 0, 0.1);
      await p.clic("texto:Claude Code", { ms: 500 });
      await sleep(300);
      await p.ev(`(() => { [...document.querySelectorAll("details")].find((d) => d.textContent.includes("Claude Code"))?.scrollIntoView({ block: "center" }); return 1; })()`);
      await sleep(200);
      await p.camara(1, 720, 405, 300);
      await p.encuadrar("details[open]", { margen: 60, max: 1.5, ms: 500 });
      await p.rotulo("details[open] pre", "Token enmascarado", { lado: "abajo", recuadro: false });
      await p.clic("details[open] button", { ms: 400 });
      await at(2, 1, 0);
      await p.sinRotulos();
      await p.camara(1, 720, 405, 300);
      await p.ev(`(() => { document.querySelector('input[placeholder="Se genera al activar"]')?.scrollIntoView({ block: "center" }); return 1; })()`);
      await sleep(300);
      await p.encuadrar('[title="Generar nuevo (invalida el anterior)"]', { margen: 260, max: 1.5, ms: 500 });
      await p.rotulo('[title="Generar nuevo (invalida el anterior)"]', "Generar nuevo (invalida el anterior)", { lado: "abajo" });
    },
  },
  {
    id: "c09-aprobar", cap: "09-agentes-mcp", pagina: "app", bloques: [3], extra: 0.8, query: "?mcp=1",
    async preparar(ctx) {
      await conectar(ctx, "acc-sw01");
    },
    async run({ p, at, sleep }) {
      await at(3, 0, 0.2);
      await V3(p, `V.agente("a1", "acc-sw01 (192.0.2.11)", "show interfaces status")`);
      await sleep(500);
      await p.encuadrar('[aria-labelledby="approval-title"]', { margen: 60, max: 1.6, ms: 600 });
      await p.rotulo('[title="Riesgo calculado por la app, no declarado por el agente"]', "Riesgo calculado por la app", { lado: "arriba" });
      await at(3, 1, 0);
      await p.sinRotulos();
      await p.atajo("Enter");
      await p.rotulo("texto:Rechazar", "Enter no aprueba", { lado: "abajo", tono: "warn" });
      await sleep(2300);
      await p.sinRotulos();
      await p.clic("texto:Permitir", { ms: 500 });
      await p.camara(1, 720, 405, 500);
      await at(3, 2, 0);
      await V3(p, `V.agente("a2", "acc-sw01 (192.0.2.11)", "reload")`);
      await sleep(400);
      await p.encuadrar('[aria-labelledby="approval-title"]', { margen: 60, max: 1.6, ms: 500 });
      await p.rotulo("texto:Entiendo que este comando puede cortar servicio", "Casilla obligatoria", { lado: "abajo", tono: "warn" });
      await at(3, 3, 0);
      await p.sinRotulos();
      await p.clic("texto:Rechazar", { ms: 500 });
      await p.camara(1, 720, 405, 400);
      await p.rotulo("titulo:Servidor MCP activo", "Aprobar cada comando: encendido", { lado: "arriba", tono: "ok" }).catch(() => {});
    },
  },
  {
    id: "c09-herramientas", cap: "09-agentes-mcp", pagina: "escenario", bloques: [4],
    async run({ E, at }) {
      await E("lista", {
        kicker: "Lo que puede hacer un agente",
        titulo: "Herramientas MCP de NetTerminal",
        items: [
          { ico: "ok", texto: "<code>list_sessions</code>, <code>list_connections</code>, <code>read_output</code>", nota: "Siempre (también en Solo lectura)" },
          { ico: "warn", texto: "<code>send_command</code>, <code>open_session</code>", nota: "Solo sin Solo lectura y con tu aprobación" },
          { ico: "no", texto: "<span class=\"tachado\">Ejecutar scripts o plugins · enviar a varias sesiones</span>" },
          { ico: "dot", texto: "La salida de los equipos se declara dato no confiable" },
        ],
      });
      await E("revelar", 2);
      await at(4, 0, 0.4);
      await E("revelar", 3);
      await at(4, 1, 0);
      await E("revelar", 4);
    },
  },

  // ===================== 10 · Buenas prácticas =====================
  capitulo(10, "Buenas prácticas", "Antes de automatizar contra equipos reales"),
  {
    id: "c10-lista", cap: "10-buenas-practicas", pagina: "escenario", bloques: [0],
    async run({ E, at }) {
      await E("lista", {
        kicker: "Cinco buenas prácticas",
        items: [
          { texto: "Prueba todo en un equipo de laboratorio" },
          { texto: "Empieza con consultas; agrega cambios cuando el script ya funciona" },
          { texto: "Scripts, plugins y packs en control de versiones", nota: "git log: «revision-puertos 1.0.1: sube la versión»" },
          { texto: "Nunca contraseñas en botones, notas, scripts, plugins ni packs" },
          { texto: "Revisa el código de todo lo que venga de una carpeta compartida" },
        ],
      });
      await at(0, 1, 0);
      await E("revelar", 1);
      await at(0, 2, 0);
      await E("revelar", 2);
      await at(0, 3, 0);
      await E("revelar", 3);
    },
  },
  {
    id: "c10-boveda", cap: "10-buenas-practicas", pagina: "app", bloques: [1], extra: 1.0,
    async preparar(ctx) {
      await conectar(ctx, "consola-core");
      await ctx.lamina();
      await V3(ctx.p, `V.scripts = ["consola_login.py", "ejemplo_respaldo.py", "inventario_csv.py", "ping_destinos.py", "primer_script.py"]; V.ritmo = 0.8`);
    },
    async run({ p, L, lamina, at, sleep }) {
      await L("lista", {
        kicker: "Cinco buenas prácticas",
        items: [
          { texto: "Prueba todo en un equipo de laboratorio" },
          { texto: "Empieza con consultas; agrega cambios cuando el script ya funciona" },
          { texto: "Scripts, plugins y packs en control de versiones" },
          { texto: "Nunca contraseñas en botones, notas, scripts, plugins ni packs", nota: "Usa la bóveda cifrada de la sesión" },
          { texto: "Revisa el código de todo lo que venga de una carpeta compartida" },
        ],
      });
      await L("revelar", 4);
      await L("destacar", 4);
      await lamina(true);
      await at(1, 1, 0);
      await p.mover("texto:consola-core", 0);
      await sleep(150);
      await p.clic('[title^="operador@192.0.2.250"] [title="Editar"]', { ms: 0 });
      await sleep(300);
      await p.ev(`(() => { [...document.querySelectorAll("label, div")].find((x) => x.textContent.trim().startsWith("Guardar contraseña"))?.scrollIntoView({ block: "center" }); return 1; })()`);
      await lamina(false);
      await p.encuadrar("texto:Guardar contraseña", { margen: 200, max: 1.5, ms: 600 });
      await p.rotulo("texto:Guardar contraseña", "Bóveda cifrada · se completa al conectar", { lado: "abajo", tono: "ok" });
      await at(1, 2, 0);
      await p.sinRotulos();
      await p.rotulo("texto:Guardar contraseña", "Los scripts no pueden leerla", { lado: "abajo", tono: "warn" });
      await at(1, 3, 0);
      await p.sinRotulos();
      await p.atajo("Escape");
      await p.camara(1, 720, 405, 10);
      await L("codigo", { kicker: "docs/ejemplos/README.md", archivo: "Contraseña guardada sin exponerla", ruta: "", lenguaje: "python", fs: 22, texto: fragmentoBoveda() });
      await L("marcar", { hl: [lineaDe(fragmentoBoveda(), /type_saved_password/)] });
      await lamina(true);
      await abrirScript(p, "consola_login.py", 0);
      await p.clic('[aria-labelledby="sl-title"] texto:Permitir que el script escriba contraseñas guardadas en: consola-core', { ms: 0 }).catch(() => p.clic("texto:Permitir que el script escriba contraseñas guardadas en: consola-core", { ms: 0 }));
      await at(1, 3, 3.6);
      await lamina(false);
      await p.encuadrar('[aria-labelledby="sl-title"]', { margen: 30, max: 1.5, ms: 10 });
      await p.rotulo("texto:Permitir que el script escriba contraseñas guardadas en: consola-core", "Marcada al lanzarlo", { lado: "der", tono: "ok" });
      await sleep(1700);
      await p.sinRotulos();
      await p.clic('[aria-labelledby="sl-title"] button[type="submit"]', { ms: 400 });
      await p.camara(1, 720, 405, 400);
      await sleep(900);
      await p.clic("texto:Permitir", { ms: 400 }).catch(() => {});
      await sleep(1600);
      await p.rotulo({ base: [266, 50, 560, 200] }, "El script nunca ve la contraseña", { lado: "der", recuadro: false, tono: "ok" });
    },
  },
  {
    id: "c10-revisar", cap: "10-buenas-practicas", pagina: "escenario", bloques: [2], salida: 0.8,
    async run({ E }) {
      await E("frase", { kicker: "Cinco", t: "Revisa el código<br>antes de ejecutarlo.", sub: "Todo lo que venga de una carpeta compartida." });
    },
  },

  // ===================== 11 · Cierre =====================
  capitulo(11, "Cierre", "Qué usar para cada cosa"),
  {
    id: "c11-resumen", cap: "11-cierre", pagina: "escenario", bloques: [0],
    async run({ E, at }) {
      await E("portada7", { kicker: "En resumen", h1: "Cada herramienta, para lo suyo", sub: "Botones y plantillas · al conectar · scripts · plugins · packs · agentes con tu aprobación", items: SIETE });
      const marcas = [1.2, 2.0, 4.4, 6.6, 8.2, 10.4, 12.0];
      for (let i = 0; i < 7; i++) {
        await at(0, 0, marcas[i]);
        await E("encender", i + 1);
      }
    },
  },
  {
    id: "c11-final", cap: "11-cierre", pagina: "escenario", bloques: [1], salida: 1.6,
    async run({ E, at }) {
      await E("arbol", {
        kicker: "Ejemplos en el repositorio",
        titulo: "docs/ejemplos",
        nodos: [
          { nombre: "scripts/", nota: "primer_script.py · ping_destinos.py · inventario_csv.py" },
          { nombre: "plugins/revision-puertos/", nota: "plugin.json · main.py · analisis.py" },
          { nombre: "packs/turno-puertos.json", nota: "pack de consultas" },
          { nombre: "plantillas/revision-puerto.txt", nota: "plantilla de Notas" },
        ],
      });
      await E("revelar");
      await at(1, 1, 0);
      await E("portada", { kicker: "NetTerminal", h1: "Gracias por tu atención", sub: "Ejemplos en <code>docs/ejemplos</code>", chips: [] });
    },
  },
];

const CSV_INV = { cab: [], filas: [] };
/** El grabador fija el CSV real del inventario antes de grabar (datosVideo().csv). */
export function fijarCsv(texto) {
  const f = filasCsvComillas(texto);
  CSV_INV.cab = f.cab;
  CSV_INV.filas = f.filas;
}
function filasCsvComillas(texto) {
  const filas = [];
  let fila = [], celda = "", q = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (q) {
      if (c === '"' && texto[i + 1] === '"') (celda += '"'), i++;
      else if (c === '"') q = false;
      else celda += c;
    } else if (c === '"') q = true;
    else if (c === ",") fila.push(celda), (celda = "");
    else if (c === "\n") fila.push(celda), filas.push(fila), (fila = []), (celda = "");
    else if (c !== "\r") celda += c;
  }
  const [cab, ...resto] = filas;
  return { cab, filas: resto };
}
