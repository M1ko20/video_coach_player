import { LoaderCircle, TriangleAlert, Upload, VideoOff } from 'lucide-react';
import { useRef } from 'react';
import { formatBytes, formatDurationShort } from '../lib/time';
import { ConfirmDialog } from '../ui/Dialog';
import { useFileDrop } from '../ui/useFileDrop';
import { useProjectStore } from './projectStore';
import { cancelRelink, confirmRelink, relinkVideo } from './session';

interface MissingVideoProps {
  /** Shown instead of the default explanation, e.g. when the stored copy failed to play. */
  reason?: string;
  drawingCount: number;
}

/**
 * Shown when a project is open but its video is not available. The drawings
 * are safe in storage; this asks for the video file again.
 */
export function MissingVideo({ reason, drawingCount }: MissingVideoProps) {
  const project = useProjectStore((state) => state.project);
  const relinking = useProjectStore((state) => state.relinking);
  const relinkError = useProjectStore((state) => state.relinkError);
  const mismatch = useProjectStore((state) => state.relinkMismatch);
  const inputRef = useRef<HTMLInputElement>(null);
  const { dragging, dropHandlers } = useFileDrop((file) => void relinkVideo(file), !relinking);

  if (!project) return null;
  const { video } = project;

  return (
    <div className={`missing-video ${dragging ? 'is-dragging' : ''}`} {...dropHandlers}>
      <div className="missing-video__icon">
        <VideoOff size={26} />
      </div>
      <h2 className="missing-video__title">Select the video to continue</h2>
      <p className="missing-video__text">
        {reason ?? 'This browser does not have a copy of the video for this analysis.'}{' '}
        {drawingCount > 0
          ? `Your ${drawingCount === 1 ? 'drawing is' : `${drawingCount} drawings are`} saved and will reappear once the video is back.`
          : 'Your analysis is saved and will continue once the video is back.'}
      </p>
      <p className="missing-video__file">
        <span className="missing-video__file-name">{video.name}</span>
        <span>
          {formatDurationShort(video.duration)} · {formatBytes(video.size)}
        </span>
      </p>

      <button type="button" className="button button--primary" disabled={relinking} onClick={() => inputRef.current?.click()}>
        {relinking ? <LoaderCircle size={16} className="spin" /> : <Upload size={16} />}
        {relinking ? 'Opening video…' : 'Choose video file'}
      </button>
      <p className="missing-video__hint">or drop the file here</p>

      {relinkError && (
        <p className="inline-error" role="alert">
          <TriangleAlert size={15} />
          {relinkError}
        </p>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="video/*,.mkv,.mov"
        hidden
        data-testid="relink-input"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void relinkVideo(file);
        }}
      />

      <ConfirmDialog
        open={mismatch !== null}
        title="Use a different video?"
        message={
          mismatch ? (
            <>
              “{mismatch.file.name}” ({formatDurationShort(mismatch.info.duration)}) does not match the original video “
              {video.name}” ({formatDurationShort(video.duration)}). Existing drawings may not line up with it.
            </>
          ) : null
        }
        confirmLabel="Use this video"
        cancelLabel="Choose another"
        onConfirm={confirmRelink}
        onCancel={cancelRelink}
      />
    </div>
  );
}
