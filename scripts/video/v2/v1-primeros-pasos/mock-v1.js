// Extensiones del backend simulado para el video 1 (Primeros pasos). Se carga después de
// scripts/screenshots/mock.js y trabaja sobre window.__mock sin modificarlo. Ids del storyboard:
// MOCK+2 a MOCK+13 (MOCK+1 y MOCK+14 ya están en mock.js). Todo es ficticio: IPs de documentación
// (RFC 5737) y nombres genéricos; la única contraseña es la de demo de la nota protegida.
import { exampleAlerts } from "/src/lib/alerts.ts";

const M = window.__mock;
const q = new URLSearchParams(location.search);
const scene = q.get("scene") ?? "";
const now = Date.now();

// Sin WebGL: xterm usa su renderizador DOM, nítido con el zoom de cámara (CSS) y en headless.
const getContext = HTMLCanvasElement.prototype.getContext;
HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
  return /webgl/.test(type) ? null : getContext.call(this, type, ...rest);
};

// El capítulo 5 necesita el aviso de cierre múltiple (mock-video.js de plugins lo apaga).
M.settings.confirmClose = true;
M.settings.fontSize = 15;
// Pausa larga entre equipos al enviar a varias sesiones: se alcanza a ver Ver detalle y Detener.
localStorage.setItem("broadcastDelay", "9000");

// ---- MOCK+2 / MOCK+3: actualización 0.9.6 → 0.9.7 con las novedades reales de 146aaa6 ----
if (q.get("update") === "1") {
  let checks = 0;
  M.handlers.app_version = () => "0.9.6";
  M.handlers.update_check = () => ({
    current: "0.9.6",
    latest: "0.9.7",
    newer: checks++ > 0,
    supported: q.get("updmanual") !== "1",
    reason: q.get("updmanual") === "1" ? "En modo portable la actualización es manual: reemplaza los archivos de la carpeta." : null,
    published: new Date(now).toISOString(),
    url: "https://github.com/Parzval-Net/Net_Terminal/releases/latest",
    notes: "- Contraseña guardada en scripts sin exponerla\n- MD5 automático tras SCP/SFTP\n- SNMP por VLAN y LLDP-V2\n- Arranque robusto",
  });
}

// ---- MOCK+4: importar desde ~/.ssh/config (formato openssh) ----
const importBase = M.handlers.import_sessions_file;
M.handlers.import_sessions_file = (args = {}) =>
  args.format === "openssh"
    ? {
        format: "openssh",
        sessions: [
          { id: "", name: "bastion-dc", type: "ssh", host: "198.51.100.5", port: 22, username: "admin", folder: "SSH config", created_at: "" },
          { id: "", name: "sw-lab-01", type: "ssh", host: "192.0.2.30", port: 22, username: "admin", jump_host: "admin@198.51.100.5:22", folder: "SSH config", created_at: "" },
        ],
        warnings: ["sw-lab-01: los túneles no se importan; agrégalos en la sesión si los necesitas"],
      }
    : importBase(args);

// ---- MOCK+8: ar-wan01 (Huawei) con plataforma VRP8 en la escena de sugerencias ----
if (scene === "suggest") M.sessions[3].platform = "vrp8";

// ---- MOCK+11 / MOCK+12: notas del capítulo 8 ----
M.notes["consultas-diarias.txt"] = "show clock\nshow ip interface brief\nshow cdp neighbors";
M.notes["usuario-local.txt"] = "! Usuario local de emergencia (datos ficticios)\nusername {{usuario}} privilege 15 secret {{clave}}\nenable secret {{enable}}\nend";

// ---- MOCK+13: regla de alerta activa que se dispara a demanda (no sola) ----
if (q.get("alertrule") === "1") {
  M.settings.alertRules = [
    ...exampleAlerts,
    { ...exampleAlerts[0], id: "qa-updown", name: "Enlace caído en Core", pattern: "%LINK-3-UPDOWN", enabled: true, toast: true, markTab: true },
  ];
  M.handlers.alerts_configure = () => null;
  window.__ntAlert = () =>
    M.emit("alert-hit", { conn: [...M.channels.keys()][0], rule: "qa-updown", line: "%LINK-3-UPDOWN: Interface GigabitEthernet1/0/3, changed state to down" });
}

