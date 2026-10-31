# Storyboard · Video 1: Primeros pasos y uso diario

Etapa de escritura. No se renderiza nada todavía. Este documento define, por capítulo y por frase del guion, qué se hace en pantalla y en qué escena del demo. Las fuentes de cada afirmación están en `fuentes.md`. Auditado sobre v0.9.7 (`146aaa6`): ver `scripts/video/v2/AUDITORIA-GUIONES.md`.

## Resumen

| # | Capítulo | Archivo de guion | Palabras | Narración (152 ppm medidos) |
| --- | --- | --- | --- | --- |
| 1 | Qué es NetTerminal e instalación | `guion/01-que-es-e-instalacion.txt` | 146 | 0:58 |
| 2 | Sesiones y carpetas | `guion/02-sesiones-y-carpetas.txt` | 160 | 1:03 |
| 3 | Conexión rápida | `guion/03-conexion-rapida.txt` | 95 | 0:38 |
| 4 | SSH, Telnet y Serial | `guion/04-ssh-telnet-serial.txt` | 210 | 1:23 |
| 5 | Pestañas y vista dividida | `guion/05-pestanas.txt` | 123 | 0:49 |
| 6 | Catálogo de comandos | `guion/06-catalogo.txt` | 118 | 0:47 |
| 7 | Sugerencias de comandos | `guion/07-sugerencias.txt` | 302 | 1:59 (295 palabras medidas con Kokoro: 1:56) |
| 8 | Notas, plantillas y envío a varias sesiones | `guion/08-notas-y-difusion.txt` | 158 | 1:02 |
| 9 | Logs, alertas, historial y búsqueda | `guion/09-logs-alertas-historial.txt` | 109 | 0:43 |
| 10 | Apariencia y Ajustes | `guion/10-apariencia-y-ajustes.txt` | 92 | 0:36 |
| 11 | Cierre | `guion/11-cierre.txt` | 47 | 0:19 |
| | **Total** | | **1.560** | **10:16 de voz; unos 10:40 con tarjetas de capítulo** |

**Velocidad real.** El capítulo 7 (295 palabras) sintetizado con Kokoro (`ef_dora`, velocidad 1.0, pausas de `tts_kokoro.py`) dura 116,4 s: 152 palabras por minuto con pausas incluidas. Las acciones de cada frase corren **mientras** suena la frase (paso `@` con tiempos relativos), no después; pausa extra entre frases solo donde se indica "respiro".

**Cambio de orden respecto del pedido.** El catálogo (capítulo 6) va antes de las sugerencias (capítulo 7): las sugerencias solo funcionan con la plataforma detectada o fijada en el catálogo (`src/lib/suggest.ts:805`), y el aviso de plataforma remite a "Comandos (⌘L) › Detectar" (`src/components/TerminalView.tsx:565`). Contraseñas guardadas quedan dentro del capítulo 4.

## Convenciones

- **Escena**: `scripts/screenshots/demo.html?scene=<nombre>&theme=light&video=1` más los parámetros indicados. `video=1` activa eco, respuestas y guardado de sesiones en el mock (`scripts/screenshots/mock.js:841`).
- **Prep**: pasos que se ejecutan antes de grabar la toma (no se ven).
- **Pasos**: vocabulario de `scripts/video/storyboard.mjs`: `click`, `dbl`, `right`, `hover`, `field`, `type`, `key`, `hl`, `zoom`, `unzoom`, `set`, `scroll`, `wait`, `@`, `js`. Selectores: `title:`, `text:`, `has:`, `ph:`, `css:`.
- **Callout**: rótulo superpuesto con flecha hacia el elemento. **Rótulo inferior**: texto fijo abajo. **Lámina**: pantalla completa fuera de la app (`scripts/video/plugins/escenario.html`, tipos `portada`, `capitulo`, `lista`, `columnas`, `tabla`, `flujo`, `codigo`).
- **Atajos en pantalla**: la grabación es en macOS. Cada atajo se muestra con los dos sistemas: `⌘N · Ctrl+Shift+N`. En la narración se dice "Comando" y la regla "Comando = Control Shift" se enuncia una vez en el capítulo 2.
- **[MOCK+n]**: la toma necesita la extensión n del mock (lista al final). **[REC+n]**: necesita la extensión n del grabador.
- **Placeholder de Host**: desde v0.9.7 la app ya muestra `192.0.2.10 o hostname` (`src/components/SessionModal.tsx:190`, `src/components/QuickConnectDialog.tsx:134`). Los selectores usan `ph:192.0.2.10 o hostname`. Ojo: el placeholder del destino de túnel también es `192.0.2.10` (`SessionModal.tsx:689`); en la toma 4a usar `css:` para distinguirlos.
- **Datos**: solo IPs 192.0.2.x, 198.51.100.x y 203.0.113.x, y nombres ficticios del mock (`mock.js:17-28`). Secretos solo de demo (`demo-clave-2026`).

### Escenas existentes en `scripts/screenshots/mock.js`

