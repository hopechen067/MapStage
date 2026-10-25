/**
 * Confirm hillshade layer uses a separate DEM source from setTerrain.
 */
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { loadPlaywright } from './lib/pw.mjs';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'out', 'fx-verify');
mkdirSync(outDir, { recursive: true });
const base = (process.argv[2] || 'http://127.0.0.1:8766').replace(/\/$/, '');
const { chromium } = loadPlaywright();
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

try {
  await page.goto(base + '/?hs=' + Date.now(), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => !!window.__tunerMap, null, { timeout: 60000 });
  await page.evaluate(() =>
    window.AntiqueMapFx.waitIdle(window.__tunerMap, { timeoutMs: 15000, force: true })
  );
  const info = await page.evaluate(() => {
    const map = window.__tunerMap;
    const layer = map.getLayer('hillshade');
    const t = map.getTerrain && map.getTerrain();
      const layers = map.getStyle().layers.map((l) => l.id);
      return {
        hillshadeSource: layer && layer.source,
        hillshadeEx: map.getPaintProperty('hillshade', 'hillshade-exaggeration'),
        terrainSource: t && t.source,
        terrainEx: t && t.exaggeration,
        hasShadeDem: !!map.getSource((t && t.source ? t.source : 'terrain') + '-hillshade'),
        order: layers,
      };
  });
  assert.ok(info.hillshadeSource, 'hillshade layer missing');
  assert.ok(info.terrainSource, 'terrain missing');
  assert.notEqual(info.hillshadeSource, info.terrainSource, 'hillshade must not share terrain source id');
  assert.equal(info.hillshadeSource, info.terrainSource + '-hillshade');
  assert.ok(info.hasShadeDem);
  assert.ok(info.hillshadeEx > 0, 'hillshade exaggeration should be on');
  const hi = info.order.indexOf('hillshade');
  const sat = info.order.indexOf('satellite');
  assert.ok(hi > sat, 'hillshade must sit above satellite');
  await page.screenshot({ path: join(outDir, '13-hillshade-idle.png') });
  console.log('hillshade ok', JSON.stringify(info));
} finally {
  await browser.close();
}
