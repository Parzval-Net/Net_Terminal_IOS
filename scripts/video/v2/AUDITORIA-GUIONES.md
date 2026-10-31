# Auditoría de los guiones de video (v1, v2 y v3)

Revisión de los tres guiones de `scripts/video/v2/` contra el código de NetTerminal v0.9.7 (`146aaa6`, rama `main` fusionada). Los guiones se escribieron sobre v0.9.5 (`c0f706d`) y quedaron desactualizados en varios puntos. Este documento resume qué estaba mal, qué se cambió y con qué evidencia, más la verificación de pronunciación, las duraciones finales y el veredicto por video.

Método: cada frase de cada guion se contrastó con el código (`src/`, `src-tauri/src/`), el `README.md` y `SECURITY.md`; los puntos dudosos se probaron ejecutando el código real (sugerencias de comandos con el catálogo de v0.9.7 bajo Node 24, `probar-ejemplos.mjs` del video 3, síntesis con Kokoro y transcripción con Whisper). Las referencias `archivo:línea` de cada afirmación están en el `fuentes.md` de cada video.

## Resumen

| Video | Palabras | Duración estimada (152 ppm medidos, más tarjetas) | Rango pedido | Veredicto |
| --- | ---: | --- | --- | --- |
| v1 Primeros pasos | 1.560 | 10:16 de voz, ~10:40 total | 9 a 11 min | **GO** |
| v2 Herramientas | 2.196 | 14:27 de voz, ~14:55 total | 13 a 15 min | **GO con reserva de duración**: está en el límite; si la grabación supera 15:00, recortar 03 bloque 4 y 05 bloque 2 (ya marcado en el storyboard) |
| v3 Automatización | 1.859 | 12:14 de voz, ~12:36 total | 11 a 13 min | **GO** |

Los tres videos siguen necesitando las extensiones del backend simulado listadas en cada storyboard (ningún mock nuevo se implementó en esta auditoría; solo se actualizaron las listas).

## Velocidad real de la narración

El capítulo 07 del video 1 (295 palabras) se sintetizó con `scripts/video/tts_kokoro.py` (voz `ef_dora`, velocidad 1.0, pausas de 250/450/700 ms) y dura **116,4 s**: **152 palabras por minuto con pausas incluidas**. Esa cifra se usó para todas las estimaciones; el modelo "150 ppm más pausas sumadas aparte" sobreestimaba un 18 %. A las duraciones de voz se suman unos 2 s por tarjeta de capítulo.

## Video 1 · Primeros pasos

Veredicto: **GO**. Guion correcto en lo esencial; se corrigieron detalles desactualizados y se mejoró la pronunciación.

