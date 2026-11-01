<p align="center">
  <img src="docs/logo.svg" alt="Logo de NetTerminal" width="112">
</p>

<h1 align="center">NetTerminal para iOS</h1>

<p align="center">
  <b>Terminal y herramientas de redes para iPhone y iPad</b><br>
  SSH · Telnet · TCP · Diagnóstico · Syslog · SNMP · Catálogo de comandos
</p>

<p align="center">
  <a href="https://github.com/Parzval-Net/Net_Terminal_IOS/releases/latest"><img src="https://img.shields.io/badge/iOS-16%2B%20(iPhone%20%26%20iPad)-000000?style=flat&logo=apple&logoColor=white" alt="iOS 16+"></a>
  <a href="https://github.com/Parzval-Net/Net_Terminal_IOS/releases/latest"><img src="https://img.shields.io/github/v/release/Parzval-Net/Net_Terminal_IOS?color=007AFF&label=Versi%C3%B3n" alt="Versión"></a>
  <a href="LICENSE.md"><img src="https://img.shields.io/badge/Licencia-PolyForm%20Noncommercial%201.0.0-red.svg" alt="Licencia PolyForm Noncommercial 1.0.0"></a>
</p>

---

## Qué es

NetTerminal es una terminal de bolsillo para ingenieros de redes, técnicos de telecomunicaciones y soporte de campo. Permite conectarse a routers, switches, firewalls y servidores desde un iPhone o un iPad, con herramientas de diagnóstico y un catálogo de comandos por fabricante.

Funciona en iPhone 13 o posterior y en iPad, con iOS 16 o superior.

---

## Herramientas

### Terminal
- **SSH, Telnet y TCP crudo** hacia equipos de red y servidores, con soporte para equipos antiguos (algoritmos legacy) y salto por bastión.
- **Llaves SSH**: se importan desde la app Archivos o se generan en el equipo (ed25519).
- **Barra de teclas de red**: Esc, Tab, Ctrl, `|`, `?` y flechas, sin cambiar de teclado.
- **Sesiones guardadas** en carpetas y **conexión rápida** para entrar en segundos.

### Diagnóstico de red
- **Ping continuo** con latencia, jitter y pérdida, y **traceroute**.
- **Monitoreo** de equipos y servicios con alarma de caída y recuperación.
- **Calculadora de subredes** IPv4 e IPv6.
- **Speedtest** del enlace.

### Operación
- **Syslog en vivo**: recibe los logs de los equipos mientras se configura.
- **SNMP v1, v2c y v3**: consultas de interfaces y estado, más generador de configuración.
- **Respaldos de configuración** con comparación entre versiones.

### Productividad
- **Catálogo de comandos** de Cisco, Juniper, Fortinet, Huawei, Aruba, Check Point, Linux y otros, clasificados por riesgo (consulta, configuración, crítico) con confirmación antes de los críticos.
- **Botones y macros** para enviar comandos frecuentes con un toque.
- **Notas** por sitio o equipo, con candado opcional.
- **Alertas por palabra clave** en la salida de la terminal.
- **Bóveda cifrada** de credenciales, con la llave protegida en el Keychain del sistema.

---

## Alcance por equipo

| Herramienta | iPhone | iPad |
| :--- | :---: | :---: |
| Terminal SSH / Telnet / TCP | ✅ | ✅ |
| Diagnóstico, monitoreo, subredes y speedtest | ✅ | ✅ |
| Syslog y SNMP | ✅ | ✅ |
| Respaldos de configuración | ✅ | ✅ |
| Catálogo, macros, notas y alertas | ✅ | ✅ |
| Topología CDP / LLDP | Opcional | ✅ |
| Transferencias TFTP / HTTP | Opcional | ✅ |
| CLI Lab | — | ✅ |

**Opcional:** viene desactivado en iPhone por el tamaño de pantalla y se activa en Ajustes › Módulos.

### Fuera de alcance en iOS
- **Consola serie por USB**: iOS no da acceso a adaptadores USB-serie. Alternativa: un servidor de consola por Wi-Fi o un equipo con `ser2net`, accesible por Telnet o TCP desde la app.
- **Terminal local y scripts**: iOS no permite ejecutar programas externos.
- **Trabajo en segundo plano**: los servidores (Syslog, TFTP) y el monitoreo funcionan con la app abierta.
- **Puertos**: los servicios usan puertos sobre 1024 (TFTP 1069, Syslog 1514).

---

## Descarga

Builds en [Releases](https://github.com/Parzval-Net/Net_Terminal_IOS/releases/latest). La guía de instalación está en [IOS.md](IOS.md).

Otras ediciones: [Android](https://github.com/Parzval-Net/NetTerminal_Android) · [Escritorio](https://github.com/Parzval-Net/Net_Terminal)

---

## Licencia

[PolyForm Noncommercial 1.0.0](LICENSE.md). Se permite el uso no comercial (personal, educativo, investigación, organizaciones sin fines de lucro y entidades públicas). Cualquier uso comercial, incluido el uso interno en empresas, requiere una licencia aparte del autor. Las versiones publicadas antes del 31-10-2026 conservan los términos con que se distribuyeron.

© 2026 Nicolás Rivera ([@Parzval-Net](https://github.com/Parzval-Net))
