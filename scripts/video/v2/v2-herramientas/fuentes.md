# Fuentes del guion (archivo:línea)

Rutas relativas a la raíz del repositorio, verificadas sobre `146aaa6` (v0.9.7) en la auditoría (`scripts/video/v2/AUDITORIA-GUIONES.md`). Formato: bloque del guion → respaldo en el código.

## 01 Herramientas y módulos
- ⌘E / Ctrl+Shift+E: `src/lib/platform.ts:3-11` (modificador), `:89-90` (`"e"` → tools); `README.md:60`.
- Lista de módulos: `src/components/tools/ToolsView.tsx:22-32`. Punto verde "Servidor activo": `ToolsView.tsx:167`.
- Ajustes › Módulos, "Desactivar un módulo no borra su configuración": `src/components/SettingsModal.tsx:67`, `:353`. Visibles por defecto: `src/lib/settings.ts:156`.

## 02 Topología: vecinos
- Comandos de vecinos y estado de puertos por fabricante: `README.md:232-239`; implementación en `src/lib/topology.ts`.
- "Descubrir con" Consola/SNMP, "Equipo (sesión conectada)", "Estado de puertos", "Descubrir vecinos": `src/components/tools/TopologyTool.tsx` (panel de descubrimiento); Port-channel en enlaces paralelos: `README.md:274`.
- "Conectar y seguir la ruta" / `Conectar con "<sesión guardada>"`: `TopologyTool.tsx:1586`. **Cambio v0.9.7**: al conectar, la sesión queda elegida sola en "Equipo": `TopologyTool.tsx:402-409` (mensaje `… conectado y elegido en "Equipo": pulsa "Descubrir vecinos"`), `README.md:272`.
- Desde aquí / Hasta aquí / Ruta: `README.md:273`; `TopologyTool.tsx:1603` (resumen `A → B`).
- Snapshots, Comparar con, verde y rojo punteado, máximo 20: `README.md:275`. **Cambio v0.9.7**: confirmaciones para borrar el diagrama (`TopologyTool.tsx:1017`), reemplazar por un snapshot (`:1785-1796`) y eliminar un snapshot (`:1811`); comentario en `:329`.
- Exportar SVG, draw.io, CSV y Mermaid: `README.md:276`.

## 03 Topología sin CDP ni LLDP
- Tres fuentes (`routing`, `desc`, `mac`), apagadas por defecto y sin comandos mientras están apagadas: `src/lib/topology.ts:1409-1448`, `README.md:241-247`, `README.md:186`.
- Vecinos de ruteo (router-id o IP, borde punteado, fusión al explorar, iBGP como sesión lógica): `README.md:249`.
- Sugerencias por descripción (usa las descripciones de "Estado de puertos"): `README.md:246`, `README.md:250`.
- MAC/fabricante: comandos `README.md:247`; confianza alta (HSRP/VRRP), media (4 o más MAC, o una sola de fabricante de red), baja: `README.md:251`.
- Confirmar / Descartar; **cambio v0.9.7**: las descartadas se recuerdan por equipo: `TopologyTool.tsx:215`, `:347-349`, `src/lib/topology.ts:1863-1868`, `README.md:275`.
- Límites del fabricante de la MAC (tarjeta de red, teléfono IP, tabla que envejece): `README.md:252`.
- Manual (+ Equipo, + Enlace) y leyenda por origen: `README.md:253`, `README.md:268`.

## 04 Topología por SNMP y tráfico
- Modo "SNMP (perfil)", perfil v2c o v3 con secretos guardados: `README.md:254`.
- Lectura con GETBULK, solo lectura, lista fija de OID; OSPF-MIB y BGP4-MIB (EIGRP solo por consola): `README.md:254-261`, `README.md:187`, `src/lib/topoSnmp.ts:165` (`snmpDiscoveryPlan`).
- **Cambio v0.9.7**: LLDP-V2-MIB si LLDP-MIB vuelve vacía: `src/lib/topoSnmp.ts:11-12`, `:61`, `:88-97`, `:188`, `:380` (`lldpV2FromSnmp`); `README.md:258`.
- **Cambio v0.9.7**: tabla MAC por VLAN en Cisco (`community@vlan` o contexto `vlan-N`, máximo 64 VLAN): `src/lib/topoSnmp.ts:126-128`, `README.md:261-263`.
- LLDP y CDP vacíos = protocolo apagado o agente sin esas MIB: `README.md:263`.
- Botón "Tráfico" y sección "Tráfico en enlaces"; apagado por defecto; intervalos 15/30/60 (30 por defecto); solo visible: `src/components/tools/useTopoTraffic.ts:22-23`, `:71`, `:113`, `README.md:264`.
- Perfil por IP o nombre; "También por consola" con `show interfaces` y riesgo `read`: `README.md:264`, `README.md:187`.
- Tasa desde la segunda lectura: `src/lib/topoTraffic.ts:66-67`.
- Interruptores "Color por utilización", "Flechas de dirección", "Velocidad de tráfico", "Animación" (apagada): `TopologyTool.tsx:1349-1361`, `README.md:264`.
- Umbrales 70 % y 90 %, sentido más cargado: `src/lib/topology.ts:1128-1133`. **Corrección**: el color de "velocidad desconocida" es violeta (`--util-unknown: #6e5f99` / `#a99bd6`, `src/App.css:28`, `:56`; `TopologyTool.tsx:213`, `:1259-1263`), no azul.
- **Cambio v0.9.7**: velocidad física antes que BW; con solo BW la utilización se marca "≈" aproximada: `src/lib/topoTraffic.ts:17-20`, `:66-70`, `:91-96`, `TopologyTool.tsx:1077`, `README.md:264`.
- **Cambio v0.9.7**: la etiqueta nombra al equipo A ("core-sw01 → 120 Mb/s · ← 35 Mb/s"); detalle con ambos nombres al pasar el mouse: `TopologyTool.tsx:1077`, `:1271`, `README.md:264`.

