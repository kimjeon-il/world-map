import assert from 'node:assert/strict';
import test from 'node:test';

await import('../../assets/js/modules/country-geometry.js');

const {
  hasCanonicalCountryWinding,
  normalizeCountryGeometry,
  ringSignedArea,
} = globalThis.PandoLabCountryGeometry;

const counterClockwiseOuter = [[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]];
const clockwiseHole = [[0.5, 0.5], [0.5, 1.5], [1.5, 1.5], [1.5, 0.5], [0.5, 0.5]];

test('country geometry normalizer rewinds clipping output for D3 spherical paths', () => {
  const normalized = normalizeCountryGeometry([[counterClockwiseOuter, clockwiseHole]]);
  assert.equal(normalized.type, 'Polygon');
  assert.ok(ringSignedArea(normalized.coordinates[0]) < 0);
  assert.ok(ringSignedArea(normalized.coordinates[1]) > 0);
  assert.equal(hasCanonicalCountryWinding(normalized), true);
});

test('country geometry normalizer closes open rings and rejects degenerate polygons', () => {
  const normalized = normalizeCountryGeometry([[[[0, 0], [0, 2], [2, 2], [2, 0]]]]);
  assert.deepEqual(normalized.coordinates[0][0], normalized.coordinates[0].at(-1));
  assert.equal(normalizeCountryGeometry([[[[0, 0], [1, 1], [0, 0]]]]), null);
});

test('legacy counter-clockwise country geometry is detected before project restore', () => {
  const legacy = { type: 'Polygon', coordinates: [counterClockwiseOuter] };
  assert.equal(hasCanonicalCountryWinding(legacy), false);
  assert.equal(hasCanonicalCountryWinding(normalizeCountryGeometry(legacy)), true);
});
