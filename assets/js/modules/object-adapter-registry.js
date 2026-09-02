import { MAP_OBJECT_DOMAINS } from './map-object-categories.js';

const text = value => String(value ?? '').trim();

function normalizeRef(value) {
  if (!value || typeof value !== 'object') return null;
  const domain = text(value.domain);
  const id = text(value.id);
  if (!domain || !id) return null;
  return Object.freeze({ domain, type: text(value.type || value.kind), id });
}

function coordinatesBounds(coordinates, bounds = [Infinity, Infinity, -Infinity, -Infinity]) {
  if (!Array.isArray(coordinates)) return bounds;
  if (coordinates.length >= 2 && Number.isFinite(Number(coordinates[0])) && Number.isFinite(Number(coordinates[1]))) {
    const x = Number(coordinates[0]);
    const y = Number(coordinates[1]);
    bounds[0] = Math.min(bounds[0], x);
    bounds[1] = Math.min(bounds[1], y);
    bounds[2] = Math.max(bounds[2], x);
    bounds[3] = Math.max(bounds[3], y);
    return bounds;
  }
  for (const child of coordinates) coordinatesBounds(child, bounds);
  return bounds;
}

export function geometryBounds(value) {
  if (Array.isArray(value?.bbox) && value.bbox.length >= 4) return value.bbox.slice(0, 4).map(Number);
  const coordinates = value?.geometry?.coordinates || value?.coordinates;
  const bounds = coordinatesBounds(coordinates);
  return bounds.every(Number.isFinite) ? bounds : null;
}

export function createDomainObjectAdapter({
  domain,
  get,
  list,
  name,
  bounds,
  isLocked,
  setLocked,
  isVisible,
  setVisibility,
  focus,
  remove,
  canRemove,
} = {}) {
  const key = text(domain);
  if (!Object.values(MAP_OBJECT_DOMAINS).includes(key)) throw new TypeError(`Unknown object adapter domain: ${domain}`);
  if (typeof get !== 'function' || typeof list !== 'function') throw new TypeError(`${key} object adapter requires get() and list()`);
  return Object.freeze({
    domain: key,
    get,
    list,
    name,
    bounds,
    isLocked,
    setLocked,
    isVisible,
    setVisibility,
    focus,
    remove,
    canRemove,
  });
}

function unsupported(operation, ref) {
  return { ok: false, changed: false, code: 'unsupported', operation, ref };
}

export function createObjectAdapterRegistry({ adapters = [] } = {}) {
  const byDomain = new Map();
  for (const candidate of Array.isArray(adapters) ? adapters : Object.values(adapters || {})) {
    if (!candidate?.domain) continue;
    byDomain.set(candidate.domain, candidate);
  }

  function adapterFor(value) {
    const ref = normalizeRef(value);
    return ref ? byDomain.get(ref.domain) || null : null;
  }

  function get(value) {
    const ref = normalizeRef(value);
    const adapter = ref ? byDomain.get(ref.domain) : null;
    return adapter ? adapter.get(ref.id, ref) || null : null;
  }

  function list({ domain = '', type = '' } = {}) {
    const domainKey = text(domain);
    const values = domainKey
      ? [byDomain.get(domainKey)].filter(Boolean)
      : [...byDomain.values()];
    return values.flatMap(adapter => {
      const items = adapter.list({ type: text(type) }) || [];
      return Array.isArray(items) ? items : [];
    });
  }

  function name(value) {
    const ref = normalizeRef(value);
    const adapter = ref ? byDomain.get(ref.domain) : null;
    const object = ref && adapter ? adapter.get(ref.id, ref) : null;
    if (!ref || !adapter || !object) return '';
    return text(adapter.name?.(object, ref) ?? object?.properties?.name ?? object?.name ?? ref.id);
  }

  function bounds(value) {
    const ref = normalizeRef(value);
    const adapter = ref ? byDomain.get(ref.domain) : null;
    const object = ref && adapter ? adapter.get(ref.id, ref) : null;
    if (!ref || !adapter || !object) return null;
    return adapter.bounds?.(object, ref) || geometryBounds(object);
  }

  function isLocked(value) {
    const ref = normalizeRef(value);
    const adapter = ref ? byDomain.get(ref.domain) : null;
    const object = ref && adapter ? adapter.get(ref.id, ref) : null;
    if (!ref || !adapter || !object) return false;
    return adapter.isLocked ? adapter.isLocked(object, ref) === true : object?.properties?.locked === true || object?.locked === true;
  }

  function isVisible(value) {
    const ref = normalizeRef(value);
    const adapter = ref ? byDomain.get(ref.domain) : null;
    const object = ref && adapter ? adapter.get(ref.id, ref) : null;
    if (!ref || !adapter || !object) return false;
    return adapter.isVisible ? adapter.isVisible(object, ref) !== false : true;
  }

  function invoke(value, operation, ...args) {
    const ref = normalizeRef(value);
    const adapter = ref ? byDomain.get(ref.domain) : null;
    if (!ref || !adapter || typeof adapter[operation] !== 'function') return unsupported(operation, ref);
    return adapter[operation](ref.id, ...args, ref);
  }

  function canRemove(value) {
    const ref = normalizeRef(value);
    const adapter = ref ? byDomain.get(ref.domain) : null;
    if (!ref || !adapter || typeof adapter.remove !== 'function') return false;
    const object = adapter.get(ref.id, ref);
    if (!object) return false;
    return adapter.canRemove ? adapter.canRemove(object, ref) !== false : true;
  }

  return Object.freeze({
    adapterFor,
    get,
    list,
    name,
    bounds,
    isLocked,
    isVisible,
    canRemove,
    setLocked: (value, locked) => invoke(value, 'setLocked', !!locked),
    setVisibility: (value, visible) => invoke(value, 'setVisibility', visible !== false),
    focus: value => invoke(value, 'focus'),
    remove: value => invoke(value, 'remove'),
    hasDomain: domain => byDomain.has(text(domain)),
    domains: () => [...byDomain.keys()],
  });
}
