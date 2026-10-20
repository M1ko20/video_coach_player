import { measureTextBlock } from '../lib/textMetrics';
import { MIN_SHAPE_SIZE, REF_HEIGHT } from './constants';
import type { Annotation, Bounds, BoxHandle, LineAnnotation, LineHandle, Point, StrokeStyle } from './types';

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function clamp01(value: number): number {
  return clamp(value, 0, 1);
}

/** Width of the overlay's coordinate space for a video of the given aspect ratio. */
export function refWidth(aspect: number): number {
  return REF_HEIGHT * aspect;
}

const round1 = (value: number) => Math.round(value * 10) / 10;

/**
 * SVG path data for a freehand stroke. Points are joined with quadratic curves
 * through their midpoints, which removes the corners of raw pointer samples.
 */
export function pathData(points: readonly number[], width: number, height: number): string {
  const count = points.length >> 1;
  if (count === 0) return '';
  const px = (i: number) => round1(points[i * 2]! * width);
  const py = (i: number) => round1(points[i * 2 + 1]! * height);

  if (count === 1) return `M${px(0)} ${py(0)}l0.01 0`;
  if (count === 2) return `M${px(0)} ${py(0)}L${px(1)} ${py(1)}`;

  let d = `M${px(0)} ${py(0)}`;
  for (let i = 1; i < count - 1; i++) {
    const midX = round1((px(i) + px(i + 1)) / 2);
    const midY = round1((py(i) + py(i + 1)) / 2);
    d += `Q${px(i)} ${py(i)} ${midX} ${midY}`;
  }
  d += `L${px(count - 1)} ${py(count - 1)}`;
  return d;
}

/**
 * Ramer–Douglas–Peucker simplification of a flat point list.
 * `tolerance` is a fraction of the video height.
 */
