// Hoja de contacto para revisar un video: extrae cuadros y los junta en una grilla de 3 columnas (640x360).
// Uso: node scripts/video/contact.mjs <video.mp4> <salida.jpg> [t1 t2 ...]   (sin tiempos: 9 repartidos)
//      node scripts/video/contact.mjs <salida.jpg> <video.mp4@t> [<video.mp4@t> ...]
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FFMPEG, FFPROBE } from "./cdp.mjs";

const args = process.argv.slice(2);
let out, picks;
if (args[0].endsWith(".jpg") || args[0].endsWith(".png")) {
  out = args[0];
  picks = args.slice(1).map((a) => {
    const i = a.lastIndexOf("@");
    return [a.slice(0, i), Number(a.slice(i + 1))];
  });
} else {
  const [video, o, ...ts] = args;
  out = o;
  const dur = Number(execFileSync(FFPROBE, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", video]).toString());
  const times = ts.length ? ts.map(Number) : Array.from({ length: 9 }, (_, i) => ((i + 0.5) * dur) / 9);
  picks = times.map((t) => [video, t]);
}
const tmp = mkdtempSync(join(tmpdir(), "nt-contact-"));
picks.forEach(([video, t], i) =>
  execFileSync(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", "-ss", String(t), "-i", video, "-frames:v", "1", "-vf", "scale=640:360", join(tmp, `${String(i).padStart(3, "0")}.png`)]),
);
const rows = Math.ceil(picks.length / 3);
execFileSync(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", "-framerate", "1", "-i", join(tmp, "%03d.png"), "-vf", `tile=3x${rows}:padding=4:color=white`, "-frames:v", "1", out]);
rmSync(tmp, { recursive: true, force: true });
console.log(picks.map(([v, t]) => `${v.split("/").pop()}@${t}`).join(" "));
