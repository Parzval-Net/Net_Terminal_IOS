// Pruebas del motor de riesgo: `node scripts/tests/risk.test.mjs` (Node 22.15+ con tipos TS).
// computeRisk protege lo pegado, la difusión, los comandos al conectar, las macros y la
// sugerencia en gris: cada caso de abajo fue reportado por las auditorías por fabricante.
import assert from "node:assert/strict";
import { fastEnough } from "./timing.mjs";
import { registerHooks } from "node:module";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

registerHooks({
  resolve(specifier, context, next) {
    if (/^\.\.?\//.test(specifier) && !/\.[cm]?[jt]s$/.test(specifier) && context.parentURL?.endsWith(".ts")) {
      try {
        return next(`${specifier}.ts`, context);
      } catch {
        /* sigue con la resolución normal */
      }
    }
    return next(specifier, context);
  },
});

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const { computeRisk, textRisk } = await import("../../src/lib/packs.ts");
const { vendors } = await import("../../src/lib/commands.ts");

const RANK = { read: 0, change: 1, disruptive: 2 };
const is = (cmd, want) => assert.equal(computeRisk(cmd), want, JSON.stringify(cmd));
const atLeast = (cmd, want) => assert.ok(RANK[computeRisk(cmd)] >= RANK[want], `${JSON.stringify(cmd)} debe ser al menos ${want}`);

// ---------- Cisco ----------
for (const c of ["debug ip ospf adj", "debug ip bgp 192.0.2.1 updates", "debug ip icmp", "debug all", "debug ip packet", "debugging ip packet"]) is(c, "disruptive");
is("undebug all", "change");
is("undo debugging all", "change");
is("show debugging", "read");
is("show running-config | include debug", "read");
is("show interfaces | include debug|CRC", "read");
for (const c of ["redundancy force-switchover", "redundancy switchover", "system switchover", "slave switchover"]) is(c, "disruptive");
for (const c of ["clear crypto sa", "clear crypto sa peer 192.0.2.1", "clear crypto session", "clear crypto isakmp sa", "clear crypto ikev2 sa"]) is(c, "disruptive");
for (const c of ["show crypto sa", "show crypto ipsec sa", "show crypto isakmp sa", "show crypto session"]) is(c, "read");
for (const c of ["clear mac address-table dynamic", "clear mac-address-table dynamic", "clear mac address-table dynamic interface Gi1/0/1"]) is(c, "disruptive");
for (const c of ["show mac address-table", "show mac address-table dynamic", "show mac-address-table"]) is(c, "read");
is("commit replace", "disruptive");
is("commit", "change");
is("commit confirmed minutes 5", "change");
is("commit check", "read");
for (const c of ["rollback configuration last 1", "rollback configuration to 1000000123", "rollback running-config checkpoint antes", "configure revert now"]) is(c, "disruptive");
is("configure revert timer 5", "change");
is("rollback 1", "change");
for (const c of ["show configuration rollback changes last 1", "show configuration commit list", "display configuration rollback", "show system rollback compare 0 1"]) is(c, "read");
is("test cable-diagnostics tdr interface Gi1/0/1", "disruptive");
is("show cable-diagnostics tdr interface Gi1/0/1", "read");
for (const c of ["copy running-config flash:respaldo.cfg", "copy running-config bootflash:respaldo.cfg", "copy run disk0:r.cfg"]) is(c, "change");
for (const c of ["copy running-config tftp://192.0.2.9/r.cfg", "copy running-config scp://user@192.0.2.9/r.cfg", "copy startup-config ftp://192.0.2.9/s.cfg"]) is(c, "read");
is("copy running-config startup-config", "change");
is("show running-config | redirect flash:r.cfg", "change");
is("show running-config | append flash:r.cfg", "change");
is("show running-config | section router bgp", "read");

