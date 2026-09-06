import { test, expect } from '@playwright/test';

test('folder name, chevron and row open both default folders', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
  for (const id of ['polities', 'landforms']) {
    const row = page.locator(`[data-bundle-key="${id}"]`);
    const toggle = row.locator('.layer-bundle-toggle');
    await row.locator('.layer-child-name-label').click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator(`[data-bundle-member="${id}"]`).first()).toBeVisible();
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await row.click({ position: { x: 1, y: 15 } });
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await toggle.click();
    const eye = row.locator('input');
    await eye.uncheck();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await eye.check();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('#app')).toHaveAttribute('data-layout', 'mobile');
  if (await page.locator('#mobileMapBtn').getAttribute('aria-expanded') !== 'true') await page.locator('#mobileMapBtn').click();
  await page.locator('[data-bundle-key="landforms"] .layer-child-name-label').click();
  await expect(page.locator('[data-bundle-member="landforms"]').first()).toBeVisible();
  expect(errors).toEqual([]);
});
