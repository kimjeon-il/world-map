import { expect, test } from '@playwright/test';
import { selectUiOption } from './helpers/ui-select.mjs';

async function openApp(page) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.locator('#bootstrapLoading')).toHaveAttribute('hidden', '', { timeout: 30_000 });
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 60_000 });
  return errors;
}

async function importTerritory(page, name) {
  await page.locator('#gisFileInput').setInputFiles({
    name: `${name}.geojson`,
    mimeType: 'application/geo+json',
    buffer: Buffer.from(JSON.stringify({
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        id: 'type-conversion-region',
        properties: { name },
        geometry: { type: 'Polygon', coordinates: [[[9, 50], [9, 51], [10, 51], [10, 50], [9, 50]]] },
      }],
    })),
  });
  await expect(page.locator('#gisImportModal')).toBeVisible();
  await expect(page.locator('#gisImportConfirmBtn')).toBeEnabled({ timeout: 30_000 });
  await expect(page.locator('#gisStepIndicator')).toContainText('1/3');
  await selectUiOption(page, '#gisTargetType', 'subunit');
  await selectUiOption(page, '#gisTargetCountry', 'DEU');
  for (const step of ['2/3', '3/3']) {
    await page.locator('#gisImportNextBtn').click();
    await expect(page.locator('#gisStepIndicator')).toContainText(step, { timeout: 30_000 });
  }
  await page.locator('#gisImportConfirmBtn').click();
  await expect.poll(() => page.evaluate(expected => window.PANDOLAB_TERRITORIAL.list({ type: 'subunit' })
    .find(unit => unit.properties.name === expected)?.id || '', name), { timeout: 60_000 }).not.toBe('');
}

test('subunit editor has one promotion and deletion path without obsolete fields', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = await openApp(page);
  const name = '하위단위 편집 검증';
  await importTerritory(page, name);
  const id = await page.evaluate(expected => window.PANDOLAB_TERRITORIAL.list({ type: 'subunit' })
    .find(unit => unit.properties.name === expected).id, name);
  await page.evaluate(key => window.PANDOLAB_TERRITORIAL.select('subunit', key), id);
  await expect(page.locator('#subunitLevelInput, #changeSubunitTypeBtn, #transferSubunitBtn, #splitSubunitBtn')).toHaveCount(0);
  await expect(page.locator('label[for="subunitCountryInput"]')).toHaveText('소속 국가');
  await expect(page.locator('label[for="subunitParentInput"]')).toHaveText('상위 단위');
  for (const button of ['addSubunitChildBtn', 'annexSubunitBtn', 'mergeSubunitBtn', 'reassignSubunitShapeBtn', 'editSubunitCoastBtn', 'reconcileSubunitCoastBtn', 'promoteSubunitBtn']) {
    await expect(page.locator('#' + button)).toHaveCount(1);
  }
  const originalCountry = await page.evaluate(() => window.PANDOLAB_TERRITORIAL.get('DEU').geometry);
  await page.locator('#removeSubunitDivisionBtn').evaluate(button => button.click());
  await expect(page.locator('#confirmModalTitle')).toHaveText('하위단위 삭제');
  await page.locator('#confirmModalOkBtn').click();
  expect(await page.evaluate(key => window.PANDOLAB_TERRITORIAL.get(key), id)).toBeNull();
  expect(await page.evaluate(() => window.PANDOLAB_TERRITORIAL.get('DEU').geometry)).toEqual(originalCountry);
  await page.locator('#undoBtn').click();
  await expect.poll(() => page.evaluate(key => window.PANDOLAB_TERRITORIAL.get(key)?.properties?.unitType, id)).toBe('subunit');
  expect(errors).toEqual([]);
});

