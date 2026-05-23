/**
 * scanner.js — OpenCV.js Vision Engine
 * Handles edge detection, perspective warp, and image filters.
 */

const Scanner = (() => {
  'use strict';

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

        if (area < minArea) continue;

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
    const [tl, tr, br, bl] = srcPoints;

    // Calculate output dimensions
    const widthTop = Math.hypot(tr.x - tl.x, tr.y - tl.y);
    const widthBottom = Math.hypot(br.x - bl.x, br.y - bl.y);
    const maxWidth = Math.round(Math.max(widthTop, widthBottom));

    const heightLeft = Math.hypot(bl.x - tl.x, bl.y - tl.y);
    const heightRight = Math.hypot(br.x - tr.x, br.y - tr.y);
    const maxHeight = Math.round(Math.max(heightLeft, heightRight));

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
      maxWidth, 0,
      maxWidth, maxHeight,
      0, maxHeight
    ]);

    const M = cv.getPerspectiveTransform(srcMat, dstMat);
    const dst = new cv.Mat();
    const dstSize = new cv.Size(maxWidth, maxHeight);

    cv.warpPerspective(src, dst, M, dstSize, cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar());

    srcMat.delete();
    dstMat.delete();
    M.delete();

    return dst;
  }

  /**
   * Apply a filter/threshold to the warped image.
   *
   * @param {cv.Mat} src - Source image (the warped result)
   * @param {'bw' | 'gray' | 'color'} mode - Filter mode
   * @returns {cv.Mat} Filtered image
   */
  function applyFilter(src, mode) {
    const dst = new cv.Mat();

    switch (mode) {
      case 'bw': {
        const gray = new cv.Mat();
        cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
        cv.adaptiveThreshold(
          gray, dst, 255,
          cv.ADAPTIVE_THRESH_GAUSSIAN_C,
          cv.THRESH_BINARY,
          21, 10
        );
        // Convert back to RGBA for canvas display
        const rgba = new cv.Mat();
        cv.cvtColor(dst, rgba, cv.COLOR_GRAY2RGBA);
        gray.delete();
        dst.delete();
        return rgba;
      }

      case 'gray': {
        const gray = new cv.Mat();
        cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
        // Enhance contrast with CLAHE-like approach via normalize
        cv.normalize(gray, gray, 0, 255, cv.NORM_MINMAX);
        cv.cvtColor(gray, dst, cv.COLOR_GRAY2RGBA);
        gray.delete();
        return dst;
      }

      case 'color':
      default: {
        // Enhance color: slight sharpening + brightness
        src.copyTo(dst);
        // Simple contrast enhancement
        const lab = new cv.Mat();
        cv.cvtColor(dst, lab, cv.COLOR_RGBA2RGB);
        const rgbEnhanced = new cv.Mat();
        // Normalize each channel
        cv.normalize(lab, rgbEnhanced, 0, 255, cv.NORM_MINMAX);
        const result = new cv.Mat();
        cv.cvtColor(rgbEnhanced, result, cv.COLOR_RGB2RGBA);
        lab.delete();
        rgbEnhanced.delete();
        dst.delete();
        return result;
      }
    }
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
  return {
    detectEdges,
    warpPerspective,
    applyFilter,
    exportImage,
    drawToCanvas,
    sortCorners
  };
})();
