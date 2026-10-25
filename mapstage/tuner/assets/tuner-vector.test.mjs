import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const VP = require('./vector-paint.js');
const TV = require('./tuner-vector.js');
const params = require('./tuner-params.js');

const tileCfg = {
  terrain: {
    enabled: true,
    tiles: ['https://example.test/terrarium/{z}/{x}/{y}.png'],
    tileSize: 256,
    maxzoom: 15,
    encoding: 'terrarium',
  },
};

// ---- normalizeVector：默认全关，坏输入被清掉 ----
const d = params.DEFAULT_PARAMS.vector;
assert.equal(d.relief, false);
assert.equal(d.landcover, false);
assert.equal(d.contour, false);
assert.equal(d.paint, null);
assert.equal(d.elevStops, null);

const n = params.normalizeVector({
  relief: true,
  contour: 'yes',
  reliefOpacity: 7,
  paint: { wood: '#ABCDEF', grass: 'red', __proto__: { x: 1 }, constructor: '#000000' },
  elevStops: [
    { h: 100, color: '#111111', label: 'b' },
    { h: 0, color: '#222222' },
    { h: 100, color: '#333333' },
    { h: 'x', color: '#444444' },
    { h: 5, color: 'blue' },
  ],
});
assert.equal(n.relief, true);
assert.equal(n.contour, false, 'non-boolean switch ignored');
assert.equal(n.reliefOpacity, 1, 'opacity clamped to 1');
assert.deepEqual(n.paint, { wood: '#abcdef' }, 'only valid hex colors survive');
assert.deepEqual(
  n.elevStops.map((s) => s.h),
  [0, 100],
  'stops sorted, duplicates and junk dropped'
);
assert.equal(params.normalizeVector(null).relief, false);
assert.equal(params.normalizeVector({ elevStops: [{ h: 1, color: '#000000' }] }).elevStops, null, 'one stop is not a ramp');

// ---- mergeParams 带 vector 往返；旧预设没有该块 ----
const merged = params.mergeParams(params.DEFAULT_PARAMS, { vector: { landcover: true } });
assert.equal(merged.vector.landcover, true);
assert.equal(params.mergeParams(params.DEFAULT_PARAMS, {}).vector.landcover, false);
assert.equal(params.DEFAULT_PARAMS.vector.landcover, false, 'mergeParams does not mutate the base');

// ---- 色值行：不含境界 / 建筑 / 由水系面板驱动的水系色 ----
const keys = TV.colorRows(VP).map((f) => f.key);
['boundary', 'boundaryProvince', 'building', 'waterway', 'waterRiver'].forEach((k) =>
  assert.ok(!keys.includes(k), k + ' hidden from Studio color list')
);
['wood', 'waterOcean', 'highway', 'rail'].forEach((k) => assert.ok(keys.includes(k), k + ' shown'));

// ---- 生效配色：自定义 > 皮肤 > 默认 ----
const skin = VP.SKINS[1] || VP.SKINS[0];
assert.equal(TV.effectivePaint(VP, { paint: null }, skin.id).wood, VP.normalizePaint(skin.paint).wood);
assert.equal(TV.effectivePaint(VP, { paint: { wood: '#010203' } }, skin.id).wood, '#010203');
assert.equal(TV.effectivePaint(VP, null, '').wood, VP.normalizePaint(VP.DEFAULT_PAINT).wood);

// ---- baseParts：relief + 地表层，无境界线，开关只改 visibility ----
function parts(over) {
  const p = JSON.parse(JSON.stringify(params.DEFAULT_PARAMS));
  Object.assign(p.vector, over || {});
  return TV.baseParts(VP, tileCfg, p);
}
const off = parts();
const ids = off.layers.map((l) => l.id);
assert.equal(ids[0], 'vl-relief', 'relief first');
VP.LANDCOVER_NATIVE_IDS.forEach((id) => assert.ok(ids.includes(id), id + ' present'));
assert.ok(!ids.some((id) => /boundary|building|-far$|polar|hillshade/.test(id)), 'no boundary / far / building layers: ' + ids.join());
assert.ok(off.layers.every((l) => l.layout.visibility === 'none'), 'all hidden by default');
assert.ok(off.sources.terrainVisual && off.sources.openmaptiles, 'sources provided');
assert.equal(off.sources.terrainVisual.type, 'raster-dem');

const on = parts({ relief: true, landcover: true, reliefOpacity: 0.4 });
const relief = on.layers.find((l) => l.id === 'vl-relief');
assert.equal(relief.layout.visibility, 'visible');
assert.equal(relief.paint['color-relief-opacity'], 0.4);
assert.equal(relief.paint['color-relief-color'][0], 'interpolate');
assert.equal(on.layers.find((l) => l.id === 'vl-wood').layout.visibility, 'visible');

const customStops = [
  { h: 0, color: '#000000', label: 'a' },
  { h: 1000, color: '#ffffff', label: 'b' },
];
const custom = parts({ relief: true, elevStops: customStops });
assert.deepEqual(
  custom.layers[0].paint['color-relief-color'],
  ['interpolate', ['linear'], ['elevation'], 0, '#000000', 1000, '#ffffff']
);

// 地球投影：设色不画（与 vector-layers 页一致）
const globeParams = JSON.parse(JSON.stringify(params.DEFAULT_PARAMS));
globeParams.ui.viewMode = 'globe';
globeParams.vector.relief = true;
assert.equal(
  TV.baseParts(VP, tileCfg, globeParams).layers[0].layout.visibility,
  'none',
  'relief hidden on globe'
);

