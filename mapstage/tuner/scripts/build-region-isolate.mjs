/**
 * Build tuner/assets/region-isolate-data.js:
 *   china     — Natural Earth 50m admin-0 (narrative silhouette)
 *   provinces — OSM administrative polygons (ODbL), simplified
 *   cities    — OSM admin_level=5 prefecture divisions (scripts/city-catalog.mjs)
 *   zhangye   — curated city extra under Gansu (province-catalog.mjs)
 *
 * City parentId = province whose polygon contains the city centroid.
 * Raw downloads cache under scripts/_ne_cache (gitignored) — resumable.
 *
 * Usage (from tuner/):
 *   node scripts/fetch-city-catalog.mjs   # once, refreshes city list
 *   node scripts/build-region-isolate.mjs
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OSM_PROVINCES, OSM_CITIES } from './province-catalog.mjs';
import { CITY_RAW } from './city-catalog.mjs';

const NE_URLS = [
  'https://d2ad6b4ur7yvpq.cloudfront.net/naturalearth-3.3.0/ne_50m_admin_0_countries.geojson',
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson',
];
const NE_SOURCE = 'Natural Earth 50m admin-0 countries';

const OSM_FR = 'https://polygons.openstreetmap.fr/get_geojson.py?id=';
const CITY_CONCURRENCY = 3;
const CITY_STAGGER_MS = 150;

const KEEP_ADM0 = new Set(['CHN', 'TWN', 'HKG', 'MAC']);
const MIN_RING_AREA = 0.02; // sq deg; keeps Hainan/Taiwan, drops reef specks
const TARGET_MIN_VERTS = 400;
const TARGET_MAX_VERTS = 1400;
const EPS_CANDIDATES = [0.02, 0.035, 0.05, 0.07, 0.1, 0.14];

const CITY_SPEC = {
  minRingArea: 0.001,
  targetMin: 100,
  targetMax: 320,
  epsCandidates: [0.006, 0.01, 0.016, 0.024, 0.035],
};

// 氹仔 / 路環：澳门离岛，简化后低于市级最小面积，且已含于澳门省级轮廓
// 九龍 / 香港島 / 新界：香港本为省级单位（catalog 已有），其下辖区不进市级目录
const CITY_SKIP_RELIDS = new Set([5758868, 5758869, 10268797, 10264792, 10268964]);

const root = dirname(fileURLToPath(import.meta.url));
const outPath = join(root, '..', 'assets', 'region-isolate-data.js');
const cacheDir = join(root, '_ne_cache');
const cachePath = join(cacheDir, 'ne_50m_admin_0_countries.geojson');

async function loadNaturalEarth() {
  const { existsSync, readFileSync, mkdirSync, writeFileSync: writeCache } = await import('node:fs');
  if (existsSync(cachePath)) {
    const text = readFileSync(cachePath, 'utf8');
    const json = JSON.parse(text);
    if (json && Array.isArray(json.features) && json.features.length) {
      console.log('Using cache ' + cachePath);
      return json;
    }
  }
  let lastErr = null;
  for (const url of NE_URLS) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + url);
      const json = await res.json();
      if (!json || !Array.isArray(json.features)) throw new Error('no features from ' + url);
      mkdirSync(dirname(cachePath), { recursive: true });
      writeCache(cachePath, JSON.stringify(json));
      console.log('Downloaded ' + url);
      return json;
    } catch (err) {
      lastErr = err;
      console.warn('Fetch failed: ' + (err && err.message));
    }
  }
  throw lastErr || new Error('Natural Earth download failed');
}

function adm0Code(props) {
  if (!props) return '';
  return String(
    props.ADM0_A3 ||
      props.adm0_a3 ||
      props.ISO_A3 ||
      props.iso_a3 ||
      props.ADM0_A3_US ||
      props.adm0_a3_us ||
      ''
  ).toUpperCase();
}

function closeRing(ring) {
  if (!ring || ring.length < 3) return null;
  const out = ring.map(function (p) {
    return [Number(p[0]), Number(p[1])];
  });
  const a = out[0];
  const b = out[out.length - 1];
  if (a[0] !== b[0] || a[1] !== b[1]) out.push([a[0], a[1]]);
  return out;
}

function signedArea(ring) {
  let a = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return a / 2;
}

function distToSeg(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const mag2 = dx * dx + dy * dy;
  if (mag2 < 1e-18) {
    return Math.hypot(p[0] - a[0], p[1] - a[1]);
  }
  return Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / Math.sqrt(mag2);
}

function rdp(points, eps) {
  if (points.length <= 2) return points.slice();
  let maxD = 0;
  let idx = 0;
  const first = points[0];
  const last = points[points.length - 1];
  for (let i = 1; i < points.length - 1; i++) {
    const d = distToSeg(points[i], first, last);
    if (d > maxD) {
      maxD = d;
      idx = i;
    }
  }
  if (maxD > eps) {
    const left = rdp(points.slice(0, idx + 1), eps);
    const right = rdp(points.slice(idx), eps);
    return left.slice(0, -1).concat(right);
  }
  return [first, last];
}

function simplifyRing(ring, eps) {
  const closed = closeRing(ring);
  if (!closed) return null;
  const open = closed.slice(0, -1);
  const simplified = rdp(open, eps);
  if (simplified.length < 3) return closed;
  simplified.push([simplified[0][0], simplified[0][1]]);
  return simplified;
}

function roundRing(ring, digits) {
  const f = Math.pow(10, digits);
  return ring.map(function (p) {
    return [Math.round(p[0] * f) / f, Math.round(p[1] * f) / f];
  });
}

function extractPolygons(geom) {
  if (!geom) return [];
  if (geom.type === 'Polygon') return [geom.coordinates];
  if (geom.type === 'MultiPolygon') return geom.coordinates;
  return [];
}

function countVerts(polys) {
  let n = 0;
  for (const poly of polys) {
    for (const ring of poly) n += ring.length;
  }
  return n;
}

function buildPolys(features, eps, minArea) {
  const min = minArea != null ? minArea : MIN_RING_AREA;
  const polys = [];
  for (const feat of features) {
    for (const coords of extractPolygons(feat.geometry)) {
      const outer = closeRing(coords[0]);
      if (!outer) continue;
      if (Math.abs(signedArea(outer)) < min) continue;
      const simple = simplifyRing(outer, eps);
      if (!simple || simple.length < 4) continue;
      polys.push([roundRing(simple, 4)]);
    }
  }
  polys.sort(function (a, b) {
    return Math.abs(signedArea(b[0])) - Math.abs(signedArea(a[0]));
  });
  return polys;
}

async function loadJsonCache(fileName, urls) {
  const { existsSync, readFileSync, mkdirSync, writeFileSync: writeCache } = await import('node:fs');
  const filePath = join(cacheDir, fileName);
  if (existsSync(filePath)) {
    const json = JSON.parse(readFileSync(filePath, 'utf8'));
    return json;
  }
  let lastErr = null;
  mkdirSync(cacheDir, { recursive: true });
  for (let attempt = 0; attempt < 3; attempt++) {
    for (const url of urls) {
      try {
        await new Promise((r) => setTimeout(r, attempt === 0 ? 0 : 800 * (attempt + 1)));
        const res = await fetch(url, {
          headers: { 'User-Agent': 'mapstage/region-isolate' },
        });
        if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + url);
        const json = await res.json();
        if (!json || !json.coordinates) throw new Error('bad geometry from ' + url);
        writeCache(filePath, JSON.stringify(json));
        return json;
      } catch (err) {
        lastErr = err;
      }
    }
  }
  throw lastErr || new Error('download failed ' + fileName);
}

function pickSimplifiedPolys(features, spec) {
  let chosenEps = spec.epsCandidates[0];
  let polys = buildPolys(features, chosenEps, spec.minRingArea);
  for (const eps of spec.epsCandidates) {
    const candidate = buildPolys(features, eps, spec.minRingArea);
    const n = countVerts(candidate);
    chosenEps = eps;
    polys = candidate;
    if (n <= spec.targetMax && n >= spec.targetMin) break;
    if (n <= spec.targetMax && eps === spec.epsCandidates[spec.epsCandidates.length - 1]) break;
  }
  return { polys, chosenEps };
}

async function buildOsmRegion(spec) {
  const geom = await loadJsonCache(spec.cacheName, [OSM_FR + spec.relId + '&params=0']);
  if (!geom || !geom.coordinates) throw new Error('no OSM geometry for ' + spec.id);
  const { polys, chosenEps } = pickSimplifiedPolys([{ geometry: geom }], spec);
  if (!polys.length) throw new Error('empty OSM region ' + spec.id);
  const region = {
    id: spec.id,
    label: spec.label,
    kind: spec.kind || 'province',
    group: spec.group || '',
    attribution:
      'OpenStreetMap contributors, ODbL 1.0. OSM relation ' +
      spec.relId +
      '. Simplified isolate silhouette, not an official boundary.',
    source: 'OpenStreetMap administrative boundary',
    sourceUrl: 'https://www.openstreetmap.org/relation/' + spec.relId,
    osmRelation: spec.relId,
    simplifyEpsilonDeg: chosenEps,
    vertexCount: countVerts(polys),
    feature: {
      type: 'Feature',
      properties: { id: spec.id, label: spec.label, narrative: true },
      geometry: { type: 'MultiPolygon', coordinates: polys },
    },
  };
  if (spec.parentId) region.parentId = spec.parentId;
  return region;
}

/** 质心近似：最大外环顶点平均；不落在任何省时退回 bbox 中心 */
function cityCentroid(polys) {
  let best = null;
  let bestArea = -1;
  for (const poly of polys) {
    const ring = poly[0];
    const area = Math.abs(signedArea(ring));
    if (area > bestArea) {
      bestArea = area;
      best = ring;
    }
  }
  if (!best) return null;
  let x = 0;
  let y = 0;
  for (const p of best) {
    x += p[0];
    y += p[1];
  }
  return [x / best.length, y / best.length];
}

