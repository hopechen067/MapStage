/**
 * Studio 配色分区（皮肤 / 海拔设色 / 等高线 / 图层颜色）真跑：
 *   node runtime/verify-tuner-vector.mjs http://127.0.0.1:8770/studio
 * 断言：默认全关；设色/图层/等高线开关生效；色阶与图层色编辑进入地图 paint 并落盘；
 * 关设色后地图仍 loaded；换皮肤清掉自定义图层色。截图写到仓库根 out/。
 */
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from './lib/pw.mjs';

const BASE = (process.argv[2] || 'http://127.0.0.1:8770/studio').replace(/\/$/, '');
const shotDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'out');
mkdirSync(shotDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e)));
await page.goto(BASE + '/?vec=' + Date.now(), { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.evaluate(() => { try { localStorage.clear(); } catch (e) {} });
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => !!window.__tunerMap, null, { timeout: 60000 });
await page.waitForTimeout(4000);

const st = () => page.evaluate(() => {
  const m = window.__tunerMap;
  const vis = (id) => (m.getLayer(id) ? m.getLayoutProperty(id, 'visibility') : 'absent');
  return {
    relief: vis('vl-relief'),
    wood: vis('vl-wood'),
    contour: vis('vl-contour'),
    skins: document.querySelectorAll('#skin-list .chip').length,
    elev: document.querySelectorAll('#elev-list input').length,
    colors: document.querySelectorAll('#color-list input').length,
  };
});

const s0 = await st();
assert.equal(s0.relief, 'none', 'relief off by default');
assert.equal(s0.wood, 'none', 'landcover off by default');
assert.equal(s0.skins, 5);
assert.equal(s0.elev, 20);
assert.ok(s0.colors >= 20, 'layer colour rows ' + s0.colors);

await page.evaluate(() => window.__studioShowTab('look'));
await page.waitForTimeout(600);
await page.screenshot({ path: join(shotDir, 'vec-1-panel.png') });

await page.evaluate(() => window.__studioShowTab('layers'));
await page.click('#sw-sat');
await page.click('#btn-relief');
await page.waitForTimeout(7000);
assert.equal((await st()).relief, 'visible', 'relief on');
await page.screenshot({ path: join(shotDir, 'vec-2-relief.png') });

await page.click('#btn-landcover');
await page.evaluate(() => window.__tunerMap.jumpTo({ center: [100.42, 38.48], zoom: 8.5, pitch: 40, bearing: 0 }));
await page.waitForTimeout(9000);
assert.equal((await st()).wood, 'visible', 'landcover on');

await page.evaluate(() => {
  const e = document.querySelector('#elev-list input[data-elev="3000"]');
  e.value = '#ff0000'; e.dispatchEvent(new Event('input', { bubbles: true }));
  const w = document.querySelector('#color-list input[data-key="wood"]');
  w.value = '#00ffff'; w.dispatchEvent(new Event('input', { bubbles: true }));
});
await page.waitForTimeout(3000);
const after = await page.evaluate(() => {
  const m = window.__tunerMap;
  return {
    stop: JSON.stringify(m.getPaintProperty('vl-relief', 'color-relief-color')).includes('#ff0000'),
    wood: m.getPaintProperty('vl-wood', 'fill-color'),
  };
});
assert.ok(after.stop, 'elevation stop edit reaches color-relief');
assert.equal(String(after.wood).toLowerCase(), '#00ffff', 'wood colour edit reaches map');

await page.click('#btn-contour');
await page.waitForTimeout(8000);
assert.equal((await st()).contour, 'visible', 'contour on');
await page.screenshot({ path: join(shotDir, 'vec-5-contour.png') });

const saved = await page.evaluate(() => {
  const keys = Object.keys(localStorage).filter((k) => /tuner/i.test(k));
  for (const k of keys) {
    try {
      const v = JSON.parse(localStorage.getItem(k)).vector;
      if (v) return { relief: v.relief, contour: v.contour, landcover: v.landcover, paint: !!v.paint, stops: !!v.elevStops };
    } catch (e) {}
  }
  return null;
});
assert.ok(saved && saved.relief && saved.contour && saved.landcover && saved.paint && saved.stops, 'persisted ' + JSON.stringify(saved));

await page.click('#btn-relief');
await page.waitForFunction(() => window.__tunerMap.loaded(), null, { timeout: 20000 }).catch(() => {});
assert.equal(await page.evaluate(() => window.__tunerMap.loaded()), true, 'map loaded after relief off');

await page.evaluate(() => window.__studioShowTab('look'));
await page.click('#skin-list .chip:nth-child(2)');
await page.waitForTimeout(1500);
const wood2 = await page.evaluate(() => window.__tunerMap.getPaintProperty('vl-wood', 'fill-color'));
assert.notEqual(String(wood2).toLowerCase(), '#00ffff', 'skin switch clears custom layer colours');

assert.deepEqual(errs, [], 'page errors');
await browser.close();
console.log('TUNER VECTOR OK');
