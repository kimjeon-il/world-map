import { expect, test } from '@playwright/test';
import { selectUiOption } from './helpers/ui-select.mjs';

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

async function openFolder(page, group) {
  const toggle = page.locator(`[data-layer-folder-toggle="${group}"]`).first();
  if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
}

async function autosavedCountryLock(page, countryId) {
  return page.evaluate(async expectedId => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('pandolab-editor-v010', 2);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const project = await new Promise((resolve, reject) => {
        const transaction = database.transaction('projects', 'readonly');
        const request = transaction.objectStore('projects').get('active-project');
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
      });
      return project?.countryOverrides?.[String(expectedId)]?.locked === true;
    } finally {
      database.close();
    }
  }, countryId);
}

async function autosavedHydroEdit(page, name) {
  return page.evaluate(async expectedName => {
    const database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('pandolab-editor-v010', 2);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const project = await new Promise((resolve, reject) => {
        const transaction = database.transaction('projects', 'readonly');
        const request = transaction.objectStore('projects').get('active-project');
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);
      });
      return project?.hydroEdits?.find(feature => feature.properties?.name === expectedName) || null;
    } finally {
      database.close();
    }
  }, name);
}

test('country lock is per-object, preserves inspection, rejects geometry edits, and restores from autosave', async ({ page }) => {
  test.setTimeout(240_000);
  const errors = await openApp(page);
  await openFolder(page, 'countries');
  const rows = page.locator('#countriesLayerChildren .layer-child');
  const firstRow = rows.first();
  const secondRow = rows.nth(1);
  const countryId = await firstRow.getAttribute('data-item-id');
  const otherCountryId = await secondRow.getAttribute('data-item-id');

  await firstRow.locator('.layer-child-menu').click();
  await page.locator('#objectLockMenuBtn').click();
  await expect.poll(() => page.evaluate(id => window.PANDOLAB_TERRITORIAL.isLocked('country', id), countryId)).toBe(true);
  expect(await page.evaluate(id => window.PANDOLAB_TERRITORIAL.isLocked('country', id), otherCountryId)).toBe(false);
  await expect(firstRow).toHaveClass(/is-selected/);
  await expect(page.locator('#countryProperties')).toBeVisible();

  await page.locator('#actionsTabBtn').click();
  await page.locator('#editCoastBtn').click();
  await expect(page.locator('#actionStatus')).toHaveAttribute('aria-label', /잠금을 해제/);
  await expect(page.locator('#modeActionBar')).toBeHidden();

  await page.locator('#countriesVisible').uncheck();
  await expect(page.locator('#countryProperties')).toBeVisible();
  expect(await page.evaluate(id => window.PANDOLAB_TERRITORIAL.isLocked('country', id), countryId)).toBe(true);
  await page.locator('#countriesVisible').check();

  await expect.poll(() => autosavedCountryLock(page, countryId), { timeout: 10_000 }).toBe(true);
  await page.reload();
  await expect(page.locator('#bootstrapLoading')).toHaveAttribute('hidden', '', { timeout: 30_000 });
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
  expect(await page.evaluate(id => window.PANDOLAB_TERRITORIAL.isLocked('country', id), countryId)).toBe(true);
  await openFolder(page, 'countries');
  const restoredRow = page.locator(`#countriesLayerChildren .layer-child[data-item-id="${countryId}"]`);
  await restoredRow.locator('.layer-child-name').click();
  await expect(page.locator('#countryProperties')).toBeVisible();
  await restoredRow.locator('.layer-child-menu').click();
  await expect(page.locator('#objectLockMenuBtn')).toHaveText('잠금 해제');
  await expect(page.locator('#objectDeleteMenuBtn')).toBeDisabled();
  expect(errors).toEqual([]);
});

