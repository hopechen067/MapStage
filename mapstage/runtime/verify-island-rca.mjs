/**
 * Independent-island RCA: dump clip state, tiles, mask, and cameras.
 *   node runtime/verify-island-rca.mjs [http://127.0.0.1:8765]
 */
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from './lib/pw.mjs';

const BASE = (process.argv[2] || 'http://127.0.0.1:8765').replace(/\/$/, '');
const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'out', 'fx-verify', 'island-rca');
mkdirSync(outDir, { recursive: true });

const FAR = { center: [103.6, 35.2], zoom: 3.85, pitch: 46, bearing: -16 };
const NEAR = { center: [110.0, 22.5], zoom: 5.2, pitch: 72, bearing: 8 };

const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=gl-egl', '--ignore-gpu-blocklist'],
});

function probeFn() {
  const map = window.__tunerMap || (window.__vectorDemo && window.__vectorDemo.map);
  const clip = window.__antiqueTerrainClip || {};
  const Island = window.AntiqueTerrainIsland;
  const iso = window.__vectorDemo && window.__vectorDemo.isolate;
  const st = iso && typeof iso.getState === 'function' ? iso.getState() : null;
  let white = 0;
  let total = 0;
  if (clip._image && clip._image.data) {
    total = clip._image.data.length / 4;
    for (let i = 0; i < clip._image.data.length; i += 4) {
      if (clip._image.data[i] > 128) white++;
    }
  }
  let tiles = [];
  try {
    const terr =
      (map.painter && map.painter.terrain) ||
      (map.painter && map.painter.renderToTexture && map.painter.renderToTexture.terrain);
    const list =
      terr && terr.sourceCache && terr.sourceCache.getRenderableTiles
        ? terr.sourceCache.getRenderableTiles() || []
        : [];
    tiles = list.map((t) => {
      const id = t && t.tileID && t.tileID.canonical;
      if (!id) return null;
      const scale = 1 << id.z;
      return {
        z: id.z,
        x: id.x,
        y: id.y,
        merc: [id.x / scale, id.y / scale, (id.x + 1) / scale, (id.y + 1) / scale],
      };
    }).filter(Boolean);
  } catch (e) {
    tiles = [{ error: String(e && e.message ? e.message : e) }];
  }
  let maskVis = null;
  try {
    maskVis = map.getLayer && map.getLayer('region-mask-fill')
      ? map.getLayoutProperty('region-mask-fill', 'visibility')
      : null;
  } catch (e2) {
    maskVis = 'err';
  }
  let clipPng = null;
  try {
    if (clip._image && typeof document !== 'undefined') {
      const c = document.createElement('canvas');
      c.width = clip._image.width;
      c.height = clip._image.height;
      c.getContext('2d').putImageData(clip._image, 0, 0);
      clipPng = c.toDataURL('image/png');
    }
  } catch (e3) {
    clipPng = null;
  }
  return {
    patched: !!window.__ANTIQUE_TERRAIN_CLIP_PATCH,
    islandApi: !!(Island && Island.patched && Island.patched()),
    clipOn: !!clip.enabled,
    hasTex: !!clip.texture,
    origin: clip.origin || null,
    size: clip.size || null,
    merc: clip.merc || null,
    drop: clip.drop,
    white: white,
    total: total,
    whiteRatio: total ? white / total : null,
    regionId: st ? st.regionId : (document.getElementById('isolate-region') || {}).value || null,
    isolateEnabled: st ? st.enabled : !!(document.getElementById('btn-isolate') && document.getElementById('btn-isolate').classList.contains('active')),
    maskKind: st ? st.maskKind : window.__tunerMaskKind || null,
    maskVis: maskVis,
    wallLayer: !!(map.getLayer && map.getLayer('region-island-walls')),
    wallCount: map.__antiqueIslandWalls ? map.__antiqueIslandWalls.count : 0,
    terrain: map.getTerrain && map.getTerrain(),
    zoom: map.getZoom(),
    pitch: map.getPitch(),
    center: [map.getCenter().lng, map.getCenter().lat],
    meshSize: (function () {
      try {
        const t =
          map.terrain ||
          (map.painter && map.painter.terrain) ||
          (map.painter && map.painter.renderToTexture && map.painter.renderToTexture.terrain);
        return t && t.meshSize;
      } catch (e) {
        return null;
      }
    })(),
    tileCount: tiles.length,
    tiles: tiles,
    last: window.__islandLast || null,
    clipPng: clipPng,
  };
}

async function shot(page, name) {
  const cdp = await page.context().newCDPSession(page);
  const png = await cdp.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(outDir, name + '.png'), Buffer.from(png.data, 'base64'));
}

async function idle(page) {
  await page.evaluate(async () => {
    const map = window.__tunerMap || (window.__vectorDemo && window.__vectorDemo.map);
    if (window.AntiqueMapFx && map) {
      await window.AntiqueMapFx.waitIdle(map, { timeoutMs: 20000, force: true });
    }
  });
}

function writeProbe(name, probe) {
  const { clipPng, ...rest } = probe;
  writeFileSync(join(outDir, name + '.json'), JSON.stringify(rest, null, 2));
  if (clipPng && clipPng.startsWith('data:image/png;base64,')) {
    writeFileSync(join(outDir, name + '-clip.png'), Buffer.from(clipPng.split(',')[1], 'base64'));
  }
}

const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const logs = [];
page.on('pageerror', (err) => logs.push('pageerror ' + String(err && err.message ? err.message : err)));

