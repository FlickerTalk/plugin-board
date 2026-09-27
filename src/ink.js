// A stroke of the finger or the pen (perfect-freehand, MIT): points with pressure become an
// outline, and the outline a path the view paints.

import { getStroke } from "perfect-freehand";

/** How a stroke is drawn: thinner when quick, with pressure when the pen gives it. */
export const NIBS = [3, 6, 12];
export const INKS = ["#111111", "#d92b2b", "#1d6fd0", "#1f9d55", "#e2a400"];

/** A finished stroke as an item: its points relative to its own corner, and its box. */
export function strokeItem(points, { color, size }) {
  if (!points.length) return null;
  const outline = outlineOf(points, size);
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const [x, y] of outline.length ? outline : points.map((one) => [one.x, one.y])) {
    left = Math.min(left, x);
    top = Math.min(top, y);
    right = Math.max(right, x);
    bottom = Math.max(bottom, y);
  }
  if (!Number.isFinite(left)) return null;
  const x = Math.floor(left);
  const y = Math.floor(top);
  return {
    kind: "ink",
    x,
    y,
    w: Math.ceil(right) - x || 1,
    h: Math.ceil(bottom) - y || 1,
    color,
    size,
    points: points.map((one) => [round(one.x - x), round(one.y - y), round(one.pressure ?? 0.5)]),
  };
}

const round = (value) => Math.round(value * 100) / 100;

/** The outline of a stroke, as perfect-freehand draws it. */
export function outlineOf(points, size) {
  const input = points.map((one) => (Array.isArray(one) ? one : [one.x, one.y, one.pressure ?? 0.5]));
  return getStroke(input, { size, thinning: 0.55, smoothing: 0.6, streamline: 0.45, simulatePressure: input.every((one) => one[2] === 0.5) });
}

/** An outline as an SVG path (the usual quadratic mid-point curve). */
export function pathOf(outline) {
  if (!outline.length) return "";
  const parts = [`M ${fixed(outline[0][0])} ${fixed(outline[0][1])}`];
  for (let at = 0; at < outline.length; at += 1) {
    const a = outline[at];
    const b = outline[(at + 1) % outline.length];
    parts.push(`Q ${fixed(a[0])} ${fixed(a[1])} ${fixed((a[0] + b[0]) / 2)} ${fixed((a[1] + b[1]) / 2)}`);
  }
  parts.push("Z");
  return parts.join(" ");
}

const fixed = (value) => Number(value.toFixed(2));

/** The path of an ink item, in its own coordinates. */
export function pathOfItem(item) {
  return pathOf(outlineOf(item.points ?? [], item.size ?? NIBS[1]));
}
