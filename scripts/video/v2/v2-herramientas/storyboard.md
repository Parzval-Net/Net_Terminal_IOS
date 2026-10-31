# Video 2: Herramientas de red a fondo. Storyboard

Etapa de escritura: no se renderiza. El guion vive en `guion/NN-titulo.txt` (un párrafo = un bloque, numerado desde 0 como en `scripts/video/plugins/guion.mjs`). Las fuentes de cada afirmación están en `fuentes.md`. Auditado sobre v0.9.7 (`146aaa6`): ver `scripts/video/v2/AUDITORIA-GUIONES.md`.

## Formato general

- 1920x1080, tema claro, `fontSize` 15, `?video=1` (igual que el video de plugins: `scripts/video/plugins/mock-video.js`).
- Página `app`: la app real con el backend simulado (`scripts/screenshots/demo.html` + `mock.js`). Página `escenario`: láminas y diagramas (`scripts/video/plugins/escenario.html`, tipos `portada`, `capitulo`, `lista`, `columnas`, `tabla`, `flujo`, `codigo`).
- Títulos de capítulo: superpuestos sobre la app (franja inferior, 2 s) para no sumar tiempo.
- Callout: recuadro con borde de acento sobre el control (`hl`), texto corto en la franja inferior. Zoom: `zoom` 1.25 a 1.6 sobre el control que se nombra, `unzoom` al cambiar de zona.
- Datos: solo IPs de documentación (192.0.2.0/24, 198.51.100.0/24, 203.0.113.0/24), nombres ficticios (`core-sw01`, `dist-sw01`, `rt-borde01`) y secretos de marcador (`<AUTH_PASS>`, `demo-...`). Servidor FTP del cliente: `203.0.113.30`, nunca un dominio real.
- Sin rayas largas en textos de pantalla. Atajos en pantalla con los dos sistemas: `⌘E · Ctrl+Shift+E`.

## Duraciones (152 palabras por minuto, medidas con Kokoro)

| # | Capítulo | Palabras | Duración | Inicio |
| --- | --- | ---: | ---: | ---: |
| 01 | Herramientas y módulos | 82 | 0:32 | 0:00 |
| 02 | Topología: vecinos CDP y LLDP | 225 | 1:29 | 0:32 |
| 03 | Topología sin CDP ni LLDP | 226 | 1:29 | 2:01 |
| 04 | Topología por SNMP y tráfico | 276 | 1:49 | 3:30 |
| 05 | Transferencias: conceptos | 169 | 1:07 | 5:19 |
| 06 | Servidores TFTP y HTTP | 203 | 1:20 | 6:26 |
| 07 | FTP: servidor y cliente FTPS | 142 | 0:56 | 7:46 |
| 08 | SFTP y SCP | 177 | 1:10 | 8:42 |
| 09 | Gestor de archivos | 198 | 1:18 | 9:52 |
| 10 | Cliente SNMP | 230 | 1:31 | 11:10 |
| 11 | Monitoreo, diagnóstico, velocidad, subredes y Syslog | 123 | 0:49 | 12:41 |
| 12 | Respaldos y comparación | 105 | 0:41 | 13:30 |
| 13 | Cierre | 40 | 0:16 | 14:11 |
| | **Total** | **2.196** | **14:27 de voz; unos 14:55 con tarjetas** | |

Si la grabación supera 15:00, recortar primero 03 bloque 4 (por qué confirmar) y 05 bloque 2.

## Escenas existentes en `scripts/screenshots/mock.js`

