/**
 * Diff de líneas para configuraciones (~10k líneas). Primero ancla las líneas únicas en
 * ambos lados (patience diff), que en configuraciones son casi todas, y resuelve los
 * tramos entre anclas con Myers O(ND). Si un tramo es demasiado distinto, se marca como
 * reemplazo completo para acotar tiempo y memoria.
 */

/** 0 = igual, 1 = solo en A (quitada), 2 = solo en B (agregada). */
export type RowKind = 0 | 1 | 2;

export interface DiffRow {
  kind: RowKind;
  /** Índice de línea en A (0-based) o -1. */
  a: number;
  /** Índice de línea en B (0-based) o -1. */
  b: number;
  /** Línea igual en el texto enmascarado cuyo secreto cambió (según las huellas del respaldo). */
  secret?: boolean;
}

export interface DiffStats {
  added: number;
  removed: number;
  same: number;
}

/** Tope de distancia de edición por tramo para Myers (memoria ~ D² enteros). */
const MAX_D = 2000;

export function splitLines(text: string): string[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

export function diffLines(a: string[], b: string[]): DiffRow[] {
  // Líneas a enteros: las comparaciones posteriores son numéricas.
  const ids = new Map<string, number>();
  const toIds = (xs: string[]) => {
    const out = new Int32Array(xs.length);
    xs.forEach((x, i) => {
      let id = ids.get(x);
      if (id === undefined) ids.set(x, (id = ids.size));
      out[i] = id;
    });
    return out;
  };
  const A = toIds(a);
  const B = toIds(b);
  const out: DiffRow[] = [];
  diffRange(A, 0, A.length, B, 0, B.length, out);
  return out;
}

function diffRange(A: Int32Array, a0: number, a1: number, B: Int32Array, b0: number, b1: number, out: DiffRow[]) {
  // Prefijo y sufijo comunes.
  while (a0 < a1 && b0 < b1 && A[a0] === B[b0]) out.push({ kind: 0, a: a0++, b: b0++ });
  let tail = 0;
  while (a1 - tail > a0 && b1 - tail > b0 && A[a1 - 1 - tail] === B[b1 - 1 - tail]) tail++;
  const ea = a1 - tail;
  const eb = b1 - tail;
  if (a0 === ea) for (let j = b0; j < eb; j++) out.push({ kind: 2, a: -1, b: j });
  else if (b0 === eb) for (let i = a0; i < ea; i++) out.push({ kind: 1, a: i, b: -1 });
  else {
    const anchors = uniqueAnchors(A, a0, ea, B, b0, eb);
    if (anchors.length) {
      let pa = a0;
      let pb = b0;
      for (const [ai, bi] of anchors) {
        diffRange(A, pa, ai, B, pb, bi, out);
        out.push({ kind: 0, a: ai, b: bi });
        pa = ai + 1;
        pb = bi + 1;
      }
      diffRange(A, pa, ea, B, pb, eb, out);
    } else if (!myers(A, a0, ea, B, b0, eb, out)) {
      for (let i = a0; i < ea; i++) out.push({ kind: 1, a: i, b: -1 });
      for (let j = b0; j < eb; j++) out.push({ kind: 2, a: -1, b: j });
    }
  }
  for (let t = 0; t < tail; t++) out.push({ kind: 0, a: ea + t, b: eb + t });
}

/** Pares (a, b) de líneas que aparecen una sola vez en cada lado, en la secuencia creciente más larga. */
function uniqueAnchors(A: Int32Array, a0: number, a1: number, B: Int32Array, b0: number, b1: number): [number, number][] {
  const count = new Map<number, number>(); // >0: posición en A + 1 si es única; -1 si se repite
  for (let i = a0; i < a1; i++) count.set(A[i], count.has(A[i]) ? -1 : i + 1);
  const inB = new Map<number, number>();
  for (let j = b0; j < b1; j++) {
    const c = count.get(B[j]);
    if (c === undefined || c < 0) continue;
    inB.set(B[j], inB.has(B[j]) ? -1 : j);
  }
  const pairs: [number, number][] = [];
  for (const [id, j] of inB) if (j >= 0) pairs.push([count.get(id)! - 1, j]);
  if (!pairs.length) return [];
  pairs.sort((x, y) => x[0] - y[0]);
  // LIS por b con patience sorting (O(n log n)).
  const tails: number[] = [];
  const prev = new Int32Array(pairs.length).fill(-1);
  for (let i = 0; i < pairs.length; i++) {
    const v = pairs[i][1];
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (pairs[tails[mid]][1] < v) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) prev[i] = tails[lo - 1];
    tails[lo] = i;
  }
  const lis: [number, number][] = [];
  for (let i = tails[tails.length - 1]; i >= 0; i = prev[i]) lis.push(pairs[i]);
  return lis.reverse();
}

