import { LoaderCircle } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AnnotationOverlay } from '../annotations/AnnotationOverlay';
import { useAnnotationStore } from '../annotations/annotationStore';
import { REF_HEIGHT } from '../annotations/constants';
import { TextEditor } from '../annotations/TextEditor';
import { MissingVideo } from '../project/MissingVideo';
import { useProjectStore } from '../project/projectStore';
import { usePlaybackStore } from './playbackStore';
import { player } from './player';

interface Size {
  width: number;
  height: number;
}

/** Largest whole-pixel box of the given aspect ratio that fits inside `container`. */
function fitInside(container: Size, aspect: number): Size {
  if (container.width <= 0 || container.height <= 0 || !(aspect > 0)) return { width: 0, height: 0 };
  let width = container.width;
  let height = width / aspect;
  if (height > container.height) {
    height = container.height;
    width = height * aspect;
  }
  return { width: Math.floor(width), height: Math.floor(height) };
}

/**
 * The video and the drawing layer on top of it.
 *
 * Both are children of one "frame" element sized here, in whole pixels, to the
 * video's aspect ratio. They each fill that frame, so they always share the
 * same box. A ResizeObserver re-fits the frame whenever the available space
 * changes; the aspect ratio is known before the video loads, so there is no
 * layout shift when it does.
 */
export function VideoStage() {
  const videoUrl = useProjectStore((state) => state.videoUrl);
  const videoStatus = useProjectStore((state) => state.videoStatus);
  const aspect = useProjectStore((state) => (state.project ? state.project.video.width / state.project.video.height : 16 / 9));
  const status = usePlaybackStore((state) => state.status);
  const error = usePlaybackStore((state) => state.error);
  const stalled = usePlaybackStore((state) => state.stalled);
  const drawingCount = useAnnotationStore((state) => state.items.length);

  const stageRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [available, setAvailable] = useState<Size>({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const measure = (width: number, height: number) =>
      setAvailable((previous) => (previous.width === width && previous.height === height ? previous : { width, height }));
    measure(stage.clientWidth, stage.clientHeight);
    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (box) measure(box.width, box.height);
    });
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !videoUrl) return;
    // The source is set here rather than through a JSX prop so that this effect
    // owns it completely: whatever it sets, its cleanup removes.
    const detach = player.attach(video, useProjectStore.getState().startTime);
    video.src = videoUrl;
    return () => {
      detach();
      // Release the decoder and the reference to the file promptly.
      video.removeAttribute('src');
      video.load();
    };
  }, [videoUrl]);

  const frame = fitInside(available, aspect);
  const scale = frame.height / REF_HEIGHT;
  const hasSource = videoStatus === 'ready' && !!videoUrl;
  const failed = hasSource && status === 'error';

  return (
    <div className="stage" ref={stageRef}>
      {hasSource && (
        // Kept mounted when playback fails, so the error state is not lost by unmounting the element.
        <div
          className="stage__frame"
          style={{
            width: frame.width,
            height: frame.height,
            // Centred on whole pixels; a half-pixel offset would blur the video.
            left: Math.floor((available.width - frame.width) / 2),
            top: Math.floor((available.height - frame.height) / 2),
          }}
          hidden={failed}
          data-testid="video-frame"
        >
          <video
            ref={videoRef}
            className="stage__video"
            playsInline
            preload="auto"
            disablePictureInPicture
            data-testid="video"
          />
          {frame.width > 0 && <AnnotationOverlay aspect={aspect} scale={scale} />}
          <TextEditor scale={scale} />
          {(status === 'loading' || stalled) && (
            <div className="stage__loading" role="status">
              <LoaderCircle size={28} className="spin" />
              <span className="visually-hidden">Loading video</span>
            </div>
          )}
        </div>
      )}
      {(!hasSource || failed) && (
        <MissingVideo reason={failed ? (error ?? undefined) : undefined} drawingCount={drawingCount} />
      )}
    </div>
  );
}
