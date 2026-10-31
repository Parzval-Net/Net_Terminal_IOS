/** Perfiles de sistema de archivos por fabricante: comandos y lectura de "dir". */

export interface RemoteFile {
  name: string;
  size: number;
  date: string;
  dir: boolean;
}

export interface Vars {
  ip: string;
  port: number;
  file: string;
  fs: string;
  extra: string;
}

export interface Profile {
  id: string;
  label: string;
  fs: string;
  list: (fs: string) => string;
  /** El equipo descarga desde este PC. */
  upload: (v: Vars, proto: "tftp" | "http") => string;
  /** El equipo sube a este PC (requiere TFTP con escritura). */
  download: ((v: Vars) => string) | null;
  backup: ((v: Vars) => string) | null;
  /**
   * FTP con el servidor de la app. `cred` es "nt:contraseña" (la contraseña cambia en cada
   * inicio del servidor; el usuario es siempre nt). Solo fabricantes que aceptan la contraseña en la URL: los
   * que la piden por teclado (NX-OS, VRP) no se automatizan.
   */
  ftp?: {
    upload: (v: Vars, cred: string) => string;
    download?: (v: Vars, cred: string) => string;
    backup?: (v: Vars, cred: string) => string;
  };
  /** Comando que muestra el MD5 de un archivo en el equipo (verificación de firmware). */
  md5: ((v: Vars) => string) | null;
  note?: string;
}

/** Extrae el último hash MD5 (32 hex) de la salida del equipo. */
export function parseMd5(output: string): string | null {
  const all = output.toLowerCase().match(/\b[0-9a-f]{32}\b/g);
  return all ? all[all.length - 1] : null;
}

const join = (fs: string, file: string) => (fs.endsWith("/") || fs.endsWith(":") ? `${fs}${file}` : `${fs}/${file}`);
const sfx = (extra: string) => (extra.trim() ? ` ${extra.trim()}` : "");

export const profiles: Profile[] = [
  {
    id: "cisco",
    label: "Cisco IOS / IOS-XE / Arista",
    fs: "flash:",
    list: (fs) => `dir ${fs}`,
    upload: (v, proto) =>
      proto === "http"
        ? `copy http://${v.ip}:${v.port}/${v.file} ${join(v.fs, v.file)}${sfx(v.extra)}`
        : `copy tftp://${v.ip}/${v.file} ${join(v.fs, v.file)}${sfx(v.extra)}`,
    download: (v) => `copy ${join(v.fs, v.file)} tftp://${v.ip}/${v.file}${sfx(v.extra)}`,
    backup: (v) => `copy running-config tftp://${v.ip}/${v.file}${sfx(v.extra)}`,
    md5: (v) => `verify /md5 ${join(v.fs, v.file)}`,
    // Cisco IOS/IOS-XE: copy ftp://usuario:contraseña@host/archivo (Cisco IOS Configuration
    // Fundamentals, "Using the Cisco IOS File System").
    ftp: {
      upload: (v, c) => `copy ftp://${c}@${v.ip}/${v.file} ${join(v.fs, v.file)}${sfx(v.extra)}`,
      download: (v, c) => `copy ${join(v.fs, v.file)} ftp://${c}@${v.ip}/${v.file}${sfx(v.extra)}`,
      backup: (v, c) => `copy running-config ftp://${c}@${v.ip}/${v.file}${sfx(v.extra)}`,
    },
  },
  {
    id: "nxos",
    label: "Cisco NX-OS",
    fs: "bootflash:",
    list: (fs) => `dir ${fs}`,
    upload: (v, proto) =>
      `copy ${proto}://${v.ip}${proto === "http" ? `:${v.port}` : ""}/${v.file} ${join(v.fs, v.file)} vrf ${v.extra.trim() || "management"}`,
    download: (v) => `copy ${join(v.fs, v.file)} tftp://${v.ip}/${v.file} vrf ${v.extra.trim() || "management"}`,
    backup: (v) => `copy running-config tftp://${v.ip}/${v.file} vrf ${v.extra.trim() || "management"}`,
    md5: (v) => `show file ${join(v.fs, v.file)} md5sum`,
    note: "En NX-OS el campo extra es la VRF (por defecto management).",
  },
  {
    id: "huawei",
    label: "Huawei VRP / H3C",
    fs: "flash:/",
    list: (fs) => `dir ${fs}`,
    upload: (v) => `tftp ${v.ip} get ${v.file}`,
    download: (v) => `tftp ${v.ip} put ${v.file}`,
    backup: null,
    md5: null,
    note: "VRP guarda en el directorio actual; usa 'cd flash:/' antes si cambiaste de carpeta.",
  },
  {
    id: "juniper",
    label: "Juniper Junos",
    fs: "/var/tmp/",
    list: (fs) => `file list ${fs} detail | no-more`,
    upload: (v, proto) =>
      `file copy ${proto}://${v.ip}${proto === "http" ? `:${v.port}` : ""}/${v.file} ${v.fs}`,
    download: null,
    backup: null,
    md5: (v) => `file checksum md5 ${v.fs}${v.file}`,
    // Junos: file copy ftp://usuario:contraseña@host/archivo destino (Junos CLI, "file copy").
    ftp: {
      upload: (v, c) => `file copy ftp://${c}@${v.ip}/${v.file} ${v.fs}`,
      download: (v, c) => `file copy ${v.fs}${v.file} ftp://${c}@${v.ip}/${v.file}`,
    },
    note: "Junos no sube archivos por TFTP; para extraer usa SCP (cifrado).",
  },
];

