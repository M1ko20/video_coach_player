import { createId } from '../lib/id';
import { player } from '../video/player';
import { getSelectedAnnotation, useAnnotationStore } from './annotationStore';
import { FONT_SIZES, STROKE_WIDTHS } from './constants';
import { useInteractionStore } from './interactionStore';
import { useToolStore } from './toolStore';
import type { TextAnnotation, Tool } from './types';

/**
 * User-level commands. Toolbar buttons and keyboard shortcuts both go through
 * these, so each action behaves identically however it is triggered.
 */

/** Commits the text being typed, if any. Empty text removes the annotation. */
export function commitTextEdit() {
  const { textEdit, setTextEdit } = useInteractionStore.getState();
  if (!textEdit) return;
  setTextEdit(null);

  const annotations = useAnnotationStore.getState();
  const text = textEdit.value.replace(/\s+$/, '');
  const existing = textEdit.id ? annotations.items.find((item) => item.id === textEdit.id) : undefined;

  if (text.trim() === '') {
    if (existing) annotations.remove(existing.id);
    return;
  }

  if (existing && existing.type === 'text') {
    if (existing.text !== text || existing.color !== textEdit.color || existing.fontSize !== textEdit.fontSize) {
      annotations.replace({ ...existing, text, color: textEdit.color, fontSize: textEdit.fontSize });
    }
    return;
  }

  const created: TextAnnotation = {
    id: createId(),
    type: 'text',
    x: textEdit.x,
    y: textEdit.y,
    text,
    fontSize: textEdit.fontSize,
    color: textEdit.color,
    anchorTime: textEdit.anchorTime,
    range: null,
  };
  annotations.add(created);
}

export function cancelTextEdit() {
  useInteractionStore.getState().setTextEdit(null);
}

/** Opens the inline editor for a new text at a point (normalized coordinates). */
export function beginText(x: number, y: number) {
  const { color, sizeIndex } = useToolStore.getState();
  player.pause();
  useAnnotationStore.getState().select(null);
  useInteractionStore.getState().setTextEdit({
    id: null,
    x,
    y,
    color,
    fontSize: FONT_SIZES[sizeIndex]!,
    value: '',
    anchorTime: player.time,
  });
}

/** Opens the inline editor on an existing text annotation. */
export function editText(annotation: TextAnnotation) {
  useAnnotationStore.getState().select(null);
  useInteractionStore.getState().setTextEdit({
    id: annotation.id,
    x: annotation.x,
    y: annotation.y,
    color: annotation.color,
    fontSize: annotation.fontSize,
    value: annotation.text,
    anchorTime: annotation.anchorTime,
  });
}

export function selectTool(tool: Tool) {
  commitTextEdit();
  useToolStore.getState().setTool(tool);
  // A drawing tool styles what is drawn next; keeping something selected would
  // make it unclear what the color and size controls apply to.
  if (tool !== 'select') useAnnotationStore.getState().select(null);
}

/** Sets the color for new drawings and recolors whatever is being edited or selected. */
export function applyColor(color: string) {
  useToolStore.getState().setColor(color);

  const { textEdit, setTextEdit } = useInteractionStore.getState();
  if (textEdit) {
    setTextEdit({ ...textEdit, color });
    return;
  }
  const selected = getSelectedAnnotation();
  if (selected && selected.color !== color) {
    useAnnotationStore.getState().replace({ ...selected, color });
  }
}

/** Sets the size step for new drawings and resizes whatever is being edited or selected. */
export function applySize(index: number) {
  useToolStore.getState().setSizeIndex(index);

  const { textEdit, setTextEdit } = useInteractionStore.getState();
  if (textEdit) {
    setTextEdit({ ...textEdit, fontSize: FONT_SIZES[index]! });
    return;
  }
  const selected = getSelectedAnnotation();
  if (!selected) return;
  const { replace } = useAnnotationStore.getState();
  if (selected.type === 'text') {
    const fontSize = FONT_SIZES[index]!;
    if (selected.fontSize !== fontSize) replace({ ...selected, fontSize });
  } else {
    const strokeWidth = STROKE_WIDTHS[index]!;
    if (selected.strokeWidth !== strokeWidth) replace({ ...selected, strokeWidth });
  }
}

export function deleteSelected() {
  const { selectedId, remove } = useAnnotationStore.getState();
  if (selectedId) remove(selectedId);
}

export function clearAll() {
  cancelTextEdit();
  useAnnotationStore.getState().clear();
}

export function undo() {
  commitTextEdit();
  useAnnotationStore.getState().undo();
}

export function redo() {
  commitTextEdit();
  useAnnotationStore.getState().redo();
}
