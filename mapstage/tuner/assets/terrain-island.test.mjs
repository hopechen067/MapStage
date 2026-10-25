import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const root = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(root, 'terrain-island.js'), 'utf8');
const isolate = readFileSync(join(root, 'region-isolate.js'), 'utf8');
const ctx = { console };
ctx.window = ctx;
ctx.globalThis = ctx;
vm.runInNewContext(isolate + '\n' + src, ctx);

const api = ctx.AntiqueTerrainIsland;
let failed = 0;
function check(name, cond) {
  if (!cond) {
    failed += 1;
    console.error('FAIL', name);
  } else {
    console.log('OK  ', name);
  }
}

function lngLatFeature(lng, lat, d) {
  return {
    type: 'Feature',
    properties: { id: 't' },
    geometry: {
      type: 'Polygon',
      coordinates: [[
        [lng - d, lat - d],
        [lng + d, lat - d],
        [lng + d, lat + d],
        [lng - d, lat + d],
        [lng - d, lat - d],
      ]],
    },
  };
}

function tileAt(lng, lat, z) {
  const m = api.lngLatToMercator(lng, lat);
  const scale = 1 << z;
  return {
    tileID: {
      canonical: {
        z: z,
        x: Math.floor(m[0] * scale),
        y: Math.floor(m[1] * scale),
      },
    },
  };
}

const origin = api.lngLatToMercator(0, 0);
check('mercator origin x=0.5', Math.abs(origin[0] - 0.5) < 1e-9);
check('mercator origin y~0.5', Math.abs(origin[1] - 0.5) < 0.01);

const beijing = lngLatFeature(116.4, 39.9, 0.4);
const box = api.mercatorBbox(beijing);
check('mercator bbox', !!(box && box.x1 > box.x0 && box.y1 > box.y0));

const insideTile = tileAt(116.4, 39.9, 6);
check('tile intersects region', api.tileIntersectsMerc(insideTile, box));

const farTile = { tileID: { canonical: { z: 6, x: 1, y: 1 } } };
check('far tile skipped', !api.tileIntersectsMerc(farTile, box));

ctx.__antiqueTerrainClip = { enabled: true, merc: box };
const filtered = api.filterTiles([insideTile, farTile]);
check('filterTiles keeps interior', filtered.length === 1 && filtered[0] === insideTile);
check(
  'beijing-scale island fits one clip texture at z8',
  typeof api.featureFitsClipTexture === 'function' &&
    api.featureFitsClipTexture({ getZoom: function () { return 8.2; } }, beijing)
);

const longRing = [];
for (let i = 0; i < 2000; i++) longRing.push([100 + i * 0.01, 36]);
longRing.push(longRing[0]);
const capped = api.densifyRing(longRing, 0.12);
check('densify caps long rings', capped.length <= api.WALL_MAX_POINTS + 1);
check('capped ring stays closed', capped[0][0] === capped[capped.length - 1][0]);

const shortRing = [
  [100, 36],
  [100.2, 36],
  [100.2, 36.2],
  [100, 36.2],
  [100, 36],
];
const dense = api.densifyRing(shortRing, 0.12);
check('short ring densifies or keeps shape', dense.length >= shortRing.length - 1);

check('wall step shrinks with zoom', api.wallStepDegForZoom(10) < api.wallStepDegForZoom(4));

const longEdge = [
  [100, 36],
  [104, 36],
];
const denseFine = api.densifyRing(longEdge, 0.02);
const denseCoarse = api.densifyRing(longEdge, 0.12);
check('densify a long edge at 0.02° has many more points than at 0.12°', denseFine.length > denseCoarse.length);

const sparseGapped = [];
for (let i = 0; i < 799; i++) sparseGapped.push([100 + i * 0.02, 36]);
const gapFrom = sparseGapped[sparseGapped.length - 1][0];
sparseGapped.push([gapFrom + 2, 36]);
sparseGapped.push(sparseGapped[0]);
const densifiedSparse = api.densifyRing(sparseGapped, 0.02);
check('early-long-ring is densified not merely strided', densifiedSparse.length > sparseGapped.length);
let insertedInGap = false;
for (let i = 0; i < densifiedSparse.length - 1; i++) {
  const x0 = densifiedSparse[i][0];
  const x1 = densifiedSparse[i + 1][0];
  if (x0 > gapFrom + 0.01 && x1 < gapFrom + 2 - 0.01) insertedInGap = true;
}
check('2° gap in 800-point ring received inserted vertices', insertedInGap);

