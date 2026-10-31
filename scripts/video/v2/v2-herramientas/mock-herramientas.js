// Extiende el backend simulado de las capturas (scripts/screenshots/mock.js) para el video 2,
// "Herramientas de red a fondo". No cambia mock.js: envuelve sus manejadores en window.__mock.
// Todo es ficticio: IPs de documentación (RFC 5737), nombres genéricos y secretos de marcador.
//
// Parámetros de la URL (además de los de mock.js):
//   v2=topology-live   diagrama vacío para descubrir en vivo por consola (capítulo 02)
//   ips=multi          tres IPs locales (selector "IP de este PC")
//   sinimagen=1        la carpeta compartida parte sin la imagen c9300 (se agrega con "Agregar")
//   flash=lleno        "dir flash:" informa poco espacio libre
//   md5=malo           "verify /md5" devuelve otro hash
//   scpbusy=1          la verificación MD5 encuentra la sesión tomada por un script dos veces
//   unknownSpeed=1     ifHighSpeed 0 en Gi1/0/10 de core-sw01 (enlace violeta)
//   pwd=<sesiones>     sesiones (por nombre, separadas por coma) que piden contraseña al conectar
const M = window.__mock;
const q = new URLSearchParams(location.search);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const invoke = (cmd, args) => window.__TAURI_INTERNALS__.invoke(cmd, args);
let seq = 0;
const newJob = () => `v2job-${++seq}`;
const job = (id, kind, text = "", data) => M.emit("tool-job", { job: id, kind, text, ...(data ? { data } : {}) });

// Sin WebGL: xterm usa su renderizador DOM, nítido con el zoom por CSS y en headless.
const getContext = HTMLCanvasElement.prototype.getContext;
HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
  return /webgl/.test(type) ? null : getContext.call(this, type, ...rest);
};

// Solo IPs de documentación en pantalla: algunos ejemplos y valores iniciales de la interfaz usan
// redes privadas (10.0.0.1, 192.168.10.77). Se reemplazan en textos, placeholders, títulos y campos.
const PRIVADAS = [
  [/\b10\.\d{1,3}\.\d{1,3}\.(\d{1,3})\b/g, "192.0.2.$1"],
  [/\b192\.168\.\d{1,3}\.(\d{1,3})\b/g, "192.0.2.$1"],
  [/\b172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.(\d{1,3})\b/g, "192.0.2.$1"],
  [/\b8\.8\.8\.8\b/g, "192.0.2.53"],
];
const limpia = (t) => PRIVADAS.reduce((a, [re, to]) => a.replace(re, to), t);
const tiene = (t) => !!t && PRIVADAS.some(([re]) => ((re.lastIndex = 0), re.test(t)));
function sanear(raiz) {
  if (!raiz) return;
  const w = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) if (tiene(n.data)) n.data = limpia(n.data);
  for (const el of raiz.querySelectorAll?.("[placeholder], [title]") ?? []) {
    for (const at of ["placeholder", "title"]) if (tiene(el.getAttribute(at))) el.setAttribute(at, limpia(el.getAttribute(at)));
  }
  for (const el of raiz.querySelectorAll?.("input, textarea") ?? []) {
    if (!tiene(el.value)) continue;
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, limpia(el.value));
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }
}
document.addEventListener("DOMContentLoaded", () => {
  sanear(document.body);
  new MutationObserver((ms) => {
    for (const m of ms) {
      if (m.type === "characterData") {
        if (tiene(m.target.data)) m.target.data = limpia(m.target.data);
      } else if (m.type === "attributes") {
        const v = m.target.getAttribute(m.attributeName);
        if (tiene(v)) m.target.setAttribute(m.attributeName, limpia(v));
      } else for (const n of m.addedNodes) n.nodeType === 1 ? sanear(n) : n.nodeType === 3 && tiene(n.data) && (n.data = limpia(n.data));
    }
  }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ["placeholder", "title"] });
});

