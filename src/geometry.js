// Where things are: the world is infinite, the screen is what the camera shows of it.

/** The camera: where the world's origin is on screen, and how big a world unit is. */
export function camera({ x = 0, y = 0, zoom = 1 } = {}) {
  return { x, y, zoom };
}

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 8;

/** A point on screen, as a point in the world. */
export function toWorld(cam, point) {
  return { x: (point.x - cam.x) / cam.zoom, y: (point.y - cam.y) / cam.zoom };
}

/** A point in the world, as a point on screen. */
export function toScreen(cam, point) {
  return { x: point.x * cam.zoom + cam.x, y: point.y * cam.zoom + cam.y };
}

/** The camera after zooming by `factor` around a point on screen, which stays put. */
export function zoomAt(cam, factor, at) {
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, cam.zoom * factor));
  const real = zoom / cam.zoom;
  return { x: at.x - (at.x - cam.x) * real, y: at.y - (at.y - cam.y) * real, zoom };
}

/** The camera after moving the view by a screen distance. */
export function pan(cam, dx, dy) {
  return { ...cam, x: cam.x + dx, y: cam.y + dy };
}

/** The box around an item, in world units. */
export function boundsOf(item) {
  return { x: item.x, y: item.y, w: item.w ?? 0, h: item.h ?? 0 };
}

/** The box around several items; null when there is none. */
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

/** Whether a world point is inside an item's box, with some air around a thin one. */
export function hits(item, point, slack = 6) {
  const box = boundsOf(item);
  return point.x >= box.x - slack && point.x <= box.x + box.w + slack && point.y >= box.y - slack && point.y <= box.y + box.h + slack;
}

/** The topmost item under a world point, or null. */
export function itemAt(items, point, slack) {
  for (let at = items.length - 1; at >= 0; at -= 1) {
    if (hits(items[at], point, slack)) return items[at];
  }
  return null;
}

/** The camera that shows every item, with a margin, in a view of this size. */
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

/** Distance between two screen points. */
export function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** The middle of two screen points. */
export function middle(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}
