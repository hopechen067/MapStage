/**
 * Shared Playwright loader for runtime/ verify, diag and measure scripts.
 *
 *   import { chromium } from './lib/pw.mjs';
 *   const browser = await chromium.launch({ headless: true, args: GL_ARGS });
 *
 * Resolution order: `playwright` on the normal Node path, $ANTIQUE_PW_ROOT,
 * ~/antique-map-fx-pw, then <repo>/.preview-tools.
 *
 * If the Playwright build's pinned browser is not installed, launch() retries
 * with the newest Chromium already in the ms-playwright cache. Set
 * $ANTIQUE_PW_CHROMIUM to force an executable.
 */
import { existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');

/** WebGL flags every map screenshot needs in headless Chromium. */
export const GL_ARGS = ['--use-gl=angle', '--use-angle=gl-egl', '--ignore-gpu-blocklist'];

function playwrightCandidates() {
  const home = process.env.USERPROFILE || process.env.HOME || homedir();
  const roots = [process.env.ANTIQUE_PW_ROOT, home && join(home, 'antique-map-fx-pw'), join(repoRoot, '.preview-tools')];
  return ['playwright'].concat(roots.filter(Boolean).map((r) => join(r, 'node_modules', 'playwright')));
}

/** @returns {{ playwright: any, source: string, attempts: string[] }} */
export function resolvePlaywright() {
  const attempts = [];
  for (const id of playwrightCandidates()) {
    try {
      const source = require.resolve(id);
      return { playwright: wrap(require(source)), source, attempts };
    } catch (e) {
      attempts.push(`${id} (${e.code || e.message})`);
    }
  }
  const err = new Error('playwright not found; tried:\n  ' + attempts.join('\n  ') +
    '\nInstall it in ~/antique-map-fx-pw or set ANTIQUE_PW_ROOT.');
  err.attempts = attempts;
  throw err;
}

/** The playwright module, with chromium.launch() falling back to an installed browser. */
export function loadPlaywright() {
  return resolvePlaywright().playwright;
}

function browserCacheDirs() {
  const home = process.env.USERPROFILE || process.env.HOME || homedir();
  return [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'ms-playwright'),
    join(home, '.cache', 'ms-playwright'),
    join(home, 'Library', 'Caches', 'ms-playwright'),
  ].filter((d) => d && existsSync(d));
}

const EXE_SUBPATHS = {
  chromium_headless_shell: [
    'chrome-headless-shell-win64/chrome-headless-shell.exe',
    'chrome-win/headless_shell.exe',
    'chrome-headless-shell-linux64/chrome-headless-shell',
    'chrome-linux/headless_shell',
    'chrome-headless-shell-mac-arm64/chrome-headless-shell',
    'chrome-headless-shell-mac-x64/chrome-headless-shell',
    'chrome-mac/headless_shell',
  ],
  chromium: [
    'chrome-win64/chrome.exe',
    'chrome-win/chrome.exe',
    'chrome-linux64/chrome',
    'chrome-linux/chrome',
    'chrome-mac-arm64/Chromium.app/Contents/MacOS/Chromium',
    'chrome-mac/Chromium.app/Contents/MacOS/Chromium',
  ],
};

/** Newest installed Chromium executable in the ms-playwright cache, or null. */
export function findInstalledChromium(headless = true) {
  if (process.env.ANTIQUE_PW_CHROMIUM) return process.env.ANTIQUE_PW_CHROMIUM;
  const kinds = headless ? ['chromium_headless_shell', 'chromium'] : ['chromium'];
  for (const kind of kinds) {
    const found = [];
    for (const dir of browserCacheDirs()) {
      for (const name of readdirSync(dir)) {
        const m = name.match(new RegExp('^' + kind + '-(\\d+)$'));
        if (!m) continue;
        for (const sub of EXE_SUBPATHS[kind]) {
          const exe = join(dir, name, sub);
          if (existsSync(exe)) found.push({ rev: Number(m[1]), exe });
        }
      }
    }
    if (found.length) return found.sort((a, b) => b.rev - a.rev)[0].exe;
  }
  return null;
}

function wrapBrowserType(browserType) {
  async function launch(options = {}) {
    if (process.env.ANTIQUE_PW_CHROMIUM && !options.executablePath) {
      return browserType.launch({ ...options, executablePath: process.env.ANTIQUE_PW_CHROMIUM });
    }
    try {
      return await browserType.launch(options);
    } catch (e) {
      if (options.executablePath || !/Executable doesn't exist/i.test(String(e && e.message))) throw e;
      const exe = findInstalledChromium(options.headless !== false);
      if (!exe) throw e;
      console.warn('[pw] pinned browser missing; using ' + exe);
      return browserType.launch({ ...options, executablePath: exe });
    }
  }
  return new Proxy(browserType, {
    get(target, key) {
      if (key === 'launch') return launch;
      const v = target[key];
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
}

function wrap(playwright) {
  const chromium = wrapBrowserType(playwright.chromium);
  return new Proxy(playwright, {
    get(target, key) {
      return key === 'chromium' ? chromium : target[key];
    },
  });
}

let cached;
/** Lazily-resolved chromium: importing this module never throws. */
export const chromium = new Proxy({}, {
  get(_t, key) {
    cached = cached || loadPlaywright().chromium;
    return cached[key];
  },
});
