import { expect, test } from '@playwright/test';
import { selectUiOption } from './helpers/ui-select.mjs';

const layouts = [
  { name: 'wide', width: 1440, height: 900 },
  { name: 'compact', width: 1024, height: 800 },
  { name: 'mobile', width: 390, height: 844 },
];

async function installTestAnimationFrame(page) {
  await page.addInitScript(() => {
    let frameId = 0;
    const timers = new Map();
    globalThis.requestAnimationFrame = callback => {
      const id = ++frameId;
      const timer = setTimeout(() => { timers.delete(id); callback(performance.now()); }, 16);
      timers.set(id, timer);
      return id;
    };
    globalThis.cancelAnimationFrame = id => { clearTimeout(timers.get(id)); timers.delete(id); };
  });
}

async function openApp(page, layout) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await installTestAnimationFrame(page);
  await page.setViewportSize({ width: layout.width, height: layout.height });
  await page.goto('/?renderer=canvas');
  await expect(page.locator('#bootstrapLoading')).toHaveAttribute('hidden', '', { timeout: 30_000 });
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
  if (layout.name !== 'wide') await page.locator('#mobileMapBtn').click();
  await expect(page.locator('#leftPanel')).toBeVisible();
  return errors;
}

for (const layout of layouts) {
  test(`${layout.name} keeps map views and editor highlights visually consistent`, async ({ page }) => {
    test.setTimeout(180_000);
    const errors = await openApp(page, layout);

    await expect(page.locator('#mapSheetTitle')).toHaveText('지도');
    await expect(page.locator('#mapPanelTabs')).toBeVisible();
    await expect(page.locator('#mapLayersTabBtn')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#mapViewTabBtn')).toHaveAttribute('aria-selected', 'false');
    await expect(page.locator('#layerPresentationBtn, #layerPresentationCloseBtn, #layerPresentationModal')).toHaveCount(0);
    expect(await page.locator('#layerSection .layer-category-title').allTextContents()).not.toContain('라벨');

    await expect(page.locator('#countriesLocked')).toHaveCount(0);
    const rowAlignment = await page.locator('.layer-folder-row').evaluateAll(rows => rows.slice(0, 4).map(row => {
      const toggle = row.querySelector(':scope > .layer-folder-toggle').getBoundingClientRect();
      const checkbox = row.querySelector(':scope > input[type="checkbox"]:not([hidden])').getBoundingClientRect();
      const name = row.querySelector(':scope > .layer-folder-name').getBoundingClientRect();
      return { toggle: toggle.left, checkbox: checkbox.left, name: name.left };
    }));
    for (const key of ['toggle', 'checkbox', 'name']) {
      const positions = rowAlignment.map(row => row[key]);
      expect(Math.max(...positions) - Math.min(...positions)).toBeLessThanOrEqual(1);
    }
    const layerNameLayout = await page.locator('.layer-folder-row').evaluateAll(rows => rows.map(row => {
      const name = row.querySelector(':scope > .layer-folder-name');
      const rowBox = row.getBoundingClientRect();
      const nameBox = name.getBoundingClientRect();
      return {
        text: name.textContent.trim(),
        clientWidth: name.clientWidth,
        scrollWidth: name.scrollWidth,
        rightInset: rowBox.right - nameBox.right,
      };
    }));
    for (const item of layerNameLayout) {
      expect(item.clientWidth, `${item.text} 이름 칸 너비`).toBeGreaterThan(18);
      expect(item.scrollWidth, `${item.text} 이름이 잘리지 않아야 함`).toBeLessThanOrEqual(item.clientWidth + 1);
      expect(item.rightInset, `${item.text} 이름이 행 밖으로 나가지 않아야 함`).toBeGreaterThanOrEqual(0);
    }

    const countryVisibility = page.locator('#countriesVisible');
    const visibleEye = await countryVisibility.evaluate(input => {
      const box = input.getBoundingClientRect();
      const icon = getComputedStyle(input, '::before');
      return { width: box.width, height: box.height, iconWidth: icon.width, mask: icon.maskImage || icon.webkitMaskImage };
    });
    const expectedVisibilityTarget = layout.name === 'mobile' ? 48 : 42;
    expect(visibleEye.width).toBeCloseTo(expectedVisibilityTarget, 1);
    expect(visibleEye.height).toBeCloseTo(expectedVisibilityTarget, 1);
    expect(visibleEye.iconWidth).toBe('20px');
    expect(visibleEye.mask).toContain('svg');
    await expect(countryVisibility).toHaveAttribute('data-tooltip', '국가 숨기기');
    await countryVisibility.click();
    await expect(countryVisibility).not.toBeChecked();
    await expect(countryVisibility).toHaveAttribute('data-tooltip', '국가 표시');
    const hiddenEyeMask = await countryVisibility.evaluate(input => {
      const icon = getComputedStyle(input, '::before');
      return icon.maskImage || icon.webkitMaskImage;
    });
    expect(hiddenEyeMask).not.toBe(visibleEye.mask);
    await countryVisibility.click();
    await expect(countryVisibility).toBeChecked();

    const mapTabMetrics = await page.locator('#mapPanelTabs').evaluate(tabs => {
      const active = tabs.querySelector('[aria-selected="true"]');
      const inactive = tabs.querySelector('[aria-selected="false"]');
      const activeMark = getComputedStyle(active, '::after');
      const inactiveMark = getComputedStyle(inactive, '::after');
      return {
        width: activeMark.width,
        height: activeMark.height,
        radius: activeMark.borderRadius,
        activeOpacity: activeMark.opacity,
        inactiveOpacity: inactiveMark.opacity,
      };
    });
    expect(mapTabMetrics).toMatchObject({ width: '30px', height: '3px', radius: '999px', activeOpacity: '1', inactiveOpacity: '0' });

    await page.locator('#mapViewTabBtn').click();
    await expect(page.locator('#mapViewTabBtn')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#mapLayersTabBtn')).toHaveAttribute('aria-selected', 'false');
    await expect(page.locator('#mapViewSection')).toBeVisible();
    await expect(page.locator('#layerSection')).toBeHidden();
    await expect.poll(() => page.locator('#projectionControl').evaluate(control => control.parentElement?.id)).toBe('mapViewProjectionSlot');
    await expect(page.locator('#projectionControl')).toContainText('지구본');
    await expect(page.locator('#projectionControl')).toContainText('평면');
    await expect(page.locator('label:has(#basemapLabelsVisible)')).toContainText('국가명 표시');
    await expect(page.locator('label:has(#labelsVisible)')).toContainText('도시·지명 표시');
    await expect(page.locator('#distributionLayerSettingsTitle')).toHaveText('분포가 겹칠 때');
    await expect(page.locator('#distributionLayerModeInput option')).toHaveText([
      '영역별 가장 높은 비율',
      '선택한 분포의 비율',
    ]);
    await selectUiOption(page, '#distributionLayerModeInput', 'intensity');
    await expect(page.locator('#distributionLayerModeHint')).toHaveText('선택한 분포를 비율이 높을수록 진하게 표시합니다.');
    await page.locator('#mapViewTabBtn').focus();
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator('#mapLayersTabBtn')).toBeFocused();
    await expect(page.locator('#layerSection')).toBeVisible();

    const search = page.locator('#layerSearchInput');
    await search.fill('폴란드');
    await page.locator('#layerSearchResults .layer-search-result').first().click();
    if (!await page.locator('#editorObjectHeader').isVisible()) await page.locator('#mobileEditBtn').click();
    await expect(page.locator('.editor-view-tabs')).toBeVisible();

    const tabMetrics = await page.locator('.editor-view-tabs').evaluate(tabs => {
      const active = tabs.querySelector('[aria-selected="true"]');
      const inactive = tabs.querySelector('[aria-selected="false"]');
      const tabsStyle = getComputedStyle(tabs);
      const activeMark = getComputedStyle(active, '::after');
      const inactiveMark = getComputedStyle(inactive, '::after');
      return {
        borderBottomWidth: tabsStyle.borderBottomWidth,
        width: activeMark.width,
        height: activeMark.height,
        radius: activeMark.borderRadius,
        activeOpacity: activeMark.opacity,
        inactiveOpacity: inactiveMark.opacity,
      };
    });
    expect(tabMetrics).toMatchObject({
      borderBottomWidth: '0px',
      width: '30px',
      height: '3px',
      radius: '999px',
      activeOpacity: '1',
      inactiveOpacity: '0',
    });

    await page.locator('#actionsTabBtn').click();
    const list = page.locator('#countryProperties .editor-action-list').first();
    const row = list.locator('.editor-action-row').first();
    const flatMetrics = await list.evaluate(element => {
      const style = getComputedStyle(element);
      const rowStyle = getComputedStyle(element.querySelector('.editor-action-row'));
      return {
        listTop: style.borderTopWidth,
        listBottom: style.borderBottomWidth,
        gap: style.rowGap,
        rowBottom: rowStyle.borderBottomWidth,
        radius: rowStyle.borderRadius,
        background: rowStyle.backgroundColor,
      };
    });
    expect(flatMetrics.listTop).toBe('0px');
    expect(flatMetrics.listBottom).toBe('0px');
    expect(flatMetrics.gap).toBe('4px');
    expect(flatMetrics.rowBottom).toBe('0px');
    expect(parseFloat(flatMetrics.radius)).toBeGreaterThan(0);
    await row.hover();
    await expect.poll(() => row.evaluate(element => getComputedStyle(element).backgroundColor)).not.toBe(flatMetrics.background);

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    expect(errors).toEqual([]);
  });
}
