// 把 mapstage skill 同步装到本机三个 agent 的 skills 目录：node mapstage/install-skill.mjs [--dry-run]
//   ~/.claude/skills/mapstage、~/.grok/skills/mapstage、~/.codex/skills/mapstage
// 只装 git 跟踪的文件（不带 out/、*.local.js、未提交脚本）。目标目录是镜像：仓库里已删除的文件会从目标删掉。
// 目标里只是安装副本，不要在那边改东西；改仓库，再跑一遍本脚本。
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const src = dirname(fileURLToPath(import.meta.url));
const dryRun = process.argv.includes('--dry-run');
const TARGETS = ['.claude', '.grok', '.codex'].map((d) => join(homedir(), d, 'skills', 'mapstage'));
const SKIP = [/^out\//, /\.local\.js$/];

const list = execFileSync('git', ['-c', 'core.quotepath=off', '-C', src, 'ls-files', '-z', '.'], { encoding: 'utf8' })
  .split('\0')
  .filter(Boolean)
  .filter((p) => !SKIP.some((re) => re.test(p)));
const want = new Set(list);

function walk(dir, base, out) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, base, out);
    else out.push(relative(base, p).split(sep).join('/'));
  }
  return out;
}

function pruneEmpty(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      pruneEmpty(p);
      if (!readdirSync(p).length && !dryRun) rmSync(p, { recursive: true });
    }
  }
}

for (const dest of TARGETS) {
  if (!existsSync(dirname(dirname(dest)))) {
    console.log('skip ' + dest + '（' + dirname(dirname(dest)) + ' 不存在）');
    continue;
  }
  const stale = existsSync(dest) ? walk(dest, dest, []).filter((p) => !want.has(p)) : [];
  if (!dryRun) {
    stale.forEach((p) => rmSync(join(dest, p)));
    list.forEach((p) => {
      mkdirSync(dirname(join(dest, p)), { recursive: true });
      copyFileSync(join(src, p), join(dest, p));
    });
    pruneEmpty(dest);
  }
  console.log((dryRun ? '[dry-run] ' : '') + dest + '：装 ' + list.length + ' 个文件，删旧文件 ' + stale.length + ' 个' +
    (stale.length ? '（' + stale.slice(0, 6).join(', ') + (stale.length > 6 ? ' …' : '') + '）' : ''));
}
