// Tomas del video: qué se ve mientras se narra cada bloque de guion/*.txt. Cada toma ocupa uno
// o más bloques (párrafos) de un capítulo; `at(b, o, s)` espera al inicio de la oración `o`
// del bloque `b` más `s` segundos. Las tomas "app" usan la app real con el backend simulado
// (demo.html); las de "escenario", láminas y código (escenario.html).
import { archivos, version100, RUTA_PACK, RUTA_PLUGIN } from "./datos.mjs";

export const NOMBRE = "NetTerminal-scripts-y-plugins";
const TOOLS = "titulo:Herramientas: monitoreo";

// ---------- Ayudas comunes ----------
const valor = (p, sel, v) =>
  p.ev(
    `(() => { const el = window.__q(a[0]); const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, "value").set.call(el, a[1]); el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true })); return true; })()`,
    [sel, v],
  );
/** Fija el plugin instalado en el backend simulado y recarga la lista de la pestaña Plugins. */
const instalado = (p, estado) =>
  p.ev(`(() => { window.__video.installed.clear(); for (const s of a) window.__video.installed.set(s.id, s); return true; })()`, estado);
const irAPlugins = async (p) => {
  await p.clic(TOOLS, { ms: 0 });
  await p.clic("texto:Plugins", { ms: 0 });
};
const conectar = async (ctx, ...nombres) => {
  for (const n of nombres) {
    await ctx.p.dobleClic(`texto:${n}`, { ms: 0 });
    await ctx.sleep(500);
  }
  await ctx.sleep(500);
};
const plugin100 = version100();
/** Encuadre fijo de la revisión de instalación (toda la tarjeta a lo ancho). */
const camaraRevision = (p, { ms = 900 } = {}) => p.camara(1.22, 880, 330, ms);
const sinDocstring = (t) => t.replace(/^"""[\s\S]*?"""\n/, "");
const docstring = (t) => t.match(/^"""[\s\S]*?"""\n/)[0];

