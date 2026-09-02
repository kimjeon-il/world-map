export function resolveWorkerRpcPoolSize({
  hardwareConcurrency = globalThis.navigator?.hardwareConcurrency || 2,
  mobile = false,
} = {}) {
  const concurrency = Math.max(1, Math.floor(Number(hardwareConcurrency) || 1));
  if (mobile) return concurrency >= 6 ? 2 : 1;
  return Math.min(4, Math.max(1, concurrency - 1));
}

export function createWorkerRpcPool({
  createClient,
  size = resolveWorkerRpcPoolSize(),
} = {}) {
  if (typeof createClient !== 'function') throw new TypeError('Worker RPC pool createClient callback is required.');
  const poolSize = Math.max(1, Math.floor(Number(size) || 1));
  const clients = Array.from({ length: poolSize }, (_, index) => createClient(index));
  let cursor = 0;
  let closed = false;

  function clientLoad(client) {
    const count = Number(client?.stats?.()?.pendingCount);
    return Number.isFinite(count) ? count : 0;
  }

  function selectClient() {
    if (closed) throw new Error('Worker RPC pool이 종료되었습니다.');
    let selected = clients[cursor % clients.length];
    let selectedIndex = cursor % clients.length;
    let selectedLoad = clientLoad(selected);
    for (let offset = 1; offset < clients.length; offset += 1) {
      const index = (cursor + offset) % clients.length;
      const candidate = clients[index];
      const load = clientLoad(candidate);
      if (load < selectedLoad) {
        selected = candidate;
        selectedIndex = index;
        selectedLoad = load;
      }
    }
    cursor = (selectedIndex + 1) % clients.length;
    return selected;
  }

  function request(operation, payload = null, options = {}) {
    return selectClient().request(operation, payload, options);
  }

  function cancelAll(reason = 'cancelled') {
    for (const client of clients) client?.cancelAll?.(reason);
  }

  function stop(reason = 'stopped') {
    if (closed) return;
    closed = true;
    for (const client of clients) client?.stop?.(reason);
  }

  return Object.freeze({
    request,
    cancelAll,
    stop,
    size: () => clients.length,
    stats: () => Object.freeze({
      size: clients.length,
      closed,
      pendingCount: clients.reduce((sum, client) => sum + clientLoad(client), 0),
      clients: Object.freeze(clients.map((client, index) => Object.freeze({ index, ...(client?.stats?.() || {}) }))),
    }),
  });
}
