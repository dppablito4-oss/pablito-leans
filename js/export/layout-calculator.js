import { getPaperSize } from './print-sizes.js';

function validateNonNegative(value, label) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) throw new TypeError(`${label} inválido`);
  return numeric;
}

function gridVariant(sheet, itemWidth, itemHeight, margin, gap, rotated) {
  const width = rotated ? itemHeight : itemWidth;
  const height = rotated ? itemWidth : itemHeight;
  const usableWidth = sheet.width - margin * 2;
  const usableHeight = sheet.height - margin * 2;
  const columns = Math.max(0, Math.floor((usableWidth + gap) / (width + gap)));
  const rows = Math.max(0, Math.floor((usableHeight + gap) / (height + gap)));
  const capacity = columns * rows;
  const contentWidth = columns ? columns * width + (columns - 1) * gap : 0;
  const contentHeight = rows ? rows * height + (rows - 1) * gap : 0;
  return {
    rotated,
    itemWidth: width,
    itemHeight: height,
    columns,
    rows,
    capacity,
    startX: margin + Math.max(0, (usableWidth - contentWidth) / 2),
    startY: margin + Math.max(0, (usableHeight - contentHeight) / 2)
  };
}

export function calculateGrid({
  paper,
  landscape = false,
  itemWidth,
  itemHeight,
  margin = 10,
  gap = 3,
  allowRotate = true
}) {
  const sheet = typeof paper === 'string' ? getPaperSize(paper, landscape) : paper;
  const width = Number(itemWidth);
  const height = Number(itemHeight);
  const marginMm = validateNonNegative(margin, 'Margen');
  const gapMm = validateNonNegative(gap, 'Separación');
  if (![width, height].every(value => Number.isFinite(value) && value > 0)) {
    throw new TypeError('El tamaño final debe ser positivo');
  }

  const normal = gridVariant(sheet, width, height, marginMm, gapMm, false);
  const rotated = allowRotate ? gridVariant(sheet, width, height, marginMm, gapMm, true) : normal;
  const selected = rotated.capacity > normal.capacity ? rotated : normal;
  return { ...selected, sheet, margin: marginMm, gap: gapMm };
}

export function createPlacements(layout, count = layout.capacity) {
  const requested = Math.max(0, Math.min(layout.capacity, Math.floor(Number(count))));
  const placements = [];
  for (let index = 0; index < requested; index++) {
    const column = index % layout.columns;
    const row = Math.floor(index / layout.columns);
    placements.push({
      x: layout.startX + column * (layout.itemWidth + layout.gap),
      y: layout.startY + row * (layout.itemHeight + layout.gap),
      width: layout.itemWidth,
      height: layout.itemHeight,
      rotated: layout.rotated
    });
  }
  return placements;
}

