import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from './lib/pw.mjs';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'out', 'fx-verify');
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=gl-egl', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('http://127.0.0.1:8766/?risebtn=' + Date.now(), {
  waitUntil: 'domcontentloaded',
  timeout: 60000,
});
await page.waitForFunction(() => !!window.__tunerMap, null, { timeout: 60000 });
await page.evaluate(() =>
  window.AntiqueMapFx.waitIdle(window.__tunerMap, { timeoutMs: 20000, force: true })
);
await page.locator('#btn-terrain-rise').evaluate((el) => el.click());
await page.waitForFunction(
  () => {
    const map = window.__tunerMap;
    if (!map) return false;
    const t = map.getTerrain && map.getTerrain();
    return (
      map.getZoom() > 10.3 &&
      map.getPitch() > 68 &&
      t &&
      Number(t.exaggeration) >= 1.5
    );
  },
  null,
  { timeout: 25000 }
);
await page.evaluate(() =>
  window.AntiqueMapFx.waitIdle(window.__tunerMap, { timeoutMs: 12000, force: true })
);
await page.waitForTimeout(600);
const info = await page.evaluate(() => {
  const map = window.__tunerMap;
  const t = map.getTerrain && map.getTerrain();
  return {
    pitch: map.getPitch(),
    zoom: map.getZoom(),
    bearing: map.getBearing(),
    maxPitch: map.getMaxPitch ? map.getMaxPitch() : null,
    center: [map.getCenter().lng, map.getCenter().lat],
    terrain: t,
    fxStatus: (document.getElementById('st-fx') || {}).textContent || null,
  };
});
await page.screenshot({ path: join(outDir, '36-rise-button.png') });
console.log(JSON.stringify(info, null, 2));
await browser.close();
