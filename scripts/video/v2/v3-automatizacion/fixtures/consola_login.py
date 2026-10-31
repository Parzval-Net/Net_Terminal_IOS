import netterminal as nt

s = nt.on("consola-core")          # una sesión con contraseña guardada
s.sendline("login")
s.expect(r"[Pp]assword:\s*$")      # el pedido tiene que estar en pantalla
s.type_saved_password()            # RuntimeError con el motivo si no se puede
s.expect(r"[>#]\s*$")
print(s.run("show clock"))