## 05 Transferencias: conceptos
- Una carpeta para TFTP, HTTP y FTP: `README.md:63-64`, `src-tauri/src/ftpserver.rs:538`.
- Sección "Archivos compartidos" y selector "IP de este PC" (`IpSelect`): `src/components/tools/TransferTool.tsx:142`, `:202-204`.
- Firewall y redes privadas; servidores escuchan solo mientras están activos: `TransferTool.tsx:143-148`, `SECURITY.md` (Servidores integrados).
- TFTP sin autenticación y en paso fijo (bloque + ACK): RFC 1350 sección 2; `src-tauri/src/servers.rs`.
- HTTP solo lectura, más rápido para imágenes grandes: `TransferTool.tsx:178`.
- FTP en claro: `src/components/tools/FtpPanels.tsx:99`.
- SCP/SFTP sobre el OpenSSH del sistema: `src-tauri/src/connection.rs:917-954`, `README.md:63`.

## 06 Servidores TFTP y HTTP
- Puertos por defecto 69 y 8080: `src/lib/settings.ts:158-159`. Estado "Activo · UDP 69": `TransferTool.tsx:153`.
- Comandos copiables (`copy tftp`, `tftp get`, `copy http`) con **el archivo elegido** en Archivos compartidos y la IP del selector: `TransferTool.tsx:120-122`, `:167-169`, `:189-190`.
- **Cambio v0.9.7**: "Permitir subidas" se aplica en caliente (`server_set_write`) y no se persiste (vale solo para la sesión de la app): `TransferTool.tsx:55-75`, `src-tauri/src/servers.rs:96`, `README.md:168`.
- Aviso de privilegios en Linux y macOS (69 → 1069): `TransferTool.tsx:171-175`. Puertos alternativos 2121 (`FtpPanels.tsx:114`), 1514 (`SyslogTool.tsx:107`) y 1162 (`SnmpTool.tsx:780`).
- Lista "Transferencias" con avance y botón "Agregar": `TransferTool.tsx:79-91`, `:109-118`, `:207-208`.

## 07 FTP
- Puerto 21: `settings.ts:180`. Usuario fijo `nt` y contraseña aleatoria de 10 caracteres por inicio: `src-tauri/src/ftpserver.rs:76`, `:538`; texto "Usuario nt y contraseña nueva en cada inicio": `FtpPanels.tsx:84`.
- "Permitir subidas" con el servidor en marcha, sin cambiar la contraseña: `FtpPanels.tsx:92`, `src/components/tools/FileManager.tsx:201-205`, `README.md:63`.
- Advertencia FTP en claro y 21 → 2121: `FtpPanels.tsx:99`, `:114`.
- Cliente FTP/FTPS: campos, Listar, traer; FTPS explícito activo; certificados del sistema sin excepciones; FTPS implícito (990) no soportado: `FtpPanels.tsx:185-212`, `README.md:63`.

## 08 SFTP y SCP
- Usuario, puerto, llave y jump host de la sesión: `connection.rs:917-954`; SCP clásico con `-O`: `connection.rs:952-954`.
- SFTP interactivo ("Abrir SFTP"; `ls`, `cd`, `get`, `put`, `bye`; carpeta compartida): `FtpPanels.tsx:309-328`.
- SCP/SFTP desde el gestor abren pestaña con contraseña: `FileManager.tsx:262` (comentario), `README.md:64`.
- `ip scp server enable` y `feature sftp-server`: `FileManager.tsx` (notas del selector de protocolo), `README.md:64`.
- **Cambio v0.9.7**: MD5 automático al terminar SCP/SFTP con código 0, en la sesión del equipo, con reintento cada 5 s hasta 2 minutos si un script tiene tomada la sesión: `FileManager.tsx:288-296`, `:346-359`, `README.md:64`.
- **Cambio v0.9.7**: aviso en el SFTP interactivo al cerrar la pestaña ("selecciónalo en el gestor de archivos y pulsa MD5"): `FtpPanels.tsx:287-302`, `:328`, `README.md:64`.
- Botón MD5 y comandos de verificación (`verify /md5` en Cisco): `FileManager.tsx:636-638`, `src/lib/devicefs.ts`.

