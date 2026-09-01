import { expect, test } from '@playwright/test';

const viewports = [
  { width: 1440, height: 900, layout: 'wide' },
  { width: 1360, height: 900, layout: 'wide' },
  { width: 1359, height: 900, layout: 'compact' },
  { width: 1200, height: 850, layout: 'compact' },
  { width: 1199, height: 850, layout: 'compact' },
  { width: 800, height: 800, layout: 'compact' },
  { width: 799, height: 900, layout: 'mobile' },
  { width: 430, height: 900, layout: 'mobile' },
  { width: 390, height: 844, layout: 'mobile' },
  { width: 360, height: 800, layout: 'mobile' },
];

async function openApp(page, viewport, colorScheme) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await page.emulateMedia({ colorScheme });
  await page.goto('/?renderer=canvas');
  await expect(page.locator('#bootstrapLoading')).toHaveAttribute('hidden', '', { timeout: 30_000 });
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
  await expect(page.locator('#app')).toHaveAttribute('data-layout', viewport.layout);
  return errors;
}

async function openCreateMenu(page, layout) {
  await page.locator(layout === 'wide' ? '#createMenuBtn' : '#mobileCreateBtn').click();
  await expect(page.locator('#createMenu')).toBeVisible();
}

async function openLayers(page, layout) {
  if (layout !== 'wide') await page.locator('#mobileMapBtn').click();
  await expect(page.locator('#leftPanel')).toBeVisible();
}

test('create menu preserves all existing actions and unique icons', async ({ page }) => {
  const errors = await openApp(page, viewports[0], 'light');
  await openCreateMenu(page, 'wide');
  const expectedIds = [
    'addCountryBtn', 'addTerritoryBtn', 'addAdministrativeBtn', 'addRegionBtn',
    'addDistributionBtn', 'addLabelBtn', 'addRiverBtn', 'addLakeBtn', 'addFromLibraryBtn',
  ];
  const items = page.locator('#createMenu .create-menu-item');
  await expect(items).toHaveCount(expectedIds.length);
  expect(await items.evaluateAll(elements => elements.map(element => element.id))).toEqual(expectedIds);
  expect(await items.evaluateAll(elements => elements.every(element => element.getAttribute('role') === 'menuitem'))).toBe(true);
  const iconHrefs = await items.locator('use').evaluateAll(elements => elements.map(element => element.getAttribute('href')));
  expect(new Set(iconHrefs).size).toBe(expectedIds.length);
  expect((await items.locator('strong').allTextContents()).slice(0, 4)).toEqual(['국가', '권역', '행정구역', '지방']);
  expect(errors).toEqual([]);
});

