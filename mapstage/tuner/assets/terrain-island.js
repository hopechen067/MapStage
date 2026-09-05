/**
 * Independent terrain island: clip MapStage terrain to a polygon and
 * extrude a side wall along the silhouette. Requires the patched
 * maplibre-gl build (__ANTIQUE_TERRAIN_CLIP_PATCH).
 */
(function (root) {
  'use strict';

  var CLIP_MAX = 2048;
  var CLIP_MIN = 512;
  var WALL_MAX_POINTS = 1600;
  var RIM_STEP_PX = 2;
  var RIM_MAX_FLAT_PX = 4;
  var RIM_NUDGE_PX = 16;
  // Live overlay top stays on the clip contour (nudgePx 0). A 16px outward
  // loop sits in the void beside the satellite, so uv=0 gold reads as a fence.
  var OVERLAY_TOP_SINK_M = 64;
  // Land residual/gold is uv<0.10. Start overlay shade past that so the gold
  // band cannot enclose the satellite top; palettes stay 10/20/70 hexes.
  var OVERLAY_TOP_SHADE = 0.12;
  var WALL_LAYER_ID = 'region-island-walls';
  var VOID = '#14110e';
  var PAPER = VOID;
  var WALL_COLOR = '#6d4a36';
  var WALL_COLOR_TOP = '#6d4a36';
  var WALL_COLOR_BOT = '#6d4a36';

  function lngLatToMercator(lng, lat) {
    var x = (Number(lng) + 180) / 360;
    var sin = Math.sin((Number(lat) * Math.PI) / 180);
    sin = Math.min(Math.max(sin, -0.9999), 0.9999);
    var y = 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI);
    return [x, y];
  }

  function mercatorBbox(feature) {
    var api = root.REGION_ISOLATE;
    var box = api && feature ? api.featureBbox(feature) : null;
    if (!box) return null;
    var a = lngLatToMercator(box[0], box[3]);
    var b = lngLatToMercator(box[2], box[1]);
    var pad = Math.max((b[0] - a[0]) * 0.04, (b[1] - a[1]) * 0.04, 0.0004);
    return {
      x0: Math.max(0, Math.min(a[0], b[0]) - pad),
      y0: Math.max(0, Math.min(a[1], b[1]) - pad),
      x1: Math.min(1, Math.max(a[0], b[0]) + pad),
      y1: Math.min(1, Math.max(a[1], b[1]) + pad),
    };
  }

  function featureFitsClipTexture(map, feature) {
    var full = mercatorBbox(feature);
    if (!full) return false;
    var z = map && typeof map.getZoom === 'function' ? Number(map.getZoom()) : 0;
    if (!isFinite(z) || z < 0) z = 0;
    var world = 512 * Math.pow(2, z);
    return (full.x1 - full.x0) * world <= CLIP_MAX && (full.y1 - full.y0) * world <= CLIP_MAX;
  }

  function tileIntersectsMerc(tile, merc) {
    if (!tile || !tile.tileID || !merc) return true;
    var id = tile.tileID.canonical;
    var scale = 1 << id.z;
    var x0 = id.x / scale;
    var y0 = id.y / scale;
    var s = 1 / scale;
    return !(x0 + s < merc.x0 || x0 > merc.x1 || y0 + s < merc.y0 || y0 > merc.y1);
  }

  function tileHitsClip(tile) {
    var clip = root.__antiqueTerrainClip;
    if (!clip || !clip.enabled) return true;
    if (clip.merc && !tileIntersectsMerc(tile, clip.merc)) return false;
    if (!clip._image) return true;
    var id = tile && tile.tileID && tile.tileID.canonical;
    if (!id) return true;
    var scale = 1 << id.z;
    var x0 = id.x / scale;
    var y0 = id.y / scale;
    var s = 1 / scale;
    var n = 6;
    var i;
    var j;
    for (j = 0; j <= n; j++) {
      for (i = 0; i <= n; i++) {
        if (sampleClipAtMerc(x0 + (i / n) * s, y0 + (j / n) * s) >= 0.45) return true;
      }
    }
    return false;
  }

  function filterTiles(tiles) {
    var clip = root.__antiqueTerrainClip;
    if (!clip || !clip.enabled) return tiles;
    var out = [];
    for (var i = 0; i < tiles.length; i++) {
      if (tileHitsClip(tiles[i])) out.push(tiles[i]);
    }
    return out;
  }

  function eachRing(feature, fn) {
    var geom = feature && feature.geometry;
    if (!geom || !geom.coordinates) return;
    var polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
    for (var p = 0; p < polys.length; p++) {
      var rings = polys[p] || [];
      for (var r = 0; r < rings.length; r++) fn(rings[r], r === 0, p);
    }
  }

  function mapTerrain(map) {
    if (!map) return null;
    if (map.terrain && map.terrain.meshSize) return map.terrain;
    if (map.painter && map.painter.terrain && map.painter.terrain.meshSize) return map.painter.terrain;
    if (
      map.painter &&
      map.painter.renderToTexture &&
      map.painter.renderToTexture.terrain
    ) {
      return map.painter.renderToTexture.terrain;
    }
    return null;
  }

  function unionMerc(a, b) {
    if (!a) return b;
    if (!b) return a;
    return {
      x0: Math.min(a.x0, b.x0),
      y0: Math.min(a.y0, b.y0),
      x1: Math.max(a.x1, b.x1),
      y1: Math.max(a.y1, b.y1),
    };
  }

  function viewMercatorFromUnproject(map, mid, minLim) {
    if (!map || typeof map.unproject !== 'function' || typeof map.getCanvas !== 'function') return null;
    var canvas = map.getCanvas();
    if (!canvas) return null;
    var cssW = canvas.clientWidth || canvas.width || 0;
    var cssH = canvas.clientHeight || canvas.height || 0;
    if (!(cssW > 8 && cssH > 8)) return null;
    var mercs = [];
    var dists = [];
    var nx = 5;
    var ny = 5;
    var ix;
    var iy;
    for (iy = 0; iy <= ny; iy++) {
      for (ix = 0; ix <= nx; ix++) {
        var ll = map.unproject([cssW * (ix / nx), cssH * (iy / ny)]);
        if (!ll || !isFinite(ll.lng) || !isFinite(ll.lat) || Math.abs(ll.lat) > 85) continue;
        var m = lngLatToMercator(ll.lng, ll.lat);
        mercs.push(m);
        if (mid) dists.push(Math.max(Math.abs(m[0] - mid[0]), Math.abs(m[1] - mid[1])));
      }
    }
    if (mercs.length < 4) return null;
    var lim = minLim > 0 ? minLim : 0.05;
    if (dists.length) {
      dists.sort(function (a, b) { return a - b; });
      var p = dists[Math.min(dists.length - 1, Math.floor(dists.length * 0.62))];
      lim = Math.max(p * 1.8, minLim > 0 ? minLim : 0.00008);
    }
    var x0 = 1;
    var y0 = 1;
    var x1 = 0;
    var y1 = 0;
    var i;
    for (i = 0; i < mercs.length; i++) {
      var mx = mercs[i][0];
      var my = mercs[i][1];
      if (mid) {
        mx = mid[0] + Math.max(-lim, Math.min(lim, mx - mid[0]));
        my = mid[1] + Math.max(-lim, Math.min(lim, my - mid[1]));
      }
      if (mx < x0) x0 = mx;
      if (my < y0) y0 = my;
      if (mx > x1) x1 = mx;
      if (my > y1) y1 = my;
    }
    if (!(x1 > x0 && y1 > y0)) return null;
    var pad = Math.max((x1 - x0) * 0.1, (y1 - y0) * 0.1, 0.00003);
    return { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad };
  }

  function clipMercatorBbox(map, feature) {
    var full = mercatorBbox(feature);
    if (!full) return null;
    if (!map) return full;
    var pitch = typeof map.getPitch === 'function' ? map.getPitch() : 0;
    var view = null;
    var mid = null;
    var nadirHalf = 0;
    if (typeof map.getCenter === 'function' && typeof map.getZoom === 'function') {
      var z = map.getZoom();
      var c = map.getCenter();
      mid = lngLatToMercator(c.lng, c.lat);
      var canvas = typeof map.getCanvas === 'function' ? map.getCanvas() : null;
      var cssW = (canvas && (canvas.clientWidth || canvas.width)) || 1280;
      var cssH = (canvas && (canvas.clientHeight || canvas.height)) || 800;
      var tiles = Math.max(cssW, cssH) / 512;
      nadirHalf = (tiles * 0.8) / Math.pow(2, Math.max(z, 0));
      nadirHalf *= 1.08;
      view = {
        x0: mid[0] - nadirHalf,
        y0: mid[1] - nadirHalf,
        x1: mid[0] + nadirHalf,
        y1: mid[1] + nadirHalf,
      };
    }
    view = unionMerc(view, viewMercatorFromUnproject(map, mid, nadirHalf));
    if (pitch <= 28 && typeof map.getBounds === 'function') {
      var b = map.getBounds();
      var sw = lngLatToMercator(b.getWest(), b.getSouth());
      var ne = lngLatToMercator(b.getEast(), b.getNorth());
      var bx0 = Math.min(sw[0], ne[0]);
      var by0 = Math.min(sw[1], ne[1]);
      var bx1 = Math.max(sw[0], ne[0]);
      var by1 = Math.max(sw[1], ne[1]);
      var px = Math.max((bx1 - bx0) * 0.08, 0.0002);
      var py = Math.max((by1 - by0) * 0.08, 0.0002);
      var boundsView = { x0: bx0 - px, y0: by0 - py, x1: bx1 + px, y1: by1 + py };
      if (!view) view = boundsView;
      else {
        view = {
          x0: Math.max(view.x0, boundsView.x0),
          y0: Math.max(view.y0, boundsView.y0),
          x1: Math.min(view.x1, boundsView.x1),
          y1: Math.min(view.y1, boundsView.y1),
        };
      }
    }
    if (!view) return full;
    var x0 = Math.max(full.x0, view.x0);
    var y0 = Math.max(full.y0, view.y0);
    var x1 = Math.min(full.x1, view.x1);
    var y1 = Math.min(full.y1, view.y1);
    if (x1 - x0 < 1e-8 || y1 - y0 < 1e-8) return full;
    var zSnap = typeof map.getZoom === 'function' ? map.getZoom() : 4;
    var q = Math.pow(0.5, Math.floor(zSnap) + 5);
    function snap(v) {
      return Math.round(v / q) * q;
    }
    return { x0: snap(x0), y0: snap(y0), x1: snap(x1), y1: snap(y1) };
  }

  var CHINA_SEAS = [
    { lng0: 117.0, lng1: 132.0, lat0: 21.2, lat1: 41.3 },
    { lng0: 105.5, lng1: 122.0, lat0: 3.0, lat1: 23.8 },
  ];
  var STRATA_LINE = [109 / 255, 74 / 255, 54 / 255];
  var STRATA_BROWN = [109 / 255, 74 / 255, 54 / 255];
  var STRATA_WATER = [
    { t: 1, rgb: STRATA_BROWN.slice() },
  ];
  var STRATA_LAND = [
    { t: 1, rgb: STRATA_BROWN.slice() },
  ];

  function inChinaSeas(lng, lat) {
    var i;
    for (i = 0; i < CHINA_SEAS.length; i++) {
      var b = CHINA_SEAS[i];
      if (lng >= b.lng0 && lng <= b.lng1 && lat >= b.lat0 && lat <= b.lat1) return true;
    }
    return false;
  }

  function chinaLandFeature() {
    var data = root.REGION_ISOLATE_DATA;
    var api = root.REGION_ISOLATE;
    if (!data || !api || typeof api.findRegion !== 'function') return null;
    var r = api.findRegion(data, 'china');
    var feat = r && r.feature;
    if (feat && typeof api.narrativeFeature === 'function') feat = api.narrativeFeature(feat) || feat;
    return feat || null;
  }

  function isRimWaterLngLat(lng, lat, chinaFeat) {
    var api = root.REGION_ISOLATE;
    var land = chinaFeat || chinaLandFeature();
    if (land && api && typeof api.pointInFeature === 'function' && api.pointInFeature(lng, lat, land)) {
      return false;
    }
    return inChinaSeas(lng, lat);
  }

  function strataUv(drop, dropMax) {
    var d = Number(drop);
    var m = Number(dropMax);
    if (!(m > 0) || !isFinite(d)) return 0;
    var uv = d / m;
    if (uv < 0) return 0;
    if (uv > 1) return 1;
    return uv;
  }

  function strataRgb(uv, water, opts) {
    void uv;
    void water;
    void opts;
    return STRATA_BROWN.slice();
  }

  function isBlueGrayRgb(r, g, b) {
    return b > r && b > g;
  }

  function classifyWallRgb(r, g, b, water) {
    if (isBlueGrayRgb(r, g, b)) return 'blue-gray';
    var named = water
      ? [
          ['mud', 61, 83, 72],
          ['clay', 166, 124, 82],
          ['rock', 58, 46, 36],
        ]
      : [
          ['residual', 196, 160, 106],
          ['weathered', 139, 115, 85],
          ['rock', 58, 46, 36],
        ];
    var best = 'other';
    var bestD = 36;
    var i;
    for (i = 0; i < named.length; i++) {
      var d = Math.hypot(r - named[i][1], g - named[i][2], b - named[i][3]);
      if (d < bestD) {
        bestD = d;
        best = named[i][0];
      }
    }
    return best;
  }

  function affineWallUv(t) {
    t = Number(t);
    if (t < 0) return 0;
    if (t > 1) return 1;
    return t;
  }

  function rasterWallColumn(n, water, opts) {
    opts = opts || {};
    n = n || 1000;
    var counts = {
      mud: 0,
      clay: 0,
      rock: 0,
      residual: 0,
      weathered: 0,
      'blue-gray': 0,
      other: 0,
    };
    var order = [];
    var last = '';
    var i;
    for (i = 0; i < n; i++) {
      var uv = affineWallUv((i + 0.5) / n);
      var rgb = strataRgb(uv, water, opts);
      var R = Math.round(rgb[0] * 255);
      var G = Math.round(rgb[1] * 255);
      var B = Math.round(rgb[2] * 255);
      var band = classifyWallRgb(R, G, B, water);
      counts[band] = (counts[band] || 0) + 1;
      if (band !== last) {
        order.push(band);
        last = band;
      }
    }
    var pct = {};
    Object.keys(counts).forEach(function (k) {
      pct[k] = (100 * counts[k]) / n;
    });
    return { n: n, counts: counts, pct: pct, order: order };
  }

  function fillFeatureMask(ctx, feature, merc, w, h) {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    if (!feature || !merc) return;
    var spanX = merc.x1 - merc.x0;
    var spanY = merc.y1 - merc.y0;
    if (!(spanX > 0) || !(spanY > 0)) return;
    ctx.fillStyle = '#fff';
    var geom = feature.geometry;
    var polys = !geom || !geom.coordinates
      ? []
      : geom.type === 'Polygon'
        ? [geom.coordinates]
        : geom.coordinates;
    for (var p = 0; p < polys.length; p++) {
      var rings = polys[p] || [];
      ctx.beginPath();
      for (var r = 0; r < rings.length; r++) {
        var ring = rings[r];
        if (!ring || ring.length < 3) continue;
        for (var i = 0; i < ring.length; i++) {
          var m = lngLatToMercator(ring[i][0], ring[i][1]);
          var x = ((m[0] - merc.x0) / spanX) * w;
          var y = ((m[1] - merc.y0) / spanY) * h;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
      }
      ctx.fill('evenodd');
    }
  }

  function paintClipWater(image, merc) {
    if (!image || !merc || !image.data) return image;
    var w = image.width;
    var h = image.height;
    var land = null;
    try {
      var china = chinaLandFeature();
      if (china && typeof document !== 'undefined') {
        var canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        var ctx = canvas.getContext('2d', { alpha: false });
        fillFeatureMask(ctx, china, merc, w, h);
        land = ctx.getImageData(0, 0, w, h);
      }
    } catch (e) {
      land = null;
    }
    var spanX = merc.x1 - merc.x0;
    var spanY = merc.y1 - merc.y0;
    var data = image.data;
    var landData = land && land.data;
    var n = w * h;
    var i;
    for (i = 0; i < n; i++) {
      var x = i % w;
      var y = (i / w) | 0;
      var mx = merc.x0 + ((x + 0.5) / w) * spanX;
      var my = merc.y0 + ((y + 0.5) / h) * spanY;
      var ll = mercatorToLngLat(mx, my);
      var onLand = landData ? landData[i * 4] >= 128 : false;
      data[i * 4 + 1] = !onLand && inChinaSeas(ll[0], ll[1]) ? 255 : 0;
    }
    return image;
  }

  function rasterizeClip(feature, merc) {
    var w = CLIP_MAX;
    var h = CLIP_MAX;
    var spanX = merc.x1 - merc.x0;
    var spanY = merc.y1 - merc.y0;
    if (spanX > spanY) h = Math.max(CLIP_MIN, Math.round(CLIP_MAX * (spanY / spanX)));
    else w = Math.max(CLIP_MIN, Math.round(CLIP_MAX * (spanX / spanY)));
    var aa = 4;
    var rw = w * aa;
    var rh = h * aa;
    var canvas = document.createElement('canvas');
    canvas.width = rw;
    canvas.height = rh;
    var ctx = canvas.getContext('2d', { alpha: false });
    fillFeatureMask(ctx, feature, merc, rw, rh);
    var out = document.createElement('canvas');
    out.width = w;
    out.height = h;
    var octx = out.getContext('2d', { alpha: false });
    octx.imageSmoothingEnabled = true;
    if ('imageSmoothingQuality' in octx) octx.imageSmoothingQuality = 'high';
    octx.drawImage(canvas, 0, 0, w, h);
    var image = octx.getImageData(0, 0, w, h);
    paintClipWater(image, merc);
    return image;
  }

  function uploadTexture(gl, image) {
    var tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    return tex;
  }

  function mercatorToLngLat(x, y) {
    var lng = Number(x) * 360 - 180;
    var n = Math.PI * (1 - 2 * Number(y));
    var lat = (180 / Math.PI) * Math.atan(Math.sinh(n));
    return [lng, lat];
  }

  function sampleClipAtMerc(mx, my) {
    var clip = root.__antiqueTerrainClip;
    var img = clip && clip._image;
    var merc = clip && clip.merc;
    if (!img || !merc) return 0;
    var sx = merc.x1 - merc.x0;
    var sy = merc.y1 - merc.y0;
    if (!(sx > 0) || !(sy > 0)) return 0;
    var u = (mx - merc.x0) / sx;
    var v = (my - merc.y0) / sy;
    if (u < 0 || v < 0 || u > 1 || v > 1) return 0;
    var w = img.width;
    var h = img.height;
    var x = Math.min(w - 1, Math.max(0, (u * (w - 1) + 0.5) | 0));
    var y = Math.min(h - 1, Math.max(0, (v * (h - 1) + 0.5) | 0));
    return img.data[(y * w + x) * 4] / 255;
  }

  function meshCrossingsFromGrid(grid, x0, y0, s, meshSize) {
    var segs = [];
    if (!grid || meshSize < 1) return segs;
    function mercOf(fi, fj) {
      return [x0 + (fi / meshSize) * s, y0 + (fj / meshSize) * s];
    }
    function val(i, j) {
      return grid[j][i];
    }
    function cross(i0, j0, i1, j1) {
      var a = val(i0, j0);
      var b = val(i1, j1);
      var t = (0.5 - a) / (b - a);
      if (!isFinite(t)) t = 0.5;
      if (t < 0) t = 0;
      if (t > 1) t = 1;
      return mercOf(i0 + (i1 - i0) * t, j0 + (j1 - j0) * t);
    }
    for (var j = 0; j < meshSize; j++) {
      for (var i = 0; i < meshSize; i++) {
        var v0 = val(i, j) >= 0.5;
        var v1 = val(i + 1, j) >= 0.5;
        var v2 = val(i + 1, j + 1) >= 0.5;
        var v3 = val(i, j + 1) >= 0.5;
        var pts = [];
        if (v0 !== v1) pts.push(cross(i, j, i + 1, j));
        if (v1 !== v2) pts.push(cross(i + 1, j, i + 1, j + 1));
        if (v2 !== v3) pts.push(cross(i + 1, j + 1, i, j + 1));
        if (v3 !== v0) pts.push(cross(i, j + 1, i, j));
        if (pts.length === 2) segs.push([pts[0], pts[1]]);
        else if (pts.length === 4) {
          segs.push([pts[0], pts[1]]);
          segs.push([pts[2], pts[3]]);
        }
      }
    }
    return segs;
  }

  function coveringTerrainTiles(map, merc) {
    var tiles = [];
    try {
      var terr = mapTerrain(map);
      var tm = terr && terr.sourceCache;
      if (tm && typeof tm.getRenderableTiles === 'function') {
        var list = tm.getRenderableTiles() || [];
        for (var i = 0; i < list.length; i++) {
          if (tileIntersectsMerc(list[i], merc)) tiles.push(list[i]);
        }
        if (tiles.length) return tiles;
      }
    } catch (e) {
      /* fall through */
    }
    if (!map || typeof map.getBounds !== 'function') return tiles;
    var z = Math.max(0, Math.floor(typeof map.getZoom === 'function' ? map.getZoom() : 0));
    var b = map.getBounds();
    var sw = lngLatToMercator(b.getWest(), b.getSouth());
    var ne = lngLatToMercator(b.getEast(), b.getNorth());
    var scale = 1 << z;
    var x0 = Math.floor(Math.min(sw[0], ne[0]) * scale) - 1;
    var x1 = Math.floor(Math.max(sw[0], ne[0]) * scale) + 1;
    var y0 = Math.floor(Math.min(sw[1], ne[1]) * scale) - 1;
    var y1 = Math.floor(Math.max(sw[1], ne[1]) * scale) + 1;
    var x;
    var y;
    for (y = y0; y <= y1; y++) {
      for (x = x0; x <= x1; x++) {
        var tile = { tileID: { canonical: { z: z, x: x, y: y } } };
        if (tileIntersectsMerc(tile, merc)) tiles.push(tile);
      }
    }
    return tiles;
  }

  function queryAlt(map, lng, lat, fallback) {
    try {
      if (map && typeof map.queryTerrainElevation === 'function') {
        var e = map.queryTerrainElevation({ lng: lng, lat: lat }, { exaggerated: true });
        if (typeof e === 'number' && isFinite(e)) return e;
        e = map.queryTerrainElevation({ lng: lng, lat: lat });
        if (typeof e === 'number' && isFinite(e)) return e;
      }
    } catch (err) {
      /* ignore */
    }
    return fallback;
  }

  function capRing(ring, maxPoints) {
    if (!ring || ring.length <= maxPoints) return ring || [];
    var last = ring[ring.length - 1];
    var bodyLen = Math.max(1, ring.length - 1);
    var stride = Math.ceil(bodyLen / Math.max(3, maxPoints - 1));
    var out = [];
    for (var i = 0; i < bodyLen; i += stride) out.push(ring[i]);
    var prev = out[out.length - 1];
    if (!prev || prev[0] !== last[0] || prev[1] !== last[1]) out.push(last);
    return out;
  }

  function ringCentroid(ring) {
    var x = 0;
    var y = 0;
    var n = 0;
    if (!ring || !ring.length) return [0, 0];
    var last = ring.length - 1;
    var end =
      ring.length >= 2 && ring[0][0] === ring[last][0] && ring[0][1] === ring[last][1]
        ? last
        : ring.length;
    for (var i = 0; i < end; i++) {
      x += Number(ring[i][0]);
      y += Number(ring[i][1]);
      n += 1;
    }
    if (!n) return [0, 0];
    return [x / n, y / n];
  }

  function percentile(sorted, p) {
    if (!sorted || !sorted.length) return 0;
    var i = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
    return sorted[i];
  }

  function fillSampleAlts(samples) {
    var finite = [];
    var i;
    for (i = 0; i < samples.length; i++) {
      if (isFinite(samples[i].alt)) finite.push(samples[i].alt);
    }
    finite.sort(function (a, b) {
      return a - b;
    });
    var med = percentile(finite, 0.5);
    if (med > 400) {
      var inland = [];
      for (i = 0; i < finite.length; i++) {
        if (finite[i] > 30) inland.push(finite[i]);
      }
      if (inland.length >= 3) finite = inland;
    }
    var q10 = percentile(finite, 0.1);
    var q90 = percentile(finite, 0.9);
    var floor = med > 400 ? Math.max(30, q10 * 0.2) : -Infinity;
    for (i = 0; i < samples.length; i++) {
      var a = samples[i].alt;
      if (!isFinite(a) || a < floor) samples[i].alt = NaN;
    }
    var lastGood = isFinite(q10) ? q10 : 0;
    for (i = 0; i < samples.length; i++) {
      if (isFinite(samples[i].alt)) lastGood = samples[i].alt;
      else samples[i].alt = lastGood;
    }
    for (i = samples.length - 1; i >= 0; i--) {
      if (isFinite(samples[i].alt)) lastGood = samples[i].alt;
      else samples[i].alt = lastGood;
    }
    return { min: q10, max: q90 };
  }

  function featureKmDiag(feature) {
    var api = root.REGION_ISOLATE;
    var box = api && feature && api.featureBbox ? api.featureBbox(feature) : null;
    if (!box) return 0;
    var lat = (Number(box[1]) + Number(box[3])) * 0.5;
    var dlat = (Number(box[3]) - Number(box[1])) * 111.32;
    var clat = Math.cos((lat * Math.PI) / 180);
    var dlng = (Number(box[2]) - Number(box[0])) * 111.32 * Math.max(clat, 0.2);
    return Math.sqrt(dlat * dlat + dlng * dlng);
  }

  function ringWallRuns(ring, bounds, stepDeg, maxPoints) {
    var runs = sliceRingRuns(ring, bounds);
    if (!runs.length) runs = ring && ring.length ? [ring] : [];
    var out = [];
    var i;
    for (i = 0; i < runs.length; i++) {
      var dense = densifyRing(runs[i], stepDeg, maxPoints || WALL_MAX_POINTS);
      if (dense && dense.length >= 2) out.push(dense);
    }
    return out;
  }

  function wallSlab(minAlt, maxAlt, kmDiag) {
    var span = Math.max(0, Number(maxAlt) - Number(minAlt));
    if (!isFinite(span)) span = 0;
    var fromElev = span * 0.45 + 900;
    var fromSize = Number(kmDiag) > 0 ? Number(kmDiag) * 1.15 : 0;
    if (!isFinite(fromSize)) fromSize = 0;
    return Math.max(900, Math.min(6400, Math.max(fromElev, fromSize)));
  }

  function wallSkirt(minAlt, maxAlt) {
    return wallSlab(minAlt, maxAlt);
  }

  var EARTH_M = 40075016.686;
  var DROP_MIN = 18000;
  var DROP_MAX = 100000;
  var DROP_TILE_FRAC = 0.16;

  function dropMetersForMap(map, feature) {
    var z = 7;
    if (map && typeof map.getZoom === 'function') {
      var zg = Number(map.getZoom());
      if (isFinite(zg) && zg > 0) z = zg;
    }
    var tileZ = Math.max(0, Math.floor(z));
    var drop = (EARTH_M / Math.pow(2, tileZ)) * DROP_TILE_FRAC;
    if (!isFinite(drop) || drop < DROP_MIN) drop = DROP_MIN;
    if (drop > DROP_MAX) drop = DROP_MAX;
    return drop;
  }

  function wallStepDegForZoom(z) {
    z = Number(z);
    if (!isFinite(z)) z = 4;
    var step = 0.28 / Math.pow(2, Math.max(z - 3.5, 0));
    return Math.max(0.00025, Math.min(0.1, step));
  }

  function wallStepDegForMap(map) {
    var z = map && typeof map.getZoom === 'function' ? map.getZoom() : 4;
    var fromZ = wallStepDegForZoom(z);
    if (!map || typeof map.getBounds !== 'function') return fromZ;
    var b = map.getBounds();
    var span = Math.max(
      Math.abs(b.getEast() - b.getWest()),
      Math.abs(b.getNorth() - b.getSouth())
    );
    var fromView = span / 160;
    return Math.max(0.00025, Math.min(fromZ, fromView, 0.08));
  }

  function mapViewBounds(map, padMul) {
    if (!map || typeof map.getBounds !== 'function') return null;
    var b = map.getBounds();
    var m = padMul == null ? 0.22 : padMul;
    var padLng = Math.max((b.getEast() - b.getWest()) * m, 0.002);
    var padLat = Math.max((b.getNorth() - b.getSouth()) * m, 0.002);
    return {
      west: b.getWest() - padLng,
      east: b.getEast() + padLng,
      south: b.getSouth() - padLat,
      north: b.getNorth() + padLat,
    };
  }

  function pointInBounds(lng, lat, bounds) {
    return (
      lng >= bounds.west &&
      lng <= bounds.east &&
      lat >= bounds.south &&
      lat <= bounds.north
    );
  }

  function sliceRingToView(ring, bounds) {
    var runs = sliceRingRuns(ring, bounds);
    if (!runs.length) return ring || [];
    if (runs.length === 1) return runs[0];
    var out = [];
    for (var r = 0; r < runs.length; r++) {
      if (out.length) out.push(out[out.length - 1]);
      for (var i = 0; i < runs[r].length; i++) out.push(runs[r][i]);
    }
    return out;
  }

  function sliceRingRuns(ring, bounds) {
    if (!ring || ring.length < 2) return ring && ring.length ? [ring] : [];
    if (!bounds) return [ring];
    var n = ring.length;
    var marked = [];
    var any = false;
    var i;
    for (i = 0; i < n; i++) {
      marked[i] = pointInBounds(ring[i][0], ring[i][1], bounds);
      if (marked[i]) any = true;
    }
    if (!any) return [ring];
    var runs = [];
    var cur = [];
    function flush() {
      if (cur.length >= 2) runs.push(cur);
      cur = [];
    }
    for (i = 0; i < n - 1; i++) {
      if (marked[i] || marked[i + 1]) {
        if (!cur.length) cur.push(ring[i]);
        else if (cur[cur.length - 1] !== ring[i]) cur.push(ring[i]);
        cur.push(ring[i + 1]);
      } else {
        flush();
      }
    }
    flush();
    return runs.length ? runs : [ring];
  }

  function offsetOutward(lng, lat, cx, cy, meters) {
    var vx = lng - cx;
    var vy = lat - cy;
    var len = Math.sqrt(vx * vx + vy * vy);
    if (len < 1e-9) return [lng, lat];
    var dlat = meters / 111320;
    var clat = Math.cos((lat * Math.PI) / 180);
    var dlng = meters / (111320 * Math.max(clat, 0.2));
    return [lng + (vx / len) * dlng, lat + (vy / len) * dlat];
  }

  function hypot2(dx, dy) {
    return Math.sqrt(dx * dx + dy * dy);
  }

  function ringBody(ring) {
    if (!ring || ring.length < 2) return [];
    var last = ring[ring.length - 1];
    var closed = ring[0][0] === last[0] && ring[0][1] === last[1];
    return closed ? ring.slice(0, -1) : ring.slice();
  }

  function closeRingCopy(body) {
    if (!body || !body.length) return [];
    var out = body.slice();
    var a = out[0];
    var b = out[out.length - 1];
    if (a[0] !== b[0] || a[1] !== b[1]) out.push([a[0], a[1]]);
    return out;
  }

  function projectPoint(project, lng, lat) {
    var p = project(lng, lat);
    if (!p) return [lng, lat];
    if (typeof p.x === 'number' && typeof p.y === 'number') return [p.x, p.y];
    return [Number(p[0]), Number(p[1])];
  }

  function unprojectPoint(unproject, x, y, fallback) {
    if (typeof unproject !== 'function') return fallback ? [fallback[0], fallback[1]] : [x, y];
    var ll = unproject(x, y);
    if (!ll) return fallback ? [fallback[0], fallback[1]] : [x, y];
    if (typeof ll.lng === 'number' && typeof ll.lat === 'number') return [ll.lng, ll.lat];
    if (ll.length >= 2) return [Number(ll[0]), Number(ll[1])];
    return fallback ? [fallback[0], fallback[1]] : [x, y];
  }

  // Invert map.project so screen-space arcs survive terrain/pitch.
  // map.unproject is a ground-plane ray and is ~8px off at the isolate camera.
  function invertProject(project, unproject, x, y, hint) {
    var ll = unprojectPoint(unproject, x, y, hint);
    if (typeof project !== 'function') return ll;
    var i;
    for (i = 0; i < 10; i++) {
      var p = projectPoint(project, ll[0], ll[1]);
      var ex = x - p[0];
      var ey = y - p[1];
      if (ex * ex + ey * ey < 0.25) break;
      var epsLng = 1e-4;
      var epsLat = 1e-4;
      var px = projectPoint(project, ll[0] + epsLng, ll[1]);
      var py = projectPoint(project, ll[0], ll[1] + epsLat);
      var jxx = (px[0] - p[0]) / epsLng;
      var jxy = (py[0] - p[0]) / epsLat;
      var jyx = (px[1] - p[1]) / epsLng;
      var jyy = (py[1] - p[1]) / epsLat;
      var det = jxx * jyy - jxy * jyx;
      if (!(Math.abs(det) > 1e-18)) break;
      var dLng = (jyy * ex - jxy * ey) / det;
      var dLat = (-jyx * ex + jxx * ey) / det;
      if (dLng > 0.25) dLng = 0.25;
      else if (dLng < -0.25) dLng = -0.25;
      if (dLat > 0.25) dLat = 0.25;
      else if (dLat < -0.25) dLat = -0.25;
      ll = [ll[0] + dLng, ll[1] + dLat];
    }
    return ll;
  }

  function projectRingPts(ring, project) {
    var body = ringBody(ring);
    var out = [];
    var i;
    for (i = 0; i < body.length; i++) {
      var xy = projectPoint(project, body[i][0], body[i][1]);
      out.push({
        lng: body[i][0],
        lat: body[i][1],
        x: xy[0],
        y: xy[1],
      });
    }
    return out;
  }

  function turnRad(a, b, c) {
    var ax = b.x - a.x;
    var ay = b.y - a.y;
    var bx = c.x - b.x;
    var by = c.y - b.y;
    return Math.atan2(ax * by - ay * bx, ax * bx + ay * by);
  }

  function segLen(a, b) {
    return hypot2(b.x - a.x, b.y - a.y);
  }

  function axisAlignedPx(dx, dy) {
    var ang = Math.atan2(Math.abs(dy), Math.abs(dx));
    return Math.min(ang, Math.PI / 2 - ang) <= (8 * Math.PI) / 180;
  }

  function longestProjectedStepPx(ring, project) {
    var pts = projectRingPts(ring, project);
    if (pts.length < 2) return 0;
    var n = pts.length;
    var max = 0;
    var i;
    for (i = 0; i < n; i++) {
      var a = pts[i];
      var b = pts[(i + 1) % n];
      if (!nearViewport([a.x, a.y]) || !nearViewport([b.x, b.y])) continue;
      var d = segLen(a, b);
      if (d > max) max = d;
    }
    return max;
  }

  function longestAxisAlignedFlatPx(ring, project) {
    var pts = projectRingPts(ring, project);
    if (pts.length < 2) return 0;
    var n = pts.length;
    var maxRun = 0;
    var run = 0;
    var i;
    for (i = 0; i < n; i++) {
      var a = pts[i];
      var b = pts[(i + 1) % n];
      if (!nearViewport([a.x, a.y]) || !nearViewport([b.x, b.y])) {
        run = 0;
        continue;
      }
      var dx = b.x - a.x;
      var dy = b.y - a.y;
      var d = hypot2(dx, dy);
      if (d >= 1.2 && axisAlignedPx(dx, dy)) {
        run += d;
        if (run > maxRun) maxRun = run;
      } else {
        run = 0;
      }
    }
    return maxRun;
  }

  function circumcircle(p, q, r) {
    var ax = p.x;
    var ay = p.y;
    var bx = q.x;
    var by = q.y;
    var cx = r.x;
    var cy = r.y;
    var d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
    if (Math.abs(d) < 1e-8) return null;
    var a2 = ax * ax + ay * ay;
    var b2 = bx * bx + by * by;
    var c2 = cx * cx + cy * cy;
    var ux = (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / d;
    var uy = (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / d;
    var rad = hypot2(ux - ax, uy - ay);
    if (!isFinite(rad) || rad < 1.5 || rad > 1600) return null;
    return { cx: ux, cy: uy, r: rad };
  }

  function sampleArcScreen(cx, cy, r, ang0, ang1, stepPx) {
    var delta = ang1 - ang0;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    var arcLen = Math.abs(delta) * r;
    var n = Math.max(2, Math.ceil(arcLen / Math.max(stepPx, 0.5)));
    if (n > 1024) n = 1024;
    var out = [];
    var i;
    for (i = 0; i <= n; i++) {
      var t = i / n;
      var a = ang0 + delta * t;
      out.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
    }
    return out;
  }

  function sampleQuadScreen(p0, p1, p2, stepPx) {
    var len =
      hypot2(p1.x - p0.x, p1.y - p0.y) + hypot2(p2.x - p1.x, p2.y - p1.y);
    var n = Math.max(2, Math.ceil(len / Math.max(stepPx, 0.5)));
    if (n > 1024) n = 1024;
    var out = [];
    var i;
    for (i = 0; i <= n; i++) {
      var t = i / n;
      var u = 1 - t;
      out.push({
        x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x,
        y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y,
      });
    }
    return out;
  }

  function arcThroughMid(a, mid, c, stepPx) {
    var circ = circumcircle(a, mid, c);
    if (circ) {
      var a0 = Math.atan2(a.y - circ.cy, a.x - circ.cx);
      var a1 = Math.atan2(c.y - circ.cy, c.x - circ.cx);
      var am = Math.atan2(mid.y - circ.cy, mid.x - circ.cx);
      function onArc(delta) {
        var t = am - a0;
        while (t > Math.PI) t -= Math.PI * 2;
        while (t < -Math.PI) t += Math.PI * 2;
        if (delta >= 0) return t >= -1e-3 && t <= delta + 1e-3;
        return t <= 1e-3 && t >= delta - 1e-3;
      }
      var dPos = a1 - a0;
      while (dPos > Math.PI) dPos -= Math.PI * 2;
      while (dPos < -Math.PI) dPos += Math.PI * 2;
      if (!onArc(dPos)) {
        if (dPos >= 0) dPos -= Math.PI * 2;
        else dPos += Math.PI * 2;
      }
      if (onArc(dPos)) {
        return sampleArcScreen(circ.cx, circ.cy, circ.r, a0, a0 + dPos, stepPx);
      }
    }
    return sampleQuadScreen(a, mid, c, stepPx);
  }

  function isNearRightAngle(tr) {
    return Math.abs(Math.abs(tr) - Math.PI / 2) < (8 * Math.PI) / 180;
  }

  // Walk past densified 2px samples so a V-notch still has real side length.
  function walkToLen(pts, from, dir, minPx) {
    var n = pts.length;
    var i = from;
    var acc = 0;
    var maxTurn = (12 * Math.PI) / 180;
    var k;
    for (k = 0; k < 80; k++) {
      var j = (i + dir + n) % n;
      var sl = segLen(pts[i], pts[j]);
      if (sl < 1e-6) {
        i = j;
        continue;
      }
      acc += sl;
      var j2 = (j + dir + n) % n;
      var tr = Math.abs(turnRad(pts[i], pts[j], pts[j2]));
      i = j;
      if (acc >= minPx || tr > maxTurn) {
        return { i: i, len: acc };
      }
    }
    return { i: i, len: acc };
  }

  function filletCorner(a, b, c, stepPx) {
    var l1 = segLen(a, b);
    var l2 = segLen(b, c);
    if (l1 < 1.2 || l2 < 1.2) return null;
    var v1x = (a.x - b.x) / l1;
    var v1y = (a.y - b.y) / l1;
    var v2x = (c.x - b.x) / l2;
    var v2y = (c.y - b.y) / l2;
    var cross = v1x * v2y - v1y * v2x;
    var dot = v1x * v2x + v1y * v2y;
    var ang = Math.atan2(cross, dot);
    var half = Math.abs(ang) * 0.5;
    if (half < 0.12 || half > 1.45) return null;
    var radius = Math.min(10, 0.42 * Math.min(l1, l2));
    var t = radius / Math.tan(half);
    if (t > l1 * 0.46 || t > l2 * 0.46) {
      t = Math.min(l1, l2) * 0.46;
      radius = t * Math.tan(half);
    }
    if (!(radius > 1.4) || !(t > 0.8)) return null;
    var p0 = { x: b.x + v1x * t, y: b.y + v1y * t };
    var p1 = { x: b.x + v2x * t, y: b.y + v2y * t };
    var nx = -v1y;
    var ny = v1x;
    var toP1x = p1.x - p0.x;
    var toP1y = p1.y - p0.y;
    if (nx * toP1y - ny * toP1x < 0) {
      nx = -nx;
      ny = -ny;
    }
    var cx = p0.x + nx * radius;
    var cy = p0.y + ny * radius;
    var a0 = Math.atan2(p0.y - cy, p0.x - cx);
    var a1 = Math.atan2(p1.y - cy, p1.x - cx);
    return sampleArcScreen(cx, cy, radius, a0, a1, stepPx);
  }

  function extendChainEnd(pts, idx, dir, extraPx) {
    var n = pts.length;
    var i = idx;
    var acc = 0;
    var k;
    var maxTurn = (6 * Math.PI) / 180;
    for (k = 0; k < 24; k++) {
      var j = (i + dir + n) % n;
      var sl = segLen(pts[i], pts[j]);
      if (sl < 1.2 || sl > 220) break;
      if (acc + sl > extraPx) break;
      var j2 = (j + dir + n) % n;
      var tr = turnRad(pts[i], pts[j], pts[j2]);
      if (Math.abs(tr) > maxTurn) break;
      if (isNearRightAngle(tr)) break;
      acc += sl;
      i = j;
    }
    return i;
  }

  function findCornerChains(pts) {
    var n = pts.length;
    var chains = [];
    var used = [];
    var i;
    for (i = 0; i < n; i++) used[i] = 0;
    // Close-zoom cape tips: a 6px oblique chamfer is ~45px. Do not treat
    // those chords as too long to be a corner, and do not merge them.
    var seedMin = (3 * Math.PI) / 180;
    var growMin = (2 * Math.PI) / 180;
    var growMax = (88.5 * Math.PI) / 180;
    var slMin = 1.2;
    var slMax = 220;
    var lenMax = 900;
    var kMax = 48;
    var needTurn = (22 * Math.PI) / 180;
    for (i = 0; i < n; i++) {
      if (used[i]) continue;
      var prev = pts[(i - 1 + n) % n];
      var cur = pts[i];
      var next = pts[(i + 1) % n];
      var tr = turnRad(prev, cur, next);
      if (Math.abs(tr) < seedMin) continue;
      var sign = tr >= 0 ? 1 : -1;
      var start = i;
      var end = i;
      var k;
      var cumTurn = tr;
      var cumLen = 0;
      for (k = 1; k <= kMax; k++) {
        var i0 = (i - k + n) % n;
        var i1 = (i - k + 1 + n) % n;
        var sl = segLen(pts[i0], pts[i1]);
        if (sl < slMin || sl > slMax) break;
        if (cumLen + sl > lenMax) break;
        var tk = turnRad(pts[(i0 - 1 + n) % n], pts[i0], pts[i1]);
        // Keep the last on-curve vertex even when the next turn leaves
        // the cape. Do not swallow a sharp 90° clip corner.
        if (Math.abs(tk) > growMax) break;
        start = i0;
        cumLen += sl;
        if (tk * sign < growMin) break;
        cumTurn += tk;
      }
      cumLen = 0;
      for (k = 1; k <= kMax; k++) {
        var j0 = (i + k - 1 + n) % n;
        var j1 = (i + k) % n;
        var sl2 = segLen(pts[j0], pts[j1]);
        if (sl2 < slMin || sl2 > slMax) break;
        if (cumLen + sl2 > lenMax) break;
        var tk2 = turnRad(pts[j0], pts[j1], pts[(j1 + 1) % n]);
        if (Math.abs(tk2) > growMax) break;
        end = j1;
        cumLen += sl2;
        if (tk2 * sign < growMin) break;
        cumTurn += tk2;
      }
      var count = (end - start + n) % n + 1;
      if (count >= 4 && Math.abs(cumTurn) >= needTurn) {
        start = extendChainEnd(pts, start, -1, 12);
        end = extendChainEnd(pts, end, 1, 12);
        count = (end - start + n) % n + 1;
        chains.push({ start: start, end: end, count: count });
        for (k = 0; k < count; k++) used[(start + k) % n] = 1;
      }
    }
    return chains;
  }

  // Screen-space circular/cubic rounding of chamfered corners. Do not snap
  // rim points onto a pixel or mesh cell grid. Do not collinear-merge.
  function roundCornerArcs(ring, project, unproject, opts) {
    opts = opts || {};
    var stepPx = opts.stepPx == null ? RIM_STEP_PX : opts.stepPx;
    if (!ring || ring.length < 3 || typeof project !== 'function') return closeRingCopy(ringBody(ring));
    var pts = projectRingPts(ring, project);
    var n = pts.length;
    if (n < 3) return closeRingCopy(ringBody(ring));
    var skip = [];
    var i;
    for (i = 0; i < n; i++) skip[i] = 0;
    var repl = [];
    var chains = findCornerChains(pts);
    for (i = 0; i < chains.length; i++) {
      var ch = chains[i];
      var a = pts[ch.start];
      var c = pts[ch.end];
      var mid = pts[(ch.start + Math.floor(ch.count / 2)) % n];
      var arc = arcThroughMid(a, mid, c, stepPx);
      if (!arc || arc.length < 3) continue;
      var k;
      for (k = 0; k < ch.count; k++) skip[(ch.start + k) % n] = 1;
      skip[ch.start] = 0;
      skip[ch.end] = 0;
      repl[ch.start] = { until: ch.end, screen: arc };
    }
    for (i = 0; i < n; i++) {
      if (skip[i] || repl[i]) continue;
      var prev = pts[(i - 1 + n) % n];
      var cur = pts[i];
      var next = pts[(i + 1) % n];
      var tr = Math.abs(turnRad(prev, cur, next));
      var l1 = segLen(prev, cur);
      var l2 = segLen(cur, next);
      if (tr < (32 * Math.PI) / 180) continue;
      if (isNearRightAngle(turnRad(prev, cur, next))) continue;
      if (Math.min(l1, l2) > 22) continue;
      var fillet = filletCorner(prev, cur, next, stepPx);
      if (!fillet || fillet.length < 3) continue;
      skip[i] = 1;
      repl[(i - 1 + n) % n] = { until: (i + 1) % n, screen: fillet, kind: 'fillet' };
    }
    // Densify turns a V-notch into 2px samples, so the local fillet
    // above never sees the real side length. Walk 16px out and arc it.
    for (i = 0; i < n; i++) {
      if (skip[i] || repl[i]) continue;
      var prevV = pts[(i - 1 + n) % n];
      var curV = pts[i];
      var nextV = pts[(i + 1) % n];
      var trV = turnRad(prevV, curV, nextV);
      if (Math.abs(trV) < (18 * Math.PI) / 180) continue;
      if (isNearRightAngle(trV)) continue;
      var back = walkToLen(pts, i, -1, 16);
      var fwd = walkToLen(pts, i, 1, 16);
      if (back.len < 6 || fwd.len < 6) continue;
      if (skip[back.i] || skip[fwd.i] || repl[back.i]) continue;
      var vArc = arcThroughMid(pts[back.i], curV, pts[fwd.i], stepPx);
      if (!vArc || vArc.length < 3) continue;
      var kk;
      var vCount = (fwd.i - back.i + n) % n + 1;
      if (vCount < 3 || vCount > n - 3) continue;
      for (kk = 0; kk < vCount; kk++) skip[(back.i + kk) % n] = 1;
      skip[back.i] = 0;
      skip[fwd.i] = 0;
      repl[back.i] = { until: fwd.i, screen: vArc, kind: 'v-notch' };
    }
    var startI = -1;
    for (i = 0; i < n; i++) {
      if (repl[i]) {
        startI = i;
        break;
      }
    }
    if (startI < 0) {
      for (i = 0; i < n; i++) {
        if (!skip[i]) {
          startI = i;
          break;
        }
      }
    }
    if (startI < 0) startI = 0;
    var out = [];
    i = startI;
    var guard = 0;
    do {
      if (repl[i] && repl[i].screen) {
        var screen = repl[i].screen;
        var s;
        for (s = 0; s < screen.length; s++) {
          var ll = invertProject(project, unproject, screen[s].x, screen[s].y, [pts[i].lng, pts[i].lat]);
          if (out.length) {
            var prevOut = out[out.length - 1];
            if (prevOut[0] === ll[0] && prevOut[1] === ll[1]) continue;
          }
          out.push(ll);
        }
        i = (repl[i].until + 1) % n;
      } else {
        if (!skip[i]) out.push([pts[i].lng, pts[i].lat]);
        i = (i + 1) % n;
      }
    } while (i !== startI && guard++ < n + 8);
    if (out.length < 3) return closeRingCopy(ringBody(ring));
    return closeRingCopy(out);
  }

  function projFinite(p) {
    return p && isFinite(p[0]) && isFinite(p[1]) && Math.abs(p[0]) < 1e6 && Math.abs(p[1]) < 1e6;
  }

  function nearViewport(p) {
    return projFinite(p) && Math.abs(p[0]) < 4000 && Math.abs(p[1]) < 3000;
  }

  function projBow(pa, pm, pb) {
    if (!projFinite(pa) || !projFinite(pm) || !projFinite(pb)) return 0;
    var dx = pb[0] - pa[0];
    var dy = pb[1] - pa[1];
    var len2 = dx * dx + dy * dy;
    if (len2 < 1e-12) return hypot2(pm[0] - pa[0], pm[1] - pa[1]);
    var t = ((pm[0] - pa[0]) * dx + (pm[1] - pa[1]) * dy) / len2;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    return hypot2(pm[0] - (pa[0] + t * dx), pm[1] - (pa[1] + t * dy));
  }

  function splitProjected(a, b, projects, maxPx, depth, acc, cap) {
    if (cap && acc.length >= cap) {
      acc.push(a);
      return;
    }
    var mid = [(a[0] + b[0]) * 0.5, (a[1] + b[1]) * 0.5];
    var geo = hypot2(b[0] - a[0], b[1] - a[1]);
    if (geo < 1e-12 || depth > 18) {
      acc.push(a);
      return;
    }
    var distMax = 0;
    var bowMax = 0;
    var anyNear = false;
    var pi;
    for (pi = 0; pi < projects.length; pi++) {
      var pa = projectPoint(projects[pi], a[0], a[1]);
      var pb = projectPoint(projects[pi], b[0], b[1]);
      if (!nearViewport(pa) || !nearViewport(pb)) continue;
      anyNear = true;
      var dist = hypot2(pb[0] - pa[0], pb[1] - pa[1]);
      if (dist > distMax) distMax = dist;
      var pm = projectPoint(projects[pi], mid[0], mid[1]);
      var bow = projBow(pa, pm, pb);
      if (bow > bowMax) bowMax = bow;
    }
    var need = false;
    if (!anyNear) {
      if (geo > 0.004 && depth < 8) need = true;
    } else if (distMax > maxPx || bowMax > maxPx * 0.45) {
      need = true;
    }
    if (!need) {
      acc.push(a);
      return;
    }
    splitProjected(a, mid, projects, maxPx, depth + 1, acc, cap);
    splitProjected(mid, b, projects, maxPx, depth + 1, acc, cap);
  }

  // Insert points so adjacent projected samples are ≤ maxPx, including
  // near-vertical tails. Never drop collinear points. Never resample-cap.
  // `project` may be one function or an array of projectors (top/clay/bottom).
  function densifyProjected(ring, project, maxPx) {
    maxPx = maxPx == null ? RIM_STEP_PX : maxPx;
    if (!ring || ring.length < 2 || typeof project !== 'function' && !Array.isArray(project)) {
      return closeRingCopy(ringBody(ring));
    }
    var projects = Array.isArray(project) ? project : [project];
    if (!projects.length || typeof projects[0] !== 'function') return closeRingCopy(ringBody(ring));
    var body = ringBody(ring);
    var n = body.length;
    if (n < 2) return closeRingCopy(body);
    var out = [];
    var i;
    var cap = 24000;
    for (i = 0; i < n; i++) {
      if (out.length >= cap) {
        accPushRest(out, body, i, n);
        break;
      }
      splitProjected(body[i], body[(i + 1) % n], projects, Math.max(maxPx, 0.5), 0, out, cap);
    }
    return closeRingCopy(out);
  }

  function accPushRest(out, body, i, n) {
    var k;
    for (k = i; k < n; k++) out.push(body[k]);
  }

  function nudgeRimOutwardPx(ring, project, unproject, px) {
    px = px == null ? RIM_NUDGE_PX : px;
    if (!(px > 0) || !ring || ring.length < 3) return closeRingCopy(ringBody(ring));
    var pts = projectRingPts(ring, project);
    var n = pts.length;
    if (n < 3) return closeRingCopy(ringBody(ring));
    var area = 0;
    var cLng = 0;
    var cLat = 0;
    var i;
    for (i = 0; i < n; i++) {
      var a = pts[i];
      var b = pts[(i + 1) % n];
      area += a.x * b.y - b.x * a.y;
      cLng += a.lng;
      cLat += a.lat;
    }
    var sign = area >= 0 ? 1 : -1;
    cLng /= n;
    cLat /= n;
    var out = [];
    for (i = 0; i < n; i++) {
      var prev = pts[(i - 1 + n) % n];
      var cur = pts[i];
      var next = pts[(i + 1) % n];
      var e1x = cur.x - prev.x;
      var e1y = cur.y - prev.y;
      var e2x = next.x - cur.x;
      var e2y = next.y - cur.y;
      var l1 = hypot2(e1x, e1y) || 1;
      var l2 = hypot2(e2x, e2y) || 1;
      var n1x = sign * (e1y / l1);
      var n1y = sign * (-e1x / l1);
      var n2x = sign * (e2y / l2);
      var n2y = sign * (-e2x / l2);
      var nx = n1x + n2x;
      var ny = n1y + n2y;
      var nl = hypot2(nx, ny);
      if (nl < 1e-6) {
        nx = n1x;
        ny = n1y;
        nl = hypot2(nx, ny) || 1;
      }
      nx /= nl;
      ny /= nl;
      var vx = 0;
      var vy = 0;
      var hasClip = root.__antiqueTerrainClip && root.__antiqueTerrainClip._image;
      if (hasClip) {
        var eps = 0.01;
        var mE = lngLatToMercator(cur.lng + eps, cur.lat);
        var mW = lngLatToMercator(cur.lng - eps, cur.lat);
        var mN = lngLatToMercator(cur.lng, cur.lat + eps);
        var mS = lngLatToMercator(cur.lng, cur.lat - eps);
        var gLng = (sampleClipAtMerc(mE[0], mE[1]) - sampleClipAtMerc(mW[0], mW[1])) / (2 * eps);
        var gLat = (sampleClipAtMerc(mN[0], mN[1]) - sampleClipAtMerc(mS[0], mS[1])) / (2 * eps);
        if (gLng * gLng + gLat * gLat > 1e-8) {
          var pOut = projectPoint(project, cur.lng - gLng * eps, cur.lat - gLat * eps);
          if (projFinite(pOut)) {
            vx = pOut[0] - cur.x;
            vy = pOut[1] - cur.y;
          }
        }
      }
      if (!(vx * vx + vy * vy > 1e-12)) {
        var dlng = cur.lng - cLng;
        var dlat = cur.lat - cLat;
        var glen = hypot2(dlng, dlat) || 1;
        var pAway = projectPoint(project, cur.lng + (dlng / glen) * 1e-3, cur.lat + (dlat / glen) * 1e-3);
        if (projFinite(pAway)) {
          vx = pAway[0] - cur.x;
          vy = pAway[1] - cur.y;
        }
      }
      if (vx * vx + vy * vy > 1e-12 && nx * vx + ny * vy < 0) {
        nx = -nx;
        ny = -ny;
      }
      var cos = Math.abs(nx * n1x + ny * n1y);
      if (cos < 0.25) cos = 0.25;
      var mag = px / cos;
      if (mag > 36) mag = 36;
      out.push(invertProject(project, unproject, cur.x + nx * mag, cur.y + ny * mag, [cur.lng, cur.lat]));
    }
    return closeRingCopy(out);
  }

  function buildRimLoop(ring, project, unproject, opts) {
    opts = opts || {};
    var maxPx = opts.maxPx == null ? RIM_STEP_PX : opts.maxPx;
    var rounded = roundCornerArcs(ring, project, unproject, opts);
    var densifyWith = opts.extraProjects && opts.extraProjects.length
      ? [project].concat(opts.extraProjects)
      : project;
    var dense = densifyProjected(rounded, densifyWith, maxPx);
    var nudge = opts.nudgePx == null ? 0 : opts.nudgePx;
    if (nudge > 0 && typeof unproject === 'function') {
      dense = nudgeRimOutwardPx(dense, project, unproject, nudge);
      dense = roundCornerArcs(dense, project, unproject, opts);
      dense = densifyProjected(dense, densifyWith, maxPx);
    }
    return dense;
  }

  function rimLoopsFromFeature(feature, project, unproject, opts) {
    opts = opts || {};
    if (opts.nudgePx == null) opts.nudgePx = RIM_NUDGE_PX;
    var loops = [];
    eachRing(feature, function (ring, isOuter) {
      if (!isOuter) return;
      var loop = buildRimLoop(ring, project, unproject, opts);
      if (loop && loop.length >= 4) loops.push(loop);
    });
    return loops;
  }

  // Skirt wall: bottom ring is the top ring dropped. Same projected loop.
  function skirtRingsFromLoop(loop) {
    var top = loop || [];
    var bottom = [];
    var i;
    for (i = 0; i < top.length; i++) bottom.push([top[i][0], top[i][1]]);
    return { top: top, bottom: bottom };
  }

  function mapProjectFn(map) {
    return function (lng, lat) {
      if (map && typeof map.project === 'function') {
        return map.project({ lng: lng, lat: lat });
      }
      var m = lngLatToMercator(lng, lat);
      return [m[0] * 1024, m[1] * 1024];
    };
  }

  function mapUnprojectFn(map) {
    return function (x, y) {
      try {
        if (map && typeof map.unproject === 'function') {
          var ll = map.unproject([x, y]);
          if (ll && isFinite(ll.lng) && isFinite(ll.lat) && Math.abs(ll.lat) <= 89) {
            return [ll.lng, ll.lat];
          }
        }
      } catch (e) {}
      return mercatorToLngLat(x / 1024, y / 1024);
    };
  }

  function project3dFn(map, altMeters) {
    return function (lng, lat) {
      try {
        var tr = map && map.painter && map.painter.transform;
        if (tr && typeof tr.coordinatePoint === 'function') {
          var m = lngLatToMercator(lng, lat);
          var mat = tr._pixelMatrix3D || tr._pixelMatrix;
          var p = tr.coordinatePoint({ x: m[0], y: m[1] }, altMeters, mat);
          if (p && isFinite(p.x) && isFinite(p.y)) return [p.x, p.y];
        }
      } catch (e) {
        /* fall through */
      }
      if (map && typeof map.project === 'function') return map.project({ lng: lng, lat: lat });
      var mm = lngLatToMercator(lng, lat);
      return [mm[0] * 1024, mm[1] * 1024];
    };
  }

  function projectElevFn(map) {
    return function (lng, lat) {
      var alt = 0;
      try {
        if (map && typeof map.queryTerrainElevation === 'function') {
          var e = map.queryTerrainElevation({ lng: lng, lat: lat }, { exaggerated: true });
          if (typeof e === 'number' && isFinite(e)) alt = e;
        }
      } catch (e) {}
      return project3dFn(map, alt)(lng, lat);
    };
  }

  function canvasCssSize(map) {
    var tr = map && map.painter && map.painter.transform;
    if (tr && tr.width && tr.height) return [tr.width, tr.height];
    var c = map && map.getCanvas && map.getCanvas();
    if (c) return [c.clientWidth || c.width || 800, c.clientHeight || c.height || 800];
    return [800, 800];
  }

  function mulMat4Vec4(m, x, y, z) {
    return [
      m[0] * x + m[4] * y + m[8] * z + m[12],
      m[1] * x + m[5] * y + m[9] * z + m[13],
      m[2] * x + m[6] * y + m[10] * z + m[14],
      m[3] * x + m[7] * y + m[11] * z + m[15],
    ];
  }

  function ndcYOfMercatorAltitude(mat, maplibregl, lng, lat, alt) {
    if (!mat || !maplibregl || !maplibregl.MercatorCoordinate) return 0;
    var mc = maplibregl.MercatorCoordinate.fromLngLat({ lng: lng, lat: lat }, alt);
    var clip = mulMat4Vec4(mat, mc.x, mc.y, mc.z);
    if (Math.abs(clip[3]) < 1e-12) return 0;
    return clip[1] / clip[3];
  }

  // Custom-layer mercator Z can be opposite the terrain mesh (ele - drop).
  // +1 → bottom = alt + drop (when alt-drop projects toward +ndcY / sky).
  // -1 → bottom = alt - drop (same meter direction as the mesh).
  // Live MapStage mainMatrix matches the mesh, so the default is -1. A/B on
  // 拆出·北京: forcing +1 put bedrock in the sky and removed the near skirt.
  function overlayDropSignFromMatrix(mat, maplibregl, lng, lat, alt, drop) {
    if (!mat || !maplibregl || !maplibregl.MercatorCoordinate || !(drop > 0)) return -1;
    var yTop = ndcYOfMercatorAltitude(mat, maplibregl, lng, lat, alt);
    var yMinus = ndcYOfMercatorAltitude(mat, maplibregl, lng, lat, alt - drop);
    if (yMinus > yTop + 1e-6) return 1;
    if (yMinus < yTop - 1e-6) return -1;
    return -1;
  }

  function overlayDropSign(map, maplibregl, lng, lat, alt, drop) {
    return overlayDropSignFromMatrix(
      customLayerMatrix(map),
      maplibregl || (typeof root.maplibregl !== 'undefined' ? root.maplibregl : null),
      lng,
      lat,
      alt,
      drop
    );
  }

  function customLayerMatrix(map) {
    try {
      var tr = map && map.painter && map.painter.transform;
      if (tr && typeof tr.getProjectionDataForCustomLayer === 'function') {
        var data = tr.getProjectionDataForCustomLayer(false);
        var live = asFlat16(data && data.mainMatrix);
        if (live) return live;
      }
    } catch (e) {}
    try {
      var impl = map && map.__antiqueIslandWalls;
      if (impl && impl.lastMatrix) return impl.lastMatrix;
    } catch (e2) {}
    return null;
  }

  function projectGpuFn(map, maplibregl, altMeters) {
    var mat = customLayerMatrix(map);
    var ml = maplibregl || (typeof root.maplibregl !== 'undefined' ? root.maplibregl : null);
    var wh = canvasCssSize(map);
    var alt = altMeters == null ? 0 : altMeters;
    return function (lng, lat) {
      try {
        if (mat && ml && ml.MercatorCoordinate) {
          var mc = ml.MercatorCoordinate.fromLngLat({ lng: lng, lat: lat }, alt);
          var clip = mulMat4Vec4(mat, mc.x, mc.y, mc.z);
          if (Math.abs(clip[3]) > 1e-12) {
            var ndcX = clip[0] / clip[3];
            var ndcY = clip[1] / clip[3];
            return [(ndcX * 0.5 + 0.5) * wh[0], (1 - (ndcY * 0.5 + 0.5)) * wh[1]];
          }
        }
      } catch (e) {}
      return project3dFn(map, alt)(lng, lat);
    };
  }

  function projectGpuElevFn(map, maplibregl) {
    var gpu0 = projectGpuFn(map, maplibregl, 0);
    var mat = customLayerMatrix(map);
    var ml = maplibregl || (typeof root.maplibregl !== 'undefined' ? root.maplibregl : null);
    var wh = canvasCssSize(map);
    return function (lng, lat) {
      var alt = queryAlt(map, lng, lat, 0);
      if (!(typeof alt === 'number') || !isFinite(alt) || alt === 0) return gpu0(lng, lat);
      try {
        if (mat && ml && ml.MercatorCoordinate) {
          var mc = ml.MercatorCoordinate.fromLngLat({ lng: lng, lat: lat }, alt);
          var clip = mulMat4Vec4(mat, mc.x, mc.y, mc.z);
          if (Math.abs(clip[3]) > 1e-12) {
            var ndcX = clip[0] / clip[3];
            var ndcY = clip[1] / clip[3];
            return [(ndcX * 0.5 + 0.5) * wh[0], (1 - (ndcY * 0.5 + 0.5)) * wh[1]];
          }
        }
      } catch (e) {}
      return projectGpuFn(map, maplibregl, alt)(lng, lat);
    };
  }

  function densifyRing(ring, maxStepDeg, maxPoints) {
    if (!ring || ring.length < 2) return ring || [];
    var step = Math.max(maxStepDeg || 0.08, 0.0002);
    var cap = maxPoints || WALL_MAX_POINTS;
    var out = [];
    for (var i = 0; i < ring.length - 1; i++) {
      var a = ring[i];
      var b = ring[i + 1];
      if (
        !out.length ||
        out[out.length - 1][0] !== a[0] ||
        out[out.length - 1][1] !== a[1]
      ) {
        out.push(a);
      }
      var dx = b[0] - a[0];
      var dy = b[1] - a[1];
      var dist = Math.sqrt(dx * dx + dy * dy);
      var n = Math.min(256, Math.floor(dist / step));
      for (var k = 1; k < n; k++) {
        var t = k / n;
        out.push([a[0] + dx * t, a[1] + dy * t]);
        if (out.length > 24000) break;
      }
      if (out.length > 24000) break;
    }
    var last = ring[ring.length - 1];
    if (
      !out.length ||
      out[out.length - 1][0] !== last[0] ||
      out[out.length - 1][1] !== last[1]
    ) {
      out.push(last);
    }
    return out.length > cap ? resampleRing(out, cap) : out;
  }

  function resampleRing(ring, maxPoints) {
    if (!ring || ring.length <= maxPoints) return ring || [];
    var closed =
      ring.length >= 2 &&
      ring[0][0] === ring[ring.length - 1][0] &&
      ring[0][1] === ring[ring.length - 1][1];
    var body = closed ? ring.slice(0, -1) : ring.slice();
    if (body.length < 2) return ring;
    var cum = [0];
    var i;
    var nBody = body.length;
    var loop = closed ? nBody : nBody - 1;
    for (i = 0; i < loop; i++) {
      var a = body[i];
      var b = body[(i + 1) % nBody];
      var dx = b[0] - a[0];
      var dy = b[1] - a[1];
      cum.push(cum[cum.length - 1] + Math.sqrt(dx * dx + dy * dy));
    }
    var total = cum[cum.length - 1];
    if (total < 1e-12) return ring;
    var count = Math.max(3, maxPoints - (closed ? 1 : 0));
    var out = [];
    var j = 0;
    for (i = 0; i < count; i++) {
      var t = (i / count) * total;
      while (j < cum.length - 2 && cum[j + 1] < t) j++;
      var seg = cum[j + 1] - cum[j];
      var f = seg > 0 ? (t - cum[j]) / seg : 0;
      var p0 = body[j % nBody];
      var p1 = body[(j + 1) % nBody];
      out.push([p0[0] + (p1[0] - p0[0]) * f, p0[1] + (p1[1] - p0[1]) * f]);
    }
    if (closed) out.push([out[0][0], out[0][1]]);
    return out;
  }

  function buildWallPositions(map, maplibregl, feature) {
    if (!maplibregl || !feature) return null;
    var clip = root.__antiqueTerrainClip;
    if (!clip || !clip.enabled) return null;
    var gpuElev = projectGpuElevFn(map, maplibregl);
    var project = gpuElev;
    var unproject = mapUnprojectFn(map);
    var dropEst = clip.drop > 0 ? clip.drop : dropMetersForMap(map, feature);
    var loops = rimLoopsFromFeature(feature, gpuElev, unproject, {
      maxPx: RIM_STEP_PX,
      stepPx: RIM_STEP_PX,
      nudgePx: 0,
      extraProjects: [
        projectGpuFn(map, maplibregl, 0),
        projectGpuFn(map, maplibregl, 2500),
        projectElevFn(map),
        mapProjectFn(map),
        project3dFn(map, -dropEst * 0.35),
        project3dFn(map, -dropEst)
      ],
    });
    if (!loops.length) return null;
    var drop = clip.drop > 0 ? clip.drop : dropMetersForMap(map, feature);
    var positions = [];
    var dropSign = -1;
    function vert(mc, shade, water) {
      positions.push(mc.x, mc.y, mc.z, shade, water);
    }
    var r;
    for (r = 0; r < loops.length; r++) {
      var rings = skirtRingsFromLoop(loops[r]);
      var top = rings.top;
      // bottom ring uses probed overlay Z so alt-drop is visual void when
      // custom-layer mercator Z matches the mesh, and alt+drop when it does not.
      var samples = [];
      var i;
      for (i = 0; i < top.length; i++) {
        samples.push({
          lng: top[i][0],
          lat: top[i][1],
          alt: queryAlt(map, top[i][0], top[i][1], NaN),
          water: isRimWaterLngLat(top[i][0], top[i][1]) ? 1 : 0,
        });
      }
      fillSampleAlts(samples);
      if (r === 0) {
        for (i = 0; i < samples.length; i++) {
          if (isFinite(samples[i].lng) && isFinite(samples[i].lat) && isFinite(samples[i].alt)) {
            dropSign = overlayDropSign(
              map,
              maplibregl,
              samples[i].lng,
              samples[i].lat,
              samples[i].alt,
              drop
            );
            break;
          }
        }
      }
      for (i = 0; i < samples.length - 1; i++) {
        var a = samples[i];
        var b = samples[i + 1];
        if (!isFinite(a.lng) || !isFinite(a.lat) || Math.abs(a.lat) > 89) continue;
        if (!isFinite(b.lng) || !isFinite(b.lat) || Math.abs(b.lat) > 89) continue;
        var aTop;
        var aBot;
        var bTop;
        var bBot;
        try {
          // Sink the top ring toward the void so satellite covers the uv=0
          // gold lip. Bottom still follows the mesh drop (alt + drop * sign).
          var aTopAlt = a.alt + dropSign * OVERLAY_TOP_SINK_M;
          var bTopAlt = b.alt + dropSign * OVERLAY_TOP_SINK_M;
          aTop = maplibregl.MercatorCoordinate.fromLngLat([a.lng, a.lat], aTopAlt);
          aBot = maplibregl.MercatorCoordinate.fromLngLat([a.lng, a.lat], a.alt + drop * dropSign);
          bTop = maplibregl.MercatorCoordinate.fromLngLat([b.lng, b.lat], bTopAlt);
          bBot = maplibregl.MercatorCoordinate.fromLngLat([b.lng, b.lat], b.alt + drop * dropSign);
        } catch (eWall) {
          continue;
        }
        vert(aTop, OVERLAY_TOP_SHADE, a.water);
        vert(aBot, 1, a.water);
        vert(bTop, OVERLAY_TOP_SHADE, b.water);
        vert(aBot, 1, a.water);
        vert(bBot, 1, b.water);
        vert(bTop, OVERLAY_TOP_SHADE, b.water);
      }
    }
    if (positions.length) {
      var rimMeta = [];
      for (r = 0; r < loops.length; r++) {
        rimMeta.push({
          n: loops[r].length,
          maxStepPx: longestProjectedStepPx(loops[r], project),
          maxFlatPx: longestAxisAlignedFlatPx(loops[r], project),
        });
      }
      root.__FM44_LAST_RIM = {
        loops: rimMeta,
        drop: drop,
        dropSign: dropSign,
        topSinkM: OVERLAY_TOP_SINK_M,
        topShade: OVERLAY_TOP_SHADE,
        nudgePx: 0,
      };
      return { positions: new Float32Array(positions), drop: drop, stride: 5, loops: loops };
    }
    return null;
  }

  function compileProgram(gl, vsSrc, fsSrc, webgl2) {
    function sh(type, src) {
      var shader = gl.createShader(type);
      gl.shaderSource(shader, src);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        var log = gl.getShaderInfoLog(shader);
        gl.deleteShader(shader);
        throw new Error(log || 'shader compile');
      }
      return shader;
    }
    var vs = sh(gl.VERTEX_SHADER, vsSrc);
    var fs = sh(gl.FRAGMENT_SHADER, fsSrc);
    var prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(prog) || 'program link');
    }
    return prog;
  }

  function asFlat16(m) {
    if (!m) return null;
    var a;
    var i;
    if (m.length >= 16) {
      a = new Float32Array(16);
      for (i = 0; i < 16; i++) a[i] = m[i];
      return a;
    }
    if (typeof m === 'object' && m[0] != null) {
      a = new Float32Array(16);
      for (i = 0; i < 16; i++) {
        if (m[i] == null) return null;
        a[i] = m[i];
      }
      return a;
    }
    return null;
  }

  function extractMatrix(args) {
    if (!args) return null;
    // Same path as han-city-3d: custom layers supply mercator [0..1]
    // verts and MapStage v5 scales mainMatrix by EXTENT to match.
    if (args.defaultProjectionData) {
      var scaled =
        asFlat16(args.defaultProjectionData.mainMatrix) ||
        asFlat16(args.defaultProjectionData.projectionMatrix);
      if (scaled) return scaled;
    }
    return asFlat16(args.modelViewProjectionMatrix) || asFlat16(args.projectionMatrix) || asFlat16(args);
  }

  function hexToRgba(hex, a) {
    var h = String(hex || '#c4b49a').replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    if (!isFinite(n)) n = 0xc4b49a;
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, a == null ? 1 : a];
  }

  function createWallLayer(maplibregl) {
    var state = {
      map: null,
      gl: null,
      prog: null,
      buf: null,
      count: 0,
      loc: null,
    };
    var strataBody = 'vec3 c=vec3(109.0,74.0,54.0)/255.0;';

    return {
      id: WALL_LAYER_ID,
      type: 'custom',
      renderingMode: '3d',
      onAdd: function (map, gl) {
        state.map = map;
        state.gl = gl;
        var webgl2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
        var vs = webgl2
          ? '#version 300 es\nin vec3 a_pos;in float a_shade;in float a_water;uniform mat4 u_matrix;out highp float v_shade_w;out highp float v_clip_w;out float v_water;out vec2 v_mercator;void main(){gl_Position=u_matrix*vec4(a_pos,1.0);v_shade_w=a_shade*gl_Position.w;v_clip_w=gl_Position.w;v_water=a_water;v_mercator=a_pos.xy;}'
          : 'attribute vec3 a_pos;attribute float a_shade;attribute float a_water;uniform mat4 u_matrix;varying highp float v_shade_w;varying highp float v_clip_w;varying float v_water;varying vec2 v_mercator;void main(){gl_Position=u_matrix*vec4(a_pos,1.0);v_shade_w=a_shade*gl_Position.w;v_clip_w=gl_Position.w;v_water=a_water;v_mercator=a_pos.xy;}';
        var fs = webgl2
          ? '#version 300 es\nprecision mediump float;in highp float v_shade_w;in highp float v_clip_w;in float v_water;in vec2 v_mercator;out vec4 fragColor;void main(){' +
            strataBody +
            'fragColor=vec4(c,1.0);}'
          : 'precision mediump float;varying highp float v_shade_w;varying highp float v_clip_w;varying float v_water;varying vec2 v_mercator;void main(){' +
            strataBody +
            'gl_FragColor=vec4(c,1.0);}';
        state.prog = compileProgram(gl, vs, fs, webgl2);
        state.loc = {
          pos: gl.getAttribLocation(state.prog, 'a_pos'),
          shade: gl.getAttribLocation(state.prog, 'a_shade'),
          water: gl.getAttribLocation(state.prog, 'a_water'),
          matrix: gl.getUniformLocation(state.prog, 'u_matrix'),
        };
        state.buf = gl.createBuffer();
        if (typeof gl.createVertexArray === 'function') state.vao = gl.createVertexArray();
        state.draws = 0;
      },
      onRemove: function () {
        var gl = state.gl;
        if (gl && state.vao) gl.deleteVertexArray(state.vao);
        if (gl && state.buf) gl.deleteBuffer(state.buf);
        if (gl && state.prog) gl.deleteProgram(state.prog);
        state.vao = null;
        state.buf = null;
        state.prog = null;
        state.map = null;
        state.gl = null;
      },
      setGeometry: function (positions) {
        var gl = state.gl;
        if (!gl || !state.buf) return;
        state.count = positions ? positions.length / 5 : 0;
        state.sample = positions && positions.length >= 3 ? [positions[0], positions[1], positions[2]] : null;
        if (state.vao) gl.bindVertexArray(state.vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, state.buf);
        gl.bufferData(gl.ARRAY_BUFFER, positions || new Float32Array(0), gl.STATIC_DRAW);
        if (state.vao) gl.bindVertexArray(null);
      },
      setColor: function () {},
      render: function (gl, args) {
        if (!state.prog || state.count < 3) return;
        var mat = extractMatrix(args);
        if (!mat) return;
        gl.useProgram(state.prog);
        if (state.vao) gl.bindVertexArray(state.vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, state.buf);
        gl.enableVertexAttribArray(state.loc.pos);
        gl.vertexAttribPointer(state.loc.pos, 3, gl.FLOAT, false, 20, 0);
        if (state.loc.shade >= 0) {
          gl.enableVertexAttribArray(state.loc.shade);
          gl.vertexAttribPointer(state.loc.shade, 1, gl.FLOAT, false, 20, 12);
        }
        if (state.loc.water >= 0) {
          gl.enableVertexAttribArray(state.loc.water);
          gl.vertexAttribPointer(state.loc.water, 1, gl.FLOAT, false, 20, 16);
        }
        gl.uniformMatrix4fv(state.loc.matrix, false, mat);
        if (state.sample) {
          var sx = state.sample[0];
          var sy = state.sample[1];
          var sz = state.sample[2];
          var cw = mat[3] * sx + mat[7] * sy + mat[11] * sz + mat[15];
          state.ndc = cw
            ? [
                (mat[0] * sx + mat[4] * sy + mat[8] * sz + mat[12]) / cw,
                (mat[1] * sx + mat[5] * sy + mat[9] * sz + mat[13]) / cw,
                cw,
              ]
            : null;
        }
        state.draws = (state.draws || 0) + 1;
        state.lastMatrix = mat;
        // Clip-space Z already matches mesh ele-drop (alt-drop is toward -ndcY).
        // Depth was off, so a 25km drop painted over the island and read as a
        // crown. Read terrain depth; do not write it (labels still composite).
        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LEQUAL);
        gl.depthMask(false);
        gl.disable(gl.STENCIL_TEST);
        gl.disable(gl.BLEND);
        gl.disable(gl.CULL_FACE);
        gl.drawArrays(gl.TRIANGLES, 0, state.count);
        if (state.vao) gl.bindVertexArray(null);
        gl.enable(gl.DEPTH_TEST);
        gl.depthMask(true);
        gl.disableVertexAttribArray(state.loc.pos);
        if (state.loc.shade >= 0) gl.disableVertexAttribArray(state.loc.shade);
        if (state.loc.water >= 0) gl.disableVertexAttribArray(state.loc.water);
      },
      debugDraw: function () {
        return {
          count: state.count,
          draws: state.draws || 0,
          ndc: state.ndc || null,
          sample: state.sample || null,
          hasVao: !!state.vao,
          hasProg: !!state.prog,
          hasMatrix: !!state.lastMatrix,
        };
      },
      get lastMatrix() {
        return state.lastMatrix || null;
      },
    };
  }

  function ensureClipState() {
    if (!root.__antiqueTerrainClip) {
      root.__antiqueTerrainClip = {
        enabled: false,
        texture: null,
        origin: [0, 0],
        size: [1, 1],
        merc: null,
        filterTiles: filterTiles,
      };
    }
    return root.__antiqueTerrainClip;
  }

  function getMapGl(map) {
    try {
      if (map && map.painter && map.painter.context && map.painter.context.gl) {
        return map.painter.context.gl;
      }
    } catch (e) {
      /* ignore */
    }
    try {
      var canvas = map && map.getCanvas && map.getCanvas();
      if (!canvas) return null;
      return canvas.getContext('webgl2') || canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    } catch (e2) {
      return null;
    }
  }

  function destroyTexture(map, tex) {
    try {
      var gl = getMapGl(map);
      if (gl && tex) gl.deleteTexture(tex);
    } catch (e) {
      /* ignore */
    }
  }

  var MESH_DEFAULT = 128;
  // Keep island mesh on the official 128 grid. 256 densifies T-junctions
  // against parent tiles and reopens mercator-row cracks under clip.
  var MESH_ISLAND = 128;

  function syncIslandMesh(map, on) {
    try {
      var terr = mapTerrain(map);
      if (!terr) return;
      var next = on ? MESH_ISLAND : MESH_DEFAULT;
      if (terr.meshSize === next && terr._meshCache && Object.keys(terr._meshCache).length) return;
      terr.meshSize = next;
      terr._meshCache = {};
    } catch (e3) {
      /* ignore */
    }
  }

  function setClip(map, feature, opts) {
    opts = opts || {};
    var clip = ensureClipState();
    var patched = !!root.__ANTIQUE_TERRAIN_CLIP_PATCH;
    if (!map || !patched) {
      clip.enabled = false;
      return { ok: false, reason: patched ? 'no-map' : 'unpatched-maplibre' };
    }
    var api = root.REGION_ISOLATE;
    var feat = feature && api && api.narrativeFeature ? api.narrativeFeature(feature) : feature;
    if (!feat) {
      clip.enabled = false;
      destroyTexture(map, clip.texture);
      clip.texture = null;
      clip.merc = null;
      clip._key = '';
      clip._size = null;
      clip._image = null;
      syncIslandMesh(map, false);
      if (map.triggerRepaint) map.triggerRepaint();
      return { ok: true, enabled: false };
    }
    var merc = clipMercatorBbox(map, feat);
    if (!merc) {
      clip.enabled = false;
      return { ok: false, reason: 'bbox' };
    }
    var gl = getMapGl(map);
    if (!gl) {
      clip.enabled = false;
      return { ok: false, reason: 'no-gl' };
    }
    var key =
      merc.x0.toFixed(6) +
      ',' +
      merc.y0.toFixed(6) +
      ',' +
      merc.x1.toFixed(6) +
      ',' +
      merc.y1.toFixed(6);
    var drop = dropMetersForMap(map, feat);
    if (!opts.force && clip.enabled && clip.texture && clip._key === key) {
      syncIslandMesh(map, true);
      if (clip.drop !== drop) {
        clip.drop = drop;
        if (map.triggerRepaint) map.triggerRepaint();
      }
      return { ok: true, enabled: true, skipped: true, size: clip._size || [0, 0], drop: drop };
    }
    var image = rasterizeClip(feat, merc);
    var prev = clip.texture;
    clip.texture = uploadTexture(gl, image);
    destroyTexture(map, prev);
    clip.origin = [merc.x0, merc.y0];
    clip.size = [merc.x1 - merc.x0, merc.y1 - merc.y0];
    clip.merc = merc;
    clip._key = key;
    clip._size = [image.width, image.height];
    clip._image = image;
    clip.drop = drop;
    clip.enabled = true;
    syncIslandMesh(map, true);
    if (map.triggerRepaint) map.triggerRepaint();
    return { ok: true, enabled: true, size: [image.width, image.height], drop: drop };
  }

  function islandSky() {
    return {
      'sky-color': VOID,
      'horizon-color': VOID,
      'fog-color': VOID,
      'sky-horizon-blend': 0,
      'horizon-fog-blend': 1,
      'fog-ground-blend': 1,
    };
  }

  function clearClip(map) {
    return setClip(map, null);
  }

  function removeWallLayer(map) {
    var impl = map.__antiqueIslandWalls;
    if (impl || (map.getLayer && map.getLayer(WALL_LAYER_ID))) {
      try {
        if (map.removeLayer) map.removeLayer(WALL_LAYER_ID);
      } catch (e0) {
        /* ignore */
      }
      map.__antiqueIslandWalls = null;
    }
  }

  function syncWalls(map, maplibregl, feature, color) {
    if (!map || !map.addLayer) return;
    // Terrain mixed-floor discard stays (FM-0902-23). Visible rim is the
    // patched mesh drop-down; bottom = top dropped. Overlay walls sat on
    // the block top as a pale fence (FM-0903-14) — do not add
    // region-island-walls for isolate. Overlay geometry helpers stay
    // exported for unit tests. Do not snap this loop onto a pixel/mesh grid or collinear-merge it.
    void feature;
    void color;
    var had =
      !!map.__antiqueIslandWalls ||
      (typeof map.getLayer === 'function' && !!map.getLayer(WALL_LAYER_ID));
    removeWallLayer(map);
    if (had && map.triggerRepaint) map.triggerRepaint();
  }

  root.AntiqueTerrainIsland = {
    WALL_LAYER_ID: WALL_LAYER_ID,
    WALL_MAX_POINTS: WALL_MAX_POINTS,
    RIM_STEP_PX: RIM_STEP_PX,
    RIM_MAX_FLAT_PX: RIM_MAX_FLAT_PX,
    RIM_NUDGE_PX: RIM_NUDGE_PX,
    OVERLAY_TOP_SINK_M: OVERLAY_TOP_SINK_M,
    OVERLAY_TOP_SHADE: OVERLAY_TOP_SHADE,
    roundCornerArcs: roundCornerArcs,
    densifyProjected: densifyProjected,
    buildRimLoop: buildRimLoop,
    rimLoopsFromFeature: rimLoopsFromFeature,
    skirtRingsFromLoop: skirtRingsFromLoop,
    longestProjectedStepPx: longestProjectedStepPx,
    longestAxisAlignedFlatPx: longestAxisAlignedFlatPx,
    lngLatToMercator: lngLatToMercator,
    mercatorToLngLat: mercatorToLngLat,
    mercatorBbox: mercatorBbox,
    featureFitsClipTexture: featureFitsClipTexture,
    CLIP_MAX: CLIP_MAX,
    sampleClipAtMerc: sampleClipAtMerc,
    meshCrossingsFromGrid: meshCrossingsFromGrid,
    clipMercatorBbox: clipMercatorBbox,
    tileIntersectsMerc: tileIntersectsMerc,
    tileHitsClip: tileHitsClip,
    filterTiles: filterTiles,
    rasterizeClip: rasterizeClip,
    paintClipWater: paintClipWater,
    inChinaSeas: inChinaSeas,
    isRimWaterLngLat: isRimWaterLngLat,
    strataUv: strataUv,
    strataRgb: strataRgb,
    isBlueGrayRgb: isBlueGrayRgb,
    classifyWallRgb: classifyWallRgb,
    affineWallUv: affineWallUv,
    rasterWallColumn: rasterWallColumn,
    STRATA_WATER: STRATA_WATER,
    STRATA_LAND: STRATA_LAND,
    STRATA_LINE: STRATA_LINE,
    densifyRing: densifyRing,
    capRing: capRing,
    wallStepDegForZoom: wallStepDegForZoom,
    wallStepDegForMap: wallStepDegForMap,
    featureKmDiag: featureKmDiag,
    ringWallRuns: ringWallRuns,
    sliceRingToView: sliceRingToView,
    sliceRingRuns: sliceRingRuns,
    wallSkirt: wallSkirt,
    wallSlab: wallSlab,
    fillSampleAlts: fillSampleAlts,
    overlayDropSignFromMatrix: overlayDropSignFromMatrix,
    overlayDropSign: overlayDropSign,
    buildWallPositions: buildWallPositions,
    setClip: setClip,
    dropMetersForMap: dropMetersForMap,
    clearClip: clearClip,
    islandSky: islandSky,
    PAPER: PAPER,
    VOID: VOID,
    WALL_COLOR: WALL_COLOR,
    WALL_COLOR_TOP: WALL_COLOR_TOP,
    WALL_COLOR_BOT: WALL_COLOR_BOT,
    syncWalls: syncWalls,
    patched: function () {
      return !!root.__ANTIQUE_TERRAIN_CLIP_PATCH;
    },
  };
  ensureClipState();
})(typeof window !== 'undefined' ? window : globalThis);
