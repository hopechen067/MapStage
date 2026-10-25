import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from './lib/pw.mjs';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'out', 'fx-verify');
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=gl-egl', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const base = (process.argv[2] || 'http://127.0.0.1:8766').replace(/\/$/, '');
await page.goto(base + '/?gansu-zhangye=' + Date.now(), {
  waitUntil: 'domcontentloaded',
  timeout: 60000,
});
await page.waitForFunction(() => !!window.__tunerMap, null, { timeout: 60000 });
await page.evaluate(() =>
  window.AntiqueMapFx.waitIdle(window.__tunerMap, { timeoutMs: 20000, force: true })
);

const catalog = await page.evaluate(() => {
  const data = window.REGION_ISOLATE_DATA;
  return (data.regions || []).map(function (r) {
    return { id: r.id, label: r.label, verts: r.vertexCount, osm: r.osmRelation || null };
  });
});

await page.evaluate(() => window.__studioShowTab('isolate'));
await page.selectOption('#isolate-region', 'gansu');
await page.locator('#btn-isolate').evaluate((el) => el.click());
await page.waitForTimeout(500);
await page.evaluate(() =>
  window.AntiqueMapFx.waitIdle(window.__tunerMap, { timeoutMs: 12000, force: true })
);

const gansuNational = await page.evaluate(() => {
  const map = window.__tunerMap;
  const t = map.getTerrain && map.getTerrain();
  const c = map.getCenter();
  const sel = document.getElementById('isolate-region');
  return {
    region: sel.value,
    label: sel.options[sel.selectedIndex] && sel.options[sel.selectedIndex].text,
    isolateOn: document.getElementById('btn-isolate').classList.contains('active'),
    maskVis: map.getLayoutProperty('region-mask-fill', 'visibility'),
    islandOn: !!(window.__tunerMaskKind === 'island' && window.__islandLast && window.__islandLast.ok && window.__islandLast.enabled),
    terrain: t,
    zoom: map.getZoom(),
    pitch: map.getPitch(),
    center: [c.lng, c.lat],
  };
});
await page.screenshot({ path: join(outDir, '50-isolate-gansu-national.png') });

await page.locator('#btn-terrain-rise').evaluate((el) => el.click());
await page.waitForFunction(
  () => {
    const map = window.__tunerMap;
    const t = map.getTerrain && map.getTerrain();
    return map && map.getPitch() >= 40 && t && t.exaggeration >= 1.5;
  },
  null,
  { timeout: 20000 }
);
await page.waitForTimeout(900);
await page.evaluate(() =>
  window.AntiqueMapFx.waitIdle(window.__tunerMap, { timeoutMs: 12000, force: true })
);
const gansuRise = await page.evaluate(() => {
  const map = window.__tunerMap;
  const t = map.getTerrain && map.getTerrain();
  const c = map.getCenter();
  return {
    region: document.getElementById('isolate-region').value,
    maskVis: map.getLayoutProperty('region-mask-fill', 'visibility'),
    islandOn: !!(window.__tunerMaskKind === 'island' && window.__islandLast && window.__islandLast.ok && window.__islandLast.enabled),
    terrain: t,
    zoom: map.getZoom(),
    pitch: map.getPitch(),
    center: [c.lng, c.lat],
  };
});
await page.screenshot({ path: join(outDir, '51-isolate-gansu-rise.png') });

await page.evaluate(() => window.__studioShowTab('isolate'));
await page.selectOption('#isolate-region', 'zhangye');
await page.waitForTimeout(400);
await page.locator('#btn-terrain-rise').evaluate((el) => el.click());
await page.waitForFunction(
  () => {
    const map = window.__tunerMap;
    const t = map.getTerrain && map.getTerrain();
    return map && map.getZoom() >= 6 && map.getPitch() >= 50 && t && t.exaggeration >= 1.5;
  },
  null,
  { timeout: 20000 }
);
await page.waitForTimeout(900);
await page.evaluate(() =>
  window.AntiqueMapFx.waitIdle(window.__tunerMap, { timeoutMs: 12000, force: true })
);
const zhangyeRise = await page.evaluate(() => {
  const map = window.__tunerMap;
  const t = map.getTerrain && map.getTerrain();
  const c = map.getCenter();
  return {
    region: document.getElementById('isolate-region').value,
    maskVis: map.getLayoutProperty('region-mask-fill', 'visibility'),
    islandOn: !!(window.__tunerMaskKind === 'island' && window.__islandLast && window.__islandLast.ok && window.__islandLast.enabled),
    terrain: t,
    zoom: map.getZoom(),
    pitch: map.getPitch(),
    center: [c.lng, c.lat],
  };
});
await page.screenshot({ path: join(outDir, '52-isolate-zhangye-rise.png') });

const report = { catalog, gansuNational, gansuRise, zhangyeRise };
writeFileSync(join(outDir, 'gansu-zhangye.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));

if (!catalog.some((r) => r.id === 'gansu' && r.osm === 153314)) {
  throw new Error('gansu OSM region missing');
}
if (!catalog.some((r) => r.id === 'zhangye' && r.osm === 165803)) {
  throw new Error('zhangye OSM region missing');
}
if (gansuNational.label && gansuNational.label.indexOf('示意') >= 0) {
  throw new Error('gansu still labelled as demo bbox');
}
// Isolate is applied either as the legacy overlay mask or, with terrain on, as a
// terrain-mesh island clip (the overlay stays hidden by design). Either one counts.
const isolateApplied = (r) => r.maskVis === 'visible' || r.islandOn === true;
if (!isolateApplied(gansuNational) || !isolateApplied(gansuRise) || !isolateApplied(zhangyeRise)) {
  throw new Error('isolate neither mask visible nor island clip applied');
}
if (zhangyeRise.region !== 'zhangye' || Number(zhangyeRise.terrain.exaggeration) < 1.5) {
  throw new Error('zhangye rise lost region or terrain');
}

await browser.close();