| Escena | Qué deja en pantalla |
| --- | --- |
| `s-modules` | Ajustes, Módulos |
| `t-topology`, `topology` | Topología base (core, dist, accesos, Po1); `topology` deja la ruta core-sw01 a sw-acceso-02 resaltada |
| `compare` | Topología comparada con el snapshot "Antes de la ventana de cambio" |
| `topology-sources`, `topology-sources-off` | Diagrama con todos los tipos de enlace, fuentes activas o apagadas |
| `topology-ospf` | rt-borde01 con vecinos solo de ruteo (OSPF, EIGRP, BGP lógico) |
| `topology-manual` | Equipos y enlaces manuales y sugerencia por descripción |
| `topology-mac` | Tablas MAC: enlace MAC/OUI confirmado y sugerencias alta, media y baja |
| `topology-snmp` | Modo "SNMP (perfil)", perfil `pcore`, y "Descubrir por SNMP" pulsado; agentes simulados en `snmp_topo_read` (`mock.js:798`) |
| `topology-traffic` | Tráfico activado por SNMP, intervalo 15 s, animación (desactivar con `&anim=0`); `SNMP_IFS` ya tiene verde (Te1/1/1), amarillo (Gi1/0/1) y rojo (Gi1/0/2) |
| `transfer` | Transferencias con scroll al Servidor TFTP; `server_start`, `server_stop`, `server_write`, `server_set_write`, `ftp_server_start`, `ftp_list`, `tftp_files`, `local_ips`, `tftp_md5` existen en el mock (`mock.js:535-584`) |
| `t-transfer` | **Rota**: `tool("TFTP / HTTP")` (`mock.js:1286`); la etiqueta hoy es "Transferencias" |
| `snmp` | SNMP: conjunto Interfaces cargado y receptor de traps iniciado (traps de ejemplo) |
| `snmpgen` | Generador: Cisco IOS-XE, v3, NMS 192.0.2.10 y 198.51.100.0/24, receptor 192.0.2.20 |
| `monitor` | Monitoreo con 3 sondas y 5 minutos de historia (`t-monitor` no genera muestras) |
| `t-diag`, `subnet`, `speed`, `t-syslog` | Pantallas vacías o con datos fijos |
| `backup`, `t-backup` | Respaldos con dos versiones de core-sw01 y comparación |

## Extensiones del backend simulado (pendientes)

Propuesta: un archivo `scripts/video/v2/v2-herramientas/mock-herramientas.js` que extiende `window.__mock`, igual que `scripts/video/plugins/mock-video.js`, para no tocar las capturas. Solo las correcciones marcadas "mock.js" van en el archivo base.

1. **Servidores de transferencia** (lo que falta sobre lo que ya existe).
   - Eventos `transfer` cada 300 ms al iniciar HTTP en la toma del flujo de firmware: `{id:"x1", proto:"http", client:"192.0.2.1:51544", file:"c9300-universalk9.17.12.04.SPA.bin", dir:"get", bytes, total:1163845632, done, error:null}` hasta completar.
   - `local_ips`: corregir `bridge100 = 192.168.64.1` (`mock.js:540`, fuera del rango de documentación) por `203.0.113.254` [mock.js]. Variante `&ips=multi` con `[{name:"bridge100", ip:"203.0.113.254"}, {name:"en0", ip:"192.0.2.250", default:true}, {name:"utun4", ip:"198.51.100.77"}]` para mostrar el selector "IP de este PC".
   - `tftp_add({path})` agrega el archivo a `tftp_files`; `tftp_delete` lo quita. `plugin:dialog|open` devuelve `/Users/operador/Descargas/c9300-universalk9.17.12.04.SPA.bin`.
   - FTP: `ftp_server_start` devuelve siempre `k7m2q9xh4p` (`mock.js:573-574`); debe generar una contraseña distinta por inicio (`demo-k7m2q9`, `demo-p4x8r2`). Con `server_set_write("ftp")` la contraseña no debe cambiar (así se demuestra el cambio en caliente).
   - `ftp_get` y `ftp_put`: devuelven un `job` y emiten `transfer` con `proto:"ftp"` y luego `tool-job` `done`. Servidor del cliente: `203.0.113.30`, usuario `operador`, contraseña tecleada `demo-ftp-2026`.