| Qué estaba mal o faltaba | Qué se cambió | Evidencia |
| --- | --- | --- |
| Guion 02: "donde veas ⌘ usa Ctrl+Shift" (el símbolo suelto no se puede narrar) | "cuando digamos Comando, en Windows y Linux usa Control Shift" | `src/lib/platform.ts:3-11` |
| Guion 01: ".deb" y ".dmg" se leían ".punto de e be" (doble punto) | "una imagen dmg", "un paquete deb"; léxico `dmg`, `deb`, `AppImage` | `scripts/video/tts_kokoro.py --solo-texto`; `pronunciacion.json` |
| Guion 07: `sh ip int br` y "sh es shutdown" deletreados por la voz | "la abreviatura de show ip interface brief se reconoce igual"; "las letras ese y hache ya no son show, sino shutdown" | prueba Whisper (ver abajo) |
| Guion 07: faltaba el aviso de Linux (Ctrl+. abre emojis con IBus; usar Alt+/) | Frase nueva | `src/components/SettingsModal.tsx:406`, `src/lib/suggest.ts:840-843`, `README.md:37` |
| Guion 07: "Ctrl+→", "Option+→", "Ctrl+." como símbolos | Narrados en palabras ("Control y flecha derecha", "Control punto"); léxico con patrones para los subtítulos | `pronunciacion.json` (categoría atajo) |
| Guion 08: variables secretas solo "contraseñas o claves" | "contraseñas, enable o comunidades SNMP" (lista real: pass, pwd, secret, clave, key, token, psk, community, comunidad, auth, enable, tacacs, radius, snmp, pin) | `src/lib/templateSecrets.ts:1-14` |
| Guion 10: "Restablecer valores" sin mención; el storyboard decía "no hacer clic" | Frase nueva: pide confirmación; el storyboard ahora muestra el diálogo "¿Restablecer todos los ajustes?" y cancela | `src/components/SettingsModal.tsx:105-106`, `:527-534` |
| Storyboard: MOCK+1 (placeholder `10.0.0.1`) | Ya resuelto en la app (`192.0.2.10 o hostname`); se retiró. Las escenas `quick`/`quicktab` del mock quedaron rotas por buscar el placeholder viejo | `src/components/QuickConnectDialog.tsx:134`, `SessionModal.tsx:190`, `scripts/screenshots/mock.js:1043,1064,1067` |
| Storyboard 3a: nota "el diálogo se titula Editar sesión" | Hoy se titula "Guardar como sesión" | `src/App.tsx:1285`, `SessionModal.tsx:17,129` |
| Storyboard 7b L6: `sh ip` + Ctrl+→ debía dar `sh ip interface ` | Falso: el texto gris de `sh ip` es ` arp` y el de `sh ip int` se detiene en `{{interfaz}}`. Se cambió la demo a `sh vl` → `sh vlan ` → `sh vlan brief` | `lookup()`/`ghostFor()` de `src/lib/suggest.ts` sobre el catálogo real (script de auditoría) |
| Storyboard 7b L7 y 7c L19: índices de la lista "a verificar" | Verificados: `sh int` deja `show interfaces status` en el índice 2 (ArrowDown ×2); `sh run` deja `show running-config interface {{interfaz}}` en el índice 1 (ArrowDown ×1); `sh run` propone primero `show running-config` (desempate nuevo) | ídem |
| Storyboard 1c: `update=1` con versiones 0.9.1/0.9.5 y notas inventadas | Actualizado a 0.9.6 → 0.9.7 con las novedades reales de `146aaa6` (pendiente en el mock) | `scripts/screenshots/mock.js:454`, `:965-972` |
| Storyboard: `local_ips` del mock incluye `192.168.64.1` (fuera de RFC 5737) | Nuevo MOCK+14: reemplazar por `203.0.113.254` | `scripts/screenshots/mock.js:540` |
| fuentes.md: líneas de v0.9.5 | Reescrito con líneas de v0.9.7 | `scripts/video/v2/v1-primeros-pasos/fuentes.md` |

Hechos reverificados sin cambios: 1.776 comandos (conteo real de `src/packs/*.json`), 17 temas de terminal, atajos (`platform.ts`), límites de autocompletado de contraseña (`autofill.rs`), aviso de cierre múltiple, importación sin contraseñas ni túneles, revisión de actualizaciones al abrir y cada 6 h.

## Video 2 · Herramientas de red

Veredicto: **GO con reserva de duración** (ver resumen). Tenía los errores más graves porque casi todo lo que cambió en v0.9.6 y v0.9.7 está en este video.