// 没有 DEM 时不凭空生成视觉 DEM / relief
const noDem = TV.baseParts(VP, { terrain: { enabled: false } }, JSON.parse(JSON.stringify(params.DEFAULT_PARAMS)));
assert.ok(!noDem.sources.terrainVisual && !noDem.layers.some((l) => l.id === 'vl-relief'));


// 底图样式：色阶升序且覆盖海与海岸，山影强度不超 MapLibre 上限，皮肤存在
TV.BASEMAP_STYLES.forEach((style) => {
  assert.ok(VP.SKINS.some((sk) => sk.id === style.skinId), style.id + ' skin exists');
  assert.ok(style.hillshade.exaggeration <= 1, style.id + ' hillshade within cap');
  if (!style.stops) return;
  const hs = style.stops.map((s) => s[0]);
  assert.ok(hs.every((h, i) => i === 0 || h > hs[i - 1]), style.id + ' stops ascend');
  assert.ok(hs[0] < 0 && hs.includes(0), style.id + ' stops cover sea and coast');
});
{
  const p = params.mergeParams(params.DEFAULT_PARAMS, {});
  const style = TV.applyBasemapParams(p, 'ink');
  assert.equal(style.skinId, 'ink');
  assert.equal(p.maplibre.satellite.opacity, 0, 'non-satellite basemap hides satellite');
  assert.equal(p.vector.relief, true);
  assert.equal(p.vector.elevStops[0].h, -4000);
  assert.equal(p.ui.basemapId, 'ink');
  assert.equal(params.mergeParams(params.DEFAULT_PARAMS, { vector: p.vector }).vector.elevStops.length, p.vector.elevStops.length, 'style stops survive normalizeVector');
  TV.applyBasemapParams(p, 'satellite');
  assert.equal(p.vector.relief, false);
  assert.equal(p.vector.elevStops, null);
  assert.equal(p.maplibre.satellite.opacity, 0.7);
  assert.equal(TV.applyBasemapParams(p, 'nope'), null);
}
// 夜景：开灯、关普通路网；切回其他样式灯光关闭、路网恢复
{
  const p = params.mergeParams(params.DEFAULT_PARAMS, {});
  assert.equal(p.vector.lights, false, 'lights default off');
  TV.applyBasemapParams(p, 'nightlights');
  assert.equal(p.vector.lights, true);
  assert.equal(p.ui.showRoads, false);
  assert.equal(params.mergeParams(params.DEFAULT_PARAMS, { vector: p.vector }).vector.lights, true, 'lights survives normalizeVector');
  const lp = TV.lightsParts(VP, p);
  assert.deepEqual(lp.layers.map((l) => l.id), TV.LIGHT_IDS);
  assert.ok(lp.layers.every((l) => l.source === VP.SOURCE_ID && l.layout.visibility === 'visible'));
  TV.applyBasemapParams(p, 'atlas');
  assert.equal(p.vector.lights, false);
  assert.equal(p.ui.showRoads, true);
  assert.ok(TV.lightsParts(VP, p).layers.every((l) => l.layout.visibility === 'none'));
}
// 真实夜光：配置解析、墨卡托重投影行映射、夜景样式开关
{
  const def = TV.resolveNightConfig(undefined);
  assert.equal(def.image, 'assets/night-lights.png', 'default night source is the baked GeoNames image');
  assert.deepEqual(def.bounds, [60, -2, 150, 56]);
  assert.deepEqual(TV.nightSourceSpec(def).coordinates, [[60, 56], [150, 56], [150, -2], [60, -2]]);
  const nasa = TV.resolveNightConfig({ image: 'https://x/earth_lights_2048.png' });
  assert.equal(nasa.bounds, null, 'custom image without bounds is reprojected as equirect');
  assert.equal(TV.nightSourceSpec(nasa, 'data:x').coordinates[0][1] > 85, true);
  assert.equal(TV.resolveNightConfig(false), null);
  assert.equal(TV.resolveNightConfig({ enabled: false }), null);
  const tiled = TV.resolveNightConfig({ tiles: ['https://x/{z}/{y}/{x}.png'], image: 'a.png' });
  assert.equal(tiled.image, '', 'tiles win over image');
  assert.equal(TV.nightSourceSpec(tiled).type, 'raster');
  assert.equal(TV.nightSourceSpec(def).type, 'image');
  assert.ok(Math.abs(TV.mercatorRowLat(0, 2048) - 85.05) < 0.2, 'top row near 85N');
  assert.ok(Math.abs(TV.mercatorRowLat(1024, 2048)) < 0.2, 'middle row near equator');
  assert.equal(TV.equirectRowForLat(90, 1024), 0);
  assert.equal(TV.equirectRowForLat(-90, 1024), 1023);
  assert.equal(TV.equirectRowForLat(0, 1024), 512);
  const p = params.mergeParams(params.DEFAULT_PARAMS, {});
  assert.equal(p.vector.nightRaster, false);
  TV.applyBasemapParams(p, 'nightlights');
  assert.equal(p.vector.nightRaster, true);
  assert.equal(p.ui.showWater, false);
  assert.equal(params.mergeParams(params.DEFAULT_PARAMS, { vector: p.vector }).vector.nightRaster, true);
  assert.notEqual(typeof TV.lightsParts(VP, p).layers[2].paint['heatmap-opacity'], 'number', 'glow fades in when raster is on');
  TV.applyBasemapParams(p, 'atlas');
  assert.equal(p.vector.nightRaster, false);
  assert.equal(p.ui.showWater, true);
}
console.log('tuner-vector.test.mjs ok');
