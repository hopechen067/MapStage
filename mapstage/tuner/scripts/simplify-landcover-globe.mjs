/**
 * Build a globe-safe landcover GeoJSON from landcover-lowzoom.geojson.
 * Globe tessellation cannot swallow ~720k verts; this keeps kind colors at z<7.
 *
 * Independent RDP at 0.35° turned shared forest/farmland edges into triangular
 * parchment gaps (缺角烂面), and collapsed Taiwan/Fujian coastal rings.
 *
 *   node tuner/scripts/simplify-landcover-globe.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const assets = join(here, '..', 'assets');
const srcPath = join(assets, 'landcover-lowzoom.geojson');
const outPath = join(assets, 'landcover-globe.geojson');

const MIN_OUTER_AREA = 0.08;
const MIN_URBAN_AREA = 0.02;
const ISLAND_SPAN = 3.2;
const MAX_EDGE_ISLAND = 0.7;
const MAX_RING_VERTS = 180;
const PAD_DEG = 0.045;
const GRID = 0.04;

/** Extra small-polygon keep windows — East Asia coasts the globe shot actually shows. */
const FINE_BOXES = [
  { b: [119.1, 21.7, 122.3, 25.6], min: 0.006 },
  { b: [108.4, 17.9, 111.6, 20.6], min: 0.006 },
  { b: [116.6, 22.4, 120.9, 27.7], min: 0.01 },
  { b: [129.0, 30.0, 146.0, 45.8], min: 0.012 },
  { b: [119.0, 5.0, 127.0, 19.2], min: 0.012 },
  { b: [124.4, 33.0, 129.8, 38.8], min: 0.01 },
  { b: [102.0, 8.2, 110.0, 23.4], min: 0.012 },
];

function dist2(a, b) {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return dx * dx + dy * dy;
}

function hypot(dx, dy) {
  return Math.sqrt(dx * dx + dy * dy);
}

function perpDist(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-18) return Math.sqrt(dist2(p, a));
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

function rdp(points, eps) {
  if (!points || points.length <= 4) return points;
  const last = points.length - 1;
  let maxD = -1;
  let idx = 0;
  for (let i = 1; i < last; i++) {
    const d = perpDist(points[i], points[0], points[last]);
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
  return [points[0], points[last]];
}

function signedArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  }
  return a / 2;
}

function closeRing(ring) {
  if (!ring.length) return ring;
  const a = ring[0];
  const b = ring[ring.length - 1];
  if (a[0] !== b[0] || a[1] !== b[1]) ring.push([a[0], a[1]]);
  return ring;
}

function bboxSpan(ring) {
  let minX = 180;
  let minY = 90;
  let maxX = -180;
  let maxY = -90;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    if (p[0] < minX) minX = p[0];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] < minY) minY = p[1];
    if (p[1] > maxY) maxY = p[1];
  }
  return Math.max(maxX - minX, maxY - minY);
}

function snap(p) {
  return [
    Math.round(p[0] / GRID) * GRID,
    Math.round(p[1] / GRID) * GRID,
  ];
}

function dedupeRing(ring) {
  const out = [];
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i];
    const prev = out[out.length - 1];
    if (!prev || prev[0] !== p[0] || prev[1] !== p[1]) out.push(p);
  }
  if (out.length > 1) {
    const a = out[0];
    const b = out[out.length - 1];
    if (a[0] === b[0] && a[1] === b[1]) out.pop();
  }
  return closeRing(out);
}

function inFineBox(lng, lat) {
  for (let i = 0; i < FINE_BOXES.length; i++) {
    const b = FINE_BOXES[i].b;
    if (lng >= b[0] && lng <= b[2] && lat >= b[1] && lat <= b[3]) return FINE_BOXES[i];
  }
  return null;
}

function minAreaFor(ring, kind) {
  const c = centroidOf(ring);
  const fine = inFineBox(c[0], c[1]);
  if (fine) return kind === 'urban_area' ? Math.min(fine.min, 0.008) : fine.min;
  if (kind === 'urban_area') return MIN_URBAN_AREA;
  return MIN_OUTER_AREA;
}

