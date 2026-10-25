import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { OSM_PROVINCES, OSM_CITIES, EXPECTED_PROVINCE_COUNT } from '../scripts/province-catalog.mjs';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
globalThis.window = globalThis;
require(join(here, 'region-isolate.js'));
require(join(here, 'region-isolate-data.js'));

const api = globalThis.REGION_ISOLATE;
const data = globalThis.REGION_ISOLATE_DATA;
const regions = api.listRegions(data);

assert.equal(OSM_PROVINCES.length, EXPECTED_PROVINCE_COUNT);
assert.equal(new Set(OSM_PROVINCES.map((r) => r.id)).size, EXPECTED_PROVINCE_COUNT);

const byId = {};
regions.forEach(function (r) {
  byId[r.id] = r;
});

assert.ok(byId.china, 'china missing');
assert.equal(byId.china.kind, 'nation');

// 「海域」(haiyu, group=maritime) 是岛礁集合，不是省级行政区。
const provinces = regions.filter(function (r) {
  return r.kind === 'province' && r.group !== 'maritime';
});
assert.equal(provinces.length, EXPECTED_PROVINCE_COUNT, 'built province count');

// 国界要求：全域轮廓含藏南、台湾、海南、东海/南海诸岛，且带十段线。
function bboxOf(feature) {
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  const g = feature.geometry;
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  polys.forEach(function (p) {
    p[0].forEach(function (c) {
      minLng = Math.min(minLng, c[0]); maxLng = Math.max(maxLng, c[0]);
      minLat = Math.min(minLat, c[1]); maxLat = Math.max(maxLat, c[1]);
    });
  });
  return { minLng, minLat, maxLng, maxLat, polys: polys.length };
}
const chinaBox = bboxOf(byId.china.feature);
assert.ok(chinaBox.minLat < 5, 'china reaches Nansha (south edge < 5N), got ' + chinaBox.minLat);
assert.ok(chinaBox.maxLng > 134, 'china reaches Heixiazi (east edge > 134E)');
assert.ok(chinaBox.polys > 100, 'china keeps islands, polys=' + chinaBox.polys);
assert.ok(byId.china.maritimeLines, 'china ten-dash maritimeLines missing');
[
  { id: 'china', lng: 94.2, lat: 28.4, name: '藏南(察隅/米林以南)' },
  { id: 'china', lng: 121.5, lat: 25.04, name: '台北' },
  { id: 'china', lng: 110.35, lat: 20.0, name: '海口' },
  { id: 'xizang', lng: 94.2, lat: 28.4, name: '藏南' },
].forEach(function (s) {
  assert.equal(api.pointInFeature(s.lng, s.lat, byId[s.id].feature), true, s.name + ' should sit in ' + s.id);
});
// 钓鱼岛及其附属岛屿（~123.5E,25.8N）以独立小多边形出现在 china 与 haiyu 中。
['china', 'haiyu'].forEach(function (id) {
  const polys = byId[id].feature.geometry.coordinates;
  const hit = polys.filter(function (p) {
    const ring = p[0];
    const x = ring.reduce((s, q) => s + q[0], 0) / ring.length;
    const y = ring.reduce((s, q) => s + q[1], 0) / ring.length;
    return x > 123.3 && x < 123.8 && y > 25.6 && y < 25.95;
  });
  assert.ok(hit.length >= 3, id + ' keeps Diaoyu islets, got ' + hit.length);
});
assert.ok(bboxOf(byId.xizang.feature).minLat < 27.5, 'xizang includes Zangnan (south edge < 27.5N)');
assert.ok(byId.haiyu && byId.haiyu.group === 'maritime', 'haiyu maritime region missing');
const provinceIds = new Set(provinces.map((p) => p.id));
// 海域下属岛群（东沙/西沙/中沙/南沙/黄岩岛…）：parent=haiyu，非 OSM 来源。
const maritimeCities = regions.filter(function (r) {
  return r.kind === 'city' && r.parentId === 'haiyu';
});
assert.ok(maritimeCities.length >= 5, 'maritime island groups under haiyu, got ' + maritimeCities.length);
maritimeCities.forEach(function (c) {
  assert.ok(c.feature && c.feature.geometry, c.id + ' feature');
});

// 地级市目录(Overpass admin_level=5,自动归省)
const cities = regions.filter(function (r) {
  return r.kind === 'city' && r.parentId !== 'haiyu';
});
assert.ok(cities.length >= 300, 'prefecture city count, got ' + cities.length);
cities.forEach(function (c) {
  assert.ok(provinceIds.has(c.parentId), c.id + ' (' + c.label + ') parentId not a province: ' + c.parentId);
  assert.ok(c.feature && c.feature.geometry, c.id + ' feature');
  assert.ok(
    c.feature.geometry.type === 'Polygon' || c.feature.geometry.type === 'MultiPolygon',
    c.id + ' geom'
  );
  assert.ok(c.vertexCount >= 6, c.id + ' verts'); // 东莞/中山等紧凑市顶点本就少
  // 藏南(zangnan)取自 Natural Earth 中国视角版，不是 OSM 关系。
  assert.ok(c.osmRelation || /Natural Earth|OpenStreetMap/.test(c.source || ''), c.id + ' osmRelation/source');
});
assert.ok(byId.zhangye, 'curated zhangye missing');
assert.equal(byId.zhangye.parentId, 'gansu', 'zhangye parent');

OSM_PROVINCES.forEach(function (spec) {
  const r = byId[spec.id];
  assert.ok(r, 'missing ' + spec.id);
  assert.equal(r.label, spec.label, spec.id + ' label');
  assert.equal(r.kind, 'province', spec.id + ' kind');
  assert.equal(r.group, spec.group, spec.id + ' group');
  assert.equal(r.osmRelation, spec.relId, spec.id + ' osm');
  assert.ok(r.feature && r.feature.geometry, spec.id + ' feature');
  assert.ok(
    r.feature.geometry.type === 'Polygon' || r.feature.geometry.type === 'MultiPolygon',
    spec.id + ' geom'
  );
  assert.ok(r.vertexCount > 10, spec.id + ' verts');
});

OSM_CITIES.forEach(function (spec) {
  const r = byId[spec.id];
  assert.ok(r, 'missing city ' + spec.id);
  assert.equal(r.kind, 'city');
  assert.equal(r.osmRelation, spec.relId);
});

assert.equal(byId.gansu.osmRelation, 153314);

const samples = [
  { id: 'gansu', lng: 103.83, lat: 36.06, name: '兰州' },
  { id: 'sichuan', lng: 104.07, lat: 30.67, name: '成都' },
  { id: 'guangdong', lng: 113.26, lat: 23.13, name: '广州' },
  { id: 'xinjiang', lng: 87.62, lat: 43.83, name: '乌鲁木齐' },
  { id: 'heilongjiang', lng: 126.53, lat: 45.8, name: '哈尔滨' },
];
samples.forEach(function (s) {
  assert.equal(
    api.pointInFeature(s.lng, s.lat, byId[s.id].feature),
    true,
    s.name + ' should sit in ' + s.id
  );
});

assert.equal(api.pointInFeature(103.83, 36.06, byId.sichuan.feature), false);

console.log('region-isolate-data.test.mjs ok · provinces=' + provinces.length);
