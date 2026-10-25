#!/usr/bin/env node

import {
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { resolvePlaywright as loadPlaywright } from './lib/pw.mjs';

const DEFAULT_SSIM_THRESHOLD = 0.999;
const BLOCK_SIZE = 8;
const REPORT_NAME = 'vector-perf-comparison.json';
const SCREENSHOT_PATTERN = /^vector-perf-.*\.png$/i;

const HELP = `Compare vector performance screenshots with browser-decoded PNG pixels.

Usage:
  node runtime/compare-vector-screenshots.mjs <baseline-dir> <candidate-dir> [options]
  node runtime/compare-vector-screenshots.mjs --baseline <dir> --candidate <dir> [options]

Options:
  --baseline <dir>    Directory containing baseline vector-perf-*.png files
  --candidate <dir>   Directory containing candidate vector-perf-*.png files
  --threshold <value> Minimum mean 8x8 luminance SSIM (default: 0.999)
  -h, --help          Show this help

The report is always written to <candidate-dir>/${REPORT_NAME}.
Exit status is nonzero for missing images, dimension mismatches, decode errors,
or any pair whose mean SSIM is below the threshold.`;

function parseArgs(argv) {
  const options = {
    baseline: null,
    candidate: null,
    threshold: DEFAULT_SSIM_THRESHOLD,
    help: false,
  };
  const positional = [];

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '-h' || argument === '--help') {
      options.help = true;
      continue;
    }

    const equalsAt = argument.indexOf('=');
    const flag = equalsAt >= 0 ? argument.slice(0, equalsAt) : argument;
    const inlineValue = equalsAt >= 0 ? argument.slice(equalsAt + 1) : null;

    if (flag === '--baseline' || flag === '--candidate' || flag === '--threshold') {
      const value = inlineValue ?? argv[index + 1];
      if (value == null || value === '' || (inlineValue == null && value.startsWith('--'))) {
        throw new Error(`Missing value for ${flag}`);
      }
      if (inlineValue == null) index += 1;

      if (flag === '--baseline') options.baseline = value;
      if (flag === '--candidate') options.candidate = value;
      if (flag === '--threshold') options.threshold = Number(value);
      continue;
    }

    if (argument.startsWith('-')) {
      throw new Error(`Unknown option: ${argument}`);
    }
    positional.push(argument);
  }

  if (options.help) return options;
  if (options.baseline == null) options.baseline = positional.shift() ?? null;
  if (options.candidate == null) options.candidate = positional.shift() ?? null;
  if (positional.length > 0) {
    throw new Error(`Unexpected argument: ${positional[0]}`);
  }
  if (!options.baseline || !options.candidate) {
    throw new Error('Both baseline and candidate directories are required');
  }
  if (!Number.isFinite(options.threshold) || options.threshold < 0 || options.threshold > 1) {
    throw new Error('--threshold must be a finite number from 0 through 1');
  }
  return options;
}

function directoryError(directory) {
  try {
    if (!statSync(directory).isDirectory()) return `Not a directory: ${directory}`;
    return null;
  } catch (error) {
    return `Cannot read directory ${directory}: ${error.message}`;
  }
}

function listScreenshots(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && SCREENSHOT_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort();
}

