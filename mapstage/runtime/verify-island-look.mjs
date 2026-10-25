import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from './lib/pw.mjs';

const BASE = (process.argv[2] || 'http://127.0.0.1:8778').replace(/\/$/, '');
const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'out', 'fx-verify', 'island-look');
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=gl-egl', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const logs = [];
page.on('pageerror', (e) => logs.push('pageerror ' + e.message));
page.on('console', (m) => {
  if (m.type() === 'error') logs.push('error ' + m.text());
});

async function idle() {
  await page.evaluate(() => {
    const map = window.__vectorDemo ? window.__vectorDemo.map : window.__tunerMap;
    return window.AntiqueMapFx.waitIdle(map, { timeoutMs: 20000, force: true });
  });
}
async function shot(name) {
  const cdp = await page.context().newCDPSession(page);
  const png = await cdp.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(outDir, name + '.png'), Buffer.from(png.data, 'base64'));
}

await page.goto(BASE + '/vector-layers.html?isolate=1&region=china&look=' + Date.now(), {
  waitUntil: 'domcontentloaded',
  timeout: 90000,
});
await page.waitForFunction(
  () => !!(window.__vectorDemo && window.__vectorDemo.map && window.__vectorDemo.isolate && window.__vectorDemo.map.loaded()),
  null,
  { timeout: 90000 }
);
await page.evaluate(() => {
  const d = window.__vectorDemo;
  if (d.viewMode !== 'map') d.applyProjection('map', { force: true });
  d.isolate.setRegion('china', { frame: true, enable: true });
});
await page.waitForTimeout(1500);
await idle();
await page.evaluate(() => {
  window.AntiqueMapFx.jumpTo(window.__vectorDemo.map, {
    center: [121.4, 36.8],
    zoom: 7.4,
    pitch: 58,
    bearing: 8,
  });
});
await page.waitForTimeout(1200);
await idle();
await shot('01-vector-shandong');

await page.evaluate(() => {
  window.__vectorDemo.isolate.setRegion('beijing', { frame: true, enable: true });
});
await page.waitForTimeout(1500);
await idle();
await page.evaluate(() => {
  window.AntiqueMapFx.jumpTo(window.__vectorDemo.map, {
    center: [116.4, 40.1],
    zoom: 8.2,
    pitch: 54,
    bearing: 16,
  });
});
await page.waitForTimeout(1000);
await idle();
await shot('02-vector-beijing');

const shaderErrs = logs.filter((l) => /compile|link|redefinition|syntax error/i.test(l));
console.log('logs', logs.slice(0, 20));
console.log('shaderErrs', shaderErrs);
if (shaderErrs.length) {
  await browser.close();
  process.exit(1);
}
await browser.close();
console.log('look shots', outDir);
