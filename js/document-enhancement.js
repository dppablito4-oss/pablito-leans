import { normalizeAdjustments } from './image-adjustments.js';

export function sampleLuminanceHistogram(data) {
  const histogram = new Uint32Array(256);
  const stride = Math.max(1, Math.ceil(data.length / 40_000));
  for (let index = 0; index < data.length; index += stride) histogram[data[index]]++;
  return histogram;
}

/** Estimate the paper level from a percentile, so small bright spots do not dominate. */
export function estimateDocumentGamma(histogram, intensity = 100) {
  const strength = normalizeAdjustments({ documentEnhance: intensity }).documentEnhance / 100;
  const total = histogram.reduce((sum, count) => sum + count, 0);
  if (!strength || !total) return 1;
  let cumulative = 0;
  let paper = 0;
  for (; paper < 255; paper++) {
    cumulative += histogram[paper];
    if (cumulative >= total * 0.85) break;
  }
  // Leave black/white pages and already bright paper alone. Limit the lift on dark photos.
  if (paper <= 12 || paper >= 235) return 1;
  const gamma = Math.max(0.55, Math.min(1, Math.log(235 / 255) / Math.log(paper / 255)));
  return 1 + (gamma - 1) * strength;
}

export function createGammaTable(gamma) {
  if (!Number.isFinite(gamma) || gamma <= 0) throw new RangeError('Gamma debe ser positiva y finita.');
  return Uint8Array.from({ length: 256 }, (_, value) => Math.round(255 * (value / 255) ** gamma));
}

/** Blend local contrast without graying white paper or fading black text. */
export function blendLocalContrast(base, enhanced, intensity) {
  const weight = normalizeAdjustments({ documentEnhance: intensity }).documentEnhance / 100 * 0.45;
  if (!weight) return;
  for (let index = 0; index < base.length; index++) {
    const original = base[index];
    const change = Math.max(-28, Math.min(28, (enhanced[index] - original) * weight));
    if ((original >= 220 && change < 0) || (original <= 20 && change > 0)) continue;
    base[index] = Math.round(Math.max(0, Math.min(255, original + change)));
  }
}

/** Full-resolution RGB processing; ownership of the returned Mat belongs to the caller. */
export function enhanceDocumentRgb(src, options) {
  const { documentEnhance, denoise } = normalizeAdjustments(options);
  const owned = [];
  const own = value => { owned.push(value); return value; };
  const take = value => { owned.splice(owned.indexOf(value), 1); return value; };
  try {
    let rgb = own(src.clone());
    if (denoise > 0) {
      const smooth = own(new cv.Mat());
      const blended = own(new cv.Mat());
      // A small neighborhood keeps mobile processing bounded and protects thin strokes.
      cv.bilateralFilter(rgb, smooth, 5, 10 + denoise * 0.3, 3);
      cv.addWeighted(rgb, 1 - denoise / 100, smooth, denoise / 100, 0, blended);
      rgb = blended;
    }
    if (documentEnhance === 0) return take(rgb);

    const lab = own(new cv.Mat());
    const channels = own(new cv.MatVector());
    cv.cvtColor(rgb, lab, cv.COLOR_RGB2Lab);
    cv.split(lab, channels);
    const lightness = own(channels.get(0));
    const histogram = sampleLuminanceHistogram(lightness.data);
    const gamma = estimateDocumentGamma(histogram, documentEnhance);
    const hasDetail = histogram.filter(count => count > 0).length > 1;
    // Avoid an unnecessary Lab roundtrip for uniform, already bright images.
    if (!hasDetail && gamma === 1) return take(rgb);

    const corrected = own(new cv.Mat());
    if (gamma !== 1) {
      const lookup = own(new cv.Mat(1, 256, cv.CV_8UC1));
      lookup.data.set(createGammaTable(gamma));
      cv.LUT(lightness, lookup, corrected);
    } else lightness.copyTo(corrected);

    if (hasDetail && src.cols >= 8 && src.rows >= 8) {
      const local = own(new cv.Mat());
      const grid = new cv.Size(Math.max(1, Math.min(8, Math.floor(src.cols / 64))),
        Math.max(1, Math.min(8, Math.floor(src.rows / 64))));
      const clahe = own(new cv.CLAHE(2, grid));
      clahe.apply(corrected, local);
      blendLocalContrast(corrected.data, local.data, documentEnhance);
    }
    channels.set(0, corrected);
    cv.merge(channels, lab);
    const result = own(new cv.Mat());
    cv.cvtColor(lab, result, cv.COLOR_Lab2RGB);
    return take(result);
  } finally {
    for (let index = owned.length - 1; index >= 0; index--) owned[index].delete();
  }
}
