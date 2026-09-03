import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyReferenceImagePlacementDrag,
  createReferenceImagePlacementDrag,
  normalizeReferenceImageRotation,
  referenceImagePlacementGeometry,
  referenceImagePlacementHit,
} from '../../assets/js/modules/reference-image-placement.js';

test('reference image rotation normalizes into the signed half-turn range', () => {
  assert.equal(normalizeReferenceImageRotation(0), 0);
  assert.equal(normalizeReferenceImageRotation(190), -170);
  assert.equal(normalizeReferenceImageRotation(-190), 170);
  assert.equal(normalizeReferenceImageRotation('bad'), 0);
});

test('placement geometry rotates corners and keeps the center stable', () => {
  const record = { screenRect: { x: 100, y: 50, width: 200, height: 100 }, rotation: 90 };
  const geometry = referenceImagePlacementGeometry(record);
  assert.deepEqual(geometry.center, [200, 100]);
  assert.ok(Math.abs(geometry.corners[0][0] - 250) < 1e-9);
  assert.ok(Math.abs(geometry.corners[0][1] - 0) < 1e-9);
});

test('placement hit distinguishes body, corner scale and rotation handle', () => {
  const record = { screenRect: { x: 100, y: 100, width: 200, height: 100 }, rotation: 0 };
  const geometry = referenceImagePlacementGeometry(record);
  assert.equal(referenceImagePlacementHit(record, [200, 150]).type, 'move');
  assert.equal(referenceImagePlacementHit(record, geometry.corners[2]).type, 'scale');
  assert.equal(referenceImagePlacementHit(record, geometry.rotateHandle).type, 'rotate');
  assert.equal(referenceImagePlacementHit(record, [10, 10]), null);
});

test('placement drag moves, scales and rotates without changing the persistence shape', () => {
  const moveRecord = { id: 'a', screenRect: { x: 10, y: 20, width: 100, height: 80 }, rotation: 0 };
  const moveDrag = createReferenceImagePlacementDrag(moveRecord, { type: 'move' }, [20, 30], 1);
  assert.equal(applyReferenceImagePlacementDrag(moveRecord, moveDrag, [45, 60]), true);
  assert.deepEqual(moveRecord.screenRect, { x: 35, y: 50, width: 100, height: 80 });

  const scaleRecord = { id: 'b', screenRect: { x: 100, y: 100, width: 100, height: 80 }, rotation: 0 };
  const scaleDrag = createReferenceImagePlacementDrag(scaleRecord, { type: 'scale', corner: 'se' }, [200, 180], 2);
  assert.equal(applyReferenceImagePlacementDrag(scaleRecord, scaleDrag, [225, 205], { shiftKey: true }), true);
  assert.ok(scaleRecord.screenRect.width >= 100);
  assert.ok(scaleRecord.screenRect.height >= 80);
  assert.ok(Math.abs(scaleRecord.screenRect.width / scaleRecord.screenRect.height - 1.25) < 1e-9);

  const rotateRecord = { id: 'c', screenRect: { x: 100, y: 100, width: 100, height: 100 }, rotation: 0 };
  const rotateDrag = createReferenceImagePlacementDrag(rotateRecord, { type: 'rotate' }, [150, 74], 3);
  assert.equal(applyReferenceImagePlacementDrag(rotateRecord, rotateDrag, [250, 150], { shiftKey: true }), true);
  assert.equal(rotateRecord.rotation, 90);
});
