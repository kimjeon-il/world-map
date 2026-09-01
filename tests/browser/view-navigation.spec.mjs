import { expect, test } from '@playwright/test';

async function openDebugMap(page, viewport, url = '/?debug&renderer=canvas', { requireEnhanced = true } = {}) {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.setViewportSize(viewport);
  await page.goto(url);
  await expect(page.locator('#bootstrapLoading')).toHaveAttribute('hidden', '', { timeout: 45_000 });
  await expect(page.locator('#app')).toHaveAttribute(
    'data-readiness',
    requireEnhanced ? 'enhanced' : /^(editable|enhanced)$/,
    { timeout: 120_000 },
  );
  await expect.poll(() => page.evaluate(() => !!window.__PANDOLAB_VIEW_DEBUG__)).toBe(true);
  return errors;
}

async function setProjection(page, projection) {
  const selector = projection === 'globe' ? '#globeBtn' : '#flatBtn';
  await page.evaluate(id => document.querySelector(id)?.click(), selector);
  await expect(page.locator(selector)).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_VIEW_DEBUG__.snapshot().projection)).toBe(projection);
}

async function dragSurface(page, { delta, input, tolerance }) {
  const map = page.locator('#map');
  const box = await map.boundingBox();
  expect(box).not.toBeNull();
  const before = await page.evaluate(() => window.__PANDOLAB_VIEW_DEBUG__.snapshot());
  const start = [before.translate[0], before.translate[1]];
  const end = [start[0] + delta[0], start[1] + delta[1]];
  const anchor = await page.evaluate(point => window.__PANDOLAB_MAP_HOST__.unproject(point), start);
  expect(anchor).not.toBeNull();

  if (input === 'touch') {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 });
    const touchPoint = point => ({
      id: 91,
      x: box.x + point[0],
      y: box.y + point[1],
      radiusX: 1,
      radiusY: 1,
      force: 1,
    });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touchPoint(start)] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [touchPoint(end)] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();
  } else {
    await page.mouse.move(box.x + start[0], box.y + start[1]);
    await page.mouse.down();
    await page.mouse.move(box.x + end[0], box.y + end[1], { steps: 3 });
    await page.mouse.up();
  }

  await expect.poll(
    () => page.evaluate(revision => window.__PANDOLAB_VIEW_DEBUG__.snapshot().revision > revision, before.revision),
    { timeout: 20_000 },
  ).toBe(true);
  const projected = await page.evaluate(coordinate => window.__PANDOLAB_MAP_HOST__.project(coordinate), anchor);
  expect(projected).not.toBeNull();
  expect(Math.hypot(projected[0] - end[0], projected[1] - end[1])).toBeLessThanOrEqual(tolerance);
}

function geographicDelta(left, right) {
  const longitude = Math.abs((((Number(left?.[0]) - Number(right?.[0])) + 540) % 360) - 180);
  const latitude = Math.abs(Number(left?.[1]) - Number(right?.[1]));
  return Math.hypot(longitude, latitude);
}

function cameraValues(snapshot) {
  return {
    projection: snapshot.projection,
    rotation: snapshot.rotation,
    projectionCenter: snapshot.projectionCenter,
    zoom: snapshot.zoom,
  };
}

