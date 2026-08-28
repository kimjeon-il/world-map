import { expect, test } from '@playwright/test';

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
  test(`${layout.name} keeps layer settings in the header and uses compact editor highlights`, async ({ page }) => {
    test.setTimeout(180_000);
    const errors = await openApp(page, layout);

    await expect(page.locator('.layer-panel-header .layer-header-title-group')).toContainText('레이어');
    await expect(page.locator('.layer-panel-header #layerPresentationBtn')).toBeVisible();
    const headerSpacing = await page.locator('.layer-header-title-group').evaluate(group => {
      const title = group.querySelector('#mapSheetTitle').getBoundingClientRect();
      const button = group.querySelector('#layerPresentationBtn').getBoundingClientRect();
      return { gap: button.left - title.right, buttonWidth: button.width, buttonHeight: button.height };
    });
    expect(headerSpacing.gap).toBeGreaterThanOrEqual(0);
    expect(headerSpacing.gap).toBeLessThanOrEqual(8);
    const expectedHeaderButtonSize = layout.name === 'mobile' ? 48 : 32;
    expect(headerSpacing.buttonWidth).toBeCloseTo(expectedHeaderButtonSize, 4);
    expect(headerSpacing.buttonHeight).toBeCloseTo(expectedHeaderButtonSize, 4);

    await expect(page.locator('#countriesLocked')).toBeHidden();
    expect(await page.locator('#countriesLocked').boundingBox()).toBeNull();
    await expect(page.locator('#countriesLocked')).toHaveCSS('display', 'none');
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

    await page.locator('#layerPresentationBtn').click();
    await expect(page.locator('#mapSheetTitle')).toHaveText('레이어 표시 설정');
    await expect(page.locator('#layerPresentationCloseBtn')).toBeVisible();
    await expect(page.locator('#layerPresentationCloseBtn')).toBeFocused();
    await expect(page.locator('#layerPresentationBtn')).toBeHidden();
    await expect(page.locator('#layerPresentationDoneBtn, .layer-subview-header')).toHaveCount(0);
    await expect(page.locator('#distributionLayerSettingsTitle')).toHaveText('분포가 겹칠 때');
    await expect(page.locator('#distributionLayerModeInput option')).toHaveText([
      '영역별 가장 높은 비율',
      '선택한 분포의 비율',
    ]);
    await page.locator('#distributionLayerModeInput').selectOption('intensity');
    await expect(page.locator('#distributionLayerModeHint')).toHaveText('선택한 분포를 비율이 높을수록 진하게 표시합니다.');
    await page.locator('#layerPresentationCloseBtn').click();
    await expect(page.locator('#mapSheetTitle')).toHaveText('레이어');
    await expect(page.locator('#layerPresentationBtn')).toBeFocused();

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