Escenas (`?scene=`): `terminal`, `notes`, `monitor`, `topology`, `compare`, `subnet`, `speed`, `oscmds`, `about`, `settings`, `logs`, `quick`, `quickserial`, `quicktab`, `packs`, `split`, `backup`, `legacy`, `credentials`, `alerts`, `import`, `vertical`, `secure-note`, `snmp`, `snmpgen`, `transfer`, `empty`, `palette`, `palette-q`, `ctxmenu`, `filter`, `filter-none`, `quicktabs`, `quick-active`, `lock-note`, `find`, `paste`, `toasts`, `bcastbar`, `macros`, `broadcast`, `s-appearance`, `s-terminal`, `s-highlight`, `s-logs`, `s-credentials`, `s-sessions`, `s-modules`, `s-alerts`, `s-ai`, `s-about`, `s-search`, `s-vault`, `session-new`, `session-edit`, `quick-telnet`, `confirm`, `approval`, `macro`, `cmd-editor`, `session-full`, `s-alerts-edit`, `bc-dialog`, `closeall-setup`, `closeall`, `closeall-menu`, `closeall-palette`, `t-monitor`, `t-diag`, `t-topology`, `topology-sources`, `topology-sources-off`, `topology-ospf`, `topology-manual`, `topology-mac`, `topology-snmp`, `topology-traffic`, `t-subnet`, `t-perf`, `t-transfer`, `t-syslog`, `t-backup`, `t-plugins`, `suggest`, `suggest-config`.

Parámetros: `theme=light|dark`, `video=1`, `update=1`, `autolegacy=1`, `noplatform=1`, `layout=vertical`, `collapsed=1`, `toast=1`, `alert`, `term=<tema>`, `logsdir=1`, `vault=portable`, `big=N`, `noend`.

Escenas usadas en este video: `empty`, `s-about`, `session-edit`, `legacy`, `s-terminal`, `credentials`, `suggest`, `suggest-config`, `s-appearance`. Las demás tomas parten de `empty` con prep. Las escenas `quick` y `quicktab` del mock están rotas (buscan el placeholder viejo `10.0.0.1 o hostname`, `mock.js:1043`, `:1064`, `:1067`); este video no las usa, pero conviene corregirlas [MOCK+1].

---

## Capítulo 1 · Qué es NetTerminal e instalación (0:58)

Tarjeta de capítulo: "1 · Qué es NetTerminal e instalación". Subtítulo: "Cliente SSH, Telnet, Serial y terminal local".

**Toma 1a** · escena `empty&theme=light&video=1`

| Línea | Narración (inicio) | Pasos | Overlay |
| --- | --- | --- | --- |
| L1 | NetTerminal es un cliente… | `zoom text:SSH, Telnet y Serial sin complicaciones. 1.35` | Título: "Video 1 · Primeros pasos y uso diario" |
| L2 | Reúne SSH, Telnet, Serial… | `unzoom`; `hl css:aside` → `@1800 hl css:main div.h-10.bg-chrome` → `@3200 hl css:main div.h-6.border-t` | Chips: "macOS · Windows · Linux" |
| L3 | Todo lo que verás usa datos ficticios. | sin acción | Rótulo inferior: "Datos ficticios · IPs de documentación (RFC 5737)" |

**Toma 1b** · lámina "Descargas" [REC+1]

| Línea | Pasos | Lámina |
| --- | --- | --- |
| L4 | Aparición secuencial de filas | Tabla: macOS `.dmg` · Windows `-setup.exe` (por usuario) · Linux `.AppImage` o `.deb` · Portable `NetTerminal-portable.zip` |
| L5 | Árbol de carpeta animado | `NetTerminal/` → `NetTerminal.exe` · `NetTerminal.app` · `NetTerminal.AppImage` · `portable` · `data/` (`README.md:112-119`). Rótulo: "Sin administrador: instalador de Windows por usuario, AppImage y portable" |

**Toma 1c** · escena `empty&theme=light&video=1&update=1` [MOCK+2]
Prep: `dbl text:core-sw01`, `dbl text:ar-wan01`, `wait 800`, `click title:Ajustes`, `click text:Acerca de`.

| Línea | Pasos | Overlay |
| --- | --- | --- |
| L6 | `hl has:Versión 0.9.6`; `@1500 hl text:Buscar ahora`; `click text:Buscar ahora`; `wait 600`; `hl has:Hay una versión nueva` | Callout en "Buscar ahora": "Al abrir y cada 6 horas" |
| L7 | `key Escape`; `hl has:Nueva versión`; `click text:Ver novedades`; `zoom has:Nueva versión 1.4`; `@3000 unzoom`; `click text:Actualizar y reiniciar` → diálogo "¿Actualizar y reiniciar?" ("Se cerrarán 2 sesiones abiertas…"); `hl css:[role=alertdialog]`; `@5500 click css:[role=alertdialog] button:last-child`; `wait 800`; `hl has:Descargando…` | Callout: "Verifica la firma antes de instalar" |
| L8 | `hl title:Omitir esta versión` (solo resaltar) | Rótulo inferior: "Portable y .deb: el aviso ofrece Descargar; se actualiza a mano". Variante opcional [MOCK+3] con el aviso "Descargar" real |

Nota: con dos sesiones conectadas el diálogo dice "Se cerrarán 2 sesiones abiertas"; por eso el prep abre dos.

---

## Capítulo 2 · Sesiones y carpetas (1:03)

Tarjeta: "2 · Sesiones y carpetas". Subtítulo: "Crear, ordenar, filtrar e importar".

**Toma 2a** · escena `empty&theme=light&video=1`

