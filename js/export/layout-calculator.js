import { getPaperSize, recommendPaper } from './print-sizes.js';

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
  const columns = Math.max(0, Math.floor((usableWidth + gap + 1e-9) / (width + gap)));
  const rows = Math.max(0, Math.floor((usableHeight + gap + 1e-9) / (height + gap)));
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
  if (!sheet || ![sheet.width, sheet.height].every(value => Number.isFinite(value) && value > 0)) {
    throw new TypeError('El tamaño de papel debe ser válido');
  }
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

// The preview and the exported PDF use this same plan, in millimeters.
export function createPrintPlan({
  pageIndices,
  item,
  mode = 'pack',
  paper = 'A4',
  orientation = 'auto',
  margin = 10,
  gap = 3,
  copies = 0
}) {
  if (!Array.isArray(pageIndices) || !pageIndices.length ||
      pageIndices.some(index => !Number.isInteger(index) || index < 0)) {
    throw new RangeError('Selecciona al menos una página válida.');
  }
  if (!['single', 'fill', 'pack', 'dni'].includes(mode)) throw new RangeError('Distribución no válida.');
  if (!['auto', 'portrait', 'landscape'].includes(orientation)) throw new RangeError('Orientación no válida.');
  const width = Number(item?.width);
  const height = Number(item?.height);
  if (![width, height].every(value => Number.isFinite(value) && value > 0)) {
    throw new RangeError('Completa el ancho y el alto con medidas mayores que cero.');
  }
  const marginMm = validateNonNegative(margin, 'Margen');
  const gapMm = mode === 'single' ? 0 : validateNonNegative(gap, 'Separación');
  const copyCount = mode === 'fill' ? Number(copies) : 0;
  if (!Number.isInteger(copyCount) || copyCount < 0 || copyCount > 1000) {
    throw new RangeError('Las copias deben ser un número entero entre 0 y 1000.');
  }
  if (mode === 'dni' && pageIndices.length % 2) {
    throw new RangeError('El DNI necesita dos caras por documento. Agrega el reverso o selecciona un número par de páginas.');
  }

  const blockHeight = mode === 'dni' ? height * 2 + gapMm : height;
  const gridFor = sheet => calculateGrid({
    paper: sheet, itemWidth: width, itemHeight: blockHeight,
    margin: marginMm, gap: gapMm, allowRotate: false
  });
  let sheet;
  if (paper === 'auto') {
    sheet = recommendPaper(width, blockHeight, marginMm, orientation);
    if (!sheet) throw new RangeError('Estas medidas no caben en A0. Reduce el tamaño, la escala o los márgenes.');
  } else {
    sheet = getPaperSize(paper, orientation === 'landscape');
    if (orientation === 'auto') {
      const horizontal = getPaperSize(paper, true);
      if (gridFor(horizontal).capacity > gridFor(sheet).capacity) sheet = horizontal;
    }
  }
  const layout = gridFor(sheet);
  if (!layout.capacity) {
    const suggested = recommendPaper(width, blockHeight, marginMm, orientation);
    throw new RangeError(suggested
      ? `No cabe ${mode === 'dni' ? 'el DNI completo' : 'la pieza'} en ${sheet.name}. Prueba ${suggested.name} ${suggested.landscape ? 'horizontal' : 'vertical'} o reduce la escala.`
      : 'Estas medidas no caben en A0. Reduce el tamaño, la escala o los márgenes.');
  }

  const capacity = ['single', 'dni'].includes(mode) ? 1 : layout.capacity;
  const copiesPerSource = mode === 'fill' ? (copyCount || capacity) : 1;
  const totalItems = pageIndices.length * copiesPerSource;
  const sheetCount = mode === 'pack' ? Math.ceil(pageIndices.length / capacity)
    : mode === 'dni' ? pageIndices.length / 2
      : pageIndices.length * Math.ceil(copiesPerSource / capacity);
  if (sheetCount > 500 || totalItems > 10000) {
    throw new RangeError('La composición supera 500 hojas o 10 000 piezas. Aumenta la medida o reduce las páginas o copias.');
  }

  const sheets = [];
  const centeredBox = {
    x: (sheet.width - width) / 2,
    y: (sheet.height - blockHeight) / 2,
    width, height
  };
  if (mode === 'dni') {
    for (let index = 0; index < pageIndices.length; index += 2) {
      sheets.push({ items: [
        { ...centeredBox, pageIndex: pageIndices[index], side: 'Anverso' },
        { ...centeredBox, y: centeredBox.y + height + gapMm, pageIndex: pageIndices[index + 1], side: 'Reverso' }
      ] });
    }
  } else if (mode === 'pack') {
    for (let index = 0; index < pageIndices.length; index += capacity) {
      const group = pageIndices.slice(index, index + capacity);
      sheets.push({ items: createPlacements(layout, group.length)
        .map((box, position) => ({ ...box, pageIndex: group[position] })) });
    }
  } else {
    for (const pageIndex of pageIndices) {
      for (let remaining = copiesPerSource; remaining > 0; remaining -= capacity) {
        const boxes = mode === 'single' ? [centeredBox] : createPlacements(layout, Math.min(capacity, remaining));
        sheets.push({ items: boxes.map(box => ({ ...box, pageIndex })) });
      }
    }
  }
  return { item: { width, height }, paper: sheet, layout, mode, capacity,
    copiesPerSource, totalItems, sheets, margin: marginMm, gap: gapMm };
}

export function fitImageToBox(page, box, fitMode = 'contain') {
  if (fitMode === 'cover') return { x: box.x, y: box.y, width: box.width, height: box.height };
  const ratio = Math.min(box.width / page.width, box.height / page.height);
  const width = page.width * ratio;
  const height = page.height * ratio;
  return { x: box.x + (box.width - width) / 2, y: box.y + (box.height - height) / 2, width, height };
}

