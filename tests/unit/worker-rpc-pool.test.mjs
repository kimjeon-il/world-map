import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createWorkerRpcPool,
  resolveWorkerRpcPoolSize,
} from '../../assets/js/modules/worker-rpc-pool.js';

test('pool sizing stays conservative on mobile and capped on desktop', () => {
  assert.equal(resolveWorkerRpcPoolSize({ hardwareConcurrency: 2, mobile: true }), 1);
  assert.equal(resolveWorkerRpcPoolSize({ hardwareConcurrency: 8, mobile: true }), 2);
  assert.equal(resolveWorkerRpcPoolSize({ hardwareConcurrency: 2, mobile: false }), 1);
  assert.equal(resolveWorkerRpcPoolSize({ hardwareConcurrency: 8, mobile: false }), 4);
});

test('pool dispatches to the least loaded client and rotates ties', async () => {
  const calls = [];
  const loads = [2, 0, 0];
  const pool = createWorkerRpcPool({
    size: 3,
    createClient: index => ({
      request: async operation => { calls.push([index, operation]); return index; },
      stats: () => ({ pendingCount: loads[index] }),
      cancelAll() {},
      stop() {},
    }),
  });
  assert.equal(await pool.request('first'), 1);
  loads[1] = 1;
  assert.equal(await pool.request('second'), 2);
  assert.deepEqual(calls, [[1, 'first'], [2, 'second']]);
  assert.equal(pool.size(), 3);
});
