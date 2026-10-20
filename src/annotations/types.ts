/**
 * Annotation data model.
 *
 * Geometry is stored in normalized video coordinates: (0, 0) is the top-left
 * corner of the video frame and (1, 1) the bottom-right. Nothing here depends
 * on how large the video is drawn on screen, so drawings cannot drift when the
 * layout changes.
 *
 * Sizes that must stay visually proportional (stroke width, font size) are
 * stored in "video units": thousandths of the video height.
 */

export interface Point {
  x: number;
  y: number;
}

export interface Bounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TimeRange {
  /** Seconds from the start of the video, inclusive. */
  start: number;
  /** Seconds from the start of the video, exclusive. */
  end: number;
}

interface AnnotationBase {
  id: string;
  color: string;
  /** Playhead position (seconds) when the annotation was created. */
  anchorTime: number;
  /**
   * When the annotation is shown. `null` means the whole video, which is what
   * the app creates today. See `isVisibleAt`.
   */
  range: TimeRange | null;
}

export interface PathAnnotation extends AnnotationBase {
  type: 'path';
  /** Flat list of normalized coordinates: x0, y0, x1, y1, … */
  points: number[];
  strokeWidth: number;
}

interface SegmentGeometry extends AnnotationBase {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  strokeWidth: number;
}

interface BoxGeometry extends AnnotationBase {
  x: number;
  y: number;
  w: number;
  h: number;
  strokeWidth: number;
}

// Each shape has its own literal `type` so the union narrows cleanly.
export interface StraightLineAnnotation extends SegmentGeometry {
  type: 'line';
}
export interface ArrowAnnotation extends SegmentGeometry {
  type: 'arrow';
}
export interface RectAnnotation extends BoxGeometry {
  type: 'rect';
}
export interface EllipseAnnotation extends BoxGeometry {
  type: 'ellipse';
}

/** Lines and arrows share the same geometry: two end points. */
export type LineAnnotation = StraightLineAnnotation | ArrowAnnotation;
/** Rectangles and ellipses share the same geometry: a bounding box. */
export type BoxAnnotation = RectAnnotation | EllipseAnnotation;

export interface TextAnnotation extends AnnotationBase {
  type: 'text';
  /** Top-left corner of the text block. */
  x: number;
  y: number;
  text: string;
  fontSize: number;
}

export type Annotation = PathAnnotation | LineAnnotation | BoxAnnotation | TextAnnotation;
export type AnnotationType = Annotation['type'];

export type Tool = 'select' | AnnotationType;
export type DrawTool = Exclude<Tool, 'select' | 'text'>;

export type BoxHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
export type LineHandle = 'start' | 'end';
export type HandleId = BoxHandle | LineHandle;

/** Whether an annotation should be drawn at a given playhead position. */
export function isVisibleAt(annotation: Annotation, time: number): boolean {
  const { range } = annotation;
  return range === null || (time >= range.start && time < range.end);
}