| Línea | Pasos | Overlay |
| --- | --- | --- |
| L1 | `hl css:aside nav`; `hover text:Sitio Central`; `@1600 hover text:Core` | |
| L2 | sin acción | Rótulo inferior grande: "⌘ (Comando) en macOS = Ctrl+Shift en Windows y Linux" |
| L3 | `hl title:Nueva sesión (⌘N)`; `click title:Nueva sesión (⌘N)`; `wait 400`; `hl css:form .grid-cols-5` (SSH, Telnet, Serial, TCP, Local) | Atajo: `⌘N · Ctrl+Shift+N` |
| L4 | `field ph:Router core sw-acceso-centro`; `field ph:Raíz · usa / para subcarpetas Sucursales/Centro`; `zoom ph:Raíz · usa / para subcarpetas 1.4` | |
| L5 | `unzoom`; `field css:form input[placeholder="192.0.2.10 o hostname"] 203.0.113.60`; `field ph:Según ~/.ssh/config admin`; `click text:Guardar`; `wait 500`; `hl text:sw-acceso-centro` | |
| L6 | `dbl text:core-sw01`; `wait 900`; `hl title:Pestaña abierta` | Callout en el punto: "Conectada" |
| L7 | `right text:core-sw02`; `wait 1200`; `click text:Duplicar`; `wait 500`; `hl text:core-sw02 (copia)` | Callout: "La copia no incluye la contraseña guardada" |
| L8 | `right text:Core`; `wait 2400` (menú: Conectar todas (2), Nueva sesión aquí, Nueva subcarpeta, Renombrar, Eliminar carpeta); `key Escape`; `js` arrastrar `core-sw02 (copia)` sobre `Laboratorio` [REC+2]; `hl text:Laboratorio` | |
| L9 | `field ph:Filtrar… 198.51.100`; `wait 1500` (quedan ar-wan01 y fw-perimetro); `set ph:Filtrar… ""` | Callout: "Nombre, IP, usuario o carpeta" |
| L10 | `click title:Ajustes`; `click text:Importar y exportar`; `click text:Desde archivo…`; `hl has:Solo se importan datos de conexión` | |
| L11 | `click text:Leer ~/.ssh/config` [MOCK+4]; `wait 700`; `hl has:OpenSSH · 2 sesiones`; `click has:1 aviso`; `wait 400`; `hl has:los túneles no se importan`; `click text:Cancelar` | |

---

## Capítulo 3 · Conexión rápida (0:38)

Tarjeta: "3 · Conexión rápida". Subtítulo: "Conectar sin guardar la sesión".

**Toma 3a** · escena `empty&theme=light&video=1`

| Línea | Pasos | Overlay |
| --- | --- | --- |
| L1 | `hl has:Conexión rápida sin guardar` (pantalla de inicio) | |
| L2 | `hl title:Conexión rápida sin guardar (⌘O)` (rayo del panel); `click` sobre él; `wait 400` | Atajo: `⌘O · Ctrl+Shift+O` |
| L3 | `click text:Telnet`; `@900 click text:TCP` (puerto pasa a 2001); `zoom has:TCP crudo: sin negociación Telnet 1.3`; `@2400 unzoom`; `click text:Serial`; `@3200 click text:SSH` | Callout en TCP: "Sin negociación Telnet" |
| L4 | `field ph:192.0.2.10 o hostname 192.0.2.77`; `field ph:Según ~/.ssh/config admin`; `click text:Conectar`; `wait 700`; `hl has:192.0.2.77` (pestaña con rayo) | |
| L5 | `hl has:Guardar como sesión…` (barra de estado); `@1500 right has:192.0.2.77`; `hl text:Guardar como sesión…`; `click text:Guardar como sesión…`; `zoom has:Guardar como sesión 1.3` (título del diálogo, `src/App.tsx:1285`); `unzoom`; `field ph:Router core sw-bodega`; `field ph:Raíz · usa / para subcarpetas Laboratorio`; `click text:Guardar`; `wait 500`; `hl text:sw-bodega` | Callout: "Misma pestaña, sin reconectar" |
| L6 | `key cmd+k`; `wait 400`; `hl has:Conexiones rápidas recientes`; `type admin@192.0.2.88`; `wait 900`; `key Escape` | Atajo: `⌘K · Ctrl+Shift+K` |

---

## Capítulo 4 · SSH, Telnet y Serial (1:23)

Tarjeta: "4 · SSH, Telnet y Serial". Subtítulo: "Jump host, túneles, equipos antiguos y contraseñas".

**Toma 4a** · escena `session-edit&theme=light&video=1` (abre "Editar sesión" de core-sw01)

| Línea | Pasos | Overlay |
| --- | --- | --- |
| L1 | `hl has:Usa OpenSSH del sistema` | |
| L2 | `field ph:~/.ssh/id_ed25519 ~/.ssh/id_ed25519_lab`; `field ph:usuario@bastion:22 admin@198.51.100.5:22`; `zoom ph:usuario@bastion:22 1.3` | Callout: "Jump host = equipo intermedio (bastión)" |
| L3 | `unzoom`; `click has:Túneles SSH`; `click text:Agregar túnel`; `field ph:1080 8443`; `field css:[title="Host de destino"] 192.0.2.20`; `field ph:443 443`; `hl ph:127.0.0.1` | Callout en la dirección de escucha: "Vacío = 127.0.0.1" |
| L4 | `click title:Cerrar`; `click title:Nueva sesión (⌘N)`; `click text:Serial`; `hl has:Velocidad`; `@1500 hl has:Paridad`; `@2500 hl has:Flujo`; `click title:Cerrar` | |

**Toma 4b** · escena `legacy&theme=light&video=1` (abre router-antiguo, 192.0.2.99)

