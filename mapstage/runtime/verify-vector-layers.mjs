/**
 * Vector layer color demo: shipped applyVectorPaint + OpenMapTiles style.
 *
 *   node runtime/verify-vector-layers.mjs
 *   node runtime/verify-vector-layers.mjs http://127.0.0.1:8771
 */
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { loadPlaywright } from './lib/pw.mjs';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..');
const paintPath = join(repo, 'tuner', 'assets', 'vector-paint.js');
const htmlPath = join(repo, 'tuner', 'vector-layers.html');
const VP = require(paintPath);

function fakeMap() {
  const layers = {};
  const layout = {};
  VP.LAYER_DEFS.forEach(function (d) {
    layers[d.id] = {};
    layout[d.id] = { visibility: (d.layout && d.layout.visibility) || 'visible' };
  });
  return {
    layers,
    layout,
    getLayer: function (id) { return layers[id] ? { id: id } : undefined; },
    setPaintProperty: function (id, prop, value) {
      if (!layers[id]) layers[id] = {};
      layers[id][prop] = value;
    },
    getPaintProperty: function (id, prop) {
      return layers[id] && layers[id][prop];
    },
    setLayoutProperty: function (id, prop, value) {
      if (!layout[id]) layout[id] = {};
      layout[id][prop] = value;
    },
    getLayoutProperty: function (id, prop) {
      return layout[id] && layout[id][prop];
    },
  };
}

assert.equal(typeof VP.applyVectorPaint, 'function');
assert.equal(typeof VP.buildStyle, 'function');
assert.ok(VP.colorKeys().includes('highway'));
assert.ok(VP.colorKeys().includes('building'));
assert.ok(VP.colorKeys().includes('wood'));
assert.ok(VP.colorKeys().includes('water'));
assert.ok(VP.colorKeys().includes('sand'));
assert.ok(VP.colorKeys().includes('trunk'));
assert.ok(VP.colorKeys().includes('wetland'));
assert.ok(VP.colorKeys().includes('boundaryProvince'));
VP.COLOR_FIELDS.forEach(function (f) {
  assert.ok(VP.colorKeys().includes(f.key), 'missing color key ' + f.key);
});
assert.notEqual(VP.DEFAULT_PAINT.sand, VP.DEFAULT_PAINT.rock);
assert.notEqual(VP.DEFAULT_PAINT.trunk, VP.DEFAULT_PAINT.highway);

const style = VP.buildStyle({ paint: VP.DEFAULT_PAINT });
assert.equal(style.sources.openmaptiles.url, VP.TILEJSON_URL);
assert.equal(style.sources.terrain.encoding, 'terrarium');
assert.equal(style.sources.terrainVisual.encoding, 'terrarium');
assert.equal(style.terrain.exaggeration, 1.6);
assert.equal(style.terrain.source, 'terrain');
assert.equal(VP.TERRAIN_VISUAL_SOURCE_ID, 'terrainVisual');
assert.equal(VP.TERRAIN_REAL_EXAGGERATION, 1);
assert.ok(VP.SCENES.some(function (s) {
  return s.id === 'qilian' && s.camera.zoom >= 10 && s.camera.pitch >= 70;
}));
const hs = style.layers.filter(function (l) { return l.id === 'vl-hillshade'; })[0];
const relief = style.layers.filter(function (l) { return l.id === 'vl-relief'; })[0];
assert.equal(hs.source, VP.TERRAIN_VISUAL_SOURCE_ID);
assert.equal(relief.source, VP.TERRAIN_VISUAL_SOURCE_ID);
assert.notEqual(hs.source, style.terrain.source);
assert.notStrictEqual(style.sources.terrain, style.sources.terrainVisual);
assert.deepEqual(style.sources.terrain.tiles, style.sources.terrainVisual.tiles);
assert.equal(VP.TERRAIN_VISUAL_MAXZOOM, 12);
assert.ok(
  VP.VIEW_RELIEF.zoom <= VP.TERRAIN_VISUAL_MAXZOOM,
  'qilian must stay within native hillshade LOD'
);
assert.equal(style.sources.terrainVisual.maxzoom, VP.TERRAIN_VISUAL_MAXZOOM);
assert.ok(style.sources.terrain.maxzoom > style.sources.terrainVisual.maxzoom);
assert.equal(VP.DEFAULT_DEM_PRESET, 'mapterhorn');
assert.equal(typeof VP.withDemPreset, 'function');
assert.equal(typeof VP.replaceTerrainSources, 'function');
assert.equal(VP.DEM_PRESETS.mapterhorn.tileSize, 512);
assert.equal(VP.DEM_PRESETS.mapterhorn.encoding, 'terrarium');
assert.match(VP.DEM_PRESETS.mapterhorn.tiles[0], /tiles\.mapterhorn\.com/);
assert.ok(VP.SCENES.some(function (s) {
  return s.id === 'alps' && s.camera.zoom > 16 && s.camera.pitch >= 60;
}));
const mhStyle = VP.buildStyle({
  paint: VP.DEFAULT_PAINT,
  tileConfig: VP.withDemPreset({}, VP.DEFAULT_DEM_PRESET),
});
assert.equal(mhStyle.sources.terrain.tileSize, 512);
assert.equal(mhStyle.sources.terrain.maxzoom, 17);
assert.equal(mhStyle.sources.terrainVisual.maxzoom, 16);
assert.equal(mhStyle.sources.terrain.encoding, 'terrarium');
assert.match(mhStyle.sources.terrain.tiles[0], /tiles\.mapterhorn\.com/);
assert.match(mhStyle.sources.terrain.attribution, /Mapterhorn/);
assert.ok(
  mhStyle.sources.terrainVisual.maxzoom > VP.TERRAIN_VISUAL_MAXZOOM,
  'Mapterhorn visual LOD should exceed Terrarium 12'
);
const keptTerrarium = VP.withDemPreset({
  terrain: { tiles: ['/t/elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png'] },
}, 'terrarium');
assert.match(keptTerrarium.terrain.tiles[0], /elevation-tiles-prod/);
assert.equal(keptTerrarium.demPreset, 'terrarium');
const visualOverride = VP.buildStyle({
  paint: VP.DEFAULT_PAINT,
  tileConfig: { terrain: { visualMaxzoom: 10, maxzoom: 15 } },
});
assert.equal(visualOverride.sources.terrainVisual.maxzoom, 10);
assert.equal(visualOverride.sources.terrain.maxzoom, 15);
const visualClamped = VP.buildStyle({
  paint: VP.DEFAULT_PAINT,
  tileConfig: { terrain: { visualMaxzoom: 20, maxzoom: 15 } },
});
assert.equal(visualClamped.sources.terrainVisual.maxzoom, 15);
assert.equal(visualClamped.sources.terrain.maxzoom, 15);
assert.equal(relief.paint['color-relief-opacity'], 1);
assert.equal((relief.layout && relief.layout.visibility) || 'visible', 'visible');
const meshDemLayerIds = style.layers
  .filter(function (l) { return l.source === VP.TERRAIN_SOURCE_ID; })
  .map(function (l) { return l.id; });
const visualDemLayerIds = style.layers
  .filter(function (l) { return l.source === VP.TERRAIN_VISUAL_SOURCE_ID; })
  .map(function (l) { return l.id; })
  .sort();
assert.deepEqual(meshDemLayerIds, []);
assert.deepEqual(visualDemLayerIds, ['vl-hillshade', 'vl-relief']);
assert.equal(VP.CONTOUR_OPTIONS.multiplier, 1);
assert.deepEqual(VP.CONTOUR_THRESHOLDS[10], [50, 200]);
assert.ok(!style.sources.contours, 'contours stay opt-in via contourTiles');
assert.ok(!style.layers.some(function (l) { return l.id === 'vl-contour'; }));
const withContours = VP.buildStyle({
  paint: VP.DEFAULT_PAINT,
  contourTiles: ['mlcontour://{z}/{x}/{y}'],
});
assert.equal(withContours.sources.contours.type, 'vector');
assert.deepEqual(withContours.sources.contours.tiles, ['mlcontour://{z}/{x}/{y}']);
assert.equal(withContours.glyphs, VP.GLYPHS_URL);
const contourIds = withContours.layers.map(function (l) { return l.id; });
assert.ok(contourIds.indexOf('vl-contour') > contourIds.indexOf('vl-hillshade'));
assert.ok(contourIds.indexOf('vl-water') > contourIds.indexOf('vl-contour'));
assert.ok(contourIds.indexOf('vl-contour-label') > contourIds.indexOf('vl-contour'));
const cl = withContours.layers.filter(function (l) { return l.id === 'vl-contour'; })[0];
assert.equal(cl.type, 'line');
assert.equal(cl.source, 'contours');
assert.equal(cl['source-layer'], 'contours');
assert.equal(cl.minzoom, 4);
assert.deepEqual(cl.filter, ['>', ['get', 'ele'], 0]);
const visualDemWithContours = withContours.layers
  .filter(function (l) { return l.source === VP.TERRAIN_VISUAL_SOURCE_ID; })
  .map(function (l) { return l.id; })
  .sort();
