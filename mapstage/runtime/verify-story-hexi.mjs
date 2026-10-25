/**
 * story-hexi 示例验收：无 pageerror、预缓存后 seek(t) 正序 / 倒序逐像素一致、违规 story 拒绝渲染。
 *   node site/serve.mjs &            # 8770
 *   node runtime/verify-story-hexi.mjs http://127.0.0.1:8770
 */
import { chromium } from './lib/pw.mjs';

// SwiftShader（CPU 光栅）：逐像素比较要确定性，且不依赖本机 GPU
const GL_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];

const base = (process.argv[2] || 'http://127.0.0.1:8770').replace(/\/$/, '');
const browser = await chromium.launch({ headless: true, args: GL_ARGS });
const page = await browser.newPage({ viewport: { width: 1280, height: 860 }, colorScheme: 'light' });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e && e.message || e)));
await page.goto(base + '/examples/story-hexi.html', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => window.stage && window.__mapstageSeek, null, { timeout: 90000 });

const out = await page.evaluate(async () => {
  const times = [0, 2, 4, 6, 8, 10, 12, 14, 16];
  const stage = window.stage;
  await stage.precache();
  // preserveDrawingBuffer 已打开；PNG 无损，比 seek-contract 的 JPEG 更严
  const grab = () => stage.map.getCanvas().toDataURL('image/png');
  const fwd = [];
  for (const t of times) { await stage.seek(t); fwd.push(grab()); }
  const back = [];
  for (let i = times.length - 1; i >= 0; i--) { await stage.seek(times[i]); back[i] = grab(); }
  const same = fwd.filter((s, i) => s === back[i]).length;
  const check = stage.check(8);
  let rejected = null;
  try {
    const bad = JSON.parse(JSON.stringify(stage.story));
    bad.routes.push({ id: 'second', side: 'red', role: 'primary', via: ['wuwei', 'zhangye'], draw: [2, 5], hold: 5 });
    await MapStage.mount(document.createElement('div'), { story: bad });
  } catch (e) { rejected = e.message; }
  return { same, total: times.length, checkOk: check.ok, counts: check.counts, rejected };
});

console.log(JSON.stringify(out, null, 1));
await browser.close();
let ok = true;
if (errors.length) { console.error('pageerror:', errors); ok = false; }
if (out.same !== out.total) { console.error('FAIL seek not pixel-identical: ' + out.same + '/' + out.total); ok = false; }
if (!out.checkOk) { console.error('FAIL check(8) not ok'); ok = false; }
if (!out.rejected || !/同屏 2 个/.test(out.rejected)) { console.error('FAIL over-limit story was not rejected'); ok = false; }
if (!ok) process.exit(1);
console.log('verify-story-hexi ok');
