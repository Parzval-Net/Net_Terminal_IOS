"""
API de scripts de NetTerminal (equivalente simple a crt.Screen de SecureCRT).

Se ejecuta con el Python del sistema y solo usa la biblioteca estándar. NetTerminal
copia este archivo a la carpeta de scripts; no hace falta instalar nada.

    import netterminal as nt

    nt.run("terminal length 0")
    salida = nt.run("show ip interface brief")
    print(salida)                      # print() aparece en la app

Sesión principal (la pestaña activa, o la primera de los destinos elegidos):
    send(texto)                 Envía texto tal cual.
    sendline(texto="")          Envía texto + Enter.
    wait_for(regex, timeout, return_match_only=False)
                                Espera hasta que la salida coincida. Devuelve TODO lo
                                acumulado desde la última lectura (eco del comando
                                incluido), no solo la coincidencia, y también lo que llegó
                                después de ella en el mismo fragmento. Con
                                return_match_only=True devuelve solo hasta el final de la
                                coincidencia y deja el resto para la próxima lectura.
    expect(regex, timeout)      Igual a wait_for(..., return_match_only=True).
    read(idle=1, timeout=10)    Lee hasta que el equipo deja de enviar por `idle` segundos.
    run(cmd, prompt, timeout)   sendline + espera el prompt; devuelve solo la salida del comando.
    clear()                     Descarta la salida pendiente.
    log(msg)                    Muestra un mensaje en la app.
    session                     dict con name, type, host, port, username, serial_port.
    data_dir                    Carpeta de datos de NetTerminal (para guardar respaldos, etc.).

Varias sesiones (las que el usuario eligió al lanzar el script, nunca otras):
    sessions()                  Lista de dict con name, type, host, port y platform. Nunca
                                incluye contraseñas ni usuarios.
    on(nombre)                  Objeto con send, sendline, wait_for, expect, read, run y clear
                                ligados a esa sesión, más .name y .session.
    for_each(fn, parallel=None) Llama fn(sesion) para cada destino. Por defecto de a uno; con
                                parallel=n usa hasta n a la vez, con el tope que el usuario
                                eligió al lanzar (máximo 4). Devuelve {nombre: resultado}; si fn
                                falló en una sesión, el resultado es la excepción.
    allow_changes               True si el usuario lanzó el script en modo "permitir cambios".
    max_parallel                Tope de sesiones en paralelo elegido por el usuario (1 a 4).

Secretos:
    ask_secret(etiqueta)        Pide un secreto al usuario en un diálogo de contraseña y lo
                                devuelve. La app lo enmascara en los mensajes del script y en
                                los diálogos de confirmación; no queda en logs ni historial.
                                Si el usuario cancela, lanza ScriptDenied.
    type_saved_password()       La app escribe la contraseña guardada de la sesión principal
                                (o de on(nombre).type_saved_password()) en el pedido de login
                                que su pantalla muestra ahora. El script nunca ve el valor.
                                Requiere que el usuario lo permita al lanzar el script (en
                                plugins, además el permiso "vault-type"), una sesión con
                                contraseña guardada y un pedido de login del equipo de destino
                                (no tras un rechazo ni en una passphrase). Una vez por pedido.
                                Si no se puede, lanza RuntimeError con el motivo.

Seguridad: cada línea que el script envía pasa por el motor de riesgo de la app. Las
consultas pasan; un cambio pide confirmación (salvo en modo "permitir cambios") y lo que
puede cortar servicio se confirma siempre, una vez por comando en cada ejecución. Si el
usuario rechaza, el script se detiene (ScriptDenied). Mientras el script corre, lo que el
usuario teclea en esas pestañas se rechaza para que no se mezcle con el script.
"""

import itertools
import json
import os
import re
import sys
import threading

