/**
 * Paleta de resaltado legible por tema. Los colores con nombre de una regla (red, green, cyan...)
 * no se envían como ANSI crudo: se resuelven contra el tema activo y se ajustan para que
 *  - tengan contraste WCAG >= 4,5:1 contra el fondo (gris de comentarios: 3:1),
 *  - se distingan del color de texto base (distancia OKLab, ΔE >= 0,09; blanco queda exento),
 *  - rojo y verde difieran también en luminosidad (daltonismo rojo/verde),
 * conservando el tono del tema en lo posible. En temas monocromos (p. ej. ámbar, donde todos
 * los ANSI son naranjos) los roles recuperan un tono propio de baja saturación.
 * Modelos: contraste relativo WCAG 2.x y espacio OKLab (Ottosson, 2020).
 */
import type { ITheme } from "@xterm/xterm";

export const MIN_CONTRAST = 4.5;
export const MIN_CONTRAST_MUTED = 3;
export const MIN_DELTA_E = 0.09;
export const MIN_RG_LIGHTNESS = 0.08;

type RGB = [number, number, number];
type Lab = [number, number, number];

export function parseColor(c: string | undefined): RGB | null {
  if (!c) return null;
  let m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(c);
  if (m) return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
  m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(c);
  if (m) return [parseInt(m[1] + m[1], 16), parseInt(m[2] + m[2], 16), parseInt(m[3] + m[3], 16)];
  m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(c);
  if (m) return [+m[1], +m[2], +m[3]];
  return null;
}

const toHex = (rgb: RGB) => "#" + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
const lin = (v: number) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const unlin = (v: number) => 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);

export function luminance(rgb: RGB): number {
  return 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
}

