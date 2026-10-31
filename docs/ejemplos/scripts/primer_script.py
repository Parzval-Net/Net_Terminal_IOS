"""
Primer script: muestra los datos de la sesión activa y la versión del equipo (solo lectura).

Cópialo a la carpeta scripts/ de NetTerminal (barra de botones > Scripts > Abrir carpeta de
scripts) y ejecútalo con una sesión conectada. Lo que imprime con print() aparece como aviso.
"""
import netterminal as nt

# Datos de la pestaña activa: nombre, tipo, host, puerto, usuario y puerto serial.
equipo = nt.session.get("name", "equipo")
print(f"Sesión: {equipo} ({nt.session.get('type')} a {nt.session.get('host')})")

# run() envía el comando, espera el prompt y devuelve solo la salida.
salida = nt.run("show version | include Version|uptime", timeout=30)
for linea in salida.splitlines():
    if linea.strip():
        print(linea.strip())