2. **Gestor de archivos** (`device_run` solo responde consultas y respaldos).
   - `source_ip({host})` devuelve `"192.0.2.250"`.
   - `dir flash:` en core-sw01 con el formato que reconoce `parseListing` (tres entradas y `11353194496 bytes total (8012345344 bytes free)`); variante `&flash=lleno` con `(812345344 bytes free)` para el aviso "Necesitas … y quedan … libres".
   - `copy http://192.0.2.250:8080/<archivo> flash:<archivo>`: `tool-job` `line` con `Destination filename [...]?`, `Accessing http://...`, `Loading ... !!!!!!!!`, `1163845632 bytes copied in 94.212 secs`, luego `result` `{ok:true, output}` y `done`, junto con eventos `transfer`.
   - `verify /md5 flash:<archivo>` responde `verify /md5 (flash:<archivo>) = 3f2a9c1e5b7d4a6f8e0c2b4d6f8a1c3e` (el hash que ya devuelve `tftp_md5`, `mock.js:584`). Variante `&md5=malo` con otro hash para el rojo.
   - `copy running-config tftp://192.0.2.250/core-sw01_<fecha>.cfg`: `Address or name of remote host [192.0.2.250]?`, `!!`, `4211 bytes copied`.
   - **Nuevo (v0.9.7)**: SCP desde el gestor. `connect` de una sesión con `scp` debe mostrar `Password:` y, tras una pausa, el progreso de `scp` y terminar emitiendo el fin de pestaña con código 0 (evento `SCP_EXIT_EVENT` de `src/lib/scpVerify.ts`) para que el gestor encole el MD5 automático. Variante `&scpbusy=1`: `device_run` del MD5 responde con el error `BUSY` de `src-tauri/src/scripts.rs:75` dos veces y luego ok, para mostrar "Equipo ocupado por un script: se reintenta en 5 s".
3. **Topología en vivo** (capítulo 02, bloques 1 y 2).
   - Escena nueva `topology-live`: `settings.topology` vacío, sesiones core-sw01 y dist-sw01 conectables.
   - `device_run` con `show cdp neighbors detail` por equipo (formato Cisco: `Device ID:`, `IP address:`, `Platform:`, `Interface: X,  Port ID (outgoing port): Y`). core-sw01: core-sw02 (Te1/1/1, 192.0.2.2), dist-sw01 por Gi1/0/1 y Gi1/0/2 (192.0.2.11). dist-sw01: core-sw01 por Gi1/0/48 y Gi1/0/47, sw-acceso-01 (192.0.2.21) y sw-acceso-02 (192.0.2.22).
   - `show lldp neighbors detail`: core-sw01 informa fw-perimetro (198.51.100.10, port1); dist-sw01 vacío.
   - `show interfaces status` y `show etherchannel summary` con Gi1/0/1 y Gi1/0/2 en Po1.
   - Para dist-sw01 la sesión guardada existe (192.0.2.11): el botón dirá `Conectar con "dist-sw01"`. Para "Conectar y seguir la ruta" usar sw-acceso-01, que no tiene sesión guardada. **v0.9.7**: tras conectar, el mock debe dejar que la app elija sola la sesión en "Equipo" (mensaje `sw-acceso-01 conectado y elegido en "Equipo": pulsa "Descubrir vecinos"`, `TopologyTool.tsx:409`); no hace falta cambiar el selector a mano.
4. **Tráfico con "velocidad desconocida" y aproximada** (capítulo 04, bloques 4 y 5). Agregar `&unknownSpeed=1`: `ifHighSpeed` 0 en Gi1/0/10 de core-sw01, para que el enlace con fw-perimetro salga violeta (`--util-unknown`). Para el "≈" (aproximado), una lectura por consola con `show interfaces` que solo traiga `BW 1000000 Kbit` y sin `Full-duplex, 1000Mb/s`.
5. **SNMP**: `snmp_walk` de `1.3.6.1.2.1.1` devuelve las filas de `SYS` con sufijo `.0`; `snmp_request` con `op:"getnext"` devuelve el OID siguiente y con `getbulk` 10 filas de `ifName`. `ifDescr` y `ifOperStatus` también deben responder en el walk. El botón "Escuchar en 192.0.2.250" aparece solo cuando `local_ips` trae una IP `default` (`SnmpTool.tsx:764-769`).
6. **Syslog**: `server_start` con `kind:"syslog"` y emisión del evento `syslog` con 6 mensajes `{ts, src:"192.0.2.1", severity, msg}` (por ejemplo `%LINK-3-UPDOWN: Interface GigabitEthernet1/0/3, changed state to down`, severidad 3; `%SYS-5-CONFIG_I: Configured from console by admin on vty0 (192.0.2.250)`, severidad 5).
7. **Diagnóstico**: `tool_ports` devuelve `[{port:22,open:true,rtt:3},{port:23,open:false,rtt:null,error:"rechazado"},{port:443,open:true,rtt:4}]` para 192.0.2.1.
8. **Corrección** [mock.js]: `"t-transfer": tool("TFTP / HTTP")` (`mock.js:1286`) debe usar `tool("Transferencias")`.
9. **Snapshots**: para mostrar las confirmaciones nuevas, el snapshot `s1` de la escena `compare` basta; "Abrir" y el basurero abren `ConfirmDialog` ("¿Reemplazar el diagrama por …?", "¿Eliminar el snapshot …?") sin mock extra.

