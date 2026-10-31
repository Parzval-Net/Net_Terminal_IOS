// Arma el video 1 a partir de las tomas (record-v1.mjs) y la narración (tts-v1.mjs): une las tomas,
// coloca cada frase de audio en el instante en que se grabó su subtítulo, normaliza a -16 LUFS en dos
// pasadas, agrega capítulos al MP4 y escribe el .srt y la lista de capítulos.
// Uso: node scripts/video/v2/v1-primeros-pasos/assemble-v1.mjs   (variables: WORK, OUT_DIR)
import { NAME, OUT_DIR, WORK } from "./config.mjs";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { FFMPEG, FFPROBE } from "../../cdp.mjs";
import { twoLines } from "../../captions.mjs";
import { captionChunks } from "./captions-v1.mjs";
import { chapters } from "./storyboard-v1.mjs";

const TITLE = "NetTerminal · Video 1: Primeros pasos y uso diario";
const RATE = 48000;
const run = (args) => execFileSync(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: ["ignore", "inherit", "inherit"] });
const probe = (file) => Number(execFileSync(FFPROBE, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).toString());

// ---------- Línea de tiempo ----------
const shots = [];
const cues = [];
const marks = [];
let t = 0;
for (const ch of chapters) {
  const log = JSON.parse(readFileSync(join(WORK, "log", `${ch.id}.json`), "utf8"));
  marks.push({ title: log.title, start: t });
  for (const s of log.shots) {
    shots.push(resolve(s.file));
    for (const c of s.cues) cues.push({ ...c, at: t + c.start });
    t += s.dur;
  }
}
const total = t;
console.log(`${shots.length} tomas, ${cues.length} frases, ${total.toFixed(2)} s`);

// ---------- Video ----------
mkdirSync(join(WORK, "final"), { recursive: true });
const list = join(WORK, "final", "shots.txt");
writeFileSync(list, shots.map((f) => `file '${f.replaceAll("'", "'\\''")}'`).join("\n") + "\n");
const video = join(WORK, "final", "video.mp4");
run(["-f", "concat", "-safe", "0", "-i", list, "-c", "copy", video]);
console.log(`video unido: ${probe(video).toFixed(2)} s`);

// ---------- Audio: cada frase en su instante ----------
function readWav(file) {
  const b = readFileSync(file);
  let p = 12;
  let fmt = null;
  while (p + 8 <= b.length) {
    const id = b.toString("ascii", p, p + 4);
    const size = b.readUInt32LE(p + 4);
    if (id === "fmt ") fmt = { ch: b.readUInt16LE(p + 10), rate: b.readUInt32LE(p + 12), bits: b.readUInt16LE(p + 22) };
    if (id === "data") {
      if (!fmt || fmt.bits !== 16 || fmt.ch !== 1 || fmt.rate !== RATE) throw new Error(`${file}: se espera WAV 16 bits mono ${RATE} Hz`);
      const n = Math.floor(Math.min(size, b.length - p - 8) / 2);
      const out = new Float32Array(n);
      for (let i = 0; i < n; i++) out[i] = b.readInt16LE(p + 8 + i * 2) / 32768;
      return out;
    }
    p += 8 + size + (size % 2);
  }
  throw new Error(`${file}: sin datos`);
}
const mix = new Float32Array(Math.ceil(total * RATE));
for (const c of cues) {
  const pcm = readWav(c.file);
  const at = Math.round(c.at * RATE);
  for (let i = 0; i < pcm.length && at + i < mix.length; i++) mix[at + i] += pcm[i];
}
const wav = Buffer.alloc(44 + mix.length * 2);
wav.write("RIFF", 0, "ascii");
wav.writeUInt32LE(36 + mix.length * 2, 4);
wav.write("WAVEfmt ", 8, "ascii");
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(RATE, 24);
wav.writeUInt32LE(RATE * 2, 28);
wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34);
wav.write("data", 36, "ascii");
wav.writeUInt32LE(mix.length * 2, 40);
for (let i = 0; i < mix.length; i++) wav.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(mix[i] * 32767))), 44 + i * 2);
const narration = join(WORK, "final", "narracion.wav");
writeFileSync(narration, wav);