## 09 Gestor de archivos
- Dos paneles, sesión obligatoria: `FileManager.tsx` (encabezado del componente), `TransferTool.tsx:128-131`.
- **Corrección**: el perfil se sugiere según la plataforma detectada; NX-OS usa `bootflash:` y `vrf management` (campo "VRF (management)"): `src/lib/devicefs.ts:74-83`, `:141-146`, `FileManager.tsx:478`, `:555`, `README.md:64`.
- IP según la ruta al equipo (por defecto la de la ruta por defecto, físicas antes que virtuales): `README.md:64`.
- Enviar, arrastrar, confirmaciones automáticas, aviso de espacio: `FileManager.tsx:432`, `TransferTool.tsx:130`.
- **Cambio v0.9.7**: reutiliza el servidor activo; si lo inicia, lo detiene al terminar; subidas en caliente sin reiniciar ni cambiar la contraseña FTP, y se quitan al final: `FileManager.tsx:201-260`, `TransferTool.tsx:143-148`, `README.md:64`.
- "Verificar MD5 después de enviar" y rojo si no coincide: `FileManager.tsx:526`, `:155-168`.
- "Respaldar config": copia sin enmascarar, fuera de Respaldos: `FileManager.tsx:644-646`, `:751`, `README.md:64`.

## 10 Cliente SNMP
- Solo lectura, sin SET: `README.md:61`.
- Perfil por defecto (v3, authPriv, SHA-256, AES-128, puerto 161): `src/lib/snmp.ts:26-40`. MD5/DES solo como legado: `README.md:61`.
- Advertencia v2c: `src/lib/snmpconfig.ts:231`, `README.md:61`.
- Bóveda y secretos atados a host y puerto: `README.md:61`, `README.md:181`, `SECURITY.md` (SNMPv3 y localización de claves).
- GET, GETNEXT, WALK acotado y cancelable, GETBULK: `README.md:61`.
- Conjuntos de OIDs (interfaces con contadores de 64 bits y tasas): `README.md:61`.
- Receptor de traps apagado; escucha en 127.0.0.1 por defecto; selector "Escuchar en"; **cambio v0.9.7**: botón "Escuchar en <IP de gestión>": `src/components/tools/SnmpTool.tsx:714`, `:743-745`, `:764-769`; aviso 162 → 1162: `SnmpTool.tsx:780`; `src/lib/settings.ts:178-179`; `SECURITY.md` (el receptor es la excepción que escucha en 127.0.0.1).
- Generador: plataformas, NMS obligatorio para la ACL, marcadores `<AUTH_PASS>`, comentarios "Verifica": `src/lib/snmpconfig.ts:104`, `:186`, `README.md:62`.

## 11 Monitoreo, diagnóstico, velocidad, subredes y Syslog
- Nueva sonda, ICMP/TCP, 1 s, 3 fallas, alarma al caer y al recuperarse: `src/components/tools/MonitorTool.tsx:29-31`, `:66-68`.
- Ping continuo, Traceroute, Puertos TCP: `src/components/tools/DiagTool.tsx:84`, `:115`, `:133`.
- Speedtest Cloudflare ~95 MB; iperf3 instalado: `src/components/tools/PerfTool.tsx:64`, `:193-197`.
- Subredes IPv4/IPv6 y división: `src/components/tools/SubnetTool.tsx:39`, `:65-71`.
- Syslog UDP 514, `logging host`, filtro, severidad, archivo diario; 514 → 1514: `settings.ts:160`, `src/components/tools/SyslogTool.tsx:81-84`, `:103-107`.

## 12 Respaldos y comparación
- Solo comandos de consulta; hasta 3 a la vez: `src/components/tools/BackupTool.tsx:27-28`, `:167`.
- Enmascarar secretos activo: `BackupTool.tsx:202`, `:265`.
- **Cambio v0.9.7**: "secreto cambiado" en la comparación entre fechas del mismo equipo, con huella HMAC-SHA256 por secreto: `src/lib/diff.ts:225-233`, `src/components/tools/DiffView.tsx:74`, `BackupTool.tsx:265`, `README.md:44`.
- A y B, Comparar, agregadas/quitadas, pliegues, copiar y exportar: `BackupTool.tsx`, `DiffView.tsx`, `README.md:44`.

## 13 Cierre
- Resumen de lo anterior; sin afirmaciones nuevas.

## Fuentes externas
- RFC 1350, The TFTP Protocol (Revision 2), sección 2: cada paquete de datos espera su ACK antes del siguiente. https://www.rfc-editor.org/rfc/rfc1350
- RFC 5798 (VRRP, MAC virtual) y Cisco "Configuring HSRP" (MAC virtual), citadas en `README.md:251`.
- Velocidad real de la narración: 295 palabras del capítulo 07 del video 1 sintetizadas con Kokoro (`ef_dora`, velocidad 1.0) duran 116,4 s, es decir 152 palabras por minuto con pausas incluidas (medido en la auditoría).
