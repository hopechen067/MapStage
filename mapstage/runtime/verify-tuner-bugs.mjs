import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from './lib/pw.mjs';

const BASE = (process.argv[2] || 'http://127.0.0.1:8765').replace(/\/$/, '');
const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'out', 'fx-verify', 'bug-fix');
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=gl-egl', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const logs = [];
const failedUrls = [];
page.on('pageerror', (err) => logs.push('pageerror ' + String(err && err.message ? err.message : err)));
page.on('console', (msg) => {
  if (msg.type() === 'error') logs.push('error ' + msg.text());
});
page.on('response', (res) => {
  if (res.status() >= 400) failedUrls.push(res.status() + ' ' + res.url());
});

async function shot(name) {
  const cdp = await page.context().newCDPSession(page);
  const png = await cdp.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(join(outDir, name + '.png'), Buffer.from(png.data, 'base64'));
}

function fail(msg, extra) {
  console.error('FAIL', msg, extra ? JSON.stringify(extra) : '');
  writeFileSync(join(outDir, 'logs.json'), JSON.stringify({ logs, failedUrls }, null, 2));
}

await page.goto(BASE + '/index.html?bug-fix=' + Date.now(), {
  waitUntil: 'domcontentloaded',
  timeout: 60000,
});
await page.waitForFunction(() => !!window.__tunerMap, null, { timeout: 60000 });
await page.evaluate(() => {
  try { localStorage.removeItem('china-antique-maplibre-tuner-v1'); } catch (e) {}
});
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!window.__tunerMap, null, { timeout: 60000 });
await page.evaluate(() =>
  window.AntiqueMapFx.waitIdle(window.__tunerMap, { timeoutMs: 20000, force: true })
);
await shot('01-load');

await page.evaluate(() => {
  const sel = document.getElementById('isolate-region');
  sel.value = 'gansu';
  sel.dispatchEvent(new Event('change'));
  const btn = document.getElementById('btn-isolate');
  if (!btn.classList.contains('active')) btn.click();
});
await page.evaluate(() =>
  window.AntiqueMapFx.waitIdle(window.__tunerMap, { timeoutMs: 20000, force: true })
);
await page.waitForTimeout(1800);
await shot('02-gansu-isolate');

const iso = await page.evaluate(() => {
  const map = window.__tunerMap;
  const api = window.REGION_ISOLATE;
  const region = api.findRegion(window.REGION_ISOLATE_DATA, 'gansu');
  const feat = region && api.narrativeFeature(region.feature);
  const src = map.getSource('han-city-extrude-src');
  let cityNames = [];
  let outside = [];
  try {
    const ser = src && src.serialize ? src.serialize() : null;
    const features = ser && ser.data && ser.data.features ? ser.data.features : [];
    const seen = {};
    for (let i = 0; i < features.length; i++) {
      const p = features[i].properties || {};
      const name = p.name || p.id;
      if (name && !seen[name]) {
        seen[name] = true;
        cityNames.push(name);
      }
      const g = features[i].geometry;
      const ring = g && g.coordinates && g.coordinates[0];
      if (ring && ring[0] && feat && api.pointInFeature) {
        const lng = ring[0][0];
        const lat = ring[0][1];
        if (!api.pointInFeature(lng, lat, feat)) outside.push(name);
      }
    }
  } catch (e) {
    outside = ['error:' + (e.message || e)];
  }
  const labels = [...document.querySelectorAll('.han-city-label')].map((el) => el.textContent);
  const clip = window.__antiqueTerrainClip || {};
  return {
    clipOn: !!clip.enabled,
    maskVis: map.getLayer('region-mask-fill')
      ? map.getLayoutProperty('region-mask-fill', 'visibility')
      : null,
    walls: !!map.getLayer('region-island-walls'),
    cityNames: cityNames,
    outside: [...new Set(outside.filter(Boolean))],
    labels: labels,
    shaderLogs: (window.__tunerShaderErrs || []).slice(),
  };
});
console.log('ISOLATE', JSON.stringify(iso));

const shaderErrs = logs.filter((l) => /redefinition|Could not compile|failed to link/i.test(l));
if (shaderErrs.length) {
  fail('shader compile', shaderErrs);
  await browser.close();
  process.exit(1);
}
// Overlay walls were dropped for the mesh-only rim (c4de5ce); they must stay gone.
if (!iso.clipOn || iso.maskVis === 'visible' || iso.walls) {
  fail('island clip/mask/walls', iso);
  await browser.close();
  process.exit(1);
}
if (iso.outside.length) {
  fail('cities outside isolate still in source', iso.outside);
  await browser.close();
  process.exit(1);
}

await page.evaluate(() => {
  const isoBtn = document.getElementById('btn-isolate');
  if (isoBtn && isoBtn.classList.contains('active')) isoBtn.click();
  const btn = [...document.querySelectorAll('#viewmode-seg button')].find(
    (b) => b.getAttribute('data-mode') === 'globe'
  );
  if (btn) btn.click();
});
await page.waitForTimeout(2500);
await page.evaluate(() =>
  window.AntiqueMapFx
    ? window.AntiqueMapFx.waitIdle(window.__tunerMap, { timeoutMs: 15000, force: true })
    : null
);
await shot('03-globe');

const globe = await page.evaluate(() => {
  const map = window.__tunerMap;
  const p = map.getProjection && map.getProjection();
  const canvas = map.getCanvas && map.getCanvas();
  let bright = 0;
  try {
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (gl) {
      const w = Math.min(64, canvas.width);
      const h = Math.min(64, canvas.height);
      const pix = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pix);
      for (let i = 0; i < pix.length; i += 4) {
        if (pix[i] + pix[i + 1] + pix[i + 2] > 40) bright += 1;
      }
      bright = bright / (w * h);
    }
  } catch (e) {
    bright = -1;
  }
  return {
    proj: p && p.type,
    viewMode: document.getElementById('chrome-proj')
      ? document.getElementById('chrome-proj').textContent
      : null,
    bright: bright,
    clipOn: !!(window.__antiqueTerrainClip && window.__antiqueTerrainClip.enabled),
  };
});
console.log('GLOBE', JSON.stringify(globe));
const globeShaderErrs = logs.filter((l) => /redefinition|Could not compile|failed to link/i.test(l));
if (globeShaderErrs.length) {
  fail('globe shader', globeShaderErrs);
  await browser.close();
  process.exit(1);
}
if (globe.proj !== 'globe') {
  fail('did not switch to globe', globe);
  await browser.close();
  process.exit(1);
}

await page.evaluate(() => {
  const btn = [...document.querySelectorAll('#viewmode-seg button')].find(
    (b) => b.getAttribute('data-mode') === 'map'
  );
  if (btn) btn.click();
});
await page.waitForTimeout(1500);
await shot('04-back-map');

writeFileSync(join(outDir, 'logs.json'), JSON.stringify({ logs, failedUrls }, null, 2));
console.log('LOGS', logs.slice(0, 20));
await browser.close();
console.log('tuner bugs verify ok');