/** Myers O(ND) con traza para reconstruir el camino. Devuelve false si supera MAX_D. */
function myers(A: Int32Array, a0: number, a1: number, B: Int32Array, b0: number, b1: number, out: DiffRow[]): boolean {
  const N = a1 - a0;
  const M = b1 - b0;
  const limit = Math.min(N + M, MAX_D);
  const off = limit + 1;
  const v = new Int32Array(2 * limit + 3);
  const trace: Int32Array[] = [];
  let found = -1;
  for (let d = 0; d <= limit && found < 0; d++) {
    trace.push(v.slice(off - d - 1, off + d + 2));
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? v[off + k + 1] : v[off + k - 1] + 1;
      let y = x - k;
      while (x < N && y < M && A[a0 + x] === B[b0 + y]) {
        x++;
        y++;
      }
      v[off + k] = x;
      if (x >= N && y >= M) {
        found = d;
        break;
      }
    }
  }
  if (found < 0) return false;
  const rev: DiffRow[] = [];
  let x = N;
  let y = M;
  for (let d = found; d > 0; d--) {
    const pv = trace[d];
    const at = (k: number) => pv[k + d + 1];
    const k = x - y;
    const down = k === -d || (k !== d && at(k - 1) < at(k + 1));
    const pk = down ? k + 1 : k - 1;
    const px = at(pk);
    const py = px - pk;
    while (x > px && y > py) rev.push({ kind: 0, a: a0 + --x, b: b0 + --y });
    if (down) rev.push({ kind: 2, a: -1, b: b0 + --y });
    else rev.push({ kind: 1, a: a0 + --x, b: -1 });
  }
  while (x > 0 && y > 0) rev.push({ kind: 0, a: a0 + --x, b: b0 + --y });
  for (let i = rev.length - 1; i >= 0; i--) out.push(rev[i]);
  return true;
}

export function diffStats(rows: DiffRow[]): DiffStats {
  const s = { added: 0, removed: 0, same: 0 };
  for (const r of rows) {
    if (r.kind === 0) s.same++;
    else if (r.kind === 1) s.removed++;
    else s.added++;
  }
  return s;
}

/** Tramos a mostrar: cambios con `context` líneas alrededor; el resto se pliega. */
export type Block = { type: "rows"; from: number; to: number } | { type: "fold"; from: number; to: number };

export function foldBlocks(rows: DiffRow[], context = 3): Block[] {
  const keep = new Uint8Array(rows.length);
  rows.forEach((r, i) => {
    if (r.kind === 0) return;
    for (let j = Math.max(0, i - context); j <= Math.min(rows.length - 1, i + context); j++) keep[j] = 1;
  });
  const blocks: Block[] = [];
  let i = 0;
  while (i < rows.length) {
    const k = keep[i];
    let j = i;
    while (j < rows.length && keep[j] === k) j++;
    blocks.push({ type: k ? "rows" : "fold", from: i, to: j });
    i = j;
  }
  return blocks;
}

/** Diff unificado estándar (como `diff -u`), para exportar o pegar en un ticket. */
export function unifiedDiff(a: string[], b: string[], rows: DiffRow[], nameA: string, nameB: string, context = 3): string {
  const out = [`--- ${nameA}`, `+++ ${nameB}`];
  for (const blk of foldBlocks(rows, context)) {
    if (blk.type !== "rows") continue;
    const slice = rows.slice(blk.from, blk.to);
    // Primera línea de cada lado en el tramo (para la cabecera @@).
    let aStart = -1;
    let bStart = -1;
    let aCount = 0;
    let bCount = 0;
    for (const r of slice) {
      if (r.a >= 0) {
        if (aStart < 0) aStart = r.a;
        aCount++;
      }
      if (r.b >= 0) {
        if (bStart < 0) bStart = r.b;
        bCount++;
      }
    }
    if (aStart < 0) aStart = nearest(rows, blk.from, "a");
    if (bStart < 0) bStart = nearest(rows, blk.from, "b");
    const range = (start: number, n: number) => (n === 1 ? `${start + 1}` : `${n ? start + 1 : start},${n}`);
    out.push(`@@ -${range(aStart, aCount)} +${range(bStart, bCount)} @@`);
    for (const r of slice) out.push(r.kind === 0 ? ` ${a[r.a]}` : r.kind === 1 ? `-${a[r.a]}` : `+${b[r.b]}${r.secret ? SECRET_NOTE : ""}`);
  }
  return out.join("\n") + "\n";
}

const SECRET_NOTE = "    [secreto cambiado]";

/** Huellas de secretos por línea (base 0), como las guarda el respaldo enmascarado. */
export type SecretMarks = Record<string, string[]>;

/**
 * Con secretos enmascarados, "password ****" queda igual aunque la contraseña cambie. Si las
 * huellas de una línea igual difieren entre A y B, esa línea pasa a quitada + agregada con la
 * marca `secret`: cuenta como cambio, no se pliega y se muestra "secreto cambiado" sin revelar
 * el valor. Sin huellas en uno de los lados (respaldo antiguo) no se marca nada.
 */
export function markSecretChanges(rows: DiffRow[], ha: SecretMarks | null, hb: SecretMarks | null): DiffRow[] {
  if (!ha || !hb || !Object.keys(ha).length || !Object.keys(hb).length) return rows;
  const out: DiffRow[] = [];
  for (const r of rows) {
    const x = r.kind === 0 ? ha[String(r.a)] : undefined;
    const y = r.kind === 0 ? hb[String(r.b)] : undefined;
    if (r.kind === 0 && (x || y) && (x ?? []).join() !== (y ?? []).join()) {
      out.push({ kind: 1, a: r.a, b: -1, secret: true }, { kind: 2, a: -1, b: r.b, secret: true });
    } else out.push(r);
  }
  return out;
}

/** Para un tramo sin líneas de un lado: la posición (0-based) tras la última línea previa de ese lado. */
function nearest(rows: DiffRow[], from: number, side: "a" | "b"): number {
  for (let i = from - 1; i >= 0; i--) if (rows[i][side] >= 0) return rows[i][side] + 1;
  return 0;
}
