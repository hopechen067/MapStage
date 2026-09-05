/**
 * Region isolate helpers: world polygon with selected region as holes.
 * Narrative cartography only — not an official boundary.
 */
(function (root) {
  'use strict';

  var WORLD_RING = [
    [-180, -85],
    [180, -85],
    [180, 85],
    [-180, 85],
    [-180, -85],
  ];

  function closeRing(ring) {
    if (!ring || ring.length < 3) return null;
    var out = [];
    for (var i = 0; i < ring.length; i++) {
      out.push([Number(ring[i][0]), Number(ring[i][1])]);
    }
    var a = out[0];
    var b = out[out.length - 1];
    if (a[0] !== b[0] || a[1] !== b[1]) out.push([a[0], a[1]]);
    if (out.length < 4) return null;
    return out;
  }

  function signedArea(ring) {
    var area = 0;
    for (var i = 0; i < ring.length - 1; i++) {
      area += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
    }
    return area / 2;
  }

  function ensureWinding(ring, clockwise) {
    var closed = closeRing(ring);
    if (!closed) return null;
    var area = signedArea(closed);
    var isClockwise = area < 0;
    if (isClockwise === clockwise) return closed;
    var rev = closed.slice().reverse();
    return closeRing(rev);
  }

  function extractOuterRings(geom) {
    var rings = [];
    if (!geom || !geom.coordinates) return rings;
    if (geom.type === 'Polygon') {
      if (geom.coordinates[0]) rings.push(geom.coordinates[0]);
    } else if (geom.type === 'MultiPolygon') {
      for (var i = 0; i < geom.coordinates.length; i++) {
        var poly = geom.coordinates[i];
        if (poly && poly[0]) rings.push(poly[0]);
      }
    }
    return rings;
  }

  /**
   * Drop OSM speck rings (Beijing/Tianjin coastal fragments, tiny islets).
   * Nation-scale silhouettes (China) must keep Hainan / Taiwan: they are ~0.3%
   * of the mainland, so the 2% city/province cut would erase them.
   */
  var NARRATIVE_MIN_FRAC = 0.02;
  var NARRATIVE_MIN_AREA = 0.002;
  var NARRATIVE_NATION_AREA = 100;
  var NARRATIVE_NATION_MIN_AREA = 1;

  function dominantOuterRings(geom) {
    var rings = extractOuterRings(geom);
    if (rings.length <= 1) return rings;
    var areas = [];
    var maxA = 0;
    var i;
    for (i = 0; i < rings.length; i++) {
      var closed = closeRing(rings[i]);
      var a = closed ? Math.abs(signedArea(closed)) : 0;
      areas.push(a);
      if (a > maxA) maxA = a;
    }
    var nation = maxA >= NARRATIVE_NATION_AREA;
    var cut = nation
      ? NARRATIVE_NATION_MIN_AREA
      : Math.max(maxA * NARRATIVE_MIN_FRAC, NARRATIVE_MIN_AREA);
    var out = [];
    for (i = 0; i < rings.length; i++) {
      if (areas[i] >= cut) out.push(rings[i]);
    }
    if (out.length) return out;
    var best = 0;
    for (i = 1; i < areas.length; i++) if (areas[i] > areas[best]) best = i;
    return [rings[best]];
  }

  function narrativeFeature(input) {
    var feat = featureFromUnknown(input);
    if (!feat) return null;
    var rings = dominantOuterRings(feat.geometry);
    if (!rings.length) return null;
    var polys = [];
    var i;
    for (i = 0; i < rings.length; i++) {
      var closed = closeRing(rings[i]);
      if (closed) polys.push([closed]);
    }
    if (!polys.length) return null;
    return {
      type: 'Feature',
      properties: feat.properties || {},
      geometry:
        polys.length === 1
          ? { type: 'Polygon', coordinates: polys[0] }
          : { type: 'MultiPolygon', coordinates: polys },
    };
  }

  function geometryBbox(geom) {
    if (!geom || !geom.coordinates) return null;
    var minX = Infinity;
    var minY = Infinity;
    var maxX = -Infinity;
    var maxY = -Infinity;
    function walk(node) {
      if (!node) return;
      if (typeof node[0] === 'number') {
        var x = Number(node[0]);
        var y = Number(node[1]);
        if (!isFinite(x) || !isFinite(y)) return;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
        return;
      }
      for (var i = 0; i < node.length; i++) walk(node[i]);
    }
    walk(geom.coordinates);
    if (!isFinite(minX) || minX > maxX) return null;
    return [minX, minY, maxX, maxY];
  }

  function featureBbox(featureOrGeom) {
    var geom = featureOrGeom;
    if (geom && geom.type === 'Feature') geom = geom.geometry;
    return geometryBbox(geom);
  }

  function bboxIntersects(a, b) {
    if (!a || !b) return true;
    return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
  }

  function bboxContainsPoint(box, lng, lat) {
    if (!box) return true;
    return lng >= box[0] && lng <= box[2] && lat >= box[1] && lat <= box[3];
  }

  /**
   * y 向 1° 分桶边索引。走廊省（甘肃/内蒙古）的外接框几乎覆盖全国，
   * bbox 预筛挡不住远端河流；按 y 分桶后点内判定 / 线段求交只扫局部边。
   */
  var SLAB_WIDTH = 1;

  function newEdgeIndex() {
    return { slab: SLAB_WIDTH, slabs: {}, bbox: null };
  }

  function addRingToIndex(index, ring) {
    if (!ring || ring.length < 2) return;
    for (var i = 0; i < ring.length - 1; i++) {
      var ax = Number(ring[i][0]);
      var ay = Number(ring[i][1]);
      var bx = Number(ring[i + 1][0]);
      var by = Number(ring[i + 1][1]);
      if (!isFinite(ax) || !isFinite(ay) || !isFinite(bx) || !isFinite(by)) continue;
      var lo = Math.floor(Math.min(ay, by) / index.slab);
      var hi = Math.floor(Math.max(ay, by) / index.slab);
      for (var s = lo; s <= hi; s++) {
        (index.slabs[s] || (index.slabs[s] = [])).push([ax, ay, bx, by]);
      }
      if (!index.bbox) index.bbox = [ax, ay, ax, ay];
      if (Math.min(ax, bx) < index.bbox[0]) index.bbox[0] = Math.min(ax, bx);
      if (Math.min(ay, by) < index.bbox[1]) index.bbox[1] = Math.min(ay, by);
      if (Math.max(ax, bx) > index.bbox[2]) index.bbox[2] = Math.max(ax, bx);
      if (Math.max(ay, by) > index.bbox[3]) index.bbox[3] = Math.max(ay, by);
    }
  }

  function buildRegionIndex(feat) {
    var geom = feat.geometry;
    var polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
    var parts = [];
    var outerAll = newEdgeIndex();
    for (var p = 0; p < polys.length; p++) {
      var rings = polys[p];
      if (!rings || !rings[0]) continue;
      var outer = newEdgeIndex();
      addRingToIndex(outer, rings[0]);
      addRingToIndex(outerAll, rings[0]);
      var part = { bbox: outer.bbox ? outer.bbox.slice() : null, outer: outer, holes: [] };
      for (var h = 1; h < rings.length; h++) {
        var holeIdx = newEdgeIndex();
        addRingToIndex(holeIdx, rings[h]);
        part.holes.push({ bbox: holeIdx.bbox ? holeIdx.bbox.slice() : null, idx: holeIdx });
      }
      parts.push(part);
    }
    return { parts: parts, outerAll: outerAll };
  }

  /** 与 pointInRing 同式的 even-odd ray cast，只扫点所在 y 桶的边 */
  function rayCrosses(lng, lat, index) {
    var edges = index.slabs[Math.floor(lat / index.slab)];
    if (!edges) return false;
    var inside = false;
    for (var i = 0; i < edges.length; i++) {
      var e = edges[i];
      var yi = e[1];
      var yj = e[3];
      if (yi > lat === yj > lat) continue;
      var xi = e[0];
      var xj = e[2];
      var xInt = ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
      if (lng < xInt) inside = !inside;
    }
    return inside;
  }

  /** pointInFeature 的索引版：语义一致（多边形件 OR，洞内为外） */
  function pointInRegionIndexed(lng, lat, idx) {
    for (var p = 0; p < idx.parts.length; p++) {
      var part = idx.parts[p];
      if (!bboxContainsPoint(part.bbox, lng, lat)) continue;
      if (!rayCrosses(lng, lat, part.outer)) continue;
      var inHole = false;
      for (var h = 0; h < part.holes.length; h++) {
        var hole = part.holes[h];
        if (bboxContainsPoint(hole.bbox, lng, lat) && rayCrosses(lng, lat, hole.idx)) {
          inHole = true;
          break;
        }
      }
      if (!inHole) return true;
    }
    return false;
  }

  function featureFromUnknown(input) {
    if (!input || typeof input !== 'object') return null;
    if (input.type === 'Feature' && input.geometry) {
      var g = input.geometry.type;
      if (g === 'Polygon' || g === 'MultiPolygon') return input;
      return null;
    }
    if (input.type === 'Polygon' || input.type === 'MultiPolygon') {
      return { type: 'Feature', properties: {}, geometry: input };
    }
    if (input.type === 'FeatureCollection' && Array.isArray(input.features)) {
      for (var i = 0; i < input.features.length; i++) {
        var f = featureFromUnknown(input.features[i]);
        if (f) return f;
      }
    }
    if (input.feature) return featureFromUnknown(input.feature);
    return null;
  }

  /**
   * MapLibre drapes fill layers onto 3D terrain. A large polygon with holes
   * triangulates into giant slivers; a centroid grid makes a mosaic edge.
   * Far cells stay 8° solids. Near the silhouette, 1° cells that miss the
   * region stay solid; cells that hit it are scanline-filled (cell minus
   * clipped rings) into hole-free trapezoids that follow the real outline.
   * Hairline Y-slabs (islands, dense coasts) become kilometer-long needles on
   * 3D terrain; coarsen slabs and split wide traps so each piece stays compact.
   * Do not stitch those trapezoids into one large concave ring: MapLibre's
   * terrain earcut turns that into interior slivers again.
   *
   * Tessellation follows the region bbox: a 2° city (Beijing) uses ~0.008°
   * slabs so the cut is not a 4 km staircase; China stays at the coarse cap.
   * Adjacent traps overlap by a few hundred metres so terrain draping cannot
   * open hairline cracks (烂面) between independently triangulated quads.
   */
  var MASK_TILE_DEG = 8;
  var MASK_NEAR_DEG = 1;
  var MASK_FINE_DEG = 0.08;
  var MASK_SLAB_MIN_DEG = 0.04;
  var MASK_TRAP_MAX_WIDTH = 0.12;
  var MASK_SLAB_FLOOR_DEG = 0.004;
  var MASK_TRAP_FLOOR_DEG = 0.016;
  var MASK_OVERLAP_MAX_DEG = 0.0018;

  function tessellationForBox(box) {
    var spanX = box ? Number(box[2]) - Number(box[0]) : MASK_TILE_DEG;
    var spanY = box ? Number(box[3]) - Number(box[1]) : MASK_TILE_DEG;
    var span = Math.max(spanX, spanY, 0.4);
    var slab = span / 280;
    if (slab < MASK_SLAB_FLOOR_DEG) slab = MASK_SLAB_FLOOR_DEG;
    if (slab > MASK_SLAB_MIN_DEG) slab = MASK_SLAB_MIN_DEG;
    var trapW = span / 55;
    if (trapW < MASK_TRAP_FLOOR_DEG) trapW = MASK_TRAP_FLOOR_DEG;
    if (trapW > MASK_TRAP_MAX_WIDTH) trapW = MASK_TRAP_MAX_WIDTH;
    if (trapW / slab > 8) trapW = slab * 8;
    var fine = slab * 2;
    if (fine < 0.01) fine = 0.01;
    if (fine > MASK_FINE_DEG) fine = MASK_FINE_DEG;
    var overlap = slab * 0.15;
    if (overlap < 0.0005) overlap = 0.0005;
    if (overlap > MASK_OVERLAP_MAX_DEG) overlap = MASK_OVERLAP_MAX_DEG;
    return { slabMin: slab, trapMax: trapW, fineDeg: fine, overlap: overlap };
  }

  function rectRing(minX, minY, maxX, maxY) {
    return [
      [minX, minY],
      [maxX, minY],
      [maxX, maxY],
      [minX, maxY],
      [minX, minY],
    ];
  }

  function polygonFeature(rings) {
    return {
      type: 'Feature',
      properties: {},
      geometry: { type: 'Polygon', coordinates: rings },
    };
  }

  function pushRect(features, minX, minY, maxX, maxY) {
    var outer = ensureWinding(rectRing(minX, minY, maxX, maxY), false);
    if (outer) features.push(polygonFeature([outer]));
  }

  function lerpPoint(a, b, t) {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  }

  function clipRingToAabb(ring, minX, minY, maxX, maxY) {
    var pts = closeRing(ring);
    if (!pts) return null;
    function clipSide(poly, axisIsX, minSide, limit) {
      if (!poly || poly.length < 2) return [];
      var out = [];
      for (var i = 0; i < poly.length - 1; i++) {
        var s = poly[i];
        var e = poly[i + 1];
        var sc = axisIsX ? s[0] : s[1];
        var ec = axisIsX ? e[0] : e[1];
        var sin = minSide ? sc >= limit : sc <= limit;
        var ein = minSide ? ec >= limit : ec <= limit;
        if (sin && ein) {
          out.push(e);
        } else if (sin && !ein) {
          var den = ec - sc;
          if (den !== 0) out.push(lerpPoint(s, e, (limit - sc) / den));
        } else if (!sin && ein) {
          var den2 = ec - sc;
          if (den2 !== 0) out.push(lerpPoint(s, e, (limit - sc) / den2));
          out.push(e);
        }
      }
      if (!out.length) return [];
      var a = out[0];
      var b = out[out.length - 1];
      if (a[0] !== b[0] || a[1] !== b[1]) out.push([a[0], a[1]]);
      return out;
    }
    var p = pts;
    p = clipSide(p, true, true, minX);
    p = clipSide(p, true, false, maxX);
    p = clipSide(p, false, true, minY);
    p = clipSide(p, false, false, maxY);
    return closeRing(p);
  }

  function interpX(a, b, y) {
    var dy = b[1] - a[1];
    if (Math.abs(dy) < 1e-18) return (a[0] + b[0]) / 2;
    var t = (y - a[1]) / dy;
    if (t < 0) t = 0;
    if (t > 1) t = 1;
    return a[0] + t * (b[0] - a[0]);
  }

  function ringIntervalsAtY(ring, y) {
    var pts = closeRing(ring);
    if (!pts) return [];
    var hits = [];
    var i;
    for (i = 0; i < pts.length - 1; i++) {
      var a = pts[i];
      var b = pts[i + 1];
      if (a[1] > y === b[1] > y) continue;
      if (a[1] === b[1]) continue;
      hits.push({ x: interpX(a, b, y), a: a, b: b });
    }
    hits.sort(function (p, q) {
      return p.x - q.x;
    });
    var out = [];
    for (i = 0; i + 1 < hits.length; i += 2) {
      var lo = hits[i].x;
      var hi = hits[i + 1].x;
      if (hi - lo > 1e-12) out.push({ lo: lo, hi: hi, left: hits[i], right: hits[i + 1] });
    }
    return out;
  }

  function mergeHoleIntervals(list) {
    if (!list.length) return [];
    list.sort(function (a, b) {
      return a.lo - b.lo;
    });
    var merged = [list[0]];
    var i;
    for (i = 1; i < list.length; i++) {
      var cur = list[i];
      var last = merged[merged.length - 1];
      if (cur.lo <= last.hi + 1e-12) {
        if (cur.hi > last.hi) {
          last.hi = cur.hi;
          last.right = cur.right;
        }
      } else {
        merged.push({ lo: cur.lo, hi: cur.hi, left: cur.left, right: cur.right });
      }
    }
    return merged;
  }

  function holeIntervalsAtY(holes, y, minX, maxX) {
    var acc = [];
    var i;
    var j;
    for (i = 0; i < holes.length; i++) {
      var part = ringIntervalsAtY(holes[i], y);
      for (j = 0; j < part.length; j++) acc.push(part[j]);
    }
    var merged = mergeHoleIntervals(acc);
    var clipped = [];
    for (i = 0; i < merged.length; i++) {
      var lo = Math.max(merged[i].lo, minX);
      var hi = Math.min(merged[i].hi, maxX);
      if (hi - lo > 1e-12) {
        clipped.push({
          lo: lo,
          hi: hi,
          left: merged[i].left,
          right: merged[i].right,
        });
      }
    }
    return clipped;
  }

  function uniqueScanYs(holes, minY, maxY) {
    var ys = [minY, maxY];
    var i;
    var j;
    for (i = 0; i < holes.length; i++) {
      var ring = holes[i];
      for (j = 0; j < ring.length; j++) {
        var y = ring[j][1];
        if (y >= minY - 1e-12 && y <= maxY + 1e-12) {
          ys.push(Math.min(maxY, Math.max(minY, y)));
        }
      }
    }
    ys.sort(function (a, b) {
      return a - b;
    });
    var out = [];
    for (i = 0; i < ys.length; i++) {
      if (!out.length || Math.abs(ys[i] - out[out.length - 1]) > 1e-10) out.push(ys[i]);
    }
    return out;
  }

  function clampX(x, minX, maxX) {
    if (x < minX) return minX;
    if (x > maxX) return maxX;
    return x;
  }

  function xAtY(hit, y, wallX) {
    if (!hit) return wallX;
    return interpX(hit.a, hit.b, y);
  }

  function gapQuad(y0, y1, leftHit, rightHit, wallL, wallR, minX, maxX) {
    if (wallR - wallL <= 1e-12) return null;
    var x00 = leftHit ? clampX(xAtY(leftHit, y0, wallL), minX, maxX) : minX;
    var x01 = leftHit ? clampX(xAtY(leftHit, y1, wallL), minX, maxX) : minX;
    var x10 = rightHit ? clampX(xAtY(rightHit, y0, wallR), minX, maxX) : maxX;
    var x11 = rightHit ? clampX(xAtY(rightHit, y1, wallR), minX, maxX) : maxX;
    if (!leftHit) {
      x00 = minX;
      x01 = minX;
    }
    if (!rightHit) {
      x10 = maxX;
      x11 = maxX;
    }
    if (x10 < x00) {
      var t0 = x00;
      x00 = x10;
      x10 = t0;
    }
    if (x11 < x01) {
      var t1 = x01;
      x01 = x11;
      x11 = t1;
    }
    if ((x10 - x00) + (x11 - x01) < 1e-12) return null;
    return { y0: y0, y1: y1, x00: x00, x10: x10, x01: x01, x11: x11 };
  }

  function coarsenScanYs(ys, minStep) {
    if (!ys || ys.length <= 2) return ys;
    var out = [ys[0]];
    var last = ys.length - 1;
    var i;
    for (i = 1; i < last; i++) {
      if (ys[i] - out[out.length - 1] >= minStep) out.push(ys[i]);
    }
    var maxY = ys[last];
    if (maxY - out[out.length - 1] < minStep * 0.35 && out.length > 1) {
      out[out.length - 1] = maxY;
    } else if (Math.abs(out[out.length - 1] - maxY) > 1e-12) {
      out.push(maxY);
    }
    return out;
  }

  function pushTrapezoid(features, x00, x10, y0, x01, x11, y1, pad) {
    pad = pad || 0;
    if (pad > 0) {
      y0 -= pad;
      y1 += pad;
      if (x00 <= x10) {
        x00 -= pad;
        x10 += pad;
      } else {
        x00 += pad;
        x10 -= pad;
      }
      if (x01 <= x11) {
        x01 -= pad;
        x11 += pad;
      } else {
        x01 += pad;
        x11 -= pad;
      }
    }
    var h = y1 - y0;
    if (h < 1e-10) return false;
    var ring = [
      [x00, y0],
      [x10, y0],
      [x11, y1],
      [x01, y1],
      [x00, y0],
    ];
    var wound = ensureWinding(ring, false);
    if (!wound || Math.abs(signedArea(wound)) <= 1e-12) return false;
    features.push(polygonFeature([wound]));
    return true;
  }

  function pushTrapezoidSplit(features, g, tess) {
    if (!g) return 0;
    var trapMax = (tess && tess.trapMax) || MASK_TRAP_MAX_WIDTH;
    var pad = (tess && tess.overlap) || 0;
    var w = Math.max(g.x10 - g.x00, g.x11 - g.x01);
    var h = g.y1 - g.y0;
    if (w < 1e-12 || h < 1e-10) return 0;
    var nx = Math.max(1, Math.ceil(w / trapMax));
    var ny = Math.max(1, Math.ceil(h / trapMax));
    var added = 0;
    var i;
    var j;
    for (j = 0; j < ny; j++) {
      var v0 = j / ny;
      var v1 = (j + 1) / ny;
      var y0 = g.y0 + (g.y1 - g.y0) * v0;
      var y1 = g.y0 + (g.y1 - g.y0) * v1;
      var left0 = g.x00 + (g.x01 - g.x00) * v0;
      var left1 = g.x00 + (g.x01 - g.x00) * v1;
      var right0 = g.x10 + (g.x11 - g.x10) * v0;
      var right1 = g.x10 + (g.x11 - g.x10) * v1;
      for (i = 0; i < nx; i++) {
        var t0 = i / nx;
        var t1 = (i + 1) / nx;
        var a0 = left0 + (right0 - left0) * t0;
        var b0 = left0 + (right0 - left0) * t1;
        var a1 = left1 + (right1 - left1) * t0;
        var b1 = left1 + (right1 - left1) * t1;
        if (pushTrapezoid(features, a0, b0, y0, a1, b1, y1, pad)) added += 1;
      }
    }
    return added;
  }

  function scanlineOutside(features, minX, minY, maxX, maxY, holes, tess) {
    var slabMin = (tess && tess.slabMin) || MASK_SLAB_MIN_DEG;
    var ys = coarsenScanYs(uniqueScanYs(holes, minY, maxY), slabMin);
    var added = 0;
    var s;
    var h;
    for (s = 0; s < ys.length - 1; s++) {
      var y0 = ys[s];
      var y1 = ys[s + 1];
      if (y1 - y0 < 1e-12) continue;
      var yMid = (y0 + y1) / 2;
      var holeInts = holeIntervalsAtY(holes, yMid, minX, maxX);
      var prevHi = minX;
      var prevRight = null;
      for (h = 0; h < holeInts.length; h++) {
        var iv = holeInts[h];
        added += pushTrapezoidSplit(
          features,
          gapQuad(y0, y1, prevRight, iv.left, prevHi, iv.lo, minX, maxX),
          tess
        );
        prevHi = iv.hi;
        prevRight = iv.right;
      }
      added += pushTrapezoidSplit(
        features,
        gapQuad(y0, y1, prevRight, null, prevHi, maxX, minX, maxX),
        tess
      );
    }
    return added;
  }

  function pushFineOutside(features, minX, minY, maxX, maxY, feat, tess) {
    var step = (tess && tess.fineDeg) || MASK_FINE_DEG;
    for (var lat = minY; lat < maxY - 1e-9; lat += step) {
      var lat1 = Math.min(lat + step, maxY);
      for (var lng = minX; lng < maxX - 1e-9; lng += step) {
        var lng1 = Math.min(lng + step, maxX);
        var cx = (lng + lng1) / 2;
        var cy = (lat + lat1) / 2;
        if (pointInFeature(cx, cy, feat)) continue;
        pushRect(features, lng, lat, lng1, lat1);
      }
    }
  }

  function pushEdgeCell(features, minX, minY, maxX, maxY, feat, srcRings, tess) {
    var outer = ensureWinding(rectRing(minX, minY, maxX, maxY), false);
    if (!outer) return;
    var holes = [];
    var i;
    for (i = 0; i < srcRings.length; i++) {
      var clipped = clipRingToAabb(srcRings[i], minX, minY, maxX, maxY);
      if (clipped && Math.abs(signedArea(clipped)) > 1e-12) holes.push(clipped);
    }
    var cx = (minX + maxX) / 2;
    var cy = (minY + maxY) / 2;
    var centerIn = pointInFeature(cx, cy, feat);
    var outerArea = Math.abs(signedArea(outer));
    var holeArea = 0;
    for (i = 0; i < holes.length; i++) holeArea += Math.abs(signedArea(holes[i]));
    if (holeArea >= outerArea * 0.995) return;
    if (!holes.length) {
      if (centerIn) {
        pushFineOutside(features, minX, minY, maxX, maxY, feat, tess);
        return;
      }
      pushRect(features, minX, minY, maxX, maxY);
      return;
    }
    var added = scanlineOutside(features, minX, minY, maxX, maxY, holes, tess);
    if (!added) pushFineOutside(features, minX, minY, maxX, maxY, feat, tess);
  }

  function fillNearCell(features, minX, minY, maxX, maxY, feat, regionBox, srcRings, tess) {
    var step = MASK_NEAR_DEG;
    for (var lat = minY; lat < maxY - 1e-9; lat += step) {
      var lat1 = Math.min(lat + step, maxY);
      for (var lng = minX; lng < maxX - 1e-9; lng += step) {
        var lng1 = Math.min(lng + step, maxX);
        var little = [lng, lat, lng1, lat1];
        if (regionBox && bboxIntersects(little, regionBox)) {
          pushEdgeCell(features, lng, lat, lng1, lat1, feat, srcRings, tess);
        } else {
          pushRect(features, lng, lat, lng1, lat1);
        }
      }
    }
  }

  function buildMaskGeoJSON(featureOrGeom) {
    var feat = narrativeFeature(featureOrGeom) || featureFromUnknown(featureOrGeom);
    if (!feat) return null;
    var rings = extractOuterRings(feat.geometry);
    if (!rings.length) return null;
    var tile = MASK_TILE_DEG;
    var regionBox = geometryBbox(feat.geometry);
    var tess = tessellationForBox(regionBox);
    var padBox = regionBox
      ? [
          regionBox[0] - tile,
          regionBox[1] - tile,
          regionBox[2] + tile,
          regionBox[3] + tile,
        ]
      : null;
    var features = [];
    for (var lat = -85; lat < 85 - 1e-9; lat += tile) {
      var lat1 = Math.min(lat + tile, 85);
      for (var lng = -180; lng < 180 - 1e-9; lng += tile) {
        var lng1 = Math.min(lng + tile, 180);
        var cellBox = [lng, lat, lng1, lat1];
        if (padBox && bboxIntersects(cellBox, padBox)) {
          fillNearCell(features, lng, lat, lng1, lat1, feat, regionBox, rings, tess);
        } else {
          pushRect(features, lng, lat, lng1, lat1);
        }
      }
    }
    if (!features.length) return null;
    return { type: 'FeatureCollection', features: features };
  }

  /**
   * One world ring minus region holes. Cheap enough for globe subdivision
   * (tiled traps × globe tessellation freezes the main thread).
   */
  function buildSimpleMaskGeoJSON(featureOrGeom) {
    var feat = narrativeFeature(featureOrGeom) || featureFromUnknown(featureOrGeom);
    if (!feat) return null;
    var rings = extractOuterRings(feat.geometry);
    if (!rings.length) return null;
    var outer = ensureWinding(WORLD_RING, false);
    if (!outer) return null;
    var holes = [];
    var i;
    for (i = 0; i < rings.length; i++) {
      var hole = ensureWinding(rings[i], true);
      if (hole && Math.abs(signedArea(hole)) > 1e-12) holes.push(hole);
    }
    if (!holes.length) return null;
    return {
      type: 'FeatureCollection',
      features: [polygonFeature([outer].concat(holes))],
    };
  }

  function listRegions(data) {
    if (!data || typeof data !== 'object') return [];
    if (Array.isArray(data.regions)) return data.regions;
    return [];
  }

  function findRegion(data, id) {
    var regions = listRegions(data);
    if (!regions.length) return null;
    if (id) {
      for (var i = 0; i < regions.length; i++) {
        if (regions[i] && regions[i].id === id) return regions[i];
      }
    }
    var fallbackId = data.defaultId;
    if (fallbackId) {
      for (var j = 0; j < regions.length; j++) {
        if (regions[j] && regions[j].id === fallbackId) return regions[j];
      }
    }
    return regions[0];
  }

  function pointInRing(lng, lat, ring) {
    if (!ring || ring.length < 3) return false;
    var inside = false;
    for (var i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      var xi = Number(ring[i][0]);
      var yi = Number(ring[i][1]);
      var xj = Number(ring[j][0]);
      var yj = Number(ring[j][1]);
      var denom = yj - yi;
      if (denom === 0) continue;
      var intersect = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / denom + xi;
      if (intersect) inside = !inside;
    }
    return inside;
  }

  function pointInPolygonCoords(lng, lat, coords) {
    if (!coords || !coords[0]) return false;
    if (!pointInRing(lng, lat, coords[0])) return false;
    for (var h = 1; h < coords.length; h++) {
      if (pointInRing(lng, lat, coords[h])) return false;
    }
    return true;
  }

  function pointInFeature(lng, lat, featureOrGeom) {
    var feat = featureFromUnknown(featureOrGeom);
    if (!feat || !feat.geometry) return false;
    var geom = feat.geometry;
    if (geom.type === 'Polygon') return pointInPolygonCoords(lng, lat, geom.coordinates);
    if (geom.type === 'MultiPolygon') {
      for (var i = 0; i < geom.coordinates.length; i++) {
        if (pointInPolygonCoords(lng, lat, geom.coordinates[i])) return true;
      }
    }
    return false;
  }

  function forEachPosition(geom, visit) {
    if (!geom || !geom.coordinates) return;
    function walk(node, depth) {
      if (!node) return;
      if (depth === 0) {
        visit(Number(node[0]), Number(node[1]));
        return;
      }
      for (var i = 0; i < node.length; i++) walk(node[i], depth - 1);
    }
    if (geom.type === 'Point') walk(geom.coordinates, 0);
    else if (geom.type === 'MultiPoint' || geom.type === 'LineString') walk(geom.coordinates, 1);
    else if (geom.type === 'MultiLineString' || geom.type === 'Polygon') walk(geom.coordinates, 2);
    else if (geom.type === 'MultiPolygon') walk(geom.coordinates, 3);
  }

  function geometryHitsFeature(geom, regionFeature, idx) {
    if (!geom) return false;
    var feat = featureFromUnknown(regionFeature);
    var index = idx || (feat ? buildRegionIndex(feat) : null);
    if (!index) return false;
    var hit = false;
    forEachPosition(geom, function (lng, lat) {
      if (!hit && pointInRegionIndexed(lng, lat, index)) hit = true;
    });
    return hit;
  }

  function collectOuterRings(regionFeature) {
    var feat = featureFromUnknown(regionFeature);
    if (!feat) return [];
    return extractOuterRings(feat.geometry);
  }

  function segmentIntersect(a, b, c, d) {
    var ax = a[0];
    var ay = a[1];
    var bx = b[0];
    var by = b[1];
    var cx = c[0];
    var cy = c[1];
    var dx = d[0];
    var dy = d[1];
    var den = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx);
    if (Math.abs(den) < 1e-12) return null;
    var t = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / den;
    var u = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / den;
    if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return null;
    return { t: t, p: [ax + t * (bx - ax), ay + t * (by - ay)] };
  }

  function segmentBoundaryHits(a, b, rings) {
    var hits = [];
    for (var r = 0; r < rings.length; r++) {
      var ring = rings[r];
      if (!ring || ring.length < 2) continue;
      for (var i = 0; i < ring.length - 1; i++) {
        var hit = segmentIntersect(a, b, ring[i], ring[i + 1]);
        if (hit) hits.push(hit);
      }
    }
    hits.sort(function (x, y) {
      return x.t - y.t;
    });
    var uniq = [];
    for (var h = 0; h < hits.length; h++) {
      var prev = uniq[uniq.length - 1];
      if (prev && Math.abs(prev.t - hits[h].t) < 1e-8) continue;
      uniq.push(hits[h]);
    }
    return uniq;
  }

  /** segmentBoundaryHits 的索引版：只扫线段 y 范围覆盖的桶边，结果一致 */
  function segmentBoundaryHitsIndexed(a, b, index) {
    var lo = Math.floor(Math.min(a[1], b[1]) / index.slab);
    var hi = Math.floor(Math.max(a[1], b[1]) / index.slab);
    var hits = [];
    for (var s = lo; s <= hi; s++) {
      var edges = index.slabs[s];
      if (!edges) continue;
      for (var i = 0; i < edges.length; i++) {
        var e = edges[i];
        var hit = segmentIntersect(a, b, [e[0], e[1]], [e[2], e[3]]);
        if (hit) hits.push(hit);
      }
    }
    hits.sort(function (x, y) {
      return x.t - y.t;
    });
    var uniq = [];
    for (var h = 0; h < hits.length; h++) {
      var prev = uniq[uniq.length - 1];
      if (prev && Math.abs(prev.t - hits[h].t) < 1e-8) continue;
      uniq.push(hits[h]);
    }
    return uniq;
  }

  function pushUnique(line, pt) {
    if (!line.length) {
      line.push(pt);
      return;
    }
    var last = line[line.length - 1];
    if (last[0] === pt[0] && last[1] === pt[1]) return;
    line.push(pt);
  }

  function clipLineString(coords, regionFeature) {
    var feat = featureFromUnknown(regionFeature);
    if (!feat) return [];
    return clipLineStringIdx(coords, buildRegionIndex(feat));
  }

  function clipLineStringIdx(coords, idx) {
    if (!coords || coords.length < 2) return [];
    var parts = [];
    var cur = [];
    function flush() {
      if (cur.length >= 2) parts.push(cur);
      cur = [];
    }
    for (var i = 0; i < coords.length - 1; i++) {
      var a = [Number(coords[i][0]), Number(coords[i][1])];
      var b = [Number(coords[i + 1][0]), Number(coords[i + 1][1])];
      var ain = pointInRegionIndexed(a[0], a[1], idx);
      var hits = segmentBoundaryHitsIndexed(a, b, idx.outerAll);
      if (ain) pushUnique(cur, a);
      for (var h = 0; h < hits.length; h++) {
        pushUnique(cur, hits[h].p);
        if (ain) {
          flush();
          ain = false;
        } else {
          ain = true;
        }
      }
      if (ain) pushUnique(cur, b);
      else flush();
    }
    flush();
    return parts;
  }

  function clipGeometry(geom, regionFeature, idx) {
    if (!geom) return null;
    var index = idx;
    if (geom.type === 'LineString') {
      var parts = index
        ? clipLineStringIdx(geom.coordinates, index)
        : clipLineString(geom.coordinates, regionFeature);
      if (!parts.length) return null;
      if (parts.length === 1) return { type: 'LineString', coordinates: parts[0] };
      return { type: 'MultiLineString', coordinates: parts };
    }
    if (geom.type === 'MultiLineString') {
      var all = [];
      for (var i = 0; i < geom.coordinates.length; i++) {
        var clipped = index
          ? clipLineStringIdx(geom.coordinates[i], index)
          : clipLineString(geom.coordinates[i], regionFeature);
        for (var j = 0; j < clipped.length; j++) all.push(clipped[j]);
      }
      if (!all.length) return null;
      if (all.length === 1) return { type: 'LineString', coordinates: all[0] };
      return { type: 'MultiLineString', coordinates: all };
    }
    if (geom.type === 'Point') {
      if (index) {
        return pointInRegionIndexed(geom.coordinates[0], geom.coordinates[1], index) ? geom : null;
      }
      return pointInFeature(geom.coordinates[0], geom.coordinates[1], regionFeature) ? geom : null;
    }
    if (geom.type === 'Polygon' || geom.type === 'MultiPolygon') {
      return geometryHitsFeature(geom, regionFeature, index) ? geom : null;
    }
    return geometryHitsFeature(geom, regionFeature, index) ? geom : null;
  }

  function filterCollection(fc, regionFeature) {
    var empty = { type: 'FeatureCollection', features: [] };
    if (!fc || !Array.isArray(fc.features) || !regionFeature) return empty;
    var feat = featureFromUnknown(regionFeature);
    if (!feat) return empty;
    // Cheap bbox prefilter: full-China hydrography against a province ring is
    // O(segments x ringVerts); skipping non-intersecting features first keeps
    // the tuner UI from freezing on every region switch. The slab index then
    // limits point-in-polygon / segment tests to nearby boundary edges.
    var regionBox = featureBbox(feat);
    var idx = buildRegionIndex(feat);
    var out = [];
    for (var i = 0; i < fc.features.length; i++) {
      var f = fc.features[i];
      if (!f || !f.geometry) continue;
      if (regionBox && !bboxIntersects(geometryBbox(f.geometry), regionBox)) continue;
      var geom = clipGeometry(f.geometry, feat, idx);
      if (!geom) continue;
      out.push({
        type: 'Feature',
        properties: f.properties || {},
        geometry: geom,
      });
    }
    return { type: 'FeatureCollection', features: out };
  }

  root.REGION_ISOLATE = {
    WORLD_RING: WORLD_RING,
    MASK_TILE_DEG: MASK_TILE_DEG,
    MASK_NEAR_DEG: MASK_NEAR_DEG,
    MASK_FINE_DEG: MASK_FINE_DEG,
    MASK_SLAB_MIN_DEG: MASK_SLAB_MIN_DEG,
    MASK_TRAP_MAX_WIDTH: MASK_TRAP_MAX_WIDTH,
    tessellationForBox: tessellationForBox,
    narrativeFeature: narrativeFeature,
    closeRing: closeRing,
    signedArea: signedArea,
    featureFromUnknown: featureFromUnknown,
    geometryBbox: geometryBbox,
    featureBbox: featureBbox,
    bboxIntersects: bboxIntersects,
    buildMaskGeoJSON: buildMaskGeoJSON,
    buildSimpleMaskGeoJSON: buildSimpleMaskGeoJSON,
    listRegions: listRegions,
    findRegion: findRegion,
    pointInRing: pointInRing,
    pointInFeature: pointInFeature,
    geometryHitsFeature: geometryHitsFeature,
    clipLineString: clipLineString,
    filterCollection: filterCollection,
  };
})(typeof window !== 'undefined' ? window : globalThis);
