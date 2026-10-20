import { expect, test, type Page } from '@playwright/test';
import { currentTime, drag, isPaused, openClip, overlay, shapes } from './helpers';

/** The test clip runs at 25 fps. */
const FRAME = 1 / 25;
const frameNumber = async (page: Page) => Number(await page.getByTestId('current-frame').textContent());

test.describe('frame scrubber', () => {
  test.beforeEach(async ({ page }) => {
    await openClip(page);
  });

  /** Centre of the scrubber and the drag distance per frame (FRAME_SPACING). */
  async function scrubber(page: Page) {
    const box = (await page.getByTestId('scrubber').locator('.scrubber__viewport').boundingBox())!;
    return { x: box.x + box.width / 2, y: box.y + box.height / 2, width: box.width, step: 12 };
  }

  test('dragging moves frame by frame and shows how far', async ({ page }) => {
    const s = await scrubber(page);
    await page.mouse.move(s.x, s.y);
    await page.mouse.down();
    // Slowly, so the release is not a flick. Left brings later frames to the centre.
    await page.mouse.move(s.x - s.step * 3, s.y, { steps: 12 });
    await expect(page.getByTestId('scrubber-readout')).toHaveText('+3 frames');
    await page.waitForTimeout(150);
    await page.mouse.up();
    await expect.poll(() => frameNumber(page)).toBe(4);
    await expect.poll(() => currentTime(page)).toBeCloseTo(3.5 * FRAME, 3);

    await page.mouse.move(s.x, s.y);
    await page.mouse.down();
    await page.mouse.move(s.x + s.step * 2, s.y, { steps: 10 });
    await page.waitForTimeout(150);
    await page.mouse.up();
    await expect.poll(() => frameNumber(page)).toBe(2);
  });

  test('tapping a side steps one frame, and scrolling steps one frame per notch', async ({ page }) => {
    const s = await scrubber(page);
    await page.mouse.click(s.x + s.width / 4, s.y);
    await expect.poll(() => frameNumber(page)).toBe(2);
    await page.mouse.click(s.x + s.width / 4, s.y);
    await expect.poll(() => frameNumber(page)).toBe(3);
    await page.mouse.click(s.x - s.width / 4, s.y);
    await expect.poll(() => frameNumber(page)).toBe(2);

    await page.mouse.move(s.x, s.y);
    await page.mouse.wheel(0, 100);
    await expect.poll(() => frameNumber(page)).toBe(3);
    await page.mouse.wheel(0, -100);
    await page.mouse.wheel(0, -100);
    await expect.poll(() => frameNumber(page)).toBe(1);
  });

  test('a flick keeps turning, then comes to rest', async ({ page }) => {
    const s = await scrubber(page);
    await page.mouse.move(s.x + 120, s.y);
    await page.mouse.down();
    await page.mouse.move(s.x - 120, s.y, { steps: 4 });
    await page.mouse.up();
    // Dragged 20 frames' worth; coasting adds more.
    await expect.poll(() => frameNumber(page)).toBeGreaterThan(22);
    await page.waitForTimeout(1500);
    const rested = await frameNumber(page);
    await page.waitForTimeout(300);
    expect(await frameNumber(page)).toBe(rested);
  });

  test('stops at the first frame, pauses playback, and can be hidden', async ({ page }) => {
    const s = await scrubber(page);
    await page.mouse.move(s.x, s.y);
    await page.mouse.down();
    await page.mouse.move(s.x + s.step * 5, s.y, { steps: 10 });
    await page.waitForTimeout(150);
    await page.mouse.up();
    await expect.poll(() => frameNumber(page)).toBe(1);

    await page.keyboard.press('Space');
    await expect.poll(() => isPaused(page)).toBe(false);
    await page.mouse.click(s.x + s.width / 4, s.y);
    await expect.poll(() => isPaused(page)).toBe(true);

    await page.keyboard.press('s');
    await expect(page.getByTestId('scrubber')).toHaveCount(0);
    await page.getByRole('button', { name: 'Show frame scrubber' }).click();
    await expect(page.getByTestId('scrubber')).toBeVisible();
  });
});

test.describe('line styles and circles', () => {
  test.beforeEach(async ({ page }) => {
    await openClip(page);
  });

  test('lines can be dashed or dotted, and a selected drawing can be restyled', async ({ page }) => {
    await page.getByRole('radio', { name: 'Dashed' }).click();
    await page.keyboard.press('a');
    await drag(page, [0.2, 0.7], [0.5, 0.4]);
    const ink = shapes(page).first().locator('line.shape__ink');
    await expect(ink).toHaveAttribute('stroke-dasharray', /\d/);
    const dashed = await ink.getAttribute('stroke-dasharray');

    await page.keyboard.press('v');
    await drag(page, [0.35, 0.55], [0.36, 0.56], 2);
    await page.getByRole('radio', { name: 'Dotted' }).click();
    await expect(ink).toHaveAttribute('stroke-dasharray', /^0 /);
    await page.getByRole('radio', { name: 'Solid' }).click();
    await expect(ink).not.toHaveAttribute('stroke-dasharray', /.*/);
    expect(dashed).not.toBeNull();

    // Text has no outline, so line styles do not apply to it.
    await page.keyboard.press('t');
    await expect(page.getByRole('radio', { name: 'Dotted' })).toBeDisabled();
  });

  test('the circle tool only draws circles, from the centre outwards', async ({ page }) => {
    await page.keyboard.press('c');
    // A drag that would make a wide ellipse as a box still makes a circle.
    await drag(page, [0.5, 0.5], [0.6, 0.55]);
    const ink = overlay(page).locator('ellipse.shape__ink');
    const box = (await ink.boundingBox())!;
    expect(Math.abs(box.width - box.height)).toBeLessThan(2);
    const frame = (await overlay(page).boundingBox())!;
    expect(Math.abs(box.x + box.width / 2 - (frame.x + frame.width * 0.5))).toBeLessThan(1.5);
    expect(Math.abs(box.y + box.height / 2 - (frame.y + frame.height * 0.5))).toBeLessThan(1.5);

    // Resizing with a handle keeps it a circle around the same centre.
    await page.keyboard.press('v');
    await page.mouse.click(box.x + box.width / 2, box.y + 1);
    await expect(overlay(page).locator('[data-handle]')).toHaveCount(4);
    const handle = (await overlay(page).locator('[data-handle="e"]').boundingBox())!;
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down();
    await page.mouse.move(handle.x + handle.width / 2 + 60, handle.y + handle.height / 2 + 30, { steps: 5 });
    await page.mouse.up();
    const resized = (await ink.boundingBox())!;
    expect(resized.width).toBeGreaterThan(box.width + 50);
    expect(Math.abs(resized.width - resized.height)).toBeLessThan(2);
    expect(Math.abs(resized.x + resized.width / 2 - (box.x + box.width / 2))).toBeLessThan(1.5);
  });
});