// ---------------------------------------------------------------- Ajustes de partida
M.settings.confirmClose = false;
M.settings.fontSize = 15;
// Una sesión NX-OS para mostrar el perfil "Cisco NX-OS" del gestor de archivos.
M.sessions.push({
  id: "s-nx", name: "nx-agg01", type: "ssh", folder: "Sitio Central/Core", host: "192.0.2.6", username: "admin", highlight: "cisco", platform: "nxos",
  port: 22, serial_port: "/dev/tty.usbserial-0001", baud_rate: 9600, created_at: new Date(Date.now() - 12 * 86400000).toISOString(),
});
// core-sw01 con plataforma detectada (IOS-XE) en el catálogo.
const core = M.sessions.find((s) => s.name === "core-sw01");
if (core) core.platform = "iosxe";

if (q.get("v2") === "topology-live") {
  M.settings.topology = { nodes: [], links: [] };
  M.settings.topoSources = {};
  M.settings.topoSnapshots = [];
}

// ---------------------------------------------------------------- IPs de este PC
if (q.get("ips") === "multi")
  M.handlers.local_ips = () => [
    { name: "en0", ip: "192.0.2.250", default: true },
    { name: "bridge100", ip: "203.0.113.254", default: false },
    { name: "utun4", ip: "198.51.100.77", default: false },
  ];
M.handlers.source_ip = () => "192.0.2.250";

// ---------------------------------------------------------------- Carpeta compartida
const IMG = "c9300-universalk9.17.12.04.SPA.bin";
const IMG_SIZE = 1_163_845_632;
const MD5_OK = "3f2a9c1e5b7d4a6f8e0c2b4d6f8a1c3e";
const shared = new Map([
  [IMG, IMG_SIZE],
  ["AR6100-V300R022C10SPC100.cc", 168_820_736],
  ["FGT_200F-v7.4.5.out", 92_340_224],
]);
if (q.get("sinimagen") === "1") shared.delete(IMG);
M.handlers.tftp_files = () => [...shared.entries()];
M.handlers.tftp_add = ({ path }) => {
  const name = String(path).split(/[\\/]/).pop();
  shared.set(name, name === IMG ? IMG_SIZE : 4_211);
  return name;
};
M.handlers.tftp_delete = ({ name }) => (shared.delete(name), null);
M.handlers["plugin:dialog|open"] = ({ options } = {}) => {
  const f = `/Users/operador/Descargas/${IMG}`;
  return options?.multiple ? [f] : f;
};
M.handlers.open_dir = () => null;

/** Progreso de una transferencia (evento "transfer"), como el backend: cada 300 ms hasta completar. */
let xfer = 0;
async function transfer({ proto = "http", file = IMG, total = IMG_SIZE, ms = 6000, client = "192.0.2.1:51544", dir = "get" } = {}) {
  const id = `x${++xfer}`;
  const steps = Math.max(2, Math.round(ms / 300));
  for (let i = 1; i <= steps; i++) {
    await wait(300);
    const done = i === steps;
    const bytes = done ? total : Math.round((total * i) / steps * (0.94 + Math.random() * 0.04));
    M.emit("transfer", { id, proto, client, file, dir, bytes, total, done, error: null });
  }
  return id;
}

// ---------------------------------------------------------------- Servidor FTP
const FTP_PASS = ["demo-k7m2q9", "demo-p4x8r2", "demo-t6w3n8", "demo-h2v9c5"];
let ftpStarts = 0;
let ftp = null; // { user, pass, port, write }
M.handlers.ftp_server_start = ({ port, allowWrite }) => {
  M.handlers.server_start({ kind: "ftp", port, allowWrite });
  ftp = { user: "nt", pass: FTP_PASS[ftpStarts++ % FTP_PASS.length], port, write: !!allowWrite };
  return { ...ftp };
};
M.handlers.ftp_server_info = () => (ftp ? { ...ftp } : null);
const setWrite = M.handlers.server_set_write;
M.handlers.server_set_write = (args) => {
  const before = setWrite(args);
  if (args.kind === "ftp" && ftp) ftp.write = !!args.allow; // en caliente: la contraseña no cambia
  return before;
};
const stopServer = M.handlers.server_stop;
M.handlers.server_stop = (args) => {
  if (args.kind === "ftp") ftp = null;
  return stopServer(args);
};

