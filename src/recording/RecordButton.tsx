import { useEffect, useRef } from 'react';
import { formatTime } from '../lib/time';
import { useProjectStore } from '../project/projectStore';
import { keepFocus } from '../ui/IconButton';
import { isRecordingSupported, startRecording, stopRecording, useRecordingStore } from './recorder';

/** Starts and stops a recording of the analysis. While recording it shows the elapsed time. */
export function RecordButton({ disabled }: { disabled: boolean }) {
  const status = useRecordingStore((state) => state.status);
  const startedAt = useRecordingStore((state) => state.startedAt);
  const elapsedRef = useRef<HTMLSpanElement>(null);

  // Leaving the workspace ends the recording; the result is still offered for download.
  useEffect(() => () => stopRecording(), []);

  useEffect(() => {
    if (status !== 'recording') return;
    const tick = () => {
      if (elapsedRef.current) elapsedRef.current.textContent = formatTime((Date.now() - startedAt) / 1000, false);
    };
    tick();
    const timer = setInterval(tick, 250);
    return () => clearInterval(timer);
  }, [status, startedAt]);

  if (status === 'starting' || status === 'recording') {
    return (
      <button
        type="button"
        className="record-button is-recording"
        aria-label="Stop recording"
        data-tooltip="Stop recording"
        data-tooltip-side="bottom"
        data-testid="record-button"
        onMouseDown={keepFocus}
        onClick={stopRecording}
      >
        <span className="record-button__stop" />
        {status === 'starting' ? (
          <span key="starting">Starting…</span>
        ) : (
          <span key="elapsed" ref={elapsedRef} className="record-button__time">
            0:00
          </span>
        )}
      </button>
    );
  }

  const supported = isRecordingSupported();
  return (
    <button
      type="button"
      className="record-button"
      aria-label="Record analysis"
      data-tooltip={
        supported
          ? 'Record the video, your drawings and your voice, then download it'
          : 'This browser cannot record. Try a current Chrome, Edge, Safari or Firefox.'
      }
      data-tooltip-side="bottom"
      data-testid="record-button"
      disabled={disabled || !supported}
      onMouseDown={keepFocus}
      onClick={() => void startRecording(useProjectStore.getState().project?.name ?? 'Analysis')}
    >
      <span className="record-button__dot" />
      <span className="record-button__label">Record</span>
    </button>
  );
}
