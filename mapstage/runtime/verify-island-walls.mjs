import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from './lib/pw.mjs';

const BASE = (process.argv[2] || 'http://127.0.0.1:8765').replace(/\/$/, '');
const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'out', 'fx-verify', 'wall-edge');
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=gl-egl', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const logs = [];
page.on('pageerror', (err) => logs.push(String(err.message || err)));

async function shot(name) {
  const cdp = await page.context().newCDPSession(page);
  const png = await cdp.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(outDir, name + '.png'), Buffer.from(png.data, 'base64'));
}

async function idle() {
  await page.evaluate(() =>
    window.AntiqueMapFx.waitIdle(window.__tunerMap, { timeoutMs: 20000, force: true })
  );
}

await page.goto(BASE + '/index.html?walls=' + Date.now(), {
  waitUntil: 'domcontentloaded',
  timeout: 60000,
});
await page.waitForFunction(() => !!window.__tunerMap, null, { timeout: 60000 });
await page.evaluate(() => {
  try { localStorage.removeItem('china-antique-maplibre-tuner-v1'); } catch (e) {}
});
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!window.__tunerMap, null, { timeout: 60000 });
await idle();

await page.evaluate(() => {
  const b = [...document.querySelectorAll('#scene-list .scene-item')].find(
    (el) => el.getAttribute('data-scene') === 'isolate-china'
  );
  if (b) b.click();
});
await page.waitForTimeout(2200);
await idle();
await shot('01-china-overview');

await page.evaluate(() => {
  window.AntiqueMapFx.jumpTo(window.__tunerMap, {
    center: [121.4, 36.8],
    zoom: 7.4,
    pitch: 58,
    bearing: 28,
  });
});
await page.waitForTimeout(1400);
await idle();
await shot('02-shandong-rim');

await page.evaluate(() => {
  const sel = document.getElementById('isolate-region');
  sel.value = 'gansu';
  sel.dispatchEvent(new Event('change'));
});
await page.waitForTimeout(1800);
await page.evaluate(() => {
  window.AntiqueMapFx.jumpTo(window.__tunerMap, {
    center: [103.15, 35.45],
    zoom: 8.1,
    pitch: 62,
    bearing: 12,
  });
});
await page.waitForTimeout(1400);
await idle();
await shot('03-gansu-inlet');

await page.evaluate(() => {
  const api = window.REGION_ISOLATE;
  const region = api.findRegion(window.REGION_ISOLATE_DATA, 'gansu');
  const feat = api.narrativeFeature(region.feature);
  const ring = feat.geometry.coordinates[0];
  let best = ring[0];
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    if (p[0] > 99.6 && p[0] < 101.2 && p[1] > 38.2 && p[1] < 39.3) {
      best = p;
      break;
    }
  }
  window.AntiqueMapFx.jumpTo(window.__tunerMap, {
    center: [best[0], best[1] - 0.012],
    zoom: 12.35,
    pitch: 74,
    bearing: 8,
  });
});
await page.waitForTimeout(1600);
await idle();
await shot('05-gansu-sew-1km');

await page.evaluate(() => {
  const sel = document.getElementById('isolate-region');
  sel.value = 'beijing';
  sel.dispatchEvent(new Event('change'));
});
await page.waitForTimeout(1600);
await idle();
await shot('04-beijing-edge');

await page.evaluate(() => {
  const sel = document.getElementById('isolate-region');
  sel.value = 'tianjin';
  sel.dispatchEvent(new Event('change'));
});
await page.waitForTimeout(1600);
await idle();
await page.evaluate(() => {
  window.AntiqueMapFx.jumpTo(window.__tunerMap, {
    center: [117.35, 39.12],
    zoom: 9.4,
    pitch: 58,
    bearing: 24,
  });
});
await page.waitForTimeout(1400);
await idle();
await shot('08-tianjin-rim');

const shaderErrs = logs.filter((l) => /compile|link|redefinition/i.test(l));
console.log('shaderErrs', shaderErrs);
if (shaderErrs.length) {
  console.error('FAIL', shaderErrs);
  await browser.close();
  process.exit(1);
}
await browser.close();
console.log('wall-edge shots ok', outDir);