| Línea | Pasos | Overlay |
| --- | --- | --- |
| L5 | `wait 600`; `zoom has:Unable to negotiate 1.5` | Texto en terminal (mock): "Unable to negotiate with 192.0.2.99 port 22: no matching host key type found. Their offer: ssh-rsa" |
| L6 | `hl has:Presiona L`; `@2200 type L`; `wait 900`; `unzoom`; `hl has:Compatibilidad con equipos antiguos activada` | Tecla en pantalla: "L" |
| L7 | `hover text:router-antiguo`; `click title:Editar`; `hl has:Permitir algoritmos legacy`; `click title:Cerrar`; `key cmd+,`; `click text:Terminal`; `hl has:Activar algoritmos legacy automáticamente`; `key Escape` | |
| L8 | sin acción | Rótulo inferior en rojo: "Algoritmos débiles: solo redes de gestión confiables" |

**Toma 4c** · escena `empty&theme=light&video=1` [MOCK+5]
Prep: ninguna. sw-acceso-norte (Telnet, 203.0.113.20) ya tiene contraseña guardada en el mock (`mock.js:34`).

| Línea | Pasos | Overlay |
| --- | --- | --- |
| L9 | `hover text:sw-acceso-norte`; `click title:Editar`; `hl has:Guardar contraseña`; `@2000 hl has:Guardada`; `hl text:Cambiar`; `hl text:Borrar` | Callout: "Solo escritura: nunca se muestra" |
| L10 | `click title:Cerrar`; `dbl text:sw-acceso-norte`; `wait 1500` (Username/Password completados por el mock); `hl title:Contraseña guardada: se completa sola en el primer pedido de contraseña al conectar` | Rótulo: "Simulación del autocompletado" |
| L11 | sin acción | Lista en pantalla: "No se completa: contraseña rechazada · passphrase de llave · bastión del jump host · segundo pedido" |
| L12 | `click title:Ajustes`; `click text:Credenciales`; `hl has:Bóveda cifrada` | Rótulo: "Para SSH: llaves y agente" |

---

## Capítulo 5 · Pestañas y vista dividida (0:49)

Tarjeta: "5 · Pestañas y vista dividida". Subtítulo: "Renombrar, dividir y cerrar con control".

**Toma 5a** · escena `empty&theme=light&video=1`
Prep: conexión rápida a 192.0.2.77 (rayo, host `192.0.2.77`, Conectar), luego `dbl` core-sw01, ar-wan01, dist-sw01, fw-perimetro; `wait 800`; clic en la pestaña core-sw01.

| Línea | Pasos | Overlay |
| --- | --- | --- |
| L1 | `click has:ar-wan01` (pestaña); `@900 click has:dist-sw01`; `@1800 click has:core-sw01`; `hl css:main div.h-10.bg-chrome` | |
| L2 | `dbl has:ar-wan01`; `type WAN principal\n`; `js window.__ntMockAsync()`; `wait 400`; `hl title:Salida nueva` | Callout: "Salida nueva en segundo plano" |
| L3 | `right has:core-sw01`; `hl text:Duplicar`; `@900 hl text:Reconectar`; `@1700 hl text:Desconectar`; `@2500 hl text:Copiar toda la salida` | |
| L4 | `click text:Pestañas verticales`; `wait 500`; `click title:Plegar pestañas a iconos`; `@1500 click title:Expandir pestañas`; `right has:core-sw01`; `click text:Pestañas horizontales` | Callout en el borde: "Arrastra para cambiar el ancho" |
| L5 | `click title:Vista dividida: ver 2 o 4 pestañas a la vez`; `click text:4 en cuadrícula (2x2)`; `wait 500`; `hl title:Pestaña del panel 1` (selector); `@2600` clic en el icono de vista dividida y `click text:Vista única` | |
| L6 | `right has:dist-sw01`; `hl text:Cerrar las demás`; `@900 hl text:Cerrar las de la derecha`; `@1800 hl text:Cerrar todas las pestañas`; `click text:Cerrar todas las pestañas` | |
| L7 | `zoom css:[role=alertdialog] 1.3`; `hl has:Se cortan`; `@1800 hl has:conexión rápida`; `@2800 hl text:Cancelar`; `key Escape`; `unzoom` | Callout: "El foco parte en Cancelar" |
| L8 | `key cmd+shift+w`; `wait 700`; `key Escape` | Atajo: `⌘⇧W · Ctrl+Shift+Alt+W` |

---

## Capítulo 6 · Catálogo de comandos (0:47)

Tarjeta: "6 · Catálogo de comandos". Subtítulo: "1.776 comandos con fuente y riesgo".

**Toma 6a** · escena `suggest&noplatform=1&theme=light&video=1` (core-sw01 abierta, plataforma sin detectar)

