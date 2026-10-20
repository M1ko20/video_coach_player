import { create } from 'zustand';
import { useAnnotationStore } from '../annotations/annotationStore';
import { REF_HEIGHT } from '../annotations/constants';
import { refWidth } from '../annotations/geometry';
import { useInteractionStore } from '../annotations/interactionStore';
import { isVisibleAt, type Annotation } from '../annotations/types';
import { player } from '../video/player';
import { drawAnnotation } from './drawAnnotations';

export type RecordingStatus = 'idle' | 'starting' | 'recording' | 'finished';

export interface Recording {
  url: string;
  blob: Blob;
  fileName: string;
  /** Seconds. */
  duration: number;
}

interface RecordingState {
  status: RecordingStatus;
  /** `Date.now()` when recording began. */
  startedAt: number;
  /** Why the microphone is missing from the recording, if it could not be used. */
  micProblem: string | null;
  error: string | null;
  result: Recording | null;
}

export const useRecordingStore = create<RecordingState>(() => ({
  status: 'idle',
  startedAt: 0,
  micProblem: null,
  error: null,
  result: null,
}));

/** Largest recorded picture. Bigger sources are scaled down; the bitrate is sized for this. */
const MAX_WIDTH = 1920;
const MAX_HEIGHT = 1080;
const FRAME_RATE = 30;

/** Preferred first: MP4 plays everywhere, including phones and messaging apps. */
const MIME_TYPES = [
  'video/mp4;codecs=avc1.640028,mp4a.40.2',
  'video/mp4;codecs=avc1,mp4a',
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
];

export function isRecordingSupported(): boolean {
  return (
    typeof MediaRecorder !== 'undefined' &&
    typeof AudioContext !== 'undefined' &&
    typeof HTMLCanvasElement.prototype.captureStream === 'function'
  );
}

function pickMimeType(): string | undefined {
  return MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
}

let audioContext: AudioContext | null = null;
/**
 * An element's sound can be routed into Web Audio only once, after which it is
 * heard only through the graph. So each element gets one source, connected to
 * the speakers for good, and recordings tap into it.
 */
const elementSources = new WeakMap<HTMLVideoElement, MediaElementAudioSourceNode>();

function elementSource(context: AudioContext, video: HTMLVideoElement): MediaElementAudioSourceNode {
  let source = elementSources.get(video);
  if (!source) {
    source = context.createMediaElementSource(video);
    source.connect(context.destination);
    elementSources.set(video, source);
  }
  return source;
}

function describeMicError(error: unknown): string {
  const name = error instanceof DOMException ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError')
    return 'Microphone access was blocked, so your voice is not in this recording. Allow the microphone for this site to include it next time.';
  if (name === 'NotFoundError') return 'No microphone was found, so your voice is not in this recording.';
  return 'The microphone could not be used, so your voice is not in this recording.';
}

function outputSize(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(1, MAX_WIDTH / width, MAX_HEIGHT / height);
  // Video encoders require even dimensions.
  const even = (value: number) => Math.max(2, Math.round((value * scale) / 2) * 2);
  return { width: even(width), height: even(height) };
}

/** Everything that is on screen over the video at this moment, minus the selection handles. */
function visibleAnnotations(): Annotation[] {
  const { items } = useAnnotationStore.getState();
  const { draft, hiddenId, textEdit } = useInteractionStore.getState();
  const time = player.time;
  const shown = items.filter((item) => item.id !== hiddenId && isVisibleAt(item, time));
  if (draft) shown.push(draft);
  if (textEdit && textEdit.value.trim()) {
    shown.push({
      id: textEdit.id ?? 'editing',
      type: 'text',
      x: textEdit.x,
      y: textEdit.y,
      text: textEdit.value,
      fontSize: textEdit.fontSize,
      color: textEdit.color,
      anchorTime: textEdit.anchorTime,
      range: null,
    });
  }
  return shown;
}

interface Session {
  recorder: MediaRecorder;
  name: string;
  /** Set when the recording should be thrown away instead of offered for download. */
  discard: boolean;
}

let session: Session | null = null;

/**
 * Starts recording the analysis as the viewer sees it: the video with the
 * drawings burnt in, the video's own sound (unless muted) and the coach's
 * voice from the microphone. The picture is composed on a canvas every
 * display frame, so pausing, stepping and drawing all end up in the recording.
 */
