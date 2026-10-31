/**
 * Packs de comandos: archivos JSON (solo datos) que amplían el catálogo por fabricante.
 *
 * Seguridad: un pack nunca ejecuta nada. Al cargarlo se valida su esquema y tamaño, y el
 * riesgo de cada comando se recalcula aquí: se usa el MAYOR entre el declarado y el
 * calculado, de modo que un pack no puede hacer pasar "reload" por una consulta.
 */
import { riskyRegex } from "./highlight";

export type Risk = "read" | "change" | "disruptive";

export interface Platform {
  id: string;
  label: string;
  /** Regex (sin delimitadores) que reconoce la plataforma en la salida de detectCommand. */
  detect?: string;
  note?: string;
}

export interface Variant {
  platforms: string[];
  cmd: string;
}

export interface PackCommand {
  cmd: string;
  desc: string;
  cat: string;
  risk: Risk;
  platforms?: string[];
  variants?: Variant[];
  note?: string;
  source?: string;
}

export interface Pack {
  format: "netterminal-commands";
  formatVersion: 1;
  id: string;
  name: string;
  vendor: string;
  vendorName: string;
  version?: string;
  author?: string;
  description?: string;
  detectCommand?: string;
  platforms?: Platform[];
  commands: PackCommand[];
  /** Incluido en la app (no se puede borrar, sí desactivar). */
  builtin?: boolean;
}

/** Comando listo para mostrar: con su pack de origen y riesgo efectivo. */
export interface CatalogEntry extends PackCommand {
  packId: string;
  packName: string;
  builtin: boolean;
  declaredRisk: Risk;
  /** true si la app subió el riesgo declarado por el pack. */
  escalated: boolean;
}

export interface CatalogVendor {
  id: string;
  name: string;
  detectCommand?: string;
  platforms: Platform[];
  commands: CatalogEntry[];
}

export const CATEGORIES = [
  "Sistema",
  "Hardware",
  "Interfaces",
  "Capa 2",
  "Enrutamiento",
  "MPLS / VPN",
  "Seguridad",
  "Alta disponibilidad",
  "QoS",
  "Diagnóstico",
  "Logs",
  "Configuración",
  "DNS",
  "Conexiones y tráfico",
  "Otros",
];

/** Catálogos de sistemas operativos (el resto son equipos de red). */
export const OS_VENDORS = ["windows", "macos", "linux"];

export const riskLabel: Record<Risk, string> = {
  read: "Consulta",
  change: "Cambia config/estado",
  disruptive: "Puede cortar servicio",
};

const RANK: Record<Risk, number> = { read: 0, change: 1, disruptive: 2 };
const maxRisk = (a: Risk, b: Risk): Risk => (RANK[a] >= RANK[b] ? a : b);

// ---------- Riesgo calculado ----------

/**
 * Comandos que solo consultan o ajustan la sesión actual. Quedan fuera a propósito: copiar la
 * configuración a la flash local (escribe un archivo), "monitor traffic ... write-file",
 * "execute ping-options <ajuste>" (cambia opciones de la sesión) y "diagnose sys session
 * filter <criterio>" (fija un filtro); "diagnose test authserver" prueba credenciales.
 */
const READ_START =
  /^(show|display|get|dir|more|ping|traceroute|tracert|tracepath|verify|monitor (traffic(?!.*\bwrite-file\b)|interface|start|stop)|test policy|compare configuration|who|policy-check|tcpdump|dnslookup|nslookup|vpn-tunnel diag-report|(undo )?terminal (logging|monitor|debugging|trapping)|request system storage cleanup dry-run|request system software validate|admin show|packet-tracer|ethanalyzer local|telnet|stelnet|ssh|terminal (length|width|monitor|pager)|no page\s*$|checkpoint diff\b|diag cable-diagnostic show\b|cd \/md\S*\s*$|mdconnect\s*$|screen-length\s+\d+\s+temporary|screen-width|set cli |file (list|show|checksum)|commit check|request support information|diagnose (sys (top|status|session (stat|list)|session filter(?=\s*$)|ha (status|checksum (?!recalculate)))|hardware|vpn (ike gateway|tunnel) list|sniffer packet|netlink|ip (route|arp) list|firewall iprope lookup|test application)|execute (ping6?|traceroute6?|telnet|ssh)(?!-)|execute (ping|traceroute)-options view-settings|tftp \S+ put|copy (running-config|startup-config|run|start) (tftp|scp|ftp|http)|execute backup)\b/i;

