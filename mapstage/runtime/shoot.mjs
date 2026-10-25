/**
 * MapStage 截帧器：打开 site/host.html，按帧调 seek(t)，把每一帧存成图片。
 *
 *   node site/serve.mjs &                      # 8770
 *   node runtime/shoot.mjs --story examples/story-hexi.json --out ../out/hexi --mode preview
 *
 * 参数
 *   --base <url>       站点地址，默认 http://127.0.0.1:8770
 *   --story <path>     story JSON，相对站点根，默认 examples/story-hexi.json
 *   --out <dir>        输出目录（必填）
 *   --mode preview|final   preview = 960x540 @10fps jpg q80；final = 1920x1080 @30fps jpg q92（默认 preview）
 *   --fps N --width N --height N --quality N --png    覆盖 mode 的默认值
 *   --layers full|map,hud|map|hud
 *                      full：一张完整画面 f#####；map,hud：地图层 m#####.jpg + 字卡层 h#####.png（透明底）
 *   --i0 N --i1 N      只拍 [i0, i1) 这段帧并覆盖已有文件，用来局部重拍
 *   --force            忽略已有帧和旧清单，全部重拍
 *   --no-precache      跳过预缓存（冷缓存帧不保证可复现，只调试用）
 *   --swiftshader      CPU 软件光栅（逐像素可复现；默认用 ANGLE + 关 GPU 光栅化）
 *
 * 断点续拍：不带 --i0/--i1 时，已存在的帧直接跳过。
 * 清单 shoot.json 记录 story+preset 指纹、fps、尺寸、图层、格式；与已有帧不一致时拒绝续拍，
 * 免得新旧画面混在一个序列里（要么删旧帧，要么加 --force）。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium, GL_ARGS } from './lib/pw.mjs';

const MODES = {
  preview: { width: 960, height: 540, fps: 10, quality: 80 },
  final: { width: 1920, height: 1080, fps: 30, quality: 92 },
};

export function parseLayers(spec) {
  const names = String(spec || 'full').split(',').map((s) => s.trim()).filter(Boolean);
  const ok = new Set(['full', 'map', 'hud']);
  for (const n of names) if (!ok.has(n)) throw new Error('--layers 只能是 full / map / hud（逗号分隔），收到：' + n);
  if (names.includes('full') && names.length > 1) throw new Error('--layers full 不能和 map / hud 混用');
  return [...new Set(names)];
}

/** 帧文件名：full → f00001.jpg，map → m00001.jpg，hud → h00001.png（hud 永远是透明 PNG）。 */
export function frameFile(layer, index, ext) {
  const prefix = { full: 'f', map: 'm', hud: 'h' }[layer];
  const e = layer === 'hud' ? 'png' : ext;
  return prefix + String(index).padStart(5, '0') + '.' + e;
}

export function resolveOptions(raw) {
  const mode = raw.mode || 'preview';
  if (!MODES[mode]) throw new Error('--mode 只能是 preview / final');
  if (!raw.out) throw new Error('缺少 --out <dir>');
  const m = MODES[mode];
  const o = {
    base: String(raw.base || 'http://127.0.0.1:8770').replace(/\/$/, ''),
    story: raw.story || 'examples/story-hexi.json',
    out: resolve(raw.out),
    mode,
    width: Number(raw.width || m.width),
    height: Number(raw.height || m.height),
    fps: Number(raw.fps || m.fps),
    quality: Number(raw.quality || m.quality),
    ext: raw.png ? 'png' : 'jpg',
    layers: parseLayers(raw.layers),
    i0: raw.i0 != null ? Number(raw.i0) : null,
    i1: raw.i1 != null ? Number(raw.i1) : null,
    force: !!raw.force,
    precache: raw.precache !== false,
    swiftshader: !!raw.swiftshader,
    onProgress: raw.onProgress || null,
  };
  for (const k of ['width', 'height', 'fps', 'quality']) {
    if (!Number.isFinite(o[k]) || o[k] <= 0) throw new Error('--' + k + ' 必须是正数');
  }
  return o;
}

function readManifest(dir) {
  const f = join(dir, 'shoot.json');
  if (!existsSync(f)) return null;
  try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; }
}

function atomicWrite(path, buf) {
  const tmp = path + '.part';
  writeFileSync(tmp, buf);
  renameSync(tmp, path);
}

