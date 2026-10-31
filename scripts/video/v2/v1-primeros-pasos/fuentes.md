# Fuentes · Video 1: Primeros pasos y uso diario

Cada afirmación del guion con el archivo y la línea que la respaldan. Rutas relativas a la raíz del repositorio. Verificado sobre `146aaa6` (v0.9.7) en la auditoría de guiones (`scripts/video/v2/AUDITORIA-GUIONES.md`).

Atajos: `src/lib/platform.ts:1-14` (modificador ⌘ / Ctrl+Shift, `closeAllLabel`) y `src/lib/platform.ts:52-98` (`shortcutFor`). Valores por defecto: `src/lib/settings.ts:121-181`. `L` numera las frases de cada guion sin contar el título.

## 01 · Qué es NetTerminal e instalación

| L | Afirmación | Fuente |
| --- | --- | --- |
| 1-2 | SSH, Telnet, Serial y terminal local; macOS, Windows y Linux | `README.md:3`, `src/components/SessionModal.tsx:139-152` (tipos) |
| 3 | Datos ficticios en la demo | `scripts/screenshots/mock.js:1-4` |
| 4 | Paquetes: dmg, instalador de Windows, AppImage, deb | `README.md:358` (plataformas del actualizador), `src-tauri/tauri.conf.json` (bundle), `docs/index.html` (descargas) |
| 5 | Zip portable con los tres ejecutables, marcador `portable` y carpeta `data` | `README.md:108-129` |
| 6 | Revisión al abrir y cada 6 h; "Buscar ahora" en Acerca de | `src/App.tsx:286-295`, `src/components/SettingsModal.tsx:711` |
| 7 | "Actualizar y reiniciar": descarga, firma verificada, confirmación | `src/App.tsx:327-329`, `src/App.tsx:1121-1146`, `SECURITY.md` (Modelo de confianza del actualizador), `README.md:353-359` |
| 8 | Portable y deb: actualización manual | `src-tauri/src/updates.rs:57-61`, `src/App.tsx:1141` (botón "Descargar") |

## 02 · Sesiones y carpetas

| L | Afirmación | Fuente |
| --- | --- | --- |
| 1 | Carpetas y subcarpetas sin límite | `README.md:52`, `src/components/Sidebar.tsx:197-204` |
| 2 | En Windows y Linux el modificador es Ctrl+Shift | `src/lib/platform.ts:3-11`, `README.md:94` |
| 3 | Botón "Nueva sesión (⌘N)"; tipos SSH, Telnet, Serial, TCP, Local | `src/components/Sidebar.tsx:397`, `src/components/SessionModal.tsx:139-152`, `src/lib/platform.ts:83-84` (`n`) |
| 4 | Carpeta con barra para subcarpetas | `src/components/SessionModal.tsx:171` (placeholder "Raíz · usa / para subcarpetas") |
| 5 | Host, puerto, usuario y Guardar | `src/components/SessionModal.tsx:190` (placeholder `192.0.2.10 o hostname`), `:214` |
| 6 | Doble clic conecta; punto "Pestaña abierta" | `src/components/Sidebar.tsx:355` |
| 7 | Menú: Conectar, Editar, Duplicar, Eliminar (con confirmación); la copia no lleva contraseña | `src/components/Sidebar.tsx:176-185`, `src/App.tsx:908` (`save_password: undefined`) |
| 8 | Menú de carpeta: Conectar todas, Nueva sesión aquí, Nueva subcarpeta, Renombrar; arrastrar y soltar | `src/components/Sidebar.tsx:176`, `:202-204`, `README.md:52` |
| 9 | Filtro por nombre, IP, usuario o carpeta | `src/components/Sidebar.tsx:384` (campo "Filtrar…"), `README.md:52` |
| 10 | Ajustes › Importar y exportar › Desde archivo… | `src/components/SettingsModal.tsx:66`, `:498` |
| 11 | Formatos ssh_config, PuTTY, SecureCRT, MobaXterm, CSV; vista previa; sin contraseñas ni túneles | `src/components/ImportDialog.tsx:26-32`, `src-tauri/src/importers.rs:21`, `:76-80`, `README.md:45`, `README.md:159` |

## 03 · Conexión rápida

