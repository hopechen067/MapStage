// 叙事运行时的底图样式（look.basemap / preset.ui.basemapId / preset.vector）与夜光：纯函数部分
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const VP = require('./vector-paint.js');
const TV = require('./tuner-vector.js');
const M = require('./mapstage-story.js');
const hexi = JSON.parse(readFileSync(join(here, '..', '..', 'site', 'examples', 'story-hexi.json'), 'utf8'));
const schema = JSON.parse(readFileSync(join(here, '..', '..', 'schemas', 'story.schema.json'), 'utf8'));
const clone = (x) => JSON.parse(JSON.stringify(x));
const style = (id) => TV.BASEMAP_STYLES.find((s) => s.id === id);
const story = (look) => Object.assign(clone(hexi), { look });

function rejects(s, re) {
  assert.throws(() => M.validateStory(s), (e) => { assert.match(e.message, re, e.message); return true; });
}

function build(look, night) {
  const st = VP.buildStyle({ paint: VP.SKINS[0].paint, tileConfig: { terrain: VP.DEM_PRESETS.mapterhorn } });
  st.layers = st.layers.filter((l) => !/^vl-boundary/.test(l.id));
  return M.applyLookToStyle(st, look, { VP, TV, night });
}
const layer = (st, id) => st.layers.find((l) => l.id === id);
const vis = (st, id) => (layer(st, id).layout || {}).visibility || 'visible';

// ── 没有底图：外观与以前完全一样 ─────────────────────────
{
  assert.deepEqual(M.resolveLook({}, hexi), { basemap: null, skinId: 'parchment' });
  assert.equal(M.resolveLook({ ui: { skinId: 'aged' } }, story({ skin: 'ink' })).skinId, 'aged', 'preset 皮肤仍优先于 story.look.skin');
  assert.equal(M.resolveLook({}, story({ skin: 'ink' })).skinId, 'ink');
  // Studio 默认导出的 satellite + 默认 vector：按原外观
  const sat = M.resolveLook({ ui: { basemapId: 'satellite', skinId: 'parchment' }, vector: { relief: false, lights: false } }, hexi);
  assert.equal(sat.basemap, null);
  assert.equal(M.wantsBasemap({ ui: { basemapId: 'satellite' }, vector: { relief: false } }, hexi), false);
  const before = JSON.stringify(build(null));
  assert.equal(JSON.stringify(build(M.resolveLook({}, hexi))), before, 'basemap: null 不改 style');
}

// ── story.look.basemap ───────────────────────────────────
{
  const n = M.resolveLook({}, story({ basemap: 'nightlights' }));
  const s = style('nightlights');
  assert.equal(n.basemap, 'nightlights');
  assert.equal(n.skinId, s.skinId);
  assert.equal(n.dark, true);
  assert.equal(n.relief, true);
  assert.equal(n.lights, true);
  assert.equal(n.nightRaster, true);
  assert.equal(n.water, false, '夜景不画水系');
  assert.deepEqual(n.elevStops.map((x) => [x.h, x.color]), s.stops);
  assert.deepEqual(n.hillshade, s.hillshade);
  assert.equal(M.wantsBasemap({}, story({ basemap: 'nightlights' })), true);

  const q = M.resolveLook({}, story({ basemap: 'qinglv' }));
  assert.equal(q.skinId, 'silk');
  assert.equal(q.lights, false);
  assert.equal(q.water, true);
  assert.equal(q.dark, false);
  assert.equal(M.resolveLook({}, story({ basemap: 'qinglv', skin: 'ink' })).skinId, 'ink', 'look.skin 可以覆盖底图配套皮肤');
  // 每个非卫星样式都能解析且开了海拔设色
  TV.BASEMAP_STYLES.filter((b) => !b.satellite).forEach((b) => {
    const l = M.resolveLook({}, story({ basemap: b.id }));
    assert.equal(l.relief, true, b.id);
    assert.equal(l.skinId, b.skinId, b.id);
  });
}

