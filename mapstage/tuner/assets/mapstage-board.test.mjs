import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const B = require('./mapstage-board.js');
const sanguo = JSON.parse(readFileSync(join(here, '..', '..', 'site', 'examples', 'play-sanguo.json'), 'utf8'));
const byId = Object.fromEntries(sanguo.sites.map((s) => [s.id, s]));

// 校验：示例合法；坏引用、自环、重复都报出来
assert.deepEqual(B.lintBoard(sanguo), []);
{
  const errs = B.lintBoard({ sites: sanguo.sites, links: [['chengdu', 'nowhere'], ['ye', 'ye'], ['ye', 'luoyang'], ['luoyang', 'ye'], ['x']] });
  assert.ok(errs.some((e) => e.includes('nowhere')));
  assert.ok(errs.some((e) => e.includes('两端相同')));
  assert.ok(errs.some((e) => e.includes('重复')));
  assert.ok(errs.some((e) => e.includes('links[4]')));
  assert.deepEqual(B.lintBoard({ sites: [] }), ['sites 至少一个地点']);
}
assert.equal(B.linkKey('b', 'a'), 'a|b');

// 局部更新：合并字段、null 清掉、非法 label / ring 抛错、不改原对象
{
  const a = B.mergeCities({}, { chengdu: { color: '#b8432f', value: 28 } });
  const b = B.mergeCities(a, { chengdu: { ring: 'select' }, ye: { color: '#3f5f8a' } });
  assert.deepEqual(b.chengdu, { color: '#b8432f', value: 28, ring: 'select' });
  assert.equal(a.chengdu.ring, undefined);
  assert.equal(B.mergeCities(b, { ye: null }).ye, undefined);
  assert.throws(() => B.mergeCities(b, { ye: { label: 'hot' } }), /label/);
  assert.throws(() => B.mergeCities(b, { ye: { ring: 'glow' } }), /ring/);
}

// 城池圈：没给 color 的不画；半径随 value 增长；ring 决定描边
{
  const fc = B.cityFeatures(sanguo.sites, { chengdu: { color: '#b8432f', value: 25, ring: 'select' }, ye: { color: '#3f5f8a' }, wan: { value: 9 } });
  assert.equal(fc.features.length, 2);
  const cd = fc.features.find((f) => f.properties.id === 'chengdu').properties;
  const ye = fc.features.find((f) => f.properties.id === 'ye').properties;
  assert.equal(cd.r, 7 + 5 * 2.2);
  assert.equal(ye.r, 7);
  assert.equal(cd.stroke, B.RINGS.select.color);
  assert.deepEqual(fc.features[0].geometry.coordinates, byId[fc.features[0].properties.id].lngLat);
}

// 连线：style 回调决定颜色 / 粗细 / 隐藏，缺省中性色
{
  const fc = B.linkFeatures(byId, sanguo.links, (a, b) => (a === 'changan' ? { color: '#3f5f8a', width: 3 } : b === 'chengdu' ? { hidden: true } : null));
  assert.equal(fc.features.length, sanguo.links.length - 1);
  const ca = fc.features.find((f) => f.properties.a === 'changan' && f.properties.b === 'luoyang').properties;
  assert.deepEqual([ca.color, ca.w], ['#3f5f8a', 3]);
  assert.equal(fc.features.find((f) => f.properties.a === 'ye').properties.color, B.DEFAULTS.neutral);
}

// 点选：取半径内最近的，超出返回 null
{
  const pts = [{ id: 'a', x: 100, y: 100 }, { id: 'b', x: 120, y: 100 }];
  assert.equal(B.nearestSite(pts, { x: 112, y: 101 }, 28), 'b');
  assert.equal(B.nearestSite(pts, { x: 104, y: 99 }, 28), 'a');
  assert.equal(B.nearestSite(pts, { x: 300, y: 300 }, 28), null);
}

console.log('mapstage-board ok');
