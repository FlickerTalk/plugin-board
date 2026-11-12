export function camera({ x = 0, y = 0, zoom = 1 } = {}) {
  return { x, y, zoom };
}

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 8;

export function toWorld(cam, point) {
  return { x: (point.x - cam.x) / cam.zoom, y: (point.y - cam.y) / cam.zoom };
}

export function toScreen(cam, point) {
  return { x: point.x * cam.zoom + cam.x, y: point.y * cam.zoom + cam.y };
}

export function zoomAt(cam, factor, at) {
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, cam.zoom * factor));
  const real = zoom / cam.zoom;
  return { x: at.x - (at.x - cam.x) * real, y: at.y - (at.y - cam.y) * real, zoom };
}

export function pan(cam, dx, dy) {
  return { ...cam, x: cam.x + dx, y: cam.y + dy };
}

export function boundsOf(item) {
  return { x: item.x, y: item.y, w: item.w ?? 0, h: item.h ?? 0 };
}

export function boundsOfAll(items) {
  if (!items.length) return null;
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const item of items) {
    const box = boundsOf(item);
    left = Math.min(left, box.x);
    top = Math.min(top, box.y);
    right = Math.max(right, box.x + box.w);
    bottom = Math.max(bottom, box.y + box.h);
  }
  return { x: left, y: top, w: right - left, h: bottom - top };
}

export function hits(item, point, slack = 6) {
  const box = boundsOf(item);
  return point.x >= box.x - slack && point.x <= box.x + box.w + slack && point.y >= box.y - slack && point.y <= box.y + box.h + slack;
}

export function itemAt(items, point, slack) {
  for (let at = items.length - 1; at >= 0; at -= 1) {
    if (hits(items[at], point, slack)) return items[at];
  }
  return null;
}

export function fit(items, view, margin = 40) {
  const box = boundsOfAll(items);
  if (!box || box.w === 0 || box.h === 0) return camera({ x: margin, y: margin, zoom: 1 });
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.min((view.w - margin * 2) / box.w, (view.h - margin * 2) / box.h, 2)));
  return {
    x: (view.w - box.w * zoom) / 2 - box.x * zoom,
    y: (view.h - box.h * zoom) / 2 - box.y * zoom,
    zoom,
  };
}

export function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function middle(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

export function cornerPlacement(box, cam, view, size, margin = 4) {
  const corner = toScreen(cam, { x: box.x + box.w, y: box.y });
  const inside = (value, length) => Math.max(margin, Math.min(value, length - size - margin));
  return { x: inside(corner.x - size / 2, view.w), y: inside(corner.y - size / 2, view.h) };
}

function toSegment(point, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  const along = length ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length)) : 0;
  return Math.hypot(point.x - (a.x + along * dx), point.y - (a.y + along * dy));
}

const side = (a, b, point) => (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x);

function betweenSegments(a, b, c, d) {
  const cross = side(c, d, a) * side(c, d, b) < 0 && side(a, b, c) * side(a, b, d) < 0;
  if (cross) return 0;
  return Math.min(toSegment(a, c, d), toSegment(b, c, d), toSegment(c, a, b), toSegment(d, a, b));
}

export function touchesInk(item, from, to = from, slack = 6) {
  const points = item.points ?? [];
  if (!points.length) return false;
  const reach = (item.size ?? 6) / 2 + slack;
  if (Number.isFinite(item.w) && Number.isFinite(item.h)) {
    const box = { x: item.x - reach, y: item.y - reach, w: item.w + reach * 2, h: item.h + reach * 2 };
    if (Math.max(from.x, to.x) < box.x || Math.min(from.x, to.x) > box.x + box.w) return false;
    if (Math.max(from.y, to.y) < box.y || Math.min(from.y, to.y) > box.y + box.h) return false;
  }
  const at = ([x, y]) => ({ x: item.x + x, y: item.y + y });
  let last = at(points[0]);
  if (points.length === 1) return betweenSegments(from, to, last, last) <= reach;
  for (let index = 1; index < points.length; index += 1) {
    const next = at(points[index]);
    if (betweenSegments(from, to, last, next) <= reach) return true;
    last = next;
  }
  return false;
}