/**
 * Cortan servicio o sesiones, o dejan el equipo en otro estado (conmutación, rollback,
 * borrado de tablas, túneles o SA). Incluye el "debug" de IOS, que puede saturar la CPU.
 */
const DISRUPTIVE =
  /^(reload(?! cancel)|reboot|shutdown|halt|poweroff|power-off|erase|format|write erase|delete|undelete|rmdir|squeeze|zeroize|factory|configure replace|configure revert now|reset saved-configuration|reset (bgp|ospf|isis|mpls|ip ospf|ike sa|ipsec sa|recycle-bin)|rollback (configuration|running-config)\b|commit replace|abort trial|debug(ging)?\b|redundancy (force-)?switchover|(system|slave|master) switchover|test cable-diagnostics|diag cable-diagnostic test|clear (ip )?(bgp|ospf|isis|eigrp)(?!.*\bsoft\b)|clear bgp(?!.*\bsoft\b)|clear (ip )?route|clear arp\s*$|clear ip nat translation|clear crypto\b|clear mac(-| )address-table\b|clear interfaces statistics all\b|clear ethernet-switching table\s*$|request system (reboot|halt|power-off|zeroize|logout|software rollback)|request chassis cluster failover|request chassis routing-engine master\b|request node (reboot|halt|power-off|offline)|restart \S+|set interfaces \S+( unit \d+)? disable\b|cfg -x|execute (reboot|shutdown|factoryreset|formatlogdisk|restore|ha failover|disk format)|execute router clear (bgp|ospf)(?!.*\bsoft\b)|diagnose sys session clear|diagnose vpn tunnel down\b|diagnose vpn ike (gateway (clear|flush)|restart)\b|diagnose firewall auth clear\b|schedule reboot|install (activate|remove|commit)|deactivate|cpstop|cpstart|cprestart|cphastop|mdsstop|fw unload(local)?|clusterXL_admin down|set cluster member admin down|fwaccel off|fw tab\b.*\s-x\b|fw ctl conntab\b.*\s-x\b|fw ctl zdebug\b|fw ctl debug (?!(0|-x)\s*$)\S|vpn tu (del|delete)\b|save config\s*$|load configuration\b|set interface \S+ state off\b|set static-route\b.*\boff\b|upgrade system\b|vpn-tunnel rekey\b|cluster (failover|reboot|reset)\b|import config\b|restore (image|factory-default|backup-image)\b|ifconfig \S+ down|ip link set \S+ down|cphaprob\b.*-s problem)\b/i;

/**
 * FortiOS: "diagnose ..." consulta salvo que lleve un verbo que cambia estado ("up" y "down"
 * levantan o bajan túneles), y algunos "execute" sin argumentos solo muestran información.
 */
const FORTI_DIAG_READ =
  /^diagnose\b(?!.*\b(clear|delete|del|reset|kill|killall|restart|flush|enable|disable|set|unset|start|stop|filter|update|purge|failover|clean|reload|test(?!-connectivity)|run|reboot|shutdown|up|down|recalculate)\b)/i;
const FORTI_EXEC_READ =
  /^execute (date|time|sensor list|disk list|dhcp lease-list|tac report|log display|log filter dump|ping6|traceroute6|ha manage|log fortianalyzer test-connectivity|switch-controller (get-conn-status|diagnose-connection|get-physical-conn|get-sync-status|get-upgrade-status|switch-software list-available)|extender list-fortiextender-image|modemfw (show all|getIMEI|checkSIM)|lte-modem (wireless-profile|PLMN-profile) list|usb-device list|5g-modem (carrier-config list|esim profile list)|vpn (ipsec|sslvpn) list)\b(?!\s+\d)/i;
/**
 * FortiAP (shell del AP): estado, configuración local y diagnósticos de solo lectura.
 * Quedan fuera cfg -a/-r/-c/-x, cw_diag -c scan-clr-all, vlan-probe-cmd, sniff, debug y
 * plain-ctl, que cambian estado o configuración.
 */
