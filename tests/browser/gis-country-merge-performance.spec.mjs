import { expect, test } from '@playwright/test';

async function selectCustomOption(page, selectId, label) {
  const select = page.locator(`#${selectId}`);
  await select.locator('..').locator('.ui-select-control').click();
  await page.locator('.ui-select-popover:not([hidden])').getByRole('option', { name: label, exact: true }).click();
  return select;
}

async function runDebugAudit(page) {
  const panel = page.locator('#debugMapPanel');
  await panel.getByRole('button', { name: '전체 지도 검사' }).click();
  await expect.poll(() => panel.locator('pre').innerText(), { timeout: 120_000 }).toContain('audit: ready / 0 issues');
}

test('imported-territory priority validates only affected countries and finishes without residual overlap', async ({ page }) => {
  test.setTimeout(240_000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/?debug');
  await expect(page.locator('#bootstrapLoading')).toHaveAttribute('hidden', '', { timeout: 60_000 });
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 120_000 });

  await page.locator('#gisFileInput').setInputFiles({
    name: 'affected-country-validation.geojson',
    mimeType: 'application/geo+json',
    buffer: Buffer.from(JSON.stringify({
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        id: 'TEST_IMPORTED_COUNTRY',
        properties: {
          pandolab_id: 'TEST_IMPORTED_COUNTRY',
          pandolab_name: '영향 국가 검증',
          pandolab_color: '#53657A',
        },
        geometry: {
          type: 'Polygon',
          coordinates: [[[10, 50], [10, 51], [11, 51], [11, 50], [10, 50]]],
        },
      }],
    })),
  });
  await expect(page.locator('#gisImportModal')).toBeVisible();
  await expect(page.locator('#gisImportConfirmBtn')).toBeEnabled({ timeout: 30_000 });
  await selectCustomOption(page, 'gisTargetType', '국가');
  await selectCustomOption(page, 'gisMergeStrategy', '가져온 영토 우선');

  const startedAt = Date.now();
  await page.locator('#gisImportConfirmBtn').click();
  await expect(page.locator('#confirmModal')).toBeVisible({ timeout: 45_000 });
  expect(Date.now() - startedAt).toBeLessThan(45_000);
  await expect(page.locator('#confirmModalTitle')).toHaveText('GIS 병합 미리보기');
  await expect(page.locator('#confirmModalMessage')).toContainText('차감 1개');
  await expect(page.locator('#confirmModalMessage')).not.toContainText('처리 후 남는 중첩');
  await page.locator('#confirmModalOkBtn').click();

  await page.locator('#layerSearchInput').fill('영향 국가 검증');
  await expect(page.getByRole('option').filter({ hasText: '영향 국가 검증' }).first()).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_GPU_METRICS__?.pendingCountryCount || 0), {
    timeout: 45_000,
  }).toBe(0);
  await runDebugAudit(page);
  expect(errors).toEqual([]);
});
