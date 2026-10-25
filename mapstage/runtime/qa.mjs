/**
 * MapStage 成片 QA：对截帧器的输出目录做硬切 / 冻帧 / 露底 / 合规逐帧检查，并导出四类验收帧。
 *
 *   node runtime/qa.mjs <frames-dir> [--base http://127.0.0.1:8770]
 *
 * 判据（来源见 references/hosts.md「QA 判据」）
 *   硬切   相邻帧灰度平均差 > --cut（默认 28，96x54 缩略图，0..255）
 *   冻帧   画面逐像素完全一致的连续帧累计 >= --freeze 秒（默认 3）
 *   露底   没有任何图层盖住底色的像素占比 > --void（默认 0.005 = 0.5%）。宿主页把底色改成品红再逐帧数纯品红，
 *          不靠颜色猜（底图本身是米色 / 沙色，和底色相近）。--void-step N 隔 N 帧抽查。
 *   合规   对每一帧调 stage.check(t)，任何一项不过即失败（需要宿主页，--no-compliance 可关）
 *   缺帧   清单声明的帧文件不全
 * 导出  <dir>/qa/{caption,nocaption,peak,handoff}.jpg + report.json
 *   caption   第一张字卡的中间帧     nocaption  同一帧只留地图层（没有分层就取字卡最少的一帧）
 *   peak      同屏字卡最多的帧       handoff    第一次镜头运动的中点
 * 退出码：全部通过 0，否则 1。
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, GL_ARGS } from './lib/pw.mjs';
import { frameFile } from './shoot.mjs';

const SMALL_W = 96;
const SMALL_H = 54;

export function defaults(o = {}) {
  return {
    cut: o.cut != null ? Number(o.cut) : 28,
    freeze: o.freeze != null ? Number(o.freeze) : 3,
    void: o.void != null ? Number(o.void) : 0.005,
    voidTol: o.voidTol != null ? Number(o.voidTol) : 8,
    voidStep: o.voidStep != null ? Number(o.voidStep) : 1,
    compliance: o.compliance !== false,
    exports: o.exports !== false,
    voidColor: o.voidColor || null,
    base: String(o.base || 'http://127.0.0.1:8770').replace(/\/$/, ''),
    story: o.story || null,
  };
}

/** 相邻缩略图的灰度平均绝对差。 */
export function meanAbsDiff(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]);
  return s / a.length;
}

/** 把逐帧布尔标记折成连续区间 [from, to]。 */
export function runs(flags) {
  const out = [];
  let from = -1;
  for (let i = 0; i <= flags.length; i++) {
    if (i < flags.length && flags[i]) { if (from < 0) from = i; }
    else if (from >= 0) { out.push([from, i - 1]); from = -1; }
  }
  return out;
}

/** 从 story 里挑四类验收帧的下标。 */
export function pickExportFrames(story, fps, total, hasMapLayer) {
  const cards = story.cards || [];
  const visible = (i) => cards.filter((c) => i / fps >= c.t0 && i / fps < c.t1).length;
  const clamp = (i) => Math.max(0, Math.min(total - 1, i));
  const counts = Array.from({ length: total }, (_, i) => visible(i));

  const first = cards.slice().sort((a, b) => a.t0 - b.t0)[0];
  const caption = first ? clamp(Math.round(((first.t0 + first.t1) / 2) * fps)) : 0;

  const max = Math.max(...counts);
  const peakRuns = runs(counts.map((c) => c === max));
  const pr = peakRuns[0] || [0, 0];
  const peak = Math.floor((pr[0] + pr[1]) / 2);

  const min = Math.min(...counts);
  const nocaption = hasMapLayer ? caption : counts.indexOf(min);

  const moving = (story.shots || []).find((s, k) => k > 0 && s.move > 0);
  const handoff = moving ? clamp(Math.round((moving.t - moving.move / 2) * fps)) : clamp(Math.floor(total / 2));
  return { caption, nocaption, peak, handoff, peakCards: max };
}

