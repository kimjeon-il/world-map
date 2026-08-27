import { expect, test } from '@playwright/test';

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
  await page.locator('#geoJsonFileInput').setInputFiles({
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
  await page.locator('#geoJsonTargetType').selectOption('region');
  await page.locator('#geoJsonTargetConfirmBtn').click();
  await expect.poll(() => page.evaluate(expected => window.PANDOLAB_TERRITORIAL.list({ type: 'territory' })
    .find(unit => unit.properties.name === expected)?.id || '', name)).not.toBe('');
}

test('a region changes to an administrative area with one-step undo', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = await openApp(page);
  const name = '종류 변경 시험 지역';
  await importRegion(page, name);
  const id = await page.evaluate(expected => window.PANDOLAB_TERRITORIAL.list({ type: 'territory' })
    .find(unit => unit.properties.name === expected).id, name);

  await page.evaluate(unitId => window.PANDOLAB_TERRITORIAL.select('territory', unitId), id);
  await page.locator('#changeRegionTypeBtn').click();
  await expect(page.locator('#territorialTypeModal')).toBeVisible();
  await page.locator('#territorialTypeInput').selectOption('admin');
  await page.locator('#territorialTypeConfirmBtn').click();

  await expect.poll(() => page.evaluate(unitId => window.PANDOLAB_TERRITORIAL.get(unitId)?.properties?.unitType, id), { timeout: 60_000 }).toBe('admin');
  const actionCardLayout = await page.locator('#administrativeProperties .editor-action-button').evaluateAll(buttons => buttons.map(button => {
    const icon = button.querySelector(':scope > span');
    const title = button.querySelector(':scope > strong');
    const description = button.querySelector(':scope > small');
    const iconRect = icon?.getBoundingClientRect();
    const titleRect = title?.getBoundingClientRect();
    const descriptionRect = description?.getBoundingClientRect();
    return {
      hasIcon: !!icon?.querySelector('svg use'),
      titleAfterIcon: !!iconRect && !!titleRect && titleRect.left > iconRect.right,
      textColumnsAligned: !!titleRect && !!descriptionRect && Math.abs(titleRect.left - descriptionRect.left) < 1,
      titleWidth: titleRect?.width || 0,
    };
  }));
  expect(actionCardLayout.every(card => card.hasIcon && card.titleAfterIcon && card.textColumnsAligned && card.titleWidth > 60)).toBe(true);
  const converted = await page.evaluate(unitId => {
    const unit = window.PANDOLAB_TERRITORIAL.get(unitId);
    return { id: unit.id, name: unit.properties.name, sovereignId: unit.properties.sovereignId, parentId: unit.properties.parentId, adminLevel: unit.properties.adminLevel };
  }, id);
  expect(converted).toEqual({ id, name, sovereignId: 'DEU', parentId: 'DEU', adminLevel: 1 });

  await page.locator('#undoBtn').click();
  await expect.poll(() => page.evaluate(unitId => window.PANDOLAB_TERRITORIAL.get(unitId)?.properties?.unitType, id), { timeout: 30_000 }).toBe('territory');
  expect(errors).toEqual([]);
});

test('a country and an administrative area convert both ways without losing identity', async ({ page }) => {
  test.setTimeout(180_000);
  const errors = await openApp(page);
  const before = await page.evaluate(() => ({
    countryCount: window.PANDOLAB_TERRITORIAL.list({ type: 'country' }).length,
    name: window.PANDOLAB_TERRITORIAL.get('IRL')?.properties?.name || '',
  }));
  expect(before.name).not.toBe('');

  await page.evaluate(() => window.PANDOLAB_TERRITORIAL.select('country', 'IRL'));
  await page.locator('#changeCountryTypeBtn').click();
  await page.locator('#territorialTypeInput').selectOption('admin');
  await page.locator('#territorialTypeSovereignInput').selectOption('GBR');
  await expect(page.locator('#territorialTypeImpact')).toContainText(before.name);
  await page.locator('#territorialTypeConfirmBtn').click();

  await expect.poll(() => page.evaluate(() => window.PANDOLAB_TERRITORIAL.get('IRL')?.properties?.unitType), { timeout: 60_000 }).toBe('admin');
  const converted = await page.evaluate(() => ({
    countryCount: window.PANDOLAB_TERRITORIAL.list({ type: 'country' }).length,
    unit: (() => {
      const unit = window.PANDOLAB_TERRITORIAL.get('IRL');
      return {
        id: unit.id,
        name: unit.properties.name,
        sovereignId: unit.properties.sovereignId,
        parentId: unit.properties.parentId,
        adminLevel: unit.properties.adminLevel,
      };
    })(),
  }));
  expect(converted.countryCount).toBe(before.countryCount - 1);
  expect(converted.unit.id).toBe('IRL');
  expect(converted.unit.name).toBe(before.name);
  expect(converted.unit.sovereignId).toBe('GBR');
  expect(converted.unit.parentId).toBe('GBR');
  expect(converted.unit.adminLevel).toBe(1);

  await page.locator('#changeAdministrativeTypeBtn').click();
  await page.locator('#territorialTypeInput').selectOption('country');
  await page.locator('#territorialTypeConfirmBtn').click();
  await expect.poll(() => page.evaluate(() => window.PANDOLAB_TERRITORIAL.get('IRL')?.properties?.unitType), { timeout: 60_000 }).toBe('country');
  expect(await page.evaluate(() => ({
    count: window.PANDOLAB_TERRITORIAL.list({ type: 'country' }).length,
    name: window.PANDOLAB_TERRITORIAL.get('IRL')?.properties?.name,
  }))).toEqual({ count: before.countryCount, name: before.name });

  await page.locator('#undoBtn').click();
  await expect.poll(() => page.evaluate(() => window.PANDOLAB_TERRITORIAL.get('IRL')?.properties?.unitType), { timeout: 30_000 }).toBe('admin');
  await page.locator('#undoBtn').click();
  await expect.poll(() => page.evaluate(() => window.PANDOLAB_TERRITORIAL.get('IRL')?.properties?.unitType), { timeout: 30_000 }).toBe('country');
  expect(await page.evaluate(() => window.PANDOLAB_TERRITORIAL.list({ type: 'country' }).length)).toBe(before.countryCount);
  expect(errors).toEqual([]);
});