| Línea | Pasos | Overlay |
| --- | --- | --- |
| L1 | `key cmd+l`; `wait 500`; `zoom css:aside[style] header 1.3` | Atajo: `⌘L · Ctrl+Shift+L` |
| L2 | `unzoom`; `hl title:Catálogo` (select `aria-label="Catálogo"`) | Lámina lateral: "Equipos de red: Cisco · Juniper · Fortinet · Huawei · Check Point · WatchGuard / Sistemas operativos: Windows · macOS · Linux" |
| L3 | `hl text:Detectar`; `click text:Detectar`; `wait 900`; `hl has:Plataforma detectada` (aviso "Plataforma detectada: IOS-XE (16.x/17.x)") | Callout: "Ejecuta show version" |
| L4 | `hl title:La sintaxis y los comandos se ajustan a la plataforma` | |
| L5 | `field ph:Buscar comando o tarea (ej: vecinos, óptico, CPU) vecinos`; `wait 600` | |
| L6 | `set ph:Buscar comando o tarea (ej: vecinos, óptico, CPU) clear`; `wait 500`; `hl has:Cambia config/estado`; `@1600 hl has:Puede cortar servicio` | Leyenda: "Consulta · Cambia config/estado · Puede cortar servicio" |
| L7 | `set ph:Buscar… vecinos`; `hover has:show cdp neighbors`; `hl text:Ejecutar`; `@1300 hl text:Escribir`; `click text:Ejecutar` (consulta: se ejecuta sin diálogo) | |
| L8 | `click title:Agregar a favoritos`; `@1200 click text:Favoritos`; `@2200 hl title:Agregar un comando propio`; `@3200 hl title:Packs de comandos`; `key cmd+l` (cierra) | |

---

## Capítulo 7 · Sugerencias de comandos (1:56)

Tarjeta: "7 · Sugerencias de comandos". Subtítulo: "Autocompletado seguro para la CLI".

Requisitos de toda la toma: [REC+3] (teclas `ArrowRight`, `ArrowLeft` y `.`), zoom de cámara sobre la línea del cursor (escala 1.6 a 1.8), ritmo de tipeo lento (`type` con 110 ms) para que se vea el texto gris aparecer. Los índices de la lista fueron verificados contra el catálogo real de v0.9.7 (`lookup()` de `src/lib/suggest.ts`, ver `fuentes.md`).

**Toma 7a** · escena `suggest&noplatform=1&theme=light&video=1`

| Línea | Pasos | Overlay |
| --- | --- | --- |
| L1 | `key cmd+,`; `click text:Terminal`; `zoom has:Sugerencias de comandos 1.4`; `hl has:Sugerencias de comandos`; `key Escape`; `unzoom` | Rótulo: "Encendidas por defecto" |
| L2 | sin acción | Chips: "SSH · Telnet · Serial · TCP" y "Plataforma detectada o fijada" |
| L3 | `click css:.xterm`; `type sh`; `wait 300`; `zoom has:Detecta la plataforma 1.5` (aviso "Detecta la plataforma para activar sugerencias: Comandos (⌘L) › Detectar"); `unzoom`; `key cmd+l`; `click text:Detectar`; `wait 900`; `key cmd+l`; `click css:.xterm`; `key Backspace` ×2 | Callout: "Una vez por pestaña" |

**Toma 7b** · misma página (plataforma ya detectada). Cámara fija sobre la terminal (zoom 1.6 a la línea del prompt).

| Línea | Pasos | Lo que se ve |
| --- | --- | --- |
| L4 | `type sh ver` | En gris: `sion` |
| L5 | `key ArrowRight`; `wait 400`; `key Enter` | Línea `sh version`; respuesta "Cisco IOS XE Software, Version 17.12.04". Tecla en pantalla: "→" |
| L6 | `type sh vl`; `wait 500` (gris: `an brief`); `key ctrl+ArrowRight` → `sh vlan `; `wait 700`; `key ctrl+ArrowRight` → `sh vlan brief`; `key Enter` [MOCK+6] | Tecla en pantalla: "Ctrl+→ · Option+→". Nota: `sh ip` no sirve para esta demo (su texto gris es ` arp`) ni `sh ip int` (se detiene en la variable `{{interfaz}}`) |
| L7 | `type sh int`; `key ctrl+.`; `wait 600` (lista: show interfaces {{interfaz}}, show interfaces trunk, show interfaces status, …); `key ArrowDown` ×2; `key Enter` → `sh interfaces status`; `key Enter`; luego `type sh`, `key ctrl+.`, `key Escape`, `key Backspace` ×2 | Callout en el pie de la lista: "↑↓ elegir · Enter escribe sin ejecutar · Esc cerrar". Tecla: "Ctrl+." |
| L8 | sin acción en la app | Lámina lateral: "Linux con IBus: Ctrl+. abre emojis → Ajustes › Terminal › Tecla para abrir la lista: Alt+/" |
| L9 | `type sh clo`; `key Tab` [MOCK+7]; `wait 300`; `key Enter` | El equipo completa `clock`. Callout: "Tab va al equipo" |
| L10 | `type sh ip int br` (lento); `wait 600`; `key ArrowRight`; `key Enter` | En gris: `ief`. Rótulo grande: "sh ip int br = show ip interface brief" |
| L11 | `click has:ar-wan01` (pestaña) [MOCK+8]; `type dis int br`; `wait 600`; `key Backspace` ×10; `click has:core-sw01` | En gris: `ief`. Chips: "Cisco · Huawei · Juniper · Fortinet" |

**Toma 7c** · escena `suggest-config&theme=light&video=1` (core-sw01 en `core-sw01(config-if)#`, plataforma IOS-XE)