// ── 十段线深浅：按实际海面判断，不看皮肤 id（PR #34 评审）───────
{
  const visible = (l) => M.contrastRatio(l.dark ? M.TEN_DASH_LIGHT : M.TEN_DASH_INK, l.sea);
  // 夜景 / 暗夜配别的皮肤：海面仍是近黑色阶，十段线要浅色
  ['parchment', 'aged', 'ink', 'silk'].forEach((skin) => {
    const n = M.resolveLook({}, story({ basemap: 'nightlights', skin }));
    assert.equal(n.skinId, skin);
    assert.equal(n.dark, true, 'nightlights + ' + skin);
  });
  // 亮海（宣纸蓝海）上保持深色；配暗夜皮肤的蓝海偏暗 → 浅色
  assert.equal(M.resolveLook({}, story({ basemap: 'natural' })).dark, false);
  assert.equal(M.resolveLook({}, story({ basemap: 'paper' })).dark, false);
  assert.equal(M.resolveLook({}, story({ basemap: 'qinglv' })).dark, false);
  assert.equal(M.resolveLook({}, story({ basemap: 'natural', skin: 'night' })).dark, true);
  // 自定义色阶：近黑海 + 不画水系 → 浅色；亮海 → 深色
  const pv = (stops) => ({ ui: { basemapId: null, skinId: 'night', showWater: false }, vector: { relief: true, elevStops: stops } });
  assert.equal(M.resolveLook(pv([{ h: -2000, color: '#050505' }, { h: 0, color: '#eeeeee' }]), hexi).dark, true);
  assert.equal(M.resolveLook(pv([{ h: -2000, color: '#b0c8d8' }, { h: 0, color: '#222222' }]), hexi).dark, false);
  // 任何底图 × 皮肤组合，选中的十段线颜色与海面对比度都不低于阈值
  TV.BASEMAP_STYLES.filter((b) => !b.satellite).forEach((b) => {
    [undefined].concat(VP.SKINS.map((s) => s.id)).forEach((skin) => {
      const l = M.resolveLook({}, story({ basemap: b.id, skin }));
      assert.ok(visible(l) >= 1.65, b.id + ' + ' + skin + '：对比度 ' + visible(l).toFixed(2));
    });
  });
}

// ── preset 兼容：ui.basemapId + vector.* ────────────────
{
  const stops = [{ h: 0, color: '#112233' }, { h: 3000, color: '#445566' }];
  const preset = {
    ui: { basemapId: 'qinglv', skinId: 'aged', showWater: false },
    vector: { relief: true, reliefOpacity: 0.8, elevStops: stops, lights: false, nightRaster: false },
    maplibre: { hillshade: { exaggeration: 0.3, shadowColor: '#010101', highlightColor: '#fefefe', accentColor: '#777777', illuminationDirection: 200 } },
  };
  const p = M.resolveLook(preset, hexi);
  assert.equal(p.basemap, 'qinglv');
  assert.equal(p.skinId, 'aged');
  assert.deepEqual(p.elevStops, stops, 'preset 里的实际色阶优先');
  assert.equal(p.reliefOpacity, 0.8);
  assert.equal(p.water, false);
  assert.deepEqual(p.hillshade, { exaggeration: 0.3, shadowColor: '#010101', highlightColor: '#fefefe', accentColor: '#777777' });
  // story 指定了别的底图：preset 的 vector / 皮肤不带过去
  const o = M.resolveLook(preset, story({ basemap: 'nightlights' }));
  assert.equal(o.basemap, 'nightlights');
  assert.equal(o.skinId, 'night');
  assert.deepEqual(o.elevStops.map((x) => [x.h, x.color]), style('nightlights').stops);
  // 同一底图：preset 值照用
  assert.deepEqual(M.resolveLook(preset, story({ basemap: 'qinglv' })).elevStops, stops);
  // Studio 里改过色阶（basemapId 被清成 null）：照 preset.vector 画
  const c = M.resolveLook({ ui: { basemapId: null, skinId: 'ink' }, vector: { relief: true, elevStops: stops } }, hexi);
  assert.equal(c.basemap, null);
  assert.equal(c.relief, true);
  assert.equal(c.skinId, 'ink');
  assert.deepEqual(c.elevStops, stops);
}