test('create menu keeps build and library routes separate', async ({ page }) => {
  const errors = await openApp(page, viewports[0], 'light');
  await openCreateMenu(page, 'wide');
  await expect(page.locator('#createBuildTabBtn')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#createBuildPanel')).toBeVisible();
  await expect(page.locator('#createLibraryPanel')).toBeHidden();
  await page.locator('#createLibraryTabBtn').click();
  await expect(page.locator('#createLibraryTabBtn')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#createLibraryPanel')).toBeVisible();
  await expect(page.locator('#createBuildPanel')).toBeHidden();
  await page.locator('#createMenuBtn').click();
  await page.locator('#createMenuBtn').click();
  await expect(page.locator('#createLibraryPanel')).toBeVisible();
  expect(errors).toEqual([]);
});

test('territory and region creation expose different canonical methods', async ({ page }) => {
  const errors = await openApp(page, viewports[0], 'light');
  await page.evaluate(() => {
    const country = window.PANDOLAB_TERRITORIAL.list({ type: 'country' })[0];
    if (!country) throw new Error('생성 방식 시험에 사용할 국가를 찾지 못했습니다.');
    window.PANDOLAB_TERRITORIAL.select('country', country.id);
  });
  await openCreateMenu(page, 'wide');

  await page.locator('#addTerritoryBtn').click();
  await expect(page.locator('#territorialCreateModal')).toBeVisible();
  await expect(page.locator('#territorialCreateTitle')).toHaveText('권역 추가');
  expect(await page.locator('#territorialCreateMethod option').allTextContents()).toEqual([
    '기존 영역 나누기', '영역 직접 지정', 'GeoJSON에서 가져오기',
  ]);
  await page.locator('#territorialCreateCancelBtn').click();

  await page.locator('#addRegionBtn').click();
  await expect(page.locator('#territorialCreateModal')).toBeVisible();
  await expect(page.locator('#territorialCreateTitle')).toHaveText('지방 추가');
  expect(await page.locator('#territorialCreateMethod option').allTextContents()).toEqual([
    '영역 직접 지정', 'GeoJSON에서 가져오기',
  ]);
  await expect(page.locator('#territorialCreateMethod')).toHaveValue('draw');
  await page.locator('#territorialCreateCancelBtn').click();

  await expect(page.locator('#addFromLibraryBtn small')).toHaveText('현존·과거 국가와 지역 검색');
  expect(errors).toEqual([]);
});

test('compact create menu uses the shared floating drawer shell', async ({ page }) => {
  const viewport = viewports.find(candidate => candidate.width === 1200);
  const errors = await openApp(page, viewport, 'light');
  await openCreateMenu(page, 'compact');
  await page.waitForTimeout(200);
  const geometry = await page.evaluate(() => {
    const menu = document.querySelector('#createMenu');
    const drawer = document.querySelector('#leftPanel');
    const workspace = document.querySelector('.workspace');
    const style = element => getComputedStyle(element);
    const menuBox = menu.getBoundingClientRect();
    const workspaceBox = workspace.getBoundingClientRect();
    return {
      menu: {
        top: style(menu).top,
        bottom: style(menu).bottom,
        left: style(menu).left,
        width: style(menu).width,
        border: style(menu).borderTopWidth,
        radius: style(menu).borderTopLeftRadius,
        shadow: style(menu).boxShadow,
        visibility: style(menu).visibility,
        pointerEvents: style(menu).pointerEvents,
        renderedTop: menuBox.top,
        renderedBottom: menuBox.bottom,
        renderedLeft: menuBox.left,
      },
      drawer: {
        top: style(drawer).top,
        bottom: style(drawer).bottom,
        left: style(drawer).left,
        width: style(drawer).width,
        border: style(drawer).borderTopWidth,
        radius: style(drawer).borderTopLeftRadius,
        shadow: style(drawer).boxShadow,
      },
      workspace: {
        top: workspaceBox.top,
        bottom: workspaceBox.bottom,
      },
    };
  });
  expect(geometry.menu.bottom).toBe(geometry.drawer.bottom);
  expect(geometry.menu.left).toBe(geometry.drawer.left);
  expect(geometry.menu.width).toBe(geometry.drawer.width);
  expect(geometry.menu.border).toBe(geometry.drawer.border);
  expect(geometry.menu.radius).toBe(geometry.drawer.radius);
  expect(geometry.menu.shadow).toBe(geometry.drawer.shadow);
  expect(geometry.menu.visibility).toBe('visible');
  expect(geometry.menu.pointerEvents).toBe('auto');
  expect(geometry.menu.renderedLeft).toBe(8);
  expect(geometry.menu.renderedTop).toBe(geometry.workspace.top + Number.parseFloat(geometry.drawer.top));
  expect(geometry.menu.renderedBottom).toBe(geometry.workspace.bottom - Number.parseFloat(geometry.drawer.bottom));
  expect(errors).toEqual([]);
});

for (const colorScheme of ['light', 'dark']) {
  for (const viewport of viewports) {
    test(`${viewport.width}px ${colorScheme} keeps layer and create-menu geometry`, async ({ page }) => {
      test.setTimeout(180_000);
      const errors = await openApp(page, viewport, colorScheme);

      await openCreateMenu(page, viewport.layout);
      const createMetrics = await page.locator('#createMenu').evaluate(menu => {
        const item = menu.querySelector('.create-menu-item');
        const icon = item.querySelector('.create-menu-icon');
        const title = item.querySelector('strong');
        const description = item.querySelector('small');
        const category = menu.querySelector('.create-menu-group');
        const style = element => getComputedStyle(element);
        return {
          menuWidth: menu.getBoundingClientRect().width,
          itemHeight: item.getBoundingClientRect().height,
          columns: style(item).gridTemplateColumns,
          columnGap: style(item).columnGap,
          itemPadding: [style(item).paddingTop, style(item).paddingRight, style(item).paddingBottom, style(item).paddingLeft],
          iconSize: [icon.getBoundingClientRect().width, icon.getBoundingClientRect().height],
          title: [style(title).fontSize, style(title).fontWeight],
          description: [style(description).fontSize, style(description).fontWeight, style(description).lineHeight],
          category: [style(category).fontSize, style(category).fontWeight, style(category).lineHeight, style(category).color],
          layerCategoryColor: style(document.querySelector('.layer-category-title')).color,
          overflow: menu.scrollWidth > menu.clientWidth + 1,
        };
      });
      if (viewport.layout === 'mobile') expect(createMetrics.menuWidth).toBe(viewport.width);
      else if (viewport.layout === 'compact') expect(createMetrics.menuWidth).toBe(Math.min(352, viewport.width - 24));
      else expect(createMetrics.menuWidth).toBe(280);
      expect(createMetrics.itemHeight).toBe(viewport.layout === 'mobile' ? 68 : 64);
      expect(createMetrics.columns.split(' ')[0]).toBe('38px');
      expect(createMetrics.columnGap).toBe('12px');
      expect(createMetrics.itemPadding).toEqual(['8px', '8px', '8px', '8px']);
      expect(createMetrics.iconSize).toEqual([38, 38]);
      expect(createMetrics.title).toEqual(['15px', '600']);
      expect(createMetrics.description).toEqual(['13px', '400', '19.5px']);
      expect(createMetrics.category.slice(0, 3)).toEqual(['13px', '600', '17.55px']);
      expect(createMetrics.category[3]).toBe(createMetrics.layerCategoryColor);
      expect(createMetrics.overflow).toBe(false);

      await page.locator(viewport.layout === 'wide' ? '#createMenuBtn' : '#mobileCreateBtn').click();
      await openLayers(page, viewport.layout);
      const folder = page.locator('.layer-folder[data-layer-group="countries"]');
      const folderMetrics = await folder.locator(':scope > .layer-folder-row').evaluate(row => {
        const style = getComputedStyle(row);
        const size = element => {
          const bounds = element.getBoundingClientRect();
          return [Math.round(bounds.width), Math.round(bounds.height)];
        };
        const name = row.querySelector('.layer-folder-name');
        return {
          height: row.getBoundingClientRect().height,
          gap: style.columnGap,
          actionSize: size(row.querySelector('.layer-folder-toggle')),
          visibilitySize: size(row.querySelector('.layer-visibility-control')),
          tuneSize: size(row.querySelector('.layer-style-toggle')),
          nameWidth: name.clientWidth,
          nameOverflow: name.scrollWidth > name.clientWidth,
          rowOverflow: row.scrollWidth > row.clientWidth + 1,
        };
      });
      const actionSize = viewport.layout === 'mobile' ? 48 : 42;
      expect(folderMetrics.height).toBe(48);
      expect(folderMetrics.gap).toBe('4px');
      expect(folderMetrics.actionSize).toEqual([actionSize, actionSize]);
      expect(folderMetrics.visibilitySize).toEqual([actionSize, actionSize]);
      expect(folderMetrics.tuneSize).toEqual([actionSize, actionSize]);
      expect(folderMetrics.nameWidth).toBeGreaterThan(24);
      expect(folderMetrics.nameOverflow).toBe(false);
      expect(folderMetrics.rowOverflow).toBe(false);

      await folder.locator('[data-layer-folder-toggle="countries"]').first().click();
      const children = page.locator('#countriesLayerChildren');
      const child = children.locator('.layer-child').first();
      await expect(child).toBeVisible();
      const childMetrics = await child.evaluate(row => {
        const style = getComputedStyle(row);
        const size = element => {
          if (!element) return null;
          const bounds = element.getBoundingClientRect();
          return [Math.round(bounds.width), Math.round(bounds.height)];
        };
        const name = row.querySelector('.layer-child-name');
        return {
          height: row.getBoundingClientRect().height,
          gap: style.columnGap,
          visibilitySize: size(row.querySelector('.layer-visibility-control')),
          menuSize: size(row.querySelector('.layer-child-menu')),
          nameWidth: name.clientWidth,
          rowOverflow: row.scrollWidth > row.clientWidth + 1,
          childrenOverflow: row.parentElement
            ? row.parentElement.scrollWidth > row.parentElement.clientWidth + 1
            : false,
        };
      });
      expect(childMetrics.height).toBe(48);
      expect(childMetrics.gap).toBe('4px');
      expect(childMetrics.visibilitySize).toEqual([actionSize, actionSize]);
      expect(childMetrics.menuSize).toEqual([actionSize, actionSize]);
      expect(childMetrics.nameWidth).toBeGreaterThan(24);
      expect(childMetrics.rowOverflow).toBe(false);
      expect(childMetrics.childrenOverflow).toBe(false);
      expect(errors).toEqual([]);
    });
  }
}
