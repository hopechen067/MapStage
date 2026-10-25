import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
require(join(dirname(fileURLToPath(import.meta.url)), 'region-isolate.js'));
const api = globalThis.REGION_ISOLATE;

const square = {
  type: 'Feature',
  properties: { id: 'box' },
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [100, 36],
        [102, 36],
        [102, 38],
        [100, 38],
        [100, 36],
      ],
    ],
  },
};

assert.equal(api.pointInFeature(101, 37, square), true);
assert.equal(api.pointInFeature(99, 37, square), false);
assert.equal(api.pointInFeature(101, 35, square), false);

const rivers = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { name: 'inside' },
      geometry: { type: 'LineString', coordinates: [[100.2, 36.2], [101.5, 37.2]] },
    },
    {
      type: 'Feature',
      properties: { name: 'outside' },
      geometry: { type: 'LineString', coordinates: [[110, 40], [111, 41]] },
    },
    {
      type: 'Feature',
      properties: { name: 'cross' },
      geometry: { type: 'LineString', coordinates: [[99, 37], [101, 37]] },
    },
  ],
};

const clipped = api.filterCollection(rivers, square);
assert.equal(clipped.features.length, 2);
assert.deepEqual(
  clipped.features.map(function (f) { return f.properties.name; }).sort(),
  ['cross', 'inside']
);
const cross = clipped.features.filter(function (f) { return f.properties.name === 'cross'; })[0];
assert.equal(cross.geometry.type, 'LineString');
assert.ok(cross.geometry.coordinates[0][0] >= 100 - 1e-6);
assert.ok(cross.geometry.coordinates.every(function (p) { return p[0] >= 100 - 1e-6 && p[0] <= 102 + 1e-6; }));

const parts = api.clipLineString([[99, 37], [101, 37]], square);
assert.equal(parts.length, 1);
assert.ok(Math.abs(parts[0][0][0] - 100) < 1e-6);
assert.deepEqual(parts[0][1], [101, 37]);

const empty = api.filterCollection({ type: 'FeatureCollection', features: [] }, square);
assert.equal(empty.features.length, 0);

// bbox 预筛：远离区域的要素直接跳过；bbox 相交但几何在洞外仍被丢弃
const mixed = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { name: 'far-poly' },
      geometry: {
        type: 'Polygon',
        coordinates: [[[120, 40], [121, 40], [121, 41], [120, 41], [120, 40]]],
      },
    },
    {
      type: 'Feature',
      properties: { name: 'far-line' },
      geometry: { type: 'LineString', coordinates: [[110, 40], [112, 42]] },
    },
    {
      // bbox 与 square 相交，但整条线都在框外
      type: 'Feature',
      properties: { name: 'bbox-only' },
      geometry: { type: 'LineString', coordinates: [[100.5, 35], [101.5, 35.5]] },
    },
  ],
};
const clippedMixed = api.filterCollection(mixed, square);
assert.equal(clippedMixed.features.length, 0);

// bbox 工具导出
assert.deepEqual(api.geometryBbox(square.geometry), [100, 36, 102, 38]);
assert.equal(api.bboxIntersects([100, 36, 102, 38], [101, 37, 103, 39]), true);
assert.equal(api.bboxIntersects([100, 36, 102, 38], [103, 37, 104, 39]), false);

const mask = api.buildMaskGeoJSON(square);
assert.equal(mask.type, 'FeatureCollection');
assert.ok(mask.features.length > 8);
const tile = api.MASK_TILE_DEG;
mask.features.forEach(function (f) {
  const box = api.geometryBbox(f.geometry);
  assert.ok(box[2] - box[0] <= tile + 1e-6, 'mask cell wider than tile');
  assert.ok(box[3] - box[1] <= tile + 1e-6, 'mask cell taller than tile');
  assert.equal(f.geometry.coordinates.length, 1, 'mask cells must be hole-free');
});
function maskCovers(lng, lat) {
  return mask.features.some(function (f) {
    return api.pointInFeature(lng, lat, f);
  });
}
assert.equal(maskCovers(101, 37), false, 'inside region must stay open');
assert.equal(maskCovers(99, 37), true, 'west of region must be masked');
assert.equal(maskCovers(101, 35), true, 'south of region must be masked');
assert.equal(maskCovers(0, 0), true, 'far cell must be masked');

