import puppeteer from 'puppeteer-core';
import path from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
const OUT_DIR = '/Users/parzval/.gemini/antigravity/brain/06493bc4-9362-4c7c-9d16-2c1e2bd2ff62';

async function captureEvidence() {
  console.log('Starting evidence capture in simulated Android...');
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();
  await page.setUserAgent(ANDROID_UA);
  await page.setViewport({
    width: 412,
    height: 915,
    deviceScaleFactor: 2.625,
    isMobile: true,
    hasTouch: true
  });

  // 1. android_sim_1_home_drawer.png
  console.log('1. Capturing android_sim_1_home_drawer.png...');
  await page.goto('http://localhost:1430/scripts/screenshots/demo.html', { waitUntil: 'networkidle0' });
  await page.waitForSelector('h1');
  await page.evaluate(() => {
    document.querySelector('button[aria-label="Sesiones"]')?.click();
  });
  await new Promise(r => setTimeout(r, 500));
  const shot1 = path.join(OUT_DIR, 'android_sim_1_home_drawer.png');
  await page.screenshot({ path: shot1 });
  console.log('Saved:', shot1);

  // 2. android_sim_2_terminal_keybar.png
  console.log('2. Capturing android_sim_2_terminal_keybar.png...');
  // Tap session core-sw01 in drawer
  await page.evaluate(() => {
    const all = [...document.querySelectorAll('span, button, div')];
    const item = all.find(e => e.textContent === 'core-sw01' && (e.tagName === 'SPAN' || e.tagName === 'BUTTON'));
    item?.click();
  });
  await new Promise(r => setTimeout(r, 800));

  // Toggle Ctrl button to sticky on state
  await page.evaluate(() => {
    const mb = document.querySelector('[aria-label="Teclas táctiles para terminal"]');
    const ctrl = [...(mb?.querySelectorAll('button') || [])].find(b => b.textContent?.trim() === 'Ctrl');
    ctrl?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
  });
  await new Promise(r => setTimeout(r, 400));
  const shot2 = path.join(OUT_DIR, 'android_sim_2_terminal_keybar.png');
  await page.screenshot({ path: shot2 });
  console.log('Saved:', shot2);

  // 3. android_sim_3_catalog_notes.png
  console.log('3. Capturing android_sim_3_catalog_notes.png...');
  await page.evaluate(() => {
    document.querySelector('button[aria-label="Comandos"]')?.click();
  });
  await new Promise(r => setTimeout(r, 600));
  const shot3 = path.join(OUT_DIR, 'android_sim_3_catalog_notes.png');
  await page.screenshot({ path: shot3 });
  console.log('Saved:', shot3);

  // Close catalog before next
  await page.evaluate(() => {
    document.querySelector('button[aria-label="Comandos"]')?.click();
  });
  await new Promise(r => setTimeout(r, 300));

  // 4. android_sim_4_tools_topology.png
  console.log('4. Capturing android_sim_4_tools_topology.png...');
  // Load demo with topology scene which automatically loads Tools > Topology
  await page.goto('http://localhost:1430/scripts/screenshots/demo.html?scene=topology', { waitUntil: 'networkidle0' });
  await new Promise(r => setTimeout(r, 2000));
  const shot4 = path.join(OUT_DIR, 'android_sim_4_tools_topology.png');
  await page.screenshot({ path: shot4 });
  console.log('Saved:', shot4);

  // 5. android_sim_5_settings.png
  console.log('5. Capturing android_sim_5_settings.png...');
  await page.evaluate(() => {
    document.querySelector('button[aria-label="Ajustes"]')?.click();
  });
  await new Promise(r => setTimeout(r, 500));
  // Click Terminal section
  await page.evaluate(() => {
    const termBtn = [...document.querySelectorAll('button')].find(b => b.title === 'Terminal');
    termBtn?.click();
  });
  await new Promise(r => setTimeout(r, 400));
  // Scroll to MobileKeyBar option
  await page.evaluate(() => {
    const el = [...document.querySelectorAll('div')].find(e => e.textContent?.includes('Barra de teclas táctiles'));
    el?.scrollIntoView({ block: 'center' });
  });
  await new Promise(r => setTimeout(r, 300));
  const shot5 = path.join(OUT_DIR, 'android_sim_5_settings.png');
  await page.screenshot({ path: shot5 });
  console.log('Saved:', shot5);

  console.log('All 5 screenshots successfully saved to:', OUT_DIR);
  await browser.close();
}

captureEvidence().catch(err => {
  console.error('Error capturing evidence:', err);
  process.exit(1);
});
