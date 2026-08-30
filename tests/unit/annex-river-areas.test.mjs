import assert from 'node:assert/strict';
import test from 'node:test';

await import('../../assets/js/vendor/polygon-clipping.min.js');
const {
  buildRiverAnnexCandidates,
  expandRiverAnnexDiscoveryBounds,
  riverAnnexConfigFingerprint,
  riverAnnexDiscoveryBounds,
  RIVER_ANNEX_ALGORITHM_REVISION,
  RIVER_ANNEX_CONFIG,
} = await import('../../assets/js/modules/annex-geometry.js');

const clipper = globalThis.polygonClipping;

function polygon(id, coordinates) {
  return {
    type: 'Feature', id,
    properties: { editor_id: id },
    geometry: { type: 'Polygon', coordinates: [coordinates] },
  };
}

function river(id, coordinatesOrGeometry, properties = {}) {
  const geometry = Array.isArray(coordinatesOrGeometry)
    ? { type: 'LineString', coordinates: coordinatesOrGeometry }
    : coordinatesOrGeometry;
  return {
    type: 'Feature', id,
    properties: {
      pandolab_id: id,
      source_logical_id: id,
      source_id: properties.source_id || id,
      category: 'river',
      ...properties,
    },
    geometry,
  };
}

const target = polygon('target', [[-0.1, 0], [0, 0], [0, 0.1], [-0.1, 0.1], [-0.1, 0]]);
const donor = polygon('donor', [[0, 0], [0.1, 0], [0.1, 0.1], [0, 0.1], [0, 0]]);

function calculate(riverFeatures, options = {}) {
  return buildRiverAnnexCandidates({
    targetFeature: options.targetFeature || target,
    donorFeatures: options.donorFeatures || [donor],
    riverFeatures,
    topologyRevision: options.topologyRevision || 'metric-fixture',
    config: options.config,
    clipper,
  });
}

test('metric pocket accepts 200m and 800m parallel offsets with virtual connectors', () => {
  for (const [id, longitude] of [['200m', 0.0018], ['800m', 0.0072]]) {
    const result = calculate([river(id, [[longitude, 0.01], [longitude, 0.09]])]);
    assert.equal(result.candidates.length, 1);
    assert.equal(result.candidates[0].connectorSegments.length, 2);
    assert.ok(result.candidates[0].areaM2 >= RIVER_ANNEX_CONFIG.minCandidateAreaM2);
    assert.equal(result.candidates[0].area, result.candidates[0].areaM2);
  }
});

test('coincident, 10km-distant, perpendicular, and short river runs produce no pocket', () => {
  assert.equal(calculate([river('coincident', [[0, 0.01], [0, 0.09]])]).candidates.length, 0);
  assert.equal(calculate([river('far', [[0.09, 0.01], [0.09, 0.09]])]).candidates.length, 0);
  assert.equal(calculate([river('crossing', [[0, 0.05], [0.02, 0.05]])]).candidates.length, 0);
  assert.equal(calculate([river('short', [[0.002, 0.04], [0.002, 0.045]])]).candidates.length, 0);
});

test('an exact border intersection is preferred over a virtual connector', () => {
  const result = calculate([river('intersections', [[0, 0.01], [0.002, 0.02], [0.002, 0.08], [0, 0.09]])]);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].connectorSegments.length, 0);
  assert.ok(result.candidates[0].riverBoundarySegments.length > 0);
  assert.ok(result.candidates[0].sharedBorderSegments.length > 0);
});

test('target-side pockets are removed by donor-side clipping', () => {
  const result = calculate([river('target-side', [[-0.002, 0.01], [-0.002, 0.09]])]);
  assert.equal(result.candidates.length, 0);
  assert.ok(result.diagnostics.rejectedOutsideDonor > 0);
});

