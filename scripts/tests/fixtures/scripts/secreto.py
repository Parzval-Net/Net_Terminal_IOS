# ask_secret: el valor se usa, pero la app lo enmascara en todo lo que muestra.
import sys

import netterminal as nt

clave = nt.ask_secret("Contraseña de enable")
print(f"recibida: {clave}")
nt.run("show privilege")
nt.sendline(clave)  # respuesta a un pedido de contraseña: no se confirma
nt.wait_for(r"#\s*$")
nt.run(f"username ops secret {clave}")  # cambio: la confirmación muestra la clave enmascarada
if "--falla" in sys.argv or nt.data_dir.endswith("falla"):
    raise ValueError(f"falla con {clave}")
print("listo")
