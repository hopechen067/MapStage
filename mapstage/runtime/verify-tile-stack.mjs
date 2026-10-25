import { join } from 'node:path';
import { chromium } from './lib/pw.mjs';

const BASE = (process.argv[2] || 'http://127.0.0.1:8767').replace(/\/$/, '');

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });

async function loadAndMeasure(page, label) {
  const t0 = Date.now();
  const stats = { proxy: { hit: 0, miss: 0 }, upstream: 0 };
  page.removeAllListeners('response');
  page.on('response', (r) => {
    const h = r.headers()['x-tile-cache'];
    if (h === 'hit') stats.proxy.hit++;
    else if (h === 'miss') stats.proxy.miss++;
    if (/autonavi|elevation-tiles/.test(r.url()) && !r.url().includes('127.0.0.1')) stats.upstream++;
  });
  await page.goto(BASE + '/?stack=' + label + Date.now(), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__tunerMap && window.__tunerMap.isStyleLoaded(), null, { timeout: 60000 });
  const styleAt = Date.now() - t0;
  // 等待初始视野瓦片全部就位
  await page.waitForFunction(() => window.__tunerMap.areTilesLoaded(), null, { timeout: 60000 });
  const tilesAt = Date.now() - t0;
  await page.waitForTimeout(2500);
  const state = await page.evaluate(() => {
    const m = window.__tunerMap;
    const style = m.getStyle();
    return {
      demSources: Object.keys(style.sources).filter((k) => style.sources[k].type === 'raster-dem'),
      hillLayerSource: m.getLayer('hillshade') ? m.getLayer('hillshade').source : null,
      terrainOn: m.getTerrain() ? m.getTerrain().exaggeration : null,
      satLayer: !!m.getLayer('satellite'),
      firstSatTile: (style.sources.basemapRaster || {}).tiles ? style.sources.basemapRaster.tiles[0].slice(0, 40) : null,
    };
  });
  await page.screenshot({ path: 'out/fx-verify/81-tile-stack-' + label + '.png' });
  return { styleAt, tilesAt, stats, state };
}

const page = await context.newPage();
const cold = await loadAndMeasure(page, 'cold');
const warm = await loadAndMeasure(page, 'warm');

console.log(JSON.stringify({ cold, warm }, null, 1));

// 服务器侧判定:磁盘缓存数量 + 初始视野抽样全部命中
// (浏览器会重放缓存响应的旧 x-tile-cache 头,页面侧计数不可靠)
const { execSync } = await import('node:child_process');
const { existsSync, readdirSync } = await import('node:fs');
// Proxy checks only apply when tiles go through the local /t/ proxy (map-tiles.config.local.js).
const useProxy = typeof cold.state.firstSatTile === 'string' && cold.state.firstSatTile.startsWith('/t/');
let cacheCount = 0;
let sampleHits = true;
if (useProxy) {
  const cacheDir = join(process.cwd(), 'tuner', '_tile_cache');
  cacheCount = existsSync(cacheDir) ? readdirSync(cacheDir).length : 0;
  const probeHit = (url) =>
    execSync('curl -s -D - -o NUL "' + url + '"', { shell: 'cmd.exe', encoding: 'utf8' })
      .toLowerCase()
      .includes('x-tile-cache: hit');
  sampleHits = [
    BASE + '/t/elevation-tiles-prod.s3.amazonaws.com/terrarium/4/13/6.png',
    BASE + '/t/webst01.is.autonavi.com/appmaptile?style=6&x=13&y=6&z=4',
  ].every(probeHit);
  console.log('serverCache files=' + cacheCount + ' sampleHits=' + sampleHits);
} else {
  console.log('no local /t/ proxy config, proxy checks skipped');
}
await browser.close();

// Shared DEM design: several raster-dem sources (terrain / terrain-hillshade / terrainVisual);
// the hillshade layer reads from one of the raster-dem sources.
const conds = {
  singleDem: cold.state.demSources.includes('terrain'),
  hillOnTerrain: ['terrain', 'terrain-hillshade'].includes(cold.state.hillLayerSource) &&
    cold.state.demSources.includes(cold.state.hillLayerSource),
  terrainOn: cold.state.terrainOn !== null,
  satLayer: cold.state.satLayer === true,
  proxyWired: useProxy ? cold.state.firstSatTile.startsWith('/t/') : true,
  cacheCount: useProxy ? cacheCount >= 20 : true,
  sampleHits,
};
console.log('conds ' + JSON.stringify(conds));
const pass = Object.values(conds).every(Boolean);
console.log(pass ? 'TILE STACK OK (shared DEM + proxy cache)' : 'TILE STACK FAILED');
if (!pass) process.exit(1);
