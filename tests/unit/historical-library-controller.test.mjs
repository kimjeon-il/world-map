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
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null;
    },
    querySelectorAll(selector) {
      return this.children.filter(child => {
        if (!child?.attributes) return false;
        if (selector.includes('[role="option"]') && child.attributes.get('role') !== 'option') return false;
        if (selector.includes('[data-library-entity-id]') && !child.dataset?.libraryEntityId) return false;
        if (selector.includes('[aria-selected="true"]') && child.attributes.get('aria-selected') !== 'true') return false;
        if (selector.includes('[role="option"]') || selector.includes('[data-library-entity-id]') || selector.includes('[aria-selected="true"]')) return true;
        return false;
      });
    },
    setAttribute(name, value) { attributes.set(name, String(value)); },
    removeAttribute(name) { attributes.delete(name); },
    getAttribute(name) { return attributes.get(name) ?? null; },
    focus() { this.focused = true; },
    click() { return listeners.get('click')?.({ target: this }); },
  };
}

test('library simplifies single versions, preserves explicit versions and resets child scope on selection', async () => {
  const document = {
    createElement() { return fakeElement(document); },
    createDocumentFragment() { return fakeElement(document); },
  };
  const names = ['open', 'modal', 'card', 'close', 'backdrop', 'search', 'clearSearch', 'type', 'status', 'year', 'geographicRegion',
    'results', 'preview', 'snapshot', 'snapshotButton', 'childDepth', 'add', 'addOptions', 'optionsBack'];
  const elements = Object.fromEntries(names.map(name => [name, fakeElement(document)]));
  elements.status.value = 'all';
  const versions = [{ id: 'old', validFrom: '1900', validTo: '1940' }, { id: 'new', validFrom: '1941', validTo: '1990' }];
  const parent = { libraryId: 'parent', canonicalName: 'Parent', geometryVersions: versions };
  parent.sourceInfo = { title: 'Source title', url: 'https://example.org/source', license: 'Public domain' };
  parent.metadata = { approximateGeometry: true };
  const originalSource = JSON.stringify(parent.sourceInfo);
  const child = { libraryId: 'child', parentLibraryId: 'parent', canonicalName: 'Child', geometryVersions: [versions[0]] };
  const entities = [parent, child], imports = [];
  const controller = createHistoricalLibraryController({
    document, elements,
    service: { load: async () => {}, list: () => entities, snapshots: () => [], search: () => entities, get: id => entities.find(entity => entity.libraryId === id) },
    typeLabels: {}, selectGeometryVersion: entity => entity.geometryVersions[0],
    renderMapPreview: () => fakeElement(document), createEmptyState: () => fakeElement(document),
    replaceSelectOptions() {}, collator: new Intl.Collator('ko'), isMobile: () => false,
    closeCreateMenu() {}, instantiate: async (...args) => { imports.push(args); return { added: 1 }; },
    confirm() {}, setStatus() {}, reportError(error) { throw error; }, requestFrame: fn => fn(),
  });
  controller.connect();
  await controller.open();
  controller.select('parent');
  const previewText = node => [node.textContent, ...(node.children || []).map(previewText)].join(' ');
  assert.match(previewText(elements.preview), /근사 경계/);
  assert.doesNotMatch(previewText(elements.preview), /출처|이용 조건|Source title|Public domain/);
  assert.equal(JSON.stringify(parent.sourceInfo), originalSource);
  assert.equal(elements.addOptions.classList.contains('hidden'), false);
  assert.equal(elements.addOptions.open, undefined, 'scope is not a disclosure');
  elements.childDepth.value = 'all';
  const versionSelect = elements.preview.children[1].children[1];
  versionSelect.value = 'new';
  versionSelect.dispatchEvent({ type: 'change' });
  elements.add.click();
  await Promise.resolve();
  assert.deepEqual(imports[0], [['parent'], '', 'all', { parent: 'new' }]);
  await controller.open();
  controller.select('child');
  assert.equal(elements.addOptions.classList.contains('hidden'), true);
  assert.equal(elements.childDepth.value, 'none');
  assert.equal(elements.preview.children[1].children.length, 0);
  assert.match(elements.preview.children[1].textContent, /1900.*1940/);
  assert.equal(elements.preview.children[0].children.length, 1, 'no empty flag block');
  elements.type.value = 'country';
  elements.type.dispatchEvent({ type: 'change' });
  assert.equal(elements.results.children[0].children.length, 2, 'changing a visible filter rerenders results');
});

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

test('historical library hides the pilot badge while retaining pilot metadata', async () => {
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
    libraryId: 'historical-country:test-badge', type: 'country', canonicalName: 'Test', displayNames: { ko: '테스트' },
    alternateNames: [], metadata: { pilot: true, approximateGeometry: true, referenceDate: '1989-04-25' },
    sourceInfo: { title: 'Source' },
  };
  const version = { id: 'test-badge-v1', certainty: 'medium', datePrecision: 'reference-date', geometry: { type: 'Polygon', coordinates: [] } };
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
    instantiate: async () => ({ added: 0 }),
    confirm() {},
    setStatus() {},
    reportError() {},
    requestFrame: callback => callback(),
  });
  controller.connect();
  await controller.open();
  controller.select(entity.libraryId);
  const resultText = elements.results.children[0].children[0].children[1].textContent;
  const previewText = elements.preview.children.map(child => child.textContent || '').join(' · ');
  assert.equal(entity.metadata.pilot, true);
  assert.doesNotMatch(resultText, /시험 데이터/);
  assert.doesNotMatch(previewText, /시험 데이터/);
  assert.match(previewText, /근사 경계/);
});