| Qué estaba mal | Qué se cambió | Evidencia |
| --- | --- | --- |
| 02: "Elige el equipo nuevo en Equipo, sesión conectada, y pulsa Descubrir vecinos otra vez" | Al conectar, el equipo queda elegido solo; basta volver a Topología y pulsar Descubrir vecinos | `src/components/tools/TopologyTool.tsx:402-409` |
| 02: "el basurero lo borra sin preguntar" | Abrir y el basurero piden confirmación | `TopologyTool.tsx:329`, `:1017`, `:1785-1796`, `:1811` |
| 03: "OUI" (mala pronunciación) y "UPLINK a dist-sw01 Gi1/0/48" (se deletrea) | "el fabricante de la MAC"; "por ejemplo un uplink hacia el switch de distribución" | léxico y prueba Whisper |
| 03: faltaba que las sugerencias descartadas se recuerdan | Frase nueva | `TopologyTool.tsx:215`, `:347-349`, `src/lib/topology.ts:1863-1868` |
| 04: faltaban LLDP-V2 y la tabla MAC por VLAN en Cisco | Frases nuevas | `src/lib/topoSnmp.ts:61`, `:88-97`, `:126-128`, `:188`, `:380`; `README.md:258-263` |
| 04: "Azul indica velocidad desconocida" | Es violeta (`--util-unknown`) | `src/App.css:28,56`, `TopologyTool.tsx:213`, `:1259-1263` |
| 04: "Para saber cuál es A, pasa el mouse" | La etiqueta ya nombra al equipo A ("core-sw01 → 120 · ← 35"); el detalle al pasar el mouse nombra ambos | `TopologyTool.tsx:1077`, `:1271` |
| 04: faltaba velocidad física antes que BW y la marca "aproximada" | Frase nueva | `src/lib/topoTraffic.ts:17-20`, `:66-70`, `:91-96` |
| 05/06: "la primera IP de la lista" y "el primer archivo de la carpeta" | Hay selector "IP de este PC" y se usa el archivo elegido en Archivos compartidos | `src/components/tools/TransferTool.tsx:120-122`, `:142` |
| 06/07: "Permitir subidas se aplica al iniciar: detenlo e inícialo de nuevo" / "actívalo antes de iniciar" | Se aplica en caliente y no se guarda (vale solo para la sesión de la app); en FTP no cambia la contraseña | `TransferTool.tsx:55-75`, `FtpPanels.tsx:92`, `src-tauri/src/servers.rs:96`, `README.md:168` |
| 06: "En Linux, los puertos bajo 1024" | También macOS; se agregó la tabla completa 1069/2121/1514/1162 (HTTP 8080 ya es libre) | `TransferTool.tsx:171-175`, `FtpPanels.tsx:114`, `SyslogTool.tsx:107`, `SnmpTool.tsx:780` |
| 08: "Selecciónalo en el panel del equipo y pulsa MD5" como único camino | El MD5 corre solo al terminar SCP/SFTP con código 0, con reintento cada 5 s hasta 2 minutos si un script tiene la sesión; el SFTP interactivo avisa al cerrar la pestaña | `FileManager.tsx:288-296`, `:346-359`, `FtpPanels.tsx:287-328` |
| 09: "En NX-OS elígelo a mano, porque la app propone Cisco IOS" | El perfil sigue la plataforma detectada; NX-OS usa `bootflash:` y `vrf management` | `src/lib/devicefs.ts:74-83`, `:141-146` |
| 09: "Al terminar, el servidor queda encendido: detenlo" | Si el gestor lo inició, lo detiene al terminar; si ya estaba activo, lo deja; las subidas en caliente se quitan al final | `FileManager.tsx:201-260`, `TransferTool.tsx:143-148` |
| 09: texto de "Respaldar config" | Alineado con el `title` real: sin enmascarar y fuera de Respaldos | `FileManager.tsx:644-646`, `:751` |
| 10: "WALK" (se pronunciaba mal) y "nunca envía SET" | "El recorrido completo de la tabla usa GETBULK"; "nunca escribe en el equipo" | léxico; `README.md:61` |
| 10: faltaba el botón "Escuchar en <IP de gestión>" | Frase nueva | `SnmpTool.tsx:764-769` |
| 11: faltaba 514 → 1514 | Frase nueva | `SyslogTool.tsx:107` |
| 12: "un cambio de contraseña no se ve al comparar" | Falso desde v0.9.7: la comparación marca "secreto cambiado" con una huella | `src/lib/diff.ts:225-233`, `DiffView.tsx:74`, `BackupTool.tsx:265` |
| Storyboard: "server_start no existe en el mock" | Ya existe (`server_start`, `server_set_write`, `ftp_server_start`); la lista se redujo a lo que falta de verdad y se agregaron SCP con MD5 automático, `scpbusy`, `&unknownSpeed`, "secreto cambiado" | `scripts/screenshots/mock.js:535-584` |
| Storyboard: D4 y D10 con "azul" y sin el botón de escucha | Corregidos | ídem |
| Duración: 2.219 palabras iniciales (~15:30 con tarjetas) | Recortado a 2.196 con las frases nuevas incluidas; marcado qué recortar si sobra | conteo `duracion.py` |

Hechos reverificados sin cambios: tres fuentes de descubrimiento apagadas por defecto; umbrales 70 % y 90 %; intervalos 15/30/60 (30 por defecto); usuario FTP `nt` con contraseña nueva por inicio; FTPS explícito con certificados del sistema; valores por defecto del perfil SNMP (v3, authPriv, SHA-256, AES-128); receptor de traps en 127.0.0.1; sondas cada 1 s y 3 fallas; speedtest ~95 MB; respaldos de a 3.

## Video 3 · Automatización

Veredicto: **GO**. El capítulo de scripts estaba escrito para la API de una sola sesión y el principio 3 era falso en v0.9.7.

