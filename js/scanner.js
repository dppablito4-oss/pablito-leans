/**
 * scanner.js — OpenCV.js Vision Engine
 * Handles edge detection, perspective warp, and image filters.
 */



  /**
   * Detect the largest quadrilateral contour in the image.
   * Returns an array of 4 points [{x, y}, ...] sorted TL, TR, BR, BL.
   * Returns null if no valid quadrilateral is found.
   *
   * @param {cv.Mat} src - Source image (RGBA)
   * @returns {{ points: Array<{x: number, y: number}> } | null}
   */
  function detectEdges(src) {
    let gray = new cv.Mat();
    let blurred = new cv.Mat();
    let edges = new cv.Mat();
    let dilated = new cv.Mat();
    let contours = new cv.MatVector();
    let hierarchy = new cv.Mat();

    try {
      // 1. Grayscale
      cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

      // 2. Gaussian blur to reduce noise
      const ksize = new cv.Size(5, 5);
      cv.GaussianBlur(gray, blurred, ksize, 0);

      // 3. Canny edge detection
      cv.Canny(blurred, edges, 50, 150);

      // 4. Dilate to close gaps in edges
      const kernel = cv.Mat.ones(3, 3, cv.CV_8U);
      cv.dilate(edges, dilated, kernel);
      kernel.delete();

      // 5. Find contours
      cv.findContours(dilated, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

      // 6. Find the largest contour that approximates to 4 points
      let bestContour = null;
      let bestArea = 0;
      const minArea = src.rows * src.cols * 0.05; // At least 5% of the image

      for (let i = 0; i < contours.size(); i++) {
        const contour = contours.get(i);
        const area = cv.contourArea(contour);

        if (area < minArea) {
          contour.delete();
          continue;
        }

        // Approximate the contour to a polygon
        const approx = new cv.Mat();
        const peri = cv.arcLength(contour, true);
        cv.approxPolyDP(contour, approx, 0.02 * peri, true);

        if (approx.rows === 4 && area > bestArea) {
          bestArea = area;
          if (bestContour) bestContour.delete();
          bestContour = approx;
        } else {
          approx.delete();
        }
        
        contour.delete();
      }

      if (!bestContour) return null;

      // 7. Extract and sort points
      const points = [];
      for (let i = 0; i < 4; i++) {
        points.push({
          x: bestContour.data32S[i * 2],
          y: bestContour.data32S[i * 2 + 1]
        });
      }
      bestContour.delete();

      return { points: sortCorners(points) };
    } finally {
      gray.delete();
      blurred.delete();
      edges.delete();
      dilated.delete();
      contours.delete();
      hierarchy.delete();
    }
  }

  /**
   * Sort 4 points into order: Top-Left, Top-Right, Bottom-Right, Bottom-Left.
   * @param {Array<{x: number, y: number}>} pts
   * @returns {Array<{x: number, y: number}>}
   */
  function sortCorners(pts) {
    // Sum of coordinates: smallest = TL, largest = BR
    // Diff of coordinates (y - x): smallest = TR, largest = BL
    const sorted = [...pts];

    sorted.sort((a, b) => (a.x + a.y) - (b.x + b.y));
    const tl = sorted[0];
    const br = sorted[3];

    // From the middle two, the one with smaller y-x diff is TR
    const remaining = [sorted[1], sorted[2]];
    remaining.sort((a, b) => (a.y - a.x) - (b.y - b.x));
    const tr = remaining[0];
    const bl = remaining[1];

    return [tl, tr, br, bl];
  }

  /**
   * Apply perspective warp to flatten the document.
   *
   * @param {cv.Mat} src - Source image (RGBA)
   * @param {Array<{x: number, y: number}>} srcPoints - 4 corner points [TL, TR, BR, BL]
   * @returns {cv.Mat} Warped image
   */
  function warpPerspective(src, srcPoints) {
    if (!Array.isArray(srcPoints) || srcPoints.length !== 4) {
      throw new TypeError('Se requieren cuatro esquinas');
    }
    const [tl, tr, br, bl] = sortCorners(srcPoints);

    // Calculate output dimensions
    const widthTop = Math.hypot(tr.x - tl.x, tr.y - tl.y);
    const widthBottom = Math.hypot(br.x - bl.x, br.y - bl.y);
    const maxWidth = Math.round(Math.max(widthTop, widthBottom));

    const heightLeft = Math.hypot(bl.x - tl.x, bl.y - tl.y);
    const heightRight = Math.hypot(br.x - tr.x, br.y - tr.y);
    const maxHeight = Math.round(Math.max(heightLeft, heightRight));

    if (maxWidth < 2 || maxHeight < 2) {
      throw new RangeError('Las esquinas no forman un área válida');
    }

    // Source matrix
    const srcMat = cv.matFromArray(4, 1, cv.CV_32FC2, [
      tl.x, tl.y,
      tr.x, tr.y,
      br.x, br.y,
      bl.x, bl.y
    ]);

    // Destination matrix
    const dstMat = cv.matFromArray(4, 1, cv.CV_32FC2, [
      0, 0,
      maxWidth - 1, 0,
      maxWidth - 1, maxHeight - 1,
      0, maxHeight - 1
    ]);

    let M = null;
    const dst = new cv.Mat();
    try {
      M = cv.getPerspectiveTransform(srcMat, dstMat);
      const dstSize = new cv.Size(maxWidth, maxHeight);
      cv.warpPerspective(src, dst, M, dstSize, cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar());
      return dst;
    } catch (error) {
      dst.delete();
      throw error;
    } finally {
      srcMat.delete();
      dstMat.delete();
      if (M) M.delete();
    }
  }

  /**
   * Apply a filter/threshold to the warped image.
   * Filters inspired by Microsoft Lens.
   *
   * @param {cv.Mat} src - Source image (the warped result, RGBA)
   * @param {string} mode - Filter mode
   * @param {Object} options - Additional options like saturation, bgClean
   * @returns {cv.Mat} Filtered image (RGBA)
   */
  function applyFilter(src, mode, options = {}) {
    switch (mode) {
      case 'original':
        return filterOriginal(src);
      case 'auto':
        return filterAuto(src);
      case 'manual':
        return filterManual(src, options);
      case 'document':
        return filterDocument(src);
      case 'whiteboard':
        return filterWhiteboard(src);
      case 'gray':
        return filterGrayscale(src);
      case 'sepia':
        return filterSepia(src);
      case 'sketch':
        return filterSketch(src);
      case 'highcontrast':
        return filterHighContrast(src);
      case 'color':
      default:
        return filterColor(src);
    }
  }

  // ---- Filter: Original ----
  // Exact visual pass-through: perspective correction remains, but color,
  // contrast, brightness and saturation are not modified.
  function filterOriginal(src) {
    const result = new cv.Mat();
    src.copyTo(result);
    return result;
  }

  // ---- Filter: Auto ----
  // A conservative default: evens out lighting and gently restores color
  // without the aggressive channel stretching used by the Color preset.
  function filterAuto(src) {
    return filterManual(src, { bgClean: 38, saturation: 56 });
  }

  // ---- Filter: Manual (Custom Background Clean & Saturation) ----
  function filterManual(src, options) {
    const parsedBgClean = Number.parseFloat(options.bgClean);
    const parsedSaturation = Number.parseFloat(options.saturation);
    const bgCleanVal = Number.isFinite(parsedBgClean) ? Math.min(100, Math.max(0, parsedBgClean)) : 0;
    const satVal = Number.isFinite(parsedSaturation) ? Math.min(100, Math.max(0, parsedSaturation)) : 50;

    const rgb = new cv.Mat();
    cv.cvtColor(src, rgb, cv.COLOR_RGBA2RGB);

    // 1. Background clean. The corrected image is blended with the original
    // using an ease-in curve. Therefore 0 is exactly the source and the first
    // half of the slider stays deliberately subtle.
    let cleaned = new cv.Mat();
    if (bgCleanVal > 0) {
      const bg = new cv.Mat();
      cv.GaussianBlur(rgb, bg, new cv.Size(51, 51), 0);

      const divided = new cv.Mat();
      cv.divide(rgb, bg, divided, 255.0);

      const enhanced = new cv.Mat();
      divided.convertTo(enhanced, -1, 1.03, 3);
      const blend = Math.pow(bgCleanVal / 100, 2) * 0.7;
      cv.addWeighted(rgb, 1 - blend, enhanced, blend, 0, cleaned);

      bg.delete(); divided.delete(); enhanced.delete();
    } else {
      rgb.copyTo(cleaned);
    }

    // 2. Saturation
    let result = new cv.Mat();
    if (satVal !== 50) {
      const hsv = new cv.Mat();
      cv.cvtColor(cleaned, hsv, cv.COLOR_RGB2HSV);
      
      const channels = new cv.MatVector();
      cv.split(hsv, channels);
      
      const s = channels.get(1);
      // 50 is neutral. The full slider only spans 75%–125% saturation so
      // small movements do not cause abrupt or artificial colors.
      const satScale = 1 + ((satVal - 50) / 50) * 0.25;
      s.convertTo(s, -1, satScale, 0);
      
      cv.merge(channels, hsv);
      cv.cvtColor(hsv, result, cv.COLOR_HSV2RGB);
      
      hsv.delete(); channels.delete(); s.delete();
    } else {
      cleaned.copyTo(result);
    }

    const rgba = new cv.Mat();
    cv.cvtColor(result, rgba, cv.COLOR_RGB2RGBA);

    rgb.delete(); cleaned.delete(); result.delete();
    return rgba;
  }

  // ---- Filter: Color (Enhanced) ----
  // Keeps hues natural while gently correcting uneven illumination.
  function filterColor(src) {
    const corrected = filterManual(src, { bgClean: 30, saturation: 64 });
    const blurred = new cv.Mat();
    cv.GaussianBlur(corrected, blurred, new cv.Size(0, 0), 1.2);
    const result = new cv.Mat();
    cv.addWeighted(corrected, 1.18, blurred, -0.18, 0, result);
    corrected.delete();
    blurred.delete();
    return result;
  }

  // ---- Filter: Document (B&W Adaptive Threshold) ----
  // Classic scan look: white background, black text.
  function filterDocument(src) {
    const gray = new cv.Mat();
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

    // Slight blur to reduce noise before threshold
    const blurred = new cv.Mat();
    cv.GaussianBlur(gray, blurred, new cv.Size(3, 3), 0);

    const thresh = new cv.Mat();
    cv.adaptiveThreshold(
      blurred, thresh, 255,
      cv.ADAPTIVE_THRESH_GAUSSIAN_C,
      cv.THRESH_BINARY,
      21, 10
    );

    const result = new cv.Mat();
    cv.cvtColor(thresh, result, cv.COLOR_GRAY2RGBA);

    gray.delete(); blurred.delete(); thresh.delete();
    return result;
  }

  // ---- Filter: Whiteboard ----
  // Optimized for whiteboards/pizarras: brightens the background, sharpens markers.
  function filterWhiteboard(src) {
    const rgb = new cv.Mat();
    cv.cvtColor(src, rgb, cv.COLOR_RGBA2RGB);

    // Large Gaussian blur to estimate the background illumination
    const bg = new cv.Mat();
    cv.GaussianBlur(rgb, bg, new cv.Size(51, 51), 0);

    // Divide original by background to normalize illumination
    // result = (src / bg) * 255
    const divided = new cv.Mat();
    cv.divide(rgb, bg, divided, 255.0);

    // Clamp values
    const clamped = new cv.Mat();
    cv.normalize(divided, clamped, 0, 255, cv.NORM_MINMAX);

    // Increase brightness and contrast
    const bright = new cv.Mat();
    clamped.convertTo(bright, -1, 1.3, 20); // alpha=1.3 (contrast), beta=20 (brightness)

    const result = new cv.Mat();
    cv.cvtColor(bright, result, cv.COLOR_RGB2RGBA);

    rgb.delete(); bg.delete(); divided.delete(); clamped.delete(); bright.delete();
    return result;
  }

  // ---- Filter: Grayscale ----
  // Normalized grayscale with enhanced contrast.
  function filterGrayscale(src) {
    const gray = new cv.Mat();
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.normalize(gray, gray, 0, 255, cv.NORM_MINMAX);

    const result = new cv.Mat();
    cv.cvtColor(gray, result, cv.COLOR_GRAY2RGBA);

    gray.delete();
    return result;
  }

  // ---- Filter: Sepia ----
  // Warm vintage tone with a brownish tint.
  function filterSepia(src) {
    const rgb = new cv.Mat();
    cv.cvtColor(src, rgb, cv.COLOR_RGBA2RGB);

    // Sepia kernel (applied per-pixel via transform)
    // newR = 0.393*R + 0.769*G + 0.189*B
    // newG = 0.349*R + 0.686*G + 0.168*B
    // newB = 0.272*R + 0.534*G + 0.131*B
    const sepiaKernel = cv.matFromArray(3, 3, cv.CV_32FC1, [
      0.393, 0.769, 0.189,
      0.349, 0.686, 0.168,
      0.272, 0.534, 0.131
    ]);

    const float = new cv.Mat();
    rgb.convertTo(float, cv.CV_32FC3);

    const transformed = new cv.Mat();
    cv.transform(float, transformed, sepiaKernel);

    // Convert back to 8-bit, clamping values
    const sepia8 = new cv.Mat();
    transformed.convertTo(sepia8, cv.CV_8UC3);

    const result = new cv.Mat();
    cv.cvtColor(sepia8, result, cv.COLOR_RGB2RGBA);

    rgb.delete(); sepiaKernel.delete(); float.delete(); transformed.delete(); sepia8.delete();
    return result;
  }

  // ---- Filter: Sketch (Pencil drawing) ----
  // Edge-detected pencil sketch effect.
  function filterSketch(src) {
    const gray = new cv.Mat();
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

    // Invert
    const inverted = new cv.Mat();
    cv.bitwise_not(gray, inverted);

    // Heavy Gaussian blur on the inverted image
    const blurred = new cv.Mat();
    cv.GaussianBlur(inverted, blurred, new cv.Size(21, 21), 0);

    // Dodge blend: result = gray / (255 - blurred) * 255
    // We simulate this with divide
    const invertedBlur = new cv.Mat();
    cv.bitwise_not(blurred, invertedBlur);

    // Avoid division by zero: add 1 to denominator
    const ones = new cv.Mat(invertedBlur.rows, invertedBlur.cols, cv.CV_8UC1, new cv.Scalar(1));
    const safeDenom = new cv.Mat();
    cv.add(invertedBlur, ones, safeDenom);

    const sketch = new cv.Mat();
    cv.divide(gray, safeDenom, sketch, 256.0);

    const result = new cv.Mat();
    cv.cvtColor(sketch, result, cv.COLOR_GRAY2RGBA);

    gray.delete(); inverted.delete(); blurred.delete();
    invertedBlur.delete(); ones.delete(); safeDenom.delete(); sketch.delete();
    return result;
  }

  // ---- Filter: High Contrast ----
  // Stark black & white with strong Otsu threshold.
  function filterHighContrast(src) {
    const gray = new cv.Mat();
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);

    // Enhance contrast first
    cv.normalize(gray, gray, 0, 255, cv.NORM_MINMAX);

    // Apply Otsu threshold for automatic optimal split
    const thresh = new cv.Mat();
    cv.threshold(gray, thresh, 0, 255, cv.THRESH_BINARY | cv.THRESH_OTSU);

    const result = new cv.Mat();
    cv.cvtColor(thresh, result, cv.COLOR_GRAY2RGBA);

    gray.delete(); thresh.delete();
    return result;
  }

  /**
   * Export canvas content as downloadable image.
   *
   * @param {HTMLCanvasElement} canvas
   * @param {'png' | 'jpeg'} format
   * @param {number} quality - 0 to 1 (for JPEG)
   * @returns {string} Data URL
   */
  function exportImage(canvas, format = 'png', quality = 0.92) {
    const mimeType = format === 'jpeg' ? 'image/jpeg' : 'image/png';
    return canvas.toDataURL(mimeType, quality);
  }

  /**
   * Draw a cv.Mat onto a canvas.
   * @param {cv.Mat} mat
   * @param {HTMLCanvasElement} canvas
   */
  function drawToCanvas(mat, canvas) {
    cv.imshow(canvas, mat);
  }

  // Public API
  export const Scanner = {
    detectEdges,
    warpPerspective,
    applyFilter,
    exportImage,
    drawToCanvas,
    sortCorners
  };