export async function shoot(raw) {
  const o = resolveOptions(raw);
  mkdirSync(o.out, { recursive: true });

  const args = o.swiftshader
    ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
    : [...GL_ARGS, '--disable-gpu-rasterization'];
  const browser = await chromium.launch({ headless: true, args });
  const slow = [];
  const t0 = Date.now();
  try {
    const page = await browser.newPage({ viewport: { width: o.width, height: o.height }, deviceScaleFactor: 1, colorScheme: 'light' });
    page.on('console', (msg) => {
      if (msg.type() === 'warning' && /idle timeout/.test(msg.text())) slow.push(msg.text());
    });
    const url = o.base + '/host.html?story=' + encodeURIComponent(o.story);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => window.__mapstageReady || window.__mapstageError, null, { timeout: 120000 });
    const err = await page.evaluate(() => window.__mapstageError || null);
    if (err) throw new Error('host 页面起不来：' + err);
    const info = await page.evaluate(() => window.__mapstageInfo);

    const total = Math.round(info.duration * o.fps);
    const ranged = o.i0 != null || o.i1 != null;
    const i0 = o.i0 != null ? o.i0 : 0;
    const i1 = o.i1 != null ? o.i1 : total;
    if (!Number.isInteger(i0) || !Number.isInteger(i1) || i0 < 0 || i1 > total || i0 >= i1) {
      throw new Error('帧区间不合法：[' + i0 + ', ' + i1 + ')，全片共 ' + total + ' 帧（0..' + (total - 1) + '）');
    }

    const manifest = {
      hash: info.hash, story: o.story, duration: info.duration, fps: o.fps, frames: total,
      width: o.width, height: o.height, layers: o.layers, ext: o.ext, quality: o.quality, mode: o.mode,
    };
    const prev = readManifest(o.out);
    if (prev && !o.force) {
      const diff = ['hash', 'fps', 'width', 'height', 'ext'].filter((k) => prev[k] !== manifest[k])
        .concat(JSON.stringify(prev.layers) !== JSON.stringify(manifest.layers) ? ['layers'] : []);
      if (diff.length) {
        throw new Error('输出目录里已有的帧和这次设置不一致（' + diff.join(', ') + '）。' +
          '删掉 ' + o.out + ' 里的旧帧，或加 --force 全部重拍。');
      }
    }
    writeFileSync(join(o.out, 'shoot.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');

    if (o.precache) await page.evaluate(() => window.stage.precache());

    let shot = 0;
    let skipped = 0;
    const frames = i1 - i0;
    for (let f = i0; f < i1; f++) {
      const files = o.layers.map((l) => ({ layer: l, path: join(o.out, frameFile(l, f, o.ext)) }));
      if (!o.force && !ranged && files.every((x) => existsSync(x.path))) { skipped++; continue; }

      let lastErr;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          await page.evaluate((t) => window.__mapstageSeek(t), f / o.fps);
          for (const { layer, path } of files) {
            await page.evaluate((l) => {
              document.documentElement.classList.remove('ms-layer-map', 'ms-layer-hud');
              if (l !== 'full') document.documentElement.classList.add('ms-layer-' + l);
            }, layer);
            const png = layer === 'hud' || o.ext === 'png';
            const buf = await page.screenshot(png
              ? { type: 'png', omitBackground: layer === 'hud' }
              : { type: 'jpeg', quality: o.quality });
            atomicWrite(path, buf);
          }
          lastErr = null;
          break;
        } catch (e) {
          lastErr = e;
        }
      }
      if (lastErr) throw new Error('第 ' + f + ' 帧（t=' + (f / o.fps).toFixed(3) + 's）截帧失败：' + (lastErr.message || lastErr));
      shot++;
      if (o.onProgress) o.onProgress({ done: shot + skipped, frames, frame: f });
    }
    await page.evaluate(() => document.documentElement.classList.remove('ms-layer-map', 'ms-layer-hud'));

    return {
      out: o.out, total, range: [i0, i1], shot, skipped, layers: o.layers,
      size: [o.width, o.height], fps: o.fps, hash: info.hash,
      slowSeeks: slow.length, seconds: Math.round((Date.now() - t0) / 100) / 10,
    };
  } finally {
    await browser.close();
  }
}

function parseArgv(argv) {
  const raw = {};
  const flags = { '--force': 'force', '--png': 'png', '--swiftshader': 'swiftshader' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (flags[a]) { raw[flags[a]] = true; continue; }
    if (a === '--no-precache') { raw.precache = false; continue; }
    if (!a.startsWith('--')) throw new Error('不认识的参数：' + a);
    const key = a.slice(2);
    const val = argv[++i];
    if (val == null || val.startsWith('--')) throw new Error('参数 ' + a + ' 缺少值');
    raw[key] = val;
  }
  return raw;
}

const isMain = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  try {
    const raw = parseArgv(process.argv.slice(2));
    let lastPct = -1;
    raw.onProgress = ({ done, frames }) => {
      const pct = Math.floor((done / frames) * 10) * 10;
      if (pct !== lastPct) { lastPct = pct; console.error('  ' + pct + '%  (' + done + '/' + frames + ')'); }
    };
    const res = await shoot(raw);
    console.log(JSON.stringify(res, null, 1));
    if (res.slowSeeks) console.error('提醒：' + res.slowSeeks + ' 次 seek 触发 idle 超时放行，那几帧可能瓦片没载全。');
  } catch (e) {
    console.error(e.message || e);
    process.exit(1);
  }
}
