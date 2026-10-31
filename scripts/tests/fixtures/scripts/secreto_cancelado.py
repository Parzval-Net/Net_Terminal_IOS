# Cancelar el diálogo de secreto lanza ScriptDenied; el script puede seguir.
import netterminal as nt

try:
    nt.ask_secret("Token")
except nt.ScriptDenied as e:
    print("cancelado:", e)
print("sigue")