## Diagramas para dibujar (página `escenario`)

- **D1 Vecinos CDP/LLDP**: dos switches unidos por un cable; sobre el cable, una burbuja "Soy dist-sw01, puerto Gi1/0/48, IP 192.0.2.11". Texto: "Cada equipo anuncia quién es y por qué puerto".
- **D2 Salto a salto**: core-sw01 (explorado) → dist-sw01 → sw-acceso-01, con tres pasos: Descubrir vecinos, Conectar (queda elegido solo), Descubrir vecinos.
- **D3 Escalera de confianza (MAC y fabricante)**: tres filas. Alta: MAC virtual HSRP `0000.0c07.acXX` o VRRP `0000.5e00.01XX`. Media: 4 o más MAC, o una sola MAC de fabricante de red. Baja: MAC de red con pocas más, o MAC local/aleatoria. Pie: "Son pistas: tú confirmas. Las descartadas se recuerdan".
- **D4 Cómo leer el tráfico**: un enlace core-sw01 a dist-sw01 con dos carriles y dos flechas; etiqueta `core-sw01 → 120 Mb/s · ← 35 Mb/s · 12 %`; leyenda: verde < 70 %, amarillo 70 a 89 %, rojo ≥ 90 %, violeta velocidad desconocida, "≈ aproximado (solo BW)"; "→ = sale del equipo nombrado; pasa el mouse para ver los dos nombres".
- **D5 Quién inicia la copia**: izquierda, "PC servidor (TFTP, HTTP, FTP)": PC ← router que ejecuta `copy`; derecha, "Equipo servidor (SCP, SFTP)": PC → SSH → router.
- **D6 Tabla de protocolos** (tipo `tabla`): columnas Cifrado, Credenciales, Velocidad, Soporte en equipos. TFTP: no / no / baja / casi todos. HTTP: no / no / alta / muchos. FTP: no / en claro / alta / muchos. SCP/SFTP: sí / del equipo / alta / si el equipo tiene el servidor activo.
- **D7 PC como servidor TFTP**: PC 192.0.2.250 con carpeta compartida y "UDP 69" ← router core-sw01 192.0.2.1 con `copy tftp://192.0.2.250/c9300-...bin flash:`. Advertencia: "Sin contraseña: apágalo al terminar".
- **D8 Flujo de firmware** (tipo `flujo`, 7 pasos): Agregar → Espacio libre → Iniciar HTTP/TFTP → Pegar copy → Avance → MD5 → Detener. Paso 8 en gris: "Arranque y reinicio: tú".
- **D9 SCP clásico**: OpenSSH 9 o superior usa SFTP por defecto; Cisco IOS-XE responde SCP clásico; la app agrega `-O`. Debajo: "Al terminar con código 0, el gestor corre el MD5 en la sesión del equipo".
- **D10 SNMP gestor y agente**: NMS (PC) → UDP 161 → agente; agente → UDP 162 → receptor de traps. Advertencia: "Receptor en 127.0.0.1: el equipo no llega. Botón: Escuchar en <IP de gestión>".
- **D11 Enmascarado en el diff**: dos líneas `enable secret 9 ****` en A y B; a la derecha la marca "secreto cambiado" (v0.9.7) sin revelar el valor.
- **D12 Puertos sin privilegios**: tabla 69 → 1069 · 21 → 2121 · 514 → 1514 · 162 → 1162 · HTTP 8080 (ya libre). "Linux y macOS".

