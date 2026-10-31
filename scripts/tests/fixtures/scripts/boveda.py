# type_saved_password: la app escribe la contraseña guardada en el pedido de login; el script
# solo sabe si se escribió o por qué no.
import netterminal as nt

b = nt.on("dist-b")
b.sendline("login")
b.expect(r"Password:\s*$")
try:
    b.type_saved_password()
    print("dist-b: escrita")
except RuntimeError as e:
    print(f"dist-b: {e}")
# La sesión principal muestra un prompt de comandos, no un pedido de contraseña.
try:
    nt.type_saved_password()
except RuntimeError as e:
    print(f"dist-a: {e}")
print(b.run("show clock").strip())
