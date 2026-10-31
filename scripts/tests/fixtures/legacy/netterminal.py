"""
API de scripts de NetTerminal (equivalente simple a crt.Screen de SecureCRT).

Se ejecuta con el Python del sistema y solo usa la biblioteca estándar. NetTerminal
copia este archivo a la carpeta de scripts; no hace falta instalar nada.

    import netterminal as nt

    nt.run("terminal length 0")
    salida = nt.run("show ip interface brief")
    print(salida)                      # print() aparece en la barra de estado de la app

Funciones:
    send(texto)                 Envía texto tal cual.
    sendline(texto="")          Envía texto + Enter.
    wait_for(regex, timeout)    Espera hasta que la salida coincida; devuelve lo recibido.
    read(idle=1, timeout=10)    Lee hasta que el equipo deja de enviar por `idle` segundos.
    run(cmd, prompt, timeout)   sendline + espera el prompt; devuelve solo la salida del comando.
    clear()                     Descarta la salida pendiente.
    log(msg)                    Muestra un mensaje en la app.
    session                     dict con name, type, host, port, username, serial_port.
    data_dir                    Carpeta de datos de NetTerminal (para guardar respaldos, etc.).
"""

import json
import os
import re
import sys

__all__ = ["send", "sendline", "wait_for", "read", "run", "clear", "log", "session", "data_dir"]

_proto_out = sys.stdout
_proto_in = sys.stdin

session = json.loads(os.environ.get("NT_SESSION", "{}"))
data_dir = os.environ.get("NT_DATA_DIR", ".")

DEFAULT_PROMPT = r"[#>$%\]]\s*$"


class ScriptTimeout(TimeoutError):
    """El patrón no apareció a tiempo. `.output` tiene lo recibido hasta entonces."""

    def __init__(self, message, output):
        super().__init__(message)
        self.output = output


def _call(op, **kwargs):
    kwargs["op"] = op
    _proto_out.write(json.dumps(kwargs) + "\n")
    _proto_out.flush()
    line = _proto_in.readline()
    if not line:
        raise SystemExit("NetTerminal cerró la conexión con el script")
    reply = json.loads(line)
    if not reply.get("ok"):
        if reply.get("error") == "timeout":
            raise ScriptTimeout(f"Tiempo agotado esperando {kwargs.get('pattern')!r}", reply.get("output", ""))
        raise RuntimeError(reply.get("error", "error desconocido"))
    return reply


class _PrintToApp:
    """Redirige print() a la app: stdout se usa para hablar con NetTerminal."""

    def __init__(self):
        self._buf = ""

    def write(self, text):
        self._buf += text
        while "\n" in self._buf:
            line, self._buf = self._buf.split("\n", 1)
            _call("log", msg=line)
        return len(text)

    def flush(self):
        if self._buf:
            _call("log", msg=self._buf)
            self._buf = ""


sys.stdout = _PrintToApp()


def send(text):
    _call("send", data=str(text))


def sendline(text=""):
    send(f"{text}\r")


def wait_for(pattern, timeout=10):
    return _call("wait", pattern=pattern, timeout=float(timeout))["output"]


def read(idle=1.0, timeout=10):
    return _call("read", idle=float(idle), timeout=float(timeout))["output"]


def clear():
    _call("clear")


def log(msg):
    _call("log", msg=str(msg))


def run(command, prompt=DEFAULT_PROMPT, timeout=30):
    """Ejecuta un comando y devuelve su salida, sin el eco del comando ni el prompt final."""
    clear()
    sendline(command)
    out = wait_for(prompt, timeout)
    lines = out.split("\n")
    if lines and command.strip() and command.strip() in lines[0]:
        lines = lines[1:]
    if lines and re.search(prompt, lines[-1]):
        lines = lines[:-1]
    return "\n".join(lines)
