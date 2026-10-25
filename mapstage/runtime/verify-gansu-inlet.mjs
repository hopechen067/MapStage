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
page.on('pageerror', (err) => console.error('pageerror', err.message));

await page.goto(BASE + '/index.html?inlet=' + Date.now(), {
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
  const sel = document.getElementById('isolate-region');
  sel.value = 'gansu';
  sel.dispatchEvent(new Event('change'));
  const btn = document.getElementById('btn-isolate');
  if (!btn.classList.contains('active')) btn.click();
});
await page.waitForTimeout(800);
await page.evaluate(() => {
  window.AntiqueMapFx.jumpTo(window.__tunerMap, {
    center: [103.35, 35.55],
    zoom: 7.35,
    pitch: 58,
    bearing: 18,
  });
});
await page.evaluate(() =>
  window.AntiqueMapFx.waitIdle(window.__tunerMap, { timeoutMs: 20000, force: true })
);
await page.waitForTimeout(600);
await page.evaluate(() => {
  if (typeof window.applyTerrainIsland === 'function') window.applyTerrainIsland();
});
await page.evaluate(() =>
  window.AntiqueMapFx.waitIdle(window.__tunerMap, { timeoutMs: 12000, force: true })
);

const cdp = await page.context().newCDPSession(page);
const png = await cdp.send('Page.captureScreenshot', { format: 'png' });
writeFileSync(join(outDir, 'gansu-inlet.png'), Buffer.from(png.data, 'base64'));
const st = await page.evaluate(() => {
  const map = window.__tunerMap;
  const clip = window.__antiqueTerrainClip || {};
  return {
    zoom: map.getZoom(),
    clipOn: !!clip.enabled,
    origin: clip.origin,
    size: clip.size,
  };
});
console.log(JSON.stringify(st));
await browser.close();
console.log('wrote gansu-inlet.png');
