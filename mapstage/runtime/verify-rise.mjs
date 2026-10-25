/**
 * Click 「地形隆起」 and capture start / mid / end stills.
 *   node runtime/verify-rise.mjs http://127.0.0.1:8766
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { loadPlaywright } from './lib/pw.mjs';
import { openTunerPanel } from './lib/tuner-ui.mjs';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'out', 'fx-verify');
mkdirSync(outDir, { recursive: true });
const base = (process.argv[2] || 'http://127.0.0.1:8766').replace(/\/$/, '');

const { chromium } = loadPlaywright();
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

function terrain() {
  return page.evaluate(() => {
    const map = window.__tunerMap;
    const t = map && map.getTerrain && map.getTerrain();
    return {
      ex: t && t.exaggeration != null ? t.exaggeration : null,
      pitch: map ? map.getPitch() : null,
      zoom: map ? map.getZoom() : null,
      count: map ? map.__antiqueSetTerrainCount : 0,
    };
  });
}

// Wait until exaggeration is within [lo, hi] and return the snapshot taken at
// that instant; the rise keeps animating, so re-reading afterwards races it.
async function waitTerrain(lo, hi) {
  const h = await page.waitForFunction(([lo, hi]) => {
    const map = window.__tunerMap;
    const t = map && map.getTerrain && map.getTerrain();
    if (!t || t.exaggeration == null || t.exaggeration < lo || t.exaggeration > hi) return false;
    return {
      ex: t.exaggeration,
      pitch: map.getPitch(),
      zoom: map.getZoom(),
      count: map.__antiqueSetTerrainCount || 0,
    };
  }, [lo, hi], { timeout: 8000 });
  return h.jsonValue();
}

try {
  await page.goto(base + '/?rise=' + Date.now(), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => !!window.__tunerMap, null, { timeout: 60000 });
  await page.evaluate(() =>
    window.AntiqueMapFx.waitIdle(window.__tunerMap, { timeoutMs: 15000, force: true })
  );

  await openTunerPanel(page);
  await page.locator('#btn-terrain-rise').evaluate((el) => el.click());
  await page.waitForFunction(() => {
    const map = window.__tunerMap;
    return map && map.getPitch() >= 42 && map.getZoom() >= 5.2;
  }, null, { timeout: 10000 });

  const start = await waitTerrain(0, 0.25);
  await page.screenshot({ path: join(outDir, '10-rise-start.png') });

  const mid = await waitTerrain(0.7, 1.15);
  await page.screenshot({ path: join(outDir, '11-rise-mid.png') });

  await page.waitForFunction(() => {
    const t = window.__tunerMap && window.__tunerMap.getTerrain && window.__tunerMap.getTerrain();
    return t && t.exaggeration >= 1.5;
  }, null, { timeout: 8000 });
  await page.waitForTimeout(200);
  const end = await terrain();
  await page.screenshot({ path: join(outDir, '12-rise-end.png') });

  assert.ok(start.ex <= 0.25, 'start should be flattened');
  assert.ok(mid.ex > start.ex, 'mid higher than start');
  assert.ok(end.ex >= 1.5, 'end near target');
  assert.ok(end.pitch >= 42, 'pitch raised so mesh is readable');
  assert.ok(end.zoom >= 5.2, 'zoom in from national 4.2');

  const report = { start, mid, end };
  writeFileSync(join(outDir, 'rise-report.json'), JSON.stringify(report, null, 2));
  console.log('verify-rise ok', JSON.stringify(report));
} finally {
  await browser.close();
}
