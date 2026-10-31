import { useEffect, useMemo, useRef, useState } from "react";

export interface Point {
  x: number; // timestamp ms o índice
  y: number | null; // null = sin respuesta
  note?: string;
}

interface Props {
  points: Point[];
  unit: string;
  height?: number;
  /** Etiqueta del eje X en el tooltip. */
  xLabel?: (x: number) => string;
  title?: string;
}

const PAD = { l: 44, r: 12, t: 10, b: 20 };

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

/**
 * Serie única (sin leyenda: el título la nombra). Línea 2px, relleno 10%, cuadrícula
 * de 1px recesiva, cursor que se ajusta al punto más cercano con tooltip, y las fallas
 * como marcas de estado crítico en la base con su motivo en el tooltip.
 */
export function LineChart({ points, unit, height = 180, xLabel, title }: Props) {
  const ref = useRef<SVGSVGElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [W, setW] = useState(640);
  const H = height;

  // El SVG usa el ancho real del contenedor para que el texto no se deforme.
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.max(200, el.clientWidth)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { path, area, fails, ticks, xs, ymax } = useMemo(() => {
    const n = points.length;
    const vals = points.map((p) => p.y).filter((v): v is number => v != null);
    const ymax = niceMax(Math.max(1, ...vals) * 1.1);
    const xs = points.map((_, i) => PAD.l + (n <= 1 ? 0 : (i / (n - 1)) * (W - PAD.l - PAD.r)));
    const y = (v: number) => PAD.t + (1 - v / ymax) * (H - PAD.t - PAD.b);
    let path = "";
    let area = "";
    let segStart: number | null = null;
    // Con muchas más muestras que píxeles (hasta 3600 por sonda) se dibuja solo el mínimo
    // y el máximo de cada columna: el trazo se ve igual y el path queda acotado al ancho.
    const dense = n > (W - PAD.l - PAD.r) * 2;
    let col = NaN;
    let lo = 0;
    let hi = 0;
    const flushCol = () => {
      if (Number.isNaN(col)) return;
      const seg = `L${col},${y(hi)}L${col},${y(lo)}`;
      path += seg;
      area += seg;
      col = NaN;
    };
    points.forEach((p, i) => {
      if (p.y == null) {
        flushCol();
        if (segStart != null) area += `L${xs[i - 1]},${H - PAD.b}Z`;
        segStart = null;
        return;
      }
      if (segStart == null) {
        path += `M${xs[i]},${y(p.y)}`;
        area += `M${xs[i]},${H - PAD.b}L${xs[i]},${y(p.y)}`;
        segStart = i;
      } else if (!dense) {
        path += `L${xs[i]},${y(p.y)}`;
        area += `L${xs[i]},${y(p.y)}`;
      } else {
        const c = Math.round(xs[i]);
        if (c !== col) {
          flushCol();
          col = c;
          lo = hi = p.y;
        } else {
          lo = Math.min(lo, p.y);
          hi = Math.max(hi, p.y);
        }
      }
    });
    flushCol();
    if (segStart != null && n) area += `L${xs[n - 1]},${H - PAD.b}Z`;
    const failX = points.map((p, i) => (p.y == null ? xs[i] : null)).filter((v): v is number => v != null);
    const fails = dense ? [...new Set(failX.map(Math.round))] : failX;
    const ticks = [0, 0.5, 1].map((f) => ({ v: ymax * f, y: y(ymax * f) }));
    return { path, area, fails, ticks, xs, ymax };
  }, [points, H, W]);

  const onMove = (e: React.PointerEvent) => {
    const svg = ref.current;
    if (!svg || !points.length) return;
    const r = svg.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W;
    // Los puntos están equiespaciados: el más cercano se calcula sin recorrerlos.
    const n = points.length;
    const best = n <= 1 ? 0 : Math.max(0, Math.min(n - 1, Math.round(((x - PAD.l) / (W - PAD.l - PAD.r)) * (n - 1))));
    setHover(best);
  };

  const hp = hover != null ? points[hover] : null;
  const fmt = (v: number) => (v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2));

  return (
    <div ref={boxRef} className="relative">
      <svg
        ref={ref}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full block"
        style={{ height: H }}
        role="img"
        aria-label={title ?? `Serie en ${unit}`}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        {ticks.map((t) => (
          <g key={t.v}>
            <line x1={PAD.l} x2={W - PAD.r} y1={t.y} y2={t.y} stroke="var(--border)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
            <text x={PAD.l - 6} y={t.y + 3.5} textAnchor="end" fontSize={10} fill="var(--muted)">
              {fmt(t.v)}
            </text>
          </g>
        ))}
        <path d={area} fill="var(--accent)" opacity={0.1} />
        <path d={path} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
        {fails.map((x, i) => (
          <rect key={i} x={x - 1.5} y={H - PAD.b - 10} width={3} height={10} rx={1} fill="var(--danger)" />
        ))}
        {hover != null && (
          <line x1={xs[hover]} x2={xs[hover]} y1={PAD.t} y2={H - PAD.b} stroke="var(--muted)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        )}
        {hp?.y != null && (
          <circle
            cx={xs[hover!]}
            cy={PAD.t + (1 - hp.y / ymax) * (H - PAD.t - PAD.b)}
            r={4}
            fill="var(--accent)"
            stroke="var(--bg)"
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
          />
        )}
        <text x={W - PAD.r} y={H - 5} textAnchor="end" fontSize={10} fill="var(--muted)">
          {unit}
        </text>
      </svg>
      {hp && (
        <div
          className="absolute top-1 pointer-events-none px-2 py-1 rounded-md bg-panel border border-line shadow-pop text-[11.5px] whitespace-nowrap"
          style={{
            left: `${(xs[hover!] / W) * 100}%`,
            transform: xs[hover!] > W * 0.7 ? "translateX(-105%)" : "translateX(8px)",
          }}
        >
          <div className="font-semibold text-fg">
            {hp.y != null ? `${fmt(hp.y)} ${unit}` : <span className="text-danger">✕ {hp.note ?? "Sin respuesta"}</span>}
          </div>
          {xLabel && <div className="text-muted">{xLabel(hp.x)}</div>}
        </div>
      )}
      {!points.length && (
        <div className="absolute inset-0 grid place-items-center text-[12px] text-muted">Sin datos todavía</div>
      )}
    </div>
  );
}

export function StatTile({ label, value, tone }: { label: string; value: string; tone?: "danger" | "ok" | "warn" }) {
  const color = tone === "danger" ? "text-danger" : tone === "ok" ? "text-ok" : tone === "warn" ? "text-warn" : "text-fg";
  return (
    <div className="rounded-lg border border-line px-2.5 py-2 min-w-0" title={`${label}: ${value}`}>
      <div className="text-[11px] text-muted truncate">{label}</div>
      <div className={`text-[16px] font-semibold tabular-nums truncate ${color}`}>{value}</div>
    </div>
  );
}
