import { expect, test, type Page } from '@playwright/test';
import { currentTime, isPaused, openClip, overlay, shapes } from './helpers';

/** Counts React commits by standing in for the DevTools hook. */
async function countReactCommits(page: Page) {
  await page.addInitScript(() => {
    const state = window as unknown as { __commits: number; __REACT_DEVTOOLS_GLOBAL_HOOK__: unknown };
    state.__commits = 0;
    state.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
      supportsFiber: true,
      renderers: new Map(),
      inject: () => 1,
      onScheduleFiberRoot() {},
      onCommitFiberRoot() {
        state.__commits += 1;
      },
      onPostCommitFiberRoot() {},
      onCommitFiberUnmount() {},
      checkDCE() {},
    };
  });
}

const commits = (page: Page) => page.evaluate(() => (window as unknown as { __commits: number }).__commits);

test.describe('rendering cost', () => {
  test('playing the video does not re-render the interface', async ({ page }) => {
    await countReactCommits(page);
    await openClip(page);
    expect(await commits(page)).toBeGreaterThan(0);

    await page.keyboard.press('Space');
    await expect.poll(() => isPaused(page)).toBe(false);
    await expect.poll(() => currentTime(page)).toBeGreaterThan(0.2);

    const before = await commits(page);
    const from = await currentTime(page);
    await page.waitForTimeout(1500);
    const elapsed = (await currentTime(page)) - from;
    const during = (await commits(page)) - before;

    // More than a second of playback, with the time readout and playhead moving…
    expect(elapsed).toBeGreaterThan(1);
    await expect(page.getByTestId('current-time')).not.toHaveText('0:00.00');
    // …and React did not render once.
    expect(during).toBe(0);
  });

  test('scrubbing the timeline does not re-render per pointer move', async ({ page }) => {
    await countReactCommits(page);
    await openClip(page);
    const track = (await page.locator('.timeline__track').boundingBox())!;
    const y = track.y + track.height / 2;

    await page.mouse.move(track.x + 20, y);
    await page.mouse.down();
    await expect(page.getByTestId('timeline')).toHaveClass(/is-scrubbing/);
    const before = await commits(page);
    await page.mouse.move(track.x + track.width - 20, y, { steps: 120 });
    const during = (await commits(page)) - before;
    await page.mouse.up();

    expect(during).toBe(0);
    await expect.poll(() => currentTime(page)).toBeGreaterThan(5);
  });

  test('a burst of pointer movement is previewed once per frame and stored compactly', async ({ page }) => {
    await countReactCommits(page);
    await openClip(page);
    await page.keyboard.press('p');

    const box = (await overlay(page).boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.1, box.y + box.height * 0.5);
    await page.mouse.down();
    await expect(overlay(page).locator('.overlay__draft g')).toHaveCount(1);

    // 300 pointer events delivered within a single frame, as a fast pen or mouse produces.
    const samples = 300;
    const during = await page.evaluate(
      async ({ box, samples }) => {
        const state = window as unknown as { __commits: number };
        const svg = document.querySelector('[data-testid="annotation-overlay"]')!;
        const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));
        await nextFrame();
        const before = state.__commits;
        for (let i = 1; i <= samples; i++) {
          const t = i / samples;
          svg.dispatchEvent(
            new PointerEvent('pointermove', {
              pointerId: 1,
              isPrimary: true,
              bubbles: true,
              clientX: box.x + box.width * (0.1 + 0.8 * t),
              clientY: box.y + box.height * (0.5 + 0.3 * Math.sin(t * 12)),
            }),
          );
        }
        await nextFrame();
        await nextFrame();
        return state.__commits - before;
      },
      { box, samples },
    );
    await page.mouse.up();

    expect(during).toBeGreaterThanOrEqual(1);
    expect(during).toBeLessThanOrEqual(2);
    await expect(shapes(page)).toHaveCount(1);

    // The stroke follows the whole path, but is simplified before it is stored.
    const ink = shapes(page).locator('path.shape__ink');
    const segments = await ink.evaluate((path) => (path.getAttribute('d') ?? '').split(/[QL]/).length);
    expect(segments).toBeGreaterThan(8);
    expect(segments).toBeLessThan(samples / 2);
    const extent = (await ink.boundingBox())!;
    expect(extent.width / box.width).toBeGreaterThan(0.75);
  });
});
