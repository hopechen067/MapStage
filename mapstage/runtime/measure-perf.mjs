import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from './lib/pw.mjs';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'out', 'fx-verify');
mkdirSync(outDir, { recursive: true });

const tag = process.argv[2] || 'pre';
const outFile = join(outDir, 'perf-' + tag + '.json');

const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=gl-egl', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
if (String(tag).indexOf('nocache') >= 0) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
}
const t0 = Date.now();
await page.goto('http://127.0.0.1:8766/?perf=' + tag + '&t=' + Date.now(), {
  waitUntil: 'domcontentloaded',
  timeout: 60000,
});
const tDom = Date.now() - t0;
await page.waitForFunction(() => !!window.__tunerMap, null, { timeout: 60000 });
const tMap = Date.now() - t0;
const idle = await page.evaluate(() =>
  window.AntiqueMapFx.waitIdle(window.__tunerMap, { timeoutMs: 20000, force: true })
);
const tIdle = Date.now() - t0;

const stats = await page.evaluate(() => {
  const map = window.__tunerMap;
  const res = performance.getEntriesByType('resource');
  function hostOf(url) {
    try {
      return new URL(url).host;
    } catch (e) {
      return 'other';
    }
  }
  const byHost = {};
  let imgN = 0;
  let imgEncoded = 0;
  for (let i = 0; i < res.length; i++) {
    const r = res[i];
    const h = hostOf(r.name);
    if (!byHost[h]) byHost[h] = { n: 0, transfer: 0, encoded: 0 };
    byHost[h].n += 1;
    byHost[h].transfer += r.transferSize || 0;
    byHost[h].encoded += r.encodedBodySize || 0;
    if (
      /\.(png|jpg|jpeg|webp)(\?|$)/i.test(r.name) ||
      r.name.indexOf('terrarium') >= 0 ||
      r.name.indexOf('s2cloudless') >= 0
    ) {
      imgN += 1;
      imgEncoded += r.encodedBodySize || 0;
    }
  }
  const c = map.getCenter();
  const gl = window.maplibregl;
  return {
    zoom: map.getZoom(),
    pitch: map.getPitch(),
    terrain: map.getTerrain && map.getTerrain(),
    center: [c.lng, c.lat],
    resourceN: res.length,
    imgN: imgN,
    imgEncoded: imgEncoded,
    byHost: byHost,
    maxParallel: gl && gl.getMaxParallelImageRequests ? gl.getMaxParallelImageRequests() : null,
    workerCount: gl && gl.getWorkerCount ? gl.getWorkerCount() : null,
    cacheZoom: map._maxTileCacheZoomLevels,
    lodClass: !!(map.getContainer && map.getContainer().classList.contains('antique-lod-labels')),
  };
});

await page.screenshot({ path: join(outDir, 'perf-' + tag + '-idle.png') });

const lod = await page.evaluate(() => {
  const map = window.__tunerMap;
  const F = window.AntiqueMapFx;
  F.setMotionLod(map, true);
  const moving = {
    classOn: map.getContainer().classList.contains('antique-lod-labels'),
    l3: map.getLayer('river-l3') ? map.getLayoutProperty('river-l3', 'visibility') : null,
  };
  F.setMotionLod(map, false);
  return {
    moving: moving,
    idleClassOn: map.getContainer().classList.contains('antique-lod-labels'),
    l3Idle: map.getLayer('river-l3') ? map.getLayoutProperty('river-l3', 'visibility') : null,
  };
});

const pan = await page.evaluate(() => {
  const map = window.__tunerMap;
  return new Promise(function (resolve) {
    let frames = 0;
    let renders = 0;
    const start = performance.now();
    let running = true;
    function onRender() {
      renders += 1;
    }
    map.on('render', onRender);
    function tick() {
      if (!running) return;
      frames += 1;
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
    map.once('moveend', function () {
      running = false;
      map.off('render', onRender);
      const elapsed = performance.now() - start;
      resolve({
        frames: frames,
        renders: renders,
        elapsedMs: Math.round(elapsed),
        fps: elapsed > 0 ? Number((frames / (elapsed / 1000)).toFixed(1)) : null,
        renderHz: elapsed > 0 ? Number((renders / (elapsed / 1000)).toFixed(1)) : null,
      });
    });
    map.panBy([140, 50], { duration: 480 });
  });
});

await page.evaluate(() => {
  const map = window.__tunerMap;
  map.jumpTo({ center: [100.32, 38.1], zoom: 11.15, pitch: 70, bearing: 178 });
});
await page.evaluate(
  () => window.AntiqueMapFx.waitIdle(window.__tunerMap, { timeoutMs: 12000, force: true })
);
await page.waitForTimeout(1200);
const relief = await page.evaluate(() => {
  const map = window.__tunerMap;
  const t = map.getTerrain && map.getTerrain();
  return {
    zoom: map.getZoom(),
    pitch: map.getPitch(),
    terrain: t,
  };
});
await page.screenshot({ path: join(outDir, 'perf-' + tag + '-relief.png') });

const report = {
  tag: tag,
  tDom: tDom,
  tMap: tMap,
  tIdle: tIdle,
  idleOk: idle && idle.ok,
  idleReason: idle && idle.reason,
  stats: stats,
  lod: lod,
  pan: pan,
  relief: relief,
};
writeFileSync(outFile, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await browser.close();
