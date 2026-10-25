#!/usr/bin/env node
/**
 * Rebuild the nation `china` silhouette (+ `xizang` province and the `zangnan`
 * extent) from Natural Earth only (public domain), so the catalog includes the
 * full PRC land extent (藏南 / Zangnan), Taiwan / HK / Macao, Diaoyu and
 * South-China-Sea islands, and the ten-dash maritime line.
 *
 * Sources (Natural Earth 10m, https://www.naturalearthdata.com/):
 *   ne_10m_admin_0_countries_chn                          China POV land
 *   ne_10m_admin_1_states_provinces                       Xizang (province)
 *   ne_10m_minor_islands                                  Diaoyu / Huangyan islets
 *   ne_10m_admin_0_boundary_lines_maritime_indicator_chn  ten-dash line
 * Dongsha, Zhongsha and Zengmu Ansha have no Natural Earth polygon (reef /
 * submerged); they are schematic markers at their published coordinates.
 * Narrative silhouette, not an official survey product.
 *
 * Usage:
 *   node mapstage/tuner/scripts/patch-china-boundaries.mjs [dir-with-the-four-geojson]
 * The directory defaults to $NE_DIR or <repo>/out/ne10m. Needs the dev-only
 * `polygon-clipping` package (npm i polygon-clipping in a scratch dir, point
 * POLYGON_CLIPPING_DIR at it; default <repo>/out/geotool).
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const dataPath = join(root, 'assets/region-isolate-data.js');

const NE_FILES = {
  countries: 'ne_10m_admin_0_countries_chn.geojson',
  admin1: 'ne_10m_admin_1_states_provinces.geojson',
  minorIslands: 'ne_10m_minor_islands.geojson',
  maritime: 'ne_10m_admin_0_boundary_lines_maritime_indicator_chn.geojson',
};
const NE_ADMINS = new Set(['China', 'Hong Kong S.A.R.', 'Macao S.A.R']);
const NE_SOURCE = 'Natural Earth 10m (public domain), China POV';
const NE_URL = 'https://www.naturalearthdata.com/';

const LAND_EPS = 0.003;
const ISLAND_EPS = 0.002;
const MIN_ISLAND_AREA = 1e-6; // deg² — keep SCS / Diaoyu islets
const MAINLAND_AREA_CUT = 0.5; // rings larger than this use LAND_EPS

// Zangnan = PRC land (China POV) inside this box that Xizang's admin-1 shape lacks.
const ZANGNAN_ZONE = [90.0, 26.5, 97.6, 29.2];

// Islets picked out of ne_10m_minor_islands by box (the layer has no country field).
const ISLET_BOXES = [
  { id: 'diaoyu', box: [123.3, 25.6, 123.9, 26.1] },
  { id: 'huangyan', box: [117.6, 15.0, 118.0, 15.4] },
];

// Schematic markers: no polygon in Natural Earth. [id, lng, lat, radius°, sides]
const MARKERS = [
  ['dongsha', 116.72, 20.7, 0.08, 12],
  ['zhongsha', 114.5, 15.9, 0.1, 12],
  ['zengmu', 112.28, 3.97, 0.05, 12],
];

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


function loadJson(path) {
  if (!existsSync(path)) throw new Error('Natural Earth file not found: ' + path);
  return JSON.parse(readFileSync(path, 'utf8'));
}

function loadPolygonClipping() {
  const dir = resolve(process.env.POLYGON_CLIPPING_DIR || join(root, '../../out/geotool'));
  const m = createRequire(join(dir, 'package.json'))('polygon-clipping');
  return m.default || m;
}

function simplifyPolys(feature, eps) {
  const polys = [];
  for (const poly of featurePolygons(feature)) {
    const outer = closeRing(poly[0]);
    if (!outer) continue;
    const area = Math.abs(signedArea(outer));
    if (area < MIN_ISLAND_AREA) continue;
    const e = eps != null ? eps : area >= MAINLAND_AREA_CUT ? LAND_EPS : ISLAND_EPS;
    const so = simplifyRing(outer, e);
    if (!so) continue;
    const holes = [];
    for (let i = 1; i < poly.length; i++) {
      const h = simplifyRing(poly[i], e);
      if (h && Math.abs(signedArea(h)) >= MIN_ISLAND_AREA) holes.push(h.map(roundPt));
    }
    polys.push([so.map(roundPt)].concat(holes));
  }
  return polys;
}

function ringCentroid(ring) {
  const n = ring.length - 1;
  let x = 0;
  let y = 0;
  for (let i = 0; i < n; i++) {
    x += ring[i][0];
    y += ring[i][1];
  }
  return [x / n, y / n];
}

function marker(lng, lat, r, sides) {
  const ring = [];
  for (let i = 0; i < sides; i++) {
    const t = (i / sides) * Math.PI * 2;
    ring.push([lng + r * Math.cos(t), lat + r * Math.sin(t)]);
  }
  ring.push(ring[0].slice());
  return [ring.map(roundPt)];
}

function inBox(p, b) {
  return p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3];
}

function ringBbox(ring) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of ring) {
    if (p[0] < x0) x0 = p[0];
    if (p[0] > x1) x1 = p[0];
    if (p[1] < y0) y0 = p[1];
    if (p[1] > y1) y1 = p[1];
  }
  return [x0, y0, x1, y1];
}

function toGeometry(polys) {
  return polys.length === 1
    ? { type: 'Polygon', coordinates: polys[0] }
    : { type: 'MultiPolygon', coordinates: polys };
}

function buildChina(ne) {
  const polys = [];
  for (const f of ne.countries.features || []) {
    const admin = f.properties && f.properties.ADMIN;
    if (!NE_ADMINS.has(admin)) continue;
    polys.push(...simplifyPolys(f));
  }
  if (!polys.length) throw new Error('No China polygons in Natural Earth countries file');
  const landCount = polys.length;

  let isletsAdded = 0;
  for (const spec of ISLET_BOXES) {
    for (const f of ne.minorIslands.features || []) {
      for (const poly of simplifyPolys(f, ISLAND_EPS)) {
        const c = ringCentroid(poly[0]);
        if (!inBox(c, spec.box)) continue;
        const dup = polys.some((p) => {
          const q = ringCentroid(p[0]);
          return Math.abs(q[0] - c[0]) < 0.01 && Math.abs(q[1] - c[1]) < 0.01;
        });
        if (dup) continue;
        polys.push(poly);
        isletsAdded++;
      }
    }
  }
  for (const [, lng, lat, r, sides] of MARKERS) polys.push(marker(lng, lat, r, sides));

  const lines = [];
  for (const f of ne.maritime.features || []) {
    const g = f.geometry;
    if (!g) continue;
    if (g.type === 'LineString') lines.push(g.coordinates);
    else if (g.type === 'MultiLineString') lines.push(...g.coordinates);
  }
  if (!lines.length) throw new Error('No ten-dash lines in Natural Earth maritime file');
  const maritimeLines = {
    type: 'Feature',
    properties: { id: 'china-ten-dash', label: '十段线', kind: 'maritime-line', narrative: true },
    geometry: { type: 'MultiLineString', coordinates: lines },
  };

  const geometry = toGeometry(polys);
  console.log('china polys', polys.length, '(land ' + landCount + ', islets ' + isletsAdded + ', markers ' + MARKERS.length + ')');
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

function buildXizang(ne, chinaLand) {
  const pc = loadPolygonClipping();
  const f = (ne.admin1.features || []).find(
    (x) => x.properties && x.properties.admin === 'China' && x.properties.name === 'Xizang'
  );
  if (!f) throw new Error('Xizang missing from Natural Earth admin-1');
  const tibet = simplifyPolys(f, LAND_EPS);
  const z = ZANGNAN_ZONE;
  const zone = [[[z[0], z[1]], [z[2], z[1]], [z[2], z[3]], [z[0], z[3]], [z[0], z[1]]]];
  const landInZone = [];
  for (const poly of featurePolygons(chinaLand)) {
    const b = ringBbox(poly[0]);
    if (b[2] < z[0] || b[0] > z[2] || b[3] < z[1] || b[1] > z[3]) continue;
    landInZone.push(...pc.intersection([poly], [zone]));
  }
  const pieces = landInZone.length ? pc.difference(landInZone, tibet) : [];
  const zangnanPolys = pieces
    .filter((p) => Math.abs(signedArea(p[0])) >= 0.01)
    .map((p) => p.map((r) => r.map(roundPt)));
  if (!zangnanPolys.length) throw new Error('No Zangnan land found between Xizang and the China POV outline');
  const xizangPolys = pc.union(tibet, zangnanPolys).map((p) => p.map((r) => r.map(roundPt)));
  console.log('xizang polys', xizangPolys.length, 'zangnan polys', zangnanPolys.length);
  const mk = (id, label, polys) => ({
    type: 'Feature',
    properties: { id, label, narrative: true, completeTerritory: true },
    geometry: toGeometry(polys),
  });
  return { xizang: mk('xizang', '西藏', xizangPolys), zangnan: mk('zangnan', '藏南', zangnanPolys) };
}

function patchDataFile(chinaBuilt, built) {
  const raw = readFileSync(dataPath, 'utf8');
  const m = raw.match(/^(?:\s*\/\*[\s\S]*?\*\/\s*)?window\.REGION_ISOLATE_DATA\s*=\s*/);
  if (!m) throw new Error('Unexpected region-isolate-data.js header');
  const data = JSON.parse(raw.slice(m[0].length).replace(/;\s*$/, ''));
  const regions = data.regions;
  const at = (id) => {
    const i = regions.findIndex((r) => r.id === id);
    if (i < 0) throw new Error(id + ' region missing');
    return i;
  };
  const chinaIdx = at('china');
  const xzIdx = at('xizang');
  const zgIdx = at('zangnan');

  regions[chinaIdx] = {
    ...regions[chinaIdx],
    label: '中国',
    kind: 'nation',
    attribution:
      'Natural Earth 10m China POV (public domain): full PRC land incl. Zangnan, Taiwan/HK/Macao, Diaoyu & SCS islands, plus ten-dash maritime line. Dongsha / Zhongsha / Zengmu Ansha are schematic markers. Narrative silhouette, not an official survey product.',
    source: NE_SOURCE,
    sourceUrl: NE_URL,
    adm0Union: ['CHN', 'HKG', 'MAC', 'Diaoyu', 'SCS-islands'],
    maritimeClaim: 'ten-dash-line',
    simplifyEpsilonDeg: LAND_EPS,
    islandSimplifyEpsilonDeg: ISLAND_EPS,
    vertexCount: chinaBuilt.vertexCount,
    polyCount: chinaBuilt.polyCount,
    bbox: chinaBuilt.bbox,
    feature: chinaBuilt.land,
    maritimeLines: chinaBuilt.maritimeLines,
  };
  const note = {
    xizang:
      'Natural Earth admin-1 Xizang plus PRC land south of it (China POV), so Tibet includes Zangnan (藏南). Narrative silhouette.',
    zangnan:
      'Natural Earth China POV land south of the admin-1 Xizang outline (Arunachal / Zangnan extent). Narrative silhouette.',
  };
  for (const [idx, key] of [
    [xzIdx, 'xizang'],
    [zgIdx, 'zangnan'],
  ]) {
    const coords = built[key].geometry.coordinates;
    regions[idx] = {
      ...regions[idx],
      attribution: note[key],
      source: NE_SOURCE,
      sourceUrl: NE_URL,
      vertexCount: countVerts(coords),
      bbox: bboxOf(coords),
      polyCount: built[key].geometry.type === 'Polygon' ? 1 : coords.length,
      feature: built[key],
    };
  }

  const header =
    '/* Auto-generated / patched by tuner/scripts/patch-china-boundaries.mjs — do not hand-edit geometry. */\n';
  writeFileSync(dataPath, header + 'window.REGION_ISOLATE_DATA = ' + JSON.stringify(data) + ';\n', 'utf8');
  return { china: regions[chinaIdx], xizang: regions[xzIdx], zangnan: regions[zgIdx] };
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
    ['Zangnan Along', 94.2, 28.17],
    ['Hainan', 109.5, 19.2],
    ['Taiwan', 121.0, 23.7],
    ['Aksai Chin', 79.0, 35.2],
    ['HK', 114.18, 22.32],
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


const dir = resolve(process.argv[2] || process.env.NE_DIR || join(root, '../../out/ne10m'));
console.log('Natural Earth dir', dir);
const ne = {};
for (const [k, name] of Object.entries(NE_FILES)) ne[k] = loadJson(join(dir, name));
const chinaBuilt = buildChina(ne);
const built = buildXizang(ne, chinaBuilt.land);
selfCheck(chinaBuilt.land, chinaBuilt.maritimeLines);
const patched = patchDataFile(chinaBuilt, built);
console.log('Patched', dataPath);
console.log('china verts', patched.china.vertexCount, 'polys', patched.china.polyCount);
console.log('xizang verts', patched.xizang.vertexCount, 'zangnan verts', patched.zangnan.vertexCount);
