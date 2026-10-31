export const isAndroid = typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);
export const isMobile = typeof navigator !== "undefined" && /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
export const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent);

/**
 * Modificador de la app. En macOS es Cmd; en Windows/Linux es Ctrl+Shift para no
 * robarle a la terminal combinaciones como Ctrl+C, Ctrl+W o Ctrl+K.
 */
export function isMod(e: KeyboardEvent): boolean {
  return isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && e.shiftKey && !e.metaKey;
}

export const modLabel = isMac ? "⌘" : "Ctrl+Shift+";
export const zoomLabel = isMac ? "⌘" : "Ctrl+Shift+";
/** Atajo de "Cerrar todas las pestañas" para mostrar en la interfaz. */
export const closeAllLabel = isMac ? "⌘⇧W" : "Ctrl+Shift+Alt+W";
/**
 * Atajos de 3 teclas y con la misma letra en todos los sistemas: ⌘⇧ + letra en macOS, Ctrl+Shift +
 * letra en Windows/Linux. Letras libres en la app (en uso: B D E F I J K L N O P T W), en los
 * sistemas (macOS: ⌘⇧3/4/5 capturas, ⌘⇧Q/A/H de Finder; Windows: Ctrl+Shift+Esc; GNOME/KDE sin
 * atajos globales sobre estas) y en la terminal (Ctrl+Shift+C/V). ⌘M y ⌘H serían los de minimizar
 * y ocultar en macOS, por eso van con Shift. ⌘⇧F vuelve a ser Buscar en macOS.
 *  - Modo foco: M (de "modo"). Ctrl+Shift+M no la usa ni Windows ni GNOME/KDE.
 *  - Historial de comandos: Y (como el historial de Chrome/Safari, ⌘Y). Ctrl+Shift+Y está libre.
 */
export const focusLabel = isMac ? "⌘⇧M" : "Ctrl+Shift+M";
export const historyLabel = isMac ? "⌘Y" : "Ctrl+Shift+Y";

export type AppAction =
  | "settings"
  | "notes"
  | "duplicateTab"
  | "tools"
  | "commands"
  | "palette"
  | "newTab"
  | "closeTab"
  | "closeAll"
  | "focusMode"
  | "history"
  | "newSession"
  | "quickConnect"
  | "cliLab"
  | "toggleSidebar"
  | "find"
  | "nextTab"
  | "prevTab"
  | "zoomIn"
  | "zoomOut"
  | "zoomReset"
  | { tab: number };

/** Traduce un evento de teclado a una acción de la app (o null si es para la terminal). */
export function shortcutFor(e: KeyboardEvent): AppAction | null {
  if (e.type !== "keydown") return null;
  const key = e.key.toLowerCase();

  if (e.ctrlKey && key === "tab") return e.shiftKey ? "prevTab" : "nextTab";

  // Zoom: Cmd + = - 0 en macOS; Ctrl+Shift en Windows/Linux para no capturar Ctrl+- (^_,
  // deshacer en readline/emacs) ni Ctrl+0, que la terminal sí usa. Se mira e.code porque con
  // Shift la tecla cambia de carácter según la distribución.
  const zoomMod = isMac ? e.metaKey : e.ctrlKey && e.shiftKey && !e.altKey;
  if (zoomMod && (e.code === "Equal" || e.code === "NumpadAdd" || key === "+")) return "zoomIn";
  if (zoomMod && (e.code === "Minus" || e.code === "NumpadSubtract")) return "zoomOut";
  if (zoomMod && (e.code === "Digit0" || e.code === "Numpad0")) return "zoomReset";

  if (isMac && e.metaKey && /^[1-9]$/.test(key)) return { tab: Number(key) - 1 };
  if ((isMac ? e.metaKey : e.ctrlKey) && key === ",") return "settings";

  // Cerrar todas las pestañas: ⌘⇧W en macOS. En Windows/Linux Ctrl+Shift+W ya es "cerrar
  // pestaña" (el modificador incluye Shift), así que se usa Ctrl+Shift+Alt+W. Va antes del
  // switch porque isMod no distingue el Shift ni el Alt extra.
  const w = key === "w" || e.code === "KeyW";
  if (w && (isMac ? e.metaKey && e.shiftKey && !e.ctrlKey && !e.altKey : e.ctrlKey && e.shiftKey && e.altKey && !e.metaKey))
    return "closeAll";

  // Modo foco (M): ⌘⇧M en macOS y Ctrl+Shift+M en Windows/Linux. Va antes de isMod, que en macOS
  // no distingue el Shift (⌘M minimizaría la ventana, por eso aquí se exige Shift).
  const sh = isMac ? e.metaKey && e.shiftKey && !e.ctrlKey && !e.altKey : e.ctrlKey && e.shiftKey && !e.altKey && !e.metaKey;
  if (sh && (key === "m" || e.code === "KeyM")) return "focusMode";

  if (!isMod(e)) return null;
  switch (key) {
    case "k":
    case "p":
      return "palette";
    case "t":
      return "newTab";
    case "w":
      return "closeTab";
    case "n":
      return "newSession";
    case "o":
      return "quickConnect";
    case "b":
      return "toggleSidebar";
    case "j":
      return "notes";
    case "d":
      return "duplicateTab";
    case "e":
      return "tools";
    case "y":
      return "history";
    case "l":
      return "commands";
    case "i":
      return "cliLab";
    case "f":
      return "find";
    default:
      return null;
  }
}

/** Catálogo de comandos del sistema donde corre la app (para la terminal local). */
export const localOsVendor = (): string =>
  isAndroid ? "linux" : isMac ? "macos" : typeof navigator !== "undefined" && /Windows/i.test(navigator.userAgent) ? "windows" : "linux";
