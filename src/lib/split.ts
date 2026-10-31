/** Vista dividida: 2 paneles (lado a lado o apilados) o 4 (2x2). */
export type SplitLayout = "cols" | "rows" | "grid";

export interface SplitState {
  layout: SplitLayout;
  /** Pestaña de cada panel (null: panel vacío). */
  panes: (string | null)[];
}

export const paneCount: Record<SplitLayout, number> = { cols: 2, rows: 2, grid: 4 };

export const layoutLabel: Record<SplitLayout, string> = {
  cols: "2 lado a lado",
  rows: "2 apiladas",
  grid: "4 en cuadrícula (2x2)",
};

/** Rectángulo de un panel en % del área: "x,y,w,h" (texto para no romper la memorización). */
export function paneRect(layout: SplitLayout, i: number): string {
  if (layout === "cols") return `${i * 50},0,50,100`;
  if (layout === "rows") return `0,${i * 50},100,50`;
  return `${(i % 2) * 50},${Math.floor(i / 2) * 50},50,50`;
}

/** Alto de la cabecera de cada panel (selector de pestaña). */
export const PANE_HEADER = 26;

/** Estilo absoluto del contenido de un panel (debajo de su cabecera). */
export function paneBodyStyle(rect: string): React.CSSProperties {
  const [x, y, w, h] = rect.split(",").map(Number);
  return {
    left: `calc(${x}% + 1px)`,
    top: `calc(${y}% + ${PANE_HEADER}px)`,
    width: `calc(${w}% - 2px)`,
    height: `calc(${h}% - ${PANE_HEADER + 1}px)`,
  };
}

/** Reparte pestañas en los paneles: primero las que ya estaban, luego la activa y el resto. */
export function fillPanes(layout: SplitLayout, current: (string | null)[], tabIds: string[], activeId: string | null): (string | null)[] {
  const n = paneCount[layout];
  const out: (string | null)[] = current.filter((id) => id && tabIds.includes(id)).slice(0, n);
  if (activeId && tabIds.includes(activeId) && !out.includes(activeId)) {
    if (out.length < n) out.unshift(activeId);
    else out[0] = activeId;
  }
  for (const id of tabIds) {
    if (out.length >= n) break;
    if (!out.includes(id)) out.push(id);
  }
  while (out.length < n) out.push(null);
  return out;
}