## Tomas por capítulo

### 01 Herramientas y módulos (escena `empty`, luego `s-modules`)
- B0: lámina `portada` "Herramientas de red a fondo", chips: Topología, Transferencias, SNMP, Monitoreo, Respaldos.
- B1: app `empty`. Atajo `cmd+e`; callout "⌘E · Ctrl+Shift+E". `hl` del botón "Herramientas" de la barra de pestañas.
- B2: `hl` de la barra de módulos (nav de ToolsView). Zoom 1.4 al punto verde junto a Transferencias (requiere `server_start` en la preparación; ya existe en el mock).
- B3: escena `s-modules`. Zoom a la lista de interruptores; callout "Ocultar no borra la configuración".

### 02 Topología: vecinos (escena nueva `topology-live`, luego `topology` y `compare`)
- B0: lámina D1.
- B1: preparación: conectar core-sw01. Clic en Topología; `hl` "Descubrir con" (Consola (CLI)) y "Equipo (sesión conectada)"; `hl` "Estado de puertos", clic "Descubrir vecinos"; callout con el estado "Ejecutando: show cdp neighbors detail"; zoom 1.5 al rótulo "Po1 ×2".
- B2: clic en sw-acceso-01; zoom al panel Detalle; `hl` "Conectar y seguir la ruta"; clic. Pestaña nueva, se escribe la contraseña; al conectar, zoom al mensaje de estado `sw-acceso-01 conectado y elegido en "Equipo"` y al selector ya cambiado; clic "Descubrir vecinos". Después clic en dist-sw01 para mostrar `Conectar con "dist-sw01"`; callout "Sesión guardada: usa sus datos". Lámina D2 (3 s).
- B3: escena `topology`. `hl` "Desde aquí" y "Hasta aquí"; zoom a la sección Ruta; `hover` en "Copiar ruta".
- B4: escena `compare`. Zoom a "Cambios respecto de..."; callout verde "nuevo", rojo punteado "ya no aparece". Clic en "Abrir" → diálogo "¿Reemplazar el diagrama por …?" (Cancelar); clic en el basurero → "¿Eliminar el snapshot …?" (Cancelar). Callout "Ambos piden confirmación". Clic en "Exportar"; menú abierto 2 s; `hl` "Copiar como Mermaid".

### 03 Topología sin CDP ni LLDP (escenas `topology-sources-off`, `topology-ospf`, `topology-manual`, `topology-mac`)
- B0: `topology-sources-off` con `&topoOpen=fuentes`. Zoom al panel: tres interruptores apagados; callout "Apagada = sin comandos".
- B1: `topology-ospf`. `hl` de un nodo con borde punteado; zoom a la etiqueta "OSPF"; callout "Sesión BGP lógica" sobre la línea punteada fina.
- B2: `topology-manual` con `&topoOpen=sugerencias`. Zoom a la sugerencia "UPLINK a sw-patio-01 Gi0/1" (en pantalla se ve el texto real; la narración dice "uplink hacia el switch de distribución").
- B3: `topology-mac` con `&topoOpen=sugerencias`. Lámina D3 a pantalla completa 4 s; luego zoom a las sugerencias con sus etiquetas alta, media, baja.
- B4: clic en el botón "Sugerencias"; `hl` "Confirmar" y "Descartar"; clic en Confirmar de la HSRP; clic en Descartar de la "baja"; recargar la escena y mostrar que la descartada no vuelve (callout "Se recuerda por equipo"). Lámina `lista` con tres pistas falsas: descripción vieja, MAC Cisco de un teléfono IP, tabla MAC envejecida.
- B5: `topology-manual` con `&topoOpen=manual,leyenda`. Clic "+ Equipo", escribir `sw-bodega-01` / `192.0.2.70`; Cancelar. Zoom a la Leyenda.

