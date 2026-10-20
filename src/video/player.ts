import { stepFrameTime } from '../lib/time';
import { PLAYBACK_RATES, rememberMuted, usePlaybackStore } from './playbackStore';

type TimeListener = (time: number) => void;

function describeMediaError(error: MediaError | null): string {
  switch (error?.code) {
    case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
      return 'This browser can’t play this video format. MP4 (H.264) and WebM work everywhere.';
    case MediaError.MEDIA_ERR_DECODE:
      return 'The video file appears to be damaged and can’t be decoded.';
    case MediaError.MEDIA_ERR_NETWORK:
      return 'The video file could not be read. It may have been moved or deleted.';
    default:
      return 'The video could not be loaded.';
  }
}

/**
 * Owns the <video> element. The element is the single source of truth for
 * playback; this class translates its events into store updates and exposes
 * the transport commands the UI needs.
 */
class Player {
  private el: HTMLVideoElement | null = null;
  private readonly listeners = new Set<TimeListener>();
  /** Latest requested seek that has not been handed to the element yet. */
  private pendingSeek: number | null = null;
  private startTime = 0;
  private raf = 0;
  private lastEmitted = -1;
  private detachCurrent: (() => void) | null = null;

  /** Binds to a video element. Returns a function that undoes the binding. */
  attach(el: HTMLVideoElement, startTime = 0): () => void {
    this.detachCurrent?.();

    this.el = el;
    this.startTime = startTime;
    this.pendingSeek = null;
    el.muted = usePlaybackStore.getState().muted;
    usePlaybackStore.setState({
      status: 'loading',
      error: null,
      playing: false,
      stalled: false,
      duration: 0,
      rate: 1,
    });

    const controller = new AbortController();
    const on = (type: keyof HTMLVideoElementEventMap, handler: () => void) =>
      el.addEventListener(type, handler, { signal: controller.signal });

    const syncDuration = () => {
      if (Number.isFinite(el.duration)) usePlaybackStore.setState({ duration: el.duration });
    };

    const onMetadata = () => {
      syncDuration();
      const start = this.startTime;
      this.startTime = 0;
      if (start > 0 && Number.isFinite(el.duration) && start < el.duration) el.currentTime = start;
      this.emit();
    };
    const onData = () => usePlaybackStore.setState({ status: 'ready', error: null });

    on('loadstart', () => usePlaybackStore.setState({ status: 'loading', error: null, playing: false }));
    on('loadedmetadata', onMetadata);
    on('loadeddata', onData);
    on('durationchange', syncDuration);
    on('play', () => {
      usePlaybackStore.setState({ playing: true });
      this.startLoop();
    });
    on('pause', () => {
      usePlaybackStore.setState({ playing: false, stalled: false });
      this.stopLoop();
      this.emit();
    });
    on('ended', () => {
      usePlaybackStore.setState({ playing: false, stalled: false });
      this.stopLoop();
      this.emit();
    });
    on('waiting', () => usePlaybackStore.setState({ stalled: true }));
    on('playing', () => usePlaybackStore.setState({ stalled: false }));
    on('canplay', () => usePlaybackStore.setState({ stalled: false }));
    on('ratechange', () => usePlaybackStore.setState({ rate: el.playbackRate }));
    on('volumechange', () => usePlaybackStore.setState({ muted: el.muted }));
    on('seeked', () => {
      this.flushSeek();
      this.emit();
    });
    on('timeupdate', () => {
      if (!this.raf) this.emit();
    });
    on('error', () => {
      this.stopLoop();
      usePlaybackStore.setState({
        status: 'error',
        error: describeMediaError(el.error),
        playing: false,
        stalled: false,
      });
    });

    // The element may already hold data when we attach (e.g. a re-run effect).
    if (el.readyState >= HTMLMediaElement.HAVE_METADATA) onMetadata();
    if (el.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) onData();

    const detach = () => {
      controller.abort();
      this.stopLoop();
      if (this.el === el) {
        this.el = null;
        this.pendingSeek = null;
        usePlaybackStore.setState({ status: 'idle', playing: false, stalled: false });
      }
      if (this.detachCurrent === detach) this.detachCurrent = null;
    };
    this.detachCurrent = detach;
    return detach;
  }

