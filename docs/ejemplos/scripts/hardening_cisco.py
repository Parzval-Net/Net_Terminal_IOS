"""
Hardening base para Cisco IOS / IOS-XE (script de ejemplo de NetTerminal).

Aplica servicios mínimos, SSH v2 con llaves RSA de 2048 bits, timestamps, logging y NTP, y
guarda la configuración. Funciona en una o varias sesiones (destino elegido al lanzarlo).

Uso:
  1. Cópialo a la carpeta scripts/ de NetTerminal (barra de botones > Scripts > Abrir carpeta
     de scripts) y crea un botón de tipo "Script Python" que lo use.
  2. Lánzalo con las sesiones conectadas y en modo privilegiado (prompt #).
  3. Marca "permitir cambios"; si no, la app pide confirmar cada línea de configuración.

Antes de cambiar nada revisa que el equipo tenga un hostname propio (las llaves RSA lo
exigen). Si las llaves ya son de 2048 bits no las regenera; si son de otro tamaño, responde
"yes" al reemplazo. Los comandos que el equipo no soporta (por ejemplo clock calendar-valid en
un switch sin reloj de hardware) se informan y no detienen el resto.

Líneas vty (solo SSH): se aplican "transport input ssh" y el método de login únicamente si:
  - el equipo tiene con qué autenticar: usuarios locales (se agrega "login local") o, con
    "aaa new-model", una lista "aaa authentication login" (no se toca el login);
  - SSH quedó habilitado (llaves RSA y versión 2) al final de la configuración;
  - la sesión del script no es Telnet (con APLICAR_VTY_DESDE_TELNET = False): cortar Telnet
    sin haber probado SSH desde tu red podría dejarte sin acceso remoto.
Si falta algo, se omite el cambio de vty, se informa el motivo y el resto se aplica igual.
"""
import re

import netterminal as nt

DOMINIO = "CSA.cl"
NTP = "192.168.60.1"
MODULO = 2048
APLICAR_VTY_DESDE_TELNET = False

# En orden de aplicación. None marca el punto donde se generan las llaves RSA.
COMANDOS = [
    "service password-encryption",
    "no ip http server",
    "no ip http secure-server",
    "no ip domain-lookup",
    "no service pad",
    "no service udp-small-servers",
    "no service tcp-small-servers",
    "no ip bootp server",
    "no ip http authentication",
    "no ip http timeout-policy idle",
    f"ip domain-name {DOMINIO}",
    None,
    "ip ssh version 2",
    "service timestamps debug datetime localtime",
    "service timestamps log datetime localtime",
    "service sequence-numbers",
    "logging buffered 52000",
    "logging trap 4",
    f"ntp server {NTP}",
    "ntp update-calendar",
    "clock calendar-valid",
]

# Dependen de la plataforma o la versión: si el equipo no los tiene, se informa y se sigue.
OPCIONALES = {
    "no ip http authentication",
    "no ip http timeout-policy idle",
    "ntp update-calendar",
    "clock calendar-valid",
}

PROMPT = r"#\s*$"
ERROR = re.compile(
    r"^\s*%\s*(?:Invalid|Incomplete|Ambiguous|Unknown|Unrecognized|Please define|.*not supported|.*failed).*",
    re.M | re.I,
)
HOSTNAME_FABRICA = {"router", "switch", "ios", "csr1000v", "cat9k"}


def error_de(salida):
    m = ERROR.search(salida)
    return m.group(0).strip() if m else None


def modulo_actual(s):
    """Tamaño de las llaves RSA según show ip ssh (None si no hay llaves o no lo informa)."""
    salida = s.run("show ip ssh", PROMPT)
    if re.search(r"SSH Disabled", salida, re.I):
        return None
    m = re.search(r"Modulus Size\s*:\s*(\d+)", salida, re.I)
    return int(m.group(1)) if m else None


def plan_vty(s):
    """Validación de solo lectura. Devuelve (rangos vty, usar "login local", motivo si se omite)."""
    rangos = re.findall(r"^line vty (\d+(?: \d+)?)\s*$", s.run("show running-config | include ^line vty", PROMPT, 60), re.M)
    if not rangos:
        return [], False, "el equipo no muestra líneas vty"
    if (s.session or {}).get("type") == "telnet" and not APLICAR_VTY_DESDE_TELNET:
        return [], False, "la sesión es Telnet; prueba SSH desde tu red y vuelve a lanzarlo por SSH o consola"
    aaa = s.run("show running-config | include ^aaa new-model|^aaa authentication login", PROMPT, 60)
    if re.search(r"^aaa new-model", aaa, re.M):
        if not re.search(r"^aaa authentication login", aaa, re.M):
            return [], False, "hay aaa new-model sin 'aaa authentication login'"
        return rangos, False, None
    usuarios = re.findall(r"^username (\S+) .*(?:secret|password) ", s.run("show running-config | include ^username", PROMPT, 60), re.M)
    if not usuarios:
        return [], False, "no hay usuarios locales con clave (username ... secret)"
    return rangos, True, None


