// Guion visual del tutorial: por capítulo, las tomas (escena del demo + preparación sin grabar) y,
// por cada frase del guion de texto (guion/<id>.txt), la lista de pasos que se ejecutan mientras suena.
// Pasos: ["click", spec], ["dbl", spec], ["right", spec], ["hover", spec], ["field", spec, texto],
// ["type", texto], ["key", "cmd+k"], ["hl", spec|null], ["zoom", spec, escala], ["unzoom"],
// ["set", spec, valor], ["scroll", spec, dy], ["wait", ms], ["@", ms] (espera hasta ms desde el inicio
// de la frase) y ["js", código]. spec: título/aria-label o texto exacto, o "css:", "ph:", "text:", "has:", "svg:".
const SIDEBAR = "css:aside";
const TABBAR = "css:main div.h-10.bg-chrome";
const BUTTONBAR = "css:main div.h-8.border-t";
const STATUSBAR = "css:main div.h-6.border-t";
const TOOLS = "title:Herramientas: monitoreo, diagnóstico, TFTP, syslog, plugins";
const HOST = "ph:192.0.2.1 o hostname";
const USER = "ph:Según ~/.ssh/config";

export const chapters = [
  {
    id: "01-intro",
    sub: "Cliente SSH, Telnet, Serial y terminal local",
    shots: [
      {
        scene: "empty",
        cues: [
          [["zoom", "text:SSH, Telnet y Serial sin complicaciones.", 1.35], ["move", 930, 420]],
          [["hl", "text:SSH, Telnet y Serial sin complicaciones."]],
          [["unzoom"], ["move", 1100, 560]],
          [["hl", SIDEBAR, 0], ["@", 2600], ["hl", TABBAR, 0], ["@", 3900], ["hl", BUTTONBAR, 0], ["@", 5300], ["hl", STATUSBAR, 0]],
          [["hl", "has:Conexión rápida sin guardar"], ["hover", "has:Conexión rápida sin guardar"], ["@", 3000], ["hl", "has:Terminal local"], ["hover", "has:Terminal local"], ["@", 4300], ["hl", "has:Herramientas de red"], ["hover", "has:Herramientas de red"]],
        ],
      },
    ],
  },
  {
    id: "02-sesiones",
    sub: "Carpetas, menú contextual e importación",
    shots: [
      {
        scene: "empty",
        cues: [
          [["hl", "css:aside nav", 0], ["hover", "text:Sitio Central"]],
          [["@", 1200], ["hl", "title:Nueva sesión"], ["click", "title:Nueva sesión"]],
          [["field", "ph:Router core", "sw-acceso-centro"], ["field", "ph:Raíz", "Sucursales/Centro"]],
          [["field", HOST, "203.0.113.60"], ["field", USER, "admin"], ["@", 3600], ["click", "text:Guardar"], ["wait", 500], ["hl", "text:sw-acceso-centro"]],
          [["dbl", "text:core-sw01"], ["wait", 900], ["hl", "text:core-sw01"]],
          [["right", "text:core-sw02"], ["wait", 2600], ["key", "Escape"]],
          [["right", "text:Core"], ["wait", 2600], ["key", "Escape"]],
          [["@", 2200], ["field", "ph:Filtrar", "acceso"], ["wait", 1600], ["set", "ph:Filtrar", ""]],
          [["click", "title:Ajustes"], ["wait", 400], ["click", "text:Importar y exportar"], ["wait", 300], ["click", "text:Desde archivo…"]],
          [["click", "text:Leer ~/.ssh/config"], ["wait", 700], ["hl", "has:PuTTY · 2 sesiones"]],
          [["click", "has:1 aviso"], ["wait", 400], ["hl", "has:1 aviso"]],
          [["click", "text:Cancelar"], ["wait", 400], ["hl", "text:Exportar"], ["hover", "text:Exportar"]],
        ],
      },
    ],
  },
  {
    id: "03-conexion-rapida",
    sub: "Conectar sin guardar la sesión",
    shots: [
      {
        scene: "empty",
        cues: [
          [["hl", "has:Conexión rápida sin guardar"], ["hover", "has:Conexión rápida sin guardar"]],
          [["hl", "title:Conexión rápida sin guardar"], ["hover", "title:Conexión rápida sin guardar"], ["@", 4200], ["click", "title:Conexión rápida sin guardar"]],
          [["click", "text:Telnet"], ["wait", 350], ["click", "text:TCP"], ["wait", 350], ["click", "text:Serial"], ["wait", 350], ["click", "text:SSH"], ["field", HOST, "192.0.2.77"], ["field", USER, "admin"]],
          [["click", "text:Conectar"], ["wait", 900], ["hl", "title:192.0.2.77"]],
          [["hl", "title:Conexión rápida sin guardar: guardar como sesión"], ["@", 3000], ["right", "title:192.0.2.77"], ["wait", 400], ["hl", "text:Guardar como sesión…"], ["wait", 1600], ["key", "Escape"]],
          [["key", "cmd+k"], ["wait", 2600], ["type", "core"], ["@end", 300], ["key", "Escape"]],
        ],
      },
    ],
  },
  {
    id: "04-protocolos",
    sub: "Opciones por protocolo y equipos antiguos",
    shots: [
      {
        scene: "empty",
        cues: [
          [["right", "text:core-sw01"], ["wait", 300], ["click", "text:Editar"]],
          [["scrollto", "has:Usa OpenSSH del sistema"], ["hl", "has:Usa OpenSSH del sistema"]],
          [["hl", "ph:~/.ssh/id_ed25519"], ["@", 1500], ["hl", "ph:usuario@bastion:22"], ["@", 2700], ["hl", "ph:-L 8443"], ["@", 3900], ["scrollto", "text:Túneles SSH"], ["click", "text:Túneles SSH"], ["click", "text:Agregar túnel"], ["wait", 300], ["hl", "has:Túneles SSH (1)"]],
          [["scrollto", "text:Telnet"], ["click", "text:Telnet"], ["@", 2800], ["click", "text:TCP"], ["wait", 400], ["hl", "has:TCP crudo: conexión directa"]],
          [["click", "text:Serial"], ["wait", 400], ["hl", "text:Velocidad"], ["@", 1800], ["hl", "text:Paridad"], ["@", 3000], ["hl", "text:Flujo"]],
          [["click", "text:SSH"], ["scrollto", "text:Opciones de terminal"], ["click", "text:Opciones de terminal"], ["wait", 300], ["scrollto", "text:Comandos al conectar (uno por línea)"], ["hl", "text:Comandos al conectar (uno por línea)"], ["@end", 400], ["key", "Escape"]],
        ],
      },
      {
        scene: "legacy",
        cursor: [900, 400],
        cues: [
          [["zoom", "has:Unable to negotiate", 1.6], ["hl", "has:Unable to negotiate"]],
          [["hl", "has:Presiona L"], ["@", 3200], ["unzoom"], ["click", "css:.xterm-screen", { at: [0.6, 0.6] }], ["key", "L"], ["wait", 900], ["hl", "has:router-antiguo#show ip"]],
          [["right", "tp:admin@192.0.2.99"], ["wait", 250], ["click", "text:Editar"], ["wait", 300], ["scrollto", "has:Permitir algoritmos legacy"], ["hl", "has:Permitir algoritmos legacy"], ["@end", 400], ["key", "Escape"]],
          [["click", "title:Ajustes"], ["wait", 300], ["click", "text:Terminal"], ["wait", 300], ["hl", "has:Activar algoritmos legacy automáticamente"]],
        ],
      },
    ],
  },
  {
    id: "05-pestanas",
    sub: "Horizontales, verticales y vista dividida",
    shots: [
      {
        scene: "empty",
        setup: [["dbl", "text:core-sw01"], ["dbl", "text:ar-wan01"], ["dbl", "text:dist-sw01"], ["dbl", "text:sw-acceso-sur"], ["wait", 800]],
        cues: [
          [["click", "title:core-sw01"], ["wait", 900], ["click", "title:ar-wan01"], ["wait", 900], ["click", "title:dist-sw01"], ["wait", 700], ["hl", TABBAR, 0]],
          [["dbl", "title:dist-sw01"], ["wait", 300], ["type", "Distribución norte\n"], ["wait", 500], ["hl", "title:Distribución norte"]],
          [["right", "title:Distribución norte"], ["wait", 300], ["hl", "text:Copiar toda la salida"], ["@end", 300], ["key", "Escape"]],
          [["right", "title:Distribución norte"], ["wait", 400], ["hl", "text:Pestañas verticales"], ["wait", 900], ["click", "text:Pestañas verticales"]],
          [["wait", 300], ["click", "title:Plegar pestañas a iconos"], ["wait", 1300], ["click", "title:Expandir pestañas"], ["@end", 300], ["click", "title:Mostrar las pestañas arriba (horizontales)"]],
          [["click", "title:Vista dividida: ver 2 o 4 pestañas a la vez"], ["wait", 300], ["hl", "text:2 lado a lado"], ["@", 3600], ["hl", "text:2 apiladas"], ["@", 4800], ["hl", "text:4 en cuadrícula (2x2)"], ["@end", 400], ["click", "text:4 en cuadrícula (2x2)"]],
          [["hl", "css:main select"], ["hover", "css:main select"]],
          [["move", 900, 420], ["wait", 1200], ["move", 1250, 600]],
        ],
      },
    ],
  },
  {
    id: "06-difusion",
    sub: "Los mismos comandos en varios equipos",
    shots: [
      {
        scene: "empty",
        setup: [["dbl", "text:core-sw01"], ["dbl", "text:core-sw02"], ["dbl", "text:Shell local"], ["click", "title:core-sw01"], ["key", "cmd+j"], ["wait", 500], ["set", "opt:cambio-descripcion.txt", "cambio-descripcion.txt"], ["wait", 400]],
        cues: [
          [["hl", "has:CAMARA PISO 2"], ["hover", "has:CAMARA PISO 2"]],
          [["click", "css:aside ~ main [title='Elegir a qué sesiones se envía'], [title='Elegir a qué sesiones se envía']"], ["wait", 400], ["hl", "css:[aria-label='Destino del envío']"]],
          [["click", "text:Pestañas elegidas"], ["wait", 400], ["click", "css:[aria-label='Destino del envío'] .ml-6 label:nth-child(1)"], ["click", "css:[aria-label='Destino del envío'] .ml-6 label:nth-child(2)"], ["wait", 600], ["move", 980, 300], ["js", "document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))"]],
          [["click", "text:Todo"], ["wait", 500], ["hl", "text:Destinos, en este orden"], ["@", 2400], ["hl", "has:Texto completo"]],
          [["hl", "has:Para confirmar, escribe la cantidad"], ["click", "css:[role=alertdialog] input[inputmode=numeric]"], ["type", "2"], ["wait", 400], ["@end", 500], ["click", "text:Enviar a 2 equipos"]],
          [["wait", 300], ["hl", "has:Difusión en curso"], ["@", 2600], ["click", "text:Ver detalle"], ["wait", 300], ["hl", "text:Detener"]],
        ],
      },
    ],
  },
  {
    id: "07-notas",
    sub: "Plantillas con variables y notas cifradas",
    shots: [
      {
        scene: "empty",
        setup: [["dbl", "text:core-sw01"], ["wait", 600]],
        cues: [
          [["key", "cmd+j"], ["wait", 500], ["set", "opt:plantilla-vlan.txt", "plantilla-vlan.txt"], ["hl", "title:Cerrar (⌘J)"]],
          [["hl", "has:{{interfaz}}"], ["@", 2600], ["click", "title:Buscar en todas las notas"], ["type", "vlan"], ["wait", 1200], ["hl", "ph:Buscar en todas las notas"], ["@end", 200], ["click", "title:Buscar en todas las notas"]],
          [["click", "has:write memory", { at: [0.9, 0.5] }], ["key", "cmd+Enter"], ["wait", 600], ["hl", "css:[role=alertdialog]"], ["@", 2400], ["click", "text:Enviar"], ["wait", 500], ["hl", "text:Todo"]],
          [["hl", "has:{{vlan}}"], ["@", 2600], ["click", "text:Todo"], ["wait", 500], ["type", "30\tCAMARAS\tGigabitEthernet1/0/7\tCamara piso 2", 45]],
          [["hl", "text:Completar plantilla"], ["@end", 1500], ["click", "text:Continuar"], ["wait", 500], ["click", "text:Enviar", { timeout: 1200 }]],
          [["hl", "text:Capturar"], ["hover", "text:Capturar"]],
          [["click", "title:Más acciones de la nota"], ["wait", 200], ["click", "title:Proteger con contraseña"], ["wait", 400], ["hl", "has:Proteger con contraseña"]],
        ],
      },
      {
        scene: "lock-note",
        cues: [
          [["hl", "css:input[type=password]"], ["hover", "css:input[type=password]"]],
          [["click", "css:input[type=password]"], ["type", "demo-clave-2026", 40], ["key", "Enter"], ["wait", 500], ["hl", "has:Accesos de emergencia"]],
          [["click", "title:Más acciones de la nota"], ["wait", 200], ["click", "title:Protección de la nota"], ["wait", 400], ["hl", "text:Bloquear ahora"], ["@", 2600], ["hl", "text:Quitar protección"]],
          [["click", "text:Bloquear ahora"], ["click", "title:Buscar en todas las notas"], ["type", "tacacs"], ["wait", 600], ["hl", "ph:Buscar en todas las notas"]],
        ],
      },
    ],
  },
  {
    id: "08-catalogo",
    sub: "Comandos verificados por fabricante",
    shots: [
      {
        scene: "empty",
        setup: [["dbl", "text:core-sw01"], ["wait", 600]],
        cues: [
          [["key", "cmd+l"], ["wait", 600], ["hl", "opt:cisco"]],
          [["set", "opt:cisco", "huawei"], ["@", 1800], ["set", "opt:huawei", "fortinet"], ["@", 3000], ["set", "opt:fortinet", "linux"], ["@end", 400], ["set", "opt:linux", "cisco"]],
          [["hl", "text:Detectar"], ["click", "text:Detectar"], ["wait", 1200], ["hl", "opt:iosxe"]],
          [["field", "ph:Buscar comando o tarea", "vecinos"], ["wait", 400]],
          [["hl", "has:Consulta"], ["@", 2600], ["field", "ph:Buscar comando o tarea", "reload"], ["wait", 500], ["hl", "has:Puede cortar servicio"]],
          [["field", "ph:Buscar comando o tarea", "vecinos"], ["wait", 300], ["hover", "has:show cdp neighbors"], ["hl", "tp:Ejecutar en"], ["@", 2600], ["click", "tp:Ejecutar en"], ["wait", 800]],
          [["click", "title:Agregar un comando propio"], ["wait", 400], ["click", "css:[role=dialog] textarea, .fixed textarea"], ["type", "show interfaces {{interfaz}} transceiver", 40], ["@end", 300], ["click", "text:Cancelar"]],
          [["click", "title:Packs de comandos"], ["wait", 500], ["hl", "text:Packs de comandos"]],
          [["hl", "has:Un pack es un archivo JSON"], ["@", 3000], ["hl", "text:Importar pack"], ["@end", 300], ["key", "Escape"]],
        ],
      },
    ],
  },
  {
    id: "09-topologia",
    sub: "Vecinos CDP y LLDP, rutas y snapshots",
    shots: [
      {
        scene: "empty",
        setup: [["click", TOOLS], ["click", "text:Topología"], ["wait", 600]],
        cues: [
          [["hl", "text:Topología CDP / LLDP"], ["@", 3000], ["hl", "css:svg"]],
          [["zoom", "svg:dist-sw01", 1.7], ["@end", 300], ["unzoom"]],
          [["click", "svg:sw-acceso-01"], ["wait", 400], ["hl", "text:Conectar y seguir la ruta"]],
          [["click", "svg:core-sw01"], ["click", "text:Desde aquí"], ["click", "svg:sw-acceso-02"], ["click", "text:Hasta aquí"], ["wait", 400], ["hl", "text:Ruta"]],
          [["hl", "text:Snapshot"], ["@", 2600], ["set", "opt:s1", "s1"], ["wait", 500], ["hl", "text:Cambios"]],
          [["hl", "text:SVG"], ["@", 1000], ["hl", "text:draw.io"], ["@", 1900], ["hl", "text:CSV"], ["@", 2600], ["hl", "text:Mermaid"]],
        ],
      },
    ],
  },
  {
    id: "10-herramientas",
    sub: "Monitoreo, diagnóstico, SNMP, transferencias y respaldos",
    shots: [
      {
        scene: "monitor",
        wait: 2600,
        cues: [
          [["hl", "text:Monitoreo"], ["@", 2200], ["hl", "text:Plugins"]],
          [["hl", "has:Gateway sitio central"], ["hover", "has:Gateway sitio central"]],
          [["hl", "has:Enlace sucursal norte"], ["hover", "has:Caídas desde que inició"]],
        ],
      },
      {
        scene: "t-diag",
        cues: [[["field", "ph:192.0.2.53 o router.lab", "192.0.2.1"], ["@", 1800], ["hl", "text:Traceroute"], ["@", 3000], ["hl", "text:Puertos TCP"]]],
      },
      {
        scene: "speed",
        cues: [[["hl", "text:Speedtest"], ["@", 1800], ["hl", "has:iperf3 · cliente"], ["@", 3000], ["hl", "has:iperf3 · servidor"]]],
      },
      {
        scene: "subnet",
        cues: [[["field", "css:main input:not([placeholder])", "198.51.100.77/26"], ["wait", 600], ["hl", "text:Calculadora de subredes"], ["@end", 1600], ["set", "opt:28", "28"], ["hl", "text:Dividir en subredes"]]],
      },
      {
        scene: "empty",
        setup: [["click", TOOLS], ["click", "text:SNMP"], ["wait", 500]],
        cues: [
          [["hl", "has:GETBULK"], ["hover", "has:GETBULK"]],
          [["click", "title:IF-MIB (RFC 2863): ifXTable con contadores de 64 bits; ifTable si el agente no la tiene"], ["wait", 900], ["scroll", "text:Conjuntos de OIDs", 520], ["hl", "text:Conjuntos de OIDs"]],
        ],
      },
      {
        scene: "snmpgen",
        cues: [[["hl", "text:Generador de configuración"], ["@", 2400], ["hl", "text:Configuración generada"]]],
      },
      {
        scene: "transfer",
        cues: [
          [["hl", "text:Servidor TFTP"], ["@", 2600], ["hl", "has:copy tftp://"]],
          [["hl", "text:SFTP interactivo"], ["@", 2600], ["scroll", "text:Servidor FTP", 500], ["hl", "text:Cliente FTP / FTPS"]],
        ],
      },
      {
        scene: "backup",
        cues: [
          [["hl", "text:Respaldar configuración"], ["@", 2600], ["hl", "text:Enmascarar secretos"]],
          [["hl", "text:Respaldos guardados"], ["@", 2200], ["hl", "has:+4 agregadas"]],
        ],
      },
      {
        scene: "t-syslog",
        cues: [[["hl", "text:Servidor Syslog"], ["@", 2600], ["click", "text:Plugins"], ["wait", 400], ["hl", "has:Un plugin es una carpeta"]]],
      },
    ],
  },
  {
    id: "11-logs-alertas",
    sub: "Grabación de sesiones y avisos por palabra clave",
    shots: [
      {
        scene: "empty",
        query: "&alert=1",
        setup: [["dbl", "text:core-sw01"], ["dbl", "text:ar-wan01"], ["click", "title:core-sw01"], ["wait", 600]],
        cues: [
          [["hl", "title:Grabar la sesión en un archivo de texto"], ["@", 1600], ["click", "title:Grabar la sesión en un archivo de texto"]],
          [["hl", "tp:Grabando en"], ["hover", "tp:Grabando en"]],
          [["click", "title:Ajustes"], ["wait", 300], ["click", "text:Logs"], ["wait", 300], ["hl", "text:Grabar logs automáticamente"], ["@", 3000], ["hl", "text:Nombre del archivo"], ["@", 4600], ["hl", "text:Rotación diaria"]],
          [["hl", "text:Ocultar secretos en los logs"]],
          [["hl", "text:Carpeta de logs"], ["hover", "text:Elegir…"]],
          [["click", "text:Alertas"], ["wait", 300], ["click", "text:Nueva alerta"], ["wait", 300], ["field", "ph:Ej: Interfaz caída", "Interfaz cambió de estado"], ["field", "ph:%LINK-3-UPDOWN", "%LINK-3-UPDOWN"]],
          [["click", "text:Guardar"], ["wait", 300], ["key", "Escape"], ["wait", 1700], ["hl", "title:Alerta por palabra clave"]],
          [["hover", "title:Alerta por palabra clave"]],
        ],
      },
    ],
  },
  {
    id: "12-contrasenas",
    sub: "Bóveda cifrada, nunca visible",
    shots: [
      {
        scene: "empty",
        cues: [
          [["right", "text:sw-acceso-norte"], ["wait", 250], ["click", "text:Editar"], ["wait", 300], ["scrollto", "has:Guardar contraseña"], ["hl", "has:Guardar contraseña"]],
          [["hl", "has:Guardada"], ["@", 3000], ["hl", "has:Se guarda en la bóveda"], ["@end", 300], ["key", "Escape"]],
          [["dbl", "text:sw-acceso-norte"], ["wait", 900], ["hl", "css:.xterm-screen"]],
          [["hl", "title:Contraseña guardada: se completa sola en el primer pedido de contraseña al conectar"], ["hover", "title:Contraseña guardada: se completa sola en el primer pedido de contraseña al conectar"]],
          [["click", "title:Ajustes"], ["wait", 300], ["click", "text:Credenciales"], ["wait", 300], ["hl", "has:Bóveda cifrada con llave"]],
          [["hl", "has:Restablecer bóveda"]],
          [["hl", "has:Recomendación: para SSH"]],
        ],
      },
    ],
  },
  {
    id: "13-apariencia",
    sub: "Modo oscuro, temas de terminal y resaltado",
    shots: [
      {
        scene: "empty",
        setup: [["dbl", "text:ar-wan01"], ["dbl", "text:core-sw01"], ["wait", 500], ["click", "title:Ajustes"], ["wait", 300]],
        cues: [
          [["hl", "text:Interfaz"], ["hover", "text:Sistema"], ["@", 2600], ["hover", "text:Claro"], ["@end", 400], ["click", "text:Oscuro"]],
          [["key", "Escape"], ["wait", 1200], ["move", 760, 380]],
          [["click", "title:Ajustes"], ["wait", 400], ["click", "text:Ámbar"], ["@", 2200], ["click", "text:Dracula"], ["@", 3600], ["click", "text:Tokyo Night"]],
          [["scroll", "text:Tokyo Night", 700], ["wait", 200], ["hl", "text:Fuente"], ["@", 2000], ["hl", "text:Cursor"]],
          [["click", "text:Resaltado"], ["wait", 400], ["scrollto", "text:Esquemas por defecto", "start"], ["hl", "text:Esquemas por defecto"]],
          [["scrollto", "text:Probar con mi salida"], ["click", "text:Probar con mi salida"], ["wait", 300], ["scrollto", "text:Cisco / Arista"], ["hl", "text:Personalizar"]],
          [["hl", "has:Cada sesión puede fijar su fabricante"]],
        ],
      },
    ],
  },
  {
    id: "14-ajustes",
    sub: "Terminal, barra de botones, módulos e integraciones",
    shots: [
      {
        scene: "empty",
        setup: [["dbl", "text:core-sw01"], ["wait", 600]],
        cues: [
          [["key", "cmd+,"], ["wait", 500], ["hl", "text:General"], ["@", 1900], ["hl", "text:Integraciones"]],
          [["field", "ph:Buscar ajuste", "contraseña"], ["wait", 900], ["@end", 200], ["set", "ph:Buscar ajuste", ""]],
          [["click", "text:Terminal"], ["wait", 300], ["hl", "text:Historial (scrollback)"], ["@", 2500], ["hl", "text:Pegar con clic derecho"], ["@", 4200], ["hl", "text:Barra de botones"]],
          [["key", "Escape"], ["wait", 300], ["hl", BUTTONBAR, 0], ["hover", "text:Interfaces"]],
          [["click", "title:Nuevo botón"], ["wait", 300], ["field", "ph:Ej: Respaldo config", "Estado de interfaz"], ["click", "css:.fixed textarea"], ["type", "show interfaces {{interfaz}} status", 40], ["click", "text:Guardar"], ["wait", 400], ["hl", "text:Estado de interfaz"]],
          [["click", "title:Nuevo botón"], ["wait", 300], ["click", "text:Script Python"], ["wait", 300], ["hl", "text:Script Python"], ["@end", 300], ["click", "text:Cancelar"]],
          [["click", "title:Ajustes"], ["wait", 300], ["click", "text:Módulos"], ["wait", 300], ["hl", "text:Monitoreo"]],
          [["click", "text:Agentes IA"], ["wait", 300], ["hl", "text:Activar servidor MCP"], ["@", 3000], ["hl", "text:Aprobar cada comando"]],
          [["hl", "text:Los cambios se aplican al instante"]],
        ],
      },
    ],
  },
  {
    id: "15-actualizaciones",
    sub: "Versión, créditos y actualización firmada",
    shots: [
      {
        scene: "empty",
        query: "&update=1",
        wait: 5200,
        setup: [["click", "title:Ajustes"], ["wait", 300], ["click", "text:Acerca de"]],
        cues: [
          [["hl", "has:Versión 0.9.1"], ["@", 2200], ["hl", "text:github.com/Parzval-Net/Net_Terminal"]],
          [["hl", "text:Actualizaciones"], ["@", 2600], ["click", "text:Buscar ahora"], ["wait", 600], ["hl", "has:Hay una versión nueva"]],
          [["key", "Escape"], ["wait", 300], ["hl", "has:Nueva versión"], ["click", "text:Ver novedades"]],
          [["hl", "text:Actualizar y reiniciar"], ["@", 1800], ["click", "text:Actualizar y reiniciar"], ["wait", 500], ["hl", "has:Descargando"]],
          [["hl", "has:Descargando"]],
        ],
      },
    ],
  },
  {
    id: "16-cierre",
    sub: "Resumen y buenas prácticas",
    shots: [
      {
        scene: "split",
        cues: [
          [["move", 900, 360]],
          [["move", 1200, 520]],
          [["hover", "title:Vista dividida: 4 en cuadrícula (2x2)"]],
          [["card", "NetTerminal", "Gracias por ver este tutorial", "SSH, Telnet, Serial y terminal local"]],
        ],
        tail: 2.2,
      },
    ],
  },
];
