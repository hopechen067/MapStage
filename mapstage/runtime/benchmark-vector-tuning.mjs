/**
 * Resumable single-dimension benchmark for tuner/vector-layers.html.
 *
 * Examples:
 *   node runtime/benchmark-vector-tuning.mjs --dimension workerCount --value 1 --mode cold
 *   node runtime/benchmark-vector-tuning.mjs --dimension maxParallelImageRequests --value 32 --mode warm
 *   node runtime/benchmark-vector-tuning.mjs --dimension maxTileCacheZoomLevels --value 8 --mode cold --runs 20
 *
 * The harness never starts a server. It reuses one Chromium process and runs
 * pages sequentially. Cold runs use a fresh context with the HTTP cache
 * disabled; warm runs reuse one context after an unmeasured warm-up.
 */
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadPlaywright } from './lib/pw.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');
const DEFAULT_OUT_DIR = join(REPO_ROOT, 'out', 'fx-verify');
const DEFAULT_BASE_URL = 'http://127.0.0.1:8780';
const DEFAULT_VIEWPORT = Object.freeze({ width: 1440, height: 900 });
const REPORT_SCHEMA = 'china-antique-maplibre/vector-tuning-benchmark@2';
const MANIFEST_SCHEMA = 'china-antique-maplibre/vector-tuning-manifest@1';
const FRAME_GAP_THRESHOLD_MS = 34;
const IDEAL_FRAME_MS = 1000 / 60;
const SSIM_THRESHOLD = 0.999;
const MIN_ACCEPTANCE_RUNS = 20;

export const DIMENSIONS = Object.freeze({
  workerCount: Object.freeze({
    query: 'perfWorkers',
    // 1/2/4 are plan candidates; 6 is the measured current-default control.
    values: Object.freeze([1, 2, 4, 6]),
    reportedKey: 'workerCount',
    effectiveKey: 'workerCount',
    aliases: Object.freeze(['workers', 'worker', 'perfWorkers']),
  }),
  maxParallelImageRequests: Object.freeze({
    query: 'perfImages',
    values: Object.freeze([16, 32]),
    reportedKey: 'maxParallelImageRequests',
    effectiveKey: 'maxParallelImageRequests',
    aliases: Object.freeze(['images', 'imageRequests', 'perfImages']),
  }),
  maxTileCacheZoomLevels: Object.freeze({
    query: 'perfCacheZoom',
    values: Object.freeze([5, 8, 12]),
    reportedKey: 'maxTileCacheZoomLevels',
    effectiveKey: 'maxTileCacheZoomLevels',
    aliases: Object.freeze(['cacheZoom', 'tileCacheZoom', 'perfCacheZoom']),
  }),
});

const DIMENSION_BY_ALIAS = Object.fromEntries(
  Object.entries(DIMENSIONS).flatMap(function ([name, definition]) {
    return [name].concat(definition.aliases).map(function (alias) {
      return [String(alias).toLowerCase(), name];
    });
  })
);

function usage() {
  return [
    'Usage:',
    '  node runtime/benchmark-vector-tuning.mjs [options]',
    '',
    'Required:',
    '  --dimension <workerCount|maxParallelImageRequests|maxTileCacheZoomLevels>',
    '  --value <number>       Allowed matrix value for the selected dimension',
    '  --mode <cold|warm>     Browser-cache mode',
    '',
    'Options:',
    '  --base-url <url>       Base URL or vector-layers.html URL',
    '                         Default: http://127.0.0.1:8780',
    '  --runs <count>         Measured runs; default: 20',
    '  --baseline <json>      Prior harness report used for acceptance + SSIM',
    '  --out-dir <path>       Default: out/fx-verify',
    '  --timeout-ms <ms>      Navigation/idle timeout; default: 90000',
    '  --zoom-duration-ms <ms> Continuous zoom duration; default: 6000',
    '  --headful              Show Chromium (headless is the default)',
    '  --no-resume            Refuse an existing compatible run directory',
    '  --dry-run              Validate and print configuration only',
    '  --help                 Show this help',
    '',
    'Aliases:',
    '  workers, images, and cacheZoom are accepted as dimension names.',
    '',
    'Acceptance:',
    '  Candidate p95 frame time must improve >=10% OR dropped frames/run',
    '  must improve >=15%. First-idle p95 and observable memory p95 may',
    '  not regress, every final screenshot must have SSIM >=0.999, and',
    '  both reports must contain at least 20 successful measured runs.',
  ].join('\n');
}

function optionValue(argv, index, inlineValue, name) {
  if (inlineValue != null) return { value: inlineValue, nextIndex: index };
  if (index + 1 >= argv.length) throw new Error(name + ' requires a value');
  return { value: argv[index + 1], nextIndex: index + 1 };
}

function positiveInteger(value, name, minimum) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum) {
    throw new Error(name + ' must be an integer >= ' + minimum + ', got ' + value);
  }
  return number;
}

export function canonicalDimension(value) {
  const key = DIMENSION_BY_ALIAS[String(value || '').toLowerCase()];
  if (!key) {
    throw new Error(
      'unknown dimension "' +
        value +
        '"; expected workerCount, maxParallelImageRequests, or maxTileCacheZoomLevels'
    );
  }
  return key;
}

export function parseArgs(argv) {
  const options = {
    baseUrl: DEFAULT_BASE_URL,
    dimension: null,
    value: null,
    mode: null,
    runs: 20,
    baseline: null,
    outDir: DEFAULT_OUT_DIR,
    timeoutMs: 90000,
    zoomDurationMs: 6000,
    headless: true,
    resume: true,
    dryRun: false,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index];
    if (!raw.startsWith('--')) {
      throw new Error('unexpected positional argument "' + raw + '"');
    }
    const equalAt = raw.indexOf('=');
    const name = equalAt >= 0 ? raw.slice(0, equalAt) : raw;
    const inlineValue = equalAt >= 0 ? raw.slice(equalAt + 1) : null;
    let parsed;
    switch (name) {
      case '--base-url':
        parsed = optionValue(argv, index, inlineValue, name);
        options.baseUrl = parsed.value;
        index = parsed.nextIndex;
        break;
      case '--dimension':
        parsed = optionValue(argv, index, inlineValue, name);
        options.dimension = parsed.value;
        index = parsed.nextIndex;
        break;
      case '--value':
        parsed = optionValue(argv, index, inlineValue, name);
        options.value = parsed.value;
        index = parsed.nextIndex;
        break;
      case '--mode':
        parsed = optionValue(argv, index, inlineValue, name);
        options.mode = parsed.value;
        index = parsed.nextIndex;
        break;
      case '--runs':
        parsed = optionValue(argv, index, inlineValue, name);
        options.runs = parsed.value;
        index = parsed.nextIndex;
        break;
      case '--baseline':
        parsed = optionValue(argv, index, inlineValue, name);
        options.baseline = parsed.value;
        index = parsed.nextIndex;
        break;
      case '--out-dir':
        parsed = optionValue(argv, index, inlineValue, name);
        options.outDir = parsed.value;
        index = parsed.nextIndex;
        break;
      case '--timeout-ms':
        parsed = optionValue(argv, index, inlineValue, name);
        options.timeoutMs = parsed.value;
        index = parsed.nextIndex;
        break;
      case '--zoom-duration-ms':
        parsed = optionValue(argv, index, inlineValue, name);
        options.zoomDurationMs = parsed.value;
        index = parsed.nextIndex;
        break;
      case '--headful':
        if (inlineValue != null) throw new Error(name + ' does not take a value');
        options.headless = false;
        break;
      case '--no-resume':
        if (inlineValue != null) throw new Error(name + ' does not take a value');
        options.resume = false;
        break;
      case '--dry-run':
        if (inlineValue != null) throw new Error(name + ' does not take a value');
        options.dryRun = true;
        break;
      case '--help':
        if (inlineValue != null) throw new Error(name + ' does not take a value');
        options.help = true;
        break;
      default:
        throw new Error('unknown option "' + name + '"');
    }
  }

  if (options.help) return options;
  if (!options.dimension) throw new Error('--dimension is required');
  options.dimension = canonicalDimension(options.dimension);
  if (options.value == null || options.value === '') throw new Error('--value is required');
  options.value = Number(options.value);
  const allowed = DIMENSIONS[options.dimension].values;
  if (!allowed.includes(options.value)) {
    throw new Error(
      options.dimension + ' must be one of ' + allowed.join(', ') + ', got ' + options.value
    );
  }
  options.mode = String(options.mode || '').toLowerCase();
  if (options.mode !== 'cold' && options.mode !== 'warm') {
    throw new Error('--mode must be cold or warm');
  }
  options.runs = positiveInteger(options.runs, '--runs', 1);
  options.timeoutMs = positiveInteger(options.timeoutMs, '--timeout-ms', 5000);
  options.zoomDurationMs = positiveInteger(
    options.zoomDurationMs,
    '--zoom-duration-ms',
    1000
  );
  try {
    new URL(options.baseUrl);
  } catch (error) {
    throw new Error('--base-url must be an absolute URL: ' + options.baseUrl);
  }
  options.outDir = resolve(options.outDir);
  if (options.baseline) options.baseline = resolve(options.baseline);
  return options;
}

