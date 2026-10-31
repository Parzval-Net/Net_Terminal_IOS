# Video 3 · Automatización: scripts, plugins y programación

Storyboard para grabar con el mismo motor del video 2 (`scripts/video/plugins/`: app real con backend simulado en `demo.html` y láminas en `escenario.html`). Esta etapa es solo de escritura: no hay tomas grabadas ni audio. Auditado sobre v0.9.7 (`146aaa6`): ver `scripts/video/v2/AUDITORIA-GUIONES.md`.

- Narración: `guion/NN-*.txt` (un párrafo = un bloque `B0`, `B1`…, como en `guion.mjs`).
- Fuentes de cada afirmación: `fuentes.md`.
- Ejemplos que aparecen en pantalla: `docs/ejemplos/` (probados con `probar-ejemplos.mjs` de esta carpeta; pasan con Node 24 sobre v0.9.7).
- Datos en pantalla: solo IPs de documentación (192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24), equipos ficticios de `equipos-campus.js` (`core-sw01`, `acc-sw01`, `acc-sw02`, `rtr-borde01`, `sw-lab09`), usuario `operador`, rutas `/Users/operador/...`. Nunca un token real: el de MCP se muestra enmascarado o con un valor de relleno generado para la toma.

## Duración

Cálculo a 152 palabras por minuto (medidas con Kokoro, pausas incluidas) más unos 2 s por tarjeta de capítulo. Total estimado: **12:36** (1.859 palabras = 12:14 de voz).

| # | Capítulo | Palabras | Narración |
| --- | --- | --- | --- |
| 01 | Qué se puede automatizar | 169 | 1:07 |
| 02 | Botones de la barra de comandos | 123 | 0:49 |
| 03 | Plantillas con variables | 144 | 0:57 |
| 04 | Comandos al conectar | 125 | 0:49 |
| 05 | Instalar las herramientas | 198 | 1:18 |
| 06 | Scripts de Python | 376 | 2:28 |
| 07 | Plugins | 235 | 1:33 |
| 08 | Packs de comandos | 133 | 0:53 |
| 09 | Agentes de IA con MCP | 189 | 1:15 |
| 10 | Buenas prácticas | 120 | 0:47 |
| 11 | Cierre | 47 | 0:19 |

## Bloqueante de macOS: resuelto en v0.9.7

La versión anterior de este storyboard advertía que la app abierta desde el Dock no veía `iperf3` ni el Python de Homebrew o python.org. Desde v0.9.7 la app agrega `/opt/homebrew/bin`, `/usr/local/bin` y `/Library/Frameworks/Python.framework/Versions/Current/bin` al PATH al iniciar (Linux: `~/.local/bin`): `src-tauri/src/lib.rs:987-998`. Además el intérprete se busca en orden fijo (`src-tauri/src/scripts.rs:784-835`) y hay un botón "Volver a detectar" en Herramientas › Plugins. El capítulo 05 se graba tal cual.

## Escenas

Convención: **App** = app real con backend simulado; **Lámina** = `escenario.html`; **Código** = lámina con editor y animación de tipeo. La cámara usa el mismo `p.camara(zoom, x, y, ms)`.

### 01 · Qué se puede automatizar (`01-principios.txt`)

| Bloque | Tipo | Qué se ve |
| --- | --- | --- |
| B0 | Lámina | Portada "Automatización: scripts, plugins y programación". Debajo, siete íconos en fila que se encienden al nombrarlos: botones, plantillas, comandos al conectar, scripts, plugins, packs, agentes IA. Sello "Datos ficticios · IPs RFC 5737". |
| B1 | Lámina | Semáforo de tres niveles con las etiquetas reales de la app: "Consulta", "Cambia config/estado", "Puede cortar servicio". Aparece `configure terminal` y cae en el amarillo con la nota "no reconocido como consulta". |
| B2 | App | Notas con la línea `show version; reload` (archivo de mock `riesgo-encadenado.txt` del video 2). ⌘↵ abre la confirmación roja "Puede cortar servicio en acc-sw01". Se cancela. |
| B3 | Lámina | Dos columnas. "Pasa por el motor de riesgo": Botones de texto, Notas, Catálogo, Enviar a varias sesiones, **Scripts y plugins (cada línea, antes de su Enter)**. "No pasa": Comandos al conectar. Abajo, aparte: "Agentes IA → diálogo con el riesgo calculado y tu aprobación". |
| B4 | Lámina | Frase sola: "Primero, solo lectura." |

