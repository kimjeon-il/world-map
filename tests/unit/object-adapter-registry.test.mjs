import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createDomainObjectAdapter,
  createObjectAdapterRegistry,
  geometryBounds,
} from '../../assets/js/modules/object-adapter-registry.js';
import { createObjectCommandDefinitions } from '../../assets/js/modules/object-command-definitions.js';
import { createProjectCommandPipeline } from '../../assets/js/modules/project-command-pipeline.js';

function fixture() {
  const state = {
    generic: new Map([
      ['a', { id: 'a', properties: { name: 'Alpha', locked: false }, geometry: { type: 'Point', coordinates: [3, 4] } }],
      ['b', { id: 'b', properties: { name: 'Beta', locked: false }, geometry: { type: 'LineString', coordinates: [[1, 2], [5, 7]] } }],
    ]),
    visible: new Map([['a', true], ['b', true]]),
    focused: '',
  };
  const adapter = createDomainObjectAdapter({
    domain: 'generic',
    get: id => state.generic.get(String(id)) || null,
    list: () => [...state.generic.values()],
    isLocked: object => object.properties.locked === true,
    setLocked: (id, locked) => { state.generic.get(String(id)).properties.locked = locked; return { ok: true }; },
    isVisible: (_object, ref) => state.visible.get(ref.id) !== false,
    setVisibility: (id, visible) => { state.visible.set(String(id), visible); return { ok: true }; },
    focus: id => { state.focused = String(id); return { ok: true }; },
    remove: id => ({ ok: state.generic.delete(String(id)) }),
  });
  const adapters = createObjectAdapterRegistry({ adapters: [adapter] });
  return { state, adapters };
}

test('object adapter registry exposes one interface across domain storage', () => {
  const { adapters } = fixture();
  const ref = { domain: 'generic', type: 'feature', id: 'b' };
  assert.equal(adapters.name(ref), 'Beta');
  assert.deepEqual(adapters.bounds(ref), [1, 2, 5, 7]);
  assert.equal(adapters.isLocked(ref), false);
  assert.equal(adapters.isVisible(ref), true);
  assert.equal(adapters.list({ domain: 'generic' }).length, 2);
  assert.equal(adapters.canRemove(ref), true);
});

test('geometry bounds works for nested GeoJSON coordinates', () => {
  assert.deepEqual(geometryBounds({
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [[[0, 1], [3, 5], [-2, 4], [0, 1]]] },
  }), [-2, 1, 3, 5]);
});

test('canonical object commands route through adapters and the command pipeline', () => {
  const { state, adapters } = fixture();
  const calls = [];
  let revision = 0;
  let snapshot = null;
  const commands = createObjectCommandDefinitions({ adapters });
  const pipeline = createProjectCommandPipeline({
    commands,
    captureSnapshot: () => {
      snapshot = {
        generic: structuredClone([...state.generic.entries()]),
        visible: structuredClone([...state.visible.entries()]),
      };
      return snapshot;
    },
    restoreSnapshot: value => {
      state.generic = new Map(value.generic);
      state.visible = new Map(value.visible);
    },
    recordHistory: meta => calls.push(`history:${meta.type}`),
    discardHistory: () => calls.push('discard'),
    advanceRevision: () => ++revision,
    invalidateRender: dirty => calls.push(`render:${dirty}`),
    queueAutosave: () => calls.push('autosave'),
  });

  const refs = [
    { domain: 'generic', type: 'feature', id: 'a' },
    { domain: 'generic', type: 'feature', id: 'b' },
  ];
  const lockResult = pipeline.execute('object.lock.toggle', { targets: refs });
  assert.equal(lockResult.ok, true);
  assert.equal(adapters.isLocked(refs[0]), true);
  assert.equal(adapters.isLocked(refs[1]), true);
  assert.equal(revision, 1);
  assert.deepEqual(calls, ['history:batch-lock', 'render:object-state', 'autosave']);

  calls.length = 0;
  const focusResult = pipeline.execute('object.focus', { target: refs[0] });
  assert.equal(focusResult.ok, true);
  assert.equal(state.focused, 'a');
  assert.equal(revision, 1);
  assert.deepEqual(calls, []);
});

test('delete command rejects locked objects before history or mutation', () => {
  const { adapters } = fixture();
  const ref = { domain: 'generic', type: 'feature', id: 'a' };
  adapters.setLocked(ref, true);
  const calls = [];
  const pipeline = createProjectCommandPipeline({
    commands: createObjectCommandDefinitions({ adapters }),
    recordHistory: () => calls.push('history'),
    discardHistory: () => calls.push('discard'),
  });
  const result = pipeline.execute('object.delete', { target: ref });
  assert.equal(result.ok, false);
  assert.ok(adapters.get(ref));
  assert.deepEqual(calls, []);
});
