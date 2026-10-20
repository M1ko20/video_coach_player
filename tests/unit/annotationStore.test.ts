import { beforeEach, describe, expect, it } from 'vitest';
import { useAnnotationStore } from '../../src/annotations/annotationStore';
import type { Annotation } from '../../src/annotations/types';

const shape = (id: string, color = '#ffd60a'): Annotation => ({
  id,
  type: 'rect',
  x: 0.1,
  y: 0.1,
  w: 0.2,
  h: 0.2,
  strokeWidth: 5,
  color,
  anchorTime: 0,
  range: null,
});

const store = () => useAnnotationStore.getState();
const ids = () => store().items.map((item) => item.id);

beforeEach(() => {
  store().load([]);
  useAnnotationStore.setState({ editCount: 0 });
});

describe('annotation store', () => {
  it('adds, replaces and removes annotations', () => {
    store().add(shape('a'));
    store().add(shape('b'));
    store().replace(shape('a', '#ff453a'));
    expect(store().items[0]!.color).toBe('#ff453a');
    store().remove('b');
    expect(ids()).toEqual(['a']);
  });

  it('undoes and redoes every kind of edit', () => {
    store().add(shape('a'));
    store().add(shape('b'));
    store().replace(shape('a', '#ff453a'));
    store().remove('b');
    store().clear();
    expect(ids()).toEqual([]);

    store().undo();
    expect(ids()).toEqual(['a']);
    store().undo();
    expect(ids()).toEqual(['a', 'b']);
    store().undo();
    expect(store().items[0]!.color).toBe('#ffd60a');
    store().undo();
    expect(ids()).toEqual(['a']);
    store().undo();
    expect(ids()).toEqual([]);
    store().undo();
    expect(ids()).toEqual([]);

    for (let i = 0; i < 5; i++) store().redo();
    expect(ids()).toEqual([]);
    store().undo();
    expect(ids()).toEqual(['a']);
  });

  it('drops the redo stack after a new edit', () => {
    store().add(shape('a'));
    store().undo();
    store().add(shape('b'));
    store().redo();
    expect(ids()).toEqual(['b']);
  });

  it('never changes annotations when the selection changes', () => {
    store().add(shape('a'));
    store().add(shape('b'));
    const before = store().items;
    const edits = store().editCount;
    store().select('a');
    store().select('b');
    store().select(null);
    expect(store().items).toBe(before);
    expect(store().editCount).toBe(edits);
    expect(store().past).toHaveLength(2);
  });

  it('deselects an annotation that undo or delete removed', () => {
    store().add(shape('a'));
    store().select('a');
    store().undo();
    expect(store().selectedId).toBeNull();

    store().redo();
    store().select('a');
    store().remove('a');
    expect(store().selectedId).toBeNull();
  });

  it('counts edits (for autosave) but not loads or no-ops', () => {
    store().load([shape('a')]);
    expect(store().editCount).toBe(0);
    store().replace(store().items[0]!);
    store().remove('missing');
    expect(store().editCount).toBe(0);
    store().add(shape('b'));
    store().undo();
    store().redo();
    expect(store().editCount).toBe(3);
  });

  it('starts a fresh history when a project is loaded', () => {
    store().add(shape('a'));
    store().load([shape('x')]);
    store().undo();
    expect(ids()).toEqual(['x']);
  });
});
