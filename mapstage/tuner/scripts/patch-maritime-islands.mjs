#!/usr/bin/env node
/**
 * Extract SCS / Diaoyu island polygons from the china MultiPolygon and
 * register them as searchable isolate regions under parent 海域.
 *
 * Usage: node mapstage/tuner/scripts/patch-maritime-islands.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataPath = join(__dirname, '../assets/region-isolate-data.js');

const text = readFileSync(dataPath, 'utf8');
const start = text.indexOf('{');
const end = text.lastIndexOf('};');
if (start < 0 || end < 0) throw new Error('cannot parse region-isolate-data.js');
const data = JSON.parse(text.slice(start, end + 1));

const china = data.regions.find((r) => r.id === 'china');
if (!china?.feature?.geometry?.coordinates) throw new Error('china feature missing');
const parts = china.feature.geometry.coordinates;

function partBbox(poly) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const ring of poly) {
    for (const p of ring) {
      minX = Math.min(minX, p[0]);
      maxX = Math.max(maxX, p[0]);
      minY = Math.min(minY, p[1]);
      maxY = Math.max(maxY, p[1]);
    }
  }
  return {
    minX,
    minY,
    maxX,
    maxY,
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
    area: Math.abs((maxX - minX) * (maxY - minY)),
  };
}

function roundPt(p) {
  return [Math.round(p[0] * 1e4) / 1e4, Math.round(p[1] * 1e4) / 1e4];
}

function clonePolys(indices) {
  return indices.map((i) => parts[i].map((ring) => ring.map(roundPt)));
}

function countVerts(polys) {
  let n = 0;
  for (const poly of polys) for (const ring of poly) n += ring.length;
  return n;
}

function polysBbox(polys) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const poly of polys) {
    for (const ring of poly) {
      for (const p of ring) {
        minX = Math.min(minX, p[0]);
        maxX = Math.max(maxX, p[0]);
        minY = Math.min(minY, p[1]);
        maxY = Math.max(maxY, p[1]);
      }
    }
  }
  return [minX, minY, maxX, maxY];
}

const annotated = parts.map((poly, i) => ({ i, ...partBbox(poly) }));

const RULES = [
  {
    id: 'dongsha',
    label: '东沙群岛',
    aliases: ['东沙', 'Dongsha', 'Pratas'],
    test: (p) => p.cx > 116.5 && p.cx < 117.2 && p.cy > 20.4 && p.cy < 21.0 && p.area < 0.2,
  },
  {
    id: 'xisha',
    label: '西沙群岛',
    aliases: ['西沙', 'Xisha', 'Paracel', '永兴岛', '永兴'],
    test: (p) => p.cx > 111.2 && p.cx < 113.2 && p.cy > 15.5 && p.cy < 17.5 && p.area < 0.2,
  },
  {
    id: 'zhongsha',
    label: '中沙群岛',
    aliases: ['中沙', 'Zhongsha', 'Macclesfield'],
    test: (p) => p.cx > 114.4 && p.cx < 115.2 && p.cy > 15.7 && p.cy < 16.4 && p.area < 0.05,
  },
  {
    id: 'huangyan',
    label: '黄岩岛',
    aliases: ['黄岩', 'Huangyan', 'Scarborough', '民主礁'],
    test: (p) => p.cx > 117.5 && p.cx < 118.1 && p.cy > 14.9 && p.cy < 15.4 && p.area < 0.1,
  },
  {
    id: 'nansha',
    label: '南沙群岛',
    aliases: ['南沙', 'Nansha', 'Spratly'],
    test: (p) =>
      p.cx > 109 &&
      p.cx < 118.5 &&
      p.cy > 4.4 &&
      p.cy < 12.5 &&
      p.area < 0.5 &&
      !(p.cx > 114.4 && p.cx < 115.2 && p.cy > 15.7),
  },
  {
    id: 'zengmu',
    label: '曾母暗沙',
    aliases: ['曾母', 'James Shoal', '南疆'],
    test: (p) => p.cx > 112.1 && p.cx < 112.4 && p.cy > 3.7 && p.cy < 4.1 && p.area < 0.02,
  },
  {
    id: 'diaoyu',
    label: '钓鱼岛及其附属岛屿',
    aliases: ['钓鱼岛', '钓鱼屿', 'Diaoyu', 'Senkaku', '钓岛'],
    test: (p) => p.cx > 123.3 && p.cx < 124.8 && p.cy > 25.5 && p.cy < 26.2 && p.area < 0.05,
  },
];

const islandRegions = [];
const used = new Set();
for (const rule of RULES) {
  const idxs = annotated.filter((p) => rule.test(p) && !used.has(p.i)).map((p) => p.i);
  if (!idxs.length) throw new Error('no polygons for ' + rule.id);
  idxs.forEach((i) => used.add(i));
  const polys = clonePolys(idxs);
  islandRegions.push({
    id: rule.id,
    label: rule.label,
    aliases: rule.aliases,
    kind: 'city',
    group: 'maritime',
    parentId: 'haiyu',
    attribution:
      'Extracted from Chinese-standard national atlas china MultiPolygon (geojson.cn). Narrative isolate silhouette.',
    source: 'geojson.cn national atlas via china isolate MultiPolygon parts',
    sourceUrl: 'https://geojson.cn/api/china/100000.json',
    simplifyEpsilonDeg: 0.008,
    vertexCount: countVerts(polys),
    polyCount: polys.length,
    bbox: polysBbox(polys),
    feature: {
      type: 'Feature',
      properties: {
        id: rule.id,
        label: rule.label,
        narrative: true,
        keepMaritimeIslands: true,
        completeTerritory: true,
      },
      geometry: {
        type: polys.length === 1 ? 'Polygon' : 'MultiPolygon',
        coordinates: polys.length === 1 ? polys[0] : polys,
      },
    },
  });
  console.log(rule.id, idxs.length, 'polys', 'verts', countVerts(polys), 'bbox', polysBbox(polys).map((n) => +n.toFixed(3)));
}

// Parent 海域 = union of all extracted island polys (selectable umbrella).
const allIdx = [...used];
const parentPolys = clonePolys(allIdx);
const parent = {
  id: 'haiyu',
  label: '海域',
  aliases: ['南海诸岛', '东海诸岛', '海上', '海疆', 'maritime'],
  kind: 'province',
  group: 'maritime',
  attribution:
    'Union of SCS / Diaoyu island parts extracted from china MultiPolygon. Narrative isolate silhouette.',
  source: 'geojson.cn national atlas via china isolate MultiPolygon parts',
  sourceUrl: 'https://geojson.cn/api/china/100000.json',
  simplifyEpsilonDeg: 0.008,
  vertexCount: countVerts(parentPolys),
  polyCount: parentPolys.length,
  bbox: polysBbox(parentPolys),
  feature: {
    type: 'Feature',
    properties: {
      id: 'haiyu',
      label: '海域',
      narrative: true,
      keepMaritimeIslands: true,
      completeTerritory: true,
    },
    geometry: { type: 'MultiPolygon', coordinates: parentPolys },
  },
};

const removeIds = new Set(['haiyu', ...RULES.map((r) => r.id)]);
data.regions = data.regions.filter((r) => !removeIds.has(r.id));

// Insert after china (index 0) for discoverability in raw data; dropdown uses group order.
const chinaIdx = data.regions.findIndex((r) => r.id === 'china');
const insertAt = chinaIdx >= 0 ? chinaIdx + 1 : 0;
data.regions.splice(insertAt, 0, parent, ...islandRegions);

const header =
  '/* Auto-generated / patched by tuner scripts — china + zangnan + tacheng + maritime islands. */\n';
writeFileSync(
  dataPath,
  header + 'window.REGION_ISOLATE_DATA = ' + JSON.stringify(data, null, 0) + ';\n',
  'utf8',
);

console.log('wrote', dataPath, 'regions', data.regions.length);
console.log(
  'maritime children',
  data.regions.filter((r) => r.parentId === 'haiyu').map((r) => r.label),
);