### 02 · Botones (`02-botones.txt`)

| Bloque | Tipo | Qué se ve |
| --- | --- | --- |
| B0 | App | Pestaña `acc-sw01` conectada. Zoom a la barra de botones sobre la barra de estado (botones de fábrica: "terminal length 0", "Interfaces"). Inserto breve de Ajustes › Terminal › "Barra de botones". |
| B1 | App | Clic en "+". Modal "Nuevo botón": se tipea la etiqueta `Revisar puerto`, queda "Enviar texto" y se tipean dos líneas: `show interfaces {{interfaz}} status` y `show logging \| include {{interfaz}}`. Guardar. |
| B2 | App | Clic en "Revisar puerto" → "Completar plantilla" con `interfaz` = `Gi1/0/5` → confirmación "¿Enviar 2 líneas a acc-sw01?" → Enviar. La terminal muestra el puerto en `err-disabled` y las líneas `%PM-4-ERR_DISABLE` del log (respuestas de `equipos-campus.js`). |
| B3 | App | Clic derecho sobre el botón: menú "Editar" / "Eliminar". |

### 03 · Plantillas (`03-plantillas.txt`)

| Bloque | Tipo | Qué se ve |
| --- | --- | --- |
| B0 | App | ⌘J abre Notas con la nota `revision-puerto.txt` (contenido de `docs/ejemplos/plantillas/revision-puerto.txt`); `{{interfaz}}` resaltado. |
| B1 | App | Selección de las cuatro líneas, ⌘↵. "Completar plantilla" con `Gi1/0/5` y vista previa. Se envía (confirmación de 4 líneas) y la salida llega a `acc-sw01`. Inserto: una nota con `{{enable}}` y `{{comunidad}}` muestra los campos ocultos y "••••••" en la vista previa (sin enviar). Variables secretas según `src/lib/templateSecrets.ts`. |
| B2 | App | Selector de destino de Notas: "Todas las de una carpeta" › `Campus/Acceso` (`acc-sw01`, `acc-sw02`). |
| B3 | App | ⌘↵ de nuevo: la plantilla pide `interfaz` una vez y abre el diálogo de envío a varias sesiones con 2 equipos, riesgo "Consulta" y "Pausa entre equipos". Enviar. Panel de progreso con "Enviado" por equipo y el botón "Detener". Inserto: mismo diálogo con `clear counters {{interfaz}}` muestra "Para confirmar, escribe la cantidad de equipos (2)" (se cancela). |

### 04 · Comandos al conectar (`04-al-conectar.txt`)

| Bloque | Tipo | Qué se ve |
| --- | --- | --- |
| B0 | App | Editar sesión `acc-sw02` › "Opciones de terminal" › "Comandos al conectar (uno por línea)": se tipea `terminal length 0`. Guardar y conectar. |
| B1 | App | Conexión de `acc-sw02` en cámara lenta: banner, `Password:` (rótulo "espera: pedido de contraseña"), se escribe la contraseña (asteriscos simulados), aparece `acc-sw02#` y entonces se envía `terminal length 0` (rótulo "prompt detectado"). |
| B2 | Lámina | Tres viñetas: "En cada conexión y reconexión", "Sin motor de riesgo", "Nunca se importan (otros clientes ni JSON)". |

### 05 · Instalar las herramientas (`05-herramientas.txt`)

