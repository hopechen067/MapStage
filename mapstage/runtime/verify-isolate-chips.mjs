import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from './lib/pw.mjs';

const BASE = process.argv[2] || 'http://127.0.0.1:8766/';
const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'out', 'fx-verify');
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(BASE + '?chips=' + Date.now(), { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => !!window.__tunerMap, null, { timeout: 60000 });
const info = await page.evaluate(() => {
  const sel = document.getElementById('isolate-region');
  const opts = Array.from(sel.options).map((o) => o.value + ':' + o.textContent);
  const groups = Array.from(sel.querySelectorAll('optgroup')).map((g) => g.label);
  const chips = Array.from(document.querySelectorAll('#isolate-region-btns .btn')).map((b) => b.textContent);
  const dataIds = (window.REGION_ISOLATE_DATA.regions || []).map((r) => r.id);
  const cities = (window.REGION_ISOLATE_DATA.regions || []).filter((r) => r.kind === 'city');
  const cityParents = new Set(cities.map((c) => c.parentId));
  return { opts, groups, chips, dataIds, cityCount: cities.length, cityParents: Array.from(cityParents) };
});
await page.screenshot({ path: join(outDir, '53-isolate-region-chips.png') });
console.log(JSON.stringify({
  optCount: info.opts.length,
  groups: info.groups.length,
  chipCount: info.chips.length,
  cityCount: info.cityCount,
  cityParents: info.cityParents.length,
}, null, 2));
const provinceChips = ['北京', '甘肃', '新疆', '广东', '西藏', '台湾'];
const missingChip = provinceChips.find((name) => info.chips.indexOf(name) < 0);
if (missingChip || info.opts.filter((o) => o.indexOf('gansu:') === 0).length !== 1) {
  throw new Error('province chips missing ' + missingChip + ': ' + JSON.stringify(info.chips));
}
if (info.dataIds.indexOf('sichuan') < 0 || info.dataIds.length < 35) {
  throw new Error('province catalog too small: ' + info.dataIds.length);
}
// 市级目录：地级市 ≥ 300，全部挂在省下
if (info.cityCount < 300) {
  throw new Error('city catalog too small: ' + info.cityCount);
}
if (info.cityParents.some((p) => !info.dataIds.includes(p))) {
  throw new Error('city parent not in catalog: ' + JSON.stringify(info.cityParents));
}
// 下拉按省 optgroup 分组
if (info.groups.length < 30) {
  throw new Error('optgroup provinces missing: ' + info.groups.length);
}
// 选中省 → 出现该省市级芯片行；选中市 → zoom 到市
await page.click('button:has-text("拆出")');
await page.evaluate(() => {
  const sel = document.getElementById('isolate-region');
  sel.value = 'gansu';
  sel.dispatchEvent(new Event('change'));
});
await page.waitForTimeout(1600);
const gansuUi = await page.evaluate(() => ({
  cityRowShown: document.getElementById('isolate-city-btns').style.display !== 'none',
  cityChips: Array.from(document.querySelectorAll('#isolate-city-btns .btn')).map((b) => b.textContent),
  zoom: window.__tunerMap.getZoom(),
  center: [window.__tunerMap.getCenter().lng, window.__tunerMap.getCenter().lat],
}));
console.log('GANSU cityRow=' + gansuUi.cityRowShown + ' cityChips=' + gansuUi.cityChips.length +
  ' zoom=' + gansuUi.zoom.toFixed(2) + ' center=' + gansuUi.center.map((v) => v.toFixed(2)).join(','));
if (!gansuUi.cityRowShown || gansuUi.cityChips.length < 10) {
  throw new Error('gansu city chips missing: ' + JSON.stringify(gansuUi));
}
if (gansuUi.zoom < 4 || gansuUi.zoom > 7.5) {
  throw new Error('province zoom framing off: ' + gansuUi.zoom);
}
const beforeCity = await page.evaluate(() => window.__tunerMap.getZoom());
await page.evaluate(() => {
  const chips = Array.from(document.querySelectorAll('#isolate-city-btns .btn'));
  const zhangye = chips.find((b) => b.textContent === '张掖');
  (zhangye || chips[0]).click();
});
await page.waitForTimeout(1800);
const cityCam = await page.evaluate(() => {
  const m = window.__tunerMap;
  return { zoom: m.getZoom(), center: [m.getCenter().lng, m.getCenter().lat] };
});
console.log('CITY zoom=' + cityCam.zoom.toFixed(2) + ' center=' + cityCam.center.map((v) => v.toFixed(2)).join(','));
if (cityCam.zoom <= beforeCity + 1.5) {
  throw new Error('city selection did not zoom in: ' + cityCam.zoom + ' <= ' + beforeCity);
}
if (cityCam.center[0] < 97 || cityCam.center[0] > 104 || cityCam.center[1] < 36 || cityCam.center[1] > 41.5) {
  throw new Error('city camera not over Zhangye: ' + JSON.stringify(cityCam));
}
await page.screenshot({ path: join(outDir, '54-isolate-city-zoom.png') });
// 切回全国 → 全国视角
await page.evaluate(() => {
  const sel = document.getElementById('isolate-region');
  sel.value = 'china';
  sel.dispatchEvent(new Event('change'));
});
await page.waitForTimeout(1600);
const chinaCam = await page.evaluate(() => window.__tunerMap.getZoom());
console.log('CHINA zoom=' + chinaCam.toFixed(2));
if (chinaCam > 6) {
  throw new Error('china restore zoom too high: ' + chinaCam);
}
await browser.close();