// ---------------------------------------------------------------- Cliente FTP / FTPS
const FTP_TREE = {
  "/firmware": [
    { name: "cisco", size: 0, dir: true, date: "2026-10-01 09:00" },
    { name: "huawei", size: 0, dir: true, date: "2026-09-02 16:40" },
    { name: "LEEME.txt", size: 1_204, dir: false, date: "2026-08-30 11:02" },
  ],
  "/firmware/cisco": [
    { name: IMG, size: IMG_SIZE, dir: false, date: "2026-09-12 18:20" },
    { name: "c9300-universalk9.17.09.05.SPA.bin", size: 1_098_203_136, dir: false, date: "2026-03-04 10:15" },
  ],
};
M.handlers.ftp_list = ({ params }) => {
  if (!params?.host) throw "Falta el servidor";
  const path = !params.path || params.path === "/" ? "/firmware" : params.path.replace(/\/$/, "");
  return wait(500).then(() => ({ cwd: path, tls: !!params.tls, entries: FTP_TREE[path] ?? [] }));
};
const ftpJob = (dir) => ({ params, name }) => {
  const id = newJob();
  const size = FTP_TREE[params?.path ?? ""]?.find((e) => e.name === name)?.size ?? shared.get(name) ?? 4_211;
  (async () => {
    await transfer({ proto: "ftp", file: name, total: size, ms: 4500, client: `${params?.host ?? "203.0.113.30"}:21`, dir });
    if (dir === "get") shared.set(name, size);
    job(id, "done");
  })();
  return id;
};
M.handlers.ftp_get = ftpJob("get");
M.handlers.ftp_put = ftpJob("put");

// ---------------------------------------------------------------- Equipos por consola (device_run)
/** Bloques de "show cdp neighbors detail" por equipo. */
const cdp = (id, ip, plat, local, remote) =>
  `-------------------------\nDevice ID: ${id}\nEntry address(es): \n  IP address: ${ip}\nPlatform: cisco ${plat},  Capabilities: Router Switch IGMP \nInterface: ${local},  Port ID (outgoing port): ${remote}\nHoldtime : 142 sec\n\nVersion :\nCisco IOS Software [Dublin], Catalyst L3 Switch Software\n`;