| Bloque | Tipo | Qué se ve |
| --- | --- | --- |
| B0 | App | ⌘T abre la terminal local. Pantalla dividida en tres columnas rotuladas macOS, Windows y Linux para el resto del capítulo. |
| B1 | Lámina + App | Columna por sistema con la fuente oficial: python.org/downloads (Windows y macOS), `sudo apt install python3` / `sudo dnf install python3` (Linux). En la terminal local se tipea `python3 --version` → `Python 3.12.x` (macOS/Linux) y en la columna Windows `py -3 --version`. Inserto de Herramientas › Plugins: línea "Python: /opt/homebrew/bin/python3 (3.12.x)" y botón "Volver a detectar". Si la app no encuentra Python, toast real: "No se encontró Python 3. Instálalo (python.org o Homebrew en macOS) y usa Volver a detectar." (`scripts.rs:931`). |
| B2 | App | Herramientas › Velocidad con `tool_iperf_version` = null: la tarjeta real "iperf3 no está instalado en este equipo" con `brew install iperf3`, `sudo apt install iperf3` y la línea de Windows. Corte a la misma sección con `iperf 3.17` en el título. Lámina lateral: "iperf.fr enlaza compilaciones de terceros · ESnet no distribuye binarios". En la terminal local: `iperf3 --version`. |
| B3 | Lámina + App | Columnas: macOS "incluido"; Linux `openssh-client` / `openssh-clients`; Windows: captura recreada de Configuración › Características opcionales › "Ver características" › OpenSSH Client, y el bloque `Add-WindowsCapability -Online -Name OpenSSH.Client~~~~0.0.1.0` con el rótulo "PowerShell como administrador" (fuente: Microsoft Learn). En la terminal local: `ssh -V` → `OpenSSH_9.x`. |
| B4 | Lámina + App | Columnas: Windows `tracert` (incluido), macOS `traceroute` (incluido), Linux `traceroute` o `tracepath`. Herramientas › Diagnóstico con un traceroute a `192.0.2.1`. Rótulo final: "Telnet: cliente propio, sin instalar nada". |

Comandos de comprobación que se tipean (todos de consulta en el motor de riesgo):

```text
macOS / Linux                 Windows (PowerShell)
python3 --version             py -3 --version
iperf3 --version              iperf3 --version
ssh -V                        ssh -V
command -v traceroute         (tracert viene con Windows)
```

### 06 · Scripts de Python (`06-scripts.txt`)

| Bloque | Tipo | Qué se ve |
| --- | --- | --- |
| B0 | App | Barra de botones › "Scripts" › menú con `ejemplo_respaldo.py`, `inventario_csv.py`, `ping_destinos.py`, `primer_script.py` y "Abrir carpeta de scripts". Inserto de la carpeta (Finder simulado en lámina) con `netterminal.py`, `ejemplo_respaldo.py` y los tres ejemplos. |
| B1 | App | Clic en `primer_script.py`: diálogo real "Ejecutar primer_script.py" (`ScriptLaunchDialog.tsx`): "Destino (el script solo puede usar estas sesiones)" con el selector de la difusión, "1 sesión: core-sw01", casilla "Permitir cambios" (apagada, con su texto "Sin marcar (recomendado)…"), casilla "Permitir que el script escriba contraseñas guardadas en: core-sw01" (apagada), "En paralelo" (deshabilitado con una sesión) y "Tiempo máximo" (30 min). Zoom a cada control mientras se nombra. Inserto: con 4 sesiones elegidas, "En paralelo" ofrece 1 a 4. |
| B2 | App | Mientras corre, el botón muestra "■ primer_script.py" (title "Detener script"); se teclea en la pestaña y no pasa nada (rótulo "sesión tomada por el script"); clic en Detener script en otra ejecución para mostrar el corte. |
| B3 | Código → App | Tipeo de `docs/ejemplos/scripts/primer_script.py` sin el docstring (código abajo). Corte a la app: toasts con las salidas reales. |
| B4 | Lámina | Diagrama: `run(cmd)` = `clear()` → `sendline(cmd)` → `wait_for(prompt)` → salida sin eco ni prompt. Al lado, `read(idle, timeout)` y `expect()` (solo hasta la coincidencia). |
| B5 | Código → App | Resaltado del bucle de `ping_destinos.py` (código abajo), con el bloque `except nt.ScriptTimeout` iluminado. App: la terminal muestra `!!!!!` para dos destinos y `.....` para 198.51.100.20; toasts "198.51.100.20: más de 8 s, esperando el final" y "Sin respuesta: 198.51.100.20". |
| B6 | Código → App | Desplazamiento por `inventario_csv.py` resaltando `nt.sessions()`, `nt.for_each(inventariar)`, `s.run(...)` y la escritura del CSV. App: se lanza con destino "Todas las de una carpeta" › `Campus` (5 sesiones, "En paralelo" = 2); progreso por equipo en los toasts; toast de `rtr-borde01`: "rtr-borde01: ISR4331/K9 17.09.05, sin show interfaces status"; `sw-lab09`: "no devolvió el prompt a tiempo". Corte a una lámina con el CSV como tabla (cinco filas de la prueba). |
| B7 | Lámina + App | `nt.ask_secret("Clave de enable")`: diálogo real de contraseña de `ScriptPrompts.tsx`; el toast posterior muestra el valor enmascarado. |
| B8 | Lámina | Dos tarjetas: "Script de consulta con error → CSV incompleto" (gris) y "Script de cambios con error → equipo sin servicio" (rojo). |

