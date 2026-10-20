import { create } from 'zustand';
import { FALLBACK_FPS } from '../lib/time';

export type PlaybackStatus = 'idle' | 'loading' | 'ready' | 'error';
export type FrameRateSource = 'measured' | 'manual' | 'assumed';

export const PLAYBACK_RATES: readonly number[] = [0.25, 0.5, 1, 1.5, 2];

/**
 * Low-frequency playback state for the UI. The current time is deliberately
 * not here: it changes every frame and is delivered through
 * `player.subscribeTime` so that playback never re-renders React components.
 */
interface PlaybackState {
  status: PlaybackStatus;
  error: string | null;
  playing: boolean;
  /** The decoder is waiting for data during playback. */
  stalled: boolean;
  duration: number;
  rate: number;
  muted: boolean;
  fps: number;
  fpsSource: FrameRateSource;
}

const MUTED_KEY = 'cva:muted';

function readMuted(): boolean {
  try {
    return localStorage.getItem(MUTED_KEY) === '1';
  } catch {
    return false;
  }
}

export function rememberMuted(muted: boolean) {
  try {
    localStorage.setItem(MUTED_KEY, muted ? '1' : '0');
  } catch {
    // Preference only; ignore unavailable storage.
  }
}

export const usePlaybackStore = create<PlaybackState>(() => ({
  status: 'idle',
  error: null,
  playing: false,
  stalled: false,
  duration: 0,
  rate: 1,
  muted: readMuted(),
  fps: FALLBACK_FPS,
  fpsSource: 'assumed',
}));

/** Resolves which frame rate frame stepping should use. A manual choice always wins. */
export function setFrameRate(measured: number | null | undefined, manual: number | null | undefined) {
  if (manual) usePlaybackStore.setState({ fps: manual, fpsSource: 'manual' });
  else if (measured) usePlaybackStore.setState({ fps: measured, fpsSource: 'measured' });
  else usePlaybackStore.setState({ fps: FALLBACK_FPS, fpsSource: 'assumed' });
}