test('built-in hydro can hide but has no delete menu, while a user distribution can be deleted', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = await openApp(page);
  await openFolder(page, 'hydro');
  const hydroRow = page.locator('#hydroLayerChildren .layer-child[data-item-id="rivers_hydro"]');
  await expect(hydroRow).toBeVisible();
  await expect(hydroRow.locator('.layer-child-menu')).toHaveCount(0);
  const hydroVisibility = hydroRow.locator('input[type="checkbox"]');
  await hydroVisibility.uncheck();
  await expect(hydroRow).toBeVisible();
  await hydroVisibility.check();

  await page.locator('#createMenuBtn').click();
  await page.locator('#addDistributionBtn').click();
  await selectUiOption(page, '#distributionTypeInput', 'language');
  page.once('dialog', dialog => dialog.accept('잠금 가시성 테스트'));
  await page.locator('#distributionTypeConfirmBtn').click();
  await openFolder(page, 'languages');
  const userRow = page.locator('#languagesLayerChildren .layer-child', { hasText: '잠금 가시성 테스트' });
  await expect(userRow).toBeVisible();
  await userRow.locator('.layer-child-menu').click();
  await expect(page.locator('#objectDeleteMenuBtn')).toBeVisible();
  await page.locator('#objectDeleteMenuBtn').click();
  await expect(page.locator('#confirmModal')).toBeVisible();
  await page.locator('#confirmModalOkBtn').click();
  await expect(page.getByRole('button', { name: '잠금 가시성 테스트', exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('user-created hydro stays outside drawings and round-trips through autosave', async ({ page }) => {
  test.setTimeout(240_000);
  const errors = await openApp(page);
  await page.locator('#createMenuBtn').click();
  await page.locator('#addRiverBtn').click();
  const mapBox = await page.locator('#map').boundingBox();
  expect(mapBox).not.toBeNull();
  await page.mouse.click(mapBox.x + mapBox.width * 0.42, mapBox.y + mapBox.height * 0.45);
  await page.mouse.click(mapBox.x + mapBox.width * 0.55, mapBox.y + mapBox.height * 0.53);
  await expect(page.locator('#modePrimaryBtn')).toBeEnabled();
  await page.locator('#modePrimaryBtn').click();
  await expect(page.locator('#hydroProperties')).toBeVisible();
  await expect(page.locator('#hydroEditFields')).toBeVisible();
  await expect(page.locator('circle.vertex-handle')).toHaveCount(2);
  await page.locator('#hydroNameInput').fill('분리 수계 테스트');
  await page.locator('#hydroNameInput').blur();
  await page.locator('#hydroNotesInput').fill('Hydro domain');
  await page.locator('#hydroNotesInput').blur();

  await openFolder(page, 'hydro');
  const editRow = page.locator('#hydroLayerChildren .layer-child', { hasText: '분리 수계 테스트' });
  await expect(editRow).toBeVisible();
  await openFolder(page, 'drawings');
  await expect(page.locator('#drawingsLayerChildren .layer-child[data-item-id="rivers_hydro"]')).toHaveCount(0);
  await expect(page.locator('#drawingsLayerChildren .layer-child[data-item-id="lakes_natural_earth"]')).toHaveCount(0);

  await expect.poll(() => autosavedHydroEdit(page, '분리 수계 테스트'), { timeout: 10_000 }).not.toBeNull();
  const saved = await autosavedHydroEdit(page, '분리 수계 테스트');
  expect(saved.properties.pandolab_domain).toBe('hydro');
  expect(saved.properties.notes).toBe('Hydro domain');

  await page.reload();
  await expect(page.locator('#bootstrapLoading')).toHaveAttribute('hidden', '', { timeout: 30_000 });
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
  await openFolder(page, 'hydro');
  const restored = page.locator('#hydroLayerChildren .layer-child', { hasText: '분리 수계 테스트' });
  await expect(restored).toBeVisible();
  await restored.locator('.layer-child-menu').click();
  await page.locator('#objectDeleteMenuBtn').click();
  await page.locator('#confirmModalOkBtn').click();
  await expect(page.locator('#hydroLayerChildren .layer-child', { hasText: '분리 수계 테스트' })).toHaveCount(0);
  expect(errors).toEqual([]);
});