// ---------- Junos ----------
for (const c of ["request system logout user admin", "request system logout pid 1234", "request system logout terminal pts/0 all"]) is(c, "disruptive");
is("clear interfaces statistics all", "disruptive");
is("clear interfaces statistics ge-0/0/0", "change");
is("clear ethernet-switching table", "disruptive");
is("clear ethernet-switching table interface ge-0/0/1", "change");
is("show ethernet-switching table", "read");
for (const c of ["request chassis cluster failover reset redundancy-group 1", "request chassis cluster failover node 1 redundancy-group 1"]) is(c, "disruptive");
for (const c of ["request chassis routing-engine master switch", "request chassis routing-engine master acquire", "request chassis routing-engine master release"]) is(c, "disruptive");
is("set interfaces ge-0/0/0 disable", "disruptive");
is("set interfaces ge-0/0/0 unit 0 disable", "disruptive");
is("set interfaces ge-0/0/0 description uplink", "change");
for (const c of ["request system software rollback", "request system software rollback reboot", "request node reboot re0", "request node halt fpc0", "request node power-off fpc1"]) is(c, "disruptive");
for (const c of ["restart routing gracefully", "restart chassis-control", "restart class-of-service immediately"]) is(c, "disruptive");
is("request system software validate /var/tmp/junos.tgz", "read");
is("request system software add /var/tmp/junos.tgz", "change");
is("monitor traffic interface ge-0/0/0 write-file /var/tmp/c.pcap", "change");
is("monitor traffic interface ge-0/0/0 no-resolve", "read");
is('monitor traffic interface ge-0/0/0 matching "host 192.0.2.1" detail', "read");
// Filtros que escriben en el equipo: "| save" (Junos), "| redirect" y "| append" (IOS).
is("request support information | save /var/tmp/rsi.txt", "change");
is("show configuration | save /var/tmp/c.txt", "change");
is("show interfaces terse | save /var/tmp/i.txt", "change");
is("show tech-support | redirect flash:tech.txt", "change");
is("show configuration | display set", "read");
is("show log messages | last 50", "read");
is("request support information", "read");
// Sin dry-run borra archivos (también vale para packs importados: el riesgo efectivo es el mayor).
is("request system storage cleanup dry-run", "read");
is("request system storage cleanup", "change");
is("request system storage cleanup no-confirm", "change");

// ---------- Huawei ----------
for (const c of ["rollback configuration last 1", "rollback configuration to label antes", "rollback configuration to commit-id 1000000123", "abort trial"]) is(c, "disruptive");
for (const c of ["reset ipsec sa", "reset ike sa", "reset recycle-bin"]) is(c, "disruptive");
for (const c of ["display ipsec sa", "display ike sa", "display recycle-bin", "display current-configuration | include rollback"]) is(c, "read");
is("commit label antes", "change");
is("system-view\ninterface GigabitEthernet0/0/1\nip address 192.0.2.1 255.255.255.0\nreturn", "disruptive");
is("system-view\ninterface GigabitEthernet0/0/1\nundo ip address\nreturn", "disruptive");
is("configure terminal\ninterface GigabitEthernet1/0/1\nip address 192.0.2.1 255.255.255.0\nend", "disruptive");
is("configure terminal\ninterface GigabitEthernet1/0/1\ndescription uplink\nend", "change");

// ---------- FortiOS ----------
is("diagnose vpn tunnel down fase2 fase1", "disruptive");
is("diagnose vpn tunnel up fase2 fase1", "change");
for (const c of ["diagnose vpn tunnel list", "diagnose vpn tunnel list name tunel", "diagnose vpn ike gateway list"]) is(c, "read");
for (const c of ["diagnose vpn ike gateway clear name tunel", "diagnose vpn ike gateway clear", "diagnose vpn ike gateway flush", "diagnose vpn ike restart"]) is(c, "disruptive");
for (const c of ["execute router clear bgp ip 192.0.2.1", "execute router clear bgp all", "execute router clear ospf process"]) is(c, "disruptive");
is("execute router clear bgp ip 192.0.2.1 soft in", "change");
is("diagnose firewall auth clear", "disruptive");
is("diagnose firewall auth list", "read");
is("diagnose sys ha checksum recalculate", "change");
for (const c of ["diagnose sys ha checksum cluster", "diagnose sys ha checksum show", "diagnose sys ha status"]) is(c, "read");
is("diagnose test authserver ldap servidor usuario clave", "change");
is("diagnose test application fcnacd 2", "read");
for (const c of ["execute ping-options source 192.0.2.1", "execute ping-options repeat-count 100", "execute ping-options reset", "execute traceroute-options source 192.0.2.1"]) is(c, "change");
for (const c of ["execute ping-options view-settings", "execute ping 192.0.2.1", "execute ping6 2001:db8::1", "execute traceroute 192.0.2.1"]) is(c, "read");
for (const c of ["diagnose sys session filter dst 192.0.2.1", "diagnose sys session filter clear"]) is(c, "change");
for (const c of ["diagnose sys session filter", "diagnose sys session list", "diagnose sys session stat"]) is(c, "read");
is("diagnose sys session clear", "disruptive");
is("diagnose sys top 2 20", "read");
is("config global", "read");
is("config vdom\nedit root", "read");