export function buildTargetUrl(baseUrl, dimension, value) {
  const canonical = canonicalDimension(dimension);
  const definition = DIMENSIONS[canonical];
  const target = new URL(baseUrl);
  const pathname = target.pathname.replace(/\/+$/, '');
  if (!/\/vector-layers\.html$/i.test(pathname)) {
    target.pathname = (pathname || '') + '/vector-layers.html';
  }
  Object.values(DIMENSIONS).forEach(function (entry) {
    target.searchParams.delete(entry.query);
  });
  target.searchParams.set(definition.query, String(value));
  target.hash = '';
  return target.toString();
}

function safeSlug(value) {
  return String(value).replace(/[^a-zA-Z0-9._-]+/g, '-');
}

export function createBenchmarkPlan(options) {
  const definition = DIMENSIONS[options.dimension];
  const targetUrl = buildTargetUrl(options.baseUrl, options.dimension, options.value);
  const fingerprintInput = {
    schema: REPORT_SCHEMA,
    harnessRevision: 2,
    targetUrl: targetUrl,
    dimension: options.dimension,
    value: options.value,
    mode: options.mode,
    viewport: DEFAULT_VIEWPORT,
    timeoutMs: options.timeoutMs,
    zoomDurationMs: options.zoomDurationMs,
    frameGapThresholdMs: FRAME_GAP_THRESHOLD_MS,
    droppedFrameEstimator: 'nearest-vsync-v1',
    scenario: {
      id: 'china-to-qilian-continuous-zoom-v1',
      startScene: 'china',
      endScene: 'qilian',
    },
  };
  const fingerprint = createHash('sha256')
    .update(JSON.stringify(fingerprintInput))
    .digest('hex')
    .slice(0, 20);
  const stem =
    'vector-tuning-' +
    safeSlug(options.dimension) +
    '-' +
    safeSlug(options.value) +
    '-' +
    options.mode;
  return {
    options: options,
    definition: definition,
    targetUrl: targetUrl,
    fingerprint: fingerprint,
    fingerprintInput: fingerprintInput,
    outDir: options.outDir,
    artifactDir: join(options.outDir, stem),
    reportPath: join(options.outDir, stem + '.json'),
    manifestPath: join(options.outDir, stem, 'manifest.json'),
    stem: stem,
  };
}

