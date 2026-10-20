import { describe, expect, it } from 'vitest';
import {
  estimateFrameRate,
  formatTime,
  frameAtTime,
  lastFrameIndex,
  snapFrameRate,
  stepFrameTime,
  timeOfFrame,
} from '../../src/lib/time';

describe('formatTime', () => {
  it('formats minutes, seconds and hundredths', () => {
    expect(formatTime(0)).toBe('0:00.00');
    expect(formatTime(83.456)).toBe('1:23.45');
    expect(formatTime(59.999)).toBe('0:59.99');
  });

  it('adds hours for long footage', () => {
    expect(formatTime(3723.5)).toBe('1:02:03.50');
  });

  it('can omit the fraction', () => {
    expect(formatTime(125.9, false)).toBe('2:05');
  });

  it('never shows invalid or negative times', () => {
    expect(formatTime(Number.NaN)).toBe('0:00.00');
    expect(formatTime(-4)).toBe('0:00.00');
  });
});

describe('frame maths', () => {
  it('maps a time to the frame on screen', () => {
    expect(frameAtTime(0, 25)).toBe(0);
    expect(frameAtTime(0.039, 25)).toBe(0);
    expect(frameAtTime(0.04, 25)).toBe(1);
    expect(frameAtTime(1, 30)).toBe(30);
  });

  it('is stable against floating-point error at frame boundaries', () => {
    for (const fps of [23.976, 25, 29.97, 30, 50, 59.94, 60]) {
      for (let frame = 0; frame < 2000; frame += 7) {
        expect(frameAtTime(frame / fps, fps)).toBe(frame);
        expect(frameAtTime(timeOfFrame(frame, fps), fps)).toBe(frame);
      }
    }
  });

  it('steps exactly one frame at a time, in both directions', () => {
    const fps = 29.97;
    const duration = 120;
    let time = 12.3456;
    const start = frameAtTime(time, fps);
    for (let i = 1; i <= 50; i++) {
      time = stepFrameTime(time, 1, fps, duration);
      expect(frameAtTime(time, fps)).toBe(start + i);
    }
    for (let i = 49; i >= 0; i--) {
      time = stepFrameTime(time, -1, fps, duration);
      expect(frameAtTime(time, fps)).toBe(start + i);
    }
  });

  it('does not step before the first or past the last frame', () => {
    expect(frameAtTime(stepFrameTime(0, -1, 25, 10), 25)).toBe(0);
    const last = lastFrameIndex(10, 25);
    expect(last).toBe(249);
    const end = stepFrameTime(9.99, 5, 25, 10);
    expect(frameAtTime(end, 25)).toBe(last);
    expect(end).toBeLessThan(10);
  });
});

describe('frame rate estimation', () => {
  const timestamps = (fps: number, count: number, skip: number[] = []) =>
    Array.from({ length: count }, (_, i) => i / fps).filter((_, i) => !skip.includes(i));

  it('recovers common frame rates from presentation timestamps', () => {
    for (const fps of [24, 25, 30, 50, 60]) {
      expect(estimateFrameRate(timestamps(fps, 24))).toBe(fps);
    }
    expect(estimateFrameRate(timestamps(30000 / 1001, 24))).toBe(29.97);
    expect(estimateFrameRate(timestamps(24000 / 1001, 24))).toBe(23.976);
  });

  it('is not fooled by dropped frames', () => {
    expect(estimateFrameRate(timestamps(30, 30, [3, 4, 9, 15, 16, 22]))).toBe(30);
  });

  it('reports nothing when there is too little data', () => {
    expect(estimateFrameRate([])).toBeNull();
    expect(estimateFrameRate([0, 0.04, 0.08])).toBeNull();
  });

  it('keeps unusual rates and rejects implausible ones', () => {
    expect(snapFrameRate(27.3)).toBe(27.3);
    expect(snapFrameRate(29.9)).toBe(29.97);
    expect(snapFrameRate(1)).toBeNull();
    expect(snapFrameRate(Number.POSITIVE_INFINITY)).toBeNull();
  });
});
