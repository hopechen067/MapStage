import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from './lib/pw.mjs';

const BASE = (process.argv[2] || 'http://127.0.0.1:8778').replace(/\/$/, '');
const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'out', 'fx-verify', 'island-rca');
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=gl-egl', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const logs = [];
page.on('pageerror', (err) => logs.push(String(err && err.message ? err.message : err)));
await page.goto(BASE + '/vector-layers.html?isolate=1&region=beijing&smooth=' + Date.now(), {
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
await page.evaluate(() => {
  const demo = window.__vectorDemo;
  if (demo.viewMode !== 'map' && demo.applyProjection) demo.applyProjection('map', { force: true });
  if (demo.isolate && demo.isolate.setRegion) demo.isolate.setRegion('beijing', { frame: true, enable: true });
});
await page.waitForTimeout(2000);
await page.evaluate(() =>
  window.AntiqueMapFx.waitIdle(window.__vectorDemo.map, { timeoutMs: 20000, force: true })
);
await page.evaluate(() => {
  window.AntiqueMapFx.jumpTo(window.__vectorDemo.map, {
    center: [116.4, 40.1],
    zoom: 8.4,
    pitch: 52,
    bearing: 18,
  });
});
await page.waitForTimeout(1200);
await page.evaluate(() =>
  window.AntiqueMapFx.waitIdle(window.__vectorDemo.map, { timeoutMs: 15000, force: true })
);
const cdp = await page.context().newCDPSession(page);
const png = await cdp.send('Page.captureScreenshot', { format: 'png' });
writeFileSync(join(outDir, '06-beijing-smooth.png'), Buffer.from(png.data, 'base64'));
const st = await page.evaluate(() => {
  const map = window.__vectorDemo.map;
  const clip = window.__antiqueTerrainClip || {};
  return {
    clipOn: !!clip.enabled,
    drop: clip.drop,
    wallLayer: !!(map.getLayer && map.getLayer('region-island-walls')),
    zoom: map.getZoom(),
    pitch: map.getPitch(),
    region: window.__vectorDemo.isolate.getState().regionId,
  };
});
console.log(JSON.stringify({ st, logs }));
const shaderErrs = logs.filter((l) => /compile|link|redefinition|syntax/i.test(l));
await browser.close();
if (shaderErrs.length) {
  console.error('FAIL shaders', shaderErrs);
  process.exit(1);
}
console.log('wrote 06-beijing-smooth.png');
