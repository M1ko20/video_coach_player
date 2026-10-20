import { estimateFrameRate } from '../lib/time';

export interface VideoInfo {
  duration: number;
  width: number;
  height: number;
}

export class VideoFileError extends Error {}

const VIDEO_EXTENSIONS = /\.(mp4|m4v|mov|webm|mkv|ogv|ogg|avi|mpg|mpeg|3gp|ts|mts)$/i;

/** Cheap check before touching a decoder. The real test is `inspectVideo`. */
export function looksLikeVideo(file: File): boolean {
  return file.type.startsWith('video/') || (file.type === '' && VIDEO_EXTENSIONS.test(file.name));
}

function once(target: EventTarget, type: string, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => target.addEventListener(type, () => resolve(), { once: true, signal }));
}

function releaseVideo(video: HTMLVideoElement) {
  video.pause();
  video.removeAttribute('src');
  video.load();
  video.remove();
}

/**
 * Confirms the browser can actually decode a video and reads its basic
 * properties. Rejects with a `VideoFileError` carrying a message fit to show.
 */
export function inspectVideo(url: string, timeoutMs = 20_000): Promise<VideoInfo> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    const controller = new AbortController();
    const { signal } = controller;

    const finish = (result: VideoInfo | VideoFileError) => {
      clearTimeout(timer);
      controller.abort();
      releaseVideo(video);
      if (result instanceof VideoFileError) reject(result);
      else resolve(result);
    };

    const report = () => {
      if (video.videoWidth === 0 || video.videoHeight === 0) {
        finish(new VideoFileError('This file has no video track that this browser can show.'));
        return;
      }
      if (!Number.isFinite(video.duration) || video.duration <= 0) {
        finish(new VideoFileError('The length of this video could not be determined.'));
        return;
      }
      finish({ duration: video.duration, width: video.videoWidth, height: video.videoHeight });
    };

    // Guards against a file that never produces an event either way.
    const timer = setTimeout(() => {
      if (video.readyState >= HTMLMediaElement.HAVE_METADATA) report();
      else finish(new VideoFileError('The video took too long to open. The file may be damaged.'));
    }, timeoutMs);

    video.addEventListener(
      'error',
      () => {
        const unsupported = video.error?.code === MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED;
        finish(
          new VideoFileError(
            unsupported
              ? 'This browser can’t play this file. Try an MP4 (H.264) or WebM video.'
              : 'This video file appears to be damaged and can’t be opened.',
          ),
        );
      },
      { signal },
    );

    video.addEventListener(
      'loadeddata',
      () => {
        if (Number.isFinite(video.duration)) {
          report();
          return;
        }
        // Some recordings (e.g. straight from MediaRecorder) report an infinite
        // duration until the browser is forced to scan to the end.
        video.addEventListener('durationchange', () => Number.isFinite(video.duration) && report(), { signal });
        video.currentTime = Number.MAX_SAFE_INTEGER;
      },
      { signal },
    );

    video.muted = true;
    video.preload = 'auto';
    video.src = url;
  });
}

export interface VideoSample {
  /** Measured frame rate, or `null` when it could not be measured. */
  fps: number | null;
  /** Small JPEG data URL for the library, or `null` when capture failed. */
  thumbnail: string | null;
}

const FRAMES_TO_SAMPLE = 24;
const THUMBNAIL_WIDTH = 480;

function captureThumbnail(video: HTMLVideoElement): string | null {
  if (video.videoWidth === 0) return null;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = THUMBNAIL_WIDTH;
    canvas.height = Math.round((THUMBNAIL_WIDTH * video.videoHeight) / video.videoWidth);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.72);
  } catch {
    return null;
  }
}

/**
 * Measures the frame rate and grabs a thumbnail using a throwaway, muted video
 * element, so the video the coach is looking at is never disturbed.
 *
 * The rate comes from the media timestamps of frames the browser actually
 * presents (`requestVideoFrameCallback`). Where that API is missing, or the tab
 * is in the background and no frames are presented, `fps` is `null` and the
 * caller falls back to an assumed rate.
 */
export async function sampleVideo(url: string, signal: AbortSignal, timeoutMs = 6000): Promise<VideoSample> {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.setAttribute('aria-hidden', 'true');
  // Kept in the viewport: browsers may suspend decoding for off-screen videos.
  video.style.cssText =
    'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0;pointer-events:none;z-index:-1';

  const local = new AbortController();
  const abort = () => local.abort();
  signal.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, timeoutMs);

  const times: number[] = [];
  let fps: number | null = null;
  let thumbnail: string | null = null;

  try {
    document.body.append(video);
    video.src = url;

    const ready =
      video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA ? Promise.resolve() : once(video, 'loadeddata', local.signal);
    const failed = new Promise<never>((_, reject) => {
      video.addEventListener('error', () => reject(new Error('sample failed')), { once: true, signal: local.signal });
      local.signal.addEventListener('abort', () => reject(new Error('sample aborted')), { once: true });
    });
    failed.catch(() => {});
    await Promise.race([ready, failed]);

    // Sample a little way in: opening frames are often black or a title card.
    const start = Math.min(video.duration * 0.1, 3);
    if (Number.isFinite(start) && start > 0) {
      video.currentTime = start;
      await Promise.race([once(video, 'seeked', local.signal), failed]);
    }
    thumbnail = captureThumbnail(video);

    if (typeof video.requestVideoFrameCallback === 'function') {
      const collected = new Promise<void>((resolve) => {
        const onFrame: VideoFrameRequestCallback = (_now, metadata) => {
          times.push(metadata.mediaTime);
          if (times.length >= FRAMES_TO_SAMPLE || local.signal.aborted) resolve();
          else video.requestVideoFrameCallback(onFrame);
        };
        video.requestVideoFrameCallback(onFrame);
      });
      const ended = once(video, 'ended', local.signal);
      await video.play();
      await Promise.race([collected, ended, failed]);
    }
  } catch {
    // Timed out, aborted, or playback was refused: report whatever was gathered.
  } finally {
    fps = estimateFrameRate(times);
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
    local.abort();
    releaseVideo(video);
  }

  return { fps, thumbnail };
}
