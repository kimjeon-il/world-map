import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DRAWING_SCHEMA_VERSION,
  createDrawingService,
  drawingGeometryKind,
  normalizeDrawingCollection,
} from '../../assets/js/modules/drawing-service.js';

const drawing = (id, geometry = { type: 'Point', coordinates: [1, 2] }) => ({
  type: 'Feature', id, geometry, properties: { name: id, category: 'legacy', visible: false },
});

test('drawing normalization keeps canonical custom semantics and rejects duplicate IDs', () => {
  const normalized = normalizeDrawingCollection([drawing('one')]);
  assert.equal(normalized[0].properties.category, 'custom');
  assert.equal(normalized[0].properties.pandolab_schema_version, DRAWING_SCHEMA_VERSION);
  assert.equal('visible' in normalized[0].properties, false);
  assert.equal(drawingGeometryKind(normalized[0]), 'point');
  assert.throws(() => normalizeDrawingCollection([drawing('one'), drawing('one')]), /중복/);
});

test('drawing service owns create, metadata, and delete transactions', () => {
  let drawings = [];
  const transactions = [];
  const service = createDrawingService({
    documentStore: {
      readDrawings: () => drawings,
      replaceDrawings: value => { drawings = value; },
    },
    runDocumentMutation(meta, mutate) { transactions.push(meta); return mutate(); },
    writeColor(feature, value) { feature.properties.editorColor = value; },
  });
  service.add(drawing('one'));
  service.updateMetadata('one', 'editorColor', '#abcdef');
  assert.equal(service.get('one').properties.editorColor, '#abcdef');
  let removed = '';
  service.remove('one', { beforeRemove: feature => { removed = feature.id; } });
  assert.equal(removed, 'one');
  assert.equal(service.list().length, 0);
  assert.deepEqual(transactions.map(meta => meta.type), ['drawing-create', 'drawing-metadata', 'drawing-delete']);
});
