/* PandoLab river-annex source geometry worker. */
'use strict';

importScripts('../vendor/fflate/fflate.min.js');

const sourceUrl = new URL('../../data/hydro/annex-source-v1/source.json.gz', self.location.href);
const revision = new URL(self.location.href).searchParams.get('v') || '';
if (revision) sourceUrl.searchParams.set('v', revision);

let sourcePromise = null;

function boundsOverlap(left, right) {
  return left[0] <= right[2] && left[2] >= right[0] && left[1] <= right[3] && left[3] >= right[1];
}

function normalizedQueryBounds(bounds) {
  const values = Array.isArray(bounds) ? bounds.map(Number) : [];
  if (values.length !== 4 || !values.every(Number.isFinite)) throw new Error('원본 하천 탐색 범위가 올바르지 않습니다.');
  if (values[2] - values[0] >= 360) return [[-180, values[1], 180, values[3]]];
  const normalize = value => {
    let output = value;
    while (output > 180) output -= 360;
    while (output < -180) output += 360;
    return output;
  };
  const left = normalize(values[0]);
  const right = normalize(values[2]);
  if (left <= right && values[0] >= -180 && values[2] <= 180) return [[left, values[1], right, values[3]]];
  return [[left, values[1], 180, values[3]], [-180, values[1], right, values[3]]];
}

function buildGrid(payload) {
  const features = Array.isArray(payload.features) ? payload.features : [];
  const byId = new Map();
  const grid = new Map();
  const large = [];
  const cellSize = Number(payload.cellSizeDegrees || 1);
  const register = (key, index) => {
    if (!grid.has(key)) grid.set(key, []);
    grid.get(key).push(index);
  };
  features.forEach((feature, index) => {
    const id = String(feature.id ?? feature.properties?.source_logical_id ?? index);
    byId.set(id, feature);
    const bounds = feature.bounds || feature.__awBounds;
    if (!Array.isArray(bounds) || bounds.length !== 4) return;
    const minX = Math.floor((bounds[0] + 180) / cellSize);
    const maxX = Math.floor((bounds[2] + 180) / cellSize);
    const minY = Math.floor((bounds[1] + 90) / cellSize);
    const maxY = Math.floor((bounds[3] + 90) / cellSize);
    const count = (maxX - minX + 1) * (maxY - minY + 1);
    if (count > 256) {
      large.push(index);
      return;
    }
    for (let x = minX; x <= maxX; x += 1) for (let y = minY; y <= maxY; y += 1) register(`${x}:${y}`, index);
  });
  return { ...payload, features, byId, grid, large, cellSize };
}

async function loadSource() {
  if (sourcePromise) return sourcePromise;
  sourcePromise = fetch(sourceUrl).then(async response => {
    if (!response.ok) throw new Error(`원본 하천 companion HTTP ${response.status}`);
    const compressed = new Uint8Array(await response.arrayBuffer());
    const decoded = self.fflate.gunzipSync(compressed);
    return buildGrid(JSON.parse(new TextDecoder().decode(decoded)));
  });
  return sourcePromise;
}

function queryGrid(source, queryBounds) {
  const indexes = new Set(source.large);
  for (const bounds of normalizedQueryBounds(queryBounds)) {
    const minX = Math.floor((bounds[0] + 180) / source.cellSize);
    const maxX = Math.floor((bounds[2] + 180) / source.cellSize);
    const minY = Math.floor((bounds[1] + 90) / source.cellSize);
    const maxY = Math.floor((bounds[3] + 90) / source.cellSize);
    for (let x = minX; x <= maxX; x += 1) for (let y = minY; y <= maxY; y += 1) {
      for (const index of source.grid.get(`${x}:${y}`) || []) indexes.add(index);
    }
  }
  const ranges = normalizedQueryBounds(queryBounds);
  return [...indexes].filter(index => {
    const featureBounds = source.features[index]?.bounds || source.features[index]?.__awBounds;
    return ranges.some(bounds => boundsOverlap(featureBounds, bounds));
  });
}

self.onmessage = async event => {
  const message = event.data || {};
  try {
    const source = await loadSource();
    if (message.type === 'query-logical-features') {
      const indexes = queryGrid(source, message.bounds);
      const logicalFids = indexes.map(index => String(source.features[index].id));
      self.postMessage({ type: 'logical-features', requestId: message.requestId, logicalFids });
      return;
    }
    if (message.type === 'load-feature') {
      const feature = source.byId.get(String(message.logicalFid)) || null;
      self.postMessage({ type: 'feature', requestId: message.requestId, feature: feature ? structuredClone(feature) : null });
    }
  } catch (error) {
    const query = message.type === 'query-logical-features';
    self.postMessage({
      type: query ? 'logical-features-error' : 'feature-error',
      requestId: message.requestId,
      message: error?.message || String(error),
    });
  }
};