Código con tipeo, B3 (`primer_script.py`, sin docstring):

```python
import netterminal as nt

# Datos de la pestaña activa: nombre, tipo, host, puerto, usuario y puerto serial.
equipo = nt.session.get("name", "equipo")
print(f"Sesión: {equipo} ({nt.session.get('type')} a {nt.session.get('host')})")

# run() envía el comando, espera el prompt y devuelve solo la salida.
salida = nt.run("show version | include Version|uptime", timeout=30)
for linea in salida.splitlines():
    if linea.strip():
        print(linea.strip())
```

Código resaltado, B5 (`ping_destinos.py`, fragmento):

```python
for destino in DESTINOS:
    nt.clear()  # descarta la salida anterior
    nt.sendline(f"ping {destino}")  # envía el comando con Enter
    try:
        salida = nt.wait_for(PROMPT, timeout=8)  # espera el prompt, máximo 8 s
    except nt.ScriptTimeout as e:
        print(f"{destino}: más de 8 s, esperando el final")
        salida = e.output + nt.read(idle=3, timeout=30)
```

Código resaltado, B6 (`inventario_csv.py`, fragmentos; tomar el texto del archivo real, nunca reescrito a mano):

```python
def inventariar(s):
    fila = {c: "" for c in COLUMNAS}
    fila.update(equipo=s.session.get("name", "equipo"), host=s.session.get("host", ""), ...)
    try:
        s.run("terminal length 0", timeout=10)
        fila.update(leer_version(s.run("show version", timeout=30)))
        puertos = contar_puertos(s.run("show interfaces status", timeout=30))
        ...
    except nt.ScriptTimeout as e:
        fila["resultado"] = "sin respuesta a tiempo"
    return fila

destinos = nt.sessions()
resultados = nt.for_each(inventariar)
```

Salidas reales (de `probar-ejemplos.mjs`, Node 24, v0.9.7) para los toasts:

```text
primer_script.py   Sesión: core-sw01 (ssh a 192.0.2.1) | Cisco IOS XE Software, Version 17.12.04 | ... | core-sw01 uptime is 47 days, 17 hours, 30 minutes
ping_destinos.py   192.0.2.1: 100 % | 192.0.2.10: 100 % | 198.51.100.20: más de 8 s, esperando el final | 198.51.100.20: 0 % | Sin respuesta: 198.51.100.20
inventario_csv.py  (5 sesiones, 2 en paralelo) core-sw01: C9300-48P 17.12.04, ok | acc-sw01: C9200L-24P-4G 17.09.05, ok | acc-sw02: C9200L-24P-4G 17.09.05, ok | rtr-borde01: ISR4331/K9 17.09.05, sin show interfaces status | sw-lab09: ? ?, sin respuesta a tiempo | 5 equipos en .../reportes/inventario.csv
```

### 07 · Plugins (`07-plugins.txt`)