const diamond = {
  type: 'Feature',
  properties: { id: 'diamond' },
  geometry: {
    type: 'Polygon',
    coordinates: [[[101, 36], [102, 37], [101, 38], [100, 37], [101, 36]]],
  },
};
const dMask = api.buildMaskGeoJSON(diamond);
let slanted = false;
dMask.features.forEach(function (f) {
  const r = f.geometry.coordinates[0];
  for (let i = 0; i < r.length - 1; i++) {
    const dx = r[i + 1][0] - r[i][0];
    const dy = r[i + 1][1] - r[i][1];
    if (Math.abs(dx) > 1e-6 && Math.abs(dy) > 1e-6) slanted = true;
  }
});
assert.ok(slanted, 'tessellated mask must include diagonal edges');
assert.equal(dMask.features.some(function (f) { return api.pointInFeature(101, 37, f); }), false);
assert.equal(dMask.features.some(function (f) { return api.pointInFeature(99, 37, f); }), true);
assert.equal(dMask.features.some(function (f) { return api.pointInFeature(101.5, 36.4, f); }), true, 'outside diagonal must be masked');
assert.equal(dMask.features.some(function (f) { return api.pointInFeature(101.5, 36.6, f); }), false, 'inside diagonal must stay open');

globalThis.window = globalThis;
require(join(dirname(fileURLToPath(import.meta.url)), 'region-isolate-data.js'));
const jiangsu = api.findRegion(globalThis.REGION_ISOLATE_DATA, 'jiangsu');
assert.ok(jiangsu && jiangsu.feature);
const jMask = api.buildMaskGeoJSON(jiangsu.feature);
assert.equal(jMask.type, 'FeatureCollection');
jMask.features.forEach(function (f) {
  const box = api.geometryBbox(f.geometry);
  assert.ok(box[2] - box[0] <= tile + 1e-6, 'jiangsu mask cell wider than tile');
  assert.ok(box[3] - box[1] <= tile + 1e-6, 'jiangsu mask cell taller than tile');
  assert.equal(f.geometry.coordinates.length, 1, 'jiangsu mask cells must be hole-free');
});
function jCovers(lng, lat) {
  return jMask.features.some(function (f) {
    return api.pointInFeature(lng, lat, f);
  });
}
assert.equal(api.pointInFeature(118.78, 32.06, jiangsu.feature), true, 'Nanjing in Jiangsu');
assert.equal(jCovers(118.78, 32.06), false, 'Nanjing must stay open');
assert.equal(jCovers(117.28, 31.86), true, 'Hefei (Anhui) must be masked');

const shanghai = api.findRegion(globalThis.REGION_ISOLATE_DATA, 'shanghai');
assert.ok(shanghai && shanghai.feature);
const sMask = api.buildMaskGeoJSON(shanghai.feature);
let needles = 0;
sMask.features.forEach(function (f) {
  const box = api.geometryBbox(f.geometry);
  const w = box[2] - box[0];
  const h = box[3] - box[1];
  if (h > 1e-8 && w > 0.2 && w / h > 20) needles += 1;
  if (w > 1e-8 && h > 0.2 && h / w > 20) needles += 1;
  assert.equal(f.geometry.coordinates.length, 1, 'shanghai mask cells must be hole-free');
});
assert.equal(needles, 0, 'shanghai mask must not emit terrain-needle trapezoids');
function sCovers(lng, lat) {
  return sMask.features.some(function (f) {
    return api.pointInFeature(lng, lat, f);
  });
}
assert.equal(api.pointInFeature(121.47, 31.23, shanghai.feature), true, 'Pudong in Shanghai');
assert.equal(sCovers(121.47, 31.23), false, 'Pudong must stay open');
assert.equal(sCovers(120.6, 31.3), true, 'west of Shanghai must be masked');

const beijing = api.findRegion(globalThis.REGION_ISOLATE_DATA, 'beijing');
assert.ok(beijing && beijing.feature);
const bjBox = api.geometryBbox(beijing.feature.geometry);
const bjTess = api.tessellationForBox(bjBox);
assert.ok(bjTess.slabMin < 0.02, 'beijing slabs must be finer than the 0.04° China cap');
assert.ok(bjTess.overlap > 0, 'beijing traps must overlap to seal terrain cracks');
const bMask = api.buildMaskGeoJSON(beijing.feature);
let bjNeedles = 0;
let bjEdgeH = 0;
bMask.features.forEach(function (f) {
  const box = api.geometryBbox(f.geometry);
  const w = box[2] - box[0];
  const h = box[3] - box[1];
  if (h > 1e-8 && w > 0.2 && w / h > 20) bjNeedles += 1;
  if (w > 1e-8 && h > 0.2 && h / w > 20) bjNeedles += 1;
  if (h > 1e-8 && h < 0.02 && w < 1.2) bjEdgeH += 1;
  assert.equal(f.geometry.coordinates.length, 1, 'beijing mask cells must be hole-free');
});
assert.equal(bjNeedles, 0, 'beijing mask must not emit terrain-needle trapezoids');
assert.ok(bjEdgeH > 40, 'beijing silhouette must use sub-0.02° slabs, got ' + bjEdgeH);
function bCovers(lng, lat) {
  return bMask.features.some(function (f) {
    return api.pointInFeature(lng, lat, f);
  });
}
assert.equal(api.pointInFeature(116.397, 39.909, beijing.feature), true, 'Tiananmen in Beijing');
assert.equal(bCovers(116.397, 39.909), false, 'Tiananmen must stay open');
assert.equal(api.pointInFeature(115.97, 39.49, beijing.feature), false, 'Zhuozhou is Hebei');
assert.equal(bCovers(115.97, 39.49), true, 'Zhuozhou must be masked');
const bjNar = api.narrativeFeature(beijing.feature);
assert.ok(bjNar);
assert.equal(bjNar.geometry.type, 'Polygon', 'Beijing isolate drops OSM specks');
assert.equal(bCovers(117.667, 39.224), true, 'southeast OSM speck must be masked');