function epsFor(ring, kind) {
  const span = Math.max(bboxSpan(ring), 0.08);
  const c = centroidOf(ring);
  const fine = inFineBox(c[0], c[1]);
  if (kind === 'urban_area') return Math.min(0.05, Math.max(0.02, span * 0.06));
  if (fine || span <= ISLAND_SPAN) return Math.min(0.06, Math.max(0.028, span * 0.038));
  if (span <= 12) return 0.16;
  return 0.22;
}

function centroidOf(ring) {
  let x = 0;
  let y = 0;
  const body = ring.slice(0, -1);
  const n = body.length || 1;
  for (let i = 0; i < body.length; i++) {
    x += body[i][0];
    y += body[i][1];
  }
  return [x / n, y / n];
}

function orient(a, b, c) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function segsCross(a, b, c, d) {
  const o1 = orient(a, b, c);
  const o2 = orient(a, b, d);
  const o3 = orient(c, d, a);
  const o4 = orient(c, d, b);
  return o1 * o2 < 0 && o3 * o4 < 0;
}

function ringSelfIntersects(ring) {
  const p = ring.slice(0, -1);
  const n = p.length;
  if (n < 4) return false;
  for (let i = 0; i < n; i++) {
    const a = p[i];
    const b = p[(i + 1) % n];
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const c = p[j];
      const d = p[(j + 1) % n];
      if (segsCross(a, b, c, d)) return true;
    }
  }
  return false;
}

function splitLongEdges(ring, maxLen) {
  const body = ring.slice(0, -1);
  const out = [];
  for (let i = 0; i < body.length; i++) {
    const a = body[i];
    const b = body[(i + 1) % body.length];
    out.push(a);
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const d = hypot(dx, dy);
    const steps = Math.max(1, Math.ceil(d / maxLen));
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      out.push([a[0] + dx * t, a[1] + dy * t]);
    }
  }
  return closeRing(out);
}

function expandFill(ring, pad) {
  const area = signedArea(ring);
  if (!isFinite(area) || Math.abs(area) < 1e-12) return ring;
  const body = ring.slice(0, -1);
  const n = body.length;
  if (n < 3) return ring;
  const sign = area >= 0 ? 1 : -1;
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = body[(i - 1 + n) % n];
    const b = body[i];
    const c = body[(i + 1) % n];
    const e1x = b[0] - a[0];
    const e1y = b[1] - a[1];
    const e2x = c[0] - b[0];
    const e2y = c[1] - b[1];
    const l1 = hypot(e1x, e1y) || 1;
    const l2 = hypot(e2x, e2y) || 1;
    // CCW left normal points interior when area > 0. Expand fill = opposite.
    const n1x = -e1y / l1;
    const n1y = e1x / l1;
    const n2x = -e2y / l2;
    const n2y = e2x / l2;
    let nx = n1x + n2x;
    let ny = n1y + n2y;
    const ln = hypot(nx, ny) || 1;
    nx /= ln;
    ny /= ln;
    out.push([b[0] - sign * pad * nx, b[1] - sign * pad * ny]);
  }
  return closeRing(out);
}

function capRing(body, eps, maxVerts) {
  let simple = closeRing(rdp(body, eps));
  let cur = eps;
  while (simple.length - 1 > maxVerts && cur < 0.4) {
    cur *= 1.25;
    simple = closeRing(rdp(body, cur));
  }
  return simple;
}

function simplifyRing(ring, kind) {
  if (!ring || ring.length < 4) return null;
  const snapped = dedupeRing(ring.map(snap));
  if (snapped.length < 4) return null;
  const span = bboxSpan(snapped);
  const body = snapped.slice(0, -1);
  const eps = epsFor(snapped, kind);
  let simple = capRing(body, eps, MAX_RING_VERTS);
  if (simple.length < 4) return null;
  if (ringSelfIntersects(simple)) {
    simple = capRing(body, eps * 0.45, MAX_RING_VERTS);
    if (simple.length < 4 || ringSelfIntersects(simple)) {
      simple = capRing(body, eps * 0.22, MAX_RING_VERTS);
    }
    if (simple.length < 4 || ringSelfIntersects(simple)) return null;
  }
  const padded = expandFill(simple, span <= ISLAND_SPAN ? PAD_DEG * 0.7 : PAD_DEG);
  const use = (padded.length >= 4 && Math.abs(signedArea(padded)) >= 1e-8 && !ringSelfIntersects(padded))
    ? padded
    : simple;
  if (span > ISLAND_SPAN) return use;
  return splitLongEdges(use, MAX_EDGE_ISLAND);
}

