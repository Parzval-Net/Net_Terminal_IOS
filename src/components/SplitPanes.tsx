import { memo } from "react";
import { X } from "lucide-react";
import type { Tab, TabState } from "../types";
import { tabTitle } from "../types";
import { PANE_HEADER, SplitState, paneRect } from "../lib/split";
import { statusColor } from "./TabBar";

interface Props {
  split: SplitState;
  tabs: Tab[];
  states: Record<string, TabState>;
  activeId: string | null;
  /** Cambia la pestaña de un panel (si ya está en otro panel, se intercambian). */
  onPick: (pane: number, tabId: string | null) => void;
  onFocus: (tabId: string) => void;
}

/**
 * Marcos de la vista dividida: cabecera con selector de pestaña y borde del panel con
 * foco. Las terminales no viven aquí: App las posiciona encima de cada marco, así no se
 * vuelven a montar (y no pierden conexión ni historial) al cambiar de diseño.
 */
export const SplitPanes = memo(function SplitPanes({ split, tabs, states, activeId, onPick, onFocus }: Props) {
  return (
    <>
      {split.panes.map((id, i) => {
        const [x, y, w, h] = paneRect(split.layout, i).split(",").map(Number);
        const focused = !!id && id === activeId;
        const tab = tabs.find((t) => t.id === id);
        return (
          <div
            key={i}
            className={`absolute pointer-events-none border ${focused ? "border-accent z-[1]" : "border-line"}`}
            style={{ left: `${x}%`, top: `${y}%`, width: `${w}%`, height: `${h}%` }}
          >
            <div
              className={`pointer-events-auto flex items-center gap-2 px-2 text-[12px] border-b border-line ${focused ? "bg-selected" : "bg-chrome"}`}
              style={{ height: PANE_HEADER - 1 }}
              onMouseDown={() => id && onFocus(id)}
            >
              {tab && <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: statusColor[states[tab.id]?.status ?? "connecting"] }} />}
              <select
                className="h-6 bg-transparent text-[12px] min-w-0 max-w-[60%] outline-none cursor-pointer"
                value={id ?? ""}
                onChange={(e) => onPick(i, e.target.value || null)}
                aria-label={`Pestaña del panel ${i + 1}`}
              >
                <option value="">Panel vacío</option>
                {tabs.map((t) => (
                  <option key={t.id} value={t.id}>
                    {tabTitle(t)}
                  </option>
                ))}
              </select>
              <span className="text-muted truncate">{tab?.session.host ?? ""}</span>
              <span className="flex-1" />
              {id && (
                <button
                  className="w-6 h-6 grid place-items-center rounded text-muted hover:text-fg hover:bg-hover"
                  title="Quitar del panel (la pestaña sigue abierta)"
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={() => onPick(i, null)}
                >
                  <X size={12} />
                </button>
              )}
            </div>
            {!id && (
              <div className="absolute inset-x-0 bottom-0 grid place-items-center text-[12px] text-muted" style={{ top: PANE_HEADER }}>
                Elige una pestaña en la cabecera del panel
              </div>
            )}
          </div>
        );
      })}
    </>
  );
});
