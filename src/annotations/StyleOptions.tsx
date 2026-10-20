import { keepFocus } from '../ui/IconButton';
import { useAnnotationStore } from './annotationStore';
import { applyColor, applyDash, applySize } from './commands';
import {
  COLORS,
  FONT_SIZES,
  SIZE_LABELS,
  STROKE_STYLES,
  STROKE_WIDTHS,
  TEXT_SIZE_LABELS,
  TOOLS,
  closestIndex,
} from './constants';
import { dashPattern } from './geometry';
import { useInteractionStore } from './interactionStore';
import { useToolStore } from './toolStore';
import type { StrokeStyle } from './types';

/** A short sample of a stroke style, drawn the way the overlay draws it. */
function DashSample({ style }: { style: StrokeStyle }) {
  return (
    <svg width="22" height="8" viewBox="0 0 22 8" aria-hidden="true">
      <line
        x1="3"
        y1="4"
        x2="19"
        y2="4"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray={dashPattern(style, 2.5)?.join(' ')}
      />
    </svg>
  );
}

/**
 * Color, size and line style controls. They show the style of whatever they will affect:
 * the text being typed, else the selected drawing, else the active tool's own style.
 */
export function StyleOptions({ disabled = false }: { disabled?: boolean }) {
  const tool = useToolStore((state) => state.tool);
  const toolStyle = useToolStore((state) => (state.tool === 'select' ? null : state.styles[state.tool]));
  const selected = useAnnotationStore((state) =>
    state.selectedId === null ? null : (state.items.find((item) => item.id === state.selectedId) ?? null),
  );
  const textEdit = useInteractionStore((state) => state.textEdit);

  // What the controls show and change. With the Select tool and nothing
  // selected there is nothing to style, so they are disabled.
  let color: string | null = null;
  let sizeIndex = -1;
  let dash: StrokeStyle | null = null;
  let isText = tool === 'text';
  let target = 'Nothing selected';

  if (textEdit) {
    color = textEdit.color;
    sizeIndex = closestIndex(FONT_SIZES, textEdit.fontSize);
    isText = true;
    target = 'Text being typed';
  } else if (selected) {
    color = selected.color;
    isText = selected.type === 'text';
    if (selected.type !== 'text') dash = selected.dash ?? 'solid';
    sizeIndex =
      selected.type === 'text'
        ? closestIndex(FONT_SIZES, selected.fontSize)
        : closestIndex(STROKE_WIDTHS, selected.strokeWidth);
    target = 'Selected drawing';
  } else if (toolStyle) {
    ({ color, sizeIndex, dash } = toolStyle);
    target = `${TOOLS.find((option) => option.tool === tool)?.label ?? 'Tool'} tool`;
  }

  const inactive = disabled || color === null;
  const sizeLabels = isText ? TEXT_SIZE_LABELS : SIZE_LABELS;

  return (
    <div
      className="style-options"
      aria-label={`${target} style`}
      title={color === null && !disabled ? 'Pick a drawing tool, or select a drawing, to choose its style' : undefined}
    >
      <div className="swatches" role="radiogroup" aria-label="Color">
        {COLORS.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={color === option.value}
            aria-label={option.label}
            data-tooltip={option.label}
            data-tooltip-side="bottom"
            className="swatch"
            disabled={inactive}
            style={{ '--swatch': option.value } as React.CSSProperties}
            onMouseDown={keepFocus}
            onClick={() => applyColor(option.value)}
          />
        ))}
      </div>

      <div className="style-options__separator" />

      <div className="sizes" role="radiogroup" aria-label={isText ? 'Text size' : 'Line thickness'}>
        {sizeLabels.map((label, index) => (
          <button
            key={index}
            type="button"
            role="radio"
            aria-checked={sizeIndex === index}
            aria-label={label}
            data-tooltip={`${isText ? 'Text size' : 'Thickness'}: ${label.toLowerCase()}`}
            data-tooltip-side="bottom"
            className="size"
            disabled={inactive}
            onMouseDown={keepFocus}
            onClick={() => applySize(index)}
          >
            {isText ? (
              <span className="size__letter" style={{ fontSize: 11 + index * 2.5 }}>
                A
              </span>
            ) : (
              <span className="size__dot" style={{ width: 4 + index * 3.5, height: 4 + index * 3.5 }} />
            )}
          </button>
        ))}
      </div>

      <div className="style-options__separator" />

      <div className="sizes" role="radiogroup" aria-label="Line style">
        {STROKE_STYLES.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={dash === option.value}
            aria-label={option.label}
            data-tooltip={`Line: ${option.label.toLowerCase()}`}
            data-tooltip-side="bottom"
            className="size"
            // Text has no outline to dash.
            disabled={inactive || isText}
            onMouseDown={keepFocus}
            onClick={() => applyDash(option.value)}
          >
            <DashSample style={option.value} />
          </button>
        ))}
      </div>
    </div>
  );
}
