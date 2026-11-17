import test from 'node:test';
import assert from 'node:assert/strict';
import { adjustTonePixels, hasAdjustments, NEUTRAL_ADJUSTMENTS, normalizeAdjustments } from '../js/image-adjustments.js';

test('neutral corrections preserve every original pixel exactly', () => {
  const pixels = new Uint8Array([0, 0, 0, 67, 120, 245, 255, 255, 255]);
  const original = pixels.slice();
  adjustTonePixels(pixels);
  assert.deepEqual(pixels, original);
  assert.deepEqual(normalizeAdjustments(), NEUTRAL_ADJUSTMENTS);
  assert.equal(hasAdjustments({ saturation: 50, brightness: 0 }), false);
});

test('brightness lightens dark paper without turning black ink gray', () => {
  const pixels = new Uint8Array([0, 0, 0, 100, 110, 120]);
  adjustTonePixels(pixels, { brightness: 25 });
  assert.deepEqual([...pixels.slice(0, 3)], [0, 0, 0]);
  assert.ok(pixels[3] > 100 && pixels[4] > 110 && pixels[5] > 120);
});

test('white balance removes yellow paper cast while keeping ink and neutral colors', () => {
  const pixels = new Uint8Array([240, 225, 200, 240, 225, 200, 20, 20, 20]);
  adjustTonePixels(pixels, { whiteBalance: 100 });
  assert.deepEqual([...pixels.slice(0, 3)], [240, 240, 240]);
  assert.ok(pixels[6] < 25 && pixels[7] < 25 && pixels[8] < 25);
  const neutral = new Uint8Array([230, 230, 230]);
  adjustTonePixels(neutral, { whiteBalance: 100 });
  assert.deepEqual([...neutral], [230, 230, 230]);
});

test('temperature warms or cools without overflow; contrast increases text separation', () => {
  const warm = new Uint8Array([150, 150, 150]);
  const cool = warm.slice();
  adjustTonePixels(warm, { warmth: 50 });
  adjustTonePixels(cool, { warmth: -50 });
  assert.ok(warm[0] > warm[2]);
  assert.ok(cool[0] < cool[2]);
  const contrasted = new Uint8Array([70, 70, 70, 190, 190, 190]);
  adjustTonePixels(contrasted, { contrast: 50 });
  assert.ok(contrasted[0] < 70 && contrasted[3] > 190);
});

test('invalid settings are clamped to safe finite ranges', () => {
  const settings = normalizeAdjustments({ brightness: Infinity, warmth: -500, contrast: 500, saturation: -20, whiteBalance: 200 });
  assert.equal(settings.brightness, 0);
  assert.equal(settings.warmth, -50);
  assert.equal(settings.contrast, 50);
  assert.equal(settings.saturation, 0);
  assert.equal(settings.whiteBalance, 100);
  assert.equal(hasAdjustments(settings), true);
});