export async function startRecording(name: string) {
  const state = useRecordingStore.getState();
  const video = player.element;
  if (state.status === 'starting' || state.status === 'recording' || !video || !isRecordingSupported()) return;
  dismissRecording();
  useRecordingStore.setState({ status: 'starting', micProblem: null, error: null });

  const cleanups: Array<() => void> = [];
  const cleanup = () => cleanups.splice(0).forEach((fn) => fn());

  try {
    // Created and resumed inside the click, which browsers require before audio can start.
    audioContext ??= new AudioContext();
    const context = audioContext;
    const resumed = context.resume();
    const mix = context.createMediaStreamDestination();

    const videoSound = elementSource(context, video);
    videoSound.connect(mix);
    cleanups.push(() => videoSound.disconnect(mix));

    let micProblem: string | null = null;
    try {
      const mic = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      cleanups.push(() => mic.getTracks().forEach((track) => track.stop()));
      // Into the recording only: playing the voice back through the speakers would echo.
      const voice = context.createMediaStreamSource(mic);
      voice.connect(mix);
      cleanups.push(() => voice.disconnect());
    } catch (error) {
      micProblem = describeMicError(error);
    }
    await resumed;

    // Cancelled while the microphone prompt was open.
    if (useRecordingStore.getState().status !== 'starting' || player.element !== video) {
      cleanup();
      useRecordingStore.setState({ status: 'idle' });
      return;
    }

    const size = outputSize(video.videoWidth || 1280, video.videoHeight || 720);
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('canvas');
    const W = refWidth(size.width / size.height);
    const scale = size.height / REF_HEIGHT;

    let frame = 0;
    const draw = () => {
      frame = requestAnimationFrame(draw);
      const source = player.element;
      if (source && source.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        ctx.drawImage(source, 0, 0, size.width, size.height);
      } else {
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, size.width, size.height);
      }
      ctx.save();
      ctx.scale(scale, scale);
      for (const annotation of visibleAnnotations()) drawAnnotation(ctx, annotation, W);
      ctx.restore();
    };
    draw();
    cleanups.push(() => cancelAnimationFrame(frame));

    const picture = canvas.captureStream(FRAME_RATE);
    cleanups.push(() => picture.getTracks().forEach((track) => track.stop()));
    const stream = new MediaStream([...picture.getVideoTracks(), ...mix.stream.getAudioTracks()]);

    const mimeType = pickMimeType();
    const recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: 8_000_000,
      audioBitsPerSecond: 128_000,
    });
    const chunks: Blob[] = [];
    const current: Session = { recorder, name, discard: false };
    session = current;

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.onstop = () => {
      cleanup();
      if (session === current) session = null;
      const { startedAt } = useRecordingStore.getState();
      if (current.discard || chunks.length === 0) {
        useRecordingStore.setState({ status: 'idle' });
        return;
      }
      const type = recorder.mimeType || mimeType || 'video/webm';
      const blob = new Blob(chunks, { type });
      useRecordingStore.setState({
        status: 'finished',
        result: {
          url: URL.createObjectURL(blob),
          blob,
          fileName: recordingFileName(current.name, type.startsWith('video/mp4') ? 'mp4' : 'webm'),
          duration: (Date.now() - startedAt) / 1000,
        },
      });
    };
    recorder.onerror = () => {
      current.discard = true;
      useRecordingStore.setState({ error: 'The recording failed. Please try again.' });
      if (recorder.state !== 'inactive') recorder.stop();
    };

    // Regular chunks keep memory flat and mean an interrupted recording still has data.
    recorder.start(1000);
    useRecordingStore.setState({ status: 'recording', startedAt: Date.now(), micProblem });
  } catch {
    cleanup();
    useRecordingStore.setState({ status: 'idle', error: 'This browser could not start a recording.' });
  }
}

/** Stops recording; the result is then offered for download. */
export function stopRecording() {
  const { status } = useRecordingStore.getState();
  if (status === 'starting') {
    useRecordingStore.setState({ status: 'idle' });
    return;
  }
  if (session && session.recorder.state !== 'inactive') session.recorder.stop();
}

/** Closes the finished recording (or error) and frees its memory. */
export function dismissRecording() {
  const { result } = useRecordingStore.getState();
  if (result) URL.revokeObjectURL(result.url);
  if (useRecordingStore.getState().status === 'finished') useRecordingStore.setState({ status: 'idle' });
  useRecordingStore.setState({ result: null, error: null, micProblem: null });
}

/** A file name from the analysis name and the time of recording. */
export function recordingFileName(projectName: string, extension: string, date = new Date()): string {
  const safe =
    [...projectName]
      .map((char) => (char < ' ' || '\\/:*?"<>|'.includes(char) ? '-' : char))
      .join('')
      .trim() || 'Analysis';
  const pad = (value: number) => String(value).padStart(2, '0');
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}.${pad(date.getMinutes())}`;
  return `${safe} ${stamp}.${extension}`;
}
