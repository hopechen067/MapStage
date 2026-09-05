/**
 * Antique MapLibre runtime FX — terrain rise, tile idle/precache, camera.
 * Tuner and HyperFrames production pages share this file.
 *
 * Browser: window.AntiqueMapFx
 * Node:    module.exports
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (root) root.AntiqueMapFx = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var QUANTIZE = 0.05;
  var L3_LAYER = 'river-l3';

  function quantizeTerrain(value) {
    var v = Number(value);
    if (!isFinite(v)) v = 0;
    v = Math.max(0, v);
    return Number((Math.round(v / QUANTIZE) * QUANTIZE).toFixed(2));
  }

  /**
   * LOD cap: wide shots may use 1.2–1.6; close / steep pitch must stay ≤ 0.8.
   */
  function budgetTerrainEx(requested, zoom, pitch) {
    var z = Number(zoom);
    var p = Number(pitch);
    if (!isFinite(z)) z = 0;
    if (!isFinite(p)) p = 0;
    var cap = 1.6;
    if (z >= 8 || p >= 50) cap = 0.8;
    else if (z >= 6) cap = 1.2;
    return quantizeTerrain(Math.min(Number(requested) || 0, cap));
  }

  function cameraToOpts(camera) {
    camera = camera || {};
    var opts = {};
    if (camera.center) opts.center = camera.center.slice ? camera.center.slice() : camera.center;
    if (camera.zoom != null) opts.zoom = camera.zoom;
    if (camera.pitch != null) opts.pitch = camera.pitch;
    if (camera.bearing != null) opts.bearing = camera.bearing;
    return opts;
  }

  function readView(map) {
    var c = map.getCenter();
    return {
      center: [c.lng, c.lat],
      zoom: map.getZoom(),
      pitch: map.getPitch(),
      bearing: map.getBearing(),
    };
  }

  function omitUndefined(obj) {
    var out = {};
    Object.keys(obj).forEach(function (k) {
      if (obj[k] !== undefined) out[k] = obj[k];
    });
    return out;
  }

  var PARALLEL_IMAGE_REQUESTS = 32;
  var LOD_LABELS_CLASS = 'antique-lod-labels';

  function configureMapLibre(maplibregl, opts) {
    if (!maplibregl) return;
    opts = opts || {};
    var requestedImages = Number(opts.maxParallelImageRequests);
    var imageRequests =
      isFinite(requestedImages) && requestedImages > 0
        ? Math.round(requestedImages)
        : PARALLEL_IMAGE_REQUESTS;
    if (typeof maplibregl.setMaxParallelImageRequests === 'function') {
      maplibregl.setMaxParallelImageRequests(imageRequests);
    }
    if (typeof maplibregl.setWorkerCount === 'function') {
      var cur =
        typeof maplibregl.getWorkerCount === 'function' ? maplibregl.getWorkerCount() : 0;
      var requestedWorkers = Number(opts.workerCount);
      var explicitWorkers = isFinite(requestedWorkers) && requestedWorkers > 0;
      var cores =
        typeof navigator !== 'undefined' && navigator.hardwareConcurrency
          ? navigator.hardwareConcurrency
          : 4;
      // 大体积 GeoJSON(水系 7.6MB)解析在 worker 池;0.75 核上限 6
      var want = explicitWorkers
        ? Math.round(requestedWorkers)
        : Math.max(2, Math.min(6, Math.floor(cores * 0.75)));
      if (!cur || (explicitWorkers ? cur !== want : cur < want)) {
        try {
          maplibregl.setWorkerCount(want);
        } catch (e) {
          /* setWorkerCount is a no-op after the first Map() */
        }
      }
    }
  }

  function mapOptions(mode) {
    var record = mode === 'record';
    return omitUndefined({
      fadeDuration: record ? 0 : 300,
      maxTileCacheZoomLevels: 12,
      refreshExpiredTiles: false,
      cancelPendingTileRequestsWhileZooming: true,
      collectResourceTiming: false,
      pixelRatio: record ? 1 : undefined,
      validateStyle: !record,
      renderWorldCopies: false,
      canvasContextAttributes: {
        powerPreference: 'high-performance',
      },
    });
  }

  function applyRasterFadeDuration(style, duration) {
    if (!style || !Array.isArray(style.layers)) return style;
    if (duration == null) duration = 0;
    for (var i = 0; i < style.layers.length; i++) {
      var layer = style.layers[i];
      if (layer && layer.type === 'raster') {
        layer.paint = layer.paint || {};
        layer.paint['raster-fade-duration'] = duration;
      }
    }
    return style;
  }

  function antiqueSky() {
    return {
      'sky-color': '#000000',
      'horizon-color': '#000000',
      'fog-color': '#000000',
      'sky-horizon-blend': 0.85,
      'horizon-fog-blend': 0.9,
      'fog-ground-blend': 0.45,
    };
  }

  /**
   * Put 3D terrain + sky on the style before `new Map()`. setTerrain after load
   * is not enough: pitched views otherwise look like a tilted 2D postcard.
   */
  function enableStyleTerrain(style, opts) {
    opts = opts || {};
    if (!style || !opts.sourceId) return style;
    style.terrain = {
      source: opts.sourceId,
      exaggeration: opts.exaggeration != null ? opts.exaggeration : 1.6,
    };
    if (opts.sky !== false) {
      style.sky = antiqueSky();
    }
    return style;
  }

  function createMap(maplibregl, opts) {
    opts = opts || {};
    var mode = opts.mode || 'tuner';
    var camera = opts.camera || {};
    var style = opts.style;
    applyRasterFadeDuration(style, 0);
    if (opts.terrain && opts.terrain.sourceId) {
      enableStyleTerrain(style, opts.terrain);
    }
    var base = {
      container: opts.container,
      style: style,
      center: camera.center,
      zoom: camera.zoom,
      pitch: camera.pitch || 0,
      bearing: camera.bearing || 0,
      maxPitch: opts.maxPitch != null ? opts.maxPitch : 85,
      attributionControl: opts.attributionControl !== false,
    };
    configureMapLibre(maplibregl, opts.runtimeOptions);
    var map = new maplibregl.Map(
      Object.assign(base, mapOptions(mode), opts.mapOptions || {})
    );
    map.__antiqueSetTerrainCount = 0;
    map.__antiqueMotionGen = 0;
    map.__antiqueMotionLod = false;
    if (opts.terrain && opts.terrain.sourceId) {
      map.__antiqueTerrain = {
        sourceId: opts.terrain.sourceId,
        ex: quantizeTerrain(
          opts.terrain.exaggeration != null ? opts.terrain.exaggeration : 1.6
        ),
      };
      map.__antiqueSetTerrainCount = 1;
    }
    return map;
  }

  function _applied(map) {
    if (!map.__antiqueTerrain) map.__antiqueTerrain = { sourceId: null, ex: NaN };
    return map.__antiqueTerrain;
  }

  /**
   * Write exact exaggeration (already quantized). Skip MapLibre setTerrain if unchanged.
   */
  function applyTerrainExact(map, sourceId, exactEx) {
    var ex = quantizeTerrain(exactEx);
    var slot = _applied(map);
    var cur = typeof map.getTerrain === 'function' ? map.getTerrain() : null;
    if (
      slot.sourceId === sourceId &&
      slot.ex === ex &&
      cur &&
      cur.source === sourceId &&
      quantizeTerrain(cur.exaggeration) === ex
    ) {
      return ex;
    }
    map.setTerrain({ source: sourceId, exaggeration: ex });
    slot.sourceId = sourceId;
    slot.ex = ex;
    map.__antiqueSetTerrainCount = (map.__antiqueSetTerrainCount || 0) + 1;
    return ex;
  }

  function flattenTerrain(map) {
    var slot = _applied(map);
    var cur = typeof map.getTerrain === 'function' ? map.getTerrain() : null;
    if (!cur && slot.sourceId == null && slot.ex === 0) return 0;
    map.setTerrain(null);
    slot.sourceId = null;
    slot.ex = 0;
    map.__antiqueSetTerrainCount = (map.__antiqueSetTerrainCount || 0) + 1;
    return 0;
  }

  function setTerrainEx(map, sourceId, requested, view) {
    view = view || {};
    var ex;
    if (view.budget === false) {
      ex = quantizeTerrain(requested);
    } else {
      var zoom = view.zoom != null ? view.zoom : map.getZoom();
      var pitch = view.pitch != null ? view.pitch : map.getPitch();
      ex = budgetTerrainEx(requested, zoom, pitch);
    }
    return applyTerrainExact(map, sourceId, ex);
  }

  function waitIdle(map, opts) {
    opts = opts || {};
    var timeoutMs = opts.timeoutMs != null ? opts.timeoutMs : 12000;
    return new Promise(function (resolve) {
      var settled = false;
      function finish(ok, reason) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          map.off('idle', onIdle);
        } catch (e) {
          /* ignore */
        }
        if (!ok) {
          console.warn('[antique-map-fx] waitIdle timeout', timeoutMs);
        }
        resolve({ ok: ok, reason: reason || (ok ? 'idle' : 'timeout') });
      }
      function onIdle() {
        finish(true, 'idle');
      }
      var loaded = typeof map.loaded === 'function' ? map.loaded() : true;
      var tiles =
        typeof map.areTilesLoaded === 'function' ? map.areTilesLoaded() : true;
      if (!opts.force && loaded && tiles) {
        finish(true, 'already');
        return;
      }
      var timer = setTimeout(function () {
        finish(false, 'timeout');
      }, timeoutMs);
      map.once('idle', onIdle);
      if (opts.force) {
        setTimeout(function () {
          var ready =
            (typeof map.loaded !== 'function' || map.loaded()) &&
            (typeof map.areTilesLoaded !== 'function' || map.areTilesLoaded());
          if (ready) finish(true, 'forced-already');
        }, 80);
      }
    });
  }

  function jumpTo(map, camera) {
    map.jumpTo(cameraToOpts(camera));
  }

  function setMotionLod(map, moving, opts) {
    opts = opts || {};
    var l3 = opts.l3LayerId || L3_LAYER;
    moving = !!moving;
    map.__antiqueMotionLod = moving;
    if (typeof map.getLayer === 'function' && map.getLayer(l3)) {
      if (moving) {
        try {
          map.__antiqueL3Vis = map.getLayoutProperty(l3, 'visibility') || 'visible';
          map.setLayoutProperty(l3, 'visibility', 'none');
        } catch (e) {
          /* ignore */
        }
      } else if (map.__antiqueL3Vis != null) {
        try {
          map.setLayoutProperty(l3, 'visibility', map.__antiqueL3Vis);
        } catch (e2) {
          /* ignore */
        }
      }
    }
    try {
      var el = typeof map.getContainer === 'function' ? map.getContainer() : null;
      if (el && el.classList) {
        if (moving) el.classList.add(LOD_LABELS_CLASS);
        else el.classList.remove(LOD_LABELS_CLASS);
      }
    } catch (e3) {
      /* ignore */
    }
    if (typeof opts.onChange === 'function') opts.onChange(moving);
  }

  function easeToCamera(map, camera, duration, lodOpts) {
    if (typeof map.stop === 'function') map.stop();
    var gen = (map.__antiqueMotionGen = (map.__antiqueMotionGen || 0) + 1);
    setMotionLod(map, true, lodOpts);
    map.easeTo(
      Object.assign({ duration: duration != null ? duration : 900 }, cameraToOpts(camera))
    );
    map.once('moveend', function () {
      if (map.__antiqueMotionGen !== gen) return;
      setMotionLod(map, false, lodOpts);
    });
  }

  function applyCamera(map, camera, opts) {
    opts = opts || {};
    if (opts.animate) {
      easeToCamera(map, camera, opts.duration, opts.lod);
    } else {
      if (typeof map.stop === 'function') map.stop();
      jumpTo(map, camera);
    }
  }

  function precacheViewports(map, cameras, opts) {
    opts = opts || {};
    var list = cameras || [];
    var restore = opts.restore !== false;
    var timeoutMs = opts.timeoutMs != null ? opts.timeoutMs : 15000;
    var origin = readView(map);
    var i = 0;
    function step() {
      if (i >= list.length) {
        if (!restore) {
          return Promise.resolve({ count: list.length, restored: false });
        }
        jumpTo(map, origin);
        return waitIdle(map, { timeoutMs: timeoutMs, force: true }).then(function () {
          return { count: list.length, restored: true };
        });
      }
      jumpTo(map, list[i]);
      i += 1;
      return waitIdle(map, { timeoutMs: timeoutMs, force: true }).then(step);
    }
    return Promise.resolve().then(step);
  }

  function samplePath(fromCam, toCam, n) {
    n = Math.max(2, n || 8);
    var out = [];
    var i;
    for (i = 0; i < n; i++) {
      var t = i / (n - 1);
      out.push({
        center: [
          fromCam.center[0] + (toCam.center[0] - fromCam.center[0]) * t,
          fromCam.center[1] + (toCam.center[1] - fromCam.center[1]) * t,
        ],
        zoom: fromCam.zoom + (toCam.zoom - fromCam.zoom) * t,
        pitch: (fromCam.pitch || 0) + ((toCam.pitch || 0) - (fromCam.pitch || 0)) * t,
        bearing:
          (fromCam.bearing || 0) + ((toCam.bearing || 0) - (fromCam.bearing || 0)) * t,
      });
    }
    return out;
  }

  /**
   * Pace terrainRise on a clock. Do not wait for MapLibre `render`:
   * a slow DEM tile paint would freeze exaggeration at ~0.1 while the user stares at a plane.
   */
  function waitPaint(map, ms) {
    ms = ms != null ? ms : 50;
    return new Promise(function (resolve) {
      if (typeof map.triggerRepaint === 'function') {
        try {
          map.triggerRepaint();
        } catch (e) {
          /* ignore */
        }
      }
      setTimeout(resolve, Math.max(0, ms));
    });
  }

  function terrainRise(map, opts) {
    opts = opts || {};
    var sourceId = opts.sourceId || 'terrain';
    var from = opts.from != null ? opts.from : 0;
    var to = opts.to != null ? opts.to : 1.6;
    var durationMs = opts.durationMs != null ? opts.durationMs : 1800;
    var shouldWait = opts.waitIdle !== false;
    var gen = (map.__antiqueRiseGen = (map.__antiqueRiseGen || 0) + 1);

    function aborted() {
      return map.__antiqueRiseGen !== gen;
    }

    function run() {
      var zoom = map.getZoom();
      var pitch = map.getPitch();
      var target =
        opts.budget === false ? quantizeTerrain(to) : budgetTerrainEx(to, zoom, pitch);
      var startEx = quantizeTerrain(from);
      var stepWait = opts.useTimeout
        ? 0
        : (opts.stepMs != null ? opts.stepMs : Math.max(50, Math.round(durationMs / 16)));

      function notify(ex, t) {
        if (typeof opts.onStep !== 'function') return;
        try {
          opts.onStep(ex, t);
        } catch (e) {
          console.warn('[antique-map-fx] onStep', e);
        }
      }

      applyTerrainExact(map, sourceId, startEx);
      notify(startEx, 0);

      if (durationMs <= 0 || startEx === target) {
        applyTerrainExact(map, sourceId, target);
        notify(target, 1);
        return Promise.resolve({ from: startEx, to: target, steps: 1, aborted: false });
      }

      var span = Math.abs(target - startEx);
      var maxByQ = Math.max(2, Math.round(span / QUANTIZE));
      var byTime = Math.max(8, Math.round(durationMs / 100));
      // 每步 setTerrain 都触发地形网格重算;maxSteps 用更少但等时的步数
      // 达到同样时长,隆起观感不变而网格重算次数按比例减少
      var stepCap = opts.maxSteps != null && opts.maxSteps >= 2 ? Math.round(opts.maxSteps) : 20;
      var n = Math.max(2, Math.min(maxByQ, byTime, stepCap));
      var last = startEx;
      var steps = 1;
      var i = 1;

      function next() {
        if (aborted()) {
          return { from: startEx, to: last, steps: steps, aborted: true };
        }
        if (i > n) {
          applyTerrainExact(map, sourceId, target);
          notify(target, 1);
          return { from: startEx, to: target, steps: steps, aborted: false };
        }
        var t = i / n;
        var q = quantizeTerrain(startEx + (target - startEx) * t);
        i += 1;
        if (q === last) return next();
        last = q;
        steps += 1;
        applyTerrainExact(map, sourceId, q);
        notify(q, t);
        return waitPaint(map, stepWait).then(next);
      }

      return waitPaint(map, stepWait).then(next);
    }

    if (!shouldWait) return run();
    return waitIdle(map, { timeoutMs: opts.timeoutMs }).then(function () {
      if (aborted()) return { from: from, to: to, steps: 0, aborted: true };
      return run();
    });
  }

  function featureBbox(featureOrGeom) {
    var geom = featureOrGeom;
    if (geom && geom.type === 'Feature') geom = geom.geometry;
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

  /**
   * Pitched camera that frames an isolate polygon (country / province / city).
   */
  function reliefCameraForFeature(map, feature, opts) {
    opts = opts || {};
    if (!map || typeof map.cameraForBounds !== 'function') return null;
    var box = featureBbox(feature);
    if (!box) return null;
    var span = Math.max(box[2] - box[0], box[3] - box[1]);
    var pitch = 62;
    var maxZoom = 12;
    if (span >= 15) {
      pitch = 48;
      maxZoom = 6.2;
    } else if (span >= 4) {
      pitch = 58;
      maxZoom = 9.5;
    } else {
      pitch = 66;
      maxZoom = 12;
    }
    if (opts.pitch != null) pitch = opts.pitch;
    if (opts.maxZoom != null) maxZoom = opts.maxZoom;
    var fitted = map.cameraForBounds(
      [
        [box[0], box[1]],
        [box[2], box[3]],
      ],
      {
        padding: opts.padding != null ? opts.padding : 80,
        maxZoom: maxZoom,
        pitch: pitch,
        bearing: opts.bearing != null ? opts.bearing : 12,
      }
    );
    if (!fitted) return null;
    var c = fitted.center;
    var center = c && typeof c.lng === 'number' ? [c.lng, c.lat] : c;
    if (!center) return null;
    return {
      center: center,
      zoom: fitted.zoom,
      pitch: fitted.pitch != null ? fitted.pitch : pitch,
      bearing: fitted.bearing != null ? fitted.bearing : 12,
    };
  }

  function setCityContinuousRepaint(layer, on) {
    if (!layer || typeof layer.setContinuousRepaint !== 'function') return false;
    layer.setContinuousRepaint(!!on);
    return true;
  }

  return {
    QUANTIZE: QUANTIZE,
    quantizeTerrain: quantizeTerrain,
    budgetTerrainEx: budgetTerrainEx,
    mapOptions: mapOptions,
    configureMapLibre: configureMapLibre,
    applyRasterFadeDuration: applyRasterFadeDuration,
    createMap: createMap,
    createAntiqueMap: createMap,
    enableStyleTerrain: enableStyleTerrain,
    antiqueSky: antiqueSky,
    applyTerrainExact: applyTerrainExact,
    setTerrainEx: setTerrainEx,
    flattenTerrain: flattenTerrain,
    featureBbox: featureBbox,
    reliefCameraForFeature: reliefCameraForFeature,
    terrainRise: terrainRise,
    waitIdle: waitIdle,
    waitPaint: waitPaint,
    jumpTo: jumpTo,
    easeToCamera: easeToCamera,
    applyCamera: applyCamera,
    setMotionLod: setMotionLod,
    precacheViewports: precacheViewports,
    samplePath: samplePath,
    setCityContinuousRepaint: setCityContinuousRepaint,
    readView: readView,
    cameraToOpts: cameraToOpts,
  };
});