/** Relación de contraste WCAG 2.x entre dos colores (1 a 21). */
export function contrast(a: string, b: string): number {
  const ra = parseColor(a);
  const rb = parseColor(b);
  if (!ra || !rb) return 21;
  const la = luminance(ra);
  const lb = luminance(rb);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function toLab(rgb: RGB): Lab {
  const [r, g, b] = rgb.map(lin);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function fromLab([L, a, b]: Lab): { rgb: RGB; inGamut: boolean } {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lr = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  const inGamut = lr.every((v) => v >= -0.0005 && v <= 1.0005);
  return { rgb: lr.map((v) => unlin(Math.max(0, Math.min(1, v)))) as RGB, inGamut };
}

/** Distancia perceptual euclidiana en OKLab. */
export function deltaE(a: string, b: string): number {
  const ra = parseColor(a);
  const rb = parseColor(b);
  if (!ra || !rb) return 1;
  const la = toLab(ra);
  const lb = toLab(rb);
  return Math.hypot(la[0] - lb[0], la[1] - lb[1], la[2] - lb[2]);
}

/** Luminosidad perceptual OKLab (0 a 1). */
export function lightness(c: string): number {
  const rgb = parseColor(c);
  return rgb ? toLab(rgb)[0] : 0;
}

function lch(c: string): [number, number, number] {
  const [L, a, b] = toLab(parseColor(c) ?? [0, 0, 0]);
  return [L, Math.hypot(a, b), (Math.atan2(b, a) * 180) / Math.PI];
}

/** OKLCH a hex; si cae fuera de sRGB baja la saturación hasta que entre. */
function fromLch(L: number, C: number, h: number): string {
  const rad = (h * Math.PI) / 180;
  for (let c = C; c >= 0; c -= 0.005) {
    const { rgb, inGamut } = fromLab([L, c * Math.cos(rad), c * Math.sin(rad)]);
    if (inGamut || c < 0.005) return toHex(rgb);
  }
  return toHex(fromLab([L, 0, 0]).rgb);
}

const hueDist = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

export type HlColorName =
  | "red" | "green" | "yellow" | "blue" | "magenta" | "cyan" | "white" | "gray"
  | "brightRed" | "brightGreen" | "brightYellow" | "brightBlue" | "brightMagenta" | "brightCyan";

/** Tono de cada rol cuando el tema no trae tonos propios (OKLCH). */
const ROLE_HUE: Record<string, number> = { red: 27, green: 145, yellow: 100, blue: 255, magenta: 330, cyan: 205 };
const ROLE_CHROMA = 0.115;
/** El rojo necesita más saturación y menos luminosidad que el resto para leerse como rojo y no como rosado. */
const RED_CHROMA = 0.16;

interface Opts {
  bg: string;
  fg: string;
  minContrast: number;
  /** Exento de la distancia al texto (blanco). */
  anyFg?: boolean;
  extra?: (hex: string) => boolean;
}

/**
 * Ajusta un color con el menor cambio posible (luminosidad y, si hace falta, tono) hasta
 * cumplir contraste y distancia al texto base.
 */
function fit(hex: string, o: Opts): string {
  const ok = (c: string) =>
    contrast(c, o.bg) >= o.minContrast && (o.anyFg || deltaE(c, o.fg) >= MIN_DELTA_E) && (!o.extra || o.extra(c));
  if (ok(hex)) return hex;
  const [L, C, h] = lch(hex);
  let best = hex;
  let bestCost = Infinity;
  const hueSteps = o.anyFg ? [0] : [0, 10, -10, 20, -20, 30, -30, 45, -45, 60, -60, 80, -80];
  for (const dh of hueSteps) {
    for (let dl = -0.5; dl <= 0.5; dl += 0.01) {
      const l = L + dl;
      if (l < 0.05 || l > 0.99) continue;
      const cand = fromLch(l, C, h + dh);
      const cost = Math.abs(dl) + (Math.abs(dh) / 90) * 0.3;
      if (cost < bestCost && ok(cand)) {
        best = cand;
        bestCost = cost;
      }
    }
  }
  // Sin solución (fondo y texto casi iguales): extremo de luminosidad que más contrasta.
  if (bestCost === Infinity) {
    const bgL = lightness(o.bg);
    return fromLch(bgL > 0.6 ? 0.15 : 0.97, 0, h);
  }
  return best;
}

export type Palette = Record<HlColorName, string>;

const NAMES: HlColorName[] = [
  "red", "green", "yellow", "blue", "magenta", "cyan", "white", "gray",
  "brightRed", "brightGreen", "brightYellow", "brightBlue", "brightMagenta", "brightCyan",
];

/** El tema no distingue tonos: todos los ANSI cromáticos caen cerca del tono del texto. */
export function isMonochrome(theme: ITheme): boolean {
  const fg = theme.foreground ?? "#ffffff";
  const [, fc, fh] = lch(fg);
  if (fc < 0.03) return false;
  const keys = ["red", "green", "yellow", "blue", "magenta", "cyan"] as const;
  const spread = keys.map((k) => {
    const c = theme[k];
    if (!c || !parseColor(c)) return 180;
    const [, cc, ch] = lch(c);
    return cc < 0.03 ? 180 : hueDist(ch, fh);
  });
  return Math.max(...spread) < 50;
}

/** Tipo de ajuste por color con nombre. */
export function baseColor(theme: ITheme, name: string): string | undefined {
  const key = name === "gray" ? "brightBlack" : name;
  const v = (theme as Record<string, string | undefined>)[key];
  return v && parseColor(v) ? toHex(parseColor(v)!) : undefined;
}

const cache = new WeakMap<object, Palette>();

/** Paleta efectiva (nombre de color a #rrggbb) del tema, con caché por objeto de tema. */
export function resolvePalette(theme: ITheme): Palette {
  const hit = cache.get(theme);
  if (hit) return hit;
  const bg = toHex(parseColor(theme.background) ?? [0, 0, 0]);
  const fg = toHex(parseColor(theme.foreground) ?? [255, 255, 255]);
  const mono = isMonochrome(theme);
  const out = {} as Palette;
  const dark = lightness(bg) < 0.6;
  for (const name of NAMES) {
    const raw = baseColor(theme, name) ?? fg;
    let start = raw;
    const role = name.replace(/^bright/, "").toLowerCase();
    if (mono && ROLE_HUE[role] !== undefined) {
      const [L] = lch(raw);
      const bright = name.startsWith("bright");
      const floor = dark ? (role === "red" ? (bright ? 0.74 : 0.66) : bright ? 0.82 : 0.74) : 0.4;
      start = fromLch(Math.min(0.9, Math.max(L, floor)), role === "red" ? RED_CHROMA : ROLE_CHROMA, ROLE_HUE[role]);
    }
    const base: Opts = {
      bg,
      fg,
      minContrast: name === "gray" ? MIN_CONTRAST_MUTED : MIN_CONTRAST,
      anyFg: name === "white",
    };
    // Verde claramente más claro/oscuro que el rojo (daltonismo): bueno y malo no solo por tono.
    if (name === "green" || name === "brightGreen") {
      const redL = lightness(out[name === "green" ? "red" : "brightRed"]);
      base.extra = (c) => Math.abs(lightness(c) - redL) >= MIN_RG_LIGHTNESS;
    }
    out[name] = fit(start, base);
  }
  cache.set(theme, out);
  return out;
}

/** Color final de un nombre ANSI para un tema, o undefined si no es un nombre conocido. */
export function themedColor(name: string, theme: ITheme): string | undefined {
  if (!NAMES.includes(name as HlColorName)) return undefined;
  return resolvePalette(theme)[name as HlColorName];
}
