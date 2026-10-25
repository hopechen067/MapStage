/**
 * 截帧器验收：断点续拍、局部重拍、旧帧混入保护、分层输出、重拍逐字节一致。
 *   node site/serve.mjs &            # 8770
 *   node runtime/verify-shoot.mjs http://127.0.0.1:8770
 */
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from './lib/pw.mjs';
import { frameFile, shoot } from './shoot.mjs';

const base = (process.argv[2] || 'http://127.0.0.1:8770').replace(/\/$/, '');
const root = mkdtempSync(join(tmpdir(), 'ms-shoot-'));
const common = { base, mode: 'preview', fps: 1, swiftshader: true };
const bytes = (dir, name) => readFileSync(join(dir, name));

try {
  // 1) 整片拍一遍（16 秒 @1fps = 16 帧）
  const A = join(root, 'a');
  const r1 = await shoot({ ...common, out: A });
  assert.equal(r1.total, 16);
  assert.equal(r1.shot, 16);
  assert.equal(r1.skipped, 0);
  assert.equal(readdirSync(A).filter((n) => n.endsWith('.jpg')).length, 16, '16 张 jpg');
  assert.equal(readdirSync(A).filter((n) => n.endsWith('.part')).length, 0, '没有残留 .part');
  console.log('full pass ok', r1.seconds + 's');

  // 2) 断点续拍：删 2 张，只补这 2 张
  unlinkSync(join(A, frameFile('full', 5, 'jpg')));
  unlinkSync(join(A, frameFile('full', 9, 'jpg')));
  const r2 = await shoot({ ...common, out: A });
  assert.equal(r2.shot, 2, '续拍只补缺的帧');
  assert.equal(r2.skipped, 14);
  console.log('resume ok');

  // 3) 数据变了不许混帧：fps 不同 → 拒绝；--force 才放行
  await assert.rejects(shoot({ ...common, fps: 2, out: A, i0: 0, i1: 1 }), /不一致/);
  console.log('mismatch guard ok');

  // 4) 局部重拍：--i0/--i1 覆盖区间，且和第一遍逐字节一致（SwiftShader 可复现）
  const before = bytes(A, frameFile('full', 3, 'jpg'));
  const r4 = await shoot({ ...common, out: A, i0: 3, i1: 5 });
  assert.equal(r4.shot, 2);
  assert.ok(before.equals(bytes(A, frameFile('full', 3, 'jpg'))), '重拍第 3 帧与首拍逐字节一致');
  assert.ok(bytes(A, frameFile('full', 4, 'jpg')).length > 5000, '第 4 帧不是空图');
  console.log('range reshoot ok (byte-identical)');

  // 5) 分层：map 层不含字卡，hud 层透明底且不含地图（含归属标注）
  const B = join(root, 'b');
  const r5 = await shoot({ ...common, out: B, layers: 'map,hud', i0: 1, i1: 2 });
  assert.deepEqual(r5.layers, ['map', 'hud']);
  assert.ok(existsSync(join(B, frameFile('map', 1, 'jpg'))));
  const hudPath = join(B, frameFile('hud', 1, 'png'));
  assert.ok(existsSync(hudPath));
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const probe = await page.evaluate(async (b64) => {
      const img = new Image();
      img.src = 'data:image/png;base64,' + b64;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width; c.height = img.height;
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0);
      const a = (x, y) => g.getImageData(x, y, 1, 1).data[3];
      let attrib = 0;
      for (let x = 560; x < 950; x += 6) for (let y = 505; y < 530; y += 3) attrib = Math.max(attrib, a(x, y));
      return { w: img.width, h: img.height, centerAlpha: a(480, 270), cardAlpha: a(100, 465), attribAlpha: attrib };
    }, readFileSync(hudPath).toString('base64'));
    assert.deepEqual([probe.w, probe.h], [960, 540]);
    assert.equal(probe.centerAlpha, 0, 'hud 层中央透明');
    assert.ok(probe.cardAlpha > 0, 'hud 层有字卡（t=1 的「河西走廊」标题卡）');
    assert.equal(probe.attribAlpha, 0, 'hud 层不含地图归属标注');
    console.log('layers ok', JSON.stringify(probe));
  } finally {
    await browser.close();
  }

  // 6) 区间越界要报错，不要静默
  await assert.rejects(shoot({ ...common, out: B, i0: 10, i1: 99 }), /帧区间不合法/);
  console.log('verify-shoot ok');
} finally {
  rmSync(root, { recursive: true, force: true });
}
