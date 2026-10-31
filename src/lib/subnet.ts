/** Calculadora IPv4/IPv6 (sin dependencias). */

export interface V4Result {
  version: 4;
  address: string;
  prefix: number;
  mask: string;
  wildcard: string;
  network: string;
  broadcast: string;
  first: string;
  last: string;
  hosts: number;
  total: number;
  cls: string;
  scope: string;
  binary: string;
}

export interface V6Result {
  version: 6;
  address: string;
  prefix: number;
  network: string;
  first: string;
  last: string;
  total: string;
  scope: string;
}

const toV4 = (n: number) => [24, 16, 8, 0].map((s) => (n >>> s) & 255).join(".");

function parseV4(s: string): number | null {
  const p = s.trim().split(".");
  if (p.length !== 4) return null;
  let n = 0;
  for (const part of p) {
    if (!/^\d{1,3}$/.test(part) || Number(part) > 255) return null;
    n = n * 256 + Number(part);
  }
  return n >>> 0;
}

function maskToPrefix(mask: string): number | null {
  const m = parseV4(mask);
  if (m == null) return null;
  const bits = m.toString(2).padStart(32, "0");
  if (!/^1*0*$/.test(bits)) return null;
  return bits.indexOf("0") === -1 ? 32 : bits.indexOf("0");
}

function v4Scope(n: number): string {
  const a = n >>> 24;
  const b = (n >>> 16) & 255;
  if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return "Privada (RFC 1918)";
  if (a === 100 && b >= 64 && b <= 127) return "CGNAT (RFC 6598)";
  if (a === 127) return "Loopback";
  if (a === 169 && b === 254) return "Link-local";
  if (a >= 224 && a <= 239) return "Multicast";
  if (a >= 240) return "Reservada";
  return "Pública";
}

/** Acepta "10.0.0.1/24", "10.0.0.1 255.255.255.0" o "10.0.0.1/255.255.255.0". */
export function calcV4(input: string): V4Result | null {
  const m = input.trim().match(/^(\d+\.\d+\.\d+\.\d+)(?:\s*[/ ]\s*(\S+))?$/);
  if (!m) return null;
  const addr = parseV4(m[1]);
  if (addr == null) return null;
  let prefix = 32;
  if (m[2]) {
    prefix = /^\d{1,2}$/.test(m[2]) ? Number(m[2]) : (maskToPrefix(m[2]) ?? -1);
    if (prefix < 0 || prefix > 32) return null;
  }
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const network = (addr & mask) >>> 0;
  const broadcast = (network | (~mask >>> 0)) >>> 0;
  const total = 2 ** (32 - prefix);
  const hosts = prefix >= 31 ? total : total - 2; // /31 punto a punto (RFC 3021), /32 host
  const first = prefix >= 31 ? network : network + 1;
  const last = prefix >= 31 ? broadcast : broadcast - 1;
  const a = addr >>> 24;
  const cls = a < 128 ? "A" : a < 192 ? "B" : a < 224 ? "C" : a < 240 ? "D" : "E";
  const bin = addr.toString(2).padStart(32, "0");
  return {
    version: 4,
    address: toV4(addr),
    prefix,
    mask: toV4(mask),
    wildcard: toV4(~mask >>> 0),
    network: toV4(network),
    broadcast: toV4(broadcast),
    first: toV4(first),
    last: toV4(last),
    hosts,
    total,
    cls,
    scope: v4Scope(addr),
    binary: [0, 8, 16, 24].map((i) => bin.slice(i, i + 8)).join("."),
  };
}