// 浏览器内：解码一帧 → 缩略图 + 全图哈希 + 露底占比
const ANALYZE = async ({ main, hud, voidColor, tol, w, h, wantComposite }) => {
  const load = async (b64, mime) => {
    const img = new Image();
    img.src = 'data:' + mime + ';base64,' + b64;
    await img.decode();
    return img;
  };
  const mk = (iw, ih) => { const c = document.createElement('canvas'); c.width = iw; c.height = ih; return c; };
  const mainImg = await load(main.b64, main.mime);
  const W = mainImg.width, H = mainImg.height;
  const full = mk(W, H);
  const g = full.getContext('2d', { willReadFrequently: true });
  g.drawImage(mainImg, 0, 0);

  // 露底只看地图层：有分层就用 main（地图层），否则用整帧
  let voidFrac = 0;
  if (voidColor) {
    const d = g.getImageData(0, 0, W, H).data;
    let n = 0;
    for (let p = 0; p < d.length; p += 4) {
      if (Math.abs(d[p] - voidColor[0]) <= tol && Math.abs(d[p + 1] - voidColor[1]) <= tol && Math.abs(d[p + 2] - voidColor[2]) <= tol) n++;
    }
    voidFrac = n / (W * H);
  }
  if (hud) g.drawImage(await load(hud.b64, hud.mime), 0, 0);

  const d2 = g.getImageData(0, 0, W, H).data;
  let h1 = 2166136261 >>> 0;
  const u32 = new Uint32Array(d2.buffer, d2.byteOffset, d2.byteLength >> 2);
  for (let i = 0; i < u32.length; i++) { h1 ^= u32[i]; h1 = Math.imul(h1, 16777619) >>> 0; }

  const small = mk(w, h);
  const sg = small.getContext('2d', { willReadFrequently: true });
  sg.imageSmoothingEnabled = true;
  sg.imageSmoothingQuality = 'high';
  sg.drawImage(full, 0, 0, w, h);
  const sd = sg.getImageData(0, 0, w, h).data;
  const gray = new Array(w * h);
  for (let i = 0; i < w * h; i++) gray[i] = 0.299 * sd[i * 4] + 0.587 * sd[i * 4 + 1] + 0.114 * sd[i * 4 + 2];
  return { hash: h1.toString(16), gray, voidFrac, composite: wantComposite ? full.toDataURL('image/jpeg', 0.92).split(',')[1] : null, size: [W, H] };
};

/**
 * 浏览器内（宿主页）：背景层改品红，逐帧 seek（或按 cameras 给的机位 jumpTo），数「没被任何图层盖住」的像素占比。
 * 纯品红 = 底色层露出来；alpha<250 = 连底色层都没盖到（比如地平线以上），成片里会露出页面底。
 */
export const PROBE_VOID = async ({ total, fps, step, cameras }) => {
  const mp = window.stage.map;
  mp.getStyle().layers.filter((l) => l.type === 'background').forEach((l) => {
    mp.setPaintProperty(l.id, 'background-color-transition', { duration: 0, delay: 0 });
    mp.setPaintProperty(l.id, 'background-color', '#ff00ff');
  });
  const out = new Array(total).fill(null);
  const c2 = document.createElement('canvas');
  const g = c2.getContext('2d', { willReadFrequently: true });
  for (let i = 0; i < total; i += step) {
    if (cameras) {
      mp.jumpTo(cameras[i]);
      await window.AntiqueMapFx.waitIdle(mp, { force: true, timeoutMs: 12000 });
    } else {
      await window.stage.seek(i / fps);
    }
    const cv = mp.getCanvas();
    c2.width = cv.width; c2.height = cv.height;
    g.drawImage(cv, 0, 0);
    const d = g.getImageData(0, 0, c2.width, c2.height).data;
    let n = 0;
    for (let p = 0; p < d.length; p += 4) if (d[p + 3] < 250 || (d[p] > 230 && d[p + 1] < 40 && d[p + 2] > 230)) n++;
    out[i] = n / (c2.width * c2.height);
  }
  return out;
};

function mimeOf(path) { return path.endsWith('.png') ? 'image/png' : 'image/jpeg'; }

