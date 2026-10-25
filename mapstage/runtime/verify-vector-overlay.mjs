/**
 * Verify the OpenFreeMap vector water + road overlay in the main tuner:
 *   - the `openmaptiles` source and the vl-water* / vl-waterway* / vl-* road layers exist
 *   - layer order: above satellite + hillshade, below region-mask / region-outline
 *   - real features render at Beijing (water + waterway + transportation)
 *   - showWater / showRoads (the 图层 switches) flip layer visibility
 *   - the optional water pack (water-data.js) is never requested
 *   - isolate (island clip and legacy mask) leaves no vector water / road outside the region
 *
 * Usage: node runtime/verify-vector-overlay.mjs [baseUrl]   (default http://127.0.0.1:8765)
 * Needs network access to tiles.openfreemap.org. Screenshots: <repo>/out/vector-overlay/
 */
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, GL_ARGS } from './lib/pw.mjs';
import { isolateMode, openTunerPanel } from './lib/tuner-ui.mjs';

const BASE = (process.argv[2] || 'http://127.0.0.1:8765').replace(/\/$/, '');
const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'out', 'vector-overlay');
mkdirSync(outDir, { recursive: true });

const failures = [];
function check(ok, msg, extra) {
  console.log((ok ? 'PASS ' : 'FAIL ') + msg + (extra !== undefined ? ' ' + JSON.stringify(extra) : ''));
  if (!ok) failures.push(msg);
}

const browser = await chromium.launch({ headless: true, args: GL_ARGS });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const requests = [];
page.on('request', (r) => requests.push(r.url()));
page.on('pageerror', (e) => {
  console.log('PAGEERROR', e.message);
  failures.push('pageerror: ' + e.message);
});

async function idle(timeoutMs = 25000) {
  await page.evaluate(
    (t) => window.AntiqueMapFx.waitIdle(window.__tunerMap, { timeoutMs: t, force: true }),
    timeoutMs
  );
  await page.waitForTimeout(400);
}

async function jump(cam) {
  await page.evaluate((c) => window.__tunerMap.jumpTo(c), cam);
  await idle();
}

await page.goto(BASE + '/?vector-overlay=' + Date.now(), { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => !!window.__tunerMap, null, { timeout: 60000 });
// start from the shipped defaults, not whatever a previous run left in localStorage
await page.evaluate(() => {
  try {
    localStorage.removeItem('china-antique-maplibre-tuner-v1');
  } catch (e) { /* ignore */ }
});
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!window.__tunerMap && window.__tunerMap.getLayer('region-mask-fill'), null, {
  timeout: 60000,
});

// --- structure --------------------------------------------------------------
const structure = await page.evaluate(() => {
  const map = window.__tunerMap;
  const layers = map.getStyle().layers;
  const ids = layers.map((l) => l.id);
  // 配色分区的底图层（vl-relief + 地表分类）在山影之下，不属于水系 / 道路叠层
  const isBase = (l) => l.id === 'vl-relief' || ['landcover', 'landuse', 'park'].includes(l['source-layer']);
  const vl = layers.filter((l) => l.source === 'openmaptiles' && !isBase(l));
  const base = layers.filter((l) => l.source === 'openmaptiles' && isBase(l));
  return {
    hasSource: !!map.getSource('openmaptiles'),
    sourceType: map.getSource('openmaptiles') && map.getSource('openmaptiles').type,
    water: vl.filter((l) => /^vl-water/.test(l.id)).map((l) => l.id),
    roads: vl.filter((l) => l['source-layer'] === 'transportation').map((l) => l.id),
    sourceLayers: Array.from(new Set(vl.map((l) => l['source-layer']))),
    firstVl: Math.min(...vl.map((l) => ids.indexOf(l.id))),
    lastVl: Math.max(...vl.map((l) => ids.indexOf(l.id))),
    hillshade: ids.indexOf('hillshade'),
    baseTop: base.length ? Math.max(...base.map((l) => ids.indexOf(l.id))) : -1,
    baseBottom: base.length ? Math.min(...base.map((l) => ids.indexOf(l.id))) : -1,
    satellite: ids.indexOf('satellite'),
    mask: ids.indexOf('region-mask-fill'),
    seal: ids.indexOf('region-edge-seal'),
    outline: ids.indexOf('region-outline'),
    attribution: (document.getElementById('attribution-note') || {}).textContent || '',
    showRoads: window.__tunerMap && document.getElementById('btn-roads') && document.getElementById('btn-roads').classList.contains('active'),
  };
});
check(structure.hasSource && structure.sourceType === 'vector', 'openmaptiles vector source exists');
check(structure.water.length >= 4 && structure.water.includes('vl-water') && structure.water.includes('vl-waterway'), 'water layers exist', structure.water);
check(structure.roads.length >= 8 && structure.roads.includes('vl-highway') && structure.roads.includes('vl-rail'), 'road layers exist', structure.roads);
check(
  structure.sourceLayers.every((s) => ['water', 'waterway', 'transportation'].includes(s)),
  'only water / waterway / transportation source-layers (no labels, buildings, landcover)',
  structure.sourceLayers
);
check(
  structure.baseTop < 0 || (structure.baseBottom > structure.satellite && structure.baseTop < structure.hillshade),
  'palette base layers (relief / landcover) sit between satellite and hillshade',
  { baseBottom: structure.baseBottom, baseTop: structure.baseTop, hillshade: structure.hillshade }
);
check(
  structure.firstVl > structure.hillshade && structure.hillshade >= 0 && structure.firstVl > structure.satellite,
  'overlay sits above satellite + hillshade',
  { firstVl: structure.firstVl, hillshade: structure.hillshade, satellite: structure.satellite }
);
check(
  structure.lastVl < structure.mask && structure.lastVl < structure.seal && structure.lastVl < structure.outline,
  'overlay sits below region-mask / edge-seal / outline',
  { lastVl: structure.lastVl, mask: structure.mask, seal: structure.seal, outline: structure.outline }
);
check(/OpenFreeMap/.test(structure.attribution) && /OpenStreetMap/.test(structure.attribution), 'attribution note credits OpenFreeMap / OSM', structure.attribution);
check(structure.showRoads === true, 'road switch defaults to on');

