/**
 * Compare Qilian terrain at real elevation 1.0 vs dramatic 1.6.
 *
 *   node runtime/verify-qilian-terrain.mjs http://127.0.0.1:8780
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { loadPlaywright } from './lib/pw.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..');
const base = (process.argv[2] || 'http://127.0.0.1:8780').replace(/\/$/, '');

const { chromium } = loadPlaywright();
const shotDir = process.env.VECTOR_SHOT_DIR || join(repo, 'out', 'fx-verify');
mkdirSync(shotDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const cdp = await page.context().newCDPSession(page);
// Console errors that are environment noise rather than product bugs:
//  - map-tiles.config.local.js is optional and gitignored, so its 404 is expected when the file is absent;
//  - maplibre-gl prints a slow tile request as console.error(Error('timed out')); the text is just "Error".
// Anything else still fails the run.
async function isEnvNoise(msg) {
  const text = msg.text();
  if (/Failed to load resource/.test(text) && /\b404\b/.test(text) &&
      /map-tiles\.config\.local\.js/.test(msg.location().url || '')) return true;
  if (text === 'Error' || /timed out/.test(text)) {
    const detail = await Promise.all(msg.args().map((a) =>
      a.evaluate((v) => (v && v.message) || String(v)).catch(() => '')
    )).then((xs) => xs.join(' '));
    return /timed out/.test(text + ' ' + detail);
  }
  return false;
}
const errors = [];
const consoleChecks = [];
page.on('pageerror', function (err) { errors.push(String(err && err.message || err)); });
page.on('console', function (msg) {
  if (msg.type() !== 'error') return;
  const text = msg.text();
  consoleChecks.push(isEnvNoise(msg).then(function (noise) {
    if (!noise) errors.push('console:' + text);
  }));
});

await page.goto(base + '/vector-layers.html?v=' + Date.now(), {
  waitUntil: 'domcontentloaded',
  timeout: 60000,
});
await page.waitForFunction(function () {
  var d = window.__vectorDemo;
  return d && d.map && typeof d.map.getLayer === 'function' && d.map.getLayer('vl-hillshade');
}, null, { timeout: 45000 });

await page.click('.scene-item[data-scene="qilian"]');
await page.waitForFunction(function () {
  var d = window.__vectorDemo;
  if (!d || !d.map || typeof d.map.queryTerrainElevation !== 'function') return false;
  var c = d.map.getCenter();
  var raw = d.map.queryTerrainElevation([c.lng, c.lat], { exaggerated: false });
  return typeof raw === 'number' && raw > 500;
}, null, { timeout: 60000 });

async function snap(ex, name) {
  // setTerrainExUi only queues the change (applied on the next UI flush), so wait for it to land
  await page.evaluate(function (target) { window.__vectorDemo.setTerrainExUi(target); }, ex);
  await page.waitForFunction(function (target) {
    var t = window.__vectorDemo.map.getTerrain();
    return !!t && Math.abs(Number(t.exaggeration) - target) < 0.06;
  }, ex, { timeout: 15000 }).catch(function () { /* the assertions below report the value */ });
  const info = await page.evaluate(function (target) {
    var d = window.__vectorDemo;
    var t = d.map.getTerrain && d.map.getTerrain();
    var c = d.map.getCenter();
    var elev = null;
    try {
      if (typeof d.map.queryTerrainElevation === 'function') {
        elev = {
          exaggerated: d.map.queryTerrainElevation([c.lng, c.lat], { exaggerated: true }),
          raw: d.map.queryTerrainElevation([c.lng, c.lat], { exaggerated: false }),
        };
      }
    } catch (e) { /* DEM may still be loading */ }
    return {
      ui: d.terrainEx,
      applied: t && t.exaggeration,
      zoom: d.map.getZoom(),
      pitch: d.map.getPitch(),
      center: [c.lng, c.lat],
      elev: elev,
    };
  }, ex);
  await page.waitForTimeout(1800);
  const file = join(shotDir, name);
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  writeFileSync(file, Buffer.from(shot.data, 'base64'));
  return { info: info, file: file };
}

const real = await snap(1, 'vector-layers-qilian-real-1.0.png');
const drama = await snap(1.6, 'vector-layers-qilian-ex-1.6.png');
await Promise.all(consoleChecks); // resolve console filter before the browser (and its message handles) closes
await browser.close();

assert.equal(errors.length, 0, 'page errors: ' + errors.join(' | '));
assert.ok(Math.abs(Number(real.info.applied) - 1) < 0.06, JSON.stringify(real.info));
assert.ok(Math.abs(Number(drama.info.applied) - 1.6) < 0.06, JSON.stringify(drama.info));
assert.ok(real.info.zoom >= 10);
assert.ok(real.info.pitch >= 65);

console.log('QILIAN TERRAIN OK');
console.log(JSON.stringify({ real: real, drama: drama, errors: errors }, null, 2));
