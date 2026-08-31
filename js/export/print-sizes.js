export const ISO_SIZES_MM = Object.freeze({
  A0: Object.freeze([841, 1189]),
  A1: Object.freeze([594, 841]),
  A2: Object.freeze([420, 594]),
  A3: Object.freeze([297, 420]),
  A4: Object.freeze([210, 297]),
  A5: Object.freeze([148, 210])
});

export const PRINT_PRESETS_MM = Object.freeze({
  dni: Object.freeze({ label: 'DNI / tarjeta ID-1', width: 85.6, height: 54 }),
  photo3x4: Object.freeze({ label: 'Foto 3 × 4 cm', width: 30, height: 40 }),
  photo4x4: Object.freeze({ label: 'Foto 4 × 4 cm', width: 40, height: 40 }),
  square5: Object.freeze({ label: 'Cuadrado 5 × 5 cm', width: 50, height: 50 })
});

const UNIT_TO_MM = Object.freeze({ mm: 1, cm: 10, in: 25.4 });
const PAPER_ORDER = Object.freeze(['A5', 'A4', 'A3', 'A2', 'A1', 'A0']);

export function toMillimeters(value, unit = 'mm') {
  const numeric = Number(value);
  const multiplier = UNIT_TO_MM[unit];
  if (!Number.isFinite(numeric) || numeric <= 0 || !multiplier) {
    throw new TypeError('La medida y la unidad deben ser válidas');
  }
  return numeric * multiplier;
}

export function resolvePrintSize({ preset = 'dni', width, height, unit = 'mm', scale = 100 }) {
  const scaleValue = Number(scale);
  if (!Number.isFinite(scaleValue) || scaleValue <= 0 || scaleValue > 1000) {
    throw new RangeError('La escala debe estar entre 0 y 1000%');
  }

  let baseWidth;
  let baseHeight;
  if (preset === 'custom') {
    baseWidth = toMillimeters(width, unit);
    baseHeight = toMillimeters(height, unit);
  } else {
    const selected = PRINT_PRESETS_MM[preset];
    if (!selected) throw new RangeError('Preset de impresión desconocido');
    baseWidth = selected.width;
    baseHeight = selected.height;
  }

  const multiplier = scaleValue / 100;
  return {
    width: baseWidth * multiplier,
    height: baseHeight * multiplier,
    scale: scaleValue
  };
}

export function getPaperSize(name, landscape = false) {
  const paper = ISO_SIZES_MM[name];
  if (!paper) throw new RangeError('Tamaño de papel desconocido');
  return landscape
    ? { name, width: paper[1], height: paper[0], landscape: true }
    : { name, width: paper[0], height: paper[1], landscape: false };
}

export function recommendPaper(width, height, margin = 0) {
  const itemWidth = Number(width);
  const itemHeight = Number(height);
  const marginMm = Number(margin);
  if (![itemWidth, itemHeight].every(value => Number.isFinite(value) && value > 0) ||
      !Number.isFinite(marginMm) || marginMm < 0) {
    throw new TypeError('Medidas inválidas para recomendar papel');
  }

  for (const name of PAPER_ORDER) {
    for (const landscape of [false, true]) {
      const paper = getPaperSize(name, landscape);
      if (itemWidth + marginMm * 2 <= paper.width && itemHeight + marginMm * 2 <= paper.height) {
        return paper;
      }
    }
  }
  return null;
}

