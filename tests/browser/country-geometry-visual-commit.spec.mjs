import { expect, test } from '@playwright/test';

async function openApp(page, renderer) {
  await page.goto(`/?renderer=${renderer}`);
  await expect(page.locator('#bootstrapLoading')).toHaveAttribute('hidden', '', { timeout: 30_000 });
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
}

for (const renderer of ['webgl2', 'webgl1']) {
test(`${renderer} country deletion and undo hide stale GPU geometry before delayed patch meshes arrive`, async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    let patchMessageCount = 0;
    window.Worker = class DelayedCountryPatchWorker extends NativeWorker {
      constructor(url, options) {
        super(url, options);
        this.delaysCountryPatch = options?.name === 'pandolab-country-patch-mesh';
      }

      postMessage(message, transfer = []) {
        if (!this.delaysCountryPatch || !message?.geometryRevision) {
          NativeWorker.prototype.postMessage.call(this, message, transfer);
          return;
        }
        patchMessageCount += 1;
        const delay = patchMessageCount === 1 ? 12_000 : 100;
        window.setTimeout(() => NativeWorker.prototype.postMessage.call(this, message, transfer), delay);
      }
    };
  });

  await openApp(page, renderer);
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_GPU_METRICS__?.renderer), { timeout: 30_000 }).toBe(renderer);
  const folderToggle = page.locator('[data-layer-folder-toggle="countries"]').first();
  if (await folderToggle.getAttribute('aria-expanded') !== 'true') await folderToggle.click();
  await page.locator('#countriesLocked').uncheck({ force: true });
  const firstRow = page.locator('#countriesLayerChildren .layer-child').first();
  const name = (await firstRow.locator('.layer-child-name').textContent()).trim();

  await firstRow.locator('.layer-child-menu').click();
  await page.locator('#objectDeleteMenuBtn').click();
  await page.locator('#confirmModalOkBtn').click();
  const pendingDelete = await page.evaluate(() => ({
    metrics: window.__PANDOLAB_GPU_METRICS__,
    previews: document.querySelectorAll('.country-patch-preview').length,
  }));
  expect(pendingDelete.metrics.pendingCountryCount).toBeGreaterThan(0);
  expect(pendingDelete.metrics.pendingOldMeshVisibleCount).toBe(0);
  expect(pendingDelete.metrics.committedGeometryRevision).toBeGreaterThan(pendingDelete.metrics.displayedGeometryRevision);
  expect(pendingDelete.previews).toBe(0);
  await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);

  await page.locator('#undoBtn').click();
  await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_GPU_METRICS__?.pendingCountryCount), {
    timeout: 30_000,
  }).toBe(0);
  const afterUndo = await page.evaluate(() => ({ ...window.__PANDOLAB_GPU_METRICS__ }));
  expect(afterUndo.displayedGeometryRevision).toBe(afterUndo.committedGeometryRevision);
  expect(afterUndo.pendingOldMeshVisibleCount).toBe(0);

  await page.waitForTimeout(13_000);
  const afterStaleResult = await page.evaluate(() => ({ ...window.__PANDOLAB_GPU_METRICS__ }));
  expect(afterStaleResult.displayedGeometryRevision).toBe(afterUndo.displayedGeometryRevision);
  expect(afterStaleResult.pendingCountryCount).toBe(0);
  await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
});
}
