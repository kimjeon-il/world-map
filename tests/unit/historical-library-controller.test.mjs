import assert from 'node:assert/strict';
import test from 'node:test';

import { createHistoricalLibraryController } from '../../assets/js/modules/historical-library-controller.js';

function fakeElement(ownerDocument) {
  const classes = new Set(['hidden']);
  const listeners = new Map();
  const attributes = new Map();
  return {
    ownerDocument,
    children: [],
    attributes,
    dataset: {},
    value: '',
    disabled: false,
    textContent: '',
    classList: {
      add: (...names) => names.forEach(name => classes.add(name)),
      remove: (...names) => names.forEach(name => classes.delete(name)),
      contains: name => classes.has(name),
    },
    addEventListener: (name, listener) => listeners.set(name, listener),
    dispatchEvent: event => listeners.get(event.type)?.(event),
    replaceChildren(...children) { this.children = children; },
    append(...children) { this.children.push(...children); },
    appendChild(child) { this.children.push(child); return child; },
    querySelector() { return null; },
    setAttribute(name, value) { attributes.set(name, String(value)); },
    removeAttribute(name) { attributes.delete(name); },
    getAttribute(name) { return attributes.get(name) ?? null; },
    focus() { this.focused = true; },
    click() { return listeners.get('click')?.({ target: this }); },
  };
}

test('historical library controller owns modal loading and close focus', async () => {
  const document = {
    defaultView: { Event: class { constructor(type) { this.type = type; } } },
    createElement() { return fakeElement(document); },
    createDocumentFragment() { return fakeElement(document); },
  };
  const names = [
    'open', 'modal', 'card', 'close', 'backdrop', 'search', 'clearSearch', 'type', 'status', 'year', 'geographicRegion',
    'results', 'preview', 'snapshot', 'snapshotButton', 'childDepth', 'add', 'addOptions', 'optionsBack',
  ];
  const elements = Object.fromEntries(names.map(name => [name, fakeElement(document)]));
  let loads = 0;
  let resolveLoad;
  let loadError = null;
  let reportedErrors = 0;
  const loadGate = new Promise(resolve => { resolveLoad = resolve; });
  const controller = createHistoricalLibraryController({
    document,
    elements,
    service: {
      load: async () => { loads += 1; await loadGate; if (loadError) throw loadError; },
      list: () => [],
      snapshots: () => [],
      search: () => [],
      get: () => null,
      getSnapshot: () => null,
    },
    typeLabels: {},
    selectGeometryVersion: () => null,
    renderMapPreview: () => fakeElement(document),
    createEmptyState: () => fakeElement(document),
    replaceSelectOptions() {},
    collator: new Intl.Collator('ko'),
    isMobile: () => false,
    closeCreateMenu() {},
    instantiate: () => 0,
    confirm() {},
    setStatus() {},
    reportError() { reportedErrors += 1; },
    requestFrame: callback => callback(),
  });
  controller.connect();
  const opening = controller.open();
  assert.equal(loads, 1);
  assert.equal(controller.isOpen(), true);
  assert.equal(elements.results.getAttribute('aria-busy'), 'true');
  assert.equal(elements.search.disabled, true);
  assert.equal(elements.type.disabled, true);
  assert.equal(elements.results.children[0].children.length, 6);
  resolveLoad();
  await opening;
  assert.equal(elements.results.getAttribute('aria-busy'), 'false');
  assert.equal(elements.search.disabled, false);
  assert.equal(elements.type.disabled, false);
  assert.equal(elements.search.focused, true);
  controller.close();
  assert.equal(controller.isOpen(), false);
  assert.equal(elements.open.focused, true);

  loadError = new Error('offline');
  await controller.open();
  assert.equal(elements.results.getAttribute('aria-busy'), 'false');
  assert.equal(elements.search.disabled, true);
  assert.equal(reportedErrors, 1);
});

test('historical library controller locks controls while async instantiation runs and keeps modal open on failure', async () => {
  const document = {
    defaultView: { Event: class { constructor(type) { this.type = type; } } },
    createElement() { return fakeElement(document); },
    createDocumentFragment() { return fakeElement(document); },
  };
  const names = [
    'open', 'modal', 'card', 'close', 'backdrop', 'search', 'clearSearch', 'type', 'status', 'year', 'geographicRegion',
    'results', 'preview', 'snapshot', 'snapshotButton', 'childDepth', 'add', 'addOptions', 'optionsBack',
  ];
  const elements = Object.fromEntries(names.map(name => [name, fakeElement(document)]));
  const entity = {
    libraryId: 'historical-country:test', type: 'country', canonicalName: 'Test', displayNames: { ko: '테스트' },
    alternateNames: [], metadata: { pilot: true, approximateGeometry: true, referenceDate: '1989-04-25' },
    sourceInfo: { title: 'Source' },
  };
  const version = { id: 'test-v1', certainty: 'medium', datePrecision: 'reference-date', geometry: { type: 'Polygon', coordinates: [] } };
  let rejectInstantiation;
  const gate = new Promise((resolve, reject) => { rejectInstantiation = reject; });
  let reportedErrors = 0;
  const controller = createHistoricalLibraryController({
    document,
    elements,
    service: {
      load: async () => {}, list: () => [entity], snapshots: () => [], search: () => [entity],
      get: id => (id === entity.libraryId ? entity : null), getSnapshot: () => null,
    },
    typeLabels: { country: '국가' },
    selectGeometryVersion: () => version,
    renderMapPreview: () => fakeElement(document),
    createEmptyState: () => fakeElement(document),
    replaceSelectOptions() {},
    collator: new Intl.Collator('ko'),
    isMobile: () => false,
    closeCreateMenu() {},
    instantiate: () => gate,
    confirm() {},
    setStatus() {},
    reportError() { reportedErrors += 1; },
    requestFrame: callback => callback(),
  });
  controller.connect();
  await controller.open();
  controller.select(entity.libraryId);
  elements.add.click();
  elements.add.click();
  assert.equal(elements.search.disabled, true);
  assert.equal(elements.results.getAttribute('aria-busy'), 'true');
  rejectInstantiation(new Error('merge failed'));
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(elements.modal.classList.contains('hidden'), false);
  assert.equal(elements.search.disabled, false);
  assert.equal(reportedErrors, 1);
});
