import { expect, test } from '@playwright/test';
import { selectUiOption } from './helpers/ui-select.mjs';

async function ready(page) {
  await page.goto('/');
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 60_000 });
}

async function openLayers(page) {
  if (await page.locator('#app').getAttribute('data-layout') !== 'wide'
      && await page.locator('#mobileMapBtn').getAttribute('aria-expanded') !== 'true') {
    await page.locator('#mobileMapBtn').click();
  }
  await expect(page.locator('#leftPanel')).toBeVisible();
}

const height = locator => locator.evaluate(element => element.getBoundingClientRect().height);

test('surface navigation, opacity and mobile controls follow the width contract', async ({ page }) => {
  test.setTimeout(180_000);
  await ready(page);
  for (const width of [1920, 1366, 1359, 1024, 800, 430, 390, 360]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(page.locator('#app')).toHaveAttribute('data-layout', width >= 1360 ? 'wide' : width >= 800 ? 'compact' : 'mobile');
    const nav = page.locator('.adaptive-nav');
    if (width >= 1360) {
      await expect(nav).toBeHidden();
      expect(await nav.evaluate(element => element.getClientRects().length)).toBe(0);
    } else await expect(nav).toBeVisible();
    await openLayers(page);
    expect(await page.locator('#leftPanel').evaluate(element => {
      const color = getComputedStyle(element).backgroundColor;
      return !color.includes('/') && !/^rgba\(.*,[\s\d.]+\)$/.test(color);
    })).toBe(true);
    await page.locator('#createMenuBtn').click();
    const menu = page.locator('#createMenu');
    await expect(menu).toBeVisible();
    const bounds = await menu.boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width + 1);
    if (width < 800) {
      const rowHeights = await menu.locator('[role="menuitem"]').evaluateAll(elements => elements.map(element => element.getBoundingClientRect().height));
      expect(rowHeights.every(value => value >= 48 && value < 68)).toBe(true);
    }
    await menu.press('Escape');
    await expect(page.locator('#createMenuBtn')).toBeFocused();
  }
});

test('short library viewports allocate remaining height to results and detail, not the footer', async ({ page }) => {
  test.setTimeout(180_000);
  await ready(page);
  for (const [width, viewportHeight] of [[360, 740], [390, 844], [430, 844], [800, 600]]) {
    await page.setViewportSize({ width, height: viewportHeight });
    await openLayers(page);
    await page.locator('#createMenuBtn').click();
    await page.locator('#addFromLibraryBtn').click();
    await expect(page.locator('#historicalLibraryModal')).toBeVisible();
    await expect(page.locator('#historicalLibraryResults [data-library-entity-id]').first()).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('.historical-library-filters summary')).toHaveCount(0);
    await expect(page.locator('details.historical-library-filters')).toHaveCount(0);
    const search = await page.locator('#historicalLibrarySearchInput').boundingBox();
    const year = await page.locator('#historicalLibraryYearInput').boundingBox();
    expect(Math.abs(search.y - year.y)).toBeLessThan(2);
    expect(search.x + search.width).toBeLessThanOrEqual(year.x);
    await expect(page.locator('.historical-library-filters .ui-select-control')).toHaveCount(3);
    for (const control of await page.locator('.historical-library-filters .ui-select-control').all()) await expect(control).toBeVisible();
    const toolbarHeight = await height(page.locator('.historical-library-toolbar'));
    expect(toolbarHeight).toBeLessThan(width < 800 ? 180 : 160);
    expect(await height(page.locator('#historicalLibraryResults'))).toBeGreaterThan(220);
    await page.locator('#historicalLibrarySearchInput').fill(width === 360 ? '소련' : '유고슬라비아');
    await page.locator('#historicalLibraryResults [data-library-entity-id]').first().click();
    await expect(page.locator('#historicalLibraryPreview')).toBeVisible();
    if (width === 360) await expect(page.locator('#historicalLibraryAddOptions')).toBeVisible();
    expect(await height(page.locator('.historical-library-footer'))).toBeLessThan(180);
    await expect(page.locator('#historicalLibraryOptionsBackBtn')).toBeHidden();
    await expect(page.locator('#historicalLibraryResults #historicalLibraryPreview')).toBeVisible();
    await expect(page.locator('.historical-library-toolbar')).toBeVisible();
    const selected = page.locator('#historicalLibraryResults [aria-expanded="true"]');
    const rowBounds = await selected.boundingBox();
    const detailBounds = await page.locator('#historicalLibraryPreview').boundingBox();
    expect(detailBounds.y).toBeGreaterThanOrEqual(rowBounds.y + rowBounds.height);
    expect(Math.abs(rowBounds.width - detailBounds.width)).toBeLessThan(2);
    expect(await page.locator('.historical-library-layout').evaluate(el => getComputedStyle(el).borderTopWidth)).toBe('0px');
    expect(await selected.evaluate(el => parseFloat(getComputedStyle(el).paddingLeft))).toBeGreaterThan(0);
    expect(await page.locator('.historical-library-card').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await page.locator('#historicalLibraryCloseBtn').click();
  }
});

