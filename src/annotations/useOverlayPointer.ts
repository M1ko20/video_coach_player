import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import { createId } from '../lib/id';
import { player } from '../video/player';
import { useAnnotationStore } from './annotationStore';
import { beginText, commitTextEdit, editText } from './commands';
import { STROKE_WIDTHS } from './constants';
import {
  boundsFromPoints,
  clamp01,
  clampDelta,
  constrainLine,
  constrainSquare,
  getBounds,
  isTooSmall,
  moveLineEnd,
  resizeBounds,
  simplifyPath,
  translateAnnotation,
} from './geometry';
import { useInteractionStore } from './interactionStore';
import { useToolStore } from './toolStore';
import type { Annotation, Bounds, BoxAnnotation, BoxHandle, DrawTool, HandleId, LineAnnotation, LineHandle, Point } from './types';

/** Pointer travel (CSS px) before a press on an annotation becomes a move. */
const MOVE_THRESHOLD = 3;
/** Minimum spacing (CSS px) between recorded freehand samples. */
const PATH_SAMPLE_SPACING = 1.5;

interface GestureBase {
  pointerId: number;
  /** Overlay position on screen, read once at the start of the gesture. */
  rect: DOMRect;
  current: Point;
  shiftKey: boolean;
}

interface DrawGesture extends GestureBase {
  kind: 'draw';
  tool: DrawTool;
  start: Point;
  id: string;
  color: string;
  strokeWidth: number;
  anchorTime: number;
  /** Freehand samples, appended in place while the pointer moves. */
  points: number[];
  lastSample: { x: number; y: number };
}

interface MoveGesture extends GestureBase {
  kind: 'move';
  original: Annotation;
  bounds: Bounds;
  start: Point;
  startClient: { x: number; y: number };
  moved: boolean;
}

interface ResizeGesture extends GestureBase {
  kind: 'resize';
  original: LineAnnotation | BoxAnnotation;
  handle: HandleId;
  moved: boolean;
}

type Gesture = DrawGesture | MoveGesture | ResizeGesture;

function toPoint(clientX: number, clientY: number, rect: DOMRect): Point {
  return {
    x: rect.width > 0 ? clamp01((clientX - rect.left) / rect.width) : 0,
    y: rect.height > 0 ? clamp01((clientY - rect.top) / rect.height) : 0,
  };
}

/** The annotation a gesture would produce if it ended now. */
function resolve(gesture: Gesture, aspect: number): Annotation {
  const { current, shiftKey } = gesture;

  if (gesture.kind === 'move') {
    const delta = clampDelta(gesture.bounds, current.x - gesture.start.x, current.y - gesture.start.y);
    return translateAnnotation(gesture.original, delta.x, delta.y);
  }

  if (gesture.kind === 'resize') {
    const { original, handle } = gesture;
    if (original.type === 'line' || original.type === 'arrow') {
      const fixed: Point =
        handle === 'start' ? { x: original.x2, y: original.y2 } : { x: original.x1, y: original.y1 };
      const point = shiftKey ? constrainLine(fixed, current, aspect) : current;
      return moveLineEnd(original, handle as LineHandle, point);
    }
    return { ...original, ...resizeBounds(original, handle as BoxHandle, current) };
  }

  const base = { id: gesture.id, color: gesture.color, anchorTime: gesture.anchorTime, range: null };
  const { start, strokeWidth } = gesture;
  switch (gesture.tool) {
    case 'path':
      return { ...base, type: 'path', points: gesture.points, strokeWidth };
    case 'line':
    case 'arrow': {
      const end = shiftKey ? constrainLine(start, current, aspect) : current;
      return { ...base, type: gesture.tool, x1: start.x, y1: start.y, x2: end.x, y2: end.y, strokeWidth };
    }
    case 'rect':
    case 'ellipse': {
      const end = shiftKey ? constrainSquare(start, current, aspect) : current;
      return { ...base, type: gesture.tool, ...boundsFromPoints(start, end), strokeWidth };
    }
  }
}

