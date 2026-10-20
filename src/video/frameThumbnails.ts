import { timeOfFrame } from '../lib/time';

/** Thumbnails kept in memory. At strip size each is well under 100 KB. */
const CACHE_LIMIT = 240;
/** A seek that has not finished by then is given up, so one bad frame cannot stall the queue. */
const SEEK_TIMEOUT_MS = 2000;

/**
 * Small pictures of individual frames for the film strip.
 *
 * Frames are decoded by a second, hidden <video> on the same file, so making
 * thumbnails never moves the picture the user is looking at. Requests are a
 * priority list that each call replaces: only frames that are still wanted get
 * decoded. Frames the main video is already showing can be stored directly
 * with `capture`, which costs one small canvas draw.
 */
export class FrameThumbnails {
  private readonly video: HTMLVideoElement;
  /** Insertion order doubles as recency order: `get` re-inserts. */
  private readonly cache = new Map<number, HTMLCanvasElement>();
  private queue: number[] = [];
  private busy = false;
  private ready = false;
  private disposed = false;

  /** Called whenever a frame's thumbnail becomes available. */
  onFrame: ((frame: number) => void) | null = null;

  constructor(
    url: string,
    private readonly fps: number,
    private readonly width: number,
    private readonly height: number,
  ) {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.addEventListener(
      'loadeddata',
      () => {
        this.ready = true;
        void this.pump();
      },
      { once: true },
    );
    video.src = url;
    this.video = video;
  }

  get(frame: number): HTMLCanvasElement | undefined {
    const thumb = this.cache.get(frame);
    if (thumb) {
      this.cache.delete(frame);
      this.cache.set(frame, thumb);
    }
    return thumb;
  }

  /** Replaces the list of frames to decode, most wanted first. Cached frames are skipped. */
  want(frames: readonly number[]) {
    this.queue = frames.filter((frame) => !this.cache.has(frame));
    void this.pump();
  }

  /** Stores what `source` is showing right now as the thumbnail of `frame`. */
  capture(frame: number, source: HTMLVideoElement) {
    if (this.cache.has(frame) || source.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
    this.store(frame, source);
  }

  dispose() {
    this.disposed = true;
    this.queue = [];
    this.onFrame = null;
    this.cache.clear();
    this.video.removeAttribute('src');
    this.video.load();
  }

  private store(frame: number, source: CanvasImageSource) {
    const canvas = document.createElement('canvas');
    canvas.width = this.width;
    canvas.height = this.height;
    canvas.getContext('2d')?.drawImage(source, 0, 0, this.width, this.height);
    this.cache.set(frame, canvas);
    if (this.cache.size > CACHE_LIMIT) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) this.cache.delete(oldest);
    }
    this.onFrame?.(frame);
  }

  private async pump() {
    if (this.busy || !this.ready) return;
    this.busy = true;
    try {
      while (!this.disposed) {
        const frame = this.queue.shift();
        if (frame === undefined) break;
        if (this.cache.has(frame)) continue;
        if (await this.seek(timeOfFrame(frame, this.fps))) {
          if (!this.disposed && !this.cache.has(frame)) this.store(frame, this.video);
        }
      }
    } finally {
      this.busy = false;
    }
  }

  private seek(time: number): Promise<boolean> {
    const video = this.video;
    return new Promise((resolve) => {
      const finish = (ok: boolean) => {
        clearTimeout(timer);
        video.removeEventListener('seeked', onSeeked);
        resolve(ok);
      };
      const onSeeked = () => finish(true);
      const timer = setTimeout(() => finish(false), SEEK_TIMEOUT_MS);
      video.addEventListener('seeked', onSeeked);
      video.currentTime = Math.min(time, Math.max(0, video.duration - 0.001));
    });
  }
}
