// Pruebas automatizadas de regresión móvil (Android 390x844, 412x915 y Tablet 800x1280):
// `node scripts/tests/mobile-ui.test.mjs` (Node 22.15+).
import assert from "node:assert/strict";
import { spawn } from "node:child_process";

// 1. Verificación de lógica de plataforma y User-Agents
const ANDROID_UA = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";
const TABLET_UA = "Mozilla/5.0 (Linux; Android 14; Pixel Tablet) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

const isAndroidUA = (ua) => /Android/i.test(ua);
const isMobileUA = (ua) => /Android|iPhone|iPad|Mobile/i.test(ua);

assert.equal(isAndroidUA(ANDROID_UA), true, "Pixel 8 detectado como Android");
assert.equal(isMobileUA(ANDROID_UA), true, "Pixel 8 detectado como Mobile");
assert.equal(isAndroidUA(TABLET_UA), true, "Pixel Tablet detectado como Android");
assert.equal(isMobileUA(TABLET_UA), true, "Pixel Tablet detectado como Mobile");

console.log("mobile-ui: lógica base OK");

// 2. Verificación en navegador headless real (Puppeteer + Chrome DevTools)
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
let puppeteer;
try {
  puppeteer = (await import("puppeteer-core")).default;
} catch {
  console.log("mobile-ui: puppeteer-core no instalado, omitiendo prueba e2e");
  process.exit(0);
}

// Comprueba si el servidor local de demo está activo
let port = 1430;
let viteProc = null;
const isServerUp = async (p) => {
  try {
    const res = await fetch(`http://localhost:${p}/scripts/screenshots/demo.html`);
    return res.ok;
  } catch {
    return false;
  }
};

if (!(await isServerUp(port))) {
  port = 1438;
  viteProc = spawn("npx", ["vite", "--host", "localhost", "--port", String(port)], {
    stdio: "ignore",
    detached: false
  });
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 200));
    if (await isServerUp(port)) break;
  }
}

