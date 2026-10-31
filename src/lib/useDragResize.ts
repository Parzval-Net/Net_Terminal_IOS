import { useCallback, useEffect, useRef, useState } from "react";

interface Box {
  x: number; // desplazamiento desde la posición centrada
  y: number;
  w: number | null; // null = tamaño natural
  h: number | null;
}

const EMPTY: Box = { x: 0, y: 0, w: null, h: null };

function load(key: string): Box {
  try {
    return { ...EMPTY, ...JSON.parse(localStorage.getItem(key) ?? "{}") };
  } catch {
    return EMPTY;
  }
}

/**
 * Ventana flotante: se arrastra desde un "asa" y, si `resizable`, se redimensiona desde
 * la esquina (CSS resize). Recuerda posición y tamaño; doble clic en el asa restaura.
 * El tamaño solo se guarda cuando el usuario lo cambia con la esquina, no cuando el
 * contenido crece o se achica.
 */
export function useDragResize<T extends HTMLElement = HTMLDivElement>(key: string, resizable = true) {
  const ref = useRef<T>(null);
  const [box, setBox] = useState<Box>(() => load(key));
  const drag = useRef<{ sx: number; sy: number; x: number; y: number } | null>(null);
  const sizeAtDown = useRef<{ w: number; h: number } | null>(null);
  const [isMobileScreen, setIsMobileScreen] = useState(() => typeof window !== "undefined" && window.innerWidth < 640);

  useEffect(() => {
    const onResize = () => setIsMobileScreen(window.innerWidth < 640);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(box));
    } catch {
      /* sin almacenamiento: no se recuerda */
    }
  }, [key, box]);

  // Detecta un redimensionado manual: tamaño distinto entre presionar y soltar el mouse.
  useEffect(() => {
    if (!resizable || isMobileScreen) return;
    const up = () => {
      const el = ref.current;
      const before = sizeAtDown.current;
      sizeAtDown.current = null;
      if (!el || !before || drag.current) return;
      if (Math.abs(el.offsetWidth - before.w) > 2 || Math.abs(el.offsetHeight - before.h) > 2)
        setBox((b) => ({ ...b, w: el.offsetWidth, h: el.offsetHeight }));
    };
    window.addEventListener("pointerup", up);
    return () => window.removeEventListener("pointerup", up);
  }, [resizable, isMobileScreen]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (isMobileScreen || e.button !== 0 || (e.target as HTMLElement).closest("button, input, select, textarea, a")) return;
      drag.current = { sx: e.clientX, sy: e.clientY, x: box.x, y: box.y };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    },
    [box.x, box.y, isMobileScreen],
  );

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const d = drag.current;
    const el = ref.current;
    if (!d || !el || isMobileScreen) return;
    // Siempre queda parte de la ventana visible para poder recuperarla.
    const maxX = window.innerWidth / 2 + el.offsetWidth / 2 - 80;
    const maxY = window.innerHeight / 2 + el.offsetHeight / 2 - 48;
    const x = Math.max(-maxX, Math.min(maxX, d.x + e.clientX - d.sx));
    const y = Math.max(-maxY, Math.min(maxY, d.y + e.clientY - d.sy));
    setBox((b) => ({ ...b, x, y }));
  }, [isMobileScreen]);

  const onPointerUp = useCallback(() => {
    drag.current = null;
  }, []);

  const reset = useCallback(() => setBox(EMPTY), []);

  return {
    /** Props para el contenedor de la ventana. */
    box: {
      ref,
      style: {
        transform: isMobileScreen ? undefined : (box.x || box.y ? `translate(${box.x}px, ${box.y}px)` : undefined),
        width: !isMobileScreen && resizable && box.w ? box.w : undefined,
        height: !isMobileScreen && resizable && box.h ? box.h : undefined,
      } as React.CSSProperties,
      onPointerDownCapture: () => {
        const el = ref.current;
        if (el && resizable && !isMobileScreen) sizeAtDown.current = { w: el.offsetWidth, h: el.offsetHeight };
      },
    },
    /** Props para la barra de título (asa de arrastre). */
    handle: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onDoubleClick: isMobileScreen ? undefined : reset,
      style: { cursor: isMobileScreen ? "default" : "move", touchAction: isMobileScreen ? "auto" : "none" } as React.CSSProperties,
      title: isMobileScreen ? undefined : "Arrastra para mover · doble clic para restaurar",
    },
  };
}
