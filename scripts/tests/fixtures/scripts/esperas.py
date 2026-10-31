# Tiempos: una espera que vence (ScriptTimeout) y un bucle sin fin que corta el tiempo máximo
# o "Detener script".
import time

import netterminal as nt

try:
    nt.on("mudo").run("show clock", timeout=1)
except nt.ScriptTimeout as e:
    print("timeout:", repr(e.output))
print("esperando")
while True:
    nt.run("show clock")
    time.sleep(0.02)
