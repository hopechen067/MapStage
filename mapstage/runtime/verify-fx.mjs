/**
 * Live verify tuner + Hexi cut against the runtime-perf plan.
 * Requires Playwright (not a repo dep). Example:
 *   set PLAYWRIGHT_BROWSERS_PATH=0
 *   node runtime/verify-fx.mjs http://127.0.0.1:8766
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { loadPlaywright } from './lib/pw.mjs';
import { readPageSource } from './lib/tuner-source.mjs';
import { openTunerPanel } from './lib/tuner-ui.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const repo = join(root, '..');
const outDir = join(repo, '..', 'out', 'fx-verify');
const base = process.argv[2] || 'http://127.0.0.1:8766';

const hexiSrc = readFileSync(join(repo, 'tuner', 'hexi-map-shot.html'), 'utf8');
assert.doesNotMatch(hexiSrc, /\beaseTo\b/, 'hexi template must not call easeTo');
assert.doesNotMatch(hexiSrc, /\bflyTo\b/, 'hexi template must not call flyTo');
assert.match(hexiSrc, /maplibre-gl@5\.6/, 'hexi must pin MapLibre 5.6.x');
assert.match(hexiSrc, /precacheViewports/, 'hexi must precache');
assert.match(hexiSrc, /mode:\s*'record'/, 'hexi must use record mode');
assert.match(hexiSrc, /tl\.call/, 'hexi camera must be GSAP call + jumpTo, not interpolated to()');

const tunerSrc = readPageSource(join(repo, 'tuner', 'index.html'));
const applyFn = tunerSrc.slice(
  tunerSrc.indexOf('function applyMapStyles()'),
  tunerSrc.indexOf('function updateWaterVisibility()')
);
assert.doesNotMatch(applyFn, /setTerrain/, 'applyMapStyles must not call setTerrain');

mkdirSync(outDir, { recursive: true });

const { chromium } = loadPlaywright();
const browser = await chromium.launch({ headless: true });
const report = { base, shots: [], checks: [] };

function log(name, extra) {
  report.checks.push({ name, ...extra });
  console.log('OK ', name, extra ? JSON.stringify(extra) : '');
}

try {
  const tuner = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const tunerLogs = [];
  tuner.on('console', (msg) => tunerLogs.push(msg.type() + ': ' + msg.text()));
  tuner.on('pageerror', (err) => tunerLogs.push('pageerror: ' + err.message));
  await tuner.goto(base.replace(/\/$/, '') + '/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  try {
    await tuner.waitForFunction(() => !!window.__tunerMap, null, { timeout: 60000 });
  } catch (err) {
    await tuner.screenshot({ path: join(outDir, '00-tuner-timeout.png') });
    writeFileSync(join(outDir, 'tuner-console.txt'), tunerLogs.join('\n'));
    throw err;
  }
  await tuner.evaluate(() =>
    window.AntiqueMapFx
      ? window.AntiqueMapFx.waitIdle(window.__tunerMap, { timeoutMs: 20000, force: true })
      : Promise.resolve()
  );
  await tuner.screenshot({ path: join(outDir, '01-tuner-idle.png') });
  report.shots.push('01-tuner-idle.png');

  const beforePaint = await tuner.evaluate(() => window.__tunerMap.__antiqueSetTerrainCount || 0);
  await tuner.evaluate(() => {
    const el = document.querySelector('[data-key="water.riverL3Width"] input[type="range"]');
    if (!el) throw new Error('missing riverL3Width slider');
    el.value = String(Math.min(8, Number(el.value) + 1.5));
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await tuner.waitForTimeout(400);
  const afterPaint = await tuner.evaluate(() => window.__tunerMap.__antiqueSetTerrainCount || 0);
  assert.equal(afterPaint, beforePaint, 'lake paint must not call setTerrain');
  log('paint-no-setTerrain', { beforePaint, afterPaint });

  const beforeSlider = afterPaint;
  await tuner.evaluate(() => {
    const el = document.querySelector('[data-key="terrainExaggeration"] input[type="range"]');
    if (!el) throw new Error('missing terrain slider');
    ['0.4', '0.9', '1.6'].forEach(function (v) {
      el.value = v;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
  });
  const afterSlider = await tuner.evaluate(() => window.__tunerMap.__antiqueSetTerrainCount || 0);
  const sliderDelta = afterSlider - beforeSlider;
  assert.ok(sliderDelta >= 1 && sliderDelta <= 6, 'terrain slider setTerrain should be quantized, not 1:1 with mousemove');
  log('terrain-slider-quantized', { beforeSlider, afterSlider, sliderDelta });
  await tuner.screenshot({ path: join(outDir, '02-tuner-terrain-slider.png') });
  report.shots.push('02-tuner-terrain-slider.png');

  await tuner.evaluate(() => {
    const map = window.__tunerMap;
    window.__stopN = 0;
    window.__easeN = 0;
    const stop = map.stop.bind(map);
    const ease = map.easeTo.bind(map);
    map.stop = function () {
      window.__stopN += 1;
      return stop.apply(map, arguments);
    };
    map.easeTo = function () {
      window.__easeN += 1;
      return ease.apply(map, arguments);
    };
    window.AntiqueMapFx.jumpTo(map, {
      center: [94.66, 40.14],
      zoom: 7.3,
      pitch: 48,
      bearing: 0,
    });
  });
  await openTunerPanel(tuner);
  // 全国视角 lives in the 镜头 (camera) tab; other tabs are hidden by default
  await tuner.evaluate(() => window.__studioShowTab('camera'));
  await tuner.locator('#btn-china').click();
  await tuner.waitForTimeout(40);
  await tuner.locator('#btn-china').click();
  await tuner.waitForTimeout(250);
  const camSpy = await tuner.evaluate(() => ({ stop: window.__stopN, ease: window.__easeN }));
  assert.ok(camSpy.stop >= 2, 'stacked 全国视角 must map.stop() before each easeTo');
  assert.ok(camSpy.ease >= 1, '全国视角 uses easeTo after stop');
  log('easeTo-stop-before-stack', camSpy);

  const rise = await tuner.evaluate(async () => {
    const map = window.__tunerMap;
    const src = (window.__tunerTileConfig && window.__tunerTileConfig.terrain && window.__tunerTileConfig.terrain.sourceId) || 'terrain';
    const steps = [];
    const result = await window.AntiqueMapFx.terrainRise(map, {
      sourceId: src,
      from: 0,
      to: 1.6,
      durationMs: 120,
      waitIdle: false,
      useTimeout: true,
      onStep: function (ex, t) { steps.push({ ex: ex, t: t }); },
    });
    return {
      steps: steps,
      result: result,
      ex: map.getTerrain ? map.getTerrain().exaggeration : null,
    };
  });
  assert.ok(rise.steps.length >= 3, 'terrainRise must emit start/mid/end');
  assert.equal(rise.steps[0].ex, 0);
  assert.equal(rise.steps[rise.steps.length - 1].ex, 1.6);
  log('terrainRise-quantized-steps', { n: rise.steps.length, result: rise.result, ex: rise.ex });

  const srcId = await tuner.evaluate(() =>
    (window.__tunerTileConfig && window.__tunerTileConfig.terrain && window.__tunerTileConfig.terrain.sourceId) || 'terrain'
  );
  for (const [ex, file] of [
    [0, '03-rise-start.png'],
    [0.8, '04-rise-mid.png'],
    [1.6, '05-rise-end.png'],
  ]) {
    await tuner.evaluate(({ src, ex }) => {
      window.AntiqueMapFx.setTerrainEx(window.__tunerMap, src, ex, { zoom: 4.2, pitch: 28 });
    }, { src: srcId, ex: ex });
    await tuner.evaluate(() =>
      window.AntiqueMapFx.waitIdle(window.__tunerMap, { timeoutMs: 8000, force: true })
    );
    await tuner.waitForTimeout(250);
    await tuner.screenshot({ path: join(outDir, file) });
    report.shots.push(file);
  }
  log('terrainRise-three-stills', { files: ['03-rise-start.png', '04-rise-mid.png', '05-rise-end.png'] });

  const hexi = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await hexi.goto(base.replace(/\/$/, '') + '/hexi-map-shot.html?paused=1', {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });
  await hexi.waitForFunction(
    () => window.__antiqueMap && /ready/.test((document.getElementById('fx-status') || {}).textContent || ''),
    null,
    { timeout: 120000 }
  );
  const hexiMeta = await hexi.evaluate(() => {
    const map = window.__antiqueMap;
    const style = map.getStyle ? map.getStyle() : { layers: [] };
    const raster = (style.layers || []).find((l) => l.type === 'raster');
    return {
      shots: (window.__hexiShots || []).map((s) => s.title),
      setTerrain: map.__antiqueSetTerrainCount || 0,
      status: (document.getElementById('fx-status') || {}).textContent,
      pixelRatio: map.getPixelRatio ? map.getPixelRatio() : map.pixelRatio,
      fadeDuration: map._fadeDuration,
      rasterFade: raster && raster.paint ? raster.paint['raster-fade-duration'] : null,
    };
  });
  assert.equal(hexiMeta.shots.length, 5, 'five Hexi shots');
  log('hexi-ready', hexiMeta);

  const shots = await hexi.evaluate(() => window.__hexiShots);
  for (let i = 0; i < shots.length; i++) {
    const shot = shots[i];
    await hexi.evaluate((s) => {
      window.AntiqueMapFx.jumpTo(window.__antiqueMap, s);
      document.getElementById('shot-title').textContent = s.title;
    }, shot);
    await hexi.evaluate(() => window.AntiqueMapFx.waitIdle(window.__antiqueMap, { timeoutMs: 12000, force: true }));
    await hexi.waitForTimeout(400);
    const name = '06-hexi-' + String(i).padStart(2, '0') + '-' + shot.title + '.png';
    await hexi.screenshot({ path: join(outDir, name) });
    report.shots.push(name);
    log('hexi-shot', { i: i, title: shot.title, zoom: shot.zoom, pitch: shot.pitch });
  }

  writeFileSync(join(outDir, 'report.json'), JSON.stringify(report, null, 2));
  console.log('verify-fx ok → ' + outDir);
} finally {
  await browser.close();
}