async function comparePngsInBrowser(input) {
  function decodePng(dataUrl) {
    return new Promise((resolveImage, rejectImage) => {
      const image = new Image();
      image.onload = () => {
        try {
          const width = image.naturalWidth;
          const height = image.naturalHeight;
          if (!width || !height) throw new Error('decoded image has zero dimensions');

          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const context = canvas.getContext('2d', { willReadFrequently: true });
          if (!context) throw new Error('2D canvas context is unavailable');
          context.drawImage(image, 0, 0);
          const pixels = context.getImageData(0, 0, width, height).data;
          resolveImage({ width, height, pixels });
        } catch (error) {
          rejectImage(error);
        }
      };
      image.onerror = () => rejectImage(new Error('browser failed to decode PNG'));
      image.src = dataUrl;
    });
  }

  function luminance(pixels, offset) {
    const alpha = pixels[offset + 3] / 255;
    const inverseAlpha = 1 - alpha;
    const red = pixels[offset] * alpha + 255 * inverseAlpha;
    const green = pixels[offset + 1] * alpha + 255 * inverseAlpha;
    const blue = pixels[offset + 2] * alpha + 255 * inverseAlpha;
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  }

  const [baseline, candidate] = await Promise.all([
    decodePng(input.baselineDataUrl),
    decodePng(input.candidateDataUrl),
  ]);
  const dimensions = {
    baseline: { width: baseline.width, height: baseline.height },
    candidate: { width: candidate.width, height: candidate.height },
  };

  if (baseline.width !== candidate.width || baseline.height !== candidate.height) {
    return { dimensions, dimensionMismatch: true };
  }

  const width = baseline.width;
  const height = baseline.height;
  const pixelCount = width * height;
  let changedPixels = 0;
  let rgbAbsoluteError = 0;
  let rgbSquaredError = 0;
  let alphaAbsoluteError = 0;
  let luminanceAbsoluteError = 0;
  let maxAbsoluteError = 0;

  for (let offset = 0; offset < baseline.pixels.length; offset += 4) {
    const redError = Math.abs(baseline.pixels[offset] - candidate.pixels[offset]);
    const greenError = Math.abs(baseline.pixels[offset + 1] - candidate.pixels[offset + 1]);
    const blueError = Math.abs(baseline.pixels[offset + 2] - candidate.pixels[offset + 2]);
    const alphaError = Math.abs(baseline.pixels[offset + 3] - candidate.pixels[offset + 3]);
    const pixelMaxError = Math.max(redError, greenError, blueError, alphaError);

    if (pixelMaxError > 0) changedPixels += 1;
    maxAbsoluteError = Math.max(maxAbsoluteError, pixelMaxError);
    rgbAbsoluteError += redError + greenError + blueError;
    rgbSquaredError +=
      redError * redError + greenError * greenError + blueError * blueError;
    alphaAbsoluteError += alphaError;
    luminanceAbsoluteError += Math.abs(
      luminance(baseline.pixels, offset) - luminance(candidate.pixels, offset)
    );
  }

  const c1 = (0.01 * 255) ** 2;
  const c2 = (0.03 * 255) ** 2;
  let blockCount = 0;
  let ssimTotal = 0;
  let minimumSsim = Infinity;
  let maximumSsim = -Infinity;
  let worstBlock = null;

  for (let blockY = 0; blockY < height; blockY += input.blockSize) {
    for (let blockX = 0; blockX < width; blockX += input.blockSize) {
      const blockWidth = Math.min(input.blockSize, width - blockX);
      const blockHeight = Math.min(input.blockSize, height - blockY);
      const count = blockWidth * blockHeight;
      let baselineSum = 0;
      let candidateSum = 0;
      let baselineSquaredSum = 0;
      let candidateSquaredSum = 0;
      let productSum = 0;

      for (let y = blockY; y < blockY + blockHeight; y += 1) {
        for (let x = blockX; x < blockX + blockWidth; x += 1) {
          const offset = (y * width + x) * 4;
          const baselineLuminance = luminance(baseline.pixels, offset);
          const candidateLuminance = luminance(candidate.pixels, offset);
          baselineSum += baselineLuminance;
          candidateSum += candidateLuminance;
          baselineSquaredSum += baselineLuminance * baselineLuminance;
          candidateSquaredSum += candidateLuminance * candidateLuminance;
          productSum += baselineLuminance * candidateLuminance;
        }
      }

      const baselineMean = baselineSum / count;
      const candidateMean = candidateSum / count;
      let baselineVariance = 0;
      let candidateVariance = 0;
      let covariance = 0;
      if (count > 1) {
        baselineVariance = Math.max(
          0,
          (baselineSquaredSum - count * baselineMean * baselineMean) / (count - 1)
        );
        candidateVariance = Math.max(
          0,
          (candidateSquaredSum - count * candidateMean * candidateMean) / (count - 1)
        );
        covariance =
          (productSum - count * baselineMean * candidateMean) / (count - 1);
      }

      const numerator =
        (2 * baselineMean * candidateMean + c1) * (2 * covariance + c2);
      const denominator =
        (baselineMean * baselineMean + candidateMean * candidateMean + c1) *
        (baselineVariance + candidateVariance + c2);
      const blockSsim =
        changedPixels === 0 ? 1 : Math.max(-1, Math.min(1, numerator / denominator));

      blockCount += 1;
      ssimTotal += blockSsim;
      maximumSsim = Math.max(maximumSsim, blockSsim);
      if (blockSsim < minimumSsim) {
        minimumSsim = blockSsim;
        worstBlock = {
          x: blockX,
          y: blockY,
          width: blockWidth,
          height: blockHeight,
          ssim: blockSsim,
        };
      }
    }
  }

  const rgbChannelCount = pixelCount * 3;
  const meanAbsoluteError = rgbAbsoluteError / rgbChannelCount;
  const rootMeanSquaredError = Math.sqrt(rgbSquaredError / rgbChannelCount);
  return {
    dimensions,
    dimensionMismatch: false,
    ssim: {
      mean: ssimTotal / blockCount,
      minimum: minimumSsim,
      maximum: maximumSsim,
      blockSize: input.blockSize,
      blockCount,
      worstBlock,
    },
    pixelError: {
      changedPixels,
      changedPixelRatio: changedPixels / pixelCount,
      meanAbsoluteError,
      normalizedMeanAbsoluteError: meanAbsoluteError / 255,
      rootMeanSquaredError,
      normalizedRootMeanSquaredError: rootMeanSquaredError / 255,
      maxAbsoluteError,
      luminanceMeanAbsoluteError: luminanceAbsoluteError / pixelCount,
      alphaMeanAbsoluteError: alphaAbsoluteError / pixelCount,
    },
  };
}

