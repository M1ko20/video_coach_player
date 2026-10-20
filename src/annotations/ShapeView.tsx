import { memo } from 'react';
import { TEXT_FONT_FAMILY, TEXT_FONT_WEIGHT, measureTextBlock } from '../lib/textMetrics';
import { REF_HEIGHT } from './constants';
import { arrowGeometry, dashPattern, pathData } from './geometry';
import { haloFor } from './halo';
import type { Annotation } from './types';

interface ShapeViewProps {
  annotation: Annotation;
  /** Width of the overlay's coordinate space. */
  width: number;
}

/** Extra width of the invisible stroke that makes thin shapes easy to click. */
const HIT_PADDING = 18;

/**
 * Renders one annotation in overlay units. Memoised on the annotation object:
 * annotations are immutable, so an unchanged shape is never re-rendered.
 */
export const ShapeView = memo(function ShapeView({ annotation: a, width: W }: ShapeViewProps) {
  const H = REF_HEIGHT;

  if (a.type === 'text') {
    const metrics = measureTextBlock(a.text, a.fontSize);
    const x = a.x * W;
    const y = a.y * H;
    const pad = a.fontSize * 0.15;
    return (
      <g data-id={a.id} className="shape">
        <rect
          className="shape__hit shape__hit--area"
          x={x - pad}
          y={y - pad}
          width={metrics.width + pad * 2}
          height={metrics.height + pad * 2}
        />
        <text
          className="shape__text"
          fontSize={a.fontSize}
          fill={a.color}
          stroke={haloFor(a.color, 0.8)}
          strokeWidth={a.fontSize * 0.1}
          style={{ fontFamily: TEXT_FONT_FAMILY, fontWeight: TEXT_FONT_WEIGHT }}
        >
          {metrics.lines.map((line, index) => (
            <tspan key={index} x={x} y={y + metrics.baseline + index * metrics.lineHeight}>
              {line}
            </tspan>
          ))}
        </text>
      </g>
    );
  }

  const halo = haloFor(a.color, 0.45);
  const haloWidth = a.strokeWidth + 3;
  const hitWidth = a.strokeWidth + HIT_PADDING;
  // The halo shares the ink's pattern so every dash keeps its outline. The hit
  // stroke stays solid: the gaps should still be clickable.
  const dash = dashPattern(a.dash, a.strokeWidth)?.join(' ');

  if (a.type === 'path') {
    const d = pathData(a.points, W, H);
    return (
      <g data-id={a.id} className="shape">
        <path className="shape__halo" d={d} stroke={halo} strokeWidth={haloWidth} strokeDasharray={dash} />
        <path className="shape__ink" d={d} stroke={a.color} strokeWidth={a.strokeWidth} strokeDasharray={dash} />
        <path className="shape__hit" d={d} strokeWidth={hitWidth} />
      </g>
    );
  }

  if (a.type === 'line' || a.type === 'arrow') {
    const x1 = a.x1 * W;
    const y1 = a.y1 * H;
    const x2 = a.x2 * W;
    const y2 = a.y2 * H;
    const arrow = a.type === 'arrow' ? arrowGeometry(x1, y1, x2, y2, a.strokeWidth) : null;
    const endX = arrow ? arrow.shaftEnd.x : x2;
    const endY = arrow ? arrow.shaftEnd.y : y2;
    return (
      <g data-id={a.id} className="shape">
        <line
          className="shape__halo"
          x1={x1}
          y1={y1}
          x2={endX}
          y2={endY}
          stroke={halo}
          strokeWidth={haloWidth}
          strokeDasharray={dash}
        />
        {arrow && <polygon className="shape__halo" points={arrow.head} stroke={halo} strokeWidth={3} />}
        <line
          className="shape__ink"
          x1={x1}
          y1={y1}
          x2={endX}
          y2={endY}
          stroke={a.color}
          strokeWidth={a.strokeWidth}
          strokeDasharray={dash}
        />
        {arrow && (
          <polygon className="shape__ink" points={arrow.head} style={{ fill: a.color }} stroke={a.color} strokeWidth={1.5} />
        )}
        <line className="shape__hit" x1={x1} y1={y1} x2={x2} y2={y2} strokeWidth={hitWidth} />
      </g>
    );
  }

  if (a.type === 'rect') {
    const box = { x: a.x * W, y: a.y * H, width: a.w * W, height: a.h * H };
    return (
      <g data-id={a.id} className="shape">
        <rect className="shape__halo" {...box} stroke={halo} strokeWidth={haloWidth} strokeDasharray={dash} />
        <rect className="shape__ink" {...box} stroke={a.color} strokeWidth={a.strokeWidth} strokeDasharray={dash} />
        <rect className="shape__hit" {...box} strokeWidth={hitWidth} />
      </g>
    );
  }

  const ellipse = {
    cx: (a.x + a.w / 2) * W,
    cy: (a.y + a.h / 2) * H,
    rx: (a.w / 2) * W,
    ry: (a.h / 2) * H,
  };
  return (
    <g data-id={a.id} className="shape">
      <ellipse className="shape__halo" {...ellipse} stroke={halo} strokeWidth={haloWidth} strokeDasharray={dash} />
      <ellipse className="shape__ink" {...ellipse} stroke={a.color} strokeWidth={a.strokeWidth} strokeDasharray={dash} />
      <ellipse className="shape__hit" {...ellipse} strokeWidth={hitWidth} />
    </g>
  );
});
