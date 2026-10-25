import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const M = require('./mapstage-story.js');
const hexi = JSON.parse(readFileSync(join(here, '..', '..', 'site', 'examples', 'story-hexi.json'), 'utf8'));
const schema = JSON.parse(readFileSync(join(here, '..', '..', 'schemas', 'story.schema.json'), 'utf8'));
const clone = (x) => JSON.parse(JSON.stringify(x));

// 极简 JSON Schema 子集校验（type/enum/const/required/properties/items/min/max/pattern/oneOf/$ref）
function check(sch, v, path, errs) {
  if (sch.$ref) sch = sch.$ref.split('/').slice(1).reduce((o, k) => o[k], schema);
  if (sch.oneOf) {
    const hits = sch.oneOf.filter((s) => { const e = []; check(s, v, path, e); return !e.length; });
    if (hits.length !== 1) errs.push(path + ': oneOf matched ' + hits.length);
    return;
  }
  if ('const' in sch && v !== sch.const) errs.push(path + ': const');
  if (sch.enum && !sch.enum.includes(v)) errs.push(path + ': enum ' + v);
  if (sch.type) {
    const ok = sch.type === 'array' ? Array.isArray(v) : sch.type === 'object' ? v && typeof v === 'object' && !Array.isArray(v) : typeof v === sch.type;
    if (!ok) { errs.push(path + ': type ' + sch.type); return; }
  }
  if (typeof v === 'number') {
    if (sch.minimum != null && v < sch.minimum) errs.push(path + ': minimum');
    if (sch.maximum != null && v > sch.maximum) errs.push(path + ': maximum');
    if (sch.exclusiveMinimum != null && v <= sch.exclusiveMinimum) errs.push(path + ': exclusiveMinimum');
  }
  if (typeof v === 'string' && sch.pattern && !new RegExp(sch.pattern).test(v)) errs.push(path + ': pattern');
  if (Array.isArray(v)) {
    if (sch.minItems != null && v.length < sch.minItems) errs.push(path + ': minItems');
    if (sch.maxItems != null && v.length > sch.maxItems) errs.push(path + ': maxItems');
    if (sch.items) v.forEach((x, i) => check(sch.items, x, path + '[' + i + ']', errs));
  } else if (v && typeof v === 'object') {
    (sch.required || []).forEach((k) => { if (!(k in v)) errs.push(path + ': missing ' + k); });
    Object.keys(sch.properties || {}).forEach((k) => { if (k in v) check(sch.properties[k], v[k], path + '.' + k, errs); });
  }
}
function schemaErrors(story) { const e = []; check(schema, story, '$', e); return e; }

function rejects(story, re) {
  assert.throws(() => M.validateStory(story), (e) => {
    assert.equal(e.name, 'StoryValidationError');
    assert.ok(Array.isArray(e.errors) && e.errors.length > 0);
    assert.match(e.message, re, e.message);
    return true;
  });
}

// 示例 story 通过 schema 与 validateStory
assert.deepEqual(schemaErrors(hexi), [], 'hexi example matches story.schema.json');
assert.deepEqual(M.validateStory(hexi), { ok: true, errors: [] });
{
  const bad = clone(hexi);
  bad.routes[0].role = 'main';
  assert.ok(schemaErrors(bad).length > 0, 'schema catches bad role enum');
}

// 引用完整
{
  const s = clone(hexi); s.routes[0].via[1] = 'nowhere';
  rejects(s, /不存在的地点 nowhere/);
  const b = clone(hexi); b.beats[0].active = ['ghost-city'];
  rejects(b, /beats\[0\]\.active.*ghost-city/);
  const f = clone(hexi); f.shots[1].fit = ['wuwei', 'ghost-city'];
  rejects(f, /shots\[1\].*ghost-city/);
  const r = clone(hexi); r.shots[1].fit = 'route:nope';
  rejects(r, /不存在的路线 nope/);
}

// C 级必须 approx
{
  const s = clone(hexi);
  s.sites.find((x) => x.id === 'yumen-han').approx = false;
  rejects(s, /confidence C.*approx/);
  const t = clone(hexi);
  delete t.sites.find((x) => x.id === 'yumen-han').approx;
  rejects(t, /confidence C.*approx/);
}

// 同屏上限
{
  const s = clone(hexi);
  s.routes.push({ id: 'p2', side: 'red', role: 'primary', via: ['wuwei', 'zhangye'], draw: [2, 5], hold: 5 });
  rejects(s, /主线路线 同屏 2 个，上限 1/);
  const r = clone(hexi);
  ['a', 'b'].forEach((id) => r.routes.push({ id, side: 'enemy', role: 'reaction', via: ['wuwei', 'zhangye'], draw: [4.6, 6], hold: 6.2 }));
  rejects(r, /敌方反应路线 同屏 3 个，上限 2/);
  const a = clone(hexi);
  a.beats[2].active = ['jiuquan', 'jiayuguan', 'dunhuang'];
  rejects(a, /active 地名 同屏 3 个，上限 2/);
  const n = clone(hexi);
  for (let i = 0; i < 3; i++) n.cards.push({ t0: 14, t1: 15, kind: 'name', text: 'N' + i });
  rejects(n, /部队名牌 同屏 3 个，上限 2/);
}

