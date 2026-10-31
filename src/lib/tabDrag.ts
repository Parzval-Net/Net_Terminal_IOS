/**
 * Reordenar pestañas arrastrando. Usa eventos de puntero y no el drag and drop de HTML5: en
 * Windows, Tauri captura el arrastre de archivos a la ventana y los eventos dragover/drop no
 * llegan a la página.
 */
import { useCallback, useEffect, useRef, useState } from "react";

/** Mueve `from` antes o después de `to`. Devuelve el mismo arreglo si no cambia nada. */
export function moveItem<T extends { id: string }>(list: T[], from: string, to: string, after: boolean): T[] {
  if (from === to) return list;
  const item = list.find((x) => x.id === from);
  if (!item) return list;
  const rest = list.filter((x) => x.id !== from);
  const idx = rest.findIndex((x) => x.id === to);
  if (idx < 0) return list;
  const out = [...rest.slice(0, idx + (after ? 1 : 0)), item, ...rest.slice(idx + (after ? 1 : 0))];
  return out.every((x, i) => x === list[i]) ? list : out;
}

export interface DropTarget {
  id: string;
  after: boolean;
}

/** Píxeles de movimiento antes de considerar que es un arrastre (y no un clic). */
const THRESHOLD = 5;

/**
 * `attr` es el atributo data-* que identifica cada pestaña; `axis`, la dirección de la lista.
 * Devuelve el handler para onMouseDown, la pestaña arrastrada y dónde caería.
 */
export function useTabDrag(attr: string, axis: "x" | "y", onReorder?: (from: string, to: string, after: boolean) => void) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [target, setTarget] = useState<DropTarget | null>(null);
  const start = useRef<{ id: string; x: number; y: number } | null>(null);
  const targetRef = useRef<DropTarget | null>(null);
  const dragIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!onReorder) return;
    const move = (e: MouseEvent) => {
      const s = start.current;
      if (!s) return;
      if (!dragIdRef.current) {
        if (Math.hypot(e.clientX - s.x, e.clientY - s.y) < THRESHOLD) return;
        dragIdRef.current = s.id;
        setDragId(s.id);
      }
      const el = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest<HTMLElement>(`[${attr}]`);
      const id = el?.getAttribute(attr);
      let t: DropTarget | null = null;
      if (el && id && id !== "tools") {
        const r = el.getBoundingClientRect();
        const after = axis === "x" ? e.clientX > r.left + r.width / 2 : e.clientY > r.top + r.height / 2;
        t = id === s.id ? null : { id, after };
      }
      if (t?.id !== targetRef.current?.id || t?.after !== targetRef.current?.after) {
        targetRef.current = t;
        setTarget(t);
      }
    };
    const up = () => {
      const s = start.current;
      const t = targetRef.current;
      if (s && dragIdRef.current && t) onReorder(s.id, t.id, t.after);
      start.current = null;
      dragIdRef.current = null;
      targetRef.current = null;
      setDragId(null);
      setTarget(null);
    };
    const key = (e: KeyboardEvent) => {
      // Esc cancela el arrastre en curso.
      if (e.key === "Escape" && dragIdRef.current) {
        e.stopPropagation();
        targetRef.current = null;
        up();
      }
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      window.removeEventListener("keydown", key, true);
    };
  }, [attr, axis, onReorder]);

  const begin = useCallback(
    (e: React.MouseEvent, id: string) => {
      if (e.button !== 0 || !onReorder) return;
      start.current = { id, x: e.clientX, y: e.clientY };
    },
    [onReorder],
  );

  return { begin, dragId, target };
}
