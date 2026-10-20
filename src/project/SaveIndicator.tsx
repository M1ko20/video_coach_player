import { Check, CircleAlert, HardDriveDownload, LoaderCircle, TriangleAlert } from 'lucide-react';
import { keepFocus } from '../ui/IconButton';
import { useProjectStore } from './projectStore';
import { saveNow } from './session';

/**
 * Reports the true state of persistence. "Saved" appears only after browser
 * storage has confirmed the write. Clicking saves immediately or retries.
 */
export function SaveIndicator() {
  const status = useProjectStore((state) => state.saveStatus);
  const error = useProjectStore((state) => state.saveError);
  const videoStorage = useProjectStore((state) => state.videoStorage);

  // Copying a large video can take a while and must not be interrupted, so it takes priority.
  if (videoStorage === 'storing' && (status === 'saved' || status === 'saving')) {
    return (
      <div className="save save--busy" role="status" data-testid="save-indicator" data-status="storing-video">
        <HardDriveDownload size={15} />
        <span className="save__label">Storing video…</span>
      </div>
    );
  }

  switch (status) {
    case 'saved':
      return (
        <div
          className="save save--saved"
          role="status"
          data-testid="save-indicator"
          data-status="saved"
          data-tooltip="All changes are saved in this browser"
          data-tooltip-side="left"
        >
          <Check size={15} />
          <span className="save__label">Saved</span>
        </div>
      );
    case 'saving':
      return (
        <div className="save save--busy" role="status" data-testid="save-indicator" data-status="saving">
          <LoaderCircle size={15} className="spin" />
          <span className="save__label">Saving…</span>
        </div>
      );
    case 'dirty':
      return (
        <button
          type="button"
          className="save save--dirty"
          data-testid="save-indicator"
          data-status="dirty"
          data-tooltip="Saves automatically · click to save now"
          data-tooltip-side="left"
          onMouseDown={keepFocus}
          onClick={saveNow}
        >
          <span className="save__dot" />
          <span className="save__label">Unsaved changes</span>
        </button>
      );
    case 'error':
      return (
        <button
          type="button"
          className="save save--error"
          data-testid="save-indicator"
          data-status="error"
          data-tooltip={error ?? 'Saving failed'}
          data-tooltip-side="left"
          onMouseDown={keepFocus}
          onClick={saveNow}
        >
          <TriangleAlert size={15} />
          <span className="save__label">Not saved · Retry</span>
        </button>
      );
    case 'conflict':
      return (
        <div className="save save--error" role="status" data-testid="save-indicator" data-status="conflict">
          <CircleAlert size={15} />
          <span className="save__label">Not saved</span>
        </div>
      );
  }
}