// hold 不越段
{
  const s = clone(hexi);
  s.routes.push({ id: 'p2', side: 'red', role: 'primary', via: ['dunhuang', 'yumen-han'], draw: [12.5, 14], hold: 14 });
  s.routes[0].hold = 13; // 12.5 开始画下一段，上一段还没收
  rejects(s, /hold 13 越进下一段 p2/);
  const ok = clone(s); ok.routes[0].hold = 12.5;
  assert.equal(M.validateStory(ok).ok, true);
  const early = clone(hexi); early.routes[0].hold = 5;
  rejects(early, /hold \(5\) 不能早于画完时刻/);
}

// 一句一动
{
  const s = clone(hexi);
  s.shots[1].t = 1.5; // 与 t=0 只隔 1.5s < move 2.2
  rejects(s, /只隔 1\.50s，小于 move 2\.2s/);
  const m = clone(hexi); m.shots[2].move = 5; // 9.0-5.0=4.0 < 5
  rejects(m, /小于 move 5s/);
}

// 字卡专门版式的字段校验：四种卡都要通过 schema 与 validateStory，缺字段则拒绝
{
  const good = clone(hexi);
  good.cards.push(
    { t0: 1, t1: 5, kind: 'table', text: 'T', header: ['A', 'B'], rows: [['a1', 'b1'], ['a2', 'b2']] },
    { t0: 1, t1: 5, kind: 'photo', text: 'P', sub: '出处', src: 'x.jpg' },
    { t0: 1, t1: 5, kind: 'telegram', text: 'line1\nline2', sub: 'who · when' },
    { t0: 1, t1: 5, kind: 'doc', text: 'D', lines: ['l1', 'l2'], sub: '落款', seal: '章' },
  );
  assert.deepEqual(schemaErrors(good), [], 'new card fields match schema');
  assert.equal(M.validateStory(good).ok, true);

  const noSrc = clone(good); delete noSrc.cards[noSrc.cards.length - 3].src;
  rejects(noSrc, /photo 必须给 src/);
  const noRows = clone(good); delete noRows.cards[noRows.cards.length - 4].rows;
  rejects(noRows, /table 必须给 rows/);
  const ragged = clone(good); ragged.cards[ragged.cards.length - 4].rows[1] = ['only-one'];
  rejects(ragged, /table 每行列数必须一致/);
  const badHeader = clone(good); badHeader.cards[badHeader.cards.length - 4].header = ['A'];
  rejects(badHeader, /table\.header 必须是 2 个字符串/);
  const badLines = clone(good); badLines.cards[badLines.cards.length - 1].lines = 'not an array';
  rejects(badLines, /lines 必须是非空的字符串数组/);
}

// 一次列全
{
  const s = clone(hexi);
  s.routes[0].via = ['x1', 'x2'];
  s.shots[0].fit = ['x3'];
  try { M.validateStory(s); assert.fail('should throw'); } catch (e) { assert.ok(e.errors.length >= 3, 'every problem listed: ' + e.errors.length); }
  rejects({ version: 2, duration: 5 }, /version 必须是 1/);
  rejects(null, /story 必须是对象/);
}

// 地名三态
{
  const st0 = M.labelStates(hexi, 0);
  assert.equal(st0.wuwei, 'active');
  assert.equal(st0.zhangye, 'dim', 'not yet told');
  const st5 = M.labelStates(hexi, 5);
  assert.equal(st5.wuwei, 'normal', 'told labels stay');
  assert.equal(st5.zhangye, 'active');
  const st7 = M.labelStates(hexi, 7);
  assert.equal(st7.jiuquan, 'active');
  assert.equal(st7.jiayuguan, 'active');
  assert.equal(st7.zhangye, 'normal');
  assert.equal(M.labelStates(hexi, 15.9).wuwei, 'normal');
  assert.equal(M.labelStates(hexi, 15.9)['yumen-han'], 'active');
}

// 同屏计数 / 路线时间窗
{
  assert.deepEqual(M.countsAt(hexi, 0.5), { primary: 0, reaction: 0, active: 1, names: 1 });
  assert.equal(M.countsAt(hexi, 5).primary, 1);
  assert.equal(M.countsAt(hexi, 5).reaction, 1);
  assert.equal(M.countsAt(hexi, 12.5).primary, 0, 'hold 12 collected before 12.5');
  assert.deepEqual(M.routeWindow({ role: 'residual', draw: [2, 4] }, 10), [2, 11]);
  assert.equal(M.routeWindow({ role: 'callout', draw: [2, 4] }, 10), null);
}

