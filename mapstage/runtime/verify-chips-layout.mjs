/**
 * 拆出 chips fit the Studio panel: every region chip exists and sits fully inside
 * the panel's width (no sideways clipping), the chip grid is not clipped by its
 * own box, and a province's city row (Guangdong: 21) wraps instead of overflowing.
 * The panel scrolls vertically by design, so vertical position is not asserted.
 */
import { chromium } from './lib/pw.mjs';

const BASE = (process.argv[2] || 'http://127.0.0.1:8767').replace(/\/$/, '');

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
await page.goto(BASE + '/?chipsfit=' + Date.now(), { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__tunerMap, null, { timeout: 60000 });
await page.waitForTimeout(2000);
await page.evaluate(() => window.__studioShowTab('isolate'));
await page.waitForTimeout(300);

const check = await page.evaluate(() => {
  const panel = document.getElementById('panel').getBoundingClientRect();
  const grid = document.getElementById('isolate-region-btns');
  const need = ['中国', '陕西', '甘肃', '青海', '宁夏', '新疆', '香港', '澳门', '台湾', '上海', '西藏'];
  const missing = [];
  const clipped = [];
  for (const name of need) {
    const btn = Array.from(grid.querySelectorAll('.btn')).find((b) => b.textContent === name);
    if (!btn) { missing.push(name); continue; }
    const r = btn.getBoundingClientRect();
    if (r.right > panel.right + 1 || r.left < panel.left - 1) clipped.push(name);
  }
  return {
    gridClipped: grid.scrollHeight > grid.clientHeight + 1 || grid.scrollWidth > grid.clientWidth + 1,
    gridOverflow: grid.scrollHeight + '/' + grid.clientHeight,
    panelBodyVisible: document.getElementById('panel-body').getBoundingClientRect().height,
    missing,
    clipped,
  };
});
console.log(JSON.stringify(check, null, 1));
await page.screenshot({ path: 'out/fx-verify/72-chips-layout.png' });

// 选中广东 → 市级行展开,再测一次不溢出
await page.selectOption('#isolate-region', { value: 'guangdong' });
await page.waitForTimeout(1200);
const cityCheck = await page.evaluate(() => {
  const panel = document.getElementById('panel').getBoundingClientRect();
  const cityRow = document.getElementById('isolate-city-btns');
  const chips = Array.from(cityRow.querySelectorAll('.btn'));
  return {
    cityClipped: chips.filter((b) => { const r = b.getBoundingClientRect(); return r.right > panel.right + 1 || r.left < panel.left - 1; }).length,
    cityRowClipped: cityRow.scrollWidth > cityRow.clientWidth + 1,
    cityChips: cityRow.querySelectorAll('.btn').length,
    panelBodyVisible: Math.round(document.getElementById('panel-body').getBoundingClientRect().height),
  };
});
console.log(JSON.stringify(cityCheck, null, 1));
await page.screenshot({ path: 'out/fx-verify/73-chips-city-layout.png' });
await browser.close();

const pass =
  check.missing.length === 0 &&
  check.clipped.length === 0 &&
  !check.gridClipped &&
  check.panelBodyVisible > 150 &&
  cityCheck.cityClipped === 0 &&
  !cityCheck.cityRowClipped &&
  cityCheck.cityChips >= 20 &&
  cityCheck.panelBodyVisible > 150;
console.log(pass ? 'CHIPS LAYOUT OK' : 'CHIPS LAYOUT FAILED');
if (!pass) process.exit(1);