try {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });

  // A. Prueba en Teléfono Android (412x915)
  const page = await browser.newPage();
  await page.setUserAgent(ANDROID_UA);
  await page.setViewport({
    width: 412,
    height: 915,
    deviceScaleFactor: 2.625,
    isMobile: true,
    hasTouch: true
  });

  await page.goto(`http://localhost:${port}/scripts/screenshots/demo.html`, { waitUntil: "networkidle0" });
  await page.waitForSelector("h1");

  // EmptyState no desborda horizontalmente y muestra la barra inferior Material 3
  const homeState = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    hasBottomNav: !!document.querySelector('nav[aria-label="Navegación principal móvil"]'),
    hasLeftRail: !!document.querySelector('nav[aria-label="Barra de actividad"]')
  }));
  assert.equal(homeState.overflow, false, "EmptyState no desborda horizontalmente en 412px");
  assert.equal(homeState.hasBottomNav, true, "Teléfono muestra Material 3 Bottom Navigation Bar");
  assert.equal(homeState.hasLeftRail, false, "Teléfono oculta el Navigation Rail lateral de escritorio");

  // Sheet de sesiones: abre a ancho completo en móvil
  await page.evaluate(() => document.querySelector('button[aria-label="Sesiones"]')?.click());
  await new Promise((r) => setTimeout(r, 300));
  const hasSessionsSheet = await page.evaluate(() => !!document.querySelector('input[aria-label*="Filtrar sesiones"]'));
  assert.equal(hasSessionsSheet, true, "Sheet de sesiones abre en móvil");

  // Tocar una sesión abre la terminal y cierra el sheet
  await page.evaluate(() => {
    const all = [...document.querySelectorAll("span, button, div")];
    const item = all.find((e) => e.textContent === "core-sw01" && (e.tagName === "SPAN" || e.tagName === "BUTTON"));
    item?.click();
  });
  await new Promise((r) => setTimeout(r, 600));

  const postClick = await page.evaluate(() => ({
    hasSessionsSheet: !!document.querySelector('input[aria-label*="Filtrar sesiones"]'),
    hasKeyBar: !!document.querySelector('[aria-label="Teclas táctiles para terminal"]'),
    hasTerminal: !!document.querySelector(".xterm"),
    hasTabMoreMenu: !!document.querySelector('button[aria-label="Opciones de la pestaña activa"]')
  }));
  assert.equal(postClick.hasSessionsSheet, false, "Al tocar una sesión el sheet se cierra automáticamente");
  assert.equal(postClick.hasTerminal, true, "Terminal abre correctamente");
  assert.equal(postClick.hasKeyBar, true, "MobileKeyBar se muestra automáticamente en Android");
  assert.equal(postClick.hasTabMoreMenu, true, "TabBar muestra botón ⋮ de opciones de pestaña activa");

  // Botón Ctrl sticky en MobileKeyBar
  await page.evaluate(() => {
    const mb = document.querySelector('[aria-label="Teclas táctiles para terminal"]');
    const ctrl = [...(mb?.querySelectorAll("button") || [])].find((b) => b.textContent?.trim() === "Ctrl");
    ctrl?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, cancelable: true }));
  });
  await new Promise((r) => setTimeout(r, 200));

  const keybarState = await page.evaluate(() => {
    const mb = document.querySelector('[aria-label="Teclas táctiles para terminal"]');
    const buttons = [...(mb?.querySelectorAll("button") || [])].map((b) => b.textContent?.trim() || b.getAttribute("aria-label"));
    const ctrl = buttons.find((b) => b === "Ctrl");
    const hasShortcuts = buttons.includes("^C") && buttons.includes("^Z") && buttons.includes("^A") && buttons.includes("^E");
    return { hasCtrl: !!ctrl, hasShortcuts };
  });
  assert.equal(keybarState.hasShortcuts, true, "Al tocar Ctrl se activa el estado sticky y botones rápidos ^C, ^Z, ^A, ^E");

  // B. Verificar Ajustes › Acerca de (mismo logo oficial de la app, sin funciones exclusivas de escritorio)
  await page.evaluate(() => document.querySelector('button[aria-label="Ajustes"]')?.click());
  await page.waitForSelector('button[aria-label="Acerca de"]');

  const mobilePrunedSettings = await page.evaluate(() => {
    const chips = [...document.querySelectorAll('nav[aria-label="Secciones de ajustes (móvil)"] button')].map((b) =>
      b.textContent?.trim(),
    );
    const bodyText = document.body.textContent ?? "";
    const hasFloatingSidebar = bodyText.includes("Barra de sesiones flotante");
    return {
      hasAiSection: chips.includes("Agentes IA"),
      hasFloatingSidebar,
    };
  });
  assert.equal(mobilePrunedSettings.hasAiSection, false, "Móvil oculta la sección Agentes IA (servidor MCP local de escritorio)");
  assert.equal(mobilePrunedSettings.hasFloatingSidebar, false, "Móvil oculta el ajuste de mouse 'Barra de sesiones flotante'");

  // Verificar que Módulos en móvil no muestre Plugins de Python
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('nav[aria-label="Secciones de ajustes (móvil)"] button')].find(
      (b) => b.textContent?.trim() === "Módulos",
    );
    btn?.click();
  });
  await new Promise((r) => setTimeout(r, 150));
  const hasPythonPluginsModule = await page.evaluate(() =>
    (document.body.textContent ?? "").includes("Extensiones instalables en Python"),
  );
  assert.equal(hasPythonPluginsModule, false, "Móvil oculta el módulo de Plugins en Python en Ajustes › Módulos");

  await page.evaluate(() => document.querySelector('button[aria-label="Acerca de"]')?.click());
  await page.waitForSelector('img[alt="Logo de NetTerminal"]');

  const aboutState = await page.evaluate(() => {
    const img = document.querySelector('img[alt="Logo de NetTerminal"]');
    const rect = img?.getBoundingClientRect();
    return {
      hasLogo: !!img && img.complete && img.naturalWidth > 0,
      width: rect?.width ?? 0,
      height: rect?.height ?? 0,
      hasTitle: document.body.textContent?.includes("NetTerminal") && document.body.textContent?.includes("Nicolás Rivera")
    };
  });
  assert.equal(aboutState.hasLogo, true, "Sección Acerca de carga el logo oficial de la app");
  assert.equal(aboutState.width >= 76 && aboutState.height >= 76, true, "Logo en Acerca de tiene tamaño prominente (>= 76x76px)");
  assert.equal(aboutState.hasTitle, true, "Sección Acerca de muestra información completa sin recortes");

  // Cerrar Ajustes y verificar rendimiento de memoria JS
  await page.evaluate(() => document.querySelector('button[aria-label="Cerrar"]')?.click());
  await new Promise((r) => setTimeout(r, 200));

  const perfMetrics = await page.metrics();
  const jsHeapMb = Math.round((perfMetrics.JSHeapUsedSize / (1024 * 1024)) * 10) / 10;
  assert.equal(jsHeapMb < 45, true, `Uso de memoria JS Heap ligero en móvil (${jsHeapMb} MB < 45 MB)`);

  // C. Prueba en Teléfono Compacto de 4.3" (320x568) y 360x640: cero solapamientos y objetivos táctiles cómodos
  for (const [w, h, label] of [
    [320, 568, "Teléfono 4.3\" (320x568)"],
    [360, 640, "Teléfono compacto (360x640)"],
    [390, 844, "Teléfono estándar (390x844)"],
    [440, 956, "Galaxy Ultra estándar (440x956)"],
    [480, 1040, "Galaxy Ultra ampliado (480x1040)"]
  ]) {
    await page.setViewport({ width: w, height: h, isMobile: true, hasTouch: true });
    await new Promise((r) => setTimeout(r, 200));
    const check = await page.evaluate(() => {
      const overflow = document.documentElement.scrollWidth > document.documentElement.clientWidth;
      const navBtns = [...document.querySelectorAll('nav[aria-label="Navegación principal móvil"] button')];
      const rects = navBtns.map((b) => b.getBoundingClientRect());
      let overlap = false;
      for (let i = 0; i < rects.length - 1; i++) {
        if (rects[i].right > rects[i + 1].left + 1) overlap = true;
      }
      const minHeight = rects.length ? Math.min(...rects.map((r) => r.height)) : 0;
      return { overflow, overlap, minHeight, count: rects.length };
    });
    assert.equal(check.overflow, false, `${label}: sin desborde horizontal`);
    assert.equal(check.overlap, false, `${label}: botones de navegación sin solapamiento`);
    assert.equal(check.minHeight >= 44, true, `${label}: objetivos táctiles >= 44px de alto (actual: ${check.minHeight}px)`);
  }

  // D. Prueba en Tablet Android (800x1280)
  await page.setUserAgent(TABLET_UA);
  await page.setViewport({ width: 800, height: 1280, isMobile: true, hasTouch: true });
  await new Promise((r) => setTimeout(r, 200));
  const tabletState = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    hasLeftRail: !!document.querySelector('nav[aria-label="Barra de actividad"]')
  }));
  assert.equal(tabletState.overflow, false, "Tablet 800x1280 no desborda horizontalmente");
  assert.equal(tabletState.hasLeftRail, true, "Tablet 800x1280 muestra el Navigation Rail lateral");

  await browser.close();
  console.log("mobile-ui OK");
} finally {
  if (viteProc) {
    viteProc.kill();
  }
}
