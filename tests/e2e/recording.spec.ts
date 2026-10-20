import { expect, test } from '@playwright/test';
import { drag, openClip } from './helpers';

// A fake microphone, granted without a prompt.
test.use({
  permissions: ['microphone'],
  launchOptions: { args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] },
});

test.describe('recording', () => {
  test('records the video with the drawings and offers it for download', async ({ page, browserName }) => {
    await openClip(page);
    await page.keyboard.press('r');
    await page.getByRole('radio', { name: 'Thick', exact: true }).click();
    await drag(page, [0.2, 0.2], [0.8, 0.8]);

    await page.getByTestId('record-button').click();
    await expect(page.getByRole('button', { name: 'Stop recording' })).toBeVisible();
    await expect(page.locator('.record-button__time')).toHaveText(/^0:0[1-9]$/, { timeout: 5000 });
    await page.keyboard.press('Space');
    await page.waitForTimeout(600);
    await page.getByRole('button', { name: 'Stop recording' }).click();

    const dialog = page.getByRole('dialog', { name: 'Recording ready' });
    await expect(dialog).toBeVisible();
    await expect(dialog).not.toContainText('microphone');
    const download = dialog.getByTestId('recording-download');
    await expect(download).toHaveAttribute('download', /\.(mp4|webm)$/);

    // The file holds a picture with the yellow rectangle burnt in, and a sound track.
    const check = await page.getByTestId('recording-preview').evaluate(async (video: HTMLVideoElement) => {
      if (video.readyState < 1) await new Promise((resolve) => video.addEventListener('loadedmetadata', resolve, { once: true }));
      // Read a frame from the middle: the very first one is not always painted yet when it reports ready.
      video.currentTime = 0.5;
      await new Promise((resolve) => video.addEventListener('seeked', resolve, { once: true }));
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(video, 0, 0);
      // Left edge of the rectangle, halfway down.
      const [r, g, b] = ctx.getImageData(Math.round(canvas.width * 0.2), Math.round(canvas.height * 0.5), 1, 1).data;
      const blob = await (await fetch(video.src)).blob();
      return { width: video.videoWidth, size: blob.size, r: r!, g: g!, b: b! };
    });
    expect(check.width).toBeGreaterThan(0);
    expect(check.size).toBeGreaterThan(10_000);
    // #ffd60a, allowing for compression. WebKit does not hand a paused preview's
    // pixels to a canvas, so there only the file itself is checked.
    if (browserName !== 'webkit') {
      expect(check.r).toBeGreaterThan(180);
      expect(check.g).toBeGreaterThan(150);
      expect(check.b).toBeLessThan(110);
    }

    // Escape does not throw the recording away; Discard does.
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Discard' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('button', { name: 'Record analysis' })).toBeEnabled();
  });
});
