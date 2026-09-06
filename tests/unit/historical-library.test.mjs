import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
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
  const library = createHistoricalLibrary({ schemaVersion: 2, entities: [
    { libraryId: 'past', type: 'country', canonicalName: 'Czechoslovakia', displayNames: { ko: '체코슬로바키아' }, alternateNames: ['Československo'], startDate: '1918', endDate: '1992', metadata: { geographicRegion: 'Europe' }, geometryVersions: [{ id: 'past-v', geometry: square() }] },
    { libraryId: 'current', type: 'region', canonicalName: 'Current region', endDate: null, metadata: { geographicRegion: 'Asia' }, geometryVersions: [{ id: 'current-v', geometry: square() }] },
  ] });
  assert.equal(library.search({ query: 'česko' }).map(item => item.libraryId).join(), 'past');
  assert.equal(library.search({ query: '체코' }).map(item => item.libraryId).join(), 'past');
  assert.equal(library.search({ status: 'past', referenceDate: '1950', type: 'country' }).length, 1);
  assert.equal(library.search({ status: 'current' }).length, 1);
  assert.equal(library.search({ referenceDate: '2000', type: 'country' }).length, 0);
  assert.equal(library.search({ geographicRegion: 'Europe' }).map(item => item.libraryId).join(), 'past');
});

test('current countries are exposed through a library adapter without mutating source geometry', () => {
  const countries = { type: 'FeatureCollection', features: [{ type: 'Feature', id: 'PL', properties: { name: '폴란드' }, geometry: square() }] };
  const before = JSON.stringify(countries);
  const entities = createCurrentCountryLibraryEntities(countries);
  assert.equal(entities[0].libraryId, 'current-country:PL');
  assert.equal(entities[0].geometryVersions[0].id, 'current-country:PL:natural-earth-5.1.1');
  assert.equal(JSON.stringify(countries), before);
});

test('pilot geometry is materialized from member countries and instances retain source tracking', () => {
  const countries = { type: 'FeatureCollection', features: [
    { type: 'Feature', id: 'A', properties: { name: 'A' }, geometry: square() },
    { type: 'Feature', id: 'B', properties: { name: 'B' }, geometry: square(1, 2) },
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
  assert.deepEqual(instance.instantiation, { mode: 'independent', countryUpdates: {} });
});

test('pilot geometry accepts immutable inline polygons and territory-replacement metadata', () => {
  const inline = square(10, 11);
  const [entity] = materializePilotEntities([{
    libraryId: 'historical-country:inline', type: 'country', canonicalName: 'Inline',
    alternateNames: ['Alias'],
    instantiation: { mode: 'territory-replacement', countryUpdates: { DEU: { name: 'Federal Republic' } } },
    geometryVersions: [{ id: 'inline-v1', geometry: inline, certainty: 'medium' }],
  }], { type: 'FeatureCollection', features: [] }, () => null);
  inline.coordinates[0][0][0] = 999;
  assert.equal(entity.geometryVersions[0].geometry.coordinates[0][0][0], 10);
  assert.deepEqual(entity.instantiation, {
    mode: 'territory-replacement',
    countryUpdates: { DEU: { name: 'Federal Republic' } },
  });
  const instance = instantiateLibraryEntity(entity);
  instance.geometry.coordinates[0][0][0] = 888;
  assert.equal(entity.geometryVersions[0].geometry.coordinates[0][0][0], 10);
});

test('pilot geometry can add and subtract explicit adjustment masks from canonical members', () => {
  const calls = [];
  const [entity] = materializePilotEntities([{
    libraryId: 'historical-subunit:adjusted', type: 'subunit', canonicalName: 'Adjusted',
    parentLibraryId: 'historical-country:parent', sovereignLibraryId: 'historical-country:parent', adminLevel: 1,
    geometryVersions: [{
      id: 'adjusted-v1', memberCountryIds: ['BASE'], includeGeometry: square(2, 3), excludeGeometry: square(0, 1),
    }],
  }], {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', id: 'BASE', properties: { name: 'Base' }, geometry: square(0, 2) }],
  }, geometries => {
    calls.push(['union', geometries.length]);
    return square(0, 3);
  }, (geometry, excluded) => {
    calls.push(['difference', geometry.coordinates[0][0][0], excluded.coordinates[0][0][0]]);
    return square(1, 3);
  });
  assert.deepEqual(calls, [['union', 2], ['difference', 0, 0]]);
  assert.deepEqual(entity.geometryVersions[0].geometry, square(1, 3));
});

test('legacy territory-priority metadata normalizes to the unified replacement mode', () => {
  const entity = normalizeHistoricalLibraryEntity({
    libraryId: 'historical-country:legacy', type: 'country', canonicalName: 'Legacy',
    instantiation: { mode: 'country-territory-priority' },
    geometryVersions: [{ id: 'legacy-v1', geometry: square() }],
  });
  assert.equal(entity.instantiation.mode, 'territory-replacement');
});

const historicalData = JSON.parse(readFileSync(new URL('../../assets/data/historical-library-pilot.json', import.meta.url), 'utf8'));

test('historical library preserves embedded polygon geometry without a modern-country materialization source', () => {
  const embedded = { type: 'MultiPolygon', coordinates: [square().coordinates] };
  const [entity] = materializePilotEntities([{
    libraryId: 'historical-country:embedded', type: 'country', canonicalName: 'Embedded',
    geometryVersions: [{ id: 'embedded-r1', geometry: embedded, certainty: 'high' }],
  }], { type: 'FeatureCollection', features: [] }, () => null);
  assert.equal(entity.geometryVersions[0].geometry.type, 'MultiPolygon');
  assert.deepEqual(entity.geometryVersions[0].geometry, embedded);
  assert.notEqual(entity.geometryVersions[0].geometry, embedded);
});

test('East Prussia r2 library geometry and production metadata remain exact', () => {
  const entity = historicalData.entities.find(item => item.libraryId === 'historical-country:east-prussia');
  const version = entity.geometryVersions[0];
  const coordinates = version.geometry.coordinates.flat(2);
  const coordinateKeys = new Set(coordinates.map(coordinate => coordinate.join(',')));
  const geometrySha256 = createHash('sha256').update(JSON.stringify(version.geometry)).digest('hex');
  assert.equal(geometrySha256, 'ee2f1f2d2ca285adeddd787f1243fc34ac49945ea4bb100b1a74651f84e8ef3e');
  assert.equal(version.geometry.coordinates.length, 2);
  assert.equal(coordinates.length, 862);
  assert.ok(coordinateKeys.has('19.789943299809654,54.43327152291397'));
  assert.ok(coordinateKeys.has('22.788853193618436,54.36826840398982'));
  assert.ok(!coordinateKeys.has('21.119884,55.493415'));
  assert.ok(!coordinateKeys.has('21.119884,55.506196'));
  assert.equal(entity.metadata.artifactSha256, '93786f2dbcdfd31539890cba070ed09a47d5818a08c49b4638ce7c5db03d0f65');
});

test('world snapshots remain templates with independent reference lists', () => {
  const refs = ['one'];
  const library = createHistoricalLibrary({ schemaVersion: 2, snapshots: [{ id: 'snapshot', name: 'Snapshot', referenceDate: '1914', entityRefs: refs }] });
  refs.push('two');
  assert.deepEqual(library.getSnapshot('snapshot').entityRefs, ['one']);
});
