/**
 * 两段出片：低清预览 → 用户确认 → 1080p 终版。
 *
 *   node runtime/render.mjs preview --story examples/story-hexi.json --out ../out/hexi [--audio narration.mp3]
 *   node runtime/render.mjs approve --out ../out/hexi        # 用户看完预览、确认之后才跑
 *   node runtime/render.mjs final   --out ../out/hexi        # 1920x1080 @30fps crf18
 *   node runtime/render.mjs status  --out ../out/hexi
 *
 * preview   960x540 @10fps：截帧 → QA → mp4 (crf23) → 接触表 preview-contact.jpg → 写 state.json
 * approve   记下「用户确认的是哪一份 story + preset」（指纹）。预览 QA 没过不允许确认，除非 --allow-qa-fail
 * final     只有 approve 过、且 story + preset 指纹没变才开跑；否则拒绝，要求重出预览。
 *           截帧 → QA → mp4 (crf18)。终版 QA 不过也保留成品，但退出码为 1
 *
 * 选项：--base（默认 http://127.0.0.1:8770）  --layers full|map,hud（map,hud 由 ffmpeg 叠合）
 *       --audio <file>  --story <path>（preview 必填，之后记在 state.json）
 * 需要 ffmpeg 在 PATH。
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { storyFingerprint } from './lib/fingerprint.mjs';
import { qa, summarize } from './qa.mjs';
import { shoot } from './shoot.mjs';

const ENCODE = { preview: { crf: 23, preset: 'veryfast' }, final: { crf: 18, preset: 'slow' } };

function readState(out) {
  const f = join(out, 'state.json');
  return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null;
}
function writeState(out, state) {
  writeFileSync(join(out, 'state.json'), JSON.stringify(state, null, 2) + '\n', 'utf8');
}

function ffmpeg(args) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8' });
  if (r.error) throw new Error('找不到 ffmpeg，请先装好并放进 PATH：' + r.error.message);
  if (r.status !== 0) throw new Error('ffmpeg 失败：\n' + r.stderr);
}

/** 帧序列 → mp4。分层（map + hud）时在 ffmpeg 里叠合，hud 是透明 PNG。 */
export function encode(dir, manifest, outFile, { crf, preset, audio }) {
  const fps = String(manifest.fps);
  const split = manifest.layers.includes('map');
  const args = [];
  if (split) {
    args.push('-framerate', fps, '-i', join(dir, 'm%05d.' + manifest.ext));
    if (manifest.layers.includes('hud')) args.push('-framerate', fps, '-i', join(dir, 'h%05d.png'));
    if (manifest.layers.includes('hud')) args.push('-filter_complex', '[0:v][1:v]overlay=format=auto,format=yuv420p[v]', '-map', '[v]');
    else args.push('-pix_fmt', 'yuv420p');
  } else {
    args.push('-framerate', fps, '-i', join(dir, 'f%05d.' + manifest.ext), '-pix_fmt', 'yuv420p');
  }
  if (audio) args.push('-i', audio, '-c:a', 'aac', '-b:a', '192k', '-shortest');
  args.push('-c:v', 'libx264', '-crf', String(crf), '-preset', preset, '-movflags', '+faststart', outFile);
  ffmpeg(args);
}

/** 抽 12 张拼成接触表，给用户一眼看完节奏。 */
export function contactSheet(videoFile, outFile, total) {
  const every = Math.max(1, Math.ceil(total / 12));
  ffmpeg(['-i', videoFile, '-vf', `select=not(mod(n\\,${every})),scale=320:-1,tile=4x3`, '-frames:v', '1', '-q:v', '3', outFile]);
}

function readManifest(dir) {
  return JSON.parse(readFileSync(join(dir, 'shoot.json'), 'utf8'));
}

