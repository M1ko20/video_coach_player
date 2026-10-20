import type { StrokeStyle, Tool } from './types';

/** Height of the overlay's coordinate space. One unit = 1/1000 of the video height. */
export const REF_HEIGHT = 1000;

export interface ColorOption {
  value: string;
  label: string;
}

/** High-contrast colors chosen to stay readable over grass, courts and ice. */
export const COLORS: readonly ColorOption[] = [
  { value: '#ffd60a', label: 'Yellow' },
  { value: '#ff453a', label: 'Red' },
  { value: '#ff9f0a', label: 'Orange' },
  { value: '#30d158', label: 'Green' },
  { value: '#0a84ff', label: 'Blue' },
  { value: '#ff2d92', label: 'Pink' },
  { value: '#ffffff', label: 'White' },
  { value: '#14161a', label: 'Black' },
];

export const DEFAULT_COLOR = COLORS[0]!.value;

/** Stroke widths in video units, thinnest first. */
export const STROKE_WIDTHS: readonly number[] = [3, 6, 10, 15];
/** Font sizes in video units, matching the four size steps. */
export const FONT_SIZES: readonly number[] = [26, 38, 54, 76];
export const SIZE_LABELS: readonly string[] = ['Thin', 'Medium', 'Thick', 'Extra thick'];
export const TEXT_SIZE_LABELS: readonly string[] = ['Small', 'Medium', 'Large', 'Extra large'];
export const DEFAULT_SIZE_INDEX = 1;

export const STROKE_STYLES: ReadonlyArray<{ value: StrokeStyle; label: string }> = [
  { value: 'solid', label: 'Solid' },
  { value: 'dashed', label: 'Dashed' },
  { value: 'dotted', label: 'Dotted' },
];

export interface ToolOption {
  tool: Tool;
  label: string;
  shortcut: string;
}

export const TOOLS: readonly ToolOption[] = [
  { tool: 'select', label: 'Select and move', shortcut: 'V' },
  { tool: 'path', label: 'Freehand', shortcut: 'P' },
  { tool: 'line', label: 'Line', shortcut: 'L' },
  { tool: 'arrow', label: 'Arrow', shortcut: 'A' },
  { tool: 'ellipse', label: 'Circle', shortcut: 'C' },
  { tool: 'rect', label: 'Rectangle', shortcut: 'R' },
  { tool: 'text', label: 'Text', shortcut: 'T' },
];

/** Shapes smaller than this (video units) are treated as accidental clicks. */
export const MIN_SHAPE_SIZE = 8;

export function closestIndex(values: readonly number[], target: number): number {
  let best = 0;
  for (let i = 1; i < values.length; i++) {
    if (Math.abs(values[i]! - target) < Math.abs(values[best]! - target)) best = i;
  }
  return best;
}