export const TOMAS = [
  // ===================== Introducción =====================
  {
    id: "portada", cap: "01-intro", capitulo: "Introducción", pagina: "escenario", bloques: [0], entrada: 1.2,
    async run({ E, at, sleep }) {
      await E("portada", { kicker: "Tutorial", h1: "Scripts y plugins<br>en NetTerminal", sub: "Automatiza consultas con botones, scripts de Python, packs de comandos y plugins revisados.", chips: ["Botones y variables", "Scripts Python", "Comandos al conectar", "Packs de comandos", "Plugins"] });
      await at(0, 0, 3.2);
      for (let i = 1; i <= 5; i++) {
        await E("revelar", i);
        await sleep(650);
      }
    },
  },
  {
    id: "intro-app", cap: "01-intro", pagina: "app", bloques: [1],
    async preparar(ctx) {
      await conectar(ctx, "core-sw01");
    },
    async run({ p, at, sleep }) {
      await at(1, 0, 0.3);
      await p.clic("texto:Versión");
      await sleep(2600);
      await p.clic("texto:Interfaces");
      await sleep(2400);
      await p.clic("texto:Ping gestión");
    },
  },
  {
    id: "intro-mapa", cap: "01-intro", pagina: "escenario", bloques: [2],
    async run({ E, at, sleep }) {
      await E("lista", {
        kicker: "En este video",
        titulo: "De lo simple a lo más potente",
        items: [
          { texto: "Botones con variables y scripts de Python" },
          { texto: "Comandos al conectar" },
          { texto: "Packs de comandos" },
          { texto: "Plugins: estructura, instalación, revisión y seguridad" },
          { texto: "Buenas prácticas" },
        ],
      });
      for (let i = 1; i <= 5; i++) {
        await sleep(i === 1 ? 300 : 700);
        await E("revelar", i);
      }
    },
  },

  // ===================== Scripts y macros =====================
  { id: "cap-scripts", cap: "02-scripts-y-macros", capitulo: "Scripts y macros", pagina: "escenario", dur: 2.6, async run({ E }) { await E("capitulo", { num: "1", titulo: "Scripts y macros", sub: "Botones de la barra, variables, scripts de Python y envío a varias sesiones" }); } },
  {
    id: "dos-formas", cap: "02-scripts-y-macros", pagina: "escenario", bloques: [0],
    async run({ E, at }) {
      await E("columnas", {
        kicker: "Dos formas de automatizar",
        titulo: "Botón de texto o script de Python",
        cols: [
          { titulo: "Botón (macro)", tag: "Enviar texto", tagFondo: "#e8effd", tagColor: "#1d5be0", html: "<ul><li>Una o varias líneas de comandos</li><li>Variables <code>{{interfaz}}</code></li><li>Pasa por el motor de riesgo</li><li>A una o varias sesiones</li></ul>" },
          { titulo: "Script de Python", tag: "Script Python", tagFondo: "#e6f4ea", tagColor: "#1a7f37", html: "<ul><li>Lógica: esperar, leer y decidir</li><li><code>import netterminal as nt</code></li><li>Sobre la pestaña activa</li><li>Requiere Python 3</li></ul>" },
        ],
      });
      await at(0, 0, 1.8);
      await E("revelar", 1);
      await at(0, 0, 3.6);
      await E("revelar", 2);
    },
  },
  {
    id: "boton-nuevo", cap: "02-scripts-y-macros", pagina: "app", bloques: [1, 2],
    async preparar(ctx) {
      await conectar(ctx, "core-sw01");
    },
    async run({ p, at, sleep }) {
      await at(1, 0, 0.2);
      await p.mover("texto:Versión", 900);
      await p.camara(1.7, 520, 790, 900);
      await sleep(1000);
      await p.mover("texto:Ping gestión", 700);
      await at(1, 1);
      await p.camara(1.7, 1350, 790, 900);
      await sleep(900);
      await p.mover("titulo:Ajustes", 700);
      await at(1, 2);
      await p.camara(1.7, 520, 790, 700);
      await sleep(700);
      await p.clic("titulo:Nuevo botón");
      await p.camara(1, 720, 405, 500);
      await sleep(500);
      await p.encuadrar("form", { margen: 60, max: 1.6 });
      await at(2, 0, 0.2);
      await p.clic('input[placeholder="Ej: Respaldo config"]', { ms: 500 });
      await p.escribir("Revisar interfaz", 16);
      await p.clic("texto:Enviar texto", { ms: 500 });
      await p.clic("form textarea", { ms: 500 });
      await p.escribir("show interfaces ", 18);
      await at(2, 1, 0.2);
      await p.escribir("{{interfaz}}", 9);
      await p.escribir("\nping 192.0.2.1", 18);
      await sleep(500);
      await p.clic("texto:Guardar", { ms: 600 });
      await p.camara(1, 720, 405, 700);
    },
  },
  {
    id: "boton-variables", cap: "02-scripts-y-macros", pagina: "app", bloques: [3], continuar: true,
    async run({ p, at, sleep }) {
      await at(3, 0, 0.1);
      await p.clic("texto:Revisar interfaz");
      await sleep(400);
      await p.encuadrar("form", { margen: 70, max: 1.7 });
      await p.escribir("GigabitEthernet1/0/1", 14);
      await at(3, 1, 0.3);
      await p.clic("texto:Continuar", { ms: 600 });
      await p.camara(1, 720, 405, 500);
      await sleep(700);
      await p.clic("texto:Enviar", { ms: 500 });
      await p.camara(1, 720, 405, 600);
    },
  },
  {
    id: "secretos", cap: "02-scripts-y-macros", pagina: "escenario", bloques: [4],
    async run({ E, sleep }) {
      await E("lista", {
        kicker: "Variables con pinta de secreto",
        titulo: "Se piden ocultas y nunca se guardan",
        items: [
          { ico: "ok", texto: "<code>{{interfaz}}</code>, <code>{{vlan}}</code>: se recuerda el último valor" },
          { ico: "warn", texto: "<code>{{community}}</code>, <code>{{password}}</code>, <code>{{token}}</code>: campo oculto", nota: "El nombre contiene pass, pwd, secret, clave, contrase, key, token, psk, community o auth" },
          { ico: "warn", texto: "Vista previa enmascarada: <code>snmp ... ••••••</code>" },
          { ico: "no", texto: "No se guarda: se pide cada vez que envías" },
        ],
      });
      for (let i = 1; i <= 4; i++) {
        await sleep(i === 1 ? 400 : 1700);
        await E("revelar", i);
      }
    },
  },
  {
    id: "editar-boton", cap: "02-scripts-y-macros", pagina: "app", bloques: [5],
    async preparar(ctx) {
      await conectar(ctx, "core-sw01");
    },
    async run({ p, at, sleep }) {
      await p.camara(1.7, 520, 790, 10);
      await at(5, 0, 0.2);
      await p.clic("texto:Ping gestión", { button: "right" });
      await sleep(700);
      await p.mover("texto:Editar", 500);
    },
  },
  {
    id: "api", cap: "02-scripts-y-macros", pagina: "escenario", bloques: [6],
    async run({ E, at }) {
      await E("codigo", {
        kicker: "Scripts de Python",
        archivo: "API netterminal",
        ruta: "datos/scripts/",
        lenguaje: "python",
        fs: 21,
        texto: [
          "import netterminal as nt",
          "",
          "nt.run(cmd, prompt, timeout)   # envía y devuelve solo la salida",
          "nt.send(texto)                 # envía el texto tal cual",
          "nt.sendline(texto)             # texto + Enter",
          "nt.wait_for(regex, timeout)    # espera un patrón en la salida",
          "nt.read(idle=1, timeout=10)    # lee hasta que el equipo calla",
          "nt.clear()                     # descarta la salida pendiente",
          "nt.log(msg)                    # mensaje en la app",
          "nt.session                     # name, type, host, port, username",
          "nt.data_dir                    # carpeta de datos de NetTerminal",
        ].join("\n"),
        notas: [
          { b: "scripts/", t: "Un archivo <code>.py</code> por script en la carpeta de datos de la app." },
          { b: "Python 3", t: "Usa el Python del sistema y solo la biblioteca estándar." },
          { b: "print()", t: "Lo que imprime aparece como aviso en la app." },
        ],
      });
      await at(6, 0, 1.5);
      await E("marcar", { hl: [1] });
      await at(6, 1, 0);
      await E("marcar", { hl: [3, 4, 6, 7] });
      await E("revelar", 1);
      await at(6, 1, 3.5);
      await E("revelar", 3);
    },
  },
  {
    id: "script-codigo", cap: "02-scripts-y-macros", pagina: "escenario", bloques: [7], extra: 1.5,
    async run({ E, at, tiempo, dur }) {
      const texto = archivos.script;
      await E("codigo", { kicker: "Script de ejemplo", archivo: "resumen_equipo.py", ruta: "docs/ejemplos/scripts/", lenguaje: "python", fs: 19, texto: docstring(texto), caret: true });
      await at(7, 0, 1.0);
      const cuerpo = sinDocstring(texto);
      const seg = dur - tiempo(7, 0) - 1.0 - 2.4;
      await E("escribir", cuerpo, Math.ceil(cuerpo.length / seg));
      await E("marcar", { hl: [15, 16, 17, 24, 25] });
    },
  },
  {
    id: "script-ejecutar", cap: "02-scripts-y-macros", pagina: "app", bloques: [8], extra: 1.5,
    async preparar(ctx) {
      await conectar(ctx, "core-sw01");
    },
    async run({ p, at, sleep }) {
      await at(8, 0, 0.1);
      await p.clic("texto:Scripts", { ms: 600 });
      await sleep(400);
      await p.clic("texto:resumen_equipo.py", { ms: 500 });
      await sleep(1600);
      await p.camara(1.45, 1150, 600, 800);
      await at(8, 1, 0);
      await p.camara(1, 720, 405, 500);
      await p.clic("titulo:Nuevo botón", { ms: 500 });
      await sleep(200);
      await p.encuadrar("form", { margen: 60, max: 1.6, ms: 600 });
      await p.clic('input[placeholder="Ej: Respaldo config"]', { ms: 300 });
      await p.escribir("Resumen", 18);
      await p.clic("texto:Script Python", { ms: 400 });
      await sleep(200);
      await valor(p, "form select", "resumen_equipo.py");
      await sleep(900);
      await p.clic("texto:Guardar", { ms: 400 });
      await p.camara(1, 720, 405, 500);
    },
  },
  {
    id: "difusion-destino", cap: "02-scripts-y-macros", pagina: "app", bloques: [9],
    async preparar(ctx) {
      await conectar(ctx, "core-sw01", "core-sw02", "Shell local");
      await ctx.p.clic("texto:core-sw01", { ms: 0 });
    },
    async run({ p, at, sleep }) {
      await at(9, 0, 0.3);
      await p.clic("titulo:Elegir a qué sesiones se envía");
      await sleep(400);
      await p.encuadrar('[aria-label="Destino del envío"]', { margen: 120, max: 1.8 });
      await p.mover("texto:Pestaña actual", 500);
      await sleep(500);
      await p.clic("texto:Pestañas elegidas", { ms: 500 });
      await sleep(500);
      await p.ev(`(() => { for (const c of document.querySelectorAll('[aria-label="Destino del envío"] input[type=checkbox]')) if (!c.checked && /core-sw0/.test(c.closest("label")?.textContent)) c.click(); return 1; })()`);
      await sleep(900);
      await at(9, 1, 0);
      await p.camara(1, 720, 405, 600);
      await p.ev(`document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }))`);
    },
  },
  {
    id: "difusion-dialogo", cap: "02-scripts-y-macros", pagina: "app", bloques: [10], continuar: true,
    async run({ p, at, sleep }) {
      await at(10, 0, 0.1);
      await p.clic("texto:Versión");
      await sleep(500);
      await p.encuadrar('[aria-labelledby="bc-title"]', { margen: 50, max: 1.5 });
      await at(10, 1, 0.2);
      await p.mover("texto:Cancelar", 600);
      await sleep(1600);
      await p.clic("texto:Cancelar", { ms: 300 });
      await p.camara(1, 720, 405, 500);
    },
  },
  {
    id: "riesgo-encadenado", cap: "02-scripts-y-macros", pagina: "app", bloques: [11], continuar: true,
    async run({ p, at, sleep }) {
      await at(11, 0, 0.1);
      await p.clic("texto:Notas");
      await sleep(400);
      await valor(p, "aside select, select", "riesgo-encadenado.txt");
      await sleep(900);
      await p.clic('button[title*="⇧Enter"], button[title*="Shift+Enter"]');
      await sleep(500);
      await p.encuadrar('[aria-labelledby="bc-title"]', { margen: 50, max: 1.5 });
      await at(11, 1, 0.3);
      await p.mover('[aria-labelledby="bc-title"] input:not([type=checkbox])', 600).catch(() => {});
      await sleep(2000);
      await p.clic("texto:Cancelar", { ms: 400 });
      await p.camara(1, 720, 405, 500);
    },
  },
  {
    id: "riesgo-tabla", cap: "02-scripts-y-macros", pagina: "escenario", bloques: [12],
    async run({ E, at, sleep }) {
      await E("tabla", {
        kicker: "Motor de riesgo",
        titulo: "¿Qué pasa por la confirmación de riesgo?",
        columnas: ["Origen del envío", "Motor de riesgo"],
        filas: [
          ["Botones de texto", '<span class="si">✓ Sí</span>'],
          ["Notas y catálogo de comandos", '<span class="si">✓ Sí</span>'],
          ["Envío a varias sesiones", '<span class="si">✓ Sí, con la cantidad de equipos para cambios</span>'],
          ["Scripts de Python", '<span class="no">✕ No: revisa el código</span>'],
          ["Comandos al conectar", '<span class="no">✕ No</span>'],
          ["Plugins", '<span class="no">✕ No: revisión al instalar</span>'],
        ],
      });
      for (let i = 1; i <= 3; i++) {
        await sleep(350);
        await E("revelar", i);
      }
      await at(12, 0, 2.2);
      await E("revelar", 4);
      await sleep(1500);
      await E("revelar", 6);
    },
  },

  // ===================== Comandos al conectar =====================
  { id: "cap-conectar", cap: "03-comandos-al-conectar", capitulo: "Comandos al conectar", pagina: "escenario", dur: 2.6, async run({ E }) { await E("capitulo", { num: "2", titulo: "Comandos al conectar", sub: "Preparar cada sesión remota al abrirla" }); } },
  {
    id: "conectar-editar", cap: "03-comandos-al-conectar", pagina: "app", bloques: [0],
    async run({ p, at, sleep }) {
      await at(0, 0, 0.1);
      await p.mover("texto:core-sw01", 700);
      await sleep(300);
      await p.clic('[title^="admin@192.0.2.1"] [title="Editar"]', { ms: 400 });
      await sleep(500);
      await p.ev(`(() => { const d = [...document.querySelectorAll("details")].find((x) => x.textContent.includes("Opciones de terminal")); d?.scrollIntoView({ block: "center" }); return 1; })()`);
      await at(0, 1, 0);
      await p.clic("texto:Opciones de terminal", { ms: 600 });
      await sleep(400);
      await p.ev(`(() => { [...document.querySelectorAll("details")].find((x) => x.textContent.includes("Opciones de terminal"))?.scrollIntoView({ block: "center" }); return 1; })()`);
      await p.encuadrar('textarea[placeholder^="terminal length"]', { margen: 260, max: 1.6 });
      await p.clic('textarea[placeholder^="terminal length"]', { ms: 500 });
      await p.escribir("show version", 14);
      await sleep(600);
      await p.camara(1, 720, 405, 500);
      await sleep(500);
      await p.clic("texto:Guardar", { ms: 600 });
    },
  },
  {
    id: "conectar-ver", cap: "03-comandos-al-conectar", pagina: "app", bloques: [1], continuar: true,
    async run({ p, at, sleep }) {
      await at(1, 0, 0.1);
      await p.dobleClic("texto:core-sw01");
      await sleep(600);
      await p.camara(1.45, 750, 260, 900);
    },
  },
  {
    id: "conectar-notas", cap: "03-comandos-al-conectar", pagina: "escenario", bloques: [2],
    async run({ E, at }) {
      await E("lista", {
        kicker: "Comandos al conectar",
        titulo: "Úsalos solo para preparar la sesión",
        items: [
          { ico: "warn", texto: "No pasan por el motor de riesgo", nota: "Se envían tal cual, uno por línea, esperando el prompt entre cada uno." },
          { ico: "ok", texto: "Nunca se importan desde otros clientes, CSV ni JSON" },
          { ico: "dot", texto: "Solo en sesiones remotas: SSH, Telnet y Serial" },
        ],
      });
      await E("revelar", 1);
      await at(2, 1, 0.4);
      await E("revelar", 3);
    },
  },

  // ===================== Packs de comandos =====================
  { id: "cap-packs", cap: "04-packs-de-comandos", capitulo: "Packs de comandos", pagina: "escenario", dur: 2.6, async run({ E }) { await E("capitulo", { num: "3", titulo: "Packs de comandos", sub: "Crear, exportar, importar y el formato JSON" }); } },
  {
    id: "packs-catalogo", cap: "04-packs-de-comandos", pagina: "app", bloques: [0, 1],
    async preparar(ctx) {
      await conectar(ctx, "core-sw01");
    },
    async run({ p, at, sleep }) {
      await at(0, 0, 0.1);
      await p.clic("titulo:Catálogo de comandos");
      await sleep(1500);
      await at(1, 0, 0);
      await p.clic("titulo:Agregar un comando propio");
      await sleep(400);
      await p.encuadrar("form", { margen: 50, max: 1.5 });
      await p.clic("form textarea", { ms: 400 });
      await p.escribir("show interfaces {{interfaz}} | include rate", 22);
      await p.clic("form label:nth-of-type(2) textarea", { ms: 300 });
      await p.escribir("Tasas de entrada y salida de una interfaz.", 36);
      await valor(p, "form select", "Interfaces");
      await at(1, 1, 0);
      await p.ev(`(() => { const t = document.querySelector("form textarea"); t.focus(); t.select(); return 1; })()`);
      await p.escribir("show version; reload", 16);
      await sleep(2200);
      await p.ev(`(() => { const t = document.querySelector("form textarea"); t.focus(); t.select(); return 1; })()`);
      await p.escribir("show interfaces {{interfaz}} | include rate", 40);
      await sleep(400);
      await p.clic("texto:Guardar", { ms: 500 });
      await p.camara(1, 720, 405, 500);
    },
  },
  {
    id: "packs-ventana", cap: "04-packs-de-comandos", pagina: "app", bloques: [2], continuar: true,
    async run({ p, at, sleep }) {
      await at(2, 0, 0.1);
      await p.clic("titulo:Packs de comandos");
      await sleep(400);
      await p.encuadrar(".shadow-pop", { margen: 30, max: 1.4 });
      await at(2, 1, 0.2);
      await p.mover('[title="Exportar para compartir"]', 600);
      await sleep(900);
      await p.clic('[title="Exportar para compartir"]', { ms: 200 });
    },
  },
  {
    id: "packs-formato", cap: "04-packs-de-comandos", pagina: "escenario", bloques: [3],
    async run({ E, at }) {
      await E("codigo", { kicker: "Formato del pack", archivo: "consultas-campus.json", ruta: "docs/ejemplos/packs/", lenguaje: "json", fs: 17, texto: archivos.pack });
      const lin = archivos.pack.split("\n");
      const n = (re) => lin.findIndex((l) => re.test(l)) + 1;
      await at(3, 0, 1.0);
      await E("marcar", { hl: [n(/"format"/), n(/"formatVersion"/)], seguir: 1 });
      await at(3, 0, 4.0);
      await E("marcar", { hl: [n(/"id"/), n(/"name"/), n(/"vendor"/)], seguir: 1 });
      await at(3, 0, 7.2);
      await E("marcar", { hl: [n(/"platforms"/)], seguir: 1 });
      await at(3, 0, 10.5);
      const risks = lin.map((l, i) => (/"(desc|cat|risk)"/.test(l) ? i + 1 : 0)).filter(Boolean);
      await E("marcar", { hl: [n(/"commands"/), ...risks], seguir: lin.length });
    },
  },
  {
    id: "packs-importar", cap: "04-packs-de-comandos", pagina: "app", bloques: [4, 5],
    async preparar(ctx) {
      await conectar(ctx, "core-sw01");
      await ctx.p.clic("titulo:Catálogo de comandos", { ms: 0 });
      await ctx.sleep(500);
      await ctx.p.clic("titulo:Packs de comandos", { ms: 0 });
      await ctx.p.ev(`(window.__nextOpen = a, 1)`, RUTA_PACK);
      await ctx.sleep(400);
    },
    async run({ p, at, sleep }) {
      await p.encuadrar(".shadow-pop", { margen: 30, max: 1.4, ms: 10 });
      await at(4, 0, 0.1);
      await p.clic("texto:Importar pack");
      await sleep(600);
      await at(4, 1, 0);
      await p.mover("texto:Importar", 500);
      await sleep(800);
      await p.clic("texto:Importar", { ms: 200 });
      await sleep(900);
      await p.clic("texto:Importar pack", { ms: 500 });
      await sleep(400);
      await at(5, 0, 0);
      await p.clic("texto:Cancelar", { ms: 500 });
      await p.mover("texto:Al compartir un pack", 600);
    },
  },

  // ===================== Plugins =====================
  { id: "cap-plugins", cap: "05-plugins", capitulo: "Plugins", pagina: "escenario", dur: 2.6, async run({ E }) { await E("capitulo", { num: "4", titulo: "Plugins", sub: "Estructura, instalación con revisión, seguridad y actualización" }); } },
  {
    id: "plugin-estructura", cap: "05-plugins", pagina: "escenario", bloques: [0],
    async run({ E, sleep }) {
      await E("arbol", {
        kicker: "Estructura de un plugin",
        titulo: "Una carpeta, un manifiesto y un script",
        nodos: [
          { nombre: "diagnostico-basico/", nota: "carpeta o .zip" },
          { nombre: "plugin.json", nota: "manifiesto: id, versión, permisos y acciones", nivel: 1 },
          { nombre: "main.py", nota: "entrada: lee NT_ACTION y usa import netterminal as nt", nivel: 1 },
        ],
        pie: "Las acciones aparecen como botones en Herramientas › Plugins.",
      });
      for (let i = 1; i <= 3; i++) {
        await sleep(i === 1 ? 300 : 1800);
        await E("revelar", i);
      }
      await sleep(3500);
      await E("revelar");
    },
  },
  {
    id: "plugin-manifiesto", cap: "05-plugins", pagina: "escenario", bloques: [1], extra: 1.0,
    async run({ E, at, tiempo, dur }) {
      await E("codigo", { kicker: "1. Manifiesto", archivo: "plugin.json", ruta: "diagnostico-basico/", lenguaje: "json", fs: 19, texto: "", caret: true });
      await at(1, 0, 0.6);
      const t = plugin100.manifiesto;
      await E("escribir", t, Math.ceil(t.length / (dur - tiempo(1, 0) - 0.6 - 2.0)));
    },
  },
  {
    id: "plugin-main", cap: "05-plugins", pagina: "escenario", bloques: [2], extra: 5.0,
    async run({ E, at, tiempo, dur }) {
      const t = plugin100.main;
      await E("codigo", { kicker: "2. Código", archivo: "main.py", ruta: "diagnostico-basico/", lenguaje: "python", fs: 19, texto: "", caret: true });
      await at(2, 0, 0.4);
      await E("escribir", t, Math.ceil(t.length / (dur - tiempo(2, 0) - 0.4 - 1.8)));
      const lin = t.split("\n");
      await E("marcar", { hl: [lin.findIndex((l) => l.includes("NT_ACTION")) + 1, lin.findIndex((l) => l.startsWith("ACCIONES")) + 1] });
    },
  },
  {
    id: "plugin-instalar", cap: "05-plugins", pagina: "app", bloques: [3],
    async preparar(ctx) {
      await conectar(ctx, "core-sw01");
      await instalado(ctx.p, []);
      await ctx.p.ev(`(window.__nextOpen = a, 1)`, `${RUTA_PLUGIN}@1.0.0`);
    },
    async run({ p, at, sleep }) {
      await at(3, 0, 0.1);
      await p.clic(TOOLS);
      await sleep(300);
      await p.clic("texto:Plugins");
      await sleep(600);
      await p.mover("texto:Instalar .zip", 600);
      await sleep(300);
      await p.clic("texto:Desde carpeta");
      await at(3, 1, 0.8);
      await camaraRevision(p);
    },
  },
  {
    id: "plugin-rechazos", cap: "05-plugins", pagina: "escenario", bloques: [4],
    async run({ E, sleep }) {
      await E("lista", {
        kicker: "Validación antes de la revisión",
        titulo: "Lo que la app rechaza",
        items: [
          { ico: "no", texto: "Manifiesto inválido: id, archivo de entrada <code>.py</code>, permisos o acciones" },
          { ico: "no", texto: "Enlaces simbólicos y rutas fuera de la carpeta (zip slip)" },
          { ico: "no", texto: "Más de 200 archivos o más de 20 MB descomprimidos" },
          { ico: "no", texto: "Código que no se puede revisar", nota: "Bytecode y binarios (.pyc, .pyo, .so, .pyd, .dylib, .dll, .exe), archivos .pth y Python que no esté en UTF-8" },
        ],
      });
      for (let i = 1; i <= 4; i++) {
        await sleep(i === 1 ? 300 : 1900);
        await E("revelar", i);
      }
    },
  },
  {
    id: "plugin-revision", cap: "05-plugins", pagina: "app", bloques: [5],
    async preparar(ctx) {
      await conectar(ctx, "core-sw01");
      await instalado(ctx.p, []);
      await ctx.p.ev(`(window.__nextOpen = a, 1)`, `${RUTA_PLUGIN}@1.0.0`);
      await irAPlugins(ctx.p);
      await ctx.p.clic("texto:Desde carpeta", { ms: 0 });
      await ctx.sleep(500);
    },
    async run({ p, at, sleep }) {
      await camaraRevision(p, { ms: 10 });
      await at(5, 0, 0.4);
      await p.mover("texto:Permisos solicitados", 600);
      await sleep(1200);
      await p.ev(`(() => { const pre = [...document.querySelectorAll("pre")].find((x) => x.textContent.includes("===== main.py")); pre.style.scrollBehavior = "smooth"; pre.scrollTop = 0; window.__pre = pre; return 1; })()`);
      await p.mover('pre', 600);
      for (let i = 0; i < 6; i++) {
        await p.ev(`(window.__pre.scrollTop += 110, 1)`);
        await sleep(700);
      }
      await at(5, 1, 0);
      await p.clic("texto:Instalar y habilitar");
      await sleep(600);
      await p.camara(1, 720, 405, 600);
    },
  },
  {
    id: "plugin-huella", cap: "05-plugins", pagina: "escenario", bloques: [6],
    async run({ E, at, sleep }) {
      await E("flujo", {
        kicker: "Control de cambios",
        titulo: "Huella SHA-256 al aprobar",
        pasos: [
          { b: "Apruebas", t: "Se guarda la huella SHA-256 de rutas y contenido de todos los archivos." },
          { b: "Un archivo cambia", t: "La huella ya no coincide.", clase: "alerta" },
          { b: "Bloqueado", t: "No se ejecuta hasta revisar el código.", clase: "alerta" },
          { b: "Revisas y apruebas", t: "Se guarda la nueva huella y vuelve a habilitarse.", clase: "bien" },
        ],
        pie: "Antes de ejecutar se recalcula la huella completa; Python corre con -B y se borra __pycache__.",
      });
      await sleep(300);
      await E("revelar", 1);
      await at(6, 1, 0);
      for (let i = 3; i <= 7; i += 2) {
        await E("revelar", i);
        await sleep(1300);
      }
      await E("revelar");
    },
  },
  {
    id: "plugin-permisos", cap: "05-plugins", pagina: "escenario", bloques: [7],
    async run({ E, at }) {
      await E("tabla", {
        kicker: "Permisos",
        titulo: "Qué hace cumplir la app",
        columnas: ["Permiso", "Qué declara", "¿Lo hace cumplir la app?"],
        filas: [
          ["<code>session</code>", "Leer y enviar comandos a la sesión conectada", '<span class="si">Sí: sin él, se rechaza todo acceso a la sesión</span>'],
          ["<code>network</code>", "Conectarse a la red por su cuenta", '<span class="decl">No: es declarativo</span>'],
          ["<code>files</code>", "Leer o escribir archivos en tu equipo", '<span class="decl">No: es declarativo</span>'],
        ],
        pie: "Python corre con tus privilegios de usuario: la revisión del código es obligatoria.",
      });
      await E("revelar", 1);
      await at(7, 2, 0);
      await E("revelar", 3);
    },
  },
  {
    id: "plugin-ejecutar", cap: "05-plugins", pagina: "app", bloques: [8],
    async preparar(ctx) {
      await conectar(ctx, "core-sw01");
      await instalado(ctx.p, [{ id: "diagnostico-basico", path: `${RUTA_PLUGIN}@1.0.0`, enabled: true, tampered: false }]);
      await irAPlugins(ctx.p);
      await ctx.sleep(400);
    },
    async run({ p, at, sleep }) {
      await at(8, 0, 0.2);
      await p.clic("texto:Interfaces");
      await sleep(4200);
      await p.clic("texto:Versión");
      await sleep(1500);
      await p.encuadrar("texto:Salida de plugins", { margen: 30, max: 1.3 }).catch(() => {});
    },
  },
  {
    id: "plugin-actualizar-codigo", cap: "05-plugins", pagina: "escenario", bloques: [9], extra: 2.5,
    async run({ E, at, sleep }) {
      const m = archivos.manifiesto.split("\n");
      const p = archivos.main.split("\n");
      await E("codigo", { kicker: "Actualizar: 1.0.0 → 1.1.0", archivo: "plugin.json", ruta: "diagnostico-basico/", lenguaje: "json", fs: 19, texto: archivos.manifiesto });
      await E("marcar", { add: [m.findIndex((l) => l.includes('"version"')) + 1, m.findIndex((l) => l.includes('"id": "ping"')) + 1] });
      await at(9, 0, 3.6);
      await E("codigo", { kicker: "Actualizar: 1.0.0 → 1.1.0", archivo: "main.py", ruta: "diagnostico-basico/", lenguaje: "python", fs: 19, texto: archivos.main });
      const ini = p.findIndex((l) => l.startsWith("def ping"));
      const fin = ini + 4;
      const add = [p.findIndex((l) => l === "import re") + 1, ...Array.from({ length: fin - ini }, (_, i) => ini + 1 + i), p.findIndex((l) => l.startsWith("ACCIONES")) + 1];
      await E("marcar", { add, seguir: fin + 6 });
    },
  },
  {
    id: "plugin-actualizar-app", cap: "05-plugins", pagina: "app", bloques: [10],
    async preparar(ctx) {
      await conectar(ctx, "core-sw01");
      await instalado(ctx.p, [{ id: "diagnostico-basico", path: `${RUTA_PLUGIN}@1.0.0`, enabled: true, tampered: false }]);
      await ctx.p.ev(`(window.__nextOpen = a, 1)`, `${RUTA_PLUGIN}@1.1.0`);
      await irAPlugins(ctx.p);
      await ctx.sleep(400);
    },
    async run({ p, at, sleep }) {
      await at(10, 0, 0.1);
      await p.clic("texto:Desde carpeta");
      await sleep(500);
      await camaraRevision(p);
      await sleep(2600);
      await p.ev(`(() => { const pre = [...document.querySelectorAll("pre")].find((x) => x.textContent.includes("===== main.py")); pre.style.scrollBehavior = "smooth"; pre.scrollTop = 420; return 1; })()`);
      await sleep(1400);
      await p.clic("texto:Instalar y habilitar");
      await sleep(400);
      await p.camara(1, 720, 405, 600);
    },
  },
  {
    id: "plugin-alterado", cap: "05-plugins", pagina: "app", bloques: [11],
    async preparar(ctx) {
      await conectar(ctx, "core-sw01");
      await instalado(ctx.p, [{ id: "diagnostico-basico", path: `${RUTA_PLUGIN}@1.1.0`, enabled: true, tampered: true }]);
      await irAPlugins(ctx.p);
      await ctx.sleep(400);
    },
    async run({ p, at, sleep }) {
      await p.encuadrar("texto:✕ Sus archivos cambiaron", { margen: 160, max: 1.5, ms: 10 });
      await at(11, 0, 1.5);
      await p.clic("texto:Revisar código");
      await sleep(2200);
      await p.mover("texto:Aprobar estos cambios y habilitar", 600);
      await sleep(900);
      await p.clic("texto:Aprobar estos cambios y habilitar", { ms: 200 });
      await sleep(400);
      await p.camara(1, 720, 405, 600);
    },
  },
  {
    id: "plugin-ejemplos", cap: "05-plugins", pagina: "escenario", bloques: [12],
    async run({ E, sleep }) {
      await E("arbol", {
        kicker: "En el repositorio",
        titulo: "Ejemplos listos para probar",
        nodos: [
          { nombre: "docs/ejemplos/" },
          { nombre: "scripts/resumen_equipo.py", nota: "script de solo lectura", nivel: 1 },
          { nombre: "plugins/diagnostico-basico/", nota: "plugin 1.1.0: versión, interfaces y ping", nivel: 1 },
          { nombre: "packs/consultas-campus.json", nota: "pack de comandos de consulta", nivel: 1 },
        ],
      });
      for (let i = 1; i <= 4; i++) {
        await sleep(i === 1 ? 200 : 700);
        await E("revelar", i);
      }
    },
  },

  // ===================== Buenas prácticas =====================
  { id: "cap-practicas", cap: "06-buenas-practicas", capitulo: "Buenas prácticas", pagina: "escenario", dur: 2.6, async run({ E }) { await E("capitulo", { num: "5", titulo: "Buenas prácticas", sub: "Antes de automatizar contra equipos reales" }); } },
  {
    id: "practicas", cap: "06-buenas-practicas", pagina: "escenario", bloques: [0, 1, 2],
    async run({ E, at }) {
      await E("lista", {
        kicker: "Buenas prácticas",
        items: [
          { ico: "ok", texto: "Prueba con comandos de consulta y en laboratorio" },
          { ico: "ok", texto: "Variables en lugar de IPs o nombres fijos; nunca contraseñas en botones, scripts, plugins ni packs" },
          { ico: "ok", texto: "Revisa el código de todo script o plugin, en especial de carpetas compartidas" },
          { ico: "ok", texto: "Plugins solo de origen confiable y con los permisos mínimos" },
          { ico: "ok", texto: "Plugins en control de versiones; sube la versión en cada cambio" },
          { ico: "ok", texto: "Al enviar a varios equipos, lee los destinos y el riesgo antes de confirmar" },
        ],
      });
      await at(0, 0, 0.2);
      await E("revelar", 1);
      await at(0, 1, 0);
      await E("revelar", 2);
      await at(1, 0, 0);
      await E("revelar", 3);
      await at(1, 1, 0);
      await E("revelar", 4);
      await at(2, 0, 0);
      await E("revelar", 5);
      await at(2, 1, 0);
      await E("revelar", 6);
    },
  },
  {
    id: "mcp", cap: "06-buenas-practicas", pagina: "escenario", bloques: [3],
    async run({ E, at }) {
      await E("lista", {
        kicker: "Agentes de IA (MCP)",
        titulo: "Servidor MCP local, aparte de scripts y plugins",
        items: [
          { ico: "dot", texto: "Apagado por defecto; solo escucha en 127.0.0.1 y exige token" },
          { ico: "dot", texto: "Aprobación de cada comando y modo solo lectura" },
          { ico: "dot", texto: "Herramientas: listar sesiones, leer salida, enviar comandos y abrir una sesión" },
          { ico: "no", texto: "No ejecuta tus scripts ni plugins, ni envía a varias sesiones" },
        ],
      });
      await at(3, 0, 1.5);
      await E("revelar", 3);
      await at(3, 1, 0);
      await E("revelar", 4);
    },
  },

  // ===================== Cierre =====================
  {
    id: "cierre-resumen", cap: "07-cierre", capitulo: "Cierre", pagina: "escenario", bloques: [0],
    async run({ E, sleep }) {
      await E("lista", {
        kicker: "En resumen",
        items: [
          { texto: "<b>Botones</b> con variables para lo frecuente" },
          { texto: "<b>Scripts</b> para lógica en Python" },
          { texto: "<b>Comandos al conectar</b> para preparar la sesión" },
          { texto: "<b>Packs</b> para compartir comandos" },
          { texto: "<b>Plugins</b> con revisión y control de cambios" },
        ],
      });
      for (let i = 1; i <= 5; i++) {
        await sleep(i === 1 ? 900 : 1900);
        await E("revelar", i);
      }
    },
  },
  {
    id: "cierre-final", cap: "07-cierre", pagina: "escenario", bloques: [1], salida: 2.0,
    async run({ E, sleep }) {
      await E("portada", { kicker: "NetTerminal", h1: "Gracias", sub: "Ejemplos en <code>docs/ejemplos</code> · Detalle en el README", chips: [] });
    },
  },
];
