import { useRef } from 'react';
import { useAnnotationStore } from './annotationStore';
import { REF_HEIGHT } from './constants';
import { refWidth } from './geometry';
import { useInteractionStore } from './interactionStore';
import { SelectionLayer } from './SelectionLayer';
import { ShapeView } from './ShapeView';
import { useToolStore } from './toolStore';
import { useOverlayPointer } from './useOverlayPointer';

interface AnnotationOverlayProps {
  /** Width / height of the video. */
  aspect: number;
  /** CSS pixels per overlay unit at the current display size. */
  scale: number;
}

/** Committed annotations. Re-renders only when the list or the hidden item changes. */
function CommittedLayer({ width }: { width: number }) {
  const items = useAnnotationStore((state) => state.items);
  const hiddenId = useInteractionStore((state) => state.hiddenId);
  return (
    <g>
      {items.map((annotation) =>
        annotation.id === hiddenId ? null : <ShapeView key={annotation.id} annotation={annotation} width={width} />,
      )}
    </g>
  );
}

/** The single shape being drawn or dragged. The only thing that re-renders during a gesture. */
function DraftLayer({ width }: { width: number }) {
  const draft = useInteractionStore((state) => state.draft);
  return <g className="overlay__draft">{draft && <ShapeView annotation={draft} width={width} />}</g>;
}

/**
 * The drawing layer. It is an SVG stretched exactly over the video, whose
 * viewBox is a fixed, video-relative coordinate space. Resizing the video only
 * scales the SVG: annotation data and the rendered shapes are left untouched,
 * so drawings cannot drift or be lost when the layout changes.
 */
export function AnnotationOverlay({ aspect, scale }: AnnotationOverlayProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const tool = useToolStore((state) => state.tool);
  const handlers = useOverlayPointer(svgRef, aspect);
  const width = refWidth(aspect);

  return (
    <svg
      ref={svgRef}
      className="overlay"
      data-tool={tool}
      data-testid="annotation-overlay"
      viewBox={`0 0 ${width} ${REF_HEIGHT}`}
      preserveAspectRatio="none"
      role="img"
      aria-label="Drawings over the video"
      {...handlers}
    >
      <CommittedLayer width={width} />
      <DraftLayer width={width} />
      <SelectionLayer width={width} aspect={aspect} scale={scale} />
    </svg>
  );
}
