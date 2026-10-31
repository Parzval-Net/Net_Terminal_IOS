// Graba las tomas del tutorial: abre cada escena del demo (backend simulado), ejecuta los pasos de
// cada frase del guion al ritmo de su audio y captura la pantalla con Page.startScreencast.
// Requisitos: vite en PORT (1461) sirviendo el repo y la narración ya generada (tts.mjs).
// Uso: node scripts/video/record.mjs [prefijo de capítulo ...]   p. ej. `node record.mjs 03 07`
// Variables: REUSE=1 usa un Chrome ya abierto en CDP_PORT (9361); si no, lanza uno propio.
// Salida: WORK/shots/<capítulo>-<n>.mp4 (30 fps, 1920x1080) y WORK/log/<capítulo>.json con tiempos.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { BASE, FFMPEG, WORK, connect, launchChrome, sleep } from "./cdp.mjs";
import { chapters } from "./storyboard.mjs";
import { chunkCaption } from "./captions.mjs";

const FPS = 30;
const GAP = 0.3; // silencio entre frases (s)
const CARD = 2.0; // tarjeta de capítulo visible (s)
const FIRST_CUE = 2.3; // primera frase tras la tarjeta (s)
const manifest = JSON.parse(readFileSync(join(WORK, "tts", "manifest.json"), "utf8"));
const overlay = readFileSync(fileURLToPath(new URL("./overlay.js", import.meta.url)), "utf8");
const only = process.argv.slice(2);

const chrome = process.env.REUSE ? null : launchChrome();
const c = await connect();
await c.send("Page.addScriptToEvaluateOnNewDocument", { source: overlay });
c.on("Runtime.exceptionThrown", (p) => console.error("  error en página:", p.exceptionDetails?.exception?.description?.split("\n")[0]));