| Bloque | Tipo | Qué se ve |
| --- | --- | --- |
| B0 | App | Herramientas (⌘E) › Plugins, con `diagnostico-basico` 1.1.0 ya instalado (del video 2) y la línea "Python: …" con "Volver a detectar". |
| B1 | Código | Tipeo de `plugin.json` de `revision-puertos` (archivo completo) y luego resaltado de `main.py`: `ACCION = os.environ.get("NT_ACTION", "")`, el diccionario `ACCIONES` y la línea `from analisis import ...`. Árbol de archivos a la izquierda: `analisis.py`, `main.py`, `plugin.json`. |
| B2 | Código + App | Zoom a `"permissions": ["session", "files"]` con los textos de la app (`PluginsTool.tsx:34-38`): "Leer y enviar comandos a la sesión conectada" (marcado "la app lo hace cumplir") y "Leer o escribir archivos en tu equipo" (marcado "declarativo"). Inserto: tarjeta de un plugin con `vault-type` y su casilla "Permitir que el script escriba contraseñas guardadas en: la sesión de la pestaña activa" (`PluginsTool.tsx:297-314`). |
| B3 | App | "Desde carpeta" (`window.__nextOpen = "/Users/operador/proyectos/revision-puertos"`). Inserto de lámina con los rechazos de la validación (cinco viñetas). Tarjeta "Revisar antes de instalar: Revisión de puertos 1.0.0", "Autor declarado: Equipo de redes", permisos, "Código Python del plugin · 3 archivos" con `# ===== main.py =====` y, al desplazar, `# ===== analisis.py =====`. Clic en "Instalar y habilitar". Luego "Resumen de puertos" sobre `acc-sw01`: "Salida de plugins" con las líneas reales. |
| B4 | App | Reinstalación con `version` 1.0.1: "▲ Reemplazará la versión instalada de este plugin." Corte: plugin alterado (`tampered`) con "✕ Sus archivos cambiaron desde que lo aprobaste…", "Revisar código", "Aprobar estos cambios y habilitar". Final: papelera → "¿Desinstalar Revisión de puertos?" (se cancela). |

Salidas reales de las acciones en `acc-sw01`:

```text
Resumen de puertos   acc-sw01: 9 puertos · 5 connected, 1 disabled, 1 err-disabled, 2 notconnect | err-disabled: Gi1/0/5
Puertos con errores  Gi1/0/7: 304 errores | Gi1/0/2: 6 errores
Exportar a CSV       9 puertos exportados a /Users/operador/.../reportes/puertos-acc-sw01.csv
```

### 08 · Packs (`08-packs.txt`)

| Bloque | Tipo | Qué se ve |
| --- | --- | --- |
| B0 | App | ⌘L abre el catálogo con Cisco. Inserto de lámina con el JSON de `docs/ejemplos/packs/turno-puertos.json` (sin tipeo). |
| B1 | App | "+ Propio" → "Nuevo comando · Cisco": se tipea `clear counters {{interfaz}}`, explicación, categoría Interfaces, riesgo "Consulta". Aparece "▲ Por su contenido, la app lo tratará como "Cambia config/estado"." Se cambia a "Cambia config/estado" y "Guardar en Mis comandos". |
| B2 | App | Ventana "Packs de comandos": "Mis comandos (Cisco)" con el ícono "Exportar para compartir"; diálogo de guardado `user-cisco.json`. |
| B3 | App | "Importar pack" con `pack-riesgo-mal-declarado.json` (de esta carpeta): resumen "2 comandos · Consulta: 1 · Cambia config/estado: 1", "▲ 1 comandos declaraban menos riesgo del real; la app los ajustó." Cancelar. Luego importar `turno-puertos.json`: 3 comandos de consulta, se ven en el catálogo de Cisco. Zoom final a la nota del pie: "Al compartir un pack no incluyas IPs…". |

### 09 · Agentes de IA con MCP (`09-agentes-mcp.txt`)

