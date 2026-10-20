import { useEffect } from 'react';
import { useAnnotationStore } from '../annotations/annotationStore';
import { deleteSelected, redo, selectTool, undo } from '../annotations/commands';
import { TOOLS } from '../annotations/constants';
import { useInteractionStore } from '../annotations/interactionStore';
import { useToolStore } from '../annotations/toolStore';
import { saveNow } from '../project/session';
import { toggleFullscreen } from '../ui/fullscreen';
import { usePlaybackStore } from '../video/playbackStore';
import { player } from '../video/player';

export interface ShortcutGroup {
  title: string;
  items: ReadonlyArray<{ keys: string[]; action: string }>;
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = isMac ? '⌘' : 'Ctrl';

/** Reference shown in the shortcuts dialog. Keep in step with the handler below. */
export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = [
  {
    title: 'Playback',
    items: [
      { keys: ['Space'], action: 'Play or pause' },
      { keys: [','], action: 'Previous frame' },
      { keys: ['.'], action: 'Next frame' },
      { keys: ['←', '→'], action: 'Back or forward 1 second' },
      { keys: ['Shift', '←', '→'], action: 'Back or forward 5 seconds' },
      { keys: ['Home', 'End'], action: 'Start or end of the video' },
      { keys: ['<', '>'], action: 'Slower or faster' },
      { keys: ['M'], action: 'Mute' },
      { keys: ['F'], action: 'Full screen' },
    ],
  },
  {
    title: 'Drawing',
    items: [
      ...TOOLS.map(({ label, shortcut }) => ({ keys: [shortcut], action: label })),
      { keys: ['Shift'], action: 'While drawing: straight angles, perfect circles and squares' },
      { keys: ['Double-click'], action: 'Edit a text' },
    ],
  },
  {
    title: 'Editing',
    items: [
      { keys: [MOD, 'Z'], action: 'Undo' },
      { keys: isMac ? ['⇧', '⌘', 'Z'] : ['Ctrl', 'Y'], action: 'Redo' },
      { keys: ['Delete'], action: 'Delete the selected drawing' },
      { keys: ['Esc'], action: 'Cancel, deselect, then back to the Select tool' },
      { keys: [MOD, 'S'], action: 'Save now' },
    ],
  },
  {
    title: 'Timeline',
    items: [
      { keys: ['Shift', 'drag'], action: 'Fine scrubbing (10× slower)' },
      { keys: ['Click a marker'], action: 'Jump to where a drawing was made' },
    ],
  },
];

function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLInputElement && !['button', 'checkbox', 'radio', 'range'].includes(target.type))
  );
}

/** Space and Enter belong to a focused button or link, not to the global shortcuts. */
function activatesFocusedControl(event: KeyboardEvent): boolean {
  if (event.key !== ' ' && event.key !== 'Enter') return false;
  return event.target instanceof HTMLElement && event.target.closest('button, a, [role="menuitemradio"]') !== null;
}

/**
 * Global keyboard shortcuts for the workspace. Inactive while typing, while a
 * dialog is open, and for keys a focused control needs for itself.
 */
export function useShortcuts(onShowShortcuts: () => void) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      if (isTyping(event.target) || document.querySelector('dialog[open]')) return;
      if (activatesFocusedControl(event)) return;

      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      const mod = event.metaKey || event.ctrlKey;
      const done = () => event.preventDefault();

      if (mod) {
        if (event.altKey) return;
        if (key === 'z') {
          done();
          if (event.shiftKey) redo();
          else undo();
        } else if (key === 'y') {
          done();
          redo();
        } else if (key === 's') {
          done();
          saveNow();
        }
        return;
      }
      if (event.altKey) return;

      // A drawing gesture in progress owns the pointer; do not change things under it.
      const gestureActive = useInteractionStore.getState().draft !== null;

      switch (key) {
        case ' ':
        case 'k':
          done();
          if (!event.repeat) player.toggle();
          return;
        case 'ArrowLeft':
          done();
          player.seekBy(event.shiftKey ? -5 : -1);
          return;
        case 'ArrowRight':
          done();
          player.seekBy(event.shiftKey ? 5 : 1);
          return;
        // Shift+comma/period is "<" / ">" on most layouts, but not all report it that way.
        case ',':
          done();
          if (event.shiftKey) player.stepRate(-1);
          else player.stepFrames(-1);
          return;
        case '.':
          done();
          if (event.shiftKey) player.stepRate(1);
          else player.stepFrames(1);
          return;
        case '<':
          done();
          player.stepRate(-1);
          return;
        case '>':
          done();
          player.stepRate(1);
          return;
        case 'Home':
          done();
          player.seek(0);
          return;
        case 'End':
          done();
          player.seek(usePlaybackStore.getState().duration);
          return;
        case 'm':
          player.toggleMuted();
          return;
        case 'f':
          toggleFullscreen();
          return;
        case '?':
          done();
          onShowShortcuts();
          return;
        case 'Delete':
        case 'Backspace':
          if (gestureActive) return;
          done();
          deleteSelected();
          return;
        case 'Escape': {
          if (gestureActive) return;
          const annotations = useAnnotationStore.getState();
          if (annotations.selectedId !== null) annotations.select(null);
          else if (useToolStore.getState().tool !== 'select') selectTool('select');
          return;
        }
      }

      if (gestureActive || event.shiftKey) return;
      const tool = TOOLS.find((option) => option.shortcut.toLowerCase() === key);
      if (tool) {
        done();
        selectTool(tool.tool);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onShowShortcuts]);
}
