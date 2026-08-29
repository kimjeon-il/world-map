import { expect, test } from '@playwright/test';

async function openCanvasApp(page) {
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    window.Worker = class DelayedCanvasPatchWorker extends NativeWorker {
      constructor(url, options) {
        super(url, options);
        this.delaysCanvasPatch = options?.name === 'pandolab-canvas-renderer';
      }

      postMessage(message, transfer = []) {
        if (this.delaysCanvasPatch && message?.type === 'patch') {
          window.setTimeout(
            () => NativeWorker.prototype.postMessage.call(this, message, transfer),
            1500,
          );
          return;
        }
        NativeWorker.prototype.postMessage.call(this, message, transfer);
      }
    };
  });

  await page.goto('/?renderer=canvas');
  await expect(page.locator('#bootstrapLoading')).toHaveAttribute('hidden', '', { timeout: 30_000 });
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
  await expect.poll(
    () => page.evaluate(() => window.__PANDOLAB_GPU_METRICS__?.renderer),
    { timeout: 30_000 },
  ).toBe('canvas-worker');
  await expect.poll(
    () => page.evaluate(() => window.__PANDOLAB_BOUNDARY_GHOSTING__?.installed === true),
    { timeout: 10_000 },
  ).toBe(true);
}

test('canvas worker hides a stale bitmap while a delayed geometry patch catches up', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1280, height: 820 });
  await openCanvasApp(page);

  const folderToggle = page.locator('[data-layer-folder-toggle="countries"]').first();
  if (await folderToggle.getAttribute('aria-expanded') !== 'true') await folderToggle.click();

  const firstRow = page.locator('#countriesLayerChildren .layer-child').first();
  const name = (await firstRow.locator('.layer-child-name').textContent()).trim();
  await firstRow.locator('.layer-child-menu').click();
  await page.locator('#objectDeleteMenuBtn').click();
  await page.locator('#confirmModalOkBtn').click();

  await expect.poll(
    () => page.evaluate(() => window.__PANDOLAB_GPU_METRICS__?.pendingCountryCount || 0),
    { timeout: 5_000 },
  ).toBeGreaterThan(0);

  await expect.poll(
    () => page.evaluate(() => document.querySelector('.gpu-map-canvas')?.dataset.geometryTransitionHidden === 'true'),
    { timeout: 3_000 },
  ).toBe(true);

  await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);

  await expect.poll(
    () => page.evaluate(() => window.__PANDOLAB_GPU_METRICS__?.pendingCountryCount || 0),
    { timeout: 15_000 },
  ).toBe(0);

  await expect.poll(
    () => page.evaluate(() => document.querySelector('.gpu-map-canvas')?.dataset.geometryTransitionHidden === 'true'),
    { timeout: 5_000 },
  ).toBe(false);

  const guard = await page.evaluate(() => ({ ...window.__PANDOLAB_BOUNDARY_GHOSTING__ }));
  expect(guard.installed).toBe(true);
  expect(guard.transitionActive).toBe(false);
  expect(guard.lastRestoredGeometryRevision).toBeGreaterThan(0);
});