const units: Record<string, number> = { "": 1, B: 1, BYTES: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3 };
const num = (s: string) => Number(s.replace(/[,.](?=\d{3}\b)/g, ""));

/** Lee la salida de dir / file list. Reconoce Cisco, Huawei y Junos. */
export function parseListing(output: string): { files: RemoteFile[]; free: number | null; total: number | null } {
  const files: RemoteFile[] = [];
  for (const raw of output.split("\n")) {
    const line = raw.replace(/\r/g, "").trimEnd();
    // Cisco:  "  1  -rw-   33591768  Mar 1 1993 00:04:25 +00:00  c2960.bin"
    // Huawei: "  0  -rw-   125,644,800  Jun 01 2023 10:00:00   s5735.cc"
    let m = line.match(/^\s*\d+\s+([-dlrwx]{3,10})\s+([\d,.]+)\s+(.+?)\s{1,}(\S+)$/);
    if (m && /\d{1,2}:\d{2}|<no date>|\d{4}/.test(m[3])) {
      files.push({ name: m[4], size: num(m[2]), date: m[3].trim(), dir: m[1].startsWith("d") });
      continue;
    }
    // Junos: "-rw-r--r--  1 root  wheel   12345 Jan  1 12:00 junos.tgz"
    m = line.match(/^([-dl][-rwxst]{9})\s+\d+\s+\S+\s+\S+\s+(\d+)\s+(\w{3}\s+\d+\s+[\d:]+)\s+(.+)$/);
    if (m) files.push({ name: m[4].replace(/\/$/, ""), size: Number(m[2]), date: m[3], dir: m[1].startsWith("d") });
  }
  const freeM = output.match(/([\d,.]+)\s*(bytes|KB|MB|GB)?\s*(?:total[^()\n]*)?\(\s*([\d,.]+)\s*(bytes|KB|MB|GB)?\s*free\)/i);
  const total = freeM ? num(freeM[1]) * (units[(freeM[2] ?? "").toUpperCase()] ?? 1) : null;
  const free = freeM ? num(freeM[3]) * (units[(freeM[4] ?? freeM[2] ?? "").toUpperCase()] ?? 1) : null;
  return { files, free, total };
}

/**
 * Sugiere el perfil de la sesión: primero la plataforma detectada o fijada en el catálogo
 * (NX-OS usa bootflash: y "vrf management"), luego el resaltado configurado.
 */
export function guessProfile(session?: { platform?: string; highlight?: string }): string {
  const p = session?.platform ?? "";
  if (p === "nxos") return "nxos";
  if (/^(junos|ex-legacy)/.test(p)) return "juniper";
  if (/^(vrp|yunshan)/.test(p)) return "huawei";
  if (/^(ios|iosxe|iosxr)$/.test(p)) return "cisco";
  if (session?.highlight === "huawei") return "huawei";
  if (session?.highlight === "juniper") return "juniper";
  return "cisco";
}

/**
 * Comandos para que el equipo envíe syslog a este PC.
 * - Cisco IOS/IOS-XE: "logging host IP transport udp port N" (Cisco IOS Configuration
 *   Fundamentals, "logging host").
 * - Huawei: "info-center loghost IP port N" (parámetro opcional, 1 a 65535, 514 por defecto en
 *   UDP). Revisado en support.huawei.com (octubre 2026): referencia de comandos de CloudEngine
 *   16800 V300R026C00 ("info-center loghost (System view)", EDOC1100611763) y guía de
 *   configuración de S5700/S6700 V200R024C10 (EDOC1100456148, "port port"); antes, CE16800
 *   V300R025C00 y NE08E/NE05E V800R022C00. La referencia de AR500 V200R007 no lo trae y no se
 *   pudo confirmar en otros AR: la interfaz pide verificarlo en la versión del equipo.
 */
export function loghostCommands(ip: string, port: number): { cisco: string; huawei: string; huaweiPortNote: boolean } {
  const custom = port !== 514;
  return {
    cisco: `logging host ${ip}${custom ? ` transport udp port ${port}` : ""}`,
    huawei: `info-center loghost ${ip}${custom ? ` port ${port}` : ""}`,
    huaweiPortNote: custom,
  };
}
