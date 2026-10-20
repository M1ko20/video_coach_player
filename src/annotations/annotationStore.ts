import { create } from 'zustand';
import type { Annotation } from './types';

const HISTORY_LIMIT = 200;

interface AnnotationState {
  /** Committed annotations, in drawing order (last is on top). */
  items: Annotation[];
  selectedId: string | null;
  past: Annotation[][];
  future: Annotation[][];
  /** Incremented by every user edit, including undo and redo. Drives autosave. */
  editCount: number;

  /** Replaces everything with saved data. Resets history; not counted as an edit. */
  load: (items: Annotation[]) => void;
  add: (annotation: Annotation) => void;
  /** Replaces the annotation with the same id. */
  replace: (annotation: Annotation) => void;
  remove: (id: string) => void;
  clear: () => void;
  undo: () => void;
  redo: () => void;
  select: (id: string | null) => void;
}

export const useAnnotationStore = create<AnnotationState>((set, get) => {
  /** Records the current items in history and swaps in the next ones. */
  const commit = (next: Annotation[], selectedId: string | null) => {
    const { items, past, editCount } = get();
    set({
      items: next,
      selectedId,
      past: [...past, items].slice(-HISTORY_LIMIT),
      future: [],
      editCount: editCount + 1,
    });
  };

  const keepSelection = (items: Annotation[], selectedId: string | null) =>
    selectedId !== null && items.some((item) => item.id === selectedId) ? selectedId : null;

  return {
    items: [],
    selectedId: null,
    past: [],
    future: [],
    editCount: 0,

    load: (items) => set({ items, selectedId: null, past: [], future: [] }),

    add: (annotation) => commit([...get().items, annotation], get().selectedId),

    replace: (annotation) => {
      const { items, selectedId } = get();
      const index = items.findIndex((item) => item.id === annotation.id);
      if (index === -1 || items[index] === annotation) return;
      const next = items.slice();
      next[index] = annotation;
      commit(next, selectedId);
    },

    remove: (id) => {
      const { items, selectedId } = get();
      if (!items.some((item) => item.id === id)) return;
      commit(
        items.filter((item) => item.id !== id),
        selectedId === id ? null : selectedId,
      );
    },

    clear: () => {
      if (get().items.length > 0) commit([], null);
    },

    undo: () => {
      const { items, past, future, selectedId, editCount } = get();
      const previous = past[past.length - 1];
      if (!previous) return;
      set({
        items: previous,
        past: past.slice(0, -1),
        future: [items, ...future],
        selectedId: keepSelection(previous, selectedId),
        editCount: editCount + 1,
      });
    },

    redo: () => {
      const { items, past, future, selectedId, editCount } = get();
      const next = future[0];
      if (!next) return;
      set({
        items: next,
        past: [...past, items],
        future: future.slice(1),
        selectedId: keepSelection(next, selectedId),
        editCount: editCount + 1,
      });
    },

    select: (id) => {
      if (get().selectedId !== id) set({ selectedId: id });
    },
  };
});

export function getSelectedAnnotation(): Annotation | null {
  const { items, selectedId } = useAnnotationStore.getState();
  return selectedId === null ? null : (items.find((item) => item.id === selectedId) ?? null);
}
