import { forwardRef, useMemo, useRef } from "react";
import type { ITheme } from "@xterm/xterm";
import { Compiled, cssColor, runs } from "../lib/highlight";

/** Una línea coloreada con las reglas de resaltado (las mismas de la terminal). */
export function renderHighlighted(line: string, compiled: Compiled[], theme: ITheme): React.ReactNode {
  const spans = runs(line, compiled);
  if (!spans.length) return line || " ";
  const parts: React.ReactNode[] = [];
  let pos = 0;
  spans.forEach(([s, e, i], k) => {
    if (s > pos) parts.push(line.slice(pos, s));
    const st = compiled[i].style;
    parts.push(
      <span
        key={k}
        style={{
          color: cssColor(st.color, theme),
          background: cssColor(st.bg, theme, true),
          fontWeight: st.bold ? 700 : undefined,
          fontStyle: st.italic ? "italic" : undefined,
          textDecoration: st.underline ? "underline" : undefined,
        }}
      >
        {line.slice(s, e)}
      </span>,
    );
    pos = e;
  });
  parts.push(line.slice(pos));
  return parts;
}

interface Props {
  value: string;
  onChange: (v: string) => void;
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  compiled: Compiled[];
  theme: ITheme;
  font: string;
  fontSize: number;
  placeholder?: string;
  /** Columna con el número de cada línea (CLI Lab). */
  gutter?: boolean;
}

/**
 * Textarea con resaltado: el texto real es transparente y debajo se dibuja una copia
 * coloreada con el mismo motor que la terminal. Sin ajuste de línea, como un editor de config.
 */
export const CodeEditor = forwardRef<HTMLTextAreaElement, Props>(function CodeEditor(
  { value, onChange, onKeyDown, compiled, theme, font, fontSize, placeholder, gutter },
  ref,
) {
  const preRef = useRef<HTMLPreElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const lineCount = gutter ? value.split("\n").length : 0;
  // Los números solo cambian al agregar o quitar líneas, no en cada tecla.
  const numbers = useMemo(() => Array.from({ length: lineCount }, (_, i) => <div key={i}>{i + 1}</div>), [lineCount]);

  // Caché por texto de línea: al teclear solo se vuelve a resaltar la línea que cambió.
  const cache = useMemo(() => new Map<string, React.ReactNode>(), [compiled, theme]);

  // Elemento por posición y texto: React omite las líneas cuyo elemento es el mismo objeto que en el
  // dibujo anterior, así que en un script de miles de líneas cada tecla solo toca la línea editada.
  const rows = useMemo(() => new Map<string, React.ReactElement>(), [compiled, theme]);

  const highlighted = useMemo(() => {
    if (cache.size > 5000) cache.clear();
    if (rows.size > 20000) rows.clear();
    return value.split("\n").map((line, li) => {
      const key = `${li}\u0000${line}`;
      let row = rows.get(key);
      if (row) return row;
      let body = cache.get(line);
      if (body === undefined) {
        body = renderHighlighted(line, compiled, theme);
        cache.set(line, body);
      }
      row = <div key={li}>{body}</div>;
      rows.set(key, row);
      return row;
    });

  }, [value, cache, rows, compiled, theme]);

  const shared: React.CSSProperties = {
    fontFamily: font,
    fontSize,
    lineHeight: 1.5,
    padding: "10px 12px",
    whiteSpace: "pre",
    tabSize: 4,
    margin: 0,
  };

  const editor = (
    <div className="relative flex-1 min-h-0 min-w-0" style={{ background: theme.background }}>
      <pre
        ref={preRef}
        aria-hidden
        className="absolute inset-0 overflow-hidden pointer-events-none"
        style={{ ...shared, color: theme.foreground, fontWeight: 400 }}
      >
        {highlighted}
        {"\n"}
      </pre>
      <textarea
        ref={ref}
        value={value}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onScroll={(e) => {
          if (preRef.current) {
            preRef.current.scrollTop = e.currentTarget.scrollTop;
            preRef.current.scrollLeft = e.currentTarget.scrollLeft;
          }
          if (gutterRef.current) gutterRef.current.style.transform = `translateY(${-e.currentTarget.scrollTop}px)`;
        }}
        className="code-editor absolute inset-0 w-full h-full resize-none outline-none bg-transparent overflow-auto"
        style={{
          ...shared,
          color: "transparent",
          caretColor: String(theme.cursor ?? theme.foreground),
          WebkitTextFillColor: "transparent",
        }}
      />
    </div>
  );
  if (!gutter) return editor;
  return (
    <div className="flex flex-1 min-h-0" style={{ background: theme.background }}>
      <div
        aria-hidden
        className="shrink-0 overflow-hidden select-none text-right border-r"
        style={{
          fontFamily: font,
          fontSize,
          lineHeight: 1.5,
          padding: "10px 8px 10px 12px",
          minWidth: `${String(lineCount).length + 3}ch`,
          color: cssColor("gray", theme),
          borderColor: "var(--border)",
        }}
      >
        <div ref={gutterRef}>{numbers}</div>
      </div>
      {editor}
    </div>
  );
});
