/**
 * tuner-util / tuner-params contract.
 *
 * tuner-app.js destructures these modules at the top of its IIFE; a name the
 * module forgot to export would be `undefined` at runtime and only fail when
 * that code path runs. Check every destructured name, then pin a few pure
 * behaviours the tuner relies on.
 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const util = require(join(here, 'tuner-util.js'));
const params = require(join(here, 'tuner-params.js'));
const modules = { AntiqueTunerUtil: util, AntiqueTunerParams: params };

// --- every name tuner-app.js pulls from a module is exported -------------
const app = readFileSync(join(here, 'tuner-app.js'), 'utf8');
const blocks = [...app.matchAll(/const \{([^}]+)\} = window\.(AntiqueTuner\w+);/g)];
assert.equal(blocks.length, 2, 'tuner-app.js destructures util and params');
for (const [, names, global] of blocks) {
  assert.ok(modules[global], 'unknown module ' + global);
  for (const name of names.split(',').map((s) => s.trim()).filter(Boolean)) {
    assert.notEqual(modules[global][name], undefined, global + '.' + name + ' is not exported');
  }
}

// --- index.html loads the modules before the app ---------------------------
const html = readFileSync(join(here, '..', 'index.html'), 'utf8');
const order = ['tuner-util.js', 'tuner-params.js', 'tuner-app.js'].map((f) =>
  html.indexOf('assets/' + f)
);
assert.ok(order.every((i) => i > 0), 'index.html loads all tuner modules');
assert.deepEqual(order.slice().sort((a, b) => a - b), order, 'util → params → app');

// --- util ------------------------------------------------------------------
assert.equal(util.clamp(5, 0, 1), 1);
assert.equal(util.round(1.23456), 1.23);
assert.equal(util.round(1.23456, 3), 1.235);
assert.deepEqual(util.parseColor('rgba(201, 160, 106, 0.5)'), { hex: '#c9a06a', a: 0.5 });
assert.equal(util.toRgba('#c9a06a', 0.5), 'rgba(201,160,106,0.5)');
const cam = { camera: { center: [104, 35.5], zoom: 4, pitch: 0, bearing: 0 } };
util.setByPath(cam, 'camera.centerLat', 36);
assert.equal(util.getByPath(cam, 'camera.centerLat'), 36);
// ui.* controls (拆出侧面色) read and write params.ui
const withUi = { ui: { islandSideColor: '#6d4a36' } };
assert.equal(util.getByPath(withUi, 'ui.islandSideColor'), '#6d4a36');
util.setByPath(withUi, 'ui.islandSideColor', '#112233');
assert.equal(withUi.ui.islandSideColor, '#112233');
const clone = util.deepClone(cam);
clone.camera.center[0] = 0;
assert.equal(cam.camera.center[0], 104, 'deepClone does not share nested arrays');

// --- params ----------------------------------------------------------------
assert.equal(params.DEFAULT_PARAMS.id, params.PRESET_ID);
const merged = params.mergeParams(
  params.DEFAULT_PARAMS,
  JSON.parse(
    '{"css":{"sepia":0.5,"__proto__":{"polluted":1}},"ui":{"showQilian":true},' +
      '"maplibre":{"hillshade":{"exaggeration":4},"water":{"qilianRiver":"#123456"}}}'
  )
);
assert.equal(merged.css.sepia, 0.5);
assert.equal({}.polluted, undefined, 'mergeParams drops __proto__ keys');
assert.equal(merged.maplibre.hillshade.exaggeration, 1, 'hillshade exaggeration capped at 1');
assert.equal(merged.maplibre.water.qilianRiver, undefined, 'legacy qilianRiver key is dropped');
assert.equal(merged.ui.showQilian, undefined, 'retired highlight keys are dropped');
assert.notEqual(params.DEFAULT_PARAMS.css.sepia, 0.5, 'mergeParams does not mutate the base');
const v3 = params.mergeParams(params.DEFAULT_PARAMS, { mapstage: { terrainExaggeration: 2.5 } });
assert.equal(v3.maplibre.terrainExaggeration, 2.5, 'v3 `mapstage` preset key is read');
const both = params.mergeParams(params.DEFAULT_PARAMS, {
  mapstage: { terrainExaggeration: 2.5 },
  maplibre: { terrainExaggeration: 9 },
});
assert.equal(both.maplibre.terrainExaggeration, 2.5, '`mapstage` wins over legacy `maplibre`');
assert.equal(params.MAP_MIN_ZOOM, 3);
assert.equal(params.DEFAULT_PARAMS.ui.showRoads, true, 'roads default on');
assert.equal(
  params.mergeParams(params.DEFAULT_PARAMS, { ui: { showRoads: false } }).ui.showRoads,
  false,
  'showRoads round-trips through mergeParams'
);
assert.equal(params.mergeParams(params.DEFAULT_PARAMS, { ui: { showWater: false } }).ui.showRoads, true, 'old presets without showRoads keep roads on');
assert.ok(params.globeSky()['sky-color']);

// --- vector overlay (OpenFreeMap water + roads) ---------------------------
const VP = require(join(here, 'vector-paint.js'));
assert.equal(typeof VP.overlayParts, 'function');
const overlay = VP.overlayParts({ groups: ['water', 'roads'] });
assert.equal(overlay.sourceId, 'openmaptiles');
assert.equal(overlay.source.type, 'vector');
assert.equal(overlay.source.url, VP.TILEJSON_URL);
assert.match(overlay.source.attribution, /OpenFreeMap.*OpenMapTiles.*OpenStreetMap/);
assert.ok(overlay.layers.length > 0);
const overlayLayers = overlay.layers.map((l) => l.id);
assert.equal(new Set(overlayLayers).size, overlayLayers.length, 'overlay layer ids are unique');
const defById = Object.fromEntries(VP.LAYER_DEFS.map((d) => [d.id, d]));
for (const layer of overlay.layers) {
  assert.ok(layer.id.startsWith('vl-'), layer.id + ' keeps the vector-layers id');
  assert.ok(defById[layer.id], layer.id + ' comes from LAYER_DEFS');
  assert.equal(layer.source, 'openmaptiles');
  assert.ok(
    ['water', 'waterway', 'transportation'].includes(layer['source-layer']),
    layer.id + ' source-layer ' + layer['source-layer'] + ' is water / waterway / transportation only'
  );
  assert.ok(['fill', 'line'].includes(layer.type), layer.id + ' is a plain fill or line');
  assert.equal(layer.layout.visibility, 'visible');
}
for (const id of ['vl-water', 'vl-water-ocean', 'vl-waterway', 'vl-waterway-canal', 'vl-waterway-stream', 'vl-rail', 'vl-highway', 'vl-minor']) {
  assert.ok(overlayLayers.includes(id), id + ' is part of the overlay');
}
for (const id of ['vl-background', 'vl-building', 'vl-boundary', 'vl-wood', 'vl-hillshade', 'vl-relief', 'vl-contour-label']) {
  assert.ok(!overlayLayers.includes(id), id + ' is not part of the overlay');
}
assert.deepEqual(overlay.ids.water.concat(overlay.ids.roads), overlayLayers);
assert.ok(overlay.ids.water.every((id) => /^vl-water/.test(id)));
const waterOnly = VP.overlayParts({ groups: ['water'] });
assert.deepEqual(waterOnly.layers.map((l) => l.id), overlay.ids.water);
assert.deepEqual(waterOnly.ids.roads, undefined);
const hiddenRoads = VP.overlayParts({ visible: { roads: false } });
assert.ok(hiddenRoads.layers.filter((l) => hiddenRoads.ids.roads.includes(l.id)).every((l) => l.layout.visibility === 'none'));
assert.ok(hiddenRoads.layers.filter((l) => hiddenRoads.ids.water.includes(l.id)).every((l) => l.layout.visibility === 'visible'));
const inkWater = VP.overlayParts({ groups: ['water'], paint: { water: '#123456' } });
assert.equal(inkWater.layers.find((l) => l.id === 'vl-water').paint['fill-color'], '#123456', 'paint colors feed the layers');
const wl = overlay.layers.find((l) => l.id === 'vl-waterway');
assert.deepEqual(wl.paint['line-width'].slice(0, 3), ['interpolate', ['linear'], ['zoom']], 'lines get zoom-interpolated widths');
assert.deepEqual(VP.overlayLineWidthFor('vl-waterway', 1), wl.paint['line-width']);
const wide = VP.overlayLineWidthFor('vl-waterway', 2);
assert.equal(wide[4], wl.paint['line-width'][4] * 2, 'width multiplier scales every stop');
assert.equal(VP.overlayLineWidthFor('vl-water', 1), null, 'fill layers have no line width');

const roadMin = Object.fromEntries(overlay.layers.filter((l) => overlay.ids.roads.includes(l.id)).map((l) => [l.id, l.minzoom || 0]));
assert.equal(roadMin['vl-highway'], 0, 'motorways show at national zoom');
assert.equal(roadMin['vl-trunk'], 0, 'trunk roads show at national zoom');
assert.ok(roadMin['vl-major'] > 4.2 && roadMin['vl-major'] <= 6, 'primary roads wait for province zoom');
assert.ok(roadMin['vl-minor'] >= 10, 'minor roads wait for city zoom');
assert.ok(roadMin['vl-service'] >= 12 && roadMin['vl-path'] >= 12, 'service / path roads wait for street zoom');
const hwOp = overlay.layers.find((l) => l.id === 'vl-highway').paint['line-opacity'];
assert.deepEqual(hwOp.slice(0, 3), ['interpolate', ['linear'], ['zoom']], 'roads fade in from national zoom');
assert.ok(hwOp[4] < hwOp[6], 'roads are fainter at national zoom');
assert.equal(typeof overlay.layers.find((l) => l.id === 'vl-waterway').paint['line-opacity'], 'number', 'water keeps its opacity');
assert.equal(defById['vl-minor'].minzoom, 8, 'vector-layers page keeps its own road minzoom');

console.log('tuner-modules.test.mjs ok');
