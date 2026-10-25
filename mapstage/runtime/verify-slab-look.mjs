import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from './lib/pw.mjs';

const BASE = (process.argv[2] || 'http://127.0.0.1:8765').replace(/\/$/, '');
const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'out', 'fx-verify');
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=gl-egl', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const logs = [];
page.on('pageerror', (err) => logs.push(String(err.message || err)));

async function shot(name) {
  const cdp = await page.context().newCDPSession(page);
  const png = await cdp.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(outDir, name + '.png'), Buffer.from(png.data, 'base64'));
}

await page.goto(BASE + '/index.html?slab=' + Date.now(), {
  waitUntil: 'domcontentloaded',
  timeout: 60000,
});
await page.waitForFunction(() => !!window.__tunerMap, null, { timeout: 60000 });
await page.evaluate(() => {
  try { localStorage.removeItem('china-antique-maplibre-tuner-v1'); } catch (e) {}
});
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!window.__tunerMap, null, { timeout: 60000 });
await page.evaluate(() =>
  window.AntiqueMapFx.waitIdle(window.__tunerMap, { timeoutMs: 20000, force: true })
);

await page.evaluate(() => {
  const b = [...document.querySelectorAll('#scene-list .scene-item')].find(
    (el) => el.getAttribute('data-scene') === 'isolate-china'
  );
  if (b) b.click();
});
await page.waitForTimeout(2500);
await page.evaluate(() =>
  window.AntiqueMapFx.waitIdle(window.__tunerMap, { timeoutMs: 20000, force: true })
);
await shot('slab-china');

await page.evaluate(() => {
  const sel = document.getElementById('isolate-region');
  sel.value = 'gansu';
  sel.dispatchEvent(new Event('change'));
});
await page.waitForTimeout(2000);
await page.evaluate(() =>
  window.AntiqueMapFx.waitIdle(window.__tunerMap, { timeoutMs: 20000, force: true })
);
await page.evaluate(() => {
  window.AntiqueMapFx.jumpTo(window.__tunerMap, {
    center: [103.2, 35.6],
    zoom: 6.8,
    pitch: 52,
    bearing: 16,
  });
});
await page.waitForTimeout(1500);
await page.evaluate(() =>
  window.AntiqueMapFx.waitIdle(window.__tunerMap, { timeoutMs: 15000, force: true })
);
await shot('slab-gansu-inlet');

const shaderErrs = logs.filter((l) => /compile|link|redefinition/i.test(l));
console.log('shaderErrs', shaderErrs);
if (shaderErrs.length) {
  console.error('FAIL shaders', shaderErrs);
  await browser.close();
  process.exit(1);
}
await browser.close();
console.log('slab shots ok');
