import test from 'node:test';
import assert from 'node:assert/strict';
import { blendLocalContrast, createGammaTable, enhanceDocumentRgb,
  estimateDocumentGamma, sampleLuminanceHistogram } from '../js/document-enhancement.js';
import { hasAdjustments, normalizeAdjustments } from '../js/image-adjustments.js';

test('adaptive gamma brightens dark paper while preserving the black and white endpoints', () => {
  const histogram = new Uint32Array(256);
  histogram[15] = 5;
  histogram[145] = 95;
  const gamma = estimateDocumentGamma(histogram, 100);
  assert.ok(gamma >= 0.55 && gamma < 1);
  const table = createGammaTable(gamma);
  assert.equal(table[0], 0);
  assert.equal(table[255], 255);
  assert.ok(table[145] > 145);
  for (let index = 1; index < table.length; index++) assert.ok(table[index] >= table[index - 1]);
});

test('intensity zero is neutral; partial intensity produces a smaller correction', () => {
  const histogram = new Uint32Array(256);
  histogram[130] = 100;
  assert.equal(estimateDocumentGamma(histogram, 0), 1);
  const low = createGammaTable(estimateDocumentGamma(histogram, 25));
  const high = createGammaTable(estimateDocumentGamma(histogram, 100));
  assert.ok(low[130] > 130 && low[130] < high[130]);
  assert.deepEqual(createGammaTable(1), Uint8Array.from({ length: 256 }, (_, index) => index));
});

test('uniform black, white, bright and empty images do not create invalid gamma', () => {
  for (const level of [0, 12, 235, 255]) {
    const histogram = new Uint32Array(256);
    histogram[level] = 100;
    assert.equal(estimateDocumentGamma(histogram), 1);
  }
  assert.equal(estimateDocumentGamma(new Uint32Array(256)), 1);
  for (const value of [0, -1, NaN, Infinity]) assert.throws(() => createGammaTable(value), /positiva/);
});

test('the paper estimate ignores a small bright reflection', () => {
  const histogram = new Uint32Array(256);
  histogram[140] = 990;
  histogram[255] = 10;
  assert.ok(estimateDocumentGamma(histogram) < 1);
});

test('histogram sampling is bounded and includes empty and tiny images', () => {
  const input = new Uint8Array(160_000).fill(180);
  const histogram = sampleLuminanceHistogram(input);
  assert.equal(histogram[180], 40_000);
  assert.equal(histogram.reduce((sum, count) => sum + count), 40_000);
  assert.equal(sampleLuminanceHistogram(new Uint8Array()).reduce((sum, count) => sum + count), 0);
  assert.equal(sampleLuminanceHistogram(new Uint8Array([0, 255]))[255], 1);
});

test('local contrast protects white paper and black ink and bounds midtone changes', () => {
  const pixels = new Uint8Array([0, 15, 100, 180, 230, 255]);
  blendLocalContrast(pixels, new Uint8Array([30, 40, 10, 250, 170, 230]), 100);
  assert.deepEqual([...pixels], [0, 15, 72, 208, 230, 255]);
  const neutral = new Uint8Array([10, 100, 250]);
  blendLocalContrast(neutral, new Uint8Array([0, 180, 220]), 0);
  assert.deepEqual([...neutral], [10, 100, 250]);
});

test('older pages stay neutral and denoising is independent of automatic enhancement', () => {
  const settings = normalizeAdjustments({ brightness: 12 });
  assert.equal(settings.documentEnhance, 0);
  assert.equal(settings.denoise, 0);
  assert.equal(hasAdjustments({ documentEnhance: 0, denoise: 0 }), false);
  assert.equal(hasAdjustments({ denoise: 30 }), true);
  const invalid = normalizeAdjustments({ documentEnhance: Infinity, denoise: -5 });
  assert.equal(invalid.documentEnhance, 0);
  assert.equal(invalid.denoise, 0);
});

test('allocated OpenCV buffers are released when denoising fails', t => {
  const originalCv = globalThis.cv;
  const live = new Set();
  class Mat {
    constructor() { live.add(this); }
    clone() { return new Mat(); }
    delete() { assert.ok(live.delete(this), 'buffer must be deleted exactly once'); }
  }
  globalThis.cv = { Mat, bilateralFilter() { throw new Error('simulated failure'); } };
  t.after(() => { globalThis.cv = originalCv; });
  const source = new Mat();
  assert.throws(() => enhanceDocumentRgb(source, { denoise: 30 }), /simulated failure/);
  assert.deepEqual([...live], [source]);
  source.delete();
});
