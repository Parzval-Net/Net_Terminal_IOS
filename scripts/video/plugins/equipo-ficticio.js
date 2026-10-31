// Equipo ficticio para el video de scripts y plugins: respuestas de solo lectura con IPs de
// documentación (RFC 5737). Lo usan el backend simulado del video (navegador) y la prueba de
// los ejemplos con Python (Node). Sin dependencias.

const VERSION = (host) => [
  "IOS XE Software, Version 17.12.4",
  "L3 Switch Software, Version 17.12.4, RELEASE SOFTWARE",
  `${host} uptime is 47 days, 17 hours, 30 minutes`,
];

const INTERFACES = [
  "Vlan10 is up, line protocol is up",
  "Vlan20 is up, line protocol is up",
  "GigabitEthernet1/0/1 is up, line protocol is up (connected)",
  "GigabitEthernet1/0/2 is up, line protocol is up (connected)",
  "GigabitEthernet1/0/3 is down, line protocol is down (notconnect)",
  "GigabitEthernet1/0/4 is administratively down, line protocol is down (disabled)",
  "TenGigabitEthernet1/1/1 is up, line protocol is up (connected)",
  "Port-channel1 is up, line protocol is up (connected)",
];

const PING = [
  "Type escape sequence to abort.",
  "Sending 5, 100-byte ICMP Echos to 192.0.2.1, timeout is 2 seconds:",
  "!!!!!",
  "Success rate is 100 percent (5/5), round-trip min/avg/max = 1/1/2 ms",
];

/** Salida (líneas) de un comando de consulta; null si el equipo ficticio no lo conoce. */
export function respuesta(cmd, host = "core-sw01") {
  const c = cmd.trim().replace(/\s+/g, " ");
  const filtro = c.split(" | include ")[1];
  const base = c.split(" | ")[0];
  let lineas = null;
  if (/^show version$/i.test(base)) lineas = [...VERSION(host), "Configuration register is 0x102"];
  else if (/^show interfaces?$/i.test(base)) lineas = INTERFACES;
  else if (/^show interfaces? \S+$/i.test(base)) {
    const nombre = base.split(" ").pop().toLowerCase();
    const fila = INTERFACES.find((l) => l.toLowerCase().startsWith(nombre)) ?? `${base.split(" ").pop()} is up, line protocol is up (connected)`;
    lineas = [fila, "  5 minute input rate 18342000 bits/sec, 2210 packets/sec", "  5 minute output rate 9120000 bits/sec, 1475 packets/sec"];
  } else if (/^ping 192\.0\.2\.\d+$/i.test(base)) lineas = PING.map((l) => l.replace("192.0.2.1", base.split(" ")[1]));
  if (!lineas) return null;
  if (filtro) {
    const re = new RegExp(filtro);
    lineas = lineas.filter((l) => re.test(l));
  }
  return lineas;
}
