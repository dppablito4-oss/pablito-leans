/**
 * corners.js — Interactive Corner Handle System
 * Manages 4 draggable corner nodes on a canvas overlay for manual document edge adjustment.
 */

const Corners = (() => {
  'use strict';

  // State
  let overlayCanvas = null;
  let ctx = null;
  let points = []; // [{x, y}, {x, y}, {x, y}, {x, y}] — TL, TR, BR, BL (in canvas coords)
  let activePointIndex = -1;
  let isDragging = false;
  let canvasRect = null;

  // Config
  const HANDLE_RADIUS = 14;
  const HIT_RADIUS = 28; // Larger touch target
  const ACCENT = '#00D4FF';
  const ACCENT_GLOW = 'rgba(0, 212, 255, 0.4)';
  const LINE_COLOR = 'rgba(0, 212, 255, 0.6)';
  const LINE_WIDTH = 2;
  const OVERLAY_COLOR = 'rgba(0, 0, 0, 0.35)';
  const HANDLE_FILL = 'rgba(0, 212, 255, 0.15)';
  const HANDLE_STROKE = ACCENT;
  const HANDLE_ACTIVE_FILL = 'rgba(0, 212, 255, 0.35)';

  /**
   * Initialize the corner system.
   *
   * @param {HTMLCanvasElement} overlay - The overlay canvas element
   * @param {Array<{x: number, y: number}>|null} initialPoints - Initial corner positions (in image coords), or null for defaults
   * @param {number} displayWidth - Display width of the canvas
   * @param {number} displayHeight - Display height of the canvas
   * @param {number} imageWidth - Original image width
   * @param {number} imageHeight - Original image height
   */
  function init(overlay, initialPoints, displayWidth, displayHeight, imageWidth, imageHeight) {
    overlayCanvas = overlay;
    overlayCanvas.width = displayWidth;
    overlayCanvas.height = displayHeight;
    ctx = overlayCanvas.getContext('2d');

    // Store scale factors for coordinate conversion
    overlayCanvas._scaleX = imageWidth / displayWidth;
    overlayCanvas._scaleY = imageHeight / displayHeight;
    overlayCanvas._imageWidth = imageWidth;
    overlayCanvas._imageHeight = imageHeight;

    if (initialPoints && initialPoints.length === 4) {
      // Convert image coords to display coords
      points = initialPoints.map(p => ({
        x: p.x / overlayCanvas._scaleX,
        y: p.y / overlayCanvas._scaleY
      }));
    } else {
      // Default: rectangle with 10% margin
      const margin = 0.10;
      points = [
        { x: displayWidth * margin,       y: displayHeight * margin },       // TL
        { x: displayWidth * (1 - margin),  y: displayHeight * margin },       // TR
        { x: displayWidth * (1 - margin),  y: displayHeight * (1 - margin) }, // BR
        { x: displayWidth * margin,        y: displayHeight * (1 - margin) }  // BL
      ];
    }

    // Bind events
    overlayCanvas.addEventListener('pointerdown', onPointerDown);
    overlayCanvas.addEventListener('pointermove', onPointerMove);
    overlayCanvas.addEventListener('pointerup', onPointerUp);
    overlayCanvas.addEventListener('pointercancel', onPointerUp);
    overlayCanvas.style.touchAction = 'none'; // Prevent scroll on touch

    draw();
  }

  /**
   * Get the 4 corner points in original image coordinates.
   * @returns {Array<{x: number, y: number}>}
   */
  function getPoints() {
    return points.map(p => ({
      x: Math.round(p.x * overlayCanvas._scaleX),
      y: Math.round(p.y * overlayCanvas._scaleY)
    }));
  }

  /**
   * Clean up event listeners and state.
   */
  function destroy() {
    if (!overlayCanvas) return;
    overlayCanvas.removeEventListener('pointerdown', onPointerDown);
    overlayCanvas.removeEventListener('pointermove', onPointerMove);
    overlayCanvas.removeEventListener('pointerup', onPointerUp);
    overlayCanvas.removeEventListener('pointercancel', onPointerUp);
    points = [];
    activePointIndex = -1;
    isDragging = false;
    if (ctx) {
      ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    }
    overlayCanvas = null;
    ctx = null;
  }

  // ======== Pointer Events ========

  function getPointerPos(e) {
    canvasRect = overlayCanvas.getBoundingClientRect();
    return {
      x: (e.clientX - canvasRect.left) * (overlayCanvas.width / canvasRect.width),
      y: (e.clientY - canvasRect.top) * (overlayCanvas.height / canvasRect.height)
    };
  }

  function hitTest(pos) {
    for (let i = 0; i < points.length; i++) {
      const dx = pos.x - points[i].x;
      const dy = pos.y - points[i].y;
      if (Math.sqrt(dx * dx + dy * dy) <= HIT_RADIUS) {
        return i;
      }
    }
    return -1;
  }

  function onPointerDown(e) {
    e.preventDefault();
    overlayCanvas.setPointerCapture(e.pointerId);
    const pos = getPointerPos(e);
    activePointIndex = hitTest(pos);
    if (activePointIndex >= 0) {
      isDragging = true;
      draw();
    }
  }

  function onPointerMove(e) {
    e.preventDefault();
    if (!isDragging || activePointIndex < 0) {
      // Update cursor
      const pos = getPointerPos(e);
      const hit = hitTest(pos);
      overlayCanvas.style.cursor = hit >= 0 ? 'grab' : 'crosshair';
      return;
    }

    const pos = getPointerPos(e);

    // Clamp to canvas bounds
    points[activePointIndex].x = Math.max(0, Math.min(pos.x, overlayCanvas.width));
    points[activePointIndex].y = Math.max(0, Math.min(pos.y, overlayCanvas.height));

    draw();
  }

  function onPointerUp(e) {
    if (isDragging) {
      isDragging = false;
      activePointIndex = -1;
      overlayCanvas.style.cursor = 'crosshair';
      draw();
    }
  }

  // ======== Drawing ========

  function draw() {
    if (!ctx || !overlayCanvas) return;
    const w = overlayCanvas.width;
    const h = overlayCanvas.height;

    ctx.clearRect(0, 0, w, h);

    // 1. Draw semi-transparent overlay OUTSIDE the polygon
    drawOverlayMask(w, h);

    // 2. Draw connecting lines
    drawLines();

    // 3. Draw corner handles
    drawHandles();
  }

  function drawOverlayMask(w, h) {
    ctx.save();
    ctx.fillStyle = OVERLAY_COLOR;

    // Draw full rect, then cut out the polygon
    ctx.beginPath();
    ctx.rect(0, 0, w, h);

    // Counter-clockwise polygon cutout
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = points.length - 1; i >= 0; i--) {
      ctx.lineTo(points[i].x, points[i].y);
    }
    ctx.closePath();
    ctx.fill('evenodd');
    ctx.restore();
  }

  function drawLines() {
    ctx.save();
    ctx.strokeStyle = LINE_COLOR;
    ctx.lineWidth = LINE_WIDTH;
    ctx.setLineDash([]);

    // Glow effect
    ctx.shadowColor = ACCENT_GLOW;
    ctx.shadowBlur = 8;

    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x, points[i].y);
    }
    ctx.closePath();
    ctx.stroke();

    ctx.restore();
  }

  function drawHandles() {
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const isActive = i === activePointIndex;

      ctx.save();

      // Outer glow
      if (isActive) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, HANDLE_RADIUS + 6, 0, Math.PI * 2);
        ctx.fillStyle = ACCENT_GLOW;
        ctx.fill();
      }

      // Handle circle
      ctx.beginPath();
      ctx.arc(p.x, p.y, HANDLE_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = isActive ? HANDLE_ACTIVE_FILL : HANDLE_FILL;
      ctx.fill();
      ctx.strokeStyle = HANDLE_STROKE;
      ctx.lineWidth = isActive ? 3 : 2;
      ctx.stroke();

      // Inner dot
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
      ctx.fillStyle = ACCENT;
      ctx.fill();

      ctx.restore();
    }
  }

  // Public API
  return {
    init,
    getPoints,
    destroy,
    draw
  };
})();
