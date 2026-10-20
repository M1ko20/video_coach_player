import { useAnnotationStore } from './annotationStore';
import { REF_HEIGHT } from './constants';
import { getBounds } from './geometry';
import { useInteractionStore } from './interactionStore';
import type { Annotation, BoxHandle, HandleId } from './types';

interface SelectionLayerProps {
  width: number;
  aspect: number;
  /** CSS pixels per overlay unit, used to keep handles a constant size on screen. */
  scale: number;
}

interface Handle {
  id: HandleId;
  x: number;
  y: number;
  cursor: string;
}

const BOX_HANDLES: ReadonlyArray<{ id: BoxHandle; fx: number; fy: number; cursor: string }> = [
  { id: 'nw', fx: 0, fy: 0, cursor: 'nwse-resize' },
  { id: 'n', fx: 0.5, fy: 0, cursor: 'ns-resize' },
  { id: 'ne', fx: 1, fy: 0, cursor: 'nesw-resize' },
  { id: 'e', fx: 1, fy: 0.5, cursor: 'ew-resize' },
  { id: 'se', fx: 1, fy: 1, cursor: 'nwse-resize' },
  { id: 's', fx: 0.5, fy: 1, cursor: 'ns-resize' },
  { id: 'sw', fx: 0, fy: 1, cursor: 'nesw-resize' },
  { id: 'w', fx: 0, fy: 0.5, cursor: 'ew-resize' },
];

const HANDLE_SIZE = 9;
const HANDLE_HIT_RADIUS = 12;
const OUTLINE_PADDING = 6;

function handlesFor(annotation: Annotation, W: number, H: number): Handle[] {
  switch (annotation.type) {
    case 'line':
    case 'arrow':
      return [
        { id: 'start', x: annotation.x1 * W, y: annotation.y1 * H, cursor: 'move' },
        { id: 'end', x: annotation.x2 * W, y: annotation.y2 * H, cursor: 'move' },
      ];
    case 'rect':
    case 'ellipse':
      return BOX_HANDLES.map(({ id, fx, fy, cursor }) => ({
        id,
        x: (annotation.x + annotation.w * fx) * W,
        y: (annotation.y + annotation.h * fy) * H,
        cursor,
      }));
    default:
      // Freehand strokes and text are moved as a whole; they have no handles.
      return [];
  }
}

/** Outline and resize handles for the selected annotation. */
export function SelectionLayer({ width: W, aspect, scale }: SelectionLayerProps) {
  const selected = useAnnotationStore((state) =>
    state.selectedId === null ? null : (state.items.find((item) => item.id === state.selectedId) ?? null),
  );
  // While the selected annotation is being dragged, follow the live preview.
  const draft = useInteractionStore((state) => (state.draft && state.draft.id === selected?.id ? state.draft : null));

  const annotation = draft ?? selected;
  if (!annotation || scale <= 0) return null;

  const H = REF_HEIGHT;
  const px = 1 / scale;
  const isLine = annotation.type === 'line' || annotation.type === 'arrow';
  const bounds = getBounds(annotation, aspect);
  const pad =
    annotation.type === 'path'
      ? annotation.strokeWidth / 2 + OUTLINE_PADDING * px
      : annotation.type === 'text'
        ? OUTLINE_PADDING * px
        : 0;
  const handles = handlesFor(annotation, W, H);
  const half = (HANDLE_SIZE * px) / 2;

  return (
    <g className="selection" data-selection={annotation.id}>
      {!isLine && (
        <>
          <rect
            className="selection__outline selection__outline--under"
            x={bounds.x * W - pad}
            y={bounds.y * H - pad}
            width={bounds.w * W + pad * 2}
            height={bounds.h * H + pad * 2}
          />
          <rect
            className="selection__outline"
            x={bounds.x * W - pad}
            y={bounds.y * H - pad}
            width={bounds.w * W + pad * 2}
            height={bounds.h * H + pad * 2}
          />
        </>
      )}
      {handles.map((handle) => (
        <g key={handle.id}>
          {isLine ? (
            <circle className="selection__handle" cx={handle.x} cy={handle.y} r={half * 1.15} />
          ) : (
            <rect
              className="selection__handle"
              x={handle.x - half}
              y={handle.y - half}
              width={half * 2}
              height={half * 2}
              rx={px * 1.5}
            />
          )}
          <circle
            className="selection__handle-hit"
            data-handle={handle.id}
            cx={handle.x}
            cy={handle.y}
            r={HANDLE_HIT_RADIUS * px}
            style={{ cursor: handle.cursor }}
          />
        </g>
      ))}
    </g>
  );
}
