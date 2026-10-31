"""
Plugin de ejemplo para NetTerminal.

NetTerminal ejecuta este archivo con la acción elegida en NT_ACTION. La API
`netterminal` (nt) envía comandos a la sesión conectada y espera su salida.
print() aparece en la consola de plugins de la app.
"""
import csv
import datetime
import os
import pathlib
import re

import netterminal as nt

ACTION = os.environ.get("NT_ACTION", "")


def inventario():
    nt.run("terminal length 0")
    version = nt.run("show version", timeout=30)
    inventory = nt.run("show inventory", timeout=30)

    modelo = re.search(r"^[Cc]isco (\S+) .*processor", version, re.M)
    serie = re.search(r'PID:\s*(\S+)\s*,.*SN:\s*(\S+)', inventory)
    ios = re.search(r"Version ([\w.()]+)", version)
    uptime = re.search(r"uptime is (.+)", version)

    fila = {
        "fecha": datetime.datetime.now().isoformat(timespec="seconds"),
        "sesion": nt.session.get("name", ""),
        "host": nt.session.get("host", ""),
        "modelo": (serie.group(1) if serie else modelo.group(1) if modelo else ""),
        "serie": serie.group(2) if serie else "",
        "version": ios.group(1) if ios else "",
        "uptime": uptime.group(1).strip() if uptime else "",
    }

    archivo = pathlib.Path(nt.data_dir) / "inventario.csv"
    nuevo = not archivo.exists()
    with archivo.open("a", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(fila))
        if nuevo:
            w.writeheader()
        w.writerow(fila)

    print(f"{fila['sesion']}: {fila['modelo']} SN {fila['serie']} versión {fila['version']}")
    print(f"Guardado en {archivo}")


def caidas():
    nt.run("terminal length 0")
    salida = nt.run("show ip interface brief", timeout=30)
    caidas = [
        linea.split()[0]
        for linea in salida.splitlines()
        if re.search(r"\b(down|administratively down)\b", linea) and not linea.startswith("Interface")
    ]
    if caidas:
        print(f"{len(caidas)} interfaces caídas: {', '.join(caidas)}")
    else:
        print("Todas las interfaces con IP están arriba")


if ACTION == "inventario":
    inventario()
elif ACTION == "caidas":
    caidas()
else:
    print(f"Acción desconocida: {ACTION}")
