/**
 * Studio 矢量配色：皮肤、海拔设色（色阶）、图层颜色、等高线。
 *
 * 纯函数部分（Node 可测）负责：当前生效的 paint、色值行、底图图层 / 数据源拼装。
 * 浏览器部分 mount(ctx) 负责面板渲染与往地图上写。参数存在 params.vector，
 * 由 tuner-params.js 校验；本文件不碰 localStorage。
 *
 * 合规：Studio 不加载 vl-boundary / vl-boundary-province，也不提供国界、省界色值。
 *
 * Browser: window.AntiqueTunerVector
 * Node:    module.exports
 */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.AntiqueTunerVector = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  /** 面板不暴露的色值：境界线不画；建筑图层 Studio 不加载；其余水系色由「水系配色」驱动 */
  var SKIP_COLOR_KEYS = {
    boundary: true,
    boundaryProvince: true,
    building: true,
    water: true,
    waterRiver: true,
    waterPond: true,
    waterway: true,
    waterwayStream: true,
    waterwayCanal: true,
    waterwayDrain: true,
  };

  var RELIEF_ID = 'vl-relief';

  /**
   * 夜景灯光：不用卫星夜光图，全由 OpenFreeMap 矢量合成。
   * 地名点 → 城市光晕（heatmap，城 > 镇 > 村）；居民 / 商业用地 → 暖色灯区；干道 → 发光线。
   * 压在山影与水路之上（灯光不受山影明暗）。
   */
  var LIGHT_IDS = ['vl-lights-urban', 'vl-lights-roads', 'vl-lights-glow'];

  /** 有真实夜光栅格时，矢量光晕只在近景补细节（远景交给栅格） */
  function glowOpacity(nightRaster) {
    return nightRaster ? ['interpolate', ['linear'], ['zoom'], 5, 0, 7, 0.4, 9, 0.75] : 0.9;
  }

  /**
   * 夜光底图。数据源由 map-tiles.config 的 nightLights 决定：
   *   image + bounds：已是墨卡托的图（默认 = 自制夜光，scripts/bake-night-lights.mjs 由 GeoNames 居民点烘焙，带透明）；
   *   image 不带 bounds：等经纬（equirectangular）全球图，浏览器里重投影成墨卡托（如 NASA 低清城市灯光）；
   *   tiles：XYZ 栅格瓦片（如 NASA GIBS VIIRS_Black_Marble，maxzoom 8）。tiles 优先。
   */
  var NIGHT_SOURCE_ID = 'nightLights';
  var NIGHT_LAYER_ID = 'night-lights';
  var MERC_MAX_LAT = 85.0511287798066;
  var DEFAULT_NIGHT_IMAGE = 'assets/night-lights.png';
  var DEFAULT_NIGHT_BOUNDS = [60, -2, 150, 56];

  function resolveNightConfig(input) {
    if (input === false) return null;
    var c = input && typeof input === 'object' ? input : {};
    if (c.enabled === false) return null;
    var tiles = Array.isArray(c.tiles)
      ? c.tiles.filter(function (u) { return typeof u === 'string' && u.length > 0; })
      : [];
    var custom = typeof c.image === 'string' && c.image;
    var bounds = Array.isArray(c.bounds) && c.bounds.length === 4 && c.bounds.every(isFinite)
      ? c.bounds.map(Number)
      : (custom ? null : DEFAULT_NIGHT_BOUNDS);
    return {
      tiles: tiles,
      image: tiles.length ? '' : (custom ? c.image : DEFAULT_NIGHT_IMAGE),
      // bounds = 已是墨卡托、覆盖该范围；null = 等经纬全球图，需重投影
      bounds: tiles.length ? null : bounds,
      tileSize: c.tileSize || 256,
      maxzoom: c.maxzoom != null ? c.maxzoom : 8,
      attribution: c.attribution || (custom || tiles.length ? '' : 'Night lights simulated from GeoNames (CC BY 4.0)'),
    };
  }

  /** 墨卡托画布第 y 行（共 h 行，覆盖 ±85.05°）中心的纬度 */
  function mercatorRowLat(y, h) {
    var mercY = Math.PI * (1 - (2 * (y + 0.5)) / h);
    return (Math.atan(Math.sinh(mercY)) * 180) / Math.PI;
  }

  /** 等经纬图（高 srcH，覆盖 90°N..90°S）里该纬度对应的源行 */
  function equirectRowForLat(lat, srcH) {
    return Math.min(srcH - 1, Math.max(0, Math.floor(((90 - lat) / 180) * srcH)));
  }

  function nightSourceSpec(nightCfg, imageUrl) {
    if (nightCfg.tiles.length) {
      return {
        type: 'raster',
        tiles: nightCfg.tiles,
        tileSize: nightCfg.tileSize,
        maxzoom: nightCfg.maxzoom,
        attribution: nightCfg.attribution,
      };
    }
    var b = nightCfg.bounds || [-180, -MERC_MAX_LAT, 180, MERC_MAX_LAT];
    return {
      type: 'image',
      url: imageUrl || nightCfg.image,
      coordinates: [[b[0], b[3]], [b[2], b[3]], [b[2], b[1]], [b[0], b[1]]],
    };
  }

  /** 夜光栅格图层（叙事运行时与 Studio 共用）。before 由调用方决定：山影之上、水路之下 */
  function nightLayerSpec(visible) {
    return {
      id: NIGHT_LAYER_ID,
      type: 'raster',
      source: NIGHT_SOURCE_ID,
      layout: { visibility: visible === false ? 'none' : 'visible' },
      paint: {
        // 夜光图只有 z6 精度：z8 起淡出、z9.5 全交给矢量灯光（否则大城市成一片灰白雾）
        'raster-opacity': ['interpolate', ['linear'], ['zoom'], 6.5, 1, 8, 0.45, 9.5, 0],
        'raster-resampling': 'linear',
        'raster-fade-duration': 0,
      },
    };
  }

  /** 等经纬全球图（已加载的 <img>）→ 墨卡托 dataURL；doc 为浏览器 document */
  function equirectToMercator(img, doc) {
    var w = img.naturalWidth;
    var srcH = img.naturalHeight;
    var c = doc.createElement('canvas');
    c.width = w;
    c.height = w;
    var g = c.getContext('2d');
    for (var y = 0; y < w; y++) {
      g.drawImage(img, 0, equirectRowForLat(mercatorRowLat(y, w), srcH), w, 1, 0, y, w, 1);
    }
    return c.toDataURL('image/jpeg', 0.92);
  }

  function lightsParts(VP, params) {
    var v = (params && params.vector) || {};
    var vis = v.lights ? 'visible' : 'none';
    var src = VP.SOURCE_ID;
    return {
      layers: [
        {
          id: 'vl-lights-urban',
          type: 'fill',
          source: src,
          'source-layer': 'landuse',
          minzoom: 5,
          filter: ['match', ['get', 'class'], ['residential', 'commercial', 'industrial', 'retail'], true, false],
          layout: { visibility: vis },
          paint: {
            'fill-color': '#ffb24a',
            'fill-antialias': false,
            'fill-opacity': ['interpolate', ['linear'], ['zoom'], 5, 0.12, 9, 0.35, 13, 0.22],
          },
        },
        {
          id: 'vl-lights-roads',
          type: 'line',
          source: src,
          'source-layer': 'transportation',
          filter: ['match', ['get', 'class'], ['motorway', 'trunk', 'primary', 'secondary'], true, false],
          layout: { visibility: vis, 'line-cap': 'round', 'line-join': 'round' },
          paint: {
            'line-color': ['match', ['get', 'class'],
              'motorway', '#ffd27a', 'trunk', '#ffbf5a', 'primary', '#ff9f40', '#e88838'],
            'line-width': ['interpolate', ['linear'], ['zoom'], 4, 0.4, 8, 1.2, 12, 3],
            'line-blur': ['interpolate', ['linear'], ['zoom'], 4, 0.4, 12, 2],
            'line-opacity': ['interpolate', ['linear'], ['zoom'], 4, 0.35, 7, 0.75],
          },
        },
        {
          id: 'vl-lights-glow',
          type: 'heatmap',
          source: src,
          'source-layer': 'place',
          filter: ['match', ['get', 'class'], ['city', 'town', 'village'], true, false],
          layout: { visibility: vis },
          paint: {
            'heatmap-weight': ['match', ['get', 'class'],
              'city', ['interpolate', ['linear'], ['coalesce', ['get', 'rank'], 10], 1, 1.4, 10, 0.7],
              'town', 0.4,
              0.08],
            'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 3, 1, 8, 1.4, 12, 2],
            'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 3, 14, 6, 26, 9, 40, 12, 70],
            'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'],
              0, 'rgba(0,0,0,0)',
              0.08, 'rgba(120,40,10,0.25)',
              0.25, 'rgba(200,90,20,0.55)',
              0.5, 'rgba(255,150,50,0.8)',
              0.8, 'rgba(255,210,120,0.95)',
              1, 'rgba(255,245,210,1)'],
            'heatmap-opacity': glowOpacity(!!v.nightRaster),
          },
        },
      ],
    };
  }

  /** 卫星底图同款山影（= DEFAULT_PARAMS.maplibre.hillshade 的配色与强度） */
  var SAT_HILLSHADE = { exaggeration: 0.42, shadowColor: '#2c2824', highlightColor: '#f0ece4', accentColor: '#6a6458' };

  /**
   * 底图样式：一键切换「卫星」或「不用卫星，只靠海拔设色 + 山影 + 皮肤」。
   * stops 为 [海拔 m, 色值] 升序，Terrarium 带海底高程，负值即海色；null = 默认色阶。
   * hillshade 只给强度与配色，光向仍归「光照」；skinId 指 AntiqueVectorPaint.SKINS。
   */
  var BASEMAP_STYLES = [
    { id: 'satellite', label: '卫星', blurb: 'Sentinel-2 卫星 + 山影', satellite: true, hillshade: SAT_HILLSHADE, skinId: 'parchment' },
    { id: 'natural', label: '自然', blurb: '默认色阶 · 仿卫星的沉稳地色', stops: null, hillshade: SAT_HILLSHADE, skinId: 'parchment' },
    {
      id: 'atlas', label: '设色', blurb: '地图集分层设色：绿平原 → 黄褐高原 → 雪峰',
      stops: [
        [-6000, '#1d3a5c'], [-200, '#3e6e94'], [-1, '#7fa8c4'], [0, '#6d9a5e'],
        [200, '#8fb06a'], [500, '#c2c27c'], [1000, '#d6c386'], [2000, '#c49a64'],
        [3000, '#a57650'], [4000, '#8c6a54'], [5000, '#a89c94'], [5800, '#e8e6e2'],
        [6500, '#ffffff'],
      ],
      hillshade: { exaggeration: 0.5, shadowColor: '#30302a', highlightColor: '#ffffff', accentColor: '#5a5040' },
      skinId: 'parchment',
    },
    {
      id: 'paper', label: '古卷', blurb: '宣纸褐调分层，海作淡青',
      stops: [
        [-4000, '#5a7680'], [-100, '#8aa0a0'], [-1, '#a9b6ac'], [0, '#d6cbb0'],
        [300, '#cfc29e'], [800, '#c4b28a'], [1500, '#b49c74'], [2500, '#9c8262'],
        [3500, '#8a7458'], [4500, '#7c6a56'], [5500, '#b8ae9e'], [6500, '#e6dfd0'],
      ],
      hillshade: { exaggeration: 0.55, shadowColor: '#3a3024', highlightColor: '#f6efe0', accentColor: '#6a5c48' },
      skinId: 'aged',
    },
    {
      id: 'ink', label: '水墨', blurb: '灰阶分层 + 重山影',
      stops: [
        [-4000, '#6e7276'], [-100, '#a4a8a8'], [-1, '#c4c6c2'], [0, '#e6e2d8'],
        [500, '#dcd8cc'], [1500, '#c4c0b4'], [3000, '#a09c92'], [4500, '#7c7a74'],
        [5500, '#9a9894'], [6500, '#f2f0ea'],
      ],
      hillshade: { exaggeration: 0.75, shadowColor: '#1a1a1a', highlightColor: '#fbfaf6', accentColor: '#3a3a38' },
      skinId: 'ink',
    },
    {
      id: 'qinglv', label: '青绿', blurb: '绢底平原，石绿山腰，石青高山',
      stops: [
        [-4000, '#2c5a64'], [-100, '#4c8486'], [-1, '#7aa69a'], [0, '#d8c69c'],
        [200, '#cdb98a'], [600, '#9fae7a'], [1200, '#6e9a72'], [2000, '#4a8a78'],
        [3000, '#3f7c74'], [4000, '#56786a'], [5000, '#7d8a80'], [5800, '#d8dcd4'],
        [6500, '#f4f2ea'],
      ],
      hillshade: { exaggeration: 0.5, shadowColor: '#2a2a22', highlightColor: '#f8f0dc', accentColor: '#4a5a48' },
      skinId: 'silk',
    },
    {
      id: 'nightlights', label: '夜景', blurb: '近黑地形 + 城市灯光（矢量合成，非卫星夜光图）',
      stops: [
        [-4000, '#040a1a'], [-100, '#071022'], [-1, '#0a1428'], [0, '#121418'],
        [500, '#15171b'], [1500, '#1a1b1f'], [3000, '#202024'], [4500, '#26262a'],
        [5500, '#3a3c42'], [6500, '#6a6e76'],
      ],
      hillshade: { exaggeration: 0.45, shadowColor: '#000000', highlightColor: '#4a5060', accentColor: '#101216' },
      skinId: 'night',
      lights: true,
      nightRaster: true,
      showRoads: false,
      showWater: false,
    },
    {
      id: 'dusk', label: '暗夜', blurb: '暗底，高原渐金',
      stops: [
        [-4000, '#0c1018'], [-100, '#18222c'], [-1, '#222a30'], [0, '#3a3226'],
        [500, '#463a2a'], [1500, '#5a4a34'], [3000, '#6e5a3e'], [4500, '#7e6a4a'],
        [5500, '#a08c66'], [6500, '#d8c49a'],
      ],
      hillshade: { exaggeration: 0.6, shadowColor: '#0a0806', highlightColor: '#e8d4a8', accentColor: '#3a3020' },
      skinId: 'night',
    },
  ];

  function findBasemap(id) {
    return BASEMAP_STYLES.filter(function (s) { return s.id === id; })[0] || null;
  }

  /**
   * 把底图样式写进 params（不碰地图、不碰皮肤）：卫星开关、海拔设色、色阶、山影，
   * 并清掉自定义图层色。返回样式，调用方再按 skinId 换皮肤、写地图。
   */
  function applyBasemapParams(params, id) {
    var style = findBasemap(id);
    if (!style || !params) return null;
    var v = params.vector;
    v.paint = null;
    v.relief = !style.satellite;
    v.lights = !!style.lights;
    v.nightRaster = !!style.nightRaster;
    params.ui.showRoads = style.showRoads !== false;
    params.ui.showWater = style.showWater !== false;
    v.reliefOpacity = 1;
    v.elevStops = style.stops
      ? style.stops.map(function (s) { return { h: s[0], color: s[1], label: s[0] + ' m' }; })
      : null;
    params.maplibre.satellite.opacity = style.satellite ? 0.7 : 0;
    Object.keys(style.hillshade).forEach(function (k) { params.maplibre.hillshade[k] = style.hillshade[k]; });
    params.ui.basemapId = style.id;
    return style;
  }

  function clone(o) {
    return JSON.parse(JSON.stringify(o));
  }

  function findSkin(VP, id) {
    if (!VP || !id) return null;
    return (VP.SKINS || []).filter(function (s) { return s.id === id; })[0] || null;
  }

  /** 生效配色：自定义 paint > 当前皮肤 > 默认 */
  function effectivePaint(VP, vector, skinId) {
    if (vector && vector.paint) return VP.normalizePaint(vector.paint);
    var skin = findSkin(VP, skinId);
    return VP.normalizePaint(skin ? skin.paint : VP.DEFAULT_PAINT);
  }

  function effectiveStops(VP, vector) {
    var src = vector && vector.elevStops ? vector.elevStops : VP.DEFAULT_ELEVATION_STOPS;
    return src.map(function (s) { return { h: s.h, color: s.color, label: s.label }; });
  }

  /** 面板里的颜色行（保持 COLOR_FIELDS 顺序，按组分） */
  function colorRows(VP) {
    return (VP.COLOR_FIELDS || []).filter(function (f) {
      return f.key === 'waterOcean' || !SKIP_COLOR_KEYS[f.key];
    });
  }

  function isGlobe(params) {
    return !!(params && params.ui && params.ui.viewMode === 'globe');
  }

  /**
   * 海拔设色 + 图层颜色在 buildMapStyle 里的图层与数据源。
   * 图层顺序：relief → 地表（landcover / landuse）；放在卫星之上、山影之下。
   * 全部预先加进样式，只用 visibility 开关，未开启时不会请求瓦片。
   */
  function baseParts(VP, tileCfg, params) {
    var vector = (params && params.vector) || {};
    var globe = isGlobe(params);
    var paint = effectivePaint(VP, vector, params && params.ui && params.ui.skinId);
    var style = VP.buildStyle({ paint: paint, tileConfig: tileCfg, farLandcover: 'none' });
    var wanted = [RELIEF_ID].concat(VP.LANDCOVER_NATIVE_IDS);
    var layers = [];
    wanted.forEach(function (id) {
      var layer = style.layers.filter(function (l) { return l.id === id; })[0];
      if (!layer) return;
      layer = clone(layer);
      layer.layout = layer.layout || {};
      if (id === RELIEF_ID) {
        layer.paint['color-relief-color'] = VP.elevationColorExpr(effectiveStops(VP, vector));
        layer.paint['color-relief-opacity'] = vector.reliefOpacity != null ? vector.reliefOpacity : 1;
        layer.layout.visibility = vector.relief && !globe ? 'visible' : 'none';
      } else {
        layer.layout.visibility = vector.landcover ? 'visible' : 'none';
      }
      layers.push(layer);
    });
    var sources = {};
    [VP.TERRAIN_VISUAL_SOURCE_ID, VP.SOURCE_ID].forEach(function (id) {
      if (style.sources[id]) sources[id] = clone(style.sources[id]);
    });
    // 地形 DEM 没配置时不要凭空生成视觉 DEM 源，relief 也就不加
    if (!tileCfg || !tileCfg.terrain || !tileCfg.terrain.enabled) {
      delete sources[VP.TERRAIN_VISUAL_SOURCE_ID];
      layers = layers.filter(function (l) { return l.id !== RELIEF_ID; });
    }
    return { sources: sources, layers: layers };
  }

  // ============================================================
  // 浏览器：面板 + 写入地图
  // ============================================================

  function mount(ctx) {
    var VP = root.AntiqueVectorPaint;
    var doc = root.document;
    if (!VP || !doc) return null;

    var $ = function (id) { return doc.getElementById(id); };
    var rafId = 0;
    var pendingKeys = {};
    var pendingStops = false;
    var contourDem = null;
    var contourReady = false;

    function vec() { return ctx.params().vector; }
    function map() { return ctx.map(); }
    function mapOk() { var m = map(); return !!(m && ctx.isReady()); }
    function paintNow() { return effectivePaint(VP, vec(), ctx.params().ui.skinId); }

    function flush() {
      rafId = 0;
      var m = map();
      if (!mapOk()) return;
      var keys = Object.keys(pendingKeys);
      pendingKeys = {};
      if (keys.length) {
        VP.applyVectorPaint(m, paintNow(), keys);
        if (typeof ctx.afterPaint === 'function') ctx.afterPaint();
      }
      if (pendingStops) {
        pendingStops = false;
        VP.applyElevationRamp(m, effectiveStops(VP, vec()));
      }
    }
    function schedule() {
      if (!rafId) rafId = root.requestAnimationFrame(flush);
    }

    // ---- 等高线（懒加载：maplibre-contour 的 DEM 源 + 矢量源） ----
    function ensureContours() {
      var m = map();
      if (contourReady || !mapOk() || !root.mlcontour || typeof root.maplibregl.addProtocol !== 'function') {
        return contourReady;
      }
      var tileCfg = ctx.tileConfig();
      if (!tileCfg || !tileCfg.terrain || !tileCfg.terrain.enabled) return false;
      try {
        contourDem = new root.mlcontour.DemSource({
          url: VP.demTileUrl(tileCfg),
          encoding: 'terrarium',
          maxzoom: VP.visualDemMaxzoom(tileCfg),
          worker: true,
        });
        contourDem.setupMaplibre(root.maplibregl);
        if (!m.getSource(VP.CONTOUR_SOURCE_ID)) {
          m.addSource(VP.CONTOUR_SOURCE_ID, {
            type: 'vector',
            tiles: [contourDem.contourProtocolUrl(VP.CONTOUR_OPTIONS)],
            maxzoom: 15,
          });
        }
        var before = m.getLayer('hillshade') ? 'hillshade' : undefined;
        VP.contourLayerDefs().forEach(function (layer) {
          if (!m.getLayer(layer.id)) m.addLayer(layer, before);
        });
        contourReady = true;
      } catch (e) {
        root.console.warn('等高线初始化失败', e);
        contourReady = false;
      }
      return contourReady;
    }

    // ---- 真实夜光（懒加载：第一次打开才拉图 / 重投影） ----
    var nightState = 'idle'; // idle | loading | ready | failed

    function addNightLayer(spec) {
      var m = map();
      if (!mapOk() || m.getLayer(NIGHT_LAYER_ID)) return;
      if (!m.getSource(NIGHT_SOURCE_ID)) m.addSource(NIGHT_SOURCE_ID, spec);
      // 压在山影之上（灯光不被山影压暗）、水路与覆盖层之下
      var ids = m.getStyle().layers.map(function (l) { return l.id; });
      var hi = ids.indexOf('hillshade');
      var before = hi >= 0 && hi + 1 < ids.length ? ids[hi + 1] : undefined;
      m.addLayer(nightLayerSpec(!!vec().nightRaster), before);
    }

    function ensureNightRaster() {
      if (nightState !== 'idle' || !mapOk()) return;
      var cfg = ctx.tileConfig() && ctx.tileConfig().nightLights;
      if (!cfg) { nightState = 'failed'; return; }
      if (cfg.tiles.length || cfg.bounds) {
        addNightLayer(nightSourceSpec(cfg));
        nightState = 'ready';
        return;
      }
      nightState = 'loading';
      var img = new root.Image();
      img.crossOrigin = 'anonymous';
      img.onload = function () {
        try {
          addNightLayer(nightSourceSpec(cfg, equirectToMercator(img, doc)));
          nightState = 'ready';
        } catch (e) {
          nightState = 'failed';
          root.console.warn('夜光图重投影失败', e);
        }
      };
      img.onerror = function () {
        nightState = 'failed';
        ctx.toast('夜光图加载失败：' + cfg.image);
      };
      img.src = cfg.image;
    }

    /** 把 params.vector 的开关 / 色阶 / 颜色全部写到地图上 */
    function applyToMap() {
      if (!mapOk()) return;
      var m = map();
      var params = ctx.params();
      var v = params.vector;
      var globe = isGlobe(params);
      if (m.getLayer(RELIEF_ID)) {
        m.setLayoutProperty(RELIEF_ID, 'visibility', v.relief && !globe ? 'visible' : 'none');
        m.setPaintProperty(RELIEF_ID, 'color-relief-opacity', v.reliefOpacity);
        VP.applyElevationRamp(m, effectiveStops(VP, v));
      }
      VP.LANDCOVER_NATIVE_IDS.forEach(function (id) {
        if (m.getLayer(id)) m.setLayoutProperty(id, 'visibility', v.landcover ? 'visible' : 'none');
      });
      LIGHT_IDS.forEach(function (id) {
        if (m.getLayer(id)) m.setLayoutProperty(id, 'visibility', v.lights ? 'visible' : 'none');
      });
      if (m.getLayer('vl-lights-glow')) {
        m.setPaintProperty('vl-lights-glow', 'heatmap-opacity', glowOpacity(!!v.nightRaster));
      }
      if (v.nightRaster) ensureNightRaster();
      if (m.getLayer(NIGHT_LAYER_ID)) {
        m.setLayoutProperty(NIGHT_LAYER_ID, 'visibility', v.nightRaster ? 'visible' : 'none');
      }
      var wantContour = v.contour && !globe;
      if (wantContour) ensureContours();
      if (contourReady) VP.setContours(m, wantContour);
      VP.applyVectorPaint(m, paintNow());
      if (typeof ctx.afterPaint === 'function') ctx.afterPaint();
    }

    // ---- 面板渲染 ----
    function setTgl(id, on) {
      var el = $(id);
      if (!el) return;
      el.classList.toggle('active', !!on);
      el.setAttribute('aria-pressed', on ? 'true' : 'false');
    }

    function renderBasemaps() {
      var host = $('basemap-list');
      if (!host) return;
      host.innerHTML = '';
      var active = ctx.params().ui.basemapId || '';
      BASEMAP_STYLES.forEach(function (s) {
        var b = doc.createElement('button');
        b.type = 'button';
        b.className = 'chip' + (s.id === active ? ' active' : '');
        b.setAttribute('data-basemap', s.id);
        b.textContent = s.label;
        b.title = s.blurb;
        b.addEventListener('click', function () {
          var style = applyBasemapParams(ctx.params(), s.id);
          if (style.skinId) ctx.applySkin(style.skinId);
          applyToMap();
          if (typeof ctx.afterBasemap === 'function') ctx.afterBasemap();
          syncUi();
          ctx.persist();
        });
        host.appendChild(b);
      });
    }

    function renderSkins() {
      var host = $('skin-list');
      if (!host) return;
      host.innerHTML = '';
      var active = ctx.params().ui.skinId || '';
      VP.SKINS.forEach(function (s) {
        var b = doc.createElement('button');
        b.type = 'button';
        b.className = 'chip' + (s.id === active && !vec().paint ? ' active' : '');
        b.setAttribute('data-skin', s.id);
        b.textContent = s.label;
        if (s.blurb) b.title = s.blurb;
        b.addEventListener('click', function () {
          vec().paint = null;
          ctx.applySkin(s.id);
          renderColors();
          renderSkins();
          ctx.persist();
        });
        host.appendChild(b);
      });
    }

    function renderColors() {
      var host = $('color-list');
      if (!host) return;
      host.innerHTML = '';
      var paint = paintNow();
      var group = '';
      colorRows(VP).forEach(function (f) {
        if (f.group !== group) {
          group = f.group;
          var lab = doc.createElement('div');
          lab.className = 'field-label';
          lab.textContent = group;
          host.appendChild(lab);
        }
        var row = doc.createElement('div');
        row.className = 'color-row';
        var name = doc.createElement('span');
        name.textContent = f.label;
        var inp = doc.createElement('input');
        inp.type = 'color';
        inp.value = paint[f.key];
        inp.setAttribute('data-key', f.key);
        inp.addEventListener('input', function () {
          var v = vec();
          if (!v.paint) v.paint = clone(paintNow());
          v.paint[f.key] = inp.value;
          pendingKeys[f.key] = true;
          schedule();
          renderSkinActive();
          ctx.persist();
        });
        row.appendChild(name);
        row.appendChild(inp);
        host.appendChild(row);
      });
    }

    function renderSkinActive() {
      doc.querySelectorAll('#skin-list .chip').forEach(function (b) {
        b.classList.toggle(
          'active',
          !vec().paint && b.getAttribute('data-skin') === (ctx.params().ui.skinId || '')
        );
      });
    }

    function renderStops() {
      var host = $('elev-list');
      if (!host) return;
      host.innerHTML = '';
      effectiveStops(VP, vec()).forEach(function (s, i) {
        var row = doc.createElement('div');
        row.className = 'color-row';
        var name = doc.createElement('span');
        name.textContent = s.label;
        var inp = doc.createElement('input');
        inp.type = 'color';
        inp.value = s.color;
        inp.setAttribute('data-elev', String(s.h));
        inp.addEventListener('input', function () {
          var v = vec();
          if (!v.elevStops) v.elevStops = effectiveStops(VP, v);
          v.elevStops[i].color = inp.value;
          ctx.params().ui.basemapId = null;
          renderBasemaps();
          pendingStops = true;
          schedule();
          ctx.persist();
        });
        row.appendChild(name);
        row.appendChild(inp);
        host.appendChild(row);
      });
    }

    function syncUi() {
      var v = vec();
      setTgl('btn-relief', v.relief);
      setTgl('btn-contour', v.contour);
      setTgl('btn-landcover', v.landcover);
      setTgl('btn-lights', v.lights);
      setTgl('btn-night-raster', v.nightRaster);
      var slider = $('relief-opacity');
      var val = $('relief-opacity-val');
      if (slider) slider.value = String(v.reliefOpacity);
      if (val) val.textContent = Number(v.reliefOpacity).toFixed(2);
      renderBasemaps();
      renderSkins();
      renderColors();
      renderStops();
    }

    function bindToggle(id, key) {
      var el = $(id);
      if (!el) return;
      el.addEventListener('click', function () {
        var v = vec();
        v[key] = !v[key];
        setTgl(id, v[key]);
        applyToMap();
        ctx.persist();
      });
    }
    bindToggle('btn-relief', 'relief');
    bindToggle('btn-contour', 'contour');
    bindToggle('btn-landcover', 'landcover');
    bindToggle('btn-lights', 'lights');
    bindToggle('btn-night-raster', 'nightRaster');

    var slider = $('relief-opacity');
    if (slider) {
      slider.addEventListener('input', function () {
        var v = vec();
        v.reliefOpacity = Math.min(1, Math.max(0, Number(slider.value)));
        var val = $('relief-opacity-val');
        if (val) val.textContent = v.reliefOpacity.toFixed(2);
        if (mapOk() && map().getLayer(RELIEF_ID)) {
          map().setPaintProperty(RELIEF_ID, 'color-relief-opacity', v.reliefOpacity);
        }
        ctx.persist();
      });
    }

    var resetBtn = $('btn-vector-reset');
    if (resetBtn) {
      resetBtn.addEventListener('click', function () {
        var v = vec();
        v.paint = null;
        v.elevStops = null;
        pendingKeys = {};
        syncUi();
        applyToMap();
        ctx.persist();
        ctx.toast('配色已回到当前皮肤与默认色阶');
      });
    }

    return { syncUi: syncUi, applyToMap: applyToMap, effectivePaint: paintNow };
  }

  return {
    SKIP_COLOR_KEYS: SKIP_COLOR_KEYS,
    RELIEF_ID: RELIEF_ID,
    BASEMAP_STYLES: BASEMAP_STYLES,
    LIGHT_IDS: LIGHT_IDS,
    lightsParts: lightsParts,
    NIGHT_LAYER_ID: NIGHT_LAYER_ID,
    NIGHT_SOURCE_ID: NIGHT_SOURCE_ID,
    nightLayerSpec: nightLayerSpec,
    equirectToMercator: equirectToMercator,
    glowOpacity: glowOpacity,
    resolveNightConfig: resolveNightConfig,
    mercatorRowLat: mercatorRowLat,
    equirectRowForLat: equirectRowForLat,
    nightSourceSpec: nightSourceSpec,
    applyBasemapParams: applyBasemapParams,
    effectivePaint: effectivePaint,
    effectiveStops: effectiveStops,
    colorRows: colorRows,
    baseParts: baseParts,
    mount: mount,
  };
});