export async function qa(dir, raw = {}) {
  const o = defaults(raw);
  dir = resolve(dir);
  const mf = join(dir, 'shoot.json');
  if (!existsSync(mf)) throw new Error('目录里没有 shoot.json，不是截帧器的输出：' + dir);
  const m = JSON.parse(readFileSync(mf, 'utf8'));
  const total = m.frames;
  const fps = m.fps;
  const split = m.layers.includes('map');
  const fileFor = (i) => (split
    ? { main: join(dir, frameFile('map', i, m.ext)), hud: m.layers.includes('hud') ? join(dir, frameFile('hud', i, m.ext)) : null }
    : { main: join(dir, frameFile('full', i, m.ext)), hud: null });

  const report = {
    dir, fps, total, size: [m.width, m.height], layers: m.layers,
    thresholds: { cut: o.cut, freezeSec: o.freeze, voidFraction: o.void, voidTol: o.voidTol },
    missing: [], hardCuts: [], freezes: [], voids: [], compliance: [], exports: null,
    maxDiff: 0, maxVoid: 0, voidColor: null, ok: false,
  };

  const missing = [];
  for (let i = 0; i < total; i++) {
    const f = fileFor(i);
    if (!existsSync(f.main) || (f.hud && !existsSync(f.hud))) missing.push(i);
  }
  report.missing = runs(Array.from({ length: total }, (_, i) => missing.includes(i)));
  const have = Array.from({ length: total }, (_, i) => i).filter((i) => !missing.includes(i));

  const browser = await chromium.launch({ headless: true, args: [...GL_ARGS, '--disable-gpu-rasterization'] });
  try {
    const ana = await browser.newPage();
    let storyJson = null;
    let host = null;

    const needHost = o.compliance || (!o.voidColor);
    if (needHost) {
      host = await browser.newPage({ viewport: { width: m.width, height: m.height }, deviceScaleFactor: 1 });
      await host.goto(o.base + '/host.html?story=' + encodeURIComponent(m.story), { waitUntil: 'domcontentloaded', timeout: 60000 });
      await host.waitForFunction(() => window.__mapstageReady || window.__mapstageError, null, { timeout: 120000 });
      const err = await host.evaluate(() => window.__mapstageError || null);
      if (err) throw new Error('host 页面起不来：' + err);
      const info = await host.evaluate(() => window.__mapstageInfo);
      if (info.hash !== m.hash) report.staleFrames = '宿主页现在的 story/preset 指纹和截帧时不同，这批帧可能已过期';
      storyJson = await host.evaluate(() => JSON.parse(JSON.stringify(window.stage.story)));
    } else {
      storyJson = await (await fetch(o.base + '/' + m.story)).json();
    }

    // 合规：逐帧
    if (o.compliance && host) {
      report.complianceChecked = total;
      report.compliance = await host.evaluate(({ total, fps }) => {
        const bad = [];
        for (let i = 0; i < total; i++) {
          const r = window.stage.check(i / fps);
          r.issues.filter((x) => !x.ok).forEach((x) => bad.push({ frame: i, t: i / fps, id: x.id, label: x.label, note: x.note || '' }));
        }
        return bad;
      }, { total, fps });
    }

    // 露底有两种量法：
    //  - 给了 voidColor：在成片帧里数同色像素（外部帧 / 合成帧用）
    //  - 没给：宿主页把 background 层改成品红，逐帧 seek 后数 WebGL 画布里的纯品红像素。
    //    纯品红只会出现在「没有任何图层盖住底色」的地方，和底图本身的米色 / 沙色不会混。
    const voidColor = o.voidColor;
    report.voidColor = voidColor;
    let probeVoid = null;
    if (!voidColor && host) {
      probeVoid = await host.evaluate(PROBE_VOID, { total, fps, step: Math.max(1, Math.round(Number(o.voidStep) || 1)), cameras: null });
    }

    // 逐帧分析
    const picks = pickExportFrames(storyJson, fps, total, split);
    const wantExport = new Set(o.exports ? [picks.caption, picks.nocaption, picks.peak, picks.handoff] : []);
    const grays = new Array(total).fill(null);
    const hashes = new Array(total).fill(null);
    const voidFrac = new Array(total).fill(0);
    const composites = {};
    for (const i of have) {
      const f = fileFor(i);
      const res = await ana.evaluate(ANALYZE, {
        main: { b64: readFileSync(f.main).toString('base64'), mime: mimeOf(f.main) },
        hud: f.hud ? { b64: readFileSync(f.hud).toString('base64'), mime: 'image/png' } : null,
        voidColor, tol: o.voidTol, w: SMALL_W, h: SMALL_H, wantComposite: wantExport.has(i) && split,
      });
      grays[i] = res.gray; hashes[i] = res.hash; voidFrac[i] = res.voidFrac;
      if (res.composite) composites[i] = Buffer.from(res.composite, 'base64');
    }

    const diffs = new Array(total).fill(0);
    for (let i = 1; i < total; i++) {
      if (grays[i] && grays[i - 1]) diffs[i] = meanAbsDiff(grays[i], grays[i - 1]);
    }
    report.maxDiff = Math.round(Math.max(...diffs) * 100) / 100;
    report.hardCuts = diffs.map((d, i) => (d > o.cut ? { frame: i, t: i / fps, diff: Math.round(d * 100) / 100 } : null)).filter(Boolean);

    const same = hashes.map((h, i) => i > 0 && h && h === hashes[i - 1]);
    report.freezes = runs(same)
      .map(([a, b]) => ({ from: a - 1, to: b, seconds: Math.round(((b - a + 2) / fps) * 100) / 100 }))
      .filter((r) => r.seconds >= o.freeze);

    if (probeVoid) probeVoid.forEach((v, i) => { if (v != null) voidFrac[i] = v; });
    report.voidMode = voidColor ? 'pixel' : 'probe';
    report.maxVoid = Math.round(Math.max(...voidFrac) * 10000) / 10000;
    report.voids = runs(voidFrac.map((v) => v > o.void)).map(([a, b]) => ({
      from: a, to: b, max: Math.round(Math.max(...voidFrac.slice(a, b + 1)) * 10000) / 10000,
    }));

    // 导出验收帧
    if (o.exports) {
      const out = join(dir, 'qa');
      mkdirSync(out, { recursive: true });
      // 能直接拷原帧就拷（不二次压缩），拼合出来的才重新编码成 jpg
      const put = (name, i, mapOnly) => {
        const src = mapOnly ? join(dir, frameFile('map', i, m.ext)) : (split ? null : join(dir, frameFile('full', i, m.ext)));
        if (src && existsSync(src)) { copyFileSync(src, join(out, name + '.' + m.ext)); return; }
        if (composites[i]) writeFileSync(join(out, name + '.jpg'), composites[i]);
      };
      put('caption', picks.caption);
      put('nocaption', picks.nocaption, split);
      put('peak', picks.peak);
      put('handoff', picks.handoff);
      report.exports = { dir: out, frames: { caption: picks.caption, nocaption: picks.nocaption, peak: picks.peak, handoff: picks.handoff }, peakCards: picks.peakCards };
    }

    report.ok = !report.missing.length && !report.hardCuts.length && !report.freezes.length && !report.voids.length && !report.compliance.length;
    mkdirSync(join(dir, 'qa'), { recursive: true });
    writeFileSync(join(dir, 'qa', 'report.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');
    return report;
  } finally {
    await browser.close();
  }
}

export function summarize(r) {
  const line = (ok, name, detail) => (ok ? 'PASS ' : 'FAIL ') + name.padEnd(6) + detail;
  const t = (i) => (i / r.fps).toFixed(1) + 's';
  return [
    line(!r.missing.length, '缺帧', r.missing.length ? r.missing.map((x) => x[0] + '-' + x[1]).join(', ') : r.total + ' 帧齐全'),
    line(!r.hardCuts.length, '硬切', r.hardCuts.length ? r.hardCuts.map((c) => 't=' + t(c.frame) + ' Δ' + c.diff).join(', ') : '最大相邻差 ' + r.maxDiff + '（阈值 ' + r.thresholds.cut + '）'),
    line(!r.freezes.length, '冻帧', r.freezes.length ? r.freezes.map((x) => t(x.from) + '–' + t(x.to) + ' ' + x.seconds + 's').join(', ') : '无 ≥' + r.thresholds.freezeSec + 's 的静止段'),
    line(!r.voids.length, '露底', r.voids.length ? r.voids.map((x) => t(x.from) + '–' + t(x.to) + ' 最高 ' + x.max).join(', ') : '最高占比 ' + r.maxVoid + '（' + r.voidMode + '）'),
    line(!r.compliance.length, '合规', r.compliance.length ? r.compliance.slice(0, 6).map((c) => 't=' + c.t.toFixed(1) + ' ' + c.label).join(', ') + (r.compliance.length > 6 ? ' …共 ' + r.compliance.length + ' 条' : '') : '逐帧通过'),
    r.exports ? '导出 ' + r.exports.dir + '  ' + JSON.stringify(r.exports.frames) : '',
  ].filter(Boolean).join('\n');
}

const isMain = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  try {
    const argv = process.argv.slice(2);
    const dir = argv.find((a) => !a.startsWith('--'));
    if (!dir) throw new Error('用法：node runtime/qa.mjs <frames-dir> [--base url] [--cut 28] [--freeze 3] [--void 0.005] [--no-compliance] [--no-export]');
    const raw = {};
    for (let i = 0; i < argv.length; i++) {
      const a = argv[i];
      if (a === '--no-compliance') raw.compliance = false;
      else if (a === '--no-export') raw.exports = false;
      else if (a.startsWith('--')) raw[a.slice(2)] = argv[++i];
    }
    const r = await qa(dir, raw);
    console.log(summarize(r));
    process.exit(r.ok ? 0 : 1);
  } catch (e) {
    console.error(e.message || e);
    process.exit(1);
  }
}
