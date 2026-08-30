/**
 * Pure helpers shared by the browser application and the test suite.
 */

export function parsePageRange(rangeStr, maxPages) {
  if (!rangeStr || rangeStr.trim() === '') {
    return Array.from({ length: maxPages }, (_, index) => index);
  }

  const pages = new Set();
  for (const rawPart of rangeStr.split(',')) {
    const part = rawPart.trim();
    if (!part) continue;

    if (part.includes('-')) {
      const bounds = part.split('-');
      if (bounds.length !== 2) continue;
      const start = Number(bounds[0]);
      const end = Number(bounds[1]);
      if (!Number.isInteger(start) || !Number.isInteger(end) || start > end) continue;

      for (let page = start; page <= end; page++) {
        if (page >= 1 && page <= maxPages) pages.add(page - 1);
      }
    } else {
      const page = Number(part);
      if (Number.isInteger(page) && page >= 1 && page <= maxPages) {
        pages.add(page - 1);
      }
    }
  }

  return Array.from(pages).sort((a, b) => a - b);
}

export function fitImageDimensions(width, height, maxDimension, maxPixels) {
  if (![width, height, maxDimension, maxPixels].every(Number.isFinite) ||
      width <= 0 || height <= 0 || maxDimension <= 0 || maxPixels <= 0) {
    throw new TypeError('Las dimensiones deben ser números positivos');
  }

  const dimensionScale = Math.min(1, maxDimension / Math.max(width, height));
  const pixelScale = Math.min(1, Math.sqrt(maxPixels / (width * height)));
  const scale = Math.min(dimensionScale, pixelScale);

  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    scale
  };
}
