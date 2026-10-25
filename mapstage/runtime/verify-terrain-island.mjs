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
await page.goto(BASE + '/index.html?island-smoke=' + Date.now(), {
  waitUntil: 'domcontentloaded',
  timeout: 60000,
});
await page.waitForFunction(() => !!window.__tunerMap && !!window.maplibregl, null, { timeout: 60000 });
const boot = await page.evaluate(() => ({
  patched: !!window.__ANTIQUE_TERRAIN_CLIP_PATCH,
  island: !!(window.AntiqueTerrainIsland && window.AntiqueTerrainIsland.patched()),
}));
console.log('boot', JSON.stringify(boot));
if (!boot.patched) {
  console.error('FAIL maplibre patch not loaded');
  await browser.close();
  process.exit(1);
}

await page.evaluate(() => {
  try { localStorage.removeItem('china-antique-maplibre-tuner-v1'); } catch (e) {}
});
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!window.__tunerMap, null, { timeout: 60000 });
await page.evaluate(() =>
  window.AntiqueMapFx.waitIdle(window.__tunerMap, { timeoutMs: 20000, force: true })
);

const timed = await page.evaluate(() => {
  const t0 = performance.now();
  const sel = document.getElementById('isolate-region');
  if (!sel || ![...sel.options].some((o) => o.value === 'gansu')) {
    return { ok: false, reason: 'no-gansu' };
  }
  sel.value = 'gansu';
  sel.dispatchEvent(new Event('change'));
  const btn = document.getElementById('btn-isolate');
  if (!btn) return { ok: false, reason: 'no-btn' };
  if (!btn.classList.contains('active')) btn.click();
  const t1 = performance.now();
  const src = window.__tunerMap && window.__tunerMap.getSource('region-mask');
  let maskFeatures = -1;
  try {
    const ser = src && typeof src.serialize === 'function' ? src.serialize() : null;
    maskFeatures = ser && ser.data && Array.isArray(ser.data.features) ? ser.data.features.length : -1;
  } catch (e) {
    maskFeatures = -2;
  }
  return {
    ok: true,
    active: btn.classList.contains('active'),
    ms: t1 - t0,
    maskFeatures: maskFeatures,
  };
});
console.log('toggle', JSON.stringify(timed));
if (!timed.ok || !timed.active) {
  console.error('FAIL isolate did not turn on', timed);
  await browser.close();
  process.exit(1);
}
if (timed.ms > 4000) {
  console.error('FAIL isolate apply froze the main thread', timed.ms);
  await browser.close();
  process.exit(1);
}
if (timed.maskFeatures > 2) {
  console.error('FAIL island mode still uploaded tiled parchment mask', timed.maskFeatures);
  await browser.close();
  process.exit(1);
}
await page.evaluate(() =>
  window.AntiqueMapFx.waitIdle(window.__tunerMap, { timeoutMs: 20000, force: true })
);

const state = await page.evaluate(() => {
  const map = window.__tunerMap;
  const clip = window.__antiqueTerrainClip || {};
  const api = window.REGION_ISOLATE;
  const Island = window.AntiqueTerrainIsland;
  const region = api.findRegion(window.REGION_ISOLATE_DATA, 'gansu');
  const feat = region && api.narrativeFeature(region.feature);
  const merc = feat ? Island.mercatorBbox(feat) : null;
  let white = 0;
  let total = 0;
  if (feat && merc) {
    const image = Island.rasterizeClip(feat, merc);
    total = image.data.length / 4;
    for (let i = 0; i < image.data.length; i += 4) {
      if (image.data[i] > 128) white++;
    }
  }
  return {
    clipOn: !!clip.enabled,
    hasTex: !!clip.texture,
    origin: clip.origin,
    size: clip.size,
    merc: clip.merc,
    white: white,
    total: total,
    maskVis: map.getLayer('region-mask-fill')
      ? map.getLayoutProperty('region-mask-fill', 'visibility')
      : null,
    walls: !!map.getLayer('region-island-walls'),
    wallCount: map.__antiqueIslandWalls ? map.__antiqueIslandWalls.count : 0,
    last: window.__islandLast || null,
    paperSky: (function () {
      try {
        var sky = map.getSky && map.getSky();
        return sky && (sky['fog-color'] || sky.fogColor || null);
      } catch (e) {
        return null;
      }
    })(),
    bgPaint: map.getLayer('background')
      ? map.getPaintProperty('background', 'background-color')
      : null,
    wrapIsland: !!(document.getElementById('map-wrap') && document.getElementById('map-wrap').classList.contains('is-island')),
    terrain: map.getTerrain && map.getTerrain(),
    region: document.getElementById('isolate-region').value,
    zoom: map.getZoom(),
    pitch: map.getPitch(),
    center: [map.getCenter().lng, map.getCenter().lat],
  };
});
console.log('isolate', JSON.stringify(state));
const cdp = await page.context().newCDPSession(page);
const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
writeFileSync(join(outDir, 'independent-island-gansu.png'), Buffer.from(shot.data, 'base64'));

if (!state.clipOn || !state.hasTex) {
  console.error('FAIL clip not enabled');
  await browser.close();
  process.exit(1);
}
if (state.bgPaint !== '#14110e' || state.paperSky !== '#14110e') {
  console.error('FAIL island void is not dark slab surround', state.bgPaint, state.paperSky);
  await browser.close();
  process.exit(1);
}
if (state.maskVis === 'visible') {
  console.error('FAIL parchment mask still visible in island mode');
  await browser.close();
  process.exit(1);
}

const afterDrag = await page.evaluate(async () => {
  const map = window.__tunerMap;
  const t0 = performance.now();
  const c = map.getCenter();
  map.panBy([120, -80], { duration: 0 });
  if (window.AntiqueMapFx) {
    await window.AntiqueMapFx.waitIdle(map, { timeoutMs: 8000, force: true });
  }
  return {
    ms: performance.now() - t0,
    clipOn: !!(window.__antiqueTerrainClip && window.__antiqueTerrainClip.enabled),
    moved: Math.abs(map.getCenter().lng - c.lng) + Math.abs(map.getCenter().lat - c.lat) > 0.01,
  };
});
console.log('drag', JSON.stringify(afterDrag));
if (afterDrag.ms > 8000 || !afterDrag.clipOn || !afterDrag.moved) {
  console.error('FAIL isolate drag', afterDrag);
  await browser.close();
  process.exit(1);
}

const off = await page.evaluate(() => {
  const t0 = performance.now();
  const btn = document.getElementById('btn-isolate');
  btn.click();
  return {
    ms: performance.now() - t0,
    active: btn.classList.contains('active'),
    clipOn: !!(window.__antiqueTerrainClip && window.__antiqueTerrainClip.enabled),
  };
});
console.log('off', JSON.stringify(off));
if (off.active || off.clipOn || off.ms > 4000) {
  console.error('FAIL isolate off froze or stayed on', off);
  await browser.close();
  process.exit(1);
}

await browser.close();
console.log('island smoke ok');