| Bloque | Tipo | Qué se ve |
| --- | --- | --- |
| B0 | Lámina | Diagrama: agente (Claude Code, Gemini CLI, Codex) → `http://127.0.0.1:47821/mcp` + token → NetTerminal → equipos. Un candado en la flecha local. |
| B1 | App | Ajustes › Agentes IA con los valores por defecto reales: "Activar servidor MCP" apagado, "Aprobar cada comando" encendido, "Solo lectura" apagado. Primero se activa "Solo lectura", después "Activar servidor MCP": el campo Token se llena (enmascarado) y el estado muestra "Escuchando en http://127.0.0.1:47821/mcp". |
| B2 | App | "Configurar tu agente" › Claude Code › "Copiar" (token enmascarado en el bloque). Botón "Generar nuevo (invalida el anterior)" resaltado. Zoom a la barra de estado: "IA". |
| B3 | App | Se desactiva "Solo lectura". Diálogo de aprobación real (evento `mcp-approval` con `tool: "send_command"`, `target: "acc-sw01"`, `detail: "show interfaces status"`): distintivo "Consulta" arriba a la derecha (title "Riesgo calculado por la app, no declarado por el agente"), foco en "Rechazar", texto "Se rechaza solo en 2 minutos". Se presiona Enter (no pasa nada, rótulo "Enter no aprueba") y luego clic en "Permitir". Segundo diálogo con `detail: "reload"`: distintivo rojo "Puede cortar servicio", botón "Permitir" deshabilitado hasta marcar "Entiendo que este comando puede cortar servicio en acc-sw01"; se rechaza. |
| B4 | Lámina | Lista de herramientas MCP: `list_sessions`, `list_connections`, `read_output` (siempre) y `send_command`, `open_session` (solo sin Solo lectura). Tachado: scripts, plugins, envío a varias sesiones. |

### 10 · Buenas prácticas (`10-buenas-practicas.txt`)

| Bloque | Tipo | Qué se ve |
| --- | --- | --- |
| B0 | Lámina | Lista numerada que se completa: Laboratorio · Consultas primero · Control de versiones (un `git log` ficticio con "revision-puertos 1.0.1"). |
| B1 | App + Código | Formulario de sesión con "Guardar contraseña" marcado y el campo enmascarado; inserto de Ajustes › Credenciales. Código: el fragmento de `docs/ejemplos/README.md` con `s.expect(r"[Pp]assword:\s*$")` y `s.type_saved_password()`. App: diálogo de lanzamiento con la casilla "Permitir que el script escriba contraseñas guardadas en: consola-core" marcada; la terminal muestra `Password:` y luego el prompt, sin que el valor aparezca en ningún toast. Rótulo: "El script nunca ve la contraseña". |
| B2 | Lámina | "Revisa el código antes de ejecutarlo" con la tarjeta de revisión del plugin de fondo. |

### 11 · Cierre (`11-cierre.txt`)

| Bloque | Tipo | Qué se ve |
| --- | --- | --- |
| B0 | Lámina | Resumen en siete íconos (los mismos de la portada) con una frase cada uno. |
| B1 | Lámina | Árbol de `docs/ejemplos/` y logo. |

## Escenas simuladas y extensiones del backend que faltan

El motor del video 2 cubre botones, Notas, plantillas, packs, plugins y el diálogo de aprobación. `mock-video.js` responde con `equipo-ficticio.js` (un solo equipo) y simula `run_script` sin el diálogo de lanzamiento. Para este video hace falta:

