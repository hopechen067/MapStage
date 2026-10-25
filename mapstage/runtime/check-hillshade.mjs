/**
 * Inspect whether hillshade is hidden (layout, paint, source, order).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadPlaywright } from './lib/pw.mjs';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'out', 'fx-verify');
mkdirSync(outDir, { recursive: true });
const base = (process.argv[2] || 'http://127.0.0.1:8766').replace(/\/$/, '');
const { chromium } = loadPlaywright();
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

try {
  await page.goto(base + '/?hscheck=' + Date.now(), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => !!window.__tunerMap, null, { timeout: 60000 });
  await page.evaluate(() =>
    window.AntiqueMapFx.waitIdle(window.__tunerMap, { timeoutMs: 15000, force: true })
  );

  const info = await page.evaluate(() => {
    const map = window.__tunerMap;
    const layer = map.getLayer('hillshade');
    let vis = null;
    try {
      vis = map.getLayoutProperty('hillshade', 'visibility');
    } catch (e) {
      vis = 'err:' + e.message;
    }
    const t = map.getTerrain && map.getTerrain();
    const layers = (map.getStyle().layers || []).map(function (l) {
      return l.id + ':' + l.type + '@' + l.source;
    });
    const shadeSrc = layer && layer.source;
    const src = shadeSrc ? map.getSource(shadeSrc) : null;
    let loaded = null;
    try {
      loaded = map.areTilesLoaded();
    } catch (e2) {
      loaded = null;
    }
    return {
      hasLayer: !!layer,
      layoutVisibility: vis == null ? '(default visible)' : vis,
      paintEx: layer ? map.getPaintProperty('hillshade', 'hillshade-exaggeration') : null,
      paintShadow: layer ? map.getPaintProperty('hillshade', 'hillshade-shadow-color') : null,
      hillshadeSource: shadeSrc || null,
      terrainSource: t ? t.source : null,
      terrainEx: t ? t.exaggeration : null,
      maskVis: (function () {
        try {
          return map.getLayoutProperty('region-mask-fill', 'visibility');
        } catch (e4) {
          return null;
        }
      })(),
      isolateOn: (function () {
        try {
          const raw = localStorage.getItem('china-antique-maplibre-tuner-v1');
          if (!raw) return false;
          const j = JSON.parse(raw);
          return !!(j && j.ui && j.ui.showRegionIsolate);
        } catch (e0) {
          return false;
        }
      })(),
      satelliteOp: map.getLayer('satellite')
        ? map.getPaintProperty('satellite', 'raster-opacity')
        : null,
      tilesLoaded: loaded,
      layers: layers,
      storageHillEx: (function () {
        try {
          const raw = localStorage.getItem('china-antique-maplibre-tuner-v1');
          if (!raw) return null;
          const j = JSON.parse(raw);
          return j && j.maplibre && j.maplibre.hillshade ? j.maplibre.hillshade.exaggeration : null;
        } catch (e3) {
          return 'parse-error';
        }
      })(),
    };
  });

  await page.screenshot({ path: join(outDir, '14-hillshade-check.png') });

  const hidden =
    !info.hasLayer ||
    info.layoutVisibility === 'none' ||
    info.paintEx === 0 ||
    info.paintEx === '0';

  writeFileSync(join(outDir, 'hillshade-check.json'), JSON.stringify({ hidden: hidden, info: info }, null, 2));
  console.log(JSON.stringify({ hidden: hidden, info: info }, null, 2));
  if (hidden) process.exitCode = 2;
} finally {
  await browser.close();
}