| Línea | Pasos | Lo que se ve |
| --- | --- | --- |
| L12 | `click css:.xterm`; `type sh`; `wait 800` | Sin texto gris. `hl` del prompt `(config-if)#` |
| L13 | `key ctrl+.`; `wait 400` | Aviso: "Modo configuración: escribe «do » antes de una consulta para ver sugerencias". Rótulo: "En (config-if)#, sh = shutdown" |
| L14 | `key Backspace` ×2; `type do sh ip int br`; `wait 500`; `key ArrowRight`; `key Enter` [MOCK+9]; `type end\n` | En gris: `ief`; respuesta de `show ip interface brief`; el prompt sigue en `(config-if)#` hasta `end`. Lámina lateral: "Cisco: do · Junos: run · Huawei: display completo · ASA: show completo" |
| L15 | `type rel`; `wait 900`; `key Backspace` ×3 | Sin texto gris. Callout: "reload: puede cortar servicio" |
| L16 | `type clear cou`; `key ctrl+.`; `wait 600`; `zoom has:Cambia config/estado 1.6`; `unzoom`; `key Enter`; `wait 400`; `zoom css:[role=alertdialog] 1.3`; `click text:Insertar`; `unzoom`; `wait 1200`; `key Backspace` ×15 | Lista con `clear counters {{interfaz}}` y distintivo rojo; diálogo "Cambia config/estado en core-sw01. Se escribe en la línea sin ejecutarlo (sin Enter): clear counters", botón "Insertar"; la línea queda `clear counters ` sin ejecutar |
| L17 | `type sh run`; `key ctrl+.`; `key ArrowDown` ×1 (segundo ítem: `show running-config interface {{interfaz}}`); `key Enter`; `type Gi1/0/1`; `key Enter` [MOCK+10] | Se inserta `sh running-config interface ` y se detiene en la variable. Rótulo: "Sin Enter: tú decides" |
| L18 | `type sh int`; `key ctrl+.`; `wait 900`; `hl` primer ítem (`show interfaces status`, por el uso de L7); `key Escape`; `key Backspace` ×6; `key cmd+,`; `click text:Terminal`; `@3500 click text:Borrar historial de sugerencias`; `hl text:Historial borrado`; `key Escape` | Lámina lateral: "Se guarda: show interfaces status (plantilla del catálogo) · No se guarda: argumentos, equipos ni secretos" |
| L19 | `dbl text:Shell local`; `type sh`; `wait 900` | Sin texto gris ni aviso. Callout: "Terminal local: sin sugerencias" |

---

## Capítulo 8 · Notas, plantillas y envío a varias sesiones (1:02)

Tarjeta: "8 · Notas y envío a varias sesiones". Subtítulo: "Plantillas con variables y control de riesgo".

**Toma 8a** · escena `empty&theme=light&video=1` [MOCK+11]
Prep: `dbl` core-sw01 y core-sw02; clic en la pestaña core-sw01.

| Línea | Pasos | Overlay |
| --- | --- | --- |
| L1 | `key cmd+j`; `wait 500`; elegir la nota `consultas-diarias.txt` en el selector | Atajo: `⌘J · Ctrl+Shift+J` |
| L2 | clic en la línea 2 (`show ip interface brief`); `key cmd+Enter`; `wait 700`; `hl text:Todo` | Atajo: `⌘Enter · Ctrl+Enter`. Excepción a la regla "⌘ = Ctrl+Shift": en Windows y Linux, Ctrl+Shift+Enter envía Todo (`NotesPanel.tsx:610`) |
| L3 | elegir `plantilla-vlan.txt`; `hl` de `{{vlan}}`; `click text:Todo`; `wait 400` (diálogo "Completar plantilla"); `field` vlan `30`, nombre `CAMARAS`, interfaz `GigabitEthernet1/0/7`, descripcion `CAMARA PISO 2` | |
| L4 | `hl has:Los valores se recuerdan`; `click text:Continuar` | Opcional [MOCK+12]: `usuario-local.txt` con `{{clave}}` y `{{enable}}` en campos ocultos (`src/lib/templateSecrets.ts`) |
| L5 | `hl css:[role=alertdialog]` ("¿Enviar 13 líneas a core-sw01?", "Cambia config/estado."); `@2200 click text:Cancelar` | Rótulo: "En el ejemplo cancelamos" |
| L6 | elegir `accesos-sitio-central` → pantalla "Nota protegida con contraseña"; `field ph:Contraseña de la nota demo-clave-2026` + Enter; `click title:Protección de la nota`; `hl has:Bloqueo por inactividad`; `click title:Bloquear nota` | Callout: "5 min por defecto" |
| L7 | `click title:Elegir a qué sesiones se envía`; `click text:Pestañas elegidas`; marcar core-sw01 y core-sw02; cerrar el selector | |
| L8 | elegir `cambio-descripcion.txt`; `click text:Todo`; `wait 500`; `hl has:Destinos, en este orden`; `@1500 hl has:Texto completo`; `field css:[role=alertdialog] input[inputmode=numeric] 2`; `hl has:Enviar a 2 equipos`; `click has:Enviar a 2 equipos` | Callout: "Escribe la cantidad de equipos" |
| L9 | `wait 600`; `click text:Ver detalle`; `hl text:Detener`; `@2000 click text:Detener` | |

---

## Capítulo 9 · Logs, alertas, historial y búsqueda (0:43)

Tarjeta: "9 · Logs, alertas, historial y búsqueda".

**Toma 9a** · escena `empty&theme=light&video=1` [MOCK+13]
Prep: `dbl` core-sw01 y ar-wan01; clic en la pestaña core-sw01.

