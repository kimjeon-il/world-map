import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

async function openApp(page) {
  await page.goto('/');
  await expect(page.locator('#bootstrapLoading')).toHaveAttribute('hidden', '', { timeout: 30_000 });
}

async function openSheet(page, trigger, panel) {
  if (await page.locator(trigger).getAttribute('aria-expanded') !== 'true') await page.locator(trigger).tap();
  await expect(page.locator(panel)).toBeVisible();
  return page.locator(panel).evaluate(element => element.getBoundingClientRect().height);
}

async function dragHeader(page, panel, deltaY, duration = 320) {
  const header = page.locator(`${panel} .map-sheet-header`);
  const start = await header.evaluate(element => {
    const view = element.ownerDocument.defaultView;
    const rect = element.getBoundingClientRect();
    const target = element.querySelector('strong') || element;
    const point = { x: rect.left + rect.width / 2, y: rect.top + rect.height * 0.7 };
    target.dispatchEvent(new view.PointerEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
      pointerId: 71,
      pointerType: 'touch',
      isPrimary: true,
      button: 0,
      buttons: 1,
      clientX: point.x,
      clientY: point.y,
    }));
    return point;
  });
  await page.waitForTimeout(duration);
  await header.evaluate((element, payload) => {
    const view = element.ownerDocument.defaultView;
    element.dispatchEvent(new view.PointerEvent('pointermove', {
      bubbles: true,
      cancelable: true,
      pointerId: 71,
      pointerType: 'touch',
      isPrimary: true,
      button: 0,
      buttons: 1,
      clientX: payload.x,
      clientY: payload.y + payload.deltaY,
    }));
    element.dispatchEvent(new view.PointerEvent('pointerup', {
      bubbles: true,
      cancelable: true,
      pointerId: 71,
      pointerType: 'touch',
      isPrimary: true,
      button: 0,
      buttons: 0,
      clientX: payload.x,
      clientY: payload.y + payload.deltaY,
    }));
  }, { ...start, deltaY });
}

async function startBodyTouch(page, target, identifier = 81) {
  return page.locator(target).evaluate((element, touchId) => {
    const view = element.ownerDocument.defaultView;
    const rect = element.getBoundingClientRect();
    const point = { x: rect.left + Math.min(rect.width / 2, 120), y: rect.top + Math.min(rect.height / 2, 100) };
    const touch = new view.Touch({ identifier: touchId, target: element, clientX: point.x, clientY: point.y });
    element.dispatchEvent(new view.TouchEvent('touchstart', {
      bubbles: true,
      cancelable: true,
      touches: [touch],
      targetTouches: [touch],
      changedTouches: [touch],
    }));
    return point;
  }, identifier);
}

async function finishBodyTouch(page, target, start, deltaY, identifier = 81, duration = 320) {
  await page.waitForTimeout(duration);
  return page.locator(target).evaluate((element, payload) => {
    const view = element.ownerDocument.defaultView;
    const touch = new view.Touch({
      identifier: payload.identifier,
      target: element,
      clientX: payload.start.x,
      clientY: payload.start.y + payload.deltaY,
    });
    const moveAccepted = element.dispatchEvent(new view.TouchEvent('touchmove', {
      bubbles: true,
      cancelable: true,
      touches: [touch],
      targetTouches: [touch],
      changedTouches: [touch],
    }));
    element.dispatchEvent(new view.TouchEvent('touchend', {
      bubbles: true,
      cancelable: true,
      touches: [],
      targetTouches: [],
      changedTouches: [touch],
    }));
    return { movePrevented: !moveAccepted };
  }, { start, deltaY, identifier });
}

test('mobile sheets hide header close buttons and resize from the full header', async ({ page }) => {
  await openApp(page);
  await openSheet(page, '#mobileMapBtn', '#leftPanel');
  await expect(page.locator('#mobileCloseLeftBtn')).toBeHidden();
  await expect(page.locator('#mobileCloseCreateBtn')).toBeHidden();
  await expect(page.locator('#mobileCloseRightBtn')).toBeHidden();

  const initialHeight = await page.locator('#leftPanel').evaluate(element => element.getBoundingClientRect().height);
  await dragHeader(page, '#leftPanel', -180);
  const expandedHeight = await page.locator('#leftPanel').evaluate(element => element.getBoundingClientRect().height);
  expect(expandedHeight).toBeGreaterThan(initialHeight);
  await expect(page.locator('#leftPanel')).toHaveAttribute('data-sheet-snap', '1');

  await page.getByRole('slider', { name: '지도 창 높이 조절' }).press('Home');
  await expect(page.locator('#leftPanel')).toHaveAttribute('data-sheet-snap', '0');
  await dragHeader(page, '#leftPanel', 240, 450);
  await expect(page.locator('#leftPanel')).toBeHidden();
  await expect(page.locator('#mobileMapBtn')).toHaveAttribute('aria-expanded', 'false');
});

