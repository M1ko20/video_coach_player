import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { create } from 'zustand';
import { useAnnotationStore } from '../annotations/annotationStore';
import { useProjectStore } from '../project/projectStore';
import { frameAtTime, frameSeekTime, lastFrameIndex } from '../lib/time';
import { FrameThumbnails } from './frameThumbnails';
import { usePlaybackStore } from './playbackStore';
import { player } from './player';

const VISIBLE_KEY = 'cva:filmstrip';

function readVisible(): boolean {
  try {
    return localStorage.getItem(VISIBLE_KEY) !== '0';
  } catch {
    return true;
  }
}

export const useFilmstripStore = create<{ visible: boolean; toggle: () => void }>((set, get) => ({
  visible: readVisible(),
  toggle: () => {
    const visible = !get().visible;
    set({ visible });
    try {
      localStorage.setItem(VISIBLE_KEY, visible ? '1' : '0');
    } catch {
      // Preference only; ignore unavailable storage.
    }
  },
}));

/** Height of the perforated band above and below the frames. Keep in step with `.filmstrip__viewport`. */
const BAND = 8;
const GAP = 4;
/** Pointer travel (CSS px) before a press becomes a drag rather than a click. */
const DRAG_THRESHOLD = 4;
/** Trackpad scroll distance (px) per frame. A mouse wheel notch is always one frame. */
const WHEEL_STEP = 24;
/** Thumbnails are decoded only once the strip has been still for this long, so they never slow down a seek. */
const DECODE_DELAY_MS = 120;

interface Layout {
  slotWidth: number;
  slotHeight: number;
  /** Always odd, so one slot sits exactly in the middle. */
  count: number;
  /** Left edge of the row, which puts the middle slot at the centre of the strip. */
  offset: number;
}

interface Drag {
  pointerId: number;
  startX: number;
  startFrame: number;
  target: number;
  moved: boolean;
}

function computeLayout(width: number, height: number, aspect: number): Layout | null {
  const slotHeight = height - BAND * 2;
  if (width <= 0 || slotHeight <= 0) return null;
  const slotWidth = Math.round(slotHeight * Math.min(2.4, Math.max(0.75, aspect)));
  const step = slotWidth + GAP;
  // Two extra slots keep the edges filled while the row is dragged sideways.
  let count = Math.floor((width + GAP) / step) + 2;
  if (count % 2 === 0) count += 1;
  const mid = (count - 1) / 2;
  return { slotWidth, slotHeight, count, offset: Math.round(width / 2 - mid * step - slotWidth / 2) };
}

/**
 * A strip of neighbouring frames, like a piece of film, centred on the frame
 * being shown. Drag it sideways to move frame by frame, click a frame to jump
 * to it, or scroll over it.
 *
 * Like the timeline it follows the playhead without React: each slot is a
 * canvas repainted from the thumbnail cache when the current frame changes.
 */