check('wall step tightens with zoom', api.wallStepDegForZoom(10) < api.wallStepDegForZoom(4));
check('close-up step is finer than 200m', api.wallStepDegForZoom(12) < 0.002);
const edgeA = [
  [100, 36],
  [102, 36],
];
const coarse = api.densifyRing(edgeA, 0.12, 2000);
const fine = api.densifyRing(edgeA, 0.02, 2000);
check('finer step inserts more wall verts', fine.length > coarse.length + 20);

const sparseGap = [];
for (let i = 0; i < 800; i++) sparseGap.push([100 + i * 0.002, 36]);
sparseGap.push([104, 36]);
sparseGap.push(sparseGap[0]);
const gapped = api.densifyRing(sparseGap, 0.02, 2000);
check('long chord on a long ring is still subdivided', gapped.length > 900);

const chinaLike = [];
for (let i = 0; i < 2000; i++) {
  const t = (i / 2000) * Math.PI * 2;
  chinaLike.push([104 + 18 * Math.cos(t), 36 + 12 * Math.sin(t)]);
}
chinaLike.push(chinaLike[0]);
const resampled = api.densifyRing(chinaLike, 0.02, 1600);
let maxD = 0;
for (let i = 0; i < resampled.length - 1; i++) {
  const dx = resampled[i + 1][0] - resampled[i][0];
  const dy = resampled[i + 1][1] - resampled[i][1];
  const d = Math.hypot(dx, dy);
  if (d > maxD) maxD = d;
}
check('capped densify has no continent-scale chord', maxD < 2);

const grid = [
  [1, 1, 0],
  [1, 1, 0],
  [1, 1, 0],
];
const segs = api.meshCrossingsFromGrid(grid, 0, 0, 1, 2);
check('straddling column emits wall segments', segs.length >= 2);
let maxSeg = 0;
for (let i = 0; i < segs.length; i++) {
  const dx = segs[i][1][0] - segs[i][0][0];
  const dy = segs[i][1][1] - segs[i][0][1];
  maxSeg = Math.max(maxSeg, Math.hypot(dx, dy));
}
check('grid wall segments stay on one cell', maxSeg < 0.8);
const midX = segs[0][0][0];
check('contour sits on the in/out grid edge', midX > 0.4 && midX < 0.9);
check('capped densify stays closed', resampled[0][0] === resampled[resampled.length - 1][0]);

const closeMerc = api.clipMercatorBbox(
  {
    getZoom: function () { return 11; },
    getBounds: function () {
      return {
        getWest: function () { return 116.2; },
        getEast: function () { return 116.6; },
        getSouth: function () { return 39.7; },
        getNorth: function () { return 40.1; },
      };
    },
  },
  beijing
);
check(
  'zoomed clip bbox tighter than province bbox',
  closeMerc && box && closeMerc.x1 - closeMerc.x0 < box.x1 - box.x0
);

const wide = lngLatFeature(116.4, 40.2, 4);
const wideBox = api.mercatorBbox(wide);
const pitchedClose = api.clipMercatorBbox(
  {
    getZoom: function () { return 10.6; },
    getPitch: function () { return 62; },
    getCenter: function () { return { lng: 116.4, lat: 39.5 }; },
    getCanvas: function () { return { clientWidth: 1400, clientHeight: 800 }; },
    getBounds: function () {
      return {
        getWest: function () { return 70; },
        getEast: function () { return 140; },
        getSouth: function () { return 15; },
        getNorth: function () { return 55; },
      };
    },
  },
  wide
);
check(
  'pitched close-up clip ignores horizon-sized bounds',
  pitchedClose && wideBox && pitchedClose.x1 - pitchedClose.x0 < (wideBox.x1 - wideBox.x0) * 0.55
);