function makeDataUrl(filePath) {
  return `data:image/png;base64,${readFileSync(filePath).toString('base64')}`;
}

function summarize(pairs, threshold, baselineCount, candidateCount, errors) {
  const counts = {
    pass: 0,
    belowThreshold: 0,
    missingBaseline: 0,
    missingCandidate: 0,
    dimensionMismatch: 0,
    error: 0,
  };
  const measuredSsim = [];

  for (const pair of pairs) {
    if (pair.status === 'pass') counts.pass += 1;
    if (pair.status === 'below-threshold') counts.belowThreshold += 1;
    if (pair.status === 'missing-baseline') counts.missingBaseline += 1;
    if (pair.status === 'missing-candidate') counts.missingCandidate += 1;
    if (pair.status === 'dimension-mismatch') counts.dimensionMismatch += 1;
    if (pair.status === 'error') counts.error += 1;
    if (pair.ssim) measuredSsim.push(pair.ssim.mean);
  }

  const failedPairs = pairs.length - counts.pass;
  return {
    status: failedPairs === 0 && pairs.length > 0 && errors.length === 0 ? 'pass' : 'fail',
    threshold,
    baselineImageCount: baselineCount,
    candidateImageCount: candidateCount,
    pairCount: pairs.length,
    comparedPairCount: measuredSsim.length,
    passedPairCount: counts.pass,
    failedPairCount: failedPairs,
    counts,
    minimumMeanSsim: measuredSsim.length ? Math.min(...measuredSsim) : null,
  };
}

function failureDescription(pair) {
  if (pair.status === 'below-threshold') {
    return `${pair.filename}: SSIM ${pair.ssim.mean} < ${pair.threshold}`;
  }
  if (pair.status === 'dimension-mismatch') {
    const baseline = pair.dimensions.baseline;
    const candidate = pair.dimensions.candidate;
    return (
      `${pair.filename}: dimensions ${baseline.width}x${baseline.height} vs ` +
      `${candidate.width}x${candidate.height}`
    );
  }
  if (pair.status === 'error') return `${pair.filename}: ${pair.error}`;
  return `${pair.filename}: ${pair.status}`;
}