| Qué estaba mal | Qué se cambió | Evidencia |
| --- | --- | --- |
| 01: "Los scripts, los plugins y los comandos al conectar no pasan por el motor de riesgo" | Scripts y plugins sí pasan: cada línea se clasifica con `computeRisk` antes de su Enter; solo los comandos al conectar quedan fuera; los agentes muestran el riesgo calculado | `src/lib/scriptGate.ts:1-5`, `src-tauri/src/scripts.rs:13-16`, `:460`, `README.md:163`, `README.md:316` |
| 05: "La app busca Python la primera vez… ciérrala y ábrela de nuevo" | Hay orden de detección (py -3 / Homebrew / python.org / PATH / stub de Apple solo con CLT) y botón "Volver a detectar" | `scripts.rs:784-835`, `:916-931`, `PluginsTool.tsx:58-66`, `:150-153` |
| 05 y storyboard: "bloqueante de macOS" (PATH mínimo desde el Dock) | Resuelto en v0.9.7 (`extend_path`); el storyboard lo marca como resuelto | `src-tauri/src/lib.rs:987-998`, `README.md:60` |
| 05: comandos con guiones ("py -3 --version", "ssh -V", "Add-WindowsCapability") narrados | Se muestran en pantalla y la narración remite a ellos | storyboard 05 |
| 06: "La API trabaja con una sesión a la vez: lo ejecutas en cada pestaña" | Diálogo de lanzamiento con destino, Permitir cambios, paralelo (1 a 4) y tiempo máximo; `sessions()`, `on()`, `for_each()`; sesiones tomadas; "Detener script"; `expect()`; `ask_secret` | `src/components/ScriptLaunchDialog.tsx:85-180`, `src-tauri/src/netterminal.py:14-57`, `scripts.rs:63`, `:68`, `:75`, `ButtonBar.tsx:86-87` |
| 06: "lo que envía un script no pasa por el motor de riesgo" | Eliminado; la motivación de "solo consultas" se mantiene por el impacto de un error | `README.md:316` |
| 06: `inventario_csv.py` descrito como "una ejecución por pestaña" | El ejemplo real usa `nt.for_each` con varios destinos y cae a una sesión en versiones anteriores; salidas reales regeneradas con Node 24 | `docs/ejemplos/scripts/inventario_csv.py:94-105`, `probar-ejemplos.mjs` (OK) |
| 07: faltaba el permiso `vault-type` | Frase nueva | `src-tauri/src/plugins.rs:25-28`, `:116-120`, `PluginsTool.tsx:38`, `:297-314` |
| 09: "Antes, activa Solo lectura" sin decir que viene apagado; faltaban el distintivo de riesgo y la casilla para lo disruptivo | Corregido: Solo lectura apagado por defecto (recomendación), Aprobar cada comando encendido, distintivo calculado por la app y casilla "Entiendo que este comando puede cortar servicio" | `src/lib/settings.ts:153-154`, `src/components/ApprovalDialog.tsx:49-98` |
| 10: "Los scripts no acceden a la bóveda, así que conecta primero y luego ejecuta el script" | Siguen sin leer la bóveda, pero existe `type_saved_password` con casilla por ejecución | `netterminal.py:49-57`, `ScriptLaunchDialog.tsx:133-148`, `SECURITY.md` |
| 03: variables secretas "password, key o community" | "password, enable, comunidad o tacacs" | `src/lib/templateSecrets.ts` |
| Storyboard 09: `mcp-approval` con `tool: "run_command"` (no existe) | `send_command`, más un segundo diálogo con `reload` para la casilla | `src-tauri/src/mcp.rs:274-312`, `scripts/screenshots/mock.js:1191` |
| Duración: 1.872 palabras iniciales; con los agregados llegó a 2.058 (~13:50) | Recortado a 1.859 (~12:36) | `duracion.py` |

## Consistencia entre videos

- Terminología unificada: "Comando" para ⌘ con la regla "Comando = Control Shift" dicha una vez (v1 cap. 2) y los atajos de Windows/Linux explícitos en los demás videos; "pestañas elegidas, una carpeta o los paneles visibles" para el destino de envío; "Completar plantilla"; "Permitir subidas"; "Detener script"; "Solo lectura" y "Aprobar cada comando".
- Referencias cruzadas verificadas: v1 cap. 6 → packs en v3 cap. 8; v1 cierre → v2 y v3; v2 cap. 9 → módulo Respaldos (v2 cap. 12); v3 cap. 1 → aprobación por comando (v3 cap. 9); v3 cap. 3 repite la regla de variables secretas de v1 cap. 8 con la misma lista.
- Sin contradicciones restantes sobre el motor de riesgo: v1 (Notas, catálogo, difusión), v2 (Topología solo consulta) y v3 (scripts y plugins con control por línea; comandos al conectar fuera) dicen lo mismo que `README.md:157-165`.
- Ningún guion usa rayas largas ni expresiones coloquiales; español neutro.

