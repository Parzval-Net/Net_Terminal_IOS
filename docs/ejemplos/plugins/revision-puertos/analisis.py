"""Lectura de las tablas de Cisco IOS / IOS-XE (sin acceso a la sesión ni a archivos)."""


def tabla_estado(salida):
    """Filas de `show interfaces status`, cortando cada columna por su posición en el encabezado."""
    lineas = [l.rstrip() for l in salida.splitlines()]
    enc = next((l for l in lineas if l.startswith("Port") and "Status" in l and "Vlan" in l), None)
    if enc is None:
        return None
    col = {n: enc.index(n) for n in ("Name", "Status", "Vlan", "Duplex")}
    filas = []
    for l in lineas[lineas.index(enc) + 1:]:
        if not l.strip():
            continue
        filas.append({
            "puerto": l[:col["Name"]].strip(),
            "nombre": l[col["Name"]:col["Status"]].strip(),
            "estado": l[col["Status"]:col["Vlan"]].strip(),
            "vlan": l[col["Vlan"]:col["Duplex"]].strip(),
        })
    return filas


def errores_por_puerto(salida):
    """Suma los contadores de `show interfaces counters errors` (puede traer varias tablas)."""
    total = {}
    for l in salida.splitlines():
        partes = l.split()
        if len(partes) > 1 and not partes[0].startswith("Port") and all(p.isdigit() for p in partes[1:]):
            total[partes[0]] = total.get(partes[0], 0) + sum(int(p) for p in partes[1:])
    return {p: n for p, n in total.items() if n > 0}
