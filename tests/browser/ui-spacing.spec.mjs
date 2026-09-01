import { expect, test } from '@playwright/test';

const layouts = [
  { name: 'wide', viewport: { width: 1440, height: 900 }, panelPadding: 0, headerHeight: 74, controlHeight: 42 },
  { name: 'compact', viewport: { width: 1024, height: 800 }, panelPadding: 0, headerHeight: 74, controlHeight: 42 },
  { name: 'mobile', viewport: { width: 390, height: 844 }, panelPadding: 0, headerHeight: 76, controlHeight: 48 },
];

async function openApp(page, viewport, colorScheme) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.setViewportSize(viewport);
  await page.emulateMedia({ colorScheme });
  await page.goto('/');
  await expect(page.locator('#bootstrapLoading')).toHaveAttribute('hidden', '', { timeout: 30_000 });
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 30_000 });
  return errors;
}

async function computed(locator, properties) {
  return locator.evaluate((element, names) => {
    const style = getComputedStyle(element);
    return Object.fromEntries(names.map(name => [name, style.getPropertyValue(name)]));
  }, properties);
}

async function height(locator) {
  return locator.evaluate(element => element.getBoundingClientRect().height);
}

async function openLayers(page, layout) {
  if (layout !== 'wide') await page.locator('#mobileMapBtn').click();
  await expect(page.locator('#leftPanel')).toBeVisible();
}

async function openLibrary(page, layout) {
  if (layout === 'wide') await page.locator('#createMenuBtn').click();
  else await page.locator('#mobileCreateBtn').click();
  await page.locator('#createLibraryTabBtn').click();
  await page.locator('#addFromLibraryBtn').click();
  await expect(page.locator('#historicalLibraryModal')).toBeVisible();
}

