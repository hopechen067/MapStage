import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from './lib/pw.mjs';
import { isolateMode, openTunerPanel } from './lib/tuner-ui.mjs';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'out', 'fx-verify');
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=gl-egl', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const BASE = (process.argv[2] || 'http://127.0.0.1:8766').replace(/\/$/, '');
await page.goto(BASE + '/?isolate-rise=' + Date.now(), {
  waitUntil: 'domcontentloaded',
  timeout: 60000,
});
await page.waitForFunction(() => !!window.__tunerMap, null, { timeout: 60000 });
await page.evaluate(() =>
  window.AntiqueMapFx.waitIdle(window.__tunerMap, { timeoutMs: 20000, force: true })
);

await openTunerPanel(page);
await page.locator('#btn-isolate').evaluate((el) => el.click());
await page.waitForTimeout(400);
const afterIsolate = await page.evaluate(() => {
  const map = window.__tunerMap;
  const t = map.getTerrain && map.getTerrain();
  const mask = map.getLayer('region-mask-fill')
    ? map.getLayoutProperty('region-mask-fill', 'visibility')
    : null;
  return {
    terrain: t,
    maskVis: mask,
    isolateBtn: document.getElementById('btn-isolate').classList.contains('active'),
  };
});

await page.locator('#btn-terrain-rise').evaluate((el) => el.click());
await page.waitForFunction(
  () => {
    const map = window.__tunerMap;
    return map && map.getZoom() < 5 && map.getPitch() >= 45;
  },
  null,
  { timeout: 15000 }
);
await page.waitForTimeout(800);
await page.evaluate(() =>
  window.AntiqueMapFx.waitIdle(window.__tunerMap, { timeoutMs: 12000, force: true })
);
await page.waitForTimeout(500);

const afterRise = await page.evaluate(() => {
  const map = window.__tunerMap;
  const t = map.getTerrain && map.getTerrain();
  const c = map.getCenter();
  let elev = null;
  try {
    elev = map.queryTerrainElevation([c.lng, c.lat], { exaggerated: true });
  } catch (e) {
    elev = 'err';
  }
  return {
    terrain: t,
    zoom: map.getZoom(),
    pitch: map.getPitch(),
    center: [c.lng, c.lat],
    elev: elev,
    fxStatus: (document.getElementById('st-fx') || {}).textContent || null,
    maskVis: map.getLayer('region-mask-fill')
      ? map.getLayoutProperty('region-mask-fill', 'visibility')
      : null,
  };
});

await page.screenshot({ path: join(outDir, '40-isolate-rise.png') });
writeFileSync(
  join(outDir, 'isolate-rise.json'),
  JSON.stringify({ afterIsolate, afterRise }, null, 2)
);
console.log(JSON.stringify({ afterIsolate, afterRise }, null, 2));

if (!afterIsolate.terrain || afterIsolate.terrain.exaggeration == null) {
  throw new Error('isolate flattened terrain');
}
if (!afterRise.terrain || Number(afterRise.terrain.exaggeration) < 1.5) {
  throw new Error('rise did not keep exaggeration');
}
// isolate renders as a terrain-mesh clip ('island'); the overlay mask stays hidden
if ((await isolateMode(page)) === 'off') {
  throw new Error('isolate not applied after rise (no island clip, no mask)');
}

await page.evaluate(() => window.__studioShowTab('isolate'));
await page.selectOption('#isolate-region', 'zhangye');
await page.waitForTimeout(400);
await page.locator('#btn-terrain-rise').evaluate((el) => el.click());
await page.waitForFunction(
  () => {
    const map = window.__tunerMap;
    return map && map.getZoom() > 6 && map.getPitch() >= 54;
  },
  null,
  { timeout: 15000 }
);
await page.waitForTimeout(800);
const afterCity = await page.evaluate(() => {
  const map = window.__tunerMap;
  const t = map.getTerrain && map.getTerrain();
  const c = map.getCenter();
  let elev = null;
  try {
    elev = map.queryTerrainElevation([c.lng, c.lat], { exaggerated: true });
  } catch (e) {
    elev = 'err';
  }
  return {
    terrain: t,
    zoom: map.getZoom(),
    pitch: map.getPitch(),
    center: [c.lng, c.lat],
    elev: elev,
    region: document.getElementById('isolate-region').value,
    maskVis: map.getLayer('region-mask-fill')
      ? map.getLayoutProperty('region-mask-fill', 'visibility')
      : null,
  };
});
await page.screenshot({ path: join(outDir, '41-isolate-zhangye-rise.png') });
writeFileSync(
  join(outDir, 'isolate-rise.json'),
  JSON.stringify({ afterIsolate, afterRise, afterCity }, null, 2)
);
console.log(JSON.stringify({ afterIsolate, afterRise, afterCity }, null, 2));
if (!afterCity.terrain || Number(afterCity.terrain.exaggeration) < 1.5) {
  throw new Error('city isolate lost terrain');
}
if ((await isolateMode(page)) === 'off' || afterCity.region !== 'zhangye') {
  throw new Error('city isolate clip/region mismatch');
}

await browser.close();