| Línea | Pasos | Overlay |
| --- | --- | --- |
| L1 | `hl title:Grabar la sesión en un archivo de texto`; `click` sobre él; `wait 400`; `hl has:Grabando` | Callout con la ruta: `~/NetTerminal/data/logs/core-sw01_20261021-101500.log` |
| L2 | `key cmd+,`; `click text:Logs`; `hl has:Grabar logs automáticamente`; `@1200 hl has:Hora en cada línea del log`; `@2400 hl has:Nombre del archivo`; `@3600 hl has:Rotación diaria` | |
| L3 | `hl has:Ocultar secretos en los logs` | |
| L4 | `click text:Alertas`; `hl has:Interfaz cambió de estado`; `click text:Nueva alerta`; `hl has:Sesiones`; `@1800 hl has:Expresión regular`; `click text:Cancelar` | Rótulo: "Trae 3 ejemplos, apagados" |
| L5 | `key Escape`; `js` emitir alerta (ver [MOCK+13]); `wait 600`; `hl` del aviso; `hl title:Alerta por palabra clave` | Callout: "Nunca envía comandos" |
| L6 | `click title:Historial de comandos enviados a este equipo`; `hl has:Últimos comandos enviados`; `@2200 key Escape` | |
| L7 | `key cmd+f`; `type UPDOWN\n`; `wait 800`; `key Escape` | Atajo: `⌘F · Ctrl+Shift+F` |

---

## Capítulo 10 · Apariencia y Ajustes (0:36)

Tarjeta: "10 · Apariencia y Ajustes".

**Toma 10a** · escena `s-appearance&theme=light&video=1`
Prep: `dbl text:core-sw01` antes de abrir Ajustes (para ver el tema aplicado detrás).

| Línea | Pasos | Overlay |
| --- | --- | --- |
| L1 | `hl css:aside` (columna de secciones de Ajustes) | Atajo: `⌘, · Ctrl+,` |
| L2 | `click text:Oscuro`; `wait 900`; `click text:Claro` | |
| L3 | `click text:Ámbar`; `@900 click text:Dracula`; `@1800 click text:Tokyo Night`; `@2700 click text:Automático` | Rótulo: "17 temas + Automático" |
| L4 | `hl has:Fuente`; `@700 hl has:Tamaño`; `@1400 hl has:Interlineado`; `@2100 hl has:Cursor`; `@2800 click text:Resaltado`; `hl has:Resaltar salida de la terminal` | |
| L5 | `field css:input[aria-label="Buscar ajuste"] legacy`; `wait 700`; `set` vacío; `click text:Módulos`; `hl css:main .space-y-5` | |
| L6 | `hl text:Los cambios se aplican al instante`; `@1500 click text:Restablecer valores`; `wait 400`; `zoom css:[role=alertdialog] 1.3` ("¿Restablecer todos los ajustes?"); `@3500 click text:Cancelar`; `unzoom` | Callout: "Pide confirmación (v0.9.7)" |

---

## Capítulo 11 · Cierre (0:19)

**Toma 11a** · escena `empty&theme=light&video=1`

| Línea | Pasos | Overlay |
| --- | --- | --- |
| L1 | montaje rápido: `hl css:aside`, `hl has:Conexión rápida sin guardar`, `hl has:Herramientas de red` | |
| L2 | `hover title:Conexión rápida sin guardar (⌘O)` | Callout que replica el tooltip "Conexión rápida sin guardar (⌘O)" [REC+4] |
| L3 | lámina final | "Video 2 · Herramientas de red" y "Video 3 · Automatización" |
| L4 | logo de la pantalla de inicio | |

---

## Extensiones del mock

Se recomienda un archivo propio `scripts/video/v2/v1-primeros-pasos/mock-v1.js` que extienda `window.__mock` (como `scripts/video/plugins/mock-video.js`) y un `demo.html` que lo cargue, para no tocar las capturas. Mantener `confirmClose` en `true` (el de plugins lo apaga y el capítulo 5 necesita el aviso). El reemplazo de placeholder de `mock-video.js:17-20` ya no hace falta: la app muestra `192.0.2.10 o hostname`.