assert.deepEqual(visualDemWithContours, ['vl-hillshade', 'vl-relief']);
assert.equal(hs.paint['hillshade-exaggeration'], 0.42);
assert.equal(hs.paint['hillshade-illumination-direction'], 315);
assert.equal(
  VP.absolutizeTileUrl('/t/s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'),
  'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'
);
assert.equal(
  VP.absolutizeTileUrl(
    '/t/s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png',
    'http://127.0.0.1:8780'
  ),
  'http://127.0.0.1:8780/t/s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'
);
const proxiedStyle = VP.buildStyle({
  paint: VP.DEFAULT_PAINT,
  tileConfig: {
    terrain: {
      tiles: ['/t/elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png'],
    },
  },
});
assert.match(proxiedStyle.sources.terrain.tiles[0], /^https:\/\//);
assert.match(proxiedStyle.sources.terrainVisual.tiles[0], /^https:\/\//);
assert.notStrictEqual(proxiedStyle.sources.terrain, proxiedStyle.sources.terrainVisual);
assert.deepEqual(proxiedStyle.sources.terrain.tiles, proxiedStyle.sources.terrainVisual.tiles);
assert.equal(proxiedStyle.sources.terrainVisual.maxzoom, VP.TERRAIN_VISUAL_MAXZOOM);
assert.equal(proxiedStyle.sources.terrain.maxzoom, 15);
const ids = style.layers.map(function (l) { return l.id; });
assert.ok(ids.includes('vl-highway'));
assert.ok(ids.includes('vl-building'));
assert.ok(ids.includes('vl-wood'));
assert.ok(ids.includes('vl-wood-far'));
assert.ok(ids.includes('vl-farmland-far'));
assert.deepEqual(VP.FAR_LAYER_IDS, [
  'vl-wood-far', 'vl-grass-far', 'vl-scrub-far', 'vl-farmland-far', 'vl-rock-far', 'vl-urban-far',
]);
assert.deepEqual(VP.LANDCOVER_LAYER_IDS, [
  'vl-wood', 'vl-grass', 'vl-farmland', 'vl-rock', 'vl-sand', 'vl-wetland', 'vl-ice',
  'vl-urban', 'vl-commercial', 'vl-industrial', 'vl-retail',
]);
assert.equal(typeof VP.setLandcover, 'function');
assert.equal(typeof VP.setFarLandcover, 'function');
assert.equal(style.sources.landcoverFar.type, 'geojson');
assert.equal(style.sources.landcoverFar.maxzoom, VP.LANDCOVER_NATIVE_MINZOOM);
assert.equal(style.sources.landcoverFar.data.type, 'FeatureCollection');
assert.deepEqual(style.sources.landcoverFar.data.features, []);
assert.equal(style.layers.filter(function (l) { return l.id === 'vl-wood-far'; })[0].layout.visibility, 'none');
const globeStyle = VP.buildStyle({ paint: VP.DEFAULT_PAINT, farLandcover: 'globe' });
assert.deepEqual(globeStyle.sources.landcoverFar.data.features, []);
const fullStyle = VP.buildStyle({ paint: VP.DEFAULT_PAINT, farLandcover: 'full' });
assert.match(String(fullStyle.sources.landcoverFar.data), /assets\/landcover-lowzoom\.geojson/);
const globeFc = JSON.parse(readFileSync(join(repo, 'tuner', 'assets', 'landcover-globe.geojson'), 'utf8'));
assert.ok(globeFc.features.length > 50, 'globe landcover too thin: ' + globeFc.features.length);
const globeKinds = {};
let globeVerts = 0;
globeFc.features.forEach(function (feat) {
  const k = feat.properties && feat.properties.kind || '?';
  globeKinds[k] = (globeKinds[k] || 0) + 1;
  const walk = function (c) {
    if (typeof c[0] === 'number') return 1;
    return c.reduce(function (n, x) { return n + walk(x); }, 0);
  };
  globeVerts += walk(feat.geometry.coordinates);
});
assert.ok(globeVerts < 80000, 'globe landcover still too dense: ' + globeVerts);
assert.ok(globeKinds.forest > 0 && globeKinds.grassland > 0 && globeKinds.farmland > 0);
assert.equal(globeStyle.sources.landcoverFar.tolerance, 0);
assert.equal(globeStyle.sources.landcoverFar.buffer, 256);
assert.equal(style.sources.landcoverFar.tolerance, 0);

function globePointInRing(lng, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const hit = ((yi > lat) !== (yj > lat)) &&
      (lng < (xj - xi) * (lat - yi) / ((yj - yi) || 1e-18) + xi);
    if (hit) inside = !inside;
  }
  return inside;
}
function globeCoverKinds(lng, lat) {
  const kinds = [];
  globeFc.features.forEach(function (feat) {
    const geom = feat.geometry;
    if (!geom) return;
    const polys = geom.type === 'Polygon' ? [geom.coordinates]
      : geom.type === 'MultiPolygon' ? geom.coordinates : [];
    polys.forEach(function (poly) {
      if (poly && poly[0] && globePointInRing(lng, lat, poly[0])) {
        kinds.push((feat.properties && feat.properties.kind) || '?');
      }
    });
  });
  return kinds;
}
assert.ok(globeCoverKinds(120.4, 23.5).length > 0, 'Taiwan west must stay filled on globe landcover');
assert.ok(globeCoverKinds(121.5, 23.5).indexOf('forest') >= 0, 'Taiwan east forest missing on globe landcover');
assert.ok(globeCoverKinds(118.1, 24.48).length > 0, 'Xiamen must stay filled on globe landcover');
assert.ok(globeCoverKinds(109.7, 19.2).length > 0, 'Hainan must stay filled on globe landcover');
const farFc = JSON.parse(readFileSync(join(repo, 'tuner', 'assets', 'landcover-lowzoom.geojson'), 'utf8'));
assert.ok(farFc.features.length > 200, 'far landcover should be global, got ' + farFc.features.length);
function firstLon(feat) {
  let c = feat.geometry && feat.geometry.coordinates;
  while (Array.isArray(c) && Array.isArray(c[0])) c = c[0];
  return Array.isArray(c) ? c[0] : null;
}
const lons = farFc.features.map(firstLon).filter(function (v) { return typeof v === 'number'; });
assert.ok(lons.some(function (v) { return v < 0; }), 'expected features west of Greenwich');
assert.ok(lons.some(function (v) { return v > 140; }), 'expected features east of 140E');
const woodFar = style.layers.filter(function (l) { return l.id === 'vl-wood-far'; })[0];
assert.equal(woodFar.source, 'landcoverFar');
assert.equal(woodFar.maxzoom, 7);
['wood', 'grass', 'farmland', 'rock', 'urban'].forEach(function (kind) {
  const farLayer = style.layers.filter(function (l) { return l.id === 'vl-' + kind + '-far'; })[0];
  const nativeLayer = style.layers.filter(function (l) { return l.id === 'vl-' + kind; })[0];
  assert.equal(farLayer.source, VP.SOURCE_FAR_ID);
  assert.equal(farLayer.maxzoom, VP.LANDCOVER_NATIVE_MINZOOM);
  assert.equal(nativeLayer.source, VP.SOURCE_ID);
  assert.equal(nativeLayer.minzoom, VP.LANDCOVER_NATIVE_MINZOOM);
});
assert.ok(ids.includes('vl-water'));
assert.ok(ids.includes('vl-water-ocean'));
assert.ok(ids.includes('vl-sand'));
assert.ok(ids.includes('vl-trunk'));
assert.ok(ids.includes('vl-boundary-province'));
assert.ok(ids.includes('vl-boundary'));
assert.ok(ids.includes('vl-polar-ice'));
assert.ok(ids.indexOf('vl-relief') > ids.indexOf('vl-background'));
assert.ok(ids.indexOf('vl-wood-far') > ids.indexOf('vl-relief'), 'landcover overlays elevation tint');
assert.ok(ids.indexOf('vl-water') > ids.indexOf('vl-relief'), 'water must cover relief at the coast');
assert.ok(ids.indexOf('vl-water') > ids.indexOf('vl-hillshade'));
assert.ok(ids.indexOf('vl-polar-ice') > ids.indexOf('vl-relief'));
assert.ok(ids.indexOf('vl-hillshade') > ids.indexOf('vl-polar-ice'));
assert.ok(ids.indexOf('vl-highway') > ids.indexOf('vl-water'));
assert.equal(style.sources.polarIce.type, 'geojson');
assert.match(String(style.sources.polarIce.data), /polar-ice\.geojson/);
const polarFc = JSON.parse(readFileSync(join(repo, 'tuner', 'assets', 'polar-ice.geojson'), 'utf8'));
assert.ok(polarFc.features.length >= 2);
const polarNames = polarFc.features.map(function (f) { return f.properties && f.properties.name; });
assert.ok(polarNames.indexOf('ATA') >= 0 && polarNames.indexOf('GRL') >= 0);
assert.ok(polarNames.indexOf('ARCTIC_W') < 0);
assert.ok(polarNames.indexOf('ARCTIC_E') < 0);
const ata = polarFc.features.filter(function (f) { return f.properties.name === 'ATA'; })[0];
const ataPolys = ata.geometry.type === 'Polygon' ? [ata.geometry.coordinates] : ata.geometry.coordinates;
assert.ok(ataPolys.some(function (poly) { return poly.length >= 2; }), 'Antarctica fill must punch a pole hole');
const highway = style.layers.filter(function (l) { return l.id === 'vl-highway'; })[0];
assert.equal(highway['source-layer'], 'transportation');
assert.equal(highway.paint['line-color'], VP.DEFAULT_PAINT.highway);
assert.equal(JSON.stringify(highway.filter).indexOf('trunk') < 0, true);
assert.equal(highway.layout.visibility, 'none');
VP.ROAD_LAYER_IDS.forEach(function (id) {
  const layer = style.layers.filter(function (l) { return l.id === id; })[0];
  assert.equal(layer.layout.visibility, 'none', id + ' should start hidden');
});
const defaultRoads = fakeMap();
assert.equal(defaultRoads.getLayoutProperty('vl-highway', 'visibility'), 'none');
assert.equal(defaultRoads.getLayoutProperty('vl-rail', 'visibility'), 'none');
const rock = style.layers.filter(function (l) { return l.id === 'vl-rock'; })[0];
assert.equal(JSON.stringify(rock.filter).indexOf('sand') < 0, true);
const sand = style.layers.filter(function (l) { return l.id === 'vl-sand'; })[0];
assert.equal(sand.paint['fill-color'], VP.DEFAULT_PAINT.sand);
const ferry = style.layers.filter(function (l) { return l.id === 'vl-ferry'; })[0];
assert.equal(ferry.minzoom, 10);
const trunk = style.layers.filter(function (l) { return l.id === 'vl-trunk'; })[0];
assert.equal(trunk.paint['line-color'], VP.DEFAULT_PAINT.trunk);
const wood = style.layers.filter(function (l) { return l.id === 'vl-wood'; })[0];
assert.equal(wood['source-layer'], 'landcover');
const aliased = VP.normalizePaint({ rock: '#abcdef', highway: '#112233', water: '#004466' });
assert.equal(aliased.sand, '#abcdef');
assert.equal(aliased.trunk, '#112233');
assert.equal(aliased.wetland, '#004466');
assert.equal(aliased.waterOcean, '#004466');
const fullPaint = VP.normalizePaint(VP.DEFAULT_PAINT);
assert.equal(fullPaint.sand, VP.DEFAULT_PAINT.sand);
assert.notEqual(fullPaint.sand, fullPaint.rock);

const map = fakeMap();
VP.setFarLandcover(map, 'none');
assert.equal(map.getLayoutProperty('vl-wood-far', 'visibility'), 'none');
VP.setFarLandcover(map, 'globe');
assert.equal(map.getLayoutProperty('vl-wood-far', 'visibility'), 'none');
VP.setFarLandcover(map, 'full');
assert.equal(map.getLayoutProperty('vl-wood-far', 'visibility'), 'visible');
VP.setFarLandcover(map, 'none');
assert.equal(map.getLayoutProperty('vl-wood-far', 'visibility'), 'none');
const next = VP.normalizePaint({ highway: '#ff00aa', water: '#113355' });
VP.applyVectorPaint(map, next);
assert.equal(map.getPaintProperty('vl-highway', 'line-color'), '#ff00aa');
assert.equal(map.getPaintProperty('vl-water', 'fill-color'), '#113355');
assert.equal(map.getPaintProperty('vl-wood', 'fill-color'), VP.DEFAULT_PAINT.wood);
assert.equal(map.getPaintProperty('vl-major', 'line-color'), VP.DEFAULT_PAINT.major);
const selectiveMap = fakeMap();
VP.applyVectorPaint(selectiveMap, next, ['water']);
assert.equal(selectiveMap.getPaintProperty('vl-water', 'fill-color'), '#113355');
assert.equal(selectiveMap.getPaintProperty('vl-highway', 'line-color'), undefined);

VP.setBuildingExtrusion(map, true);
assert.equal(map.getLayoutProperty('vl-building-3d', 'visibility'), 'visible');
assert.equal(map.getLayoutProperty('vl-building', 'visibility'), 'none');
VP.setHillshade(map, false);
assert.equal(map.getLayoutProperty('vl-hillshade', 'visibility'), 'none');
VP.setRoads(map, false);
assert.equal(map.getLayoutProperty('vl-highway', 'visibility'), 'none');
assert.equal(map.getLayoutProperty('vl-major', 'visibility'), 'none');
assert.equal(map.getLayoutProperty('vl-rail', 'visibility'), 'none');
VP.setRoads(map, true);
assert.equal(map.getLayoutProperty('vl-highway', 'visibility'), 'visible');
VP.setLandcover(map, false);
assert.equal(map.getLayoutProperty('vl-wood', 'visibility'), 'none');
assert.equal(map.getLayoutProperty('vl-farmland', 'visibility'), 'none');
assert.equal(map.getLayoutProperty('vl-wood-far', 'visibility'), 'none');
VP.setLandcover(map, true);
assert.equal(map.getLayoutProperty('vl-wood', 'visibility'), 'visible');
assert.equal(map.getLayoutProperty('vl-urban', 'visibility'), 'visible');
assert.equal(map.getLayoutProperty('vl-wood-far', 'visibility'), 'none');
assert.equal(map.getLayoutProperty('vl-relief', 'visibility'), 'visible');
VP.setRelief(map, false);
assert.equal(map.getLayoutProperty('vl-relief', 'visibility'), 'none');
assert.equal(map.getLayoutProperty('vl-wood', 'visibility'), 'visible');
function elevRgb(s) {
  return [
    parseInt(s.color.slice(1, 3), 16),
    parseInt(s.color.slice(3, 5), 16),
    parseInt(s.color.slice(5, 7), 16),
  ];
}
function elevChroma(s) {
  const rgb = elevRgb(s);
  return (Math.max.apply(null, rgb) - Math.min.apply(null, rgb)) / 255;
}
const elevStops = VP.DEFAULT_ELEVATION_STOPS;
const ramp = VP.elevationColorExpr(elevStops);
assert.equal(ramp[0], 'interpolate');
assert.deepEqual(ramp[2], ['elevation']);
assert.ok(elevStops.length >= 16 && elevStops.length <= 20, 'keep 16–20 stops, got ' + elevStops.length);
elevStops.forEach(function (s, i) {
  assert.equal(typeof s.h, 'number');
  assert.match(s.color, /^#[0-9a-fA-F]{6}$/);
  assert.match(s.label, /\d+\s*m\s+\S+/);
  if (i > 0) assert.ok(s.h > elevStops[i - 1].h, 'stops must rise, ' + s.h);
});
assert.ok(elevStops.filter(function (s) { return s.h >= 0 && s.h <= 500; }).length >= 5);
assert.ok(elevStops.filter(function (s) { return s.h > 500 && s.h <= 3000; }).length >= 4);
assert.ok(elevStops.filter(function (s) { return s.h >= 3000 && s.h <= 5200; }).length >= 5, 'densify 3000–5200 m plateau');
assert.ok(elevStops.some(function (s) { return s.h < 0 && /海/.test(s.label); }));
assert.ok(elevStops.some(function (s) { return s.h === 0 && /潮滩/.test(s.label); }));
assert.ok(elevStops.some(function (s) { return s.h >= 200 && s.h <= 400 && /平原/.test(s.label); }));
assert.ok(elevStops.some(function (s) { return s.h >= 800 && s.h <= 1400 && /黄土/.test(s.label); }));
assert.ok(elevStops.some(function (s) { return /高原/.test(s.label); }));
assert.ok(elevStops.some(function (s) { return /前山/.test(s.label); }));
assert.ok(elevStops.some(function (s) { return s.h >= 3400 && s.h <= 4000 && /高寒草原|高原面/.test(s.label); }));
assert.ok(elevStops.some(function (s) { return s.h >= 5000 && s.h <= 5400 && /极高山/.test(s.label); }));
elevStops.filter(function (s) { return s.h < 5500; }).forEach(function (s) {
  assert.ok(!/雪/.test(s.label), 'no snow label below 5500 m, ' + s.label);
});
assert.ok(elevStops.some(function (s) { return s.h >= 5500 && s.h <= 6000 && /雪/.test(s.label); }));
assert.ok(elevStops.some(function (s) { return s.h >= 6200 && /雪峰/.test(s.label); }));
['#1a3f4a', '#2c4f54', '#b8a888', '#7a8a58', '#d5d2cd', '#f1f0eb', '#5da744', '#3397c1'].forEach(function (oldHex) {
  assert.ok(!elevStops.some(function (s) { return s.color.toLowerCase() === oldHex; }), 'retired hex ' + oldHex);
});
elevStops.filter(function (s) { return s.h < 0; }).forEach(function (s) {
  const rgb = elevRgb(s);
  assert.ok(rgb[2] > rgb[0] && rgb[2] > rgb[1], 'bathymetry must stay blue, ' + s.label + ' ' + s.color);
});
elevStops.filter(function (s) { return s.h >= 30 && s.h <= 200; }).forEach(function (s) {
  const rgb = elevRgb(s);
  assert.ok(rgb[1] > rgb[0] && rgb[1] > rgb[2], 'low plains must stay green, ' + s.label + ' ' + s.color);
  assert.ok(elevChroma(s) <= 0.32, 'plains chroma too high, ' + s.label + ' ' + s.color);
});
elevStops.filter(function (s) { return s.h >= 3000 && s.h <= 5200; }).forEach(function (s) {
  const rgb = elevRgb(s);
  assert.ok(Math.max.apply(null, rgb) < 180, 'plateau must not go snow-white, ' + s.label + ' ' + s.color);
});
const z0 = elevStops.filter(function (s) { return s.h === 0; })[0];
assert.ok(parseInt(z0.color.slice(3, 5), 16) >= parseInt(z0.color.slice(1, 3), 16), '0 m not brown parchment');
assert.equal(elevStops[0].color, '#0e1730');
assert.equal(elevStops[2].color, '#8a926c');
assert.equal(elevStops[5].color, '#576542');
assert.equal(elevStops[9].color, '#8a8470');
assert.equal(elevStops[elevStops.length - 1].color, '#eef0ee');
assert.ok(ramp.indexOf(0) >= 0);
assert.ok(ramp.indexOf(500) >= 0);
assert.ok(ramp.indexOf(1200) >= 0);
assert.ok(ramp.indexOf(1600) >= 0);
assert.ok(ramp.indexOf(3800) >= 0);
assert.ok(ramp.indexOf(5200) >= 0);
assert.ok(ramp.indexOf(5800) >= 0);
assert.ok(ramp.indexOf(6500) >= 0);
assert.equal(ramp.length, 3 + elevStops.length * 2);
VP.applyElevationRamp(map, elevStops);
assert.deepEqual(map.getPaintProperty('vl-relief', 'color-relief-color'), ramp);
VP.setRelief(map, true);
assert.equal(map.getLayoutProperty('vl-relief', 'visibility'), 'visible');
assert.ok(ids.includes('vl-relief'));

const exported = VP.exportPreset(next);
assert.equal(exported.vector.highway, '#ff00aa');
assert.equal(exported.vector.water, '#113355');

const html = readFileSync(htmlPath, 'utf8');
assert.match(html, /assets\/vector-paint\.js/);
assert.match(html, /vector-paint\.js\?v=/);
assert.match(html, /assets\/site-nav\.js/);
assert.match(html, /AntiqueSiteNav\.mount/);
assert.match(html, /skinDeepLink/);
assert.match(html, /vendor\/maplibre-gl\.js/);
assert.match(html, /assets\/vector-paint\.js\?v=20260904-mh-default/);
assert.match(html, /vendor\/maplibre-contour\.min\.js/);
assert.match(html, /id="sw-contour"/);
assert.match(html, /class="sw on" id="sw-contour"/);
assert.match(html, /new mlcontour\.DemSource/);
assert.match(html, /contourProtocolUrl/);
assert.match(html, /id="dem-presets"/);
assert.match(html, /id="dem-presets"[^>]*\bhidden\b/);
assert.match(html, /#dem-presets\s*\{\s*display:\s*none/);
assert.match(html, /data-dem="mapterhorn"/);
assert.match(html, /DEFAULT_DEM_PRESET \|\| 'mapterhorn'/);
assert.match(html, /function applyDem/);
assert.match(html, /tiles\.mapterhorn\.com/);
assert.doesNotMatch(html, /生产页默认不变/);
assert.match(html, /encoding: 'terrarium'/);
assert.match(html, /VP\.setContours/);
assert.match(html, /if \(map\.getZoom\(\) >= 6\) return false/);
assert.match(html, /isolate-workbench\.js/);
assert.match(html, /AntiqueIsolateWorkbench\.mount/);
assert.match(html, /id="sw-isolate"/);
assert.match(html, /id="vl-isolate-region"/);
assert.match(html, /id="btn-isolate-paste"/);
assert.doesNotMatch(html, /id="btn-chrome-isolate"/);
const chromeHeader = html.match(/<header id="chrome">[\s\S]*?<\/header>/);
assert.ok(chromeHeader, 'chrome header missing');
assert.doesNotMatch(chromeHeader[0], /拆出/);
assert.doesNotMatch(html, /setIslandVector/);
assert.doesNotMatch(html, /islandVectorOff/);
const isolateJs = readFileSync(join(repo, 'tuner', 'assets', 'isolate-workbench.js'), 'utf8');
assert.doesNotMatch(isolateJs, /setPaintProperty\(\s*['"]vl-background['"]/);
assert.doesNotMatch(isolateJs, /setPaintProperty\(\s*['"]background['"]/);
assert.match(isolateJs, /setPaintProperty\('region-edge-seal',\s*'line-color'/);
assert.match(isolateJs, /皮肤不变/);
assert.doesNotMatch(isolateJs, /btn-chrome-isolate/);
assert.doesNotMatch(isolateJs, /chromeEl/);
assert.match(html, /id="color-list"/);
assert.match(html, /id="btn-copy"/);
assert.match(html, /id="sw-roads"/);
assert.match(html, /id="sw-roads"[^>]*aria-pressed="false"/);
assert.doesNotMatch(html, /class="sw on" id="sw-roads"/);
assert.match(html, /id="sw-relief"/);
assert.match(html, /class="sw on" id="sw-relief"/);
assert.match(html, /id="sw-relief"[^>]*aria-pressed="true"/);
assert.match(html, /initialRelief\.layout\.visibility = viewMode === 'globe' \? 'none' : 'visible'/);
assert.match(html, /reliefOn && typeof VP\.setRelief === 'function'\) VP\.setRelief\(map, true\)/);
assert.match(html, /id="sw-landcover"/);
assert.match(html, /applyElevationRamp/);
assert.match(html, /setRoads/);
assert.match(html, /syncLandcoverVis/);
assert.match(html, /VP\.setLandcover/);
assert.doesNotMatch(html, /setLayoutProperty\('vl-relief',\s*'visibility',\s*hide/);
assert.match(html, /applyVectorPaint/);
assert.match(html, /data-key/);
assert.match(html, /id="terrain-ex"/);
assert.match(html, /budget: false/);
assert.match(html, /FX\.createMap\(maplibregl/);
assert.match(html, /requestAnimationFrame\(flushUiChanges\)/);
assert.match(html, /VP\.applyVectorPaint\(map, paint, keys\)/);
assert.match(html, /renderWorldCopies:\s*true/);
assert.match(html, /map\.once\('load'[\s\S]*applyProjection\(\s*'globe'/);
assert.match(html, /VP\.setFarLandcover\(map, 'none'\)/);
assert.doesNotMatch(html, /setFarLandcover\(map, 'globe'\)/);
assert.doesNotMatch(html, /farLandcover:\s*viewMode === 'globe' \? 'globe'/);
assert.match(html, /GLOBE_MAX_ZOOM = 22/);
assert.match(html, /MAP_MIN_ZOOM = 3/);
assert.match(html, /MAP_FALLBACK_CAM/);
assert.match(html, /perfWorkers/);
assert.match(html, /perfImages/);
assert.match(html, /perfCacheZoom/);
assert.doesNotMatch(html, /new maplibregl\.Map\(/);
assert.doesNotMatch(html, /map\.on\('moveend'/);
assert.doesNotMatch(html, /class="armillary"/);

const serveSrc = readFileSync(join(repo, 'tuner', '_serve.cjs'), 'utf8');
assert.match(serveSrc, /tiles\.mapterhorn\.com/);

console.log('VECTOR LAYERS STATIC OK');
console.log(JSON.stringify({
  tilejson: VP.TILEJSON_URL,
  layers: ids.length,
  keys: VP.colorKeys(),
  highway: next.highway,
}, null, 2));

const base = (process.argv[2] || '').replace(/\/$/, '');
if (!base) process.exit(0);

const { chromium } = loadPlaywright();
const shotDir = process.env.VECTOR_SHOT_DIR || join(repo, 'out', 'fx-verify');
mkdirSync(shotDir, { recursive: true });

const viewport = { width: 1440, height: 900 };
const perfTimeoutMs = Math.max(5000, Number(process.env.VECTOR_PERF_TIMEOUT_MS) || 45000);
const frameGapThresholdMs = 34;
const requestRecords = [];
const requestLookup = new WeakMap();

function requestHost(url) {
  try { return new URL(url).host || '(no-host)'; } catch (e) { return '(invalid-url)'; }
}

function increment(obj, key) {
  key = String(key || 'unknown');
  obj[key] = (obj[key] || 0) + 1;
}

function summarizeRequests(startEpochMs, endEpochMs) {
  const selected = requestRecords.filter(function (record) {
    return record.startedAtEpochMs >= startEpochMs && record.startedAtEpochMs < endEpochMs;
  });
  const byResourceType = {};
  const byHost = {};
  const byStatusClass = {};
  let finished = 0;
  let failed = 0;
  let responses = 0;
  let inFlightAtEnd = 0;
  let tileCacheHit = 0;
  let tileCacheMiss = 0;
  selected.forEach(function (record) {
    increment(byResourceType, record.resourceType);
    increment(byHost, record.host);
    if (record.status != null) {
      responses += 1;
      increment(byStatusClass, Math.floor(record.status / 100) + 'xx');
    }
    if (record.failedAtEpochMs != null && record.failedAtEpochMs <= endEpochMs) failed += 1;
    if (record.finishedAtEpochMs != null && record.finishedAtEpochMs <= endEpochMs) finished += 1;
    if (record.tileCache === 'hit') tileCacheHit += 1;
    if (record.tileCache === 'miss') tileCacheMiss += 1;
    if (
      (record.finishedAtEpochMs == null || record.finishedAtEpochMs > endEpochMs) &&
      (record.failedAtEpochMs == null || record.failedAtEpochMs > endEpochMs)
    ) {
      inFlightAtEnd += 1;
    }
  });
  return {
    observable: true,
    count: selected.length,
    responses: responses,
    finished: finished,
    failed: failed,
    inFlightAtEnd: inFlightAtEnd,
    byResourceType: byResourceType,
    byHost: byHost,
    byStatusClass: byStatusClass,
    tileCache: {
      observable: tileCacheHit + tileCacheMiss > 0,
      hit: tileCacheHit,
      miss: tileCacheMiss,
      hitRate: tileCacheHit + tileCacheMiss
        ? Number((tileCacheHit / (tileCacheHit + tileCacheMiss)).toFixed(4))
        : null,
    },
  };
}

function attachRequestSummary(metric, startEpochMs) {
  metric.requests = summarizeRequests(
    startEpochMs != null ? startEpochMs : metric.timeOriginEpochMs + metric.startedAtMs,
    metric.timeOriginEpochMs + metric.endedAtMs
  );
  return metric;
}

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: viewport, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', function (err) { errors.push(String(err && err.message || err)); });
page.on('request', function (request) {
  const record = {
    startedAtEpochMs: Date.now(),
    url: request.url(),
    resourceType: request.resourceType(),
    host: requestHost(request.url()),
    status: null,
    tileCache: null,
    finishedAtEpochMs: null,
    failedAtEpochMs: null,
  };
  requestRecords.push(record);
  requestLookup.set(request, record);
});
page.on('response', function (response) {
  const record = requestLookup.get(response.request());
  if (record) {
    record.status = response.status();
    if (typeof response.headerValue === 'function') {
      Promise.resolve(response.headerValue('x-tile-cache')).then(function (value) {
        record.tileCache = value ? String(value).toLowerCase() : null;
      }).catch(function () { /* optional response metadata */ });
    }
  }
});
page.on('requestfinished', function (request) {
  const record = requestLookup.get(request);
  if (record) record.finishedAtEpochMs = Date.now();
});
page.on('requestfailed', function (request) {
  const record = requestLookup.get(request);
  if (record) record.failedAtEpochMs = Date.now();
});

await page.addInitScript(function (config) {
  function rounded(value) {
    return typeof value === 'number' && isFinite(value) ? Number(value.toFixed(2)) : null;
  }

  function addCount(target, key) {
    key = String(key || 'unknown');
    target[key] = (target[key] || 0) + 1;
  }

  var state = {
    frameGapThresholdMs: config.frameGapThresholdMs,
    frameGaps: [],
    frameGapDropped: 0,
    framesObserved: 0,
    longTaskSupported: false,
    longTasks: [],
    longTaskDropped: 0,
    resourceTimingBufferFull: false,
  };
  var maxStoredEntries = config.maxStoredEntries;

  try {
    performance.setResourceTimingBufferSize(config.resourceTimingBufferSize);
    performance.addEventListener('resourcetimingbufferfull', function () {
      state.resourceTimingBufferFull = true;
    });
  } catch (e) {
    state.resourceTimingBufferFull = true;
  }

  var lastFrameAt = null;
  function recordFrame(at) {
    state.framesObserved += 1;
    if (lastFrameAt != null) {
      var gap = at - lastFrameAt;
      if (gap >= state.frameGapThresholdMs) {
        if (state.frameGaps.length < maxStoredEntries) {
          state.frameGaps.push({ atMs: rounded(at), gapMs: rounded(gap) });
        } else {
          state.frameGapDropped += 1;
        }
      }
    }
    lastFrameAt = at;
    window.requestAnimationFrame(recordFrame);
  }
  window.requestAnimationFrame(recordFrame);

  try {
    var supported = window.PerformanceObserver &&
      Array.isArray(window.PerformanceObserver.supportedEntryTypes) &&
      window.PerformanceObserver.supportedEntryTypes.indexOf('longtask') >= 0;
    if (supported) {
      var longTaskObserver = new window.PerformanceObserver(function (list) {
        list.getEntries().forEach(function (entry) {
          if (state.longTasks.length < maxStoredEntries) {
            state.longTasks.push({
              startMs: rounded(entry.startTime),
              durationMs: rounded(entry.duration),
              name: entry.name || 'self',
            });
          } else {
            state.longTaskDropped += 1;
          }
        });
      });
      longTaskObserver.observe({ type: 'longtask', buffered: true });
      state.longTaskSupported = true;
    }
  } catch (e2) {
    state.longTaskSupported = false;
  }

  function percentile(values, ratio) {
    if (!values.length) return 0;
    var sorted = values.slice().sort(function (a, b) { return a - b; });
    return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
  }

  function summarizeFrameGaps(startMs, endMs) {
    var entries = state.frameGaps.filter(function (entry) {
      return entry.atMs >= startMs && entry.atMs <= endMs;
    });
    var values = entries.map(function (entry) { return entry.gapMs; });
    var evidence = entries.slice().sort(function (a, b) {
      return b.gapMs - a.gapMs;
    }).slice(0, config.evidenceLimit);
    return {
      observable: true,
      thresholdMs: state.frameGapThresholdMs,
      count: entries.length,
      over50Ms: values.filter(function (value) { return value >= 50; }).length,
      totalGapMs: rounded(values.reduce(function (sum, value) { return sum + value; }, 0)),
      maxMs: rounded(values.length ? Math.max.apply(Math, values) : 0),
      p95Ms: rounded(percentile(values, 0.95)),
      droppedGlobally: state.frameGapDropped,
      evidence: evidence,
    };
  }

  function summarizeLongTasks(startMs, endMs) {
    var entries = state.longTasks.filter(function (entry) {
      return entry.startMs < endMs && entry.startMs + entry.durationMs > startMs;
    });
    var values = entries.map(function (entry) { return entry.durationMs; });
    var evidence = entries.slice().sort(function (a, b) {
      return b.durationMs - a.durationMs;
    }).slice(0, config.evidenceLimit);
    return {
      observable: state.longTaskSupported,
      thresholdMs: 50,
      count: entries.length,
      totalMs: rounded(values.reduce(function (sum, value) { return sum + value; }, 0)),
      maxMs: rounded(values.length ? Math.max.apply(Math, values) : 0),
      p95Ms: rounded(percentile(values, 0.95)),
      droppedGlobally: state.longTaskDropped,
      evidence: evidence,
    };
  }

  function summarizeResources(startMs, endMs) {
    var all = [];
    try { all = performance.getEntriesByType('resource') || []; } catch (e) { /* ignore */ }
    var entries = all.filter(function (entry) {
      return entry.startTime >= startMs && entry.startTime < endMs;
    });
    var byInitiatorType = {};
    var byHost = {};
    var transferSizeBytes = 0;
    var encodedBodySizeBytes = 0;
    var decodedBodySizeBytes = 0;
    var sizeObservable = false;
    var evidence = [];
    entries.forEach(function (entry) {
      var host = '(invalid-url)';
      var path = String(entry.name || '');
      try {
        var url = new URL(entry.name, location.href);
        host = url.host || '(no-host)';
        path = url.pathname;
      } catch (e) { /* keep fallback */ }
      addCount(byInitiatorType, entry.initiatorType);
      addCount(byHost, host);
      transferSizeBytes += Number(entry.transferSize) || 0;
      encodedBodySizeBytes += Number(entry.encodedBodySize) || 0;
      decodedBodySizeBytes += Number(entry.decodedBodySize) || 0;
      if (entry.transferSize > 0 || entry.encodedBodySize > 0 || entry.decodedBodySize > 0) {
        sizeObservable = true;
      }
      evidence.push({
        host: host,
        path: path,
        initiatorType: entry.initiatorType || 'unknown',
        startMs: rounded(entry.startTime),
        durationMs: rounded(entry.duration),
        transferSizeBytes: Number(entry.transferSize) || 0,
      });
    });
    evidence.sort(function (a, b) { return b.durationMs - a.durationMs; });
    return {
      observable: typeof performance.getEntriesByType === 'function',
      bufferFull: state.resourceTimingBufferFull,
      count: entries.length,
      sizeObservable: sizeObservable,
      transferSizeBytes: transferSizeBytes,
      encodedBodySizeBytes: encodedBodySizeBytes,
      decodedBodySizeBytes: decodedBodySizeBytes,
      byInitiatorType: byInitiatorType,
      byHost: byHost,
      evidence: evidence.slice(0, config.evidenceLimit),
    };
  }

  function safeCall(target, method, fallback) {
    try {
      return target && typeof target[method] === 'function' ? target[method]() : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function readMapState(map) {
    var center = safeCall(map, 'getCenter', null);
    var terrain = safeCall(map, 'getTerrain', null);
    var style = safeCall(map, 'getStyle', null);
    var reliefVisibility = null;
    var hillshadeVisibility = null;
    var highwayFeatures = null;
    var majorRoadFeatures = null;
    try { reliefVisibility = map.getLayoutProperty('vl-relief', 'visibility') || 'visible'; } catch (e) { /* not loaded */ }
    try { hillshadeVisibility = map.getLayoutProperty('vl-hillshade', 'visibility') || 'visible'; } catch (e2) { /* not loaded */ }
    try { highwayFeatures = map.queryRenderedFeatures({ layers: ['vl-highway'] }).length; } catch (e3) { /* not loaded */ }
    try { majorRoadFeatures = map.queryRenderedFeatures({ layers: ['vl-major'] }).length; } catch (e4) { /* not loaded */ }
    return {
      loaded: !!safeCall(map, 'loaded', false),
      tilesLoaded: !!safeCall(map, 'areTilesLoaded', false),
      moving: !!safeCall(map, 'isMoving', false),
      center: center && typeof center.lng === 'number'
        ? [rounded(center.lng), rounded(center.lat)]
        : null,
      zoom: rounded(safeCall(map, 'getZoom', NaN)),
      pitch: rounded(safeCall(map, 'getPitch', NaN)),
      bearing: rounded(safeCall(map, 'getBearing', NaN)),
      terrain: terrain ? {
        source: terrain.source || null,
        exaggeration: rounded(Number(terrain.exaggeration)),
      } : null,
      projection: style && style.projection ? style.projection.type : null,
      setTerrainCount: Number(map && map.__antiqueSetTerrainCount) || 0,
      reliefVisibility: reliefVisibility,
      hillshadeVisibility: hillshadeVisibility,
      highwayFeatures: highwayFeatures,
      majorRoadFeatures: majorRoadFeatures,
    };
  }

  function measure(map, action, opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var startedAtMs = opts.startAtMs != null ? opts.startAtMs : performance.now();
      var actionStartedAtMs = performance.now();
      var framesBefore = opts.framesStart != null ? opts.framesStart : state.framesObserved;
      var before = readMapState(map);
      var moveStartedAtMs = null;
      var moveEndedAtMs = null;
      var idleEventAtMs = null;
      var actionFinishedAtMs = null;
      var settled = false;
      var frameChecks = 0;

      function onMoveStart() {
        if (moveStartedAtMs == null) moveStartedAtMs = performance.now();
      }
      function onMoveEnd() {
        moveEndedAtMs = performance.now();
      }
      function onIdle() {
        idleEventAtMs = performance.now();
      }
      function cleanup() {
        clearTimeout(timer);
        try { map.off('movestart', onMoveStart); } catch (e) { /* ignore */ }
        try { map.off('moveend', onMoveEnd); } catch (e2) { /* ignore */ }
        try { map.off('idle', onIdle); } catch (e3) { /* ignore */ }
      }
      function isIdle() {
        return !!safeCall(map, 'loaded', false) &&
          !!safeCall(map, 'areTilesLoaded', false) &&
          !safeCall(map, 'isMoving', false);
      }
      function finish(ok, reason, actionError) {
        if (settled) return;
        settled = true;
        cleanup();
        var endedAtMs = performance.now();
        var after = readMapState(map);
        resolve({
          id: opts.id || '',
          ok: ok,
          reason: reason,
          timeoutMs: opts.timeoutMs,
          timeOriginEpochMs: performance.timeOrigin,
          startedAtMs: rounded(startedAtMs),
          actionStartedAtMs: rounded(actionStartedAtMs),
          actionFinishedAtMs: rounded(actionFinishedAtMs),
          moveStartedAtMs: rounded(moveStartedAtMs),
          moveEndedAtMs: rounded(moveEndedAtMs),
          idleEventAtMs: rounded(idleEventAtMs),
          endedAtMs: rounded(endedAtMs),
          elapsedMs: rounded(endedAtMs - startedAtMs),
          actionToIdleMs: rounded(endedAtMs - actionStartedAtMs),
          moveToIdleMs: moveStartedAtMs == null ? null : rounded(endedAtMs - moveStartedAtMs),
          moveEndToIdleMs: moveEndedAtMs == null ? null : rounded(endedAtMs - moveEndedAtMs),
          framesObserved: Math.max(0, state.framesObserved - framesBefore),
          frameGaps: summarizeFrameGaps(startedAtMs, endedAtMs),
          longTasks: summarizeLongTasks(startedAtMs, endedAtMs),
          resources: summarizeResources(startedAtMs, endedAtMs),
          setTerrain: {
            before: before.setTerrainCount,
            after: after.setTerrainCount,
            delta: after.setTerrainCount - before.setTerrainCount,
          },
          map: { before: before, after: after },
          actionError: actionError || null,
        });
      }
      function checkAfterPaint() {
        if (settled) return;
        frameChecks += 1;
        if (frameChecks >= 2 && isIdle()) {
          finish(true, idleEventAtMs == null ? 'state-idle' : 'idle-event');
          return;
        }
        window.requestAnimationFrame(checkAfterPaint);
      }

      map.on('movestart', onMoveStart);
      map.on('moveend', onMoveEnd);
      map.on('idle', onIdle);
      var timer = setTimeout(function () {
        finish(false, 'timeout');
      }, opts.timeoutMs);

      try {
        if (typeof action === 'function') action();
        actionFinishedAtMs = performance.now();
      } catch (error) {
        actionFinishedAtMs = performance.now();
        finish(false, 'action-error', String(error && error.message || error));
        return;
      }
      try { map.triggerRepaint(); } catch (e4) { /* ignore */ }
      window.requestAnimationFrame(checkAfterPaint);
    });
  }

  window.__vectorPerf = {
    state: state,
    measure: measure,
  };
}, {
  frameGapThresholdMs: frameGapThresholdMs,
  evidenceLimit: 20,
  maxStoredEntries: 10000,
  resourceTimingBufferSize: 10000,
});

const navigationStartedAtEpochMs = Date.now();
await page.goto(base + '/vector-layers.html?v=' + Date.now(), {
  waitUntil: 'domcontentloaded',
  timeout: 60000,
});
await page.waitForSelector('#look-rail input[data-key="highway"]');
await page.waitForFunction(function () {
  return !!(window.__vectorDemo && window.__vectorDemo.map);
});
const firstIdle = attachRequestSummary(await page.evaluate(function (timeoutMs) {
  var d = window.__vectorDemo;
  return window.__vectorPerf.measure(d.map, null, {
    id: 'first-idle',
    startAtMs: 0,
    framesStart: 0,
    timeoutMs: timeoutMs,
  });
}, perfTimeoutMs), navigationStartedAtEpochMs);
firstIdle.firstIdleMs = firstIdle.elapsedMs;
await page.waitForFunction(function () {
  var d = window.__vectorDemo;
  return d && d.map && typeof d.map.getLayer === 'function' && d.map.getLayer('vl-highway');
}, null, { timeout: 45000 });
await page.waitForFunction(function () {
  var m = window.__vectorDemo && window.__vectorDemo.map;
  if (!m) return false;
  return typeof m.loaded !== 'function' || m.loaded();
}, null, { timeout: 45000 });

await page.fill('#look-rail input[data-key="highway"]', '#e23d28');
const live = await page.evaluate(function () {
  var d = window.__vectorDemo;
  d.VP.applyVectorPaint(d.map, Object.assign({}, d.paint, { highway: '#e23d28' }));
  var currentStyle = d.map.getStyle();
  var layers = currentStyle.layers || [];
  var terrain = d.map.getTerrain && d.map.getTerrain();
  return {
    highway: d.map.getPaintProperty('vl-highway', 'line-color'),
    water: d.map.getPaintProperty('vl-water', 'fill-color'),
    hasWood: !!d.map.getLayer('vl-wood'),
    sceneCount: document.querySelectorAll('#scene-list .scene-item').length,
    colorCount: document.querySelectorAll('#look-rail input[data-key]').length,
    sourceSplit: {
      meshSource: terrain && terrain.source,
      visualSource: d.VP.TERRAIN_VISUAL_SOURCE_ID,
      meshSourceExists: !!d.map.getSource(d.VP.TERRAIN_SOURCE_ID),
      visualSourceExists: !!d.map.getSource(d.VP.TERRAIN_VISUAL_SOURCE_ID),
      distinctSourceInstances:
        d.map.getSource(d.VP.TERRAIN_SOURCE_ID) !== d.map.getSource(d.VP.TERRAIN_VISUAL_SOURCE_ID),
      meshLayerIds: layers.filter(function (layer) {
        return layer.source === d.VP.TERRAIN_SOURCE_ID;
      }).map(function (layer) { return layer.id; }).sort(),
      visualLayerIds: layers.filter(function (layer) {
        return layer.source === d.VP.TERRAIN_VISUAL_SOURCE_ID;
      }).map(function (layer) { return layer.id; }).sort(),
      meshTiles: (currentStyle.sources[d.VP.TERRAIN_SOURCE_ID] || {}).tiles || [],
      visualTiles: (currentStyle.sources[d.VP.TERRAIN_VISUAL_SOURCE_ID] || {}).tiles || [],
      meshMaxzoom: (currentStyle.sources[d.VP.TERRAIN_SOURCE_ID] || {}).maxzoom,
      visualMaxzoom: (currentStyle.sources[d.VP.TERRAIN_VISUAL_SOURCE_ID] || {}).maxzoom,
      pageOrigin: location.origin,
      // same rule as tileConfigFor() in tuner/vector-layers.html: DEM tiles go through the local /t/ proxy
      localProxy: (function () {
        var t = ((window.MAP_TILE_CONFIG || {}).terrain || {}).tiles || [];
        return t.some(function (u) { return String(u).indexOf('/t/') === 0; });
      })(),
    },
    projection: currentStyle.projection && currentStyle.projection.type,
    zoom: d.map.getZoom(),
    pitch: d.map.getPitch(),
    viewMode: d.viewMode,
    farVis: d.map.getLayoutProperty('vl-wood-far', 'visibility') || 'visible',
    scene: document.querySelector('.scene-item.active') &&
      document.querySelector('.scene-item.active').getAttribute('data-scene'),
  };
});
assert.equal(live.highway, '#e23d28');
assert.ok(live.hasWood);
assert.ok(live.sceneCount >= 6);
assert.ok(VP.SCENES.some(function (s) { return s.id === 'landcover-far' && s.camera.zoom === 7; }));
assert.ok(live.colorCount >= 10);
assert.equal(live.sourceSplit.meshSource, null);
assert.equal(live.sourceSplit.visualSource, VP.TERRAIN_VISUAL_SOURCE_ID);
assert.equal(live.sourceSplit.meshSourceExists, true);
assert.equal(live.sourceSplit.visualSourceExists, true);
assert.equal(live.projection, 'globe');
assert.equal(live.viewMode, 'globe');
assert.equal(live.scene, 'world');
assert.ok(live.zoom <= 5.5, 'globe must stay far, zoom=' + live.zoom);
assert.equal(live.farVis, 'none');
const globeLandcover = await page.evaluate(function () {
  var d = window.__vectorDemo;
  d.VP.setRelief(d.map, false);
  var n = 0;
  try {
    n = d.map.queryRenderedFeatures({
      layers: ['vl-wood-far', 'vl-grass-far', 'vl-farmland-far', 'vl-rock-far'],
    }).length;
  } catch (e) { n = -1; }
  d.VP.setRelief(d.map, true);
  return n;
});
assert.equal(globeLandcover, 0, 'globe must not tessellate far geojson, got ' + globeLandcover);
const globeZoomRange = await page.evaluate(function () {
  var m = window.__vectorDemo.map;
  return { minZoom: m.getMinZoom(), maxZoom: m.getMaxZoom() };
});
assert.ok(globeZoomRange.minZoom <= 0.8, 'globe minZoom=' + globeZoomRange.minZoom);
assert.ok(globeZoomRange.maxZoom >= 20, 'globe maxZoom too low: ' + globeZoomRange.maxZoom);
await page.evaluate(function () {
  window.__vectorDemo.map.jumpTo({
    center: [104.0, 35.5],
    zoom: 13,
    pitch: 40,
    bearing: 0,
  });
});
const groundZoom = await page.evaluate(function () {
  var d = window.__vectorDemo;
  var p = d.map.getProjection && d.map.getProjection();
  return {
    viewMode: d.viewMode,
    proj: p && p.type,
    zoom: d.map.getZoom(),
  };
});
assert.equal(groundZoom.viewMode, 'globe');
assert.equal(groundZoom.proj, 'globe');
assert.ok(groundZoom.zoom >= 12.5, 'globe cannot zoom to ground, zoom=' + groundZoom.zoom);
await page.click('.scene-item[data-scene="world"]');

await page.click('#viewmode-seg button[data-mode="map"]');
const leftGlobe = await page.evaluate(function () {
  var d = window.__vectorDemo;
  var p = d.map.getProjection && d.map.getProjection();
  return {
    viewMode: d.viewMode,
    proj: p && p.type,
    zoom: d.map.getZoom(),
    farVis: d.map.getLayoutProperty('vl-wood-far', 'visibility') || 'visible',
    scene: document.querySelector('.scene-item.active') &&
      document.querySelector('.scene-item.active').getAttribute('data-scene'),
    terrain: d.map.getTerrain && d.map.getTerrain(),
  };
});
assert.equal(leftGlobe.viewMode, 'map');
assert.ok(!leftGlobe.proj || leftGlobe.proj === 'mercator');
assert.ok(leftGlobe.zoom >= 3, 'left globe still at far zoom: ' + leftGlobe.zoom);
assert.equal(leftGlobe.scene, 'china');
assert.equal(leftGlobe.farVis, 'none');
if (leftGlobe.zoom >= VP.TERRAIN_MESH_MINZOOM) {
  assert.ok(leftGlobe.terrain && leftGlobe.terrain.source === VP.TERRAIN_SOURCE_ID);
} else {
  assert.ok(!leftGlobe.terrain, 'overview should not load 3D mesh DEM');
}
await page.click('#viewmode-seg button[data-mode="globe"]');
const globeAgain = await page.evaluate(function () {
  var d = window.__vectorDemo;
  var p = d.map.getProjection && d.map.getProjection();
  return {
    viewMode: d.viewMode,
    proj: p && p.type,
    zoom: d.map.getZoom(),
    scene: document.querySelector('.scene-item.active') &&
      document.querySelector('.scene-item.active').getAttribute('data-scene'),
  };
});
assert.equal(globeAgain.viewMode, 'globe');
assert.equal(globeAgain.proj, 'globe');
assert.equal(globeAgain.scene, 'world');
assert.ok(Math.abs(globeAgain.zoom - 1.9) < 0.15, 'globe cam clamped, zoom=' + globeAgain.zoom);
assert.equal(live.sourceSplit.distinctSourceInstances, true);
assert.deepEqual(live.sourceSplit.meshLayerIds, []);
assert.deepEqual(live.sourceSplit.visualLayerIds, ['vl-hillshade', 'vl-relief']);
assert.deepEqual(live.sourceSplit.meshTiles, live.sourceSplit.visualTiles);
assert.ok(live.sourceSplit.meshTiles.length >= 1);
assert.ok(
  live.sourceSplit.meshTiles.some(function (u) { return /mapterhorn/.test(u); }),
  'lab default DEM must be Mapterhorn: ' + JSON.stringify(live.sourceSplit.meshTiles)
);
assert.equal(live.sourceSplit.visualMaxzoom, VP.DEM_PRESETS.mapterhorn.visualMaxzoom);
assert.ok(
  live.sourceSplit.meshMaxzoom > live.sourceSplit.visualMaxzoom,
  'mesh DEM must out-zoom visual hillshade'
);
// Mesh DEM is only same-origin when tiles go through the local /t/ proxy (map-tiles.config.local.js).
// Without the proxy the mesh tiles point at the upstream host, so the check does not apply.
if (live.sourceSplit.localProxy) {
  live.sourceSplit.meshTiles.forEach(function (url) {
    assert.equal(new URL(url).origin, live.sourceSplit.pageOrigin);
  });
} else {
  console.log('skip mesh same-origin check: no /t/ proxy in MAP_TILE_CONFIG terrain.tiles');
}
assert.equal(errors.length, 0, 'page errors: ' + errors.join(' | '));

const landcoverScene = VP.SCENES.filter(function (scene) {
  return scene.id === 'landcover-far';
})[0];
const perfScenarioDefs = [
  { id: 'world', sceneId: 'world' },
  { id: 'china', sceneId: 'china' },
  {
    id: 'z6.99',
    sceneId: 'landcover-far',
    camera: Object.assign({}, landcoverScene.camera, { zoom: 6.99 }),
    roads: true,
  },
  { id: 'z7.0', sceneId: 'landcover-far', roads: true },
  { id: 'hexi', sceneId: 'hexi', roads: false },
  { id: 'qilian', sceneId: 'qilian', timeoutMs: 90000 },
  { id: 'beijing', sceneId: 'beijing', timeoutMs: 90000 },
];

async function runPerfScenario(def) {
  const metric = attachRequestSummary(await page.evaluate(function (input) {
    var d = window.__vectorDemo;
    return window.__vectorPerf.measure(d.map, function () {
      if (input.sceneId) {
        var button = document.querySelector('.scene-item[data-scene="' + input.sceneId + '"]');
        if (!button) throw new Error('missing scene button ' + input.sceneId);
        button.click();
      }
      if (input.camera) d.map.jumpTo(input.camera);
      if (typeof input.relief === 'boolean') {
        var reliefButton = document.getElementById('sw-relief');
        var reliefOn = reliefButton.classList.contains('on');
        if (reliefOn !== input.relief) reliefButton.click();
      }
      if (typeof input.roads === 'boolean') {
        var roadsButton = document.getElementById('sw-roads');
        var roadsOn = roadsButton.classList.contains('on');
        if (roadsOn !== input.roads) roadsButton.click();
      }
    }, {
      id: input.id,
      timeoutMs: input.timeoutMs,
    });
  }, {
    id: def.id,
    sceneId: def.sceneId || null,
    camera: def.camera || null,
    relief: def.relief,
    roads: def.roads,
    timeoutMs: def.timeoutMs || perfTimeoutMs,
  }));
  const screenshot = 'vector-perf-' + def.id + '.png';
  await page.screenshot({ path: join(shotDir, screenshot), fullPage: false });
  metric.screenshot = screenshot;
  metric.action = {
    sceneId: def.sceneId || null,
    camera: def.camera || null,
    relief: typeof def.relief === 'boolean' ? def.relief : null,
    roads: typeof def.roads === 'boolean' ? def.roads : null,
  };
  return metric;
}

const perfScenarios = [];
for (const def of perfScenarioDefs) {
  perfScenarios.push(await runPerfScenario(def));
}

const perfEnvironment = await page.evaluate(function () {
  var nav = performance.getEntriesByType('navigation')[0];
  var recorder = window.__vectorPerf && window.__vectorPerf.state;
  var demo = window.__vectorDemo;
  var gl = window.maplibregl;
  return {
    url: location.href,
    userAgent: navigator.userAgent,
    hardwareConcurrency: navigator.hardwareConcurrency || null,
    deviceMemoryGb: navigator.deviceMemory || null,
    devicePixelRatio: window.devicePixelRatio,
    tuning: {
      requested: demo && demo.perfTuning || null,
      workerCount: gl && typeof gl.getWorkerCount === 'function' ? gl.getWorkerCount() : null,
      maxParallelImageRequests:
        gl && typeof gl.getMaxParallelImageRequests === 'function'
          ? gl.getMaxParallelImageRequests()
          : null,
      maxTileCacheZoomLevels:
        demo && demo.map ? demo.map._maxTileCacheZoomLevels : null,
    },
    navigation: nav ? {
      domContentLoadedMs: Number(nav.domContentLoadedEventEnd.toFixed(2)),
      loadEventMs: Number(nav.loadEventEnd.toFixed(2)),
      transferSizeBytes: Number(nav.transferSize) || 0,
    } : null,
    recorder: recorder ? {
      framesObserved: recorder.framesObserved,
      frameGapDropped: recorder.frameGapDropped,
      longTaskSupported: recorder.longTaskSupported,
      longTaskDropped: recorder.longTaskDropped,
      resourceTimingBufferFull: recorder.resourceTimingBufferFull,
    } : null,
  };
});
const perfReportPath = join(shotDir, 'vector-layers-perf-baseline.json');
const perfReport = {
  schema: 'china-antique-maplibre/vector-perf-baseline@1',
  generatedAt: new Date().toISOString(),
  target: base + '/vector-layers.html',
  configuration: {
    headless: true,
    freshBrowserContext: true,
    viewport: viewport,
    deviceScaleFactor: 1,
    timeoutMs: perfTimeoutMs,
    frameGapThresholdMs: frameGapThresholdMs,
    scenarioOrder: perfScenarioDefs.map(function (def) { return def.id; }),
  },
  environment: Object.assign({
    node: process.version,
    platform: process.platform,
    browser: browser.version(),
  }, perfEnvironment),
  firstIdle: firstIdle,
  scenarios: perfScenarios,
  pageErrors: errors.slice(),
};
writeFileSync(perfReportPath, JSON.stringify(perfReport, null, 2) + '\n', 'utf8');

assert.equal(firstIdle.ok, true, 'first idle failed: ' + JSON.stringify(firstIdle));
assert.equal(firstIdle.map.after.loaded, true);
assert.equal(firstIdle.map.after.moving, false);
assert.ok(!firstIdle.map.after.highwayFeatures, 'roads should start off');
assert.equal(typeof firstIdle.firstIdleMs, 'number');
assert.equal(firstIdle.resources.observable, true);
assert.equal(firstIdle.requests.observable, true);
assert.equal(typeof firstIdle.longTasks.observable, 'boolean');
assert.deepEqual(
  perfScenarios.map(function (metric) { return metric.id; }),
  perfScenarioDefs.map(function (def) { return def.id; })
);
perfScenarios.forEach(function (metric) {
  assert.equal(metric.ok, true, metric.id + ' idle failed: ' + JSON.stringify(metric));
  assert.equal(metric.map.after.loaded, true, metric.id + ' map not loaded');
  assert.equal(metric.map.after.moving, false, metric.id + ' map still moving');
  assert.equal(metric.resources.observable, true);
  assert.equal(metric.requests.observable, true);
  assert.equal(typeof metric.longTasks.observable, 'boolean');
  assert.equal(Number.isFinite(metric.setTerrain.after), true);
});
const perfById = Object.fromEntries(perfScenarios.map(function (metric) {
  return [metric.id, metric];
}));
['world', 'china', 'z6.99', 'z7.0', 'hexi', 'qilian', 'beijing'].forEach(function (id) {
  assert.equal(typeof perfById[id].moveToIdleMs, 'number', id + ' move-to-idle missing');
});
assert.ok(Math.abs(perfById['z6.99'].map.after.zoom - 6.99) < 0.011);
assert.ok(Math.abs(perfById['z7.0'].map.after.zoom - 7) < 0.011);
assert.ok(perfById['z6.99'].map.after.highwayFeatures > 0, 'z6.99 highways missing');
assert.ok(perfById['z7.0'].map.after.highwayFeatures > 0, 'z7.0 highways missing');
assert.equal(perfById['qilian'].map.after.hillshadeVisibility, 'visible');
assert.equal(errors.length, 0, 'page errors: ' + errors.join(' | '));

const qilianContours = await page.evaluate(function () {
  var d = window.__vectorDemo;
  var vis = null;
  var n = 0;
  try { vis = d.map.getLayoutProperty('vl-contour', 'visibility') || 'visible'; } catch (e) { /* missing */ }
  try { n = d.map.queryRenderedFeatures({ layers: ['vl-contour'] }).length; } catch (e2) { /* missing */ }
  return {
    hasLayer: !!d.map.getLayer('vl-contour'),
    hasSource: !!d.map.getSource(d.VP.CONTOUR_SOURCE_ID),
    visibility: vis,
    features: n,
    zoom: d.map.getZoom(),
  };
});
assert.equal(qilianContours.hasLayer, true, 'vl-contour missing');
assert.equal(qilianContours.hasSource, true, 'contours source missing');
assert.equal(qilianContours.visibility, 'visible');
assert.ok(qilianContours.features > 0, 'qilian contour lines missing: ' + JSON.stringify(qilianContours));

await page.click('.scene-item[data-scene="qilian"]');
await page.waitForTimeout(1200);
const realTerrain = await page.evaluate(function () {
  var d = window.__vectorDemo;
  d.setTerrainExUi(d.VP.TERRAIN_REAL_EXAGGERATION);
  var t = d.map.getTerrain && d.map.getTerrain();
  return {
    ui: d.terrainEx,
    applied: t && t.exaggeration,
    zoom: d.map.getZoom(),
    pitch: d.map.getPitch(),
  };
});
assert.equal(realTerrain.ui, 1);
assert.ok(Math.abs(Number(realTerrain.applied) - 1) < 0.06, 'real elevation should apply 1.0, got ' + realTerrain.applied);
assert.ok(realTerrain.zoom >= 10, 'qilian close-up required to see mesh, zoom=' + realTerrain.zoom);
const qilianProj = await page.evaluate(function () {
  var d = window.__vectorDemo;
  var p = d.map.getProjection && d.map.getProjection();
  return {
    viewMode: d.viewMode,
    proj: p && p.type,
    farVis: d.map.getLayoutProperty('vl-wood-far', 'visibility') || 'visible',
  };
});
assert.equal(qilianProj.viewMode, 'map');
assert.ok(!qilianProj.proj || qilianProj.proj === 'mercator');
assert.equal(qilianProj.farVis, 'none');

await page.waitForFunction(function () {
  var m = window.__vectorDemo && window.__vectorDemo.map;
  return m && typeof m.loaded === 'function' && m.loaded();
}, null, { timeout: 90000 });
const globeSwitchStarted = Date.now();
await page.click('#viewmode-seg button[data-mode="globe"]');
const globeSwitchMs = Date.now() - globeSwitchStarted;
assert.ok(globeSwitchMs < 8000, 'globe switch too slow: ' + globeSwitchMs + 'ms');
const globeState = await page.evaluate(function () {
  var d = window.__vectorDemo;
  var p = d.map.getProjection && d.map.getProjection();
  return {
    viewMode: d.viewMode,
    proj: p && p.type,
    zoom: d.map.getZoom(),
    pitch: d.map.getPitch(),
    farVis: d.map.getLayoutProperty('vl-wood-far', 'visibility') || 'visible',
    scene: document.querySelector('.scene-item.active') &&
      document.querySelector('.scene-item.active').getAttribute('data-scene'),
  };
});
assert.equal(globeState.viewMode, 'globe');
assert.equal(globeState.proj, 'globe');
assert.equal(globeState.scene, 'world');
assert.ok(Math.abs(globeState.zoom - 1.9) < 0.15, 'globe zoom still close-up: ' + globeState.zoom);
assert.equal(globeState.farVis, 'none');
await page.click('.scene-item[data-scene="qilian"]');
await page.waitForFunction(function () {
  var m = window.__vectorDemo && window.__vectorDemo.map;
  return m && typeof m.loaded === 'function' && m.loaded();
}, null, { timeout: 90000 });
await page.waitForTimeout(800);
await page.screenshot({ path: join(shotDir, 'vector-layers.png'), fullPage: false });
await page.screenshot({ path: join(shotDir, 'vector-layers-qilian-real-1.0.png'), fullPage: false });

async function setSwitch(id, on) {
  const isOn = await page.evaluate(function (elId) {
    var el = document.getElementById(elId);
    return !!(el && el.classList.contains('on'));
  }, id);
  if (isOn !== on) await page.click('#' + id);
}

await page.evaluate(function () {
  var d = window.__vectorDemo;
  var mapEl = document.getElementById('map');
  var tint = document.getElementById('warm-tint');
  var vig = document.getElementById('vignette');
  d._shadeCompare = {
    filter: mapEl ? mapEl.style.filter : '',
    tint: tint ? tint.style.display : '',
    vig: vig ? vig.style.display : '',
    pitch: d.map.getPitch(),
    bearing: d.map.getBearing(),
    reliefOpacity: d.map.getPaintProperty('vl-relief', 'color-relief-opacity'),
  };
  if (mapEl) mapEl.style.filter = 'none';
  if (tint) tint.style.display = 'none';
  if (vig) vig.style.display = 'none';
  // Opacity, not layout visibility: hiding color-relief via visibility reloads
  // all terrainVisual tiles into a stuck 'reloading' state on this MapLibre 5.6.
  d.map.setPaintProperty('vl-relief', 'color-relief-opacity', 0);
  d.map.jumpTo({ pitch: 0 });
});
await setSwitch('sw-landcover', false);
await page.waitForFunction(function () {
  var m = window.__vectorDemo && window.__vectorDemo.map;
  return m && typeof m.loaded === 'function' && m.loaded();
}, null, { timeout: 90000 });
await page.waitForTimeout(800);
const shadeOrtho = await page.evaluate(function () {
  var d = window.__vectorDemo;
  var src = d.map.getStyle().sources[d.VP.TERRAIN_VISUAL_SOURCE_ID] || {};
  return {
    pitch: d.map.getPitch(),
    zoom: d.map.getZoom(),
    visualMaxzoom: src.maxzoom,
    hillshade: d.map.getLayoutProperty('vl-hillshade', 'visibility') || 'visible',
    reliefOpacity: d.map.getPaintProperty('vl-relief', 'color-relief-opacity'),
    wood: d.map.getLayoutProperty('vl-wood', 'visibility') || 'visible',
  };
});
assert.ok(shadeOrtho.pitch < 1, 'ortho shade compare needs pitch 0, got ' + shadeOrtho.pitch);
assert.ok(shadeOrtho.zoom >= 10, 'qilian ortho zoom=' + shadeOrtho.zoom);
assert.equal(shadeOrtho.visualMaxzoom, VP.DEM_PRESETS.mapterhorn.visualMaxzoom);
assert.equal(shadeOrtho.hillshade, 'visible');
assert.equal(shadeOrtho.reliefOpacity, 0);
assert.equal(shadeOrtho.wood, 'none');
await page.screenshot({ path: join(shotDir, 'vector-layers-qilian-shade-ortho.png'), fullPage: false });

await setSwitch('sw-landcover', true);
await page.evaluate(function () {
  var d = window.__vectorDemo;
  var prev = d._shadeCompare || {};
  var mapEl = document.getElementById('map');
  var tint = document.getElementById('warm-tint');
  var vig = document.getElementById('vignette');
  if (mapEl) mapEl.style.filter = prev.filter || '';
  if (tint) tint.style.display = prev.tint || '';
  if (vig) vig.style.display = prev.vig || '';
  d.map.setPaintProperty(
    'vl-relief',
    'color-relief-opacity',
    prev.reliefOpacity != null ? prev.reliefOpacity : 1
  );
  d.map.jumpTo({
    pitch: prev.pitch != null ? prev.pitch : 70,
    bearing: prev.bearing != null ? prev.bearing : 180,
  });
});
await page.waitForFunction(function () {
  var m = window.__vectorDemo && window.__vectorDemo.map;
  return m && typeof m.loaded === 'function' && m.loaded();
}, null, { timeout: 90000 });
await page.waitForTimeout(800);
await page.screenshot({ path: join(shotDir, 'vector-layers-qilian-antique-pitch70.png'), fullPage: false });

await page.evaluate(function () {
  window.__vectorDemo.setTerrainExUi(1.6);
});
await page.waitForTimeout(800);
const dramaTerrain = await page.evaluate(function () {
  var d = window.__vectorDemo;
  var t = d.map.getTerrain && d.map.getTerrain();
  return { ui: d.terrainEx, applied: t && t.exaggeration };
});
assert.ok(Math.abs(Number(dramaTerrain.applied) - 1.6) < 0.06, 'dramatic 1.6 should not be LOD-capped, got ' + dramaTerrain.applied);
await page.screenshot({ path: join(shotDir, 'vector-layers-qilian-ex-1.6.png'), fullPage: false });

await page.click('.scene-item[data-scene="beijing"]');
await page.waitForTimeout(800);
await page.screenshot({ path: join(shotDir, 'vector-layers-beijing.png'), fullPage: false });
const coalescing = await page.evaluate(async function () {
  var d = window.__vectorDemo;
  await new Promise(function (resolve) {
    requestAnimationFrame(function () { requestAnimationFrame(resolve); });
  });
  var before = Object.assign({}, d.uiApplyStats);
  var color = document.querySelector('#look-rail input[data-key="highway"]');
  var elevation = document.querySelector('#elev-list input[data-elev]');
  var terrain = document.getElementById('terrain-ex');
  for (var i = 0; i < 24; i += 1) {
    color.value = i % 2 ? '#e23d28' : '#c43b2f';
    color.dispatchEvent(new Event('input', { bubbles: true }));
    elevation.value = i % 2 ? '#d8c8a4' : '#c9b58c';
    elevation.dispatchEvent(new Event('input', { bubbles: true }));
    terrain.value = String(1 + i * 0.05);
    terrain.dispatchEvent(new Event('input', { bubbles: true }));
  }
  await new Promise(function (resolve) {
    requestAnimationFrame(function () { requestAnimationFrame(resolve); });
  });
  var after = d.uiApplyStats;
  var appliedTerrain = d.map.getTerrain && d.map.getTerrain();
  return {
    frames: after.frames - before.frames,
    paintFlushes: after.paintFlushes - before.paintFlushes,
    paintKeys: after.paintKeys - before.paintKeys,
    elevationFlushes: after.elevationFlushes - before.elevationFlushes,
    terrainFlushes: after.terrainFlushes - before.terrainFlushes,
    finalHighway: d.map.getPaintProperty('vl-highway', 'line-color'),
    finalTerrain: appliedTerrain && appliedTerrain.exaggeration,
  };
});
assert.deepEqual(
  {
    frames: coalescing.frames,
    paintFlushes: coalescing.paintFlushes,
    paintKeys: coalescing.paintKeys,
    elevationFlushes: coalescing.elevationFlushes,
    terrainFlushes: coalescing.terrainFlushes,
  },
  { frames: 1, paintFlushes: 1, paintKeys: 1, elevationFlushes: 1, terrainFlushes: 1 }
);
assert.equal(coalescing.finalHighway, '#e23d28');
assert.ok(Math.abs(Number(coalescing.finalTerrain) - 2.15) < 0.06);
const hotLandcover = await page.evaluate(async function () {
  var url = new URL(window.__vectorDemo.VP.LANDCOVER_FAR_URL, location.href).href;
  performance.clearResourceTimings();
  async function load() {
    var response = await fetch(url, { cache: 'force-cache' });
    var bytes = (await response.arrayBuffer()).byteLength;
    var entries = performance.getEntriesByName(url);
    var timing = entries[entries.length - 1];
    return {
      bytes: bytes,
      transferSize: timing ? Number(timing.transferSize) || 0 : null,
      encodedBodySize: timing ? Number(timing.encodedBodySize) || 0 : null,
      decodedBodySize: timing ? Number(timing.decodedBodySize) || 0 : null,
    };
  }
  return { url: url, first: await load(), second: await load() };
});
assert.ok(hotLandcover.second.bytes > 10000000);
assert.equal(hotLandcover.first.bytes, hotLandcover.second.bytes);
assert.ok(
  hotLandcover.second.transferSize === 0 ||
    hotLandcover.second.encodedBodySize === hotLandcover.second.bytes,
  'landcover pack should load; transfer=' + hotLandcover.second.transferSize
);
const demTimeoutMs = Math.max(perfTimeoutMs, 120000);
const alpsMapterhorn = attachRequestSummary(await page.evaluate(function (timeoutMs) {
  var d = window.__vectorDemo;
  return window.__vectorPerf.measure(d.map, function () {
    d.setTerrainExUi(d.VP.TERRAIN_REAL_EXAGGERATION);
    if (d.demPreset !== 'mapterhorn') d.applyDem('mapterhorn');
    d.applyScene('alps');
  }, { id: 'alps-mapterhorn', timeoutMs: timeoutMs });
}, demTimeoutMs));
assert.equal(alpsMapterhorn.ok, true, 'alps mapterhorn idle failed: ' + JSON.stringify(alpsMapterhorn));
const alpsMapterhornSrc = await page.evaluate(function () {
  var d = window.__vectorDemo;
  var style = d.map.getStyle();
  var src = style.sources.terrain || {};
  var visual = style.sources[d.VP.TERRAIN_VISUAL_SOURCE_ID] || {};
  var demUi = document.getElementById('dem-presets');
  return {
    dem: d.demPreset,
    demUiHidden: !!(demUi && (demUi.hidden || getComputedStyle(demUi).display === 'none')),
    tileSize: src.tileSize,
    maxzoom: src.maxzoom,
    visualMaxzoom: visual.maxzoom,
    tiles: src.tiles || [],
    encoding: src.encoding,
    zoom: d.map.getZoom(),
    pitch: d.map.getPitch(),
  };
});
assert.equal(alpsMapterhornSrc.dem, 'mapterhorn');
assert.equal(alpsMapterhornSrc.demUiHidden, true);
assert.ok(alpsMapterhornSrc.zoom > 16, 'alps zoom=' + alpsMapterhornSrc.zoom);
assert.equal(alpsMapterhornSrc.tileSize, 512);
assert.equal(alpsMapterhornSrc.encoding, 'terrarium');
assert.equal(alpsMapterhornSrc.visualMaxzoom, 16);
assert.ok(
  alpsMapterhornSrc.tiles.some(function (u) { return /mapterhorn/.test(u); }),
  'mapterhorn tiles missing: ' + JSON.stringify(alpsMapterhornSrc.tiles)
);
await page.screenshot({ path: join(shotDir, 'vector-layers-alps-mapterhorn.png'), fullPage: false });

const qilianMapterhorn = attachRequestSummary(await page.evaluate(function (timeoutMs) {
  var d = window.__vectorDemo;
  return window.__vectorPerf.measure(d.map, function () {
    d.applyScene('qilian');
  }, { id: 'qilian-mapterhorn', timeoutMs: timeoutMs });
}, demTimeoutMs));
assert.equal(qilianMapterhorn.ok, true, 'qilian mapterhorn idle failed: ' + JSON.stringify(qilianMapterhorn));
const qilianMapterhornSrc = await page.evaluate(function () {
  var d = window.__vectorDemo;
  return {
    dem: d.demPreset,
    scene: document.querySelector('.scene-item.active') &&
      document.querySelector('.scene-item.active').getAttribute('data-scene'),
    tiles: (d.map.getStyle().sources.terrain || {}).tiles || [],
  };
});
assert.equal(qilianMapterhornSrc.dem, 'mapterhorn');
assert.equal(qilianMapterhornSrc.scene, 'qilian');
assert.ok(qilianMapterhornSrc.tiles.some(function (u) { return /mapterhorn/.test(u); }));
await page.screenshot({ path: join(shotDir, 'vector-layers-qilian-mapterhorn.png'), fullPage: false });

perfReport.hotLandcover = hotLandcover;
perfReport.uiCoalescing = coalescing;
perfReport.demCompare = {
  defaultPreset: 'mapterhorn',
  demUiHidden: alpsMapterhornSrc.demUiHidden,
  alpsMapterhorn: {
    ok: alpsMapterhorn.ok,
    moveToIdleMs: alpsMapterhorn.moveToIdleMs,
    tileSize: alpsMapterhornSrc.tileSize,
    visualMaxzoom: alpsMapterhornSrc.visualMaxzoom,
  },
  qilianMapterhorn: {
    ok: qilianMapterhorn.ok,
    moveToIdleMs: qilianMapterhorn.moveToIdleMs,
  },
};
writeFileSync(perfReportPath, JSON.stringify(perfReport, null, 2) + '\n', 'utf8');
await browser.close();
console.log('VECTOR LAYERS LIVE OK');
console.log(JSON.stringify({
  live: live,
  performanceReport: perfReportPath,
  firstIdleMs: firstIdle.firstIdleMs,
  demCompare: perfReport.demCompare,
  scenarios: perfScenarios.map(function (metric) {
    return {
      id: metric.id,
      moveToIdleMs: metric.moveToIdleMs,
      frameGaps: metric.frameGaps.count,
      longTasks: metric.longTasks.count,
      resources: metric.resources.count,
      requests: metric.requests.count,
      setTerrain: metric.setTerrain,
      screenshot: metric.screenshot,
    };
  }),
}, null, 2));
