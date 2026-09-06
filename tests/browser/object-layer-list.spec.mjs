import { expect, test } from '@playwright/test';

test('object list shares bundles, direct rows and actions on desktop and mobile', async ({ page }) => {
  test.setTimeout(150_000);
  page.setDefaultTimeout(10_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?debug=1');
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
  await expect(page.locator('#layerSection .layer-category,#layerSection .layer-folder,#layerSection [data-layer-style-toggle]')).toHaveCount(0);
  await expect(page.locator('.layer-bundle-row .layer-child-name-label')).toHaveText(['세계 국가', '기본 강', '기본 호수']);
  await expect(page.locator('[data-bundle-key="countries"] .layer-item-type')).toHaveText('국가 258');
  const footerY = (await page.locator('.layer-panel-footer').boundingBox()).y;
  await page.locator('.layer-bundle-toggle[data-layer-folder-toggle="countries"]').click();
  await expect(page.locator('.layer-list')).toHaveAttribute('data-virtualized', 'true');
  expect(await page.locator('.layer-list .layer-child').count()).toBeLessThan(80);
  await page.locator('.layer-list').evaluate(el => { el.scrollTop = el.scrollHeight; });
  await expect(page.locator('[data-bundle-key="lakes"]')).toBeVisible();
  expect((await page.locator('.layer-panel-footer').boundingBox()).y).toBe(footerY);
  await page.locator('.layer-list').evaluate(el => { el.scrollTop = 0; });
  await page.locator('.layer-bundle-toggle[data-layer-folder-toggle="countries"]').click();

  // The existing creation workflow inserts a direct, sorted row, not a type folder.
  await page.locator('#createMenuBtn').click();
  await page.locator('#addDistributionBtn').click();
  page.once('dialog', dialog => dialog.accept('가나다 언어권'));
  await page.locator('#distributionTypeConfirmBtn').click();
  const language = page.locator('.layer-list .layer-child[data-layer-group="languages"]');
  await expect(language).toHaveCount(1);
  await expect(language.locator('.layer-item-type')).toHaveText('언어');
  await expect(language).not.toHaveAttribute('data-bundle-member', /.+/);
  await expect(page.locator('#distributionProperties')).toBeVisible();

  // Search selects the same objects; modifier selection crosses types.
  await page.locator('#layerSearchInput').fill('독일');
  await page.locator('#layerSearchResults [data-layer-item-select="countries"][data-item-id="DEU"]').click({ modifiers: ['Control'] });
  await expect(page.locator('#multiSelectionCount')).toHaveText('2개 선택됨');
  // Cross-domain batch mutation remains constrained by the existing action policy.
  await expect(page.locator('#objectLockBtn')).toBeDisabled();
  await page.locator('#layerSearchClearBtn').click();
  await language.locator('[data-layer-item-select]').click();
  await page.locator('#objectLockBtn').click();
  await expect(page.locator('#objectLockBtn')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#undoBtn').click();
  await language.locator('[data-layer-item-select]').click();
  await page.locator('#objectDeleteBtn').click();
  await page.locator('#confirmModalOkBtn').click();
  await expect(language).toHaveCount(0);
  await page.locator('#undoBtn').click();
  await expect(language).toHaveCount(1);

  // Type style controls now live in Map, with the same presentation fields.
  await page.locator('#mapViewTabBtn').click();
  await page.locator('.map-object-style-settings > summary').click();
  await page.locator('[data-layer-style-toggle="countries"]').click();
  await expect(page.locator('[data-layer-style-opacity="countries"]')).toBeVisible();
  await page.locator('#countriesVisible').uncheck();
  await page.locator('#mapLayersTabBtn').click();
  const worldEye = page.locator('[data-bundle-key="countries"] input');
  await expect(worldEye).not.toBeChecked();
  await worldEye.check();
  await expect(worldEye).toBeChecked();
  await expect(language).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('#app')).toHaveAttribute('data-layout', 'mobile');
  if (await page.locator('#mobileMapBtn').getAttribute('aria-expanded') !== 'true') await page.locator('#mobileMapBtn').click();
  await expect(page.locator('.layer-bundle-row')).toHaveCount(3);
  await expect(language).toBeVisible();
  await expect(page.locator('.layer-panel-footer #createMenuBtn')).toBeVisible();
  await expect.poll(async () => { const box = await page.locator('.layer-panel-footer').boundingBox(); return box.y + box.height; }).toBeLessThanOrEqual(780);
  await expect(language.locator('.layer-item-type')).toHaveText('언어');
  expect(errors).toEqual([]);
});
