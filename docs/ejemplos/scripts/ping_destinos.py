"""
Ping a varios destinos desde el equipo de la sesión activa (solo lectura).

Muestra las funciones de bajo nivel de la API: clear, sendline, wait_for y read, y cómo
manejar un tiempo agotado. Un ping sin respuesta en Cisco tarda unos 10 segundos (5 envíos
de 2 s), más que la espera de 8 s: ahí el script recoge el resto con read().
"""
import re

import netterminal as nt

DESTINOS = ["192.0.2.1", "192.0.2.10", "198.51.100.20"]
PROMPT = r"[#>]\s*$"

resultados = []
for destino in DESTINOS:
    nt.clear()  # descarta la salida anterior
    nt.sendline(f"ping {destino}")  # envía el comando con Enter
    try:
        salida = nt.wait_for(PROMPT, timeout=8)  # espera el prompt, máximo 8 s
    except nt.ScriptTimeout as e:
        # No volvió el prompt a tiempo: se guarda lo recibido y se lee hasta que el equipo
        # deja de enviar datos por 3 s (máximo 30 s).
        print(f"{destino}: más de 8 s, esperando el final")
        salida = e.output + nt.read(idle=3, timeout=30)
    exito = re.search(r"Success rate is (\d+) percent", salida)
    porcentaje = int(exito.group(1)) if exito else 0
    resultados.append((destino, porcentaje))
    print(f"{destino}: {porcentaje} %")

sin_respuesta = [d for d, p in resultados if p == 0]
print("Sin respuesta: " + ", ".join(sin_respuesta) if sin_respuesta else "Todos los destinos responden")