// --- real features at Beijing --------------------------------------------------
await jump({ center: [116.55, 40.05], zoom: 9.6, pitch: 0, bearing: 0 });
await page.screenshot({ path: join(outDir, '01-beijing-z9.6.png') });
const feats = await page.evaluate(() => {
  const map = window.__tunerMap;
  const count = (layers) => {
    const list = layers.filter((id) => map.getLayer(id));
    return map.queryRenderedFeatures({ layers: list }).length;
  };
  const ids = map.getStyle().layers.filter((l) => l.source === 'openmaptiles');
  const bySource = (sl) => ids.filter((l) => l['source-layer'] === sl).map((l) => l.id);
  const seen = {};
  map.queryRenderedFeatures({ layers: ids.map((l) => l.id) }).forEach((f) => {
    seen[f.sourceLayer] = (seen[f.sourceLayer] || 0) + 1;
  });
  return { seen, water: count(bySource('water')), waterway: count(bySource('waterway')), roads: count(bySource('transportation')) };
});
check(feats.water > 0, 'water polygons rendered near Beijing', feats.water);
check(feats.waterway > 0, 'waterway lines rendered near Beijing', feats.waterway);
check(feats.roads > 0, 'transportation lines rendered near Beijing', feats.roads);

// --- toggles --------------------------------------------------------------------
const vis = () =>
  page.evaluate(() => {
    const map = window.__tunerMap;
    const v = (l) => map.getLayoutProperty(l.id, 'visibility');
    const layers = map.getStyle().layers.filter((l) => l.source === 'openmaptiles');
    const water = layers.filter((l) => /^vl-water/.test(l.id)).map(v);
    const roads = layers.filter((l) => l['source-layer'] === 'transportation').map(v);
    const uniform = (a) => (a.every((x) => x === a[0]) ? a[0] : 'mixed');
    return {
      water: uniform(water),
      roads: uniform(roads),
      uiWater: JSON.parse(localStorage.getItem('china-antique-maplibre-tuner-v1') || '{}').ui,
      btnWater: document.getElementById('btn-water').classList.contains('active'),
      btnRoads: document.getElementById('btn-roads').classList.contains('active'),
    };
  });

let s = await vis();
check(s.water === 'visible' && s.roads === 'visible', 'water and roads visible by default', s);
check(s.btnWater && s.btnRoads, 'water / roads switches show on by default');

await openTunerPanel(page);
await page.click('#btn-water');
s = await vis();
check(s.water === 'none' && s.roads === 'visible', 'btn-water hides water only', s);
check(!s.btnWater, 'btn-water switch turns off');
await page.click('#btn-roads');
s = await vis();
check(s.water === 'none' && s.roads === 'none', 'btn-roads hides roads', s);
check(!s.btnRoads, 'btn-roads switch turns off');
await idle();
const offCount = await page.evaluate(() => {
  const map = window.__tunerMap;
  const layers = map.getStyle().layers.filter((l) => l.source === 'openmaptiles').map((l) => l.id);
  return map.queryRenderedFeatures({ layers }).length;
});
check(offCount === 0, 'nothing renders from openmaptiles with both off', offCount);
await page.screenshot({ path: join(outDir, '02-beijing-both-off.png') });

