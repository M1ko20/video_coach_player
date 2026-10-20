import {
  BrushCleaning,
  Circle,
  MousePointer2,
  MoveUpRight,
  Pencil,
  Redo2,
  Slash,
  Square,
  Trash2,
  Type,
  Undo2,
  type LucideIcon,
} from 'lucide-react';
import { useState } from 'react';
import { ConfirmDialog } from '../ui/Dialog';
import { IconButton } from '../ui/IconButton';
import { useAnnotationStore } from './annotationStore';
import { clearAll, deleteSelected, redo, selectTool, undo } from './commands';
import { TOOLS } from './constants';
import { useToolStore } from './toolStore';
import type { Tool } from './types';

const TOOL_ICONS: Record<Tool, LucideIcon> = {
  select: MousePointer2,
  path: Pencil,
  line: Slash,
  arrow: MoveUpRight,
  ellipse: Circle,
  rect: Square,
  text: Type,
};

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = isMac ? '⌘' : 'Ctrl+';

interface ToolRailProps {
  /** Where tooltips open, depending on whether the rail is vertical or horizontal. */
  tooltipSide: 'right' | 'top';
  disabled?: boolean;
}

/** Drawing tools, history and delete actions. */
export function ToolRail({ tooltipSide, disabled = false }: ToolRailProps) {
  const tool = useToolStore((state) => state.tool);
  const canUndo = useAnnotationStore((state) => state.past.length > 0);
  const canRedo = useAnnotationStore((state) => state.future.length > 0);
  const hasSelection = useAnnotationStore((state) => state.selectedId !== null);
  const count = useAnnotationStore((state) => state.items.length);
  const [confirmingClear, setConfirmingClear] = useState(false);

  return (
    <nav className="rail" aria-label="Drawing tools">
      <div className="rail__group" role="group" aria-label="Tools">
        {TOOLS.map(({ tool: id, label, shortcut }) => {
          const Icon = TOOL_ICONS[id];
          return (
            <IconButton
              key={id}
              label={label}
              shortcut={shortcut}
              tooltipSide={tooltipSide}
              active={tool === id}
              disabled={disabled}
              data-tool-button={id}
              onClick={() => selectTool(id)}
            >
              <Icon size={18} strokeWidth={2} />
            </IconButton>
          );
        })}
      </div>

      <div className="rail__separator" />

      <div className="rail__group" role="group" aria-label="History">
        <IconButton
          label="Undo"
          shortcut={`${MOD}Z`}
          tooltipSide={tooltipSide}
          disabled={disabled || !canUndo}
          onClick={undo}
        >
          <Undo2 size={18} />
        </IconButton>
        <IconButton
          label="Redo"
          shortcut={isMac ? '⇧⌘Z' : 'Ctrl+Y'}
          tooltipSide={tooltipSide}
          disabled={disabled || !canRedo}
          onClick={redo}
        >
          <Redo2 size={18} />
        </IconButton>
      </div>

      <div className="rail__spacer" />

      <div className="rail__group" role="group" aria-label="Delete">
        <IconButton
          label="Delete selected drawing"
          shortcut="Del"
          tooltipSide={tooltipSide}
          variant="danger"
          disabled={disabled || !hasSelection}
          onClick={deleteSelected}
        >
          <Trash2 size={18} />
        </IconButton>
        <IconButton
          label="Clear all drawings…"
          tooltipSide={tooltipSide}
          variant="danger"
          disabled={disabled || count === 0}
          onClick={() => setConfirmingClear(true)}
        >
          <BrushCleaning size={18} />
        </IconButton>
      </div>

      <ConfirmDialog
        open={confirmingClear}
        title="Clear all drawings?"
        message={
          <>
            This removes {count === 1 ? 'the drawing' : `all ${count} drawings`} from this analysis. You can bring them
            back with Undo until you close the analysis.
          </>
        }
        confirmLabel="Clear all"
        danger
        onCancel={() => setConfirmingClear(false)}
        onConfirm={() => {
          clearAll();
          setConfirmingClear(false);
        }}
      />
    </nav>
  );
}
