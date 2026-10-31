// Divide una frase en bloques de subtítulo (máx. ~84 caracteres, dos líneas) y reparte su duración.
const MAX = 84;

/** Devuelve [{ text, start, end }] en segundos relativos al inicio de la frase. */
export function chunkCaption(text, dur) {
  const words = text.split(/\s+/);
  const parts = [];
  let cur = "";
  words.forEach((w, i) => {
    if (cur && cur.length + 1 + w.length > MAX) parts.push(cur), (cur = "");
    cur = cur ? `${cur} ${w}` : w;
    const rest = words.slice(i + 1).join(" ");
    // Corte natural tras una pausa si queda bastante texto.
    if (/[,;:]$/.test(w) && cur.length >= 45 && rest.length >= 25 && cur.length + rest.length + 1 > MAX) parts.push(cur), (cur = "");
  });
  if (cur) parts.push(cur);
  const total = parts.reduce((a, p) => a + p.length, 0);
  let t = 0;
  return parts.map((p, i) => {
    const d = (p.length / total) * dur;
    const start = t;
    t += d;
    return { text: p, start, end: i === parts.length - 1 ? dur + 0.15 : t };
  });
}

/** Parte un bloque en dos líneas equilibradas para el .srt. */
export function twoLines(s) {
  if (s.length <= 42) return s;
  const mid = s.length / 2;
  let best = -1;
  for (let i = 0; i < s.length; i++) if (s[i] === " " && (best < 0 || Math.abs(i - mid) < Math.abs(best - mid))) best = i;
  return best < 0 ? s : `${s.slice(0, best)}\n${s.slice(best + 1)}`;
}
