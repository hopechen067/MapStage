import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from './lib/pw.mjs';

const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'out', 'fx-verify');
mkdirSync(outDir, { recursive: true });

const GONGGA = { center: [101.879, 29.595], zoom: 12, pitch: 70, bearing: 22 };
const QILIAN = { center: [100.42, 38.48], zoom: 10.6, pitch: 70, bearing: 180 };

const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=angle', '--use-angle=gl-egl', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (err) => console.warn('pageerror', err.message));
await page.goto('http://127.0.0.1:8766/?relief=' + Date.now(), {
  waitUntil: 'domcontentloaded',
  timeout: 60000,
});
await page.waitForFunction(() => !!window.__tunerMap, null, { timeout: 60000 });
await page.evaluate(() =>
  window.AntiqueMapFx.waitIdle(window.__tunerMap, { timeoutMs: 20000, force: true })
);

async function shoot(name, cam, ex) {
  await page.evaluate(
    ({ cam, ex }) => {
      const map = window.__tunerMap;
      const F = window.AntiqueMapFx;
      F.jumpTo(map, cam);
      F.setTerrainEx(map, 'terrain', ex, { budget: false });
      if (typeof map.setSky === 'function') map.setSky(F.antiqueSky());
      const el = document.getElementById('st-fx');
      if (el) {
        const t = map.getTerrain && map.getTerrain();
        el.textContent =
          '夸张 ' + (t && t.exaggeration) + ' · 调用 setTerrain ×' + (map.__antiqueSetTerrainCount || 0);
      }
    },
    { cam, ex }
  );
  await page.evaluate(() =>
    window.AntiqueMapFx.waitIdle(window.__tunerMap, { timeoutMs: 20000, force: true })
  );
  await page.waitForTimeout(800);
  const info = await page.evaluate(() => {
    const map = window.__tunerMap;
    const c = map.getCenter();
    const t = map.getTerrain && map.getTerrain();
    const sky = typeof map.getSky === 'function' ? map.getSky() : 'no-getSky';
    const samples = [];
    const offs = [
      [0, 0],
      [0.04, 0],
      [0, 0.04],
      [-0.05, 0.02],
      [0.08, -0.03],
    ];
    for (let i = 0; i < offs.length; i++) {
      const lng = c.lng + offs[i][0];
      const lat = c.lat + offs[i][1];
      let z = null;
      try {
        z = map.queryTerrainElevation([lng, lat], { exaggerated: true });
      } catch (e) {
        z = null;
      }
      samples.push({ lng: lng, lat: lat, z: z });
    }
    const zs = samples.map((s) => s.z).filter((v) => typeof v === 'number' && isFinite(v));
    return {
      pitch: map.getPitch(),
      zoom: map.getZoom(),
      bearing: map.getBearing(),
      maxPitch: map.getMaxPitch ? map.getMaxPitch() : null,
      center: [c.lng, c.lat],
      terrain: t,
      sky: sky && typeof sky === 'object' ? Object.keys(sky) : sky,
      elevMin: zs.length ? Math.min.apply(null, zs) : null,
      elevMax: zs.length ? Math.max.apply(null, zs) : null,
      elevSpan: zs.length ? Math.max.apply(null, zs) - Math.min.apply(null, zs) : null,
      samples: samples,
      fxStatus: (document.getElementById('st-fx') || {}).textContent || null,
    };
  });
  const file = join(outDir, name + '-ex' + ex + '.png');
  await page.screenshot({ path: file });
  return { file: file, info: info };
}

const results = {
  gongga0: await shoot('30-gongga', GONGGA, 0),
  gongga2: await shoot('31-gongga', GONGGA, 2.2),
  qilian0: await shoot('32-qilian', QILIAN, 0),
  qilian2: await shoot('33-qilian', QILIAN, 2.2),
};

writeFileSync(join(outDir, 'terrain-diag.json'), JSON.stringify(results, null, 2));
console.log(
  JSON.stringify(
    {
      gongga0: results.gongga0.info,
      gongga2: results.gongga2.info,
      qilian0: results.qilian0.info,
      qilian2: results.qilian2.info,
    },
    null,
    2
  )
);
await browser.close();
