// Arma el video final a partir de las tomas grabadas (record.mjs) y la narración (tts.mjs):
// une las tomas, coloca cada frase de audio en el instante en que se grabó su caption, normaliza
// el volumen, agrega capítulos al MP4 y escribe el .srt y la lista de capítulos.
// Uso: node scripts/video/assemble.mjs   (variables: WORK, OUT_DIR, NAME)
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { FFMPEG, FFPROBE, OUT_DIR, WORK } from "./cdp.mjs";
import { chapters } from "./storyboard.mjs";
import { chunkCaption, twoLines } from "./captions.mjs";

const NAME = process.env.NAME ?? "NetTerminal-tutorial";
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

// ---------- Subtítulos y capítulos ----------
const ts = (s, sep = ",") => {
  const ms = Math.max(0, Math.round(s * 1000));
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)}${sep}${p(ms % 1000, 3)}`;
};
let n = 0;
const srt = cues
  .flatMap((c) => chunkCaption(c.text, c.dur).map((k) => ({ start: c.at + k.start, end: Math.min(c.at + k.end, total), text: k.text })))
  .map((k) => `${++n}\n${ts(k.start)} --> ${ts(k.end)}\n${twoLines(k.text)}\n`)
  .join("\n");
const mmss = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const chaptersTxt =
  `NetTerminal: tutorial completo (${mmss(total)})\n\n` + marks.map((m, i) => `${mmss(m.start)}  ${i + 1}. ${m.title}`).join("\n") + "\n";
const meta =
  ";FFMETADATA1\ntitle=NetTerminal: tutorial completo\nlanguage=spa\n\n" +
  marks.map((m, i) => `[CHAPTER]\nTIMEBASE=1/1000\nSTART=${Math.round(m.start * 1000)}\nEND=${Math.round((marks[i + 1]?.start ?? total) * 1000)}\ntitle=${m.title}\n`).join("\n");
const metaFile = join(WORK, "final", "capitulos.ffmeta");
writeFileSync(metaFile, meta);

// ---------- Mezcla final ----------
const out = join(WORK, "final", `${NAME}.mp4`);
run([
  "-i", video, "-i", narration, "-i", metaFile,
  "-map", "0:v", "-map", "1:a", "-map_metadata", "2", "-map_chapters", "2",
  "-c:v", "copy",
  "-af", "highpass=f=70,loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000",
  "-c:a", "aac", "-b:a", "192k", "-ac", "2", "-ar", "48000",
  "-metadata:s:a:0", "language=spa", "-metadata:s:v:0", "language=spa",
  "-t", total.toFixed(3), "-movflags", "+faststart", out,
]);
mkdirSync(OUT_DIR, { recursive: true });
copyFileSync(out, join(OUT_DIR, `${NAME}.mp4`));
writeFileSync(join(OUT_DIR, `${NAME}.srt`), srt);
writeFileSync(join(OUT_DIR, `${NAME}-capitulos.txt`), chaptersTxt);
console.log(chaptersTxt);
console.log(`Listo: ${join(OUT_DIR, `${NAME}.mp4`)} (${probe(join(OUT_DIR, `${NAME}.mp4`)).toFixed(2)} s)`);