export async function preview(o) {
  if (!o.story) throw new Error('preview 需要 --story');
  const out = resolve(o.out);
  mkdirSync(out, { recursive: true });
  const dir = join(out, 'preview');
  const fp = await storyFingerprint(o.base, o.story);
  const prev = readState(out);
  // 数据变了就丢掉旧预览帧和旧确认，免得混帧
  const changed = prev && prev.hash !== fp.hash;
  const res = await shoot({ base: o.base, story: o.story, out: dir, mode: 'preview', layers: o.layers, force: !!changed, onProgress: o.onProgress });
  const report = await qa(dir, { base: o.base });
  const manifest = readManifest(dir);
  const mp4 = join(out, 'preview.mp4');
  encode(dir, manifest, mp4, { ...ENCODE.preview, audio: o.audio });
  contactSheet(mp4, join(out, 'preview-contact.jpg'), manifest.frames);
  const state = {
    story: o.story, base: o.base, hash: res.hash, layers: manifest.layers,
    preview: { mp4, qaOk: report.ok, frames: manifest.frames, at: new Date().toISOString() },
    approved: false, final: null, audio: o.audio || null,
  };
  writeState(out, state);
  return { state, report, res };
}

export function approve(o) {
  const out = resolve(o.out);
  const st = readState(out);
  if (!st || !st.preview) throw new Error('还没有预览：先跑 preview');
  if (!st.preview.qaOk && !o.allowQaFail) throw new Error('预览 QA 没过，不能确认。先修，或加 --allow-qa-fail 明确放行。');
  st.approved = true;
  st.approvedAt = new Date().toISOString();
  st.approvedHash = st.hash;
  writeState(out, st);
  return st;
}

export async function final(o) {
  const out = resolve(o.out);
  const st = readState(out);
  if (!st || !st.preview) throw new Error('还没有预览：先跑 preview，让用户确认后再 approve。');
  if (!st.approved) throw new Error('预览还没被确认：用户看完后跑 approve，才能出终版。');
  const fp = await storyFingerprint(o.base || st.base, st.story);
  if (fp.hash !== st.approvedHash) {
    throw new Error('确认之后 story / preset 又改过了（指纹 ' + st.approvedHash + ' → ' + fp.hash + '）。重出预览并重新确认，不要拿改过的数据出终版。');
  }
  const base = o.base || st.base;
  const dir = join(out, 'final');
  const res = await shoot({ base, story: st.story, out: dir, mode: 'final', layers: o.layers || st.layers.join(','), onProgress: o.onProgress });
  const report = await qa(dir, { base });
  const manifest = readManifest(dir);
  const mp4 = join(out, 'final.mp4');
  encode(dir, manifest, mp4, { ...ENCODE.final, audio: o.audio || st.audio });
  st.final = { mp4, qaOk: report.ok, frames: manifest.frames, at: new Date().toISOString() };
  writeState(out, st);
  return { state: st, report, res };
}

function parse(argv) {
  const [cmd, ...rest] = argv;
  const o = { cmd, base: 'http://127.0.0.1:8770' };
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--allow-qa-fail') o.allowQaFail = true;
    else if (a.startsWith('--')) o[a.slice(2)] = rest[++i];
    else throw new Error('不认识的参数：' + a);
  }
  if (!o.out) throw new Error('缺少 --out <dir>');
  return o;
}

const isMain = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  try {
    const o = parse(process.argv.slice(2));
    let last = -1;
    o.onProgress = ({ done, frames }) => {
      const pct = Math.floor((done / frames) * 10) * 10;
      if (pct !== last) { last = pct; console.error('  ' + pct + '%  (' + done + '/' + frames + ')'); }
    };
    if (o.cmd === 'preview') {
      const r = await preview(o);
      console.log(summarize(r.report));
      console.log('\n预览：' + r.state.preview.mp4 + '\n接触表：' + join(resolve(o.out), 'preview-contact.jpg'));
      console.log(r.state.preview.qaOk ? '\n等用户确认后跑：node runtime/render.mjs approve --out ' + o.out : '\nQA 没过：先修再重出预览。');
      process.exit(r.state.preview.qaOk ? 0 : 1);
    } else if (o.cmd === 'approve') {
      const st = approve(o);
      console.log('已确认预览（指纹 ' + st.approvedHash + '）。出终版：node runtime/render.mjs final --out ' + o.out);
    } else if (o.cmd === 'final') {
      const r = await final(o);
      console.log(summarize(r.report));
      console.log('\n终版：' + r.state.final.mp4);
      process.exit(r.state.final.qaOk ? 0 : 1);
    } else if (o.cmd === 'status') {
      console.log(JSON.stringify(readState(resolve(o.out)), null, 2));
    } else {
      throw new Error('用法：render.mjs preview|approve|final|status --out <dir> …');
    }
  } catch (e) {
    console.error(e.message || e);
    process.exit(1);
  }
}
