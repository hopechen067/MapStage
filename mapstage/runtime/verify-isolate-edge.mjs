import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from './lib/pw.mjs';
import { isolateMode, openTunerPanel } from './lib/tuner-ui.mjs';

const BASE = (process.argv[2] || 'http://127.0.0.1:8768').replace(/\/$/, '');
const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'out', 'fx-verify');
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=gl-egl', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(BASE + '/?isolate-edge=' + Date.now(), {
  waitUntil: 'domcontentloaded',
  timeout: 60000,
});
await page.waitForFunction(() => !!window.__tunerMap, null, { timeout: 60000 });
await page.evaluate(() => {
  try {
    localStorage.removeItem('china-antique-maplibre-tuner-v1');
  } catch (e) {}
});
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!window.__tunerMap, null, { timeout: 60000 });
await page.evaluate(() =>
  window.AntiqueMapFx.waitIdle(window.__tunerMap, { timeoutMs: 20000, force: true })
);

await openTunerPanel(page);
await page.locator('#btn-isolate').evaluate((el) => el.click());
await page.waitForTimeout(200);
await page.evaluate(() => {
  const sel = document.getElementById('isolate-region');
  sel.value = 'beijing';
  sel.dispatchEvent(new Event('change'));
});
await page.waitForTimeout(800);
await page.evaluate(() =>
  window.AntiqueMapFx.waitIdle(window.__tunerMap, { timeoutMs: 20000, force: true })
);

const isolateModeBefore = await isolateMode(page);
const beforeRise = await page.evaluate(() => {
  const map = window.__tunerMap;
  const t = map.getTerrain && map.getTerrain();
  const seal = map.getLayer('region-edge-seal');
  const src = map.getSource('region-mask');
  const n = src && src._data && src._data.features ? src._data.features.length : 0;
  return {
    region: document.getElementById('isolate-region').value,
    maskVis: map.getLayoutProperty('region-mask-fill', 'visibility'),
    sealVis: seal ? map.getLayoutProperty('region-edge-seal', 'visibility') : null,
    terrain: t,
    zoom: map.getZoom(),
    pitch: map.getPitch(),
    maskFeats: n,
    isolateSrcTol: src && src.workerOptions ? src.workerOptions.geojsonVtOptions : null,
  };
});

await page.locator('#btn-terrain-rise').evaluate((el) => el.click());
await page.waitForFunction(
  () => {
    const map = window.__tunerMap;
    const t = map.getTerrain && map.getTerrain();
    return map && map.getPitch() >= 40 && t && t.exaggeration >= 1.4;
  },
  null,
  { timeout: 20000 }
);
await page.waitForTimeout(1200);
await page.evaluate(() =>
  window.AntiqueMapFx.waitIdle(window.__tunerMap, { timeoutMs: 20000, force: true })
);

const afterRise = await page.evaluate(() => {
  const map = window.__tunerMap;
  const t = map.getTerrain && map.getTerrain();
  const c = map.getCenter();
  return {
    region: document.getElementById('isolate-region').value,
    maskVis: map.getLayoutProperty('region-mask-fill', 'visibility'),
    sealVis: map.getLayer('region-edge-seal')
      ? map.getLayoutProperty('region-edge-seal', 'visibility')
      : null,
    terrain: t,
    zoom: map.getZoom(),
    pitch: map.getPitch(),
    center: [c.lng, c.lat],
  };
});

await page.screenshot({
  path: join(outDir, '82-beijing-isolate-edge.png'),
  clip: { x: 0, y: 0, width: 1060, height: 900 },
});

await page.screenshot({
  path: join(outDir, '82-beijing-isolate-edge-full.png'),
});

await page.evaluate(() => {
  const map = window.__tunerMap;
  const c = map.getCenter();
  map.jumpTo({ center: [c.lng, c.lat], zoom: map.getZoom() + 1.15, pitch: map.getPitch(), bearing: map.getBearing() });
});
await page.waitForTimeout(800);
await page.evaluate(() =>
  window.AntiqueMapFx.waitIdle(window.__tunerMap, { timeoutMs: 15000, force: true })
);
await page.screenshot({
  path: join(outDir, '82-beijing-isolate-edge-close.png'),
  clip: { x: 0, y: 0, width: 1060, height: 900 },
});

await page.evaluate(() => {
  const sel = document.getElementById('isolate-region');
  sel.value = 'tianjin';
  sel.dispatchEvent(new Event('change'));
});
await page.waitForTimeout(800);
await page.evaluate(() =>
  window.AntiqueMapFx.waitIdle(window.__tunerMap, { timeoutMs: 15000, force: true })
);
await page.screenshot({
  path: join(outDir, '83-tianjin-isolate-edge.png'),
  clip: { x: 0, y: 0, width: 1060, height: 900 },
});

console.log(JSON.stringify({ isolateModeBefore, beforeRise, afterRise }, null, 2));

if (beforeRise.region !== 'beijing' || isolateModeBefore === 'off') {
  throw new Error('beijing isolate not on: ' + JSON.stringify(beforeRise));
}
// edge seal overlay only exists in legacy mask mode; island mode seals with mesh walls
if (isolateModeBefore === 'mask' && beforeRise.sealVis !== 'visible') {
  throw new Error('edge seal missing: ' + JSON.stringify(beforeRise));
}
if (!afterRise.terrain || afterRise.terrain.exaggeration < 1.4) {
  throw new Error('terrain not risen: ' + JSON.stringify(afterRise));
}

await browser.close();
