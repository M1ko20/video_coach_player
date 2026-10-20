import { expect, test } from '@playwright/test';
import {
  MAIN_CLIP,
  clickTimeline,
  clickVideo,
  currentTime,
  doubleClickVideo,
  drag,
  expectSaved,
  fixture,
  isPaused,
  openClip,
  overlay,
  presentedTime,
  relativeBox,
  shapes,
  trackPresentedFrames,
} from './helpers';

const FRAME = 1 / 25;

test.describe('opening a video', () => {
  test('shows an empty state, then the workspace with the video and overlay aligned', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Analyze a video' })).toBeVisible();

    await openClip(page);
    await expect(page.getByTestId('fps-button')).toHaveText('25 fps');
    await expect(page.locator('.readout__duration')).toHaveText('/ 0:06.00');

    const video = (await page.getByTestId('video').boundingBox())!;
    const layer = (await overlay(page).boundingBox())!;
    expect(layer).toEqual(video);
    expect(video.width / video.height).toBeCloseTo(16 / 9, 2);
  });

  test('rejects a file that is not a video without leaving the library', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('video-input').setInputFiles(fixture('notes.txt'));
    await expect(page.getByTestId('open-error')).toContainText('is not a video file');
    await expect(page.getByTestId('project-card')).toHaveCount(0);
  });

  test('explains a damaged video and creates no project for it', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('video-input').setInputFiles(fixture('corrupt.webm'));
    await expect(page.getByTestId('open-error')).toBeVisible();
    await expect(page.getByTestId('open-error')).toContainText(/can’t|damaged/);
    await expect(page.getByRole('button', { name: 'Choose video' })).toBeEnabled();
    await expect(page.getByTestId('project-card')).toHaveCount(0);

    // The app is still usable afterwards.
    await page.getByTestId('video-input').setInputFiles(fixture(MAIN_CLIP));
    await expect(page.getByTestId('video-frame')).toBeVisible();
  });

  test('accepts a video dropped onto the page', async ({ page }) => {
    await page.goto('/');
    const dataTransfer = await page.evaluateHandle(async (url) => {
      const blob = await (await fetch(url)).blob();
      const transfer = new DataTransfer();
      transfer.items.add(new File([blob], 'dropped.webm', { type: 'video/webm' }));
      return transfer;
    }, `/@fs${fixture(MAIN_CLIP)}`);
    await page.dispatchEvent('.library', 'dragenter', { dataTransfer });
    await expect(page.getByRole('heading', { name: 'Drop the video to start' })).toBeVisible();
    await page.dispatchEvent('.library', 'drop', { dataTransfer });
    await expect(page.getByTestId('video-frame')).toBeVisible();
    await expect(page.getByLabel('Analysis name')).toHaveValue('dropped');
  });
});

