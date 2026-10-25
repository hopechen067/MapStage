/**
 * Tuner parameter schema: preset id, storage key, DEFAULT_PARAMS and
 * mergeParams, plus the fixed camera / lighting / theme tables.
 *
 * Browser: window.AntiqueTunerParams
 * Node:    module.exports
 */
(function (root, factory) {
  var cjs = typeof module === 'object' && module.exports;
  var util = cjs ? require('./tuner-util.js') : root.AntiqueTunerUtil;
  var api = factory(util);
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (root) root.AntiqueTunerParams = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (util) {
  'use strict';
  var deepClone = util.deepClone;

  const PRESET_ID = 'antique-default';

  const STORAGE_KEY = 'china-antique-maplibre-tuner-v1';

  // 默认 = 用户手调 antique-default（保留三级河 / 高亮水系字段）
  const DEFAULT_PARAMS = {
    id: PRESET_ID,
    label: '手绘古地图 · MapLibre + Terrarium 山影',
    version: 1,
    camera: {
      center: [104.0, 35.5],
      zoom: 4.2,
      pitch: 28,
      bearing: 0,
    },
    maplibre: {
      backgroundColor: '#000000',
      terrainExaggeration: 1.6,
      satellite: {
        opacity: 0.7,
        saturation: -0.08,
        contrast: 0.02,
        brightnessMin: 0.08,
        brightnessMax: 0.96,
        hueRotate: 12,
      },
      hillshade: {
        exaggeration: 0.42,
        illuminationDirection: 315,
        shadowColor: '#2c2824',
        highlightColor: '#f0ece4',
        accentColor: '#6a6458',
      },
      water: {
        lakeFill: 'rgba(50,118,138,0.9)',
        riverLevel3: 'rgba(48,112,128,0.55)',
        riverLevel2: 'rgba(45,110,125,0.88)',
        riverLevel1: 'rgba(42,105,120,0.95)',
        riverL3Width: 1.2,
        riverL2Width: 2,
        riverL1Width: 1.8,
      },
    },
    css: {
      sepia: 0.08,
      saturate: 0.98,
      contrast: 1.03,
      brightness: 1.0,
      hueRotate: -1,
      warmTintAlpha: 0.04,
      warmTintColor: '#9a8868',
      vignetteStrength: 0.1,
    },
    ui: {
      showWater: true,
      showRoads: true,
      showCities: true,
      showRef: false,
      showRegionIsolate: false,
      regionIsolateId: 'china',
      refMode: 'pip', // pip | split
      viewMode: 'map', // map | globe
      sceneId: 'china',
      lightingId: 'night',
      themeId: 'antique',
      islandSideColor: '#6d4a36',
    },
    cities: {
      dataFile: 'assets/sample-sites.json',
      halfKm: 18,
      renderMode: 'fill-extrusion',
    },
    season: null, // null | spring | summer | autumn | winter
    // 矢量配色（海拔设色 / 图层颜色 / 等高线）。默认全关，旧预设不受影响。
    // paint / elevStops 为 null 表示跟随当前皮肤 / 默认色阶。
    vector: {
      relief: false,
      reliefOpacity: 1,
      contour: false,
      landcover: false,
      lights: false,
      nightRaster: false,
      paint: null,
      elevStops: null,
    },
  };

  const HEX_COLOR = /^#[0-9a-f]{6}$/i;
  const VECTOR_BOOL_KEYS = ['relief', 'contour', 'landcover', 'lights', 'nightRaster'];

  /**
   * 粘贴 / 本地缓存里的 vector 块可能是任何东西：只留布尔开关、0–1 的设色不透明度、
   * 十六进制色值的 paint、形如 { h, color, label } 的色阶，其余丢弃。
   */
  function normalizeVector(input) {
    var out = deepClone(DEFAULT_PARAMS.vector);
    if (!input || typeof input !== 'object') return out;
    VECTOR_BOOL_KEYS.forEach(function (k) {
      if (typeof input[k] === 'boolean') out[k] = input[k];
    });
    var op = Number(input.reliefOpacity);
    if (input.reliefOpacity != null && isFinite(op)) out.reliefOpacity = Math.min(1, Math.max(0, op));
    if (input.paint && typeof input.paint === 'object' && !Array.isArray(input.paint)) {
      var paint = {};
      Object.keys(input.paint).forEach(function (k) {
        if (k === '__proto__' || k === 'constructor' || k === 'prototype') return;
        var c = input.paint[k];
        if (typeof c === 'string' && HEX_COLOR.test(c)) paint[k] = c.toLowerCase();
      });
      if (Object.keys(paint).length) out.paint = paint;
    }
    if (Array.isArray(input.elevStops)) {
      var stops = [];
      input.elevStops.forEach(function (st) {
        if (!st || typeof st !== 'object') return;
        var h = Number(st.h);
        if (!isFinite(h) || typeof st.color !== 'string' || !HEX_COLOR.test(st.color)) return;
        stops.push({
          h: h,
          color: st.color.toLowerCase(),
          label: typeof st.label === 'string' ? st.label.slice(0, 40) : h + ' m',
        });
      });
      stops.sort(function (a, b) { return a.h - b.h; });
      // interpolate 需要严格递增的海拔
      var strict = stops.filter(function (st, i) { return i === 0 || st.h > stops[i - 1].h; });
      if (strict.length >= 2) out.elevStops = strict;
    }
    return out;
  }

  // 视角快捷
  const VIEW_CHINA = { center: [104.0, 35.5], zoom: 4.2, pitch: 28, bearing: 0 };

  // Same scale as MapLibre's 3D terrain example (zoom ~11–12, pitch ~70).
  // Look south from the Hexi corridor at the Qilian front, not the plateau interior.
  const VIEW_RELIEF = { center: [100.42, 38.48], zoom: 10.6, pitch: 70, bearing: 180 };

  // 对比用参考图：仓库不带图。想用就在 map-tiles.config.local.js 里设
  // window.MAPSTAGE_REF_SRC = 'xxx.jpg'（可选 MAPSTAGE_REF_LABEL）；没设则整块对比 UI 隐藏。
  const BASELINE_REF = {
    src: (typeof window !== 'undefined' && window.MAPSTAGE_REF_SRC) || '',
    label: (typeof window !== 'undefined' && window.MAPSTAGE_REF_LABEL) || '参考图',
  };

  const MAP_MIN_ZOOM = 3;

  const GLOBE_MIN_ZOOM = 0.8;

  function mergeParams(base, override) {
    const out = deepClone(base);
    if (!override || typeof override !== 'object') return out;

    // 只拷贝安全自有键：粘贴/本地的预设可能带 __proto__ / constructor，
    // Object.assign 会经 setter 触发原型替换
    function safeKeys(src) {
      const copy = {};
      if (!src || typeof src !== 'object') return copy;
      Object.keys(src).forEach(function (k) {
        if (k === '__proto__' || k === 'constructor' || k === 'prototype') return;
        copy[k] = src[k];
      });
      return copy;
    }

    if (override.camera) {
      if (Array.isArray(override.camera.center) && override.camera.center.length >= 2) {
        out.camera.center = [+override.camera.center[0], +override.camera.center[1]];
      }
      if (override.camera.zoom != null) out.camera.zoom = +override.camera.zoom;
      if (override.camera.pitch != null) out.camera.pitch = +override.camera.pitch;
      if (override.camera.bearing != null) out.camera.bearing = +override.camera.bearing;
    }

    // v3 键 `mapstage`；旧键 `maplibre` 只读兼容（两者同时存在以 `mapstage` 为准）
    const lookBlock = override.mapstage || override.maplibre;
    if (lookBlock) {
      const m = lookBlock;
      if (m.backgroundColor) out.maplibre.backgroundColor = m.backgroundColor;
      if (m.terrainExaggeration != null) out.maplibre.terrainExaggeration = +m.terrainExaggeration;
      if (m.satellite) Object.assign(out.maplibre.satellite, safeKeys(m.satellite));
      if (m.hillshade) {
        Object.assign(out.maplibre.hillshade, safeKeys(m.hillshade));
        // MapLibre hillshade-exaggeration 上限为 1；超限会导致 style 无法加载
        if (out.maplibre.hillshade.exaggeration != null) {
          out.maplibre.hillshade.exaggeration = Math.min(1, Math.max(0, +out.maplibre.hillshade.exaggeration));
        }
      }
      if (m.water) Object.assign(out.maplibre.water, safeKeys(m.water));
      // 高亮水系 / 湖描边 / 河湖名依赖已移除的分级水系包，旧预设里的键直接丢弃
      ['qilianRiver', 'qilianWidth', 'highlightRiver', 'highlightWidth', 'lakeOutline'].forEach(function (k) {
        delete out.maplibre.water[k];
      });
    }

    if (override.css) Object.assign(out.css, safeKeys(override.css));
    if (override.ui) Object.assign(out.ui, safeKeys(override.ui));
    ['showQilian', 'showHighlight', 'showRiverLabels'].forEach(function (k) {
      delete out.ui[k];
    });
    if (override.cities) {
      out.cities = Object.assign({}, out.cities || {}, safeKeys(override.cities));
    }
    if (override.vector) out.vector = normalizeVector(override.vector);
    if (override.id) out.id = override.id;
    if (override.label) out.label = override.label;
    if (override.version != null) out.version = override.version;
    if (Object.prototype.hasOwnProperty.call(override, 'season')) {
      out.season = override.season;
    }

    return out;
  }

  const GLOBE_CAM = { center: [104.0, 35.5], zoom: 1.9, pitch: 16, bearing: 18 };

  const LIGHTING = {
    dawn: { illuminationDirection: 70, shadowColor: '#3a3028', highlightColor: '#f4e8d0' },
    day: { illuminationDirection: 165, shadowColor: '#2a2824', highlightColor: '#fff8ec' },
    dusk: { illuminationDirection: 285, shadowColor: '#2c2018', highlightColor: '#f0dcc0' },
    night: { illuminationDirection: 315, shadowColor: '#2c2824', highlightColor: '#f0ece4' },
  };

  const THEMES = {
    antique: { sepia: 0.08, saturate: 0.98, contrast: 1.03, brightness: 1.0, hueRotate: -1 },
    aged: { sepia: 0.28, saturate: 0.85, contrast: 1.08, brightness: 0.96, hueRotate: 4 },
    ink: { sepia: 0.04, saturate: 0.35, contrast: 1.12, brightness: 0.92, hueRotate: 0 },
    cyan: { sepia: 0.02, saturate: 0.9, contrast: 1.05, brightness: 1.02, hueRotate: -18 },
    silk: { sepia: 0.16, saturate: 1.05, contrast: 1.0, brightness: 1.04, hueRotate: 8 },
    hard: { sepia: 0.04, saturate: 0.92, contrast: 1.18, brightness: 1.0, hueRotate: 0 },
  };

  function globeSky() {
    return {
      'sky-color': '#0a0806',
      'horizon-color': '#1c140c',
      'fog-color': '#000000',
      'sky-horizon-blend': 0.7,
      'horizon-fog-blend': 0.8,
      'fog-ground-blend': 0.35,
      'atmosphere-blend': [
        'interpolate', ['linear'], ['zoom'],
        0, 0.88, 3, 0.5, 6, 0.06, 7, 0,
      ],
    };
  }

  return {
    PRESET_ID: PRESET_ID,
    STORAGE_KEY: STORAGE_KEY,
    DEFAULT_PARAMS: DEFAULT_PARAMS,
    VIEW_CHINA: VIEW_CHINA,
    VIEW_RELIEF: VIEW_RELIEF,
    BASELINE_REF: BASELINE_REF,
    mergeParams: mergeParams,
    normalizeVector: normalizeVector,
    MAP_MIN_ZOOM: MAP_MIN_ZOOM,
    GLOBE_MIN_ZOOM: GLOBE_MIN_ZOOM,
    GLOBE_CAM: GLOBE_CAM,
    LIGHTING: LIGHTING,
    THEMES: THEMES,
    globeSky: globeSky,
  };
});
