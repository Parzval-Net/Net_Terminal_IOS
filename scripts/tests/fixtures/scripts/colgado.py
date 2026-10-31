# Un equipo que no devuelve el prompt: solo "Detener script" corta la espera.
import netterminal as nt

print("esperando")
nt.run("show tech-support", timeout=600)
print("no debería llegar")