// ── applyLookToStyle ─────────────────────────────────────
{
  const night = M.nightSpec(undefined, 'http://x/studio/');
  const st = build(M.resolveLook({}, story({ basemap: 'nightlights' })), night);
  const relief = layer(st, 'vl-relief');
  assert.equal(vis(st, 'vl-relief'), 'visible');
  assert.deepEqual(relief.paint['color-relief-color'], VP.elevationColorExpr(style('nightlights').stops.map((s) => ({ h: s[0], color: s[1] }))));
  const hs = layer(st, 'vl-hillshade').paint;
  assert.equal(hs['hillshade-shadow-color'], '#000000');
  assert.equal(hs['hillshade-highlight-color'], '#4a5060');
  assert.equal(hs['hillshade-exaggeration'], 0.45);
  VP.LANDCOVER_NATIVE_IDS.forEach((id) => assert.equal(vis(st, id), 'none', id));
  assert.equal(vis(st, 'vl-water-ocean'), 'none');
  // 夜光栅格紧贴山影之上，矢量灯光在最上
  const ids = st.layers.map((l) => l.id);
  assert.equal(ids[ids.indexOf('vl-hillshade') + 1], TV.NIGHT_LAYER_ID);
  assert.deepEqual(st.sources[TV.NIGHT_SOURCE_ID], night);
  assert.deepEqual(ids.slice(-3), TV.LIGHT_IDS);
  TV.LIGHT_IDS.forEach((id) => assert.equal(vis(st, id), 'visible', id));
  assert.deepEqual(layer(st, 'vl-lights-glow').paint['heatmap-opacity'], TV.glowOpacity(true));
  assert.equal(layer(st, TV.NIGHT_LAYER_ID).paint['raster-fade-duration'], 0, '夜光不淡入，逐帧确定');
  // 合规：没有境界线图层；新图层 id 也不像境界线
  assert.ok(!st.layers.some((l) => /boundary|admin/.test(l.id) || l['source-layer'] === 'boundary'));
  assert.ok(!Object.keys(st.sources).some((k) => /boundary|admin/.test(k)));

  // 夜光图失败（night = null）：只剩矢量灯光，光晕回到全强度
  const st2 = build(M.resolveLook({}, story({ basemap: 'nightlights' })), null);
  assert.ok(!st2.layers.some((l) => l.id === TV.NIGHT_LAYER_ID));
  assert.equal(layer(st2, 'vl-lights-glow').paint['heatmap-opacity'], TV.glowOpacity(false));

  // 青绿：有水系、无灯光
  const q = build(M.resolveLook({}, story({ basemap: 'qinglv' })), night);
  assert.equal(vis(q, 'vl-water-ocean'), 'visible');
  assert.ok(!q.layers.some((l) => /^vl-lights|night-lights/.test(l.id)));
  assert.ok(!q.sources[TV.NIGHT_SOURCE_ID]);
}

// ── 夜光数据源 ───────────────────────────────────────────
{
  const d = M.nightSpec(undefined, 'http://x/studio/');
  assert.equal(d.type, 'image');
  assert.equal(d.url, 'http://x/studio/assets/night-lights.png');
  assert.deepEqual(d.coordinates, [[60, 56], [150, 56], [150, -2], [60, -2]]);
  assert.equal(M.nightSpec(false), null);
  assert.equal(M.nightSpec({ enabled: false }), null);
  assert.equal(M.nightSpec({ image: 'https://e/x.png' }), null, '等经纬图要浏览器重投影，同步版不支持');
  const t = M.nightSpec({ tiles: ['https://t/{z}/{y}/{x}.png'] });
  assert.equal(t.type, 'raster');
  // 合规：默认夜光图范围盖住台湾、海南、南海诸岛
  const b = TV.resolveNightConfig().bounds;
  M.COMPLIANCE_POINTS.forEach((c) => c.pts.forEach((p) => {
    assert.ok(p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3], c.id + ' ' + p);
  }));
  M.TEN_DASH.forEach((l) => l.forEach((p) => assert.ok(p[1] >= b[1] && p[0] <= b[2], 'ten-dash ' + p)));
}

// ── 校验 + schema ────────────────────────────────────────
{
  assert.equal(M.validateStory(story({ basemap: 'nightlights' })).ok, true);
  assert.equal(M.validateStory(story({ basemap: 'paper', skin: 'aged', terrain: 1.2 })).ok, true);
  rejects(story({ basemap: 'neon' }), /look\.basemap 不认识/);
  rejects(story({ basemap: 'satellite' }), /没有卫星底图/);
  rejects(story({ basemap: 3 }), /look\.basemap 必须是字符串/);
  rejects(Object.assign(clone(hexi), { look: [] }), /look 必须是对象/);
  const ids = TV.BASEMAP_STYLES.filter((b) => !b.satellite).map((b) => b.id);
  assert.deepEqual(schema.properties.look.properties.basemap.enum, ids, 'schema 枚举与 BASEMAP_STYLES 同步');
}

console.log('mapstage-look.test ok');
