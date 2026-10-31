# Consultas, cambios y comandos que cortan servicio en tres sesiones.
import netterminal as nt

print("modo:", "cambios" if nt.allow_changes else "lectura")
nt.for_each(lambda s: s.run("show clock"))


def configurar(s):
    s.run("configure terminal")
    s.run("interface Gi1/0/5")
    s.run("description enlace")
    s.run("shutdown")
    s.run("end")


for nombre, r in nt.for_each(configurar).items():
    if isinstance(r, Exception):
        print(f"{nombre}: {r}")
nt.run("reload")
print("fin")
