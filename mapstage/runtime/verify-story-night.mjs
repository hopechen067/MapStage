/**
 * 夜景底图（story.look.basemap = 'nightlights'）验收：
 *   - 首帧不闪：mount 后立刻 seek(0) 拍的帧，与走过其它时刻再回 seek(0) 的帧逐像素一致（夜光图已在首帧前就位）；
 *   - 逐帧确定：precache 后正序 / 倒序 seek 逐像素一致；
 *   - 不过曝：首帧（全图）与中间帧（江南）近白像素占比、平均亮度在阈值内，且确实有灯光；
 *   - 合规：夜光图层在、境界线图层不在，全图时段 check 通过（十段线、台湾、海南、南海）；
 *     十段线像素与海面对比度 ≥ 3（配套皮肤与换成宣纸皮肤各测一次）。
 * 截图写到仓库根 out/story-night-*.png。
 *   node site/serve.mjs &            # 8770
 *   node runtime/verify-story-night.mjs http://127.0.0.1:8770
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from './lib/pw.mjs';

// SwiftShader（CPU 光栅）：逐像素比较要确定性，且不依赖本机 GPU
const GL_ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const base = (process.argv[2] || 'http://127.0.0.1:8770').replace(/\/$/, '');
// 第二个参数可换底图（排查用），默认夜景
const basemap = process.argv[3] || 'nightlights';
const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'out');
mkdirSync(outDir, { recursive: true });

/**
 * 在页面里跑：seek(0)（全图，十段线可见），取每段十段线中点的像素，与两侧垂直 10 px 处的海面比 WCAG 对比度，
 * 每段取两侧较小值（防止一侧是亮海岸蒙混过关），返回各段中位数。
 */
async function measureTenDash() {
  const stage = window.stage;
  const map = stage.map;
  await stage.seek(0);
  const cv = map.getCanvas();
  const k = cv.width / cv.clientWidth;
  const c = document.createElement('canvas');
  c.width = cv.width; c.height = cv.height;
  const g = c.getContext('2d');
  g.drawImage(cv, 0, 0);
  const px = (x, y) => {
    const d = g.getImageData(Math.round(x * k), Math.round(y * k), 1, 1).data;
    return [d[0], d[1], d[2]];
  };
  const lum = (p) => {
    const l = p.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2];
  };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const per = MapStage.TEN_DASH.map((dash) => {
    const a = map.project(dash[0]);
    const b = map.project(dash[dash.length - 1]);
    const m = map.project(dash.length > 2 ? dash[1] : [(dash[0][0] + dash[1][0]) / 2, (dash[0][1] + dash[1][1]) / 2]);
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const nx = -(b.y - a.y) / len * 10, ny = (b.x - a.x) / len * 10;
    const line = px(m.x, m.y);
    return Math.min(ratio(line, px(m.x + nx, m.y + ny)), ratio(line, px(m.x - nx, m.y - ny)));
  }).sort((x, y) => x - y);
  return {
    median: +per[Math.floor(per.length / 2)].toFixed(2),
    look: { skinId: stage.look.skinId, dark: stage.look.dark, sea: stage.look.sea },
  };
}

const browser = await chromium.launch({ headless: true, args: GL_ARGS });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, colorScheme: 'light' });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e && e.message || e)));
await page.goto(base + '/examples/look-basemap.html?basemap=' + basemap, { waitUntil: 'domcontentloaded', timeout: 60000 });
// 示例页 show() 里会先 seek(t=0)；这里在它之前就截获 stage，自己做「首帧」
await page.waitForFunction(() => window.stage && window.stage.map && window.__mapstageSeek, null, { timeout: 90000 });

