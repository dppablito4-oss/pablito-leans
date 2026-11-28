import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeJpeg, setJpegDensity } from '../js/export/jpeg.js';

const existingHeader = [0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 1, 0, 0, 96, 0, 96, 0, 0, 0xff, 0xd9];

test('JPEG export changes both density fields to 300 pixels per inch', async () => {
  const canvas = {
    toBlob(callback, type, quality) {
      assert.equal(type, 'image/jpeg');
      assert.equal(quality, 0.96);
      callback(new Blob([Uint8Array.from(existingHeader)], { type }));
    }
  };

  const result = await encodeJpeg(canvas, 300);
  assert.deepEqual([...result.slice(13, 18)], [1, 1, 44, 1, 44]);
  assert.deepEqual([...result.slice(18)], existingHeader.slice(18));
  assert.equal(result.length, existingHeader.length);
});

test('JPEG export inserts a density header if the encoder omitted JFIF', () => {
  const bytes = Uint8Array.of(0xff, 0xd8, 0xff, 0xe1, 0, 4, 1, 2, 0xff, 0xd9);
  const result = setJpegDensity(bytes, 150);

  assert.deepEqual([...result.slice(0, 13)], existingHeader.slice(0, 13));
  assert.deepEqual([...result.slice(13, 18)], [1, 0, 150, 0, 150]);
  assert.deepEqual(result.slice(20), bytes.slice(2));
});