## Datos ficticios

- IPs en guiones, storyboards y fixtures: solo 192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24, 127.0.0.1 y 0.0.0.0 (más fragmentos de OID, que no son IPs). Única excepción: `scripts/screenshots/mock.js:540` (`192.168.64.1`, interfaz `bridge100` en `local_ips`); queda como corrección pendiente del mock en ambos storyboards (v1 MOCK+14, v2 extensión 1).
- Nombres de empresa: ninguno real además de fabricantes (Cisco, Juniper, Huawei, Fortinet, Check Point, WatchGuard, Microsoft, Apple, Cloudflare). Hosts y dominios: `ftp.ejemplo.cl` solo como placeholder de la app; el storyboard usa `203.0.113.30`.
- Secretos: `demo-clave-2026`, `demo-ftp-2026`, `<AUTH_PASS>`; el token MCP se muestra enmascarado.

## Pronunciación (Kokoro + Whisper)

Corpus: `scripts/video/v2/corpus_voz_guiones.txt` (62 oraciones difíciles tomadas de los tres guiones). Comando:

```sh
~/.venvs/kokoro/bin/python -I scripts/video/verificar_voz.py --corpus scripts/video/v2/corpus_voz_guiones.txt --voces ef_dora --lexico con --modelo medium
```

Primera pasada (guiones reescritos, léxico ampliado con 70 entradas nuevas): **WER 7,3 %**, términos del léxico reconocidos 158/193, 5,52 sílabas/s, logprob medio -0,113. La mayoría de los fallos eran variantes de escritura de Whisper con audio correcto ("Core Switch 01", "TypeSavedPassword", "Volt Type", "Trace Root"). Fallos reales que se corrigieron con reescritura o léxico:

| Problema oído | Corrección |
| --- | --- |
| "comando e en macOS" → "comando en macOS" (la letra se pierde ante "en") | Los atajos con letra van al final de la cláusula: "se abren con ⌘E. En Windows y Linux, Ctrl+Shift+E" (igual con ⌘T y ⌘L) |
| "ese hache es shutdown" → "SHShutdown" | "las letras ese y hache ya no son show, sino shutdown" |
| "con su Port-channel" → "Support Channel" | "con el Port-channel que los agrupa" |
| "uplink" → "aplica" | dicho `ap link` y "un uplink hacia…" |
| "versión dos de esa MIB" → "2D Samib" | "prueba la MIB versión dos" |
| "Usas ls" → "CLS" | "Con ls listas, con cd cambias de carpeta, get trae y put envía" |
| "en NX-OS usa bootflash" → "NX o SU Sabut Flash" | "en NX-OS, el almacenamiento es bootflash" |
| "authPriv" → "UDPRIBE" | dicho `aut priv` |
| "IOS-XE" → "I o SXC" | dicho `i o ese, equis e` |
| "punto py" → ".pa" | "un archivo de Python" |
| "main.py lee" → "Main.pylee" | "main.py toma la acción…" |
| "deb" → "de V" | dicho `deb` (palabra) |

Términos que el encargo pedía evitar: WALK (reemplazado por "recorrido completo de la tabla"), OUI ("fabricante de la MAC"), `import netterminal as nt` (no aparece en ningún guion; se dice "el módulo netterminal") y deb (solo como "paquete deb", dicho como palabra).

Segunda pasada sobre las 23 oraciones reescritas: ver la sección siguiente.

### Segunda pasada

Sobre las 23 oraciones reescritas (misma voz, modelo `medium`): **WER 5,0 %**, términos 64/73, 5,36 sílabas/s, logprob medio -0,135. Los 7 términos marcados como fallidos son variantes de transcripción con audio correcto ("de app" por deb, "app link" por uplink, "MIBI" por MIB, "CISLOG" por Syslog, "OUTPRIB" por authPriv, "DS" por DES, "ShowBerson" por show version); se agregaron a `acepta` para que la próxima corrida no los cuente como error. La única secuencia que sigue sonando artificial es el deletreo de IOS-XE ("i o ese, equis e"), que Whisper transcribe de forma inestable pero que un oyente humano entiende; si en el ensayo molesta, reemplazar en v1 cap. 6 y v2 cap. 8 por "IOS XE" dicho como "ios equis e".

