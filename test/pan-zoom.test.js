import test from 'node:test';
import assert from 'node:assert/strict';
import { fitViewport, zoomAt, resizeCamera } from '../js/pan-zoom.js';

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} ≠ ${b}`);
const worldAt = (camera, point) => ({ x: (point.x - camera.x) / camera.scale,
  y: (point.y - camera.y) / camera.scale });

for (const [name, content] of Object.entries({ vertical: { width: 210, height: 297 },
  horizontal: { width: 297, height: 210 } })) {
  test(`The ${name} sheet fits and stays centered in a wide or narrow stage`, () => {
    for (const view of [{ width: 600, height: 260 }, { width: 260, height: 500 }]) {
      const fit = fitViewport(view, content, 18);
      assert.ok(fit.x >= 18 - 1e-8 && fit.y >= 18 - 1e-8);
      assert.ok(fit.x + content.width * fit.scale <= view.width - 18 + 1e-8);
      assert.ok(fit.y + content.height * fit.scale <= view.height - 18 + 1e-8);
      near(fit.x * 2 + content.width * fit.scale, view.width);
      near(fit.y * 2 + content.height * fit.scale, view.height);
    }
  });
}

test('Continuous pages fit their width and start at the top, even for long documents', () => {
  const fit = fitViewport({ width: 500, height: 600 }, { width: 800, height: 30000 }, 24, 'width');
  near(fit.scale, 452 / 800);
  near(fit.x, 24);
  near(fit.y, 24);
});

test('Zoom keeps the document point under the cursor still', () => {
  const camera = { x: -270, y: 130, scale: 0.8 };
  const anchor = { x: 517, y: 93 };
  const before = worldAt(camera, anchor);
  for (const scale of [0.1, 1, 8]) {
    const after = worldAt(zoomAt(camera, scale, anchor), anchor);
    near(after.x, before.x);
    near(after.y, before.y);
  }
});

test('Zooming in and back out restores the camera without drift', () => {
  const camera = { x: 27, y: -839, scale: 0.6 };
  const anchor = { x: 80, y: 145 };
  const restored = zoomAt(zoomAt(camera, 4.8, anchor), 0.6, anchor);
  near(restored.x, camera.x);
  near(restored.y, camera.y);
});

test('Resizing preserves the document point in the center of a freely moved view', () => {
  const previous = { width: 900, height: 700 };
  const next = { width: 320, height: 250 };
  const camera = { x: -170, y: 90, scale: 1.8 };
  const before = worldAt(camera, { x: previous.width / 2, y: previous.height / 2 });
  const after = worldAt(resizeCamera(camera, previous, next, 0.7), { x: next.width / 2, y: next.height / 2 });
  near(before.x, after.x);
  near(before.y, after.y);
});
