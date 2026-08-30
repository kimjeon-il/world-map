import { expect, test } from '@playwright/test';

async function openApp(page) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?renderer=canvas');
  await expect(page.locator('#bootstrapLoading')).toHaveAttribute('hidden', '', { timeout: 30_000 });
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
  return errors;
}

async function autosaveRecords(page) {
  return page.evaluate(async () => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('pandolab-editor', 2);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      return await new Promise((resolve, reject) => {
        const transaction = database.transaction('projects', 'readonly');
        const store = transaction.objectStore('projects');
        const projectRequest = store.get('active-project');
        const viewRequest = store.get('active-view');
        transaction.oncomplete = () => resolve({ project: projectRequest.result || null, view: viewRequest.result || null });
        transaction.onerror = () => reject(transaction.error);
      });
    } finally {
      database.close();
    }
  });
}

test('presentation persists without document history while view and session stay outside the project record', async ({ page }) => {
  test.setTimeout(240_000);
  const errors = await openApp(page);
  const dirty = page.locator('#projectSaveStatus');
  const undo = page.locator('#undoBtn');

  await expect(dirty).toBeHidden();
  await expect(undo).toBeDisabled();

  await page.locator('[data-layer-folder-toggle="countries"]').first().click();
  await expect(page.locator('#countriesLayerChildren .layer-child').first()).toBeVisible();
  await page.locator('#countriesLayerChildren .layer-child-name').first().click();
  await page.locator('#flatBtn').click();
  await expect(page.locator('#flatBtn')).toHaveAttribute('aria-pressed', 'true');
  await expect(dirty).toBeHidden();
  await expect(undo).toBeDisabled();

  await page.locator('#countriesVisible').uncheck();
  await expect(dirty).toBeVisible();
  await expect(undo).toBeDisabled();

  await expect.poll(async () => {
    const records = await autosaveRecords(page);
    return records.project?.layerVisibility?.countries === false && records.view?.projection === 'flat';
  }, { timeout: 15_000 }).toBe(true);

  const records = await autosaveRecords(page);
  expect(records.project).not.toHaveProperty('projection');
  expect(records.project).not.toHaveProperty('view');
  expect(records.project).not.toHaveProperty('layerFolders');
  expect(records.project).not.toHaveProperty('selectedDistributionLayerId');
  expect(records.view.projection).toBe('flat');

  await page.reload();
  await expect(page.locator('#bootstrapLoading')).toHaveAttribute('hidden', '', { timeout: 30_000 });
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
  await expect(page.locator('#flatBtn')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#countriesVisible')).not.toBeChecked();
  await expect(page.locator('#countryProperties')).toBeHidden();
  expect(errors).toEqual([]);
});