Resultados completos: `~/.cache/netterminal-voz/verificacion` o la carpeta que se pase con `-d` (`resultado.json` por voz, con transcripción por oración).

## Duraciones finales

Conteo con `duracion.py` (palabras de narración sin títulos) y 152 ppm medidos:

| Video | Capítulos | Palabras | Voz | Con tarjetas (2 s c/u) | Rango |
| --- | --- | ---: | --- | --- | --- |
| v1 | 11 | 1.560 | 10:16 | 10:38 | 9 a 11 |
| v2 | 13 | 2.196 | 14:27 | 14:53 | 13 a 15 |
| v3 | 11 | 1.859 | 12:14 | 12:36 | 11 a 13 |

Capítulos más largos: v1 07 (302 palabras, 1:59), v2 04 (276, 1:49), v3 06 (376, 2:28).

## Extensiones del mock pendientes (resumen)

Detalle exacto en cada storyboard. Nada de esto se implementó aquí.

- **Correcciones en `scripts/screenshots/mock.js`** (compartidas): placeholder viejo en `quick`/`quicktab` (`:1043`, `:1064`, `:1067`); `local_ips` con `192.168.64.1` (`:540`); `"t-transfer": tool("TFTP / HTTP")` (`:1286`); `approval` con `tool: "run_command"` (`:1191`).
- **v1** (`mock-v1.js`): `update=1` coherente con 0.9.6 → 0.9.7; importación openssh; login Telnet con contraseña guardada; respuesta a `show vlan brief`; Tab del equipo; ar-wan01 con plataforma vrp8; `do` en configuración; `show running-config interface`; notas `consultas-diarias.txt` y `usuario-local.txt`; alerta a demanda. Grabador: láminas, arrastrar y soltar, teclas `ArrowRight`/`ArrowLeft`/`.` (`record.mjs:55`), tooltips.
- **v2** (`mock-herramientas.js`): eventos `transfer` de progreso; `&ips=multi`; `tftp_add`/`tftp_delete`; contraseña FTP distinta por inicio y estable al cambiar subidas; `ftp_get`/`ftp_put`; gestor de archivos (`source_ip`, `dir flash:`, `copy http`, `verify /md5`, `copy running-config`, variantes `flash=lleno` y `md5=malo`); pestaña SCP que termina con código 0 y dispara el MD5 automático, con variante `scpbusy`; escena `topology-live` con `show cdp/lldp neighbors detail`, `show interfaces status`, `show etherchannel summary`; `&unknownSpeed=1` y una lectura por consola solo con BW; `snmp_walk`/`getnext`/`getbulk`; evento `syslog`; `tool_ports`; `backup_secrets` distinto entre fechas para "secreto cambiado".
- **v3** (sobre `mock-video.js`): campus multi-equipo con `respuestaCampus`; `run_script` con el diálogo de lanzamiento real (destinos, permitir cambios, paralelo, tiempo máximo) y ejecuciones por sesión; ping lento; sesión tomada (`BUSY`) y "Detener script"; diálogo de `scriptGate` (opcional); `ask_secret` y `type_saved_password` sin exponer el valor; plugin de varios archivos con versiones 1.0.0/1.0.1, estado `tampered` y uno con `vault-type`; `python_status` con ruta/versión y con el error `NO_PYTHON`; `tool_iperf_version` nulo; terminal local con las comprobaciones; conexión con `Password:` para los comandos al conectar; `mcp_configure` y `mcp-approval` con `send_command` (consulta y `reload`); láminas nuevas y Finder simulado.

## Archivos tocados

- `scripts/video/v2/v1-primeros-pasos/guion/*.txt`, `storyboard.md`, `fuentes.md`
- `scripts/video/v2/v2-herramientas/guion/*.txt`, `storyboard.md`, `fuentes.md`
- `scripts/video/v2/v3-automatizacion/guion/*.txt`, `storyboard.md`, `fuentes.md`
- `scripts/video/pronunciacion.json` (70 entradas nuevas: atajos, comandos, API de scripts, siglas, productos)
- `scripts/video/v2/corpus_voz_guiones.txt` (corpus de verificación de los guiones)
- `scripts/video/v2/AUDITORIA-GUIONES.md` (este documento)
