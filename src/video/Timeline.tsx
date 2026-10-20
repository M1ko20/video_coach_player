import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { useAnnotationStore } from '../annotations/annotationStore';
import { formatTime } from '../lib/time';
import { usePlaybackStore } from './playbackStore';
import { player } from './player';

/** With Shift held, the playhead moves this fraction of the pointer's travel. */
const FINE_SCRUB_FACTOR = 0.1;
/** Clicking this close (CSS px) to a drawing marker jumps exactly to it. */
const MARK_SNAP_DISTANCE = 5;

interface Scrub {
  pointerId: number;
  wasPlaying: boolean;
  /** Reference point for fine scrubbing, set while Shift is held. */
  fine: { clientX: number; time: number } | null;
}

interface Mark {
  time: number;
  selected: boolean;
}

/**
 * Seek bar. The playhead and progress fill are positioned by writing to the
 * DOM directly from the player's time feed, so playback and scrubbing never
 * re-render this component.
 */
export function Timeline() {
  const duration = usePlaybackStore((state) => state.duration);
  const ready = usePlaybackStore((state) => state.status === 'ready' && state.duration > 0);
  const items = useAnnotationStore((state) => state.items);
  const selectedId = useAnnotationStore((state) => state.selectedId);

  const rootRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const hoverRef = useRef<HTMLDivElement>(null);
  const hoverLabelRef = useRef<HTMLSpanElement>(null);
  const widthRef = useRef(0);
  const scrubRef = useRef<Scrub | null>(null);
  const lastAriaRef = useRef(-1);
  const [scrubbing, setScrubbing] = useState(false);

  /** One marker per distinct moment at which something was drawn. */
  const marks = useMemo(() => {
    const byTime = new Map<number, Mark>();
    for (const item of items) {
      const key = Math.round(item.anchorTime * 20) / 20;
      const mark = byTime.get(key) ?? { time: item.anchorTime, selected: false };
      mark.selected ||= item.id === selectedId;
      byTime.set(key, mark);
    }
    return [...byTime.values()];
  }, [items, selectedId]);

  const position = useCallback(
    (time: number) => {
      const fraction = duration > 0 ? Math.min(1, Math.max(0, time / duration)) : 0;
      if (fillRef.current) fillRef.current.style.transform = `scaleX(${fraction})`;
      if (thumbRef.current) thumbRef.current.style.transform = `translateX(${fraction * widthRef.current}px)`;

      // Assistive technology does not need 60 updates a second.
      const tenths = Math.round(time * 10);
      if (tenths !== lastAriaRef.current && rootRef.current) {
        lastAriaRef.current = tenths;
        rootRef.current.setAttribute('aria-valuenow', (tenths / 10).toFixed(1));
        rootRef.current.setAttribute('aria-valuetext', `${formatTime(time)} of ${formatTime(duration)}`);
      }
    },
    [duration],
  );

  useLayoutEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const observer = new ResizeObserver(() => {
      widthRef.current = track.clientWidth;
      position(player.time);
    });
    widthRef.current = track.clientWidth;
    observer.observe(track);
    return () => observer.disconnect();
  }, [position]);

  useEffect(() => player.subscribeTime(position), [position]);

  const showHover = (time: number, label: string) => {
    const hover = hoverRef.current;
    const text = hoverLabelRef.current;
    if (!hover || !text || duration <= 0) return;
    const width = widthRef.current;
    const x = (time / duration) * width;
    hover.style.transform = `translateX(${x}px)`;
    hover.dataset.visible = 'true';
    text.textContent = label;
    // Keep the label inside the track at either end.
    const half = text.offsetWidth / 2;
    text.style.transform = `translateX(${Math.min(width - x - half, Math.max(-x + half, 0)) - half}px)`;
  };

  const hideHover = () => {
    if (hoverRef.current) hoverRef.current.dataset.visible = 'false';
  };

  const pointerTime = (clientX: number): number => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return 0;
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)) * duration;
  };

  /** The drawing marker under the pointer, if it is close enough to snap to. */
  const markNear = (clientX: number): Mark | null => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || duration <= 0) return null;
    let best: Mark | null = null;
    let bestDistance = MARK_SNAP_DISTANCE;
    for (const mark of marks) {
      const distance = Math.abs(rect.left + (mark.time / duration) * rect.width - clientX);
      if (distance <= bestDistance) {
        best = mark;
        bestDistance = distance;
      }
    }
    return best;
  };

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!ready || event.button !== 0 || scrubRef.current) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const wasPlaying = player.isPlaying;
    if (wasPlaying) player.pause();
    scrubRef.current = { pointerId: event.pointerId, wasPlaying, fine: null };
    setScrubbing(true);

    const mark = markNear(event.clientX);
    const time = mark ? mark.time : pointerTime(event.clientX);
    player.seek(time);
    showHover(time, formatTime(time));
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!ready) return;
    const scrub = scrubRef.current;

    if (!scrub) {
      const mark = markNear(event.clientX);
      if (mark) showHover(mark.time, `Drawing · ${formatTime(mark.time)}`);
      else {
        const time = pointerTime(event.clientX);
        showHover(time, formatTime(time));
      }
      return;
    }
    if (event.pointerId !== scrub.pointerId) return;

    let time: number;
    if (event.shiftKey) {
      scrub.fine ??= { clientX: event.clientX, time: player.time };
      const travel = (event.clientX - scrub.fine.clientX) / Math.max(1, widthRef.current);
      time = Math.min(duration, Math.max(0, scrub.fine.time + travel * duration * FINE_SCRUB_FACTOR));
    } else {
      scrub.fine = null;
      time = pointerTime(event.clientX);
    }
    player.seek(time);
    showHover(time, event.shiftKey ? `Fine · ${formatTime(time)}` : formatTime(time));
  };

  const endScrub = (event: PointerEvent<HTMLDivElement>) => {
    const scrub = scrubRef.current;
    if (!scrub || event.pointerId !== scrub.pointerId) return;
    scrubRef.current = null;
    setScrubbing(false);
    if (event.pointerType !== 'mouse') hideHover();
    if (scrub.wasPlaying) player.play();
  };

  return (
    <div
      ref={rootRef}
      className={`timeline ${scrubbing ? 'is-scrubbing' : ''}`}
      role="slider"
      tabIndex={ready ? 0 : -1}
      aria-label="Video position"
      aria-orientation="horizontal"
      aria-valuemin={0}
      aria-valuemax={Number(duration.toFixed(1))}
      aria-disabled={!ready}
      data-testid="timeline"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endScrub}
      onPointerCancel={endScrub}
      onPointerLeave={() => {
        if (!scrubRef.current) hideHover();
      }}
    >
      <div className="timeline__track" ref={trackRef}>
        <div className="timeline__bar">
          <div className="timeline__fill" ref={fillRef} />
        </div>
        {duration > 0 &&
          marks.map((mark) => (
            <span
              key={mark.time}
              className={`timeline__mark ${mark.selected ? 'is-selected' : ''}`}
              style={{ left: `${(mark.time / duration) * 100}%` }}
            />
          ))}
        <div className="timeline__hover" ref={hoverRef} data-visible="false">
          <span className="timeline__hover-label" ref={hoverLabelRef} />
        </div>
        <div className="timeline__thumb" ref={thumbRef} />
      </div>
    </div>
  );
}
