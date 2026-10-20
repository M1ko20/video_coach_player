import { Download, Share2, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { formatBytes, formatTime } from '../lib/time';
import { Dialog } from '../ui/Dialog';
import { dismissRecording, useRecordingStore, type Recording } from './recorder';

function canShare(file: File): boolean {
  try {
    return typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });
  } catch {
    return false;
  }
}

function RecordingResult({ result, micProblem }: { result: Recording; micProblem: string | null }) {
  const [saved, setSaved] = useState(false);
  const [file] = useState(() => new File([result.blob], result.fileName, { type: result.blob.type }));
  const shareable = canShare(file);

  const share = async () => {
    try {
      await navigator.share({ files: [file], title: result.fileName });
      setSaved(true);
    } catch {
      // Cancelled by the user, or the target app failed; the download is still there.
    }
  };

  return (
    <>
      <video className="recording__preview" src={result.url} controls playsInline data-testid="recording-preview" />
      <p className="recording__meta">
        {formatTime(result.duration, false)} · {formatBytes(result.blob.size)} · {result.fileName}
      </p>
      {micProblem && (
        <p className="inline-error recording__warning">
          <TriangleAlert size={15} />
          {micProblem}
        </p>
      )}
      <div className="dialog__actions">
        <button type="button" className="button" onClick={dismissRecording}>
          {saved ? 'Done' : 'Discard'}
        </button>
        {shareable && (
          <button type="button" className="button" onClick={() => void share()}>
            <Share2 size={16} />
            Share
          </button>
        )}
        <a
          className="button button--primary"
          href={result.url}
          download={result.fileName}
          onClick={() => setSaved(true)}
          data-testid="recording-download"
        >
          <Download size={16} />
          Download
        </a>
      </div>
    </>
  );
}

/**
 * Offers a finished recording for download. Kept outside the workspace so a
 * recording stopped by leaving the analysis is not lost. Escape and clicks
 * outside do not throw it away: only the Discard button does.
 */
export function RecordingDialog() {
  const status = useRecordingStore((state) => state.status);
  const result = useRecordingStore((state) => state.result);
  const error = useRecordingStore((state) => state.error);
  const micProblem = useRecordingStore((state) => state.micProblem);
  const open = (status === 'finished' && result !== null) || error !== null;

  return (
    <Dialog
      open={open}
      onClose={error ? dismissRecording : () => {}}
      title={error ? 'Recording failed' : 'Recording ready'}
      className="dialog--recording"
    >
      {error ? (
        <>
          <p className="dialog__message">{error}</p>
          <div className="dialog__actions">
            <button type="button" className="button button--primary" onClick={dismissRecording} autoFocus>
              OK
            </button>
          </div>
        </>
      ) : (
        result && <RecordingResult key={result.url} result={result} micProblem={micProblem} />
      )}
    </Dialog>
  );
}