const CDP = {
  "core-sw01": [
    cdp("core-sw02", "192.0.2.2", "C9500-24Y4C", "TenGigabitEthernet1/1/1", "TenGigabitEthernet1/1/1"),
    cdp("dist-sw01", "192.0.2.11", "C9300-48P", "GigabitEthernet1/0/1", "GigabitEthernet1/0/48"),
    cdp("dist-sw01", "192.0.2.11", "C9300-48P", "GigabitEthernet1/0/2", "GigabitEthernet1/0/47"),
  ],
  "dist-sw01": [
    cdp("core-sw01", "192.0.2.1", "C9500-24Y4C", "GigabitEthernet1/0/48", "GigabitEthernet1/0/1"),
    cdp("core-sw01", "192.0.2.1", "C9500-24Y4C", "GigabitEthernet1/0/47", "GigabitEthernet1/0/2"),
    cdp("sw-acceso-01", "192.0.2.21", "C9200L-24P", "GigabitEthernet1/0/1", "GigabitEthernet1/0/24"),
    cdp("sw-acceso-02", "192.0.2.22", "C9200L-24P", "GigabitEthernet1/0/2", "GigabitEthernet1/0/24"),
  ],
};
const LLDP = {
  "core-sw01":
    "------------------------------------------------\nLocal Intf: Gi1/0/10\nChassis id: 0009.0f00.0001\nPort id: port1\nPort Description: port1\nSystem Name: fw-perimetro\n\nSystem Description: \nFortiGate-200F v7.4.5\n\nTime remaining: 101 seconds\nSystem Capabilities: B,R\nEnabled Capabilities: R\nManagement Addresses:\n    IP: 198.51.100.10\n\nTotal entries displayed: 1\n",
};
const STATUS = {
  "core-sw01": [
    ["Gi1/0/1", "UPLINK dist-sw01", "connected", "trunk", "a-full", "a-1000"],
    ["Gi1/0/2", "UPLINK dist-sw01", "connected", "trunk", "a-full", "a-1000"],
    ["Gi1/0/10", "fw-perimetro port1", "connected", "20", "a-full", "a-1000"],
    ["Te1/1/1", "ISL core-sw02", "connected", "trunk", "full", "10G"],
  ],
  "dist-sw01": [
    ["Gi1/0/1", "sw-acceso-01", "connected", "trunk", "a-full", "a-1000"],
    ["Gi1/0/2", "sw-acceso-02", "connected", "trunk", "a-full", "a-1000"],
    ["Gi1/0/47", "UPLINK core-sw01", "connected", "trunk", "a-full", "a-1000"],
    ["Gi1/0/48", "UPLINK core-sw01", "connected", "trunk", "a-full", "a-1000"],
  ],
};
const PO = { "core-sw01": ["Gi1/0/1", "Gi1/0/2"], "dist-sw01": ["Gi1/0/47", "Gi1/0/48"] };
const pad = (s, n) => String(s).padEnd(n);
function show(name, cmd) {
  const c = cmd.toLowerCase();
  if (/^show cdp neighbors detail/.test(c)) return (CDP[name] ?? []).join("\n") || "";
  if (/^show lldp neighbors detail/.test(c)) return LLDP[name] ?? "\nTotal entries displayed: 0\n";
  if (/^show interfaces status/.test(c)) {
    const rows = STATUS[name] ?? [];
    return ["", "Port         Name               Status       Vlan       Duplex  Speed Type", ...rows.map(([p, n, st, v, d, sp]) => `${pad(p, 13)}${pad(n, 19)}${pad(st, 13)}${pad(v, 11)}${pad(d, 8)}${pad(sp, 6)}10/100/1000BaseTX`)].join("\n");
  }
  if (/^show etherchannel summary/.test(c)) {
    const m = PO[name];
    if (!m) return "Number of channel-groups in use: 0";
    return `Flags:  D - down        P - bundled in port-channel\n        S - Layer2      U - in use\n\nNumber of channel-groups in use: 1\nNumber of aggregators:           1\n\nGroup  Port-channel  Protocol    Ports\n------+-------------+-----------+-----------------------------------------------\n1      Po1(SU)         LACP      ${m.map((p) => `${p}(P)`).join("     ")}\n`;
  }
  return null;
}

const free = () => (q.get("flash") === "lleno" ? 812_345_344 : 8_012_345_344);
function dirFlash(fs) {
  const rows = [
    ["1", "drwx", "4096", "Oct 14 2026 09:12:44 +00:00", "core"],
    ["2", "-rw-", "1098203136", "Mar 4 2026 10:15:02 +00:00", "c9300-universalk9.17.09.05.SPA.bin"],
    ["3", "-rw-", "10223", "Oct 20 2026 18:15:00 +00:00", "packages.conf"],
    ["4", "-rw-", "4211", "Oct 20 2026 18:15:31 +00:00", "config.text"],
  ];
  if (copied.has(IMG)) rows.push(["5", "-rw-", String(IMG_SIZE), "Oct 24 2026 10:42:17 +00:00", IMG]);
  return `Directory of ${fs}/\n\n${rows.map((r) => `${r[0].padStart(6)}  ${r[1]}  ${r[2].padStart(12)}  ${r[3]}  ${r[4]}`).join("\n")}\n\n11353194496 bytes total (${free()} bytes free)`;
}
const copied = new Set();
let busyLeft = q.get("scpbusy") === "1" ? 2 : 0;