test('wheel, projection, panels, and selection preserve the intended camera state', async ({ page }) => {
  test.setTimeout(240_000);
  const errors = await openDebugMap(page, { width: 1440, height: 900 });
  const map = page.locator('#map');
  const box = await map.boundingBox();
  expect(box).not.toBeNull();

  const initial = await page.evaluate(() => window.__PANDOLAB_VIEW_DEBUG__.snapshot());
  const focalPoint = [
    initial.translate[0] + initial.scale * 0.42,
    initial.translate[1] - initial.scale * 0.12,
  ];
  const focalBefore = await page.evaluate(point => window.__PANDOLAB_VIEW_DEBUG__.screenToGeo(point), focalPoint);
  expect(focalBefore).not.toBeNull();
  await page.mouse.move(box.x + focalPoint[0], box.y + focalPoint[1]);
  await page.mouse.wheel(0, -320);
  await expect.poll(() => page.evaluate(() => window.__PANDOLAB_VIEW_STATE__.revision)).toBeGreaterThan(initial.revision);
  const focalAfter = await page.evaluate(point => window.__PANDOLAB_VIEW_DEBUG__.screenToGeo(point), focalPoint);
  expect(geographicDelta(focalBefore, focalAfter)).toBeLessThan(0.2);

  const globe = await page.evaluate(() => window.__PANDOLAB_VIEW_DEBUG__.snapshot());
  await page.locator('#mapViewTabBtn').click();
  await page.locator('#flatBtn').click();
  await expect(page.locator('#flatBtn')).toHaveAttribute('aria-pressed', 'true');
  const flat = await page.evaluate(() => window.__PANDOLAB_VIEW_DEBUG__.snapshot());
  expect(geographicDelta(globe.geographicCenter, flat.geographicCenter)).toBeLessThan(0.2);
  expect(Math.abs(flat.scale / globe.scale - 1)).toBeLessThan(0.03);

  await page.locator('#globeBtn').click();
  await expect(page.locator('#globeBtn')).toHaveAttribute('aria-pressed', 'true');
  const globeAgain = await page.evaluate(() => window.__PANDOLAB_VIEW_DEBUG__.snapshot());
  expect(geographicDelta(globe.geographicCenter, globeAgain.geographicCenter)).toBeLessThan(0.2);
  expect(Math.abs(globeAgain.scale / globe.scale - 1)).toBeLessThan(0.03);

  const cameraBeforeSelection = cameraValues(globeAgain);
  await page.locator('#mapLayersTabBtn').click();
  await page.locator('#layerSearchInput').fill('독일');
  const germany = page.locator('#layerSearchResults .layer-search-result').filter({ hasText: '독일' }).first();
  await expect(germany).toBeVisible();
  await germany.click();
  await expect(page.locator('#selectionStatus')).toContainText('독일');
  expect(cameraValues(await page.evaluate(() => window.__PANDOLAB_VIEW_DEBUG__.snapshot()))).toEqual(cameraBeforeSelection);

  await page.waitForTimeout(300);
  const revisionBeforeSelection = await page.evaluate(() => window.__PANDOLAB_VIEW_STATE__.revision);
  await page.locator('#layerSearchInput').fill('프랑스');
  const france = page.locator('#layerSearchResults .layer-search-result').filter({ hasText: '프랑스' }).first();
  await expect(france).toBeVisible();
  await france.click();
  await expect(page.locator('#selectionStatus')).toContainText('프랑스');
  expect(await page.evaluate(() => window.__PANDOLAB_VIEW_STATE__.revision)).toBe(revisionBeforeSelection);
  expect(cameraValues(await page.evaluate(() => window.__PANDOLAB_VIEW_DEBUG__.snapshot()))).toEqual(cameraBeforeSelection);

  const cameraBeforePanel = cameraValues(await page.evaluate(() => window.__PANDOLAB_VIEW_DEBUG__.snapshot()));
  await expect(page.locator('#mobileCloseRightBtn')).toBeVisible();
  await page.locator('#mobileCloseRightBtn').click();
  expect(cameraValues(await page.evaluate(() => window.__PANDOLAB_VIEW_DEBUG__.snapshot()))).toEqual(cameraBeforePanel);
  expect(errors).toEqual([]);
});

test('mobile pinch keeps the geographic anchor under the moving midpoint', async ({ browser }) => {
  test.setTimeout(240_000);
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  try {
    const errors = await openDebugMap(page, { width: 390, height: 844 });
    const box = await page.locator('#map').boundingBox();
    expect(box).not.toBeNull();
    const before = await page.evaluate(() => window.__PANDOLAB_VIEW_DEBUG__.snapshot());
    const oldMidpoint = before.translate;
    const newMidpoint = [oldMidpoint[0] + 24, oldMidpoint[1] + 18];
    const anchorBefore = await page.evaluate(point => window.__PANDOLAB_VIEW_DEBUG__.screenToGeo(point), oldMidpoint);
    expect(anchorBefore).not.toBeNull();

    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 });
    const touchPoint = (id, point) => ({ id, x: box.x + point[0], y: box.y + point[1], radiusX: 1, radiusY: 1, force: 1 });
    const start = [[oldMidpoint[0] - 30, oldMidpoint[1]], [oldMidpoint[0] + 30, oldMidpoint[1]]];
    const moved = [[newMidpoint[0] - 65, newMidpoint[1] - 10], [newMidpoint[0] + 65, newMidpoint[1] + 10]];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touchPoint(1, start[0]), touchPoint(2, start[1])] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [touchPoint(1, moved[0]), touchPoint(2, moved[1])] });
    await expect.poll(
      () => page.evaluate(() => window.__PANDOLAB_VIEW_DEBUG__.snapshot().scale),
      { timeout: 30_000 },
    ).toBeGreaterThan(before.scale * 1.5);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });

    const anchorAfter = await page.evaluate(point => window.__PANDOLAB_VIEW_DEBUG__.screenToGeo(point), newMidpoint);
    expect(geographicDelta(anchorBefore, anchorAfter)).toBeLessThan(0.35);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