const FORTIAP_READ =
  /^(fap-get-status|fap-tech|presult|kinfo|cfg -[seh]|diag_debug_crashlog read|iwconfig( \S+)?|cw_diag (help|uptime|sys-performance|kernel-panic|power|stats \S+|-c (wtp-cfg|radio-cfg|vap-cfg|acs|acs-chan-stats|ha|ap-scan|sta-scan|sta-cap|wids|ap-suppress|darrp|temperature|all-countries|mesh|mesh-ap|k-lan-host|vlan-probe-rpt|wan1x|snmp)))\s*$/i;
/**
 * Check Point (Gaia clish/expert): comandos de consulta propios. Excluye explícitamente
 * las opciones que modifican (fw tab -x, fw ctl conntab -x, cphaprob -d ... register), las
 * capturas que escriben a disco (-o) y el menú interactivo "vpn tu", que permite borrar SA.
 */
const CHECKPOINT_READ =
  /^(fw (ver|stat|tab\b(?!.*\s-x\b)|ctl (iflist|arp|conntab(?!.*\s-x\b)|multik (stat|print_heavy_conn)|affinity -l|fast_accel show_table|pstat|chain|get)\b|up_execute|samp get|log|lslogs|getifs)|fwaccel (stat|stats|conns|ver)\b|cphaprob\b(?!.*\s-d\b)|cpstat|cpinfo(?!.*\s-o\b)|cplic print|cpview|cpwd_admin list|api status|mdsstat|mdsenv|\$MDSVERUTIL|vpn (tu (tlist|list)\b|overlap_encdom)|vsenv|vsx stat|ips stat|mgmt_cli show|asg (monitor|stat)|connection_pipelining (status|heaviest_conn)|dynamic_balancing -p|cppcap(?!.*\s-o\b)|fw monitor(?!.*\s-o\b)|fgate stat|cp_log_export show|set virtual-system \S+$)/i;

/**
 * Herramientas Linux de solo lectura (modo expert de Gaia y equipos basados en Linux). Cada
 * nombre termina en espacio o fin de línea: "ls" no cubre "lsof" ni "hostname" a
 * "hostnamectl". "date" y "hostname" con argumento que fija un valor quedan fuera.
 */
const LINUX_READ =
  /^((top|uptime|free|df|du|cat|less|tail|head|grep|ls|lsof|lsns|lsblk|lscpu|lsmod|lsusb|lshw|uname|dmidecode|raid_diagnostic|lspci|netstat)(\s|$)|hostname( -\w+)*\s*$|date(?!.*\s(-s|--set)\b)(\s|$)|arp -an|ip (neigh|route|addr|link)( show)?\b(?!.*\b(add|del|delete|flush|set|change|replace|append|prepend)\b)|ss\b|ifconfig( \S+)?$)/i;

/** tcpdump distingue mayúsculas: -w escribe la captura a disco y -G rota archivos (exige -w). */
const TCPDUMP_WRITE = /^tcpdump\b.*\s-[A-Za-z]*[wG]\b/;

/**
 * ethtool distingue mayúsculas: -k/-g/-a/-l/-c muestran y -K/-G/-A/-L/-C cambian (y -E
 * escribe la EEPROM), así que esta regla no puede ir con la bandera "i".
 */
const ETHTOOL_READ = /^ethtool( -[iSkgacmlTPne])? \S+$/;
/** iptables también distingue mayúsculas (-L lista, -A/-I/-D/-F cambian reglas). */
const IPTABLES_READ = /^ip6?tables(-legacy|-nft)?( -t \w+)?( (-[LSnvxV]+|--list\S*|--line-numbers|--version|[A-Za-z_][\w-]*))*$/;

/**
 * Sistemas operativos (Windows, macOS, Linux): consultas de red. Los subcomandos que
 * cambian estado (add, del, set, flush, up/down…) quedan fuera a propósito.
 */