for (const layout of layouts) {
  for (const colorScheme of ['light', 'dark']) {
    test(`${layout.name} ${colorScheme} uses the shared spacing grammar`, async ({ page }) => {
      const errors = await openApp(page, layout.viewport, colorScheme);
      await expect(page.locator('#app')).toHaveAttribute('data-layout', layout.name);

      const tokens = await page.locator(':root').evaluate(element => {
        const style = getComputedStyle(element);
        return {
          control: style.getPropertyValue('--ui-control-height').trim(),
          touch: style.getPropertyValue('--ui-touch-height').trim(),
          fieldX: style.getPropertyValue('--ui-control-padding-x').trim(),
          treeRow: style.getPropertyValue('--ui-tree-row-height').trim(),
          dialogPadding: style.getPropertyValue('--ui-dialog-padding').trim(),
        };
      });
      expect(tokens).toEqual({ control: '42px', touch: '48px', fieldX: '12px', treeRow: '48px', dialogPadding: '24px' });

      await openLayers(page, layout.name);
      expect(await height(page.locator('#leftPanel .layer-panel-header'))).toBe(layout.headerHeight);
      const panelStyle = await computed(page.locator('#layerSection'), ['padding-left', 'padding-right']);
      expect(panelStyle).toEqual({ 'padding-left': `${layout.panelPadding}px`, 'padding-right': `${layout.panelPadding}px` });

      const countryFolder = page.locator('.layer-folder[data-layer-group="countries"]');
      expect(await height(countryFolder.locator(':scope > .layer-folder-row'))).toBeCloseTo(48, 1);
      await countryFolder.locator('[data-layer-folder-toggle="countries"]').first().click();
      const firstCountry = page.locator('#countriesLayerChildren .layer-child').first();
      await expect(firstCountry).toBeVisible();
      expect(await height(firstCountry)).toBeCloseTo(48, 1);
      expect(await height(firstCountry.locator('.layer-child-menu'))).toBeCloseTo(layout.controlHeight, 1);

      const focusTarget = countryFolder.locator('[data-layer-folder-toggle="countries"]').first();
      const beforeHover = await focusTarget.boundingBox();
      await focusTarget.hover();
      expect(await focusTarget.boundingBox()).toEqual(beforeHover);
      await focusTarget.focus();
      expect(await focusTarget.boundingBox()).toEqual(beforeHover);

      await openLibrary(page, layout.name);
      const librarySearch = page.locator('#historicalLibrarySearchInput');
      expect(await height(librarySearch)).toBe(layout.controlHeight);
      const searchFieldStyle = await computed(librarySearch.locator('xpath=..'), ['padding-left', 'padding-right']);
      expect(searchFieldStyle).toEqual({ 'padding-left': '12px', 'padding-right': '0px' });
      const searchInputStyle = await computed(librarySearch, ['padding-left', 'padding-right']);
      expect(searchInputStyle).toEqual({ 'padding-left': '0px', 'padding-right': '0px' });

      await page.locator('.historical-library-filters summary').click();
      const typeField = page.locator('#historicalLibraryTypeInput').locator('xpath=..');
      const customSelect = typeField.locator('.ui-select-control');
      const selectStyle = await computed(customSelect, ['padding-left', 'padding-right']);
      expect(selectStyle).toEqual({ 'padding-left': '12px', 'padding-right': '40px' });
      expect(await height(customSelect)).toBe(layout.controlHeight);
      const toggleStyle = await computed(typeField.locator('.ui-select-toggle'), ['right', 'width', 'height']);
      expect(toggleStyle).toEqual({ right: '12px', width: '18px', height: '18px' });

      await customSelect.click();
      const popover = page.locator('.ui-select-popover:not([hidden])');
      await expect(popover).toBeVisible();
      const popoverStyle = await computed(popover, ['padding-top', 'padding-right', 'padding-bottom', 'padding-left']);
      expect(new Set(Object.values(popoverStyle))).toEqual(new Set(['8px']));
      const optionHeight = await height(popover.locator('.ui-select-option').first());
      expect(optionHeight).toBeGreaterThanOrEqual(layout.controlHeight === 48 ? 48 : 40);
      expect(optionHeight).toBeLessThanOrEqual(56);
      await page.keyboard.press('Escape');
      await expect(customSelect).toBeFocused();

      if (layout.name !== 'mobile') {
        const libraryMetrics = await page.locator('.historical-library-card').evaluate(card => {
          const body = card.querySelector('.historical-library-layout');
          const results = card.querySelector('.historical-library-results');
          return {
            cardHeight: card.getBoundingClientRect().height,
            bodyHeight: body.getBoundingClientRect().height,
            resultClientHeight: results.clientHeight,
            resultScrollHeight: results.scrollHeight,
          };
        });
        expect(libraryMetrics.cardHeight).toBeLessThanOrEqual(layout.viewport.height - 32);
        expect(libraryMetrics.bodyHeight).toBeLessThan(libraryMetrics.cardHeight);
        expect(libraryMetrics.resultClientHeight).toBeLessThanOrEqual(libraryMetrics.bodyHeight);
        expect(libraryMetrics.resultScrollHeight).toBeGreaterThan(libraryMetrics.resultClientHeight);
      }

      expect(errors).toEqual([]);
    });
  }
}

test('native and custom selects reserve the same indicator geometry', async ({ page }) => {
  const errors = await openApp(page, layouts[0].viewport, 'light');
  const result = await page.evaluate(() => {
    const field = document.createElement('label');
    field.className = 'ui-field field-group';
    field.style.position = 'fixed';
    field.style.left = '20px';
    field.style.top = '20px';
    field.style.width = '240px';
    const select = document.createElement('select');
    select.innerHTML = '<option>기본 선택</option>';
    field.append(select);
    document.body.append(field);
    const style = getComputedStyle(select);
    const metrics = {
      height: select.getBoundingClientRect().height,
      paddingLeft: style.paddingLeft,
      paddingRight: style.paddingRight,
      backgroundPosition: style.backgroundPosition,
      backgroundSize: style.backgroundSize,
    };
    field.remove();
    return metrics;
  });
  expect(result.height).toBe(42);
  expect(result.paddingLeft).toBe('12px');
  expect(result.paddingRight).toBe('40px');
  expect(result.backgroundPosition).toContain('12px');
  expect(result.backgroundSize).toBe('18px 18px');
  expect(errors).toEqual([]);
});
