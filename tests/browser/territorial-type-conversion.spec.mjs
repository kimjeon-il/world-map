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

async function importRegion(page, name) {
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
  await page.locator('#gisImportNextBtn').click();
  await expect(page.locator('#gisStepIndicator')).toContainText('2/5');
  await selectUiOption(page, '#gisTargetType', 'region');
  await selectUiOption(page, '#gisTargetCountry', 'DEU');
  for (const step of ['3/5', '4/5', '5/5']) {
    await page.locator('#gisImportNextBtn').click();
    await expect(page.locator('#gisStepIndicator')).toContainText(step, { timeout: 30_000 });
  }
  await page.locator('#gisImportConfirmBtn').click();
  await expect.poll(() => page.evaluate(expected => window.PANDOLAB_TERRITORIAL.list({ type: 'territory' })
    .find(unit => unit.properties.name === expected)?.id || '', name), { timeout: 60_000 }).not.toBe('');
}

test('a region changes to an administrative area with one-step undo', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = await openApp(page);
  const name = '종류 변경 시험 지역';
  await importRegion(page, name);
  const id = await page.evaluate(expected => window.PANDOLAB_TERRITORIAL.list({ type: 'territory' })
    .find(unit => unit.properties.name === expected).id, name);

  await page.evaluate(unitId => window.PANDOLAB_TERRITORIAL.select('territory', unitId), id);
  await page.locator('#actionsTabBtn').click();
  await page.locator('#changeRegionTypeBtn').click();
  await expect(page.locator('#territorialTypeModal')).toBeVisible();
  await selectUiOption(page, '#territorialTypeInput', 'admin');
  await expect(page.locator('#territorialTypeTitle')).toHaveText('지역을 행정구역으로 전환');
  await expect(page.locator('#territorialTypeImpactList')).toContainText('현재 형상과 객체 ID 유지');
  await expect(page.locator('#territorialTypeImpactList')).toContainText('한 번의 실행취소로 복구 가능');
  await page.locator('#territorialTypeConfirmBtn').click();

  await expect.poll(() => page.evaluate(unitId => window.PANDOLAB_TERRITORIAL.get(unitId)?.properties?.unitType, id), { timeout: 60_000 }).toBe('admin');
  await page.locator('#actionsTabBtn').click();
  const actionRows = await page.locator('#administrativeProperties .editor-action-row').evaluateAll(buttons => buttons.map(button => {
    const rect = button.getBoundingClientRect();
    const title = button.querySelector('strong');
    const description = button.querySelector('small');
    return {
      fullWidth: Math.abs(rect.width - button.parentElement.getBoundingClientRect().width) < 1,
      minHeight: rect.height >= 48,
      title: title?.textContent || '',
      descriptionLines: description ? Math.round(description.getBoundingClientRect().height / parseFloat(getComputedStyle(description).lineHeight)) : 0,
    };
  }));
  expect(actionRows.every(row => row.fullWidth && row.minHeight && row.title && row.descriptionLines <= 1)).toBe(true);
  const converted = await page.evaluate(unitId => {
    const unit = window.PANDOLAB_TERRITORIAL.get(unitId);
    return { id: unit.id, name: unit.properties.name, sovereignId: unit.properties.sovereignId, parentId: unit.properties.parentId, adminLevel: unit.properties.adminLevel };
  }, id);
  expect(converted).toEqual({ id, name, sovereignId: 'DEU', parentId: 'DEU', adminLevel: 1 });

  await page.locator('#undoBtn').click();
  await expect.poll(() => page.evaluate(unitId => window.PANDOLAB_TERRITORIAL.get(unitId)?.properties?.unitType, id), { timeout: 30_000 }).toBe('territory');
  expect(errors).toEqual([]);
});

test('a country and an administrative area convert both ways with a stable canonical UUID', async ({ page }) => {
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
  await selectUiOption(page, '#territorialTypeInput', 'admin');
  await selectUiOption(page, '#territorialTypeSovereignInput', 'GBR');
  await expect(page.locator('#territorialTypeImpact')).toContainText(before.name);
  await expect(page.locator('#territorialTypeTitle')).toHaveText('국가를 행정구역으로 전환');
  await expect(page.locator('#territorialTypeImpactList')).toContainText('현재 형상과 객체 ID 유지');
  await page.locator('#territorialTypeConfirmBtn').click();

  await expect.poll(() => page.evaluate(expected => window.PANDOLAB_TERRITORIAL.list({ type: 'admin' })
    .find(unit => unit.properties?.name === expected && unit.properties?.unitType === 'admin')?.id || '', before.name), { timeout: 60_000 }).not.toBe('');
  const converted = await page.evaluate(expected => {
    const unit = window.PANDOLAB_TERRITORIAL.list({ type: 'admin' })
      .find(candidate => candidate.properties?.name === expected && candidate.properties?.unitType === 'admin');
    return {
      countryCount: window.PANDOLAB_TERRITORIAL.list({ type: 'country' }).length,
      unit: {
        id: unit.id,
        name: unit.properties.name,
        sovereignId: unit.properties.sovereignId,
        parentId: unit.properties.parentId,
        adminLevel: unit.properties.adminLevel,
        convertedFromId: unit.properties?.metadata?.convertedFromCountry?.properties?.editor_id,
      },
    };
  }, before.name);
  expect(converted.countryCount).toBe(before.countryCount - 1);
  expect(converted.unit.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  expect(converted.unit.name).toBe(before.name);
  expect(converted.unit.sovereignId).toBe('GBR');
  expect(converted.unit.parentId).toBe('GBR');
  expect(converted.unit.adminLevel).toBe(1);
  expect(converted.unit.convertedFromId).toBe('IRL');

  await page.evaluate(unitId => window.PANDOLAB_TERRITORIAL.select('admin', unitId), converted.unit.id);
  await page.locator('#actionsTabBtn').click();
  await page.locator('#changeAdministrativeTypeBtn').click();
  await selectUiOption(page, '#territorialTypeInput', 'country');
  await page.locator('#territorialTypeConfirmBtn').click();
  await expect.poll(() => page.evaluate(id => window.PANDOLAB_TERRITORIAL.get(id)?.properties?.unitType, converted.unit.id), { timeout: 60_000 }).toBe('country');
  expect(await page.evaluate(unitId => ({
    count: window.PANDOLAB_TERRITORIAL.list({ type: 'country' }).length,
    name: window.PANDOLAB_TERRITORIAL.get(unitId)?.properties?.name,
  }), converted.unit.id)).toEqual({ count: before.countryCount, name: before.name });

  await page.locator('#undoBtn').click();
  await expect.poll(() => page.evaluate(id => window.PANDOLAB_TERRITORIAL.get(id)?.properties?.unitType, converted.unit.id), { timeout: 30_000 }).toBe('admin');
  await page.locator('#undoBtn').click();
  await expect.poll(() => page.evaluate(() => window.PANDOLAB_TERRITORIAL.get('IRL')?.properties?.unitType), { timeout: 30_000 }).toBe('country');
  expect(await page.evaluate(() => window.PANDOLAB_TERRITORIAL.list({ type: 'country' }).length)).toBe(before.countryCount);
  expect(errors).toEqual([]);
});
