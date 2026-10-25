import assert from 'node:assert/strict';
import test from 'node:test';

import {
  aggregateRuns,
  assessConfiguration,
  buildTargetUrl,
  createBenchmarkPlan,
  estimateDroppedFrames,
  evaluateAcceptance,
  parseArgs,
} from './benchmark-vector-tuning.mjs';

function parsed(extra) {
  return parseArgs([
    '--dimension',
    'workerCount',
    '--value',
    '1',
    '--mode',
    'cold',
  ].concat(extra || []));
}

function sampleRun(index, overrides) {
  const options = overrides || {};
  return {
    index: index,
    ok: true,
    firstIdle: { elapsedMs: options.firstIdleMs || 1000 },
    zoom: {
      frames: {
        samplesMs: options.samplesMs || [15, 16, 17, 20],
        gapSamplesMs: options.gapSamplesMs || [],
        gapCount: (options.gapSamplesMs || []).length,
        droppedFramesEstimate: options.droppedFrames || 0,
      },
      longTasks: {
        count: (options.longTasks || []).length,
        samplesMs: options.longTasks || [],
      },
    },
    memory: {
      afterZoom: {
        cdp: { jsHeapUsedBytes: options.memoryBytes || 10_000_000 },
      },
    },
    visual: {
      ssim: Number.isFinite(options.ssim)
        ? { observable: true, score: options.ssim }
        : null,
    },
  };
}

test('CLI defaults to 20 runs and accepts aliases', function () {
  const options = parseArgs([
    '--dimension=workers',
    '--value=2',
    '--mode=warm',
  ]);
  assert.equal(options.dimension, 'workerCount');
  assert.equal(options.value, 2);
  assert.equal(options.mode, 'warm');
  assert.equal(options.runs, 20);
  assert.equal(options.headless, true);
  assert.equal(options.resume, true);
});

test('workerCount accepts current-default control value 6', function () {
  const options = parseArgs([
    '--dimension=workerCount',
    '--value=6',
    '--mode=cold',
  ]);
  assert.equal(options.value, 6);
});

test('CLI rejects values outside the exact matrix', function () {
  assert.throws(function () {
    parseArgs([
      '--dimension',
      'maxParallelImageRequests',
      '--value',
      '24',
      '--mode',
      'cold',
    ]);
  }, /must be one of 16, 32/);
});

test('target URL contains only the selected performance parameter', function () {
  const target = new URL(
    buildTargetUrl(
      'http://127.0.0.1:8780?keep=yes&perfImages=16&perfCacheZoom=5',
      'workerCount',
      4
    )
  );
  assert.equal(target.pathname, '/vector-layers.html');
  assert.equal(target.searchParams.get('keep'), 'yes');
  assert.equal(target.searchParams.get('perfWorkers'), '4');
  assert.equal(target.searchParams.has('perfImages'), false);
  assert.equal(target.searchParams.has('perfCacheZoom'), false);
});

test('increasing run count keeps the resume fingerprint stable', function () {
  const first = createBenchmarkPlan(parsed(['--runs', '1']));
  const extended = createBenchmarkPlan(parsed(['--runs', '20']));
  assert.equal(first.fingerprint, extended.fingerprint);
  assert.equal(first.reportPath, extended.reportPath);
});

test('configuration evidence requires query acknowledgement and effective match', function () {
  const passing = assessConfiguration(
    {
      reported: { workerCount: 1 },
      effective: { workerCount: 1 },
    },
    'workerCount',
    1
  );
  assert.equal(passing.pass, true);

  const ignoredQuery = assessConfiguration(
    {
      reported: { workerCount: null },
      effective: { workerCount: 1 },
    },
    'workerCount',
    1
  );
  assert.equal(ignoredQuery.pass, false);

  const wrongEffectiveValue = assessConfiguration(
    {
      reported: { workerCount: 1 },
      effective: { workerCount: 2 },
    },
    'workerCount',
    1
  );
  assert.equal(wrongEffectiveValue.pass, false);
});

test('dropped-frame estimate ignores normal refresh jitter', function () {
  assert.equal(estimateDroppedFrames([16.6, 16.7, 16.8]), 0);
  assert.equal(estimateDroppedFrames([16.7, 33.4, 50.1]), 3);
});

test('aggregate pools frame samples and records observable guards', function () {
  const runs = [
    sampleRun(1, {
      firstIdleMs: 900,
      samplesMs: [10, 20],
      gapSamplesMs: [40],
      droppedFrames: 2,
      longTasks: [55],
      memoryBytes: 20_000_000,
      ssim: 0.9998,
    }),
    sampleRun(2, {
      firstIdleMs: 1100,
      samplesMs: [30, 40],
      gapSamplesMs: [40],
      droppedFrames: 4,
      longTasks: [65],
      memoryBytes: 22_000_000,
      ssim: 0.9999,
    }),
  ];
  const summary = aggregateRuns(runs, 2);
  assert.equal(summary.complete, true);
  assert.equal(summary.zoom.frameTimeMs.count, 4);
  assert.equal(summary.zoom.frameTimeMs.p95, 40);
  assert.equal(summary.zoom.droppedFramesPerRun, 3);
  assert.equal(summary.zoom.longTaskCountTotal, 2);
  assert.equal(summary.memory.usedJSHeapBytes.p95, 22_000_000);
  assert.equal(summary.visualSsim.min, 0.9998);

  assert.equal(aggregateRuns(runs, 2, null).visualSsim.count, 0);
  runs[0].visual.ssim.baselineIdentity = 'baseline-a';
  runs[1].visual.ssim.baselineIdentity = 'baseline-b';
  assert.equal(aggregateRuns(runs, 2, 'baseline-a').visualSsim.count, 1);
});

test('acceptance requires performance gain and non-regressing guards', function () {
  const baseline = {
    completedRuns: 20,
    firstIdleMs: { p95: 1000 },
    zoom: {
      frameTimeMs: { p95: 20 },
      droppedFramesPerRun: 10,
    },
    memory: { usedJSHeapBytes: { p95: 100_000_000 } },
    visualSsim: { count: 0, min: null },
  };
  const candidate = {
    completedRuns: 20,
    firstIdleMs: { p95: 990 },
    zoom: {
      frameTimeMs: { p95: 17.5 },
      droppedFramesPerRun: 9,
    },
    memory: { usedJSHeapBytes: { p95: 99_000_000 } },
    visualSsim: { count: 20, min: 0.9992 },
  };
  const accepted = evaluateAcceptance(candidate, baseline);
  assert.equal(accepted.performance.pass, true);
  assert.equal(accepted.guards.firstIdle.pass, true);
  assert.equal(accepted.guards.memory.pass, true);
  assert.equal(accepted.guards.visual.pass, true);
  assert.equal(accepted.retain, true);

  candidate.firstIdleMs.p95 = 1001;
  const rejected = evaluateAcceptance(candidate, baseline);
  assert.equal(rejected.guards.firstIdle.pass, false);
  assert.equal(rejected.retain, false);
});
