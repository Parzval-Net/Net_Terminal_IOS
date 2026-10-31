# Fuentes del video 3

Cada afirmación de la narración (`guion/`) con el código que la respalda. Rutas relativas a la raíz del repositorio, verificadas sobre `146aaa6` (v0.9.7) en la auditoría (`scripts/video/v2/AUDITORIA-GUIONES.md`). Lo que no está en el código va con su fuente externa oficial.

## 01 · Qué se puede automatizar

| Afirmación | Fuente |
| --- | --- |
| Tres niveles: Consulta, Cambia config/estado, Puede cortar servicio | `src/lib/packs.ts:92-96` |
| Lo que no se reconoce como consulta se trata como cambio | `README.md:199`, `src/lib/packs.ts` (`computeRisk`) |
| Comandos encadenados se evalúan por partes; `show version ; reload` es disruptivo | `README.md:151`; prueba en `scripts/video/v2/v3-automatizacion/probar-ejemplos.mjs` ("riesgo calculado: show version ; reload = disruptive") |
| Lo disruptivo siempre se confirma; el cambio, según "Confirmar envío de varias líneas" (activado) | `src/App.tsx:727`, `src/lib/settings.ts:145` |
| Notas, botones de texto, catálogo y envío a varias sesiones pasan por el motor de riesgo | `README.md:42`, `README.md:157`, `README.md:162` |
| **Cambio v0.9.7**: los scripts y plugins también pasan por el motor: cada línea se clasifica con `computeRisk` antes de su Enter | `src/lib/scriptGate.ts:1-5`, `src-tauri/src/scripts.rs:13-16`, `:460` (`gate`), `README.md:163`, `README.md:316` |
| Los comandos al conectar se escriben sin evaluar riesgo | `src/components/TerminalView.tsx:290-301` |
| Agentes: el diálogo muestra el riesgo calculado por la app; aprobación por comando activada por defecto | `src/components/ApprovalDialog.tsx:49-67`, `src/lib/settings.ts:153` (`mcpApproval: true`) |

## 02 · Botones

| Afirmación | Fuente |
| --- | --- |
| La barra está sobre la barra de estado y viene activada (Ajustes › Terminal › "Barra de botones") | `src/lib/settings.ts:150` (`showButtonBar: true`), `src/components/SettingsModal.tsx:426` |
| Botones de fábrica "terminal length 0" e "Interfaces" | `src/lib/settings.ts:146-149` |
| "+" abre "Nuevo botón": Etiqueta, "Enviar texto" o "Script Python" | `src/components/ButtonBar.tsx:75`, `src/components/MacroModal.tsx:40`, `:56-57` |
| Solo se activan con una sesión conectada; piden las variables (Completar plantilla) | `src/components/ButtonBar.tsx`, `src/components/TemplateDialog.tsx:75` |
| Un bloque de varias líneas muestra un resumen; lo disruptivo siempre se confirma | `src/App.tsx:727`, `README.md:162` |
| Clic derecho: Editar / Eliminar | `src/components/ButtonBar.tsx` (menú contextual) |

## 03 · Plantillas

| Afirmación | Fuente |
| --- | --- |
| Notas con ⌘J (Ctrl+Shift+J); ⌘Enter / Ctrl+Enter | `README.md:77`, `README.md:80`, `src/lib/platform.ts:79-80` |
| Variables `{{nombre}}` y diálogo "Completar plantilla" con vista previa | `src/components/TemplateDialog.tsx:75-76` |
| **Cambio v0.9.7**: variables con pinta de secreto (pass, pwd, secret, clave, key, token, psk, community, comunidad, auth, enable, tacacs, radius, snmp, pin) se piden ocultas, se enmascaran y no se guardan | `src/lib/templateSecrets.ts:1-14`, `src/components/TemplateDialog.tsx:37`, `:48`, `:55`, `:87`, `README.md:180` |
| Destinos: pestañas elegidas, una carpeta, paneles visibles | `src/components/BroadcastTarget.tsx`, `README.md:42` |
| Las variables se piden una sola vez también al enviar a varias sesiones | `src/App.tsx` (`templateVars` antes del envío), `README.md:51` |
| Equipos, omitidos y riesgo; escribir la cantidad de equipos si no es consulta | `src/components/BroadcastDialog.tsx:81`, `:99`, `:130` |
| Envío en orden con pausa entre equipos y "Detener" | `src/components/BroadcastDialog.tsx:113`, `:191`, `README.md:42` |

## 04 · Comandos al conectar

