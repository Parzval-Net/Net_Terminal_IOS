"""
Inventario de switches Cisco IOS / IOS-XE a un CSV (solo lectura).

Lánzalo con varias sesiones como destino (pestañas elegidas, una carpeta o los paneles
visibles): recorre cada una con nt.for_each, de a una o en paralelo según lo que elijas al
lanzarlo, y agrega o actualiza la fila de cada equipo en

    <carpeta de datos>/reportes/inventario.csv

Con una versión de NetTerminal sin la API de varias sesiones trabaja con la sesión activa:
ejecútalo en cada pestaña y cada ejecución actualiza la fila de ese equipo.

Columnas: equipo, host, modelo, serie, versión, tiempo encendido, puertos por estado
(show interfaces status), resultado y fecha. Usa solo comandos de consulta, así que corre
en modo de solo lectura sin pedir confirmaciones.
"""
import csv
import datetime
import pathlib
import re

import netterminal as nt

ARCHIVO = pathlib.Path(nt.data_dir) / "reportes" / "inventario.csv"
COLUMNAS = ["equipo", "host", "modelo", "serie", "version", "encendido",
            "conectados", "libres", "deshabilitados", "err_disabled", "resultado", "fecha"]
# Un rechazo del usuario detiene el script: no se anota como error del equipo.
RECHAZO = getattr(nt, "ScriptDenied", ())


def buscar(patron, texto):
    """Primer grupo de la expresión en el texto, o vacío si no aparece."""
    m = re.search(patron, texto, re.MULTILINE)
    return m.group(1).strip() if m else ""


def leer_version(salida):
    return {
        "version": buscar(r"Version ([\w.()]+)", salida),
        "encendido": buscar(r"uptime is (.+)", salida),
        "modelo": buscar(r"^Model [Nn]umber\s*:\s*(\S+)", salida) or buscar(r"^cisco (\S+) .*processor", salida),
        "serie": buscar(r"^System [Ss]erial [Nn]umber\s*:\s*(\S+)", salida) or buscar(r"^Processor board ID (\S+)", salida),
    }


def contar_puertos(salida):
    """Cuenta los puertos por estado leyendo la columna Status por su posición."""
    lineas = [l.rstrip() for l in salida.splitlines()]
    encabezado = next((l for l in lineas if l.startswith("Port") and "Status" in l), None)
    if encabezado is None:
        return None  # el equipo no tiene ese comando (por ejemplo, un router)
    inicio = encabezado.index("Status")
    fin = encabezado.index("Vlan") if "Vlan" in encabezado else inicio + 13
    estados = [l[inicio:fin].strip() for l in lineas[lineas.index(encabezado) + 1:] if l.strip()]
    return {
        "conectados": estados.count("connected"),
        "libres": estados.count("notconnect"),
        "deshabilitados": estados.count("disabled"),
        "err_disabled": estados.count("err-disabled"),
    }


def celda(valor):
    """Evita que Excel interprete como fórmula un texto que viene del equipo."""
    texto = str(valor)
    return "'" + texto if texto[:1] in ("=", "+", "-", "@") else texto


def inventariar(s):
    """Fila del equipo de la sesión `s`: nt.on(...) o, en versiones anteriores, el módulo nt."""
    fila = {c: "" for c in COLUMNAS}
    fila.update(equipo=s.session.get("name", "equipo"), host=s.session.get("host", ""),
                fecha=datetime.datetime.now().strftime("%Y-%m-%d %H:%M"))
    try:
        s.run("terminal length 0", timeout=10)  # sin paginación (--More--)
        fila.update(leer_version(s.run("show version", timeout=30)))
        puertos = contar_puertos(s.run("show interfaces status", timeout=30))
        if puertos is None:
            fila["resultado"] = "sin show interfaces status"
        else:
            fila.update(puertos)
            fila["resultado"] = "ok"
    except RECHAZO:
        raise
    except nt.ScriptTimeout as e:
        fila["resultado"] = "sin respuesta a tiempo"
        print(f"{fila['equipo']}: no devolvió el prompt a tiempo. Últimos datos: {e.output[-80:]!r}")
    except RuntimeError as e:
        fila["resultado"] = f"error: {e}"
        print(f"{fila['equipo']}: error de la sesión: {e}")
    return fila


if hasattr(nt, "for_each"):
    destinos = nt.sessions()
    resultados = nt.for_each(inventariar)
    nuevas = []
    for info in destinos:
        r = resultados[info["name"]]
        if isinstance(r, Exception):  # falla del script en ese equipo, no de la sesión
            r = {**{c: "" for c in COLUMNAS}, "equipo": info["name"], "host": info.get("host", ""),
                 "resultado": f"error: {r}", "fecha": datetime.datetime.now().strftime("%Y-%m-%d %H:%M")}
        nuevas.append(r)
else:
    nuevas = [inventariar(nt)]  # versión anterior de NetTerminal: solo la sesión activa

# Lee el CSV existente, reemplaza las filas de estos equipos y lo vuelve a escribir.
ARCHIVO.parent.mkdir(parents=True, exist_ok=True)
filas = {}
if ARCHIVO.exists():
    with ARCHIVO.open(newline="", encoding="utf-8") as f:
        filas = {r["equipo"]: r for r in csv.DictReader(f)}
for fila in nuevas:
    nueva = {c: celda(v) for c, v in fila.items()}
    filas[nueva["equipo"]] = nueva
with ARCHIVO.open("w", newline="", encoding="utf-8") as f:
    w = csv.DictWriter(f, fieldnames=COLUMNAS)
    w.writeheader()
    w.writerows(filas[k] for k in sorted(filas))

for fila in nuevas:
    print(f"{fila['equipo']}: {fila['modelo'] or '?'} {fila['version'] or '?'}, {fila['resultado']}")
print(f"{len(filas)} equipos en {ARCHIVO}")
