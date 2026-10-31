"""
Demostración de ask_secret para el video 3 (no envía nada al equipo).

El valor se escribe en un campo oculto de la app; si el script lo imprime, la app lo
enmascara en sus mensajes.
"""
import netterminal as nt

clave = nt.ask_secret("Clave de enable")
print(f"Clave recibida: {clave}")
