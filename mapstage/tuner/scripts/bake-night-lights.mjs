/**
 * 自制夜光图：不用卫星夜光影像，由 GeoNames 居民点密度模拟「从太空看夜晚」的灯光。
 *
 *   node tuner/scripts/bake-night-lights.mjs <geonames 目录> [输出 png]
 *
 * <geonames 目录> 里放 https://download.geonames.org/export/dump/ 解压后的
 * CN.txt TW.txt HK.txt MO.txt cities500.txt（GeoNames, CC BY 4.0）。
 * 中国四个文件含全部村镇（约 88 万点，多数无人口数，按地物码给默认权重）；
 * 周边国家只有 cities500（人口 ≥ 500），亮度会偏稀。
 *
 * 做法：居民点按「人口^0.8」累加到 z6 墨卡托网格，按聚落规模分档做高斯扩散（城市成片、
 * 村庄成点），再叠两层大半径光晕；对数压亮后写成带透明度的调色板 PNG（1 字节 / 像素）。
 * 透明处露出底下的海拔设色与山影。输出范围见 BOUNDS，tuner 的 nightLights 配置要一致。
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = process.argv[2];
const outPath = process.argv[3] || join(here, '..', 'assets', 'night-lights.png');
if (!srcDir) {
  console.error('usage: node bake-night-lights.mjs <geonames dir> [out.png]');
  process.exit(1);
}

// [西, 南, 东, 北]：中国全境（含南海诸岛）及周边，边缘渐隐避免硬边
const BOUNDS = [60, -2, 150, 56];
const ZOOM = 6;
const WORLD = 256 * 2 ** ZOOM;

const lonToX = (lon) => ((lon + 180) / 360) * WORLD;
const latToY = (lat) => {
  const s = Math.sin((lat * Math.PI) / 180);
  return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * WORLD;
};
const X0 = lonToX(BOUNDS[0]);
const Y0 = latToY(BOUNDS[3]);
const W = Math.round(lonToX(BOUNDS[2]) - X0);
const H = Math.round(latToY(BOUNDS[1]) - Y0);

// 无人口数时按地物码估一个规模
const DEFAULT_POP = {
  PPLC: 5e6, PPLA: 1e6, PPLA2: 3e5, PPLA3: 6e4, PPLA4: 8000, PPLA5: 3000,
  PPLX: 3000, PPLG: 50000, PPL: 600, PPLS: 600, PPLF: 300, PPLL: 200, PPLR: 300,
};
const SKIP = new Set(['PPLH', 'PPLQ', 'PPLW', 'PPLCH']);
const CHINA = ['CN', 'TW', 'HK', 'MO'];

// 城市照明随规模超线性增长：村庄只留微光，免得农村连片把国境轮廓烧出来
const LIGHT_EXP = +(process.env.LIGHT_EXP || 1.15);
const SIGMAS = [0.6, 1.2, 2.4, 4.8, 9.6]; // px，聚落扩散分档
const buckets = SIGMAS.map(() => []);

function addPoint(lon, lat, pop, boost) {
  const x = lonToX(lon) - X0;
  const y = latToY(lat) - Y0;
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const pxKm = (2 * Math.PI * 6378.137 * Math.cos((lat * Math.PI) / 180)) / WORLD;
  const sigmaKm = Math.min(12, Math.max(0.8, 0.25 * Math.sqrt(pop / 1000)));
  const sigmaPx = sigmaKm / pxKm;
  let b = 0;
  for (let i = 1; i < SIGMAS.length; i++) {
    if (Math.abs(Math.log(sigmaPx / SIGMAS[i])) < Math.abs(Math.log(sigmaPx / SIGMAS[b]))) b = i;
  }
  buckets[b].push(x, y, Math.pow(pop, LIGHT_EXP) * boost);
}

function readGeonames(file, accept) {
  const path = join(srcDir, file);
  if (!existsSync(path)) throw new Error('missing ' + path);
  let n = 0;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const f = line.split('\t');
    if (f.length < 15 || f[6] !== 'P' || SKIP.has(f[7])) continue;
    if (!accept(f[8])) continue;
    const pop = +f[14] > 0 ? +f[14] : DEFAULT_POP[f[7]] || 600;
    points.push(+f[5], +f[4], pop);
    n++;
  }
  return n;
}

const points = [];
let total = 0;
for (const cc of CHINA) total += readGeonames(cc + '.txt', () => true);
total += readGeonames('cities500.txt', (cc) => !CHINA.includes(cc));
console.log('points', total, 'grid', W + 'x' + H);

// ---- 城郊增亮：大城市周边的村镇按距离增亮，城市轮廓由真实聚落点长出来，而不是一个圆球 ----
const D = 4; // 影响场降采样
const IW = Math.ceil(W / D);
const IH = Math.ceil(H / D);
const infl = new Float32Array(IW * IH);
for (let i = 0; i < points.length; i += 3) {
  const pop = points[i + 2];
  if (pop < 20000) continue;
  const x = Math.floor((lonToX(points[i]) - X0) / D);
  const y = Math.floor((latToY(points[i + 1]) - Y0) / D);
  if (x >= 0 && y >= 0 && x < IW && y < IH) infl[y * IW + x] += pop;
}
{
  const { k, r } = (function (sigma) {
    const rr = Math.ceil(sigma * 3);
    const kk = new Float32Array(2 * rr + 1);
    let sum = 0;
    for (let i = -rr; i <= rr; i++) sum += kk[i + rr] = Math.exp(-(i * i) / (2 * sigma * sigma));
    for (let i = 0; i < kk.length; i++) kk[i] /= sum;
    return { k: kk, r: rr };
  })(+(process.env.SUBURB_SIGMA || 3));
  const t = new Float32Array(IW * IH);
  for (let y = 0; y < IH; y++) for (let x = 0; x < IW; x++) {
    let s = 0;
    for (let i = -r; i <= r; i++) { const xx = x + i; if (xx >= 0 && xx < IW) s += infl[y * IW + xx] * k[i + r]; }
    t[y * IW + x] = s;
  }
  for (let y = 0; y < IH; y++) for (let x = 0; x < IW; x++) {
    let s = 0;
    for (let i = -r; i <= r; i++) { const yy = y + i; if (yy >= 0 && yy < IH) s += t[yy * IW + x] * k[i + r]; }
    infl[y * IW + x] = s;
  }
}
const inflSorted = Array.from(infl).filter((v) => v > 0).sort((a, b) => a - b);
const inflRef = inflSorted[Math.floor(inflSorted.length * 0.995)] || 1;
const SUBURB_GAIN = +(process.env.SUBURB_GAIN || 15);
for (let i = 0; i < points.length; i += 3) {
  const lon = points[i];
  const lat = points[i + 1];
  const pop = points[i + 2];
  let boost = 1;
  if (pop < 20000) {
    const x = Math.floor((lonToX(lon) - X0) / D);
    const y = Math.floor((latToY(lat) - Y0) / D);
    if (x >= 0 && y >= 0 && x < IW && y < IH) boost = 1 + SUBURB_GAIN * Math.min(1, infl[y * IW + x] / inflRef);
  }
  addPoint(lon, lat, pop, boost);
}

// ---- 高斯模糊（可分离，边界截断） ----
function kernel(sigma) {
  const r = Math.max(1, Math.ceil(sigma * 3));
  const k = new Float32Array(2 * r + 1);
  let s = 0;
  for (let i = -r; i <= r; i++) s += k[i + r] = Math.exp(-(i * i) / (2 * sigma * sigma));
  for (let i = 0; i < k.length; i++) k[i] /= s;
  return { k, r };
}
function blur(src, sigma, tmp, dst) {
  const { k, r } = kernel(sigma);
  for (let y = 0; y < H; y++) {
    const row = y * W;
    for (let x = 0; x < W; x++) {
      let s = 0;
      const a = Math.max(-r, -x);
      const b = Math.min(r, W - 1 - x);
      for (let i = a; i <= b; i++) s += src[row + x + i] * k[i + r];
      tmp[row + x] = s;
    }
  }
  for (let y = 0; y < H; y++) {
    const a = Math.max(-r, -y);
    const b = Math.min(r, H - 1 - y);
    for (let x = 0; x < W; x++) {
      let s = 0;
      for (let i = a; i <= b; i++) s += tmp[(y + i) * W + x] * k[i + r];
      dst[y * W + x] = s;
    }
  }
}

const N = W * H;
const acc = new Float32Array(N);
const work = new Float32Array(N);
const tmp = new Float32Array(N);
const out = new Float32Array(N);

SIGMAS.forEach((sigma, bi) => {
  work.fill(0);
  const pts = buckets[bi];
  for (let i = 0; i < pts.length; i += 3) {
    // 双线性落点，避免整像素网格感
    const x = pts[i] - 0.5;
    const y = pts[i + 1] - 0.5;
    const m = pts[i + 2];
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    for (const [dx, dy, wt] of [[0, 0, (1 - fx) * (1 - fy)], [1, 0, fx * (1 - fy)], [0, 1, (1 - fx) * fy], [1, 1, fx * fy]]) {
      const xx = x0 + dx;
      const yy = y0 + dy;
      if (xx >= 0 && yy >= 0 && xx < W && yy < H) work[yy * W + xx] += m * wt;
    }
  }
  blur(work, sigma, tmp, out);
  for (let i = 0; i < N; i++) acc[i] += out[i];
  console.log('bucket σ=' + sigma, pts.length / 3);
});

// 光晕：近处溢光 + 远处天光
blur(acc, 6, tmp, work);
blur(acc, 18, tmp, out);
for (let i = 0; i < N; i++) acc[i] += 0.5 * work[i] + 0.35 * out[i];

// ---- 压亮：以亮像素的高分位为参考做对数映射 ----
const sample = [];
for (let i = 0; i < N; i += 7) if (acc[i] > 0) sample.push(acc[i]);
sample.sort((a, b) => a - b);
const ref = sample[Math.floor(sample.length * +(process.env.REF_Q || 0.999))] || 1;
const K = +(process.env.TONE_K || 12);
const FLOOR = 0.04; // 低于此值视为黑
const EDGE = 40; // px，四周渐隐
const idx = new Uint8Array(N);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = y * W + x;
    let t = Math.log1p((K * acc[i]) / ref) / Math.log1p(K);
    const edge = Math.min(1, x / EDGE, y / EDGE, (W - 1 - x) / EDGE, (H - 1 - y) / EDGE);
    t = Math.min(1, t * edge);
    t = t < FLOOR ? 0 : (t - FLOOR) / (1 - FLOOR);
    idx[i] = Math.round(t * 255);
  }
}

// ---- 调色板：暗琥珀 → 钠灯橙 → 黄白；透明度随亮度 ----
const STOPS = [
  [0, [40, 14, 0]], [0.2, [120, 48, 8]], [0.45, [225, 120, 35]],
  [0.7, [255, 190, 95]], [0.88, [255, 228, 160]], [1, [255, 250, 232]],
];
const plte = Buffer.alloc(256 * 3);
const trns = Buffer.alloc(256);
for (let i = 0; i < 256; i++) {
  const t = i / 255;
  let j = 0;
  while (j < STOPS.length - 2 && t > STOPS[j + 1][0]) j++;
  const [t0, c0] = STOPS[j];
  const [t1, c1] = STOPS[j + 1];
  const u = Math.min(1, Math.max(0, (t - t0) / (t1 - t0)));
  for (let c = 0; c < 3; c++) plte[i * 3 + c] = Math.round(c0[c] + (c1[c] - c0[c]) * u);
  trns[i] = i === 0 ? 0 : Math.round(255 * Math.min(1, Math.pow(t * 2.2, 0.85)));
}

// ---- PNG（调色板 + tRNS） ----
const CRC = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 3; // palette
const raw = Buffer.alloc((W + 1) * H);
for (let y = 0; y < H; y++) {
  raw[y * (W + 1)] = 1; // Sub filter
  for (let x = 0; x < W; x++) {
    const v = idx[y * W + x];
    raw[y * (W + 1) + 1 + x] = (v - (x ? idx[y * W + x - 1] : 0)) & 255;
  }
}
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('PLTE', plte),
  chunk('tRNS', trns),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);
writeFileSync(outPath, png);
console.log('wrote', outPath, (png.length / 1024 / 1024).toFixed(2) + ' MB', 'bounds', JSON.stringify(BOUNDS));