let probe;
try {
await page.goto(BASE + '/vector-layers.html?isolate=1&region=china&rca=' + Date.now(), {
  waitUntil: 'domcontentloaded',
  timeout: 60000,
});
await page.waitForFunction(
  () => {
    const d = window.__vectorDemo;
    return !!(d && d.map && d.isolate && d.map.loaded && d.map.loaded());
  },
  null,
  { timeout: 90000 }
);
await page.waitForTimeout(1200);
await idle(page);

await page.evaluate(() => {
  const demo = window.__vectorDemo;
  if (demo.viewMode !== 'map' && demo.applyProjection) demo.applyProjection('map', { force: true });
  if (demo.isolate && demo.isolate.setRegion) demo.isolate.setRegion('china', { frame: true, enable: true });
});
await page.waitForTimeout(1500);
await idle(page);

await page.evaluate((cam) => {
  const map = window.__vectorDemo.map;
  window.AntiqueMapFx.jumpTo(map, cam);
}, FAR);
await page.waitForTimeout(800);
await idle(page);
await shot(page, '01-vector-far');
probe = await page.evaluate(probeFn);
writeProbe('01-vector-far', probe);
console.log('01-vector-far', JSON.stringify({
  clipOn: probe.clipOn, whiteRatio: probe.whiteRatio, maskVis: probe.maskVis,
  regionId: probe.regionId, tileCount: probe.tileCount, drop: probe.drop,
  wallLayer: probe.wallLayer, zoom: probe.zoom, pitch: probe.pitch,
}));

await page.evaluate((cam) => {
  window.AntiqueMapFx.jumpTo(window.__vectorDemo.map, cam);
}, NEAR);
await page.waitForTimeout(800);
await idle(page);
await shot(page, '02-vector-near');
probe = await page.evaluate(probeFn);
writeProbe('02-vector-near', probe);
console.log('02-vector-near', JSON.stringify({
  clipOn: probe.clipOn, whiteRatio: probe.whiteRatio, maskVis: probe.maskVis,
  tileCount: probe.tileCount, merc: probe.merc, tiles: probe.tiles,
}));

await page.evaluate(() => {
  const map = window.__vectorDemo.map;
  if (map.getLayer('region-mask-fill')) {
    map.setLayoutProperty('region-mask-fill', 'visibility', 'none');
  }
});
await page.waitForTimeout(400);
await idle(page);
await shot(page, '03-vector-near-maskoff');
probe = await page.evaluate(probeFn);
writeProbe('03-vector-near-maskoff', probe);
console.log('03-maskoff', JSON.stringify({ maskVis: probe.maskVis, tileCount: probe.tileCount }));
} catch (err) {
  logs.push('vector-layers ' + String(err && err.message ? err.message : err));
  console.warn('vector-layers rca skipped', err && err.message ? err.message : err);
}

const page2 = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page2.on('pageerror', (err) => logs.push('idx ' + String(err && err.message ? err.message : err)));
await page2.goto(BASE + '/index.html?island-rca=' + Date.now(), {
  waitUntil: 'domcontentloaded',
  timeout: 60000,
});
await page2.waitForFunction(() => !!window.__tunerMap, null, { timeout: 60000 });
await page2.evaluate(() => {
  try { localStorage.removeItem('china-antique-maplibre-tuner-v1'); } catch (e) {}
});
await page2.reload({ waitUntil: 'domcontentloaded' });
await page2.waitForFunction(() => !!window.__tunerMap, null, { timeout: 60000 });
await idle(page2);
await page2.evaluate(() => {
  const b = [...document.querySelectorAll('#scene-list .scene-item')].find(
    (el) => el.getAttribute('data-scene') === 'isolate-china'
  );
  if (b) b.click();
});
await page2.waitForTimeout(2200);
await idle(page2);
await page2.waitForFunction(
  () => !!(window.__tunerMap && window.__tunerMap.getLayer && window.__tunerMap.getLayer('region-island-walls')),
  null,
  { timeout: 15000 }
).catch(() => {});
await page2.evaluate((cam) => window.AntiqueMapFx.jumpTo(window.__tunerMap, cam), FAR);
await page2.waitForTimeout(800);
await idle(page2);
await shot(page2, '04-index-far');
probe = await page2.evaluate(probeFn);
writeProbe('04-index-far', probe);
console.log('04-index-far', JSON.stringify({
  clipOn: probe.clipOn, whiteRatio: probe.whiteRatio, maskVis: probe.maskVis,
  tileCount: probe.tileCount, drop: probe.drop, wallLayer: probe.wallLayer,
}));

await page2.evaluate((cam) => window.AntiqueMapFx.jumpTo(window.__tunerMap, cam), NEAR);
await page2.waitForTimeout(800);
await idle(page2);
await shot(page2, '05-index-near');
probe = await page2.evaluate(probeFn);
writeProbe('05-index-near', probe);
console.log('05-index-near', JSON.stringify({
  clipOn: probe.clipOn, whiteRatio: probe.whiteRatio, tileCount: probe.tileCount,
  drop: probe.drop, wallLayer: probe.wallLayer, wallCount: probe.wallCount, tiles: probe.tiles,
}));

writeFileSync(join(outDir, 'logs.json'), JSON.stringify({ logs }, null, 2));
const far = JSON.parse(readFileSync(join(outDir, '04-index-far.json'), 'utf8'));
if (!far.clipOn || !far.hasTex) {
  console.error('FAIL clip not enabled', far);
  await browser.close();
  process.exit(1);
}
if (!(far.drop > 0)) {
  console.error('FAIL clip.drop should pull outside verts down', far.drop);
  await browser.close();
  process.exit(1);
}
if (far.maskVis === 'visible') {
  console.error('FAIL parchment mask still visible', far.maskVis);
  await browser.close();
  process.exit(1);
}
if (far.wallLayer) {
  console.error('FAIL second contour wall still present', { wallLayer: far.wallLayer, wallCount: far.wallCount });
  await browser.close();
  process.exit(1);
}
await browser.close();
console.log('rca shots', outDir);
