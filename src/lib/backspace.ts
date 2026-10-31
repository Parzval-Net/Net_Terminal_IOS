/**
 * Qué envía la tecla Retroceso. xterm.js envía DEL (0x7f, ^?), como PuTTY y la mayoría de las
 * terminales; algunos equipos solo borran con BS (0x08, ^H). Huawei VRP documenta CTRL_H como
 * la tecla de sistema que borra el carácter a la izquierda del cursor (no se puede reasignar),
 * y no documenta DEL: por eso en plataformas Huawei el modo automático usa BS.
 */
import type { Session } from "../types";

export type BackspaceMode = "del" | "bs";

export const DEL = "\x7f";
export const BS = "\b";
/** ^W: borra la palabra a la izquierda (VRP CTRL_W, IOS, Junos, bash y zsh). */
export const CTRL_W = "\x17";

/** Plataformas del catálogo Huawei (VRP 5, VRP 8 y YunShan, basado en VRP). */
export const HUAWEI_PLATFORMS: ReadonlySet<string> = new Set(["vrp5", "vrp8", "yunshan"]);

/**
 * Prompt típico de Huawei VRP al inicio de la línea: vista de usuario `<equipo>` o vista de
 * sistema `[equipo]` / `[~equipo]` / `[*equipo]` (VRP8 y YunShan). Sirve cuando la plataforma
 * aún no se detectó (conexión rápida). Un prompt de Linux como `[user@host ~]$` no calza:
 * tiene espacio y termina en `$`.
 */
const HUAWEI_PROMPT = /^(?:<[^<>\s]{1,64}>|\[[~*]{0,2}[^[\]\s]{1,64}\])/;
export const looksHuaweiPrompt = (line: string) => HUAWEI_PROMPT.test(line);

/**
 * Modo efectivo: el elegido en la sesión o, en automático, BS para Huawei (por plataforma o,
 * si aún no se conoce, por el prompt de la línea actual) y DEL para el resto.
 */
export function backspaceMode(s: Pick<Session, "backspace" | "platform">, promptLine?: string): BackspaceMode {
  if (s.backspace === "del" || s.backspace === "bs") return s.backspace;
  if (s.platform) return HUAWEI_PLATFORMS.has(s.platform) ? "bs" : "del";
  return promptLine && looksHuaweiPrompt(promptLine) ? "bs" : "del";
}

/** Opciones del selector "Retroceso envía" (sesión y conexión rápida); "" = automático. */
export function backspaceOptions(platform?: string): [string, string][] {
  const auto = platform && HUAWEI_PLATFORMS.has(platform) ? "BS, plataforma Huawei" : "DEL; BS si es Huawei";
  return [
    ["", `Automático (${auto})`],
    ["del", "DEL (^?)"],
    ["bs", "BS (^H)"],
  ];
}

/** Lo que xterm.js entrega por onData para Retroceso con o sin Ctrl/Alt. */
const XTERM_BACKSPACE: ReadonlySet<string> = new Set([DEL, BS, "\x1b\x7f", "\x1b\b"]);

export interface KeyMods {
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

/**
 * Secuencia para una pulsación de Retroceso (null: se deja lo que envía xterm).
 * - Retroceso: el código del modo.
 * - Shift+Retroceso: el otro código, como en PuTTY, para probar sin cambiar la sesión.
 * - Ctrl o Alt (Option en macOS) + Retroceso en la línea de comandos: ^W, borrar palabra
 *   (como la terminal de VS Code). En pantalla completa (vim, nano) se respeta la convención
 *   de xterm: Ctrl envía el otro código y Alt antepone ESC.
 */
export function backspaceSeq(e: KeyMods, mode: BackspaceMode, lineEditing: boolean): string | null {
  if (e.metaKey) return null;
  const main = mode === "bs" ? BS : DEL;
  const other = mode === "bs" ? DEL : BS;
  if (e.ctrlKey || e.altKey) {
    if (lineEditing) return CTRL_W;
    return (e.altKey ? "\x1b" : "") + (e.ctrlKey ? other : main);
  }
  return e.shiftKey ? other : main;
}

/** Reemplaza lo que xterm envió para Retroceso por la secuencia elegida. */
export function translateBackspace(data: string, seq: string | null): string {
  return seq !== null && XTERM_BACKSPACE.has(data) ? seq : data;
}
