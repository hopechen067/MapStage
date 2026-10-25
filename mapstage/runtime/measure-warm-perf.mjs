import { chromium } from './lib/pw.mjs';

const BASE = (process.argv[2] || 'http://127.0.0.1:8767').replace(/\/$/, '');

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));

// 冷加载:预热 CDN 脚本与瓦片缓存
await page.goto(BASE + '/?warm=1' + Date.now(), { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__tunerMap && window.__tunerMap.isStyleLoaded(), null, { timeout: 90000 });
await page.waitForFunction(() => {
  const s = window.__tunerMap.getSource('river-l1-src');
  return s && s._data;
}, null, { timeout: 60000 });
await page.waitForTimeout(3000);

// 热加载:同 context 重载,资源全走缓存,度量代码路径本身
const t0 = Date.now();
await page.reload({ waitUntil: 'domcontentloaded' });
const dcl = Date.now() - t0;
await page.waitForFunction(() => window.__tunerMap && window.__tunerMap.isStyleLoaded(), null, { timeout: 60000 });
const styleLoaded = Date.now() - t0;
await page.waitForFunction(() => {
  const s = window.__tunerMap.getSource('river-l1-src');
  return s && s._data;
}, null, { timeout: 60000 });
const waterReady = Date.now() - t0;

// 瓦片已缓存下的隆起相位(纯代码路径)
await page.waitForTimeout(2500);
const rise = await page.evaluate(async () => {
  const m = window.__tunerMap;
  const t0 = performance.now();
  let moveendAt = null;
  m.once('moveend', () => { moveendAt = Math.round(performance.now() - t0); });
  const s0 = m.__antiqueSetTerrainCount || 0;
  document.getElementById('btn-terrain-rise').click();
  while (document.getElementById('btn-terrain-rise').disabled) {
    await new Promise((r) => setTimeout(r, 30));
  }
  const total = Math.round(performance.now() - t0);
  return {
    totalMs: total,
    moveendAtMs: moveendAt,
    riseMs: total - (moveendAt || 0),
    setTerrainCalls: (m.__antiqueSetTerrainCount || 0) - s0,
    finalEx: m.getTerrain() ? m.getTerrain().exaggeration : null,
  };
});

console.log(JSON.stringify({
  warmReload: { dclMs: dcl, styleLoadedMs: styleLoaded, waterReadyMs: waterReady },
  riseCachedTiles: rise,
}, null, 1));
await browser.close();
