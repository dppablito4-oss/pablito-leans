import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getPaperSize,
  recommendPaper,
  resolvePrintSize,
  toMillimeters
} from '../js/export/print-sizes.js';
import { calculateGrid, createPlacements } from '../js/export/layout-calculator.js';

test('physical units and DNI scaling are exact', () => {
  assert.equal(toMillimeters(5, 'cm'), 50);
  assert.equal(toMillimeters(1, 'in'), 25.4);
  const dni = resolvePrintSize({ preset: 'dni', scale: 195 });
  assert.equal(dni.width, 166.92);
  assert.equal(dni.height, 105.3);
});

test('paper recommendation chooses the smallest fitting ISO sheet', () => {
  assert.equal(recommendPaper(550, 750, 0).name, 'A1');
  assert.equal(recommendPaper(550, 750, 0).landscape, false);
  assert.equal(recommendPaper(900, 1300, 0), null);
});

test('5 × 5 cm grid accounts for margins and gaps on A4', () => {
  const layout = calculateGrid({
    paper: 'A4',
    itemWidth: 50,
    itemHeight: 50,
    margin: 10,
    gap: 3
  });
  assert.equal(layout.columns, 3);
  assert.equal(layout.rows, 5);
  assert.equal(layout.capacity, 15);
  assert.equal(createPlacements(layout).length, 15);
});

test('grid rotates pieces only when it increases capacity', () => {
  const sheet = getPaperSize('A4');
  const layout = calculateGrid({ paper: sheet, itemWidth: 120, itemHeight: 60, margin: 10, gap: 2 });
  assert.equal(layout.capacity, 6);
  assert.equal(layout.rotated, true);
});
