import { expect, test, type Page } from '@playwright/test';
import {
  MAIN_CLIP,
  OTHER_CLIP,
  clickTimeline,
  clickVideo,
  currentTime,
  drag,
  expectSaved,
  fixture,
  openClip,
  overlay,
  saveIndicator,
  shapes,
  waitForWorkspace,
} from './helpers';

async function drawThree(page: Page) {
  await page.keyboard.press('a');
  await drag(page, [0.2, 0.7], [0.4, 0.4]);
  await page.getByRole('radio', { name: 'Red' }).click();
  await page.keyboard.press('c');
  await drag(page, [0.55, 0.3], [0.75, 0.6]);
  await page.keyboard.press('t');
  await clickVideo(page, [0.1, 0.1]);
  await page.keyboard.type('Second phase');
  await page.keyboard.press('Enter');
  await expect(shapes(page)).toHaveCount(3);
}

/** Removes the stored copy of every video, as the browser may do under storage pressure. */
async function evictStoredVideos(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open('coach-video-analysis');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const tx = request.result.transaction('videos', 'readwrite');
          tx.objectStore('videos').clear();
          tx.oncomplete = () => {
            request.result.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
  );
}

test.describe('saving and restoring', () => {
  test('a reload restores the video, every drawing and the playhead', async ({ page }) => {
    await openClip(page);
    await clickTimeline(page, 0.5);
    await expect.poll(() => currentTime(page)).toBeCloseTo(3, 1);
    await drawThree(page);

    // The indicator reports unsaved work first, and "Saved" only afterwards.
    await page.keyboard.press('r');
    await drag(page, [0.6, 0.7], [0.8, 0.9]);
    await expect(saveIndicator(page)).not.toHaveAttribute('data-status', 'saved');
    await expectSaved(page);
    const snapshot = await overlay(page).locator('g[data-id]').evaluateAll((nodes) => nodes.map((node) => node.outerHTML));
    const time = await currentTime(page);
    // The playhead position is written at most once a second.
    await page.waitForTimeout(1200);

    await page.reload();
    await waitForWorkspace(page);
    await expect(shapes(page)).toHaveCount(4);
    const restored = await overlay(page).locator('g[data-id]').evaluateAll((nodes) => nodes.map((node) => node.outerHTML));
    expect(restored).toEqual(snapshot);
    await expect.poll(() => currentTime(page)).toBeCloseTo(time, 2);
    await expect(page.getByLabel('Analysis name')).toHaveValue('clip-25fps');
    // Undo history is per session: nothing to undo after a reload.
    await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();
  });

  test('an analysis can be closed, found in the library and reopened', async ({ page }) => {
    await openClip(page);
    await drawThree(page);
    await page.getByLabel('Analysis name').fill('Derby — first half');
    await page.getByLabel('Analysis name').press('Enter');

    // Leaving straight after an edit must still save it.
    await page.keyboard.press('l');
    await drag(page, [0.5, 0.8], [0.9, 0.85]);
    await page.getByRole('button', { name: 'All analyses' }).click();

    const card = page.getByTestId('project-card');
    await expect(card).toHaveCount(1);
    await expect(card).toContainText('Derby — first half');
    await expect(card).toContainText('4 drawings');
    await expect(card.locator('img')).toBeVisible();
    await expect(card).not.toContainText('Video not stored');

    await card.click();
    await waitForWorkspace(page);
    await expect(shapes(page)).toHaveCount(4);
    await expect(overlay(page).locator('text')).toHaveText('Second phase');
    await expect(overlay(page).locator('ellipse.shape__ink')).toHaveAttribute('stroke', '#ff453a');

    // Browser back returns to the library; forward reopens the analysis.
    await page.goBack();
    await expect(card).toBeVisible();
    await page.goForward();
    await waitForWorkspace(page);
    await expect(shapes(page)).toHaveCount(4);
  });

  test('several analyses stay separate, and deleting one asks first', async ({ page }) => {
    await openClip(page);
    await page.keyboard.press('r');
    await drag(page, [0.2, 0.2], [0.4, 0.4]);
    await expectSaved(page);
    await page.getByRole('button', { name: 'All analyses' }).click();

    await page.getByTestId('video-input').setInputFiles(fixture(OTHER_CLIP));
    await waitForWorkspace(page);
    await expect(shapes(page)).toHaveCount(0);
    await expect(page.getByTestId('fps-button')).toHaveText('30 fps');
    const frame = (await page.getByTestId('video-frame').boundingBox())!;
    expect(frame.width / frame.height).toBeCloseTo(4 / 3, 2);
    await page.getByRole('button', { name: 'All analyses' }).click();

    await expect(page.getByTestId('project-card')).toHaveCount(2);
    await page.getByRole('button', { name: 'Delete clip-30fps-4x3' }).click();
    const dialog = page.getByRole('dialog', { name: 'Delete this analysis?' });
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByTestId('project-card')).toHaveCount(2);

    await page.getByRole('button', { name: 'Delete clip-30fps-4x3' }).click();
    await dialog.getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByTestId('project-card')).toHaveCount(1);
    await expect(page.getByTestId('project-card')).toContainText('1 drawing');

    await page.reload();
    await expect(page.getByTestId('project-card')).toHaveCount(1);
  });

  test('a link to a deleted analysis lands in the library with an explanation', async ({ page }) => {
    await page.goto('/#/a/does-not-exist');
    await expect(page.getByTestId('open-error')).toContainText('could not be found');
    await expect(page.getByRole('button', { name: 'Choose video' })).toBeVisible();
  });
});

