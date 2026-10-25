import { chromium } from './lib/pw.mjs';

const BASE = (process.argv[2] || 'http://127.0.0.1:8767').replace(/\/$/, '');

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

// 预置恶意预设到 localStorage：__proto__ / constructor 载荷
await page.addInitScript(() => {
  localStorage.setItem(
    'china-antique-maplibre-tuner-v1',
    JSON.stringify({
      id: 'evil',
      camera: { center: [104, 35.5], zoom: 4.2 },
      css: { sepia: 0.5, __proto__: { polluted: 'via-css' } },
      ui: { __proto__: { polluted: 'via-ui' }, constructor: { prototype: { polluted2: 'via-ctor' } } },
      maplibre: { water: { __proto__: { polluted: 'via-water' } } },
      cities: { __proto__: { polluted: 'via-cities' } },
    })
  );
});
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(BASE + '/?audit=' + Date.now(), { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__tunerMap, null, { timeout: 60000 });
await page.waitForTimeout(2500);

const result = await page.evaluate(async () => ({
  objectPolluted: Object.prototype.polluted,
  objectPolluted2: Object.prototype.polluted2,
  filterText: (document.getElementById('css-summary') || {}).textContent ||
    Array.from(document.querySelectorAll('code'))
      .map((c) => c.textContent)
      .find((t) => /sepia/.test(t)) || '',
}));
console.log(JSON.stringify(result, null, 1));
console.log('pageErrors:', errors.length ? errors : 'none');
await browser.close();
const pass =
  result.objectPolluted === undefined &&
  result.objectPolluted2 === undefined &&
  errors.length === 0 &&
  /sepia\(0\.5\)/.test(result.filterText);
console.log(pass ? 'POLLUTION GUARD OK (payload merged, dangerous keys dropped)' : 'POLLUTION GUARD FAILED');
if (!pass) process.exit(1);
