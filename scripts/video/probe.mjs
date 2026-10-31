// Herramienta de exploración: carga una escena y guarda una captura, o evalúa código en la página.
// Uso (con Chrome ya abierto en CDP_PORT):
//   node scripts/video/probe.mjs <escena> <archivo.png> [tema] [query]
//   node scripts/video/probe.mjs --eval "<expresión>" [archivo.png]
import { writeFileSync } from "node:fs";
import { BASE, connect, sleep } from "./cdp.mjs";

const c = await connect();
const args = process.argv.slice(2);
if (args[0] === "--eval") {
  console.log(JSON.stringify(await c.evaluate(args[1]), null, 1));
  await sleep(Number(process.env.WAIT ?? 300));
  if (args[2]) writeFileSync(args[2], Buffer.from((await c.send("Page.captureScreenshot", { format: "png" })).data, "base64"));
} else {
  const [scene, out, theme = "light", query = ""] = args;
  await c.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: theme }] });
  await c.send("Page.navigate", { url: `${BASE}?scene=${scene}&theme=${theme}${query}` });
  await sleep(Number(process.env.WAIT ?? 4500));
  writeFileSync(out, Buffer.from((await c.send("Page.captureScreenshot", { format: "png" })).data, "base64"));
}
c.close();
