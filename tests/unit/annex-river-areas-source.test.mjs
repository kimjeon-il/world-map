import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const app = fs.readFileSync(new URL('../../assets/js/app.js', import.meta.url), 'utf8');
const geometry = fs.readFileSync(new URL('../../assets/js/modules/annex-geometry.js', import.meta.url), 'utf8');
const metric = fs.readFileSync(new URL('../../assets/js/modules/river-annex-metric.js', import.meta.url), 'utf8');
const sourceWorker = fs.readFileSync(new URL('../../assets/js/workers/hydro-annex-source-worker.js', import.meta.url), 'utf8');
const worker = fs.readFileSync(new URL('../../assets/js/workers/river-annex-worker.js', import.meta.url), 'utf8');
const manifest = JSON.parse(fs.readFileSync(new URL('../../assets/data/hydro/annex-source-v1/manifest.json', import.meta.url), 'utf8'));

test('annex river UI preserves automatic multi-candidate selection and preview', () => {
  assert.match(app, /annexPhase === 'river-areas'/);
  assert.match(app, /prepareAnnexRiverAreaCandidates/);
  assert.match(app, /toggleRiverAnnexCandidate/);
  assert.match(app, /new Set\(state\.annexSelectedRiverAreaKeys\)/);
  assert.match(app, /polygonClipping\?\.union\(\.\.\.coordinateSets\)/);
  assert.match(app, /여러 영역을 선택할 수 있습니다/);
  assert.doesNotMatch(app, /connectorSegments/);
});

test('candidate discovery explicitly loads source-role rivers from the companion asset', () => {
  assert.match(app, /queryHydroLogicalFeatures\(bounds, \{ category: 'river', geometryRole: 'source' \}\)/);
  assert.match(app, /loadHydroLogicalFeature\(logicalId, \{ geometryRole: 'source' \}\)/);
  assert.match(sourceWorker, /annex-source-v1\/source\.json\.gz/);
  assert.equal(manifest.version, 'annex-source-v1');
  assert.equal(manifest.schema, 'pandolab-river-annex-source-v1');
  assert.equal(manifest.buildCorridorM, 10000);
  assert.ok(manifest.featureCount > 0);
  assert.ok(manifest.data.bytes > 0);
});

test('metric matching owns pocket generation and the worker injects polygon-clipping', () => {
  assert.match(geometry, /buildMetricRiverAnnexCandidates/);
  assert.match(metric, /matchMaxDistanceM: 2500/);
  assert.match(metric, /connectorMaxLengthM: 3000/);
  assert.match(metric, /workingWindowMaxM: 200000/);
  assert.match(metric, /clipper\.intersection/);
  assert.match(metric, /clipper\.difference/);
  assert.match(worker, /polygon-clipping\.min\.js/);
  assert.match(worker, /clipper/);
});

test('cache signatures include source, algorithm, config, hydro edits, and stale-generation guards', () => {
  assert.match(app, /'annex-source-v1'/);
  assert.match(app, /RIVER_ANNEX_ALGORITHM_REVISION/);
  assert.match(app, /riverAnnexConfigFingerprint\(RIVER_ANNEX_CONFIG\)/);
  assert.match(app, /state\.hydroEdits/);
  assert.match(app, /riverAnnexCandidateGeneration/);
  assert.match(app, /generation === riverAnnexCandidateGeneration/);
  assert.match(app, /__PANDOLAB_RIVER_ANNEX_DIAGNOSTICS__/);
  assert.match(app, /RIVER_ANNEX_SOURCE_ERROR/);
});