const slab = api.wallSlab(800, 4200);
check('wall slab stays plaque-scale', slab >= 900 && slab <= 6400);
check('china-scale slab caps below 7km', api.wallSlab(0, 6000, 4200) <= 6400);
check('city-scale slab has a floor', api.wallSlab(40, 120, 80) >= 900);

const chinaWall = api.ringWallRuns(chinaLike, null, 0.08, 1600);
let wallMax = 0;
for (let r = 0; r < chinaWall.length; r++) {
  const run = chinaWall[r];
  for (let i = 0; i < run.length - 1; i++) {
    const dx = run[i + 1][0] - run[i][0];
    const dy = run[i + 1][1] - run[i][1];
    const d = Math.hypot(dx, dy);
    if (d > wallMax) wallMax = d;
  }
}
check('ring wall has no continent-scale chord', wallMax < 2);
check('ring wall emits at least one run', chinaWall.length >= 1);
const patched = [
  { alt: 1200 },
  { alt: 0 },
  { alt: 1300 },
  { alt: 1250 },
];
const filled = api.fillSampleAlts(patched);
check('fillSampleAlts reports inland min', filled.min > 200);
check('missing 0-alt filled from neighbors', patched[1].alt > 200);
check('clip texture uses LINEAR', src.includes('TEXTURE_MAG_FILTER, gl.LINEAR'));
check('clip texture not NEAREST mag', !/TEXTURE_MAG_FILTER, gl\.NEAREST/.test(src));
check('island mesh stays on official 128', /var MESH_ISLAND = 128;/.test(src));
check('island mesh is not 256', !/var MESH_ISLAND = 256;/.test(src));
check('outside verts drop', src.includes('dropMetersForMap') && src.includes('clip.drop = drop'));
check(
  'beijing overview drop is a thick slab',
  api.dropMetersForMap({ getZoom: function () { return 7.15; } }, beijing) > 20000
);
check(
  'close-up drop is not a tower',
  api.dropMetersForMap({ getZoom: function () { return 11; } }, beijing) <= 40000
);
check(
  'china overview drop is hundreds of km',
  api.dropMetersForMap({ getZoom: function () { return 3.85; } }, lngLatFeature(104, 36, 18)) > 80000
);
check(
  'rim skirt is same-loop drop not a snapped extra tessellation',
  src.includes('bottom = top dropped') && src.includes('function densifyProjected')
);
check('rim does not collinear-merge', src.includes('Never drop collinear points'));
check('clip G paints water-facing rim', src.includes('paintClipWater') && src.includes('inChinaSeas'));
check('UV 0 is top rim', api.strataUv(0, 12000) === 0);
check('UV 1 is skirt bottom', api.strataUv(12000, 12000) === 1);
check('bay vs inland palettes differ', api.strataRgb(0.05, true)[1] !== api.strataRgb(0.05, false)[1]);
check('Shandong bay is water rim', api.isRimWaterLngLat(121.4, 36.8) === true);
check('Gansu inland is land rim', api.isRimWaterLngLat(103.7, 37.9) === false);
check('B>R satellite water is not counted as rock', api.classifyWallRgb(38, 44, 62, true) === 'blue-gray');
const bayWall = api.rasterWallColumn(1000, true);
check(
  'bay wall raster is mud/clay/rock at ~15/25/60',
  bayWall.order.join(',') === 'mud,clay,rock' &&
    Math.abs(bayWall.pct.mud - 15) < 2 &&
    Math.abs(bayWall.pct.clay - 25) < 2 &&
    Math.abs(bayWall.pct.rock - 60) < 2 &&
    bayWall.pct['blue-gray'] === 0
);
const inlandWall = api.rasterWallColumn(1000, false);
check(
  'inland wall raster stays 10/20/70 residual/weathered/rock',
  inlandWall.order.join(',') === 'residual,weathered,rock' &&
    Math.abs(inlandWall.pct.residual - 10) < 2 &&
    Math.abs(inlandWall.pct.weathered - 20) < 2 &&
    Math.abs(inlandWall.pct.rock - 70) < 2
);
check('overlay reconstructs shade as affine * clip.w', src.includes('v_shade_w=a_shade*gl_Position.w'));

if (failed) process.exit(1);
console.log('terrain-island tests passed');