test('Legacy Pando mouse drag makes the flat map and globe follow every pointer direction', async ({ page }) => {
  test.setTimeout(240_000);
  const errors = await openDebugMap(page, { width: 1440, height: 900 }, '/?debug', { requireEnhanced: false });
  await expect(page.locator('body')).toHaveAttribute('data-map-host', 'legacy');
  for (const projection of ['flat', 'globe']) {
    await setProjection(page, projection);
    for (const delta of [[56, 0], [-56, 0], [0, 56], [0, -56]]) {
      await dragSurface(page, { delta, input: 'mouse', tolerance: 4 });
    }
  }
  expect(errors).toEqual([]);
});

test('Legacy Pando touch drag makes the flat map and globe follow every finger direction', async ({ browser }) => {
  test.setTimeout(240_000);
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  try {
    const errors = await openDebugMap(page, { width: 390, height: 844 }, '/?debug', { requireEnhanced: false });
    await expect(page.locator('body')).toHaveAttribute('data-map-host', 'legacy');
    for (const projection of ['flat', 'globe']) {
      await setProjection(page, projection);
      for (const delta of [[44, 0], [-44, 0], [0, 44], [0, -44]]) {
        await dragSurface(page, { delta, input: 'touch', tolerance: 7 });
      }
    }
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

test('Legacy Pando mobile pinch keeps the original geographic anchor under its moving midpoint', async ({ browser }) => {
  test.setTimeout(240_000);
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  try {
    const errors = await openDebugMap(page, { width: 390, height: 844 }, '/?debug', { requireEnhanced: false });
    await expect(page.locator('body')).toHaveAttribute('data-map-host', 'legacy');
    const box = await page.locator('#map').boundingBox();
    expect(box).not.toBeNull();
    const before = await page.evaluate(() => window.__PANDOLAB_VIEW_DEBUG__.snapshot());
    const oldMidpoint = before.translate;
    const newMidpoint = [oldMidpoint[0] + 24, oldMidpoint[1] + 18];
    const anchorBefore = await page.evaluate(point => window.__PANDOLAB_VIEW_DEBUG__.screenToGeo(point), oldMidpoint);
    expect(anchorBefore).not.toBeNull();

    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 2 });
    const touchPoint = (id, point) => ({ id, x: box.x + point[0], y: box.y + point[1], radiusX: 1, radiusY: 1, force: 1 });
    const start = [[oldMidpoint[0] - 30, oldMidpoint[1]], [oldMidpoint[0] + 30, oldMidpoint[1]]];
    const moved = [[newMidpoint[0] - 65, newMidpoint[1] - 10], [newMidpoint[0] + 65, newMidpoint[1] + 10]];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touchPoint(1, start[0]), touchPoint(2, start[1])] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [touchPoint(1, moved[0]), touchPoint(2, moved[1])] });
    await expect.poll(
      () => page.evaluate(scale => window.__PANDOLAB_VIEW_DEBUG__.snapshot().scale > scale * 1.5, before.scale),
      { timeout: 30_000 },
    ).toBe(true);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await cdp.detach();

    const anchorAfter = await page.evaluate(point => window.__PANDOLAB_VIEW_DEBUG__.screenToGeo(point), newMidpoint);
    expect(geographicDelta(anchorBefore, anchorAfter)).toBeLessThan(0.35);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
  }
});

test('legacy flat map and globe retain surface-relative drag direction', async ({ page }) => {
  test.setTimeout(240_000);
  const errors = await openDebugMap(page, { width: 1200, height: 800 }, '/?debug&maphost=legacy', { requireEnhanced: false });
  await expect(page.locator('body')).toHaveAttribute('data-map-host', 'legacy');
  for (const projection of ['flat', 'globe']) {
    await setProjection(page, projection);
    await dragSurface(page, { delta: [48, 32], input: 'mouse', tolerance: 4 });
  }
  expect(errors).toEqual([]);
});