function jsonRead(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function atomicWriteJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = path + '.' + process.pid + '.' + Date.now() + '.tmp';
  writeFileSync(temporary, JSON.stringify(value, null, 2) + '\n', 'utf8');
  try {
    renameSync(temporary, path);
  } catch (error) {
    if (!existsSync(path)) throw error;
    unlinkSync(path);
    renameSync(temporary, path);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

function portableRelative(from, to) {
  return relative(from, to).split('\\').join('/');
}

function runPath(plan, index, suffix) {
  return join(
    plan.artifactDir,
    'run-' + String(index).padStart(3, '0') + (suffix ? '-' + suffix : '')
  );
}

function checkpointPath(plan, index) {
  return runPath(plan, index, '') + '.json';
}

function initializeStorage(plan) {
  mkdirSync(plan.outDir, { recursive: true });
  if (existsSync(plan.manifestPath)) {
    if (!plan.options.resume) {
      throw new Error(
        'run directory already exists and --no-resume was set: ' + plan.artifactDir
      );
    }
    const manifest = jsonRead(plan.manifestPath);
    if (manifest.schema !== MANIFEST_SCHEMA || manifest.fingerprint !== plan.fingerprint) {
      throw new Error(
        'existing run directory is incompatible; choose a different --out-dir: ' +
          plan.artifactDir
      );
    }
    return manifest;
  }
  mkdirSync(plan.artifactDir, { recursive: true });
  const manifest = {
    schema: MANIFEST_SCHEMA,
    createdAt: new Date().toISOString(),
    fingerprint: plan.fingerprint,
    configuration: plan.fingerprintInput,
  };
  atomicWriteJson(plan.manifestPath, manifest);
  return manifest;
}

function loadRuns(plan) {
  const runs = [];
  for (let index = 1; index <= plan.options.runs; index += 1) {
    const path = checkpointPath(plan, index);
    if (!existsSync(path)) continue;
    const run = jsonRead(path);
    if (run.fingerprint !== plan.fingerprint || run.index !== index) {
      throw new Error('incompatible checkpoint: ' + path);
    }
    runs.push(run);
  }
  return runs.sort(function (a, b) {
    return a.index - b.index;
  });
}

function upsertRun(runs, next) {
  const index = runs.findIndex(function (run) {
    return run.index === next.index;
  });
  if (index >= 0) runs[index] = next;
  else runs.push(next);
  runs.sort(function (a, b) {
    return a.index - b.index;
  });
}

function rounded(value, digits) {
  if (!Number.isFinite(value)) return null;
  return Number(value.toFixed(digits == null ? 2 : digits));
}

export function percentile(values, ratio) {
  const selected = values.filter(Number.isFinite).slice().sort(function (a, b) {
    return a - b;
  });
  if (!selected.length) return null;
  return selected[Math.min(selected.length - 1, Math.ceil(selected.length * ratio) - 1)];
}

export function estimateDroppedFrames(samples, idealFrameMs) {
  const budget = Number.isFinite(idealFrameMs) && idealFrameMs > 0
    ? idealFrameMs
    : IDEAL_FRAME_MS;
  return samples.filter(Number.isFinite).reduce(function (sum, duration) {
    return sum + Math.max(0, Math.round(duration / budget) - 1);
  }, 0);
}

function statistics(values, digits) {
  const selected = values.filter(Number.isFinite);
  if (!selected.length) {
    return {
      count: 0,
      min: null,
      max: null,
      mean: null,
      p50: null,
      p95: null,
      p99: null,
    };
  }
  const sum = selected.reduce(function (total, value) {
    return total + value;
  }, 0);
  return {
    count: selected.length,
    min: rounded(Math.min.apply(Math, selected), digits),
    max: rounded(Math.max.apply(Math, selected), digits),
    mean: rounded(sum / selected.length, digits),
    p50: rounded(percentile(selected, 0.5), digits),
    p95: rounded(percentile(selected, 0.95), digits),
    p99: rounded(percentile(selected, 0.99), digits),
  };
}

function memoryUsedBytes(run) {
  const memory = run && run.memory && run.memory.afterZoom;
  if (!memory) return null;
  if (Number.isFinite(memory.cdp && memory.cdp.jsHeapUsedBytes)) {
    return memory.cdp.jsHeapUsedBytes;
  }
  if (Number.isFinite(memory.performance && memory.performance.usedJSHeapSize)) {
    return memory.performance.usedJSHeapSize;
  }
  return null;
}

export function aggregateRuns(runs, requestedRuns, ssimBaselineIdentity) {
  const successful = runs.filter(function (run) {
    return run.ok;
  });
  const failed = runs.filter(function (run) {
    return !run.ok;
  });
  const frameTimes = successful.flatMap(function (run) {
    return (
      (run.zoom && run.zoom.frames && Array.isArray(run.zoom.frames.samplesMs)
        ? run.zoom.frames.samplesMs
        : [])
    ).filter(Number.isFinite);
  });
  const frameGapDurations = successful.flatMap(function (run) {
    return (
      (run.zoom && run.zoom.frames && Array.isArray(run.zoom.frames.gapSamplesMs)
        ? run.zoom.frames.gapSamplesMs
        : [])
    ).filter(Number.isFinite);
  });
  const longTaskDurations = successful.flatMap(function (run) {
    return (
      (run.zoom && run.zoom.longTasks && Array.isArray(run.zoom.longTasks.samplesMs)
        ? run.zoom.longTasks.samplesMs
        : [])
    ).filter(Number.isFinite);
  });
  const droppedByRun = successful.map(function (run) {
    return Number(run.zoom && run.zoom.frames && run.zoom.frames.droppedFramesEstimate) || 0;
  });
  const gapCounts = successful.map(function (run) {
    return Number(run.zoom && run.zoom.frames && run.zoom.frames.gapCount) || 0;
  });
  const longTaskCounts = successful.map(function (run) {
    return Number(run.zoom && run.zoom.longTasks && run.zoom.longTasks.count) || 0;
  });
  const ssimValues = successful
    .map(function (run) {
      const evidence = run.visual && run.visual.ssim;
      if (ssimBaselineIdentity === null) return null;
      if (
        typeof ssimBaselineIdentity === 'string' &&
        (!evidence || evidence.baselineIdentity !== ssimBaselineIdentity)
      ) {
        return null;
      }
      return evidence && evidence.score;
    })
    .filter(Number.isFinite);
  const droppedTotal = droppedByRun.reduce(function (sum, value) {
    return sum + value;
  }, 0);
  const gapTotal = gapCounts.reduce(function (sum, value) {
    return sum + value;
  }, 0);
  const longTaskTotal = longTaskCounts.reduce(function (sum, value) {
    return sum + value;
  }, 0);
  return {
    requestedRuns: requestedRuns,
    completedRuns: successful.length,
    failedRuns: failed.length,
    complete: successful.length === requestedRuns && failed.length === 0,
    firstIdleMs: statistics(
      successful.map(function (run) {
        return run.firstIdle && run.firstIdle.elapsedMs;
      })
    ),
    zoom: {
      frameTimeMs: statistics(frameTimes),
      frameGapMs: statistics(frameGapDurations),
      frameGapCountTotal: gapTotal,
      frameGapCountPerRun: successful.length ? rounded(gapTotal / successful.length) : null,
      droppedFramesTotal: droppedTotal,
      droppedFramesPerRun: successful.length
        ? rounded(droppedTotal / successful.length)
        : null,
      longTaskDurationMs: statistics(longTaskDurations),
      longTaskCountTotal: longTaskTotal,
      longTaskCountPerRun: successful.length
        ? rounded(longTaskTotal / successful.length)
        : null,
    },
    memory: {
      usedJSHeapBytes: statistics(successful.map(memoryUsedBytes)),
    },
    visualSsim: statistics(ssimValues, 6),
  };
}

function improvementPercent(baseline, candidate) {
  if (!Number.isFinite(baseline) || !Number.isFinite(candidate) || baseline <= 0) return null;
  return rounded(((baseline - candidate) / baseline) * 100, 3);
}

export function evaluateAcceptance(candidate, baseline, settings) {
  const config = Object.assign(
    {
      minRuns: MIN_ACCEPTANCE_RUNS,
      frameImprovementPercent: 10,
      droppedImprovementPercent: 15,
      ssimThreshold: SSIM_THRESHOLD,
    },
    settings || {}
  );
  if (!baseline) {
    return {
      evaluated: false,
      retain: false,
      reason: 'No --baseline report supplied',
      thresholds: config,
    };
  }

  const frameCandidate = candidate.zoom.frameTimeMs.p95;
  const frameBaseline = baseline.zoom.frameTimeMs.p95;
  const droppedCandidate = candidate.zoom.droppedFramesPerRun;
  const droppedBaseline = baseline.zoom.droppedFramesPerRun;
  const frameImprovement = improvementPercent(frameBaseline, frameCandidate);
  const droppedImprovement =
    droppedBaseline === 0 && droppedCandidate === 0
      ? 0
      : improvementPercent(droppedBaseline, droppedCandidate);
  const performancePass =
    (frameImprovement != null && frameImprovement >= config.frameImprovementPercent) ||
    (droppedImprovement != null &&
      droppedImprovement >= config.droppedImprovementPercent);

  const firstIdleObservable =
    Number.isFinite(candidate.firstIdleMs.p95) && Number.isFinite(baseline.firstIdleMs.p95);
  const firstIdlePass =
    firstIdleObservable && candidate.firstIdleMs.p95 <= baseline.firstIdleMs.p95;

  const candidateMemory = candidate.memory.usedJSHeapBytes.p95;
  const baselineMemory = baseline.memory.usedJSHeapBytes.p95;
  const memoryObservable = Number.isFinite(candidateMemory) && Number.isFinite(baselineMemory);
  const memoryPass = !memoryObservable || candidateMemory <= baselineMemory;

  const ssimComplete =
    candidate.completedRuns > 0 && candidate.visualSsim.count === candidate.completedRuns;
  const ssimPass =
    ssimComplete &&
    Number.isFinite(candidate.visualSsim.min) &&
    candidate.visualSsim.min >= config.ssimThreshold;

  const sampleSizePass =
    candidate.completedRuns >= config.minRuns && baseline.completedRuns >= config.minRuns;
  const retain =
    sampleSizePass &&
    performancePass &&
    firstIdlePass &&
    memoryPass &&
    ssimPass;

  return {
    evaluated: true,
    retain: retain,
    thresholds: config,
    sampleSize: {
      pass: sampleSizePass,
      candidateRuns: candidate.completedRuns,
      baselineRuns: baseline.completedRuns,
    },
    performance: {
      pass: performancePass,
      p95FrameTimeMs: {
        baseline: frameBaseline,
        candidate: frameCandidate,
        improvementPercent: frameImprovement,
      },
      droppedFramesPerRun: {
        baseline: droppedBaseline,
        candidate: droppedCandidate,
        improvementPercent: droppedImprovement,
      },
    },
    guards: {
      firstIdle: {
        observable: firstIdleObservable,
        pass: firstIdlePass,
        baselineP95Ms: baseline.firstIdleMs.p95,
        candidateP95Ms: candidate.firstIdleMs.p95,
      },
      memory: {
        observable: memoryObservable,
        pass: memoryPass,
        baselineP95Bytes: baselineMemory,
        candidateP95Bytes: candidateMemory,
      },
      visual: {
        observable: ssimComplete,
        pass: ssimPass,
        threshold: config.ssimThreshold,
        comparedRuns: candidate.visualSsim.count,
        minimumSsim: candidate.visualSsim.min,
      },
    },
  };
}

function loadBaseline(path) {
  if (!path) return null;
  if (!existsSync(path)) throw new Error('baseline report not found: ' + path);
  const report = jsonRead(path);
  if (report.schema !== REPORT_SCHEMA) {
    throw new Error('baseline report has unsupported schema: ' + report.schema);
  }
  const summary = report.summary || aggregateRuns(report.runs || [], report.configuration.runs);
  return {
    path: path,
    report: report,
    summary: summary,
  };
}

function baselineIdentity(baseline) {
  if (!baseline) return null;
  return [
    resolve(baseline.path),
    baseline.report.fingerprint || '',
    baseline.report.generatedAt || '',
  ].join('|');
}

function ssimMatchesBaseline(run, baseline) {
  return !!(
    baseline &&
    run &&
    run.visual &&
    run.visual.ssim &&
    run.visual.ssim.baselineIdentity === baselineIdentity(baseline)
  );
}

function baselineCompatibility(plan, baseline) {
  if (!baseline) return { compatible: false, reasons: ['baseline not supplied'] };
  const reasons = [];
  const config = baseline.report.configuration || {};
  if (config.mode !== plan.options.mode) reasons.push('cold/warm mode differs');
  if (
    !config.viewport ||
    config.viewport.width !== DEFAULT_VIEWPORT.width ||
    config.viewport.height !== DEFAULT_VIEWPORT.height
  ) {
    reasons.push('viewport differs');
  }
  if (config.zoomDurationMs !== plan.options.zoomDurationMs) {
    reasons.push('continuous zoom duration differs');
  }
  if (config.scenarioId !== plan.fingerprintInput.scenario.id) {
    reasons.push('scenario differs');
  }
  return { compatible: reasons.length === 0, reasons: reasons };
}

function installBrowserInstrumentation(config) {
  if (window.__vectorBenchmarkHarness) return;
  var frameRecords = [];
  var frameRecordDropCount = 0;
  var longTaskRecords = [];
  var longTaskRecordDropCount = 0;
  var longTaskObservable = false;
  var resourceBufferFull = false;
  var previousFrameAt = null;

  function finite(value) {
    return typeof value === 'number' && isFinite(value);
  }

  function round(value) {
    return finite(value) ? Number(value.toFixed(2)) : null;
  }

  function safeCall(target, method, fallback) {
    try {
      return target && typeof target[method] === 'function' ? target[method]() : fallback;
    } catch (error) {
      return fallback;
    }
  }

  function percentileInPage(values, ratio) {
    if (!values.length) return null;
    var selected = values.slice().sort(function (a, b) {
      return a - b;
    });
    return selected[Math.min(selected.length - 1, Math.ceil(selected.length * ratio) - 1)];
  }

  function onAnimationFrame(at) {
    if (previousFrameAt != null) {
      if (frameRecords.length < config.maxFrameRecords) {
        frameRecords.push({
          startMs: previousFrameAt,
          endMs: at,
          durationMs: at - previousFrameAt,
        });
      } else {
        frameRecordDropCount += 1;
      }
    }
    previousFrameAt = at;
    requestAnimationFrame(onAnimationFrame);
  }
  requestAnimationFrame(onAnimationFrame);

  try {
    performance.setResourceTimingBufferSize(config.resourceTimingBufferSize);
    performance.addEventListener('resourcetimingbufferfull', function () {
      resourceBufferFull = true;
    });
  } catch (error) {
    resourceBufferFull = true;
  }

  try {
    longTaskObservable =
      !!window.PerformanceObserver &&
      Array.isArray(window.PerformanceObserver.supportedEntryTypes) &&
      window.PerformanceObserver.supportedEntryTypes.indexOf('longtask') >= 0;
    if (longTaskObservable) {
      var observer = new PerformanceObserver(function (list) {
        list.getEntries().forEach(function (entry) {
          if (longTaskRecords.length < config.maxLongTaskRecords) {
            longTaskRecords.push({
              startMs: entry.startTime,
              durationMs: entry.duration,
              name: entry.name || 'self',
            });
          } else {
            longTaskRecordDropCount += 1;
          }
        });
      });
      observer.observe({ type: 'longtask', buffered: true });
    }
  } catch (error) {
    longTaskObservable = false;
  }

  function mapState(map) {
    var center = safeCall(map, 'getCenter', null);
    var terrain = safeCall(map, 'getTerrain', null);
    var projection = safeCall(map, 'getProjection', null);
    var style = safeCall(map, 'getStyle', null);
    var highwayFeatures = null;
    try {
      highwayFeatures = map.queryRenderedFeatures({ layers: ['vl-highway'] }).length;
    } catch (error) {
      highwayFeatures = null;
    }
    return {
      loaded: !!safeCall(map, 'loaded', false),
      tilesLoaded: !!safeCall(map, 'areTilesLoaded', false),
      moving: !!safeCall(map, 'isMoving', false),
      center:
        center && finite(center.lng) && finite(center.lat)
          ? [round(center.lng), round(center.lat)]
          : null,
      zoom: round(safeCall(map, 'getZoom', NaN)),
      pitch: round(safeCall(map, 'getPitch', NaN)),
      bearing: round(safeCall(map, 'getBearing', NaN)),
      projection:
        projection && projection.type
          ? projection.type
          : style && style.projection
            ? style.projection.type
            : null,
      setTerrainCount: Number(map && map.__antiqueSetTerrainCount) || 0,
      highwayFeatures: highwayFeatures,
      terrain: terrain
        ? {
            source: terrain.source || null,
            exaggeration: round(Number(terrain.exaggeration)),
          }
        : null,
    };
  }

  function summarizeFrames(startMs, endMs) {
    var selected = frameRecords.filter(function (entry) {
      return entry.startMs >= startMs && entry.endMs <= endMs;
    });
    var samples = selected.map(function (entry) {
      return round(entry.durationMs);
    });
    var gaps = samples.filter(function (duration) {
      return duration >= config.frameGapThresholdMs;
    });
    var dropped = samples.reduce(function (sum, duration) {
      return sum + Math.max(0, Math.round(duration / config.idealFrameMs) - 1);
    }, 0);
    return {
      observable: true,
      frameBudgetMs: round(config.idealFrameMs),
      gapThresholdMs: config.frameGapThresholdMs,
      count: samples.length,
      p50Ms: round(percentileInPage(samples, 0.5)),
      p95Ms: round(percentileInPage(samples, 0.95)),
      p99Ms: round(percentileInPage(samples, 0.99)),
      maxMs: round(samples.length ? Math.max.apply(Math, samples) : 0),
      gapCount: gaps.length,
      gapP95Ms: round(percentileInPage(gaps, 0.95)),
      gapMaxMs: round(gaps.length ? Math.max.apply(Math, gaps) : 0),
      droppedFramesEstimate: dropped,
      droppedFrameEstimator: 'nearest-vsync-v1',
      recorderDroppedGlobally: frameRecordDropCount,
      samplesMs: samples,
      gapSamplesMs: gaps,
    };
  }

  function summarizeLongTasks(startMs, endMs) {
    var selected = longTaskRecords.filter(function (entry) {
      return entry.startMs < endMs && entry.startMs + entry.durationMs > startMs;
    });
    var samples = selected.map(function (entry) {
      return round(entry.durationMs);
    });
    return {
      observable: longTaskObservable,
      thresholdMs: 50,
      count: samples.length,
      totalMs: round(
        samples.reduce(function (sum, duration) {
          return sum + duration;
        }, 0)
      ),
      p95Ms: round(percentileInPage(samples, 0.95)),
      maxMs: round(samples.length ? Math.max.apply(Math, samples) : 0),
      recorderDroppedGlobally: longTaskRecordDropCount,
      samplesMs: samples,
      evidence: selected
        .slice()
        .sort(function (a, b) {
          return b.durationMs - a.durationMs;
        })
        .slice(0, config.evidenceLimit)
        .map(function (entry) {
          return {
            startMs: round(entry.startMs),
            durationMs: round(entry.durationMs),
            name: entry.name,
          };
        }),
    };
  }

  function summarizeResources(startMs, endMs) {
    var entries = [];
    try {
      entries = (performance.getEntriesByType('resource') || []).filter(function (entry) {
        return entry.startTime >= startMs && entry.startTime < endMs;
      });
    } catch (error) {
      entries = [];
    }
    var byHost = {};
    var byInitiatorType = {};
    var transferSizeBytes = 0;
    var encodedBodySizeBytes = 0;
    var decodedBodySizeBytes = 0;
    var evidence = [];
    entries.forEach(function (entry) {
      var host = '(invalid-url)';
      var path = String(entry.name || '');
      try {
        var parsed = new URL(entry.name, location.href);
        host = parsed.host || '(no-host)';
        path = parsed.pathname;
      } catch (error) {
        // Keep fallback values.
      }
      byHost[host] = (byHost[host] || 0) + 1;
      var initiator = entry.initiatorType || 'unknown';
      byInitiatorType[initiator] = (byInitiatorType[initiator] || 0) + 1;
      transferSizeBytes += Number(entry.transferSize) || 0;
      encodedBodySizeBytes += Number(entry.encodedBodySize) || 0;
      decodedBodySizeBytes += Number(entry.decodedBodySize) || 0;
      evidence.push({
        host: host,
        path: path,
        initiatorType: initiator,
        startMs: round(entry.startTime),
        durationMs: round(entry.duration),
        transferSizeBytes: Number(entry.transferSize) || 0,
      });
    });
    evidence.sort(function (a, b) {
      return b.durationMs - a.durationMs;
    });
    return {
      observable: typeof performance.getEntriesByType === 'function',
      bufferFull: resourceBufferFull,
      count: entries.length,
      transferSizeBytes: transferSizeBytes,
      encodedBodySizeBytes: encodedBodySizeBytes,
      decodedBodySizeBytes: decodedBodySizeBytes,
      byHost: byHost,
      byInitiatorType: byInitiatorType,
      evidence: evidence.slice(0, config.evidenceLimit),
    };
  }

  function waitForIdle(map, timeoutMs) {
    return new Promise(function (resolve) {
      var startedAt = performance.now();
      var stableFrames = 0;
      function check() {
        var idle =
          !!safeCall(map, 'loaded', false) &&
          !!safeCall(map, 'areTilesLoaded', false) &&
          !safeCall(map, 'isMoving', false);
        stableFrames = idle ? stableFrames + 1 : 0;
        if (stableFrames >= 2) {
          resolve({
            ok: true,
            reason: 'loaded-tiles-stable',
            waitedMs: round(performance.now() - startedAt),
          });
          return;
        }
        if (performance.now() - startedAt >= timeoutMs) {
          resolve({
            ok: false,
            reason: 'timeout',
            waitedMs: round(performance.now() - startedAt),
          });
          return;
        }
        requestAnimationFrame(check);
      }
      requestAnimationFrame(check);
    });
  }

  function sceneCamera(demo, id) {
    var scene = (demo.VP.SCENES || []).filter(function (entry) {
      return entry.id === id;
    })[0];
    if (!scene || !scene.camera) throw new Error('missing scene camera: ' + id);
    return {
      center: scene.camera.center.slice(),
      zoom: scene.camera.zoom,
      pitch: scene.camera.pitch,
      bearing: scene.camera.bearing,
    };
  }

  function readConfiguration() {
    var demo = window.__vectorDemo;
    var map = demo && demo.map;
    var gl = window.maplibregl;
    var tuning = (demo && demo.perfTuning) || {};
    var effectiveWorkers = null;
    var effectiveImages = null;
    try {
      effectiveWorkers =
        gl && typeof gl.getWorkerCount === 'function' ? gl.getWorkerCount() : null;
    } catch (error) {
      effectiveWorkers = null;
    }
    try {
      effectiveImages =
        gl && typeof gl.getMaxParallelImageRequests === 'function'
          ? gl.getMaxParallelImageRequests()
          : null;
    } catch (error) {
      effectiveImages = null;
    }
    var effectiveCache = null;
    try {
      effectiveCache =
        map && finite(Number(map._maxTileCacheZoomLevels))
          ? Number(map._maxTileCacheZoomLevels)
          : null;
    } catch (error) {
      effectiveCache = null;
    }
    return {
      query: Object.fromEntries(new URLSearchParams(location.search)),
      reported: {
        workerCount: tuning.workerCount == null ? null : Number(tuning.workerCount),
        maxParallelImageRequests:
          tuning.maxParallelImageRequests == null
            ? null
            : Number(tuning.maxParallelImageRequests),
        maxTileCacheZoomLevels:
          tuning.maxTileCacheZoomLevels == null
            ? null
            : Number(tuning.maxTileCacheZoomLevels),
      },
      effective: {
        workerCount: effectiveWorkers == null ? null : Number(effectiveWorkers),
        maxParallelImageRequests: effectiveImages == null ? null : Number(effectiveImages),
        maxTileCacheZoomLevels: effectiveCache,
      },
      map: mapState(map),
    };
  }

  window.__vectorBenchmarkHarness = {
    waitForFirstIdle: async function (timeoutMs) {
      var map = window.__vectorDemo.map;
      var idle = await waitForIdle(map, timeoutMs);
      var endedAt = performance.now();
      return {
        ok: idle.ok,
        reason: idle.reason,
        startedAtMs: 0,
        endedAtMs: round(endedAt),
        elapsedMs: round(endedAt),
        frames: summarizeFrames(0, endedAt),
        longTasks: summarizeLongTasks(0, endedAt),
        resources: summarizeResources(0, endedAt),
        map: mapState(map),
      };
    },
    prepareZoom: async function (input) {
      var demo = window.__vectorDemo;
      var map = demo.map;
      var startedAt = performance.now();
      map.stop();
      map.jumpTo(sceneCamera(demo, input.startScene));
      var idle = await waitForIdle(map, input.timeoutMs);
      return {
        ok: idle.ok,
        reason: idle.reason,
        elapsedMs: round(performance.now() - startedAt),
        map: mapState(map),
      };
    },
    runContinuousZoom: async function (input) {
      var demo = window.__vectorDemo;
      var map = demo.map;
      var endCamera = sceneCamera(demo, input.endScene);
      map.stop();
      var startedAt = performance.now();
      var moveResult = await new Promise(function (resolve) {
        var settled = false;
        function finish(ok, reason) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          try {
            map.off('moveend', onMoveEnd);
          } catch (error) {
            // Ignore cleanup errors.
          }
          resolve({ ok: ok, reason: reason, endedAtMs: performance.now() });
        }
        function onMoveEnd() {
          finish(true, 'moveend');
        }
        map.on('moveend', onMoveEnd);
        var timer = setTimeout(function () {
          finish(false, 'move-timeout');
          try {
            map.stop();
          } catch (error) {
            // Ignore stop errors after timeout.
          }
        }, input.timeoutMs);
        try {
          map.easeTo({
            center: endCamera.center,
            zoom: endCamera.zoom,
            pitch: endCamera.pitch,
            bearing: endCamera.bearing,
            duration: input.durationMs,
            easing: function (t) {
              return t;
            },
            essential: true,
          });
        } catch (error) {
          finish(false, 'action-error: ' + String(error && error.message ? error.message : error));
        }
      });
      await new Promise(function (resolve) {
        requestAnimationFrame(function () {
          requestAnimationFrame(resolve);
        });
      });
      var movementEndedAt = performance.now();
      var idle = await waitForIdle(map, input.timeoutMs);
      var settledAt = performance.now();
      return {
        ok: moveResult.ok && idle.ok,
        reason: moveResult.reason + '+' + idle.reason,
        startedAtMs: round(startedAt),
        movementEndedAtMs: round(movementEndedAt),
        settledAtMs: round(settledAt),
        movementElapsedMs: round(movementEndedAt - startedAt),
        settleElapsedMs: round(settledAt - movementEndedAt),
        frames: summarizeFrames(startedAt, movementEndedAt),
        longTasks: summarizeLongTasks(startedAt, movementEndedAt),
        resources: summarizeResources(startedAt, movementEndedAt),
        map: mapState(map),
      };
    },
    readConfiguration: readConfiguration,
    readEnvironment: function () {
      var navigation = performance.getEntriesByType('navigation')[0];
      return {
        url: location.href,
        userAgent: navigator.userAgent,
        hardwareConcurrency: navigator.hardwareConcurrency || null,
        deviceMemoryGb: navigator.deviceMemory || null,
        devicePixelRatio: window.devicePixelRatio,
        crossOriginIsolated: !!window.crossOriginIsolated,
        longTaskObservable: longTaskObservable,
        recorder: {
          frameRecordCount: frameRecords.length,
          frameRecordDropCount: frameRecordDropCount,
          longTaskRecordCount: longTaskRecords.length,
          longTaskRecordDropCount: longTaskRecordDropCount,
          resourceBufferFull: resourceBufferFull,
        },
        navigation: navigation
          ? {
              domContentLoadedMs: round(navigation.domContentLoadedEventEnd),
              loadEventMs: round(navigation.loadEventEnd),
              transferSizeBytes: Number(navigation.transferSize) || 0,
            }
          : null,
      };
    },
  };
}

function createTelemetry(page) {
  let records = [];
  let lookup = new WeakMap();
  let pageErrors = [];
  let consoleMessages = [];

  page.on('request', function (request) {
    const record = {
      url: request.url(),
      resourceType: request.resourceType(),
      startedAtEpochMs: Date.now(),
      status: null,
      finished: false,
      failed: false,
      failure: null,
    };
    records.push(record);
    lookup.set(request, record);
  });
  page.on('response', function (response) {
    const record = lookup.get(response.request());
    if (record) record.status = response.status();
  });
  page.on('requestfinished', function (request) {
    const record = lookup.get(request);
    if (record) record.finished = true;
  });
  page.on('requestfailed', function (request) {
    const record = lookup.get(request);
    if (record) {
      record.failed = true;
      record.failure = request.failure() ? request.failure().errorText : 'unknown';
    }
  });
  page.on('pageerror', function (error) {
    pageErrors.push(String(error && error.message ? error.message : error));
  });
  page.on('console', function (message) {
    if (message.type() === 'warning' || message.type() === 'error') {
      consoleMessages.push({
        type: message.type(),
        text: message.text().slice(0, 1000),
      });
    }
  });

  return {
    reset: function () {
      records = [];
      lookup = new WeakMap();
      pageErrors = [];
      consoleMessages = [];
    },
    snapshot: function () {
      const byResourceType = {};
      const byStatusClass = {};
      records.forEach(function (record) {
        byResourceType[record.resourceType] = (byResourceType[record.resourceType] || 0) + 1;
        if (record.status != null) {
          const key = Math.floor(record.status / 100) + 'xx';
          byStatusClass[key] = (byStatusClass[key] || 0) + 1;
        }
      });
      return {
        requests: {
          count: records.length,
          finished: records.filter(function (record) {
            return record.finished;
          }).length,
          failed: records.filter(function (record) {
            return record.failed;
          }).length,
          byResourceType: byResourceType,
          byStatusClass: byStatusClass,
          failures: records
            .filter(function (record) {
              return record.failed;
            })
            .slice(0, 20)
            .map(function (record) {
              return { url: record.url, resourceType: record.resourceType, failure: record.failure };
            }),
        },
        pageErrors: pageErrors.slice(),
        consoleMessages: consoleMessages.slice(0, 100),
      };
    },
  };
}

async function createPageHarness(browser, plan, cold) {
  const context = await browser.newContext({
    viewport: DEFAULT_VIEWPORT,
    deviceScaleFactor: 1,
    reducedMotion: 'no-preference',
    serviceWorkers: 'block',
  });
  const page = await context.newPage();
  await page.addInitScript(installBrowserInstrumentation, {
    frameGapThresholdMs: FRAME_GAP_THRESHOLD_MS,
    idealFrameMs: IDEAL_FRAME_MS,
    maxFrameRecords: 100000,
    maxLongTaskRecords: 20000,
    resourceTimingBufferSize: 20000,
    evidenceLimit: 20,
  });
  const cdp = await context.newCDPSession(page);
  try {
    await cdp.send('Performance.enable');
  } catch (error) {
    // Memory remains observable through performance.memory on Chromium.
  }
  if (cold) {
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  }
  return {
    context: context,
    page: page,
    cdp: cdp,
    telemetry: createTelemetry(page),
    plan: plan,
  };
}

async function collectMemory(page, cdp) {
  let performanceMemory = null;
  try {
    performanceMemory = await page.evaluate(function () {
      var memory = performance.memory;
      if (!memory) return null;
      return {
        usedJSHeapSize: Number(memory.usedJSHeapSize) || null,
        totalJSHeapSize: Number(memory.totalJSHeapSize) || null,
        jsHeapSizeLimit: Number(memory.jsHeapSizeLimit) || null,
      };
    });
  } catch (error) {
    performanceMemory = null;
  }

  let cdpMemory = null;
  try {
    const result = await cdp.send('Performance.getMetrics');
    const values = Object.fromEntries(
      (result.metrics || []).map(function (metric) {
        return [metric.name, metric.value];
      })
    );
    cdpMemory = {
      jsHeapUsedBytes: Number.isFinite(values.JSHeapUsedSize) ? values.JSHeapUsedSize : null,
      jsHeapTotalBytes: Number.isFinite(values.JSHeapTotalSize) ? values.JSHeapTotalSize : null,
      documents: Number.isFinite(values.Documents) ? values.Documents : null,
      nodes: Number.isFinite(values.Nodes) ? values.Nodes : null,
      layoutObjects: Number.isFinite(values.LayoutObjects) ? values.LayoutObjects : null,
    };
  } catch (error) {
    cdpMemory = null;
  }

  let domCounters = null;
  try {
    const counters = await cdp.send('Memory.getDOMCounters');
    domCounters = {
      documents: counters.documents,
      nodes: counters.nodes,
      jsEventListeners: counters.jsEventListeners,
    };
  } catch (error) {
    domCounters = null;
  }

  return {
    observable: !!(
      performanceMemory ||
      (cdpMemory && Number.isFinite(cdpMemory.jsHeapUsedBytes))
    ),
    performance: performanceMemory,
    cdp: cdpMemory,
    domCounters: domCounters,
  };
}

export function assessConfiguration(evidence, dimension, value) {
  const definition = DIMENSIONS[canonicalDimension(dimension)];
  const reported = evidence && evidence.reported
    ? evidence.reported[definition.reportedKey]
    : null;
  const effective = evidence && evidence.effective
    ? evidence.effective[definition.effectiveKey]
    : null;
  const reportedMatch = Number(reported) === Number(value);
  const effectiveObservable = Number.isFinite(effective);
  const effectiveMatch = !effectiveObservable || Number(effective) === Number(value);
  return {
    pass: reportedMatch && effectiveMatch,
    reported: reported,
    reportedMatch: reportedMatch,
    effective: effective,
    effectiveObservable: effectiveObservable,
    effectiveMatch: effectiveMatch,
  };
}

async function executeSequence(harness, plan, index, captureArtifacts) {
  const page = harness.page;
  harness.telemetry.reset();
  const startedAt = new Date().toISOString();
  await page.goto(plan.targetUrl, {
    waitUntil: 'domcontentloaded',
    timeout: plan.options.timeoutMs,
  });
  await page.waitForFunction(
    function () {
      return !!(
        window.__vectorDemo &&
        window.__vectorDemo.map &&
        window.__vectorBenchmarkHarness
      );
    },
    null,
    { timeout: plan.options.timeoutMs }
  );

  const firstIdle = await page.evaluate(
    function (timeoutMs) {
      return window.__vectorBenchmarkHarness.waitForFirstIdle(timeoutMs);
    },
    plan.options.timeoutMs
  );
  if (!firstIdle.ok) {
    throw new Error('first idle failed: ' + firstIdle.reason);
  }

  const configurationEvidence = await page.evaluate(function () {
    return window.__vectorBenchmarkHarness.readConfiguration();
  });
  const configurationAssessment = assessConfiguration(
    configurationEvidence,
    plan.options.dimension,
    plan.options.value
  );
  if (!configurationAssessment.pass) {
    throw new Error(
      'requested tuning was not applied: ' + JSON.stringify(configurationAssessment)
    );
  }

  const memoryAtFirstIdle = await collectMemory(page, harness.cdp);
  let idleScreenshot = null;
  if (captureArtifacts) {
    idleScreenshot = runPath(plan, index, 'idle') + '.png';
    await page.screenshot({
      path: idleScreenshot,
      fullPage: false,
      animations: 'disabled',
    });
  }

  const setup = await page.evaluate(
    function (input) {
      return window.__vectorBenchmarkHarness.prepareZoom(input);
    },
    {
      startScene: plan.fingerprintInput.scenario.startScene,
      timeoutMs: plan.options.timeoutMs,
    }
  );
  if (!setup.ok) throw new Error('zoom setup failed: ' + setup.reason);

  const zoom = await page.evaluate(
    function (input) {
      return window.__vectorBenchmarkHarness.runContinuousZoom(input);
    },
    {
      endScene: plan.fingerprintInput.scenario.endScene,
      durationMs: plan.options.zoomDurationMs,
      timeoutMs: plan.options.timeoutMs,
    }
  );
  if (!zoom.ok) throw new Error('continuous zoom failed: ' + zoom.reason);
  if (zoom.map.projection !== 'globe') {
    throw new Error('continuous zoom left globe projection: ' + zoom.map.projection);
  }
  if (zoom.map.setTerrainCount !== firstIdle.map.setTerrainCount) {
    throw new Error(
      'ordinary zoom changed terrain ' +
        firstIdle.map.setTerrainCount +
        ' -> ' +
        zoom.map.setTerrainCount
    );
  }

  const memoryAfterZoom = await collectMemory(page, harness.cdp);
  let zoomScreenshot = null;
  let zoomScreenshotBuffer = null;
  if (captureArtifacts) {
    zoomScreenshot = runPath(plan, index, 'zoom') + '.png';
    zoomScreenshotBuffer = await page.screenshot({
      path: zoomScreenshot,
      fullPage: false,
      animations: 'disabled',
    });
  }

  const environment = await page.evaluate(function () {
    return window.__vectorBenchmarkHarness.readEnvironment();
  });
  const telemetry = harness.telemetry.snapshot();
  if (telemetry.pageErrors.length) {
    throw new Error('page errors: ' + telemetry.pageErrors.join(' | '));
  }

  return {
    result: {
      schema: REPORT_SCHEMA + '/run@1',
      fingerprint: plan.fingerprint,
      index: index,
      ok: true,
      mode: plan.options.mode,
      startedAt: startedAt,
      completedAt: new Date().toISOString(),
      targetUrl: plan.targetUrl,
      requested: {
        dimension: plan.options.dimension,
        value: plan.options.value,
        query: plan.definition.query,
      },
      configurationEvidence: configurationEvidence,
      configurationAssessment: configurationAssessment,
      firstIdle: firstIdle,
      setup: setup,
      zoom: zoom,
      memory: {
        firstIdle: memoryAtFirstIdle,
        afterZoom: memoryAfterZoom,
      },
      environment: environment,
      telemetry: telemetry,
      visual: {
        ssim: null,
      },
      artifacts: captureArtifacts
        ? {
            idleScreenshot: portableRelative(plan.outDir, idleScreenshot),
            zoomScreenshot: portableRelative(plan.outDir, zoomScreenshot),
          }
        : null,
    },
    zoomScreenshotBuffer: zoomScreenshotBuffer,
  };
}

async function comparePngBuffers(page, candidate, baseline) {
  return page.evaluate(
    async function (input) {
      function imageFromBase64(base64) {
        return new Promise(function (resolve, reject) {
          var image = new Image();
          image.onload = function () {
            resolve(image);
          };
          image.onerror = function () {
            reject(new Error('PNG decode failed'));
          };
          image.src = 'data:image/png;base64,' + base64;
        });
      }

      var images = await Promise.all([
        imageFromBase64(input.candidate),
        imageFromBase64(input.baseline),
      ]);
      var first = images[0];
      var second = images[1];
      if (first.width !== second.width || first.height !== second.height) {
        return {
          observable: false,
          score: null,
          reason:
            'dimension mismatch: ' +
            first.width +
            'x' +
            first.height +
            ' vs ' +
            second.width +
            'x' +
            second.height,
        };
      }

      var canvas = document.createElement('canvas');
      canvas.width = first.width;
      canvas.height = first.height;
      var context = canvas.getContext('2d', { willReadFrequently: true });
      context.drawImage(first, 0, 0);
      var firstPixels = context.getImageData(0, 0, first.width, first.height).data;
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(second, 0, 0);
      var secondPixels = context.getImageData(0, 0, second.width, second.height).data;

      var blockSize = 8;
      var c1 = Math.pow(0.01 * 255, 2);
      var c2 = Math.pow(0.03 * 255, 2);
      var scoreTotal = 0;
      var blockCount = 0;
      for (var top = 0; top < first.height; top += blockSize) {
        for (var left = 0; left < first.width; left += blockSize) {
          var count = 0;
          var sumA = 0;
          var sumB = 0;
          var sumAA = 0;
          var sumBB = 0;
          var sumAB = 0;
          var bottom = Math.min(first.height, top + blockSize);
          var right = Math.min(first.width, left + blockSize);
          for (var y = top; y < bottom; y += 1) {
            for (var x = left; x < right; x += 1) {
              var offset = (y * first.width + x) * 4;
              var a =
                firstPixels[offset] * 0.2126 +
                firstPixels[offset + 1] * 0.7152 +
                firstPixels[offset + 2] * 0.0722;
              var b =
                secondPixels[offset] * 0.2126 +
                secondPixels[offset + 1] * 0.7152 +
                secondPixels[offset + 2] * 0.0722;
              count += 1;
              sumA += a;
              sumB += b;
              sumAA += a * a;
              sumBB += b * b;
              sumAB += a * b;
            }
          }
          var meanA = sumA / count;
          var meanB = sumB / count;
          var divisor = Math.max(1, count - 1);
          var varianceA = Math.max(0, (sumAA - (sumA * sumA) / count) / divisor);
          var varianceB = Math.max(0, (sumBB - (sumB * sumB) / count) / divisor);
          var covariance = (sumAB - (sumA * sumB) / count) / divisor;
          var numerator = (2 * meanA * meanB + c1) * (2 * covariance + c2);
          var denominator =
            (meanA * meanA + meanB * meanB + c1) * (varianceA + varianceB + c2);
          scoreTotal += denominator === 0 ? 1 : numerator / denominator;
          blockCount += 1;
        }
      }
      return {
        observable: true,
        score: Number((scoreTotal / blockCount).toFixed(6)),
        threshold: input.threshold,
        pass: scoreTotal / blockCount >= input.threshold,
        width: first.width,
        height: first.height,
        blockSize: blockSize,
        algorithm: 'luma-ssim-8x8',
      };
    },
    {
      candidate: candidate.toString('base64'),
      baseline: baseline.toString('base64'),
      threshold: SSIM_THRESHOLD,
    }
  );
}

function artifactAbsolute(reportPath, artifactPath) {
  if (!artifactPath) return null;
  return isAbsolute(artifactPath)
    ? artifactPath
    : resolve(dirname(reportPath), artifactPath);
}

function matchingBaselineRun(baseline, index) {
  if (!baseline) return null;
  return (baseline.report.runs || []).find(function (run) {
    return run.ok && run.index === index;
  });
}

async function addSsimEvidence(comparePage, plan, run, baseline) {
  const identity = baselineIdentity(baseline);
  const referenceRun = matchingBaselineRun(baseline, run.index);
  if (!referenceRun) {
    run.visual.ssim = {
      observable: false,
      score: null,
      reason: 'baseline run ' + run.index + ' is missing',
      baselineIdentity: identity,
    };
    return run;
  }
  const candidatePath = artifactAbsolute(plan.reportPath, run.artifacts.zoomScreenshot);
  const baselinePath = artifactAbsolute(
    baseline.path,
    referenceRun.artifacts && referenceRun.artifacts.zoomScreenshot
  );
  if (!candidatePath || !existsSync(candidatePath)) {
    run.visual.ssim = {
      observable: false,
      score: null,
      reason: 'candidate screenshot is missing: ' + candidatePath,
      baselineIdentity: identity,
    };
    return run;
  }
  if (!baselinePath || !existsSync(baselinePath)) {
    run.visual.ssim = {
      observable: false,
      score: null,
      reason: 'baseline screenshot is missing: ' + baselinePath,
      baselineIdentity: identity,
    };
    return run;
  }
  run.visual.ssim = await comparePngBuffers(
    comparePage,
    readFileSync(candidatePath),
    readFileSync(baselinePath)
  );
  run.visual.ssim.baselineScreenshot = baselinePath;
  run.visual.ssim.baselineIdentity = identity;
  return run;
}

function reportObject(plan, runs, baseline, browserVersion) {
  const summary = aggregateRuns(
    runs,
    plan.options.runs,
    baseline ? baselineIdentity(baseline) : null
  );
  const compatibility = baselineCompatibility(plan, baseline);
  const acceptance =
    baseline && compatibility.compatible
      ? evaluateAcceptance(summary, baseline.summary)
      : {
          evaluated: false,
          retain: false,
          reason: baseline
            ? 'Baseline is incompatible: ' + compatibility.reasons.join('; ')
            : 'No --baseline report supplied',
          baselineCompatibility: compatibility,
        };
  const firstEnvironment = runs.find(function (run) {
    return run.ok && run.environment;
  });
  return {
    schema: REPORT_SCHEMA,
    generatedAt: new Date().toISOString(),
    status: summary.complete ? 'complete' : 'incomplete',
    fingerprint: plan.fingerprint,
    target: plan.targetUrl,
    configuration: {
      baseUrl: plan.options.baseUrl,
      targetUrl: plan.targetUrl,
      dimension: plan.options.dimension,
      value: plan.options.value,
      queryParameter: plan.definition.query,
      allowedValues: plan.definition.values,
      mode: plan.options.mode,
      runs: plan.options.runs,
      viewport: DEFAULT_VIEWPORT,
      timeoutMs: plan.options.timeoutMs,
      zoomDurationMs: plan.options.zoomDurationMs,
      frameGapThresholdMs: FRAME_GAP_THRESHOLD_MS,
      droppedFrameEstimator: plan.fingerprintInput.droppedFrameEstimator,
      scenarioId: plan.fingerprintInput.scenario.id,
      scenario: plan.fingerprintInput.scenario,
      coldDefinition: 'fresh browser context per measured run; HTTP cache disabled via CDP',
      warmDefinition:
        'one browser context; unmeasured full-scenario warm-up; same URL reloaded sequentially',
      browserReuse: 'one Chromium process; measured runs execute sequentially',
    },
    environment: {
      node: process.version,
      platform: process.platform,
      browser: browserVersion || null,
      page: firstEnvironment ? firstEnvironment.environment : null,
    },
    resume: {
      artifactDirectory: plan.artifactDir,
      checkpointPattern: 'run-NNN.json',
      completedIndices: runs
        .filter(function (run) {
          return run.ok;
        })
        .map(function (run) {
          return run.index;
        }),
      failedIndices: runs
        .filter(function (run) {
          return !run.ok;
        })
        .map(function (run) {
          return run.index;
        }),
    },
    baseline: baseline
      ? {
          report: baseline.path,
          fingerprint: baseline.report.fingerprint,
          compatibility: compatibility,
        }
      : null,
    summary: summary,
    acceptance: acceptance,
    runs: runs,
  };
}

function writeReport(plan, runs, baseline, browserVersion) {
  const report = reportObject(plan, runs, baseline, browserVersion);
  atomicWriteJson(plan.reportPath, report);
  return report;
}

async function runBenchmark(plan) {
  initializeStorage(plan);
  const baseline = loadBaseline(plan.options.baseline);
  const runs = loadRuns(plan);
  let currentReport = writeReport(plan, runs, baseline, null);
  const completed = new Set(
    runs
      .filter(function (run) {
        return run.ok;
      })
      .map(function (run) {
        return run.index;
      })
  );
  const pendingIndices = [];
  for (let index = 1; index <= plan.options.runs; index += 1) {
    if (!completed.has(index)) pendingIndices.push(index);
  }
  const needsSsim = !!baseline && runs.some(function (run) {
    return run.ok && !ssimMatchesBaseline(run, baseline);
  });

  if (!pendingIndices.length && !needsSsim) {
    return currentReport;
  }

  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({
    headless: plan.options.headless,
    args: [
      '--use-gl=angle',
      '--use-angle=gl-egl',
      '--ignore-gpu-blocklist',
      '--enable-precise-memory-info',
    ],
  });
  let browserVersion = browser.version();
  let warmHarness = null;

  try {
    if (pendingIndices.length && plan.options.mode === 'warm') {
      let warmupError = null;
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        if (warmHarness) {
          try {
            await warmHarness.context.close();
          } catch (error) {
            // Ignore close errors before a warmup retry.
          }
          warmHarness = null;
        }
        try {
          warmHarness = await createPageHarness(browser, plan, false);
          await executeSequence(warmHarness, plan, 0, false);
          warmupError = null;
          break;
        } catch (error) {
          warmupError = error;
          console.log(
            JSON.stringify({
              event: 'warmup-retry',
              attempt: attempt,
              error: String(error && error.message ? error.message : error),
            })
          );
        }
      }
      if (warmupError) throw warmupError;
    }

    for (const index of pendingIndices) {
      let lastError = null;
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        let harness = warmHarness;
        if (plan.options.mode === 'cold') {
          harness = await createPageHarness(browser, plan, true);
        }
        try {
          const execution = await executeSequence(harness, plan, index, true);
          upsertRun(runs, execution.result);
          atomicWriteJson(checkpointPath(plan, index), execution.result);
          currentReport = writeReport(plan, runs, baseline, browserVersion);
          console.log(
            JSON.stringify({
              event: 'run-complete',
              index: index,
              attempt: attempt,
              requestedRuns: plan.options.runs,
              firstIdleMs: execution.result.firstIdle.elapsedMs,
              frameP95Ms: execution.result.zoom.frames.p95Ms,
              droppedFrames: execution.result.zoom.frames.droppedFramesEstimate,
              longTasks: execution.result.zoom.longTasks.count,
            })
          );
          lastError = null;
          break;
        } catch (error) {
          lastError = error;
          const failure = {
            schema: REPORT_SCHEMA + '/run@1',
            fingerprint: plan.fingerprint,
            index: index,
            ok: false,
            mode: plan.options.mode,
            attempt: attempt,
            failedAt: new Date().toISOString(),
            targetUrl: plan.targetUrl,
            requested: {
              dimension: plan.options.dimension,
              value: plan.options.value,
              query: plan.definition.query,
            },
            error: String(error && error.stack ? error.stack : error),
          };
          upsertRun(runs, failure);
          atomicWriteJson(checkpointPath(plan, index), failure);
          writeReport(plan, runs, baseline, browserVersion);
          console.log(
            JSON.stringify({
              event: 'run-retry',
              index: index,
              attempt: attempt,
              error: String(error && error.message ? error.message : error),
            })
          );
        } finally {
          if (plan.options.mode === 'cold' && harness) {
            await harness.context.close();
          }
        }
      }
      if (lastError) {
        console.log(
          JSON.stringify({
            event: 'run-failed',
            index: index,
            error: String(lastError && lastError.message ? lastError.message : lastError),
          })
        );
      }
    }

    if (warmHarness) {
      await warmHarness.context.close();
      warmHarness = null;
    }

    if (baseline) {
      const comparisonContext = await browser.newContext();
      const comparisonPage = await comparisonContext.newPage();
      try {
        for (const run of runs) {
          if (!run.ok || ssimMatchesBaseline(run, baseline)) continue;
          await addSsimEvidence(comparisonPage, plan, run, baseline);
          atomicWriteJson(checkpointPath(plan, run.index), run);
        }
      } finally {
        await comparisonContext.close();
      }
    }
  } finally {
    if (warmHarness) await warmHarness.context.close();
    await browser.close();
  }

  currentReport = writeReport(plan, runs, baseline, browserVersion);
  return currentReport;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(usage());
    return;
  }
  const plan = createBenchmarkPlan(options);
  if (options.dryRun) {
    console.log(
      JSON.stringify(
        {
          valid: true,
          targetUrl: plan.targetUrl,
          dimension: options.dimension,
          value: options.value,
          queryParameter: plan.definition.query,
          mode: options.mode,
          runs: options.runs,
          reportPath: plan.reportPath,
          artifactDir: plan.artifactDir,
          fingerprint: plan.fingerprint,
        },
        null,
        2
      )
    );
    return;
  }
  const report = await runBenchmark(plan);
  console.log(
    JSON.stringify(
      {
        report: plan.reportPath,
        status: report.status,
        completedRuns: report.summary.completedRuns,
        requestedRuns: report.summary.requestedRuns,
        firstIdleP95Ms: report.summary.firstIdleMs.p95,
        frameP95Ms: report.summary.zoom.frameTimeMs.p95,
        droppedFramesPerRun: report.summary.zoom.droppedFramesPerRun,
        memoryP95Bytes: report.summary.memory.usedJSHeapBytes.p95,
        minimumSsim: report.summary.visualSsim.min,
        acceptance: report.acceptance,
      },
      null,
      2
    )
  );
}

const invokedDirectly =
  !!process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (invokedDirectly) {
  main().catch(function (error) {
    console.error(error && error.stack ? error.stack : String(error));
    process.exitCode = 1;
  });
}
