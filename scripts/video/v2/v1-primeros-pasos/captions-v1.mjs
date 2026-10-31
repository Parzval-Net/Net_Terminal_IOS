// Subtítulos del video 1: bloques por oración en el intervalo que da el JSON de tiempos de
// tts_kokoro.py; dentro de cada oración, el reparto por caracteres de scripts/video/captions.mjs.
import { chunkCaption } from "../../captions.mjs";

/** cue: { text, dur, tiempos? } → [{ text, start, end }] en segundos relativos al inicio de la frase. */
export function captionChunks(cue) {
  const ora = cue.tiempos?.oraciones ?? [];
  if (ora.length < 2) return chunkCaption(cue.text, cue.dur);
  return ora.flatMap((o, i) => {
    const end = i + 1 < ora.length ? ora[i + 1].inicio : cue.dur;
    return chunkCaption(o.texto, end - o.inicio).map((k) => ({
      ...k,
      start: k.start + o.inicio,
      end: Math.min(k.end + o.inicio, i + 1 < ora.length ? end : cue.dur + 0.15),
    }));
  });
}
