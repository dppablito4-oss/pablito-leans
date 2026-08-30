import test from 'node:test';
import assert from 'node:assert/strict';

import { fitImageDimensions, parsePageRange } from '../js/utils.js';

test('parsePageRange returns every page for an empty range', () => {
  assert.deepEqual(parsePageRange('', 4), [0, 1, 2, 3]);
});

test('parsePageRange normalizes, sorts and deduplicates valid pages', () => {
  assert.deepEqual(parsePageRange('5, 1-3, 2, 99', 5), [0, 1, 2, 4]);
});

test('parsePageRange rejects partial numbers and malformed ranges', () => {
  assert.deepEqual(parsePageRange('2foo, 4-2, 1-2-3, 0', 5), []);
});

test('fitImageDimensions preserves aspect ratio within both limits', () => {
  assert.deepEqual(fitImageDimensions(8000, 4000, 4096, 16_000_000), {
    width: 4096,
    height: 2048,
    scale: 0.512
  });
});

test('fitImageDimensions does not upscale small images', () => {
  assert.deepEqual(fitImageDimensions(800, 600, 4096, 16_000_000), {
    width: 800,
    height: 600,
    scale: 1
  });
});

test('fitImageDimensions validates its inputs', () => {
  assert.throws(() => fitImageDimensions(0, 600, 4096, 16_000_000), TypeError);
});