const baseRun = M.handlers.device_run;
M.handlers.device_run = (args) => {
  const { conn, command } = args;
  const s = M.connSessions.get(conn) ?? {};
  const name = s.name ?? "equipo";
  const prompt = `${name}#`;
  const done = (output, ms = 500, ok = true) => {
    const id = newJob();
    setTimeout(() => {
      job(id, "result", "", { ok, output: `${prompt}${command}\r\n${output.replace(/\r?\n/g, "\r\n")}\r\n${prompt}` });
      job(id, "done");
    }, ms);
    return id;
  };
  const out = show(name, command);
  if (out !== null) return done(out, Number(q.get("showms") ?? 450));
  let m;
  if ((m = command.match(/^dir ((?:boot)?flash:)/))) return done(dirFlash(m[1]), 600);
  if (/^verify \/md5 /.test(command) || / md5sum$/.test(command)) {
    if (busyLeft > 0) {
      busyLeft--;
      throw "Un script está usando esta sesión. Espera a que termine o usa Detener script.";
    }
    const md5 = q.get("md5") === "malo" ? "9b1c0e7a2d4f6a8c0e2b4d6f8a0c2e4f" : MD5_OK;
    const file = command.replace(/^verify \/md5 /, "");
    return done(`.....................................Done!\nverify /md5 (${file}) = ${md5}`, 1300);
  }
  if ((m = command.match(/^copy (http|tftp|ftp):\/\/\S+\/(\S+) (\S+)/))) {
    const [, proto, file, dest] = m;
    const id = newJob();
    const total = shared.get(file) ?? IMG_SIZE;
    (async () => {
      await wait(250);
      job(id, "line", `${prompt}${command}`);
      await wait(400);
      job(id, "line", `Destination filename [${file}]? `);
      await wait(500);
      job(id, "line", `Accessing ${proto}://192.0.2.250${proto === "http" ? ":8080" : ""}/${file}...`);
      await wait(300);
      job(id, "line", `Loading ${file} from 192.0.2.250 (via Vlan10): !!!!!!!!!!!!!!!!`);
      await transfer({ proto, file, total, ms: Number(q.get("copyms") ?? 6000), client: "192.0.2.1:51544" });
      job(id, "line", "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
      job(id, "line", `[OK - ${total} bytes]`);
      job(id, "line", `${total} bytes copied in 94.212 secs (12353579 bytes/sec)`);
      copied.add(file);
      job(id, "result", "", { ok: true, output: `${prompt}${command}\r\nDestination filename [${file}]? \r\n${total} bytes copied in 94.212 secs (12353579 bytes/sec)\r\n${prompt}` });
      job(id, "done");
      void dest;
    })();
    return id;
  }
  if ((m = command.match(/^copy (?:boot)?flash:(\S+) (tftp|ftp):\/\//))) {
    const [, file, proto] = m;
    const id = newJob();
    (async () => {
      await wait(250);
      job(id, "line", `${prompt}${command}`);
      await wait(400);
      job(id, "line", "Address or name of remote host [192.0.2.250]? ");
      await wait(300);
      job(id, "line", `Destination filename [${file}]? `);
      await transfer({ proto, file, total: 10_223, ms: 2400, client: "192.0.2.1:50113", dir: "put" });
      shared.set(file, 10_223);
      job(id, "line", "!!\n10223 bytes copied in 1.104 secs (9260 bytes/sec)");
      job(id, "result", "", { ok: true, output: `${prompt}${command}\r\n10223 bytes copied in 1.104 secs (9260 bytes/sec)\r\n${prompt}` });
      job(id, "done");
    })();
    return id;
  }
  if ((m = command.match(/^copy running-config (tftp|ftp):\/\/\S+\/(\S+)/))) {
    const [, proto, file] = m;
    const id = newJob();
    (async () => {
      await wait(250);
      job(id, "line", `${prompt}${command}`);
      await wait(400);
      job(id, "line", `Address or name of remote host [192.0.2.250]? `);
      await wait(300);
      job(id, "line", `Destination filename [${file}]? `);
      await wait(300);
      job(id, "line", "!!");
      await transfer({ proto, file, total: 4_211, ms: 900, client: "192.0.2.1:50112", dir: "put" });
      shared.set(file, 4_211);
      job(id, "line", "4211 bytes copied in 0.912 secs (4617 bytes/sec)");
      job(id, "result", "", { ok: true, output: `${prompt}${command}\r\n4211 bytes copied in 0.912 secs (4617 bytes/sec)\r\n${prompt}` });
      job(id, "done");
    })();
    return id;
  }
  return baseRun(args);
};

// ---------------------------------------------------------------- Pestañas: contraseña, SCP y SFTP
// Las sesiones listadas en ?pwd= y las pestañas SCP/SFTP piden contraseña en la terminal. Lo que se
// teclea ahí no hace eco ni se guarda: solo se espera Enter.
const pwdFor = new Set((q.get("pwd") ?? "").split(",").filter(Boolean));
const special = new Map(); // conexión -> { onLine(texto) }
const send = (id, text) => {
  const ch = M.channels.get(id);
  if (ch) M.cbs.get(ch.data)?.({ index: ch.index++, message: M.enc.encode(text).buffer });
};
const finish = (id, reason) => {
  const ch = M.channels.get(id);
  if (ch) M.cbs.get(ch.data)?.({ index: ch.index++, message: reason });
};
const baseConnect = M.handlers.connect;
M.handlers.connect = (args) => {
  const { id, session, onData } = args;
  const user = session.username || "admin";
  if (session.scp) {
    M.connSessions.set(id, session);
    M.channels.set(id, { data: onData.id, index: 0 });
    const files = session.scp.files ?? [];
    setTimeout(() => send(id, `${user}@${session.host}'s password: `), 400);
    if (session.scp.mode === "shell") {
      let ready = false;
      special.set(id, {
        line: (t) => {
          if (!ready) {
            ready = true;
            send(id, `\r\nConnected to ${session.host}.\r\nsftp> `);
            return;
          }
          const cmd = t.trim();
          let body = "";
          if (cmd === "ls" || cmd === "ls -l") body = "c9300-universalk9.17.09.05.SPA.bin   config.text   core   packages.conf";
          else if (/^cd /.test(cmd)) body = "";
          else if (/^get /.test(cmd)) {
            const f = cmd.slice(4).trim();
            body = `Fetching /${f} to ${f}\r\n${f.padEnd(40)}100%   10KB   1.2MB/s   00:00`;
            shared.set(f, 10_223);
          } else if (/^put /.test(cmd)) body = `Uploading ${cmd.slice(4).trim()} to /${cmd.slice(4).trim()}`;
          else if (cmd === "bye" || cmd === "exit" || cmd === "quit") {
            special.delete(id);
            setTimeout(() => finish(id, "Sesión finalizada"), 300);
            return;
          }
          send(id, `\r\n${body ? body + "\r\n" : ""}sftp> `);
        },
        echo: () => ready,
      });
      return null;
    }
    special.set(id, {
      line: async () => {
        special.delete(id);
        send(id, "\r\n");
        const f = files[0] ?? IMG;
        const total = shared.get(f) ?? IMG_SIZE;
        const mb = (total / 1048576).toFixed(0);
        const steps = 12;
        for (let i = 1; i <= steps; i++) {
          await wait(330);
          const pct = Math.round((100 * i) / steps);
          const eta = String(Math.max(0, Math.round((steps - i) * 1.6))).padStart(2, "0");
          send(id, `\r${f}${" ".repeat(4)}${String(pct).padStart(3)}% ${String(Math.round((mb * pct) / 100)).padStart(5)}MB  52.4MB/s   00:${eta}${i === steps ? "    " : " ETA"}`);
        }
        send(id, "\r\n");
        if (session.scp.upload) copied.add(f);
        await wait(400);
        finish(id, "Sesión finalizada");
      },
      echo: () => false,
    });
    return null;
  }
  if (pwdFor.has(session.name)) {
    M.connSessions.set(id, session);
    M.channels.set(id, { data: onData.id, index: 0 });
    setTimeout(() => send(id, `${user}@${session.host}'s password: `), 350);
    special.set(id, {
      line: () => {
        special.delete(id);
        send(id, `\r\n\r\n\x1b[2mAcceso solo para personal autorizado. Equipo de laboratorio.\x1b[0m\r\n\r\n${session.name}#`);
      },
      echo: () => false,
    });
    return null;
  }
  return baseConnect(args);
};
const buffers = new Map();
const baseWrite = M.handlers.write;
M.handlers.write = (args) => {
  const sp = special.get(args.id);
  if (!sp) return baseWrite(args);
  let buf = buffers.get(args.id) ?? "";
  for (const ch of String(args.data)) {
    if (ch === "\r" || ch === "\n") {
      const line = buf;
      buf = "";
      buffers.set(args.id, "");
      sp.line(line);
    } else if (ch === "\x7f") {
      if (buf && sp.echo()) send(args.id, "\b \b");
      buf = buf.slice(0, -1);
    } else if (ch >= " ") {
      buf += ch;
      if (sp.echo()) send(args.id, ch);
    }
  }
  buffers.set(args.id, buf);
  return null;
};

// ---------------------------------------------------------------- Topología: velocidad desconocida
if (q.get("unknownSpeed") === "1") {
  const read = M.handlers.snmp_topo_read;
  const zero = (r) => (r && /^1\.3\.6\.1\.2\.1\.31\.1\.1\.1\.15\.10010$/.test(r.oid) ? { ...r, value: "0" } : r);
  M.handlers.snmp_topo_read = async (args) => {
    const res = await read(args);
    if (args.target?.host !== "192.0.2.1") return res;
    return { ...res, gets: res.gets.map(zero), walks: res.walks.map((w) => ({ ...w, rows: w.rows.map(zero) })) };
  };
}

// ---------------------------------------------------------------- Cliente SNMP
const SYS = [
  ["1.3.6.1.2.1.1.1.0", "OCTET STRING", "Cisco IOS XE Software, Version 17.12.4, Catalyst L3 Switch Software (CAT9K_IOSXE)"],
  ["1.3.6.1.2.1.1.2.0", "OID", "1.3.6.1.4.1.9.1.2494"],
  ["1.3.6.1.2.1.1.3.0", "Timeticks", "412345600 (47d 17h 30m 56.00s)"],
  ["1.3.6.1.2.1.1.4.0", "OCTET STRING", "noc@example.com"],
  ["1.3.6.1.2.1.1.5.0", "OCTET STRING", "core-sw01"],
  ["1.3.6.1.2.1.1.6.0", "OCTET STRING", "Sala de equipos, piso 3"],
  ["1.3.6.1.2.1.1.7.0", "INTEGER", "6"],
].map(([oid, type, value]) => ({ oid, type, value }));
const IFS = ["Gi1/0/1", "Gi1/0/2", "Gi1/0/3", "Gi1/0/4", "Gi1/0/5", "Gi1/0/6", "Gi1/0/7", "Gi1/0/8", "Te1/1/1", "Te1/1/2", "Vlan10", "Vlan20"];
const longName = (n) => n.replace(/^Gi/, "GigabitEthernet").replace(/^Te/, "TenGigabitEthernet");
const col = (base, vals, type = "OCTET STRING") => vals.map((v, i) => ({ oid: `${base}.${i + 1}`, type, value: String(v) }));
const WALKS = {
  "1.3.6.1.2.1.1": () => SYS,
  "1.3.6.1.2.1.2.2.1.2": () => col("1.3.6.1.2.1.2.2.1.2", IFS.map(longName)),
  "1.3.6.1.2.1.2.2.1.8": () => col("1.3.6.1.2.1.2.2.1.8", IFS.map((_, i) => (i === 2 || i === 3 ? 2 : 1)), "INTEGER"),
  "1.3.6.1.2.1.31.1.1.1.1": () => col("1.3.6.1.2.1.31.1.1.1.1", IFS),
};
const baseWalk = M.handlers.snmp_walk;
M.handlers.snmp_walk = (args) => {
  const make = WALKS[String(args.oid).replace(/\.$/, "")];
  if (!make) return baseWalk(args);
  const id = newJob();
  const rows = make();
  (async () => {
    await wait(250);
    for (let i = 0; i < rows.length; i += 4) {
      job(id, "line", "", { rows: rows.slice(i, i + 4) });
      await wait(120);
    }
    job(id, "result", "", { count: rows.length, truncated: false, cancelled: false, ms: 96 });
    job(id, "done");
  })();
  return id;
};
const ALL = [...SYS, ...WALKS["1.3.6.1.2.1.2.2.1.2"](), ...WALKS["1.3.6.1.2.1.31.1.1.1.1"]()];
const cmpOid = (a, b) => {
  const x = a.split(".").map(Number), y = b.split(".").map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? -1) !== (y[i] ?? -1)) return (x[i] ?? -1) - (y[i] ?? -1);
  return 0;
};
const SORTED = [...ALL].sort((a, b) => cmpOid(a.oid, b.oid));
const baseReq = M.handlers.snmp_request;
M.handlers.snmp_request = (args) => {
  const { op, oids = [], maxRep = 10 } = args;
  if (op === "getnext") return wait(120).then(() => oids.map((o) => SORTED.find((r) => cmpOid(r.oid, o) > 0) ?? { oid: o, type: "endOfMibView", value: "Fin de la MIB" }));
  if (op === "getbulk") return wait(150).then(() => oids.flatMap((o) => SORTED.filter((r) => cmpOid(r.oid, o) > 0).slice(0, maxRep)));
  if (op === "get") {
    const hit = oids.map((o) => SYS.find((r) => r.oid === o));
    if (hit.every(Boolean)) return wait(100).then(() => hit);
  }
  return baseReq(args);
};

// ---------------------------------------------------------------- Syslog
const SYSLOG = [
  [3, "%LINK-3-UPDOWN: Interface GigabitEthernet1/0/3, changed state to down"],
  [5, "%LINEPROTO-5-UPDOWN: Line protocol on Interface GigabitEthernet1/0/3, changed state to down"],
  [5, "%SYS-5-CONFIG_I: Configured from console by admin on vty0 (192.0.2.250)"],
  [4, "%PLATFORM_ENV-4-FAN: Fan 2 speed above threshold"],
  [6, "%SEC_LOGIN-6-LOGIN_SUCCESS: Login Success [user: admin] [Source: 192.0.2.250] [localport: 22]"],
  [3, "%LINK-3-UPDOWN: Interface GigabitEthernet1/0/3, changed state to up"],
];
const baseStart = M.handlers.server_start;
M.handlers.server_start = (args) => {
  const r = baseStart(args);
  if (args.kind === "syslog")
    (async () => {
      for (const [i, [severity, msg]] of SYSLOG.entries()) {
        await wait(i ? 650 : 500);
        M.emit("syslog", [{ ts: Date.now(), src: i === 3 ? "192.0.2.11" : "192.0.2.1", severity, facility: 23, msg }]);
      }
    })();
  return r;
};

// ---------------------------------------------------------------- Diagnóstico: puertos TCP
M.handlers.tool_ports = ({ ports = [22, 23, 443] }) =>
  wait(700).then(() =>
    ports.map((port) => (port === 23 ? { port, open: false, rtt: null, error: "rechazado" } : [22, 443, 80, 830].includes(port) ? { port, open: true, rtt: port === 22 ? 3 : 4, error: null } : { port, open: false, rtt: null, error: "sin respuesta" })),
  );

// ---------------------------------------------------------------- Escenas de mock.js sin el clic final
// ?noclick=1: la escena prepara Topología pero no pulsa "Descubrir por SNMP" ni "Tráfico" (lo hace el video).
if (q.get("noclick") === "1")
  window.addEventListener(
    "click",
    (e) => {
      const b = e.target?.closest?.("button");
      if (!e.isTrusted && b && /Descubrir por SNMP|Mostrar el tráfico/.test(`${b.textContent} ${b.title}`)) e.stopImmediatePropagation();
    },
    true,
  );
// ?intervalo=30: intervalo de lectura del tráfico (la escena de mock.js fija 15 s).
if (q.get("intervalo")) {
  try {
    const ui = JSON.parse(localStorage.getItem("topoUi") ?? "{}");
    ui.interval = Number(q.get("intervalo"));
    localStorage.setItem("topoUi", JSON.stringify(ui));
  } catch {}
}

// Utilidades para el guion de grabación (CDP).
window.__v2 = { transfer, invoke, shared, copied, busy: (n) => (busyLeft = n) };