| Afirmación | Fuente |
| --- | --- |
| Opciones de terminal › "Comandos al conectar (uno por línea)" | `src/components/SessionModal.tsx:403-405` |
| `terminal length 0` / `screen-length 0 temporary` | `src/lib/settings.ts:147`, `README.md:309` |
| Espera el prompt (termina en `> # $ % ]`) con 200 ms de silencio, o 1,5 s de silencio | `src/lib/suggest.ts:25` (`PROMPT`), `src/components/TerminalView.tsx:276-288` |
| No envía sobre un pedido de usuario, contraseña, PIN, código u OTP; hasta 2 minutos; entre líneas espera el prompt (hasta 5 s) | `src/lib/suggest.ts:30` (`CREDENTIALS`), `src/components/TerminalView.tsx:284`, `:290-301` |
| Se ejecutan en cada conexión, también al reconectar | `src/components/TerminalView.tsx:407` (`runOnConnect` en cada `connect()`) |
| Nunca se importan desde otros clientes ni desde JSON | `src-tauri/src/importers.rs` (se descartan), `README.md:45`, `README.md:150`, `README.md:159` |

## 05 · Instalar las herramientas

| Afirmación | Fuente |
| --- | --- |
| Terminal local con ⌘T / Ctrl+Shift+T | `src/lib/platform.ts:73-74` (`t`), `README.md:84` |
| Python 3 para scripts y plugins | `src-tauri/src/netterminal.py:1-5`, `README.md:54` |
| **Cambio v0.9.7**: orden de detección. Windows: `py -3`, `python`, `python3`. macOS: Homebrew (`/opt/homebrew/bin`, `/usr/local/bin`), python.org (`Python.framework`), otros del PATH y `/usr/bin/python3` al final solo con las Command Line Tools. Linux: `python3`, `python` | `src-tauri/src/scripts.rs:784-835`, `:884-908`, `README.md:330` |
| **Cambio v0.9.7**: si no hay Python, cada ejecución lo vuelve a buscar; botón "Volver a detectar" en Herramientas › Plugins | `src-tauri/src/scripts.rs:916-931` (`NO_PYTHON`: "…usa Volver a detectar"), `src/components/tools/PluginsTool.tsx:58-66`, `:150-153` |
| **Cambio v0.9.7**: desde el Dock o Finder la app agrega `/opt/homebrew/bin`, `/usr/local/bin` y el Python de python.org al PATH (Linux: `~/.local/bin`) | `src-tauri/src/lib.rs:987-998` (`extend_path`), `README.md:60` |
| Python desde python.org; en Windows el lanzador `py` | https://www.python.org/downloads/ , https://docs.python.org/3/using/windows.html |
| iperf3: `iperf3 --version` al abrir Velocidad; aviso con `brew install iperf3` y `sudo apt install iperf3` | `src-tauri/src/nettools.rs:131-133`, `:196`, `src/components/tools/PerfTool.tsx:193-197` |
| ESnet no distribuye binarios; iperf.fr enlaza compilaciones de terceros para Windows | https://software.es.net/iperf/obtaining.html , https://iperf.fr/iperf-download.php |
| `iperf3.exe` junto a NetTerminal.exe o en el PATH | `src/components/tools/PerfTool.tsx` (indicación para Windows) |
| ssh, scp y sftp del sistema | `src-tauri/src/connection.rs:948`, `README.md:36`, `README.md:63` |
| Windows: OpenSSH Client como característica opcional; `Add-WindowsCapability` en PowerShell como administrador | https://learn.microsoft.com/en-us/windows-server/administration/openssh/openssh_install_firstuse |
| Linux: `openssh-client` (Debian/Ubuntu) y `openssh-clients` (Fedora/RHEL) | packages.debian.org/openssh-client, packages.fedoraproject.org/pkgs/openssh/openssh-clients |
| Traceroute: `tracert` en Windows; `traceroute` o `tracepath` en Linux/macOS | `src-tauri/src/nettools.rs:109-124` |
| Telnet no requiere nada instalado | `README.md:38` |

## 06 · Scripts de Python