  /** The position the UI should show: the seek target if one is queued, else the element's time. */
  get time(): number {
    return this.pendingSeek ?? this.el?.currentTime ?? 0;
  }

  /** The bound element, for code that reads pictures or sound from it (thumbnails, recording). */
  get element(): HTMLVideoElement | null {
    return this.el;
  }

  /** True while the picture on screen may not match `time` yet. */
  get isSeeking(): boolean {
    return this.pendingSeek !== null || !!this.el?.seeking;
  }

  get isPlaying(): boolean {
    const el = this.el;
    return !!el && !el.paused && !el.ended;
  }

  /** Calls `listener` whenever the displayed time changes. Returns an unsubscribe function. */
  subscribeTime(listener: TimeListener): () => void {
    this.listeners.add(listener);
    listener(this.time);
    return () => {
      this.listeners.delete(listener);
    };
  }

  play() {
    const el = this.el;
    if (!el || usePlaybackStore.getState().status !== 'ready') return;
    // play() rejects when a pause interrupts it; the element's events keep the UI correct.
    el.play().catch(() => {});
  }

  pause() {
    this.el?.pause();
  }

  toggle() {
    if (this.isPlaying) this.pause();
    else this.play();
  }

  /**
   * Seeks to `time`. Requests made while the decoder is still busy with the
   * previous seek are coalesced: only the most recent one is applied when the
   * decoder is free again, so dragging the playhead never builds up a backlog.
   */
  seek(time: number) {
    const el = this.el;
    if (!el || !Number.isFinite(time)) return;
    if (el.readyState < HTMLMediaElement.HAVE_METADATA) {
      this.startTime = Math.max(0, time);
      return;
    }
    const { duration } = usePlaybackStore.getState();
    this.pendingSeek = Math.min(Math.max(0, time), duration);
    this.emit();
    if (!el.seeking) this.flushSeek();
  }

  seekBy(seconds: number) {
    this.seek(this.time + seconds);
  }

  /**
   * Pauses and moves by whole frames, based on the known frame rate. Browsers
   * do not expose frame-exact seeking, so with unusual encodings (variable
   * frame rate in particular) a step can occasionally repeat or skip a frame.
   */
  stepFrames(delta: number) {
    if (!this.el) return;
    this.pause();
    const { fps, duration } = usePlaybackStore.getState();
    if (duration <= 0) return;
    this.seek(stepFrameTime(this.time, delta, fps, duration));
  }

  setRate(rate: number) {
    if (this.el) this.el.playbackRate = rate;
  }

  /** Moves to the next slower (-1) or faster (+1) preset speed. */
  stepRate(direction: -1 | 1) {
    // Read from the element, not the store: the store follows the asynchronous
    // `ratechange` event, so two quick presses would both start from the old value.
    const rate = this.el?.playbackRate ?? 1;
    const index = PLAYBACK_RATES.indexOf(rate);
    const from = index === -1 ? PLAYBACK_RATES.indexOf(1) : index;
    const next = PLAYBACK_RATES[Math.min(PLAYBACK_RATES.length - 1, Math.max(0, from + direction))];
    if (next !== undefined) this.setRate(next);
  }

  toggleMuted() {
    const muted = !usePlaybackStore.getState().muted;
    if (this.el) this.el.muted = muted;
    usePlaybackStore.setState({ muted });
    rememberMuted(muted);
  }

  private flushSeek() {
    const el = this.el;
    const target = this.pendingSeek;
    if (!el || target === null) return;
    this.pendingSeek = null;
    if (Math.abs(el.currentTime - target) > 1e-6) el.currentTime = target;
  }

  private emit() {
    const time = this.time;
    this.lastEmitted = time;
    for (const listener of this.listeners) listener(time);
  }

  private startLoop() {
    if (this.raf) return;
    const tick = () => {
      this.raf = requestAnimationFrame(tick);
      if (this.time !== this.lastEmitted) this.emit();
    };
    this.raf = requestAnimationFrame(tick);
  }

  private stopLoop() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }
}

export const player = new Player();
