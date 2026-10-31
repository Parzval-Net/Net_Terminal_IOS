# Varias sesiones: sessions(), for_each, on(nombre), expect y la sesión principal.
import netterminal as nt

info = nt.sessions()
print("destinos:", ",".join(s["name"] for s in info))
print("campos:", ",".join(sorted(info[0])))
res = nt.for_each(lambda s: s.run("show clock").strip())
for nombre, valor in res.items():
    print(f"{nombre} = {valor}")
b = nt.on("dist-b")
b.sendline("show version")
print("expect:", repr(b.expect(r"dist-b: ")))
print("resto:", repr(b.wait_for(r"#\s*$")))
print("principal:", nt.session["name"], nt.run("show users").strip())
try:
    nt.on("ajena")
except RuntimeError as e:
    print("ajena:", e)
