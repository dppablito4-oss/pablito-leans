import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getPaperSize,
  recommendPaper,
  resolvePrintSize,
  toMillimeters
} from '../js/export/print-sizes.js';
import { calculateGrid, createPlacements, createPrintPlan, fitImageToBox } from '../js/export/layout-calculator.js';

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

const squarePlan = (count, options = {}) => createPrintPlan({
  pageIndices: Array.from({ length: count }, (_, index) => index),
  item: { width: 50, height: 50 }, paper: 'A4', ...options
});

test('ten distinct 5 × 5 cm pages share one A4, without duplication', () => {
  const plan = squarePlan(10);
  assert.equal(plan.capacity, 15);
  assert.equal(plan.sheets.length, 1);
  assert.equal(plan.totalItems, 10);
  assert.deepEqual(plan.sheets[0].items.map(box => box.pageIndex), Array.from({ length: 10 }, (_, i) => i));
});

test('twenty pages continue onto a second A4 at the original physical size', () => {
  const plan = squarePlan(20);
  assert.deepEqual(plan.sheets.map(sheet => sheet.items.length), [15, 5]);
  assert.deepEqual(plan.sheets.flatMap(sheet => sheet.items.map(box => box.pageIndex)), Array.from({ length: 20 }, (_, i) => i));
  for (const sheet of plan.sheets) {
    for (const box of sheet.items) {
      assert.equal(box.width, 50);
      assert.equal(box.height, 50);
      assert.ok(box.x >= 10 && box.y >= 10);
      assert.ok(box.x + box.width <= plan.paper.width - 10);
      assert.ok(box.y + box.height <= plan.paper.height - 10);
    }
  }
});

test('fill mode makes one completely filled sheet for each of ten source pages', () => {
  const plan = squarePlan(10, { mode: 'fill' });
  assert.equal(plan.sheets.length, 10);
  assert.equal(plan.totalItems, 150);
  plan.sheets.forEach((sheet, index) => {
    assert.equal(sheet.items.length, 15);
    assert.ok(sheet.items.every(box => box.pageIndex === index));
  });
});

test('explicit copies spill per source, without filling the last sheet with extra copies', () => {
  const plan = squarePlan(2, { mode: 'fill', copies: 20 });
  assert.equal(plan.totalItems, 40);
  assert.deepEqual(plan.sheets.map(sheet => sheet.items.length), [15, 5, 15, 5]);
  assert.deepEqual(plan.sheets.map(sheet => sheet.items[0].pageIndex), [0, 0, 1, 1]);
});

test('single mode centers one original per sheet', () => {
  const plan = squarePlan(2, { mode: 'single' });
  assert.equal(plan.sheets.length, 2);
  assert.deepEqual(plan.sheets[0].items[0], { x: 80, y: 123.5, width: 50, height: 50, pageIndex: 0 });
});

test('DNI normal and enlarged keep both faces centered one below the other', () => {
  for (const scale of [100, 195]) {
    const plan = createPrintPlan({
      pageIndices: [0, 1, 2, 3], mode: 'dni', paper: 'A4',
      item: resolvePrintSize({ preset: 'dni', scale })
    });
    assert.equal(plan.sheets.length, 2);
    assert.equal(plan.paper.landscape, false);
    for (const [index, sheet] of plan.sheets.entries()) {
      const [front, back] = sheet.items;
      assert.equal(front.side, 'Anverso');
      assert.equal(back.side, 'Reverso');
      assert.equal(front.pageIndex, index * 2);
      assert.equal(back.pageIndex, index * 2 + 1);
      assert.equal(front.x, back.x);
      assert.equal(back.y, front.y + front.height + 3);
      assert.ok(back.y + back.height <= 287);
      assert.ok(Math.abs(front.y - (297 - back.y - back.height)) < 1e-9);
    }
  }
});

test('selected pages and swapped DNI faces preserve their source references', () => {
  const plan = createPrintPlan({
    pageIndices: [5, 2], mode: 'dni', item: resolvePrintSize({ preset: 'dni' })
  });
  assert.deepEqual(plan.sheets[0].items.map(box => box.pageIndex), [5, 2]);
  const packed = createPrintPlan({ pageIndices: [1, 4, 8], item: { width: 50, height: 50 } });
  assert.deepEqual(packed.sheets[0].items.map(box => box.pageIndex), [1, 4, 8]);
});

test('DNI rejects a missing reverse and a sheet that fits only one face', () => {
  const item = resolvePrintSize({ preset: 'dni', scale: 195 });
  assert.throws(() => createPrintPlan({ pageIndices: [0], mode: 'dni', item }), /dos caras/);
  assert.throws(() => createPrintPlan({ pageIndices: [0, 1], mode: 'dni', item, paper: 'A5' }), /DNI completo/);
});

test('automatic paper recommendation fits the complete DNI and honors forced orientation', () => {
  const item = resolvePrintSize({ preset: 'dni', scale: 195 });
  const portrait = createPrintPlan({ pageIndices: [0, 1], item, mode: 'dni', paper: 'auto', orientation: 'portrait' });
  assert.equal(portrait.paper.name, 'A4');
  assert.equal(portrait.paper.landscape, false);
  const landscape = createPrintPlan({ pageIndices: [0, 1], item, mode: 'dni', paper: 'auto', orientation: 'landscape' });
  assert.equal(landscape.paper.name, 'A3');
  assert.equal(landscape.paper.landscape, true);
});

test('invalid geometry, fractional copies and excessive output fail before allocating sheets', () => {
  assert.throws(() => squarePlan(1, { margin: -1 }), /Margen/);
  assert.throws(() => squarePlan(1, { gap: Infinity }), /Separación/);
  assert.throws(() => squarePlan(1, { item: { width: 0, height: 50 } }), /mayores que cero/);
  assert.throws(() => squarePlan(1, { mode: 'fill', copies: 1.5 }), /entero/);
  assert.throws(() => squarePlan(100, { mode: 'fill', copies: 1000 }), /500 hojas/);
  assert.throws(() => squarePlan(1, { mode: 'fill', item: { width: 0.01, height: 0.01 }, gap: 0 }), /10 000/);
});

test('preview and PDF fitting preserve proportions or stretch to an exact box', () => {
  const box = { x: 10, y: 20, width: 50, height: 50 };
  assert.deepEqual(fitImageToBox({ width: 200, height: 100 }, box), { x: 10, y: 32.5, width: 50, height: 25 });
  assert.deepEqual(fitImageToBox({ width: 200, height: 100 }, box, 'cover'), box);
});
