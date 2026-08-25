import test from 'node:test';
import assert from 'node:assert/strict';

import {
  COUNTRY_REGION_STATUS,
  createCountryRegionFeature,
  normalizeCountryRegions,
  runCountryRegionTransaction,
  validateCountryRegionRelations,
} from '../../assets/js/modules/country-regions.js';

const square = (x0 = 0, y0 = 0, x1 = 10, y1 = 10) => ({
  type: 'Polygon',
  coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]],
});

test('country regions normalize missing arrays and canonical optional fields', () => {
  assert.deepEqual(normalizeCountryRegions(undefined), []);
  const [region] = normalizeCountryRegions([createCountryRegionFeature({
    id: 'r1', kind: 'region', countryId: 'PL', name: '지역', geometry: square(),
  })], { countryExists: id => id === 'PL' });
  assert.equal(region.properties.kind, 'region');
  assert.equal(region.properties.parentRegionId, '');
  assert.equal(region.properties.level, null);
  assert.equal(region.properties.status, COUNTRY_REGION_STATUS.ASSIGNED);
});

test('administrative levels follow parent depth and invalid parents recover to country level', () => {
  const regions = normalizeCountryRegions([
    createCountryRegionFeature({ id: 'r1', kind: 'region', countryId: 'PL', geometry: square() }),
    createCountryRegionFeature({ id: 'a1', kind: 'administrative', countryId: 'PL', parentRegionId: 'r1', level: 8, geometry: square(0, 0, 5, 5) }),
    createCountryRegionFeature({ id: 'a2', kind: 'administrative', countryId: 'PL', parentRegionId: 'a1', level: 8, geometry: square(0, 0, 2, 2) }),
    createCountryRegionFeature({ id: 'a3', kind: 'administrative', countryId: 'PL', parentRegionId: 'missing', level: 8, geometry: square(2, 2, 3, 3) }),
  ], { countryExists: id => id === 'PL' });
  assert.equal(regions.find(item => item.id === 'a1').properties.level, 2);
  assert.equal(regions.find(item => item.id === 'a2').properties.level, 3);
  assert.equal(regions.find(item => item.id === 'a3').properties.level, 1);
  assert.equal(regions.find(item => item.id === 'a3').properties.parentRegionId, '');
  assert.equal(validateCountryRegionRelations(regions, { countryExists: id => id === 'PL' }).ok, true);
});

test('administrative levels do not depend on feature order', () => {
  const regions = normalizeCountryRegions([
    createCountryRegionFeature({ id: 'a2', kind: 'administrative', countryId: 'PL', parentRegionId: 'a1', level: 9, geometry: square(0, 0, 2, 2) }),
    createCountryRegionFeature({ id: 'a1', kind: 'administrative', countryId: 'PL', parentRegionId: 'r1', level: 9, geometry: square(0, 0, 5, 5) }),
    createCountryRegionFeature({ id: 'r1', kind: 'region', countryId: 'PL', geometry: square() }),
  ], { countryExists: id => id === 'PL' });
  assert.equal(regions.find(item => item.id === 'a1').properties.level, 2);
  assert.equal(regions.find(item => item.id === 'a2').properties.level, 3);
});

test('deleted owners become unassigned and circular parents are removed', () => {
  const regions = normalizeCountryRegions([
    createCountryRegionFeature({ id: 'a1', kind: 'administrative', countryId: 'gone', parentRegionId: 'a2', geometry: square() }),
    createCountryRegionFeature({ id: 'a2', kind: 'administrative', countryId: 'gone', parentRegionId: 'a1', geometry: square() }),
  ], { countryExists: () => false });
  for (const region of regions) {
    assert.equal(region.properties.countryId, '');
    assert.equal(region.properties.status, COUNTRY_REGION_STATUS.UNASSIGNED);
    assert.equal(region.properties.parentRegionId, '');
  }
});

test('country region transaction records and autosaves once on success', async () => {
  const calls = [];
  const result = await runCountryRegionTransaction({
    snapshot: () => ({ value: 1 }),
    calculate: async () => ({ value: 2 }),
    validate: () => ({ ok: true }),
    apply: value => calls.push(['apply', value.value]),
    restore: () => calls.push(['restore']),
    recordHistory: value => calls.push(['history', value.value]),
    autosave: () => calls.push(['autosave']),
  });
  assert.equal(result.value, 2);
  assert.deepEqual(calls, [['apply', 2], ['history', 1], ['autosave']]);
});

test('country region transaction restores once and skips history/autosave on failure', async () => {
  const calls = [];
  await assert.rejects(runCountryRegionTransaction({
    snapshot: () => ({ value: 1 }),
    calculate: async () => ({ value: 2 }),
    validate: () => ({ ok: false, message: 'invalid' }),
    apply: () => calls.push(['apply']),
    restore: value => calls.push(['restore', value.value]),
    recordHistory: () => calls.push(['history']),
    autosave: () => calls.push(['autosave']),
  }), /invalid/);
  assert.deepEqual(calls, [['restore', 1]]);
});
