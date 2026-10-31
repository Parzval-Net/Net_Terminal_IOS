import { memo, useMemo, useState } from "react";
import { DiffRow, foldBlocks } from "../../lib/diff";

/** Filas que se dibujan por tanda: 10k líneas de diff no se pintan de una vez. */
const CHUNK = 1500;

const rowClass = ["", "bg-[color-mix(in_srgb,var(--danger)_var(--diff-tint),transparent)]", "bg-[color-mix(in_srgb,var(--ok)_var(--diff-tint),transparent)]"];
const sign = [" ", "-", "+"];

/** Diff unificado con números de línea de ambos lados y tramos sin cambios plegados. */
export const DiffView = memo(function DiffView({ a, b, rows }: { a: string[]; b: string[]; rows: DiffRow[] }) {
  const blocks = useMemo(() => foldBlocks(rows, 3), [rows]);
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [limit, setLimit] = useState(CHUNK);

  // Lista plana de lo visible (filas y pliegues), cortada en `limit` filas.
  const items = useMemo(() => {
    const out: ({ fold: number; count: number } | { row: number })[] = [];
    let shown = 0;
    for (const blk of blocks) {
      if (shown >= limit) break;
      if (blk.type === "fold" && !open.has(blk.from)) {
        out.push({ fold: blk.from, count: blk.to - blk.from });
        continue;
      }
      for (let i = blk.from; i < blk.to && shown < limit; i++, shown++) out.push({ row: i });
    }
    return { out, more: shown >= limit };
  }, [blocks, open, limit]);

  if (!rows.some((r) => r.kind !== 0)) return <p className="text-[12.5px] text-muted py-3">Sin diferencias.</p>;

  return (
    <div className="rounded-lg border border-line overflow-auto max-h-[60vh] bg-field text-fg font-mono text-[11.5px] leading-[1.55] select-text">
      <table className="w-full border-collapse">
        <tbody>
          {items.out.map((it) =>
            "fold" in it ? (
              <tr key={`f${it.fold}`}>
                <td colSpan={4} className="p-0">
                  <button
                    className="w-full text-left px-3 h-7 sm:h-6 text-[11px] text-muted bg-hover hover:text-fg font-sans active:bg-hover/80 touch-manipulation"
                    onClick={() => setOpen((o) => new Set(o).add(it.fold))}
                  >
                    ⋯ {it.count.toLocaleString("es-CL")} líneas sin cambios (clic para mostrar)
                  </button>
                </td>
              </tr>
            ) : (
              <Row key={it.row} r={rows[it.row]} a={a} b={b} />
            ),
          )}
        </tbody>
      </table>
      {items.more && (
        <button className="w-full h-9 sm:h-8 text-[12px] text-accent hover:underline font-sans active:opacity-80 touch-manipulation" onClick={() => setLimit((l) => l + CHUNK)}>
          Mostrar {CHUNK.toLocaleString("es-CL")} filas más
        </button>
      )}
    </div>
  );
});

function Row({ r, a, b }: { r: DiffRow; a: string[]; b: string[] }) {
  return (
    <tr className={rowClass[r.kind]}>
      <td className="w-8 sm:w-12 pr-1 sm:pr-2 text-right text-muted select-none align-top tabular-nums">{r.a >= 0 ? r.a + 1 : ""}</td>
      <td className="w-8 sm:w-12 pr-1 sm:pr-2 text-right text-muted select-none align-top tabular-nums">{r.b >= 0 ? r.b + 1 : ""}</td>
      <td className={`w-4 select-none align-top ${r.kind === 1 ? "text-danger" : r.kind === 2 ? "text-ok" : "text-muted"}`}>{sign[r.kind]}</td>
      <td className="whitespace-pre-wrap break-all pr-3">
        {r.kind === 2 ? b[r.b] : a[r.a]}
        {r.secret && r.kind === 2 && (
          <span className="ml-3 rounded border border-[var(--warn)] px-1 font-sans text-[11px] text-warn" title="El valor enmascarado cambió entre los dos respaldos (se compara su huella, nunca el secreto)">
            secreto cambiado
          </span>
        )}
      </td>
    </tr>
  );
}