test.describe('missing video', () => {
  test('drawings are kept and reappear when the same file is selected again', async ({ page }) => {
    await openClip(page);
    await drawThree(page);
    await expectSaved(page);

    await evictStoredVideos(page);
    await page.reload();

    await expect(page.getByRole('heading', { name: 'Select the video to continue' })).toBeVisible();
    await expect(page.getByText('Your 3 drawings are saved')).toBeVisible();
    await expect(page.getByText('clip-25fps.webm')).toBeVisible();
    // Tools are unavailable without a frame to draw on.
    await expect(page.locator('[data-tool-button="arrow"]')).toBeDisabled();

    // A wrong file type is refused with a message.
    await page.getByTestId('relink-input').setInputFiles(fixture('notes.txt'));
    await expect(page.getByRole('alert')).toContainText('is not a video file');

    await page.getByTestId('relink-input').setInputFiles(fixture(MAIN_CLIP));
    await waitForWorkspace(page);
    await expect(shapes(page)).toHaveCount(3);

    // The video is stored again, so the next reload needs nothing.
    await page.reload();
    await waitForWorkspace(page);
    await expect(shapes(page)).toHaveCount(3);
  });

  test('selecting a different video requires confirmation', async ({ page }) => {
    await openClip(page);
    await page.keyboard.press('r');
    await drag(page, [0.2, 0.2], [0.4, 0.4]);
    await expectSaved(page);
    await evictStoredVideos(page);
    await page.reload();

    await page.getByTestId('relink-input').setInputFiles(fixture(OTHER_CLIP));
    const dialog = page.getByRole('dialog', { name: 'Use a different video?' });
    await expect(dialog).toContainText('does not match the original video');
    await dialog.getByRole('button', { name: 'Choose another' }).click();
    await expect(page.getByRole('heading', { name: 'Select the video to continue' })).toBeVisible();

    await page.getByTestId('relink-input').setInputFiles(fixture(OTHER_CLIP));
    await dialog.getByRole('button', { name: 'Use this video' }).click();
    await waitForWorkspace(page);
    await expect(shapes(page)).toHaveCount(1);
    const frame = (await page.getByTestId('video-frame').boundingBox())!;
    expect(frame.width / frame.height).toBeCloseTo(4 / 3, 2);
    await expect(page.getByTestId('fps-button')).toHaveText('30 fps');
  });

  test('a video too large for browser storage still works, with an honest warning', async ({ page }) => {
    // Pretend the browser has almost no room left.
    await page.addInitScript(() => {
      navigator.storage.estimate = async () => ({ usage: 0, quota: 1024 });
    });
    await page.goto('/');
    await page.getByTestId('video-input').setInputFiles(fixture(MAIN_CLIP));
    await expect(page.getByTestId('video-frame')).toBeVisible();
    await expect(page.getByRole('alert')).toContainText('too large to keep');
    await expect(page.getByRole('alert')).toContainText('Your drawings are saved as usual');

    await page.keyboard.press('a');
    await drag(page, [0.2, 0.2], [0.5, 0.5]);
    await expectSaved(page);

    await page.reload();
    await expect(page.getByRole('heading', { name: 'Select the video to continue' })).toBeVisible();
    await expect(page.getByText('Your drawing is saved')).toBeVisible();
    await page.getByRole('button', { name: 'All analyses' }).click();
    await expect(page.getByTestId('project-card')).toContainText('Video not stored');
  });
});

