import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from 'react';
import { create } from 'zustand';
import { frameAtTime, frameSeekTime, lastFrameIndex } from '../lib/time';
import { usePlaybackStore } from './playbackStore';
import { player } from './player';

const VISIBLE_KEY = 'cva:scrubber';

function readVisible(): boolean {
  try {
    return localStorage.getItem(VISIBLE_KEY) !== '0';
  } catch {
    return true;
  }
}

export const useScrubberStore = create<{ visible: boolean; toggle: () => void }>((set, get) => ({
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

/** Distance between frame ticks, and the drag distance that moves one frame. */
const FRAME_SPACING = 12;
/** Every fifth tick is long. The tick pattern repeats with this period. */
const MAJOR_EVERY = 5;
const PERIOD = FRAME_SPACING * MAJOR_EVERY;
/** Pointer travel (CSS px) before a press becomes a drag rather than a tap. */
const DRAG_THRESHOLD = 6;
/** Trackpad scroll distance (px) per frame. A mouse wheel notch is always one frame. */
const WHEEL_STEP = 24;
/** A flick faster than this (px/ms) keeps the strip turning after release. */
const FLING_MIN_SPEED = 0.35;
/** Fraction of the speed kept per 16 ms while coasting. */
const FLING_FRICTION = 0.94;
const READOUT_HIDE_MS = 700;

interface Drag {
  pointerId: number;
  startX: number;
  /** Frame under the centre line when the gesture began. */
  startFrame: number;
  /** Horizontal travel so far, including coasting after a flick. */
  travel: number;
  target: number;
  moved: boolean;
  /** Recent pointer positions, for the release speed. */
  samples: Array<{ t: number; x: number }>;
}

function formatOffset(frames: number): string {
  if (frames === 0) return '0';
  return `${frames > 0 ? '+' : '−'}${Math.abs(frames)} ${Math.abs(frames) === 1 ? 'frame' : 'frames'}`;
}

/**
 * A jog strip: a ruler with one tick per frame under a fixed centre line.
 * Drag or flick it sideways to move frame by frame, tap either side of the
 * centre to step one frame, or scroll over it. Built for fingers as much as
 * for a mouse.
 *
 * It has no pictures, so following the playhead costs one transform per frame
 * change, written straight to the DOM like the timeline's playhead.
 */
export function FrameScrubber() {
  const visible = useScrubberStore((state) => state.visible);
  const ready = usePlaybackStore((state) => state.status === 'ready' && state.duration > 0);
  const duration = usePlaybackStore((state) => state.duration);
  const fps = usePlaybackStore((state) => state.fps);
  const playing = usePlaybackStore((state) => state.playing);

  const viewportRef = useRef<HTMLDivElement>(null);
  const ticksRef = useRef<HTMLDivElement>(null);
  const readoutRef = useRef<HTMLSpanElement>(null);
  const dragRef = useRef<Drag | null>(null);
  const flingRef = useRef(0);
  const readoutTimerRef = useRef(0);
  const frameRef = useRef(0);
  const residualRef = useRef(0);
  /** Left edge of the centre line, in whole pixels. Ticks are 2px wide and start at their position, like the line. */
  const [center, setCenter] = useState(0);
  const [dragging, setDragging] = useState(false);

  const last = duration > 0 ? lastFrameIndex(duration, fps) : 0;

  /** Positions the ruler for the current frame plus the in-between drag offset. */
  const placeTicks = useCallback(() => {
    const shift = (frameRef.current * FRAME_SPACING) % PERIOD;
    if (ticksRef.current) ticksRef.current.style.transform = `translate3d(${residualRef.current - shift}px, 0, 0)`;
  }, []);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const measure = () => setCenter(Math.round(viewport.clientWidth / 2) - 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    frameRef.current = -1;
    return player.subscribeTime((time) => {
      const frame = frameAtTime(time, fps);
      if (frame === frameRef.current) return;
      frameRef.current = frame;
      placeTicks();
    });
  }, [visible, fps, placeTicks]);

  const stopFling = () => {
    if (flingRef.current) cancelAnimationFrame(flingRef.current);
    flingRef.current = 0;
  };

  useEffect(
    () => () => {
      if (flingRef.current) cancelAnimationFrame(flingRef.current);
      clearTimeout(readoutTimerRef.current);
    },
    [],
  );

  const showReadout = (text: string) => {
    const readout = readoutRef.current;
    if (!readout) return;
    clearTimeout(readoutTimerRef.current);
    readout.textContent = text;
    readout.dataset.visible = 'true';
  };

  const hideReadoutSoon = () => {
    clearTimeout(readoutTimerRef.current);
    readoutTimerRef.current = window.setTimeout(() => {
      if (readoutRef.current) readoutRef.current.dataset.visible = 'false';
    }, READOUT_HIDE_MS);
  };

  /** Moves to the frame the gesture's travel points at. Dragging left brings later frames to the centre. */
  const follow = (drag: Drag) => {
    const target = Math.min(last, Math.max(0, drag.startFrame + Math.round(-drag.travel / FRAME_SPACING)));
    if (target !== drag.target) {
      drag.target = target;
      player.seek(frameSeekTime(target, fps, duration));
    }
    // Between frames the ruler follows the finger; at either end of the video it stops.
    const residual = drag.travel + (target - drag.startFrame) * FRAME_SPACING;
    residualRef.current = Math.min(FRAME_SPACING / 2, Math.max(-FRAME_SPACING / 2, residual));
    frameRef.current = target;
    placeTicks();
    showReadout(formatOffset(target - drag.startFrame));
  };

  const settle = () => {
    residualRef.current = 0;
    placeTicks();
    setDragging(false);
    hideReadoutSoon();
  };

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

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    // A coasting flick has released its pointer (id -1); a new press takes over and stops it there.
    if (!ready || event.button !== 0 || (dragRef.current && dragRef.current.pointerId !== -1)) return;
    const wasFlinging = flingRef.current !== 0;
    stopFling();
    event.currentTarget.setPointerCapture(event.pointerId);
    player.pause();
    const startFrame = frameAtTime(player.time, fps);
    frameRef.current = startFrame;
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startFrame,
      travel: 0,
      target: startFrame,
      moved: wasFlinging,
      samples: [{ t: event.timeStamp, x: event.clientX }],
    };
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    const travel = event.clientX - drag.startX;
    if (!drag.moved) {
      if (Math.abs(travel) < DRAG_THRESHOLD) return;
      drag.moved = true;
      setDragging(true);
    }
    drag.travel = travel;
    drag.samples.push({ t: event.timeStamp, x: event.clientX });
    while (drag.samples.length > 2 && event.timeStamp - drag.samples[0]!.t > 100) drag.samples.shift();
    follow(drag);
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;

    if (!drag.moved) {
      // A tap: one frame towards the side that was tapped.
      dragRef.current = null;
      const rect = event.currentTarget.getBoundingClientRect();
      player.stepFrames(event.clientX < rect.left + rect.width / 2 ? -1 : 1);
      return;
    }

    const first = drag.samples[0]!;
    const elapsed = event.timeStamp - first.t;
    let speed = elapsed > 0 ? (event.clientX - first.x) / elapsed : 0;
    if (Math.abs(speed) < FLING_MIN_SPEED) {
      dragRef.current = null;
      settle();
      return;
    }

    // A flick: keep turning and slow down, as a jog wheel does.
    let previous = performance.now();
    const coast = (now: number) => {
      const dt = Math.min(48, now - previous);
      previous = now;
      drag.travel += speed * dt;
      speed *= FLING_FRICTION ** (dt / 16);
      follow(drag);
      const atEnd = drag.target === 0 || drag.target === last;
      if (Math.abs(speed) < 0.03 || atEnd) {
        flingRef.current = 0;
        if (dragRef.current === drag) dragRef.current = null;
        settle();
        return;
      }
      flingRef.current = requestAnimationFrame(coast);
    };
    // Released, but kept as the active gesture so a new touch can stop it.
    drag.pointerId = -1;
    flingRef.current = requestAnimationFrame(coast);
  };

  const onPointerCancel = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || event.pointerId !== drag.pointerId) return;
    dragRef.current = null;
    settle();
  };

  return (
    <div className={`scrubber ${dragging || playing ? 'is-live' : ''}`} aria-disabled={!ready} data-testid="scrubber">
      <div
        ref={viewportRef}
        className="scrubber__viewport"
        role="group"
        aria-label="Frame scrubber: drag sideways to move frame by frame, tap a side to step one frame"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      >
        <div
          ref={ticksRef}
          className="scrubber__ticks"
          style={{ left: (center % PERIOD) - PERIOD, backgroundSize: `${PERIOD}px 62%, ${FRAME_SPACING}px 34%` }}
        />
        <div className="scrubber__center" style={{ left: center }} />
      </div>
      <span ref={readoutRef} className="scrubber__readout" data-visible="false" data-testid="scrubber-readout" />
    </div>
  );
}