const chinaTess = api.tessellationForBox([73, 18, 135, 54]);
assert.equal(chinaTess.slabMin, api.MASK_SLAB_MIN_DEG, 'china keeps the coarse slab cap');

const china = api.findRegion(globalThis.REGION_ISOLATE_DATA, 'china');
const chinaNar = api.narrativeFeature(china.feature);
assert.equal(api.pointInFeature(110.35, 19.2, china.feature), true, 'Hainan in raw China');
assert.equal(api.pointInFeature(110.35, 19.2, chinaNar), true, 'Hainan stays on China isolate');
assert.equal(api.pointInFeature(121.0, 23.7, china.feature), true, 'Taiwan in raw China');
assert.equal(api.pointInFeature(121.0, 23.7, chinaNar), true, 'Taiwan stays on China isolate');
const chinaNarPolys =
  chinaNar.geometry.type === 'Polygon' ? 1 : chinaNar.geometry.coordinates.length;
assert.ok(chinaNarPolys >= 3, 'China isolate keeps mainland + Hainan + Taiwan');
const simple = api.buildSimpleMaskGeoJSON(china.feature);
const tiledChina = api.buildMaskGeoJSON(china.feature);
assert.equal(simple.features.length, 1, 'globe mask is a single world-minus-holes polygon');
assert.ok(simple.features[0].geometry.coordinates.length >= 2, 'globe mask keeps region holes');
assert.ok(
  tiledChina.features.length > simple.features.length * 20,
  'tiled China mask is far denser than globe/simple mask (' +
    tiledChina.features.length +
    ' vs ' +
    simple.features.length +
    ')'
);
function simpleCovers(lng, lat) {
  return simple.features.some(function (f) {
    return api.pointInFeature(lng, lat, f);
  });
}
assert.equal(simpleCovers(110.35, 19.2), false, 'simple mask does not fill Hainan (hole)');
assert.equal(simpleCovers(121.0, 23.7), false, 'simple mask does not fill Taiwan (hole)');
assert.equal(simpleCovers(0, 0), true, 'simple mask covers open ocean');
assert.equal(api.pointInFeature(117.667, 39.224, bjNar), false, 'Beijing narrative drops OSM speck');

// 国家级「完整领土」轮廓保留南海/钓鱼岛等小岛；不带标记的同样几何仍按 1 deg² 剪掉碎屑。
function rect(x, y, w, h) {
  return [[[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]]];
}
const islandGeom = {
  type: 'MultiPolygon',
  coordinates: [rect(80, 20, 20, 20), [rect(114, 10, 0.05, 0.05)[0]]],
};
function polyCount(f) {
  return f.geometry.type === 'Polygon' ? 1 : f.geometry.coordinates.length;
}
assert.equal(
  polyCount(api.narrativeFeature({ type: 'Feature', properties: {}, geometry: islandGeom })),
  1,
  'nation silhouette without flag drops islets'
);
assert.equal(
  polyCount(
    api.narrativeFeature({ type: 'Feature', properties: { keepMaritimeIslands: true }, geometry: islandGeom })
  ),
  2,
  'keepMaritimeIslands keeps islets'
);
assert.equal(
  polyCount(
    api.narrativeFeature({ type: 'Feature', properties: { completeTerritory: true }, geometry: islandGeom })
  ),
  2,
  'completeTerritory keeps islets'
);

// 岛群（单个环远小于 100 deg²，走「相对最大环 2%」剪裁）同样要保留全部小岛。
const groupGeom = {
  type: 'MultiPolygon',
  coordinates: [[rect(111.46, 16.2, 0.13, 0.1)[0]], [rect(112.2, 16.99, 0.1, 0.04)[0]], [rect(112.22, 16.75, 0.002, 0.002)[0]]],
};
assert.equal(
  polyCount(api.narrativeFeature({ type: 'Feature', properties: {}, geometry: groupGeom })),
  2,
  'island group without flag drops the speck'
);
assert.equal(
  polyCount(
    api.narrativeFeature({ type: 'Feature', properties: { completeTerritory: true }, geometry: groupGeom })
  ),
  3,
  'completeTerritory island group keeps every islet'
);

console.log('region-isolate.test.mjs ok');
