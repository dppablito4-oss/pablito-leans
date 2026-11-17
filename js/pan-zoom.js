/** A display-only camera shared by the document and print-sheet viewers. */
export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 8;

export function fitViewport(view, content, padding = 24, mode = 'contain') {
  const widthScale = Math.max(1, view.width - padding * 2) / content.width;
  const scale = mode === 'width' ? widthScale : Math.min(widthScale,
    Math.max(1, view.height - padding * 2) / content.height);
  return { scale, x: (view.width - content.width * scale) / 2,
    y: mode === 'width' ? padding : (view.height - content.height * scale) / 2 };
}

export function zoomAt(camera, scale, anchor) {
  return { scale, x: anchor.x - (anchor.x - camera.x) * scale / camera.scale,
    y: anchor.y - (anchor.y - camera.y) * scale / camera.scale };
}

export function resizeCamera(camera, previous, next, scale) {
  return { scale,
    x: next.width / 2 - (previous.width / 2 - camera.x) * scale / camera.scale,
    y: next.height / 2 - (previous.height / 2 - camera.y) * scale / camera.scale };
}

export function createPanZoomViewport(viewport, { padding = 24, onChange = () => {} } = {}) {
  let content = null;
  let size = { width: 1, height: 1 };
  let view = { width: 0, height: 0 };
  let camera = { x: 0, y: 0, scale: 1 };
  let baseScale = 1;
  let zoom = 1;
  let fitted = true;
  let enabled = false;
  let fitMode = 'contain';
  let wheelMode = 'zoom';
  let gesture = null;
  let dragged = false;
  let suppressClickUntil = 0;
  const pointers = new Map();
  const events = new AbortController();
  const signal = events.signal;

  viewport.classList.add('pan-zoom-viewport');

  function emit() {
    if (content) content.style.transform = `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})`;
    onChange({ zoom, enabled, minZoom: MIN_ZOOM, maxZoom: MAX_ZOOM });
  }

  function measure() {
    return { width: viewport.clientWidth, height: viewport.clientHeight };
  }

  function fit() {
    fitted = true;
    zoom = 1;
    const next = measure();
    if (next.width && next.height && content) {
      view = next;
      camera = fitViewport(view, size, padding, fitMode);
      baseScale = camera.scale;
    }
    emit();
  }

  function resize() {
    const next = measure();
    if (!content || !next.width || !next.height ||
        (view.width === next.width && view.height === next.height)) return;
    if (fitted || !view.width || !view.height) { fit(); return; }
    baseScale = fitViewport(next, size, padding, fitMode).scale;
    camera = resizeCamera(camera, view, next, baseScale * zoom);
    view = next;
    emit();
  }

  function setZoom(value, anchor = { x: view.width / 2, y: view.height / 2 }) {
    if (!enabled || !Number.isFinite(value)) return;
    zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, value));
    camera = zoomAt(camera, baseScale * zoom, anchor);
    fitted = false;
    emit();
  }

  function local(point) {
    const bounds = viewport.getBoundingClientRect();
    return { x: point.x - bounds.left - viewport.clientLeft,
      y: point.y - bounds.top - viewport.clientTop };
  }

  function editable(target) {
    return target instanceof Element && target.closest('input, select, textarea, [contenteditable="true"]');
  }

  function blocked(target) {
    return editable(target) || (target instanceof Element &&
      target.closest('button, a') && !target.closest('.document-page__paper'));
  }

  function startGesture() {
    const points = [...pointers.values()];
    if (!points.length) { gesture = null; return; }
    const midpoint = points.length > 1 ? {
      x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2
    } : points[0];
    gesture = { count: points.length, origin: midpoint, camera: { ...camera }, zoom,
      distance: points.length > 1 ? Math.max(1, Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y)) : 0 };
  }

  function endPointers() {
    for (const id of pointers.keys()) {
      if (viewport.hasPointerCapture(id)) viewport.releasePointerCapture(id);
    }
    pointers.clear();
    gesture = null;
    viewport.classList.remove('is-panning');
  }

  viewport.addEventListener('pointerdown', event => {
    if (!enabled || blocked(event.target) || (event.pointerType === 'mouse' && event.button !== 0)) return;
    if (!pointers.size) { dragged = false; suppressClickUntil = 0; }
    pointers.set(event.pointerId, local({ x: event.clientX, y: event.clientY }));
    startGesture();
    if (event.target === viewport || event.target.tagName === 'CANVAS') viewport.focus({ preventScroll: true });
  }, { signal });

  window.addEventListener('pointermove', event => {
    if (!pointers.has(event.pointerId) || !gesture) return;
    pointers.set(event.pointerId, local({ x: event.clientX, y: event.clientY }));
    const points = [...pointers.values()];
    const midpoint = points.length > 1 ? {
      x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2
    } : points[0];
    const dx = midpoint.x - gesture.origin.x;
    const dy = midpoint.y - gesture.origin.y;
    if (!dragged && points.length === 1 && Math.hypot(dx, dy) < 3) return;
    dragged = true;
    fitted = false;
    event.preventDefault();
    for (const id of pointers.keys()) {
      if (!viewport.hasPointerCapture(id)) viewport.setPointerCapture(id);
    }
    viewport.classList.add('is-panning');
    zoom = points.length > 1 ? Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, gesture.zoom *
      Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y) / gesture.distance)) : gesture.zoom;
    camera = zoomAt(gesture.camera, baseScale * zoom, gesture.origin);
    camera.x += dx;
    camera.y += dy;
    emit();
  }, { signal, passive: false });

  function release(event) {
    if (!pointers.has(event.pointerId)) return;
    pointers.delete(event.pointerId);
    if (viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId);
    if (dragged) suppressClickUntil = performance.now() + 350;
    startGesture();
    if (!pointers.size) viewport.classList.remove('is-panning');
  }
  window.addEventListener('pointerup', release, { signal });
  window.addEventListener('pointercancel', release, { signal });
  window.addEventListener('blur', endPointers, { signal });
  viewport.addEventListener('click', event => {
    if (event.detail && performance.now() < suppressClickUntil && !blocked(event.target)) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, { signal, capture: true });
  viewport.addEventListener('dragstart', event => event.preventDefault(), { signal });
  viewport.addEventListener('dblclick', event => {
    if (!enabled || blocked(event.target)) return;
    event.preventDefault();
    fit();
  }, { signal });
  viewport.addEventListener('wheel', event => {
    if (!enabled || blocked(event.target)) return;
    event.preventDefault();
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? view.height : 1;
    if (wheelMode === 'pan' && !event.ctrlKey && !event.metaKey) {
      camera.x -= event.deltaX * unit;
      camera.y -= event.deltaY * unit;
      fitted = false;
      emit();
    } else {
      setZoom(zoom * Math.exp(-event.deltaY * unit * 0.002), local({ x: event.clientX, y: event.clientY }));
    }
  }, { signal, passive: false });
  viewport.addEventListener('keydown', event => {
    if (!enabled || editable(event.target) || event.target !== viewport) return;
    if (['+', '=', '-', '0', 'Home', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) event.preventDefault();
    if (event.key === '+' || event.key === '=') setZoom(zoom + 0.25);
    else if (event.key === '-') setZoom(zoom - 0.25);
    else if (event.key === '0' || event.key === 'Home') fit();
    else if (event.key.startsWith('Arrow')) {
      const step = event.shiftKey ? 100 : 40;
      if (event.key === 'ArrowLeft') camera.x += step;
      if (event.key === 'ArrowRight') camera.x -= step;
      if (event.key === 'ArrowUp') camera.y += step;
      if (event.key === 'ArrowDown') camera.y -= step;
      fitted = false;
      emit();
    }
  }, { signal });

  const observer = new ResizeObserver(resize);
  observer.observe(viewport);

  return {
    fit, setZoom,
    setEnabled(value) { enabled = value; if (!enabled) endPointers(); emit(); },
    setContent(element, { width, height, mode = 'contain', wheel = 'zoom', reset = false }) {
      const changed = element !== content || width !== size.width || height !== size.height || mode !== fitMode;
      if (changed || reset) endPointers();
      content = element;
      size = { width, height };
      fitMode = mode;
      wheelMode = wheel;
      enabled = true;
      content.classList.add('pan-zoom-content');
      content.style.width = `${width}px`;
      content.style.height = `${height}px`;
      if (changed || reset || fitted) fit();
      else { resize(); emit(); }
    },
    revealRect(rect) {
      if (!enabled) return;
      const top = camera.y + rect.y * camera.scale;
      const bottom = top + rect.height * camera.scale;
      if (top < padding || bottom > view.height - padding) {
        camera.y = padding - rect.y * camera.scale;
        fitted = false;
        emit();
      }
    },
    destroy() { endPointers(); events.abort(); observer.disconnect(); }
  };
}
