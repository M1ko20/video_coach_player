import { useEffect, useRef } from 'react';
import { TEXT_FONT_FAMILY, TEXT_FONT_WEIGHT, TEXT_LINE_HEIGHT, measureTextBlock } from '../lib/textMetrics';
import { cancelTextEdit, commitTextEdit } from './commands';
import { useInteractionStore } from './interactionStore';

interface TextEditorProps {
  /** CSS pixels per overlay unit. */
  scale: number;
}

/**
 * Inline editor for text annotations: a borderless textarea placed exactly
 * where the text will be drawn, in the same font, size and color.
 */
export function TextEditor({ scale }: TextEditorProps) {
  const textEdit = useInteractionStore((state) => state.textEdit);
  const ref = useRef<HTMLTextAreaElement>(null);
  const active = textEdit !== null;

  useEffect(() => {
    const element = ref.current;
    if (!active || !element) return;
    element.focus({ preventScroll: true });
    element.setSelectionRange(element.value.length, element.value.length);
  }, [active]);

  if (!textEdit) return null;

  const fontSize = textEdit.fontSize * scale;
  const metrics = measureTextBlock(textEdit.value || 'Type here', fontSize);

  return (
    <textarea
      ref={ref}
      className="text-editor"
      aria-label="Annotation text"
      placeholder="Type here"
      value={textEdit.value}
      rows={1}
      spellCheck={false}
      autoComplete="off"
      wrap="off"
      style={{
        left: `${textEdit.x * 100}%`,
        top: `${textEdit.y * 100}%`,
        width: Math.ceil(metrics.width + fontSize * 0.6),
        height: Math.ceil(metrics.height),
        color: textEdit.color,
        fontFamily: TEXT_FONT_FAMILY,
        fontWeight: TEXT_FONT_WEIGHT,
        fontSize,
        lineHeight: TEXT_LINE_HEIGHT,
      }}
      onChange={(event) => useInteractionStore.getState().setTextEdit({ ...textEdit, value: event.target.value })}
      onBlur={commitTextEdit}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          cancelTextEdit();
        } else if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
          event.preventDefault();
          commitTextEdit();
        }
      }}
    />
  );
}
