// Prueba una escena del video 1 sin grabar: abre la escena, ejecuta pasos y guarda capturas.
// Uso: node scripts/video/v2/v1-primeros-pasos/probar-toma.mjs pasos.json salida-dir
// pasos.json: { "scene": "empty", "query": "&update=1", "steps": [[...], ["snap", "nombre"], ...] }
// El paso extra ["snap", nombre] guarda salida-dir/nombre.png; ["dump", texto] lista elementos visibles
// cuyo texto o title contiene `texto`.
import "./config.mjs";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { BASE, connect, launchChrome, sleep } from "../../cdp.mjs";
import { makeSteps } from "./steps-v1.mjs";

const [file, outDir = "."] = process.argv.slice(2);
const plan = JSON.parse(readFileSync(file, "utf8"));
mkdirSync(outDir, { recursive: true });
const chrome = process.env.REUSE ? null : launchChrome();
const c = await connect();
for (const f of ["../../overlay.js", "./overlay-v1.js"]) await c.send("Page.addScriptToEvaluateOnNewDocument", { source: readFileSync(fileURLToPath(new URL(f, import.meta.url)), "utf8") });
c.on("Runtime.exceptionThrown", (p) => console.error("error en página:", p.exceptionDetails?.exception?.description?.split("\n")[0]));
c.on("Runtime.consoleAPICalled", (p) => p.type !== "log" && console.log(`consola ${p.type}:`, p.args.map((a) => a.value ?? a.description).join(" ")));
const { steps, missing } = makeSteps(c);
steps.snap = async (name) => {
  const { data } = await c.send("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(outDir, `${name}.png`), Buffer.from(data, "base64"));
};
steps.dump = async (text) => {
  const r = await c.evaluate(`[...document.querySelectorAll("body *")].filter((e) => !e.closest("#ntv,#ntv1") && e.getBoundingClientRect().width > 1 && ((e.title ?? "").includes(${JSON.stringify(text)}) || (e.children.length <= 2 && (e.textContent ?? "").includes(${JSON.stringify(text)})))).slice(0, 25).map((e) => { const r = e.getBoundingClientRect(); return e.tagName + (e.title ? " title=" + JSON.stringify(e.title) : "") + (e.getAttribute("aria-label") ? " aria=" + JSON.stringify(e.getAttribute("aria-label")) : "") + (e.placeholder ? " ph=" + JSON.stringify(e.placeholder) : "") + " text=" + JSON.stringify((e.textContent ?? "").trim().slice(0, 70)) + " @" + [r.x, r.y, r.width, r.height].map(Math.round).join(","); })`);
  console.log(`dump ${text}:\n  ${r.join("\n  ")}`);
};
await c.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
await c.send("Page.navigate", { url: `${BASE}?scene=${plan.scene ?? "empty"}&theme=light&video=1${plan.query ?? ""}` });
await sleep(plan.wait ?? 4200);
await c.evaluate("window.__v.sanitize()");
for (const [name, ...args] of plan.steps) {
  if (!steps[name]) throw new Error(`Paso desconocido: ${name}`);
  await steps[name](...args);
}
if (missing.length) console.log("no encontrados:", missing);
c.close();
await chrome?.close();
