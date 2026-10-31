// Verifica el MP4 final: streams y duraciones (ffprobe), sincronía voz/subtítulos (inicio de cada
// tramo con voz frente al subtítulo más cercano) y una hoja de cuadros en varios tiempos.
// Uso: node scripts/video/plugins/verificar.mjs [video.mp4] [t1 t2 ...]   (OUT=carpeta de salida)
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { BUILD, FFMPEG, FFPROBE } from "./narracion.mjs";

const OUT = process.env.OUT ?? fileURLToPath(new URL("../../../videos/", import.meta.url));
const args = process.argv.slice(2);
const mp4 = args[0]?.endsWith(".mp4") ? args.shift() : join(OUT, "NetTerminal-scripts-y-plugins.mp4");
const srt = mp4.replace(/\.mp4$/, ".srt");

const probe = JSON.parse(execFileSync(FFPROBE, ["-v", "error", "-show_entries", "stream=codec_type,codec_name,width,height,r_frame_rate,pix_fmt,sample_rate,duration,start_time:format=duration", "-of", "json", mp4]).toString());
const v = probe.streams.find((s) => s.codec_type === "video");
const a = probe.streams.find((s) => s.codec_type === "audio");
console.log(`video: ${v.codec_name} ${v.width}x${v.height} ${v.r_frame_rate} ${v.pix_fmt} inicio ${v.start_time} dur ${Number(v.duration).toFixed(3)} s`);
console.log(`audio: ${a.codec_name} ${a.sample_rate} Hz inicio ${a.start_time} dur ${Number(a.duration).toFixed(3)} s`);
console.log(`diferencia de duración audio/video: ${((Number(a.duration) - Number(v.duration)) * 1000).toFixed(0)} ms`);

// Tramos con voz (silencedetect) frente a los subtítulos.
// ffmpeg escribe silencedetect en stderr.
const { spawnSync } = await import("node:child_process");
const det = spawnSync(FFMPEG, ["-v", "info", "-i", mp4, "-map", "0:a", "-af", "silencedetect=noise=-38dB:d=0.25", "-f", "null", "-"], { encoding: "utf8", maxBuffer: 1 << 26 }).stderr;
const voz = [...det.matchAll(/silence_end: ([\d.]+)/g)].map((m) => Number(m[1]));
// Inicio de cada oración: subtítulo que empieza tras una pausa (el anterior terminó antes).
const srtTxt = readFileSync(srt, "utf8");
const seg = (h, m, s, ms) => +h * 3600 + +m * 60 + +s + +ms / 1000;
const cues = [...srtTxt.matchAll(/(\d\d):(\d\d):(\d\d),(\d\d\d) --> (\d\d):(\d\d):(\d\d),(\d\d\d)/g)].map((m) => ({ a: seg(m[1], m[2], m[3], m[4]), b: seg(m[5], m[6], m[7], m[8]) }));
const inicios = cues.filter((c, i) => i === 0 || c.a - cues[i - 1].b > 0.1).map((c) => c.a);
const difs = inicios.map((t) => Math.min(...voz.map((x) => Math.abs(x - t)))).sort((x, y) => x - y);
const p = (q) => difs[Math.floor((difs.length - 1) * q)] ?? 0;
console.log(`oraciones: ${inicios.length}, inicios de voz detectados: ${voz.length}; desfase subtítulo→voz: mediana ${(p(0.5) * 1000).toFixed(0)} ms, p90 ${(p(0.9) * 1000).toFixed(0)} ms, máx ${(p(1) * 1000).toFixed(0)} ms`);

// Hoja de cuadros.
const tiempos = args.length ? args.map(Number) : [5, 62, 140, 210, 270, 330, 400, 455, 520, 555];
const dir = join(BUILD, "verificacion");
mkdirSync(dir, { recursive: true });
const files = tiempos.map((t) => {
  const f = join(dir, `t${String(t).padStart(4, "0")}.png`);
  execFileSync(FFMPEG, ["-v", "error", "-y", "-ss", String(t), "-i", mp4, "-frames:v", "1", f]);
  return f;
});
const cols = 2;
const inputs = files.flatMap((f) => ["-i", f]);
const fc = files.map((_, i) => `[${i}:v]scale=960:540[s${i}]`).join(";") + ";" + files.map((_, i) => `[s${i}]`).join("") + `xstack=inputs=${files.length}:layout=${files.map((_, i) => `${(i % cols) * 960}_${Math.floor(i / cols) * 540}`).join("|")}`;
const hoja = join(dir, "hoja.png");
execFileSync(FFMPEG, ["-v", "error", "-y", ...inputs, "-filter_complex", fc, "-frames:v", "1", hoja]);
console.log(`cuadros: ${dir}\nhoja: ${hoja}`);