// ---- Terminal: eco, respuestas, modos y Tab (reemplaza el modo video de mock.js) ----
const out = (id, t) => {
  const ch = M.channels.get(id);
  if (ch) M.cbs.get(ch.data)?.({ index: ch.index++, message: M.enc.encode(t).buffer });
};
const lineBuf = new Map();
const modes = new Map();
const promptOf = (id) => {
  const s = M.connSessions.get(id) ?? {};
  if (s.type === "local") return "\x1b[32muser@laptop\x1b[0m:\x1b[34m~\x1b[0m$ ";
  if (s.highlight === "huawei") return `<${s.name}>`;
  const m = modes.get(id);
  return `${s.name}${m ? `(${m})` : ""}#`;
};
const IPBRIEF = [
  "Interface              IP-Address      OK? Method Status                Protocol",
  "Vlan1                  unassigned      YES NVRAM  administratively down down",
  "Vlan10                 192.0.2.1       YES NVRAM  up                    up",
  "Vlan20                 192.0.2.65      YES NVRAM  up                    up",
  "GigabitEthernet1/0/1   unassigned      YES unset  up                    up",
  "GigabitEthernet1/0/2   unassigned      YES unset  up                    up",
  "GigabitEthernet1/0/3   unassigned      YES unset  down                  down",
  "GigabitEthernet1/0/4   unassigned      YES unset  administratively down down",
  "TenGigabitEthernet1/1/1 unassigned     YES unset  up                    up",
  "Port-channel1          unassigned      YES unset  up                    up",
].join("\n");
// MOCK+6
const VLANS = [
  "VLAN Name                             Status    Ports",
  "---- -------------------------------- --------- -------------------------------",
  "1    default                          active    Gi1/0/2, Gi1/0/5, Gi1/0/6",
  "10   USUARIOS                         active    Gi1/0/8, Gi1/0/9, Gi1/0/10",
  "20   VOZ                              active    Gi1/0/11, Gi1/0/12",
  "30   CAMARAS                          active    Gi1/0/7",
].join("\n");
// MOCK+10 (bloque de GigabitEthernet1/0/1 de mock.js)
const RUN_INT = (intf) =>
  [
    "Building configuration...",
    "",
    "Current configuration : 212 bytes",
    "!",
    `interface ${intf}`,
    " description UPLINK a dist-sw01 Gi1/0/48",
    " switchport trunk allowed vlan 10,20,30",
    " switchport mode trunk",
    " channel-group 1 mode active",
    " spanning-tree guard root",
    " no shutdown",
    "end",
  ].join("\n");
const HUAWEI_INT = [
  "PHY: Physical",
  "*down: administratively down",
  "Interface                   PHY   Protocol  InUti OutUti   inErrors  outErrors",
  "GigabitEthernet0/0/0        up    up        12%    8%          0          0",
  "GigabitEthernet0/0/1        up    up         3%    2%          0          0",
  "GigabitEthernet0/0/2        down  down        0%    0%          0          0",
].join("\n");
const fullIntf = (s) => s.replace(/^gi(g(abit(ethernet)?)?)?\s*/i, "GigabitEthernet");

function respond(id, s, raw) {
  const [cmd0, filter] = raw.trim().split(/\s*\|\s*(?:include|i)\s+/);
  let cmd = cmd0;
  let c = cmd.toLowerCase();
  let body = "";
  // MOCK+9: "do" en modo configuración responde la consulta sin cambiar de modo.
  if (modes.get(id) && /^do\s+/.test(c)) (cmd = cmd.replace(/^do\s+/i, "")), (c = cmd.toLowerCase());
  else if (modes.get(id) && /^sh(ow)?\b/.test(c)) return "               ^\r\n% Invalid input detected at '^' marker.\r\n\r\n";
  let m;
  if (s.type === "local") {
    if (/^(ifconfig|ip a)/.test(c)) body = "en0: flags=8863<UP,BROADCAST,RUNNING,MULTICAST> mtu 1500\n\tinet 192.0.2.250 netmask 0xffffff00 broadcast 192.0.2.255";
  } else if (s.highlight === "huawei") {
    if (/^dis(play)? ver/.test(c)) body = "Huawei Versatile Routing Platform Software\nVRP (R) software, Version 8.220 (AR6100 V300R022C10SPC100)";
    else if (/^dis(play)? clock/.test(c)) body = "2026-10-21 10:42:17\nWednesday";
    else if (/^dis(play)? int(erface)? br/.test(c)) body = HUAWEI_INT;
  } else if (/^sh(ow)? clo(ck)?/.test(c)) body = "*10:42:17.385 UTC Wed Oct 21 2026";
  else if (/^sh(ow)? ver/.test(c)) body = `Cisco IOS XE Software, Version 17.12.04\nCisco IOS Software [Dublin], Catalyst L3 Switch Software (CAT9K_IOSXE)\n${s.name} uptime is 47 weeks, 17 hours, 30 minutes`;
  else if (/^sh(ow)? ip int(erface)? br/.test(c)) body = IPBRIEF;
  else if (/^sh(ow)? vl(an)? br/.test(c)) body = VLANS;
  else if ((m = c.match(/^sh(ow)? run(ning-config)? int(erface)? (\S+)/))) body = RUN_INT(fullIntf(cmd.split(/\s+/).pop()));
  else if (/^sh(ow)? (cdp|lldp) nei/.test(c)) body = "Device ID        Local Intrfce     Holdtme    Capability  Platform  Port ID\ncore-sw02        Ten 1/1/1         142             R S I  C9500-24Y Ten 1/1/1\ndist-sw01        Gig 1/0/1         131             R S I  C9300-48P Gig 1/0/48";
  else if (/^sh(ow)? int(erfaces?)? status/.test(c)) body = "Port      Name               Status       Vlan       Duplex  Speed Type\nGi1/0/1   UPLINK dist-sw01   connected    trunk      a-full a-1000 10/100/1000BaseTX\nGi1/0/3                      notconnect   10           auto   auto 10/100/1000BaseTX\nGi1/0/7   CAMARA PISO 2      connected    30         a-full a-1000 10/100/1000BaseTX";
  else if (/^conf(igure)? t/.test(c)) (body = "Enter configuration commands, one per line.  End with CNTL/Z."), modes.set(id, "config");
  else if (/^int(erface)? /.test(c) && modes.get(id)) modes.set(id, "config-if");
  else if (/^vlan \d/.test(c) && modes.get(id)) modes.set(id, "config-vlan");
  else if (c === "end") modes.delete(id);
  else if (c === "exit") modes.get(id) === "config" ? modes.delete(id) : modes.get(id) && modes.set(id, "config");
  else if (/^(write|wr)( mem)?/.test(c)) body = "Building configuration...\n[OK]";
  if (filter) body = body.split("\n").filter((l) => l.includes(filter)).join("\n");
  body = body.replace(/\n/g, "\r\n");
  return body ? body + "\r\n" : "";
}
const reply = (id, raw) => `\r\n${respond(id, M.connSessions.get(id) ?? {}, raw)}`;