function vertsOf(geom) {
  if (!geom) return 0;
  const walk = function (c) {
    if (typeof c[0] === 'number') return 1;
    return c.reduce(function (n, x) { return n + walk(x); }, 0);
  };
  return walk(geom.coordinates);
}

const KEEP_PER_KIND = 90;

const raw = JSON.parse(readFileSync(srcPath, 'utf8'));
const pool = [];
let dropped = 0;
let holesDropped = 0;

raw.features.forEach(function (feat) {
  const geom = feat.geometry;
  if (!geom) return;
  const kind = (feat.properties && feat.properties.kind) || '';
  const polygons = geom.type === 'Polygon'
    ? [geom.coordinates]
    : geom.type === 'MultiPolygon'
      ? geom.coordinates
      : [];
  polygons.forEach(function (poly) {
    if (!poly || !poly.length) return;
    holesDropped += Math.max(0, poly.length - 1);
    const srcRing = poly[0];
    if (!srcRing || Math.abs(signedArea(srcRing)) < minAreaFor(srcRing, kind)) {
      dropped += 1;
      return;
    }
    const outer = simplifyRing(srcRing, kind);
    if (!outer || Math.abs(signedArea(outer)) < minAreaFor(outer, kind) * 0.7) {
      dropped += 1;
      return;
    }
    const c = centroidOf(outer);
    pool.push({
      kind: kind,
      ring: outer,
      area: Math.abs(signedArea(outer)),
      fine: !!inFineBox(c[0], c[1]),
    });
  });
});

const byKind = {};
pool.forEach(function (p) {
  if (!byKind[p.kind]) byKind[p.kind] = [];
  byKind[p.kind].push(p);
});

const keptPolys = [];
Object.keys(byKind).forEach(function (kind) {
  const list = byKind[kind].slice().sort(function (a, b) { return b.area - a.area; });
  const picked = [];
  const seen = {};
  list.forEach(function (p, idx) {
    if (p.fine || idx < KEEP_PER_KIND) {
      const key = p.ring[0][0] + ',' + p.ring[0][1] + ':' + p.ring.length;
      if (seen[key]) return;
      seen[key] = true;
      picked.push(p);
    }
  });
  picked.forEach(function (p) { keptPolys.push(p); });
});

const features = keptPolys.map(function (p) {
  return {
    type: 'Feature',
    properties: { kind: p.kind },
    geometry: { type: 'Polygon', coordinates: [p.ring] },
  };
});
const kept = keptPolys.length;
const keptFine = keptPolys.filter(function (p) { return p.fine; }).length;
dropped += pool.length - kept;

const out = { type: 'FeatureCollection', features: features };
writeFileSync(outPath, JSON.stringify(out));
const vIn = raw.features.reduce(function (n, f) { return n + vertsOf(f.geometry); }, 0);
const vOut = features.reduce(function (n, f) { return n + vertsOf(f.geometry); }, 0);
const kinds = {};
features.forEach(function (f) {
  const k = f.properties.kind || '?';
  kinds[k] = (kinds[k] || 0) + 1;
});
console.log(JSON.stringify({
  inFeatures: raw.features.length,
  outFeatures: features.length,
  polygonsKept: kept,
  polygonsKeptFine: keptFine,
  polygonsDropped: dropped,
  holesDropped: holesDropped,
  vertsIn: vIn,
  vertsOut: vOut,
  bytes: Buffer.byteLength(JSON.stringify(out)),
  kinds: kinds,
  outPath: outPath,
}, null, 2));
