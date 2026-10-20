import { expect, test, type Page } from '@playwright/test';
import { currentTime, drag, isPaused, openClip, overlay, shapes } from './helpers';

/** The test clip runs at 25 fps. */
const FRAME = 1 / 25;
const frameNumber = async (page: Page) => Number(await page.getByTestId('current-frame').textContent());

test.describe('frame strip', () => {
  test.beforeEach(async ({ page }) => {
    await openClip(page);
  });

  test('shows neighbouring frames and moves frame by frame when dragged, clicked or scrolled', async ({ page }) => {
    const strip = page.getByTestId('filmstrip');
    await expect(strip).toBeVisible();
    const center = strip.locator('.filmstrip__slot--center');
    // Pictures fill in once the strip is still.
    await expect(center).toHaveAttribute('data-state', 'ready');
    await expect(center.locator('xpath=following-sibling::*[1]')).toHaveAttribute('data-state', 'ready');

    // Dragging left by two frames pulls two later frames into the middle.
    const slot = (await center.boundingBox())!;
    const step = slot.width + 4;
    const y = slot.y + slot.height / 2;
    await page.mouse.move(slot.x + slot.width / 2, y);
    await page.mouse.down();
    await page.mouse.move(slot.x + slot.width / 2 - step * 2, y, { steps: 10 });
    await page.mouse.up();
    await expect.poll(() => frameNumber(page)).toBe(3);
    await expect.poll(() => currentTime(page)).toBeCloseTo(2.5 * FRAME, 3);

    // Clicking the frame to the left goes back one.
    const previous = (await center.locator('xpath=preceding-sibling::*[1]').boundingBox())!;
    await page.mouse.click(previous.x + previous.width / 2, previous.y + previous.height / 2);
    await expect.poll(() => frameNumber(page)).toBe(2);

    // One wheel notch is one frame.
    await page.mouse.move(slot.x + slot.width / 2, y);
    await page.mouse.wheel(0, 100);
    await expect.poll(() => frameNumber(page)).toBe(3);
    await page.mouse.wheel(0, -100);
    await page.mouse.wheel(0, -100);
    await expect.poll(() => frameNumber(page)).toBe(1);
  });

  test('cannot move before the first frame, pauses playback, and can be hidden', async ({ page }) => {
    const center = page.locator('.filmstrip__slot--center');
    await expect(center.locator('xpath=preceding-sibling::*[1]')).toHaveAttribute('data-state', 'empty');

    await page.keyboard.press('Space');
    await expect.poll(() => isPaused(page)).toBe(false);
    const box = (await center.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect.poll(() => isPaused(page)).toBe(true);

    await page.keyboard.press('s');
    await expect(page.getByTestId('filmstrip')).toHaveCount(0);
    await page.getByRole('button', { name: 'Show frame strip' }).click();
    await expect(page.getByTestId('filmstrip')).toBeVisible();
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
    expect(box.x + box.width / 2).toBeCloseTo(frame.x + frame.width * 0.5, 0);
    expect(box.y + box.height / 2).toBeCloseTo(frame.y + frame.height * 0.5, 0);

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
    expect(resized.x + resized.width / 2).toBeCloseTo(box.x + box.width / 2, 0);
  });
});
