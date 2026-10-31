/**
 * Rueda del mapa de Topología. La rueda vertical hace zoom sin distinguir mouse de touchpad (no hay
 * forma fiable: WebKit entrega la rueda en múltiplos de 4,000244 px solo sin aceleración, y Magic Mouse
 * o los mouse con desplazamiento suave dan deltas continuos). Se desplaza con Shift + rueda, con el
 * movimiento horizontal del touchpad o arrastrando el fondo; el pellizco (rueda con Ctrl) hace zoom.
 */
export interface WheelLike {
  deltaX: number;
  deltaY: number;
  deltaMode: number;
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
}

export function wheelIntent(e: WheelLike): "zoom" | "pinch" | "pan" {
  if (e.ctrlKey || e.metaKey) return "pinch";
  return e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY) ? "pan" : "zoom";
}

/** Factor de zoom de un evento de rueda: un paso de rueda (100 px) cambia un 16 %; el pellizco es más fino. */
export function wheelFactor(e: Pick<WheelLike, "deltaY" | "deltaMode">, pinch: boolean): number {
  if (pinch) {
    const d = Math.max(-50, Math.min(50, e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY));
    return Math.exp(-d * 0.01);
  }
  const d = Math.max(-300, Math.min(300, e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY));
  return Math.exp(-d * 0.0015);
}

/**
 * Pantallas táctiles: zoom con dos dedos (Pointer Events). Con un dedo se arrastra el mapa como con
 * el mouse. Aquí solo va la geometría; el estado de los punteros activos vive en el componente.
 */
export interface Pt {
  x: number;
  y: number;
}

export function pinchMetrics(a: Pt, b: Pt): { dist: number; mid: Pt } {
  return { dist: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
}

/**
 * Zoom objetivo de un gesto de dos dedos: el zoom inicial por la razón de distancias, con los topes
 * dados. Una distancia inicial casi nula (dedos juntos) no produce zoom, para no dividir por cero.
 */
export function pinchZoom(base: number, startDist: number, dist: number, min: number, max: number): number {
  if (!(startDist >= 8) || !Number.isFinite(dist)) return base;
  return Math.max(min, Math.min(max, base * (dist / startDist)));
}