__all__ = [
    "send", "sendline", "wait_for", "expect", "read", "run", "clear", "log", "session", "data_dir",
    "sessions", "on", "for_each", "ask_secret", "type_saved_password", "allow_changes", "max_parallel",
    "ScriptTimeout", "ScriptDenied", "Session",
]

_proto_out = sys.stdout
_proto_in = sys.stdin

session = json.loads(os.environ.get("NT_SESSION", "{}"))
data_dir = os.environ.get("NT_DATA_DIR", ".")
allow_changes = os.environ.get("NT_ALLOW_CHANGES") == "1"
try:
    max_parallel = max(1, min(4, int(os.environ.get("NT_MAX_PARALLEL", "1"))))
except ValueError:
    max_parallel = 1

DEFAULT_PROMPT = r"[#>$%\]]\s*$"


class ScriptTimeout(TimeoutError):
    """El patrón no apareció a tiempo. `.output` tiene lo recibido hasta entonces."""

    def __init__(self, message, output):
        super().__init__(message)
        self.output = output


class ScriptDenied(RuntimeError):
    """El usuario rechazó un comando o canceló un pedido, o el script fue detenido."""


# ---------- Protocolo: una línea JSON por pedido, respuestas con el mismo id ----------

_write_lock = threading.Lock()
_pending_lock = threading.Lock()
_pending = {}
_ids = itertools.count(1)
_reader = None
_closed = False


def _read_replies():
    global _closed
    for line in _proto_in:
        try:
            reply = json.loads(line)
        except ValueError:
            continue
        with _pending_lock:
            rid = reply.get("id")
            # Respuesta sin id (versiones anteriores): solo vale con un único pedido en curso.
            if rid is None and len(_pending) == 1:
                rid = next(iter(_pending))
            slot = _pending.pop(rid, None)
        if slot is not None:
            slot[1] = reply
            slot[0].set()
    with _pending_lock:
        _closed = True
        for slot in _pending.values():
            slot[0].set()
        _pending.clear()


def _call(op, **kwargs):
    global _reader
    kwargs["op"] = op
    rid = next(_ids)
    kwargs["id"] = rid
    slot = [threading.Event(), None]
    with _pending_lock:
        if _closed:
            raise SystemExit("NetTerminal cerró la conexión con el script")
        _pending[rid] = slot
        if _reader is None:
            _reader = threading.Thread(target=_read_replies, name="netterminal", daemon=True)
            _reader.start()
    with _write_lock:
        _proto_out.write(json.dumps(kwargs) + "\n")
        _proto_out.flush()
    slot[0].wait()
    reply = slot[1]
    if reply is None:
        raise SystemExit("NetTerminal cerró la conexión con el script")
    if not reply.get("ok"):
        code = reply.get("code") or reply.get("error")
        message = reply.get("error", "error desconocido")
        if code == "timeout":
            raise ScriptTimeout(f"Tiempo agotado esperando {kwargs.get('pattern')!r}", reply.get("output", ""))
        if code in ("denied", "cancelled"):
            raise ScriptDenied(message)
        raise RuntimeError(message)
    return reply


class _PrintToApp:
    """Redirige print() a la app: stdout se usa para hablar con NetTerminal."""

    def __init__(self):
        self._buf = ""
        self._lock = threading.RLock()

    def write(self, text):
        with self._lock:
            self._buf += text
            while "\n" in self._buf:
                line, self._buf = self._buf.split("\n", 1)
                _call("log", msg=line)
        return len(text)

    def flush(self):
        with self._lock:
            if self._buf:
                buf, self._buf = self._buf, ""
                _call("log", msg=buf)


sys.stdout = _PrintToApp()


# ---------- Sesiones ----------