| L | Afirmación | Fuente |
| --- | --- | --- |
| 1 | No guarda la sesión | `README.md:46`, `src/App.tsx:377` |
| 2 | Rayo junto al más; ⌘O | `src/components/Sidebar.tsx:393`, `src/lib/platform.ts:85-86` (`o`) |
| 3 | SSH, Telnet, TCP, Serial; TCP crudo sin negociación Telnet (puerto 2001) | `src/components/QuickConnectDialog.tsx:18`, `:172`, `README.md:39` |
| 4 | Pestaña con rayo | `README.md:46` |
| 5 | "Guardar como sesión…" en barra de estado y menú de la pestaña; el diálogo se titula "Guardar como sesión"; sin reconectar | `src/components/StatusBar.tsx:107`, `src/App.tsx:825`, `src/App.tsx:1285`, `src/components/SessionModal.tsx:17`, `:129` |
| 6 | ⌘K: buscar sesión o usuario@host; "Conexiones rápidas recientes" | `src/lib/platform.ts:70-72` (`k`), `src/components/CommandPalette.tsx:30`, `:163`, `README.md:96` |

## 04 · SSH, Telnet y Serial

| L | Afirmación | Fuente |
| --- | --- | --- |
| 1 | SSH con el OpenSSH del sistema; config, agente y llaves | `README.md:36` |
| 2 | Llave privada y jump host (`usuario@bastion:22`) | `src/components/SessionModal.tsx:222`, `:231` |
| 3 | Túneles locales, remotos y dinámicos; escucha vacía = 127.0.0.1 | `src/components/SessionModal.tsx:654-698` (`placeholder="127.0.0.1"` en `:671`), `README.md:160` |
| 4 | Telnet propio; Serial con puerto, velocidad, paridad y flujo | `README.md:38-40`, `src-tauri/src/telnet.rs` |
| 5-6 | Equipo antiguo: la conexión falla, tecla L activa la compatibilidad | `src/components/TerminalView.tsx` (detección "Unable to negotiate" y tecla L), `README.md:36` |
| 7 | "Permitir algoritmos legacy" en la sesión; "Activar algoritmos legacy automáticamente", apagado | `src/components/SessionModal.tsx:258`, `src/components/SettingsModal.tsx:393`, `src/lib/settings.ts:134` (`autoLegacySsh: false`) |
| 8 | Algoritmos débiles, solo redes confiables | `README.md:36`, `SECURITY.md` (Algoritmos SSH legacy) |
| 9 | Contraseña en bóveda cifrada; campo solo de escritura | `src/components/SessionModal.tsx:536` ("Guardar contraseña"), `src-tauri/src/credentials.rs:1-5`, `README.md:53` |
| 10 | Se completa una sola vez, en el primer pedido (ventana de 60 s) | `src-tauri/src/autofill.rs:1-10`, `src/components/StatusBar.tsx:114` |
| 11 | No completa tras rechazo, passphrase ni en el bastión | `src-tauri/src/autofill.rs:1-4`, `README.md:177` |
| 12 | Llaves y agente como opción más segura | `README.md:36` |

## 05 · Pestañas y vista dividida

| L | Afirmación | Fuente |
| --- | --- | --- |
| 1 | La sesión sigue activa al cambiar de pestaña | `README.md:41` |
| 2 | Doble clic renombra; marca "Salida nueva" | `src/components/TabBar.tsx:175`, `:215` |
| 3 | Menú: Duplicar, Reconectar, Desconectar, Copiar toda la salida | `src/components/tabMenu.tsx:51-54` |
| 4 | Pestañas verticales; ancho ajustable; plegar a íconos | `src/components/tabMenu.tsx:43`, `src/components/VerticalTabs.tsx`, `README.md:59` |
| 5 | Vista dividida: 2 o 2x2; selector por panel | `README.md:41`, `src/lib/split.ts`, `src/components/SplitPanes.tsx` |
| 6 | Cerrar las demás / de la derecha (de abajo en vertical) / todas | `src/components/tabMenu.tsx:74-81` |
| 7 | Aviso con sesiones que se cortan, transferencias y conexiones rápidas | `src/components/CloseManyMessage.tsx:24-30`, `README.md:59` |
| 8 | ⌘⇧W / Ctrl+Shift+Alt+W | `src/lib/platform.ts:13-14`, `:56-62`, `README.md:86` |

## 06 · Catálogo de comandos

