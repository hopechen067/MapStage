import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = dirname(fileURLToPath(import.meta.url));

const required = [
  'index.html',
  'vector-layers.html',
  'map-tiles.config.js',
  'map-tiles.config.example.js',
  'assets/han-city-3d.js',
  'assets/sample-sites.json',
  'assets/water-pack.json',
  'assets/site-nav.js',
  'assets/vector-paint.js',
  'assets/map-fx.js',
  'assets/region-isolate.js',
  'assets/region-isolate-data.js',
  'assets/terrain-island.js',
  'assets/isolate-workbench.js',
  'assets/polar-ice.geojson',
  'vendor/maplibre-gl.js',
  'vendor/maplibre-contour.min.js',
  'preset-antique-default.json',
  'presets/antique-default.json',
];

let ok = true;
for (const rel of required) {
  const p = join(root, rel);
  if (existsSync(p)) {
    console.log(`OK  ${rel}`);
  } else {
    console.error(`MISS ${rel}`);
    ok = false;
  }
}

// Local override is optional
const localCfg = join(root, 'map-tiles.config.local.js');
if (existsSync(localCfg)) {
  console.log('OK  map-tiles.config.local.js (optional local override present)');
} else {
  console.log('—   map-tiles.config.local.js (optional, not present)');
}

// Tiny pack flag must default to disabled (no in-repo redistribution).
const waterPackPath = join(root, 'assets/water-pack.json');
if (existsSync(waterPackPath)) {
  try {
    const pack = JSON.parse(readFileSync(waterPackPath, 'utf8'));
    if (pack.enabled === true) {
      console.error('FAIL assets/water-pack.json enabled=true but public tree must default to false');
      ok = false;
    } else {
      console.log('OK  assets/water-pack.json enabled=false (water not shipped)');
    }
  } catch (e) {
    console.error('FAIL parsing assets/water-pack.json', e);
    ok = false;
  }
}

// Large water pack is optional and not redistributed in this repo.
const waterPath = join(root, 'assets/water-data.js');
if (existsSync(waterPath)) {
  const bytes = statSync(waterPath).size;
  console.log(`OK  assets/water-data.js (optional local pack) size=${bytes}`);
  if (bytes < 1_000) {
    console.error(`FAIL assets/water-data.js too small (${bytes} bytes)`);
    ok = false;
  } else {
    try {
      const code = readFileSync(waterPath, 'utf8');
      const ctx = { window: {} };
      vm.runInNewContext(code, ctx, { timeout: 60_000 });
      const data = ctx.window.CHINA_WATER_DATA;
      if (!data || typeof data !== 'object') {
        console.error('FAIL CHINA_WATER_DATA missing after eval');
        ok = false;
      } else {
        const keys = Object.keys(data);
        console.log(`OK  CHINA_WATER_DATA keys=${keys.join(',')}`);
      }
    } catch (e) {
      console.error('FAIL evaluating water-data.js', e);
      ok = false;
    }
  }
} else {
  console.log('—   assets/water-data.js (optional, not shipped)');
}

const indexHtml = join(root, 'index.html');
if (existsSync(indexHtml)) {
  const html = readFileSync(indexHtml, 'utf8');
  if (html.includes('id="btn-water"') || html.includes('水系（可选')) {
    console.error('FAIL index.html still has homepage water UI');
    ok = false;
  } else {
    console.log('OK  index.html has no water overlay UI');
  }
  if (!html.includes('data-key="satellite.opacity"') || !html.includes('data-key="css.sepia"') || !html.includes('data-key="hillshade.exaggeration"')) {
    console.error('FAIL index.html lost original tuner parameters');
    ok = false;
  } else {
    console.log('OK  index.html keeps original tuner sliders');
  }
  if (!html.includes('id="viewmode-seg"') || !html.includes('id="sw-isolate"') || !html.includes('id="sw-relief"')) {
    console.error('FAIL index.html missing 地图/地球 · 拆出 · 海拔设色');
    ok = false;
  } else {
    console.log('OK  index.html has 地图/地球 + 拆出 + 海拔设色');
  }
  if (!html.includes('han-city-3d.js')) {
    console.error('FAIL index.html missing han-city-3d');
    ok = false;
  } else if (/<script[^>]+three@/.test(html)) {
    console.error('FAIL index.html still eagerly loads Three.js');
    ok = false;
  } else if (!html.includes('three@0.160.0')) {
    console.error('FAIL index.html missing Three.js lazy fallback');
    ok = false;
  } else {
    console.log('OK  index.html han-city-3d + lazy Three.js fallback');
  }
  if (/<script[^>]+region-isolate-data\.js/.test(html)) {
    console.error('FAIL index.html still eagerly loads region-isolate-data.js');
    ok = false;
  } else {
    console.log('OK  index.html lazy-loads isolate region data');
  }
}

// Directory-safe base: no-trailing-slash project Pages must not resolve to /assets/
{
  const noSlash = new URL(
    'assets/water-data.js',
    'https://hopechen067.github.io/china-antique-maplibre'
  ).href;
  const withSlash = new URL(
    'assets/water-data.js',
    'https://hopechen067.github.io/china-antique-maplibre/'
  ).href;
  if (noSlash === 'https://hopechen067.github.io/assets/water-data.js') {
    console.log('OK  documented hazard: no-trailing-slash relative URL escapes repo');
  } else {
    console.error('FAIL expected no-slash relative resolution hazard missing');
    ok = false;
  }
  if (withSlash !== 'https://hopechen067.github.io/china-antique-maplibre/assets/water-data.js') {
    console.error('FAIL unexpected with-slash resolution', withSlash);
    ok = false;
  } else {
    console.log('OK  with-trailing-slash relative URL stays in repo');
  }
}

if (!ok) {
  console.error('verify failed');
  process.exit(1);
}

console.log('verify ok');
process.exit(0);
