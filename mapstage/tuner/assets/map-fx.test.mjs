import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const fx = require(join(dirname(fileURLToPath(import.meta.url)), 'map-fx.js'));

assert.equal(fx.quantizeTerrain(1.62), 1.6);
assert.equal(fx.quantizeTerrain(1.61), 1.6);
assert.equal(fx.quantizeTerrain(0.82), 0.8);
assert.equal(fx.quantizeTerrain(-1), 0);

assert.equal(fx.budgetTerrainEx(1.6, 4.2, 20), 1.6);
assert.equal(fx.budgetTerrainEx(1.6, 6.2, 40), 1.2);
assert.equal(fx.budgetTerrainEx(1.6, 8.1, 30), 0.8);
assert.equal(fx.budgetTerrainEx(1.6, 5, 52), 0.8);

const path = fx.samplePath(
  { center: [100, 38], zoom: 5, pitch: 20, bearing: 0 },
  { center: [102, 39], zoom: 7, pitch: 40, bearing: 10 },
  5
);
assert.equal(path.length, 5);
assert.deepEqual(path[0].center, [100, 38]);
assert.deepEqual(path[4].center, [102, 39]);

const style = {
  layers: [
    { id: 'satellite', type: 'raster', paint: { 'raster-opacity': 0.5 } },
    { id: 'hillshade', type: 'hillshade', paint: {} },
  ],
};
fx.applyRasterFadeDuration(style, 0);
assert.equal(style.layers[0].paint['raster-fade-duration'], 0);
assert.equal(style.layers[1].paint['raster-fade-duration'], undefined);

const rec = fx.mapOptions('record');
assert.equal(rec.pixelRatio, 1);
assert.equal(rec.fadeDuration, 0);
assert.equal(rec.validateStyle, false);
assert.equal(rec.refreshExpiredTiles, false);
assert.equal(rec.renderWorldCopies, false);
assert.equal(rec.maxTileCacheZoomLevels, 12);
assert.equal(rec.collectResourceTiming, false);

const tun = fx.mapOptions('tuner');
assert.equal(tun.pixelRatio, undefined);
assert.equal(tun.fadeDuration, 300);
assert.equal(tun.maxTileCacheZoomLevels, 12);
assert.equal(fx.createAntiqueMap, fx.createMap);

const cfgCalls = { parallel: 0, workers: 0 };
const fakeGl = {
  Map: function MapCtor(opts) {
    this.opts = opts;
  },
  setMaxParallelImageRequests: function (n) {
    cfgCalls.parallel = n;
  },
  getWorkerCount: function () {
    return 1;
  },
  setWorkerCount: function (n) {
    cfgCalls.workers = n;
  },
};
fx.createMap(fakeGl, {
  container: 'map',
  style: { version: 8, sources: {}, layers: [] },
  camera: { center: [104, 35], zoom: 4 },
});
assert.equal(cfgCalls.parallel, 32);
assert.ok(cfgCalls.workers >= 2);

const tunedCalls = { parallel: 0, workers: 0, mapOptions: null };
const tunedGl = {
  Map: function MapCtor(opts) {
    tunedCalls.mapOptions = opts;
  },
  setMaxParallelImageRequests: function (n) {
    tunedCalls.parallel = n;
  },
  getWorkerCount: function () {
    return 6;
  },
  setWorkerCount: function (n) {
    tunedCalls.workers = n;
  },
};
fx.createMap(tunedGl, {
  container: 'map',
  style: { version: 8, sources: {}, layers: [] },
  camera: { center: [104, 35], zoom: 4 },
  runtimeOptions: { workerCount: 1, maxParallelImageRequests: 16 },
  mapOptions: { maxTileCacheZoomLevels: 5 },
});
assert.equal(tunedCalls.parallel, 16);
assert.equal(tunedCalls.workers, 1);
assert.equal(tunedCalls.mapOptions.maxTileCacheZoomLevels, 5);

let lodClass = '';
const lodMap = {
  getLayer: function () {
    return { id: 'river-l3' };
  },
  getLayoutProperty: function () {
    return 'visible';
  },
  setLayoutProperty: function () {},
  getContainer: function () {
    return {
      classList: {
        add: function (c) {
          lodClass = c;
        },
        remove: function () {
          lodClass = '';
        },
      },
    };
  },
};
fx.setMotionLod(lodMap, true);
assert.equal(lodClass, 'antique-lod-labels');
assert.equal(lodMap.__antiqueMotionLod, true);
fx.setMotionLod(lodMap, false);
assert.equal(lodClass, '');

