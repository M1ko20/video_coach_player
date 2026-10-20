import { describe, expect, it } from 'vitest';
import {
  arrowGeometry,
  boundsFromPoints,
  circleFromCenter,
  clampDelta,
  constrainLine,
  constrainSquare,
  dashPattern,
  getBounds,
  isTooSmall,
  pathData,
  resizeBounds,
  resizeCircle,
  simplifyPath,
  translateAnnotation,
} from '../../src/annotations/geometry';
import { isVisibleAt, type Annotation, type PathAnnotation } from '../../src/annotations/types';

const base = { id: 'a', color: '#ffd60a', anchorTime: 0, range: null };
const ASPECT = 16 / 9;

describe('pathData', () => {
  it('draws a visible dot for a single point', () => {
    expect(pathData([0.5, 0.5], 1000, 1000)).toBe('M500 500l0.01 0');
  });

  it('smooths longer strokes through midpoints and ends on the last point', () => {
    const d = pathData([0, 0, 0.1, 0.1, 0.2, 0], 1000, 1000);
    expect(d.startsWith('M0 0Q100 100')).toBe(true);
    expect(d.endsWith('L200 0')).toBe(true);
  });
});

describe('simplifyPath', () => {
  it('removes points that lie on a straight line', () => {
    const points: number[] = [];
    for (let i = 0; i <= 100; i++) points.push(i / 100, 0.5);
    expect(simplifyPath(points, ASPECT)).toEqual([0, 0.5, 1, 0.5]);
  });

  it('keeps corners', () => {
    const simplified = simplifyPath([0, 0, 0.25, 0, 0.5, 0, 0.5, 0.25, 0.5, 0.5], ASPECT);
    expect(simplified).toEqual([0, 0, 0.5, 0, 0.5, 0.5]);
  });

  it('keeps the shape of a curve within tolerance', () => {
    const points: number[] = [];
    for (let i = 0; i <= 400; i++) {
      const t = (i / 400) * Math.PI;
      points.push(0.5 + 0.3 * Math.cos(t), 0.5 + 0.3 * Math.sin(t));
    }
    const simplified = simplifyPath(points, 1);
    expect(simplified.length).toBeLessThan(points.length / 4);
    for (let i = 0; i < simplified.length; i += 2) {
      const radius = Math.hypot(simplified[i]! - 0.5, simplified[i + 1]! - 0.5);
      expect(radius).toBeCloseTo(0.3, 5);
    }
  });
});

describe('bounds and movement', () => {
  const path: PathAnnotation = { ...base, type: 'path', points: [0.2, 0.3, 0.6, 0.1, 0.4, 0.7], strokeWidth: 5 };

  it('computes bounds for each geometry', () => {
    const bounds = getBounds(path, ASPECT);
    expect(bounds.x).toBeCloseTo(0.2);
    expect(bounds.y).toBeCloseTo(0.1);
    expect(bounds.w).toBeCloseTo(0.4);
    expect(bounds.h).toBeCloseTo(0.6);
    const arrow = getBounds({ ...base, type: 'arrow', x1: 0.8, y1: 0.2, x2: 0.3, y2: 0.6, strokeWidth: 5 }, ASPECT);
    expect(arrow.x).toBeCloseTo(0.3);
    expect(arrow.y).toBeCloseTo(0.2);
    expect(arrow.w).toBeCloseTo(0.5);
    expect(arrow.h).toBeCloseTo(0.4);
  });

  it('translates without mutating the original', () => {
    const moved = translateAnnotation(path, 0.1, -0.05);
    expect(moved.points[0]).toBeCloseTo(0.3);
    expect(moved.points[1]).toBeCloseTo(0.25);
    expect(path.points[0]).toBe(0.2);
    expect(moved).not.toBe(path);
  });

  it('keeps a moved annotation inside the frame', () => {
    const bounds = { x: 0.7, y: 0.1, w: 0.2, h: 0.2 };
    const delta = clampDelta(bounds, 0.5, -0.5);
    expect(delta.x).toBeCloseTo(0.1);
    expect(delta.y).toBeCloseTo(-0.1);
  });

  it('resizes from a handle and flips when dragged past the opposite edge', () => {
    const box = { x: 0.2, y: 0.2, w: 0.2, h: 0.2 };
    const grown = resizeBounds(box, 'se', { x: 0.6, y: 0.5 });
    expect(grown.x).toBeCloseTo(0.2);
    expect(grown.w).toBeCloseTo(0.4);
    expect(grown.h).toBeCloseTo(0.3);

    const sideOnly = resizeBounds(box, 'e', { x: 0.9, y: 0.95 });
    expect(sideOnly.h).toBeCloseTo(0.2);
    expect(sideOnly.w).toBeCloseTo(0.7);

    const flipped = resizeBounds(box, 'nw', { x: 0.7, y: 0.8 });
    expect(flipped.x).toBeCloseTo(0.4);
    expect(flipped.y).toBeCloseTo(0.4);
    expect(flipped.w).toBeCloseTo(0.3);
    expect(flipped.h).toBeCloseTo(0.4);
  });
});

