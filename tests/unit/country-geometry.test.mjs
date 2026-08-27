import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

await import('../../assets/js/modules/country-geometry.js');

const {
  ensureClosedRing,
  hasCanonicalCountryWinding,
  normalizeCountryGeometry,
  ringSignedArea,
} = globalThis.PandoLabCountryGeometry;

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

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

test('country geometry normalizer removes consecutive duplicate vertices', () => {
  const duplicate = [117.703608, 4.163415];
  const ring = [duplicate, duplicate, [117.738071, 4.157242], [117.75, 4.1], duplicate];
  const normalizedRing = ensureClosedRing(ring);

  assert.equal(normalizedRing.length, ring.length - 1);
  assert.deepEqual(normalizedRing[0], normalizedRing.at(-1));
  assert.equal(normalizedRing.some((coord, index) => index > 0
    && coord[0] === normalizedRing[index - 1][0]
    && coord[1] === normalizedRing[index - 1][1]), false);
});

test('Borneo country rings are sanitized without changing their boundaries', () => {
  const countries = JSON.parse(fs.readFileSync(path.join(root, 'assets/data/countries-ne-5.1.1.geojson'), 'utf8'));
  const borneoCountries = countries.features.filter(feature => ['IDN', 'MYS'].includes(feature.properties?.editor_id));

  assert.equal(borneoCountries.length, 2);
  for (const feature of borneoCountries) {
    assert.equal(hasCanonicalCountryWinding(feature.geometry), false);
    const normalized = normalizeCountryGeometry(feature.geometry);
    assert.ok(normalized);
    assert.equal(hasCanonicalCountryWinding(normalized), true);
    const polygons = normalized.type === 'Polygon' ? [normalized.coordinates] : normalized.coordinates;
    for (const polygon of polygons) for (const ring of polygon) {
      assert.equal(ring.some((coord, index) => index > 0
        && coord[0] === ring[index - 1][0]
        && coord[1] === ring[index - 1][1]), false);
    }
  }
});
