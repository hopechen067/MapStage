import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from './lib/pw.mjs';

const BASE = (process.argv[2] || 'http://127.0.0.1:8765').replace(/\/$/, '');
const shotDir = process.argv[3] || join(dirname(fileURLToPath(import.meta.url)), '..', 'out', 'fx-verify');
mkdirSync(shotDir, { recursive: true });

const pageErrors = [];
const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=gl-egl', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (err) => pageErrors.push(String(err)));

await page.goto(BASE + '/?perf-gating=' + Date.now(), {
  waitUntil: 'domcontentloaded',
  timeout: 60000,
});
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

const chinaZoom = await page.evaluate(() => window.__tunerMap.getZoom());
console.log('chinaOverviewZoom', chinaZoom);
if (chinaZoom < 4) {
  throw new Error('default China camera should be overview >=4, got ' + chinaZoom);
}

await page.evaluate(() => {
  const map = window.__tunerMap;
  map.setZoom(map.getMinZoom());
});
await page.waitForTimeout(400);
const minZoomState = await page.evaluate(() => {
  const map = window.__tunerMap;
  const p = map.getProjection && map.getProjection();
  return {
    minZoom: map.getMinZoom(),
    zoom: map.getZoom(),
    proj: p && p.type,
  };
});
console.log('minZoom', JSON.stringify(minZoomState));
if (minZoomState.minZoom < 3 - 1e-6) {
  throw new Error('mercator minZoom below China-overview floor: ' + minZoomState.minZoom);
}
if (minZoomState.zoom < 3 - 1e-6) {
  throw new Error('mercator zoomed below floor: ' + minZoomState.zoom);
}
await page.screenshot({ path: join(shotDir, 'perf-map-minzoom.png') });

await page.click('#viewmode-seg button[data-mode="globe"]');
await page.waitForTimeout(800);
const globeState = await page.evaluate(() => {
  const map = window.__tunerMap;
  const p = map.getProjection && map.getProjection();
  return { proj: p && p.type, zoom: map.getZoom(), minZoom: map.getMinZoom() };
});
console.log('globe', JSON.stringify(globeState));
if (globeState.proj && globeState.proj !== 'globe') {
  throw new Error('expected globe, got ' + globeState.proj);
}

await page.click('#viewmode-seg button[data-mode="map"]');
await page.waitForTimeout(800);
const backState = await page.evaluate(() => {
  const map = window.__tunerMap;
  const p = map.getProjection && map.getProjection();
  return { proj: p && p.type, zoom: map.getZoom(), minZoom: map.getMinZoom() };
});
console.log('backToMap', JSON.stringify(backState));
if (backState.proj && backState.proj !== 'mercator') {
  throw new Error('expected mercator after leaving globe');
}
if (backState.zoom < 3 - 1e-6) {
  throw new Error('left globe still at far zoom: ' + backState.zoom);
}

await page.click('.scene-item[data-scene="isolate-china"]');
await page.waitForTimeout(1200);
await page.evaluate(() =>
  window.AntiqueMapFx.waitIdle(window.__tunerMap, { timeoutMs: 15000, force: true })
);
const isolateState = await page.evaluate(() => {
  const api = window.REGION_ISOLATE;
  const china = api.findRegion(window.REGION_ISOLATE_DATA, 'china');
  const feat = api.narrativeFeature(china.feature);
  const mask = window.__tunerMap.getSource('region-mask');
  const n = mask && mask._data && mask._data.features ? mask._data.features.length : -1;
  return {
    hainan: api.pointInFeature(110.35, 19.2, feat),
    taiwan: api.pointInFeature(121.0, 23.7, feat),
    beijing: api.pointInFeature(116.397, 39.909, feat),
    maskN: n,
    isolateBtn: document.getElementById('btn-isolate').classList.contains('active'),
  };
});
console.log('isolateChina', JSON.stringify(isolateState));
if (!isolateState.hainan || !isolateState.taiwan) {
  throw new Error('China isolate missing Hainan/Taiwan');
}
if (!isolateState.beijing) throw new Error('mainland missing from narrative');
if (isolateState.maskN > 50) {
  throw new Error('far/simple China mask still too dense: ' + isolateState.maskN);
}
await page.screenshot({ path: join(shotDir, 'perf-isolate-china.png') });

if (pageErrors.length) {
  throw new Error('pageerrors: ' + pageErrors.join(' | '));
}

await browser.close();
console.log('verify-perf-gating ok');