// ---------- Check Point ----------
for (const c of ["fw ctl conntab -x -sip=192.0.2.1", "fw ctl conntab -x"]) is(c, "disruptive");
for (const c of ["fw ctl conntab", "fw ctl conntab -dport=443 -proto=6", "fw tab -t connections -s"]) is(c, "read");
for (const c of ["fw ctl zdebug + drop", "fw ctl zdebug + drop | grep 192.0.2.1", "fw ctl debug -m fw + drop", "fw ctl debug -buf 8200", "fw ctl debug -buf 8200\nfw ctl debug -m fw + drop\nfw ctl kdebug -T -f > /var/log/kernel_debug.txt"]) is(c, "disruptive");
is("fw ctl debug 0", "change");
is("fw ctl debug -x", "change");
is("vpn tu", "change");
is("vpn tu tlist", "read");
is("vpn tu del all", "disruptive");
is('fw monitor -e "host(192.0.2.1), accept;"', "read");
is('fw monitor -e "host(192.0.2.1), accept;" -o /var/log/c.cap', "change");
is('cppcap -i eth0 -f "host 192.0.2.1"', "read");
is('cppcap -i eth0 -f "host 192.0.2.1" -o /var/log/c.pcap -p 100', "change");
is("cpinfo -y all", "read");
is("cpinfo -z -o /var/log/cpinfo.txt", "change");
is("save config", "disruptive");
is("save configuration /home/admin/c.txt", "change");
for (const c of ["cpstart", "cphastop", "cpstop", "load configuration /home/admin/c.txt", "set interface eth1 state off", "set static-route 10.0.0.0/8 off", "set static-route 10.0.0.0/8 nexthop gateway address 192.0.2.1 off"]) is(c, "disruptive");
is("cphastart", "change");
is("set interface eth1 state on", "change");
for (const c of ["show interface eth1", "show configuration", "cphaprob stat", "fw stat", "fwaccel stat"]) is(c, "read");

// ---------- WatchGuard ----------
for (const c of ["upgrade system from ftp://192.0.2.9/fw.sysa-dl", "upgrade system from ftp://192.0.2.9/fw.sysa-dl yes", "vpn-tunnel rekey tunel", "cluster failover", "cluster reboot", "cluster reset", "import config from ftp://192.0.2.9/c.xml", "restore image ftp://192.0.2.9/i.img", "restore factory-default"]) is(c, "disruptive");
is("configure\ninterface 1\nip 10.0.0.1/24\nexit\nexit", "disruptive");
is("configure\npolicy\napply\nexit\nexit", "disruptive");
is("configure\nip route 10.0.0.0/8 192.0.2.1\nexit", "change");
for (const c of ["show cluster", "show interface", "vpn-tunnel diag-report", "diagnose dynroute \"show ip route\""]) is(c, "read");

// ---------- Windows / macOS ----------
for (const c of ["route delete 10.0.0.0", "route delete 0.0.0.0", "route -n delete default", "sudo route delete -net 10.0.0.0", "route del -net 10.0.0.0 netmask 255.0.0.0"]) is(c, "disruptive");
is("route print", "read");
is("route -n get default", "read");
for (const c of ["arp -d *", "arp -d -a", "sudo arp -d -a"]) is(c, "disruptive");
is("arp -d 192.0.2.1", "change");
is("arp -a", "read");
is("arp -an", "read");
for (const c of ['Set-DnsClientServerAddress -InterfaceAlias "Ethernet" -ServerAddresses ("192.0.2.53")', 'Set-DnsClientServerAddress -InterfaceAlias "Ethernet" -ResetServerAddresses', "Remove-NetRoute -DestinationPrefix 10.0.0.0/8 -Confirm:$false", 'netsh wlan connect name="perfil"']) is(c, "disruptive");
for (const c of ["Get-DnsClientServerAddress", "Get-NetRoute", "netsh wlan show profiles", "netsh wlan show interfaces"]) is(c, "read");
for (const c of ['sudo networksetup -setdnsservers "Wi-Fi" 192.0.2.53', 'sudo networksetup -setdnsservers "Wi-Fi" Empty', 'sudo networksetup -setmanual "Wi-Fi" 10.0.0.2 255.255.255.0 10.0.0.1', 'sudo networksetup -setdhcp "Wi-Fi"', "sudo ipconfig set en0 DHCP"]) is(c, "disruptive");
for (const c of ['networksetup -getinfo "Wi-Fi"', "networksetup -listallhardwareports", "ipconfig getifaddr en0", "ipconfig getsummary en0"]) is(c, "read");
for (const c of ["sudo wdutil diagnose", "sudo wdutil log +wifi"]) is(c, "change");
for (const c of ["sudo wdutil info", "wdutil"]) is(c, "read");