function bboxCenter(polys) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const poly of polys) {
    for (const p of poly[0]) {
      if (p[0] < minX) minX = p[0];
      if (p[1] < minY) minY = p[1];
      if (p[0] > maxX) maxX = p[0];
      if (p[1] > maxY) maxY = p[1];
    }
  }
  return [(minX + maxX) / 2, (minY + maxY) / 2];
}

function polysBbox(polys) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const poly of polys) {
    for (const p of poly[0]) {
      if (p[0] < minX) minX = p[0];
      if (p[1] < minY) minY = p[1];
      if (p[0] > maxX) maxX = p[0];
      if (p[1] > maxY) maxY = p[1];
    }
  }
  return [minX, minY, maxX, maxY];
}

function pointInPolys(pt, polys) {
  // even-odd ray cast over all outer rings
  const x = pt[0];
  const y = pt[1];
  for (const poly of polys) {
    const ring = poly[0];
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i][0];
      const yi = ring[i][1];
      const xj = ring[j][0];
      const yj = ring[j][1];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    if (inside) return true;
  }
  return false;
}

function bboxOverlap(a, b) {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

/**
 * 归省：取「该市顶点被包含比例最高」的省。
 * 月牙形抱界的市（如甘南）顶点平均质心可能落进邻省简化轮廓，质心法会判错；
 * 包含率对简化边界偏差和异形轮廓都稳。
 */
function findParentProvince(cityPolys, provinceRegions) {
  const box = polysBbox(cityPolys);
  let best = null;
  let bestFrac = 0;
  for (const prov of provinceRegions) {
    const provPolys = prov.feature.geometry.coordinates;
    if (!bboxOverlap(box, polysBbox(provPolys))) continue;
    let inside = 0;
    let total = 0;
    for (const poly of cityPolys) {
      for (let i = 0; i < poly[0].length; i += 2) {
        total++;
        if (pointInPolys(poly[0][i], provPolys)) inside++;
      }
    }
    const frac = total ? inside / total : 0;
    if (frac > bestFrac) {
      bestFrac = frac;
      best = prov;
    }
  }
  if (best && bestFrac > 0.2) return best;
  // 兜底：质心 / bbox 中心逐省试探
  const c1 = cityCentroid(cityPolys);
  for (const prov of provinceRegions) {
    if (c1 && pointInPolys(c1, prov.feature.geometry.coordinates)) return prov;
  }
  const c2 = bboxCenter(cityPolys);
  for (const prov of provinceRegions) {
    if (pointInPolys(c2, prov.feature.geometry.coordinates)) return prov;
  }
  return null;
}

const fc = await loadNaturalEarth();

const kept = fc.features.filter(function (f) {
  return KEEP_ADM0.has(adm0Code(f.properties));
});
if (!kept.length) {
  throw new Error('No CHN/TWN/HKG/MAC features in Natural Earth file');
}

let chosenEps = EPS_CANDIDATES[0];
let polys = buildPolys(kept, chosenEps);
for (const eps of EPS_CANDIDATES) {
  const candidate = buildPolys(kept, eps);
  const n = countVerts(candidate);
  chosenEps = eps;
  polys = candidate;
  if (n <= TARGET_MAX_VERTS && n >= TARGET_MIN_VERTS) break;
  if (n <= TARGET_MAX_VERTS && eps === EPS_CANDIDATES[EPS_CANDIDATES.length - 1]) break;
}

if (!polys.length) {
  throw new Error('Simplification produced empty geometry');
}

const feature = {
  type: 'Feature',
  properties: {
    id: 'china',
    label: '中国',
    narrative: true,
  },
  geometry: {
    type: 'MultiPolygon',
    coordinates: polys,
  },
};

// ---- provinces (sequential; mostly cached after first run) ----
const provinceRegions = [];
for (const spec of OSM_PROVINCES) {
  const region = await buildOsmRegion(spec);
  provinceRegions.push(region);
  console.log(region.id + ' verts=' + region.vertexCount + ' eps=' + region.simplifyEpsilonDeg);
}

// ---- cities: curated first, then auto-fetched (dedupe by relId) ----
const curatedRelIds = new Set(OSM_CITIES.map((c) => c.relId));
const cityRegions = [];
for (const spec of OSM_CITIES) {
  const region = await buildOsmRegion(spec);
  cityRegions.push(region);
  console.log(region.id + ' (curated) verts=' + region.vertexCount);
}

const citySpecs = CITY_RAW.filter(
  (c) => !curatedRelIds.has(c.relId) && !CITY_SKIP_RELIDS.has(c.relId)
).map((c) => ({
  id: 'c' + c.relId,
  label: c.label,
  relId: c.relId,
  kind: 'city',
  cacheName: 'osm-city-R' + c.relId + '.geojson',
  ...CITY_SPEC,
}));

console.log('Fetching ' + citySpecs.length + ' city polygons (concurrency ' + CITY_CONCURRENCY + ')…');
const failed = [];
let done = 0;
let cursor = 0;
async function worker(wid) {
  while (cursor < citySpecs.length) {
    const spec = citySpecs[cursor++];
    try {
      const region = await buildOsmRegion(spec);
      const polysGeom = region.feature.geometry.coordinates;
      const parent = findParentProvince(polysGeom, provinceRegions);
      if (!parent) {
        console.warn('no parent province for ' + spec.label + ' (rel ' + spec.relId + ') — skipped');
        failed.push(spec.label + ':' + spec.relId + ':no-parent');
      } else {
        region.parentId = parent.id;
        region.group = parent.group || '';
        cityRegions.push(region);
      }
    } catch (err) {
      console.warn('city failed ' + spec.label + ' rel=' + spec.relId + ' — ' + err.message);
      failed.push(spec.label + ':' + spec.relId + ':' + (err && err.message));
    }
    done++;
    if (done % 25 === 0 || done === citySpecs.length) {
      console.log('cities ' + done + '/' + citySpecs.length);
    }
    await new Promise((r) => setTimeout(r, CITY_STAGGER_MS));
  }
}
await Promise.all(Array.from({ length: CITY_CONCURRENCY }, (_, i) => worker(i)));

cityRegions.sort(function (a, b) {
  return a.label.localeCompare(b.label, 'zh');
});

const payload = {
  version: 1,
  defaultId: 'china',
  regions: [
    {
      id: 'china',
      label: '中国',
      kind: 'nation',
      group: '',
      attribution:
        'Natural Earth 50m admin-0 (public domain). Narrative silhouette, not an official boundary.',
      source: NE_SOURCE,
      sourceUrl: NE_URLS[0],
      adm0Union: ['CHN', 'TWN', 'HKG', 'MAC'],
      simplifyEpsilonDeg: chosenEps,
      vertexCount: countVerts(polys),
      feature: feature,
    },
  ]
    .concat(provinceRegions)
    .concat(cityRegions),
};

const body =
  '/* Auto-generated by tuner/scripts/build-region-isolate.mjs — do not hand-edit geometry. */\n' +
  'window.REGION_ISOLATE_DATA = ' +
  JSON.stringify(payload) +
  ';\n';

writeFileSync(outPath, body, 'utf8');
console.log(
  'Wrote ' +
    outPath +
    ' eps=' +
    chosenEps +
    ' provinces=' +
    provinceRegions.length +
    ' cities=' +
    cityRegions.length +
    ' verts=' +
    countVerts(polys) +
    '(china)' +
    ' bytes=' +
    Buffer.byteLength(body)
);
if (failed.length) {
  console.warn('FAILED (' + failed.length + '): ' + failed.join(' | '));
  console.warn('Re-run to retry failures (cached successes are skipped).');
}
