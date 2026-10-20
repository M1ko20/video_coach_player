import { expect, test, type Page } from '@playwright/test';
import { openClip, overlay, shapes } from './helpers';

// A tablet: touch input, no hover.
test.use({ viewport: { width: 1180, height: 820 }, hasTouch: true, isMobile: false });

/** Drags one finger along a straight line, as a real touch screen reports it. */
async function swipe(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, steps = 12, holdMs = 0) {
  const cdp = await page.context().newCDPSession(page);
  const point = (x: number, y: number) => [{ x, y, id: 1, radiusX: 8, radiusY: 8, force: 1 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: point(from.x, from.y) });
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: point(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t),
    });
  }
  if (holdMs) await page.waitForTimeout(holdMs);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

const frameNumber = async (page: Page) => Number(await page.getByTestId('current-frame').textContent());

test('works with a finger: tools, drawing and the frame scrubber', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'touch input is sent through the Chromium DevTools protocol');
  await openClip(page);

  // Controls are large enough for a fingertip.
  const play = (await page.getByTestId('play-button').boundingBox())!;
  expect(play.height).toBeGreaterThanOrEqual(44);
  const circleTool = page.locator('[data-tool-button="ellipse"]');
  expect((await circleTool.boundingBox())!.height).toBeGreaterThanOrEqual(44);

  await circleTool.tap();
  const frame = (await overlay(page).boundingBox())!;
  const at = (fx: number, fy: number) => ({ x: frame.x + frame.width * fx, y: frame.y + frame.height * fy });
  await swipe(page, at(0.5, 0.5), at(0.5, 0.3));
  await expect(shapes(page)).toHaveCount(1);
  await expect(overlay(page).locator('ellipse.shape__ink')).toHaveCount(1);

  // Dragging the scrubber with a finger moves frame by frame and does not scroll the page.
  const viewport = (await page.locator('.scrubber__viewport').boundingBox())!;
  const center = { x: viewport.x + viewport.width / 2, y: viewport.y + viewport.height / 2 };
  await swipe(page, center, { x: center.x - 12 * 4, y: center.y }, 16, 150);
  await expect.poll(() => frameNumber(page)).toBe(5);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);

  // Tapping the right side steps forward one frame.
  await page.touchscreen.tap(center.x + viewport.width / 4, center.y);
  await expect.poll(() => frameNumber(page)).toBe(6);

  // Holding the next-frame button repeats, like holding a key.
  const next = (await page.getByRole('button', { name: 'Next frame' }).boundingBox())!;
  const cdp = await page.context().newCDPSession(page);
  const touch = [{ x: next.x + next.width / 2, y: next.y + next.height / 2, id: 2 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: touch });
  await page.waitForTimeout(800);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect.poll(() => frameNumber(page)).toBeGreaterThan(8);
});
