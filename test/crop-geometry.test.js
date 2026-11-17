import test from 'node:test';
import assert from 'node:assert/strict';
import { cropHandlePositions, isValidCrop, moveCropHandle, rectangleFromPoints } from '../js/crop-geometry.js';

const rectangle = [{ x: 20, y: 20 }, { x: 180, y: 20 }, { x: 180, y: 280 }, { x: 20, y: 280 }];

test('crop exposes four corners and four centered edge handles', () => {
  assert.deepEqual(cropHandlePositions(rectangle).slice(4), [
    { x: 100, y: 20 }, { x: 180, y: 150 }, { x: 100, y: 280 }, { x: 20, y: 150 }
  ]);
});

test('horizontal edge cropping moves both endpoints and keeps the other edge intact', () => {
  const top = moveCropHandle(rectangle, 4, 40, 30, 200, 300);
  assert.deepEqual(top, [{ x: 20, y: 50 }, { x: 180, y: 50 }, rectangle[2], rectangle[3]]);
  const bottom = moveCropHandle(rectangle, 6, 50, -30, 200, 300);
  assert.deepEqual(bottom, [rectangle[0], rectangle[1], { x: 180, y: 250 }, { x: 20, y: 250 }]);
});

test('vertical edge cropping changes only the selected left or right edge', () => {
  const left = moveCropHandle(rectangle, 7, 30, 40, 200, 300);
  assert.deepEqual(left, [{ x: 50, y: 20 }, rectangle[1], rectangle[2], { x: 50, y: 280 }]);
  const right = moveCropHandle(rectangle, 5, -30, 40, 200, 300);
  assert.deepEqual(right, [rectangle[0], { x: 150, y: 20 }, { x: 150, y: 280 }, rectangle[3]]);
});

test('perspective corner edits remain independent; rectangular edits keep aligned sides', () => {
  const perspective = moveCropHandle(rectangle, 0, 10, 15, 200, 300);
  assert.deepEqual(perspective, [{ x: 30, y: 35 }, ...rectangle.slice(1)]);
  const aligned = moveCropHandle(rectangle, 0, 10, 15, 200, 300, 'rectangle');
  assert.deepEqual(aligned, [{ x: 30, y: 35 }, { x: 180, y: 35 }, rectangle[2], { x: 30, y: 280 }]);
});

test('cropping cannot cross corners, collapse, mutate its input or leave the image', () => {
  const input = structuredClone(rectangle);
  assert.deepEqual(moveCropHandle(rectangle, 4, 0, 290, 200, 300), rectangle);
  assert.deepEqual(moveCropHandle(rectangle, 0, 190, 190, 200, 300), rectangle);
  assert.deepEqual(moveCropHandle(rectangle, 4, 0, -100, 200, 300).slice(0, 2), [{ x: 20, y: 0 }, { x: 180, y: 0 }]);
  assert.deepEqual(rectangle, input);
  assert.equal(isValidCrop([rectangle[0], rectangle[2], rectangle[1], rectangle[3]]), false);
  assert.equal(isValidCrop(rectangle), true);
});

test('rectangular crop encloses a tilted perspective selection', () => {
  assert.deepEqual(rectangleFromPoints([{ x: 25, y: 30 }, { x: 160, y: 20 }, { x: 180, y: 270 }, { x: 20, y: 280 }]), rectangle);
});
