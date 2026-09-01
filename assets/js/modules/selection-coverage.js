export function createSelectionCoverageChannel(nextItems = [], renderedKeys = [], missingKeys = [], segmentCount = 0) {
  const requestedKeys = [...new Set(nextItems.map(item => String(item?.key || '')).filter(Boolean))];
  const rendered = [...new Set(renderedKeys.map(String))];
  const renderedSet = new Set(rendered);
  const missing = [...new Set([
    ...missingKeys.map(String),
    ...requestedKeys.filter(key => !renderedSet.has(key)),
  ])];
  return Object.freeze({
    renderedKeys: Object.freeze(rendered),
    missingKeys: Object.freeze(missing),
    segmentCount: Math.max(0, Number(segmentCount) || 0),
  });
}

export function createEmptySelectionCoverage(items = { hover: [], primary: [], secondary: [] }) {
  return Object.freeze({
    hover: createSelectionCoverageChannel(items.hover),
    primary: createSelectionCoverageChannel(items.primary),
    secondary: createSelectionCoverageChannel(items.secondary),
  });
}

export function finalizeSelectionDrawCoverage({ items, buildCoverage, channelMetrics, channelSucceeded, gpuHealth, selfTestPassed }) {
  const channels = {};
  for (const name of ['hover', 'primary', 'secondary']) {
    const requested = items[name] || [];
    const requestedKeys = [...new Set(requested.map(item => String(item?.key || '')).filter(Boolean))];
    const coverage = buildCoverage[name] || createSelectionCoverageChannel(requested);
    const buildSucceeded = !channelMetrics[name]?.buildFailed;
    const drawSucceeded = gpuHealth === 'healthy' && selfTestPassed && buildSucceeded && channelSucceeded[name] !== false;
    const renderedKeys = drawSucceeded ? [...coverage.renderedKeys] : [];
    const renderedSet = new Set(renderedKeys);
    const missingKeys = [...new Set([
      ...coverage.missingKeys,
      ...requestedKeys.filter(key => !renderedSet.has(key)),
    ])];
    channels[name] = Object.freeze({ buildSucceeded, drawSucceeded, renderedKeys, missingKeys });
  }
  return Object.freeze(channels);
}