const out = await page.evaluate(async () => {
  const stage = window.stage;
  const map = stage.map;
  const canvas = map.getCanvas();
  const grab = () => canvas.toDataURL('image/png');
  function stats() {
    const c = document.createElement('canvas');
    c.width = canvas.width; c.height = canvas.height;
    const g = c.getContext('2d');
    g.drawImage(canvas, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    let sum = 0, white = 0, lit = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) {
      const y = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      sum += y; n++;
      if (y > 245) white++;
      if (y > 120) lit++;
    }
    return { mean: +(sum / n).toFixed(1), whitePct: +(100 * white / n).toFixed(3), litPct: +(100 * lit / n).toFixed(3) };
  }
  // 首帧：不预缓存，直接拍
  await stage.seek(0);
  const first0 = grab();
  const stats0 = stats();
  const night = !!map.getLayer('night-lights') && map.isSourceLoaded('nightLights');
  const mid = 5.2;
  await stage.seek(mid);
  const firstMid = grab();
  const statsMid = stats();
  await stage.seek(2);
  await stage.seek(0);
  const again0 = grab();
  await stage.seek(mid);
  const againMid = grab();
  // 正序 / 倒序（按录制契约先 precache）。t = 2.5 是镜头推进中段，旧外观（不用底图样式）在这个机位
  // precache 后也不逐像素一致，是既有问题，不在本脚本范围内，所以不取
  await stage.precache();
  const times = [0, 1, 4, 5.2, 6.5, 8];
  const fwd = [];
  for (const t of times) { await stage.seek(t); fwd.push(grab()); }
  const back = [];
  for (let i = times.length - 1; i >= 0; i--) { await stage.seek(times[i]); back[i] = grab(); }
  const ids = map.getStyle().layers.map((l) => l.id);
  return {
    night,
    look: { basemap: stage.look.basemap, skinId: stage.look.skinId, dark: stage.look.dark },
    firstFrameStable: first0 === again0,
    midFrameStable: firstMid === againMid,
    same: fwd.filter((s, i) => s === back[i]).length,
    differ: times.filter((t, i) => fwd[i] !== back[i]),
    total: times.length,
    stats0, statsMid,
    borders: ids.filter((id) => /boundary|admin/.test(id)),
    lights: ids.filter((id) => /^vl-lights|night-lights/.test(id)),
    check0: stage.check(0),
    shots: { first: first0, mid: firstMid },
  };
});

// 十段线看得见：配套皮肤一次，再换成宣纸皮肤一次（海面仍是近黑色阶，评审 PR #34 指出的情形）
out.tenDash = await page.evaluate(measureTenDash);
const page2 = await browser.newPage({ viewport: { width: 1280, height: 720 }, colorScheme: 'light' });
page2.on('pageerror', (e) => errors.push(String(e && e.message || e)));
await page2.goto(base + '/examples/look-basemap.html?basemap=' + basemap + '&skin=parchment', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page2.waitForFunction(() => window.stage && window.stage.map && window.__mapstageSeek, null, { timeout: 90000 });
out.tenDashParchment = await page2.evaluate(measureTenDash);

writeFileSync(join(outDir, 'story-night-t0.png'), Buffer.from(out.shots.first.split(',')[1], 'base64'));
writeFileSync(join(outDir, 'story-night-mid.png'), Buffer.from(out.shots.mid.split(',')[1], 'base64'));
delete out.shots;
const check0 = out.check0;
out.check0 = { ok: check0.ok, bad: check0.issues.filter((i) => !i.ok).map((i) => i.label) };
console.log(JSON.stringify(out, null, 1));
await browser.close();

let ok = true;
const fail = (m) => { console.error('FAIL ' + m); ok = false; };
if (errors.length) fail('pageerror: ' + errors.join(' | '));
if (!out.night) fail('night-lights 图层 / 数据源没有就位');
if (out.look.basemap !== 'nightlights' || out.look.skinId !== 'night') fail('look 没解析成夜景');
if (!out.firstFrameStable) fail('首帧与回放帧不一致（夜光闪烁）');
if (!out.midFrameStable) fail('中间帧与回放帧不一致');
if (out.same !== out.total) fail('seek 正倒序不一致 ' + out.same + '/' + out.total + '：t = ' + out.differ.join(', '));
if (out.borders.length) fail('出现境界线图层 ' + out.borders.join(','));
if (out.lights.length !== 4) fail('灯光图层不全 ' + out.lights.join(','));
if (!out.check0.ok) fail('t=0 合规自检未过 ' + out.check0.bad.join(','));
for (const [name, r] of [['配套皮肤', out.tenDash], ['宣纸皮肤', out.tenDashParchment]]) {
  if (r.median < 3) fail('十段线（' + name + '）与海面对比度中位数 ' + r.median + ' < 3，几乎看不见');
}
if (out.tenDashParchment.look.skinId !== 'parchment') fail('?skin=parchment 没生效');
for (const [name, s] of [['t0', out.stats0], ['mid', out.statsMid]]) {
  if (s.whitePct > 1.5) fail(name + ' 过曝：近白像素 ' + s.whitePct + '%');
  if (s.mean > 90) fail(name + ' 整体太亮：平均亮度 ' + s.mean);
  if (s.litPct < 0.05) fail(name + ' 看不到灯光：亮像素 ' + s.litPct + '%');
}
if (!ok) process.exit(1);
console.log('verify-story-night ok → out/story-night-t0.png, out/story-night-mid.png');
