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
  await page.locator('#gisImportNextBtn').click();
  await expect(page.locator('#gisStepIndicator')).toHaveText('2/5 · 가져올 내용');
  await selectCustomOption(page, 'gisTargetType', '국가');
  await page.locator('#gisImportNextBtn').click();
  await page.locator('#gisImportNextBtn').click();
  await expect(page.locator('#gisStepIndicator')).toHaveText('4/5 · 적용 결과');
  await page.locator('[data-gis-open-mode="merge"]').click();
  await expect(page.locator('#gisMergeStrategyRow')).toBeVisible();
  await selectCustomOption(page, 'gisMergeStrategy', '가져온 영토 우선');
  await page.locator('#gisImportNextBtn').click();
  const identitySelect = page.locator('#gisCountryIdentityRows [data-identity-source-key]').first();
  await expect(identitySelect).toHaveCount(1, { timeout: 30_000 });
  await identitySelect.evaluate(element => {
    element.value = 'new';
    const BrowserEvent = element.ownerDocument.defaultView.Event;
    element.dispatchEvent(new BrowserEvent('input', { bubbles: true }));
    element.dispatchEvent(new BrowserEvent('change', { bubbles: true }));
  });
  await page.locator('#gisImportNextBtn').click();
  await expect(page.locator('#gisStepIndicator')).toHaveText('5/5 · 최종 확인', { timeout: 90_000 });

  const startedAt = Date.now();
  await page.locator('#gisImportConfirmBtn').click();
  await expect(page.locator('#gisImportModal')).toBeHidden({ timeout: 45_000 });
  expect(Date.now() - startedAt).toBeLessThan(45_000);

  await page.locator('#layerSearchInput').fill('영향 국가 검증');
  await expect(page.getByRole('option').filter({ hasText: '영향 국가 검증' }).first()).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_GPU_METRICS__?.pendingCountryCount || 0), {
    timeout: 45_000,
  }).toBe(0);
  await runDebugAudit(page);
  expect(errors).toEqual([]);
});