const OS_READ = new RegExp(
  "^(" +
    [
      // Windows
      "ipconfig(\\s+/(all|displaydns|allcompartments)\\b.*)?$",
      "(Get|Test|Resolve|Find|Measure|Select|Format|Where|Sort|Show|Compare)-\\w+",
      "netsh\\b(?!.*\\b(set|add|delete|reset|start|stop|dump|connect|disconnect|import|export)\\b).*\\bshow\\b",
      "netsh (wlan|trace) show\\b",
      "route print|arp -a|getmac|nbtstat -[acnsS]\\b|pathping|systeminfo|whoami|typeperf|w32tm /(query|stripchart|monitor|tz)\\b",
      "pktmon (status|list|filter list|counters|etl2txt|etl2pcap|format|pcapng)\\b",
      "(Get-Content|gc|type) .*hosts$",
      "\\(Get-\\w+|\\$PSVersionTable\\b|tasklist\\b|rasdial$|net (use|view|share|config \\w+|statistics \\w+)$",
      "nltest /(dsgetdc|sc_query|sc_verify|dclist|domain_trusts|dsgetsite|query|parentdomain|dnsgetdc)\\b",
      // macOS
      "ipconfig (getifaddr|getpacket|getsummary|getoption|getiflist|getv6packet|getra)\\b",
      "networksetup -(list|get|print|show|version|help)\\w*",
      "scutil (-r\\b|--(dns|nwi|proxy|get)\\b|--nc (list|status|show|statistics)\\b)",
      "dscacheutil -(q|statistics|cachedump)\\b",
      "dns-sd -[BGLQZ]\\b",
      // wdutil diagnose y wdutil log escriben archivos o cambian el nivel de registro.
      "nettop|ndp -[anpr]+\\b|(\\S*/)?airport -[Is]\\b|arp -n\\b|ifconfig( -\\w+)*( \\S+)?$|system_profiler|sw_vers|networkQuality|wdutil( info)?\\s*$",
      "/usr/libexec/ApplicationFirewall/socketfilterfw --(get|list)\\w*",
      "pfctl -s\\w*",
      "log (show|stream)\\b",
      "route (-n )?(get|monitor)\\b",
      // Linux
      "resolvectl( (status|query|statistics|dns|domain|show-cache|show-server-state|monitor|llmnr|mdns|dnssec|dnsovertls)\\b(?!.*\\s(\\S+\\s+){1}\\S+\\.\\S+\\s*$)|$)",
      "systemd-resolve --(status|statistics)\\b",
      "nmcli( -\\S+)*( (general|g|device|dev|d|connection|con|c|radio|r|networking|n|monitor))?( (show|status|list|wifi( list)?|connectivity|permissions|hostname|logging))?(?!.*\\b(up|down|modify|delete|add|reload|off|on|connect|disconnect|rescan|set|import|export|clone|edit)\\b)(\\s|$)",
      "netplan (get|status)\\b",
      "networkctl (status|list|lldp|cat)\\b",
      "wicked (show|ifstatus|show-config)\\b",
      "ifquery\\b",
      "iw (dev|phy|reg get|list|event)\\b(?!.*\\b(set|connect|disconnect|scan trigger|del|add)\\b)",
      "nstat|sar -n|vnstat|iftop|nload|bmon|tshark|mtr\\b|getent\\b|dig\\b|host\\b|nc -[zvnuw]+|curl\\b|wget --spider",
      "conntrack -[LSCE]\\b|nft list\\b|ip6?tables(-legacy|-nft)?-save$",
      "firewall-cmd (--zone=\\S+ |--permanent )*--(state|list|get|query|info)\\S*|ufw status\\b|ufw show\\b",
      "arping\\b.*-c \\d+|lldpctl\\b|lldpcli show\\b|route -n$|swanctl --(list|stats)\\S*|wg( show\\b|$)|ip -f \\w+ (route|addr|neigh)( show)?$|getenforce$|sestatus\\b|aa-status$|openssl s_client\\b|teamdctl \\S+ state\\b",
      "tc (-\\w+ )*(qdisc|class|filter) show\\b|bridge (-\\w+ )*(link|fdb|vlan|mdb)( show)?\\b",
      "sysctl (-a\\b.*|(net\\.\\S+\\s*)+)$|journalctl\\b|dmesg\\b|hostnamectl( status)?$|timedatectl( (status|show|timesync-status|show-timesync))?$|chronyc (tracking|sources|sourcestats)\\b",
      "rc-service \\S+ status|rc-status\\b|systemctl (status|is-active|is-enabled|list-units)\\b",
      "ip (-\\S+ )*(addr|address|a|link|l|route|r|neigh|n|neighbour|rule|ru|netns|maddr|mroute|tunnel|xfrm (state|policy)|monitor|ntable|token|vrf)\\b(?!.*\\b(add|del|delete|flush|set|change|replace|append|prepend|exec|identify)\\b)",
      "traceroute6|ping6|tracepath6?",
    ].join("|") +
    ")",
  "i",
);