| Afirmación | Fuente |
| --- | --- |
| Carpeta `scripts/` y "Abrir carpeta de scripts" en el menú Scripts | `src/components/ButtonBar.tsx:43`, `README.md:281` |
| La app deja `netterminal.py`, solo biblioteca estándar | `src-tauri/src/netterminal.py:1-5` |
| **Cambio v0.9.7**: diálogo de lanzamiento: destino (mismo selector de la difusión), "Permitir cambios" (apagado), "Permitir que el script escriba contraseñas guardadas en: …", "En paralelo" (1 a 4) y "Tiempo máximo" (5, 15, 30, 60, 120 min) | `src/components/ScriptLaunchDialog.tsx:24`, `:85-180`, `src-tauri/src/scripts.rs:63` (`MAX_PARALLEL = 4`), `README.md:281-285` |
| **Cambio v0.9.7**: cada línea pasa por el motor de riesgo; consulta pasa, cambio confirma (salvo "permitir cambios"), disruptivo y líneas con Tab/?/Esc/Ctrl-D siempre; rechazo o 2 minutos sin respuesta detiene el script (`ScriptDenied`) | `src-tauri/src/scripts.rs:13-16`, `:68` (`GATE_TIMEOUT` 120 s), `:460`, `src/lib/scriptGate.ts`, `README.md:316` |
| **Cambio v0.9.7**: destinos tomados mientras corre (lo tecleado no se envía); "Detener script" en la barra de botones | `src-tauri/src/scripts.rs:15`, `:75` (`BUSY`), `src/components/ButtonBar.tsx:86-87`, `src/components/ScriptLaunchDialog.tsx:177-180`, `README.md:164` |
| `nt.session`, `run()` sin eco ni prompt, `print()` como aviso | `src-tauri/src/netterminal.py:14-30`, `:237`, `README.md:291-297` |
| `clear`, `sendline`, `wait_for(timeout)`, `read(idle, timeout)`; `ScriptTimeout.output` | `src-tauri/src/netterminal.py:14-25`, `:91-96`, `:211-230`, `README.md:293-295` |
| `expect()` = `wait_for(return_match_only=True)` | `src-tauri/src/netterminal.py:21-24`, `:223`, `:265`, `README.md:294` |
| **Cambio v0.9.7**: varias sesiones: `sessions()`, `on(nombre)`, `for_each(fn, parallel)`; `allow_changes`, `max_parallel` | `src-tauri/src/netterminal.py:31-42`, `:285-328`, `README.md:298-300` |
| `ask_secret` (campo oculto, enmascarado en mensajes) | `src-tauri/src/netterminal.py:44-48`, `:335`, `README.md:301`, `README.md:165` |
| Ejemplos y salidas mostradas (validados con Node 24 el día de la auditoría) | `docs/ejemplos/scripts/primer_script.py`, `ping_destinos.py`, `inventario_csv.py` (usa `for_each` y cae a una sesión en versiones anteriores); `scripts/video/v2/v3-automatizacion/probar-ejemplos.mjs` |
| Los comandos de los ejemplos son de consulta | `probar-ejemplos.mjs` ("comandos enviados por los ejemplos: 8 distintos, todos de consulta") |

## 07 · Plugins

| Afirmación | Fuente |
| --- | --- |
| Carpeta con `plugin.json` y código Python con la API netterminal | `src/components/tools/PluginsTool.tsx:132`, `README.md:334-342` |
| Acciones como botones en Herramientas › Plugins | `src/components/tools/PluginsTool.tsx` |
| `NT_ACTION` | `README.md:339` |
| Manifiesto: id, versión, `entry`, permisos, acciones | `docs/ejemplos/plugins/revision-puertos/plugin.json`, `src-tauri/src/plugins.rs:100-120` |
| Permisos `session`, `network`, `files` y **vault-type (nuevo)**; solo `session` se hace cumplir; `vault-type` exige `session` y aprobación por ejecución | `src-tauri/src/plugins.rs:25-28`, `:116-120`, `src/components/tools/PluginsTool.tsx:38`, `:297-314`, `README.md:342` |
| Python corre con los privilegios del usuario | `SECURITY.md` (Scripts y plugins Python) |
| "Desde carpeta" e "Instalar .zip" | `src/components/tools/PluginsTool.tsx:138-141` |
| Rechazos: enlaces simbólicos, más de 200 archivos, más de 20 MB, bytecode y binarios, no UTF-8 | `src-tauri/src/plugins.rs:23-24`, `:136-161`, `README.md:153` |
| Revisión: permisos y todo el código Python, primero la entrada; "Instalar y habilitar"; huella SHA-256 | `src/components/tools/PluginsTool.tsx:159`, `:179`, `:197`, `README.md:65`, `README.md:169` |
| Reinstalar avisa "Reemplazará la versión instalada" | `src/components/tools/PluginsTool.tsx:161` |
| Archivos editados: bloqueado hasta revisar y aprobar | `src/components/tools/PluginsTool.tsx:266-276` |
| Papelera con confirmación "¿Desinstalar …?" | `src/components/tools/PluginsTool.tsx:251` |
| Los plugins pasan por el mismo control de riesgo que los scripts | `README.md:316`, `README.md:342` |

## 08 · Packs