### 04 Topología por SNMP y tráfico (escenas `topology-snmp`, `topology-traffic`)
- B0: `topology-snmp` sin pulsar (agregar `&noclick=1`). `hl` "Descubrir con" (SNMP (perfil)) y "Perfil SNMP del equipo (v2c o v3)".
- B1: clic "Descubrir por SNMP"; zoom al mensaje "core-sw01: N vecinos CDP/LLDP... por SNMP en X s". Callouts: "EIGRP: solo por consola", "LLDP-V2 si LLDP-MIB vuelve vacío", "Cisco: tabla MAC por VLAN".
- B2: `topology-traffic` con `&anim=0`, con `&topoOpen=trafico`. `hl` botón "Tráfico" y la sección "Tráfico en enlaces"; zoom al selector "Cada". Zoom al recuadro de estado ("SNMP: core-sw01, ..."). `hl` "También por consola" con callout "Ocupa la sesión unos segundos".
- B3: callout "Primera lectura: sin tasa" mientras aparece "La tasa aparece desde la segunda lectura". Zoom a los cuatro interruptores (Color por utilización, Flechas de dirección, Velocidad de tráfico, Animación).
- B4: lámina D4 3 s; luego app con `&unknownSpeed=1`: zoom sucesivo a enlace verde, amarillo, rojo y violeta. Abrir Leyenda (incluye "Velocidad desconocida" y la nota "≈: aproximada").
- B5: zoom 1.6 a una etiqueta `core-sw01 → … ← …`; `hover` sobre el enlace para mostrar el tooltip "Tráfico: core-sw01 → dist-sw01 … · dist-sw01 → core-sw01 …".

### 05 Transferencias: conceptos (página `escenario` casi completa)
- B0: lámina `capitulo` corta.
- B1: D5.
- B2: D6 completa (una fila por protocolo, revelada con la narración).
- B3: app, escena `transfer` con `&ips=multi`: zoom al selector "IP de este PC" con las tres IPs; callout "Usa la de gestión". Scroll a "Archivos compartidos". Pie: "Firewall: solo redes privadas".

### 06 Servidores TFTP y HTTP (escena `transfer` + extensión 1)
- B0: clic "Iniciar" en Servidor TFTP; zoom al estado "Activo · UDP 69".
- B1: clic en un archivo de "Archivos compartidos" y zoom 1.5 a los comandos copiables, que cambian con el archivo elegido; cambiar la IP en el selector y mostrar que el comando cambia; callout "Archivo elegido e IP del selector".
- B2: con el servidor en marcha, `hl` "Permitir subidas" y activarlo; aparece `copy running-config tftp://...` sin reiniciar; callout "Al instante · no se guarda".
- B3: Servidor HTTP: Iniciar, zoom a `copy http://192.0.2.250:8080/...`.
- B4: lámina D12 (puertos sin privilegios).
- B5: D8 (flujo); en paralelo, en la app: Agregar (diálogo simulado), Transferencias con barra de avance HTTP, Detener.

### 07 FTP (escena `transfer`, scroll a Servidor FTP y Cliente FTP / FTPS)
- B0: `hl` Servidor FTP.
- B1: Iniciar; zoom a Usuario `nt` y Contraseña; Detener e Iniciar otra vez para mostrar que la contraseña cambia; activar "Permitir subidas" con el servidor en marcha y mostrar que la contraseña no cambia.
- B2: zoom a la advertencia amarilla "FTP no cifra" y al aviso de 2121.
- B3: Cliente: escribir `203.0.113.30`, `operador`, contraseña; Listar; doble clic en `cisco`; clic en la flecha de descarga.
- B4: zoom a "FTPS explícito (AUTH TLS, certificado verificado)" y "Certificados del sistema, sin excepciones"; apagar el interruptor 1 s para mostrar la advertencia y volver a encenderlo.

### 08 SFTP y SCP
- B0: lámina D9 en versión simple (PC con OpenSSH → SSH → equipo).
- B1: escena `transfer`, sección SFTP interactivo; clic "Abrir SFTP"; pestaña nueva "SFTP core-sw01" con prompt `sftp>` simulado y `ls`, `get packages.conf`. Callout "get y put: carpeta compartida".
- B2: gestor de archivos, Protocolo "SCP (cifrado)"; Enviar abre la pestaña con `Password:`.
- B3: D9 completa; callout `ip scp server enable` y `feature sftp-server`.
- B4: la pestaña SCP termina (código 0) y en el gestor aparece sola la operación "✓ MD5 … ● Completado" (extensión 2, SCP). Variante `&scpbusy=1`: estado "Equipo ocupado por un script: se reintenta en 5 s" y luego ok. Cierre de la pestaña del SFTP interactivo: aviso que recuerda pulsar MD5 en el gestor.