| Id | Estado | Necesidad | Detalle exacto |
| --- | --- | --- | --- |
| MOCK+1 | pendiente (mock.js) | Escenas `quick`/`quicktab` rotas | `mock.js:1043`, `:1064`, `:1067` buscan `input[placeholder="10.0.0.1 o hostname"]`; cambiar a `192.0.2.10 o hostname`. |
| MOCK+2 | pendiente | `update=1` coherente | Hoy `app_version` devuelve `0.9.7` (`mock.js:454`) y con `update=1` el aviso dice `current: "0.9.1"` con notas inventadas (`mock.js:965-972`). Con `update=1`: `app_version` → `"0.9.6"`; `update_check` → `{ current: "0.9.6", latest: "0.9.7", newer: checks++ > 0, supported: true, reason: null }` y `notes` con el resumen de v0.9.7 (`146aaa6`): `"- Contraseña guardada en scripts sin exponerla\n- MD5 automático tras SCP/SFTP\n- SNMP por VLAN y LLDP-V2\n- Arranque robusto"`. |
| MOCK+3 | pendiente (opcional) | Aviso de actualización manual | `update=1&updmanual=1`: `supported: false`, `reason: "En modo portable la actualización es manual: reemplaza los archivos de la carpeta."` (`src-tauri/src/updates.rs:58`). El aviso muestra "Descargar". |
| MOCK+4 | pendiente | Importar desde ssh_config | `import_sessions_file` (`mock.js:513`) debe respetar `format: "openssh"`. Fixture: `{ format: "openssh", sessions: [ { name: "bastion-dc", type: "ssh", host: "198.51.100.5", port: 22, username: "admin", folder: "SSH config" }, { name: "sw-lab-01", type: "ssh", host: "192.0.2.30", port: 22, username: "admin", jump_host: "admin@198.51.100.5:22", folder: "SSH config" } ], warnings: ["sw-lab-01: los túneles no se importan; agrégalos en la sesión si los necesitas"] }`. |
| MOCK+5 | pendiente | Login Telnet simulado con contraseña guardada | Para `sw-acceso-norte` en modo video, `connect` escribe: `"\r\nUser Access Verification\r\n\r\nUsername: admin\r\nPassword: \r\n\r\nsw-acceso-norte#"`. El autocompletado real ocurre en Rust (`src-tauri/src/autofill.rs`); se rotula como simulación. |
| MOCK+6 | pendiente | Respuesta a `show vlan brief` | En `respond` (`mock.js:863`): `/^sh(ow)? vl(an)? br/` → tabla `VLAN Name Status Ports` con VLAN 1, 10 (USUARIOS), 20 (VOZ), 30 (CAMARAS). Solo IPs/nombres ficticios. |
| MOCK+7 | pendiente | Tab del equipo | En `handlers.write` (`mock.js:917`), `"\t"`: completar la última palabra con un diccionario mínimo (`show`, `clock`, `version`, `interfaces`, `ip`, `interface`, `brief`, `running-config`, `vlan`) y hacer eco del resto más un espacio. `sh clo` + Tab → eco `ck `. |
| MOCK+8 | pendiente | Huawei con plataforma | En la escena `suggest`, además `sessions[3].platform = "vrp8"` (ar-wan01). Verificado: `ghostFor("dis int br")` en vrp8 devuelve `ief`. |
| MOCK+9 | pendiente | `do` en configuración | En `respond`, si la conexión está en modo configuración y el comando empieza con `do `, quitar el prefijo, responder la consulta y no cambiar de modo. |
| MOCK+10 | pendiente | `show running-config interface` | Responder `/^sh(ow)? run(ning-config)? int(erface)? (\S+)/` con el bloque de `GigabitEthernet1/0/1` que ya está en `CISCO` (`mock.js:51-63`), con `Building configuration...` y `end`. |
| MOCK+11 | pendiente | Nota de consultas | `notes["consultas-diarias.txt"] = "show clock\nshow ip interface brief\nshow cdp neighbors"`. |
| MOCK+12 | pendiente (opcional) | Variables secretas | `notes["usuario-local.txt"] = "! Usuario local de emergencia (datos ficticios)\nusername {{usuario}} privilege 15 secret {{clave}}\nenable secret {{enable}}\nend"`. `clave` y `enable` coinciden con `src/lib/templateSecrets.ts` y se piden ocultas. |
| MOCK+13 | pendiente | Alerta a demanda | Parámetro `alertrule=1` que instale la regla `qa-updown` activa (como `toast=1`, `mock.js:177-184`) sin dispararla sola. En la toma: `window.__mock.emit("alert-hit", { conn: [...window.__mock.channels.keys()][0], rule: "qa-updown", line: "%LINK-3-UPDOWN: Interface GigabitEthernet1/0/3, changed state to down" })`. |
| MOCK+14 | pendiente (mock.js) | IP fuera del rango de documentación | `local_ips` devuelve `bridge100 = 192.168.64.1` (`mock.js:540`): reemplazar por `203.0.113.254`. Compartido con el video 2. |

## Extensiones del grabador

| Id | Necesidad | Detalle |
| --- | --- | --- |
| REC+1 | Láminas | Capítulos 1, 6, 7 y 11 usan láminas o rótulos laterales. Reutilizar `scripts/video/plugins/escenario.html` o agregar un tipo de paso `card`. |
| REC+2 | Arrastrar y soltar | No hay paso `drag`. Opción con `js`: crear `new DataTransfer()`, `setData("application/x-nt-session", id)` y despachar `dragstart` en la fila origen, `dragover` y `drop` en la fila destino (tipos de `src/components/Sidebar.tsx`), con `move` del cursor entre ambos. |
| REC+3 | Teclas faltantes | `scripts/video/record.mjs:55` no tiene `ArrowRight`, `ArrowLeft` ni `.`. Con `ctrl+.` hoy se enviaría `code: "Key."` y `windowsVirtualKeyCode: 46` (Delete). Agregar `ArrowRight: [39, "ArrowRight"]`, `ArrowLeft: [37, "ArrowLeft"]` y `"." → { key: ".", code: "Period", windowsVirtualKeyCode: 190 }`. |
| REC+4 | Tooltips | Los `title` nativos no salen en el screencast. Replicarlos con un callout del overlay. |

## Léxico TTS

Las entradas nuevas están en `scripts/video/pronunciacion.json` (atajos `⌘⇧W`, `⌘F`, `⌘T`, `Ctrl+Shift+…`, `Ctrl+→`, `Option+→`, `Alt+/`, `Ctrl+.`, `Ctrl+,`; `dmg`, `deb`, `AppImage`, `legacy`, `jump host`, `reload`, `shutdown`, `do`, `run`, `Dracula`, `Tokyo Night`, `IOS-XE`, `MD5`). Verificación con Whisper en `scripts/video/v2/AUDITORIA-GUIONES.md`.
