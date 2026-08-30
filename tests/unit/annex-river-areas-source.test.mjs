import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const app = fs.readFileSync(new URL('../../assets/js/app.js', import.meta.url), 'utf8');
const geometry = fs.readFileSync(new URL('../../assets/js/modules/annex-geometry.js', import.meta.url), 'utf8');

test('annex river UI uses candidate areas instead of selecting a river or a side', () => {
  assert.match(app, /annexPhase === 'river-areas'/);
  assert.match(app, /prepareAnnexRiverAreaCandidates/);
  assert.match(app, /toggleRiverAnnexCandidate/);
  assert.match(app, /new Set\(state\.annexSelectedRiverAreaKeys\)/);
  assert.match(app, /if \(candidate\.geometry\?\.type === 'Polygon'\) return \[candidate\.geometry\.coordinates\];/);
  assert.match(app, /polygonClipping\?\.union\(\.\.\.coordinateSets\)/);
  assert.match(app, /여러 영역을 선택할 수 있습니다/);
  assert.doesNotMatch(app, /annexRiverFeature|annexRiverSections|prepareAnnexRiverCandidates/);
  assert.doesNotMatch(geometry, /extractRiverAnnexSections/);
});

test('candidate computation uses canonical river centerlines and only the target-donor shared frontier', () => {
  assert.match(app, /queryHydroLogicalFeatures\(bounds, \{ category: 'river' \}\)/);
  assert.match(app, /loadHydroLogicalFeature\(logicalId\)/);
  assert.match(geometry, /sharedFrontierSegments\(targetFeature\.geometry, donorFeature\.geometry/);
  assert.match(geometry, /source: 'frontier'/);
  assert.match(geometry, /source: 'river'/);
  assert.doesNotMatch(geometry, /buffer\(/i);
});

test('river area calculations are cached and stale results cannot replace a newer annex context', () => {
  assert.match(app, /riverAnnexCandidateCache/);
  assert.match(app, /riverAnnexCandidateGeneration/);
  assert.match(app, /generation === riverAnnexCandidateGeneration/);
  assert.match(app, /state\.annexRiverAreaPreviewGeometry/);
  assert.match(app, /selectedRiverCandidates\.map\(candidate => String\(candidate\.donorCountryId\)\)/);
});
