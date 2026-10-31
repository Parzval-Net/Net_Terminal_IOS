// Tomas del video 2, "Herramientas de red a fondo": qué se ve mientras se narra cada oración de
// guion/*.txt. Una toma parte en la oración `desde: [bloque, oración]` (desde 0, como en
// scripts/video/plugins/guion.mjs; un tercer valor corta dentro de la oración, en segundos) y dura
// hasta donde parte la siguiente toma del capítulo. `at(b, o, s)` espera el inicio de la oración o
// del bloque b más s segundos; `fin(b, o, s)`, su fin.
// Páginas: "app" (la app real con el backend simulado: demo.html + mock-herramientas.js) y
// "escenario" (láminas y diagramas: escenario.html + diagramas.js).
// Datos ficticios: IPs de documentación (RFC 5737), nombres genéricos y secretos de marcador.
export const NOMBRE = "NetTerminal-v2-herramientas";

const espera = (ms) => new Promise((r) => setTimeout(r, ms));
// Contraseña de laboratorio que se teclea en las pestañas: la terminal no la muestra.
const CLAVE = "demo-clave-2026";

// ---------- Ayudas ----------
/** Abre una sesión guardada con doble clic en la barra lateral. */
async function conectar(p, nombre, ms = 0) {
  await p.dobleClic(`texto:${nombre}`, { ms });
  await espera(700);
}
/** Abre Herramientas (⌘E o su pestaña) y un módulo. */
async function modulo(p, nombre, ms = 0) {
  if (!(await p.ev(`!!window.__q("btn:Monitoreo")`))) {
    if (await p.ev(`!!window.__q("texto:Herramientas")`)) await p.clic("texto:Herramientas", { ms });
    else await p.cmd("e");
    await espera(500);
  }
  await p.clic(`btn:${nombre}`, { ms });
  await espera(450);
}
/** Resaltado que no detiene la toma si el elemento no está. */
const suave = (p, ...a) => p.hl(...a).catch((e) => console.log(`    (hl) ${String(e.message ?? e).split("\n")[0]}`));
/** Escribe en la terminal activa la contraseña y Enter (la terminal no hace eco). */
async function clave(p) {
  await p.clic("css:.xterm-screen", { ms: 300 });
  await p.escribir(CLAVE, 16);
  await p.tecla("Enter", "Enter", 13);
}
/** Escribe un comando en la terminal activa. */
async function comando(p, texto, cps = 14) {
  await p.escribir(texto, cps);
  await p.tecla("Enter", "Enter", 13);
}

