import assert from 'node:assert/strict';
import { chromium } from './lib/pw.mjs';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
try {
  const base = (process.argv[2] || 'http://127.0.0.1:8766').replace(/\/$/, '');
  await page.goto(base + '/?t=' + Date.now(), {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await page.waitForFunction(() => !!window.__tunerMap, null, { timeout: 60000 });
  await page.evaluate(() =>
    window.AntiqueMapFx.waitIdle(window.__tunerMap, { timeoutMs: 12000, force: true })
  );
  await page.evaluate(() => {
    window.AntiqueMapFx.jumpTo(window.__tunerMap, {
      center: [100.45, 37.92],
      zoom: 8.2,
      pitch: 52,
      bearing: -20,
    });
  });
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    const el = document.querySelector('[data-key="terrainExaggeration"] input[type="range"]');
    el.value = '1.66';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(400);
  const r = await page.evaluate(() => {
    const t = window.__tunerMap.getTerrain();
    return {
      ex: t && t.exaggeration,
      zoom: window.__tunerMap.getZoom(),
      pitch: window.__tunerMap.getPitch(),
    };
  });
  console.log(JSON.stringify(r));
  assert.ok(r.ex >= 1.6, 'close-up slider must not LOD-cap tuner bulge');
} finally {
  await browser.close();
}