// 几何（自 stage-kit 迁入）
{
  const w = [[102.64, 37.93], [100.45, 38.93], [98.49, 39.73], [94.66, 40.14]];
  const total = M.sliceRoute(w, 1).totalKm;
  assert.ok(total > 700 && total < 850);
  assert.ok(Math.abs(M.sliceRoute(w, 0.5).km - total / 2) < 1e-6, 'progress is by distance');
  assert.deepEqual(M.sliceRoute(w, 2).head, w[3]);
  assert.deepEqual(M.safePadding(1920, 1080), { left: 115, top: 238, right: 115, bottom: 238 });
  const shots = [{ t: 0, center: [100, 30], zoom: 4, push: 0.2 }, { t: 10, center: [110, 30], zoom: 6, move: 2 }];
  assert.ok(M.cameraAt(shots, 7.9).zoom > 4.19);
  const mid = M.cameraAt(shots, 9);
  assert.ok(mid.center[0] > 104 && mid.center[0] < 106);
  assert.deepEqual(M.cameraAt(shots, 99).center, [110, 30]);
  // curve:auto 只给两点 / 近共线加弧，真实线形不动
  assert.equal(M.shapeRoute([[100, 30], [110, 30]], 'auto').length, 33);
  assert.equal(M.shapeRoute(w, 'auto').length, 4);
  assert.equal(M.shapeRoute([[100, 30], [110, 30]], 'none').length, 2);
  assert.equal(M.shapeRoute([[100, 30], [105, 30.1], [110, 30]], 'auto').length, 33);
}

// 十段线：10 段，都在南海 / 台湾以东；compliance.tenDash 只接受布尔
{
  assert.equal(M.TEN_DASH.length, 10, 'ten dashes');
  M.TEN_DASH.forEach(function (l, i) {
    assert.ok(l.length >= 2, 'dash ' + i + ' has a segment');
    l.forEach(function (p) { assert.ok(p[0] > 107 && p[0] < 124 && p[1] > 3 && p[1] < 25, 'dash ' + i + ' in SCS: ' + p); });
  });
  assert.ok(M.TEN_DASH.some(function (l) { return l[0][0] > 122.5 && l[0][1] > 23; }), 'dash east of Taiwan');
  assert.ok(M.TEN_DASH.some(function (l) { return l.some(function (p) { return p[1] < 4; }); }), 'southern dash near Zengmu');
  const s = clone(hexi);
  s.compliance = Object.assign({}, s.compliance, { tenDash: 'no' });
  rejects(s, /compliance.tenDash/);
  s.compliance.tenDash = false;
  assert.equal(M.validateStory(s).ok, true);
  assert.deepEqual(schemaErrors(s), []);
}

// fitCamera：计入俯仰 / 朝向，所有点落进安全区；确定性
{
  const W = 661, H = 371;
  const pad = M.safePadding(W, H);
  const hexiRoute = [[102.64, 37.93], [100.45, 38.93], [98.49, 39.73], [94.66, 40.14]];
  const cam0 = { center: [98, 38], zoom: 6, pitch: 50, bearing: 20 };
  const back = M.unprojectGround(M.projectGround([100, 39], cam0, 800, 600), cam0, 800, 600);
  assert.ok(Math.abs(back[0] - 100) < 1e-9 && Math.abs(back[1] - 39) < 1e-9, 'unproject inverts project');
  const c = M.projectGround(cam0.center, cam0, 800, 600);
  assert.ok(Math.abs(c.x - 400) < 1e-9 && Math.abs(c.y - 300) < 1e-9, 'center at screen center');
  for (const pitch of [0, 20, 40, 60, 75]) {
    for (const bearing of [0, 30, -120]) {
      const cam = M.fitCamera(hexiRoute, { width: W, height: H, padding: pad, pitch, bearing });
      assert.equal(cam.pitch, pitch);
      assert.equal(cam.bearing, bearing);
      const px = hexiRoute.map((p) => M.projectGround(p, cam, W, H));
      px.forEach((q, i) => {
        assert.ok(q && q.x >= pad.left - 0.5 && q.x <= W - pad.right + 0.5 && q.y >= pad.top - 0.5 && q.y <= H - pad.bottom + 0.5,
          'pitch ' + pitch + ' bearing ' + bearing + ' pt ' + i + ' in safe area: ' + JSON.stringify(q));
      });
      // 贴边：至少一侧顶住安全区（没有无谓地拉远）
      const xs = px.map((q) => q.x), ys = px.map((q) => q.y);
      const gap = Math.min(Math.min(...xs) - pad.left, W - pad.right - Math.max(...xs), Math.min(...ys) - pad.top, H - pad.bottom - Math.max(...ys));
      assert.ok(gap < 1, 'tight fit pitch ' + pitch + ' bearing ' + bearing + ' gap ' + gap);
      assert.deepEqual(M.fitCamera(hexiRoute, { width: W, height: H, padding: pad, pitch, bearing }), cam, 'deterministic');
    }
  }
  // 单点 / maxZoom 封顶
  const one = M.fitCamera([[100, 38]], { width: W, height: H, padding: pad, pitch: 40, maxZoom: 7 });
  assert.equal(one.zoom, 7);
  const p1 = M.projectGround([100, 38], one, W, H);
  assert.ok(Math.abs(p1.x - W / 2) < 0.01 && Math.abs(p1.y - H / 2) < 0.01, 'single point centred');
  assert.deepEqual(M.normPadding(10), { left: 10, top: 10, right: 10, bottom: 10 });
}

console.log('mapstage-story.test ok');
