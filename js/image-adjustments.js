export const NEUTRAL_ADJUSTMENTS = Object.freeze({
  bgClean: 0, saturation: 50, brightness: 0, contrast: 0,
  warmth: 0, whiteBalance: 0, sharpness: 0
});

export function normalizeAdjustments(options = {}) {
  return Object.fromEntries(Object.entries(NEUTRAL_ADJUSTMENTS).map(([key, fallback]) => {
    const numeric = Number(options[key] ?? fallback);
    const signed = ['brightness', 'contrast', 'warmth'].includes(key);
    return [key, Number.isFinite(numeric) ? Math.min(signed ? 50 : 100, Math.max(signed ? -50 : 0, numeric)) : fallback];
  }));
}

export function hasAdjustments(options) {
  const normalized = normalizeAdjustments(options);
  return Object.keys(normalized).some(key => normalized[key] !== NEUTRAL_ADJUSTMENTS[key]);
}

/** RGB tone correction. The neutral settings leave every byte unchanged. */
export function adjustTonePixels(data, options = {}) {
  const { brightness, contrast, warmth, whiteBalance } = normalizeAdjustments(options);
  if (!brightness && !contrast && !warmth && !whiteBalance) return;
  const gains = [1, 1, 1];
  if (whiteBalance) {
    // Estimate the paper color from bright, low-chroma pixels; ignore ink/photos.
    const totals = [0, 0, 0];
    let samples = 0;
    const stride = Math.max(3, Math.floor(data.length / 3 / 40_000) * 3);
    for (let index = 0; index < data.length; index += stride) {
      const r = data[index], g = data[index + 1], b = data[index + 2];
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      if (min < 120 || max - min > 65) continue;
      totals[0] += r; totals[1] += g; totals[2] += b; samples++;
    }
    if (samples) {
      const target = Math.max(...totals);
      totals.forEach((total, channel) => {
        gains[channel] = 1 + (Math.min(1.35, target / total) - 1) * whiteBalance / 100;
      });
    }
  }
  const exposure = 2 ** (brightness / 50);
  const contrastFactor = 1 + contrast / 100;
  const temperature = warmth / 50 * 18;
  for (let index = 0; index < data.length; index += 3) {
    for (let channel = 0; channel < 3; channel++) {
      const tint = channel === 0 ? temperature : channel === 2 ? -temperature : 0;
      const value = (data[index + channel] * gains[channel] * exposure - 128) * contrastFactor + 128 + tint;
      data[index + channel] = Math.max(0, Math.min(255, Math.round(value)));
    }
  }
}