export const TOMAS = [
  // ===================== 01 Herramientas y módulos =====================
  {
    id: "01-a-portada", cap: "01-herramientas-y-modulos", pagina: "escenario",
    async run({ E, at }) {
      await E("portada", {
        kicker: "Tutorial 2",
        h1: "Herramientas de red<br>a fondo",
        sub: "Para qué sirve cada herramienta de NetTerminal y cuándo usarla. Todos los datos son ficticios.",
        chips: ["Topología", "Transferencias", "SNMP", "Monitoreo", "Respaldos"],
      });
      await at(0, 1, 0.2);
      for (let i = 1; i <= 5; i++) {
        await E("revelar", i);
        await espera(420);
      }
    },
  },
  {
    id: "01-b-modulos", cap: "01-herramientas-y-modulos", pagina: "app", desde: [1, 0],
    async run({ p, at }) {
      await at(1, 0, 0.1);
      await suave(p, "has:Herramientas de red", "⌘E · Ctrl+Shift+E", { lado: "der" });
      await p.mover("has:Herramientas de red", 600);
      await at(1, 0, 1.9);
      await p.sinHl();
      await p.cmd("e");
      await espera(500);
      await at(1, 1, 0);
      await suave(p, "texto:Herramientas", "⌘E · Ctrl+Shift+E", { lado: "der" });
      await at(2, 0, 0);
      await suave(p, "css:nav.w-44", "Módulos", { lado: "der", pad: 2 });
      await at(2, 1, 0.2);
      await p.sinHl();
      await p.clic("btn:Transferencias", { ms: 500 });
      await espera(400);
      await p.clic("Servidor TFTP>>btn:Iniciar", { ms: 600 });
      await espera(500);
      await p.clic("btn:Monitoreo", { ms: 600 });
      await at(2, 2, 0);
      await p.zoom("btn:Transferencias", 2.0, 800);
      await suave(p, "btn:Transferencias", "Punto verde: servidor activo", { lado: "der", tono: "ok", pad: 3 });
      await at(3, 0, 0);
      await p.sinHl();
      await p.unzoom(500);
      await p.clic("titulo:Ajustes", { ms: 500 });
      await espera(350);
      await p.clic("texto:Módulos", { ms: 500 });
      await at(3, 1, 0);
      await p.zoom("has:Diagrama de vecinos", 1.4, 800);
      await suave(p, "has:Muestra u oculta", "Ocultar no borra la configuración", { tono: "neutro", pad: 4 });
    },
  },

  // ===================== 02 Topología: vecinos =====================
  {
    id: "02-a-d1", cap: "02-topologia-vecinos", pagina: "escenario",
    async run({ D, E, at }) {
      await D("vecinos");
      await at(0, 1, 0);
      for (let i = 1; i <= 3; i++) {
        await E("revelar", i);
        await espera(1600);
      }
    },
  },
  {
    id: "02-b-descubrir", cap: "02-topologia-vecinos", pagina: "app", desde: [1, 0], query: { v2: "topology-live" },
    async run({ p, at }) {
      await at(1, 0, 0);
      await conectar(p, "core-sw01", 600);
      await modulo(p, "Topología", 500);
      await at(1, 1, 0.2);
      await suave(p, "campo:Descubrir con", "Consola (CLI)");
      await at(1, 1, 2.9);
      await suave(p, "campo:Equipo (sesión conectada)", "core-sw01 · sesión conectada");
      await at(1, 2, 0);
      await suave(p, "label:Estado de puertos", "", { pad: 4 });
      await at(1, 2, 1.9);
      await p.sinHl();
      await p.clic("btn:Descubrir vecinos", { ms: 500 });
      await espera(250);
      await p.zoom("has:Ejecutando", 1.7, 600);
      await at(1, 4, 0);
      await p.unzoom(400);
      await p.zoom("svgt:Po1 ×2", 2.1, 800);
      await suave(p, "svgt:Po1 ×2", "Port-channel que agrupa Gi1/0/1 y Gi1/0/2", { pad: 4, scroll: false });
    },
  },
  {
    id: "02-c-d2", cap: "02-topologia-vecinos", pagina: "escenario", desde: [2, 0],
    async run({ D, E }) {
      await D("saltos");
      for (let i = 1; i <= 8; i++) {
        await espera(i === 1 ? 300 : 520);
        await E("revelar", i);
      }
    },
  },
  {
    id: "02-d-seguir", cap: "02-topologia-vecinos", pagina: "app", desde: [2, 1], query: { v2: "topology-live", pwd: "dist-sw01", showms: "380" },
    async preparar({ p }) {
      await conectar(p, "core-sw01");
      await modulo(p, "Topología");
      await p.clicYa("btn:Descubrir vecinos");
      await espera(2600);
    },
    async run({ p, at }) {
      await at(2, 1, 0);
      await p.nodo("dist-sw01", { ms: 600 });
      await espera(300);
      await suave(p, "btn:Conectar con", "Sesión guardada: usa sus datos", { lado: "arriba", tono: "neutro" });
      await at(2, 1, 4.6);
      await p.nota("Sin sesión guardada: SSH con el usuario y el jump host de origen", 560, 300, "neutro");
      await at(2, 1, 7.4);
      await p.sinHl();
      await p.clic("btn:Conectar con", { ms: 500 });
      await at(2, 2, 0.2);
      await clave(p);
      await espera(300);
      await p.nota("La contraseña no se muestra", 520, 110, "neutro");
      await at(2, 3, 0);
      await p.sinHl();
      await p.clic("texto:Herramientas", { ms: 500 });
      await espera(300);
      await suave(p, "has:conectado y elegido", "", { pad: 4 });
      await at(2, 3, 1.3);
      await suave(p, "campo:Equipo (sesión conectada)", "Elegido solo");
      await at(2, 3, 2.5);
      await p.sinHl();
      await p.clic("btn:Descubrir vecinos", { ms: 400 });
      await espera(2100);
      await p.camara(1.35, 600, 560, 700);
    },
  },
  {
    id: "02-e-ruta", cap: "02-topologia-vecinos", pagina: "app", desde: [3, 0], query: { scene: "t-topology", topoOpen: "snapshots" }, espera: 2600,
    async run({ p, at }) {
      await at(3, 0, 0.2);
      await p.nodo("core-sw01", { ms: 600 });
      await espera(250);
      await suave(p, "btn:Desde aquí", "", { pad: 4 });
      await at(3, 0, 2.5);
      await p.clic("btn:Desde aquí", { ms: 500 });
      await at(3, 1, 0);
      await p.sinHl();
      await p.nodo("sw-acceso-02", { ms: 600 });
      await espera(200);
      await p.clic("btn:Hasta aquí", { ms: 500 });
      await at(3, 2, 0);
      await p.zoom("css:pre.whitespace-pre-wrap", 1.6, 700);
      await suave(p, "css:pre.whitespace-pre-wrap", "Puertos de cada salto", { pad: 4, lado: "izq" });
      await espera(1100);
      await p.mover("titulo:Copiar ruta", 400).catch(() => {});
      await at(4, 0, 0);
      await p.sinHl();
      await p.unzoom(500);
      await suave(p, "btn:Snapshot", "Guarda una copia antes del cambio", { lado: "arriba" });
      await at(4, 1, 0);
      await p.sinHl();
      await p.elegir("opt:s1", "s1", 500);
      await espera(400);
      await p.camara(1.3, 860, 560, 800);
      await p.nota("Verde: nuevo · rojo punteado: ya no aparece", 620, 300, "neutro");
      await at(4, 2, 0);
      await p.sinHl();
      await p.unzoom(450);
      await p.clic("titulo:Reemplazar el diagrama actual por este snapshot", { ms: 500 });
      await espera(1100);
      await p.clic("btn:Cancelar", { ms: 400 });
      await p.clic("titulo:Eliminar snapshot", { ms: 400 });
      await espera(300);
      await p.nota("Ambos piden confirmación", 600, 220, "neutro");
      await espera(800);
      await p.clic("btn:Cancelar", { ms: 400 });
      await p.sinHl();
      await at(4, 3, 0);
      await p.clic("titulo:Exportar el diagrama", { ms: 500 });
      await espera(400);
      await suave(p, "texto:Copiar como Mermaid", "SVG · draw.io · CSV · Mermaid", { pad: 3, lado: "der" });
    },
  },

  // ===================== 03 Topología sin CDP ni LLDP =====================
  {
    id: "03-a-fuentes", cap: "03-topologia-sin-cdp-lldp", pagina: "app", query: { scene: "topology-sources-off", topoOpen: "fuentes" }, espera: 2600,
    async run({ p, at }) {
      await at(0, 1, 0);
      await p.zoom("h:Fuentes de descubrimiento", 1.45, 900);
      await suave(p, "sec:Fuentes de descubrimiento", "", { pad: 2, scroll: false });
      await at(0, 2, 0.6);
      await suave(p, "label:Vecinos de ruteo", "Apagada = sin comandos", { tono: "neutro", lado: "izq" });
    },
  },
  {
    id: "03-b-ruteo", cap: "03-topologia-sin-cdp-lldp", pagina: "app", desde: [1, 0], query: { scene: "topology-ospf" }, espera: 2600,
    async run({ p, at }) {
      await at(1, 0, 0.3);
      await p.zoom("svgt:rt-borde01", 1.9, 900);
      await suave(p, "svgt:OSPF", "OSPF, EIGRP y BGP", { pad: 4, scroll: false });
      await at(1, 1, 0);
      await suave(p, "svg:192.0.2.41", "Router ID o IP, borde punteado", { pad: 3, scroll: false });
      await at(1, 1, 3.4);
      await suave(p, "svgt:BGP lógica", "Sesión BGP lógica", { pad: 3, scroll: false, lado: "arriba" });
    },
  },
  {
    id: "03-c-descripcion", cap: "03-topologia-sin-cdp-lldp", pagina: "app", desde: [2, 0], query: { scene: "topology-manual", topoOpen: "sugerencias" }, espera: 2600,
    async run({ p, at }) {
      await at(2, 0, 0.2);
      await p.zoom("has:Descripción:", 1.6, 900);
      await suave(p, "has:hacia sw-taller-02 Gi0/24", "Descripción del puerto", { pad: 3, scroll: false });
      await at(2, 1, 0);
      await p.unzoom(500);
      await suave(p, "label:Estado de puertos", "Necesita Estado de puertos", { pad: 3 });
    },
  },
  {
    id: "03-d-d3", cap: "03-topologia-sin-cdp-lldp", pagina: "escenario", desde: [3, 0],
    async run({ D, E, at }) {
      await D("confianza");
      await at(3, 1, 0);
      await E("revelar", 1);
      await at(3, 1, 4.4);
      await E("revelar", 2);
      await at(3, 1, 7.4);
      await E("revelar", 3);
      await espera(1500);
      await E("revelar", 4);
    },
  },
  {
    id: "03-e-sugerencias", cap: "03-topologia-sin-cdp-lldp", pagina: "app", desde: [4, 0], query: { scene: "topology-mac", topoOpen: "sugerencias" }, espera: 2600,
    async run({ p, at }) {
      await at(4, 0, 0.1);
      await suave(p, "btn:Sugerencias", "Nada se dibuja solo", { lado: "arriba", tono: "neutro" });
      await at(4, 1, 0);
      await p.sinHl();
      await p.zoom("h:Sugerencias", 1.45, 800);
      await suave(p, "Sugerencias>>btn:Confirmar", "Confirmar", { pad: 3, scroll: false, lado: "izq" });
      await at(4, 1, 2.4);
      await p.clic("Sugerencias>>btn:Confirmar", { ms: 500 });
      await espera(500);
      await suave(p, "Sugerencias>>btn:Descartar", "Descartar", { pad: 3, scroll: false, lado: "izq" });
      await at(4, 2, 0);
      await p.clic("Sugerencias>>btn:Descartar", { ms: 500 });
      await espera(300);
      await p.nota("Se recuerda por equipo", 900, 160, "neutro");
    },
  },
  {
    id: "03-f-pistas", cap: "03-topologia-sin-cdp-lldp", pagina: "escenario", desde: [4, 3],
    async run({ D, E, at }) {
      await D("pistas");
      await at(4, 3, 1.4);
      await E("revelar", 1);
      await at(4, 3, 3.3);
      await E("revelar", 2);
      await at(4, 3, 5.6);
      await E("revelar", 3);
    },
  },
  {
    id: "03-g-manual", cap: "03-topologia-sin-cdp-lldp", pagina: "app", desde: [5, 0], query: { scene: "topology-manual", topoOpen: "manual,leyenda" }, espera: 2600,
    async run({ p, at }) {
      await at(5, 0, 0.3);
      await p.clic("Manual>>btn:Equipo", { ms: 600 }).catch(() => p.clic("btn:Equipo", { ms: 600 }));
      await espera(400);
      await p.escribir("sw-bodega-01", 16);
      await p.tecla("Tab", "Tab", 9);
      await p.escribir("192.0.2.70", 16);
      await at(5, 0, 5.2);
      await p.nota("+ Enlace: los dos equipos y sus interfaces", 620, 330, "neutro");
      await at(5, 1, 0);
      await p.sinHl();
      await p.clic("btn:Cancelar", { ms: 400 }).catch(() => {});
      await p.zoom("btn:Leyenda", 1.6, 700);
      await suave(p, "has:Equipo manual o visto solo por ruteo", "", { pad: 6, scroll: false });
    },
  },

  // ===================== 04 Topología por SNMP y tráfico =====================
  {
    id: "04-a-snmp", cap: "04-topologia-snmp-y-trafico", pagina: "app", query: { scene: "topology-snmp", noclick: "1" }, espera: 2800,
    async run({ p, at }) {
      await at(0, 0, 0.3);
      await suave(p, "campo:Descubrir con", "SNMP (perfil)");
      await at(0, 1, 0);
      await suave(p, "campo:Perfil SNMP", "Perfil v2c o v3 con secretos en la bóveda", { lado: "abajo" });
      await at(1, 0, 0);
      await p.sinHl();
      await p.clic("btn:Descubrir por SNMP", { ms: 600 });
      await espera(1500);
      await p.zoom("has:por SNMP en", 1.5, 800);
      await suave(p, "has:por SNMP en", "", { pad: 3, scroll: false });
      await at(1, 2, 0);
      await p.unzoom(500);
      await p.nota("EIGRP: solo por consola", 820, 300, "neutro");
      await at(1, 3, 0);
      await p.camara(1.45, 735, 470, 900);
      await p.nota("LLDP-V2 si LLDP-MIB vuelve vacío · Cisco: tabla MAC por VLAN", 560, 250, "neutro");
      await at(1, 4, 0);
      await p.nota("Sin LLDP ni CDP: el protocolo está apagado en el equipo", 640, 300, "neutro");
    },
  },
  {
    id: "04-b-trafico", cap: "04-topologia-snmp-y-trafico", pagina: "app", desde: [2, 0], query: { scene: "topology-traffic", noclick: "1", anim: "0", topoOpen: "trafico", intervalo: "30", unknownSpeed: "1" }, espera: 2800,
    async run({ p, at }) {
      await at(2, 1, 0);
      await suave(p, "titulo:Mostrar el tráfico", "Tráfico", { lado: "abajo" });
      await at(2, 1, 1.3);
      await p.clic("titulo:Mostrar el tráfico", { ms: 500 });
      await suave(p, "h:Tráfico en enlaces", "", { pad: 4 });
      await at(2, 2, 0.5);
      await p.zoom("h:Tráfico en enlaces", 1.45, 800);
      await suave(p, "campo:Cada", "30 s por defecto", { lado: "abajo" });
      await at(2, 2, 4.5);
      await suave(p, "has:SNMP: core-sw01", "", { pad: 3 });
      await at(2, 3, 0.4);
      await suave(p, "has:También por consola", "Ocupa la sesión unos segundos", { lado: "abajo", tono: "warn", scroll: false, pad: 4 });
      await at(3, 0, 0);
      await suave(p, "has:segunda lectura", "Primera lectura: sin tasa", { lado: "abajo", tono: "neutro" });
      await at(3, 1, 0);
      await suave(p, "label:Color por utilización", "", { pad: 3 });
      await at(3, 1, 1.8);
      await suave(p, "label:Animación", "Animación: apagada", { pad: 3, lado: "abajo" });
      await at(4, 0, 0);
      await p.sinHl();
      await p.unzoom(600);
      await p.camara(1.35, 700, 470, 800);
      await at(4, 1, 0);
      await p.zoom("svgt:fw-perimetro", 1.8, 800);
      await p.nota("Violeta: velocidad desconocida", 600, 150, "neutro");
      await at(4, 2, 0);
      await p.sinHl();
      await p.unzoom(500);
      await p.clic("btn:Leyenda", { ms: 500 });
      await espera(300);
      await p.zoom("btn:Leyenda", 1.7, 800);
      await suave(p, "has:aproximada", "≈ aproximada: solo BW configurado", { pad: 3, scroll: false, lado: "arriba" });
    },
  },
  {
    id: "04-c-d4", cap: "04-topologia-snmp-y-trafico", pagina: "escenario", desde: [5, 0],
    async run({ D, E, at }) {
      await D("trafico");
      await at(5, 0, 3.0);
      await E("revelar", 1);
      await at(5, 1, 0);
      await E("revelar", 2);
      await at(5, 1, 2.2);
      await E("revelar", 3);
    },
  },
  {
    id: "04-d-hover", cap: "04-topologia-snmp-y-trafico", pagina: "app", desde: [5, 2], query: { scene: "topology-traffic", anim: "0" }, espera: 2800,
    async preparar() {
      await espera(17500);
    },
    async run({ p, at }) {
      await at(5, 2, 0);
      await p.zoom("svg:dist-sw01", 1.6, 700);
      await p.mover("svgt:Gi1/0/48", 600).catch(() => {});
    },
  },

  // ===================== 05 Transferencias: conceptos =====================
  {
    id: "05-a-intro", cap: "05-transferencias-conceptos", pagina: "escenario",
    async run({ E }) {
      await E("capitulo", { num: "5", titulo: "Transferencias", sub: "Quién inicia la copia y si viaja cifrada" });
    },
  },
  {
    id: "05-b-d5", cap: "05-transferencias-conceptos", pagina: "escenario", desde: [1, 0],
    async run({ D, E, at }) {
      await D("quienInicia");
      await at(1, 0, 0.6);
      await E("revelar", 1);
      await at(1, 1, 0);
      await E("revelar", 2);
    },
  },
  {
    id: "05-c-d6", cap: "05-transferencias-conceptos", pagina: "escenario", desde: [2, 0],
    async run({ D, E, at }) {
      await D("protocolos");
      await at(2, 0, 0.3);
      await E("revelar", 1);
      await at(2, 1, 0);
      await E("revelar", 2);
      await at(2, 2, 0);
      await E("revelar", 3);
      await at(2, 3, 0);
      await E("revelar", 4);
    },
  },
  {
    id: "05-d-ip", cap: "05-transferencias-conceptos", pagina: "app", desde: [3, 0], query: { ips: "multi" },
    async preparar({ p }) {
      await modulo(p, "Transferencias");
    },
    async run({ p, at }) {
      await at(3, 0, 0.2);
      await p.ver("h:Archivos compartidos", "center");
      await espera(700);
      await suave(p, "sec:Archivos compartidos", "Misma carpeta para TFTP, HTTP y FTP", { pad: 2, lado: "arriba" });
      await at(3, 1, 0);
      await p.ver("h:Servidor TFTP", "center");
      await espera(600);
      await suave(p, "campo:IP de este PC (para los comandos)", "Las IP de tu computador", { lado: "abajo" });
      await at(3, 2, 1.6);
      await p.zoom("campo:IP de este PC (para los comandos)", 1.6, 700);
      await p.elegir("campo:IP de este PC (para los comandos)", "203.0.113.254", 400);
      await espera(900);
      await p.elegir("campo:IP de este PC (para los comandos)", "198.51.100.77", 400);
      await espera(900);
      await p.elegir("campo:IP de este PC (para los comandos)", "192.0.2.250", 400);
      await suave(p, "campo:IP de este PC (para los comandos)", "Usa la de la red de gestión", { lado: "abajo", tono: "ok" });
      await at(3, 3, 0);
      await p.sinHl();
      await p.unzoom(500);
      await suave(p, "has:permite el acceso solo en redes privadas", "Firewall: solo redes privadas", { lado: "abajo", tono: "warn", pad: 4 });
    },
  },

  // ===================== 06 Servidores TFTP y HTTP =====================
  {
    id: "06-a-tftp", cap: "06-servidores-tftp-y-http", pagina: "app",
    async preparar({ p }) {
      await modulo(p, "Transferencias");
      await p.ver("h:Servidor TFTP", "start", false);
    },
    async run({ p, at }) {
      await at(0, 0, 0.2);
      await suave(p, "sec:Servidor TFTP", "", { pad: 2 });
      await at(0, 1, 0);
      await p.sinHl();
      await p.clic("Servidor TFTP>>btn:Iniciar", { ms: 500 });
      await espera(300);
      await p.zoom("has:Activo · UDP 69", 1.7, 700);
      await suave(p, "has:Activo · UDP 69", "", { pad: 3, scroll: false });
      await at(1, 0, 0);
      await p.sinHl();
      await p.unzoom(400);
      await p.zoom("Servidor TFTP>>has:Desde el equipo", 1.5, 700);
      await suave(p, "Servidor TFTP>>has:copy tftp://", "Cisco", { pad: 3, scroll: false, lado: "arriba" });
      await at(1, 0, 4.2);
      await suave(p, "Servidor TFTP>>has:get c9300", "Huawei", { pad: 3, scroll: false });
      await at(1, 1, 0);
      await p.sinHl();
      await p.unzoom(400);
      await p.ver("h:Archivos compartidos", "center");
      await espera(500);
      await p.clic("Archivos compartidos>>has:FGT_200F-v7.4.5.out", { ms: 500 });
      await p.ver("h:Servidor TFTP", "start");
      await espera(500);
      await suave(p, "Servidor TFTP>>has:copy tftp://", "Archivo elegido e IP del selector", { pad: 3, lado: "abajo" });
      await at(2, 0, 0);
      await p.sinHl();
      await suave(p, "Servidor TFTP>>label:Permitir subidas", "Solo entrega archivos", { pad: 3, tono: "neutro" });
      await at(2, 1, 0.4);
      await p.clic("Servidor TFTP>>label:Permitir subidas", { ms: 500 });
      await espera(400);
      await suave(p, "Servidor TFTP>>has:copy running-config tftp://", "Al instante · no se guarda", { pad: 3, tono: "ok" });
      await at(3, 0, 0);
      await p.sinHl();
      await suave(p, "sec:Servidor HTTP", "TCP 8080 · solo lectura", { pad: 2, lado: "abajo" });
      await at(3, 0, 2.4);
      await p.clic("Servidor HTTP>>btn:Iniciar", { ms: 500 });
      await at(3, 1, 0);
      await p.zoom("Servidor HTTP>>has:copy http://", 1.6, 700);
      await suave(p, "Servidor HTTP>>has:copy http://", "IP y puerto", { pad: 3, scroll: false });
    },
  },
  {
    id: "06-b-d12", cap: "06-servidores-tftp-y-http", pagina: "escenario", desde: [4, 0],
    async run({ D, E, at }) {
      await D("puertos");
      await at(4, 1, 0);
      await E("revelar", 1);
      await at(4, 2, 1.2);
      await E("revelar", 2);
      await espera(900);
      await E("revelar", 3);
      await espera(900);
      await E("revelar", 4);
      await espera(1000);
      await E("revelar", 5);
    },
  },
  {
    id: "06-c-d8", cap: "06-servidores-tftp-y-http", pagina: "escenario", desde: [5, 0],
    async run({ D, E }) {
      await D("flujoFirmware");
      for (let i = 1; i <= 7; i++) {
        await espera(i === 1 ? 500 : 1000);
        await E("revelar", i);
      }
    },
  },
  {
    id: "06-d-firmware", cap: "06-servidores-tftp-y-http", pagina: "app", desde: [5, 0, 8.6], query: { sinimagen: "1" },
    async preparar({ p }) {
      await modulo(p, "Transferencias");
      await p.ver("h:Archivos compartidos", "end", false);
    },
    async run({ p, at }) {
      await at(5, 0, 8.8);
      await p.clic("Archivos compartidos>>btn:Agregar", { ms: 400 });
      await espera(400);
      await p.clic("Archivos compartidos>>has:c9300-universalk9.17.12.04.SPA.bin", { ms: 300 });
      await p.ver("h:Servidor HTTP", "start", false);
      await p.clic("Servidor HTTP>>btn:Iniciar", { ms: 300 });
      await p.ev(`(window.__v2.transfer({ proto: "http", ms: 2700 }), 1)`);
      await espera(400);
      await p.ver("h:Transferencias", "center", false);
      await suave(p, "sec:Transferencias", "Avance de la copia", { pad: 2, lado: "arriba" });
      await espera(2500);
      await p.sinHl();
      await p.ver("h:Servidor HTTP", "start", false);
      await p.clic("Servidor HTTP>>btn:Detener", { ms: 300 });
      await suave(p, "Servidor HTTP>>has:Detenido", "Detenido al terminar", { pad: 3, tono: "ok" });
    },
  },
  {
    id: "06-e-d8-fin", cap: "06-servidores-tftp-y-http", pagina: "escenario", desde: [5, 1],
    async run({ D, E }) {
      await D("flujoFirmware");
      await E("revelar", 7);
      await espera(600);
      await E("revelar", 8);
    },
  },

  // ===================== 07 FTP: servidor y cliente =====================
  {
    id: "07-a-servidor", cap: "07-ftp-servidor-y-cliente", pagina: "app",
    async preparar({ p }) {
      await modulo(p, "Transferencias");
      await p.ver("h:Servidor FTP", "start", false);
    },
    async run({ p, at }) {
      await at(0, 1, 0);
      await suave(p, "sec:Servidor FTP", "TCP 21", { pad: 2, lado: "der" });
      await at(1, 0, 0);
      await p.sinHl();
      await p.clic("Servidor FTP>>btn:Iniciar", { ms: 500 });
      await espera(400);
      await p.zoom("Servidor FTP>>has:Contraseña", 1.6, 700);
      await suave(p, "Servidor FTP>>has:Contraseña", "Usuario nt · contraseña nueva", { pad: 4, scroll: false });
      await at(1, 0, 4.3);
      await p.clic("Servidor FTP>>btn:Detener", { ms: 400 });
      await espera(300);
      await p.clic("Servidor FTP>>btn:Iniciar", { ms: 400 });
      await espera(300);
      await suave(p, "Servidor FTP>>has:Contraseña", "Otra contraseña: los comandos ya la incluyen", { pad: 4, scroll: false });
      await at(1, 2, 0);
      await p.sinHl();
      await p.clic("Servidor FTP>>label:Permitir subidas", { ms: 500 });
      await espera(300);
      await suave(p, "Servidor FTP>>has:Contraseña", "Subidas en caliente: misma contraseña", { pad: 4, scroll: false, tono: "ok" });
      await at(2, 0, 0);
      await p.sinHl();
      await p.unzoom(400);
      await suave(p, "Servidor FTP>>has:FTP no cifra", "", { pad: 3 });
      await at(2, 1, 0);
      await suave(p, "Servidor FTP>>has:usa 2121", "21 → 2121", { pad: 3 });
    },
  },
  {
    id: "07-b-cliente", cap: "07-ftp-servidor-y-cliente", pagina: "app", desde: [3, 0],
    async preparar({ p }) {
      await modulo(p, "Transferencias");
      await p.ver("h:Cliente FTP / FTPS", "start", false);
    },
    async run({ p, at }) {
      await at(3, 0, 0.3);
      await suave(p, "sec:Cliente FTP / FTPS", "Tu PC se conecta al servidor de la empresa", { pad: 2, lado: "abajo" });
      await at(3, 1, 0);
      await p.sinHl();
      await p.clic("Cliente FTP / FTPS>>campo:Servidor", { ms: 400 });
      await p.escribir("203.0.113.30", 22);
      await p.clic("Cliente FTP / FTPS>>campo:Usuario", { ms: 300 });
      await p.escribir("operador", 22);
      await p.clic("Cliente FTP / FTPS>>campo:Contraseña", { ms: 300 });
      await p.escribir("demo-ftp-2026", 22);
      await p.clic("Cliente FTP / FTPS>>btn:Listar", { ms: 400 });
      await espera(700);
      await p.dobleClic("Cliente FTP / FTPS>>has:cisco", { ms: 400 });
      await at(3, 2, 0);
      await p.clic("titulo:Traer a la carpeta compartida", { ms: 500 });
      await espera(300);
      await suave(p, "titulo:Traer a la carpeta compartida", "Trae el archivo", { pad: 3, lado: "izq" });
      await at(4, 0, 0);
      await p.sinHl();
      await p.zoom("Cliente FTP / FTPS>>label:FTPS explícito", 1.6, 700);
      await suave(p, "Cliente FTP / FTPS>>label:FTPS explícito", "Activo por defecto", { pad: 3, scroll: false, tono: "ok" });
      await at(4, 1, 0);
      await suave(p, "has:Certificados del sistema, sin excepciones", "", { pad: 3, scroll: false });
      await at(4, 2, 0);
      await p.clic("Cliente FTP / FTPS>>label:FTPS explícito", { ms: 400 });
      await espera(300);
      await suave(p, "has:Sin TLS la contraseña", "No desactives TLS como solución", { pad: 3, scroll: false, tono: "bad" });
      await espera(1800);
      await p.clic("Cliente FTP / FTPS>>label:FTPS explícito", { ms: 400 });
      await p.sinHl();
    },
  },

  // ===================== 08 SFTP y SCP =====================
  {
    id: "08-a-d9", cap: "08-sftp-y-scp", pagina: "escenario",
    async run({ D, E }) {
      await D("scp", { simple: true });
      await espera(2500);
      await E("revelar", 1);
    },
  },
  {
    id: "08-b-sftp", cap: "08-sftp-y-scp", pagina: "app", desde: [1, 0],
    async preparar({ p }) {
      await conectar(p, "core-sw01");
      await modulo(p, "Transferencias");
      await p.ver("h:SFTP interactivo", "center", false);
    },
    async run({ p, at }) {
      await at(1, 0, 0.2);
      await suave(p, "SFTP interactivo>>campo:Equipo", "core-sw01 · 192.0.2.1", { lado: "abajo" });
      await at(1, 0, 2.6);
      await p.sinHl();
      await p.clic("SFTP interactivo>>btn:Abrir SFTP", { ms: 500 });
      await at(1, 1, 0.2);
      await clave(p);
      await p.camara(1.7, 560, 200, 700);
      await at(1, 2, 0);
      await comando(p, "ls");
      await espera(900);
      await comando(p, "get packages.conf");
      await espera(400);
      await p.nota("get y put: carpeta compartida", 600, 200, "neutro");
      await at(2, 0, 0);
      await p.sinHl();
      await p.unzoom(400);
      await p.clic("texto:Herramientas", { ms: 400 });
      await espera(300);
      await p.ver("h:Gestor de archivos", "start");
      await p.elegir("campo:Protocolo", "scp", 400);
      await p.clic("Gestor de archivos>>texto:c9300-universalk9.17.12.04.SPA.bin", { ms: 400 });
      await p.clic("btn:Enviar", { ms: 400 });
      await espera(600);
      await p.nota("Pestaña SCP: escribe la contraseña ahí", 520, 110, "neutro");
    },
  },
  {
    id: "08-c-d9", cap: "08-sftp-y-scp", pagina: "escenario", desde: [3, 0],
    async run({ D, E, at }) {
      await D("scp");
      await at(3, 1, 0);
      await E("revelar", 1);
      await at(3, 3, 0);
      await E("revelar", 2);
      await at(3, 4, 2.5);
      await E("revelar", 3);
    },
  },
  {
    id: "08-d-md5", cap: "08-sftp-y-scp", pagina: "app", desde: [4, 0],
    async preparar({ p }) {
      await conectar(p, "core-sw01");
      await modulo(p, "Transferencias");
      await p.ver("h:SFTP interactivo", "center", false);
      await p.clicYa("SFTP interactivo>>btn:Abrir SFTP");
      await espera(600);
      await p.clicYa("css:.xterm-screen");
      await p.escribir(CLAVE, 200);
      await p.tecla("Enter", "Enter", 13);
      await espera(400);
      await p.clicYa("texto:Herramientas");
      await p.ver("h:Gestor de archivos", "start", false);
      await p.clicYa("btn:Leer archivos");
      await espera(900);
      await p.valor("campo:Protocolo", "scp");
      await p.clicYa("Gestor de archivos>>texto:c9300-universalk9.17.12.04.SPA.bin");
      await p.clicYa("btn:Enviar");
      await espera(700);
    },
    async run({ p, at }) {
      await p.ev(`(window.__v2.busy(1), 1)`);
      await at(4, 0, 0.6);
      await clave(p);
      await espera(1500);
      await p.clic("texto:Herramientas", { ms: 400 });
      await espera(200);
      await p.ver("has:Operaciones", "center");
      await p.zoom("css:div.p-3.space-y-2", 1.25, 700);
      await suave(p, "has:→ Enviar", "SCP en su pestaña: al terminar con código 0…", { pad: 4, scroll: false });
      await at(4, 0, 6.3);
      await suave(p, "has:✓ MD5", "…verifica el MD5 en la sesión del equipo", { pad: 4, scroll: false, tono: "ok" });
      await at(4, 1, 0.3);
      await suave(p, "has:✓ MD5", "Sesión tomada por un script: reintenta cada 5 s, hasta 2 min", { pad: 4, scroll: false, tono: "warn" });
      await at(4, 1, 4.3);
      await suave(p, "has:✓ MD5", "MD5 verificado", { pad: 4, scroll: false, tono: "ok" });
      await at(4, 2, 0);
      await p.sinHl();
      await p.unzoom(400);
      await p.clic("has:SFTP core-sw01", { ms: 500 });
      await espera(300);
      await p.clic("css:.xterm-screen", { ms: 300 });
      await comando(p, "bye");
      await espera(900);
      await p.clic("texto:Herramientas", { ms: 400 });
      await p.ver("h:SFTP interactivo", "center");
      await espera(500);
      await p.zoom("has:Sesión SFTP cerrada", 1.5, 700);
      await suave(p, "has:Sesión SFTP cerrada", "Pulsa MD5 en el gestor", { pad: 4, scroll: false, tono: "warn" });
    },
  },

  // ===================== 09 Gestor de archivos =====================
  {
    id: "09-a-gestor", cap: "09-gestor-de-archivos", pagina: "app", query: { copyms: "5200" },
    async preparar({ p }) {
      await conectar(p, "core-sw01");
      await conectar(p, "nx-agg01");
      await modulo(p, "Transferencias");
      await espera(400);
    },
    async run({ p, at }) {
      await at(0, 0, 0.3);
      await suave(p, "has:Este PC · carpeta compartida", "Tu PC", { pad: 4, lado: "abajo" });
      await at(0, 0, 3.4);
      await suave(p, "has:core-sw01 · flash:", "El equipo", { pad: 4, lado: "abajo" });
      await at(0, 1, 0);
      await suave(p, "campo:Equipo (sesión conectada)", "Necesita una sesión abierta", { lado: "abajo" });
      await at(1, 0, 0);
      await suave(p, "campo:Tipo de equipo", "IOS-XE detectado: Cisco IOS", { lado: "abajo" });
      await at(1, 1, 3.0);
      const nx = await p.ev(`[...window.__q("campo:Equipo (sesión conectada)").options].find((o) => o.textContent.startsWith("nx-agg01")).value`);
      await p.elegir("campo:Equipo (sesión conectada)", nx, 500);
      await espera(500);
      await suave(p, "campo:Almacenamiento", "bootflash:", { lado: "abajo" });
      await espera(1500);
      await suave(p, "css:input[placeholder='VRF (management)']", "VRF management, editable", { lado: "abajo" });
      await at(1, 2, 0);
      const core = await p.ev(`[...window.__q("campo:Equipo (sesión conectada)").options].find((o) => o.textContent.startsWith("core-sw01")).value`);
      await p.elegir("campo:Equipo (sesión conectada)", core, 400);
      await suave(p, "campo:IP de este PC", "Según la ruta al equipo", { lado: "abajo" });
      await at(1, 2, 2.6);
      await p.sinHl();
      await p.clic("btn:Leer archivos", { ms: 400 });
      await espera(900);
      await suave(p, "has:libre", "Espacio libre", { pad: 3, lado: "arriba" });
      await at(2, 0, 0);
      await p.sinHl();
      await p.elegir("campo:Protocolo", "http", 400);
      await p.clic("Gestor de archivos>>texto:c9300-universalk9.17.12.04.SPA.bin", { ms: 400 });
      await p.clic("btn:Enviar", { ms: 400 });
      await at(2, 1, 0);
      await p.ver("has:Operaciones", "center");
      await p.clic("titulo:Ver salida del equipo", { ms: 400 });
      await espera(200);
      await p.zoom("titulo:Ver salida del equipo", 1.4, 700);
      await at(2, 2, 0);
      await p.unzoom(400);
      await p.ver("h:Gestor de archivos", "start");
      await espera(1200);
      await p.clic("Gestor de archivos>>texto:c9300-universalk9.17.12.04.SPA.bin", { ms: 300 });
      await p.clic("btn:Enviar", { ms: 300 });
      await espera(300);
      await suave(p, "has:Sobrescribir", "Avisa antes", { pad: 4, tono: "warn" });
      await espera(1200);
      await p.clic("btn:Cancelar", { ms: 300 });
      await p.sinHl();
    },
  },
  {
    id: "09-b-servidores", cap: "09-gestor-de-archivos", pagina: "app", desde: [3, 0], query: { copyms: "4000" },
    async preparar({ p }) {
      await conectar(p, "core-sw01");
      await modulo(p, "Transferencias");
      await p.clicYa("btn:Leer archivos");
      await espera(1200);
    },
    async run({ p, at }) {
      await at(3, 0, 0.2);
      await p.elegir("campo:Protocolo", "tftp", 400);
      await p.clic("ultimo:config.text", { ms: 400 });
      await p.clic("btn:Traer", { ms: 400 });
      await espera(500);
      await p.ver("h:Servidor TFTP", "center");
      await espera(400);
      await suave(p, "Servidor TFTP>>has:Activo", "Iniciado para la operación", { pad: 3, tono: "ok" });
      await at(3, 1, 0);
      await suave(p, "Servidor TFTP>>label:Permitir subidas", "Subidas en caliente, solo para traer", { pad: 3 });
      await espera(2600);
      await suave(p, "Servidor TFTP>>has:Detenido", "Detenido al terminar", { pad: 3, tono: "neutro" });
      await at(4, 0, 0);
      await p.sinHl();
      await p.ver("h:Gestor de archivos", "start");
      await espera(400);
      await suave(p, "label:Verificar MD5 después de enviar", "Compara el hash al terminar", { pad: 3 });
      await at(4, 0, 2.8);
      await p.nota("Si no coincide: ✕ MD5 no coincide, en rojo", 620, 400, "bad");
      await at(5, 0, 0);
      await p.sinHl();
      await suave(p, "btn:Respaldar config", "Sin enmascarar · no entra en Respaldos", { pad: 3, lado: "izq", tono: "warn" });
      await at(5, 0, 2.8);
      await p.clic("btn:Respaldar config", { ms: 400 });
      await espera(2200);
      await p.ver("has:Operaciones", "center");
      await espera(500);
      await suave(p, "has:con contraseñas y communities sin", "", { pad: 4 });
      await at(5, 1, 0);
      await p.nota("Historial enmascarado y comparable: módulo Respaldos", 560, 200, "neutro");
    },
  },

  // ===================== 10 Cliente SNMP =====================
  {
    id: "10-a-d10", cap: "10-cliente-snmp", pagina: "escenario",
    async run({ D }) {
      await D("snmp");
    },
  },
  {
    id: "10-b-perfil", cap: "10-cliente-snmp", pagina: "app", desde: [1, 0],
    async preparar({ p }) {
      await modulo(p, "SNMP");
    },
    async run({ p, at }) {
      await at(1, 0, 0.2);
      await suave(p, "sec:Destino SNMP", "", { pad: 2 });
      await at(1, 1, 0);
      await p.sinHl();
      await p.clic("campo:Host o IP", { ms: 400 });
      await p.ev(`(window.__q("campo:Host o IP").select(), 1)`);
      await p.escribir("192.0.2.1", 18);
      await suave(p, "campo:Versión", "SNMPv3 por defecto", { lado: "abajo" });
      await at(1, 2, 0);
      await p.zoom("campo:Autenticación", 1.4, 700);
      await suave(p, "campo:Nivel", "authPriv", { lado: "abajo" });
      await at(1, 2, 3.0);
      await suave(p, "campo:Autenticación", "SHA-256", { lado: "abajo" });
      await at(1, 2, 4.6);
      await suave(p, "campo:Privacidad", "AES-128", { lado: "abajo" });
      await at(1, 3, 0);
      await suave(p, "label:Mostrar algoritmos heredados", "MD5 y DES ocultos", { lado: "abajo" });
      await at(1, 3, 3.2);
      await p.sinHl();
      await p.elegir("campo:Versión", "2c", 400);
      await espera(400);
      await suave(p, "has:texto claro", "v2c: comunidad en claro", { lado: "abajo", tono: "warn", pad: 3, scroll: false });
      await espera(2600);
      await p.elegir("campo:Versión", "3", 400);
      await p.sinHl();
      await at(2, 0, 0);
      await suave(p, "label:Guardar secretos en la bóveda", "Para que Topología los use", { lado: "abajo" });
      await at(2, 0, 3.4);
      await suave(p, "has:Secretos en la bóveda", "Atados a este host y puerto", { lado: "abajo", pad: 3 });
      await at(3, 0, 0);
      await p.sinHl();
      await p.unzoom(500);
      await p.ver("h:Consulta", "start");
      await espera(400);
      await p.clic("Consulta>>btn:GET", { ms: 400 });
      await suave(p, "Consulta>>btn:GET", "OID exacto", { lado: "abajo", pad: 3 });
      await at(3, 0, 2.0);
      await p.clic("Consulta>>btn:GETNEXT", { ms: 400 });
      await suave(p, "Consulta>>btn:GETNEXT", "El siguiente", { lado: "abajo", pad: 3 });
      await at(3, 1, 0);
      await p.sinHl();
      await p.clic("Consulta>>btn:system", { ms: 500 });
      await espera(300);
      await p.clic("Consulta>>btn:Consultar", { ms: 400 });
      await espera(900);
      await suave(p, "has:filas en", "Tope de filas y Detener", { lado: "abajo", pad: 3 });
      await at(3, 2, 0);
      await p.sinHl();
      await p.ver("h:Conjuntos de OIDs", "start");
      await p.clic("Conjuntos de OIDs>>btn:Interfaces", { ms: 400 });
      await espera(1200);
      await suave(p, "btn:Medir tasas", "Calcula el tráfico", { lado: "abajo", pad: 3 });
      await at(3, 2, 5.0);
      await p.clic("btn:Medir tasas", { ms: 400 }).catch(() => {});
    },
  },
  {
    id: "10-c-d10", cap: "10-cliente-snmp", pagina: "escenario", desde: [4, 0],
    async run({ D, E }) {
      await D("snmp", { completo: true });
      await espera(2000);
      await E("revelar", 1);
      await espera(2400);
      await E("revelar", 2);
    },
  },
  {
    id: "10-d-traps", cap: "10-cliente-snmp", pagina: "app", desde: [4, 1],
    async preparar({ p }) {
      await modulo(p, "SNMP");
      await p.ver("h:Receptor de traps", "center", false);
    },
    async run({ p, at }) {
      await at(4, 1, 0);
      await p.zoom("campo:Escuchar en", 1.5, 600);
      await suave(p, "campo:Escuchar en", "127.0.0.1: solo este PC", { lado: "abajo", tono: "warn" });
      await at(4, 1, 2.2);
      await p.sinHl();
      await p.clic("btn:Escuchar en 192.0.2.250", { ms: 500 });
      await espera(300);
      await suave(p, "campo:Escuchar en", "IP de gestión", { lado: "abajo", tono: "ok" });
      await at(4, 2, 0);
      await p.sinHl();
      await p.clic("Receptor de traps>>btn:Iniciar", { ms: 500 });
      await espera(900);
      await suave(p, "has:1162", "162 → 1162", { pad: 3 });
    },
  },
  {
    id: "10-e-generador", cap: "10-cliente-snmp", pagina: "app", desde: [5, 0], query: { scene: "snmpgen" }, espera: 2800,
    async run({ p, at }) {
      await at(5, 0, 0.3);
      await suave(p, "btn:Generador de configuración", "Agente de solo lectura", { lado: "abajo" });
      await at(5, 1, 0);
      await suave(p, "has:NMS autorizados", "Obligatorio para la ACL", { lado: "abajo", pad: 3 });
      await at(5, 2, 0);
      await p.sinHl();
      await p.zoom("has:<AUTH_PASS>", 1.5, 700).catch(() => {});
      await suave(p, "has:<AUTH_PASS>", "Marcador: reemplázalo antes de pegar", { pad: 3, scroll: false });
      await at(5, 2, 4.0);
      await suave(p, "has:! Verifica", "Sintaxis según la versión", { pad: 3, scroll: false });
    },
  },

  // ===================== 11 Monitoreo, diagnóstico y más =====================
  {
    id: "11-a-monitoreo", cap: "11-monitoreo-y-diagnostico", pagina: "app", query: { scene: "monitor" }, espera: 3000,
    async run({ p, at }) {
      await at(0, 1, 0);
      await p.clic("btn:Nueva sonda", { ms: 500 });
      await espera(400);
      await p.zoom("campo:Tipo", 1.5, 600);
      await suave(p, "campo:Tipo", "ICMP o TCP", { lado: "abajo" });
      await at(0, 2, 0);
      await suave(p, "campo:Caído tras", "3 fallas seguidas", { lado: "abajo" });
      await at(0, 3, 0);
      await p.clic("btn:Cancelar", { ms: 400 });
      await p.sinHl();
      await p.unzoom(300);
      await p.zoom("has:Enlace sucursal norte", 1.5, 700);
      await p.nota("Alarma al caer y al recuperarse", 700, 200, "neutro");
    },
  },
  {
    id: "11-b-diag", cap: "11-monitoreo-y-diagnostico", pagina: "app", desde: [1, 0],
    async preparar({ p }) {
      await modulo(p, "Diagnóstico");
      await p.valor("Puertos TCP>>campo:Host", "192.0.2.1");
      await p.valor("Puertos TCP>>campo:Puertos", "22,23,443");
      await p.clicYa("Puertos TCP>>btn:Revisar");
      await espera(1200);
    },
    async run({ p, at }) {
      await at(1, 0, 0.1);
      await p.camara(1.3, 800, 330, 600);
      await suave(p, "sec:Ping continuo", "Ping continuo", { pad: 2, lado: "abajo" });
      await espera(1300);
      await suave(p, "sec:Traceroute", "Traceroute", { pad: 2, lado: "abajo" });
      await espera(1100);
      await suave(p, "sec:Puertos TCP", "22 y 443 abiertos · 23 rechazado", { pad: 2, lado: "abajo", tono: "ok" });
    },
  },
  {
    id: "11-c-velocidad", cap: "11-monitoreo-y-diagnostico", pagina: "app", desde: [2, 0], query: { scene: "speed" }, espera: 2600,
    async run({ p, at }) {
      await at(2, 0, 0.3);
      await p.zoom("has:95 MB", 1.4, 700);
      await suave(p, "has:95 MB", "~95 MB por prueba", { pad: 3 });
      await at(2, 0, 5.5);
      await suave(p, "has:iperf3", "iperf3 entre dos puntos", { pad: 3 });
    },
  },
  {
    id: "11-d-subredes", cap: "11-monitoreo-y-diagnostico", pagina: "app", desde: [3, 0], query: { scene: "subnet" }, espera: 2600,
    async run({ p, at }) {
      await at(3, 0, 0.3);
      await p.camara(1.3, 760, 380, 700);
      await suave(p, "Calculadora de subredes>>css:input", "IPv4 o IPv6", { pad: 3 });
      await at(3, 0, 2.6);
      await p.elegir("campo:Nuevo prefijo", "28", 400);
      await suave(p, "campo:Nuevo prefijo", "Divide una red IPv4 en subredes", { pad: 3, lado: "der" });
    },
  },
  {
    id: "11-e-syslog", cap: "11-monitoreo-y-diagnostico", pagina: "app", desde: [4, 0], query: { scene: "t-syslog" }, espera: 2600,
    async run({ p, at }) {
      await at(4, 0, 0.2);
      await p.camara(1.35, 780, 300, 600);
      await p.clic("btn:Iniciar", { ms: 500 });
      await espera(400);
      await suave(p, "has:1514", "514 → 1514", { pad: 3 });
      await at(4, 1, 0);
      await suave(p, "has:logging host 192.0.2.250", "Para el equipo", { pad: 3 });
      await at(4, 1, 2.8);
      await suave(p, "css:input[placeholder^='Filtrar']", "Texto o severidad", { lado: "abajo" });
      await at(4, 1, 5.0);
      await suave(p, "label:Guardar en archivo diario", "Evidencia", { pad: 3 });
    },
  },

  // ===================== 12 Respaldos y comparación =====================
  {
    id: "12-a-respaldos", cap: "12-respaldos-y-comparacion", pagina: "app", query: { scene: "backup" }, espera: 3600,
    async run({ p, at }) {
      await at(0, 0, 0.2);
      await p.ver("h:Respaldar configuración", "start");
      await suave(p, "sec:Respaldar configuración", "Solo comandos de consulta", { pad: 2, lado: "abajo" });
      await at(0, 1, 0);
      await suave(p, "titulo:Respaldar core-sw01", "Marca los equipos", { pad: 3 }).catch(() => {});
      await at(0, 1, 1.4);
      await suave(p, "Respaldar configuración>>btn:Respaldar", "Hasta tres a la vez", { pad: 3 });
    },
  },
  {
    id: "12-b-d11", cap: "12-respaldos-y-comparacion", pagina: "escenario", desde: [1, 0],
    async run({ D, E, at }) {
      await D("enmascarado");
      await at(1, 0, 0.5);
      await E("revelar", 1);
      await at(1, 1, 0);
      await E("revelar", 2);
      await at(1, 1, 5.0);
      await E("revelar", 3);
    },
  },
  {
    id: "12-c-comparar", cap: "12-respaldos-y-comparacion", pagina: "app", desde: [2, 0], query: { scene: "backup" }, espera: 3600,
    async run({ p, at }) {
      await at(2, 0, 0.2);
      await p.ver("h:Respaldos guardados", "center");
      await suave(p, "sec:Respaldos guardados", "A y B: mismo equipo o dos distintos", { pad: 2, lado: "arriba" });
      await at(2, 0, 4.0);
      await p.clic("btn:Comparar A y B", { ms: 500 }).catch(() => {});
      await p.ver("h:Comparar", "start");
      await espera(500);
      await suave(p, "has:secreto cambiado", "Secreto cambiado: sin revelar el valor", { pad: 3, tono: "warn" });
      await at(2, 0, 8.4);
      await suave(p, "titulo:Exportar diff como texto", "Exportar", { pad: 3, lado: "izq" });
    },
  },

  // ===================== 13 Cierre =====================
  {
    id: "13-a-resumen", cap: "13-cierre", pagina: "escenario",
    async run({ E, at }) {
      await E("lista", {
        kicker: "Repaso",
        titulo: "Para llevar",
        items: [
          { ico: "ok", texto: "<b>Topología</b> solo consulta y nunca dibuja una sugerencia sin tu confirmación" },
          { ico: "ok", texto: "<b>Archivos:</b> prefiere SCP o SFTP" },
          { ico: "ok", texto: "<b>Verifica el MD5</b> y apaga los servidores al terminar" },
          { ico: "ok", texto: "<b>SNMP:</b> usa v3 con authPriv" },
        ],
      });
      await at(0, 1, 0);
      await E("revelar", 1);
      await at(0, 2, 0);
      await E("revelar", 2);
      await at(0, 2, 3.0);
      await E("revelar", 3);
      await at(0, 3, 0);
      await E("revelar", 4);
    },
  },
  {
    id: "13-b-final", cap: "13-cierre", pagina: "escenario", desde: [1, 0],
    async run({ E }) {
      await E("portada", { kicker: "NetTerminal", h1: "Gracias", sub: "Tutoriales y descarga en parzval-net.github.io/Net_Terminal", chips: [] });
    },
  },
];
