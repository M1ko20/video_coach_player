import { REF_HEIGHT } from '../annotations/constants';
import { arrowGeometry, dashPattern, pathData } from '../annotations/geometry';
import { haloFor } from '../annotations/halo';
import type { Annotation } from '../annotations/types';
import { TEXT_FONT_FAMILY, TEXT_FONT_WEIGHT, measureTextBlock } from '../lib/textMetrics';

/**
 * Canvas version of `ShapeView`, used to burn drawings into a recording. It
 * draws in overlay units — the caller scales the context so that REF_HEIGHT
 * units span the canvas height — and mirrors the SVG's halo, ink and dash
 * choices so a recording looks like the screen.
 */
export function drawAnnotation(ctx: CanvasRenderingContext2D, a: Annotation, W: number) {
  const H = REF_HEIGHT;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (a.type === 'text') {
    const metrics = measureTextBlock(a.text, a.fontSize);
    ctx.font = `${TEXT_FONT_WEIGHT} ${a.fontSize}px ${TEXT_FONT_FAMILY}`;
    ctx.textBaseline = 'alphabetic';
    ctx.lineWidth = a.fontSize * 0.1;
    ctx.strokeStyle = haloFor(a.color, 0.8);
    ctx.fillStyle = a.color;
    metrics.lines.forEach((line, index) => {
      const x = a.x * W;
      const y = a.y * H + metrics.baseline + index * metrics.lineHeight;
      // The SVG paints the stroke first (paint-order: stroke), so the fill stays crisp.
      ctx.strokeText(line, x, y);
      ctx.fillText(line, x, y);
    });
    ctx.restore();
    return;
  }

  const shape = new Path2D();
  let head: Path2D | null = null;

  if (a.type === 'path') {
    shape.addPath(new Path2D(pathData(a.points, W, H)));
  } else if (a.type === 'line' || a.type === 'arrow') {
    const x1 = a.x1 * W;
    const y1 = a.y1 * H;
    const x2 = a.x2 * W;
    const y2 = a.y2 * H;
    const arrow = a.type === 'arrow' ? arrowGeometry(x1, y1, x2, y2, a.strokeWidth) : null;
    shape.moveTo(x1, y1);
    shape.lineTo(arrow ? arrow.shaftEnd.x : x2, arrow ? arrow.shaftEnd.y : y2);
    if (arrow && arrow.headPoints.length > 0) {
      head = new Path2D();
      arrow.headPoints.forEach(({ x, y }, index) => (index === 0 ? head!.moveTo(x, y) : head!.lineTo(x, y)));
      head.closePath();
    }
  } else if (a.type === 'rect') {
    shape.rect(a.x * W, a.y * H, a.w * W, a.h * H);
  } else {
    shape.ellipse((a.x + a.w / 2) * W, (a.y + a.h / 2) * H, (a.w / 2) * W, (a.h / 2) * H, 0, 0, Math.PI * 2);
  }

  const dash = dashPattern(a.dash, a.strokeWidth) ?? [];
  const halo = haloFor(a.color, 0.45);

  ctx.setLineDash(dash);
  ctx.strokeStyle = halo;
  ctx.lineWidth = a.strokeWidth + 3;
  ctx.stroke(shape);
  ctx.strokeStyle = a.color;
  ctx.lineWidth = a.strokeWidth;
  ctx.stroke(shape);

  if (head) {
    ctx.setLineDash([]);
    ctx.strokeStyle = halo;
    ctx.lineWidth = 3;
    ctx.stroke(head);
    ctx.fillStyle = a.color;
    ctx.strokeStyle = a.color;
    ctx.lineWidth = 1.5;
    ctx.fill(head);
    ctx.stroke(head);
  }
  ctx.restore();
}
