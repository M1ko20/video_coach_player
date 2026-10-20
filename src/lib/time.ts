/** Frame rate used until the real one has been measured or chosen. */
export const FALLBACK_FPS = 30;

/** Absorbs floating-point error when converting a time to a frame index. */
const FRAME_EPSILON = 1e-4;

const COMMON_FRAME_RATES = [
  12, 15, 23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60, 90, 100, 119.88, 120, 240,
];

/** Formats seconds as `m:ss.cc` (or `h:mm:ss.cc` for long footage). */
export function formatTime(seconds: number, withFraction = true): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const totalCentis = Math.floor(seconds * 100 + FRAME_EPSILON);
  const centis = totalCentis % 100;
  const totalSeconds = Math.floor(totalCentis / 100);
  const secs = totalSeconds % 60;
  const mins = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  const pad = (value: number) => String(value).padStart(2, '0');
  const head = hours > 0 ? `${hours}:${pad(mins)}:${pad(secs)}` : `${mins}:${pad(secs)}`;
  return withFraction ? `${head}.${pad(centis)}` : head;
}

/** Index of the frame on screen at `time`, assuming a constant frame rate. */
export function frameAtTime(time: number, fps: number): number {
  return Math.max(0, Math.floor(time * fps + FRAME_EPSILON));
}

/**
 * Seek target for a frame. Aims at the middle of the frame's display interval:
 * a seek to the exact frame boundary can land on either neighbour, depending on
 * rounding in the container timestamps.
 */
export function timeOfFrame(frame: number, fps: number): number {
  return (frame + 0.5) / fps;
}

export function lastFrameIndex(duration: number, fps: number): number {
  return Math.max(0, Math.ceil(duration * fps - 0.01) - 1);
}

/** Seek target for a frame, clamped to the frames the video actually has. */
export function frameSeekTime(frame: number, fps: number, duration: number): number {
  const target = Math.min(lastFrameIndex(duration, fps), Math.max(0, frame));
  // Never seek to the very end: that puts the element in its "ended" state.
  return Math.max(0, Math.min(timeOfFrame(target, fps), duration - 0.001));
}

/** Time to seek to in order to move `delta` frames away from `time`. */
export function stepFrameTime(time: number, delta: number, fps: number, duration: number): number {
  return frameSeekTime(frameAtTime(time, fps) + delta, fps, duration);
}

/** Snaps a measured rate to a standard one when it is within 1.5%. */
export function snapFrameRate(raw: number): number | null {
  if (!Number.isFinite(raw) || raw < 5 || raw > 300) return null;
  let best: number | null = null;
  let bestError = Infinity;
  for (const rate of COMMON_FRAME_RATES) {
    const error = Math.abs(rate - raw) / rate;
    if (error < bestError) {
      best = rate;
      bestError = error;
    }
  }
  if (best !== null && bestError <= 0.015) return best;
  return Math.round(raw * 100) / 100;
}

/**
 * Estimates the frame rate from the media timestamps of consecutively presented
 * frames. A dropped frame only ever makes a gap longer, so a low percentile of
 * the gaps is the best estimate of the true frame duration.
 */
export function estimateFrameRate(mediaTimes: readonly number[]): number | null {
  const gaps: number[] = [];
  for (let i = 1; i < mediaTimes.length; i++) {
    const gap = mediaTimes[i]! - mediaTimes[i - 1]!;
    if (gap > 1e-4) gaps.push(gap);
  }
  if (gaps.length < 4) return null;
  gaps.sort((a, b) => a - b);
  const frameDuration = gaps[Math.floor(gaps.length * 0.25)]!;
  return snapFrameRate(1 / frameDuration);
}

export function formatFrameRate(fps: number): string {
  return Number.isInteger(fps) ? String(fps) : fps.toFixed(2).replace(/0$/, '');
}

export function formatDurationShort(seconds: number): string {
  return formatTime(seconds, false);
}

export function formatRelativeDate(timestamp: number, now = Date.now()): string {
  const diff = Math.max(0, now - timestamp);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff < minute) return 'just now';
  if (diff < hour) return `${Math.floor(diff / minute)} min ago`;
  if (diff < day) return `${Math.floor(diff / hour)} h ago`;
  if (diff < 7 * day) {
    const days = Math.floor(diff / day);
    return days === 1 ? 'yesterday' : `${days} days ago`;
  }
  return new Date(timestamp).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${gb.toFixed(gb >= 10 ? 0 : 1)} GB`;
  const mb = bytes / 1024 ** 2;
  if (mb < 0.1) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${mb >= 10 ? Math.round(mb) : mb.toFixed(1)} MB`;
}
