// Verifica el MP4 final del video 3: formato (ffprobe), capítulos incrustados, sonoridad (EBU R128),
// blackdetect y freezedetect, cuadros cada 30 s más el inicio de cada capítulo (hojas de contacto),
// atrasos de las acciones grabadas frente a la narración (toma.json) y, con Python, sincronía de
// la voz y WER de la transcripción con Whisper (verificar_audio.py).
// Uso: node scripts/video/v2/v3-automatizacion/verificar.mjs [video.mp4]   (BUILD, OUT)
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { BUILD, FFMPEG, FFPROBE } from "./narracion.mjs";

const OUT = process.env.OUT ?? fileURLToPath(new URL("../../../../videos/", import.meta.url));
const mp4 = process.argv[2] ?? join(OUT, "NetTerminal-v3-automatizacion.mp4");
const dir = join(BUILD, "verificacion");
mkdirSync(dir, { recursive: true });
const informe = {};

// 1. Formato y capítulos.
const probe = JSON.parse(execFileSync(FFPROBE, ["-v", "error", "-show_entries", "stream=codec_type,codec_name,profile,width,height,r_frame_rate,pix_fmt,sample_rate,channels,duration:format=duration", "-show_chapters", "-of", "json", mp4]).toString());
const v = probe.streams.find((s) => s.codec_type === "video");
const a = probe.streams.find((s) => s.codec_type === "audio");
informe.formato = { video: `${v.codec_name} ${v.profile} ${v.width}x${v.height} ${v.r_frame_rate} ${v.pix_fmt}`, audio: `${a.codec_name} ${a.sample_rate} Hz ${a.channels} canales`, duracion: Number(probe.format.duration) };
informe.capitulos = probe.chapters.map((c) => ({ t: Number(c.start_time), titulo: c.tags?.title }));
console.log("formato:", informe.formato);
console.log("capítulos:", informe.capitulos.map((c) => `${c.t.toFixed(1)} ${c.titulo}`).join(" | "));

// 2. Sonoridad integrada.
const r128 = spawnSync(FFMPEG, ["-hide_banner", "-nostats", "-i", mp4, "-map", "0:a", "-af", "ebur128=peak=true", "-f", "null", "-"], { encoding: "utf8", maxBuffer: 1 << 26 }).stderr;
const resumen = r128.slice(r128.lastIndexOf("Summary:"));
informe.sonoridad = { I_LUFS: Number(resumen.match(/I:\s+(-?[\d.]+) LUFS/)?.[1]), LRA: Number(resumen.match(/LRA:\s+([\d.]+) LU/)?.[1]), pico_dBFS: Number(resumen.match(/Peak:\s+(-?[\d.]+) dBFS/)?.[1]) };
console.log("sonoridad:", informe.sonoridad);

// 3. Negro y congelado.
const det = spawnSync(FFMPEG, ["-hide_banner", "-nostats", "-i", mp4, "-map", "0:v", "-vf", "blackdetect=d=0.5:pix_th=0.10,freezedetect=n=0.001:d=8", "-f", "null", "-"], { encoding: "utf8", maxBuffer: 1 << 26 }).stderr;
informe.negro = [...det.matchAll(/black_start:([\d.]+) black_end:([\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
informe.congelado = [...det.matchAll(/freeze_start: ([\d.]+)[\s\S]*?freeze_duration: ([\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
console.log("blackdetect (≥0,5 s):", informe.negro.length ? informe.negro : "sin tramos negros");
console.log("freezedetect (≥8 s):", informe.congelado.length ? informe.congelado : "sin tramos congelados");

// 4. Cuadros cada 30 s y al inicio de cada capítulo (+1 s), en hojas de 3x3.
const tiempos = [...new Set([...Array.from({ length: Math.floor(informe.formato.duracion / 30) + 1 }, (_, i) => Math.min(i * 30 + 1, informe.formato.duracion - 0.5)), ...informe.capitulos.map((c) => c.t + 1.0)])].sort((x, y) => x - y);
const cuadros = tiempos.map((t) => {
  const f = join(dir, `t${String(Math.round(t * 10)).padStart(5, "0")}.png`);
  execFileSync(FFMPEG, ["-v", "error", "-y", "-ss", t.toFixed(2), "-i", mp4, "-frames:v", "1", f]);
  return { t, f };
});
const hojas = [];
for (let i = 0; i < cuadros.length; i += 9) {
  const grupo = cuadros.slice(i, i + 9);
  const inputs = grupo.flatMap((c) => ["-i", c.f]);
  const fc = grupo.map((_, k) => `[${k}:v]scale=640:360[s${k}]`).join(";") + ";" + grupo.map((_, k) => `[s${k}]`).join("") + `xstack=inputs=${grupo.length}:layout=${grupo.map((_, k) => `${(k % 3) * 640}_${Math.floor(k / 3) * 360}`).join("|")}:fill=black`;
  const hoja = join(dir, `hoja-${String(i / 9 + 1).padStart(2, "0")}.png`);
  execFileSync(FFMPEG, ["-v", "error", "-y", ...inputs, "-filter_complex", grupo.length > 1 ? fc : "[0:v]scale=640:360", "-frames:v", "1", hoja]);
  hojas.push({ hoja, tiempos: grupo.map((c) => c.t) });
}
informe.cuadros = { total: cuadros.length, hojas };
console.log(`cuadros: ${cuadros.length} (cada 30 s + inicio de capítulo) en ${hojas.length} hojas: ${dir}`);

// 5. Acciones atrasadas frente a la narración (grabación).
const tomas = readdirSync(join(BUILD, "tomas")).map((id) => join(BUILD, "tomas", id, "toma.json")).filter(existsSync).map((f) => JSON.parse(readFileSync(f, "utf8")));
const tardes = tomas.map((t) => ({ id: t.id, tarde: t.tarde ?? 0, extra: t.dur - t.plan })).sort((x, y) => y.tarde - x.tarde);
informe.acciones = { max_atraso_s: tardes[0]?.tarde ?? 0, peores: tardes.slice(0, 5), tomas_alargadas: tardes.filter((t) => t.extra > 0.05).map((t) => `${t.id} +${t.extra.toFixed(2)} s`) };
console.log("acciones atrasadas (máx):", informe.acciones.max_atraso_s.toFixed(2), "s", informe.acciones.peores.map((t) => `${t.id} ${t.tarde.toFixed(2)}`).join(", "));

// 6. Voz: sincronía y WER (Whisper).
const py = join(homedir(), ".venvs", "kokoro", "bin", "python");
const audioJson = join(dir, "audio.json");
execFileSync(py, ["-I", fileURLToPath(new URL("./verificar_audio.py", import.meta.url)), mp4, join(BUILD, "armado", "oraciones.json"), "-o", audioJson], { stdio: ["ignore", "inherit", "inherit"] });
informe.voz = JSON.parse(readFileSync(audioJson, "utf8")).resumen;
writeFileSync(join(dir, "informe.json"), JSON.stringify(informe, null, 1));
console.log(`informe: ${join(dir, "informe.json")}`);
