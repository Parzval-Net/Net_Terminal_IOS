// Guion visual del video 1 (Primeros pasos y uso diario), traducido de storyboard.md a pasos de
// record-v1.mjs. Un arreglo de pasos por línea de guion/<capítulo>.txt; los pasos corren mientras suena
// la frase. Vocabulario: ver steps-v1.mjs. Selectores verificados contra la interfaz de v0.9.7 con
// probar-toma.mjs. Datos: solo IPs de documentación y nombres ficticios del mock.
const SIDEBAR = "css:aside";
const TOPBAR = "css:main div.h-10.bg-chrome";
const STATUSBAR = "css:main div.h-6.border-t";
const HOST = "ph:192.0.2.10 o hostname";
const USER = "ph:Según ~/.ssh/config";
const QUICK = "title:Conexión rápida sin guardar (⌘O)";
const NEW = "title:Nueva sesión (⌘N)";
const DIALOG = "css:[role=alertdialog]";
const SEARCH = "ph:Buscar comando o tarea";
const NOTESEL = "opt:consultas-diarias.txt";
const tpl = (name) => `css:label:has(span[title="${name}"]) input`;

export const chapters = [
  // ---------------------------------------------------------------- 1
  {
    id: "01-que-es-e-instalacion",
    sub: "Cliente SSH, Telnet, Serial y terminal local",
    shots: [
      {
        scene: "empty",
        cues: [
          [["label", "Video 1 · Primeros pasos y uso diario", "big"], ["zoom", "text:SSH, Telnet y Serial sin complicaciones.", 1.35]],
          [["unzoom"], ["chips", [["SSH", "Telnet", "Serial", "Terminal local"], ["macOS", "Windows", "Linux"]]], ["hl", SIDEBAR, 0], ["@", 2600], ["hl", "has:Conexión rápida sin guardar"], ["@", 4600], ["hl", "has:Terminal local"]],
          [["label", "Datos ficticios · IPs de documentación (RFC 5737)"]],
        ],
      },
      {
        scene: "empty",
        setup: [["lam", "tabla", { kicker: "Instalación", titulo: "Descarga según tu sistema", filas: [["macOS", "Imagen `.dmg`"], ["Windows", "Instalador `-setup.exe` (por usuario, sin administrador)"], ["Linux", "`.AppImage` o paquete `.deb`"], ["Portable", "`NetTerminal-portable.zip`"]] }]],
        cues: [
          [["@", 2600], ["reveal", 0], ["@", 4700], ["reveal", 1], ["@", 6600], ["reveal", 2]],
          [
            ["reveal", 3],
            ["@", 1700],
            ["lam", "arbol", { kicker: "Modo portable", titulo: "Una carpeta, tres sistemas", filas: [["NetTerminal/", "", 0], ["NetTerminal.exe", "Windows", 1], ["NetTerminal.app", "macOS", 1], ["NetTerminal.AppImage", "Linux", 1], ["portable", "marcador (archivo vacío)", 1], ["data/", "sesiones, ajustes y notas", 1]], nota: "Sin administrador: instalador de Windows por usuario, AppImage y portable" }],
            ["reveal", 0], ["@", 2500], ["reveal", 1], ["reveal", 2], ["reveal", 3], ["@", 3600], ["reveal", 4], ["@", 4800], ["reveal", 5],
          ],
        ],
      },
      {
        scene: "empty",
        query: "&update=1",
        setup: [["dbl", "text:core-sw01"], ["dbl", "text:ar-wan01"], ["wait", 900], ["click", "title:Ajustes"], ["wait", 300], ["click", "text:Acerca de"], ["wait", 300]],
        cursor: [1200, 640],
        cues: [
          [["hl", "text:Versión 0.9.6"], ["@", 1400], ["hl", "text:Buscar ahora"], ["co", "text:Buscar ahora", "Al abrir y cada 6 horas", { side: "above" }], ["@", 3300], ["click", "text:Buscar ahora"], ["wait", 700], ["hl", "has:Hay una versión nueva"]],
          [
            ["key", "Escape"], ["wait", 300], ["hl", "has:Nueva versión 0.9.7 disponible"], ["@", 1200], ["click", "text:Ver novedades"], ["wait", 400], ["hl", "has:Contraseña guardada en scripts"],
            ["@", 3300], ["click", "text:Actualizar y reiniciar"], ["wait", 500], ["hl", DIALOG], ["co", DIALOG, "Verifica la firma antes de instalar", { side: "below" }],
            ["@", 6300], ["clickcss", "[role=alertdialog] button", -1], ["wait", 600], ["hl", "has:Descargando"],
          ],
          [["hl", "title:Omitir esta versión"], ["label", "Portable y paquete deb: el aviso ofrece Descargar y se actualiza a mano"]],
        ],
      },
    ],
  },
  // ---------------------------------------------------------------- 2
  {
    id: "02-sesiones-y-carpetas",
    sub: "Crear, ordenar, filtrar e importar",
    shots: [
      {
        scene: "empty",
        cues: [
          [["hl", SIDEBAR, 0], ["hover", "text:Sitio Central"], ["@", 1700], ["hover", "text:Core"], ["@", 2900], ["hover", "text:Distribución"]],
          [["label", "⌘ Comando en macOS = Ctrl+Shift en Windows y Linux", "big"]],
          [["hl", NEW], ["keys", ["⌘N", "Ctrl+Shift+N"]], ["@", 1500], ["click", NEW], ["wait", 500], ["hl", "css:form .grid-cols-5"], ["co", "css:form .grid-cols-5", "SSH · Telnet · Serial · TCP · Local", { side: "below" }]],
          [["field", "ph:Router core", "sw-acceso-centro", { delay: 40 }], ["field", "ph:Raíz", "Sucursales/Centro", { delay: 45 }], ["co", "ph:Raíz", "Una barra crea subcarpetas", { side: "below" }]],
          [["field", HOST, "203.0.113.60", { delay: 30 }], ["field", USER, "admin", { delay: 30 }], ["click", "text:Guardar"], ["wait", 500], ["hl", "text:sw-acceso-centro"]],
          [["dbl", "text:core-sw01"], ["move", 640, 560], ["wait", 900], ["hl", "title:Pestaña abierta", 8], ["co", "title:Pestaña abierta", "Conectada", { side: "right" }]],
          [["right", "text:core-sw02"], ["wait", 400], ["hl", "css:[role=menu]"], ["@", 3000], ["click", "text:Duplicar"], ["wait", 500], ["hl", "text:core-sw02 (copia)"], ["co", "text:core-sw02 (copia)", "La copia no incluye la contraseña guardada", { side: "right" }], ["@end", 200], ["key", "Escape"]],
          [["right", "text:Core"], ["wait", 400], ["hl", "css:[role=menu]"], ["@", 4300], ["key", "Escape"], ["drag", "text:core-sw02 (copia)", "text:Laboratorio"], ["wait", 300], ["hl", "text:Laboratorio"]],
          [["field", "ph:Filtrar", "198.51.100", { delay: 45 }], ["co", "ph:Filtrar", "Nombre, IP, usuario o carpeta", { side: "right" }], ["@end", 250], ["set", "ph:Filtrar", ""]],
          [["click", "title:Ajustes"], ["wait", 300], ["click", "text:Importar y exportar"], ["wait", 300], ["click", "text:Desde archivo…"], ["wait", 400], ["hl", "has:Solo se importan datos de conexión"]],
          [
            ["chips", [["ssh_config", "PuTTY", "SecureCRT", "MobaXterm", "CSV"]]], ["click", "text:Leer ~/.ssh/config"], ["wait", 700], ["hl", "has:OpenSSH · 2 sesiones"],
            ["@", 4300], ["click", "has:1 aviso"], ["wait", 400], ["hl", "has:los túneles no se importan"], ["label", "Nunca importa contraseñas ni túneles"], ["@end", 350], ["click", "text:Cancelar"],
          ],
        ],
      },
    ],
  },
  // ---------------------------------------------------------------- 3
  {
    id: "03-conexion-rapida",
    sub: "Conectar sin guardar la sesión",
    shots: [
      {
        scene: "empty",
        cues: [
          [["hl", "has:Conexión rápida sin guardar"], ["hover", "has:Conexión rápida sin guardar"]],
          [["hl", QUICK], ["keys", ["⌘O", "Ctrl+Shift+O"]], ["hover", QUICK], ["@", 2300], ["click", QUICK], ["wait", 300]],
          [
            ["click", "text:Telnet"], ["@", 1200], ["click", "text:TCP"], ["@", 2000], ["click", "text:Serial"], ["@", 3300], ["click", "text:TCP"], ["wait", 300], ["hl", "has:TCP crudo"], ["co", "text:TCP", "Sin negociación Telnet · puerto 2001", { side: "above" }],
            ["@", 7000], ["click", "text:SSH"], ["field", HOST, "192.0.2.77", { delay: 30 }],
          ],
          [["field", USER, "admin", { delay: 30 }], ["click", "text:Conectar"], ["wait", 700], ["hl", "title:192.0.2.77"]],
          [
            ["hl", "has:Guardar como sesión…"], ["co", "has:Guardar como sesión…", "Barra de estado", { side: "above" }], ["@", 2600], ["right", "title:192.0.2.77"], ["wait", 300], ["hl", "text:Guardar como sesión…"],
            ["@", 4600], ["click", "text:Guardar como sesión…"], ["wait", 500], ["field", "ph:Router core", "sw-bodega", { delay: 35 }], ["field", "ph:Raíz", "Laboratorio", { delay: 35 }], ["click", "text:Guardar"], ["wait", 500],
            ["hl", "text:sw-bodega"], ["co", "text:sw-bodega", "Misma pestaña, sin reconectar", { side: "right" }],
          ],
          [["keys", ["⌘K", "Ctrl+Shift+K"]], ["key", "cmd+k"], ["wait", 500], ["hl", "has:Conexiones rápidas recientes"], ["@", 2600], ["type", "admin@192.0.2.88", 45], ["@end", 300], ["key", "Escape"]],
        ],
      },
    ],
  },
  // ---------------------------------------------------------------- 4
  {
    id: "04-ssh-telnet-serial",
    sub: "Jump host, túneles, equipos antiguos y contraseñas",
    shots: [
      {
        scene: "empty",
        setup: [["hover", "text:core-sw01"], ["click", "title:Editar"], ["wait", 400]],
        cursor: [1300, 700],
        cues: [
          [["scrollto", "has:Usa OpenSSH del sistema"], ["hl", "has:Usa OpenSSH del sistema"]],
          [["scrollto", "ph:~/.ssh/id_ed25519"], ["field", "ph:~/.ssh/id_ed25519", "~/.ssh/id_ed25519_lab", { delay: 35 }], ["field", "ph:usuario@bastion:22", "admin@198.51.100.5:22", { delay: 35 }], ["co", "ph:usuario@bastion:22", "Jump host = equipo intermedio (bastión)", { side: "below" }]],
          [
            ["click", "has:Túneles SSH"], ["wait", 300], ["click", "text:Agregar túnel"], ["wait", 300], ["hl", "css:details select"], ["co", "css:details select", "-L local · -R remoto · -D dinámico", { side: "above" }],
            ["@", 3800], ["field", "ph:1080", "8443", { delay: 40 }], ["field", "css:[title=\"Host de destino\"]", "192.0.2.20", { delay: 35 }], ["field", "ph:443", "443", { delay: 40 }],
            ["hl", "ph:127.0.0.1"], ["co", "ph:127.0.0.1", "Vacío = 127.0.0.1", { side: "below" }],
          ],
          [["click", "title:Cerrar"], ["wait", 300], ["click", NEW], ["wait", 300], ["click", "text:Telnet"], ["@", 2600], ["click", "text:Serial"], ["wait", 300], ["hl", "text:Velocidad"], ["@", 3900], ["hl", "text:Paridad"], ["@", 4800], ["hl", "text:Flujo"], ["@end", 250], ["click", "title:Cerrar"]],
        ],
      },
      {
        scene: "legacy",
        cursor: [900, 400],
        cues: [
          [["wait", 300], ["zoom", "has:Unable to negotiate", 1.5], ["hl", "has:Unable to negotiate"]],
          [["hl", "has:Presiona L"], ["keys", ["L"]], ["@", 2600], ["unzoom"], ["clickcss", ".xterm-screen", 0, { at: [0.6, 0.6] }], ["key", "L"], ["wait", 900], ["hl", "has:Compatibilidad con equipos antiguos"]],
          [
            ["hover", "tp:admin@192.0.2.99"], ["click", "title:Editar"], ["wait", 400], ["scrollto", "has:Permitir algoritmos legacy"], ["hl", "has:Permitir algoritmos legacy"],
            ["@", 3800], ["click", "title:Cerrar"], ["wait", 300], ["keys", ["⌘,", "Ctrl+,"]], ["key", "cmd+,"], ["wait", 400], ["click", "text:Terminal"], ["wait", 300],
            ["scrollto", "has:Activar algoritmos legacy automáticamente"], ["hl", "has:Activar algoritmos legacy automáticamente"], ["co", "has:Activar algoritmos legacy automáticamente", "Apagado por defecto", { side: "below" }],
          ],
          [["label", "Algoritmos débiles: solo redes de gestión confiables", "warn"]],
        ],
      },
      {
        scene: "empty",
        cues: [
          [["hover", "text:sw-acceso-norte"], ["click", "title:Editar"], ["wait", 400], ["scrollto", "has:Guardar contraseña"], ["hl", "has:Guardar contraseña"], ["@", 4200], ["hl", "text:Guardada"], ["co", "text:Guardada", "Solo escritura: nunca se muestra", { side: "below" }]],
          [["click", "title:Cerrar"], ["wait", 300], ["label", "Simulación del autocompletado"], ["dbl", "text:sw-acceso-norte"], ["move", 900, 500], ["wait", 1000], ["hl", "title:Contraseña guardada: se completa sola en el primer pedido de contraseña al conectar", 8], ["co", "title:Contraseña guardada: se completa sola en el primer pedido de contraseña al conectar", "Se completa sola, una vez", { side: "above" }]],
          [["side", "No se completa", ["Si el equipo ya rechazó la contraseña", "Si pide la frase de una llave (passphrase)", "En el bastión de un jump host", "En un segundo pedido de contraseña"]]],
          [["click", "title:Ajustes"], ["wait", 300], ["click", "text:Credenciales"], ["wait", 400], ["label", "Para SSH: llaves y agente"]],
        ],
      },
    ],
  },
  // ---------------------------------------------------------------- 5
  {
    id: "05-pestanas",
    sub: "Renombrar, dividir y cerrar con control",
    shots: [
      {
        scene: "empty",
        setup: [
          ["click", QUICK], ["wait", 300], ["field", HOST, "192.0.2.77"], ["click", "text:Conectar"], ["wait", 500],
          ["dbl", "text:core-sw01"], ["dbl", "text:ar-wan01"], ["dbl", "text:dist-sw01"], ["dbl", "text:fw-perimetro"], ["wait", 900], ["click", "title:core-sw01"], ["wait", 300],
        ],
        cues: [
          [["click", "title:ar-wan01"], ["@", 1100], ["click", "title:dist-sw01"], ["@", 2100], ["click", "title:core-sw01"], ["hl", TOPBAR, 0]],
          [["dbl", "title:ar-wan01"], ["wait", 300], ["key", "cmd+a"], ["type", "WAN principal\n", 45], ["wait", 200], ["js", "window.__ntMockAsync()"], ["wait", 500], ["hl", "title:Salida nueva", 8], ["co", "title:Salida nueva", "Salida nueva en segundo plano", { side: "below" }]],
          [["right", "title:core-sw01"], ["wait", 300], ["hl", "text:Duplicar"], ["@", 1500], ["hl", "text:Reconectar"], ["@", 2400], ["hl", "text:Desconectar"], ["@", 3600], ["hl", "text:Copiar toda la salida"], ["@end", 200], ["key", "Escape"]],
          [
            ["right", "title:core-sw01"], ["wait", 300], ["click", "text:Pestañas verticales"], ["wait", 600], ["co", "css:[role=separator]", "Arrastra para cambiar el ancho", { side: "right" }],
            ["@", 3300], ["click", "title:Plegar pestañas a iconos"], ["@", 4700], ["click", "title:Expandir pestañas"], ["@end", 300], ["right", "title:core-sw01"], ["click", "text:Pestañas horizontales"],
          ],
          [["click", "title:Vista dividida: ver 2 o 4 pestañas a la vez"], ["wait", 300], ["click", "text:4 en cuadrícula (2x2)"], ["wait", 600], ["hl", "css:main select"], ["co", "css:main select", "Cada panel tiene su selector", { side: "below" }]],
          [["right", "title:dist-sw01"], ["wait", 300], ["hl", "text:Cerrar las demás"], ["@", 1800], ["hl", "text:Cerrar las de la derecha"], ["@", 3300], ["hl", "text:Cerrar todas las pestañas"], ["@end", 300], ["click", "text:Cerrar todas las pestañas"]],
          [["wait", 300], ["zoom", DIALOG, 1.25], ["hl", "has:Se cortan"], ["@", 2200], ["hl", "has:conexión rápida"], ["@", 3500], ["hl", "text:Cancelar"], ["co", "text:Cancelar", "El foco parte en Cancelar", { side: "below" }], ["@end", 250], ["key", "Escape"]],
          [["unzoom"], ["keys", ["⌘⇧W", "Ctrl+Shift+Alt+W"]], ["key", "cmd+shift+w"], ["wait", 700], ["hl", DIALOG], ["@end", 250], ["key", "Escape"]],
        ],
      },
    ],
  },
  // ---------------------------------------------------------------- 6
  {
    id: "06-catalogo",
    sub: "1.776 comandos con fuente y riesgo",
    shots: [
      {
        scene: "suggest",
        query: "&noplatform=1",
        cues: [
          [["keys", ["⌘L", "Ctrl+Shift+L"]], ["key", "cmd+l"], ["wait", 600], ["hl", "css:aside[style]", 0], ["co", "title:Catálogo", "Cada comando con su fuente oficial", { side: "below" }]],
          [["hl", "title:Catálogo"], ["side", "Plataformas", ["Equipos de red: Cisco, Juniper, Fortinet, Huawei, Check Point, WatchGuard", "Sistemas operativos: Windows, macOS, Linux"]]],
          [["hl", "text:Detectar"], ["@", 900], ["click", "text:Detectar"], ["wait", 1000], ["hl", "has:Plataforma detectada"], ["co", "text:Detectar", "Ejecuta show version", { side: "below" }]],
          [["hl", "title:La sintaxis y los comandos se ajustan a la plataforma"]],
          [["field", SEARCH, "vecinos", { delay: 60 }], ["wait", 400], ["hl", "css:aside[style] code"]],
          [["set", SEARCH, "clear"], ["wait", 400], ["label", "Consulta · Cambia config/estado · Puede cortar servicio"], ["hl", "has:Cambia config/estado"], ["@", 3400], ["hl", "has:Puede cortar servicio"]],
          [["set", SEARCH, "vecinos"], ["wait", 300], ["hover", "has:show cdp neighbors"], ["hl", "text:Ejecutar"], ["@", 2600], ["hl", "text:Escribir"], ["@", 4300], ["click", "text:Ejecutar"]],
          [["click", "title:Agregar a favoritos"], ["@", 1300], ["click", "text:Favoritos"], ["@", 2600], ["hl", "title:Agregar un comando propio"], ["@", 4500], ["hl", "title:Packs de comandos"], ["co", "title:Packs de comandos", "Packs: video de automatización", { side: "below" }], ["@end", 200], ["key", "cmd+l"]],
        ],
      },
    ],
  },
  // ---------------------------------------------------------------- 7
  {
    id: "07-sugerencias",
    sub: "Autocompletado seguro para la CLI",
    shots: [
      {
        scene: "suggest",
        query: "&noplatform=1",
        setup: [["dbl", "text:ar-wan01"], ["wait", 700], ["click", "title:core-sw01"], ["wait", 300]],
        cues: [
          // L1-L3: ajuste, requisitos y aviso de plataforma
          [["key", "cmd+,"], ["wait", 300], ["click", "text:Terminal"], ["wait", 300], ["scrollto", "has:Sugerencias de comandos"], ["hl", "has:Sugerencias de comandos"], ["label", "Encendidas por defecto"], ["@end", 300], ["key", "Escape"]],
          [["chips", [["SSH", "Telnet", "Serial", "TCP"], ["Plataforma detectada o fijada en el catálogo"]]]],
          [
            ["clickcss", ".xterm-screen", 0, { at: [0.5, 0.5] }], ["type", "sh", 120], ["wait", 400], ["hl", "has:Detecta la plataforma"], ["co", "has:Detecta la plataforma", "Una vez por pestaña", { side: "above" }],
            ["@", 3600], ["key", "cmd+l"], ["wait", 400], ["click", "text:Detectar"], ["wait", 900], ["key", "cmd+l"], ["wait", 200], ["clickcss", ".xterm-screen", 0, { at: [0.5, 0.5] }], ["key", "Backspace", 2],
          ],
          // L4-L11: texto gris y lista, cámara sobre la línea
          [["zoomcursor", 1.7], ["type", "sh ver", 130], ["wait", 300], ["cocursor", "Texto gris: el resto del comando", { side: "above", dx: 120 }]],
          [["keys", ["→"]], ["key", "ArrowRight"], ["wait", 500], ["key", "Enter"]],
          [["wait", 300], ["type", "sh vl", 130], ["wait", 600], ["keys", ["Ctrl+→", "~Option+→ en macOS"]], ["key", "ctrl+ArrowRight"], ["@", 3300], ["key", "ctrl+ArrowRight"], ["@", 4600], ["key", "Enter"]],
          [["wait", 300], ["type", "sh int", 120], ["keys", ["Ctrl+."]], ["key", "ctrl+."], ["wait", 500], ["co", "has:↑↓ elegir", "Enter escribe sin ejecutar", { side: "below" }], ["@", 3500], ["key", "ArrowDown"], ["wait", 350], ["key", "ArrowDown"], ["@", 5000], ["key", "Enter"], ["wait", 500], ["key", "Enter"]],
          [["side", "Linux con IBus", ["Control punto puede abrir el selector de emojis", "Cámbiala en Ajustes › Terminal › Tecla para abrir la lista: `Alt+/`"]]],
          [["type", "sh clo", 120], ["wait", 300], ["keys", ["Tab"]], ["key", "Tab"], ["wait", 400], ["cocursor", "Tab va al equipo", { side: "above" }], ["@end", 300], ["key", "Enter"]],
          [["wait", 300], ["type", "sh ip int br", 120], ["wait", 400], ["label", "sh ip int br = show ip interface brief", "big"], ["@", 4300], ["key", "ArrowRight"], ["wait", 300], ["key", "Enter"], ["wait", 300], ["unzoom"], ["click", "title:ar-wan01"]],
          [["chips", [["Cisco", "Huawei", "Juniper", "Fortinet"]]], ["clickcss", ".xterm-screen", 0, { at: [0.5, 0.5] }], ["type", "dis int br", 55], ["wait", 300], ["cocursor", "Huawei: display interface brief", { side: "above" }]],
          // L12-L19: modo configuración y control de riesgo
          [["key", "Backspace", 10], ["click", "title:core-sw01"], ["wait", 200], ["clickcss", ".xterm-screen", 0, { at: [0.5, 0.5] }], ["zoomcursor", 1.7], ["type", "conf t", 35], ["key", "Enter"], ["wait", 350], ["type", "interface Gi1/0/4", 30], ["key", "Enter"], ["wait", 350], ["type", "sh", 150], ["wait", 300], ["cocursor", "Sin texto gris", { side: "above" }]],
          [["key", "ctrl+."], ["wait", 400], ["label", "En (config-if)#, sh = shutdown", "warn"]],
          [["key", "Backspace", 2], ["type", "do sh ip int br", 70], ["wait", 400], ["key", "ArrowRight"], ["wait", 300], ["key", "Enter"], ["side", "Consultar desde configuración", ["Cisco: `do`", "Junos: `run`", "Huawei: `display` completo", "ASA: `show` completo"]], ["@end", 500], ["type", "end\n", 60]],
          [["wait", 300], ["type", "rel", 150], ["wait", 500], ["cocursor", "reload: puede cortar servicio", { side: "above", warn: true }], ["@end", 400], ["key", "Backspace", 3]],
          [
            ["type", "clear cou", 80], ["key", "ctrl+."], ["wait", 600], ["hl", "has:Cambia config/estado"], ["co", "has:Cambia config/estado", "Distintivo de riesgo", { side: "below", warn: true }],
            ["@", 3800], ["key", "Enter"], ["wait", 400], ["unzoom"], ["hl", DIALOG], ["@", 7300], ["click", "text:Insertar"], ["wait", 300], ["zoomcursor", 1.7],
          ],
          [["label", "Sin Enter: tú decides"], ["key", "Backspace", 15], ["key", "Enter"], ["wait", 300], ["type", "sh run", 60], ["wait", 200], ["key", "ctrl+."], ["wait", 300], ["key", "ArrowDown"], ["key", "Enter"], ["wait", 300], ["type", "Gi1/0/1", 70], ["@end", 300], ["key", "Enter"]],
          [
            ["wait", 300], ["type", "sh int", 80], ["key", "ctrl+."], ["wait", 600], ["co", "has:↑↓ elegir", "Lo que usas sube en la lista", { side: "below" }], ["@", 3000], ["key", "Escape"], ["key", "Backspace", 6],
            ["side", "Historial de sugerencias", ["Se guarda: `show interfaces status` (plantilla del catálogo)", "No se guarda: argumentos, equipos ni secretos"]],
            ["@", 4700], ["unzoom"], ["key", "cmd+,"], ["wait", 300], ["click", "text:Terminal"], ["wait", 300], ["scrollto", "text:Borrar historial de sugerencias"], ["click", "text:Borrar historial de sugerencias"], ["wait", 400], ["hl", "has:Historial borrado"], ["@end", 250], ["key", "Escape"],
          ],
          [["dbl", "text:Shell local"], ["wait", 400], ["clickcss", ".xterm-screen", 0, { at: [0.5, 0.3] }], ["type", "sh", 110], ["wait", 200], ["cocursor", "Terminal local: sin sugerencias", { side: "below" }]],
        ],
      },
    ],
  },
  // ---------------------------------------------------------------- 8
  {
    id: "08-notas-y-difusion",
    sub: "Plantillas con variables y control de riesgo",
    shots: [
      {
        scene: "empty",
        setup: [["dbl", "text:core-sw01"], ["dbl", "text:core-sw02"], ["wait", 900], ["click", "title:core-sw01"], ["wait", 300]],
        cues: [
          [["keys", ["⌘J", "Ctrl+Shift+J"]], ["key", "cmd+j"], ["wait", 600], ["set", NOTESEL, "consultas-diarias.txt"], ["hl", NOTESEL]],
          [["noteline", 2], ["keys", ["⌘Enter", "Ctrl+Enter"]], ["@", 1500], ["key", "cmd+Enter"], ["wait", 800], ["hl", "has:Interface              IP-Address"], ["@", 5300], ["hl", "text:Todo"]],
          [["set", NOTESEL, "plantilla-vlan.txt"], ["wait", 300], ["hl", "css:pre[aria-hidden]"], ["@", 2600], ["click", "text:Todo"], ["wait", 400], ["field", tpl("vlan"), "30", { delay: 60 }], ["field", tpl("nombre"), "CAMARAS", { delay: 40 }]],
          [["field", tpl("interfaz"), "GigabitEthernet1/0/7", { delay: 30 }], ["field", tpl("descripcion"), "CAMARA PISO 2", { delay: 30 }], ["hl", "has:Los valores se recuerdan"], ["label", "Secretos (clave, enable, comunidad SNMP): ocultos y sin guardar"], ["@end", 300], ["click", "text:Continuar"]],
          [["wait", 300], ["hl", DIALOG], ["label", "En el ejemplo cancelamos"], ["@end", 300], ["click", "text:Cancelar"]],
          [["set", NOTESEL, "accesos-sitio-central"], ["wait", 300], ["field", "ph:Contraseña de la nota", "demo-clave-2026", { delay: 30 }], ["key", "Enter"], ["wait", 400], ["click", "title:Más acciones de la nota"], ["wait", 200], ["click", "title:Protección de la nota"], ["wait", 300], ["hl", "has:Bloqueo por inactividad"], ["co", "has:Bloqueo por inactividad", "5 min por defecto", { side: "below" }], ["@end", 300], ["click", "title:Bloquear nota"]],
          [["click", "title:Elegir a qué sesiones se envía"], ["wait", 300], ["click", "text:Pestañas elegidas"], ["@", 2600], ["clickcss", "label:has(> input[type=checkbox])", 0], ["clickcss", "label:has(> input[type=checkbox])", 1], ["@end", 300], ["key", "Escape"]],
          [
            ["set", NOTESEL, "cambio-descripcion.txt"], ["wait", 300], ["click", "title:Más acciones de la nota"], ["wait", 200], ["click", "title:Proteger con contraseña"], ["wait", 200], ["click", "text:Todo"], ["wait", 500], ["hl", "has:Destinos, en este orden"], ["@", 2300], ["hl", "has:Texto completo"],
            ["@", 4900], ["field", "css:[role=alertdialog] input[inputmode=numeric]", "2", { delay: 80 }], ["co", "css:[role=alertdialog] input[inputmode=numeric]", "Escribe la cantidad de equipos", { side: "right" }], ["@end", 300], ["click", "has:Enviar a 2 equipos"],
          ],
          [["wait", 500], ["click", "text:Ver detalle"], ["wait", 300], ["hl", "text:Detener"], ["@end", 300], ["click", "text:Detener"]],
        ],
      },
    ],
  },
  // ---------------------------------------------------------------- 9
  {
    id: "09-logs-alertas-historial",
    sub: "Grabar, avisar y encontrar",
    shots: [
      {
        scene: "empty",
        query: "&alertrule=1",
        setup: [["dbl", "text:core-sw01"], ["dbl", "text:ar-wan01"], ["wait", 900], ["click", "title:core-sw01"], ["wait", 300]],
        cues: [
          [["hl", "title:Grabar la sesión en un archivo de texto"], ["@", 1400], ["click", "title:Grabar la sesión en un archivo de texto"], ["wait", 500], ["hl", "has:Grabando"], ["co", "has:Grabando", "`~/NetTerminal/data/logs/core-sw01_20261021-101500.log`", { side: "above", dy: -70, dx: -260 }]],
          [["key", "cmd+,"], ["wait", 300], ["click", "text:Logs"], ["wait", 300], ["hl", "has:Grabar logs automáticamente"], ["@", 2600], ["hl", "has:Hora en cada línea"], ["@", 3700], ["hl", "has:Nombre del archivo"], ["@", 5000], ["hl", "has:Rotación diaria"]],
          [["scrollto", "has:Ocultar secretos en los logs"], ["hl", "has:Ocultar secretos en los logs"], ["co", "has:Ocultar secretos en los logs", "Activado por defecto", { side: "above" }]],
          [["click", "text:Alertas"], ["wait", 300], ["hl", "has:Interfaz cambió de estado"], ["label", "Trae 3 ejemplos, apagados"], ["@", 3300], ["click", "text:Nueva alerta"], ["wait", 300], ["hl", "text:Expresión regular"], ["@end", 300], ["click", "text:Cancelar"]],
          [["key", "Escape"], ["wait", 300], ["js", "window.__ntAlert()"], ["wait", 700], ["hl", "has:Enlace caído en Core"], ["@", 2700], ["hl", "title:core-sw01", 4], ["co", "title:core-sw01", "Pestaña marcada", { side: "below" }], ["@", 4600], ["label", "Las alertas nunca envían comandos"]],
          [["click", "title:Historial de comandos enviados a este equipo"], ["wait", 400], ["hl", "has:Últimos comandos enviados"], ["label", "Notas, catálogo y botones; no lo que tecleas"], ["@end", 300], ["key", "Escape"]],
          [["keys", ["⌘F", "Ctrl+Shift+F"]], ["key", "cmd+f"], ["wait", 300], ["type", "UPDOWN\n", 60], ["@end", 200], ["key", "Escape"]],
        ],
      },
    ],
  },
  // ---------------------------------------------------------------- 10
  {
    id: "10-apariencia-y-ajustes",
    sub: "Temas, fuente, resaltado y módulos",
    shots: [
      {
        scene: "empty",
        setup: [["dbl", "text:core-sw01"], ["wait", 900], ["key", "cmd+,"], ["wait", 300], ["click", "text:Apariencia"], ["wait", 300]],
        cursor: [1100, 500],
        cues: [
          [["keys", ["⌘,", "Ctrl+,"]], ["hl", { x: 322, y: 107, w: 174, h: 596 }, 0], ["co", { x: 322, y: 107, w: 174, h: 596 }, "Secciones de Ajustes", { side: "right" }]],
          [["click", "text:Oscuro"], ["@", 2300], ["click", "text:Claro"]],
          [["click", "text:Ámbar"], ["@", 2600], ["click", "text:Dracula"], ["@", 3600], ["click", "text:Tokyo Night"], ["@", 5000], ["click", "has:Automático · Sigue la interfaz"], ["label", "17 temas + Automático"]],
          [["scrollto", "text:Interlineado"], ["hl", "text:Fuente"], ["@", 1500], ["hl", "text:Tamaño"], ["@", 2100], ["hl", "text:Interlineado"], ["@", 2800], ["hl", "text:Cursor"], ["@", 3600], ["click", "text:Resaltado"], ["wait", 300], ["hl", "has:Resaltar salida de la terminal"]],
          [["field", "css:input[aria-label=\"Buscar ajuste\"]", "legacy", { delay: 60 }], ["wait", 500], ["@", 2600], ["set", "css:input[aria-label=\"Buscar ajuste\"]", ""], ["click", "text:Módulos"], ["wait", 300], ["hl", "has:Sondas ICMP/TCP"], ["co", "has:Sondas ICMP/TCP", "Oculta las herramientas que no usas", { side: "below" }]],
          [["hl", "text:Los cambios se aplican al instante"], ["@", 2000], ["click", "text:Restablecer valores"], ["wait", 400], ["hl", DIALOG], ["co", DIALOG, "Pide confirmación", { side: "below" }], ["@end", 300], ["click", "text:Cancelar"]],
        ],
      },
    ],
  },
  // ---------------------------------------------------------------- 11
  {
    id: "11-cierre",
    sub: "Resumen y próximos videos",
    shots: [
      {
        scene: "empty",
        tail: 2.2,
        cues: [
          [["hl", SIDEBAR, 0], ["@", 2300], ["hl", "has:Conexión rápida sin guardar"], ["@", 4500], ["hl", "has:Herramientas de red"]],
          [["tip", QUICK, "Conexión rápida sin guardar (⌘O)"]],
          [["lam", "columnas", { kicker: "Siguientes videos", titulo: "Sigue con la serie", cols: [["Video 2", "Herramientas de red", "Topología, transferencias, SNMP, monitoreo y respaldos"], ["Video 3", "Automatización", "Botones, scripts, plugins, packs y agentes IA"]] }], ["reveal", 0], ["@", 2300], ["reveal", 1]],
          [["lam", "logo", { titulo: "NetTerminal", sub: "Gracias por ver" }]],
        ],
      },
    ],
  },
];
