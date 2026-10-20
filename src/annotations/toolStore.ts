import { create } from 'zustand';
import { COLORS, DEFAULT_COLOR, DEFAULT_SIZE_INDEX, STROKE_STYLES, STROKE_WIDTHS, TOOLS } from './constants';
import type { StrokeStyle, Tool } from './types';

const STORAGE_KEY = 'cva:tool-settings';

/** The tools that create drawings, and so have a style of their own. */
export type StyledTool = Exclude<Tool, 'select'>;

export interface ToolStyle {
  color: string;
  sizeIndex: number;
  dash: StrokeStyle;
}

interface ToolSettings {
  tool: Tool;
  /**
   * Each drawing tool keeps its own style: picking red for arrows does not
   * make the next circle red.
   */
  styles: Record<StyledTool, ToolStyle>;
}

interface ToolState extends ToolSettings {
  setTool: (tool: Tool) => void;
  /** Changes part of one tool's style. */
  setStyle: (tool: StyledTool, patch: Partial<ToolStyle>) => void;
}

const STYLED_TOOLS = TOOLS.map((option) => option.tool).filter((tool): tool is StyledTool => tool !== 'select');
const DEFAULT_STYLE: ToolStyle = { color: DEFAULT_COLOR, sizeIndex: DEFAULT_SIZE_INDEX, dash: 'solid' };

function validStyle(saved: Partial<ToolStyle> | undefined, fallback: ToolStyle): ToolStyle {
  return {
    color: COLORS.some((option) => option.value === saved?.color) ? saved!.color! : fallback.color,
    sizeIndex:
      Number.isInteger(saved?.sizeIndex) && saved!.sizeIndex! >= 0 && saved!.sizeIndex! < STROKE_WIDTHS.length
        ? saved!.sizeIndex!
        : fallback.sizeIndex,
    dash: STROKE_STYLES.some((option) => option.value === saved?.dash) ? saved!.dash! : fallback.dash,
  };
}

/** Tool preferences are a convenience, so a failed read or write is ignored. */
function readSettings(): ToolSettings {
  const styles = Object.fromEntries(STYLED_TOOLS.map((tool) => [tool, DEFAULT_STYLE])) as Record<StyledTool, ToolStyle>;
  const defaults: ToolSettings = { tool: 'select', styles };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults;
    const saved = JSON.parse(raw) as Partial<ToolSettings> & Partial<ToolStyle>;
    // Settings saved before each tool had its own style hold one shared style; every tool starts from it.
    const shared = validStyle(saved, DEFAULT_STYLE);
    return {
      tool: TOOLS.some((option) => option.tool === saved.tool) ? saved.tool! : defaults.tool,
      styles: Object.fromEntries(
        STYLED_TOOLS.map((tool) => [tool, validStyle(saved.styles?.[tool], shared)]),
      ) as Record<StyledTool, ToolStyle>,
    };
  } catch {
    return defaults;
  }
}

function writeSettings({ tool, styles }: ToolSettings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ tool, styles }));
  } catch {
    // Storage unavailable (private mode, quota): keep working with in-memory settings.
  }
}

export const useToolStore = create<ToolState>((set, get) => {
  const update = (patch: Partial<ToolSettings>) => {
    set(patch);
    writeSettings(get());
  };
  return {
    ...readSettings(),
    setTool: (tool) => update({ tool }),
    setStyle: (tool, patch) => {
      const { styles } = get();
      update({ styles: { ...styles, [tool]: { ...styles[tool], ...patch } } });
    },
  };
});