test('a country and a subunit convert both ways with a stable canonical UUID', async ({ page }) => {
  test.setTimeout(300_000);
  const errors = await openApp(page);
  const before = await page.evaluate(() => ({
    countryCount: window.PANDOLAB_TERRITORIAL.list({ type: 'country' }).length,
    name: window.PANDOLAB_TERRITORIAL.get('IRL')?.properties?.name || '',
  }));
  expect(before.name).not.toBe('');

  await page.evaluate(() => window.PANDOLAB_TERRITORIAL.select('country', 'IRL'));
  await page.locator('#actionsTabBtn').click();
  await page.locator('#changeCountryTypeBtn').click();
  await selectUiOption(page, '#territorialTypeInput', 'subunit');
  await selectUiOption(page, '#territorialTypeSovereignInput', 'GBR');
  await expect(page.locator('#territorialTypeImpact')).toContainText(before.name);
  await expect(page.locator('#territorialTypeTitle')).toHaveText('국가를 하위단위로 전환');
  await expect(page.locator('#territorialTypeImpactList')).toContainText('현재 형상과 객체 ID 유지');
  await page.locator('#territorialTypeConfirmBtn').click();

  await expect.poll(() => page.evaluate(expected => window.PANDOLAB_TERRITORIAL.list({ type: 'subunit' })
    .find(unit => unit.properties?.name === expected && unit.properties?.unitType === 'subunit')?.id || '', before.name), { timeout: 60_000 }).not.toBe('');
  const converted = await page.evaluate(expected => {
    const unit = window.PANDOLAB_TERRITORIAL.list({ type: 'subunit' })
      .find(candidate => candidate.properties?.name === expected && candidate.properties?.unitType === 'subunit');
    return {
      countryCount: window.PANDOLAB_TERRITORIAL.list({ type: 'country' }).length,
      unit: {
        id: unit.id,
        name: unit.properties.name,
        sovereignId: unit.properties.sovereignId,
        parentId: unit.properties.parentId,
        convertedFromName: unit.properties?.metadata?.convertedFromCountry?.properties?.name,
      },
    };
  }, before.name);
  expect(converted.countryCount).toBe(before.countryCount - 1);
  expect(converted.unit.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  expect(converted.unit.name).toBe(before.name);
  expect(converted.unit.sovereignId).toBe('GBR');
  expect(converted.unit.parentId).toBe('GBR');
  expect(converted.unit.convertedFromName).toBe(before.name);

  await page.evaluate(unitId => window.PANDOLAB_TERRITORIAL.select('subunit', unitId), converted.unit.id);
  await page.locator('#actionsTabBtn').click();
  await page.locator('#promoteSubunitBtn').evaluate(button => button.click());
  await page.locator('#confirmModalOkBtn').click();
  await expect(page.locator('#modePrimaryBtn')).toBeEnabled({ timeout: 60_000 });
  await page.locator('#modePrimaryBtn').click();
  await expect.poll(() => page.evaluate(id => window.PANDOLAB_TERRITORIAL.get(id)?.properties?.unitType, converted.unit.id), { timeout: 60_000 }).toBe('country');
  expect(await page.evaluate(unitId => ({
    count: window.PANDOLAB_TERRITORIAL.list({ type: 'country' }).length,
    name: window.PANDOLAB_TERRITORIAL.get(unitId)?.properties?.name,
  }), converted.unit.id)).toEqual({ count: before.countryCount, name: before.name });

  await page.locator('#undoBtn').click();
  await expect.poll(() => page.evaluate(id => window.PANDOLAB_TERRITORIAL.get(id)?.properties?.unitType, converted.unit.id), { timeout: 30_000 }).toBe('subunit');
  await page.locator('#undoBtn').click();
  await expect.poll(() => page.evaluate(() => window.PANDOLAB_TERRITORIAL.get('IRL')?.properties?.unitType), { timeout: 30_000 }).toBe('country');
  expect(await page.evaluate(() => window.PANDOLAB_TERRITORIAL.list({ type: 'country' }).length)).toBe(before.countryCount);
  expect(errors).toEqual([]);
});