test.describe('drawing', () => {
  test.beforeEach(async ({ page }) => {
    await openClip(page);
  });

  test('every tool creates a drawing and the active tool is always marked', async ({ page }) => {
    const tools: Array<[key: string, tool: string]> = [
      ['a', 'arrow'],
      ['l', 'line'],
      ['c', 'ellipse'],
      ['r', 'rect'],
      ['p', 'path'],
    ];
    let count = 0;
    for (const [key, tool] of tools) {
      await page.keyboard.press(key);
      await expect(page.locator(`[data-tool-button="${tool}"]`)).toHaveAttribute('aria-pressed', 'true');
      await expect(page.locator('[data-tool-button][aria-pressed="true"]')).toHaveCount(1);
      await drag(page, [0.1 + count * 0.15, 0.2], [0.2 + count * 0.15, 0.5]);
      count += 1;
      await expect(shapes(page)).toHaveCount(count);
    }

    await page.locator('[data-tool-button="text"]').click();
    await clickVideo(page, [0.5, 0.8]);
    await page.keyboard.type('Press high');
    await page.keyboard.press('Enter');
    await expect(shapes(page)).toHaveCount(6);
    await expect(overlay(page).locator('text')).toHaveText('Press high');
    await expectSaved(page);
  });

  test('an accidental click with a shape tool draws nothing', async ({ page }) => {
    await page.keyboard.press('r');
    await clickVideo(page, [0.5, 0.5]);
    await page.keyboard.press('a');
    await clickVideo(page, [0.3, 0.3]);
    await expect(shapes(page)).toHaveCount(0);
  });

  test('drawings survive every unrelated interaction', async ({ page }) => {
    await page.keyboard.press('a');
    await drag(page, [0.2, 0.7], [0.4, 0.4]);
    await page.keyboard.press('c');
    // A circle centred at (0.65, 0.45) whose top passes through (0.65, 0.3).
    await drag(page, [0.65, 0.45], [0.65, 0.3]);
    await page.keyboard.press('p');
    await drag(page, [0.1, 0.1], [0.3, 0.2]);
    await expect(shapes(page)).toHaveCount(3);

    const circle = shapes(page).nth(1);
    const before = await relativeBox(page, circle.locator('.shape__ink'));

    // Moving the playhead, by click, drag, keyboard and frame step.
    await clickTimeline(page, 0.6);
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('.');
    await page.getByRole('button', { name: 'Previous frame' }).click();
    await expect(shapes(page)).toHaveCount(3);

    // Playing, pausing and changing speed.
    await page.keyboard.press('Space');
    await expect.poll(() => isPaused(page)).toBe(false);
    await page.getByRole('radio', { name: '0.5× speed' }).click();
    await page.keyboard.press('Space');
    await expect.poll(() => isPaused(page)).toBe(true);
    await expect(shapes(page)).toHaveCount(3);

    // Switching tools, selecting, clicking empty space, pressing Escape.
    for (const key of ['l', 't', 'r', 'v']) await page.keyboard.press(key);
    await clickVideo(page, [0.65, 0.3]);
    await expect(overlay(page).locator('.selection')).toBeVisible();
    await clickVideo(page, [0.9, 0.9]);
    await expect(overlay(page).locator('.selection')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(shapes(page)).toHaveCount(3);

    // Resizing the window: same drawings, same place relative to the footage.
    for (const size of [
      { width: 900, height: 700 },
      { width: 1700, height: 620 },
      { width: 1440, height: 900 },
    ]) {
      await page.setViewportSize(size);
      await expect
        .poll(async () => {
          const video = await page.getByTestId('video').boundingBox();
          const layer = await overlay(page).boundingBox();
          return JSON.stringify(video) === JSON.stringify(layer);
        })
        .toBe(true);
      const after = await relativeBox(page, circle.locator('.shape__ink'));
      expect(after.x).toBeCloseTo(before.x, 2);
      expect(after.y).toBeCloseTo(before.y, 2);
      expect(after.w).toBeCloseTo(before.w, 2);
      expect(after.h).toBeCloseTo(before.h, 2);
      await expect(shapes(page)).toHaveCount(3);
    }
  });

  test('starting to draw pauses playback on the current frame', async ({ page }) => {
    await page.keyboard.press('Space');
    await expect.poll(() => isPaused(page)).toBe(false);
    await page.keyboard.press('a');
    await drag(page, [0.2, 0.2], [0.5, 0.5]);
    expect(await isPaused(page)).toBe(true);
    await expect(shapes(page)).toHaveCount(1);
  });

  test('select, move, restyle and delete a single drawing', async ({ page }) => {
    await page.keyboard.press('r');
    await drag(page, [0.2, 0.2], [0.4, 0.5]);
    await page.keyboard.press('a');
    await drag(page, [0.6, 0.6], [0.8, 0.3]);
    await page.keyboard.press('v');

    const rect = shapes(page).first();
    const ink = rect.locator('.shape__ink');
    const start = await relativeBox(page, ink);

    // Click the rectangle's top edge (away from its handles): it becomes the selection.
    await clickVideo(page, [0.25, 0.2]);
    await expect(overlay(page).locator('.selection')).toHaveAttribute('data-selection', (await rect.getAttribute('data-id'))!);
    await expect(page.getByRole('button', { name: 'Delete selected drawing' })).toBeEnabled();

    // Move it.
    await drag(page, [0.25, 0.2], [0.45, 0.3]);
    const moved = await relativeBox(page, ink);
    expect(moved.x - start.x).toBeCloseTo(0.2, 2);
    expect(moved.y - start.y).toBeCloseTo(0.1, 2);
    expect(moved.w).toBeCloseTo(start.w, 2);

    // Resize it from the bottom-right handle.
    await drag(page, [0.6, 0.6], [0.7, 0.75]);
    const resized = await relativeBox(page, ink);
    expect(resized.w - moved.w).toBeCloseTo(0.1, 2);
    expect(resized.h - moved.h).toBeCloseTo(0.15, 2);

    // Restyle it; the other drawing keeps its own style.
    await page.getByRole('radio', { name: 'Red' }).click();
    await page.getByRole('radio', { name: 'Extra thick' }).click();
    await expect(ink).toHaveAttribute('stroke', '#ff453a');
    await expect(ink).toHaveAttribute('stroke-width', '15');
    await expect(shapes(page).nth(1).locator('line.shape__ink')).toHaveAttribute('stroke', '#ffd60a');

    // Delete only the selected one.
    await page.keyboard.press('Delete');
    await expect(shapes(page)).toHaveCount(1);
    await expect(overlay(page).locator('line.shape__ink')).toHaveCount(1);
    await expect(page.getByRole('button', { name: 'Delete selected drawing' })).toBeDisabled();
  });

  test('undo and redo walk through every change', async ({ page }) => {
    const undoButton = page.getByRole('button', { name: 'Undo' });
    const redoButton = page.getByRole('button', { name: 'Redo' });
    await expect(undoButton).toBeDisabled();

    await page.keyboard.press('l');
    await drag(page, [0.1, 0.1], [0.3, 0.3]);
    await drag(page, [0.4, 0.4], [0.6, 0.6]);
    await page.keyboard.press('v');
    await clickVideo(page, [0.5, 0.5]);
    await page.keyboard.press('Backspace');
    await expect(shapes(page)).toHaveCount(1);

    await page.keyboard.press('ControlOrMeta+z');
    await expect(shapes(page)).toHaveCount(2);
    await undoButton.click();
    await expect(shapes(page)).toHaveCount(1);
    await undoButton.click();
    await expect(shapes(page)).toHaveCount(0);
    await expect(undoButton).toBeDisabled();

    await redoButton.click();
    await page.keyboard.press('ControlOrMeta+Shift+z');
    await expect(shapes(page)).toHaveCount(2);
    await redoButton.click();
    await expect(shapes(page)).toHaveCount(1);
    await expect(redoButton).toBeDisabled();
  });

  test('clear all asks first, can be cancelled, and can be undone', async ({ page }) => {
    await page.keyboard.press('r');
    await drag(page, [0.1, 0.1], [0.3, 0.3]);
    await drag(page, [0.5, 0.5], [0.7, 0.7]);

    await page.getByRole('button', { name: 'Clear all drawings…' }).click();
    const dialog = page.getByRole('dialog', { name: 'Clear all drawings?' });
    await expect(dialog).toContainText('all 2 drawings');
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(shapes(page)).toHaveCount(2);

    await page.getByRole('button', { name: 'Clear all drawings…' }).click();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(shapes(page)).toHaveCount(2);

    await page.getByRole('button', { name: 'Clear all drawings…' }).click();
    await dialog.getByRole('button', { name: 'Clear all' }).click();
    await expect(shapes(page)).toHaveCount(0);

    await page.keyboard.press('ControlOrMeta+z');
    await expect(shapes(page)).toHaveCount(2);
  });

  test('text can be typed, edited and cancelled without triggering shortcuts', async ({ page }) => {
    await page.keyboard.press('t');
    await clickVideo(page, [0.3, 0.3]);
    const editor = page.getByLabel('Annotation text');
    await expect(editor).toBeFocused();

    // Letters and Space here are tool and playback shortcuts elsewhere.
    await page.keyboard.type('var play ,.');
    await expect(editor).toHaveValue('var play ,.');
    expect(await isPaused(page)).toBe(true);
    expect(await currentTime(page)).toBe(0);
    await page.keyboard.press('Enter');
    await expect(overlay(page).locator('text')).toHaveText('var play ,.');
    await expect(page.locator('[data-tool-button="text"]')).toHaveAttribute('aria-pressed', 'true');

    // Escape abandons a new text.
    await clickVideo(page, [0.6, 0.6]);
    await page.keyboard.type('discard me');
    await page.keyboard.press('Escape');
    await expect(shapes(page)).toHaveCount(1);

    // Double-click with the Select tool edits the existing text.
    await page.keyboard.press('v');
    await doubleClickVideo(page, [0.33, 0.33]);
    await expect(editor).toHaveValue('var play ,.');
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.type('Overlap');
    await clickVideo(page, [0.8, 0.8]);
    await expect(overlay(page).locator('text')).toHaveText('Overlap');
    await expect(shapes(page)).toHaveCount(1);
  });

  test('Escape abandons a drawing in progress', async ({ page }) => {
    await page.keyboard.press('r');
    const box = (await overlay(page).boundingBox())!;
    await page.mouse.move(box.x + 200, box.y + 200);
    await page.mouse.down();
    await page.mouse.move(box.x + 400, box.y + 400, { steps: 5 });
    await expect(overlay(page).locator('.overlay__draft g')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await expect(shapes(page)).toHaveCount(0);
    await expect(page.locator('[data-tool-button="rect"]')).toHaveAttribute('aria-pressed', 'true');
  });
});

test.describe('navigation', () => {
  test.beforeEach(async ({ page }) => {
    await openClip(page);
  });

  test('frame buttons and keys move exactly one real frame at a time', async ({ page }) => {
    await trackPresentedFrames(page);
    const next = page.getByRole('button', { name: 'Next frame' });
    const previous = page.getByRole('button', { name: 'Previous frame' });

    // Forward: each step must present the next frame of the 25 fps clip.
    for (let frame = 1; frame <= 8; frame++) {
      if (frame % 2) await next.click();
      else await page.keyboard.press('.');
      await expect.poll(() => presentedTime(page)).toBeCloseTo(frame * FRAME, 3);
      await expect(page.getByTestId('current-frame')).toHaveText(String(frame + 1));
    }
    // Backward.
    for (let frame = 7; frame >= 3; frame--) {
      if (frame % 2) await previous.click();
      else await page.keyboard.press(',');
      await expect.poll(() => presentedTime(page)).toBeCloseTo(frame * FRAME, 3);
    }
    // Cannot step before the first frame.
    for (let i = 0; i < 6; i++) await page.keyboard.press(',');
    await expect.poll(() => presentedTime(page)).toBeCloseTo(0, 3);
    await expect(page.getByTestId('current-frame')).toHaveText('1');
  });

  test('rapid frame steps are all counted', async ({ page }) => {
    await trackPresentedFrames(page);
    for (let i = 0; i < 12; i++) await page.keyboard.press('.', { delay: 0 });
    await expect.poll(() => presentedTime(page)).toBeCloseTo(12 * FRAME, 3);
  });

  test('stepping from the middle of playback lands on frame boundaries', async ({ page }) => {
    await trackPresentedFrames(page);
    await clickTimeline(page, 0.5);
    await expect.poll(() => currentTime(page)).toBeCloseTo(3, 1);
    await expect.poll(() => presentedTime(page)).toBeGreaterThan(2.9);
    const start = Math.round((await presentedTime(page)) / FRAME);
    await page.keyboard.press('.');
    await expect.poll(async () => Math.round((await presentedTime(page)) / FRAME)).toBe(start + 1);
    await page.keyboard.press(',');
    await page.keyboard.press(',');
    await expect.poll(async () => Math.round((await presentedTime(page)) / FRAME)).toBe(start - 1);
  });

  test('clicking and dragging the timeline seeks continuously', async ({ page }) => {
    await clickTimeline(page, 0.25);
    await expect.poll(() => currentTime(page)).toBeCloseTo(1.5, 1);
    await expect(page.getByTestId('current-time')).toHaveText(/^0:01\.[45]\d$/);

    // Clicking above the thin track still works: the whole strip is the target.
    const strip = (await page.getByTestId('timeline').boundingBox())!;
    const track = (await page.locator('.timeline__track').boundingBox())!;
    expect(strip.height).toBeGreaterThanOrEqual(28);
    await page.mouse.click(track.x + track.width * 0.75, strip.y + 3);
    await expect.poll(() => currentTime(page)).toBeCloseTo(4.5, 1);

    // Drag: the video follows while the button is held.
    const y = track.y + track.height / 2;
    await page.mouse.move(track.x + track.width * 0.75, y);
    await page.mouse.down();
    await expect(page.getByTestId('timeline')).toHaveClass(/is-scrubbing/);
    await page.mouse.move(track.x + track.width * 0.5, y, { steps: 10 });
    await expect.poll(() => currentTime(page)).toBeCloseTo(3, 1);
    await page.mouse.move(track.x + track.width * 0.1, y, { steps: 10 });
    await expect.poll(() => currentTime(page)).toBeCloseTo(0.6, 1);
    // Dragging beyond the end clamps instead of breaking.
    await page.mouse.move(track.x - 200, y, { steps: 3 });
    await expect.poll(() => currentTime(page)).toBe(0);
    await page.mouse.up();
    await expect(page.getByTestId('timeline')).not.toHaveClass(/is-scrubbing/);
  });

  test('holding Shift while dragging scrubs ten times finer', async ({ page }) => {
    const track = (await page.locator('.timeline__track').boundingBox())!;
    const y = track.y + track.height / 2;
    await page.mouse.move(track.x + track.width * 0.5, y);
    await page.mouse.down();
    await expect.poll(() => currentTime(page)).toBeCloseTo(3, 1);
    await page.keyboard.down('Shift');
    await page.mouse.move(track.x + track.width * 0.5 + 1, y);
    await page.mouse.move(track.x + track.width * 0.6, y, { steps: 5 });
    // 10% of the track would be 0.6 s; in fine mode it is 0.06 s.
    await expect.poll(() => currentTime(page)).toBeCloseTo(3.06, 1);
    expect(await currentTime(page)).toBeLessThan(3.2);
    await page.keyboard.up('Shift');
    await page.mouse.up();
  });

  test('keyboard shortcuts control playback, speed and position', async ({ page }) => {
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => currentTime(page)).toBeCloseTo(1, 2);
    await page.keyboard.press('Shift+ArrowRight');
    await expect.poll(() => currentTime(page)).toBeCloseTo(6, 1);
    await page.keyboard.press('ArrowLeft');
    await expect.poll(() => currentTime(page)).toBeCloseTo(5, 1);
    await page.keyboard.press('Home');
    await expect.poll(() => currentTime(page)).toBe(0);

    await page.keyboard.press('Shift+,');
    await expect(page.getByRole('radio', { name: '0.5× speed' })).toBeChecked();
    expect(await page.evaluate(() => document.querySelector('video')!.playbackRate)).toBe(0.5);
    await page.keyboard.press('Shift+.');
    await page.keyboard.press('Shift+.');
    await expect(page.getByRole('radio', { name: '1.5× speed' })).toBeChecked();

    await page.keyboard.press('Space');
    await expect.poll(() => isPaused(page)).toBe(false);
    await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
    await expect.poll(() => currentTime(page)).toBeGreaterThan(0.2);
    await page.keyboard.press('Space');
    await expect.poll(() => isPaused(page)).toBe(true);
    await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
  });

  test('typing in the name field does not trigger shortcuts', async ({ page }) => {
    const name = page.getByLabel('Analysis name');
    await name.fill('');
    await name.pressSequentially('Cup final a.p,');
    expect(await isPaused(page)).toBe(true);
    expect(await currentTime(page)).toBe(0);
    await expect(page.locator('[data-tool-button="select"]')).toHaveAttribute('aria-pressed', 'true');
    await name.press('Enter');
    await expect(name).toHaveValue('Cup final a.p,');
    await expectSaved(page);
  });

  test('the frame rate can be overridden and stepping follows it', async ({ page }) => {
    await page.getByTestId('fps-button').click();
    await page.getByRole('menuitemradio', { name: '50 fps' }).click();
    await expect(page.getByTestId('fps-button')).toHaveText('50 fps');
    await page.keyboard.press('.');
    await expect.poll(() => currentTime(page)).toBeCloseTo(1.5 / 50, 3);

    await page.getByTestId('fps-button').click();
    await page.getByRole('menuitemradio', { name: /Automatic/ }).click();
    await expect(page.getByTestId('fps-button')).toHaveText('25 fps');
  });

  test('a marker on the timeline returns to the moment a drawing was made', async ({ page }) => {
    await clickTimeline(page, 0.4);
    await expect.poll(() => currentTime(page)).toBeCloseTo(2.4, 1);
    const drawnAt = await currentTime(page);
    await page.keyboard.press('a');
    await drag(page, [0.2, 0.2], [0.5, 0.5]);
    await expect(page.locator('.timeline__mark')).toHaveCount(1);

    await page.keyboard.press('Home');
    await expect.poll(() => currentTime(page)).toBe(0);
    const mark = (await page.locator('.timeline__mark').boundingBox())!;
    await page.mouse.click(mark.x + mark.width / 2 + 3, mark.y + mark.height / 2);
    await expect.poll(() => currentTime(page)).toBeCloseTo(drawnAt, 3);
  });
});