/** Divide una red en subredes de un prefijo mayor (máx. 1024 resultados). */
export function splitV4(network: string, prefix: number, newPrefix: number): { cidr: string; first: string; last: string }[] {
  const base = parseV4(network);
  if (base == null || newPrefix < prefix || newPrefix > 32) return [];
  const count = Math.min(2 ** (newPrefix - prefix), 1024);
  const size = 2 ** (32 - newPrefix);
  return Array.from({ length: count }, (_, i) => {
    const net = base + i * size;
    const bc = net + size - 1;
    return {
      cidr: `${toV4(net)}/${newPrefix}`,
      first: toV4(newPrefix >= 31 ? net : net + 1),
      last: toV4(newPrefix >= 31 ? bc : bc - 1),
    };
  });
}

// ---------- IPv6 ----------

function parseV6(s: string): bigint | null {
  let str = s.trim().toLowerCase();
  if (!/^[0-9a-f:.]+$/.test(str) || (str.match(/::/g) ?? []).length > 1) return null;
  // IPv4 incrustada al final (::ffff:10.0.0.1)
  const v4 = str.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) {
    const n = parseV4(v4[1]);
    if (n == null) return null;
    str = str.slice(0, -v4[1].length) + ((n >>> 16).toString(16) + ":" + (n & 0xffff).toString(16));
  }
  const [head, tail] = str.includes("::") ? str.split("::") : [str, null];
  const h = head ? head.split(":") : [];
  const t = tail ? tail.split(":") : [];
  const fill = tail === null ? 0 : 8 - h.length - t.length;
  if (fill < 0 || (tail === null && h.length !== 8)) return null;
  const groups = [...h, ...Array(fill).fill("0"), ...t];
  if (groups.length !== 8 || groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  return groups.reduce((acc, g) => (acc << 16n) + BigInt(parseInt(g, 16)), 0n);
}

/** Formato comprimido RFC 5952. */
export function formatV6(n: bigint): string {
  const groups = Array.from({ length: 8 }, (_, i) => Number((n >> BigInt(112 - i * 16)) & 0xffffn));
  let best = { start: -1, len: 0 };
  for (let i = 0; i < 8; ) {
    if (groups[i] !== 0) {
      i++;
      continue;
    }
    let j = i;
    while (j < 8 && groups[j] === 0) j++;
    if (j - i > best.len && j - i > 1) best = { start: i, len: j - i };
    i = j;
  }
  const hex = groups.map((g) => g.toString(16));
  if (best.start < 0) return hex.join(":");
  const left = hex.slice(0, best.start).join(":");
  const right = hex.slice(best.start + best.len).join(":");
  return `${left}::${right}`;
}

function v6Scope(n: bigint): string {
  const top = Number(n >> 112n);
  if (n === 1n) return "Loopback";
  if ((top & 0xffc0) === 0xfe80) return "Link-local";
  if ((top & 0xfe00) === 0xfc00) return "ULA (privada)";
  if ((top & 0xff00) === 0xff00) return "Multicast";
  if ((top & 0xe000) === 0x2000) return "Global unicast";
  return "Otra";
}

export function calcV6(input: string): V6Result | null {
  const m = input.trim().match(/^([0-9a-fA-F:.]+)(?:\/(\d{1,3}))?$/);
  if (!m || !m[1].includes(":")) return null;
  const addr = parseV6(m[1]);
  const prefix = m[2] ? Number(m[2]) : 128;
  if (addr == null || prefix > 128) return null;
  const hostBits = BigInt(128 - prefix);
  const mask = ((1n << 128n) - 1n) ^ ((1n << hostBits) - 1n);
  const network = addr & mask;
  const last = network | ((1n << hostBits) - 1n);
  const total = 1n << hostBits;
  return {
    version: 6,
    address: formatV6(addr),
    prefix,
    network: `${formatV6(network)}/${prefix}`,
    first: formatV6(network),
    last: formatV6(last),
    total: hostBits > 64n ? `2^${hostBits}` : total.toLocaleString("es-CL"),
    scope: v6Scope(addr),
  };
}

export function calc(input: string): V4Result | V6Result | null {
  return input.includes(":") ? calcV6(input) : calcV4(input);
}