// Loudnorm en dos pasadas: medir y aplicar con los valores medidos (lineal), objetivo -16 LUFS.
const meas = spawnSync(FFMPEG, ["-hide_banner", "-nostats", "-i", narration, "-af", "highpass=f=70,loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json", "-f", "null", "-"], { encoding: "utf8" });
const m = JSON.parse(meas.stderr.slice(meas.stderr.lastIndexOf("{"), meas.stderr.lastIndexOf("}") + 1));
const loud = `highpass=f=70,loudnorm=I=-16:TP=-1.5:LRA=11:measured_I=${m.input_i}:measured_TP=${m.input_tp}:measured_LRA=${m.input_lra}:measured_thresh=${m.input_thresh}:offset=${m.target_offset}:linear=true,aresample=48000`;
console.log(`narración medida: ${m.input_i} LUFS, pico ${m.input_tp} dBTP`);

// ---------- Subtítulos y capítulos ----------
const ts = (s, sep = ",") => {
  const ms = Math.max(0, Math.round(s * 1000));
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)}${sep}${p(ms % 1000, 3)}`;
};
// Mismos bloques que se quemaron en el video (el orden de las frases es el del manifiesto).
const manifest = JSON.parse(readFileSync(join(WORK, "tts", "manifest.json"), "utf8")).flatMap((c) => c.cues);
let n = 0;
const srt = cues
  .flatMap((c, i) => captionChunks(manifest[i]).map((k) => ({ start: c.at + k.start, end: Math.min(c.at + k.end, total), text: k.text })))
  .map((k) => `${++n}\n${ts(k.start)} --> ${ts(k.end)}\n${twoLines(k.text)}\n`)
  .join("\n");
const mmss = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const chaptersTxt = `${TITLE} (${mmss(total)})\n\n` + marks.map((mk, i) => `${mmss(mk.start)}  ${i + 1}. ${mk.title}`).join("\n") + "\n";
const meta =
  `;FFMETADATA1\ntitle=${TITLE}\nlanguage=spa\n\n` +
  marks.map((mk, i) => `[CHAPTER]\nTIMEBASE=1/1000\nSTART=${Math.round(mk.start * 1000)}\nEND=${Math.round((marks[i + 1]?.start ?? total) * 1000)}\ntitle=${i + 1}. ${mk.title}\n`).join("\n");
const metaFile = join(WORK, "final", "capitulos.ffmeta");
writeFileSync(metaFile, meta);

// ---------- Mezcla final ----------
const out = join(WORK, "final", `${NAME}.mp4`);
run([
  "-i", video, "-i", narration, "-i", metaFile,
  "-map", "0:v", "-map", "1:a", "-map_metadata", "2", "-map_chapters", "2",
  // Rango limitado (tv) y yuv420p: los cuadros JPEG del screencast llegan en rango completo (yuvj420p).
  "-vf", "scale=in_range=pc:out_range=tv,format=yuv420p", "-c:v", "libx264", "-profile:v", "high", "-preset", "medium", "-crf", "18",
  "-pix_fmt", "yuv420p", "-color_range", "tv", "-r", "30",
  "-af", loud,
  "-c:a", "aac", "-b:a", "192k", "-ac", "2", "-ar", "48000",
  "-metadata:s:a:0", "language=spa", "-metadata:s:v:0", "language=spa",
  "-t", total.toFixed(3), "-movflags", "+faststart", out,
]);
mkdirSync(OUT_DIR, { recursive: true });
copyFileSync(out, join(OUT_DIR, `${NAME}.mp4`));
writeFileSync(join(OUT_DIR, `${NAME}.srt`), srt);
writeFileSync(join(OUT_DIR, `${NAME}-capitulos.txt`), chaptersTxt);
// Línea de tiempo para la verificación (verificar-v1.mjs).
writeFileSync(join(WORK, "final", "timeline.json"), JSON.stringify({ total, marks, cues: cues.map(({ index, at, dur, text, speech, late, overrun }) => ({ index, at, dur, text, speech, late, overrun })) }, null, 1));
console.log(chaptersTxt);
console.log(`Listo: ${join(OUT_DIR, `${NAME}.mp4`)} (${probe(join(OUT_DIR, `${NAME}.mp4`)).toFixed(2)} s)`);
