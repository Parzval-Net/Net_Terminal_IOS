import { useEffect, useState } from "react";
import type { ITheme } from "@xterm/xterm";

export interface TermPreset {
  id: string;
  name: string;
  dark: boolean;
  theme: ITheme;
}

/** Arma un ITheme a partir de fondo, texto, cursor, selección y los 16 colores ANSI. */
function t(bg: string, fg: string, cursor: string, sel: string, ansi: string[]): ITheme {
  const [black, red, green, yellow, blue, magenta, cyan, white] = ansi;
  const [bBlack, bRed, bGreen, bYellow, bBlue, bMagenta, bCyan, bWhite] = ansi.slice(8);
  return {
    background: bg,
    foreground: fg,
    cursor,
    cursorAccent: bg,
    selectionBackground: sel,
    black,
    red,
    green,
    yellow,
    blue,
    magenta,
    cyan,
    white,
    brightBlack: bBlack,
    brightRed: bRed,
    brightGreen: bGreen,
    brightYellow: bYellow,
    brightBlue: bBlue,
    brightMagenta: bMagenta,
    brightCyan: bCyan,
    brightWhite: bWhite,
  };
}

const solarizedAnsi = [
  "#073642", "#dc322f", "#859900", "#b58900", "#268bd2", "#d33682", "#2aa198", "#eee8d5",
  "#586e75", "#cb4b16", "#586e75", "#657b83", "#839496", "#6c71c4", "#93a1a1", "#fdf6e3",
];