export function simplifyPath(points: readonly number[], aspect: number, tolerance = 0.0012): number[] {
  const count = points.length >> 1;
  if (count <= 2) return points.slice();

  const xs = (i: number) => points[i * 2]! * aspect;
  const ys = (i: number) => points[i * 2 + 1]!;
  const keep = new Uint8Array(count);
  keep[0] = 1;
  keep[count - 1] = 1;

  const stack: Array<[number, number]> = [[0, count - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop()!;
    const ax = xs(first);
    const ay = ys(first);
    const dx = xs(last) - ax;
    const dy = ys(last) - ay;
    const lengthSq = dx * dx + dy * dy;

    let maxDistSq = 0;
    let index = -1;
    for (let i = first + 1; i < last; i++) {
      const ox = xs(i) - ax;
      const oy = ys(i) - ay;
      let distSq: number;
      if (lengthSq === 0) {
        distSq = ox * ox + oy * oy;
      } else {
        const t = clamp((ox * dx + oy * dy) / lengthSq, 0, 1);
        const ex = ox - t * dx;
        const ey = oy - t * dy;
        distSq = ex * ex + ey * ey;
      }
      if (distSq > maxDistSq) {
        maxDistSq = distSq;
        index = i;
      }
    }

    if (index !== -1 && maxDistSq > tolerance * tolerance) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }

  const result: number[] = [];
  for (let i = 0; i < count; i++) {
    if (keep[i]) result.push(points[i * 2]!, points[i * 2 + 1]!);
  }
  return result;
}

/**
 * Dash pattern for a stroke style, scaled with the stroke width so dashes look
 * the same at every thickness. `null` means a solid stroke. Dots are zero-length
 * dashes made round by the round line cap.
 */
export function dashPattern(style: StrokeStyle | undefined, strokeWidth: number): number[] | null {
  switch (style) {
    case 'dashed':
      return [strokeWidth * 3, strokeWidth * 2.2];
    case 'dotted':
      return [0, strokeWidth * 2];
    default:
      return null;
  }
}

export interface ArrowGeometry {
  /** Where the shaft stops, slightly inside the head so the two overlap. */
  shaftEnd: Point;
  /** Corners of the arrowhead: tip first. Empty for a zero-length arrow. */
  headPoints: Point[];
  /** `points` attribute of the arrowhead polygon. */
  head: string;
}

/** Arrowhead geometry in overlay units. The head scales with the stroke width. */
export function arrowGeometry(x1: number, y1: number, x2: number, y2: number, strokeWidth: number): ArrowGeometry {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.hypot(dx, dy);
  if (length < 0.001) return { shaftEnd: { x: x2, y: y2 }, headPoints: [], head: '' };

  const ux = dx / length;
  const uy = dy / length;
  const headLength = Math.min(length * 0.7, Math.max(strokeWidth * 5, 24));
  const halfWidth = headLength * 0.46;
  const baseX = x2 - ux * headLength;
  const baseY = y2 - uy * headLength;

  const headPoints = [
    { x: x2, y: y2 },
    { x: baseX - uy * halfWidth, y: baseY + ux * halfWidth },
    { x: baseX + uy * halfWidth, y: baseY - ux * halfWidth },
  ];

  return {
    shaftEnd: { x: x2 - ux * headLength * 0.8, y: y2 - uy * headLength * 0.8 },
    headPoints,
    head: headPoints.map(({ x, y }) => `${round1(x)},${round1(y)}`).join(' '),
  };
}

/** Bounding box of an annotation in normalized coordinates. */
export function getBounds(annotation: Annotation, aspect: number): Bounds {
  switch (annotation.type) {
    case 'path': {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      const { points } = annotation;
      for (let i = 0; i < points.length; i += 2) {
        const x = points[i]!;
        const y = points[i + 1]!;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
      if (minX === Infinity) return { x: 0, y: 0, w: 0, h: 0 };
      return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
    }
    case 'line':
    case 'arrow': {
      const x = Math.min(annotation.x1, annotation.x2);
      const y = Math.min(annotation.y1, annotation.y2);
      return { x, y, w: Math.abs(annotation.x2 - annotation.x1), h: Math.abs(annotation.y2 - annotation.y1) };
    }
    case 'rect':
    case 'ellipse':
      return { x: annotation.x, y: annotation.y, w: annotation.w, h: annotation.h };
    case 'text': {
      const metrics = measureTextBlock(annotation.text, annotation.fontSize);
      return {
        x: annotation.x,
        y: annotation.y,
        w: metrics.width / refWidth(aspect),
        h: metrics.height / REF_HEIGHT,
      };
    }
  }
}

export function translateAnnotation<T extends Annotation>(annotation: T, dx: number, dy: number): T {
  switch (annotation.type) {
    case 'path': {
      const points = new Array<number>(annotation.points.length);
      for (let i = 0; i < annotation.points.length; i += 2) {
        points[i] = annotation.points[i]! + dx;
        points[i + 1] = annotation.points[i + 1]! + dy;
      }
      return { ...annotation, points };
    }
    case 'line':
    case 'arrow':
      return {
        ...annotation,
        x1: annotation.x1 + dx,
        y1: annotation.y1 + dy,
        x2: annotation.x2 + dx,
        y2: annotation.y2 + dy,
      };
    default:
      return { ...annotation, x: annotation.x + dx, y: annotation.y + dy };
  }
}

/** Limits a move so the annotation's bounding box stays inside the video frame. */
export function clampDelta(bounds: Bounds, dx: number, dy: number): Point {
  const minX = -bounds.x;
  const minY = -bounds.y;
  return {
    x: clamp(dx, minX, Math.max(minX, 1 - bounds.x - bounds.w)),
    y: clamp(dy, minY, Math.max(minY, 1 - bounds.y - bounds.h)),
  };
}

export function boundsFromPoints(a: Point, b: Point): Bounds {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(b.x - a.x),
    h: Math.abs(b.y - a.y),
  };
}

/** Moves the edges named by `handle` to `point`. Dragging past the opposite edge flips the box. */
export function resizeBounds(original: Bounds, handle: BoxHandle, point: Point): Bounds {
  let left = original.x;
  let top = original.y;
  let right = original.x + original.w;
  let bottom = original.y + original.h;

  if (handle.includes('w')) left = point.x;
  if (handle.includes('e')) right = point.x;
  if (handle.includes('n')) top = point.y;
  if (handle.includes('s')) bottom = point.y;

  return boundsFromPoints({ x: left, y: top }, { x: right, y: bottom });
}

/** Snaps `to` so the segment from `from` runs at a multiple of 45° on screen. */
export function constrainLine(from: Point, to: Point, aspect: number): Point {
  const dx = (to.x - from.x) * aspect;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return to;
  const step = Math.PI / 4;
  const angle = Math.round(Math.atan2(dy, dx) / step) * step;
  return {
    x: clamp01(from.x + (Math.cos(angle) * length) / aspect),
    y: clamp01(from.y + Math.sin(angle) * length),
  };
}

/**
 * Bounding box of a circle around `center` with radius `radius` (a fraction of
 * the video height). The circle is kept inside the frame by moving its centre
 * inwards rather than shrinking it, so a player near the edge can still be
 * circled at a useful size.
 */
export function circleBounds(center: Point, radius: number, aspect: number): Bounds {
  const r = Math.min(radius, 0.5, aspect / 2);
  const rx = r / aspect;
  const cx = clamp(center.x, rx, 1 - rx);
  const cy = clamp(center.y, r, 1 - r);
  return { x: cx - rx, y: cy - r, w: rx * 2, h: r * 2 };
}

/** Distance between two points on screen, as a fraction of the video height. */
function screenDistance(a: Point, b: Point, aspect: number): number {
  return Math.hypot((b.x - a.x) * aspect, b.y - a.y);
}

/** A circle drawn from its centre outwards: `edge` is a point on its outline. */
export function circleFromCenter(center: Point, edge: Point, aspect: number): Bounds {
  return circleBounds(center, screenDistance(center, edge, aspect), aspect);
}

/** Resizes a circle about its centre so that its outline passes through `point`. */
export function resizeCircle(original: Bounds, point: Point, aspect: number): Bounds {
  const center = { x: original.x + original.w / 2, y: original.y + original.h / 2 };
  return circleFromCenter(center, point, aspect);
}

/** Snaps `to` so the box from `from` is square on screen, without leaving the frame. */
export function constrainSquare(from: Point, to: Point, aspect: number): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const roomX = (dx >= 0 ? 1 - from.x : from.x) * aspect;
  const roomY = dy >= 0 ? 1 - from.y : from.y;
  const side = Math.min(Math.max(Math.abs(dx) * aspect, Math.abs(dy)), roomX, roomY);
  return {
    x: from.x + (Math.sign(dx) || 1) * (side / aspect),
    y: from.y + (Math.sign(dy) || 1) * side,
  };
}

export function moveLineEnd(line: LineAnnotation, handle: LineHandle, point: Point): LineAnnotation {
  return handle === 'start'
    ? { ...line, x1: point.x, y1: point.y }
    : { ...line, x2: point.x, y2: point.y };
}

/** True for shapes so small they were almost certainly an accidental click. */
export function isTooSmall(annotation: Annotation, aspect: number): boolean {
  const width = refWidth(aspect);
  switch (annotation.type) {
    case 'line':
    case 'arrow':
      return (
        Math.hypot((annotation.x2 - annotation.x1) * width, (annotation.y2 - annotation.y1) * REF_HEIGHT) <
        MIN_SHAPE_SIZE
      );
    case 'rect':
    case 'ellipse': {
      const w = annotation.w * width;
      const h = annotation.h * REF_HEIGHT;
      return Math.min(w, h) < 3 || Math.max(w, h) < MIN_SHAPE_SIZE;
    }
    case 'path':
      return annotation.points.length < 2;
    case 'text':
      return annotation.text.trim().length === 0;
  }
}
