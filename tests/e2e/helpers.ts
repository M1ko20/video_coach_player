import { expect, type Locator, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';

export const fixture = (name: string) => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));

export const MAIN_CLIP = 'clip-25fps.webm';
export const OTHER_CLIP = 'clip-30fps-4x3.webm';

export const overlay = (page: Page) => page.getByTestId('annotation-overlay');
/** Committed drawings (the draft layer is empty outside a gesture). */
export const shapes = (page: Page) => overlay(page).locator('g[data-id]');
export const saveIndicator = (page: Page) => page.getByTestId('save-indicator');

export async function expectSaved(page: Page) {
  await expect(saveIndicator(page)).toHaveAttribute('data-status', 'saved');
}

/** Waits until the workspace is showing a decoded video and everything is stored. */
export async function waitForWorkspace(page: Page) {
  await expect(page.getByTestId('video-frame')).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.querySelector('video')?.readyState ?? 0))
    .toBeGreaterThanOrEqual(2);
  // "~" marks an assumed frame rate; wait for the measured one.
  await expect(page.getByTestId('fps-button')).not.toContainText('~');
  await expectSaved(page);
}

export async function openClip(page: Page, name = MAIN_CLIP) {
  await page.goto('/');
  await page.getByTestId('video-input').setInputFiles(fixture(name));
  await waitForWorkspace(page);
}

type Fraction = readonly [number, number];

async function toPagePoint(page: Page, [fx, fy]: Fraction) {
  const box = (await overlay(page).boundingBox())!;
  return { x: box.x + box.width * fx, y: box.y + box.height * fy };
}

/** Drags across the video. Points are fractions of the video frame. */
export async function drag(page: Page, from: Fraction, to: Fraction, steps = 8) {
  const a = await toPagePoint(page, from);
  const b = await toPagePoint(page, to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps });
  await page.mouse.up();
}

export async function clickVideo(page: Page, at: Fraction) {
  const point = await toPagePoint(page, at);
  await page.mouse.click(point.x, point.y);
}

export async function doubleClickVideo(page: Page, at: Fraction) {
  const point = await toPagePoint(page, at);
  await page.mouse.dblclick(point.x, point.y);
}

/**
 * Position and size of an element as fractions of the video frame. Both boxes
 * are read in one step, so a layout change cannot slip in between them.
 */
export function relativeBox(_page: Page, locator: Locator) {
  return locator.evaluate((element) => {
    const frame = element.closest('svg')!.getBoundingClientRect();
    const box = element.getBoundingClientRect();
    return {
      x: (box.x - frame.x) / frame.width,
      y: (box.y - frame.y) / frame.height,
      w: box.width / frame.width,
      h: box.height / frame.height,
    };
  });
}

export const currentTime = (page: Page) => page.evaluate(() => document.querySelector('video')!.currentTime);
export const isPaused = (page: Page) => page.evaluate(() => document.querySelector('video')!.paused);

/** Clicks the timeline at a fraction of its track. */
export async function clickTimeline(page: Page, fraction: number) {
  const box = (await page.locator('.timeline__track').boundingBox())!;
  await page.mouse.click(box.x + box.width * fraction, box.y + box.height / 2);
}

/**
 * Starts recording the media timestamp of every frame the browser actually
 * presents, so tests can check which frame is really on screen.
 */
export async function trackPresentedFrames(page: Page) {
  await page.evaluate(() => {
    const video = document.querySelector('video')!;
    const state = window as unknown as { __presented: number };
    state.__presented = -1;
    const onFrame: VideoFrameRequestCallback = (_now, metadata) => {
      state.__presented = metadata.mediaTime;
      video.requestVideoFrameCallback(onFrame);
    };
    video.requestVideoFrameCallback(onFrame);
  });
}

export const presentedTime = (page: Page) =>
  page.evaluate(() => (window as unknown as { __presented: number }).__presented);