/** Sistemas operativos: acciones que cortan la red del equipo o requieren reinicio. */
const OS_DISRUPTIVE = new RegExp(
  "^(" +
    [
      "ipconfig /release6?\\b",
      "netsh wlan (disconnect|connect)\\b|rasdial\\b.*/disconnect\\b",
      "(Disable|Restart)-NetAdapter\\b|Remove-NetIPAddress\\b|Remove-NetRoute\\b|Set-DnsClientServerAddress\\b|(Restart|Stop)-Computer\\b",
      "netsh (int|interface) (ip|ipv4|ipv6|tcp) reset\\b|netsh winsock reset\\b",
      "ip (-\\S+ )*(addr|address|a) flush\\b|ip (-\\S+ )*(route|r) (flush|del|delete)\\b",
      "nmcli( -\\S+)* ((c|con|connection) down|(n|networking) off|(r|radio) \\S+ off|(d|dev|device) (disconnect|down))\\b",
      "systemctl (restart|stop) (NetworkManager|networking|network|systemd-networkd|wicked)\\b",
      "netplan apply\\b|dhclient -r\\b|ifdown\\b|rc-service networking (restart|stop)\\b",
      // Cambiar DNS, IP o el modo DHCP de un servicio corta la resolución o la sesión remota.
      "networksetup -(setnetworkserviceenabled \\S+ off|setairportpower \\S+ off|setdnsservers|setmanual\\b|setdhcp|setairportnetwork)",
      "ipconfig set \\S+ (DHCP|BOOTP|MANUAL|INFORM|NONE|LINKLOCAL)\\b",
      // Borrar cualquier ruta (no solo la por defecto) o vaciar la tabla ARP completa.
      "route (-n )?(delete|del)\\b",
      "arp -d (\\*|-a)(\\s|$)",
    ].join("|") +
    ")",
  "i",
);

/**
 * Una consulta deja de serlo si su salida se ejecuta, se escribe a disco o termina procesos.
 * "| save" (Junos) y "| redirect" / "| append" (IOS) guardan la salida en el equipo.
 */
const PIPE_CHANGES = /^(sh|bash|zsh|tee|xargs|sudo|iex|Invoke-Expression|save|redirect|append|(Stop|Remove|Disable|Restart|Set|Clear|Reset|Rename|New|Add|Enable|Start|Export|Out-File|Uninstall|Install)-\w+)\b/i;
const REDIRECT_WRITE = /(^|[^2&])>{1,2}\s*(?!\s*(\/dev\/null|\$null|nul)\b)\S/i;

/** Navegación de contexto en FortiOS con VDOM (no cambia configuración). */
const FORTI_CONTEXT = /^(config global|config vdom|edit \S+|end|next)$/i;

/** ethtool -s (minúscula) cambia velocidad/dúplex y renegocia el enlace; -S solo muestra. */
const ETHTOOL_SET = /^ethtool -s\b/;

/**
 * Dentro de un bloque de configuración, estas órdenes cortan servicio: apagar la interfaz,
 * cambiar o quitar su IP (IOS, VRP y la forma "ip a.b.c.d/n" de Fireware) o "apply", que en
 * Fireware aplica de inmediato todos los cambios pendientes de políticas.
 */
const DISRUPTIVE_IN_CONFIG = /^(shutdown|set status down|disable|(no |undo )?ip address\b|ip \d+\.\d+\.\d+\.\d+\/\d+|apply\s*$|set .*admin-status down)\b/i;

/**
 * ";" "&&" "||" y "&" encadenan otro comando en la misma línea (shells, cmd y NX-OS): se
 * separan para evaluar cada parte y que "cat x; reboot" no pase como consulta. No separan
 * dentro de comillas ni de (), {} o [] (filtros de tcpdump, hashtables de PowerShell), ni en
 * "2>&1" o "&>". Lo que queda agrupado no se reconoce como consulta y pide confirmación.
 */
