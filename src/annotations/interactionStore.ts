import { create } from 'zustand';
import type { Annotation } from './types';

export interface TextEdit {
  /** Id of the annotation being edited, or `null` while typing a new one. */
  id: string | null;
  x: number;
  y: number;
  color: string;
  fontSize: number;
  value: string;
  anchorTime: number;
}

/**
 * Transient state of the gesture in progress. It is deliberately separate from
 * the annotation store: pointer movement updates only this store, so nothing
 * but the shape under the pointer re-renders and nothing reaches undo history
 * or storage until the gesture is committed.
 */
interface InteractionState {
  /** The shape being drawn, moved or resized right now. */
  draft: Annotation | null;
  /** Committed annotation hidden because the draft or the text editor stands in for it. */
  hiddenId: string | null;
  textEdit: TextEdit | null;

  setDraft: (draft: Annotation | null, hiddenId?: string | null) => void;
  setTextEdit: (textEdit: TextEdit | null) => void;
  reset: () => void;
}

export const useInteractionStore = create<InteractionState>((set) => ({
  draft: null,
  hiddenId: null,
  textEdit: null,

  setDraft: (draft, hiddenId = null) => set({ draft, hiddenId: draft ? hiddenId : null }),
  setTextEdit: (textEdit) => set({ textEdit, hiddenId: textEdit?.id ?? null }),
  reset: () => set({ draft: null, hiddenId: null, textEdit: null }),
}));