// Paletas tomadas de las especificaciones públicas de cada tema.
export const presets: TermPreset[] = [
  {
    id: "nt-dark",
    name: "NetTerminal oscuro",
    dark: true,
    theme: t("#0e1116", "#d6dae0", "#7aa7ff", "rgba(122,167,255,0.30)", [
      "#1f242c", "#ef6b73", "#7ccf8a", "#e6c06b", "#6ea8fe", "#c49bf2", "#5fc8d6", "#d6dae0",
      "#5c6470", "#ff8a91", "#98e2a4", "#f2d38c", "#92bfff", "#d8b6ff", "#83dbe6", "#ffffff",
    ]),
  },
  {
    id: "nt-light",
    name: "NetTerminal claro",
    dark: false,
    theme: t("#ffffff", "#24292f", "#2563eb", "rgba(37,99,235,0.20)", [
      "#24292f", "#cf222e", "#116329", "#8a6100", "#0550ae", "#8250df", "#1b7c83", "#6e7781",
      "#57606a", "#a40e26", "#1a7f37", "#9a6700", "#0969da", "#7c4ddb", "#3192aa", "#8c959f",
    ]),
  },
  {
    id: "classic",
    name: "Clásico",
    dark: true,
    theme: t("#000000", "#c0c0c0", "#c0c0c0", "rgba(192,192,192,0.35)", [
      "#000000", "#cd0000", "#00cd00", "#cdcd00", "#0000ee", "#cd00cd", "#00cdcd", "#e5e5e5",
      "#7f7f7f", "#ff0000", "#00ff00", "#ffff00", "#5c5cff", "#ff00ff", "#00ffff", "#ffffff",
    ]),
  },
  {
    id: "phosphor",
    name: "Fósforo verde",
    dark: true,
    theme: t("#0a0f0a", "#33ff66", "#33ff66", "rgba(51,255,102,0.25)", [
      "#0a0f0a", "#ff5555", "#33ff66", "#ccff66", "#33cc99", "#99ff99", "#66ffcc", "#33ff66",
      "#1f7a3a", "#ff7777", "#66ff88", "#ddff88", "#55ddaa", "#bbffbb", "#88ffdd", "#ccffcc",
    ]),
  },
  {
    // Monocromo ámbar (monitores de fósforo P3): todos los ANSI son tonos naranja/ámbar con
    // luminancia distinta para que el resaltado se distinga. Texto 9,0:1 sobre el fondo (WCAG AA).
    id: "amber",
    name: "Ámbar",
    dark: true,
    theme: t("#1a1208", "#ff9f1c", "#ff9f1c", "rgba(255,159,28,0.25)", [
      "#2b1d0c", "#ff6a3d", "#e0a030", "#ffc85c", "#c47a1c", "#f0885a", "#ffb84a", "#ffd79a",
      "#a67c3c", "#ff8a65", "#f5b547", "#ffe08a", "#d99b3a", "#ffa07a", "#ffcf6e", "#fff0d0",
    ]),
  },
  {
    id: "dracula",
    name: "Dracula",
    dark: true,
    theme: t("#282a36", "#f8f8f2", "#f8f8f2", "#44475a", [
      "#21222c", "#ff5555", "#50fa7b", "#f1fa8c", "#bd93f9", "#ff79c6", "#8be9fd", "#f8f8f2",
      "#6272a4", "#ff6e6e", "#69ff94", "#ffffa5", "#d6acff", "#ff92df", "#a4ffff", "#ffffff",
    ]),
  },
  {
    id: "nord",
    name: "Nord",
    dark: true,
    theme: t("#2e3440", "#d8dee9", "#d8dee9", "#434c5e", [
      "#3b4252", "#bf616a", "#a3be8c", "#ebcb8b", "#81a1c1", "#b48ead", "#88c0d0", "#e5e9f0",
      "#4c566a", "#bf616a", "#a3be8c", "#ebcb8b", "#81a1c1", "#b48ead", "#8fbcbb", "#eceff4",
    ]),
  },
  {
    id: "one-dark",
    name: "One Dark",
    dark: true,
    theme: t("#282c34", "#abb2bf", "#528bff", "#3e4451", [
      "#3f4451", "#e06c75", "#98c379", "#e5c07b", "#61afef", "#c678dd", "#56b6c2", "#abb2bf",
      "#5c6370", "#e06c75", "#98c379", "#e5c07b", "#61afef", "#c678dd", "#56b6c2", "#ffffff",
    ]),
  },
  {
    id: "gruvbox",
    name: "Gruvbox",
    dark: true,
    theme: t("#282828", "#ebdbb2", "#ebdbb2", "#504945", [
      "#282828", "#cc241d", "#98971a", "#d79921", "#458588", "#b16286", "#689d6a", "#a89984",
      "#928374", "#fb4934", "#b8bb26", "#fabd2f", "#83a598", "#d3869b", "#8ec07c", "#ebdbb2",
    ]),
  },
  {
    // https://github.com/folke/tokyonight.nvim (extras/alacritty/tokyonight_night.toml)
    id: "tokyo-night",
    name: "Tokyo Night",
    dark: true,
    theme: t("#1a1b26", "#c0caf5", "#c0caf5", "#33467c", [
      "#15161e", "#f7768e", "#9ece6a", "#e0af68", "#7aa2f7", "#bb9af7", "#7dcfff", "#a9b1d6",
      "#414868", "#f7768e", "#9ece6a", "#e0af68", "#7aa2f7", "#bb9af7", "#7dcfff", "#c0caf5",
    ]),
  },
  {
    // https://github.com/catppuccin/alacritty (catppuccin-mocha.toml)
    id: "catppuccin-mocha",
    name: "Catppuccin Mocha",
    dark: true,
    theme: t("#1e1e2e", "#cdd6f4", "#f5e0dc", "#585b70", [
      "#45475a", "#f38ba8", "#a6e3a1", "#f9e2af", "#89b4fa", "#f5c2e7", "#94e2d5", "#bac2de",
      "#585b70", "#f38ba8", "#a6e3a1", "#f9e2af", "#89b4fa", "#f5c2e7", "#94e2d5", "#a6adc8",
    ]),
  },
  {
    // https://github.com/catppuccin/alacritty (catppuccin-latte.toml)
    id: "catppuccin-latte",
    name: "Catppuccin Latte",
    dark: false,
    theme: t("#eff1f5", "#4c4f69", "#dc8a78", "#acb0be", [
      "#5c5f77", "#d20f39", "#40a02b", "#df8e1d", "#1e66f5", "#ea76cb", "#179299", "#acb0be",
      "#6c6f85", "#d20f39", "#40a02b", "#df8e1d", "#1e66f5", "#ea76cb", "#179299", "#bcc0cc",
    ]),
  },
  {
    // https://github.com/alacritty/alacritty-theme (themes/monokai.toml), paleta clásica de monokai.nl
    id: "monokai",
    name: "Monokai",
    dark: true,
    theme: t("#272822", "#f8f8f2", "#f8f8f0", "#49483e", [
      "#272822", "#f92672", "#a6e22e", "#f4bf75", "#66d9ef", "#ae81ff", "#a1efe4", "#f8f8f2",
      "#75715e", "#f92672", "#a6e22e", "#f4bf75", "#66d9ef", "#ae81ff", "#a1efe4", "#f9f8f5",
    ]),
  },
  {
    // https://github.com/primer/github-vscode-theme (GitHub Dark Default, colores terminal.ansi*)
    id: "github-dark",
    name: "GitHub Dark",
    dark: true,
    theme: t("#0d1117", "#e6edf3", "#58a6ff", "rgba(56,139,253,0.40)", [
      "#484f58", "#ff7b72", "#3fb950", "#d29922", "#58a6ff", "#bc8cff", "#39c5cf", "#b1bac4",
      "#6e7681", "#ffa198", "#56d364", "#e3b341", "#79c0ff", "#d2a8ff", "#56d4dd", "#f0f6fc",
    ]),
  },
  {
    // https://github.com/rose-pine/alacritty (rose-pine.toml)
    id: "rose-pine",
    name: "Rosé Pine",
    dark: true,
    theme: t("#191724", "#e0def4", "#524f67", "#403d52", [
      "#26233a", "#eb6f92", "#31748f", "#f6c177", "#9ccfd8", "#c4a7e7", "#ebbcba", "#e0def4",
      "#6e6a86", "#eb6f92", "#31748f", "#f6c177", "#9ccfd8", "#c4a7e7", "#ebbcba", "#e0def4",
    ]),
  },
  {
    id: "solarized-dark",
    name: "Solarized oscuro",
    dark: true,
    theme: t("#002b36", "#839496", "#93a1a1", "#073642", solarizedAnsi),
  },
  {
    id: "solarized-light",
    name: "Solarized claro",
    dark: false,
    theme: t("#fdf6e3", "#657b83", "#586e75", "#eee8d5", solarizedAnsi),
  },
];

/** "auto" sigue el modo de la interfaz. */
export function resolvePreset(id: string, appDark: boolean): TermPreset {
  if (id === "auto") return presets[appDark ? 0 : 1];
  return presets.find((p) => p.id === id) ?? presets[appDark ? 0 : 1];
}

/** Sigue el modo claro/oscuro del sistema operativo. */
export function useSystemDark(): boolean {
  const query = "(prefers-color-scheme: dark)";
  const [dark, setDark] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = (e: MediaQueryListEvent) => setDark(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return dark;
}

export const monoFont =
  'ui-monospace, "SF Mono", "Cascadia Mono", "JetBrains Mono", Menlo, Consolas, "DejaVu Sans Mono", "Liberation Mono", monospace';

export function fontStack(family: string): string {
  const f = family.trim().replace(/"/g, "");
  return f ? `"${f}", ${monoFont}` : monoFont;
}
