/**
 * 给官网示例拍缩略图 + 冒烟检查（无 pageerror）。
 *   node site/serve.mjs &   # 8770
 *   node runtime/site-thumbs.mjs http://127.0.0.1:8770
 *   node runtime/site-thumbs.mjs http://127.0.0.1:8770 route-march,skins   # 只拍这几个
 * 输出 site/examples/thumbs/<id>.jpg（1280×720，示例页本身全屏），全页截图到仓库根 out/site/。
 */
import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, GL_ARGS } from './lib/pw.mjs';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const pkg = join(here, '..');
const base = (process.argv[2] || 'http://127.0.0.1:8770').replace(/\/$/, '');
const thumbs = join(pkg, 'site', 'examples', 'thumbs');
const shots = join(pkg, '..', 'out', 'site');
mkdirSync(thumbs, { recursive: true });
mkdirSync(shots, { recursive: true });

// examples.js 是浏览器脚本；用最小 window 桩读出注册表
const fakeWin = {};
const vm = require('node:vm');
const fs = require('node:fs');
vm.runInNewContext(fs.readFileSync(join(pkg, 'site', 'examples', 'examples.js'), 'utf8'), {
  window: fakeWin,
  document: { readyState: 'complete', querySelector: () => null },
});
const LIST = fakeWin.MapStageExamples.list;

/** 特殊示例拍缩略图前要做的事；其余有 thumb 字段的示例统一 seek 到该时刻 */
const PREP = {
  'camera-fit': async (p) => p.waitForTimeout(4000),
  globe: async (p) => p.waitForTimeout(1500),
  'board-basic': async (p) => p.evaluate(() => window.board.setCities({ chengdu: { color: '#b8432f', value: 25, badge: 3, ring: 'select', label: 'active' }, luoyang: { color: '#3f5f8a', value: 16, badge: 2 }, jianye: { color: '#2f7d5b', value: 9, badge: 1 } })),
  'play-sanguo': async (p) => p.waitForFunction(() => !document.getElementById('hud').textContent.includes('载入'), null, { timeout: 60000 }),
};
// 示例页必须挂出 window.stage 或 window.board（文档承诺「控制台里可以直接试」）
const NO_HANDLE = new Set(['look-basic', 'terrain', 'look-layers', 'globe', 'compliance', 'route-slice', 'camera-fit', 'validate']);
const only = process.argv[3] ? new Set(process.argv[3].split(',')) : null;

const browser = await chromium.launch({ headless: true, args: GL_ARGS });
const failures = [];
async function visit(path, name, prep, viewport) {
  const page = await browser.newPage({ viewport: viewport || { width: 1280, height: 860 }, colorScheme: 'light' });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e && e.message || e)));
  await page.goto(base + path, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => {
    const c = document.querySelector('.maplibregl-canvas');
    return !c || c.width > 0;
  }, null, { timeout: 30000 });
  // 示例 mount 慢的机器要 10 秒以上：等句柄挂出来，最多 20 秒。<div id="stage"> 本身就是 window.stage，所以要看 .map
  await page.waitForFunction(() => (window.stage && window.stage.map) || (window.board && window.board.map) || (window.map && window.map.getStyle), null, { timeout: 20000 }).catch(() => {});
  // 再等瓦片落地：window.map 一构造就存在，不等 idle 会拍到半张图
  await page.evaluate(() => {
    const map = (window.stage && window.stage.map) || (window.board && window.board.map) || window.map;
    if (!map || !map.once) return null;
    return new Promise((done) => {
      if (map.loaded() && map.areTilesLoaded()) return done();
      map.once('idle', done);
      setTimeout(done, 20000);
    });
  }).catch(() => {});
  await page.waitForTimeout(1500);
  if (prep) await prep(page);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: join(shots, name + '.png'), fullPage: true });
  if (errors.length) failures.push(name + ': ' + errors.join(' | '));
  return page;
}

for (const ex of LIST) {
  if (only && !only.has(ex.id)) continue;
  const prep = PREP[ex.id] || (ex.thumb != null ? (p) => p.evaluate((t) => window.__mapstageSeek(t), ex.thumb) : null);
  const page = await visit('/examples/' + ex.id + '.html', ex.id, prep, { width: 1280, height: 720 });
  if (!NO_HANDLE.has(ex.id) && !(await page.evaluate(() => !!((window.stage && window.stage.map) || (window.board && window.board.map))))) failures.push(ex.id + ': 没有挂出 window.stage / window.board');
  await page.evaluate(() => { document.querySelectorAll('.ui').forEach((el) => { el.style.visibility = 'hidden'; }); });
  await page.screenshot({ path: join(thumbs, ex.id + '.jpg'), type: 'jpeg', quality: 72, clip: { x: 0, y: 0, width: 1280, height: 720 } });
  console.log('OK  ' + ex.id);
  await page.close();
}
if (only) {
  await browser.close();
  if (failures.length) { console.error('FAIL\n' + failures.join('\n')); process.exit(1); }
  console.log('site-thumbs ok (partial)');
  process.exit(0);
}
for (const [path, name] of [['/', 'home'], ['/examples/', 'gallery'], ['/examples/view.html?id=route-march', 'viewer'], ['/docs/', 'docs'], ['/docs/?p=story', 'docs-story']]) {
  const page = await visit(path, name, name === 'home' ? (p) => p.evaluate(() => window.__mapstageSeek(9)) : null);
  console.log('OK  ' + name);
  await page.close();
}
await browser.close();
if (failures.length) {
  console.error('FAIL pageerror\n' + failures.join('\n'));
  process.exit(1);
}
console.log('site-thumbs ok → ' + thumbs);
