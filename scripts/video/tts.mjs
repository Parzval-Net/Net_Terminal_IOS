// Genera la narración, una pista por línea de guion. Motor por defecto: Kokoro local (voz ef_dora,
// léxico pronunciacion.json); `say -v Paulina` (es_MX) queda como respaldo.
// Uso: node scripts/video/tts.mjs   (variables: NT_TTS=kokoro|say, NT_VOICE, NT_SPEED, VOICE y RATE para say, WORK)
// Lee scripts/video/guion/*.txt (primera línea "# Título", luego una frase por línea) y deja en
// WORK/tts/<capítulo>-<n>.wav (48 kHz, mono) junto a WORK/tts/manifest.json con textos y duraciones.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { FFPROBE, WORK } from "./cdp.mjs";
import { generarKokoro, huellaKokoro, usarKokoro } from "./kokoro.mjs";

const VOICE = process.env.VOICE ?? "Paulina";
const RATE = process.env.RATE ?? "185";
const GUION = fileURLToPath(new URL("./guion/", import.meta.url));

// Lo que se lee distinto de como se escribe en los subtítulos.
const SPOKEN = [
  [/⌘,/g, "Comando coma"],
  [/⌘Enter/g, "Comando Enter"],
  [/⌘([A-Z])\b/g, "Comando $1"],
  [/Ctrl\+Shift\+([A-Z])\b/g, "Control Shift $1"],
  [/\b1\.777\b/g, "mil setecientos setenta y siete"],
  [/\bNetTerminal\b/g, "Net Terminal"],
  [/\bOpenSSH\b/g, "Open ese ese hache"],
  [/\bssh_config\b/g, "ese ese hache config"],
  [/\bknown_hosts\b/g, "known hosts"],
  [/\bwait_for\b/g, "wait for"],
  [/\bJSON\b/g, "yeison"],
  [/\bmacOS\b/g, "mac o ese"],
  [/\bMobaXterm\b/g, "Moba X term"],
  [/\bSecureCRT\b/g, "Secure C R T"],
  [/\bPuTTY\b/g, "Putty"],
  [/\biperf3\b/g, "iperf tres"],
  [/\bIPv4\b/g, "IP versión cuatro"],
  [/\bIPv6\b/g, "IP versión seis"],
  [/\bv1, v2c y v3\b/g, "versiones uno, dos c y tres"],
  [/\bv1\b/g, "versión uno"],
  [/\bv2c\b/g, "versión dos c"],
  [/\bv3\b/g, "versión tres"],
  [/\bGETNEXT\b/g, "get next"],
  [/\bGETBULK\b/g, "get bulk"],
  [/\bGET\b/g, "get"],
  [/\bWALK\b/g, "walk"],
  [/\bOIDs\b/g, "OIDs"],
  [/\bauthPriv\b/g, "auth priv"],
  [/\bdraw\.io\b/g, "draw punto io"],
  [/\bPort-channel\b/g, "port channel"],
  [/\bspeedtest\b/g, "speed test"],
  [/\bSucursales\/Centro\b/g, "Sucursales barra Centro"],
  [/\bdeb\b/g, "punto deb"],
  [/\bAPI\b/g, "A P I"],
];
export const spoken = (s) => SPOKEN.reduce((acc, [re, to]) => acc.replace(re, to), s);

/** Lee los guiones: [{ id, title, lines[] }]. */
export function readScripts() {
  return readdirSync(GUION)
    .filter((f) => f.endsWith(".txt"))
    .sort()
    .map((f) => {
      const [head, ...rest] = readFileSync(join(GUION, f), "utf8").split("\n");
      return { id: f.replace(/\.txt$/, ""), title: head.replace(/^#\s*/, "").trim(), lines: rest.map((l) => l.trim()).filter(Boolean) };
    });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dir = join(WORK, "tts");
  mkdirSync(dir, { recursive: true });
  const manifest = [];
  let kokoro = usarKokoro();
  const huella = kokoro ? huellaKokoro() : "";
  // Solo se regenera un clip si cambió el texto, el motor, la voz o el léxico.
  const firma = (c, k = kokoro) => (k ? `${huella}|${c.text}` : `${VOICE}|${RATE}|${spoken(c.text)}`);
  const vigente = (c) => existsSync(c.file) && existsSync(`${c.file}.txt`) && readFileSync(`${c.file}.txt`, "utf8") === firma(c);
  const pendientes = [];
  const capitulos = [];
  for (const ch of readScripts()) {
    for (const t of ch.lines) if (/\u2014/.test(t)) throw new Error(`Guion ${ch.id}: no usar raya larga`);
    const cues = ch.lines.map((text, i) => ({ text, file: join(dir, `${ch.id}-${String(i + 1).padStart(2, "0")}.wav`) }));
    pendientes.push(...cues.filter((c) => !vigente(c)));
    capitulos.push({ ch, cues });
  }
  // Kokoro: todos los clips pendientes en un solo lote (el modelo se carga una vez).
  if (kokoro && pendientes.length) {
    const ok = generarKokoro(pendientes.map((c) => ({ texto: c.text, salida: c.file, tiempos: `${c.file}.json` })), { lote: join(dir, "lote-kokoro.json") });
    if (ok) for (const c of pendientes) writeFileSync(`${c.file}.txt`, firma(c));
    else kokoro = false;
  }
  for (const { ch, cues: base } of capitulos) {
    const cues = base.map(({ text, file }) => {
      if (!vigente({ text, file })) {
        // Respaldo: voz del sistema de macOS.
        execFileSync("say", ["-v", VOICE, "-r", RATE, "--file-format=WAVE", "--data-format=LEI16@48000", "-o", file, spoken(text)]);
        writeFileSync(`${file}.txt`, firma({ text }, false));
      }
      const dur = Number(execFileSync(FFPROBE, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).toString().trim());
      return { text, file, dur };
    });
    const total = cues.reduce((a, c) => a + c.dur, 0);
    console.log(`${ch.id}  ${cues.length} frases  ${total.toFixed(1)} s`);
    manifest.push({ id: ch.id, title: ch.title, cues });
  }
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest, null, 1));
  const all = manifest.flatMap((c) => c.cues);
  const words = all.reduce((a, c) => a + c.text.split(/\s+/).length, 0);
  const secs = all.reduce((a, c) => a + c.dur, 0);
  console.log(`Total ${secs.toFixed(1)} s de voz, ${words} palabras, ${((words / secs) * 60).toFixed(0)} palabras por minuto`);
}
