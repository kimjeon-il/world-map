import assert from 'node:assert/strict';
import test from 'node:test';

import { createHistoricalLibraryController } from '../../assets/js/modules/historical-library-controller.js';

function fakeElement(ownerDocument) {
  const classes = new Set(['hidden']);
  const listeners = new Map();
  return {
    ownerDocument,
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
    replaceChildren() {},
    append() {},
    appendChild() {},
    querySelector() { return null; },
    setAttribute() {},
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
    'open', 'modal', 'card', 'close', 'backdrop', 'search', 'clearSearch', 'type', 'status', 'year', 'region',
    'results', 'preview', 'snapshot', 'snapshotButton', 'childDepth', 'add', 'addOptions', 'optionsBack',
  ];
  const elements = Object.fromEntries(names.map(name => [name, fakeElement(document)]));
  let loads = 0;
  const controller = createHistoricalLibraryController({
    document,
    elements,
    service: {
      load: async () => { loads += 1; },
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
    reportError() {},
    requestFrame: callback => callback(),
  });
  controller.connect();
  await controller.open();
  assert.equal(loads, 1);
  assert.equal(controller.isOpen(), true);
  assert.equal(elements.search.focused, true);
  controller.close();
  assert.equal(controller.isOpen(), false);
  assert.equal(elements.open.focused, true);
});
