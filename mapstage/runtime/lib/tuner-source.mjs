/**
 * Read a tuner page as source text for static checks.
 *
 * Pages keep their logic and styles in assets/*.js / *.css, so grepping the
 * .html alone misses most of it. These helpers inline every local script and
 * stylesheet the page references (vendor/ and remote URLs are skipped), in
 * document order.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const LOCAL_REF = /<(?:script[^>]*\ssrc|link[^>]*\shref)=["']([^"'?#]+)[^"']*["'][^>]*>/g;

function localRefs(html, ext) {
  const refs = [];
  for (const m of html.matchAll(LOCAL_REF)) {
    const ref = m[1];
    if (/^[a-z]+:|^\/\//i.test(ref) || ref.startsWith('vendor/') || !ref.endsWith(ext)) continue;
    if (ext === '.css' && !/rel=["']stylesheet["']/.test(m[0])) continue;
    refs.push(ref);
  }
  return refs;
}

function readRefs(htmlPath, refs) {
  const dir = dirname(htmlPath);
  return refs
    .map((ref) => join(dir, ref))
    .filter((p) => existsSync(p))
    .map((p) => readFileSync(p, 'utf8'));
}

/** The page HTML followed by every local script and stylesheet it loads. */
export function readPageSource(htmlPath) {
  const html = readFileSync(htmlPath, 'utf8');
  return [html, ...readRefs(htmlPath, [...localRefs(html, '.js'), ...localRefs(html, '.css')])].join('\n');
}

/** Inline <style> blocks followed by local stylesheets, in document order. */
export function readPageCss(htmlPath) {
  const html = readFileSync(htmlPath, 'utf8');
  const inline = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]);
  return [...inline, ...readRefs(htmlPath, localRefs(html, '.css'))].join('\n');
}