test('MultiLineString parts remain independent candidates with stable provenance', () => {
  const source = river('logical-river', {
    type: 'MultiLineString',
    coordinates: [
      [[0.002, 0.01], [0.002, 0.04]],
      [[0.002, 0.06], [0.002, 0.09]],
    ],
  }, { source_id: '102,101' });
  const first = calculate([source], { topologyRevision: 'stable' });
  const second = calculate([source], { topologyRevision: 'stable' });
  assert.equal(first.candidates.length, 2);
  assert.deepEqual(first.candidates.map(candidate => candidate.key), second.candidates.map(candidate => candidate.key));
  assert.ok(first.candidates.every(candidate => candidate.sourceLogicalRiverIds.includes('logical-river')));
  assert.ok(first.candidates.every(candidate => candidate.sourceRiverIds.join(',') === '101,102'));
});

test('a short invalid sample gap is bridged and separated parts stay separate', () => {
  const bridged = calculate([river('bridged', [
    [0.002, 0.01], [0.002, 0.04], [0.004, 0.042], [0.002, 0.044], [0.002, 0.09],
  ])]);
  assert.ok(bridged.candidates.length >= 1);
  const separated = calculate([river('separated', {
    type: 'MultiLineString',
    coordinates: [
      [[0.002, 0.01], [0.002, 0.04]],
      [[0.002, 0.06], [0.002, 0.09]],
    ],
  })]);
  assert.equal(separated.candidates.length, 2);
});

test('long frontiers use overlapping metric windows without duplicate pockets', () => {
  const longTarget = polygon('long-target', [[-0.1, 0], [0, 0], [0, 4], [-0.1, 4], [-0.1, 0]]);
  const longDonor = polygon('long-donor', [[0, 0], [0.1, 0], [0.1, 4], [0, 4], [0, 0]]);
  const result = calculate([river('long-river', [[0.002, 0.1], [0.002, 3.9]])], {
    targetFeature: longTarget,
    donorFeatures: [longDonor],
  });
  assert.equal(result.candidates.length, 1);
  assert.ok(result.diagnostics.frontierWindowCount >= 3);
  assert.equal(result.diagnostics.matchedParallelRuns, 1);
});

test('MultiPolygon donors keep unrelated components out of the result', () => {
  const multiDonor = {
    type: 'Feature', id: 'multi-donor', properties: { editor_id: 'multi-donor' },
    geometry: {
      type: 'MultiPolygon',
      coordinates: [
        [[[0, 0], [0.1, 0], [0.1, 0.1], [0, 0.1], [0, 0]]],
        [[[10, 10], [11, 10], [11, 11], [10, 11], [10, 10]]],
      ],
    },
  };
  const result = calculate([river('near-component', [[0.002, 0.01], [0.002, 0.09]])], { donorFeatures: [multiDonor] });
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].donorCountryId, 'multi-donor');
});

test('inputs stay immutable and config changes alter the deterministic fingerprint', () => {
  const inputRiver = river('immutable', [[0.002, 0.01], [0.002, 0.09]]);
  const before = JSON.parse(JSON.stringify({ target, donor, inputRiver }));
  calculate([inputRiver]);
  assert.deepEqual({ target, donor, inputRiver }, before);
  assert.equal(RIVER_ANNEX_ALGORITHM_REVISION, 'river-areas-v2');
  assert.notEqual(
    riverAnnexConfigFingerprint(RIVER_ANNEX_CONFIG),
    riverAnnexConfigFingerprint({ ...RIVER_ANNEX_CONFIG, matchMaxDistanceM: 2400 }),
  );
});

test('discovery bounds use the shared frontier and expand in meters', () => {
  const raw = riverAnnexDiscoveryBounds(target.geometry, [donor.geometry]);
  assert.deepEqual(raw, [0, 0, 0, 0.1]);
  const expanded = expandRiverAnnexDiscoveryBounds(raw, 5000);
  assert.ok(expanded[0] < -0.04 && expanded[2] > 0.04);
  assert.ok(expanded[1] < -0.04 && expanded[3] > 0.14);
});
