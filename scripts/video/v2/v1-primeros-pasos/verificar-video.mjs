// Revisión técnica del MP4 final del video 1: formato, sonoridad, capítulos, negro y congelados, y
// cuadros cada 30 s más el inicio de cada capítulo (hojas de contacto para mirarlas).
// Uso: node scripts/video/v2/v1-primeros-pasos/verificar-video.mjs [carpeta de salida]
import { NAME, OUT_DIR, WORK } from "./config.mjs";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FFMPEG, FFPROBE } from "../../cdp.mjs";

const mp4 = join(OUT_DIR, `${NAME}.mp4`);
const dir = process.argv[2] ?? join(WORK, "verificacion");
mkdirSync(dir, { recursive: true });
const tl = JSON.parse(readFileSync(join(WORK, "final", "timeline.json"), "utf8"));
const info = JSON.parse(execFileSync(FFPROBE, ["-v", "error", "-show_format", "-show_streams", "-show_chapters", "-of", "json", mp4]).toString());
const v = info.streams.find((s) => s.codec_type === "video");
const a = info.streams.find((s) => s.codec_type === "audio");
const ff = (args) => spawnSync(FFMPEG, ["-hide_banner", "-nostats", ...args], { encoding: "utf8", maxBuffer: 1 << 26 }).stderr;

const ebu = ff(["-i", mp4, "-vn", "-af", "ebur128=peak=true", "-f", "null", "-"]);
const I = Number(/I:\s+(-?[\d.]+) LUFS/.exec(ebu.slice(ebu.lastIndexOf("Summary")))?.[1]);
const TP = Number(/Peak:\s+(-?[\d.]+) dBFS/.exec(ebu.slice(ebu.lastIndexOf("Summary")))?.[1]);
const black = [...ff(["-i", mp4, "-an", "-vf", "blackdetect=d=0.5:pix_th=0.10", "-f", "null", "-"]).matchAll(/black_start:(\S+) black_end:(\S+) black_duration:(\S+)/g)].map((m) => m.slice(1).map(Number));
const freeze = [...ff(["-i", mp4, "-an", "-vf", "freezedetect=n=0.001:d=5", "-f", "null", "-"]).matchAll(/freeze_start: (\S+)[\s\S]*?freeze_duration: (\S+)[\s\S]*?freeze_end: (\S+)/g)].map((m) => [Number(m[1]), Number(m[3]), Number(m[2])]);

// Cuadros: cada 30 s y el inicio de cada capítulo (tarjeta a +1 s y primera acción a +3 s).
const total = Number(info.format.duration);
const marcas = [];
for (let t = 0; t < total; t += 30) marcas.push([t, `t${Math.round(t)}`]);
tl.marks.forEach((m, i) => marcas.push([m.start + 1, `cap${i + 1}-tarjeta`], [m.start + 3.2, `cap${i + 1}-inicio`]));
marcas.sort((x, y) => x[0] - y[0]);
const files = [];
for (const [t, name] of marcas) {
  const f = join(dir, `${String(Math.round(t * 10)).padStart(5, "0")}-${name}.png`);
  execFileSync(FFMPEG, ["-loglevel", "error", "-y", "-ss", t.toFixed(2), "-i", mp4, "-frames:v", "1", "-vf", "scale=640:360", f]);
  files.push(f);
}
// Hojas de 3x3.
for (let h = 0; h * 9 < files.length; h++) {
  const part = files.slice(h * 9, h * 9 + 9);
  while (part.length < 9) part.push(part.at(-1));
  const args = ["-loglevel", "error", "-y"];
  part.forEach((f) => args.push("-i", f));
  args.push("-filter_complex", `xstack=inputs=9:layout=${part.map((_, i) => `${(i % 3) * 640}_${Math.floor(i / 3) * 360}`).join("|")}`, join(dir, `hoja-${h + 1}.png`));
  execFileSync(FFMPEG, args);
}
const res = {
  archivo: mp4,
  duracion_s: total,
  video: { codec: v.codec_name, perfil: v.profile, ancho: v.width, alto: v.height, fps: v.r_frame_rate, pix_fmt: v.pix_fmt },
  audio: { codec: a.codec_name, hz: Number(a.sample_rate), canales: a.channels },
  capitulos: info.chapters.map((c) => [Number(c.start_time).toFixed(2), c.tags?.title]),
  lufs_integrado: I,
  pico_dbfs: TP,
  negro: black,
  congelados_5s: freeze,
  cuadros: files.length,
};
writeFileSync(join(dir, "tecnica.json"), JSON.stringify(res, null, 1));
console.log(JSON.stringify(res, null, 1));