// MOCK+7: Tab completa la última palabra como lo haría el equipo (diccionario mínimo).
const WORDS = ["show", "clock", "version", "interfaces", "ip", "interface", "brief", "running-config", "vlan"];
const complete = (buf) => {
  const w = buf.split(" ").pop();
  if (!w) return "";
  const hit = WORDS.find((x) => x.startsWith(w.toLowerCase()) && x !== w.toLowerCase());
  return hit ? hit.slice(w.length) + " " : "";
};

window.__ntMockAsync = () => {
  for (const id of M.channels.keys()) out(id, `\r\n*Oct 21 10:42:17: %LINK-3-UPDOWN: Interface GigabitEthernet1/0/3, changed state to down\r\n${promptOf(id)}${lineBuf.get(id) ?? ""}`);
};
const queues = new Map();
const later = (id, fn, ms) => {
  const at = Math.max(Date.now(), queues.get(id) ?? 0) + Math.max(1, ms);
  queues.set(id, at);
  setTimeout(fn, at - Date.now());
};
M.handlers.write = ({ id, data }) => {
  let buf = lineBuf.get(id) ?? "";
  let echo = "";
  for (const ch of data) {
    if (ch === "\r" || ch === "\n") {
      if (ch === "\n" && data.includes("\r\n")) continue;
      const line = buf;
      const e = echo;
      later(id, () => e && out(id, e), 0);
      later(id, () => out(id, reply(id, line) + promptOf(id)), 200);
      buf = "";
      echo = "";
    } else if (ch === "\t") {
      const add = complete(buf);
      buf += add;
      echo += add;
    } else if (ch === "\x7f") {
      if (buf) (buf = buf.slice(0, -1)), (echo += "\b \b");
    } else if (ch >= " ") (buf += ch), (echo += ch);
  }
  if (echo) {
    const e = echo;
    later(id, () => out(id, e), 0);
  }
  lineBuf.set(id, buf);
  return null;
};

// Detectar plataforma y consultas del catálogo por la vía de herramientas (device_run).
const deviceRun = M.handlers.device_run;
M.handlers.device_run = (args) => {
  if (/running-config|current-configuration|verify \/md5/.test(args.command) && !/interface/.test(args.command)) return deviceRun(args);
  const s = M.connSessions.get(args.conn) ?? {};
  const job = `job-${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
  const prompt = s.highlight === "huawei" ? `<${s.name}>` : `${s.name}#`;
  const output = `${prompt}${args.command}\r\n${respond(args.conn, s, args.command)}${prompt}`;
  setTimeout(() => {
    M.emit("tool-job", { job, kind: "result", text: "", data: { ok: true, output } });
    M.emit("tool-job", { job, kind: "done", text: "" });
  }, 500);
  return job;
};

// Conexión: banner corto por equipo, modo configuración en suggest-config y login Telnet simulado.
const connectBase = M.handlers.connect;
M.handlers.connect = (args) => {
  const { id, session, onData } = args;
  if (scene === "suggest-config" && session?.name === "core-sw01") modes.set(id, "config-if");
  // MOCK+5: sw-acceso-norte (Telnet) con contraseña guardada. El autocompletado real ocurre en Rust
  // (src-tauri/src/autofill.rs); aquí se simula lo que se ve en la terminal (sin mostrar el valor).
  if (session?.name === "sw-acceso-norte") {
    M.connSessions.set(id, session);
    M.channels.set(id, { data: onData.id, index: 0 });
    setTimeout(() => out(id, "\r\nUser Access Verification\r\n\r\nUsername: "), 250);
    setTimeout(() => out(id, "admin\r\n"), 700);
    setTimeout(() => out(id, "Password: "), 900);
    setTimeout(() => out(id, "\r\n\r\nsw-acceso-norte#"), 1500);
    return null;
  }
  return connectBase(args);
};
