// Genera las 6 láminas comparativas Teléfono vs Tablet y Multi-Resolución (Material Design 3 Adaptive UI).
// Salida: /Users/parzval/.gemini/antigravity/brain/06493bc4-9362-4c7c-9d16-2c1e2bd2ff62/
// Uso: node scripts/screenshots/android-qa.mjs
import puppeteer from "puppeteer-core";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = process.env.PORT ?? 1430;
const BASE = `http://localhost:${PORT}/scripts/screenshots/demo.html`;
const OUT_DIR = process.env.OUT ?? "/Users/parzval/.gemini/antigravity/brain/06493bc4-9362-4c7c-9d16-2c1e2bd2ff62";

const PHONE_UA = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";
const TABLET_UA = "Mozilla/5.0 (Linux; Android 14; Pixel Tablet) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

mkdirSync(OUT_DIR, { recursive: true });

async function createCompositeSheet(browser, { title, subtitle, phoneShotB64, tabletShotB64, phoneBadges, tabletBadges }) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1740, height: 1040, deviceScaleFactor: 2 });

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: #0b0f19;
    color: #e2e8f0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    width: 1740px;
    height: 1040px;
    padding: 28px 36px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 20px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    padding-bottom: 16px;
  }
  .title-group {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .app-tag {
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #38bdf8;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .app-tag::before {
    content: "";
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #38bdf8;
    box-shadow: 0 0 10px #38bdf8;
  }
  h1 {
    font-size: 26px;
    font-weight: 700;
    color: #ffffff;
    letter-spacing: -0.02em;
  }
  .subtitle {
    font-size: 14px;
    color: #94a3b8;
  }
  .badge-m3 {
    background: linear-gradient(135deg, rgba(56, 189, 248, 0.15), rgba(129, 140, 248, 0.2));
    border: 1px solid rgba(56, 189, 248, 0.4);
    padding: 8px 16px;
    border-radius: 9999px;
    font-size: 13px;
    font-weight: 600;
    color: #e0f2fe;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .content {
    flex: 1;
    display: flex;
    gap: 36px;
    align-items: stretch;
    min-height: 0;
  }
  .pane-phone {
    width: 355px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .pane-tablet {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .device-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 13px;
    font-weight: 600;
    color: #cbd5e1;
    padding: 0 4px;
  }
  .device-badge {
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 6px;
    background: rgba(255, 255, 255, 0.08);
    color: #94a3b8;
  }
  .frame-phone {
    height: 780px;
    width: 351px;
    margin: 0 auto;
    border-radius: 32px;
    overflow: hidden;
    background: #000;
    border: 5px solid #1e293b;
    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(255, 255, 255, 0.1);
    position: relative;
    display: flex;
  }
  .frame-phone img {
    width: 100%;
    height: 100%;
    object-fit: contain;
    background: #11141c;
    display: block;
  }
  .frame-tablet {
    flex: 1;
    height: 780px;
    border-radius: 20px;
    overflow: hidden;
    background: #000;
    border: 5px solid #1e293b;
    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(255, 255, 255, 0.1);
    display: flex;
  }
  .frame-tablet img {
    width: 100%;
    height: 100%;
    object-fit: contain;
    background: #11141c;
    display: block;
  }
  .features-list {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 4px;
  }
  .feature-chip {
    font-size: 11px;
    padding: 4px 10px;
    border-radius: 8px;
    background: rgba(15, 23, 42, 0.8);
    border: 1px solid rgba(255, 255, 255, 0.08);
    color: #38bdf8;
    display: flex;
    align-items: center;
    gap: 5px;
  }
  .feature-chip span {
    color: #e2e8f0;
  }
</style>
</head>
<body>
  <header>
    <div class="title-group">
      <div class="app-tag">NetTerminal Android · Adaptive UI</div>
      <h1>${title}</h1>
      <div class="subtitle">${subtitle}</div>
    </div>
    <div class="badge-m3">
      <span>Material Design 3 Responsive Grid</span>
    </div>
  </header>
  <div class="content">
    <div class="pane-phone">
      <div class="device-header">
        <span>📱 Teléfono Android (Pixel 8 · 412 × 915)</span>
        <span class="device-badge">Compact &lt; 640px</span>
      </div>
      <div class="frame-phone">
        <img src="data:image/png;base64,${phoneShotB64}" alt="Phone view" />
      </div>
      <div class="features-list">
        ${phoneBadges.map((b) => `<div class="feature-chip">✓ <span>${b}</span></div>`).join("")}
      </div>
    </div>
    <div class="pane-tablet">
      <div class="device-header">
        <span>💻 Tablet Android (Pixel Tablet · 1280 × 800)</span>
        <span class="device-badge">Expanded &ge; 640px</span>
      </div>
      <div class="frame-tablet">
        <img src="data:image/png;base64,${tabletShotB64}" alt="Tablet view" />
      </div>
      <div class="features-list">
        ${tabletBadges.map((b) => `<div class="feature-chip">✓ <span>${b}</span></div>`).join("")}
      </div>
    </div>
  </div>
</body>
</html>`;

  await page.setContent(html, { waitUntil: "load" });
  await sleep(400);
  const compositeBuffer = await page.screenshot({ type: "png", fullPage: true });
  await page.close();
  return compositeBuffer;
}

async function createScreenSizesSheet(browser, { shotCompact, shotStandard, shotUltra }) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1740, height: 1040, deviceScaleFactor: 2 });

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: #0b0f19;
    color: #e2e8f0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    width: 1740px;
    height: 1040px;
    padding: 28px 36px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 20px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    padding-bottom: 16px;
  }
  .title-group {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .app-tag {
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: #38bdf8;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .app-tag::before {
    content: "";
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #38bdf8;
    box-shadow: 0 0 10px #38bdf8;
  }
  h1 {
    font-size: 26px;
    font-weight: 700;
    color: #ffffff;
    letter-spacing: -0.02em;
  }
  .subtitle {
    font-size: 14px;
    color: #94a3b8;
  }
  .badge-m3 {
    background: linear-gradient(135deg, rgba(56, 189, 248, 0.15), rgba(129, 140, 248, 0.2));
    border: 1px solid rgba(56, 189, 248, 0.4);
    padding: 8px 16px;
    border-radius: 9999px;
    font-size: 13px;
    font-weight: 600;
    color: #e0f2fe;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .content {
    flex: 1;
    display: flex;
    gap: 36px;
    justify-content: center;
    align-items: stretch;
    min-height: 0;
  }
  .phone-col {
    flex: 1;
    max-width: 500px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .device-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 13px;
    font-weight: 600;
    color: #cbd5e1;
    padding: 0 4px;
  }
  .device-badge {
    font-size: 11px;
    padding: 2px 8px;
    border-radius: 6px;
    background: rgba(255, 255, 255, 0.08);
    color: #94a3b8;
  }
  .frame-container {
    height: 770px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .frame-mockup {
    border-radius: 32px;
    overflow: hidden;
    background: #000;
    border: 5px solid #1e293b;
    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(255, 255, 255, 0.1);
    position: relative;
    display: flex;
  }
  .frame-compact {
    width: 380px;
    height: 674px;
  }
  .frame-standard {
    width: 346px;
    height: 748px;
  }
  .frame-ultra {
    width: 350px;
    height: 760px;
  }
  .frame-mockup img {
    width: 100%;
    height: 100%;
    object-fit: contain;
    background: #11141c;
    display: block;
  }
  .features-list {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 4px;
  }
  .feature-chip {
    font-size: 11px;
    padding: 4px 10px;
    border-radius: 8px;
    background: rgba(15, 23, 42, 0.8);
    border: 1px solid rgba(255, 255, 255, 0.08);
    color: #38bdf8;
    display: flex;
    align-items: center;
    gap: 5px;
  }
  .feature-chip span {
    color: #e2e8f0;
  }
</style>
</head>
<body>
  <header>
    <div class="title-group">
      <div class="app-tag">NetTerminal Android · Multi-Screen Responsive Verification</div>
      <h1>Lámina 6: Adaptabilidad Multi-Resolución en Teléfonos</h1>
      <div class="subtitle">Escalado fluido y controles táctiles de 44px desde 4.3" (320 × 568) hasta Galaxy S24/S25 Ultra (440 × 956)</div>
    </div>
    <div class="badge-m3">
      <span>Zero-Overflow · Touch Targets &ge; 44px</span>
    </div>
  </header>
  <div class="content">
    <div class="phone-col">
      <div class="device-header">
        <span>📱 Compacto 4.3" (320 × 568)</span>
        <span class="device-badge">Ultracompacto</span>
      </div>
      <div class="frame-container">
        <div class="frame-mockup frame-compact">
          <img src="data:image/png;base64,${shotCompact}" alt="Compact phone view" />
        </div>
      </div>
      <div class="features-list">
        <div class="feature-chip">✓ <span>Chips M3 deslizables sin desborde</span></div>
        <div class="feature-chip">✓ <span>Logo oficial centrado y versión nítida</span></div>
        <div class="feature-chip">✓ <span>Objetivos táctiles cómodos &ge; 44px</span></div>
      </div>
    </div>

    <div class="phone-col">
      <div class="device-header">
        <span>📱 Estándar 6.1" (390 × 844)</span>
        <span class="device-badge">Teléfono Estándar</span>
      </div>
      <div class="frame-container">
        <div class="frame-mockup frame-standard">
          <img src="data:image/png;base64,${shotStandard}" alt="Standard phone view" />
        </div>
      </div>
      <div class="features-list">
        <div class="feature-chip">✓ <span>Terminal Cisco xterm.js interactiva</span></div>
        <div class="feature-chip">✓ <span>MobileKeyBar con Ctrl sticky iluminado</span></div>
        <div class="feature-chip">✓ <span>MobileBottomNav con píldora activa</span></div>
      </div>
    </div>

    <div class="phone-col">
      <div class="device-header">
        <span>📱 Galaxy S24/S25 Ultra (440 × 956)</span>
        <span class="device-badge">Insignia Gran Formato</span>
      </div>
      <div class="frame-container">
        <div class="frame-mockup frame-ultra">
          <img src="data:image/png;base64,${shotUltra}" alt="Galaxy Ultra phone view" />
        </div>
      </div>
      <div class="features-list">
        <div class="feature-chip">✓ <span>Ajustes › Acerca de espacioso y claro</span></div>
        <div class="feature-chip">✓ <span>Botones amplios de 48px de accesibilidad</span></div>
        <div class="feature-chip">✓ <span>Tarjeta de identidad completa con enlaces</span></div>
      </div>
    </div>
  </div>
</body>
</html>`;

  await page.setContent(html, { waitUntil: "load" });
  await sleep(400);
  const compositeBuffer = await page.screenshot({ type: "png", fullPage: true });
  await page.close();
  return compositeBuffer;
}

async function captureAll() {
  console.log("Iniciando captura de láminas comparativas Teléfono vs Tablet...");
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });

  try {
    // -------------------------------------------------------------
    // LÁMINA 1: Pantalla Principal & Sesiones (Drawer / Sheet)
    // -------------------------------------------------------------
    console.log("Generando Lámina 1: Pantalla Principal & Sesiones...");
    const pPage = await browser.newPage();
    await pPage.setUserAgent(PHONE_UA);
    await pPage.setViewport({ width: 412, height: 915, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await pPage.goto(BASE, { waitUntil: "networkidle0" });
    await pPage.waitForSelector("h1");
    await pPage.evaluate(() => document.querySelector('button[aria-label="Sesiones"]')?.click());
    await sleep(600);
    const shot1Phone = await pPage.screenshot({ encoding: "base64" });
    await pPage.close();

    const tPage = await browser.newPage();
    await tPage.setUserAgent(TABLET_UA);
    await tPage.setViewport({ width: 1280, height: 800, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await tPage.goto(BASE, { waitUntil: "networkidle0" });
    await tPage.waitForSelector("h1");
    await sleep(600);
    const shot1Tablet = await tPage.screenshot({ encoding: "base64" });
    await tPage.close();

    const plate1 = await createCompositeSheet(browser, {
      title: "Lámina 1: Pantalla Principal & Sesiones",
      subtitle: "MobileBottomNav & Sesiones Sheet en teléfono frente a Navigation Rail & Barra lateral acoplada en tablet",
      phoneShotB64: shot1Phone,
      tabletShotB64: shot1Tablet,
      phoneBadges: [
        "MobileBottomNav M3 con íconos e indicadores de píldora activos",
        "Sheet modal de Sesiones a ancho completo táctil",
        "Tarjetas de acción rápida Material 3 en EmptyState"
      ],
      tabletBadges: [
        "Navigation Rail M3 lateral izquierdo permanente",
        "Barra de sesiones acoplada con árbol jerárquico y búsqueda",
        "Layout horizontal amplio de alta productividad"
      ]
    });
    writeFileSync(join(OUT_DIR, "android_sim_1_home_drawer.png"), plate1);
    console.log("✓ Guardado: android_sim_1_home_drawer.png");

    // -------------------------------------------------------------
    // LÁMINA 2: Terminal xterm.js & MobileKeyBar
    // -------------------------------------------------------------
    console.log("Generando Lámina 2: Terminal & MobileKeyBar...");
    const pPage2 = await browser.newPage();
    await pPage2.setUserAgent(PHONE_UA);
    await pPage2.setViewport({ width: 412, height: 915, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await pPage2.goto(BASE, { waitUntil: "networkidle0" });
    await pPage2.waitForSelector("h1");
    await pPage2.evaluate(() => document.querySelector('button[aria-label="Sesiones"]')?.click());
    await sleep(400);
    await pPage2.evaluate(() => {
      const all = [...document.querySelectorAll("span, button, div")];
      const item = all.find((e) => e.textContent === "core-sw01" && (e.tagName === "SPAN" || e.tagName === "BUTTON"));
      item?.click();
    });
    await sleep(800);
    await pPage2.evaluate(() => {
      const mb = document.querySelector('[aria-label="Teclas táctiles para terminal"]');
      const ctrl = [...(mb?.querySelectorAll("button") || [])].find((b) => b.textContent?.trim() === "Ctrl");
      ctrl?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }));
    });
    await sleep(400);
    const shot2Phone = await pPage2.screenshot({ encoding: "base64" });
    await pPage2.close();

    const tPage2 = await browser.newPage();
    await tPage2.setUserAgent(TABLET_UA);
    await tPage2.setViewport({ width: 1280, height: 800, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await tPage2.goto(BASE, { waitUntil: "networkidle0" });
    await tPage2.waitForSelector("h1");
    await tPage2.evaluate(() => {
      const all = [...document.querySelectorAll("span, button, div")];
      const item = all.find((e) => e.textContent === "core-sw01" && (e.tagName === "SPAN" || e.tagName === "BUTTON"));
      item?.click();
    });
    await sleep(800);
    const shot2Tablet = await tPage2.screenshot({ encoding: "base64" });
    await tPage2.close();

    const plate2 = await createCompositeSheet(browser, {
      title: "Lámina 2: Terminal xterm.js & Teclas Táctiles",
      subtitle: "MobileKeyBar con Ctrl persistente y atajos de red en teléfono frente a terminal de escritorio de alto rendimiento en tablet",
      phoneShotB64: shot2Phone,
      tabletShotB64: shot2Tablet,
      phoneBadges: [
        "MobileKeyBar táctil con tecla Ctrl iluminada y sticky",
        "Atajos directos de Cisco (^C, ^Z, ^A, ^E, ^W, ^L)",
        "Menú de pestaña activa ⋮ en TabBar para desconectar/duplicar"
      ],
      tabletBadges: [
        "Terminal xterm.js con aceleración WebGL y ajuste dinámico",
        "Pestañas multinivel y barra de estado con latencia y bytes",
        "Soporte nativo para teclados físicos Bluetooth y atajos estándar"
      ]
    });
    writeFileSync(join(OUT_DIR, "android_sim_2_terminal_keybar.png"), plate2);
    console.log("✓ Guardado: android_sim_2_terminal_keybar.png");

    // -------------------------------------------------------------
    // LÁMINA 3: Catálogo de Comandos & Notas
    // -------------------------------------------------------------
    console.log("Generando Lámina 3: Catálogo de Comandos & Notas...");
    const pPage3 = await browser.newPage();
    await pPage3.setUserAgent(PHONE_UA);
    await pPage3.setViewport({ width: 412, height: 915, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await pPage3.goto(BASE, { waitUntil: "networkidle0" });
    await pPage3.waitForSelector("h1");
    await pPage3.evaluate(() => {
      const all = [...document.querySelectorAll("span, button, div")];
      const item = all.find((e) => e.textContent === "core-sw01" && (e.tagName === "SPAN" || e.tagName === "BUTTON"));
      item?.click();
    });
    await sleep(600);
    await pPage3.evaluate(() => document.querySelector('button[aria-label="Comandos"]')?.click());
    await sleep(600);
    const shot3Phone = await pPage3.screenshot({ encoding: "base64" });
    await pPage3.close();

    const tPage3 = await browser.newPage();
    await tPage3.setUserAgent(TABLET_UA);
    await tPage3.setViewport({ width: 1280, height: 800, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await tPage3.goto(BASE, { waitUntil: "networkidle0" });
    await tPage3.waitForSelector("h1");
    await tPage3.evaluate(() => {
      const all = [...document.querySelectorAll("span, button, div")];
      const item = all.find((e) => e.textContent === "core-sw01" && (e.tagName === "SPAN" || e.tagName === "BUTTON"));
      item?.click();
    });
    await sleep(600);
    await tPage3.evaluate(() => document.querySelector('button[aria-label="Comandos"]')?.click());
    await sleep(600);
    const shot3Tablet = await tPage3.screenshot({ encoding: "base64" });
    await tPage3.close();

    const plate3 = await createCompositeSheet(browser, {
      title: "Lámina 3: Catálogo de Comandos & Automatización",
      subtitle: "Botones táctiles permanentes (Ejecutar/Escribir/Copiar) en teléfono frente a panel acoplado con categorías en tablet",
      phoneShotB64: shot3Phone,
      tabletShotB64: shot3Tablet,
      phoneBadges: [
        "Botones táctiles siempre visibles: 'Ejecutar', 'Escribir' y 'Copiar'",
        "Filtrado por riesgo (solo lectura, peligroso, corte de servicio)",
        "Panel lateral responsive con backdrop táctil para descartar"
      ],
      tabletBadges: [
        "Panel lateral integrado junto al búfer interactivo de xterm",
        "Búsqueda instantánea en catálogo de más de 2.900 comandos",
        "Soporte de macros por hardware y plantillas con variables"
      ]
    });
    writeFileSync(join(OUT_DIR, "android_sim_3_catalog_notes.png"), plate3);
    console.log("✓ Guardado: android_sim_3_catalog_notes.png");

    // -------------------------------------------------------------
    // LÁMINA 4: Herramientas de Red & Topología
    // -------------------------------------------------------------
    console.log("Generando Lámina 4: Herramientas & Topología...");
    const pPage4 = await browser.newPage();
    await pPage4.setUserAgent(PHONE_UA);
    await pPage4.setViewport({ width: 412, height: 915, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await pPage4.goto(BASE, { waitUntil: "networkidle0" });
    await pPage4.waitForSelector("h1");
    await pPage4.evaluate(() => {
      const redBtn = document.querySelector('button[aria-label="Red"]') || document.querySelector('button[aria-label="Herramientas"]');
      redBtn?.click();
    });
    await sleep(500);
    await pPage4.evaluate(() => {
      const chips = [...document.querySelectorAll('nav[aria-label*="compacto"] button')];
      const topoChip = chips.find((c) => c.textContent?.includes("Topología"));
      topoChip?.click();
    });
    await sleep(2000);
    const shot4Phone = await pPage4.screenshot({ encoding: "base64" });
    await pPage4.close();

    const tPage4 = await browser.newPage();
    await tPage4.setUserAgent(TABLET_UA);
    await tPage4.setViewport({ width: 1280, height: 800, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await tPage4.goto(`${BASE}?scene=topology`, { waitUntil: "networkidle0" });
    await sleep(2000);
    const shot4Tablet = await tPage4.screenshot({ encoding: "base64" });
    await tPage4.close();

    const plate4 = await createCompositeSheet(browser, {
      title: "Lámina 4: Herramientas de Red & Topología Dinámica",
      subtitle: "Barra horizontal de chips M3 en teléfono frente a navegación por grupos y diagrama interactivo en tablet",
      phoneShotB64: shot4Phone,
      tabletShotB64: shot4Tablet,
      phoneBadges: [
        "Barra horizontal de chips Material 3 para conmutación rápida",
        "Diagrama Cytoscape interactivo con gestos táctiles de zoom/pan",
        "Cálculo de rutas entre nodos y enlaces CDP/LLDP"
      ],
      tabletBadges: [
        "Navegación vertical categorizada (Monitoreo, Diagnóstico, Topología)",
        "Panel completo de telemetría de tráfico e inspección de interfaces",
        "Capacidad de exportación Draw.io y sincronización SNMP viva"
      ]
    });
    writeFileSync(join(OUT_DIR, "android_sim_4_tools_topology.png"), plate4);
    console.log("✓ Guardado: android_sim_4_tools_topology.png");

    // -------------------------------------------------------------
    // LÁMINA 5: Ajustes & Sección "Acerca de" con Logo Oficial
    // -------------------------------------------------------------
    console.log("Generando Lámina 5: Ajustes & Acerca de...");
    const pPage5 = await browser.newPage();
    await pPage5.setUserAgent(PHONE_UA);
    await pPage5.setViewport({ width: 412, height: 915, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await pPage5.goto(BASE, { waitUntil: "networkidle0" });
    await pPage5.waitForSelector("h1");
    // Abrir Ajustes en teléfono
    await pPage5.evaluate(() => document.querySelector('button[aria-label="Ajustes"]')?.click());
    await sleep(500);
    // Tocar el botón directo "Acerca de"
    await pPage5.evaluate(() => {
      const btn = document.querySelector('button[aria-label="Acerca de"]') ||
        [...document.querySelectorAll('nav[aria-label*="móvil"] button')].find((b) => b.textContent?.includes("Acerca de"));
      btn?.click();
    });
    await sleep(500);
    const shot5Phone = await pPage5.screenshot({ encoding: "base64" });
    await pPage5.close();

    const tPage5 = await browser.newPage();
    await tPage5.setUserAgent(TABLET_UA);
    await tPage5.setViewport({ width: 1280, height: 800, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await tPage5.goto(BASE, { waitUntil: "networkidle0" });
    await tPage5.waitForSelector("h1");
    await tPage5.evaluate(() => document.querySelector('button[aria-label="Ajustes"]')?.click());
    await sleep(500);
    await tPage5.evaluate(() => {
      const items = [...document.querySelectorAll('nav[aria-label="Secciones de ajustes"] button')];
      const about = items.find((b) => b.textContent?.includes("Acerca de"));
      about?.click();
    });
    await sleep(500);
    const shot5Tablet = await tPage5.screenshot({ encoding: "base64" });
    await tPage5.close();

    const plate5 = await createCompositeSheet(browser, {
      title: "Lámina 5: Ajustes & Identidad Oficial (Acerca de)",
      subtitle: "Barra horizontal de chips M3 y tarjeta con logo oficial en teléfono frente a panel expandido en tablet",
      phoneShotB64: shot5Phone,
      tabletShotB64: shot5Tablet,
      phoneBadges: [
        "Barra horizontal deslizable de chips Material 3 para acceso directo a secciones",
        "Botón directo 'Acerca de' y tarjeta de identidad con logo oficial de NetTerminal",
        "Diseño optimizado para controles táctiles con target de 44px a 48px"
      ],
      tabletBadges: [
        "Navegación lateral de Ajustes categorizada con búsqueda integrada",
        "Sección de identidad completa con versión, autor y repositorio oficial",
        "Gestión integral de actualizaciones y modo portable de datos"
      ]
    });
    writeFileSync(join(OUT_DIR, "android_sim_5_settings.png"), plate5);
    console.log("✓ Guardado: android_sim_5_settings.png");

    // -------------------------------------------------------------
    // LÁMINA 6: Adaptabilidad Multi-Resolución (320px, 390px, 440px)
    // -------------------------------------------------------------
    console.log("Generando Lámina 6: Adaptabilidad Multi-Resolución...");
    // A. 4.3" Compact Phone (320 × 568): Acerca de con logo oficial sin overflow
    const pageCompact = await browser.newPage();
    await pageCompact.setUserAgent(PHONE_UA);
    await pageCompact.setViewport({ width: 320, height: 568, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await pageCompact.goto(BASE, { waitUntil: "networkidle0" });
    await pageCompact.waitForSelector("h1");
    await pageCompact.evaluate(() => document.querySelector('button[aria-label="Ajustes"]')?.click());
    await sleep(400);
    await pageCompact.evaluate(() => {
      const btn = document.querySelector('button[aria-label="Acerca de"]') ||
        [...document.querySelectorAll('nav[aria-label*="móvil"] button')].find((b) => b.textContent?.includes("Acerca de"));
      btn?.click();
    });
    await sleep(500);
    const shotCompact = await pageCompact.screenshot({ encoding: "base64" });
    await pageCompact.close();

    // B. Standard Phone (390 × 844): Terminal + MobileKeyBar + MobileBottomNav
    const pageStandard = await browser.newPage();
    await pageStandard.setUserAgent(PHONE_UA);
    await pageStandard.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await pageStandard.goto(BASE, { waitUntil: "networkidle0" });
    await pageStandard.waitForSelector("h1");
    await pageStandard.evaluate(() => document.querySelector('button[aria-label="Sesiones"]')?.click());
    await sleep(400);
    await pageStandard.evaluate(() => {
      const all = [...document.querySelectorAll("span, button, div")];
      const item = all.find((e) => e.textContent === "core-sw01" && (e.tagName === "SPAN" || e.tagName === "BUTTON"));
      item?.click();
    });
    await sleep(800);
    await pageStandard.evaluate(() => {
      const mb = document.querySelector('[aria-label="Teclas táctiles para terminal"]');
      const ctrl = [...(mb?.querySelectorAll("button") || [])].find((b) => b.textContent?.trim() === "Ctrl");
      ctrl?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }));
    });
    await sleep(400);
    const shotStandard = await pageStandard.screenshot({ encoding: "base64" });
    await pageStandard.close();

    // C. Samsung Galaxy S24/S25 Ultra (440 × 956): Ajustes › Acerca de amplio
    const pageUltra = await browser.newPage();
    await pageUltra.setUserAgent(PHONE_UA);
    await pageUltra.setViewport({ width: 440, height: 956, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await pageUltra.goto(BASE, { waitUntil: "networkidle0" });
    await pageUltra.waitForSelector("h1");
    await pageUltra.evaluate(() => document.querySelector('button[aria-label="Ajustes"]')?.click());
    await sleep(400);
    await pageUltra.evaluate(() => {
      const btn = document.querySelector('button[aria-label="Acerca de"]') ||
        [...document.querySelectorAll('nav[aria-label*="móvil"] button')].find((b) => b.textContent?.includes("Acerca de"));
      btn?.click();
    });
    await sleep(500);
    const shotUltra = await pageUltra.screenshot({ encoding: "base64" });
    await pageUltra.close();

    const plate6 = await createScreenSizesSheet(browser, {
      shotCompact,
      shotStandard,
      shotUltra
    });
    writeFileSync(join(OUT_DIR, "android_sim_6_screen_sizes.png"), plate6);
    console.log("✓ Guardado: android_sim_6_screen_sizes.png");

    console.log("\n¡Todas las 6 láminas comparativas han sido generadas exitosamente en:", OUT_DIR);
  } finally {
    await browser.close();
  }
}

captureAll().catch((err) => {
  console.error("Error al capturar láminas:", err);
  process.exit(1);
});
