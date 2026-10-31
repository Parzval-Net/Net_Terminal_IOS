"""
Resumen de solo lectura del equipo de la sesión activa (script de ejemplo de NetTerminal).

Cópialo a la carpeta scripts/ de NetTerminal (barra de botones > Scripts > Abrir carpeta de
scripts) y ejecútalo con una sesión conectada, desde el menú Scripts o desde un botón.
Usa solo comandos de consulta. Lo que imprime con print() aparece como aviso en la app.
"""
import re

import netterminal as nt

equipo = nt.session.get("name", "equipo")
nt.log(f"Revisando {equipo}")

version = nt.run("show version | include Version|uptime", timeout=30)
interfaces = nt.run("show interfaces | include line protocol", timeout=30)
ping = nt.run("ping 192.0.2.1", timeout=30)

lineas = interfaces.splitlines()
arriba = sum("line protocol is up" in linea for linea in lineas)
abajo = sum("line protocol is down" in linea for linea in lineas)
exito = re.search(r"Success rate is (\d+) percent", ping)

print(f"{equipo}: {arriba} interfaces arriba, {abajo} abajo")
print(f"Ping 192.0.2.1: {exito.group(1) + ' %' if exito else 'sin respuesta'}")
for linea in version.splitlines():
    if linea.strip():
        print(linea.strip())
