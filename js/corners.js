/**
 * corners.js — Interactive Corner Handle System
 * Four perspective corners plus horizontal and vertical edge handles.
 */



import { cropHandlePositions, moveCropHandle, rectangleFromPoints } from './crop-geometry.js';

  // State
  let overlayCanvas = null;
  let ctx = null;
  let points = []; // [{x, y}, {x, y}, {x, y}, {x, y}] — TL, TR, BR, BL (in canvas coords)
  let activePointIndex = -1;
  let isDragging = false;
  let canvasRect = null;
  let stateScaleX = 1;
  let stateScaleY = 1;
  let stateImageWidth = 0;
  let stateImageHeight = 0;
  let cropMode = 'perspective';
  let dragStart = null;
  let dragPoints = null;

  // Config
  const HANDLE_RADIUS = 14;
  const HIT_RADIUS = 28; // Larger touch target
  let ACCENT = '#10B981';
  let ACCENT_GLOW = 'rgba(16, 185, 129, 0.4)';
  let LINE_COLOR = 'rgba(16, 185, 129, 0.6)';
  const LINE_WIDTH = 2;
  const OVERLAY_COLOR = 'rgba(0, 0, 0, 0.35)';
  let HANDLE_FILL = 'rgba(16, 185, 129, 0.12)';
  let HANDLE_STROKE = ACCENT;
  let HANDLE_ACTIVE_FILL = 'rgba(16, 185, 129, 0.24)';

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
  function init(overlay, initialPoints, displayWidth, displayHeight, imageWidth, imageHeight, mode = 'perspective') {
    destroy();
    overlayCanvas = overlay;
    overlayCanvas.width = displayWidth;
    overlayCanvas.height = displayHeight;
    ctx = overlayCanvas.getContext('2d');

    // Store scale factors for coordinate conversion
    stateScaleX = imageWidth / displayWidth;
    stateScaleY = imageHeight / displayHeight;
    stateImageWidth = imageWidth;
    stateImageHeight = imageHeight;

    if (initialPoints && initialPoints.length === 4) {
      // Convert image coords to display coords
      points = initialPoints.map(p => ({
        x: p.x / stateScaleX,
        y: p.y / stateScaleY
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

    cropMode = mode;
    if (mode === 'rectangle') points = rectangleFromPoints(points);

    // Bind events
    overlayCanvas.addEventListener('pointerdown', onPointerDown);
    overlayCanvas.addEventListener('pointermove', onPointerMove);
    overlayCanvas.addEventListener('pointerup', onPointerUp);
    overlayCanvas.addEventListener('pointercancel', onPointerUp);
    overlayCanvas.addEventListener('lostpointercapture', onPointerUp);
    overlayCanvas.addEventListener('keydown', onKeyDown);
    overlayCanvas.addEventListener('focus', onCanvasFocus);
    overlayCanvas.style.touchAction = 'none'; // Prevent scroll on touch
    overlayCanvas.tabIndex = 0;
    overlayCanvas.setAttribute('role', 'application');
    overlayCanvas.setAttribute('aria-describedby', 'corner-keyboard-help');

    draw();
    updateAriaLabel();
  }

  /**
   * Get the 4 corner points in original image coordinates.
   * @returns {Array<{x: number, y: number}>}
   */
  function getPoints() {
    return points.map(p => ({
      x: Math.max(0, Math.min(stateImageWidth - 1, Math.round(p.x * stateScaleX))),
      y: Math.max(0, Math.min(stateImageHeight - 1, Math.round(p.y * stateScaleY)))
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
    overlayCanvas.removeEventListener('lostpointercapture', onPointerUp);
    overlayCanvas.removeEventListener('keydown', onKeyDown);
    overlayCanvas.removeEventListener('focus', onCanvasFocus);
    points = [];
    activePointIndex = -1;
    isDragging = false;
    dragStart = null;
    dragPoints = null;
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
    const handles = cropHandlePositions(points);
    let best = -1;
    let distance = HIT_RADIUS * (overlayCanvas.width / canvasRect.width);
    for (let index = 0; index < handles.length; index++) {
      const candidate = Math.hypot(pos.x - handles[index].x, pos.y - handles[index].y);
      if (candidate < distance) { best = index; distance = candidate; }
    }
    return best;
  }

  function onPointerDown(e) {
    e.preventDefault();
    const pos = getPointerPos(e);
    activePointIndex = hitTest(pos);
    if (activePointIndex >= 0) {
      overlayCanvas.focus({ preventScroll: true });
      overlayCanvas.setPointerCapture(e.pointerId);
      isDragging = true;
      dragStart = pos;
      dragPoints = points.map(point => ({ ...point }));
      updateAriaLabel();
      draw();
    }
  }

  function onPointerMove(e) {
    e.preventDefault();
    if (!isDragging || activePointIndex < 0) {
      // Update cursor
      const pos = getPointerPos(e);
      const hit = hitTest(pos);
      overlayCanvas.style.cursor = hit >= 4 ? (hit % 2 ? 'ew-resize' : 'ns-resize') : hit >= 0 ? 'grab' : 'crosshair';
      return;
    }

    const pos = getPointerPos(e);

    const moved = moveCropHandle(dragPoints, activePointIndex, pos.x - dragStart.x, pos.y - dragStart.y,
      overlayCanvas.width, overlayCanvas.height, cropMode);
    if (moved !== dragPoints) points = moved;

    updateAriaLabel();
    draw();
  }

  function onCanvasFocus() {
    if (activePointIndex < 0) activePointIndex = 0;
    updateAriaLabel();
    draw();
  }

  function onKeyDown(e) {
    if (!overlayCanvas || points.length !== 4) return;

    if (/^[1-8]$/.test(e.key)) {
      e.preventDefault();
      activePointIndex = Number(e.key) - 1;
      updateAriaLabel();
      draw();
      return;
    }

    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
    e.preventDefault();
    if (activePointIndex < 0) activePointIndex = 0;
    const step = e.shiftKey ? 10 : 1;
    const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
    const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
    points = moveCropHandle(points, activePointIndex, dx, dy, overlayCanvas.width, overlayCanvas.height, cropMode);
    updateAriaLabel();
    draw();
  }

  function updateAriaLabel() {
    if (!overlayCanvas || points.length !== 4) return;
    const pointIndex = activePointIndex >= 0 ? activePointIndex : 0;
    const names = ['esquina superior izquierda', 'esquina superior derecha', 'esquina inferior derecha', 'esquina inferior izquierda',
      'borde superior', 'borde derecho', 'borde inferior', 'borde izquierdo'];
    const point = cropHandlePositions(points)[pointIndex];
    overlayCanvas.setAttribute(
      'aria-label',
      `Recorte ${cropMode === 'rectangle' ? 'rectangular' : 'con perspectiva'}. ${names[pointIndex]}, posición ${Math.round(point.x)}, ${Math.round(point.y)}.`
    );
  }

  function onPointerUp(e) {
    if (isDragging) {
      isDragging = false;
      dragStart = null;
      dragPoints = null;
      overlayCanvas.style.cursor = 'crosshair';
      draw();
    }
  }

  // ======== Drawing ========

  function draw() {
    if (!ctx || !overlayCanvas) return;
    const theme = getComputedStyle(document.documentElement);
    const rgb = theme.getPropertyValue('--accent-rgb').trim() || '16, 185, 129';
    ACCENT = theme.getPropertyValue('--accent-primary').trim() || '#10B981';
    ACCENT_GLOW = `rgba(${rgb}, 0.4)`;
    LINE_COLOR = `rgba(${rgb}, 0.6)`;
    HANDLE_FILL = theme.getPropertyValue('--accent-surface').trim();
    HANDLE_ACTIVE_FILL = theme.getPropertyValue('--accent-surface-strong').trim();
    HANDLE_STROKE = ACCENT;
    const w = overlayCanvas.width;
    const h = overlayCanvas.height;

    ctx.clearRect(0, 0, w, h);

    // 1. Draw semi-transparent overlay OUTSIDE the polygon
    drawOverlayMask(w, h);

    // 2. Draw connecting lines
    drawLines();

    // 3. Draw corner handles
    drawHandles();
    drawEdgeHandles();
  }

  function setMode(mode) {
    cropMode = mode === 'rectangle' ? 'rectangle' : 'perspective';
    if (cropMode === 'rectangle') points = rectangleFromPoints(points);
    updateAriaLabel();
    draw();
  }

  function reset() {
    if (!overlayCanvas) return;
    points = [{ x: 0, y: 0 }, { x: overlayCanvas.width, y: 0 },
      { x: overlayCanvas.width, y: overlayCanvas.height }, { x: 0, y: overlayCanvas.height }];
    activePointIndex = 0;
    updateAriaLabel();
    draw();
  }

  function drawEdgeHandles() {
    const handles = cropHandlePositions(points).slice(4);
    handles.forEach((point, edge) => {
      ctx.save();
      ctx.translate(point.x, point.y);
      const horizontal = edge % 2 === 0;
      ctx.fillStyle = activePointIndex === edge + 4 ? '#ffffff' : ACCENT;
      ctx.strokeStyle = '#022C22';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(horizontal ? -18 : -6, horizontal ? -6 : -18, horizontal ? 36 : 12, horizontal ? 12 : 36, 5);
      ctx.fill(); ctx.stroke();
      ctx.restore();
    });
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
  export const Corners = {
    init,
    getPoints,
    setMode,
    getMode: () => cropMode,
    reset,
    destroy,
    draw
  };
