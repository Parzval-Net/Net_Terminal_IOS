# Política de seguridad

## Versiones soportadas

Solo la última versión publicada en [Releases](https://github.com/Parzval-Net/Net_Terminal/releases/latest) recibe correcciones de seguridad. Si usas una versión anterior, actualiza antes de reportar.

| Versión | Soporte |
| --- | --- |
| Última versión (`latest`) | Sí |
| Versiones anteriores | No |

## Cómo reportar una vulnerabilidad

No abras un issue público ni un PR con el detalle de la vulnerabilidad.

1. Entra a la pestaña **Security** del repositorio y usa **Report a vulnerability** ([enlace directo](https://github.com/Parzval-Net/Net_Terminal/security/advisories/new)). El reporte queda privado entre tú y el mantenedor.
2. Incluye la versión afectada, el sistema operativo, los pasos para reproducir y el impacto que observas. Si tienes una prueba de concepto, adjúntala en el reporte privado.
3. No incluyas contraseñas, IPs ni configuraciones reales de tus equipos de red.

Plazos de referencia: confirmación de recepción en 5 días hábiles y una evaluación inicial en 10 días hábiles. Una vez publicada la corrección se crea un GitHub Security Advisory y, si corresponde, se solicita un CVE.

## Modelo de confianza del actualizador

- La app solo instala actualizaciones firmadas con la clave del proyecto. La clave pública va dentro de la app (`src-tauri/tauri.conf.json`) y la firma se verifica antes de instalar; una descarga alterada se rechaza.
- El índice `latest.json` y los paquetes se descargan desde el Release más reciente de este repositorio. Quien controle la clave privada de firma puede publicar una actualización que las apps instaladas aceptarán, por eso esa clave vive solo en los secretos de GitHub Actions (environment `release`, con aprobación manual del mantenedor) y nunca en el repositorio.
- Los Releases se generan solo desde tags `v*` que apuntan a commits de `main` y cuya versión coincide con `tauri.conf.json`. Las acciones del workflow están fijadas a SHA y el token del workflow es de solo lectura salvo en el paso que crea el Release.
- Las instalaciones en modo portable y por `.deb` no se actualizan solas.

Si sospechas que la clave de firma o un Release fueron comprometidos, repórtalo de inmediato por el canal privado indicado arriba.

## Limitaciones conocidas

Estos puntos son conocidos y no se consideran vulnerabilidades. Evalúalos antes de distribuir la app en tu organización.

- **macOS sin Developer ID:** el build de macOS tiene firma ad-hoc, sin Developer ID, sin notarización de Apple y sin hardened runtime. Gatekeeper pide abrirla con clic derecho › Abrir, y sin hardened runtime el sistema no aplica las protecciones contra inyección de bibliotecas ni la validación de firma en tiempo de ejecución. Las actualizaciones automáticas sí se verifican con la firma minisign (Ed25519) del proyecto antes de instalar.
- **Windows y modo portable:** en Windows los datos dependen de los permisos (ACL) de `%APPDATA%`, que por defecto solo dan acceso al usuario, a SYSTEM y a los administradores. En modo portable sobre un pendrive FAT/exFAT no hay permisos de archivo: cualquiera con acceso al dispositivo puede copiar la carpeta `data`. Las contraseñas y las notas protegidas siguen cifradas, pero sesiones, notas normales y logs quedan en claro.
- **Servidores integrados:** TFTP, HTTP, FTP y Syslog están apagados por defecto y, al iniciarlos, escuchan en todas las interfaces (0.0.0.0) para que los equipos de red lleguen al PC. TFTP y HTTP no tienen autenticación por diseño del protocolo: cualquier equipo que alcance el puerto puede leer la carpeta compartida mientras el servidor está activo. FTP usa credenciales nuevas en cada inicio, pero viajan en claro. Úsalos solo en redes de gestión y detenlos al terminar. El receptor de traps SNMP es la excepción: escucha en 127.0.0.1 salvo que elijas otra IP.
- **SNMPv3 y localización de claves:** con USM (RFC 3414) la clave localizada se deriva de la contraseña y del engineID que informa el agente. Un agente falso que responda con un engineID elegido puede obtener material para atacar la contraseña fuera de línea. La app lo mitiga atando los secretos de cada perfil al host y puerto guardados: no se envían a un destino distinto. Usa contraseñas largas y únicas por dominio de gestión.
- **Scripts y plugins Python:** corren con los permisos de tu usuario. El control de riesgo (confirmación de cambios y cortes) cubre lo que envían por la API de `netterminal.py`; un script puede abrir sus propias conexiones o leer archivos, por eso los plugins pasan por revisión y conviene revisar los scripts antes de ejecutarlos. `ask_secret` enmascara el texto exacto del secreto en lo que el script muestra en la app, no versiones transformadas ni el eco que haga el equipo. Los scripts no tienen acceso a la bóveda de contraseñas: ninguna operación devuelve una contraseña guardada.
- **Contraseña guardada escrita por un script (`type_saved_password`):** con la casilla del diálogo de lanzamiento (por ejecución, apagada por defecto; en plugins además el permiso `vault-type`), la app escribe la contraseña guardada de un destino directo en el equipo cuando su pantalla muestra un pedido de login. Se aplican las reglas del autocompletado (destino igual al guardado, no tras un rechazo, no en una passphrase ni en un cambio de clave, un pedido que nombra a otro host se rechaza) y se responde una vez por pedido. El script no recibe el valor, pero controla la sesión: en un shell podría lanzar un programa que muestre un "Password:" genérico y reenvíe lo tecleado a otro equipo. Marca la casilla solo con scripts que revisaste y en sesiones de equipos de red.
- **Algoritmos SSH legacy:** la opción "Activar algoritmos legacy automáticamente" (apagada por defecto) acepta ssh-rsa, SHA1 y CBC cuando el equipo los exige. Son algoritmos débiles: actívala solo en redes de gestión confiables.
