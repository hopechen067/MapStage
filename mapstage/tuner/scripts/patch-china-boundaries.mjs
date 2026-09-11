#!/usr/bin/env node
/**
 * Rebuild the nation `china` silhouette (+ `xizang` province) so the catalog
 * includes the full PRC land extent (藏南 / Zangnan), Taiwan / HK / Macao,
 * Diaoyu and South-China-Sea islands, and the ten-dash maritime line.
 *
 * Source: geojson.cn national atlas (100000.json) — Chinese standard
 * administrative presentation used for narrative silhouettes (not a survey
 * product). Replaces the incomplete Natural Earth CHN∪TWN∪HKG∪MAC union.
 *
 * Usage:
 *   node mapstage/tuner/scripts/patch-china-boundaries.mjs [/path/to/100000.json]
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const dataPath = join(root, 'assets/region-isolate-data.js');

const DEFAULT_SRC =
  process.env.CHINA_ATLAS_GEOJSON ||
  '/tmp/china100000.json';

const LAND_EPS = 0.025;
const ISLAND_EPS = 0.008;
const MIN_ISLAND_AREA = 1e-6; // deg² — keep SCS / Diaoyu islets
const MAINLAND_AREA_CUT = 0.5; // rings larger than this use LAND_EPS

function signedArea(ring) {
  let a = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return a / 2;
}

function closeRing(ring) {
  if (!ring || ring.length < 3) return null;
  const out = ring.map((p) => [Number(p[0]), Number(p[1])]);
  const a = out[0];
  const b = out[out.length - 1];
  if (a[0] !== b[0] || a[1] !== b[1]) out.push([a[0], a[1]]);
  return out.length >= 4 ? out : null;
}

function perpDist(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-18) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2;
  const x = a[0] + t * dx;
  const y = a[1] + t * dy;
  return Math.hypot(p[0] - x, p[1] - y);
}

function douglasPeucker(points, eps) {
  if (points.length <= 2) return points.slice();
  let maxD = 0;
  let idx = 0;
  const first = points[0];
  const last = points[points.length - 1];
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpDist(points[i], first, last);
    if (d > maxD) {
      maxD = d;
      idx = i;
    }
  }
  if (maxD > eps) {
    const left = douglasPeucker(points.slice(0, idx + 1), eps);
    const right = douglasPeucker(points.slice(idx), eps);
    return left.slice(0, -1).concat(right);
  }
  return [first, last];
}

function simplifyRing(ring, eps) {
  const closed = closeRing(ring);
  if (!closed) return null;
  const open = closed.slice(0, -1);
  if (open.length <= 4) return closed;
  const simp = douglasPeucker(open, eps);
  if (simp.length < 3) return closed;
  return closeRing(simp);
}

function roundPt(p) {
  return [Math.round(p[0] * 1e4) / 1e4, Math.round(p[1] * 1e4) / 1e4];
}

function simplifyPolygon(poly) {
  const outer = closeRing(poly[0]);
  if (!outer) return null;
  const area = Math.abs(signedArea(outer));
  if (area < MIN_ISLAND_AREA) return null;
  const eps = area >= MAINLAND_AREA_CUT ? LAND_EPS : ISLAND_EPS;
  const outOuter = simplifyRing(outer, eps);
  if (!outOuter) return null;
  const holes = [];
  for (let i = 1; i < poly.length; i++) {
    const h = simplifyRing(poly[i], eps);
    if (h && Math.abs(signedArea(h)) >= MIN_ISLAND_AREA) holes.push(h.map(roundPt));
  }
  return [outOuter.map(roundPt)].concat(holes);
}

function featurePolygons(f) {
  if (!f || !f.geometry) return [];
  const g = f.geometry;
  if (g.type === 'Polygon') return [g.coordinates];
  if (g.type === 'MultiPolygon') return g.coordinates;
  return [];
}

function countVerts(coords) {
  let n = 0;
  const walk = (node) => {
    if (!node) return;
    if (typeof node[0] === 'number') n += 1;
    else node.forEach(walk);
  };
  walk(coords);
  return n;
}

function bboxOf(coords) {
  let minLng = 180;
  let maxLng = -180;
  let minLat = 90;
  let maxLat = -90;
  const walk = (node) => {
    if (typeof node[0] === 'number') {
      minLng = Math.min(minLng, node[0]);
      maxLng = Math.max(maxLng, node[0]);
      minLat = Math.min(minLat, node[1]);
      maxLat = Math.max(maxLat, node[1]);
    } else node.forEach(walk);
  };
  walk(coords);
  return [minLng, minLat, maxLng, maxLat];
}

function loadAtlas(path) {
  if (!existsSync(path)) {
    throw new Error('Atlas GeoJSON not found: ' + path);
  }
  return JSON.parse(readFileSync(path, 'utf8'));
}

function buildChina(atlas) {
  const polys = [];
  let maritimeLines = null;
  for (const f of atlas.features || []) {
    const name = (f.properties && (f.properties.name || f.properties.NAME)) || '';
    if (name === '十段线' || name === '九段线') {
      if (f.geometry && f.geometry.type.includes('Line')) {
        maritimeLines = {
          type: 'Feature',
          properties: {
            id: 'china-ten-dash',
            label: '十段线',
            kind: 'maritime-line',
            narrative: true,
          },
          geometry: f.geometry,
        };
      }
      continue;
    }
    for (const poly of featurePolygons(f)) {
      const simp = simplifyPolygon(poly);
      if (simp) polys.push(simp);
    }
  }
  if (!polys.length) throw new Error('No land polygons extracted from atlas');
  const geometry =
    polys.length === 1
      ? { type: 'Polygon', coordinates: polys[0] }
      : { type: 'MultiPolygon', coordinates: polys };
  return {
    land: {
      type: 'Feature',
      properties: {
        id: 'china',
        label: '中国',
        narrative: true,
        keepMaritimeIslands: true,
        completeTerritory: true,
      },
      geometry,
    },
    maritimeLines,
    vertexCount: countVerts(geometry.coordinates),
    bbox: bboxOf(geometry.coordinates),
    polyCount: polys.length,
  };
}

function buildXizang(atlas) {
  const f = (atlas.features || []).find(
    (x) => x.properties && (x.properties.name === '西藏' || x.properties.fullname === '西藏自治区')
  );
  if (!f) throw new Error('西藏 feature missing from atlas');
  const polys = [];
  for (const poly of featurePolygons(f)) {
    const simp = simplifyPolygon(poly);
    if (simp) polys.push(simp);
  }
  const geometry =
    polys.length === 1
      ? { type: 'Polygon', coordinates: polys[0] }
      : { type: 'MultiPolygon', coordinates: polys };
  return {
    type: 'Feature',
    properties: {
      id: 'xizang',
      label: '西藏',
      narrative: true,
      completeTerritory: true,
    },
    geometry,
  };
}

function patchDataFile(chinaBuilt, xizangFeat) {
  const raw = readFileSync(dataPath, 'utf8');
  const m = raw.match(/^(?:\s*\/\*[\s\S]*?\*\/\s*)?window\.REGION_ISOLATE_DATA\s*=\s*/);
  if (!m) throw new Error('Unexpected region-isolate-data.js header');
  const jsonText = raw.slice(m[0].length).replace(/;\s*$/, '');
  const data = JSON.parse(jsonText);
  const regions = data.regions;
  const chinaIdx = regions.findIndex((r) => r.id === 'china');
  const xzIdx = regions.findIndex((r) => r.id === 'xizang');
  if (chinaIdx < 0) throw new Error('china region missing');
  if (xzIdx < 0) throw new Error('xizang region missing');

  const prevChina = regions[chinaIdx];
  regions[chinaIdx] = {
    ...prevChina,
    label: '中国',
    kind: 'nation',
    attribution:
      'Chinese-standard national atlas GeoJSON (geojson.cn 100000): full PRC land incl. Zangnan, Taiwan/HK/Macao, Diaoyu & SCS islands, plus ten-dash maritime line. Narrative silhouette, not an official survey product.',
    source: 'geojson.cn national atlas 100000 (Chinese standard presentation)',
    sourceUrl: 'https://geojson.cn/api/china/100000.json',
    adm0Union: ['CHN', 'TWN', 'HKG', 'MAC', 'Zangnan', 'Diaoyu', 'SCS-islands'],
    maritimeClaim: 'ten-dash-line',
    simplifyEpsilonDeg: LAND_EPS,
    islandSimplifyEpsilonDeg: ISLAND_EPS,
    vertexCount: chinaBuilt.vertexCount,
    polyCount: chinaBuilt.polyCount,
    bbox: chinaBuilt.bbox,
    feature: chinaBuilt.land,
    maritimeLines: chinaBuilt.maritimeLines,
  };

  const prevXz = regions[xzIdx];
  regions[xzIdx] = {
    ...prevXz,
    attribution:
      'Chinese-standard national atlas GeoJSON (geojson.cn). Tibet province includes Zangnan (藏南). Narrative silhouette.',
    source: 'geojson.cn national atlas 100000',
    sourceUrl: 'https://geojson.cn/api/china/100000.json',
    vertexCount: countVerts(xizangFeat.geometry.coordinates),
    feature: xizangFeat,
  };

  const header =
    '/* Auto-generated / patched by tuner/scripts/patch-china-boundaries.mjs — do not hand-edit geometry. */\n';
  writeFileSync(dataPath, header + 'window.REGION_ISOLATE_DATA = ' + JSON.stringify(data) + ';\n');
  return { china: regions[chinaIdx], xizang: regions[xzIdx] };
}