1. **Campus multi-equipo en el navegador.** Elegir la respuesta por el nombre de la sesión de cada conexión con `respuestaCampus(cmd, nombre)` de `equipos-campus.js`, y prompts por equipo. Sesiones: carpeta `Campus/Núcleo` (`core-sw01` 192.0.2.1), `Campus/Acceso` (`acc-sw01` 192.0.2.11, `acc-sw02` 192.0.2.12), `Campus/Borde` (`rtr-borde01` 198.51.100.1), `Campus/Laboratorio` (`sw-lab09`, sin respuesta).
2. **Diálogo de lanzamiento (v0.9.7).** El mock debe dejar que la app muestre `ScriptLaunchDialog` y recibir `run_script` con `{script, targets, allowChanges, vaultType, parallel, maxMinutes}` (ver la firma real en `src/App.tsx:565`). Con varios destinos, ejecutar la simulación por sesión y emitir los eventos de progreso que la app espera (`script-*`, ver `src/components/ScriptPrompts.tsx` y `src/lib/scriptGate.ts`).
3. **Datos de scripts por equipo.** `datosVideo()` hoy guarda una ejecución por script. Para `inventario_csv.py` se necesita una ejecución multi-sesión (5 equipos, 2 en paralelo) generada con `probar-ejemplos.mjs`, más la variante de una sola sesión.
4. **Ping lento.** El tercer destino de `ping_destinos.py` debe tardar unos 10 s con `.` progresivos (o un corte con rótulo "10 s después").
5. **Sesión tomada y Detener script.** Mientras `run_script` está en curso, `write` desde la terminal debe devolver el error `BUSY` ("Un script está usando esta sesión…", `scripts.rs:75`) y el botón "Detener script" debe cortar la simulación (handler `script_stop` o el nombre real que use `ButtonBar.tsx`).
6. **Control de riesgo en scripts.** Un script de demostración que envíe `clear counters` para mostrar el diálogo de `scriptGate` ("gate") con los destinos, y el rechazo que detiene el script. Solo si cabe en tiempo; el guion no lo exige.
7. **`ask_secret` y `type_saved_password`.** Emitir las peticiones `kind: "secret"` para abrir el diálogo real de `ScriptPrompts.tsx`; para `type_saved_password`, escribir `Password:` en la terminal y luego el prompt, sin texto del secreto.
8. **Plugin de varios archivos.** `vista()` en `datos.mjs` arma el listado solo con `main.py`. Para `revision-puertos` debe agregar `analisis.py` después de `main.py` (orden de `code_listing`) y `files` con los tres archivos; también las versiones 1.0.0 y 1.0.1, un estado `tampered` y un plugin con permiso `vault-type` para la casilla.
9. **Python detectado / ausente.** Handler `python_status` (o el nombre real que invoque `PluginsTool.tsx:60-66`) con dos respuestas: ruta y versión, o el error `NO_PYTHON` de `scripts.rs:931`.
10. **Velocidad sin iperf3.** `tool_iperf_version` del mock de capturas devuelve `"iperf 3.17"`; la escena B2 del capítulo 05 necesita poder devolver `null`.
11. **Terminal local con comprobaciones.** Respuestas para `python3 --version`, `py -3 --version`, `iperf3 --version`, `ssh -V`, `command -v traceroute` en una pestaña `local`.
12. **Comandos al conectar con login.** Conexión de `acc-sw02` que muestra `Password:`, espera la escritura y solo con `acc-sw02#` recibe `terminal length 0`. El mock debe dejar correr el `runOnConnect` real de `TerminalView` (basta con que banner, pedido de contraseña y prompt lleguen por el canal de datos con pausas).
13. **MCP.** Handler `mcp_configure` que devuelva "Escuchando en http://127.0.0.1:47821/mcp", token de relleno fijo para la toma, y disparadores `mcp-approval` con `tool: "send_command"` y `detail: "show interfaces status"` (distintivo "Consulta") y con `detail: "reload"` (distintivo rojo y casilla). Corregir en `scripts/screenshots/mock.js:1191` el `tool: "run_command"`, que no existe en `mcp.rs` [mock.js].
14. **Láminas nuevas en `escenario.html`.** Semáforo de riesgo, columnas "pasa / no pasa" (con scripts y plugins en "pasa"), diagrama de `run()` con `expect()`, tabla CSV, diagrama MCP, tres columnas por sistema operativo con capturas recreadas de python.org, Características opcionales de Windows e iperf.fr (recreadas, sin logos ni marcas de terceros más allá del nombre).
15. **Explorador de archivos.** Lámina de Finder simulada para la carpeta de scripts y para `reportes/`.

## Pruebas antes de grabar

```bash
~/.nvm/versions/node/v24.21.0/bin/node scripts/video/v2/v3-automatizacion/probar-ejemplos.mjs   # pasa en v0.9.7
~/.nvm/versions/node/v24.21.0/bin/node scripts/video/plugins/probar-ejemplos.mjs                 # ejemplos del video 2
~/.nvm/versions/node/v24.21.0/bin/node scripts/tests/scripts-api.test.mjs                        # API de varias sesiones, riesgo, secretos
cd src-tauri && cargo test --lib plugins::tests                                                   # revisión de instalación de los plugins de ejemplo
```
