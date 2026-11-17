const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function rectangleFromPoints(points) {
  const left = Math.min(...points.map(point => point.x));
  const right = Math.max(...points.map(point => point.x));
  const top = Math.min(...points.map(point => point.y));
  const bottom = Math.max(...points.map(point => point.y));
  return [{ x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom }];
}

export function cropHandlePositions(points) {
  return [...points, ...points.map((point, index) => {
    const next = points[(index + 1) % 4];
    return { x: (point.x + next.x) / 2, y: (point.y + next.y) / 2 };
  })];
}

export function isValidCrop(points, minimum = 2) {
  if (points.length !== 4 || points.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y))) return false;
  let direction = 0;
  for (let index = 0; index < 4; index++) {
    const a = points[index], b = points[(index + 1) % 4], c = points[(index + 2) % 4];
    if (Math.hypot(a.x - b.x, a.y - b.y) < minimum) return false;
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) < minimum * minimum) return false;
    if (direction && Math.sign(cross) !== direction) return false;
    direction = Math.sign(cross);
  }
  return direction > 0;
}

/** Handles 0–3 are corners; 4–7 are top, right, bottom and left edges. */
export function moveCropHandle(points, handle, dx, dy, width, height, mode = 'perspective') {
  if (!Number.isInteger(handle) || handle < 0 || handle > 7) return points;
  const next = points.map(point => ({ ...point }));
  let xIndices = [], yIndices = [];
  if (handle >= 4) {
    const edge = handle - 4;
    const indices = [edge, (edge + 1) % 4];
    if (edge % 2) xIndices = indices;
    else yIndices = indices;
  } else if (mode === 'rectangle') {
    xIndices = handle === 0 || handle === 3 ? [0, 3] : [1, 2];
    yIndices = handle < 2 ? [0, 1] : [2, 3];
  } else {
    xIndices = [handle];
    yIndices = [handle];
  }
  const boundedDelta = (indices, axis, delta, bound) => indices.length
    ? clamp(delta, -Math.min(...indices.map(index => points[index][axis])), bound - Math.max(...indices.map(index => points[index][axis]))) : 0;
  const deltaX = boundedDelta(xIndices, 'x', dx, width);
  const deltaY = boundedDelta(yIndices, 'y', dy, height);
  xIndices.forEach(index => { next[index].x += deltaX; });
  yIndices.forEach(index => { next[index].y += deltaY; });
  return isValidCrop(next) ? next : points;
}
