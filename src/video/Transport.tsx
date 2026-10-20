import { Check, Maximize, Minimize, Pause, Play, StepBack, StepForward, Volume2, VolumeX } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useProjectStore } from '../project/projectStore';
import { setManualFrameRate } from '../project/session';
import { formatFrameRate, formatTime, frameAtTime } from '../lib/time';
import { toggleFullscreen, useFullscreen } from '../ui/fullscreen';
import { IconButton, keepFocus } from '../ui/IconButton';
import { useRepeatPress } from '../ui/useRepeatPress';
import { PLAYBACK_RATES, usePlaybackStore } from './playbackStore';
import { player } from './player';

const MANUAL_RATES = [24, 25, 30, 50, 60];

/** Current time and frame number, written straight to the DOM as the video plays. */
function TimeReadout() {
  const duration = usePlaybackStore((state) => state.duration);
  const fps = usePlaybackStore((state) => state.fps);
  const timeRef = useRef<HTMLSpanElement>(null);
  const frameRef = useRef<HTMLSpanElement>(null);

  useEffect(
    () =>
      player.subscribeTime((time) => {
        if (timeRef.current) timeRef.current.textContent = formatTime(time);
        if (frameRef.current) frameRef.current.textContent = String(frameAtTime(time, fps) + 1);
      }),
    [fps],
  );

  return (
    <div className="readout">
      <span className="readout__time">
        <span ref={timeRef} data-testid="current-time">
          0:00.00
        </span>
        <span className="readout__duration"> / {formatTime(duration)}</span>
      </span>
      <span className="readout__frame" data-tooltip="Frame number, based on the frame rate shown on the right" data-tooltip-side="top">
        Frame <span ref={frameRef} data-testid="current-frame">1</span>
      </span>
    </div>
  );
}

/** Shows which frame rate frame stepping uses, how it was obtained, and lets it be overridden. */
function FrameRateControl() {
  const fps = usePlaybackStore((state) => state.fps);
  const source = usePlaybackStore((state) => state.fpsSource);
  const measured = useProjectStore((state) => state.project?.measuredFps ?? null);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: globalThis.PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown, true);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [open]);

  const choose = (value: number | null) => {
    setManualFrameRate(value);
    setOpen(false);
  };

  return (
    <div className="fps" ref={rootRef}>
      <button
        type="button"
        className={`chip ${source === 'assumed' ? 'chip--warning' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        data-tooltip={open ? undefined : 'Frame rate used for frame-by-frame stepping'}
        data-tooltip-side="top"
        data-testid="fps-button"
        onMouseDown={keepFocus}
        onClick={() => setOpen((value) => !value)}
      >
        {source === 'assumed' ? '~' : ''}
        {formatFrameRate(fps)} fps
      </button>

      {open && (
        <div className="menu" role="menu" aria-label="Frame rate">
          <p className="menu__note">
            {source === 'measured' && `Measured from this video: ${formatFrameRate(fps)} fps.`}
            {source === 'manual' && 'Set manually.'}
            {source === 'assumed' &&
              'The frame rate could not be measured yet, so 30 fps is assumed. Pick the correct rate if you know it.'}{' '}
            Stepping is as exact as the browser’s video decoder allows; footage with a variable frame rate can
            occasionally repeat or skip a frame.
          </p>
          <button type="button" role="menuitemradio" aria-checked={source !== 'manual'} className="menu__item" onClick={() => choose(null)}>
            <span className="menu__check">{source !== 'manual' && <Check size={14} />}</span>
            Automatic{measured ? ` (${formatFrameRate(measured)} fps)` : ''}
          </button>
          {MANUAL_RATES.map((rate) => {
            const checked = source === 'manual' && fps === rate;
            return (
              <button
                key={rate}
                type="button"
                role="menuitemradio"
                aria-checked={checked}
                className="menu__item"
                onClick={() => choose(rate)}
              >
                <span className="menu__check">{checked && <Check size={14} />}</span>
                {rate} fps
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Playback controls below the timeline. */
export function Transport() {
  const ready = usePlaybackStore((state) => state.status === 'ready');
  const playing = usePlaybackStore((state) => state.playing);
  const rate = usePlaybackStore((state) => state.rate);
  const muted = usePlaybackStore((state) => state.muted);
  const fullscreen = useFullscreen();
  const stepBack = useRepeatPress(() => player.stepFrames(-1));
  const stepForward = useRepeatPress(() => player.stepFrames(1));

  return (
    <div className="transport">
      <div className="transport__left">
        <TimeReadout />
      </div>

      <div className="transport__center" role="group" aria-label="Playback">
        <IconButton label="Previous frame" shortcut="," disabled={!ready} {...stepBack}>
          <StepBack size={18} />
        </IconButton>
        <IconButton
          label={playing ? 'Pause' : 'Play'}
          shortcut="Space"
          variant="primary"
          className="transport__play"
          disabled={!ready}
          data-testid="play-button"
          onClick={() => player.toggle()}
        >
          {playing ? <Pause size={20} fill="currentColor" strokeWidth={0} /> : <Play size={20} fill="currentColor" strokeWidth={0} />}
        </IconButton>
        <IconButton label="Next frame" shortcut="." disabled={!ready} {...stepForward}>
          <StepForward size={18} />
        </IconButton>
      </div>

      <div className="transport__right">
        <div className="segmented" role="radiogroup" aria-label="Playback speed">
          {PLAYBACK_RATES.map((value) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={rate === value}
              aria-label={`${value}× speed`}
              className="segmented__item"
              disabled={!ready}
              onMouseDown={keepFocus}
              onClick={() => player.setRate(value)}
            >
              {value}×
            </button>
          ))}
        </div>
        <FrameRateControl />
        <IconButton label={muted ? 'Unmute' : 'Mute'} shortcut="M" onClick={() => player.toggleMuted()}>
          {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
        </IconButton>
        <IconButton label={fullscreen ? 'Exit full screen' : 'Full screen'} shortcut="F" tooltipSide="left" onClick={toggleFullscreen}>
          {fullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
        </IconButton>
      </div>
    </div>
  );
}
