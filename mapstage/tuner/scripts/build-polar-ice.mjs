/**
 * Tiny ice overlay for globe poles. DEM treats missing polar samples as 0 m (潮滩).
 *
 *   node tuner/scripts/build-polar-ice.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const nePath = join(here, '_ne_cache', 'ne_50m_admin_0_countries.geojson');
const outPath = join(here, '..', 'assets', 'polar-ice.geojson');
const EPS = 0.35;
const LAT_MAX = 85;

function perpDist(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-18) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

function rdp(points, eps) {
  if (!points || points.length <= 4) return points;
  const last = points.length - 1;
  let maxD = -1;
  let idx = 0;
  for (let i = 1; i < last; i++) {
    const d = perpDist(points[i], points[0], points[last]);
    if (d > maxD) { maxD = d; idx = i; }
  }
  if (maxD > eps) {
    const left = rdp(points.slice(0, idx + 1), eps);
    const right = rdp(points.slice(idx), eps);
    return left.slice(0, -1).concat(right);
  }
  return [points[0], points[last]];
}

function closeRing(ring) {
  if (!ring.length) return ring;
  const a = ring[0];
  const b = ring[ring.length - 1];
  if (a[0] !== b[0] || a[1] !== b[1]) ring.push([a[0], a[1]]);
  return ring;
}

function clampLat(lat) {
  return Math.max(-LAT_MAX, Math.min(LAT_MAX, lat));
}

function simplifyRing(ring) {
  if (!ring || ring.length < 4) return null;
  const body = closeRing(ring.map(function (p) {
    return [p[0], clampLat(p[1])];
  })).slice(0, -1);
  const simple = closeRing(rdp(body, EPS));
  return simple.length >= 4 ? simple : null;
}

function latRing(lat, steps, clockwise) {
  const ring = [];
  for (let i = 0; i <= steps; i++) {
    const t = clockwise ? (steps - i) : i;
    const lon = -180 + (360 * t) / steps;
    ring.push([lon, lat]);
  }
  return closeRing(ring);
}

function signedArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  }
  return a / 2;
}

function simplifyGeom(geom, punchPoleHole) {
  const polys = geom.type === 'Polygon' ? [geom.coordinates]
    : geom.type === 'MultiPolygon' ? geom.coordinates : [];
  const out = [];
  let largest = -1;
  let largestArea = 0;
  polys.forEach(function (poly) {
    const outer = simplifyRing(poly[0]);
    if (!outer) return;
    const area = Math.abs(signedArea(outer));
    const rings = [outer];
    if (area > largestArea) {
      largestArea = area;
      largest = out.length;
    }
    out.push(rings);
  });
  if (!out.length) return null;
  if (punchPoleHole && largest >= 0) {
    const outer = out[largest][0];
    const hole = latRing(-84.6, 72, signedArea(outer) > 0);
    if (Math.sign(signedArea(hole)) === Math.sign(signedArea(outer))) {
      hole.reverse();
    }
    out[largest] = [outer, hole];
  }
  return out.length === 1
    ? { type: 'Polygon', coordinates: out[0] }
    : { type: 'MultiPolygon', coordinates: out };
}

function vertsOf(geom) {
  const walk = function (c) {
    if (typeof c[0] === 'number') return 1;
    return c.reduce(function (n, x) { return n + walk(x); }, 0);
  };
  return walk(geom.coordinates);
}

const ne = JSON.parse(readFileSync(nePath, 'utf8'));
const keep = new Set(['ATA', 'GRL']);
const features = [];
ne.features.forEach(function (feat) {
  const iso = feat.properties && (feat.properties.iso_a3 || feat.properties.adm0_a3);
  if (!keep.has(iso) || !feat.geometry) return;
  const geom = simplifyGeom(feat.geometry, iso === 'ATA');
  if (!geom) return;
  features.push({
    type: 'Feature',
    properties: { kind: 'ice', name: iso },
    geometry: geom,
  });
});

const out = { type: 'FeatureCollection', features: features };
writeFileSync(outPath, JSON.stringify(out));
const verts = features.reduce(function (n, f) { return n + vertsOf(f.geometry); }, 0);
console.log(JSON.stringify({
  features: features.length,
  names: features.map(function (f) { return f.properties.name; }),
  verts: verts,
  bytes: Buffer.byteLength(JSON.stringify(out)),
  outPath: outPath,
}, null, 2));
