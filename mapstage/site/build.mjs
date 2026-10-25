// MapStage 官网本地构建：node mapstage/site/build.mjs [outDir] [--private]
// 产物布局与 site/serve.mjs 一致：/ → site/，/studio/ → tuner/，/references/ → references/*.md。
// 默认输出到仓库根 out/_site（已 gitignore）。CI 不在 GitHub 上跑，发布用这份产物（见 AGENTS.md）。
//
// 只拷 git 跟踪的文件：本地瓦片配置、未提交脚本、缓存不会混进去。
// 许可闸门：许可未确认的数据不进公开产物（DATA-PROVENANCE.md）。
//   - water-data.js、*.local.js：任何情况下都不发布
//   - region-isolate-data.js 若含 geojson.cn 图集数据（现已换成 Natural Earth，闸门作防回退）：默认拒绝构建；--private 只用于本地预览
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pkg = join(here, '..');
const repo = execFileSync('git', ['-C', here, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();

const args = process.argv.slice(2);
const privateBuild = args.includes('--private');
const outDir = args.find((a) => !a.startsWith('--')) || join(repo, 'out', '_site');

const SKIP = [
  /(^|\/)\.DS_Store$/,
  /\.test\.mjs$/,
  /(^|\/)_serve\./,
  /(^|\/)_preview/,
  /\.local\.js$/,
  /(^|\/)water-data\.js$/,
];
const MOUNTS = [
  { src: here, dest: '', skip: [/^serve\.mjs$/, /^build\.mjs$/] },
  { src: join(pkg, 'references'), dest: 'references', only: /\.md$/ },
  { src: join(pkg, 'tuner'), dest: 'studio', skip: [/^verify\.mjs$/] },
];

function tracked(dir) {
  const out = execFileSync('git', ['-C', repo, 'ls-files', '-z', '--', relative(repo, dir).split(sep).join('/')], { encoding: 'utf8' });
  return out.split('\0').filter(Boolean).map((p) => relative(dir, join(repo, p)).split(sep).join('/'));
}

function fail(msg) {
  console.error('FAIL ' + msg);
  process.exit(1);
}

const isolateData = join(pkg, 'tuner', 'assets', 'region-isolate-data.js');
if (existsSync(isolateData) && /geojson\.cn/.test(readFileSync(isolateData, 'utf8')) && !privateBuild) {
  fail(
    'tuner/assets/region-isolate-data.js 含 geojson.cn 图集数据，再分发许可未确认，不能进公开产物。\n' +
      '     先换成许可明确的数据（见 references/compliance.md「边界数据复核」），或用 --private 只做本地预览。'
  );
}

rmSync(outDir, { recursive: true, force: true });
let count = 0;
for (const m of MOUNTS) {
  for (const rel of tracked(m.src)) {
    if (SKIP.some((re) => re.test(rel))) continue;
    if (m.skip && m.skip.some((re) => re.test(rel))) continue;
    if (m.only && !m.only.test(rel)) continue;
    const to = join(outDir, m.dest, rel);
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(join(m.src, rel), to);
    count++;
  }
}

// 首页演示短片
const demo = join(repo, 'showcases', 'hexi-ep07', 'hexi-ep07-demo-480p.mp4');
if (existsSync(demo)) {
  mkdirSync(join(outDir, 'studio', 'media'), { recursive: true });
  copyFileSync(demo, join(outDir, 'studio', 'media', 'hexi-ep07-demo-480p.mp4'));
  count++;
}

writeFileSync(join(outDir, '.nojekyll'), '');
const commit = execFileSync('git', ['-C', repo, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
writeFileSync(join(outDir, 'DEPLOYED_AT.txt'), new Date().toISOString() + ' ' + commit + (privateBuild ? ' PRIVATE-PREVIEW' : '') + '\n');

for (const bad of ['studio/assets/water-data.js', 'studio/map-tiles.config.local.js']) {
  if (existsSync(join(outDir, bad))) fail(bad + ' 不能进产物');
}
console.log((privateBuild ? 'private preview ' : '') + 'site built: ' + count + ' files → ' + outDir);
