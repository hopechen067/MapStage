// MapStage 官网本地预览：node site/serve.mjs（PORT=8770 默认）
// 与 GitHub Pages 布局一致：/ → site/，/studio/ → tuner/，/references/ → references/
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pkg = join(here, '..');
const MOUNTS = [
  ['/studio/', join(pkg, 'tuner')],
  ['/references/', join(pkg, 'references')],
  ['/', here],
];
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.geojson': 'application/geo+json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.bin': 'application/octet-stream',
};

export function resolvePath(urlPath) {
  const clean = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  for (const [prefix, dir] of MOUNTS) {
    if (prefix !== '/' && clean === prefix.slice(0, -1)) return { redirect: prefix };
    if (!clean.startsWith(prefix)) continue;
    const rel = normalize(clean.slice(prefix.length));
    if (rel.startsWith('..')) return null;
    let file = join(dir, rel);
    if (!file.startsWith(dir)) return null;
    if (existsSync(file) && statSync(file).isDirectory()) {
      if (!clean.endsWith('/')) return { redirect: clean + '/' };
      file = join(file, 'index.html');
    }
    return { file };
  }
  return null;
}

function serve(req, res) {
  const hit = resolvePath(req.url || '/');
  if (hit && hit.redirect) {
    res.writeHead(301, { Location: hit.redirect });
    res.end();
    return;
  }
  if (!hit || !existsSync(hit.file) || hit.file.split(sep).some((p) => p === '.git')) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 ' + req.url);
    return;
  }
  res.writeHead(200, {
    'Content-Type': TYPES[extname(hit.file).toLowerCase()] || 'application/octet-stream',
    'Cache-Control': 'no-cache',
  });
  createReadStream(hit.file).pipe(res);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === normalize(process.argv[1])) {
  const port = Number(process.env.PORT || 8770);
  createServer(serve).listen(port, '127.0.0.1', () => {
    console.log('MapStage site → http://127.0.0.1:' + port + '/');
  });
}