async function run(options) {
  const baselineDirectory = resolve(options.baseline);
  const candidateDirectory = resolve(options.candidate);
  const candidateProblem = directoryError(candidateDirectory);
  if (candidateProblem) throw new Error(candidateProblem);

  const reportPath = join(candidateDirectory, REPORT_NAME);
  const errors = [];
  const baselineProblem = directoryError(baselineDirectory);
  if (baselineProblem) errors.push(baselineProblem);

  const baselineNames = baselineProblem ? [] : listScreenshots(baselineDirectory);
  const candidateNames = listScreenshots(candidateDirectory);
  const baselineSet = new Set(baselineNames);
  const candidateSet = new Set(candidateNames);
  const filenames = [...new Set([...baselineNames, ...candidateNames])].sort();
  if (filenames.length === 0) {
    errors.push('No vector-perf-*.png screenshots found in either directory');
  }

  let browser = null;
  let pagePromise = null;
  let playwrightSource = null;
  let browserVersion = null;

  async function getPage() {
    if (!pagePromise) {
      pagePromise = (async () => {
        const loaded = loadPlaywright();
        playwrightSource = loaded.source;
        browser = await loaded.playwright.chromium.launch({ headless: true });
        browserVersion = browser.version();
        return browser.newPage();
      })();
    }
    return pagePromise;
  }

  const pairs = [];
  try {
    for (const filename of filenames) {
      const baselinePath = join(baselineDirectory, filename);
      const candidatePath = join(candidateDirectory, filename);
      if (!baselineSet.has(filename)) {
        pairs.push({
          filename,
          status: 'missing-baseline',
          baselinePath,
          candidatePath,
        });
        continue;
      }
      if (!candidateSet.has(filename)) {
        pairs.push({
          filename,
          status: 'missing-candidate',
          baselinePath,
          candidatePath,
        });
        continue;
      }

      try {
        const page = await getPage();
        const result = await page.evaluate(comparePngsInBrowser, {
          baselineDataUrl: makeDataUrl(baselinePath),
          candidateDataUrl: makeDataUrl(candidatePath),
          blockSize: BLOCK_SIZE,
        });
        if (result.dimensionMismatch) {
          pairs.push({
            filename,
            status: 'dimension-mismatch',
            baselinePath,
            candidatePath,
            dimensions: result.dimensions,
          });
          continue;
        }

        const status =
          result.ssim.mean >= options.threshold ? 'pass' : 'below-threshold';
        pairs.push({
          filename,
          status,
          threshold: options.threshold,
          baselinePath,
          candidatePath,
          dimensions: result.dimensions,
          ssim: result.ssim,
          pixelError: result.pixelError,
        });
      } catch (error) {
        pairs.push({
          filename,
          status: 'error',
          baselinePath,
          candidatePath,
          error: error.message,
        });
      }
    }
  } finally {
    if (browser) await browser.close();
  }

  const summary = summarize(
    pairs,
    options.threshold,
    baselineNames.length,
    candidateNames.length,
    errors
  );
  const report = {
    schema: 'china-antique-maplibre/vector-perf-comparison@1',
    generatedAt: new Date().toISOString(),
    baselineDirectory,
    candidateDirectory,
    reportPath,
    configuration: {
      filenamePattern: SCREENSHOT_PATTERN.source,
      blockSize: BLOCK_SIZE,
      ssimThreshold: options.threshold,
      luminance: 'Rec.709 sRGB, alpha composited over white',
      ssimConstants: { k1: 0.01, k2: 0.03, dynamicRange: 255 },
      pngDecoder: 'Chromium Image + 2D canvas',
    },
    environment: {
      node: process.version,
      platform: process.platform,
      playwrightSource,
      browserVersion,
    },
    errors,
    summary,
    pairs,
  };
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

  const outcome = summary.status.toUpperCase();
  const minimum = summary.minimumMeanSsim == null ? 'n/a' : summary.minimumMeanSsim;
  console.log(
    `${outcome}: ${summary.passedPairCount}/${summary.pairCount} pairs passed; ` +
      `minimum mean SSIM ${minimum}; threshold ${options.threshold}`
  );
  for (const pair of pairs.filter((entry) => entry.status !== 'pass')) {
    console.error(`- ${failureDescription(pair)}`);
  }
  for (const error of errors) console.error(`- ${error}`);
  console.log(`Report: ${reportPath}`);
  return summary.status === 'pass' ? 0 : 1;
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`Argument error: ${error.message}\n`);
    console.error(HELP);
    process.exitCode = 2;
    return;
  }

  if (options.help) {
    console.log(HELP);
    return;
  }

  try {
    process.exitCode = await run(options);
  } catch (error) {
    console.error(`Comparison error: ${error.message}`);
    process.exitCode = 2;
  }
}

await main();
