import assert from 'node:assert/strict';
import test from 'node:test';

import { buildRiverAnnexCandidates, riverAnnexDiscoveryBounds } from '../../assets/js/modules/annex-geometry.js';

function polygon(id, coordinates) {
  return {
    type: 'Feature', id,
    properties: { editor_id: id },
    geometry: { type: 'Polygon', coordinates: [coordinates] },
  };
}

function river(id, coordinatesOrGeometry) {
  const geometry = Array.isArray(coordinatesOrGeometry)
    ? { type: 'LineString', coordinates: coordinatesOrGeometry }
    : coordinatesOrGeometry;
  return {
    type: 'Feature', id,
    properties: { pandolab_id: id, category: 'river' },
    geometry,
  };
}

const target = polygon('target', [[-5, 0], [0, 0], [0, 10], [-5, 10], [-5, 0]]);
const donor = polygon('donor', [[0, 0], [5, 0], [5, 10], [0, 10], [0, 0]]);

test('river annex discovers one enclosed land face from a shared frontier and a river centerline', () => {
  const result = buildRiverAnnexCandidates({
    targetFeature: target,
    donorFeatures: [donor],
    riverFeatures: [river('r-1', [[0, 2], [2, 5], [0, 8]])],
    topologyRevision: 'revision-a',
  });
  assert.equal(result.candidates.length, 1);
  const [candidate] = result.candidates;
  assert.equal(candidate.donorCountryId, 'donor');
  assert.equal(candidate.geometry.type, 'Polygon');
  assert.deepEqual(candidate.sourceRiverIds, ['r-1']);
  assert.ok(candidate.sharedBorderSegments.length > 0);
  assert.ok(candidate.riverBoundarySegments.length > 0);
  assert.match(candidate.key, /^donor:r-1:/);
});

test('river annex keeps disconnected pockets separate and sorts stable candidate keys', () => {
  const input = {
    targetFeature: target,
    donorFeatures: [donor],
    riverFeatures: [river('r-meander', [[0, 1], [1, 2], [0, 3], [1, 4], [0, 5]])],
    topologyRevision: 'revision-b',
  };
  const first = buildRiverAnnexCandidates(input).candidates;
  const second = buildRiverAnnexCandidates(input).candidates;
  assert.equal(first.length, 2);
  assert.deepEqual(first.map(candidate => candidate.key), second.map(candidate => candidate.key));
  assert.deepEqual(first.map(candidate => candidate.key), first.map(candidate => candidate.key).slice().sort());
  assert.equal(new Set(first.map(candidate => candidate.key)).size, 2);
});

test('river annex returns three individually selectable pockets without filling gaps between them', () => {
  const result = buildRiverAnnexCandidates({
    targetFeature: target,
    donorFeatures: [donor],
    riverFeatures: [river('r-three', [[0, 1], [1, 2], [0, 3], [1, 4], [0, 5], [1, 6], [0, 7]])],
  });
  assert.equal(result.candidates.length, 3);
  assert.equal(new Set(result.candidates.map(candidate => candidate.geometry.coordinates[0].map(point => point.join(',')).join('|'))).size, 3);
});

test('river annex ignores rivers that stay inside the donor, touch once, coincide with the frontier, or lack a shared frontier', () => {
  const inside = buildRiverAnnexCandidates({
    targetFeature: target,
    donorFeatures: [donor],
    riverFeatures: [river('inside', [[1, 2], [2, 5], [1, 8]])],
  });
  assert.equal(inside.candidates.length, 0);

  const open = buildRiverAnnexCandidates({
    targetFeature: target,
    donorFeatures: [donor],
    riverFeatures: [river('open', [[0, 2], [2, 5]])],
  });
  assert.equal(open.candidates.length, 0);

  const coincident = buildRiverAnnexCandidates({
    targetFeature: target,
    donorFeatures: [donor],
    riverFeatures: [river('coincident', [[0, 2], [0, 8]])],
  });
  assert.equal(coincident.candidates.length, 0);

  const separateTarget = polygon('separate-target', [[-5, 0], [-0.01, 0], [-0.01, 10], [-5, 10], [-5, 0]]);
  const noSharedFrontier = buildRiverAnnexCandidates({
    targetFeature: separateTarget,
    donorFeatures: [donor],
    riverFeatures: [river('closed-looking', [[0, 2], [2, 5], [0, 8]])],
  });
  assert.equal(noSharedFrontier.candidates.length, 0);
});

test('river annex preserves overlap then divergence and rejoin as a pocket', () => {
  const result = buildRiverAnnexCandidates({
    targetFeature: target,
    donorFeatures: [donor],
    riverFeatures: [river('diverge', [[0, 2], [0, 3], [2, 5], [0, 7], [0, 8]])],
  });
  assert.equal(result.candidates.length, 1);
  assert.ok(result.candidates[0].riverBoundarySegments.length >= 2);
});

test('river annex handles canonical MultiLineString rivers as separate pocket sources', () => {
  const result = buildRiverAnnexCandidates({
    targetFeature: target,
    donorFeatures: [donor],
    riverFeatures: [river('logical-river', {
      type: 'MultiLineString',
      coordinates: [
        [[0, 1], [2, 2.5], [0, 4]],
        [[0, 6], [2, 7.5], [0, 9]],
      ],
    })],
  });
  assert.equal(result.candidates.length, 2);
  assert.ok(result.candidates.every(candidate => candidate.sourceLogicalRiverIds.includes('logical-river')));
});

test('river annex applies only the internal snap tolerance needed to close a near-coincident endpoint', () => {
  const withinTolerance = buildRiverAnnexCandidates({
    targetFeature: target,
    donorFeatures: [donor],
    riverFeatures: [river('near', [[0.0000005, 2], [2, 5], [0.0000005, 8]])],
  });
  assert.equal(withinTolerance.candidates.length, 1);

  const beyondTolerance = buildRiverAnnexCandidates({
    targetFeature: target,
    donorFeatures: [donor],
    riverFeatures: [river('far', [[0.00005, 2], [2, 5], [0.00005, 8]])],
  });
  assert.equal(beyondTolerance.candidates.length, 0);
});

test('river annex keeps candidates tied to their individual donors', () => {
  const lowerDonor = polygon('lower', [[0, 0], [5, 0], [5, 5], [0, 5], [0, 0]]);
  const upperDonor = polygon('upper', [[0, 5], [5, 5], [5, 10], [0, 10], [0, 5]]);
  const result = buildRiverAnnexCandidates({
    targetFeature: target,
    donorFeatures: [upperDonor, lowerDonor],
    riverFeatures: [
      river('lower-river', [[0, 1], [2, 2.5], [0, 4]]),
      river('upper-river', [[0, 6], [2, 7.5], [0, 9]]),
    ],
  });
  assert.deepEqual(result.candidates.map(candidate => candidate.donorCountryId).sort(), ['lower', 'upper']);
});

test('a malformed river source is skipped without discarding valid river candidates', () => {
  const result = buildRiverAnnexCandidates({
    targetFeature: target,
    donorFeatures: [donor],
    riverFeatures: [
      { type: 'Feature', id: 'broken', properties: { pandolab_id: 'broken', category: 'river' }, geometry: { type: 'LineString', coordinates: null } },
      river('valid', [[0, 2], [2, 5], [0, 8]]),
    ],
  });
  assert.equal(result.candidates.length, 1);
  assert.equal(result.diagnostics.skippedRivers, 1);
});

test('river discovery bounds are limited to the actual shared target-donor frontier', () => {
  assert.deepEqual(riverAnnexDiscoveryBounds(target.geometry, [donor.geometry]), [0, 0, 0, 10]);
});