function splitChain(line: string): string[] {
  const parts: string[] = [];
  let quote = "";
  let depth = 0;
  let start = 0;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote) {
      if (c === quote) quote = "";
      continue;
    }
    if (c === "'" || c === '"') quote = c;
    else if ("({[".includes(c)) depth++;
    else if (")}]".includes(c)) depth = Math.max(0, depth - 1);
    else if (depth === 0) {
      const two = line.slice(i, i + 2);
      const sep =
        c === ";" ? 1 : two === "&&" || two === "||" ? 2 : c === "&" && !/[<>&]/.test(line[i - 1] ?? "") && line[i + 1] !== ">" ? 1 : 0;
      if (sep) {
        parts.push(line.slice(start, i));
        start = i + sep;
        i += sep - 1;
      }
    }
  }
  // Comillas o paréntesis sin cerrar (un apóstrofo en una descripción) no esconden un separador.
  if (quote || depth) return line.split(/;|&&|\|\||&/);
  parts.push(line.slice(start));
  return parts;
}

const riskCache = new Map<string, Risk>();

/**
 * Riesgo según el contenido. Analiza cada línea (sin lo que va tras "|"). Un comando que
 * no se reconoce como consulta se trata como cambio: ante la duda, se pide confirmación.
 */
/** Riesgo mayor entre las líneas de un texto de varios comandos (aprobaciones MCP). */
export function textRisk(text: string): Risk {
  return text
    .split(/\r?\n|\r/)
    .filter((l) => l.trim())
    .map((l) => computeRisk(l))
    .reduce<Risk>((a, b) => maxRisk(a, b), "read");
}

export function computeRisk(cmd: string): Risk {
  let risk = riskCache.get(cmd);
  if (risk === undefined) {
    // Es pura: se memoriza para no repetir las regex al recargar o reconstruir el catálogo.
    if (riskCache.size >= 10000) riskCache.clear();
    risk = evalRisk(cmd);
    riskCache.set(cmd, risk);
  }
  return risk;
}