### 09 Gestor de archivos (escena `transfer` + extensión 2)
- B0: `hl` de los dos paneles.
- B1: abrir "Tipo de equipo": con core-sw01 (plataforma IOS-XE detectada) propone Cisco IOS; con una sesión de plataforma `nxos` propone "Cisco NX-OS" y aparece el campo "VRF (management)". Zoom a "IP de este PC" y a "Leer archivos" con el pie "3 archivos · libre ...".
- B2: seleccionar la imagen y clic "Enviar"; abrir "Ver salida del equipo". Con `&flash=lleno`, mostrar el diálogo de espacio insuficiente.
- B3: abajo, el Servidor HTTP pasa a "Activo" durante la operación y vuelve a "Detenido" al terminar; callout "Lo inició para esta operación y lo detuvo". Con el servidor ya activo antes de la operación: sigue activo al terminar; "Permitir subidas" se enciende solo durante un Traer y se apaga al final.
- B4: operación MD5 en verde; con `&md5=malo`, en rojo "MD5 no coincide".
- B5: `hl` "Respaldar config"; callout "Sin enmascarar · no entra en Respaldos".

### 10 Cliente SNMP (escenas `snmp`, `snmpgen` + extensión 5)
- B0: lámina D10 (solo la mitad de consulta).
- B1: app SNMP, Destino SNMP; zoom a Versión, Nivel, Autenticación SHA-256, Privacidad AES-128; `hl` "Mostrar algoritmos heredados (MD5, DES)". Cambiar a v2c para mostrar la advertencia y volver a SNMPv3.
- B2: `hl` "Guardar secretos en la bóveda cifrada" y "Secretos en la bóveda · olvidar".
- B3: pulsar los botones de operación; botón rápido "system" (recorrido completo) y Consultar; zoom a la tabla, al estado "N filas en X ms" y al botón Detener. Conjunto Interfaces; "Medir tasas"; zoom a Entrada y Salida.
- B4: lámina D10 completa con la advertencia; app: receptor con "Escuchar en" en 127.0.0.1 y el aviso amarillo; clic en el botón "Escuchar en 192.0.2.250" (v0.9.7); Iniciar; traps de ejemplo. Zoom al aviso 162 → 1162.
- B5: escena `snmpgen`; zoom a "NMS autorizados", a `<AUTH_PASS>` en el texto generado y a una línea `! Verifica ...`.

### 11 Monitoreo y más (escenas `monitor`, `t-diag`, `speed`, `subnet`, `t-syslog`)
- B0: `monitor`; clic "Nueva sonda" para ver Tipo, Intervalo y "Caído tras"; Cancelar; zoom a la caída de "Enlace sucursal norte".
- B1: `t-diag` con el resultado de Puertos TCP (extensión 7).
- B2: `speed`; zoom a "Consume ~95 MB de datos por prueba".
- B3: `subnet`; elegir un "Nuevo prefijo".
- B4: `t-syslog` con mensajes (extensión 6); zoom a `logging host 192.0.2.250`, al aviso 514 → 1514 y a "Guardar en archivo diario".

### 12 Respaldos y comparación (escena `backup`)
- B0: `hl` lista de equipos, selector de perfil y "Respaldar".
- B1: lámina D11 2 s; app: zoom a "Enmascarar secretos" y a su texto de ayuda ("… marca "secreto cambiado" por una huella…").
- B2: `hl` botones A y B; clic "Comparar A y B"; zoom a "+N agregadas −N quitadas", a una línea con la marca "secreto cambiado" (`DiffView.tsx:74`; el mock debe devolver `backup_secrets` distinto entre las dos fechas de core-sw01) y a un pliegue "líneas sin cambios"; `hl` "Exportar".

### 13 Cierre
- B0: lámina `lista` con cuatro puntos.
- B1: lámina final con el logo y el enlace del sitio.
