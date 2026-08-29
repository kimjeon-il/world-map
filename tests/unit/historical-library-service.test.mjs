import assert from 'node:assert/strict';
import test from 'node:test';

import { createHistoricalLibraryService } from '../../assets/js/modules/historical-library-service.js';

const square = offset => ({
  type: 'Polygon',
  coordinates: [[[offset, 0], [offset + 1, 0], [offset + 1, 1], [offset, 1], [offset, 0]]],
});

function fixture() {
  return {
    schemaVersion: 1,
    entities: [
      {
        libraryId: 'historical-country:parent',
        type: 'country',
        canonicalName: 'Parent',
        geometryVersions: [{ id: 'parent:1', memberCountryIds: ['AAA'] }],
      },
      {
        libraryId: 'historical-region:child',
        type: 'region',
        canonicalName: 'Child',
        parentLibraryId: 'historical-country:parent',
        geometryVersions: [{ id: 'child:1', memberCountryIds: ['AAA'] }],
      },
    ],
    snapshots: [],
  };
}

function countries() {
  return {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      id: 'AAA',
      properties: { editor_id: 'AAA', editor_name: 'Current A' },
      geometry: square(0),
    }],
  };
}

test('historical library service shares concurrent loads and exposes current and pilot data', async () => {
  let loads = 0;
  let resolveLoad;
  const service = createHistoricalLibraryService({
    dataUrl: '/library.json',
    fetchJson: () => new Promise(resolve => { loads += 1; resolveLoad = resolve; }),
    getCountriesData: countries,
    displayName: feature => feature.properties.editor_name,
    combineGeometries: geometries => geometries[0],
    currentYear: () => 2026,
  });
  const first = service.load();
  const second = service.load();
  resolveLoad(fixture());
  assert.equal(await first, await second);
  assert.equal(loads, 1);
  assert.equal(service.get('current-country:AAA').canonicalName, 'Current A');
  assert.equal(service.getSnapshot('current-world').referenceDate, '2026');
});

test('historical library service expands descendants and materializes descriptors', async () => {
  const service = createHistoricalLibraryService({
    dataUrl: '/library.json',
    fetchJson: async () => fixture(),
    getCountriesData: countries,
    displayName: feature => feature.properties.editor_name,
    combineGeometries: geometries => geometries[0],
  });
  await service.load();
  assert.deepEqual(service.entityRefsWithChildren(['historical-country:parent'], 'level1'), [
    'historical-country:parent',
    'historical-region:child',
  ]);
  const descriptors = service.instantiateDescriptors(['historical-country:parent'], '', 'all');
  assert.equal(descriptors.length, 2);
  assert.equal(descriptors[1].parentLibraryId, 'historical-country:parent');
});

test('historical library service allows retry after a failed load', async () => {
  let attempts = 0;
  const service = createHistoricalLibraryService({
    dataUrl: '/library.json',
    fetchJson: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('offline');
      return fixture();
    },
    getCountriesData: countries,
    displayName: feature => feature.properties.editor_name,
    combineGeometries: geometries => geometries[0],
  });
  await assert.rejects(service.load(), /offline/);
  await service.load();
  assert.equal(attempts, 2);
});
