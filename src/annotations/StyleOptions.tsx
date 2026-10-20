import { keepFocus } from '../ui/IconButton';
import { useAnnotationStore } from './annotationStore';
import { applyColor, applySize } from './commands';
import { COLORS, FONT_SIZES, SIZE_LABELS, STROKE_WIDTHS, TEXT_SIZE_LABELS, closestIndex } from './constants';
import { useInteractionStore } from './interactionStore';
import { useToolStore } from './toolStore';

/**
 * Color and size controls. They show the style of whatever they will affect:
 * the text being typed, else the selected drawing, else the next drawing.
 */
export function StyleOptions({ disabled = false }: { disabled?: boolean }) {
  const tool = useToolStore((state) => state.tool);
  const toolColor = useToolStore((state) => state.color);
  const toolSizeIndex = useToolStore((state) => state.sizeIndex);
  const selected = useAnnotationStore((state) =>
    state.selectedId === null ? null : (state.items.find((item) => item.id === state.selectedId) ?? null),
  );
  const textEdit = useInteractionStore((state) => state.textEdit);

  let color = toolColor;
  let sizeIndex = toolSizeIndex;
  let isText = tool === 'text';

  if (textEdit) {
    color = textEdit.color;
    sizeIndex = closestIndex(FONT_SIZES, textEdit.fontSize);
    isText = true;
  } else if (selected) {
    color = selected.color;
    isText = selected.type === 'text';
    sizeIndex =
      selected.type === 'text'
        ? closestIndex(FONT_SIZES, selected.fontSize)
        : closestIndex(STROKE_WIDTHS, selected.strokeWidth);
  }

  const sizeLabels = isText ? TEXT_SIZE_LABELS : SIZE_LABELS;
  const target = textEdit || selected ? 'Selected drawing' : 'Next drawing';

  return (
    <div className="style-options" aria-label={`${target} style`}>
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
            disabled={disabled}
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
            disabled={disabled}
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
    </div>
  );
}