test('editor sheet body always keeps vertical touch gestures for content scrolling', async ({ page }) => {
  await openApp(page);
  await openSheet(page, '#mobileEditBtn', '#rightPanel');
  await page.locator('#editorScrollBody').evaluate(body => {
    const scroll = document.createElement('div');
    scroll.id = 'sheetGestureScrollProbe';
    scroll.style.cssText = 'height:120px;overflow-y:auto;';
    scroll.innerHTML = '<div style="height:600px">스크롤 테스트</div>';
    body.prepend(scroll);
  });
  const probe = page.locator('#sheetGestureScrollProbe');
  await expect(page.locator('#editorScrollBody')).toHaveCSS('touch-action', 'pan-y');
  await probe.evaluate(element => { element.scrollTop = 80; });
  const scrolledHeight = await page.locator('#rightPanel').evaluate(element => element.getBoundingClientRect().height);
  const scrolledStart = await startBodyTouch(page, '#sheetGestureScrollProbe');
  const scrolledMove = await finishBodyTouch(page, '#sheetGestureScrollProbe', scrolledStart, 140);
  const unchangedHeight = await page.locator('#rightPanel').evaluate(element => element.getBoundingClientRect().height);
  expect(scrolledMove.movePrevented).toBe(false);
  expect(Math.abs(unchangedHeight - scrolledHeight)).toBeLessThanOrEqual(1);

  await probe.evaluate(element => { element.scrollTop = 0; });
  const topStart = await startBodyTouch(page, '#sheetGestureScrollProbe', 82);
  const topMove = await finishBodyTouch(page, '#sheetGestureScrollProbe', topStart, -180, 82);
  const topHeight = await page.locator('#rightPanel').evaluate(element => element.getBoundingClientRect().height);
  expect(topMove.movePrevented).toBe(false);
  expect(Math.abs(topHeight - unchangedHeight)).toBeLessThanOrEqual(1);
  await expect(page.locator('#rightPanel')).toHaveAttribute('data-sheet-snap', '0');
});

test('map layer and view bodies keep touch scrolling while nested folders chain outward', async ({ page }) => {
  await openApp(page);
  const initialHeight = await openSheet(page, '#mobileMapBtn', '#leftPanel');
  const layerList = page.locator('.layer-list');
  await expect(layerList).toHaveCSS('touch-action', 'pan-y');
  await expect(layerList).toHaveCSS('overscroll-behavior-y', 'contain');

  await page.locator('[data-layer-folder-toggle="countries"]').first().tap();
  const countryChildren = page.locator('#countriesLayerChildren');
  await expect(countryChildren).toBeVisible();
  await expect(countryChildren).toHaveCSS('touch-action', 'pan-y');
  await expect(countryChildren).toHaveCSS('overscroll-behavior-y', 'auto');
  const layerStart = await startBodyTouch(page, '#countriesLayerChildren', 83);
  const layerMove = await finishBodyTouch(page, '#countriesLayerChildren', layerStart, -160, 83);
  expect(layerMove.movePrevented).toBe(false);
  expect(Math.abs(await page.locator('#leftPanel').evaluate(element => element.getBoundingClientRect().height) - initialHeight)).toBeLessThanOrEqual(1);

  await page.locator('#mapViewTabBtn').tap();
  const view = page.locator('#mapViewSection');
  await expect(view).toBeVisible();
  await expect(view).toHaveCSS('touch-action', 'pan-y');
  await expect(view).toHaveCSS('overscroll-behavior-y', 'contain');
  const viewStart = await startBodyTouch(page, '#mapViewSection', 84);
  const viewMove = await finishBodyTouch(page, '#mapViewSection', viewStart, -160, 84);
  expect(viewMove.movePrevented).toBe(false);
  expect(Math.abs(await page.locator('#leftPanel').evaluate(element => element.getBoundingClientRect().height) - initialHeight)).toBeLessThanOrEqual(1);
});

test('active navigation and browser back both dismiss the current mobile sheet', async ({ page }) => {
  await openApp(page);
  await openSheet(page, '#mobileCreateBtn', '#createMenu');
  await expect.poll(() => page.evaluate(() => globalThis.history.state?.__atlaswrightMobileSheet)).toBe('create');
  await page.locator('#mobileCreateBtn').tap();
  await expect(page.locator('#createMenu')).toBeHidden();
  await expect.poll(() => page.evaluate(() => globalThis.history.state?.__atlaswrightMobileSheet || null)).toBe(null);

  await openSheet(page, '#mobileEditBtn', '#rightPanel');
  await page.locator('#editorScrollBody').evaluate(body => {
    const select = document.createElement('select');
    select.id = 'sheetBackSelectProbe';
    for (let index = 0; index < 13; index += 1) select.add(new Option(`선택 ${index + 1}`, String(index)));
    body.prepend(select);
  });
  const selectControl = page.locator('#sheetBackSelectProbeControl');
  await expect(selectControl).toBeVisible();
  await selectControl.click();
  await expect(page.locator('.ui-select-popover:not([hidden])')).toBeVisible();
  await page.evaluate(() => globalThis.history.back());
  await expect(page.locator('.ui-select-popover:not([hidden])')).toHaveCount(0);
  await expect(page.locator('#rightPanel')).toBeVisible();
  await expect.poll(() => page.evaluate(() => globalThis.history.state?.__atlaswrightMobileSheet)).toBe('edit');

  await page.evaluate(() => globalThis.history.back());
  await expect(page.locator('#rightPanel')).toBeHidden();
  await expect(page.locator('#mobileEditBtn')).toHaveAttribute('aria-expanded', 'false');
});
