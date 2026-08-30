import { expect, test } from '@playwright/test';

const layouts = [
  { name: 'wide', width: 1440, height: 900 },
  { name: 'compact', width: 1024, height: 800 },
  { name: 'mobile', width: 390, height: 844 },
];

async function openApp(page, layout) {
  await page.setViewportSize({ width: layout.width, height: layout.height });
  await page.goto('/?renderer=canvas&sheet-rail-test=1');
  await expect(page.locator('#bootstrapLoading')).toHaveAttribute('hidden', '', { timeout: 30_000 });
  await expect(page.locator('#app')).toHaveAttribute('data-readiness', 'enhanced', { timeout: 90_000 });
  await expect(page.locator('#app')).toHaveAttribute('data-layout', layout.name);
}

async function readRails(page, kind) {
  return page.evaluate(kind => {
    const box = selector => {
      const element = document.querySelector(selector);
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        left: rect.left,
        right: rect.right,
        paddingLeft: Number.parseFloat(style.paddingLeft),
        paddingRight: Number.parseFloat(style.paddingRight),
        clientWidth: element.clientWidth,
        offsetWidth: element.offsetWidth,
      };
    };
    const inset = selector => {
      const value = box(selector);
      return [value.left + value.paddingLeft, value.right - value.paddingRight];
    };
    if (kind === 'layers') {
      const list = box('.layer-list');
      return {
        header: inset('.layer-panel-header'),
        tabs: inset('.map-panel-tabs'),
        search: (() => { const value = box('.layer-search'); return [value.left, value.right]; })(),
        content: [
          list.left + list.paddingLeft,
          list.right - list.paddingRight - (list.offsetWidth - list.clientWidth),
        ],
      };
    }
    if (kind === 'view') {
      return {
        header: inset('.layer-panel-header'),
        tabs: inset('.map-panel-tabs'),
        content: inset('.map-view-settings'),
      };
    }
    if (kind === 'create') {
      const header = box('.create-sheet-header');
      const content = inset('.create-sheet-content');
      const item = box('.create-menu-item');
      return {
        ...(header.offsetWidth > 0 ? { header: [header.left + header.paddingLeft, header.right - header.paddingRight] } : {}),
        content,
        firstItem: [item.left, item.right],
      };
    }
    return {
      header: inset('.editor-shell-header'),
      content: inset('.editor-empty'),
    };
  }, kind);
}

function expectAligned(rails) {
  const entries = Object.entries(rails);
  const [, [left, right]] = entries.find(([name]) => name === 'header') || entries[0];
  for (const [, [candidateLeft, candidateRight]] of entries) {
    expect(Math.abs(candidateLeft - left)).toBeLessThanOrEqual(1);
    expect(Math.abs(candidateRight - right)).toBeLessThanOrEqual(1);
  }
}

test('sheet headers, tabs, and content share one rail in every layout', async ({ page }) => {
  test.setTimeout(240_000);
  for (const layout of layouts) {
    await openApp(page, layout);
    if (layout.name !== 'wide') await page.locator('#mobileMapBtn').click();

    expectAligned(await readRails(page, 'layers'));
    await page.locator('#mapViewTabBtn').click();
    expectAligned(await readRails(page, 'view'));

    await page.locator(layout.name === 'wide' ? '#createMenuBtn' : '#mobileCreateBtn').click();
    await expect(page.locator('#createMenu')).toBeVisible();
    expectAligned(await readRails(page, 'create'));

    await page.locator(layout.name === 'wide' ? '#togglePanelBtn' : '#mobileEditBtn').click();
    await expect(page.locator('#rightPanel')).toBeVisible();
    expectAligned(await readRails(page, 'editor'));
  }
});