| L | Afirmación | Fuente |
| --- | --- | --- |
| 1 | ⌘L; 1.776 comandos con fuente | `src/lib/platform.ts:91-92` (`l`), `README.md:57`; conteo verificado con `src/packs/*.json` (1.776 `commands`) |
| 2 | Fabricantes y sistemas operativos | `README.md:57` |
| 3 | Detectar ejecuta el comando de detección (`show version` en Cisco) | `src/components/CommandsPanel.tsx:192-195`, `README.md:197` |
| 4 | La plataforma se guarda en la sesión | `README.md:57`, `scripts/screenshots/mock.js:171` (`sessions[0].platform`) |
| 5 | Búsqueda por comando o tarea | `src/components/CommandsPanel.tsx` (campo "Buscar comando o tarea") |
| 6 | Riesgos: Consulta, Cambia config/estado, Puede cortar servicio | `src/lib/packs.ts:92-96` |
| 7 | Ejecutar confirma si no es consulta; Escribir sin Enter | `src/components/CommandsPanel.tsx:329-334`, `README.md:162` |
| 8 | Favoritos, "Propio" y "Packs de comandos" | `src/components/CommandsPanel.tsx:164`, `:217-222` |

## 07 · Sugerencias de comandos

| L | Afirmación | Fuente |
| --- | --- | --- |
| 1 | Encendidas por defecto | `src/lib/suggest.ts:810` (`SUGGEST_DEFAULT = true`), `src/lib/settings.ts:135`, `src/components/SettingsModal.tsx:399-400` |
| 2 | SSH, Telnet, Serial y TCP con plataforma detectada o fijada | `src/lib/suggest.ts:805` (`suggestAllowed`), `README.md:37` |
| 3 | Aviso de plataforma una vez por pestaña | `src/components/TerminalView.tsx:457`, `:565` |
| 4 | Texto gris solo para consultas | `src/lib/suggest.ts:498` (`ghostFor`), `README.md:189` |
| 5 | → acepta todo | `src/lib/suggest.ts:866-879` (`suggestKey`), `README.md:92` |
| 6 | Ctrl+→ (Option+→ en macOS) acepta una palabra | `src/lib/suggest.ts:541` (`nextWord`), `README.md:92` |
| 7 | Ctrl+. abre hasta 8; flechas, Enter, Escape | `src/lib/settings.ts:137` (`suggestListKey: "ctrl+period"`), `src/lib/suggest.ts:840-843`, `README.md:37` |
| 8 | En Linux con IBus Ctrl+. abre emojis: usar Alt+/ | `src/components/SettingsModal.tsx:406`, `README.md:37` |
| 9 | Tab siempre va al equipo | `README.md:37`, `README.md:189` |
| 10 | Abreviaturas (`sh ip int br` → `show ip interface brief`); verificado `ghostFor("sh ip int br") = "ief"` en iosxe | `src/lib/suggest.ts:294` (`ABBREV_VENDORS`), auditoría (script sobre `src/lib/suggest.ts` con el catálogo real) |
| 11 | Abreviaturas solo en Cisco, Huawei, Juniper, Fortinet | `src/lib/suggest.ts:294` |
| 12-13 | Sin texto gris en configuración; `sh` = `shutdown` | `src/lib/suggest.ts:77` (`cliMode`), `:109-118` (`suggestQuery`, `configHint`), `README.md:37` |
| 14 | Escapes `do` (Cisco), `run` (Junos) | `src/lib/suggest.ts:118` (texto "escribe «do » antes de una consulta"), `README.md:37` |
| 15 | Sin texto gris si lo escrito ya puede ser riesgoso (`reload`) | `src/lib/suggest.ts:609` (`riskyAsTyped`); verificado `riskyAsTyped("rel") = true` |
| 16 | Riesgosos solo en la lista, con distintivo rojo y confirmación ("Insertar") | `src/components/TerminalView.tsx:1030-1031`, `README.md:189` |
| 17 | Ninguna sugerencia envía Enter | `src/lib/suggest.ts:617` (`safeInsert`), `README.md:189` |
| 18 | Aceptados, ejecutados y favoritos suben; historial local con plantillas; "Borrar historial de sugerencias" | `src/lib/suggest.ts:631-632`, `:766-792`, `src/components/SettingsModal.tsx:769`, `README.md:37` |
| 19 | No funciona en la terminal local | `src/lib/suggest.ts:805` |

Desempate verificado en la auditoría: `lookup("sh run")` devuelve primero `show running-config` y luego `show running-config interface {{interfaz}}`; `lookup("sh int")` deja `show interfaces status` en la tercera posición (índice 2).

