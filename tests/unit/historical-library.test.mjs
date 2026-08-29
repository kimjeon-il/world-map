import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createCurrentCountryLibraryEntities,
  createHistoricalLibrary,
  instantiateLibraryEntity,
  materializePilotEntities,
  normalizeHistoricalLibraryEntity,
  selectGeometryVersion,
} from '../../assets/js/modules/historical-library.js';

const square = (left = 0, right = 1) => ({
  type: 'Polygon',
  coordinates: [[[left, 0], [left, 1], [right, 1], [right, 0], [left, 0]]],
});

test('historical entities use stable IDs and select the geometry version for a reference year', () => {
  const entity = normalizeHistoricalLibraryEntity({
    libraryId: 'historical-country:test', type: 'country', canonicalName: 'Test',
    geometryVersions: [
      { id: 'v1900', validFrom: '1900', validTo: '1949', geometry: square(), certainty: 'medium' },
      { id: 'v1950', validFrom: '1950', validTo: '1999', geometry: square(2, 3), certainty: 'high' },
    ],
  });
  assert.equal(selectGeometryVersion(entity, '1910').id, 'v1900');
  assert.equal(selectGeometryVersion(entity, '1980').id, 'v1950');
});

test('library search covers multilingual names aliases dates types and current/past status', () => {
  const library = createHistoricalLibrary({ schemaVersion: 1, entities: [
    { libraryId: 'past', type: 'country', canonicalName: 'Czechoslovakia', displayNames: { ko: '체코슬로바키아' }, alternateNames: ['Československo'], startDate: '1918', endDate: '1992', geometryVersions: [{ id: 'past-v', geometry: square() }] },
    { libraryId: 'current', type: 'region', canonicalName: 'Current region', endDate: null, geometryVersions: [{ id: 'current-v', geometry: square() }] },
  ] });
  assert.equal(library.search({ query: 'česko' }).map(item => item.libraryId).join(), 'past');
  assert.equal(library.search({ query: '체코' }).map(item => item.libraryId).join(), 'past');
  assert.equal(library.search({ status: 'past', referenceDate: '1950', type: 'country' }).length, 1);
  assert.equal(library.search({ status: 'current' }).length, 1);
  assert.equal(library.search({ referenceDate: '2000', type: 'country' }).length, 0);
});

test('current countries are exposed through a library adapter without mutating source geometry', () => {
  const countries = { type: 'FeatureCollection', features: [{ type: 'Feature', id: 'PL', properties: { editor_id: 'PL', editor_name: '폴란드', NAME: 'Poland' }, geometry: square() }] };
  const before = JSON.stringify(countries);
  const entities = createCurrentCountryLibraryEntities(countries);
  assert.equal(entities[0].libraryId, 'current-country:PL');
  assert.equal(entities[0].geometryVersions[0].id, 'current-country:PL:natural-earth-5.1.1');
  assert.equal(JSON.stringify(countries), before);
});

test('pilot geometry is materialized from member countries and instances retain source tracking', () => {
  const countries = { type: 'FeatureCollection', features: [
    { type: 'Feature', id: 'A', properties: { editor_id: 'A' }, geometry: square() },
    { type: 'Feature', id: 'B', properties: { editor_id: 'B' }, geometry: square(1, 2) },
  ] };
  const [entity] = materializePilotEntities([{
    libraryId: 'historical-country:ab', type: 'country', canonicalName: 'AB', startDate: '1900', endDate: '1950',
    geometryVersions: [{ id: 'ab-v1', memberCountryIds: ['A', 'B'], certainty: 'low' }],
  }], countries, geometries => ({ type: 'MultiPolygon', coordinates: geometries.map(geometry => geometry.coordinates) }));
  const instance = instantiateLibraryEntity(entity, '1920');
  assert.equal(instance.libraryId, 'historical-country:ab');
  assert.equal(instance.geometryVersionId, 'ab-v1');
  assert.equal(instance.type, 'country');
  assert.notEqual(instance.geometry, entity.geometryVersions[0].geometry);
});

test('world snapshots remain templates with independent reference lists', () => {
  const refs = ['one'];
  const library = createHistoricalLibrary({ schemaVersion: 1, snapshots: [{ id: 'snapshot', name: 'Snapshot', referenceDate: '1914', entityRefs: refs }] });
  refs.push('two');
  assert.deepEqual(library.getSnapshot('snapshot').entityRefs, ['one']);
});