await page.click('#btn-water');
s = await vis();
check(s.water === 'visible' && s.roads === 'none', 'btn-water shows water again', s);
await page.click('#btn-roads');
s = await vis();
check(s.water === 'visible' && s.roads === 'visible', 'btn-roads shows roads again', s);
await idle();
await page.screenshot({ path: join(outDir, '03-beijing-both-on-again.png') });

// showRoads round-trips through the persisted state
await page.click('#btn-roads');
await page.waitForTimeout(500);
const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('china-antique-maplibre-tuner-v1') || '{}').ui);
check(stored && stored.showRoads === false, 'showRoads persists to localStorage', stored && stored.showRoads);
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!window.__tunerMap && window.__tunerMap.getLayer('region-mask-fill'), null, { timeout: 60000 });
s = await vis();
check(s.roads === 'none' && s.water === 'visible' && !s.btnRoads, 'roads stay off after reload', s);
await openTunerPanel(page);
await page.click('#btn-roads');
s = await vis();
check(s.roads === 'visible', 'roads back on', s);

// --- water panel colors / widths reach the vector layers --------------------------
const paintBefore = await page.evaluate(() => {
  const map = window.__tunerMap;
  return {
    fill: map.getPaintProperty('vl-water', 'fill-color'),
    river: map.getPaintProperty('vl-waterway', 'line-color'),
    width: JSON.stringify(map.getPaintProperty('vl-waterway', 'line-width')),
  };
});
const paintAfter = await page.evaluate(async () => {
  const map = window.__tunerMap;
  const out = {};
  const range = document.querySelector('.ctrl[data-key="water.riverL1Width"] input[type="range"]');
  out.hasSlider = !!range;
  if (range) {
    range.value = String(Math.min(Number(range.max) || 10, Number(range.value) * 2));
    range.dispatchEvent(new Event('input', { bubbles: true }));
  }
  await new Promise((r) => setTimeout(r, 400));
  out.width = JSON.stringify(map.getPaintProperty('vl-waterway', 'line-width'));
  return out;
});
check(paintBefore.width !== paintAfter.width, 'riverL1Width slider rescales vl-waterway line-width', {
  before: paintBefore.width,
  after: paintAfter.width,
  hasSlider: paintAfter.hasSlider,
});
check(/50,\s*118,\s*138/.test(paintBefore.fill), 'vl-water fill-color follows water.lakeFill by default', paintBefore.fill);

// --- water pack stays off -----------------------------------------------------------
check(!requests.some((u) => /water-data\.js/.test(u)), 'water-data.js is never requested');
check(requests.some((u) => /tiles\.openfreemap\.org/.test(u)), 'OpenFreeMap tiles are requested');

// --- isolate: no vector water / road outside the region --------------------------
/**
 * Screenshots the isolated region with the overlay on and off, then counts pixels that
 * differ between the two at points that lie outside the region (unproject + point-in-polygon,
 * every probe within an 8 px ring must be outside too). The void outside is flat, so any
 * difference there is vector water/road leaking through the clip.
 */