function evalRisk(cmd: string): Risk {
  let risk: Risk = "read";
  // Un "\r" suelto también separa comandos en el equipo.
  cmd = cmd.replace(/\r\n?/g, "\n");
  const lines = cmd
    .split("\n")
    .map((l) => l.split("|")[0].trim())
    .filter(Boolean);
  const multi = lines.length > 1;
  // "config vdom / edit X" o "config global": solo cambia de contexto.
  if (lines.every((l) => FORTI_CONTEXT.test(l)) && /^config (global|vdom)$/i.test(lines[0]) && lines.length <= 2) return "read";
  // Una sustitución `...` o $(...) ejecuta un comando que no se analiza.
  if (/`|\$\(/.test(cmd)) risk = "change";
  const parts = cmd.split("\n").flatMap(splitChain);
  for (const raw of parts.map((l) => l.trim()).filter(Boolean)) {
    // "sudo" no cambia la naturaleza del comando: se evalúa lo que ejecuta.
    const segments = raw
      .split("|")
      .map((x) => x.trim().replace(/^sudo\s+(-\S+\s+)*/i, "").replace(/^ip netns exec \S+\s+/i, ""));
    const line = segments[0];
    if (DISRUPTIVE.test(line) || ETHTOOL_SET.test(line) || OS_DISRUPTIVE.test(line) || (multi && DISRUPTIVE_IN_CONFIG.test(line)))
      return "disruptive";
    const read = [READ_START, FORTI_DIAG_READ, FORTI_EXEC_READ, FORTIAP_READ, CHECKPOINT_READ, LINUX_READ, ETHTOOL_READ, IPTABLES_READ, OS_READ].some((re) => re.test(line));
    if (!read || TCPDUMP_WRITE.test(line)) risk = maxRisk(risk, "change");
    if (segments.slice(1).some((x) => PIPE_CHANGES.test(x)) || REDIRECT_WRITE.test(raw)) risk = maxRisk(risk, "change");
  }
  return risk;
}

// ---------- Validación ----------

const ID = /^[a-z0-9][a-z0-9_.-]{0,63}$/;
const MAX_COMMANDS = 3000;
const str = (v: unknown, max: number): v is string => typeof v === "string" && v.length > 0 && v.length <= max;
/**
 * Caracteres que el catálogo no muestra pero el equipo sí interpreta: un "\r" suelto ejecuta
 * otra línea, Ctrl-U o backspace borran lo anterior y los de dirección Unicode reordenan el
 * texto. Un pack importado podría usarlos para que "show clock" esconda un "reload".
 */
const HIDDEN_CHARS = /[\x00-\x08\x0b-\x1f\x7f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/;
const VARIABLE_OK = (cmd: string) => (cmd.match(/\{\{[^}]*\}\}/g) ?? []).every((m) => /^\{\{\s*[\w.-]+\s*\}\}$/.test(m));

export interface Validation {
  pack: Pack | null;
  errors: string[];
  warnings: string[];
}

/** Valida y normaliza un pack. Descarta comandos inválidos con aviso, sin aceptar basura. */
export function validatePack(raw: unknown): Validation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const o = raw as Record<string, unknown>;
  if (!o || typeof o !== "object") return { pack: null, errors: ["No es un objeto JSON"], warnings };
  if (o.format !== "netterminal-commands") errors.push('Falta "format": "netterminal-commands"');
  if (o.formatVersion !== 1) errors.push('"formatVersion" debe ser 1');
  if (!str(o.id, 64) || !ID.test(o.id)) errors.push("id inválido (minúsculas, números, - _ .)");
  if (!str(o.name, 120)) errors.push("Falta name");
  if (!str(o.vendor, 32) || !ID.test(o.vendor)) errors.push("vendor inválido");
  if (!Array.isArray(o.commands)) errors.push("Falta la lista commands");
  if (errors.length) return { pack: null, errors, warnings };

  const platforms: Platform[] = [];
  for (const p of (Array.isArray(o.platforms) ? o.platforms : []) as Record<string, unknown>[]) {
    if (!p || !str(p.id, 32) || !ID.test(p.id) || !str(p.label, 120)) {
      warnings.push("Plataforma inválida descartada");
      continue;
    }
    let detect: string | undefined;
    if (str(p.detect, 300)) {
      try {
        new RegExp(p.detect, "im");
        if (riskyRegex(p.detect)) warnings.push(`Regex de detección de ${p.id} descartada (potencialmente lenta)`);
        else detect = p.detect;
      } catch {
        warnings.push(`Regex de detección inválida en ${p.id}`);
      }
    }
    platforms.push({ id: p.id, label: p.label, detect, note: str(p.note, 300) ? p.note : undefined });
  }
  const platformIds = new Set(platforms.map((p) => p.id));

  const commands: PackCommand[] = [];
  const seen = new Set<string>();
  const list = o.commands as Record<string, unknown>[];
  if (list.length > MAX_COMMANDS) warnings.push(`Se cargan solo los primeros ${MAX_COMMANDS} comandos`);
  for (const c of list.slice(0, MAX_COMMANDS)) {
    if (!c || !str(c.cmd, 2000) || !str(c.desc, 1000)) {
      warnings.push("Comando sin cmd o desc descartado");
      continue;
    }
    if (HIDDEN_CHARS.test(c.cmd)) {
      warnings.push(`Comando con caracteres de control descartado: ${c.cmd.replace(HIDDEN_CHARS, "?").slice(0, 60)}`);
      continue;
    }
    if (!VARIABLE_OK(c.cmd)) {
      warnings.push(`Variable inválida en: ${c.cmd.slice(0, 60)}`);
      continue;
    }
    if (seen.has(c.cmd)) continue;
    seen.add(c.cmd);
    const risk: Risk = c.risk === "read" || c.risk === "change" || c.risk === "disruptive" ? c.risk : "change";
    const cat = typeof c.cat === "string" && CATEGORIES.includes(c.cat) ? c.cat : "Otros";
    const plats = Array.isArray(c.platforms) ? (c.platforms as unknown[]).filter((x): x is string => typeof x === "string" && platformIds.has(x)) : undefined;
    const variants = Array.isArray(c.variants)
      ? (c.variants as Record<string, unknown>[])
          .filter((v) => v && str(v.cmd, 2000) && !HIDDEN_CHARS.test(v.cmd) && Array.isArray(v.platforms) && VARIABLE_OK(v.cmd as string))
          .map((v) => ({
            cmd: v.cmd as string,
            platforms: (v.platforms as unknown[]).filter((x): x is string => typeof x === "string" && platformIds.has(x)),
          }))
          .filter((v) => v.platforms.length)
      : undefined;
    const source = str(c.source, 500) && /^https:\/\//.test(c.source) ? c.source : undefined;
    commands.push({
      cmd: c.cmd,
      desc: c.desc,
      cat,
      risk,
      platforms: plats?.length ? plats : undefined,
      variants: variants?.length ? variants : undefined,
      note: str(c.note, 600) ? c.note : undefined,
      source,
    });
  }
  if (!commands.length) return { pack: null, errors: ["El pack no tiene comandos válidos"], warnings };

  return {
    pack: {
      format: "netterminal-commands",
      formatVersion: 1,
      id: o.id as string,
      name: o.name as string,
      vendor: o.vendor as string,
      vendorName: str(o.vendorName, 60) ? o.vendorName : (o.vendor as string),
      version: str(o.version, 30) ? o.version : undefined,
      author: str(o.author, 120) ? o.author : undefined,
      description: str(o.description, 600) ? o.description : undefined,
      detectCommand: str(o.detectCommand, 120) && computeRisk(o.detectCommand) === "read" ? o.detectCommand : undefined,
      platforms,
      commands,
    },
    errors,
    warnings,
  };
}

// ---------- Catálogo combinado ----------

/**
 * Orden de los packs para el catálogo: primero "Mis comandos" (user-<fabricante>), luego los
 * incluidos y al final los importados. Ante el mismo comando gana el primero, así que una
 * actualización que agrega a los incluidos un comando que el usuario ya tenía no oculta su
 * versión (descripción, riesgo, notas). Un importado con el id de uno incluido se ignora.
 */
export function orderPacks(builtin: Pack[], user: Pack[]): Pack[] {
  const own = user.filter((p) => p.id.startsWith("user-"));
  const imported = user.filter((p) => !p.id.startsWith("user-") && !builtin.some((b) => b.id === p.id));
  return [...own, ...builtin, ...imported];
}

export function buildCatalog(packs: Pack[], disabled: string[]): CatalogVendor[] {
  const vendors = new Map<string, CatalogVendor>();
  // Comandos ya agregados por fabricante (evita buscar en la lista en cada comando).
  const seen = new Map<string, Set<string>>();
  for (const pack of packs) {
    if (disabled.includes(pack.id)) continue;
    let v = vendors.get(pack.vendor);
    if (!v) {
      v = { id: pack.vendor, name: pack.vendorName, platforms: [], commands: [] };
      vendors.set(pack.vendor, v);
    }
    v.detectCommand ??= pack.detectCommand;
    for (const p of pack.platforms ?? []) if (!v.platforms.some((x) => x.id === p.id)) v.platforms.push(p);
    let cmds = seen.get(v.id);
    if (!cmds) seen.set(v.id, (cmds = new Set()));
    for (const c of pack.commands) {
      if (cmds.has(c.cmd)) continue;
      cmds.add(c.cmd);
      const computed = computeRisk([c.cmd, ...(c.variants ?? []).map((x) => x.cmd)].join("\n"));
      const effective = maxRisk(c.risk, computed);
      v.commands.push({
        ...c,
        risk: effective,
        declaredRisk: c.risk,
        escalated: effective !== c.risk,
        packId: pack.id,
        packName: pack.name,
        builtin: !!pack.builtin,
      });
    }
  }
  return [...vendors.values()];
}

/** Sintaxis del comando para una plataforma (variante si existe). */
export function commandFor(c: PackCommand, platform: string | null): string {
  if (!platform) return c.cmd;
  return c.variants?.find((v) => v.platforms.includes(platform))?.cmd ?? c.cmd;
}

/** ¿El comando aplica a la plataforma? (sin plataforma elegida, todos aplican) */
export function appliesTo(c: PackCommand, platform: string | null): boolean {
  if (!platform || !c.platforms?.length) return true;
  return c.platforms.includes(platform) || !!c.variants?.some((v) => v.platforms.includes(platform));
}

/** Plataforma según la salida del comando de detección. */
export function detectPlatform(v: CatalogVendor, output: string): Platform | null {
  for (const p of v.platforms) {
    if (!p.detect) continue;
    try {
      if (new RegExp(p.detect, "im").test(output.slice(0, 20000))) return p;
    } catch {
      /* regex inválida: se ignora */
    }
  }
  return null;
}
