/**
 * 两段出片验收：预览 → 确认 → 终版 的闸门（没确认 / 数据改过都不许出终版）、指纹与页面一致、mp4 真的出来。
 * 不在这里跑 1080p 终版本身（太慢）；终版的截帧参数由 shoot 的 final 模式保证。
 *   node site/serve.mjs &            # 8770
 *   node runtime/verify-render.mjs http://127.0.0.1:8770
 */
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { storyFingerprint } from './lib/fingerprint.mjs';
import { approve, final, preview } from './render.mjs';

const base = (process.argv[2] || 'http://127.0.0.1:8770').replace(/\/$/, '');
const out = mkdtempSync(join(tmpdir(), 'ms-render-'));
const story = 'examples/story-hexi.json';

try {
  // 1) 还没预览 / 还没确认：终版一律拒绝
  await assert.rejects(final({ out, base }), /先跑 preview/);

  // 2) 预览：mp4 + 接触表 + state
  const r = await preview({ out, base, story, layers: 'full' });
  assert.equal(r.report.ok, true, '预览 QA 通过');
  assert.ok(existsSync(join(out, 'preview.mp4')) && statSync(join(out, 'preview.mp4')).size > 100000, 'preview.mp4 有内容');
  assert.ok(existsSync(join(out, 'preview-contact.jpg')), '接触表');
  assert.equal(r.state.approved, false);
  console.log('preview ok', r.res.seconds + 's');

  // 3) 指纹：Node 算的和页面算的一致（算法不能漂）
  const fp = await storyFingerprint(base, story);
  assert.equal(fp.hash, r.res.hash, 'Node 指纹 = host.html 指纹');

  // 4) 没确认就出终版：拒绝
  await assert.rejects(final({ out, base }), /还没被确认/);

  // 5) 确认；然后数据被改 → 终版拒绝
  approve({ out });
  const stFile = join(out, 'state.json');
  const st = JSON.parse(readFileSync(stFile, 'utf8'));
  assert.equal(st.approved, true);
  const edited = JSON.parse(await (await fetch(base + '/' + story)).text());
  edited.sites[0].name = edited.sites[0].name + '（改过）';
  if (typeof edited.preset === 'string') edited.preset = new URL(edited.preset, new URL(base + '/' + story)).href;   // data: URL 没法解析相对路径
  writeFileSync(stFile, JSON.stringify({ ...st, story: 'data:application/json,' + encodeURIComponent(JSON.stringify(edited)) }), 'utf8');
  await assert.rejects(final({ out, base }), /又改过了/);
  console.log('gates ok');

  // 6) 预览 QA 没过不许确认
  writeFileSync(stFile, JSON.stringify({ ...st, approved: false, preview: { ...st.preview, qaOk: false } }), 'utf8');
  assert.throws(() => approve({ out }), /QA 没过/);
  assert.doesNotThrow(() => approve({ out, allowQaFail: true }));
  console.log('verify-render ok');
} finally {
  rmSync(out, { recursive: true, force: true });
}