async function isolateLeak(label, forceMask) {
  const p = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await p.goto(BASE + '/?vector-isolate=' + label + Date.now(), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await p.waitForFunction(() => !!window.__tunerMap && window.__tunerMap.getLayer('region-mask-fill'), null, { timeout: 60000 });
  await p.evaluate(() => {
    try { localStorage.removeItem('china-antique-maplibre-tuner-v1'); } catch (e) { /* ignore */ }
  });
  await p.reload({ waitUntil: 'domcontentloaded' });
  await p.waitForFunction(() => !!window.__tunerMap && window.__tunerMap.getLayer('region-mask-fill'), null, { timeout: 60000 });
  if (forceMask) await p.evaluate(() => { window.AntiqueTerrainIsland.patched = () => false; });
  await openTunerPanel(p);
  await p.evaluate(() => {
    const sel = document.getElementById('isolate-region');
    sel.value = 'beijing';
    sel.dispatchEvent(new Event('change'));
  });
  await p.locator('#btn-isolate').evaluate((el) => el.click());
  await p.waitForTimeout(1500);
  // close the panel so the map canvas is unobstructed, then frame Beijing flat
  await p.evaluate(() => {
    const t = document.getElementById('btn-tuner');
    if (t && !document.getElementById('panel').classList.contains('collapsed')) t.click();
    window.__tunerMap.jumpTo({ center: [116.4, 40.2], zoom: 7.6, pitch: 0, bearing: 0 });
  });
  await p.evaluate(() => window.AntiqueMapFx.waitIdle(window.__tunerMap, { timeoutMs: 25000, force: true }));
  await p.waitForTimeout(1500);
  const mode = await isolateMode(p);
  const shotOn = join(outDir, `10-isolate-${label}-overlay-on.png`);
  const shotOff = join(outDir, `11-isolate-${label}-overlay-off.png`);
  // the map sits below the Studio top bar, so shoot exactly the canvas: pixel (x, y) is then canvas (x, y)
  const clip = await p.evaluate(() => {
    const r = window.__tunerMap.getCanvas().getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) };
  });
  const bufOn = await p.screenshot({ path: shotOn, clip });
  await p.evaluate(() => {
    document.getElementById('btn-water').click();
    document.getElementById('btn-roads').click();
  });
  await p.evaluate(() => window.AntiqueMapFx.waitIdle(window.__tunerMap, { timeoutMs: 25000, force: true }));
  await p.waitForTimeout(1500);
  const bufOff = await p.screenshot({ path: shotOff, clip });
  // pixel compare in the page (decode both PNGs on a canvas)
  const res = await p.evaluate(
    async ([a, b]) => {
      const load = (b64) =>
        new Promise((res, rej) => {
          const img = new Image();
          img.onload = () => res(img);
          img.onerror = rej;
          img.src = 'data:image/png;base64,' + b64;
        });
      const [ia, ib] = await Promise.all([load(a), load(b)]);
      const data = (img) => {
        const c = document.createElement('canvas');
        c.width = img.width;
        c.height = img.height;
        const g = c.getContext('2d');
        g.drawImage(img, 0, 0);
        return g.getImageData(0, 0, c.width, c.height).data;
      };
      const da = data(ia);
      const db = data(ib);
      const map = window.__tunerMap;
      const api = window.REGION_ISOLATE;
      const region = api.findRegion(window.REGION_ISOLATE_DATA, 'beijing');
      let feat = region && region.feature;
      if (feat && typeof api.narrativeFeature === 'function') feat = api.narrativeFeature(feat) || feat;
      if (!feat) return { error: 'no beijing isolate feature' };
      const canvas = map.getCanvas();
      const sx = ia.width / canvas.clientWidth;
      const sy = ia.height / canvas.clientHeight;
      const inside = (x, y) => {
        const ll = map.unproject([x, y]);
        return api.pointInFeature(ll.lng, ll.lat, feat);
      };
      // page chrome (rails, switches, attribution) legitimately differs between the two shots
      const chrome = Array.from(
        document.querySelectorAll('#scene-rail, #chrome, #panel, #map-status, .maplibregl-ctrl')
      ).map((el) => el.getBoundingClientRect());
      const cr = canvas.getBoundingClientRect();
      // the MapLibre attribution box also shrinks when no OpenFreeMap layer is visible
      const onChrome = (x, y) => y > canvas.clientHeight - 60 || chrome.some((r) => x + cr.left >= r.left - 4 && x + cr.left <= r.right + 4 && y + cr.top >= r.top - 4 && y + cr.top <= r.bottom + 4);
      const ring = [[0, 0], [8, 0], [-8, 0], [0, 8], [0, -8], [6, 6], [-6, 6], [6, -6], [-6, -6]];
      let outside = 0;
      let leaks = 0;
      let insideDiff = 0;
      const samples = [];
      const step = 3;
      for (let y = 4; y < canvas.clientHeight - 4; y += step) {
        for (let x = 4; x < canvas.clientWidth - 4; x += step) {
          const i = (Math.round(y * sy) * ia.width + Math.round(x * sx)) * 4;
          const d =
            Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]);
          if (onChrome(x, y)) continue;
          const differs = d > 24;
          if (inside(x, y)) {
            if (differs) insideDiff += 1;
            continue;
          }
          if (ring.some(([dx, dy]) => inside(x + dx, y + dy))) continue;
          outside += 1;
          if (differs) {
            leaks += 1;
            if (samples.length < 8) samples.push([x, y, d]);
          }
        }
      }
      return { outside, leaks, insideDiff, samples };
    },
    [bufOn.toString('base64'), bufOff.toString('base64')]
  );
  await p.close();
  return { mode, ...res };
}

const island = await isolateLeak('island', false);
console.log('island', JSON.stringify(island));
check(island.mode === 'island', 'isolate runs as island clip', island.mode);
check(!island.error && island.insideDiff > 20, 'overlay is visible inside the isolated region (island)', island.insideDiff);
check(!island.error && island.leaks === 0, 'no vector water / roads outside the region (island)', island);

const mask = await isolateLeak('mask', true);
console.log('mask', JSON.stringify(mask));
check(mask.mode === 'mask', 'isolate runs as legacy mask', mask.mode);
check(!mask.error && mask.insideDiff > 20, 'overlay is visible inside the isolated region (mask)', mask.insideDiff);
check(!mask.error && mask.leaks === 0, 'no vector water / roads outside the region (mask)', mask);

await browser.close();
if (failures.length) {
  console.error('verify-vector-overlay FAILED:\n  - ' + failures.join('\n  - '));
  process.exit(1);
}
console.log('verify-vector-overlay ok');
