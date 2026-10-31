"""Revisión de puertos: plugin de ejemplo para NetTerminal (solo comandos de consulta)."""
import csv
import os
import pathlib

import netterminal as nt
from analisis import errores_por_puerto, tabla_estado

ACCION = os.environ.get("NT_ACTION", "")
EQUIPO = nt.session.get("name", "equipo")


def leer_tabla():
    nt.run("terminal length 0", timeout=10)
    filas = tabla_estado(nt.run("show interfaces status", timeout=30))
    if filas is None:
        print(f"{EQUIPO} no responde a show interfaces status (¿es un switch Cisco?)")
    return filas


def resumen():
    filas = leer_tabla()
    if filas is None:
        return
    estados = {}
    for f in filas:
        estados[f["estado"]] = estados.get(f["estado"], 0) + 1
    print(f"{EQUIPO}: {len(filas)} puertos · " + ", ".join(f"{n} {e}" for e, n in sorted(estados.items())))
    caidos = [f["puerto"] for f in filas if f["estado"] == "err-disabled"]
    if caidos:
        print("err-disabled: " + ", ".join(caidos))


def errores():
    nt.run("terminal length 0", timeout=10)
    con_error = errores_por_puerto(nt.run("show interfaces counters errors", timeout=30))
    if not con_error:
        print(f"{EQUIPO}: sin errores en los contadores")
    for puerto, total in sorted(con_error.items(), key=lambda x: -x[1]):
        print(f"{puerto}: {total} errores")


def celda(texto):
    """Un texto del equipo que empieza con = + - @ no debe abrirse como fórmula en Excel."""
    return "'" + texto if texto[:1] in ("=", "+", "-", "@") else texto


def exportar():
    filas = leer_tabla()
    if filas is None:
        return
    archivo = pathlib.Path(nt.data_dir) / "reportes" / f"puertos-{EQUIPO.replace('/', '-')}.csv"
    archivo.parent.mkdir(parents=True, exist_ok=True)
    with archivo.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["puerto", "nombre", "estado", "vlan"])
        w.writeheader()
        for fila in filas:
            w.writerow({k: celda(v) for k, v in fila.items()})
    print(f"{len(filas)} puertos exportados a {archivo}")


ACCIONES = {"resumen": resumen, "errores": errores, "exportar": exportar}

try:
    ACCIONES.get(ACCION, lambda: print(f"Acción desconocida: {ACCION}"))()
except nt.ScriptTimeout:
    print(f"{EQUIPO} no devolvió el prompt a tiempo. Revisa la sesión y vuelve a intentar.")