| Afirmación | Fuente |
| --- | --- |
| Catálogo con ⌘L / Ctrl+Shift+L | `README.md:78` |
| Un pack es JSON, solo datos, nunca se ejecuta | `README.md:199` |
| "Propio": "Nuevo comando · <fabricante>", "Guardar en Mis comandos" | `src/components/CommandEditor.tsx:44`, `:127` |
| Aviso "Por su contenido, la app lo tratará como…" y uso del mayor riesgo | `src/components/CommandEditor.tsx:84`, `README.md:199` |
| `clear counters` se calcula como cambio | `probar-ejemplos.mjs` ("pack mal declarado: clear counters declarado read, la app lo trata como change") |
| "Mis comandos", un pack por fabricante; activar, desactivar, "Exportar para compartir" | `src/components/PacksModal.tsx:175`, `README.md:198` |
| Al importar: comandos por riesgo, "N comandos declaraban menos riesgo del real", reemplazo por id | `src/components/PacksModal.tsx:114`, `:207` |
| Al compartir, usar variables en vez de IPs, hostnames, clientes o credenciales | `src/components/PacksModal.tsx:199` |

## 09 · Agentes de IA con MCP

| Afirmación | Fuente |
| --- | --- |
| Clientes: Claude Code, Gemini CLI, Codex, Claude Desktop | `src/components/AiSettings.tsx:26-45`, `README.md:55` |
| Apagado por defecto | `src/lib/settings.ts:150` (`mcpEnabled: false`), `src-tauri/src/mcp.rs:6` |
| Ajustes › Agentes IA: "Activar servidor MCP", "Aprobar cada comando", "Solo lectura", Puerto | `src/components/SettingsModal.tsx:69`, `src/components/AiSettings.tsx:69-90` |
| **Valores por defecto**: Solo lectura apagado (`mcpReadOnly: false`), aprobación por comando encendida (`mcpApproval: true`) | `src/lib/settings.ts:153-154` |
| Solo lectura: lista y lee, sin enviar comandos ni abrir sesiones | `src/components/AiSettings.tsx:86`, `src-tauri/src/mcp.rs:358`, `:380` (`if !cfg.read_only`), test `:435-436` |
| Token generado al activar; "Generar nuevo (invalida el anterior)"; tratar como contraseña | `src/lib/settings.ts:183-187` (`newToken`), `src/components/AiSettings.tsx:117`, `:150` |
| Solo 127.0.0.1; sin token se rechaza; Origin y Host locales | `src-tauri/src/mcp.rs:6`, `:90`, `:103`, `:152`, `README.md:172` |
| Configuración copiable por cliente | `src/components/AiSettings.tsx:125-140` |
| Indicador "IA" en la barra de estado | `src/components/StatusBar.tsx:59` |
| **Cambio v0.9.7**: diálogo con equipo, texto completo y distintivo de riesgo calculado por la app; casilla "Entiendo que este comando puede cortar servicio" para lo disruptivo; Enter no aprueba; foco en Rechazar; rechazo a los 2 minutos | `src/components/ApprovalDialog.tsx:26-27`, `:37`, `:49-52`, `:65-67`, `:78-98`, `src-tauri/src/mcp.rs:28` (máx. 3 pendientes) |
| Herramientas MCP: `list_sessions`, `list_connections`, `read_output`, `send_command`, `open_session`; no hay scripts, plugins ni difusión | `src-tauri/src/mcp.rs:274-312`, `README.md:157` |
| La salida de los equipos se declara dato no confiable | `src-tauri/src/mcp.rs:251`, `README.md:173` |
| MCP es un protocolo abierto | https://modelcontextprotocol.io |

## 10 · Buenas prácticas

| Afirmación | Fuente |
| --- | --- |
| "Guardar contraseña" en la sesión: bóveda cifrada, se completa al conectar | `src/components/SessionModal.tsx:536`, `README.md:53`, `README.md:177` |
| Los scripts no pueden leer la bóveda | `README.md:165`, `README.md:318`, `SECURITY.md` |
| **Cambio v0.9.7**: `type_saved_password()`: la app escribe la contraseña guardada en el pedido de login; casilla por ejecución (apagada por defecto); el script solo recibe "escrita" o el motivo | `src-tauri/src/netterminal.py:49-57`, `:233`, `:330`, `src/components/ScriptLaunchDialog.tsx:133-148`, `README.md:302`, `README.md:318-326`, `SECURITY.md` (Contraseña guardada escrita por un script) |
| Revisar scripts de carpetas compartidas | `README.md:191` |

## 11 · Cierre

| Afirmación | Fuente |
| --- | --- |
| Ejemplos en `docs/ejemplos` | `docs/ejemplos/README.md` |

## Fuentes externas consultadas

- Python para Windows y macOS: https://www.python.org/downloads/ y https://docs.python.org/3/using/windows.html (lanzador `py`).
- OpenSSH en Windows: https://learn.microsoft.com/en-us/windows-server/administration/openssh/openssh_install_firstuse
- iperf3: https://software.es.net/iperf/obtaining.html e https://iperf.fr/iperf-download.php
- MCP: https://modelcontextprotocol.io