export function Filmstrip() {
  const visible = useFilmstripStore((state) => state.visible);
  const videoUrl = useProjectStore((state) => (state.videoStatus === 'ready' ? state.videoUrl : null));
  const aspect = useProjectStore((state) => (state.project ? state.project.video.width / state.project.video.height : 16 / 9));
  const ready = usePlaybackStore((state) => state.status === 'ready' && state.duration > 0);
  const duration = usePlaybackStore((state) => state.duration);
  const fps = usePlaybackStore((state) => state.fps);
  const items = useAnnotationStore((state) => state.items);

  const viewportRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const slotRefs = useRef<Array<HTMLDivElement | null>>([]);
  const canvasRefs = useRef<Array<HTMLCanvasElement | null>>([]);
  /** Frame each slot currently shows (-1: outside the video, -2: not painted yet), and whether its picture is drawn. */
  const shownRef = useRef<Array<{ frame: number; drawn: boolean }>>([]);
  const thumbsRef = useRef<FrameThumbnails | null>(null);
  const centerRef = useRef(-1);
  const dragRef = useRef<Drag | null>(null);
  const [layout, setLayout] = useState<Layout | null>(null);
  const [dragging, setDragging] = useState(false);

  /** Frames at which something was drawn get a marker, as on the timeline. */
  const marked = useMemo(() => new Set(items.map((item) => frameAtTime(item.anchorTime, fps))), [items, fps]);
  const markedRef = useRef(marked);

  const last = duration > 0 ? lastFrameIndex(duration, fps) : -1;

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const measure = () => {
      const next = computeLayout(viewport.clientWidth, viewport.clientHeight, aspect);
      setLayout((previous) =>
        previous &&
        next &&
        previous.slotWidth === next.slotWidth &&
        previous.slotHeight === next.slotHeight &&
        previous.count === next.count &&
        previous.offset === next.offset
          ? previous
          : next,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [aspect, visible]);

  useEffect(() => {
    if (!visible || !layout || !ready || !videoUrl) return;
    const { count, slotWidth, slotHeight } = layout;
    const mid = (count - 1) / 2;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const pixelWidth = Math.round(slotWidth * dpr);
    const pixelHeight = Math.round(slotHeight * dpr);
    const thumbs = new FrameThumbnails(videoUrl, fps, pixelWidth, pixelHeight);
    thumbsRef.current = thumbs;
    shownRef.current = Array.from({ length: count }, () => ({ frame: -2, drawn: false }));
    for (const canvas of canvasRefs.current) {
      if (!canvas) continue;
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }

    const paint = () => {
      const center = centerRef.current;
      for (let i = 0; i < count; i++) {
        const slot = slotRefs.current[i];
        const canvas = canvasRefs.current[i];
        const shown = shownRef.current[i];
        if (!slot || !canvas || !shown) continue;
        const frame = center + i - mid;
        if (frame < 0 || frame > last) {
          if (shown.frame !== -1) {
            shown.frame = -1;
            slot.dataset.state = 'empty';
          }
          continue;
        }
        const thumb = thumbs.get(frame);
        if (shown.frame === frame && (shown.drawn || !thumb)) continue;
        const ctx = canvas.getContext('2d');
        if (!ctx) continue;
        if (thumb) ctx.drawImage(thumb, 0, 0);
        else ctx.clearRect(0, 0, canvas.width, canvas.height);
        shown.frame = frame;
        shown.drawn = !!thumb;
        slot.dataset.state = thumb ? 'ready' : 'loading';
        slot.dataset.marked = String(markedRef.current.has(frame));
      }
    };

    let decodeTimer = 0;
    const decodeAround = () => {
      decodeTimer = 0;
      const center = centerRef.current;
      const wanted: number[] = [];
      for (let distance = 0; distance <= mid; distance++) {
        for (const frame of distance === 0 ? [center] : [center + distance, center - distance]) {
          if (frame >= 0 && frame <= last) wanted.push(frame);
        }
      }
      thumbs.want(wanted);
    };

    thumbs.onFrame = (frame) => {
      if (Math.abs(frame - centerRef.current) <= mid) paint();
    };

    const onTime = (time: number) => {
      const center = Math.min(last, frameAtTime(time, fps));
      if (center !== centerRef.current) {
        centerRef.current = center;
        paint();
      }
      // The main video already shows this frame: keep it, it is free.
      const video = player.element;
      if (video && !player.isSeeking) thumbs.capture(center, video);
      // Decoding while playing would only fall behind; fill in once the picture is still.
      if (!player.isPlaying) {
        clearTimeout(decodeTimer);
        decodeTimer = window.setTimeout(decodeAround, DECODE_DELAY_MS);
      }
    };

    centerRef.current = -1;
    const unsubscribe = player.subscribeTime(onTime);
    // Playback stops without a time change at the end of a play; decode then too.
    const unsubscribePlayback = usePlaybackStore.subscribe((state, previous) => {
      if (previous.playing && !state.playing) onTime(player.time);
    });

    return () => {
      unsubscribe();
      unsubscribePlayback();
      clearTimeout(decodeTimer);
      thumbs.dispose();
      if (thumbsRef.current === thumbs) thumbsRef.current = null;
    };
  }, [visible, layout, ready, videoUrl, fps, last]);

  // Drawings changed: refresh the markers without touching the pictures.
  useEffect(() => {
    markedRef.current = marked;
    const center = centerRef.current;
    const mid = layout ? (layout.count - 1) / 2 : 0;
    slotRefs.current.forEach((slot, i) => {
      if (slot) slot.dataset.marked = String(marked.has(center + i - mid));
    });
  }, [marked, layout]);

  // Scrolling over the strip steps frames. Needs a non-passive listener to stop the page from scrolling.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport || !ready) return;
    let accumulated = 0;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const raw = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      const delta = event.deltaMode === WheelEvent.DOM_DELTA_PIXEL ? raw : raw * 16;
      // A mouse wheel sends large, discrete deltas: one notch, one frame.
      if (Math.abs(delta) >= 50) {
        accumulated = 0;
        player.stepFrames(Math.sign(delta));
        return;
      }
      accumulated += delta;
      while (Math.abs(accumulated) >= WHEEL_STEP) {
        const direction = Math.sign(accumulated);
        accumulated -= direction * WHEEL_STEP;
        player.stepFrames(direction);
      }
    };
    viewport.addEventListener('wheel', onWheel, { passive: false });
    return () => viewport.removeEventListener('wheel', onWheel);
  }, [ready, visible]);

  if (!visible) return null;

  const mid = layout ? (layout.count - 1) / 2 : 0;
  const step = layout ? layout.slotWidth + GAP : 1;

  const setResidual = (px: number) => {
    if (rowRef.current) rowRef.current.style.transform = `translateX(${px}px)`;
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!ready || !layout || event.button !== 0 || dragRef.current) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    player.pause();
    const startFrame = Math.max(0, centerRef.current);
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startFrame, target: startFrame, moved: false };
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    const dx = event.clientX - drag.startX;
    if (!drag.moved) {
      if (Math.abs(dx) < DRAG_THRESHOLD) return;
      drag.moved = true;
      setDragging(true);
    }
    // Dragging left pulls later frames into the middle, as when pulling film through a viewer.
    const target = Math.min(last, Math.max(0, drag.startFrame + Math.round(-dx / step)));
    if (target !== drag.target) {
      drag.target = target;
      player.seek(frameSeekTime(target, fps, duration));
    }
    // The row follows the pointer between frames; at either end of the video it stops.
    const residual = dx + (target - drag.startFrame) * step;
    setResidual(Math.min(step / 2, Math.max(-step / 2, residual)));
  };

  const endDrag = (event: PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    dragRef.current = null;
    setDragging(false);
    setResidual(0);
    if (drag.moved || cancelled) return;
    // A click: jump to the frame that was clicked. Pointer capture retargets the
    // event to the strip itself, so look up what is actually under the pointer.
    const slot = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-slot]');
    if (!slot) return;
    const frame = drag.startFrame + Number(slot.dataset.slot) - mid;
    if (frame >= 0 && frame <= last && frame !== drag.startFrame) player.seek(frameSeekTime(frame, fps, duration));
  };

  return (
    <div className={`filmstrip ${dragging ? 'is-dragging' : ''}`} aria-disabled={!ready} data-testid="filmstrip">
      <div
        className="filmstrip__viewport"
        ref={viewportRef}
        role="group"
        aria-label="Frame strip: drag sideways to move frame by frame"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(event) => endDrag(event, false)}
        onPointerCancel={(event) => endDrag(event, true)}
      >
        {layout && (
          <div className="filmstrip__row" ref={rowRef} style={{ left: layout.offset, gap: GAP }}>
            {Array.from({ length: layout.count }, (_, i) => {
              const offset = i - mid;
              return (
                <div
                  key={i}
                  ref={(element) => {
                    slotRefs.current[i] = element;
                  }}
                  className={`filmstrip__slot ${offset === 0 ? 'filmstrip__slot--center' : ''}`}
                  style={{ width: layout.slotWidth, height: layout.slotHeight }}
                  data-slot={i}
                  data-state="loading"
                  title={offset === 0 ? 'Current frame' : `${offset > 0 ? '+' : '−'}${Math.abs(offset)} frame${Math.abs(offset) === 1 ? '' : 's'}`}
                >
                  <canvas
                    ref={(element) => {
                      canvasRefs.current[i] = element;
                    }}
                  />
                  {offset !== 0 && (
                    <span className="filmstrip__label">
                      {offset > 0 ? '+' : '−'}
                      {Math.abs(offset)}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
