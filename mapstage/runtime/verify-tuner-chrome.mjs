/**
 * Gating: Studio shell (top bar, scene pills, parameter panel).
 *
 * Static part (no browser): tuner.css tokens equal the site's tokens, index.html
 * carries the ids tuner-app.js binds, every panel tab points at a section.
 * Live part (when a base URL is given): panel is open and does not cover the map,
 * the map canvas follows the panel, tabs scroll to their section, theme toggle
 * works, narrow screens start map-only with no horizontal overflow.
 *
 *   node runtime/verify-tuner-chrome.mjs
 *   node runtime/verify-tuner-chrome.mjs http://127.0.0.1:8770/studio
 *
 * Optional env:
 *   CHROME_SHOT_DIR  screenshot output (default: <repo>/out/fx-verify)
 *   ANTIQUE_PW_ROOT  Playwright install
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { loadPlaywright } from './lib/pw.mjs';
import { readPageCss, readPageSource } from './lib/tuner-source.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '..');
const tunerHtmlPath = join(repo, 'tuner', 'index.html');
const html = readFileSync(tunerHtmlPath, 'utf8');
const source = readPageSource(tunerHtmlPath);
const scenes = JSON.parse(readFileSync(join(repo, 'tuner', 'scenes.json'), 'utf8'));

function parseRootVars(css, label) {
  const m = css.match(/:root\s*\{([\s\S]*?)\n\}/);
  assert.ok(m, label + ' missing :root');
  const vars = {};
  for (const part of m[1].split(';')) {
    const kv = part.match(/--([\w-]+)\s*:\s*([\s\S]+)/);
    if (kv) vars['--' + kv[1]] = kv[2].trim();
  }
  return vars;
}

function parseRgb(cssColor) {
  const m = String(cssColor).match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  assert.ok(m, 'not an rgb color: ' + cssColor);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

// --- tokens: Studio wears the site's palette ---------------------------------------
const studioVars = parseRootVars(readPageCss(tunerHtmlPath), 'tuner.css');
const siteVars = parseRootVars(readFileSync(join(repo, 'site', 'assets', 'site.css'), 'utf8'), 'site.css');
for (const k of ['--paper', '--paper-2', '--card', '--ink', '--ink-2', '--ink-3', '--rule', '--seal', '--seal-ink', '--water', '--gold']) {
  assert.ok(studioVars[k], 'tuner.css :root missing ' + k);
  assert.equal(studioVars[k], siteVars[k], k + ' must equal the site token');
}
assert.match(studioVars['--serif'], /Noto Serif SC/);
assert.ok(studioVars['--map-bg'], 'tuner.css keeps --map-bg for the canvas backdrop');

// --- structure ------------------------------------------------------------------------
for (const id of [
  'chrome', 'chrome-nav', 'viewmode-seg', 'btn-theme', 'btn-chrome-copy', 'btn-tuner',
  'workspace', 'map-wrap', 'map', 'scene-list', 'panel', 'panel-actions', 'panel-tabs', 'panel-body',
  'lighting-grid', 'theme-grid', 'skin-list', 'btn-relief', 'btn-contour', 'btn-landcover', 'btn-vector-reset', 'btn-copy', 'btn-download', 'btn-paste', 'btn-reset',
  'sw-sat', 'btn-water', 'btn-roads', 'btn-cities', 'btn-isolate',
  'isolate-region', 'isolate-region-btns', 'isolate-city-btns', 'btn-china', 'btn-terrain-rise',
  'st-preset', 'paint-summary', 'css-summary', 'attribution-note',
]) {
  assert.ok(new RegExp('id="' + id + '"').test(html), 'index.html missing #' + id);
}
const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
assert.equal(new Set(ids).size, ids.length, 'duplicate ids in index.html');

assert.match(html, /data-mode="map"[^>]*>地图/);
assert.match(html, /data-mode="globe"[^>]*>地球/);
assert.match(html, /id="btn-copy"[^>]*>复制 JSON/);
assert.match(html, /id="btn-download"[^>]*>下载 JSON/);
assert.match(html, /class="chip"/);
assert.match(source, /function setPanelOpen/);

const tabTargets = [...html.matchAll(/<a href="#(sec-[a-z]+)"/g)].map((m) => m[1]);
assert.deepEqual(tabTargets, ['sec-layers', 'sec-look', 'sec-camera', 'sec-isolate', 'sec-preset']);
for (const t of tabTargets) assert.ok(html.includes('id="' + t + '"'), 'panel tab points at missing #' + t);

assert.ok(Array.isArray(scenes.scenes) && scenes.scenes.length >= 6, 'scenes.json must list scene items');
assert.ok(scenes.scenes.every((s) => s.id && s.title), 'each scene needs id+title');

// retired shell pieces must not come back
for (const gone of ['look-rail', 'status-bar', 'panel-toggle', 'demo-banner', 'sw-water', 'sw-roads', 'sw-labels', 'sw-cities', 'sw-isolate']) {
  assert.ok(!new RegExp('id="' + gone + '"').test(html), '#' + gone + ' was retired from the Studio shell');
}

console.log('TUNER CHROME STATIC OK');
console.log(JSON.stringify({ paper: studioVars['--paper'], seal: studioVars['--seal'], scenes: scenes.scenes.length }, null, 2));

const base = (process.argv[2] || '').replace(/\/$/, '');
if (!base) process.exit(0);

const shotDir = process.env.CHROME_SHOT_DIR || join(repo, '..', 'out', 'fx-verify');
mkdirSync(shotDir, { recursive: true });

let chromium;
try {
  ({ chromium } = loadPlaywright());
} catch (e) {
  const logPath = join(shotDir, 'playwright-unavailable.log');
  writeFileSync(logPath, String(e && e.stack || e), 'utf8');
  console.error('PLAYWRIGHT UNAVAILABLE', e.message);
  process.exit(2);
}

async function openPage(browser, viewport, colorScheme) {
  const ctx = await browser.newContext({ viewport, colorScheme });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push(String(err && err.message || err)));
  await page.goto(base + '/?chrome=' + Date.now(), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('#chrome');
  await page.waitForSelector('#scene-list .scene-item', { timeout: 30000 });
  // the panel may start closed (narrow), so only require the chips to exist
  await page.waitForSelector('#lighting-grid .chip', { state: 'attached' });
  await page.waitForSelector('#theme-grid .chip', { state: 'attached' });
  await page.waitForSelector('#skin-list .chip', { state: 'attached' });
  await page.waitForSelector('#chrome-nav .nav-link', { state: 'attached' });
  await page.waitForTimeout(1500);
  return { ctx, page, errors };
}

const browser = await chromium.launch({ headless: true });
try {
  // ---- desktop ------------------------------------------------------------------
  const { ctx, page, errors } = await openPage(browser, { width: 1440, height: 900 }, 'light');

  const geo = () => page.evaluate(() => {
    const r = (id) => document.getElementById(id).getBoundingClientRect();
    const wrap = r('map-wrap');
    const panel = r('panel');
    const canvas = document.querySelector('#map canvas');
    return {
      chromeH: r('chrome').height,
      chromeTop: r('chrome').top,
      wrapRight: wrap.right,
      wrapW: wrap.width,
      panelLeft: panel.left,
      panelW: panel.width,
      canvasW: canvas ? canvas.getBoundingClientRect().width : 0,
      collapsed: document.getElementById('panel').classList.contains('collapsed'),
      tunerActive: document.getElementById('btn-tuner').classList.contains('active'),
      scenes: document.querySelectorAll('#scene-list .scene-item').length,
      navLinks: document.querySelectorAll('#chrome-nav .nav-link').length,
      sliders: document.querySelectorAll('#panel input[type="range"]').length,
      paperBg: getComputedStyle(document.getElementById('chrome')).backgroundColor,
    };
  });

  let g = await geo();
  assert.ok(g.chromeH >= 44 && g.chromeH <= 64, 'top bar height ' + g.chromeH);
  assert.equal(g.chromeTop, 0);
  assert.equal(g.collapsed, false, 'panel starts open on desktop');
  assert.equal(g.tunerActive, true);
  assert.ok(g.panelW > 300, 'panel width ' + g.panelW);
  assert.ok(g.wrapRight <= g.panelLeft + 1, 'map must not sit under the panel');
  assert.ok(Math.abs(g.canvasW - g.wrapW) <= 2, `canvas ${g.canvasW} must fill the map area ${g.wrapW}`);
  assert.ok(g.scenes >= 6, 'scene pills ' + g.scenes);
  assert.ok(g.navLinks >= 4, 'nav links ' + g.navLinks);
  assert.ok(g.sliders >= 8, 'panel sliders ' + g.sliders);
  const [pr, pg, pb] = parseRgb(g.paperBg);
  assert.ok(pr > 200 && pg > 200 && pb > 180, 'light theme top bar should be paper, got ' + g.paperBg);

  // 分区一次只显示一个：默认是图层，点哪个标签就只剩哪个分区，并回到顶部
  const panes = () => page.evaluate(() => ({
    active: (document.querySelector('#panel-tabs a.active') || {}).textContent,
    activeHref: (document.querySelector('#panel-tabs a.active') || document.body).getAttribute('href'),
    visible: Array.from(document.querySelectorAll('#panel-body .sec')).filter((s) => s.offsetParent !== null).map((s) => s.id),
    scrollTop: document.getElementById('panel-body').scrollTop,
  }));
  let pv = await panes();
  assert.deepEqual(pv.visible, ['sec-layers'], 'default shows only the layers section');
  for (const t of ['look', 'camera', 'isolate', 'preset', 'layers']) {
    await page.click(`#panel-tabs a[href="#sec-${t}"]`);
    await page.waitForTimeout(150);
    pv = await panes();
    assert.equal(pv.activeHref, '#sec-' + t, 'active tab after click ' + t);
    assert.deepEqual(pv.visible, ['sec-' + t], 'only #sec-' + t + ' is visible');
    assert.equal(pv.scrollTop, 0, 'new section starts at the top');
  }
  // 导出 / 导入 / 重置 在预设分区，进去就在屏内
  await page.click('#panel-tabs a[href="#sec-preset"]');
  const actions = await page.evaluate(() => ['btn-copy', 'btn-download', 'btn-paste', 'btn-reset'].map((id) => {
    const b = document.getElementById(id).getBoundingClientRect();
    return { id, ok: b.width > 20 && b.right <= window.innerWidth && b.bottom <= window.innerHeight };
  }));
  for (const act of actions) assert.ok(act.ok, act.id + ' not on-screen');
  // 风格里折叠分组是互斥的（同一时间最多展开一个）
  await page.click('#panel-tabs a[href="#sec-look"]');
  const openGroups = await page.evaluate(() => document.querySelectorAll('#sec-look details.group[open]').length);
  assert.ok(openGroups <= 1, 'look accordion open groups ' + openGroups);
  await page.click('#panel-tabs a[href="#sec-layers"]');

  await page.screenshot({ path: join(shotDir, 'studio-desktop.png') });

  // closing the panel hands the width back to the map and the canvas follows
  const wasW = g.wrapW;
  await page.click('#btn-tuner');
  await page.waitForTimeout(800);
  g = await geo();
  assert.equal(g.collapsed, true);
  assert.ok(g.wrapW > wasW + 250, `map should widen when the panel closes (${wasW} -> ${g.wrapW})`);
  assert.ok(Math.abs(g.canvasW - g.wrapW) <= 2, `canvas ${g.canvasW} must follow the widened map ${g.wrapW}`);
  await page.click('#btn-tuner');
  await page.waitForTimeout(600);

  // theme toggle flips the palette and persists for the site
  await page.click('#btn-theme');
  await page.waitForTimeout(300);
  const dark = await page.evaluate(() => ({
    attr: document.documentElement.getAttribute('data-theme'),
    stored: localStorage.getItem('mapstage-site-theme'),
    bg: getComputedStyle(document.getElementById('chrome')).backgroundColor,
  }));
  assert.equal(dark.attr, 'dark');
  assert.equal(dark.stored, 'dark');
  const [dr, dg, db] = parseRgb(dark.bg);
  assert.ok(dr < 60 && dg < 60 && db < 60, 'dark theme top bar should be dark, got ' + dark.bg);
  await page.screenshot({ path: join(shotDir, 'studio-dark.png') });

  assert.equal(errors.length, 0, 'page errors on desktop: ' + errors.join(' | '));
  await ctx.close();

  // ---- narrow -----------------------------------------------------------------------
  const n = await openPage(browser, { width: 420, height: 800 }, 'light');
  const ng = await n.page.evaluate(() => ({
    collapsed: document.getElementById('panel').classList.contains('collapsed'),
    overflow: document.documentElement.scrollWidth - window.innerWidth,
    chromeOverflow: document.getElementById('chrome').scrollWidth - document.getElementById('chrome').clientWidth,
  }));
  assert.equal(ng.collapsed, true, 'panel starts closed on a narrow screen');
  assert.ok(ng.overflow <= 0, 'page overflows horizontally by ' + ng.overflow);
  assert.ok(ng.chromeOverflow <= 0, 'top bar overflows by ' + ng.chromeOverflow);
  await n.page.screenshot({ path: join(shotDir, 'studio-narrow.png') });
  await n.page.click('#btn-tuner');
  await n.page.waitForTimeout(500);
  const open = await n.page.evaluate(() => {
    const p = document.getElementById('panel').getBoundingClientRect();
    return { w: p.width, right: p.right, vw: window.innerWidth, collapsed: document.getElementById('panel').classList.contains('collapsed') };
  });
  assert.equal(open.collapsed, false);
  assert.ok(open.right <= open.vw + 1 && open.w > 280, 'narrow panel fits the viewport ' + JSON.stringify(open));
  await n.page.screenshot({ path: join(shotDir, 'studio-narrow-open.png') });
  assert.equal(n.errors.length, 0, 'page errors on narrow: ' + n.errors.join(' | '));
  await n.ctx.close();

  console.log('TUNER CHROME LIVE OK');
  console.log(JSON.stringify({ shotDir }, null, 2));
} finally {
  await browser.close();
}