test.describe('two tabs', () => {
  test('a stale tab cannot silently overwrite newer work', async ({ context, page }) => {
    await openClip(page);
    const other = await context.newPage();
    await other.goto(page.url());
    await waitForWorkspace(other);

    // Tab 1 draws two shapes and saves.
    await page.keyboard.press('r');
    await drag(page, [0.1, 0.1], [0.3, 0.3]);
    await drag(page, [0.5, 0.5], [0.7, 0.7]);
    await expectSaved(page);

    // Tab 2, unaware, draws one. Its save must be refused, not applied.
    await other.keyboard.press('a');
    await drag(other, [0.2, 0.8], [0.6, 0.6]);
    await expect(saveIndicator(other)).toHaveAttribute('data-status', 'conflict');
    await expect(other.getByRole('alert')).toContainText('changed in another tab');
    await expect(shapes(other)).toHaveCount(1);

    // Storage still holds tab 1's work.
    await page.reload();
    await waitForWorkspace(page);
    await expect(shapes(page)).toHaveCount(2);

    // Tab 2 chooses to load the other version.
    await other.getByRole('button', { name: 'Load the other version' }).click();
    await expect(shapes(other)).toHaveCount(2);
    await expectSaved(other);
    await expect(other.getByRole('alert')).toHaveCount(0);

    // From here tab 2 can save normally again.
    await drag(other, [0.2, 0.8], [0.6, 0.6]);
    await expectSaved(other);
    await expect(shapes(other)).toHaveCount(3);
  });

  test('keeping this tab’s version overwrites only after an explicit choice', async ({ context, page }) => {
    await openClip(page);
    const other = await context.newPage();
    await other.goto(page.url());
    await waitForWorkspace(other);

    await page.keyboard.press('r');
    await drag(page, [0.1, 0.1], [0.3, 0.3]);
    await expectSaved(page);

    await other.keyboard.press('c');
    await drag(other, [0.4, 0.4], [0.6, 0.7]);
    await expect(saveIndicator(other)).toHaveAttribute('data-status', 'conflict');

    // The library cannot be reached while work is unsaved: nothing is dropped.
    await other.getByRole('button', { name: 'All analyses' }).click();
    await expect(other.getByTestId('video-frame')).toBeVisible();
    await expect(shapes(other)).toHaveCount(1);

    await other.getByRole('button', { name: 'Keep this version' }).click();
    await expectSaved(other);
    await other.reload();
    await waitForWorkspace(other);
    await expect(overlay(other).locator('ellipse.shape__ink')).toHaveCount(1);
    await expect(shapes(other)).toHaveCount(1);
  });
});

test.describe('small screens', () => {
  test.use({ viewport: { width: 390, height: 780 }, hasTouch: false });

  test('the layout regroups without horizontal scrolling and stays usable', async ({ page }) => {
    await page.goto('/');
    const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
    expect(await fits()).toBe(true);

    await page.getByTestId('video-input').setInputFiles(fixture(MAIN_CLIP));
    await waitForWorkspace(page);
    expect(await fits()).toBe(true);
    await expect(page.getByText('work best on a larger screen')).toBeVisible();

    // Tools sit below the video, in a row.
    const frame = (await page.getByTestId('video-frame').boundingBox())!;
    const arrow = (await page.locator('[data-tool-button="arrow"]').boundingBox())!;
    const pen = (await page.locator('[data-tool-button="path"]').boundingBox())!;
    expect(arrow.y).toBeGreaterThan(frame.y + frame.height - 1);
    expect(arrow.y).toBe(pen.y);
    expect(frame.width).toBeGreaterThan(380);

    await page.locator('[data-tool-button="arrow"]').click();
    await drag(page, [0.2, 0.7], [0.7, 0.3]);
    await expect(shapes(page)).toHaveCount(1);
    await expect(page.getByTestId('play-button')).toBeVisible();
    await expect(page.getByTestId('timeline')).toBeVisible();
    await page.getByRole('button', { name: 'Next frame' }).click();
    await expect(page.getByTestId('current-frame')).toHaveText('2');
  });
});