test('mobile GIS export has a single form and horizontal action rail', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await ready(page);
  await page.locator('#mobileFileBtn').click();
  await page.locator('#preferencesBtn').click();
  expect(await page.locator('.preferences-accent-swatches').evaluate(element => getComputedStyle(element).display)).toBe('grid');
  await page.locator('#preferencesCancelBtn').click();
  await page.locator('#mobileFileBtn').click();
  await page.locator('#dataExportBtn').click();
  await expect(page.locator('#gisExportTitle')).toHaveText('GIS 내보내기');
  const cancel = await page.locator('#gisExportCancelBtn').boundingBox();
  const confirm = await page.locator('#gisExportConfirmBtn').boundingBox();
  expect(Math.abs(cancel.y - confirm.y)).toBeLessThan(1);
  expect(cancel.height).toBeGreaterThanOrEqual(48);
  expect(confirm.height).toBeGreaterThanOrEqual(48);
  expect(await height(page.locator('#gisExportModal .ui-dialog-actions'))).toBeLessThan(90);
  await page.locator('#gisExportCancelBtn').click();
  await expect(page.locator('#gisExportModal')).toBeHidden();
});

test('theme and enlarged text preserve map hit areas, inspector controls and library rails', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await ready(page);
  for (const theme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: theme });
    await openLayers(page);
    await page.locator('[data-surface-tab="view"]').click();
    const heights = await page.locator('#mapViewSection .projection-btn, #mapViewSection .ui-toggle, .terrain-mode-option').evaluateAll(elements => elements.filter(element => element.getClientRects().length).map(element => element.getBoundingClientRect().height));
    expect(heights.length).toBeGreaterThan(3);
    expect(heights.every(value => value >= 48)).toBe(true);
  }
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.locator('[data-surface-tab="layers"]').click();
  await page.locator('#layerSearchInput').fill('폴란드');
  const row = page.locator('.layer-search-result').filter({ hasText: '폴란드' }).first();
  await row.locator('.layer-child-name').click();
  await expect(page.locator('#rightPanel')).toBeVisible();
  await expect(row.locator('.layer-color-swatch')).toHaveCount(0);
  expect(await row.evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
  expect(await height(page.locator('#focusSelectedObjectBtn'))).toBeGreaterThanOrEqual(36);
  const input = page.locator('#countryNameInput');
  await expect(input).toBeVisible();
  await input.fill('긴 한국어 객체명 Long country name for responsive inspector');
  await input.press('Tab');
  expect(await page.locator('#rightPanel').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  const textStyle = await page.addStyleTag({ content: 'html { font-size: 125%; }' });
  await page.setViewportSize({ width: 430, height: 844 });
  await openLayers(page);
  await page.locator('#createMenuBtn').click();
  await page.locator('#addFromLibraryBtn').click();
  await expect(page.locator('#historicalLibraryResults [data-library-entity-id]').first()).toBeVisible();
  expect(await page.locator('.historical-library-card').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  const rails = await page.locator('.historical-library-card').evaluate(element => {
    const style = getComputedStyle(element);
    return [parseFloat(style.paddingLeft), parseFloat(style.paddingRight), parseFloat(getComputedStyle(document.documentElement).fontSize)];
  });
  expect(rails[0]).toBeCloseTo(rails[2], 0);
  expect(rails[1]).toBeCloseTo(rails[2], 0);
  await textStyle.evaluate(element => element.remove());
});

test('mobile GIS import keeps its current stages and a single horizontal footer', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 360, height: 740 });
  await ready(page);
  await page.locator('#mobileFileBtn').click();
  const chooser = page.waitForEvent('filechooser');
  await page.locator('#openGisBtn').click();
  await (await chooser).setFiles({ name: 'ui-smoke.geojson', mimeType: 'application/geo+json', buffer: Buffer.from(JSON.stringify({
    type: 'FeatureCollection', features: [{ type: 'Feature', properties: { name: '시험 영역' }, geometry: { type: 'Polygon', coordinates: [[[9, 50], [9, 51], [10, 51], [10, 50], [9, 50]]] } }],
  })) });
  await expect(page.locator('#gisImportModal')).toBeVisible();
  await expect(page.locator('#gisImportNextBtn')).toBeEnabled();
  await selectUiOption(page, '#gisTargetType', 'subunit');
  for (const stage of [1, 2, 3]) {
    await expect(page.locator('#gisStepIndicator')).toContainText(`${stage}/3`, { timeout: 45_000 });
    if (stage === 2) await selectUiOption(page, '#gisTargetCountry', 'DEU');
    const buttons = page.locator('#gisImportModal .ui-dialog-actions button:visible');
    const rects = await buttons.evaluateAll(elements => elements.map(element => element.getBoundingClientRect().toJSON()));
    expect(rects.every(rect => Math.abs(rect.y - rects[0].y) < 1 && rect.height >= 48)).toBe(true);
    if (stage < 3) await page.locator('#gisImportNextBtn').click();
  }
  await page.locator('#gisImportBackBtn').click();
  await expect(page.locator('#gisStepIndicator')).toContainText('2/3');
  await page.locator('#gisImportCancelBtn').click();
  await expect(page.locator('#gisImportModal')).toBeHidden();
});
