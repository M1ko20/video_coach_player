/**
 * Text measurement shared by the SVG renderer, the selection outline and the
 * inline editor, so that all three agree on where a text block sits.
 */

export const TEXT_FONT_FAMILY =
  'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
export const TEXT_FONT_WEIGHT = 600;
export const TEXT_LINE_HEIGHT = 1.25;

export interface TextBlockMetrics {
  /** Width of the widest line. */
  width: number;
  /** Total height of all lines. */
  height: number;
  /** Distance from the top of a line box to its baseline. */
  baseline: number;
  lineHeight: number;
  lines: string[];
}

let context: CanvasRenderingContext2D | null | undefined;

function getContext(): CanvasRenderingContext2D | null {
  if (context === undefined) {
    context = typeof document === 'undefined' ? null : document.createElement('canvas').getContext('2d');
  }
  return context;
}

/** Measures a text block. Input and output share one unit (the font size's). */
export function measureTextBlock(text: string, fontSize: number): TextBlockMetrics {
  const lines = text.split('\n');
  const lineHeight = fontSize * TEXT_LINE_HEIGHT;
  const ctx = getContext();

  let width = 0;
  let ascent = fontSize * 0.93;
  let descent = fontSize * 0.24;

  if (ctx) {
    ctx.font = `${TEXT_FONT_WEIGHT} ${fontSize}px ${TEXT_FONT_FAMILY}`;
    for (const line of lines) width = Math.max(width, ctx.measureText(line).width);
    const sample = ctx.measureText('Hg');
    if (sample.fontBoundingBoxAscent > 0) {
      ascent = sample.fontBoundingBoxAscent;
      descent = sample.fontBoundingBoxDescent;
    }
  } else {
    // No canvas (tests, server): a rough average glyph width is good enough.
    for (const line of lines) width = Math.max(width, line.length * fontSize * 0.56);
  }

  // CSS centres the font's content area inside the line box; mirror that so
  // SVG text lands exactly where the editor showed it.
  const baseline = (lineHeight - (ascent + descent)) / 2 + ascent;

  return { width, height: lineHeight * lines.length, baseline, lineHeight, lines };
}
