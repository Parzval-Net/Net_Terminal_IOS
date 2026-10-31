"""Diagnóstico básico: plugin de ejemplo para NetTerminal (solo lectura)."""
import os
import re

import netterminal as nt

ACCION = os.environ.get("NT_ACTION", "")


def version():
    salida = nt.run("show version | include Version|uptime", timeout=30)
    for linea in salida.splitlines():
        print(linea.strip())


def interfaces():
    salida = nt.run("show interfaces | include line protocol", timeout=30)
    abajo = [l.split()[0] for l in salida.splitlines() if "protocol is down" in l]
    arriba = [l.split()[0] for l in salida.splitlines() if "protocol is up" in l]
    print(f"{len(arriba)} arriba, {len(abajo)} abajo")
    if abajo:
        print("Abajo: " + ", ".join(abajo))


def ping():
    salida = nt.run("ping 192.0.2.1", timeout=30)
    exito = re.search(r"Success rate is (\d+) percent", salida)
    print(f"Ping 192.0.2.1: {exito.group(1)} %" if exito else salida.strip())


ACCIONES = {"version": version, "interfaces": interfaces, "ping": ping}

if ACCION in ACCIONES:
    ACCIONES[ACCION]()
else:
    print(f"Acción desconocida: {ACCION}")
