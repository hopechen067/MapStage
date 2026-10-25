import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from './lib/pw.mjs';

const BASE = (process.argv[2] || 'http://127.0.0.1:8768').replace(/\/$/, '');
const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'out', 'fx-verify');
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=gl-egl', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(BASE + '/?showcase=' + Date.now(), {
  waitUntil: 'domcontentloaded',
  timeout: 60000,
});
await page.evaluate(() => {
  try { localStorage.removeItem('china-antique-maplibre-tuner-v1'); } catch (e) {}
});
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!window.__tunerMap, null, { timeout: 60000 });
await page.evaluate(() =>
  window.AntiqueMapFx.waitIdle(window.__tunerMap, { timeoutMs: 20000, force: true })
);

async function shot(name) {
  await page.waitForTimeout(800);
  await page.evaluate(() =>
    window.AntiqueMapFx.waitIdle(window.__tunerMap, { timeoutMs: 12000, force: true })
  );
  await page.screenshot({ path: join(outDir, name) });
}

const chrome = await page.evaluate(() => ({
  hasSeg: !!document.getElementById('viewmode-seg'),
  scenes: document.querySelectorAll('#scene-list .scene-item').length,
}));
console.log('shell', JSON.stringify(chrome));
// The tuner panel is expanded by default on wide screens (new design), so its state is not checked.
if (!chrome.hasSeg || chrome.scenes < 6) {
  throw new Error('showcase shell missing: ' + JSON.stringify(chrome));
}

await shot('90-showcase-map-china.png');

await page.click('#viewmode-seg button[data-mode="globe"]');
await page.waitForTimeout(1200);
const globe = await page.evaluate(() => {
  const map = window.__tunerMap;
  const p = map.getProjection && map.getProjection();
  return { type: p && p.type, zoom: map.getZoom() };
});
console.log('globe', JSON.stringify(globe));
if (globe.type && globe.type !== 'globe') {
  throw new Error('expected globe projection, got ' + globe.type);
}
await shot('91-showcase-globe.png');

await page.click('.scene-item[data-scene="isolate-china"]');
await page.waitForTimeout(1500);
await shot('92-showcase-globe-isolate.png');

await page.click('#viewmode-seg button[data-mode="map"]');
await page.waitForTimeout(400);
await page.click('.scene-item[data-scene="beijing"]');
await page.waitForTimeout(1600);
await shot('93-showcase-map-beijing.png');

const beijing = await page.evaluate(() => {
  const map = window.__tunerMap;
  const p = map.getProjection && map.getProjection();
  return {
    type: p && p.type,
    isolate: document.getElementById('btn-isolate').classList.contains('active'),
    region: document.getElementById('isolate-region').value,
  };
});
console.log('beijing', JSON.stringify(beijing));
if (beijing.region !== 'beijing') throw new Error('beijing scene not applied');

await browser.close();