// ---------- Pasos ----------
let fast = false; // en la preparación (no grabada) el cursor no se anima
const rectOf = async (spec, timeout = 3500) => {
  const t = Date.now();
  do {
    const r = await c.evaluate(`window.__v?.rectOf(${JSON.stringify(spec)})`);
    if (r) return r;
    await sleep(120);
  } while (Date.now() - t < timeout);
  console.warn(`  no encontrado: ${spec}`);
  return null;
};
const pointOf = (r, at = [0.5, 0.5]) => [Math.round(r.x + r.w * at[0]), Math.round(r.y + r.h * at[1])];
async function moveTo(x, y) {
  const [cx, cy] = await c.evaluate("window.__v.cursor");
  const ms = fast ? 0 : Math.round(Math.min(950, Math.max(380, 260 + Math.hypot(x - cx, y - cy) * 0.55)));
  await c.evaluate(`window.__v.cursorTo(${x}, ${y}, ${ms})`);
  await sleep(ms);
  await c.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
}
async function mouse(x, y, button = "left", count = 1) {
  if (!fast) await c.evaluate(`window.__v.ripple(${x}, ${y})`);
  for (let n = 1; n <= count; n++) {
    await c.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button, clickCount: n });
    await c.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button, clickCount: n });
  }
}
const KEYS = { Enter: [13, "Enter", "\r"], Escape: [27, "Escape"], Tab: [9, "Tab"], Backspace: [8, "Backspace"], ArrowDown: [40, "ArrowDown"], ArrowUp: [38, "ArrowUp"], Delete: [46, "Delete"] };
async function key(combo) {
  const parts = combo.split("+");
  const k = parts.pop();
  const mods = parts.reduce((m, p) => m | { alt: 1, ctrl: 2, cmd: 4, meta: 4, shift: 8 }[p], 0);
  let ev;
  if (KEYS[k]) ev = { key: KEYS[k][1], code: KEYS[k][1], windowsVirtualKeyCode: KEYS[k][0], text: mods & 6 ? undefined : KEYS[k][2] };
  else if (k === ",") ev = { key: ",", code: "Comma", windowsVirtualKeyCode: 188 };
  else ev = { key: k.toLowerCase(), code: /\d/.test(k) ? `Digit${k}` : `Key${k.toUpperCase()}`, windowsVirtualKeyCode: k.toUpperCase().charCodeAt(0), text: mods & 6 ? undefined : k };
  await c.send("Input.dispatchKeyEvent", { type: ev.text ? "keyDown" : "rawKeyDown", modifiers: mods, ...ev });
  await c.send("Input.dispatchKeyEvent", { type: "keyUp", modifiers: mods, ...ev, text: undefined });
}
async function type(text, delay = 55) {
  for (const ch of text) {
    if (ch === "\n") await key("Enter");
    else if (ch === "\t") await key("Tab");
    else {
      await c.send("Input.dispatchKeyEvent", { type: "keyDown", text: ch, key: ch, unmodifiedText: ch });
      await c.send("Input.dispatchKeyEvent", { type: "keyUp", key: ch });
    }
    if (!fast) await sleep(delay + Math.random() * delay * 0.6);
  }
}
const steps = {
  async click(spec, o = {}) {
    const r = await rectOf(spec, o.timeout);
    if (!r) return;
    const [x, y] = pointOf(r, o.at);
    await moveTo(x, y);
    await sleep(fast ? 0 : 90);
    await mouse(x, y, o.right ? "right" : "left", o.dbl ? 2 : 1);
    await sleep(fast ? 120 : 260);
  },
  dbl: (spec, o = {}) => steps.click(spec, { ...o, dbl: true }),
  right: (spec, o = {}) => steps.click(spec, { ...o, right: true }),
  async hover(spec, o = {}) {
    const r = await rectOf(spec);
    if (r) await moveTo(...pointOf(r, o.at));
  },
  move: (x, y) => moveTo(x, y),
  async type(text, delay) {
    await type(text, delay);
  },
  async field(spec, text, o = {}) {
    await steps.set(spec, "");
    await steps.click(spec, o);
    await type(text, o.delay);
  },
  key,
  async hl(spec, pad = 6) {
    const r = spec ? await rectOf(spec) : null;
    await c.evaluate(`window.__v.hl(${JSON.stringify(r)}, ${pad})`);
  },
  async zoom(spec, s = 1.5) {
    const r = await rectOf(spec);
    await c.evaluate(`window.__v.hl(null); window.__v.zoom(${JSON.stringify(r)}, ${s}, ${fast ? 0 : 900})`);
    await sleep(fast ? 50 : 950);
  },
  async unzoom() {
    await c.evaluate(`window.__v.hl(null); window.__v.zoom(null, 1, ${fast ? 0 : 800})`);
    await sleep(fast ? 50 : 850);
  },
  wait: (ms) => sleep(fast ? 0 : ms),
  js: (code) => c.evaluate(`(async () => { ${code} })()`),
  async set(spec, value) {
    await c.evaluate(`(() => { const el = window.__v.find(${JSON.stringify(spec)}); if (!el) return console.warn("set: no encontrado"); const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, "value").set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true })); })()`);
    await sleep(fast ? 50 : 250);
  },
  async scroll(spec, dy, o = {}) {
    const r = await rectOf(spec);
    if (!r) return;
    const [x, y] = pointOf(r, o.at);
    if (!o.still) await moveTo(x, y);
    const n = Math.max(1, Math.round(Math.abs(dy) / 60));
    for (let i = 0; i < n; i++) {
      await c.send("Input.dispatchMouseEvent", { type: "mouseWheel", x, y, deltaX: 0, deltaY: Math.sign(dy) * 60 });
      await sleep(fast ? 0 : 28);
    }
    await sleep(fast ? 50 : 300);
  },
  async scrollto(spec, block = "center") {
    if (!(await c.evaluate(`window.__v.scrollTo(${JSON.stringify(spec)}, ${JSON.stringify(block)})`))) console.warn(`  no encontrado: ${spec}`);
    await sleep(fast ? 100 : 650);
  },
  cursor: (on) => c.evaluate(`window.__v.cursorShow(${on})`),
  card: (k, t, s) => c.evaluate(`window.__v.card(${JSON.stringify(k ?? null)}, ${JSON.stringify(t ?? "")}, ${JSON.stringify(s ?? "")})`),
};
async function runSteps(list, t0, dur = 0) {
  for (const s of list ?? []) {
    const [name, ...args] = s;
    if (name === "@" || name === "@end") {
      // Punto de sincronía: hasta `ms` desde el inicio de la frase ("@end": `ms` antes de que termine).
      const left = t0 + (name === "@" ? args[0] : dur * 1000 - args[0]) - Date.now();
      if (left > 0 && !fast) await sleep(left);
      continue;
    }
    if (!steps[name]) throw new Error(`Paso desconocido: ${name}`);
    await steps[name](...args);
  }
}