class Session:
    """Operaciones ligadas a una sesión de los destinos. Se obtiene con on(nombre)."""

    def __init__(self, info=None):
        self.session = dict(info or {})
        self.name = self.session.get("name")
        # None = sesión principal (compatibilidad con scripts de una sola sesión).
        self._target = self.name if info is not None else None

    def __repr__(self):
        return f"<netterminal.Session {self.name!r}>"

    def _op(self, op, **kwargs):
        if self._target is not None:
            kwargs["session"] = self._target
        return _call(op, **kwargs)

    def send(self, text):
        self._op("send", data=str(text))

    def sendline(self, text=""):
        self.send(f"{text}\r")

    def wait_for(self, pattern, timeout=10, return_match_only=False):
        kwargs = {"pattern": pattern, "timeout": float(timeout)}
        if return_match_only:
            kwargs["return_match_only"] = True
        return self._op("wait", **kwargs)["output"]

    def expect(self, pattern, timeout=10):
        """Espera el patrón y devuelve solo hasta el final de la coincidencia."""
        return self.wait_for(pattern, timeout, return_match_only=True)

    def read(self, idle=1.0, timeout=10):
        return self._op("read", idle=float(idle), timeout=float(timeout))["output"]

    def clear(self):
        self._op("clear")

    def type_saved_password(self):
        """La app escribe la contraseña guardada en el pedido de login actual; no la devuelve."""
        self._op("type_saved_password")

    def run(self, command, prompt=DEFAULT_PROMPT, timeout=30):
        """Ejecuta un comando y devuelve su salida, sin el eco del comando ni el prompt final."""
        self.clear()
        self.sendline(command)
        out = self.wait_for(prompt, timeout)
        lines = out.split("\n")
        if lines and command.strip() and command.strip() in lines[0]:
            lines = lines[1:]
        if lines and re.search(prompt, lines[-1]):
            lines = lines[:-1]
        return "\n".join(lines)


_main = Session()


def send(text):
    _main.send(text)


def sendline(text=""):
    _main.sendline(text)


def wait_for(pattern, timeout=10, return_match_only=False):
    return _main.wait_for(pattern, timeout, return_match_only)


def expect(pattern, timeout=10):
    return _main.expect(pattern, timeout)


def read(idle=1.0, timeout=10):
    return _main.read(idle, timeout)


def clear():
    _main.clear()


def run(command, prompt=DEFAULT_PROMPT, timeout=30):
    return _main.run(command, prompt, timeout)


def log(msg):
    _call("log", msg=str(msg))


def sessions():
    """Destinos que el usuario eligió al lanzar el script (sin credenciales)."""
    return [dict(s) for s in _call("sessions")["sessions"]]


def on(name):
    """Sesión de los destinos por nombre (o el dict que devuelve sessions())."""
    if isinstance(name, dict):
        name = name.get("name")
    for info in sessions():
        if info.get("name") == name:
            return Session(info)
    raise RuntimeError(f"La sesión {name!r} no está entre los destinos elegidos al lanzar el script")


def for_each(fn, parallel=None, targets=None):
    """Llama fn(sesion) en cada destino; devuelve {nombre: resultado o excepción}."""
    handles = [t if isinstance(t, Session) else on(t) for t in targets] if targets is not None else [
        Session(info) for info in sessions()
    ]
    workers = max(1, min(int(parallel or max_parallel), max_parallel, len(handles) or 1))
    results = {}

    def one(h):
        try:
            return fn(h)
        except (ScriptDenied, SystemExit):
            raise
        except Exception as e:  # noqa: BLE001 - se entrega al script por sesión
            return e

    if workers == 1:
        for h in handles:
            results[h.name] = one(h)
        return results

    from concurrent.futures import ThreadPoolExecutor

    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = [(h.name, pool.submit(one, h)) for h in handles]
        for name, fut in futures:
            results[name] = fut.result()
    return results


def type_saved_password():
    """Contraseña guardada de la sesión principal escrita por la app (el script no la ve)."""
    _main.type_saved_password()


def ask_secret(label="Secreto"):
    """Pide un secreto en un diálogo de contraseña de la app y lo devuelve."""
    return _call("ask_secret", label=str(label))["value"]