const styled = { version: 8, sources: {}, layers: [] };
fx.enableStyleTerrain(styled, { sourceId: 'terrain', exaggeration: 1.6 });
assert.equal(styled.terrain.source, 'terrain');
assert.equal(styled.terrain.exaggeration, 1.6);
assert.ok(styled.sky, 'style.sky must exist so pitched views get a horizon');

let setCount = 0;
const fakeMap = {
  __antiqueSetTerrainCount: 0,
  getZoom: function () { return 4; },
  getPitch: function () { return 20; },
  getTerrain: function () { return this._t || null; },
  setTerrain: function (t) {
    setCount += 1;
    this._t = t;
  },
};
fx.setTerrainEx(fakeMap, 'terrain', 1.6);
fx.setTerrainEx(fakeMap, 'terrain', 1.62);
fx.setTerrainEx(fakeMap, 'terrain', 1.6);
assert.equal(setCount, 1, 'duplicate setTerrain must be skipped');
assert.equal(fakeMap.__antiqueSetTerrainCount, 1);
fakeMap.getZoom = function () { return 8.2; };
fakeMap.getPitch = function () { return 52; };
fx.setTerrainEx(fakeMap, 'terrain', 1.66);
assert.equal(fakeMap._t.exaggeration, 0.8);
fx.setTerrainEx(fakeMap, 'terrain', 1.66, { budget: false });
assert.equal(fakeMap._t.exaggeration, 1.65);
fx.flattenTerrain(fakeMap);
fx.flattenTerrain(fakeMap);
assert.equal(setCount, 4, 'flatten once then skip');

let stopN = 0;
let easeN = 0;
const camMap = {
  stop: function () { stopN += 1; },
  easeTo: function () { easeN += 1; },
  once: function () {},
  getLayer: function () { return null; },
};
fx.easeToCamera(camMap, { center: [104, 35], zoom: 4.2 }, 900);
fx.easeToCamera(camMap, { center: [102, 38], zoom: 7 }, 900);
assert.equal(stopN, 2, 'easeToCamera must map.stop() first');
assert.equal(easeN, 2);

const riseSteps = [];
const riseMap = {
  getZoom: function () { return 4.2; },
  getPitch: function () { return 20; },
  getTerrain: function () { return this._t || null; },
  setTerrain: function (t) { this._t = t; },
};
await fx.terrainRise(riseMap, {
  sourceId: 'terrain',
  from: 0,
  to: 1.6,
  durationMs: 80,
  waitIdle: false,
  useTimeout: true,
  onStep: function (ex) { riseSteps.push(ex); },
});
assert.ok(riseSteps.length >= 3, 'terrainRise must emit start/mid/end steps');
assert.equal(riseSteps[0], 0);
assert.equal(riseSteps[riseSteps.length - 1], 1.6);
assert.ok(riseSteps.length <= 22, 'rise must not dump 0.05 steps on a raw clock');

const chinaFeat = {
  type: 'Feature',
  geometry: {
    type: 'Polygon',
    coordinates: [[[70, 18], [136, 18], [136, 54], [70, 54], [70, 18]]],
  },
};
const chinaBox = fx.featureBbox(chinaFeat);
assert.deepEqual(chinaBox, [70, 18, 136, 54]);
const cityBox = fx.featureBbox({
  type: 'Polygon',
  coordinates: [[[100.4, 38.9], [100.5, 38.9], [100.5, 39.0], [100.4, 39.0], [100.4, 38.9]]],
});
assert.ok(cityBox[2] - cityBox[0] < 0.2);
let camBounds = null;
const fakeCamMap = {
  cameraForBounds: function (b, o) {
    camBounds = { b: b, o: o };
    return { center: { lng: 103, lat: 36 }, zoom: 5.1, pitch: o.pitch, bearing: o.bearing };
  },
};
const countryCam = fx.reliefCameraForFeature(fakeCamMap, chinaFeat);
assert.equal(countryCam.zoom, 5.1);
assert.equal(countryCam.pitch, 48);
assert.ok(camBounds.o.maxZoom <= 6.2);
const cityCam = fx.reliefCameraForFeature(fakeCamMap, {
  type: 'Feature',
  geometry: { type: 'Polygon', coordinates: [[[100.4, 38.9], [100.5, 38.9], [100.5, 39.0], [100.4, 39.0], [100.4, 38.9]]] },
});
assert.equal(cityCam.pitch, 66);

console.log('map-fx.test.mjs ok');