describe('constraints', () => {
  it('snaps lines to 45° steps as seen on screen', () => {
    const horizontal = constrainLine({ x: 0.2, y: 0.5 }, { x: 0.6, y: 0.52 }, ASPECT);
    expect(horizontal.y).toBeCloseTo(0.5);

    const diagonal = constrainLine({ x: 0.2, y: 0.2 }, { x: 0.4, y: 0.52 }, ASPECT);
    // 45° on screen: equal horizontal and vertical travel once x is scaled by the aspect ratio.
    expect((diagonal.x - 0.2) * ASPECT).toBeCloseTo(diagonal.y - 0.2);
  });

  it('makes boxes square on screen and keeps them in the frame', () => {
    const end = constrainSquare({ x: 0.1, y: 0.1 }, { x: 0.3, y: 0.2 }, ASPECT);
    expect((end.x - 0.1) * ASPECT).toBeCloseTo(end.y - 0.1);

    const nearEdge = constrainSquare({ x: 0.5, y: 0.8 }, { x: 0.9, y: 0.85 }, ASPECT);
    expect(nearEdge.y).toBeLessThanOrEqual(1);
    expect((nearEdge.x - 0.5) * ASPECT).toBeCloseTo(nearEdge.y - 0.8);
  });

  it('builds bounds from any two corners', () => {
    const bounds = boundsFromPoints({ x: 0.6, y: 0.7 }, { x: 0.2, y: 0.1 });
    expect(bounds.x).toBeCloseTo(0.2);
    expect(bounds.y).toBeCloseTo(0.1);
    expect(bounds.w).toBeCloseTo(0.4);
    expect(bounds.h).toBeCloseTo(0.6);
  });
});

describe('circles', () => {
  const center = (b: { x: number; y: number; w: number; h: number }) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });

  it('are drawn from the centre and are round on screen, whatever the drag direction', () => {
    const circle = circleFromCenter({ x: 0.5, y: 0.5 }, { x: 0.6, y: 0.52 }, ASPECT);
    expect(circle.w * ASPECT).toBeCloseTo(circle.h);
    expect(center(circle).x).toBeCloseTo(0.5);
    expect(center(circle).y).toBeCloseTo(0.5);
    // Radius is the on-screen distance to the pointer, in video heights.
    expect(circle.h / 2).toBeCloseTo(Math.hypot(0.1 * ASPECT, 0.02));
  });

  it('stay inside the frame by moving inwards instead of shrinking', () => {
    const circle = circleFromCenter({ x: 0.98, y: 0.05 }, { x: 0.98, y: 0.25 }, ASPECT);
    expect(circle.h).toBeCloseTo(0.4);
    expect(circle.x + circle.w).toBeLessThanOrEqual(1 + 1e-9);
    expect(circle.y).toBeGreaterThanOrEqual(-1e-9);
  });

  it('resize about their centre', () => {
    const original = circleFromCenter({ x: 0.4, y: 0.5 }, { x: 0.4, y: 0.6 }, ASPECT);
    const resized = resizeCircle(original, { x: 0.4, y: 0.75 }, ASPECT);
    expect(center(resized).x).toBeCloseTo(0.4);
    expect(center(resized).y).toBeCloseTo(0.5);
    expect(resized.h).toBeCloseTo(0.5);
    expect(resized.w * ASPECT).toBeCloseTo(resized.h);
  });
});

describe('dashPattern', () => {
  it('is solid by default and for drawings saved before line styles existed', () => {
    expect(dashPattern(undefined, 6)).toBeNull();
    expect(dashPattern('solid', 6)).toBeNull();
  });

  it('scales dashes and dots with the stroke width', () => {
    expect(dashPattern('dashed', 10)).toEqual([30, 22]);
    expect(dashPattern('dotted', 10)).toEqual([0, 20]);
  });
});

describe('isTooSmall', () => {
  it('rejects accidental clicks but keeps deliberate shapes', () => {
    const tiny: Annotation = { ...base, type: 'line', x1: 0.5, y1: 0.5, x2: 0.501, y2: 0.5, strokeWidth: 5 };
    const real: Annotation = { ...base, type: 'line', x1: 0.5, y1: 0.5, x2: 0.56, y2: 0.5, strokeWidth: 5 };
    expect(isTooSmall(tiny, ASPECT)).toBe(true);
    expect(isTooSmall(real, ASPECT)).toBe(false);
    expect(isTooSmall({ ...base, type: 'rect', x: 0.1, y: 0.1, w: 0.2, h: 0.0001, strokeWidth: 5 }, ASPECT)).toBe(true);
    expect(isTooSmall({ ...base, type: 'text', x: 0, y: 0, text: '   ', fontSize: 40 }, ASPECT)).toBe(true);
  });
});

describe('arrowGeometry', () => {
  it('puts the tip of the head on the end point', () => {
    const arrow = arrowGeometry(0, 0, 200, 0, 5);
    expect(arrow.head.startsWith('200,0')).toBe(true);
    expect(arrow.shaftEnd.x).toBeLessThan(200);
  });

  it('copes with a zero-length arrow', () => {
    expect(arrowGeometry(10, 10, 10, 10, 5).head).toBe('');
  });
});

describe('isVisibleAt', () => {
  const shape: Annotation = { ...base, type: 'rect', x: 0, y: 0, w: 0.1, h: 0.1, strokeWidth: 5 };

  it('shows annotations without a range for the whole video', () => {
    expect(isVisibleAt(shape, 0)).toBe(true);
    expect(isVisibleAt(shape, 9999)).toBe(true);
  });

  it('respects a time range when one is set', () => {
    const ranged = { ...shape, range: { start: 2, end: 5 } };
    expect(isVisibleAt(ranged, 1.99)).toBe(false);
    expect(isVisibleAt(ranged, 2)).toBe(true);
    expect(isVisibleAt(ranged, 4.99)).toBe(true);
    expect(isVisibleAt(ranged, 5)).toBe(false);
  });
});
