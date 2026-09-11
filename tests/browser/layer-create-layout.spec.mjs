import { expect, test } from '@playwright/test';
import { MAP_OBJECT_TYPES, MAP_OBJECT_CATEGORIES } from '../../assets/js/modules/map-object-categories.js';

const widths = [360, 390, 430, 800, 1024, 1359, 1366, 1920];
async function openLayers(page) {
  if (!(await page.locator('#createMenuBtn').isVisible())) await page.locator('#mobileMapBtn').click();
  await page.locator('#mapLayersTabBtn').click();
}
for (const colorScheme of ['light', 'dark']) for (const width of widths) {
  test(`${width}px ${colorScheme} layer submenu preserves shell and menu navigation`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ colorScheme });
    await page.goto('/?renderer=canvas');
    await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
    await openLayers(page);
    const shell = () => page.locator('#leftPanel').evaluate(panel => ({
      height: panel.getBoundingClientRect().height,
      lock: getComputedStyle(document.body).overflow,
      history: history.length,
    }));
    const before = await shell();
    const trigger = page.locator('#createMenuBtn'), menu = page.locator('#createMenu');
    await trigger.click();
    await expect(menu).toBeVisible();
    await expect(menu).toHaveAttribute('role', 'menu');
    await expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await expect(menu.locator('.surface-header, .mobile-sheet-handle, [role="tab"]')).toHaveCount(0);
    expect(await shell()).toEqual(before);
    const expectedIds = Object.values(MAP_OBJECT_CATEGORIES).flatMap(category =>
      category.createItems.map(type => MAP_OBJECT_TYPES[type].createButton)).concat('addFromLibraryBtn');
    const items = menu.getByRole('menuitem');
    expect(await items.evaluateAll(nodes => nodes.map(node => node.id))).toEqual(expectedIds);
    await expect(items.first()).toBeFocused();
    await items.first().press('End');
    await expect(items.last()).toBeFocused();
    await items.last().press('Home');
    await expect(items.first()).toBeFocused();
    await items.first().press('ArrowDown');
    await expect(items.nth(1)).toBeFocused();
    const metrics = await menu.evaluate(element => {
      const rect = element.getBoundingClientRect(), style = getComputedStyle(element);
      return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom,
        padding: [style.paddingLeft, style.paddingRight], overflow: element.scrollWidth > element.clientWidth,
        font: getComputedStyle(element.querySelector('strong')).fontSize };
    });
    expect(metrics.left).toBeGreaterThanOrEqual(8);
    expect(metrics.right).toBeLessThanOrEqual(width - 8);
    expect(metrics.top).toBeGreaterThanOrEqual(8);
    expect(metrics.bottom).toBeLessThanOrEqual(836);
    expect(metrics.padding).toEqual(['16px', '16px']);
    expect(metrics.font).toBe('14px');
    expect(metrics.overflow).toBe(false);
    await items.nth(1).press('Escape');
    await expect(menu).toBeHidden();
    await expect(trigger).toBeFocused();
    expect(await shell()).toEqual(before);
    await trigger.click();
    await items.first().press('Tab');
    await expect(menu).toBeHidden();
    await trigger.click();
    await page.locator('#layerSearchInput').click();
    await expect(menu).toBeHidden();
    await trigger.click();
    await page.setViewportSize({ width: width < 800 ? 1024 : 390, height: 844 });
    await expect(menu).toBeHidden();
  });
}

test('submenu hands focus to the existing distribution dialog', async ({ page }) => {
  await page.goto('/?renderer=canvas');
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
  await openLayers(page);
  await page.locator('#createMenuBtn').click();
  await page.locator('#addDistributionBtn').click();
  await expect(page.locator('#createMenu')).toBeHidden();
  await expect(page.locator('#distributionTypeModal')).toBeVisible();
  expect(await page.locator('#distributionTypeModal').evaluate(dialog => dialog.contains(document.activeElement))).toBe(true);
});
