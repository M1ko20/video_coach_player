import { create } from 'zustand';
import { COLORS, DEFAULT_COLOR, DEFAULT_SIZE_INDEX, STROKE_WIDTHS, TOOLS } from './constants';
import type { Tool } from './types';

const STORAGE_KEY = 'cva:tool-settings';

interface ToolSettings {
  tool: Tool;
  color: string;
  sizeIndex: number;
}

interface ToolState extends ToolSettings {
  setTool: (tool: Tool) => void;
  setColor: (color: string) => void;
  setSizeIndex: (index: number) => void;
}

/** Tool preferences are a convenience, so a failed read or write is ignored. */
function readSettings(): ToolSettings {
  const defaults: ToolSettings = { tool: 'select', color: DEFAULT_COLOR, sizeIndex: DEFAULT_SIZE_INDEX };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults;
    const saved = JSON.parse(raw) as Partial<ToolSettings>;
    return {
      tool: TOOLS.some((option) => option.tool === saved.tool) ? saved.tool! : defaults.tool,
      color: COLORS.some((option) => option.value === saved.color) ? saved.color! : defaults.color,
      sizeIndex:
        Number.isInteger(saved.sizeIndex) && saved.sizeIndex! >= 0 && saved.sizeIndex! < STROKE_WIDTHS.length
          ? saved.sizeIndex!
          : defaults.sizeIndex,
    };
  } catch {
    return defaults;
  }
}

function writeSettings({ tool, color, sizeIndex }: ToolSettings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ tool, color, sizeIndex }));
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
    setColor: (color) => update({ color }),
    setSizeIndex: (sizeIndex) => update({ sizeIndex }),
  };
});
