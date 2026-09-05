/**
 * Antique vector-layer paint — OpenMapTiles schema.
 * Browser: window.AntiqueVectorPaint
 * Node:    module.exports
 *
 * Color keys drive live setPaintProperty. TileJSON is OpenFreeMap planet (OMT).
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  if (root) root.AntiqueVectorPaint = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var TILEJSON_URL = 'https://tiles.openfreemap.org/planet';
  var SOURCE_ID = 'openmaptiles';
  /** Protomaps Daylight landcover exists from z0; OMT wood/grass/farmland only from z7. */
  var SOURCE_FAR_ID = 'landcoverFar';
  var SOURCE_POLAR_ID = 'polarIce';
  var POLAR_ICE_URL = 'assets/polar-ice.geojson?v=20260826-polar3';
  var POLAR_ICE_MAXZOOM = 6;
  var LANDCOVER_NATIVE_MINZOOM = 7;
  var LANDCOVER_FAR_URL = 'assets/landcover-lowzoom.geojson?v=20260826-perf';
  var LANDCOVER_GLOBE_URL = 'assets/landcover-globe.geojson?v=20260830-globe2';
  /** Live far paint is color-relief. `full` is an opt-in GeoJSON pack; globe no longer loads one. */
  var EMPTY_FAR_FC = { type: 'FeatureCollection', features: [] };
  var TERRAIN_SOURCE_ID = 'terrain';
  /** Keep visual DEM LOD independent from the 3D terrain mesh during zoom. */
  var TERRAIN_VISUAL_SOURCE_ID = 'terrainVisual';
  /**
   * Hillshade + color-relief native LOD. Mesh keeps tileCfg maxzoom (15).
   * 12 = official demo tiles.json / SRTM ~30m. Above this Terrarium is interpolated.
   */
  var TERRAIN_VISUAL_MAXZOOM = 12;
  var TERRAIN_MESH_MINZOOM = 6;
  /** Same as tuner/preset-antique-default.json maplibre.terrainExaggeration (dramatic) */
  var TERRAIN_EXAGGERATION = 1.6;
  /** Terrarium metres 1:1 — MapStage exaggeration 1.0 */
  var TERRAIN_REAL_EXAGGERATION = 1;
  /** Qilian front: zoom/pitch where the terrain mesh is actually visible. */
  var VIEW_RELIEF = { center: [100.42, 38.48], zoom: 10.6, pitch: 70, bearing: 180 };
  /** MapStage three.js-on-terrain example camera (Innsbruck). */
  var VIEW_ALPS = { center: [11.5257, 47.668], zoom: 16.27, pitch: 60, bearing: -28.5 };
  /** Same as tuner/preset-antique-default.json maplibre.hillshade */
  var HILLSHADE_PAINT = {
    exaggeration: 0.42,
    illuminationDirection: 315,
    shadowColor: '#2c2824',
    highlightColor: '#f0ece4',
    accentColor: '#6a6458',
  };
  var CONTOUR_SOURCE_ID = 'contours';
  var CONTOUR_LAYER = 'contours';
  var GLYPHS_URL = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';
  /** zoom: [minor m, major m] — MapStage contour protocol (meters, not feet). */
  var CONTOUR_THRESHOLDS = {
    3: [1000, 2000],
    5: [500, 1000],
    7: [200, 1000],
    8: [100, 500],
    10: [50, 200],
    11: [20, 100],
    13: [10, 50],
  };
  var CONTOUR_OPTIONS = {
    multiplier: 1,
    overzoom: 1,
    thresholds: CONTOUR_THRESHOLDS,
    elevationKey: 'ele',
    levelKey: 'level',
    contourLayer: CONTOUR_LAYER,
  };
  /**
   * Vector-lab DEM presets. Lab default is Mapterhorn; Terrarium kept for ?dem=.
   * Mapterhorn: CC-BY / equivalent, commercial OK with attribution.
   * Public tiles CDN has no SLA — self-host PMTiles for heavy production.
   */
  var DEFAULT_DEM_PRESET = 'mapterhorn';
  var DEM_PRESETS = {
    mapterhorn: {
      id: 'mapterhorn',
      label: 'Mapterhorn',
      tiles: ['https://tiles.mapterhorn.com/{z}/{x}/{y}.webp'],
      tileSize: 512,
      maxzoom: 17,
      visualMaxzoom: 16,
      encoding: 'terrarium',
      attribution: '<a href="https://mapterhorn.com/attribution" target="_blank" rel="noopener">© Mapterhorn</a>',
    },
    terrarium: {
      id: 'terrarium',
      label: 'Terrarium 30m',
      tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
      tileSize: 256,
      maxzoom: 15,
      visualMaxzoom: TERRAIN_VISUAL_MAXZOOM,
      encoding: 'terrarium',
      attribution: '© AWS Terrain Tiles (Terrarium)',
    },
  };

  function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function assign(a, b) {
    var o = clone(a);
    Object.keys(b).forEach(function (k) { o[k] = b[k]; });
    return o;
  }

  function hexShift(hex, dr, dg, db) {
    var h = String(hex || '').replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var n = parseInt(h, 16);
    if (!isFinite(n)) return hex;
    var r = Math.max(0, Math.min(255, ((n >> 16) & 255) + dr));
    var g = Math.max(0, Math.min(255, ((n >> 8) & 255) + dg));
    var b = Math.max(0, Math.min(255, (n & 255) + db));
    return '#' + (0x1000000 + (r << 16) + (g << 8) + b).toString(16).slice(1);
  }

  /** Old 15-key skins stay the core; splits get distinct antique offsets. */
  function withLayerSplits(core) {
    return assign(core, {
      scrub: hexShift(core.grass, 18, -10, -22),
      sand: hexShift(core.rock, 36, 28, 12),
      wetland: hexShift(core.water, 40, 28, -12),
      ice: hexShift(core.background, 48, 44, 40),
      commercial: hexShift(core.urban, 12, -8, -4),
      industrial: hexShift(core.urban, -16, -10, 4),
      retail: hexShift(core.urban, 18, 8, 0),
      boundaryProvince: hexShift(core.boundary, 28, 24, 20),
      waterOcean: hexShift(core.water, -12, -18, -8),
      waterRiver: hexShift(core.water, 10, 8, 4),
      waterPond: hexShift(core.water, 24, 16, 8),
      waterwayStream: hexShift(core.waterway, 28, 20, 16),
      waterwayCanal: hexShift(core.waterway, -8, -6, -4),
      waterwayDrain: hexShift(core.waterway, 36, 24, 20),
      trunk: hexShift(core.highway, -16, -8, 0),
      secondary: hexShift(core.major, 8, 8, 8),
      tertiary: hexShift(core.minor, 8, 4, 0),
      service: hexShift(core.minor, -12, -8, -4),
      track: hexShift(core.path, -10, -12, -8),
      ferry: hexShift(core.water, 8, 4, 0),
      transit: hexShift(core.rail, 18, 12, 10),
    });
  }

  /**
   * 皮肤注册表：核心 15 键 + 拆分层 + css grade（css 字段对齐 preset-antique-default.json）。
   * 第一套 = 默认古卷宣纸。旧 JSON 只有 15 键时，拆分层从父色回填。
   */
  var SKINS = [
    {
      id: 'parchment',
      label: '宣纸古卷',
      blurb: '默认 · 宣纸底黛青水',
      paint: withLayerSplits({
        background: '#c8c2b4',
        wood: '#8a9264',
        grass: '#a8a878',
        farmland: '#c0ac80',
        rock: '#a3947c',
        urban: '#b2987a',
        water: '#32768a',
        waterway: '#2d6e7d',
        highway: '#9a5232',
        major: '#8a6a48',
        minor: '#7a6a54',
        path: '#6e6254',
        rail: '#4a4238',
        building: '#8a7458',
        boundary: '#9a3a2a',
      }),
      css: {
        sepia: 0.08, saturate: 0.98, contrast: 1.03, brightness: 1.0, hueRotate: -1,
        warmTintColor: '#9a8868', warmTintAlpha: 0.04, vignetteStrength: 0.1,
      },
    },
  ];

  /** 默认配色 = 宣纸古卷（SKINS[0]） */
  var DEFAULT_PAINT = clone(SKINS[0].paint);
  var DEFAULT_CSS = clone(SKINS[0].css);

  var COLOR_FIELDS = [
    { key: 'background', label: '底色', group: '地表' },
    { key: 'wood', label: '林地', group: '地表' },
    { key: 'grass', label: '草地', group: '地表' },
    { key: 'scrub', label: '灌丛', group: '地表' },
    { key: 'farmland', label: '农田', group: '地表' },
    { key: 'rock', label: '裸岩', group: '地表' },
    { key: 'sand', label: '沙地', group: '地表' },
    { key: 'wetland', label: '湿地', group: '地表' },
    { key: 'ice', label: '冰雪', group: '地表' },
    { key: 'urban', label: '居住', group: '地表' },
    { key: 'commercial', label: '商业', group: '地表' },
    { key: 'industrial', label: '工业', group: '地表' },
    { key: 'retail', label: '零售', group: '地表' },
    { key: 'boundary', label: '国界', group: '地表' },
    { key: 'boundaryProvince', label: '省界', group: '地表' },
    { key: 'waterOcean', label: '海洋', group: '水系' },
    { key: 'water', label: '湖泊', group: '水系' },
    { key: 'waterRiver', label: '河面', group: '水系' },
    { key: 'waterPond', label: '池塘', group: '水系' },
    { key: 'waterway', label: '河道', group: '水系' },
    { key: 'waterwayStream', label: '溪流', group: '水系' },
    { key: 'waterwayCanal', label: '运河', group: '水系' },
    { key: 'waterwayDrain', label: '沟渠', group: '水系' },
    { key: 'highway', label: '高速', group: '道路' },
    { key: 'trunk', label: '国道', group: '道路' },
    { key: 'major', label: '主干道', group: '道路' },
    { key: 'secondary', label: '次干道', group: '道路' },
    { key: 'tertiary', label: '三级路', group: '道路' },
    { key: 'minor', label: '次路', group: '道路' },
    { key: 'service', label: '服务路', group: '道路' },
    { key: 'path', label: '小路', group: '道路' },
    { key: 'track', label: '土路', group: '道路' },
    { key: 'ferry', label: '轮渡', group: '道路' },
    { key: 'rail', label: '铁路', group: '道路' },
    { key: 'transit', label: '轨道交通', group: '道路' },
    { key: 'building', label: '建筑', group: '建筑' },
  ];

  /** Old 15-key JSON copies parent color onto splits that are missing. */
  var PAINT_ALIASES = [
    ['grass', 'scrub'],
    ['rock', 'sand'],
    ['urban', 'commercial'],
    ['urban', 'industrial'],
    ['urban', 'retail'],
    ['boundary', 'boundaryProvince'],
    ['water', 'waterOcean'],
    ['water', 'waterRiver'],
    ['water', 'waterPond'],
    ['water', 'wetland'],
    ['waterway', 'waterwayStream'],
    ['waterway', 'waterwayCanal'],
    ['waterway', 'waterwayDrain'],
    ['highway', 'trunk'],
    ['major', 'secondary'],
    ['minor', 'tertiary'],
    ['minor', 'service'],
    ['path', 'track'],
    ['path', 'ferry'],
    ['rail', 'transit'],
  ];

  function classIn(values) {
    return ['match', ['get', 'class'], values, true, false];
  }

  function classNotIn(values) {
    return ['!', classIn(values)];
  }

  function kindIn(values) {
    return ['match', ['get', 'kind'], values, true, false];
  }

  function landBoundary(minLevel, maxLevel) {
    var parts = [
      ['>=', ['to-number', ['get', 'admin_level']], minLevel],
      ['<=', ['to-number', ['get', 'admin_level']], maxLevel],
      ['!=', ['to-number', ['coalesce', ['get', 'maritime'], 0]], 1],
    ];
    return ['all'].concat(parts);
  }

  var LAYER_DEFS = [
    {
      id: 'vl-background',
      type: 'background',
      paintFrom: { 'background-color': 'background' },
    },
    {
      id: 'vl-relief',
      type: 'color-relief',
      source: TERRAIN_VISUAL_SOURCE_ID,
      paint: { 'color-relief-opacity': 1 },
    },
    {
      id: 'vl-wood-far',
      type: 'fill',
      source: SOURCE_FAR_ID,
      maxzoom: LANDCOVER_NATIVE_MINZOOM,
      layout: { visibility: 'none' },
      filter: kindIn(['forest']),
      paintFrom: { 'fill-color': 'wood', 'fill-opacity': 0.88 },
    },
    {
      id: 'vl-wood',
      type: 'fill',
      source: SOURCE_ID,
      'source-layer': 'landcover',
      minzoom: LANDCOVER_NATIVE_MINZOOM,
      filter: classIn(['wood']),
      paintFrom: { 'fill-color': 'wood', 'fill-opacity': 0.88 },
    },
    {
      id: 'vl-grass-far',
      type: 'fill',
      source: SOURCE_FAR_ID,
      maxzoom: LANDCOVER_NATIVE_MINZOOM,
      layout: { visibility: 'none' },
      filter: kindIn(['grassland']),
      paintFrom: { 'fill-color': 'grass', 'fill-opacity': 0.82 },
    },
    {
      id: 'vl-grass',
      type: 'fill',
      source: SOURCE_ID,
      'source-layer': 'landcover',
      minzoom: LANDCOVER_NATIVE_MINZOOM,
      filter: classIn(['grass']),
      paintFrom: { 'fill-color': 'grass', 'fill-opacity': 0.82 },
    },
    {
      id: 'vl-scrub-far',
      type: 'fill',
      source: SOURCE_FAR_ID,
      maxzoom: LANDCOVER_NATIVE_MINZOOM,
      layout: { visibility: 'none' },
      filter: kindIn(['scrub']),
      paintFrom: { 'fill-color': 'scrub', 'fill-opacity': 0.8 },
    },
    {
      id: 'vl-farmland-far',
      type: 'fill',
      source: SOURCE_FAR_ID,
      maxzoom: LANDCOVER_NATIVE_MINZOOM,
      layout: { visibility: 'none' },
      filter: kindIn(['farmland']),
      paintFrom: { 'fill-color': 'farmland', 'fill-opacity': 0.82 },
    },
    {
      id: 'vl-farmland',
      type: 'fill',
      source: SOURCE_ID,
      'source-layer': 'landcover',
      minzoom: LANDCOVER_NATIVE_MINZOOM,
      filter: classIn(['farmland']),
      paintFrom: { 'fill-color': 'farmland', 'fill-opacity': 0.82 },
    },
    {
      id: 'vl-rock-far',
      type: 'fill',
      source: SOURCE_FAR_ID,
      maxzoom: LANDCOVER_NATIVE_MINZOOM,
      layout: { visibility: 'none' },
      filter: kindIn(['barren']),
      paintFrom: { 'fill-color': 'rock', 'fill-opacity': 0.8 },
    },
    {
      id: 'vl-rock',
      type: 'fill',
      source: SOURCE_ID,
      'source-layer': 'landcover',
      minzoom: LANDCOVER_NATIVE_MINZOOM,
      filter: classIn(['rock']),
      paintFrom: { 'fill-color': 'rock', 'fill-opacity': 0.8 },
    },
    {
      id: 'vl-sand',
      type: 'fill',
      source: SOURCE_ID,
      'source-layer': 'landcover',
      minzoom: LANDCOVER_NATIVE_MINZOOM,
      filter: classIn(['sand']),
      paintFrom: { 'fill-color': 'sand', 'fill-opacity': 0.82 },
    },
    {
      id: 'vl-wetland',
      type: 'fill',
      source: SOURCE_ID,
      'source-layer': 'landcover',
      minzoom: LANDCOVER_NATIVE_MINZOOM,
      filter: classIn(['wetland']),
      paintFrom: { 'fill-color': 'wetland', 'fill-opacity': 0.78 },
    },
    {
      id: 'vl-ice',
      type: 'fill',
      source: SOURCE_ID,
      'source-layer': 'landcover',
      minzoom: LANDCOVER_NATIVE_MINZOOM,
      filter: classIn(['ice']),
      paintFrom: { 'fill-color': 'ice', 'fill-opacity': 0.82 },
    },
    {
      id: 'vl-urban-far',
      type: 'fill',
      source: SOURCE_FAR_ID,
      maxzoom: LANDCOVER_NATIVE_MINZOOM,
      layout: { visibility: 'none' },
      filter: kindIn(['urban_area']),
      paintFrom: { 'fill-color': 'urban', 'fill-opacity': 0.55 },
    },
    {
      id: 'vl-urban',
      type: 'fill',
      source: SOURCE_ID,
      'source-layer': 'landuse',
      minzoom: LANDCOVER_NATIVE_MINZOOM,
      filter: classIn(['residential']),
      paintFrom: { 'fill-color': 'urban', 'fill-opacity': 0.55 },
    },
    {
      id: 'vl-commercial',
      type: 'fill',
      source: SOURCE_ID,
      'source-layer': 'landuse',
      minzoom: LANDCOVER_NATIVE_MINZOOM,
      filter: classIn(['commercial']),
      paintFrom: { 'fill-color': 'commercial', 'fill-opacity': 0.55 },
    },
    {
      id: 'vl-industrial',
      type: 'fill',
      source: SOURCE_ID,
      'source-layer': 'landuse',
      minzoom: LANDCOVER_NATIVE_MINZOOM,
      filter: classIn(['industrial']),
      paintFrom: { 'fill-color': 'industrial', 'fill-opacity': 0.55 },
    },
    {
      id: 'vl-retail',
      type: 'fill',
      source: SOURCE_ID,
      'source-layer': 'landuse',
      minzoom: LANDCOVER_NATIVE_MINZOOM,
      filter: classIn(['retail']),
      paintFrom: { 'fill-color': 'retail', 'fill-opacity': 0.55 },
    },
    {
      id: 'vl-boundary',
      type: 'line',
      source: SOURCE_ID,
      'source-layer': 'boundary',
      filter: landBoundary(2, 2),
      paintFrom: { 'line-color': 'boundary', 'line-width': 1.25, 'line-opacity': 0.88 },
    },
    {
      id: 'vl-boundary-province',
      type: 'line',
      source: SOURCE_ID,
      'source-layer': 'boundary',
      filter: landBoundary(3, 4),
      paintFrom: { 'line-color': 'boundaryProvince', 'line-width': 0.8, 'line-opacity': 0.62 },
    },
    {
      id: 'vl-polar-ice',
      type: 'fill',
      source: SOURCE_POLAR_ID,
      maxzoom: POLAR_ICE_MAXZOOM,
      paintFrom: { 'fill-color': 'ice', 'fill-opacity': 0.72 },
    },
    {
      id: 'vl-hillshade',
      type: 'hillshade',
      source: TERRAIN_VISUAL_SOURCE_ID,
      paint: {
        'hillshade-exaggeration': HILLSHADE_PAINT.exaggeration,
        'hillshade-illumination-direction': HILLSHADE_PAINT.illuminationDirection,
        'hillshade-shadow-color': HILLSHADE_PAINT.shadowColor,
        'hillshade-highlight-color': HILLSHADE_PAINT.highlightColor,
        'hillshade-accent-color': HILLSHADE_PAINT.accentColor,
      },
    },
    {
      id: 'vl-water-ocean',
      type: 'fill',
      source: SOURCE_ID,
      'source-layer': 'water',
      filter: classIn(['ocean']),
      paintFrom: { 'fill-color': 'waterOcean', 'fill-opacity': 0.92 },
    },
    {
      id: 'vl-water',
      type: 'fill',
      source: SOURCE_ID,
      'source-layer': 'water',
      filter: classNotIn(['ocean', 'river', 'pond', 'swimming_pool', 'dock']),
      paintFrom: { 'fill-color': 'water', 'fill-opacity': 0.92 },
    },
    {
      id: 'vl-water-river',
      type: 'fill',
      source: SOURCE_ID,
      'source-layer': 'water',
      filter: classIn(['river']),
      paintFrom: { 'fill-color': 'waterRiver', 'fill-opacity': 0.9 },
    },
    {
      id: 'vl-water-pond',
      type: 'fill',
      source: SOURCE_ID,
      'source-layer': 'water',
      filter: classIn(['pond', 'swimming_pool', 'dock']),
      paintFrom: { 'fill-color': 'waterPond', 'fill-opacity': 0.88 },
    },
    {
      id: 'vl-waterway-drain',
      type: 'line',
      source: SOURCE_ID,
      'source-layer': 'waterway',
      minzoom: 10,
      filter: classIn(['drain', 'ditch']),
      paintFrom: { 'line-color': 'waterwayDrain', 'line-width': 0.7, 'line-opacity': 0.7 },
    },
    {
      id: 'vl-waterway-stream',
      type: 'line',
      source: SOURCE_ID,
      'source-layer': 'waterway',
      minzoom: 9,
      filter: classIn(['stream']),
      paintFrom: { 'line-color': 'waterwayStream', 'line-width': 0.9, 'line-opacity': 0.8 },
    },
    {
      id: 'vl-waterway-canal',
      type: 'line',
      source: SOURCE_ID,
      'source-layer': 'waterway',
      filter: classIn(['canal']),
      paintFrom: { 'line-color': 'waterwayCanal', 'line-width': 1.2, 'line-opacity': 0.88 },
    },
    {
      id: 'vl-waterway',
      type: 'line',
      source: SOURCE_ID,
      'source-layer': 'waterway',
      filter: classNotIn(['stream', 'canal', 'drain', 'ditch']),
      paintFrom: { 'line-color': 'waterway', 'line-width': 1.4, 'line-opacity': 0.9 },
    },
    {
      id: 'vl-building',
      type: 'fill',
      source: SOURCE_ID,
      'source-layer': 'building',
      minzoom: 12,
      paintFrom: { 'fill-color': 'building', 'fill-opacity': 0.78 },
    },
    {
      id: 'vl-building-3d',
      type: 'fill-extrusion',
      source: SOURCE_ID,
      'source-layer': 'building',
      minzoom: 13,
      layout: { visibility: 'none' },
      paintFrom: {
        'fill-extrusion-color': 'building',
        'fill-extrusion-opacity': 0.85,
      },
      paint: {
        'fill-extrusion-height': ['coalesce', ['to-number', ['get', 'render_height']], 10],
        'fill-extrusion-base': ['coalesce', ['to-number', ['get', 'render_min_height']], 0],
      },
    },
    {
      id: 'vl-rail',
      type: 'line',
      source: SOURCE_ID,
      'source-layer': 'transportation',
      layout: { visibility: 'none' },
      filter: classIn(['rail']),
      paintFrom: { 'line-color': 'rail', 'line-width': 1.1, 'line-opacity': 0.85 },
    },
    {
      id: 'vl-transit',
      type: 'line',
      source: SOURCE_ID,
      'source-layer': 'transportation',
      layout: { visibility: 'none' },
      filter: classIn(['transit', 'busway', 'bus_guideway']),
      paintFrom: { 'line-color': 'transit', 'line-width': 1.0, 'line-opacity': 0.82 },
    },
    {
      id: 'vl-ferry',
      type: 'line',
      source: SOURCE_ID,
      'source-layer': 'transportation',
      layout: { visibility: 'none' },
      filter: classIn(['ferry']),
      minzoom: 10,
      paintFrom: { 'line-color': 'ferry', 'line-width': 1.0, 'line-opacity': 0.8 },
    },
    {
      id: 'vl-path',
      type: 'line',
      source: SOURCE_ID,
      'source-layer': 'transportation',
      layout: { visibility: 'none' },
      filter: classIn(['path', 'raceway']),
      minzoom: 10,
      paintFrom: { 'line-color': 'path', 'line-width': 0.8, 'line-opacity': 0.75 },
    },
    {
      id: 'vl-track',
      type: 'line',
      source: SOURCE_ID,
      'source-layer': 'transportation',
      layout: { visibility: 'none' },
      filter: classIn(['track']),
      minzoom: 10,
      paintFrom: { 'line-color': 'track', 'line-width': 0.75, 'line-opacity': 0.72 },
    },
    {
      id: 'vl-service',
      type: 'line',
      source: SOURCE_ID,
      'source-layer': 'transportation',
      layout: { visibility: 'none' },
      filter: classIn(['service']),
      minzoom: 11,
      paintFrom: { 'line-color': 'service', 'line-width': 1.0, 'line-opacity': 0.82 },
    },
    {
      id: 'vl-minor',
      type: 'line',
      source: SOURCE_ID,
      'source-layer': 'transportation',
      layout: { visibility: 'none' },
      filter: classIn(['minor', 'minor_construction']),
      minzoom: 8,
      paintFrom: { 'line-color': 'minor', 'line-width': 1.2, 'line-opacity': 0.9 },
    },
    {
      id: 'vl-tertiary',
      type: 'line',
      source: SOURCE_ID,
      'source-layer': 'transportation',
      layout: { visibility: 'none' },
      filter: classIn(['tertiary', 'tertiary_link', 'tertiary_construction']),
      minzoom: 8,
      paintFrom: { 'line-color': 'tertiary', 'line-width': 1.3, 'line-opacity': 0.9 },
    },
    {
      id: 'vl-secondary',
      type: 'line',
      source: SOURCE_ID,
      'source-layer': 'transportation',
      layout: { visibility: 'none' },
      filter: classIn(['secondary', 'secondary_link', 'secondary_construction']),
      paintFrom: { 'line-color': 'secondary', 'line-width': 1.5, 'line-opacity': 0.92 },
    },
    {
      id: 'vl-major',
      type: 'line',
      source: SOURCE_ID,
      'source-layer': 'transportation',
      layout: { visibility: 'none' },
      filter: classIn(['primary', 'primary_link', 'primary_construction']),
      paintFrom: { 'line-color': 'major', 'line-width': 1.7, 'line-opacity': 0.95 },
    },
    {
      id: 'vl-trunk',
      type: 'line',
      source: SOURCE_ID,
      'source-layer': 'transportation',
      layout: { visibility: 'none' },
      filter: classIn(['trunk', 'trunk_link', 'trunk_construction']),
      paintFrom: { 'line-color': 'trunk', 'line-width': 2.0, 'line-opacity': 0.98 },
    },
    {
      id: 'vl-highway',
      type: 'line',
      source: SOURCE_ID,
      'source-layer': 'transportation',
      layout: { visibility: 'none' },
      filter: classIn(['motorway', 'motorway_link', 'motorway_construction']),
      paintFrom: { 'line-color': 'highway', 'line-width': 2.2, 'line-opacity': 1 },
    },
  ];

  var FAR_LAYER_IDS = LAYER_DEFS.filter(function (def) {
    return def.source === SOURCE_FAR_ID;
  }).map(function (def) { return def.id; });

  var LANDCOVER_NATIVE_IDS = LAYER_DEFS.filter(function (def) {
    return def.source === SOURCE_ID &&
      (def['source-layer'] === 'landcover' || def['source-layer'] === 'landuse');
  }).map(function (def) { return def.id; });
  var LANDCOVER_LAYER_IDS = LANDCOVER_NATIVE_IDS.slice();

  var SCENES = [
    {
      id: 'landcover-far',
      title: '地表·最远',
      blurb: 'z7 林地农田刚进瓦片',
      camera: { center: [112.5, 34.5], zoom: 7.0, pitch: 28, bearing: 0 },
    },
    {
      id: 'china',
      title: '全国',
      blurb: '矢量古卷远景',
      camera: { center: [104.0, 35.5], zoom: 4.6, pitch: 28, bearing: 0 },
    },
    {
      id: 'world',
      title: '全球',
      blurb: '球体远景',
      camera: { center: [104.0, 35.5], zoom: 1.9, pitch: 16, bearing: 18 },
    },
    {
      id: 'hexi',
      title: '河西',
      blurb: '走廊路网',
      camera: { center: [100.2, 38.5], zoom: 7.2, pitch: 42, bearing: 12 },
    },
    {
      id: 'qilian',
      title: '祁连',
      blurb: '近景山脊 · 真实海拔',
      camera: {
        center: VIEW_RELIEF.center.slice(),
        zoom: VIEW_RELIEF.zoom,
        pitch: VIEW_RELIEF.pitch,
        bearing: VIEW_RELIEF.bearing,
      },
    },
    {
      id: 'alps',
      title: '阿尔卑斯',
      blurb: 'Innsbruck · 官方同机位',
      camera: {
        center: VIEW_ALPS.center.slice(),
        zoom: VIEW_ALPS.zoom,
        pitch: VIEW_ALPS.pitch,
        bearing: VIEW_ALPS.bearing,
      },
    },
    {
      id: 'beijing',
      title: '北京',
      blurb: '建筑与街道',
      camera: { center: [116.403, 39.915], zoom: 13.6, pitch: 52, bearing: 24 },
    },
  ];

  function normalizePaint(input) {
    var out = clone(DEFAULT_PAINT);
    if (!input || typeof input !== 'object') return out;
    Object.keys(DEFAULT_PAINT).forEach(function (k) {
      var v = input[k];
      if (typeof v === 'string' && v.trim()) out[k] = v.trim();
    });
    PAINT_ALIASES.forEach(function (pair) {
      var from = pair[0];
      var to = pair[1];
      if (Object.prototype.hasOwnProperty.call(input, to)) return;
      var v = input[from];
      if (typeof v === 'string' && v.trim()) out[to] = v.trim();
    });
    return out;
  }

  function resolvePaint(def, colors) {
    var paint = {};
    if (def.paint) {
      Object.keys(def.paint).forEach(function (k) {
        paint[k] = def.paint[k];
      });
    }
    if (def.paintFrom) {
      Object.keys(def.paintFrom).forEach(function (k) {
        var spec = def.paintFrom[k];
        paint[k] = typeof spec === 'string' ? colors[spec] : spec;
      });
    }
    return paint;
  }

  function layerFromDef(def, colors) {
    var layer = { id: def.id, type: def.type };
    if (def.source) layer.source = def.source;
    if (def['source-layer']) layer['source-layer'] = def['source-layer'];
    if (def.filter) layer.filter = def.filter;
    if (def.minzoom != null) layer.minzoom = def.minzoom;
    if (def.maxzoom != null) layer.maxzoom = def.maxzoom;
    if (def.layout) layer.layout = clone(def.layout);
    layer.paint = resolvePaint(def, colors);
    if (def.id === 'vl-relief') {
      layer.paint['color-relief-color'] = elevationColorExpr(DEFAULT_ELEVATION_STOPS);
    }
    return layer;
  }

  /**
   * 真实地图海拔设色（对照中国地势图）：
   * 东部平原绿、黄土/高原黄褐、高山棕、雪线以上才发白。
   * DEM 海面多为 0 m，海色靠矢量海洋层，不靠 0 m 设色。
   */
  var DEFAULT_ELEVATION_STOPS = [
    { h: -500, color: '#1a4f66', label: '海' },
    { h: 5, color: '#3f8f4a', label: '平原' },
    { h: 200, color: '#7aaa52', label: '低丘' },
    { h: 600, color: '#c4b45c', label: '丘陵' },
    { h: 1200, color: '#d2b46a', label: '黄土' },
    { h: 2000, color: '#c49a58', label: '高原' },
    { h: 3200, color: '#a07a48', label: '高山' },
    { h: 4200, color: '#8a7358', label: '高原面' },
    { h: 5200, color: '#9a948c', label: '极高' },
    { h: 6000, color: '#e6e4dc', label: '雪' },
  ];

  function cloneStops(stops) {
    return (stops || DEFAULT_ELEVATION_STOPS).map(function (s) {
      return { h: s.h, color: s.color, label: s.label };
    });
  }

  function elevationColorExpr(stops) {
    var expr = ['interpolate', ['linear'], ['elevation']];
    cloneStops(stops).forEach(function (s) {
      expr.push(s.h, s.color);
    });
    return expr;
  }

  function applyElevationRamp(map, stops) {
    if (!map || typeof map.setPaintProperty !== 'function') return;
    if (typeof map.getLayer === 'function' && !map.getLayer('vl-relief')) return;
    map.setPaintProperty('vl-relief', 'color-relief-color', elevationColorExpr(stops));
  }

  function setRelief(map, on) {
    if (!map || typeof map.setLayoutProperty !== 'function') return;
    if (typeof map.getLayer === 'function' && !map.getLayer('vl-relief')) return;
    map.setLayoutProperty('vl-relief', 'visibility', on ? 'visible' : 'none');
  }

  function contourLayerDefs() {
    return [
      {
        id: 'vl-contour',
        type: 'line',
        source: CONTOUR_SOURCE_ID,
        'source-layer': CONTOUR_LAYER,
        minzoom: 4,
        filter: ['>', ['get', 'ele'], 0],
        paint: {
          'line-color': ['match', ['get', 'level'], 1, '#4a3824', '#6a5640'],
          'line-width': ['match', ['get', 'level'], 1, 1.15, 0.4],
          'line-opacity': ['match', ['get', 'level'], 1, 0.72, 0.38],
        },
      },
      {
        id: 'vl-contour-label',
        type: 'symbol',
        source: CONTOUR_SOURCE_ID,
        'source-layer': CONTOUR_LAYER,
        minzoom: 8,
        filter: ['all', ['>', ['get', 'level'], 0], ['>', ['get', 'ele'], 0]],
        layout: {
          'symbol-placement': 'line',
          'text-pitch-alignment': 'viewport',
          'symbol-spacing': 420,
          'text-size': 10,
          'text-padding': 2,
          'text-max-angle': 35,
          'text-font': ['Noto Sans Regular'],
          'text-field': [
            'concat',
            ['number-format', ['get', 'ele'], { 'max-fraction-digits': 0 }],
            ' m',
          ],
        },
        paint: {
          'text-color': '#4a3824',
          'text-halo-color': 'rgba(236, 228, 212, 0.86)',
          'text-halo-width': 1.15,
          'text-opacity': 0.9,
        },
      },
    ];
  }

  function setContours(map, on) {
    if (!map || typeof map.setLayoutProperty !== 'function') return;
    var vis = on ? 'visible' : 'none';
    ['vl-contour', 'vl-contour-label'].forEach(function (id) {
      if (typeof map.getLayer === 'function' && !map.getLayer(id)) return;
      map.setLayoutProperty(id, 'visibility', vis);
    });
  }

  function absolutizeTileUrl(url, origin) {
    var s = String(url || '');
    var proxied = s.match(/^\/t\/([^/?#]+)\/(.+)$/);
    if (proxied) {
      var base = typeof origin === 'string' ? origin : '';
      if (!base && typeof location !== 'undefined' && location.origin) {
        base = location.origin;
      }
      if (base) return String(base).replace(/\/$/, '') + s;
      return 'https://' + proxied[1] + '/' + proxied[2];
    }
    return s;
  }

  function withDemPreset(tileCfg, presetId) {
    var id = DEM_PRESETS[presetId] ? presetId : DEFAULT_DEM_PRESET;
    var base = tileCfg && typeof tileCfg === 'object' ? assign({}, tileCfg) : {};
    base.demPreset = id;
    if (id === 'terrarium' && base.terrain && Array.isArray(base.terrain.tiles) && base.terrain.tiles.length) {
      return base;
    }
    var preset = DEM_PRESETS[id];
    base.terrain = {
      enabled: true,
      tiles: preset.tiles.slice(),
      tileSize: preset.tileSize,
      maxzoom: preset.maxzoom,
      visualMaxzoom: preset.visualMaxzoom,
      encoding: preset.encoding || 'terrarium',
      attribution: preset.attribution,
      sourceId: TERRAIN_SOURCE_ID,
    };
    return base;
  }

  function terrainSource(tileCfg, opts) {
    opts = opts || {};
    var t = (tileCfg && tileCfg.terrain) || {};
    var raw = Array.isArray(t.tiles) && t.tiles.length ? t.tiles : [
      'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',
    ];
    var tiles = raw.map(absolutizeTileUrl);
    var src = {
      type: 'raster-dem',
      tiles: tiles,
      tileSize: t.tileSize || 256,
      maxzoom: opts.maxzoom != null ? opts.maxzoom : (t.maxzoom || 15),
      encoding: 'terrarium',
      attribution: t.attribution || '© AWS Terrain Tiles (Terrarium)',
    };
    if (opts.minzoom != null) src.minzoom = opts.minzoom;
    return src;
  }

  function demTileUrl(tileCfg) {
    return terrainSource(tileCfg).tiles[0];
  }

  function visualDemMaxzoom(tileCfg) {
    var t = (tileCfg && tileCfg.terrain) || {};
    var mesh = t.maxzoom != null ? t.maxzoom : 15;
    var visual = t.visualMaxzoom != null ? t.visualMaxzoom : TERRAIN_VISUAL_MAXZOOM;
    return Math.min(visual, mesh);
  }

  function replaceTerrainSources(map, tileCfg, opts) {
    opts = opts || {};
    if (!map || typeof map.addSource !== 'function') return;
    var colors = normalizePaint(opts.paint);
    var elevStops = Array.isArray(opts.elevStops) && opts.elevStops.length
      ? opts.elevStops
      : DEFAULT_ELEVATION_STOPS;
    if (typeof map.setTerrain === 'function') {
      try { map.setTerrain(null); } catch (e0) { /* already flat */ }
    }
    ['vl-contour-label', 'vl-contour', 'vl-hillshade', 'vl-relief'].forEach(function (id) {
      if (typeof map.getLayer === 'function' && map.getLayer(id)) {
        map.removeLayer(id);
      }
    });
    [CONTOUR_SOURCE_ID, TERRAIN_VISUAL_SOURCE_ID, TERRAIN_SOURCE_ID].forEach(function (id) {
      if (typeof map.getSource === 'function' && map.getSource(id)) {
        map.removeSource(id);
      }
    });
    map.addSource(TERRAIN_SOURCE_ID, terrainSource(tileCfg));
    map.addSource(TERRAIN_VISUAL_SOURCE_ID, terrainSource(tileCfg, { maxzoom: visualDemMaxzoom(tileCfg) }));
    var reliefDef = LAYER_DEFS.filter(function (d) { return d.id === 'vl-relief'; })[0];
    var hsDef = LAYER_DEFS.filter(function (d) { return d.id === 'vl-hillshade'; })[0];
    var relief = layerFromDef(reliefDef, colors);
    relief.paint['color-relief-color'] = elevationColorExpr(elevStops);
    relief.layout = relief.layout || {};
    relief.layout.visibility = opts.reliefOn === false ? 'none' : 'visible';
    var hs = layerFromDef(hsDef, colors);
    hs.layout = hs.layout || {};
    hs.layout.visibility = opts.hillshadeOn === false ? 'none' : 'visible';
    var beforeRelief = map.getLayer && map.getLayer('vl-wood-far') ? 'vl-wood-far' : undefined;
    var beforeHs = map.getLayer && map.getLayer('vl-water-ocean') ? 'vl-water-ocean' : undefined;
    map.addLayer(relief, beforeRelief);
    map.addLayer(hs, beforeHs);
  }

  function buildStyle(opts) {
    opts = opts || {};
    var colors = normalizePaint(opts.paint);
    var tileCfg = opts.tileConfig || {};
    var layers = LAYER_DEFS.map(function (def) {
      return layerFromDef(def, colors);
    });
    var contourTiles = Array.isArray(opts.contourTiles) ? opts.contourTiles.filter(Boolean) : [];
    if (contourTiles.length) {
      var extra = contourLayerDefs();
      var hsIdx = -1;
      layers.forEach(function (layer, i) {
        if (layer.id === 'vl-hillshade') hsIdx = i;
      });
      if (hsIdx >= 0) {
        extra.unshift(hsIdx + 1, 0);
        layers.splice.apply(layers, extra);
      } else {
        layers = layers.concat(extra);
      }
    }
    var farSource = {
      type: 'geojson',
      data: farLandcoverData(opts.farLandcover),
      maxzoom: LANDCOVER_NATIVE_MINZOOM,
      tolerance: 0,
      buffer: 256,
      attribution:
        '<a href="https://protomaps.com">Protomaps</a> © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    };
    var sources = {
      openmaptiles: {
        type: 'vector',
        url: TILEJSON_URL,
        attribution:
          '<a href="https://openfreemap.org">OpenFreeMap</a> © <a href="https://openmaptiles.org">OpenMapTiles</a> © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      },
      landcoverFar: farSource,
      polarIce: {
        type: 'geojson',
        data: POLAR_ICE_URL,
        maxzoom: POLAR_ICE_MAXZOOM,
      },
      terrain: terrainSource(tileCfg),
      terrainVisual: terrainSource(tileCfg, { maxzoom: visualDemMaxzoom(tileCfg) }),
    };
    if (contourTiles.length) {
      sources[CONTOUR_SOURCE_ID] = {
        type: 'vector',
        tiles: contourTiles.slice(),
        maxzoom: 15,
      };
    }
    var style = {
      version: 8,
      name: 'antique-vector-layers',
      terrain: {
        source: TERRAIN_SOURCE_ID,
        exaggeration: TERRAIN_EXAGGERATION,
      },
      sources: sources,
      layers: layers,
    };
    if (contourTiles.length) style.glyphs = GLYPHS_URL;
    return style;
  }

  function applyVectorPaint(map, paint, keys) {
    if (!map || typeof map.setPaintProperty !== 'function') {
      throw new Error('applyVectorPaint needs a MapStage map');
    }
    var colors = normalizePaint(paint);
    var allowed = null;
    if (Array.isArray(keys)) {
      allowed = {};
      keys.forEach(function (key) { allowed[key] = true; });
    }
    LAYER_DEFS.forEach(function (def) {
      if (!def.paintFrom) return;
      if (typeof map.getLayer === 'function' && !map.getLayer(def.id)) return;
      Object.keys(def.paintFrom).forEach(function (prop) {
        var spec = def.paintFrom[prop];
        if (typeof spec !== 'string') return;
        if (allowed && !allowed[spec]) return;
        map.setPaintProperty(def.id, prop, colors[spec]);
      });
    });
    return colors;
  }

  function setBuildingExtrusion(map, on) {
    if (!map || typeof map.setLayoutProperty !== 'function') return;
    if (typeof map.getLayer === 'function' && !map.getLayer('vl-building-3d')) return;
    map.setLayoutProperty('vl-building-3d', 'visibility', on ? 'visible' : 'none');
    if (map.getLayer('vl-building')) {
      map.setLayoutProperty('vl-building', 'visibility', on ? 'none' : 'visible');
    }
  }

  function setHillshade(map, on) {
    if (!map || typeof map.setLayoutProperty !== 'function') return;
    if (typeof map.getLayer === 'function' && !map.getLayer('vl-hillshade')) return;
    map.setLayoutProperty('vl-hillshade', 'visibility', on ? 'visible' : 'none');
  }

  var ROAD_LAYER_IDS = LAYER_DEFS.filter(function (def) {
    return def['source-layer'] === 'transportation';
  }).map(function (def) { return def.id; });

  function setRoads(map, on) {
    if (!map || typeof map.setLayoutProperty !== 'function') return;
    var vis = on ? 'visible' : 'none';
    ROAD_LAYER_IDS.forEach(function (id) {
      if (typeof map.getLayer === 'function' && !map.getLayer(id)) return;
      map.setLayoutProperty(id, 'visibility', vis);
    });
  }

  function setLandcover(map, on) {
    if (!map || typeof map.setLayoutProperty !== 'function') return;
    var vis = on ? 'visible' : 'none';
    LANDCOVER_LAYER_IDS.forEach(function (id) {
      if (typeof map.getLayer === 'function' && !map.getLayer(id)) return;
      map.setLayoutProperty(id, 'visibility', vis);
    });
  }

  function farLandcoverData(mode) {
    if (mode === 'full') return LANDCOVER_FAR_URL;
    return EMPTY_FAR_FC;
  }

  function setFarLandcover(map, on) {
    if (!map || typeof map.setLayoutProperty !== 'function') return;
    var vis = on === 'full' ? 'visible' : 'none';
    FAR_LAYER_IDS.forEach(function (id) {
      if (typeof map.getLayer === 'function' && !map.getLayer(id)) return;
      map.setLayoutProperty(id, 'visibility', vis);
    });
    var src = typeof map.getSource === 'function' ? map.getSource(SOURCE_FAR_ID) : null;
    if (src && typeof src.setData === 'function') {
      src.setData(farLandcoverData(on));
    }
  }

  function normalizeCss(input) {
    var out = clone(DEFAULT_CSS);
    if (!input || typeof input !== 'object') return out;
    ['sepia', 'saturate', 'contrast', 'brightness', 'hueRotate', 'warmTintAlpha', 'vignetteStrength'].forEach(function (k) {
      var v = Number(input[k]);
      if (isFinite(v)) out[k] = v;
    });
    if (typeof input.warmTintColor === 'string' && input.warmTintColor.trim()) {
      out.warmTintColor = input.warmTintColor.trim();
    }
    return out;
  }

  function exportPreset(paint, opts) {
    opts = opts || {};
    var out = {
      id: 'antique-vector-layers',
      version: 2,
      vector: normalizePaint(paint),
    };
    if (typeof opts.skin === 'string' && opts.skin) out.skin = opts.skin;
    if (opts.css) out.css = normalizeCss(opts.css);
    return out;
  }

  function colorKeys() {
    return Object.keys(DEFAULT_PAINT);
  }

  return {
    TILEJSON_URL: TILEJSON_URL,
    SOURCE_ID: SOURCE_ID,
    SOURCE_FAR_ID: SOURCE_FAR_ID,
    SOURCE_POLAR_ID: SOURCE_POLAR_ID,
    POLAR_ICE_URL: POLAR_ICE_URL,
    POLAR_ICE_MAXZOOM: POLAR_ICE_MAXZOOM,
    LANDCOVER_NATIVE_MINZOOM: LANDCOVER_NATIVE_MINZOOM,
    LANDCOVER_FAR_URL: LANDCOVER_FAR_URL,
    LANDCOVER_GLOBE_URL: LANDCOVER_GLOBE_URL,
    TERRAIN_SOURCE_ID: TERRAIN_SOURCE_ID,
    TERRAIN_VISUAL_SOURCE_ID: TERRAIN_VISUAL_SOURCE_ID,
    TERRAIN_VISUAL_MAXZOOM: TERRAIN_VISUAL_MAXZOOM,
    TERRAIN_MESH_MINZOOM: TERRAIN_MESH_MINZOOM,
    TERRAIN_EXAGGERATION: TERRAIN_EXAGGERATION,
    TERRAIN_REAL_EXAGGERATION: TERRAIN_REAL_EXAGGERATION,
    VIEW_RELIEF: VIEW_RELIEF,
    VIEW_ALPS: VIEW_ALPS,
    DEFAULT_DEM_PRESET: DEFAULT_DEM_PRESET,
    DEM_PRESETS: DEM_PRESETS,
    HILLSHADE_PAINT: HILLSHADE_PAINT,
    CONTOUR_SOURCE_ID: CONTOUR_SOURCE_ID,
    CONTOUR_LAYER: CONTOUR_LAYER,
    GLYPHS_URL: GLYPHS_URL,
    CONTOUR_THRESHOLDS: CONTOUR_THRESHOLDS,
    CONTOUR_OPTIONS: CONTOUR_OPTIONS,
    DEFAULT_PAINT: DEFAULT_PAINT,
    DEFAULT_CSS: DEFAULT_CSS,
    SKINS: SKINS,
    COLOR_FIELDS: COLOR_FIELDS,
    LAYER_DEFS: LAYER_DEFS,
    FAR_LAYER_IDS: FAR_LAYER_IDS,
    LANDCOVER_NATIVE_IDS: LANDCOVER_NATIVE_IDS,
    LANDCOVER_LAYER_IDS: LANDCOVER_LAYER_IDS,
    SCENES: SCENES,
    normalizePaint: normalizePaint,
    normalizeCss: normalizeCss,
    absolutizeTileUrl: absolutizeTileUrl,
    demTileUrl: demTileUrl,
    visualDemMaxzoom: visualDemMaxzoom,
    withDemPreset: withDemPreset,
    replaceTerrainSources: replaceTerrainSources,
    buildStyle: buildStyle,
    applyVectorPaint: applyVectorPaint,
    setBuildingExtrusion: setBuildingExtrusion,
    setHillshade: setHillshade,
    setRoads: setRoads,
    setLandcover: setLandcover,
    setFarLandcover: setFarLandcover,
    ROAD_LAYER_IDS: ROAD_LAYER_IDS,
    DEFAULT_ELEVATION_STOPS: DEFAULT_ELEVATION_STOPS,
    elevationColorExpr: elevationColorExpr,
    applyElevationRamp: applyElevationRamp,
    setRelief: setRelief,
    setContours: setContours,
    contourLayerDefs: contourLayerDefs,
    exportPreset: exportPreset,
    colorKeys: colorKeys,
  };
});