// ---------- Grabación ----------
mkdirSync(join(WORK, "shots"), { recursive: true });
mkdirSync(join(WORK, "log"), { recursive: true });
for (const ch of chapters) {
  if (only.length && !only.some((p) => ch.id.startsWith(p))) continue;
  const m = manifest.find((x) => x.id === ch.id);
  if (!m) throw new Error(`Sin narración para ${ch.id}: ejecuta tts.mjs`);
  const nCues = ch.shots.reduce((a, s) => a + s.cues.length, 0);
  if (nCues !== m.cues.length) throw new Error(`${ch.id}: el guion tiene ${m.cues.length} frases y el storyboard ${nCues}`);
  console.log(`${ch.id}  ${m.title}`);
  const log = { id: ch.id, title: m.title, shots: [] };
  let cueIndex = 0;
  for (const [si, shot] of ch.shots.entries()) {
    const theme = shot.theme ?? "light";
    await c.send("Page.stopScreencast").catch(() => {});
    await c.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: theme }] });
    await c.send("Page.navigate", { url: `${BASE}?scene=${shot.scene ?? "empty"}&theme=${theme}&video=1${shot.query ?? ""}` });
    await sleep(shot.wait ?? 4200);
    await c.evaluate("window.__v.sanitize()");
    fast = true;
    await runSteps(shot.setup, Date.now());
    await c.evaluate("window.__v.sanitize()");
    const [sx, sy] = shot.cursor ?? [1040, 600];
    await c.evaluate(`window.__v.cursorTo(${sx}, ${sy}, 0)`);
    fast = false;
    const first = si === 0;
    if (first) await c.evaluate(`window.__v.card(${JSON.stringify(`Capítulo ${Number(ch.id.slice(0, 2))}`)}, ${JSON.stringify(m.title)}, ${JSON.stringify(ch.sub ?? "")})`);
    await sleep(300);

    const dir = resolve(WORK, "frames", `${ch.id}-${si + 1}`);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const frames = [];
    c.off("Page.screencastFrame");
    c.on("Page.screencastFrame", ({ data, metadata, sessionId }) => {
      c.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
      const file = join(dir, `${String(frames.length).padStart(6, "0")}.jpg`);
      writeFileSync(file, Buffer.from(data, "base64"));
      frames.push({ ts: metadata.timestamp, file });
    });
    await c.send("Page.startScreencast", { format: "jpeg", quality: 88, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
    const t0 = Date.now();
    // Fuerza un primer cuadro aunque la pantalla esté quieta.
    await c.evaluate("window.__v.cursorTo(...window.__v.cursor.map((v) => v + 1), 0)");
    const cues = [];
    let at = first ? FIRST_CUE : 0.5;
    if (first) {
      await sleep(CARD * 1000);
      await c.evaluate("window.__v.card(null)");
    }
    for (const stepsOfCue of shot.cues) {
      const cue = m.cues[cueIndex];
      const wait = t0 + at * 1000 - Date.now();
      if (wait > 0) await sleep(wait);
      const start = Date.now();
      const chunks = chunkCaption(cue.text, cue.dur);
      await c.evaluate(`window.__v.hl(null); window.__v.caption(${JSON.stringify(chunks.map((k) => [Math.round(k.start * 1000), k.text, Math.round(k.end * 1000)]))})`);
      await runSteps(stepsOfCue, start, cue.dur);
      const startRel = (start - t0) / 1000;
      cues.push({ index: cueIndex, start: startRel, dur: cue.dur, text: cue.text, file: cue.file });
      // La siguiente frase parte cuando termina el audio de esta (o cuando terminan sus pasos).
      at = Math.max(startRel + cue.dur + GAP, (Date.now() - t0) / 1000 + 0.15);
      cueIndex++;
    }
    const last = si === ch.shots.length - 1;
    const end = at - GAP + (shot.tail ?? (last ? 1.0 : 0.5));
    const wait = t0 + end * 1000 - Date.now();
    if (wait > 0) await sleep(wait);
    await c.evaluate("window.__v.hl(null)");
    await sleep(150);
    await c.send("Page.stopScreencast");
    await sleep(250);
    c.off("Page.screencastFrame");

    // Cuadros con hora de llegada -> video a 30 fps con la duración exacta de la toma.
    const t0s = t0 / 1000;
    const N = Math.round(end * FPS);
    const dur = N / FPS;
    const list = frames.filter((f) => f.ts < t0s + dur).sort((a, b) => a.ts - b.ts);
    if (!list.length) throw new Error(`${ch.id} toma ${si + 1}: sin cuadros`);
    let txt = "";
    for (let i = 0; i < list.length; i++) {
      const from = i === 0 ? t0s : list[i].ts;
      const to = i + 1 < list.length ? list[i + 1].ts : t0s + dur + 0.1;
      txt += `file '${list[i].file.replaceAll("'", "'\\''")}'\nduration ${Math.max(0.001, to - from).toFixed(4)}\n`;
    }
    txt += `file '${list.at(-1).file.replaceAll("'", "'\\''")}'\n`;
    const listFile = join(dir, "list.txt");
    writeFileSync(listFile, txt);
    const out = join(WORK, "shots", `${ch.id}-${si + 1}.mp4`);
    execFileSync(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", listFile, "-vf", `scale=1920:1080:flags=lanczos,fps=${FPS},format=yuv420p`, "-frames:v", String(N), "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-r", String(FPS), "-video_track_timescale", "15360", out]);
    if (!process.env.KEEP_FRAMES) rmSync(dir, { recursive: true, force: true });
    log.shots.push({ file: out, dur, frames: list.length, cues });
    console.log(`  toma ${si + 1}: ${dur.toFixed(2)} s, ${list.length} cuadros (${(list.length / dur).toFixed(1)} por s)`);
  }
  writeFileSync(join(WORK, "log", `${ch.id}.json`), JSON.stringify(log, null, 1));
}
c.close();
await chrome?.close();