/**
 * Pointer handling for the drawing overlay.
 *
 * While a gesture is in progress its state lives in a ref and the shape is
 * previewed through the interaction store, at most once per animation frame.
 * The annotation store — and with it undo history and autosave — is only
 * touched once, when the gesture ends.
 */
export function useOverlayPointer(svgRef: RefObject<SVGSVGElement | null>, aspect: number) {
  const gestureRef = useRef<Gesture | null>(null);
  const frameRef = useRef(0);
  const aspectRef = useRef(aspect);
  useEffect(() => {
    aspectRef.current = aspect;
  }, [aspect]);

  const preview = useCallback(() => {
    frameRef.current = 0;
    const gesture = gestureRef.current;
    if (!gesture) return;
    if (gesture.kind !== 'draw' && !gesture.moved) return;
    const hiddenId = gesture.kind === 'draw' ? null : gesture.original.id;
    useInteractionStore.getState().setDraft(resolve(gesture, aspectRef.current), hiddenId);
  }, []);

  const schedulePreview = useCallback(() => {
    if (!frameRef.current) frameRef.current = requestAnimationFrame(preview);
  }, [preview]);

  /** Finishes the gesture, committing its result or discarding it. */
  const endGesture = useCallback(
    (commit: boolean) => {
      const gesture = gestureRef.current;
      if (!gesture) return;
      gestureRef.current = null;
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;

      const svg = svgRef.current;
      if (svg?.hasPointerCapture(gesture.pointerId)) svg.releasePointerCapture(gesture.pointerId);

      const annotations = useAnnotationStore.getState();
      if (commit) {
        const currentAspect = aspectRef.current;
        let result = resolve(gesture, currentAspect);
        if (gesture.kind === 'draw') {
          if (result.type === 'path') {
            result = { ...result, points: simplifyPath(result.points, currentAspect) };
          }
          if (!isTooSmall(result, currentAspect)) annotations.add(result);
        } else if (gesture.moved && !isTooSmall(result, currentAspect)) {
          annotations.replace(result);
        }
      }
      // Cleared in the same tick as the commit, so the shape never flickers.
      useInteractionStore.getState().setDraft(null);
    },
    [svgRef],
  );

  const beginGesture = useCallback(
    (gesture: Gesture) => {
      gestureRef.current = gesture;
      svgRef.current?.setPointerCapture(gesture.pointerId);
    },
    [svgRef],
  );

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<SVGSVGElement>) => {
      const svg = svgRef.current;
      if (!svg || event.button !== 0 || !event.isPrimary || gestureRef.current) return;

      // A click outside the text being typed finishes it and does nothing else.
      if (useInteractionStore.getState().textEdit) {
        commitTextEdit();
        return;
      }
      // The overlay suppresses the browser's own focus change (see onMouseDown),
      // so a field being edited elsewhere, such as the project name, is committed here.
      const focused = document.activeElement;
      if (focused instanceof HTMLElement && focused !== document.body) focused.blur();

      const rect = svg.getBoundingClientRect();
      const point = toPoint(event.clientX, event.clientY, rect);
      const base: GestureBase = { pointerId: event.pointerId, rect, current: point, shiftKey: event.shiftKey };
      const { tool, color, sizeIndex } = useToolStore.getState();
      const annotations = useAnnotationStore.getState();

      if (tool === 'text') {
        beginText(point.x, point.y);
        return;
      }

      if (tool === 'select') {
        const target = event.target as Element;
        const handle = target.closest<SVGElement>('[data-handle]')?.dataset.handle as HandleId | undefined;
        const selected = annotations.items.find((item) => item.id === annotations.selectedId);

        if (handle && selected && selected.type !== 'path' && selected.type !== 'text') {
          beginGesture({ ...base, kind: 'resize', original: selected, handle, moved: false });
          return;
        }

        const id = target.closest<SVGElement>('[data-id]')?.dataset.id;
        const hit = id ? annotations.items.find((item) => item.id === id) : undefined;
        if (!hit) {
          annotations.select(null);
          return;
        }
        annotations.select(hit.id);
        beginGesture({
          ...base,
          kind: 'move',
          original: hit,
          bounds: getBounds(hit, aspectRef.current),
          start: point,
          startClient: { x: event.clientX, y: event.clientY },
          moved: false,
        });
        return;
      }

      // Drawing starts on a still frame: pause so the footage does not move underneath.
      player.pause();
      annotations.select(null);
      beginGesture({
        ...base,
        kind: 'draw',
        tool,
        start: point,
        id: createId(),
        color,
        strokeWidth: STROKE_WIDTHS[sizeIndex]!,
        anchorTime: player.time,
        points: [point.x, point.y],
        lastSample: { x: event.clientX, y: event.clientY },
      });
      schedulePreview();
    },
    [beginGesture, schedulePreview, svgRef],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<SVGSVGElement>) => {
      const gesture = gestureRef.current;
      if (!gesture || event.pointerId !== gesture.pointerId) return;

      gesture.current = toPoint(event.clientX, event.clientY, gesture.rect);
      gesture.shiftKey = event.shiftKey;

      if (gesture.kind === 'draw') {
        if (gesture.tool === 'path') {
          // Coalesced events carry every sample the device produced since the
          // last frame, which keeps fast strokes smooth.
          const native = event.nativeEvent;
          const samples = native.getCoalescedEvents?.() ?? [];
          for (const sample of samples.length > 0 ? samples : [native]) {
            const dx = sample.clientX - gesture.lastSample.x;
            const dy = sample.clientY - gesture.lastSample.y;
            if (dx * dx + dy * dy < PATH_SAMPLE_SPACING * PATH_SAMPLE_SPACING) continue;
            gesture.lastSample = { x: sample.clientX, y: sample.clientY };
            const point = toPoint(sample.clientX, sample.clientY, gesture.rect);
            gesture.points.push(point.x, point.y);
          }
        }
      } else if (!gesture.moved) {
        if (gesture.kind === 'resize') {
          gesture.moved = true;
        } else {
          const dx = event.clientX - gesture.startClient.x;
          const dy = event.clientY - gesture.startClient.y;
          gesture.moved = dx * dx + dy * dy >= MOVE_THRESHOLD * MOVE_THRESHOLD;
        }
      }

      schedulePreview();
    },
    [schedulePreview],
  );

  const onPointerUp = useCallback(
    (event: ReactPointerEvent<SVGSVGElement>) => {
      const gesture = gestureRef.current;
      if (!gesture || event.pointerId !== gesture.pointerId) return;
      gesture.current = toPoint(event.clientX, event.clientY, gesture.rect);
      gesture.shiftKey = event.shiftKey;
      endGesture(true);
    },
    [endGesture],
  );

  const onPointerCancel = useCallback(
    (event: ReactPointerEvent<SVGSVGElement>) => {
      if (gestureRef.current?.pointerId === event.pointerId) endGesture(false);
    },
    [endGesture],
  );

  /**
   * Pressing on the overlay must not move keyboard focus or start a text
   * selection: the text tool focuses its editor during pointerdown, and the
   * default action of the mousedown that follows would immediately blur it.
   */
  const onMouseDown = useCallback((event: React.MouseEvent<SVGSVGElement>) => {
    event.preventDefault();
  }, []);

  const onDoubleClick = useCallback((event: React.MouseEvent<SVGSVGElement>) => {
    if (useToolStore.getState().tool !== 'select') return;
    // Pointer capture during the preceding clicks retargets this event to the
    // overlay itself, so look up what is actually under the pointer.
    const under = document.elementFromPoint(event.clientX, event.clientY);
    const id = under?.closest<SVGElement>('[data-id]')?.dataset.id;
    const hit = useAnnotationStore.getState().items.find((item) => item.id === id);
    if (hit?.type === 'text') editText(hit);
  }, []);

  useEffect(() => {
    // Escape abandons the gesture in progress. Listening in the capture phase
    // keeps the global shortcut from also changing the tool or selection.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !gestureRef.current) return;
      event.stopPropagation();
      event.preventDefault();
      endGesture(false);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      // If the overlay goes away mid-gesture, drop the gesture without committing.
      endGesture(false);
    };
  }, [endGesture]);

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    onLostPointerCapture: onPointerCancel,
    onMouseDown,
    onDoubleClick,
  };
}