def aplicar_vty(s, rangos, login_local):
    salida = s.run("do show ip ssh", PROMPT)
    if not re.search(r"SSH Enabled - version 2", salida, re.I):
        return "SSH no quedó habilitado en versión 2"
    for rango in rangos:
        for cmd in [f"line vty {rango}", "transport input ssh", *(["login local"] if login_local else []), "exit"]:
            e = error_de(s.run(cmd, PROMPT))
            if e:
                return f"{cmd}: {e}"
    return None


def generar_llaves(s):
    s.clear()
    s.sendline(f"crypto key generate rsa general-keys modulus {MODULO}")
    salida = ""
    # Equipos lentos tardan bastante en generar 2048 bits.
    for _ in range(3):
        salida += s.wait_for(r"(\[yes/no\]:?\s*$|#\s*$)", timeout=300)
        if re.search(r"\[yes/no\]:?\s*$", salida):
            s.sendline("yes")
            continue
        break
    return error_de(salida)


def guardar(s):
    s.clear()
    s.sendline("write memory")
    salida = s.wait_for(r"(\[confirm\]\s*$|#\s*$)", timeout=120)
    if re.search(r"\[confirm\]\s*$", salida):
        s.sendline("")
        salida += s.wait_for(PROMPT, timeout=120)
    return error_de(salida)


def aplicar(s):
    nombre = s.name or nt.session.get("name", "equipo")
    s.run("terminal length 0")

    s.clear()
    s.sendline("")
    if not re.search(PROMPT, s.wait_for(r"[#>]\s*$", timeout=15)):
        raise RuntimeError("requiere modo privilegiado (enable): no se aplicó nada")

    host = re.search(r"^hostname\s+(\S+)", s.run("show running-config | include ^hostname", PROMPT, 60), re.M)
    if not host or host.group(1).lower() in HOSTNAME_FABRICA:
        raise RuntimeError("configura un hostname propio antes (las llaves RSA lo exigen): no se aplicó nada")

    modulo = modulo_actual(s)
    regenerar = modulo != MODULO
    rangos, login_local, sin_vty = plan_vty(s)
    nt.log(f"{nombre}: llaves RSA actuales {modulo or 'sin llaves'}; {'se generan' if regenerar else 'se mantienen'} {MODULO} bits")

    errores, omitidos = [], []
    s.run("configure terminal", PROMPT)
    try:
        for cmd in COMANDOS:
            if cmd is None:
                if regenerar and (e := generar_llaves(s)):
                    errores.append(f"crypto key generate rsa: {e}")
                continue
            e = error_de(s.run(cmd, PROMPT))
            if e:
                (omitidos if cmd in OPCIONALES else errores).append(f"{cmd}: {e}")
        # Las vty se cierran a SSH al final y solo si todo lo anterior salió bien.
        if not sin_vty and errores:
            sin_vty = "hubo errores en comandos anteriores"
        if not sin_vty:
            sin_vty = aplicar_vty(s, rangos, login_local)
            if sin_vty:
                errores.append(f"vty: {sin_vty}")
    finally:
        s.run("end", PROMPT)

    if errores:
        raise RuntimeError("no se guardó la configuración por errores en: " + "; ".join(errores))
    e = guardar(s)
    if e:
        raise RuntimeError(f"write memory: {e}")

    final = modulo_actual(s)
    ssh = s.run("show ip ssh | include version", PROMPT)
    resumen = f"OK. RSA {final or '?'} bits, {ssh.strip() or 'SSH sin datos'}"
    if sin_vty:
        resumen += f". vty sin cambios: {sin_vty}"
    else:
        resumen += f". vty {', '.join(rangos)} solo SSH{' con login local' if login_local else ' (login por AAA)'}"
    if omitidos:
        resumen += ". No soportados: " + "; ".join(c.split(":")[0] for c in omitidos)
    return resumen


if not nt.allow_changes:
    nt.log("Sin 'permitir cambios' la app pedirá confirmar cada línea de configuración.")

for equipo, resultado in nt.for_each(aplicar).items():
    if isinstance(resultado, Exception):
        print(f"{equipo}: ERROR, {resultado}")
    else:
        print(f"{equipo}: {resultado}")