## 08 · Notas, plantillas y envío a varias sesiones

| L | Afirmación | Fuente |
| --- | --- | --- |
| 1 | ⌘J abre Notas; autoguardado | `src/lib/platform.ts:79-80` (`j`), `README.md:48` |
| 2 | ⌘Enter / Ctrl+Enter envía línea o selección; Todo (⌘⇧Enter) | `src/components/NotesPanel.tsx:610`, `:627`, `README.md:80` |
| 3 | Variables `{{...}}`: diálogo "Completar plantilla" | `src/components/TemplateDialog.tsx:75` |
| 4 | Se recuerdan salvo secretos (pass, enable, comunidad, tacacs…), que se piden ocultos | `src/lib/templateSecrets.ts:1-14`, `src/components/TemplateDialog.tsx:37`, `:48`, `:55`, `:76`, `:87` |
| 5 | Resumen antes de enviar varias líneas o un cambio | `src/App.tsx:727`, `src/lib/settings.ts:145` (`confirmSend: true`) |
| 6 | Nota protegida, cifrada, bloqueo por inactividad | `README.md:49`, `src/components/NotesPanel.tsx:203`, `:459` |
| 7 | Destinos: pestañas elegidas, una carpeta, paneles visibles | `src/components/BroadcastTarget.tsx`, `README.md:42` |
| 8 | Lista de equipos, omitidos, riesgo por línea; confirmar con la cantidad de equipos | `src/components/BroadcastDialog.tsx:81`, `:99`, `:130` |
| 9 | Secuencial y con "Detener" | `src/components/BroadcastDialog.tsx:191`, `README.md:42` |

## 09 · Logs, alertas, historial y búsqueda

| L | Afirmación | Fuente |
| --- | --- | --- |
| 1 | Botón Log / Grabando; texto plano; continúa al reconectar | `src/components/StatusBar.tsx:124-128`, `README.md:50` |
| 2 | Grabación automática, hora por línea, nombre, rotación diaria | `src/components/SettingsModal.tsx:455-472`, `src/lib/settings.ts:171-173` |
| 3 | Ocultar secretos activado por defecto | `src/lib/settings.ts:174` (`logMask: true`), `src/components/SettingsModal.tsx:475` |
| 4 | Reglas por texto o regex, todas o una carpeta | `src/components/AlertSettings.tsx:83-125`, `src/lib/alerts.ts:38` (ejemplo "Interfaz cambió de estado") |
| 5 | Aviso, marca en pestaña; nunca envían comandos | `src/lib/alerts.ts:9`, `README.md:43` |
| 6 | Historial de comandos enviados (Notas, catálogo, botones), no teclas | `src/components/HistoryMenu.tsx:19`, `:56`, `:66`, `README.md:47` |
| 7 | ⌘F busca en la salida | `src/lib/platform.ts:93-94` (`f`), `README.md:87` |

## 10 · Apariencia y Ajustes

| L | Afirmación | Fuente |
| --- | --- | --- |
| 1 | ⌘, y Ctrl+, (sin Shift) | `src/lib/platform.ts:52` (`key === ","`), `README.md:76` |
| 2 | Interfaz Sistema, Claro, Oscuro | `src/lib/settings.ts:122` (`appTheme: "system"`), `README.md:69` |
| 3 | Automático + 17 temas | `src/components/SettingsModal.tsx:267`, `src/lib/theme.ts` (17 `name:`), `README.md:69` |
| 4 | Fuente, tamaño, interlineado y cursor; Resaltado por fabricante | `src/lib/settings.ts:125-129`, `src/components/HighlightSettings.tsx:108`, `README.md:70` |
| 5 | Buscador de ajustes; Módulos ocultan herramientas sin perder configuración | `src/components/SettingsModal.tsx:196-197`, `:353` |
| 6 | Cambios al instante; "Restablecer valores" pide confirmación | `src/components/SettingsModal.tsx:529`, `:105-106`, `:527-534` ("¿Restablecer todos los ajustes?") |

## 11 · Cierre

| L | Afirmación | Fuente |
| --- | --- | --- |
| 2 | Atajos en el `title` de cada botón | `src/components/Sidebar.tsx:393-397` |
| 3 | Video 2 (herramientas) y video 3 (automatización) | `scripts/video/v2/v2-herramientas/`, `scripts/video/v2/v3-automatizacion/` |
