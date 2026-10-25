/**
 * QA 检测器验收：用合成帧证明每一类缺陷都能被抓到、干净序列不误报。
 *   node site/serve.mjs &            # 8770（导出帧要读 story）
 *   node runtime/verify-qa.mjs http://127.0.0.1:8770
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from './lib/pw.mjs';
import { meanAbsDiff, PROBE_VOID, pickExportFrames, qa, runs } from './qa.mjs';
import { frameFile, shoot } from './shoot.mjs';

const base = (process.argv[2] || 'http://127.0.0.1:8770').replace(/\/$/, '');

// ── 纯函数 ──
assert.deepEqual(runs([false, true, true, false, true]), [[1, 2], [4, 4]]);
assert.deepEqual(runs([]), []);
assert.equal(meanAbsDiff([0, 0, 10], [0, 10, 10]), 10 / 3);
const story = await (await fetch(base + '/examples/story-hexi.json')).json();
const pick = pickExportFrames(story, 10, 160, false);
assert.equal(pick.caption, 19, 'caption = 第一张字卡 [0.2,3.6) 的中点 1.9 s → 帧 19');
assert.equal(pick.handoff, 39, 'handoff = 第一次镜头运动 5 s / 2.2 s 的中点 3.9 s → 帧 39');
assert.ok(pick.peakCards >= 2, 'peak 帧同屏至少 2 张字卡');
console.log('pure ok', JSON.stringify(pick));

// ── 合成帧 ──
const FPS = 5;
const TOTAL = 30;
const VOID = [200, 100, 50];
const W = 960, H = 540;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
async function paint(kind, i) {
  return page.evaluate(({ kind, i, W, H, VOID }) => {
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d');
    const inv = kind === 'inverted';
    const shift = kind === 'static' ? 0 : i * 4;
    for (let x = -80; x < W + 80; x += 40) {
      const k = ((x / 40) % 2 + 2) % 2;
      g.fillStyle = (k === 0) !== inv ? 'rgb(90,90,90)' : 'rgb(160,160,160)';
      g.fillRect(x + (shift % 80), 0, 40, H);
    }
    if (kind === 'void') { g.fillStyle = `rgb(${VOID.join(',')})`; g.fillRect(100, 100, 400, 300); }
    return c.toDataURL('image/png').split(',')[1];
  }, { kind, i, W, H, VOID });
}

function manifest(dir) {
  writeFileSync(join(dir, 'shoot.json'), JSON.stringify({
    hash: 'synthetic', story: 'examples/story-hexi.json', duration: TOTAL / FPS, fps: FPS, frames: TOTAL,
    width: W, height: H, layers: ['full'], ext: 'png', quality: 0, mode: 'preview',
  }), 'utf8');
}

const root = mkdtempSync(join(tmpdir(), 'ms-qa-'));
try {
  // 干净序列：持续平移，不应有任何告警
  const clean = join(root, 'clean');
  mkdirSync(clean);
  manifest(clean);
  for (let i = 0; i < TOTAL; i++) writeFileSync(join(clean, frameFile('full', i, 'png')), Buffer.from(await paint('move', i), 'base64'));
  const opts = { base, compliance: false, voidColor: VOID, freeze: 1.5 };
  const rc = await qa(clean, opts);
  assert.equal(rc.ok, true, '干净序列不误报：' + JSON.stringify({ c: rc.hardCuts, f: rc.freezes, v: rc.voids }));
  assert.ok(rc.maxDiff > 0 && rc.maxDiff < 28, '平移的相邻差在阈值内：' + rc.maxDiff);
  for (const n of ['caption', 'nocaption', 'peak', 'handoff']) assert.ok(existsSync(join(clean, 'qa', n + '.png')), '导出 ' + n);
  assert.ok(existsSync(join(clean, 'qa', 'report.json')));
  console.log('clean ok  maxDiff', rc.maxDiff);

  // 缺陷序列
  const bad = join(root, 'bad');
  mkdirSync(bad);
  manifest(bad);
  for (let i = 0; i < TOTAL; i++) {
    let kind = 'move';
    if (i === 5) kind = 'void';          // 露底（单帧）
    if (i >= 12 && i < 20) kind = 'inverted'; // 12 帧起整张反相 = 硬切；20 回到 move = 再切一次
    if (i >= 22) kind = 'static';        // 22..29 完全静止 8 帧 = 1.6 s
    writeFileSync(join(bad, frameFile('full', i, 'png')), Buffer.from(await paint(kind, i), 'base64'));
  }
  unlinkSync(join(bad, frameFile('full', 27, 'png')));
  const rb = await qa(bad, { ...opts, exports: false });
  assert.equal(rb.ok, false);
  const cutFrames = rb.hardCuts.map((c) => c.frame);
  assert.ok(cutFrames.includes(12), '抓到第 12 帧的硬切：' + JSON.stringify(rb.hardCuts));
  assert.deepEqual(rb.voids.map((v) => [v.from, v.to]), [[5, 5]], '露底只在第 5 帧');
  assert.deepEqual(rb.missing, [[27, 27]], '缺的第 27 帧被报出来');
  console.log('defects ok', JSON.stringify({ cuts: cutFrames, voids: rb.voids, missing: rb.missing }));

  // 冻帧：补回第 27 帧再测（缺帧会截断静止段）
  writeFileSync(join(bad, frameFile('full', 27, 'png')), Buffer.from(await paint('static', 27), 'base64'));
  const rf = await qa(bad, { ...opts, exports: false });
  assert.equal(rf.freezes.length, 1, '一段冻帧：' + JSON.stringify(rf.freezes));
  assert.ok(rf.freezes[0].seconds >= 1.5 && rf.freezes[0].from >= 21, '冻帧时长与起点：' + JSON.stringify(rf.freezes[0]));
  // 阈值抬到 3 s 就不该报
  const rf2 = await qa(bad, { ...opts, exports: false, freeze: 3 });
  assert.equal(rf2.freezes.length, 0);
  console.log('freeze ok', JSON.stringify(rf.freezes[0]));

  // 宿主探针的正向对照：镜头压到 80° 俯仰，地平线以上没有任何图层，必须被报成露底
  const horizon = JSON.parse(JSON.stringify(story));
  horizon.duration = 2;
  horizon.routes = []; horizon.beats = []; horizon.cards = [];
  horizon.compliance = {};
  horizon.shots = [{ t: 0, fit: ['wuwei', 'zhangye'], pitch: 80 }];
  horizon.preset = base + '/studio/presets/antique-default.json';
  const dataUrl = 'data:application/json,' + encodeURIComponent(JSON.stringify(horizon));
  const H1 = join(root, 'horizon');
  const rs = await shoot({ base, story: dataUrl, out: H1, mode: 'preview', fps: 1 });
  assert.equal(rs.total, 2);
  const rh = await qa(H1, { base, compliance: false, exports: false });
  assert.ok(rh.voids.length >= 1 && rh.maxVoid > 0.005, '地平线露底被探针抓到：maxVoid=' + rh.maxVoid);
  console.log('probe positive control ok  maxVoid', rh.maxVoid);

  // 露底探针要真能看见底：同一个函数分别量「正常机位」和「拉远加大俯仰、地平线外露」
  const hostPage = await browser.newPage({ viewport: { width: W, height: H } });
  await hostPage.goto(base + '/host.html?story=examples%2Fstory-hexi.json', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await hostPage.waitForFunction(() => window.__mapstageReady || window.__mapstageError, null, { timeout: 120000 });
  assert.equal(await hostPage.evaluate(() => window.__mapstageError || null), null, 'host 页面起得来');
  const cams = [
    { center: [100.5, 38.9], zoom: 7, pitch: 40, bearing: 0 },
    { center: [100.5, 38.9], zoom: 2.2, pitch: 78, bearing: 0 },
  ];
  const pv = await hostPage.evaluate(PROBE_VOID, { total: 2, fps: 1, step: 1, cameras: cams });
  assert.ok(pv[0] < 0.005, '正常机位不露底：' + pv[0]);
  assert.ok(pv[1] > 0.02, '拉远 + 大俯仰要能量出露底：' + pv[1]);
  console.log('void probe ok', JSON.stringify(pv));
  await hostPage.close();

  // 真 host 上的合规逐帧路径确实跑了（对 story-hexi 的 2 帧）
  const comp = await browser.newPage({ viewport: { width: W, height: H } });
  await comp.goto(base + '/host.html?story=examples%2Fstory-hexi.json', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await comp.waitForFunction(() => window.__mapstageReady, null, { timeout: 120000 });
  const issues = await comp.evaluate(() => window.stage.check(8).issues.map((x) => [x.id, x.ok]));
  assert.ok(issues.length >= 3 && issues.every(([, ok]) => ok), '合规 check(8) 全过：' + JSON.stringify(issues));
  await comp.close();

  // 不是截帧目录要明说
  await assert.rejects(qa(root, opts), /shoot\.json/);
  console.log('verify-qa ok');
} finally {
  await browser.close();
  rmSync(root, { recursive: true, force: true });
}