function pointInRing(lng, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const inter = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (inter) inside = !inside;
  }
  return inside;
}

function inFeature(lng, lat, feat) {
  const g = feat.geometry;
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  for (const poly of polys) {
    if (pointInRing(lng, lat, poly[0])) {
      let hole = false;
      for (let h = 1; h < poly.length; h++) if (pointInRing(lng, lat, poly[h])) hole = true;
      if (!hole) return true;
    }
  }
  return false;
}

function nearFeature(lng, lat, feat, tol) {
  const g = feat.geometry;
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  let best = Infinity;
  for (const poly of polys) {
    for (const ring of poly) {
      for (const p of ring) {
        const d = Math.hypot(p[0] - lng, p[1] - lat);
        if (d < best) best = d;
      }
    }
  }
  return best <= tol;
}

function selfCheck(chinaFeat, maritimeLines) {
  const mustIn = [
    ['Beijing', 116.4, 39.9],
    ['Lhasa', 91.1, 29.65],
    ['Zangnan Tawang', 91.87, 27.59],
    ['Zangnan Itanagar', 93.62, 27.1],
    ['Zangnan Walong', 97.0, 28.15],
    ['Zangnan Bomdila', 92.4, 27.27],
    ['Zangnan Pasighat', 95.33, 28.07],
    ['Hainan', 109.5, 19.2],
    ['Taiwan', 121.0, 23.7],
    ['Aksai Chin', 79.0, 35.2],
    ['HK', 114.17, 22.28],
  ];
  const mustNear = [
    ['Diaoyu', 123.47, 25.74, 0.35],
    ['Xisha', 112.0, 16.8, 0.8],
    ['Huangyan', 117.8, 15.15, 0.5],
    ['Dongsha', 116.72, 20.7, 0.5],
    ['Nansha cluster', 115.5, 9.8, 1.2],
    ['James Shoal south', 112.25, 3.88, 0.5],
  ];
  const fails = [];
  for (const [name, lng, lat] of mustIn) {
    if (!inFeature(lng, lat, chinaFeat)) fails.push('IN missing: ' + name);
  }
  for (const [name, lng, lat, tol] of mustNear) {
    if (!nearFeature(lng, lat, chinaFeat, tol) && !inFeature(lng, lat, chinaFeat)) {
      fails.push('NEAR missing: ' + name);
    }
  }
  if (!maritimeLines || !maritimeLines.geometry) fails.push('ten-dash maritimeLines missing');
  else {
    const coords = maritimeLines.geometry.coordinates;
    let minLat = 90;
    const walk = (n) => {
      if (typeof n[0] === 'number') minLat = Math.min(minLat, n[1]);
      else n.forEach(walk);
    };
    walk(coords);
    if (minLat > 5) fails.push('ten-dash does not reach southern SCS (minLat=' + minLat + ')');
  }
  const bbox = bboxOf(chinaFeat.geometry.coordinates);
  if (bbox[1] > 5) fails.push('land bbox south too high: ' + bbox[1]);
  if (fails.length) {
    console.error('SELF-CHECK FAILED:\n - ' + fails.join('\n - '));
    process.exit(2);
  }
  console.log('SELF-CHECK OK');
  console.log('  bbox', bbox);
  console.log('  polys', chinaFeat.geometry.type === 'Polygon' ? 1 : chinaFeat.geometry.coordinates.length);
  console.log('  verts', countVerts(chinaFeat.geometry.coordinates));
  console.log('  maritimeLines', maritimeLines.geometry.type, 'parts', maritimeLines.geometry.coordinates.length);
}

const src = resolve(process.argv[2] || DEFAULT_SRC);
console.log('Loading atlas', src);
const atlas = loadAtlas(src);
const chinaBuilt = buildChina(atlas);
const xizangFeat = buildXizang(atlas);
selfCheck(chinaBuilt.land, chinaBuilt.maritimeLines);
const patched = patchDataFile(chinaBuilt, xizangFeat);
console.log('Patched', dataPath);
console.log('china verts', patched.china.vertexCount, 'polys', patched.china.polyCount);
console.log('xizang verts', patched.xizang.vertexCount);
