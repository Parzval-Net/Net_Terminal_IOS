import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { Copy, Download } from "lucide-react";
import { MermaidBlock, extractMermaid } from "../lib/mermaidBlocks";

type Mermaid = (typeof import("mermaid"))["default"];
let loader: Promise<Mermaid> | null = null;
let themeSet: string | null = null;
let seq = 0;

/** Mermaid (varios MB) se descarga recién al abrir la vista de diagramas, una sola vez. */
function loadMermaid(dark: boolean): Promise<Mermaid> {
  loader ??= import("mermaid").then((m) => m.default);
  return loader.then((m) => {
    const theme = dark ? "dark" : "default";
    if (themeSet !== theme) {
      // strict: sin clics con scripts; htmlLabels false: las etiquetas son texto SVG, nunca HTML
      // (una nota compartida no puede meter imágenes ni enlaces en el diagrama).
      // `secure`: claves que una directiva %%{init: …}%% de la nota no puede cambiar.
      m.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        htmlLabels: false,
        flowchart: { htmlLabels: false },
        theme,
        fontFamily: "inherit",
        secure: ["secure", "securityLevel", "startOnLoad", "maxTextSize", "maxEdges", "htmlLabels", "flowchart", "themeCSS", "fontFamily", "dompurifyConfig"],
      });
      themeSet = theme;
    }
    return m;
  });
}

type Rendered = { line: number; svg?: string; error?: string };

/**
 * Vista de los diagramas Mermaid de una nota: se dibujan al dejar de escribir (400 ms) y cada uno
 * se puede copiar o guardar como SVG.
 */
export function DiagramPreview({ text, dark, name, onNotice }: { text: string; dark: boolean; name: string; onNotice: (msg: string) => void }) {
  const [items, setItems] = useState<Rendered[] | null>(null);
  const [loading, setLoading] = useState(false);
  const run = useRef(0);

  useEffect(() => {
    const blocks: MermaidBlock[] = extractMermaid(text);
    const my = ++run.current;
    if (!blocks.length) {
      setItems([]);
      return;
    }
    const t = window.setTimeout(async () => {
      setLoading(true);
      try {
        const m = await loadMermaid(dark);
        const out: Rendered[] = [];
        for (const b of blocks) {
          try {
            const { svg } = await m.render(`nt-mmd-${++seq}`, b.code);
            out.push({ line: b.line, svg });
          } catch (e) {
            out.push({ line: b.line, error: String((e as Error)?.message ?? e).slice(0, 400) });
          }
          if (my !== run.current) return; // llegó otro cambio: se descarta este dibujo
        }
        setItems(out);
      } catch (e) {
        setItems([{ line: 1, error: `No se pudo cargar Mermaid: ${String(e)}` }]);
      } finally {
        if (my === run.current) setLoading(false);
      }
    }, 400);
    return () => window.clearTimeout(t);
  }, [text, dark]);

  const saveSvg = async (svg: string, i: number) => {
    const base = name.replace(/\.[^.]+$/, "") || "diagrama";
    const dest = await save({ defaultPath: `${base}${items && items.length > 1 ? `-${i + 1}` : ""}.svg`, filters: [{ name: "SVG", extensions: ["svg"] }] });
    if (!dest) return;
    await invoke("save_text", { dest, content: svg })
      .then(() => onNotice(`Guardado: ${dest}`))
      .catch((e) => onNotice(String(e)));
  };

  if (items && !items.length)
    return (
      <p className="p-3 text-[12px] text-muted leading-snug">
        Sin diagramas. Escribe un bloque <span className="font-mono">```mermaid</span> … <span className="font-mono">```</span> o usa "Insertar diagrama de red" en el menú
        de la nota. También puedes pegar lo que copia Topología › Exportar › "Copiar como Mermaid".
      </p>
    );
  return (
    <div className="p-2 space-y-3" aria-busy={loading}>
      {!items && <p className="text-[12px] text-muted px-1">Dibujando…</p>}
      {items?.map((it, i) => (
        <figure key={`${it.line}-${i}`} className="rounded-md border border-line bg-panel">
          <figcaption className="flex items-center gap-1 px-2 h-7 border-b border-line text-[11px] text-muted">
            <span className="flex-1">Diagrama {i + 1} · línea {it.line}</span>
            {it.svg && (
              <>
                <button className="h-6 px-1.5 rounded hover:bg-hover hover:text-fg inline-flex items-center gap-1" title="Copiar como SVG" onClick={() => writeText(it.svg!).then(() => onNotice("SVG copiado"))}>
                  <Copy size={12} /> SVG
                </button>
                <button className="h-6 px-1.5 rounded hover:bg-hover hover:text-fg inline-flex items-center gap-1" title="Guardar como SVG" onClick={() => void saveSvg(it.svg!, i)}>
                  <Download size={12} /> Guardar
                </button>
              </>
            )}
          </figcaption>
          {it.svg ? (
            // SVG generado por Mermaid en modo strict (saneado con DOMPurify).
            <div
              className="p-2 overflow-auto [&_svg]:max-w-full [&_svg]:h-auto"
              // Un "click … href" del diagrama no navega: la vista de la app no sale a un sitio externo.
              onClickCapture={(e) => {
                if ((e.target as Element).closest("a")) {
                  e.preventDefault();
                  e.stopPropagation();
                  onNotice("Los enlaces de los diagramas están desactivados");
                }
              }}
              dangerouslySetInnerHTML={{ __html: it.svg }}
            />
          ) : (
            <pre className="p-2 text-[11.5px] text-danger whitespace-pre-wrap">{it.error}</pre>
          )}
        </figure>
      ))}
    </div>
  );
}