// ---------- Linux ----------
for (const c of ["sudo tcpdump -ni en0 -w /tmp/c.pcap", "tcpdump -ni eth0 -G 60 -w /tmp/c-%s.pcap", "tcpdump -ni eth0 -c 1000 -w /tmp/captura.pcap"]) is(c, "change");
for (const c of ["tcpdump -ni eth0 -c 100 host 192.0.2.1", "sudo tcpdump -D", "tcpdump -nni eth0 -e arp"]) is(c, "read");
is("ip route del 10.0.0.0/8", "disruptive");
is("ip -6 route del 2001:db8::/32", "disruptive");
is("ip route add 10.0.0.0/8 via 192.0.2.1", "change");
for (const c of ["ip route show", "ip -s link", "ls -l /sys/class/net/", "lsof -nP -iTCP -sTCP:LISTEN", "lsns -t net", "lsblk", "hostname", "hostname -I", "date", "date -u", "cat /etc/hosts", "ss -tulpn", "netstat -rn"]) is(c, "read");
// "ls" o "hostname" como prefijo no deben convertir en consulta otro comando.
for (const c of ["hostnamectl set-hostname srv01", "date -s '2026-01-01 00:00'", "lsattr +i /etc/hosts"]) is(c, "change");

// ---------- Consultas que deben seguir siendo consultas ----------
for (const c of [
  "show version", "show clock", "show ip route", "show ip bgp summary", "show interfaces status", "terminal length 0",
  "display version", "display interface brief", "display ip routing-table", "screen-length 0 temporary",
  "get system status", "get router info routing-table all", "diagnose sys top", "show full-configuration",
  "show interfaces terse", "show route", "set cli screen-length 0", "show | compare",
  "cpview", "cpstat os -f all", "show route summary", "show sysinfo", "show status-report",
  "ipconfig /all", "Get-NetIPConfiguration", "ping -S 192.0.2.1 198.51.100.1", "nmcli device status", "resolvectl status", "ethtool -S eth0", "iptables -L -n -v",
  "ssh admin@192.0.2.1", "telnet 192.0.2.5 23", "ping 192.0.2.1", "traceroute 192.0.2.1",
]) is(c, "read");

// ---------- Combinaciones ----------
is("show clock ; reload", "disruptive");
is("show clock\nclear crypto sa", "disruptive");
atLeast("cat /etc/hosts && hostnamectl set-hostname x", "change");
is("ethtool -s eth0 speed 100 duplex full", "disruptive");
is("ethtool -S eth0", "read");
is("iptables -F", "change");

// ---------- Rendimiento: patrones lineales (sin retroceso catastrófico) ----------
for (const cmd of ["fw ctl conntab " + "-sip=192.0.2.1 ".repeat(800), "show " + "a ".repeat(4000), "tcpdump " + "-n ".repeat(3000), "monitor traffic " + "interface ge-0/0/0 ".repeat(500)]) {
  fastEnough(`computeRisk con entrada larga (${cmd.slice(0, 20)}…)`, 50, () => computeRisk(cmd));
}

// ---------- Catálogo: ninguna consulta declarada se vuelve cambio (rompería la sugerencia en gris) ----------
const escalated = [];
let reads = 0;
let total = 0;
for (const f of readdirSync(join(root, "src", "packs"))) {
  const pack = JSON.parse(readFileSync(join(root, "src", "packs", f), "utf8"));
  for (const c of pack.commands) {
    total++;
    if (c.risk === "read") reads++;
    for (const cmd of [c.cmd, ...(c.variants ?? []).map((v) => v.cmd)]) {
      const got = computeRisk(cmd);
      if (RANK[got] > RANK[c.risk]) escalated.push(`${f}: ${c.risk} -> ${got}: ${JSON.stringify(cmd)}`);
    }
  }
}
for (const v of vendors) for (const c of v.commands) {
  total++;
  if (c.risk === "read") reads++;
  const got = computeRisk(c.cmd);
  if (RANK[got] > RANK[c.risk]) escalated.push(`commands.ts ${v.id}: ${c.risk} -> ${got}: ${JSON.stringify(c.cmd)}`);
}
assert.deepEqual(escalated, [], "comandos del catálogo cuyo riesgo calculado supera al declarado");
assert.ok(total > 1700 && reads > 1000, `catálogo con ${total} comandos (${reads} consultas)`);

// Aprobación MCP: el riesgo de un bloque es el de su línea más riesgosa.
assert.equal(textRisk("show version\nshow clock"), "read");
assert.equal(textRisk("show version\nreload"), "disruptive");
assert.equal(textRisk("show run\r\ninterface Gi0/1"), "change");
assert.equal(textRisk(""), "read");

console.log(`risk: ok (${total} comandos del catálogo revisados, ${reads} consultas intactas)`);
