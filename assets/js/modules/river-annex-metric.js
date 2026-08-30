const EARTH_RADIUS_M = 6371008.8;
const DEG_TO_RAD = Math.PI / 180;

export const RIVER_ANNEX_ALGORITHM_REVISION = 'river-areas-v2';

export const RIVER_ANNEX_CONFIG = Object.freeze({
  discoveryRadiusM: 5000,
  matchMaxDistanceM: 2500,
  connectorMaxLengthM: 3000,
  exactJoinToleranceM: 50,
  maxDirectionDeltaDeg: 35,
  minParallelRunM: 1500,
  shortFrontierMinRunM: 500,
  minRunFrontierRatio: 0.25,
  sampleSpacingM: 250,
  maxMatchGapM: 500,
  maxMonotonicBacktrackM: 750,
  frontierGridCellM: 2500,
  connectorSampleSpacingM: 100,
  connectorBorderCorridorM: 100,
  minCandidateAreaM2: 1000,
  workingWindowMaxM: 200000,
  workingWindowOverlapM: 10000,
  anchorQuantizationM: 10,
});

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function polygonCoordinates(geometry) {
  if (geometry?.type === 'Polygon') return [geometry.coordinates || []];
  if (geometry?.type === 'MultiPolygon') return geometry.coordinates || [];
  return [];
}

function lineParts(geometry) {
  if (geometry?.type === 'LineString') return [geometry.coordinates || []];
  if (geometry?.type === 'MultiLineString') return geometry.coordinates || [];
  return [];
}

function finitePoint(point) {
  return Array.isArray(point) && Number.isFinite(Number(point[0])) && Number.isFinite(Number(point[1]));
}

function samePoint(left, right, epsilon = 1e-9) {
  return finitePoint(left) && finitePoint(right)
    && Math.abs(left[0] - right[0]) <= epsilon
    && Math.abs(left[1] - right[1]) <= epsilon;
}

function interpolate(left, right, t) {
  return [left[0] + (right[0] - left[0]) * t, left[1] + (right[1] - left[1]) * t];
}

function dedupeLine(points) {
  const output = [];
  for (const point of points || []) {
    if (!finitePoint(point)) continue;
    const normalized = [Number(point[0]), Number(point[1])];
    if (!output.length || !samePoint(output[output.length - 1], normalized)) output.push(normalized);
  }
  return output;
}

function closeRing(points) {
  const ring = dedupeLine(points);
  if (ring.length && !samePoint(ring[0], ring[ring.length - 1])) ring.push(ring[0].slice());
  return ring;
}

function pointOnSegment(point, left, right, epsilon = 1e-9) {
  const cross = (point[0] - left[0]) * (right[1] - left[1]) - (point[1] - left[1]) * (right[0] - left[0]);
  if (Math.abs(cross) > epsilon) return false;
  return point[0] >= Math.min(left[0], right[0]) - epsilon && point[0] <= Math.max(left[0], right[0]) + epsilon
    && point[1] >= Math.min(left[1], right[1]) - epsilon && point[1] <= Math.max(left[1], right[1]) + epsilon;
}

function pointInRing(point, ring) {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const left = ring[index];
    const right = ring[previous];
    if (pointOnSegment(point, left, right)) return true;
    if ((left[1] > point[1]) !== (right[1] > point[1])
      && point[0] < ((right[0] - left[0]) * (point[1] - left[1])) / (right[1] - left[1]) + left[0]) inside = !inside;
  }
  return inside;
}

function pointInGeometry(point, geometry) {
  return polygonCoordinates(geometry).some(polygon => (
    polygon?.length && pointInRing(point, polygon[0]) && !polygon.slice(1).some(ring => pointInRing(point, ring))
  ));
}

function unwrapLongitude(longitude, centerLongitude) {
  let value = Number(longitude);
  while (value - centerLongitude > 180) value -= 360;
  while (value - centerLongitude < -180) value += 360;
  return value;
}

function normalizeLongitude(longitude) {
  let value = Number(longitude);
  while (value > 180) value -= 360;
  while (value < -180) value += 360;
  return value;
}

export function createLocalMetricWorkspace(points = []) {
  const valid = points.filter(finitePoint);
  const centerLat = valid.length ? valid.reduce((sum, point) => sum + Number(point[1]), 0) / valid.length : 0;
  const firstLon = valid.length ? Number(valid[0][0]) : 0;
  const unwrapped = valid.map(point => unwrapLongitude(point[0], firstLon));
  const centerLon = unwrapped.length ? unwrapped.reduce((sum, value) => sum + value, 0) / unwrapped.length : firstLon;
  const cosLat = Math.max(1e-6, Math.cos(centerLat * DEG_TO_RAD));
  return {
    centerLon,
    centerLat,
    toMeters(point) {
      const longitude = unwrapLongitude(point[0], centerLon);
      return [
        EARTH_RADIUS_M * (longitude - centerLon) * DEG_TO_RAD * cosLat,
        EARTH_RADIUS_M * (Number(point[1]) - centerLat) * DEG_TO_RAD,
      ];
    },
    toLonLat(point) {
      return [
        normalizeLongitude(centerLon + point[0] / (EARTH_RADIUS_M * cosLat) / DEG_TO_RAD),
        centerLat + point[1] / EARTH_RADIUS_M / DEG_TO_RAD,
      ];
    },
  };
}

export function expandRiverAnnexDiscoveryBounds(bounds, distanceM = RIVER_ANNEX_CONFIG.discoveryRadiusM) {
  if (!Array.isArray(bounds) || bounds.length !== 4 || !bounds.every(Number.isFinite)) return null;
  const centerLat = Math.max(-89.5, Math.min(89.5, (bounds[1] + bounds[3]) / 2));
  const latPadding = Number(distanceM) / EARTH_RADIUS_M / DEG_TO_RAD;
  const lonPadding = Math.min(180, latPadding / Math.max(0.01, Math.cos(centerLat * DEG_TO_RAD)));
  return [bounds[0] - lonPadding, bounds[1] - latPadding, bounds[2] + lonPadding, bounds[3] + latPadding];
}

function distance(left, right) {
  return Math.hypot(right[0] - left[0], right[1] - left[1]);
}

function lineCumulative(points) {
  const cumulative = [0];
  for (let index = 1; index < points.length; index += 1) cumulative.push(cumulative[index - 1] + distance(points[index - 1], points[index]));
  return cumulative;
}

function projectionOnSegment(point, left, right) {
  const dx = right[0] - left[0];
  const dy = right[1] - left[1];
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared > 1e-9
    ? Math.max(0, Math.min(1, ((point[0] - left[0]) * dx + (point[1] - left[1]) * dy) / lengthSquared))
    : 0;
  const coordinate = [left[0] + dx * t, left[1] + dy * t];
  return { t, coordinate, distance: distance(point, coordinate) };
}

function directionForSegment(left, right) {
  const length = distance(left, right);
  return length > 1e-9 ? [(right[0] - left[0]) / length, (right[1] - left[1]) / length] : [0, 0];
}

function undirectedAngleDegrees(left, right) {
  const dot = Math.abs(left[0] * right[0] + left[1] * right[1]);
  return Math.acos(Math.max(-1, Math.min(1, dot))) / DEG_TO_RAD;
}

function stableTextHash(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function coordinateKey(point, precision = 1e-8) {
  return `${Math.round(Number(point[0]) / precision)}:${Math.round(Number(point[1]) / precision)}`;
}

function canonicalLineKey(points) {
  const forward = points.map(point => coordinateKey(point)).join('|');
  const reverse = points.slice().reverse().map(point => coordinateKey(point)).join('|');
  return forward < reverse ? forward : reverse;
}

export function buildSharedFrontierChains(segments = []) {
  const entries = segments.map((segment, index) => ({
    index,
    points: dedupeLine(segment),
    used: false,
  })).filter(entry => entry.points.length >= 2);
  const endpointMap = new Map();
  const register = (key, entry) => {
    if (!endpointMap.has(key)) endpointMap.set(key, []);
    endpointMap.get(key).push(entry);
  };
  for (const entry of entries) {
    register(coordinateKey(entry.points[0]), entry);
    register(coordinateKey(entry.points[entry.points.length - 1]), entry);
  }
  const chains = [];
  const extend = (points, atStart) => {
    while (true) {
      const endpoint = atStart ? points[0] : points[points.length - 1];
      const next = (endpointMap.get(coordinateKey(endpoint)) || []).find(entry => !entry.used);
      if (!next) break;
      next.used = true;
      const candidate = next.points.slice();
      const matchesStart = samePoint(endpoint, candidate[0]);
      const matchesEnd = samePoint(endpoint, candidate[candidate.length - 1]);
      if (!matchesStart && !matchesEnd) break;
      if (atStart) {
        if (matchesStart) candidate.reverse();
        points.unshift(...candidate.slice(0, -1));
      } else {
        if (matchesEnd) candidate.reverse();
        points.push(...candidate.slice(1));
      }
    }
  };
  for (const entry of entries) {
    if (entry.used) continue;
    entry.used = true;
    const points = entry.points.map(point => point.slice());
    extend(points, false);
    extend(points, true);
    const workspace = createLocalMetricWorkspace(points);
    const metricPoints = points.map(workspace.toMeters);
    const cumulative = lineCumulative(metricPoints);
    const lengthM = cumulative[cumulative.length - 1] || 0;
    if (lengthM <= 0) continue;
    chains.push({
      key: stableTextHash(canonicalLineKey(points)),
      points,
      workspace,
      metricPoints,
      cumulative,
      lengthM,
    });
  }
  return chains.sort((left, right) => left.key.localeCompare(right.key));
}

function buildWorkingWindows(chain, config) {
  const maximum = Math.max(1, Number(config.workingWindowMaxM));
  const overlap = Math.max(0, Math.min(maximum - 1, Number(config.workingWindowOverlapM)));
  if (chain.lengthM <= maximum) return [{ ...chain, parentLengthM: chain.lengthM, offsetS: 0, windowIndex: 0 }];
  const windows = [];
  const step = maximum - overlap;
  for (let startS = 0, windowIndex = 0; startS < chain.lengthM - 1e-6; startS += step, windowIndex += 1) {
    const endS = Math.min(chain.lengthM, startS + maximum);
    const points = slicePolyline(chain.points, chain.cumulative, startS, endS);
    const workspace = createLocalMetricWorkspace(points);
    const metricPoints = points.map(workspace.toMeters);
    const cumulative = lineCumulative(metricPoints);
    const lengthM = cumulative[cumulative.length - 1] || 0;
    if (lengthM > 0) windows.push({
      key: chain.key,
      points,
      workspace,
      metricPoints,
      cumulative,
      lengthM,
      parentLengthM: chain.lengthM,
      offsetS: startS,
      windowIndex,
    });
    if (endS >= chain.lengthM - 1e-6) break;
  }
  return windows;
}

function buildFrontierIndex(chain, cellSize) {
  const buckets = new Map();
  const segments = [];
  for (let index = 0; index < chain.metricPoints.length - 1; index += 1) {
    const left = chain.metricPoints[index];
    const right = chain.metricPoints[index + 1];
    const segment = {
      index,
      left,
      right,
      startS: chain.cumulative[index],
      length: distance(left, right),
      direction: directionForSegment(left, right),
    };
    if (segment.length <= 1e-6) continue;
    segments.push(segment);
    const minX = Math.floor(Math.min(left[0], right[0]) / cellSize);
    const maxX = Math.floor(Math.max(left[0], right[0]) / cellSize);
    const minY = Math.floor(Math.min(left[1], right[1]) / cellSize);
    const maxY = Math.floor(Math.max(left[1], right[1]) / cellSize);
    for (let x = minX; x <= maxX; x += 1) for (let y = minY; y <= maxY; y += 1) {
      const key = `${x}:${y}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(segment);
    }
  }
  function nearest(point, searchDistance) {
    const cellX = Math.floor(point[0] / cellSize);
    const cellY = Math.floor(point[1] / cellSize);
    const radius = Math.max(1, Math.ceil(searchDistance / cellSize));
    let best = null;
    const seen = new Set();
    for (let dx = -radius; dx <= radius; dx += 1) for (let dy = -radius; dy <= radius; dy += 1) {
      for (const segment of buckets.get(`${cellX + dx}:${cellY + dy}`) || []) {
        if (seen.has(segment.index)) continue;
        seen.add(segment.index);
        const projected = projectionOnSegment(point, segment.left, segment.right);
        if (!best || projected.distance < best.distance) best = {
          ...projected,
          segmentIndex: segment.index,
          direction: segment.direction,
          s: segment.startS + projected.t * segment.length,
        };
      }
    }
    return best;
  }
  return { nearest, segmentCount: segments.length };
}

function samplePolyline(points, spacing) {
  const cumulative = lineCumulative(points);
  const total = cumulative[cumulative.length - 1] || 0;
  if (total <= 0) return { cumulative, samples: [], total };
  const positions = [];
  for (let position = 0; position < total; position += spacing) positions.push(position);
  if (!positions.length || total - positions[positions.length - 1] > 1e-6) positions.push(total);
  let segmentIndex = 0;
  const samples = positions.map(position => {
    while (segmentIndex < cumulative.length - 2 && cumulative[segmentIndex + 1] < position - 1e-9) segmentIndex += 1;
    const segmentLength = cumulative[segmentIndex + 1] - cumulative[segmentIndex];
    const t = segmentLength > 1e-9 ? (position - cumulative[segmentIndex]) / segmentLength : 0;
    return {
      distanceAlong: position,
      segmentIndex,
      t: Math.max(0, Math.min(1, t)),
      coordinate: interpolate(points[segmentIndex], points[segmentIndex + 1], Math.max(0, Math.min(1, t))),
      direction: directionForSegment(points[segmentIndex], points[segmentIndex + 1]),
    };
  });
  return { cumulative, samples, total };
}

function validateMonotonicRun(samples, config) {
  if (samples.length < 2) return false;
  const direction = samples[samples.length - 1].frontier.s >= samples[0].frontier.s ? 1 : -1;
  let backtrack = 0;
  for (let index = 1; index < samples.length; index += 1) {
    const riverStep = samples[index].distanceAlong - samples[index - 1].distanceAlong;
    const frontierStep = (samples[index].frontier.s - samples[index - 1].frontier.s) * direction;
    if (Math.abs(frontierStep) > riverStep * 4 + 2000) return false;
    if (frontierStep < -config.maxMonotonicBacktrackM) return false;
    if (frontierStep < 0) backtrack += -frontierStep;
  }
  const length = samples[samples.length - 1].distanceAlong - samples[0].distanceAlong;
  return backtrack <= length * 0.1;
}

function matchRunsForPart(sourcePoints, parentChain, windows, config, diagnostics) {
  const sourceWorkspace = createLocalMetricWorkspace(sourcePoints);
  const metricPoints = sourcePoints.map(sourceWorkspace.toMeters);
  const sampled = samplePolyline(metricPoints, config.sampleSpacingM);
  if (!sampled.samples.length) return [];
  const evaluated = sampled.samples.map(sample => {
    diagnostics.scannedRiverSamples += 1;
    const lonLat = sourceWorkspace.toLonLat(sample.coordinate);
    let frontier = null;
    for (const window of windows) {
      const index = window.frontierIndex || (window.frontierIndex = buildFrontierIndex(window, config.frontierGridCellM));
      const localPoint = window.workspace.toMeters(lonLat);
      const nearest = index.nearest(localPoint, config.matchMaxDistanceM);
      if (!nearest || (frontier && frontier.distance <= nearest.distance)) continue;
      const riverLeft = window.workspace.toMeters(sourcePoints[sample.segmentIndex]);
      const riverRight = window.workspace.toMeters(sourcePoints[sample.segmentIndex + 1]);
      frontier = {
        ...nearest,
        direction: nearest.direction,
        riverDirection: directionForSegment(riverLeft, riverRight),
        s: window.offsetS + nearest.s,
        lonLat: window.workspace.toLonLat(nearest.coordinate),
      };
    }
    if (!frontier || frontier.distance > config.matchMaxDistanceM) {
      diagnostics.rejectedByDistance += 1;
      return { ...sample, valid: false, reason: 'distance' };
    }
    const angle = undirectedAngleDegrees(frontier.riverDirection, frontier.direction);
    if (angle > config.maxDirectionDeltaDeg) {
      diagnostics.rejectedByDirection += 1;
      return { ...sample, frontier, angle, valid: false, reason: 'direction' };
    }
    return { ...sample, frontier, angle, valid: true };
  });
  const runs = [];
  let current = [];
  let invalidStart = null;
  const flush = () => {
    if (current.length >= 2) {
      const runLength = current[current.length - 1].distanceAlong - current[0].distanceAlong;
      const frontierLength = parentChain.lengthM;
      const minimum = Math.min(config.minParallelRunM, Math.max(config.shortFrontierMinRunM, frontierLength * config.minRunFrontierRatio));
      if (runLength < minimum) diagnostics.rejectedByRunLength += 1;
      else if (!validateMonotonicRun(current, config)) diagnostics.rejectedByMonotonicity += 1;
      else runs.push({
        start: current[0],
        end: current[current.length - 1],
        samples: current.slice(),
        sourcePoints,
        sourceWorkspace,
        metricPoints,
        cumulative: sampled.cumulative,
        lengthM: runLength,
      });
    } else if (current.length) diagnostics.rejectedByRunLength += 1;
    current = [];
    invalidStart = null;
  };
  for (const sample of evaluated) {
    if (sample.valid) {
      if (invalidStart !== null && sample.distanceAlong - invalidStart > config.maxMatchGapM) flush();
      current.push(sample);
      invalidStart = null;
    } else if (current.length && invalidStart === null) invalidStart = sample.distanceAlong;
  }
  flush();
  return runs;
}

function pointAtDistance(points, cumulative, position) {
  const target = Math.max(0, Math.min(cumulative[cumulative.length - 1] || 0, position));
  let index = 0;
  while (index < cumulative.length - 2 && cumulative[index + 1] < target - 1e-9) index += 1;
  const span = cumulative[index + 1] - cumulative[index];
  const t = span > 1e-9 ? (target - cumulative[index]) / span : 0;
  return { coordinate: interpolate(points[index], points[index + 1], t), index, t };
}

function slicePolyline(points, cumulative, startPosition, endPosition) {
  if (endPosition < startPosition) return slicePolyline(points, cumulative, endPosition, startPosition).reverse();
  const start = pointAtDistance(points, cumulative, startPosition);
  const end = pointAtDistance(points, cumulative, endPosition);
  const output = [start.coordinate];
  for (let index = start.index + 1; index <= end.index; index += 1) {
    if (cumulative[index] > startPosition + 1e-7 && cumulative[index] < endPosition - 1e-7) output.push(points[index].slice());
  }
  output.push(end.coordinate);
  return dedupeLine(output);
}

function sliceFrontier(chain, startS, endS) {
  return slicePolyline(chain.points, chain.cumulative, startS, endS);
}

function metricRingArea(ring, workspace = createLocalMetricWorkspace(ring)) {
  const points = ring.map(workspace.toMeters);
  let sum = 0;
  for (let index = 0; index < points.length - 1; index += 1) sum += points[index][0] * points[index + 1][1] - points[index + 1][0] * points[index][1];
  return Math.abs(sum / 2);
}

function geometryAreaM2(geometry) {
  let total = 0;
  for (const polygon of polygonCoordinates(geometry)) {
    if (!polygon?.length) continue;
    const workspace = createLocalMetricWorkspace(polygon.flat());
    total += metricRingArea(closeRing(polygon[0]), workspace);
    for (const hole of polygon.slice(1)) total -= metricRingArea(closeRing(hole), workspace);
  }
  return Math.max(0, total);
}

function orientation(left, right, point) {
  return (right[0] - left[0]) * (point[1] - left[1]) - (right[1] - left[1]) * (point[0] - left[0]);
}

function segmentsIntersect(a, b, c, d, allowEndpoints = true) {
  const epsilon = 1e-7;
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);
  if (((o1 > epsilon && o2 < -epsilon) || (o1 < -epsilon && o2 > epsilon))
    && ((o3 > epsilon && o4 < -epsilon) || (o3 < -epsilon && o4 > epsilon))) return true;
  if (!allowEndpoints) return false;
  const on = (point, left, right) => Math.abs(orientation(left, right, point)) <= epsilon
    && point[0] >= Math.min(left[0], right[0]) - epsilon && point[0] <= Math.max(left[0], right[0]) + epsilon
    && point[1] >= Math.min(left[1], right[1]) - epsilon && point[1] <= Math.max(left[1], right[1]) + epsilon;
  return on(c, a, b) || on(d, a, b) || on(a, c, d) || on(b, c, d);
}

function segmentIntersection(leftA, rightA, leftB, rightB) {
  const ax = rightA[0] - leftA[0];
  const ay = rightA[1] - leftA[1];
  const bx = rightB[0] - leftB[0];
  const by = rightB[1] - leftB[1];
  const denominator = ax * by - ay * bx;
  if (Math.abs(denominator) <= 1e-9) return null;
  const dx = leftB[0] - leftA[0];
  const dy = leftB[1] - leftA[1];
  const t = (dx * by - dy * bx) / denominator;
  const u = (dx * ay - dy * ax) / denominator;
  if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return null;
  return {
    t: Math.max(0, Math.min(1, t)),
    u: Math.max(0, Math.min(1, u)),
    coordinate: [leftA[0] + ax * t, leftA[1] + ay * t],
  };
}

function actualIntersectionNear(run, chain, desiredDistance, config) {
  const searchRadius = Math.max(config.sampleSpacingM * 2, config.maxMatchGapM);
  const workspace = createLocalMetricWorkspace([...run.sourcePoints, ...chain.points]);
  const riverPoints = run.sourcePoints.map(workspace.toMeters);
  const frontierPoints = chain.points.map(workspace.toMeters);
  let best = null;
  for (let riverIndex = 0; riverIndex < riverPoints.length - 1; riverIndex += 1) {
    const riverStart = run.cumulative[riverIndex];
    const riverEnd = run.cumulative[riverIndex + 1];
    if (riverEnd < desiredDistance - searchRadius || riverStart > desiredDistance + searchRadius) continue;
    for (let frontierIndex = 0; frontierIndex < chain.metricPoints.length - 1; frontierIndex += 1) {
      const intersection = segmentIntersection(
        riverPoints[riverIndex], riverPoints[riverIndex + 1],
        frontierPoints[frontierIndex], frontierPoints[frontierIndex + 1],
      );
      if (!intersection) continue;
      const riverDistance = riverStart + (riverEnd - riverStart) * intersection.t;
      const delta = Math.abs(riverDistance - desiredDistance);
      if (delta > searchRadius || (best && best.delta <= delta)) continue;
      const frontierStart = chain.cumulative[frontierIndex];
      const frontierEnd = chain.cumulative[frontierIndex + 1];
      best = {
        delta,
        riverDistance,
        frontier: {
          coordinate: intersection.coordinate,
          lonLat: workspace.toLonLat(intersection.coordinate),
          distance: 0,
          segmentIndex: frontierIndex,
          s: frontierStart + (frontierEnd - frontierStart) * intersection.u,
        },
      };
    }
  }
  return best;
}

function ringSelfIntersects(ring, workspace) {
  const points = ring.map(workspace.toMeters);
  const count = points.length - 1;
  for (let left = 0; left < count; left += 1) for (let right = left + 1; right < count; right += 1) {
    if (right === left + 1 || (left === 0 && right === count - 1)) continue;
    if (segmentsIntersect(points[left], points[left + 1], points[right], points[right + 1])) return true;
  }
  return false;
}

function validateConnector(connector, chain, donorGeometry, targetGeometry, config) {
  const [left, right] = connector;
  const leftMetric = chain.workspace.toMeters(left);
  const rightMetric = chain.workspace.toMeters(right);
  const length = distance(leftMetric, rightMetric);
  if (length > config.connectorMaxLengthM) return { valid: false, reason: 'length', length };
  const steps = Math.max(1, Math.ceil(length / config.connectorSampleSpacingM));
  const index = chain.frontierIndex || (chain.frontierIndex = buildFrontierIndex(chain, config.frontierGridCellM));
  for (let step = 0; step <= steps; step += 1) {
    const coordinate = interpolate(left, right, step / steps);
    const metric = chain.workspace.toMeters(coordinate);
    const frontier = index.nearest(metric, config.connectorBorderCorridorM);
    const nearBorder = !!frontier && frontier.distance <= config.connectorBorderCorridorM;
    if (!pointInGeometry(coordinate, donorGeometry) && !nearBorder) return { valid: false, reason: 'outside-donor', length };
    if (pointInGeometry(coordinate, targetGeometry) && !nearBorder) return { valid: false, reason: 'inside-target', length };
  }
  return { valid: true, length };
}

function connectorCrossesPath(connector, points, workspace) {
  const [left, right] = connector.map(workspace.toMeters);
  const connectorEndpoints = [left, right];
  for (let index = 0; index < points.length - 1; index += 1) {
    const a = workspace.toMeters(points[index]);
    const b = workspace.toMeters(points[index + 1]);
    const sharedEndpoint = connectorEndpoints.some(endpoint => distance(endpoint, a) <= 1e-5 || distance(endpoint, b) <= 1e-5);
    if (segmentsIntersect(left, right, a, b, !sharedEndpoint)) return true;
  }
  return false;
}

function componentGeometries(coordinates) {
  return (coordinates || []).filter(polygon => Array.isArray(polygon) && polygon[0]?.length >= 4)
    .map(polygon => ({ type: 'Polygon', coordinates: clone(polygon) }));
}

function clipPocket(ring, donorGeometry, targetGeometry, clipper) {
  if (!clipper?.intersection || !clipper?.difference) return [{ type: 'Polygon', coordinates: [ring] }];
  let coordinates = clipper.intersection([[ring]], polygonCoordinates(donorGeometry));
  if (!coordinates?.length) return [];
  coordinates = clipper.difference(coordinates, polygonCoordinates(targetGeometry));
  return componentGeometries(coordinates);
}

function segmentRows(points) {
  return points.slice(0, -1).map((point, index) => [point.slice(), points[index + 1].slice()]);
}

function boundarySegmentsInside(points, geometry) {
  const boundary = polygonCoordinates(geometry).flatMap(polygon => polygon.flatMap(ring => segmentRows(closeRing(ring))));
  const output = [];
  for (const [left, right] of segmentRows(points)) {
    const parameters = [0, 1];
    for (const [a, b] of boundary) {
      const hit = segmentIntersection(left, right, a, b);
      if (hit && hit.t > 1e-9 && hit.t < 1 - 1e-9) parameters.push(hit.t);
    }
    parameters.sort((a, b) => a - b);
    const unique = parameters.filter((value, index) => !index || value - parameters[index - 1] > 1e-9);
    for (let index = 0; index < unique.length - 1; index += 1) {
      const start = unique[index];
      const end = unique[index + 1];
      if (end - start <= 1e-9) continue;
      if (!pointInGeometry(interpolate(left, right, (start + end) / 2), geometry)) continue;
      output.push([interpolate(left, right, start), interpolate(left, right, end)]);
    }
  }
  return output;
}

function canonicalGeometryKey(geometry) {
  const rings = polygonCoordinates(geometry).flatMap(polygon => polygon.map(ring => {
    const values = closeRing(ring).slice(0, -1).map(point => coordinateKey(point));
    if (!values.length) return '';
    const rotations = list => list.map((_, index) => [...list.slice(index), ...list.slice(0, index)].join('|'));
    return [...rotations(values), ...rotations(values.slice().reverse())].sort()[0];
  })).sort();
  return rings.join('||');
}

function sourceIdsForRiver(river) {
  const sourceIds = String(river?.properties?.source_id || '').split(',').map(value => value.trim()).filter(Boolean);
  return sourceIds.length ? [...new Set(sourceIds)].sort() : [String(river?.properties?.pandolab_id || river?.id || '')].filter(Boolean);
}

function logicalIdsForRiver(river) {
  const logical = river?.properties?.source_logical_id
    ?? river?.properties?.__sourceLogicalId
    ?? river?.properties?.__logicalFid
    ?? river?.properties?.pandolab_id
    ?? river?.id;
  return logical == null || logical === '' ? [] : [String(logical)];
}

function configFingerprint(config) {
  return stableTextHash(Object.keys(config).sort().map(key => `${key}:${config[key]}`).join('|'));
}

export function riverAnnexConfigFingerprint(config = RIVER_ANNEX_CONFIG) {
  return configFingerprint({ ...RIVER_ANNEX_CONFIG, ...(config || {}) });
}

function createDiagnostics(sourceDiagnostics = {}) {
  return {
    scannedDonors: 0,
    frontierChainCount: 0,
    frontierWindowCount: 0,
    discoveredLogicalRivers: Number(sourceDiagnostics.discoveredLogicalRivers || 0),
    loadedRivers: Number(sourceDiagnostics.loadedRivers || 0),
    failedRiverLoads: Number(sourceDiagnostics.failedRiverLoads || 0),
    scannedRiverParts: 0,
    scannedRiverSamples: 0,
    matchedParallelRuns: 0,
    rejectedByDistance: 0,
    rejectedByDirection: 0,
    rejectedByRunLength: 0,
    rejectedByMonotonicity: 0,
    rejectedByConnectorLength: 0,
    rejectedByConnectorGeometry: 0,
    rejectedSelfIntersection: 0,
    rejectedOutsideDonor: 0,
    rejectedBelowArea: 0,
    candidateCount: 0,
    computeMs: 0,
    ...sourceDiagnostics,
  };
}

export function buildMetricRiverAnnexCandidates({
  targetFeature = null,
  donorFrontiers = [],
  riverFeatures = [],
  topologyRevision = '',
  clipper = null,
  config: configInput = null,
  algorithmRevision = RIVER_ANNEX_ALGORITHM_REVISION,
  sourceDiagnostics = {},
} = {}) {
  const startedAt = globalThis.performance?.now?.() ?? Date.now();
  const config = Object.freeze({ ...RIVER_ANNEX_CONFIG, ...(configInput || {}) });
  const diagnostics = createDiagnostics(sourceDiagnostics);
  diagnostics.loadedRivers = Math.max(diagnostics.loadedRivers, riverFeatures.length);
  if (!targetFeature?.geometry || !polygonCoordinates(targetFeature.geometry).length) {
    diagnostics.reason = 'missing-target';
    return { candidates: [], diagnostics };
  }
  const candidates = [];
  const seen = new Set();
  const topologyKey = stableTextHash(String(topologyRevision));
  const configKey = configFingerprint(config);
  for (const row of donorFrontiers) {
    const donorFeature = row?.donorFeature;
    const donorCountryId = String(donorFeature?.properties?.editor_id || donorFeature?.id || '');
    if (!donorCountryId || !donorFeature?.geometry || !row?.segments?.length) continue;
    const chains = buildSharedFrontierChains(row.segments);
    if (!chains.length) continue;
    const windowsByChain = new Map(chains.map(chain => [chain.key, buildWorkingWindows(chain, config)]));
    diagnostics.scannedDonors += 1;
    diagnostics.frontierChainCount += chains.length;
    diagnostics.frontierWindowCount += [...windowsByChain.values()].reduce((sum, windows) => sum + windows.length, 0);
    for (const river of riverFeatures) {
      const riverParts = lineParts(river?.geometry).map(dedupeLine).filter(part => part.length >= 2);
      if (!riverParts.length) continue;
      const sourceRiverIds = sourceIdsForRiver(river);
      const sourceLogicalRiverIds = logicalIdsForRiver(river);
      for (const sourcePoints of riverParts) {
        diagnostics.scannedRiverParts += 1;
        for (const chain of chains) {
          const runs = matchRunsForPart(sourcePoints, chain, windowsByChain.get(chain.key) || [chain], config, diagnostics);
          for (const run of runs) {
            diagnostics.matchedParallelRuns += 1;
            const startIntersection = actualIntersectionNear(run, chain, run.start.distanceAlong, config);
            const endIntersection = actualIntersectionNear(run, chain, run.end.distanceAlong, config);
            const startAnchor = startIntersection?.frontier || run.start.frontier;
            const endAnchor = endIntersection?.frontier || run.end.frontier;
            const riverStartDistance = startIntersection?.riverDistance ?? run.start.distanceAlong;
            const riverEndDistance = endIntersection?.riverDistance ?? run.end.distanceAlong;
            if (Math.abs(riverEndDistance - riverStartDistance) < 1e-6 || Math.abs(endAnchor.s - startAnchor.s) < 1e-6) {
              diagnostics.rejectedByRunLength += 1;
              continue;
            }
            const riverForwardMetric = slicePolyline(run.metricPoints, run.cumulative, riverStartDistance, riverEndDistance);
            const riverForward = riverForwardMetric.map(run.sourceWorkspace.toLonLat);
            const frontierForward = sliceFrontier(chain, startAnchor.s, endAnchor.s);
            if (riverForward.length < 2 || frontierForward.length < 2) {
              diagnostics.rejectedByRunLength += 1;
              continue;
            }
            const frontierStart = frontierForward[0];
            const frontierEnd = frontierForward[frontierForward.length - 1];
            const riverStart = riverForward[0];
            const riverEnd = riverForward[riverForward.length - 1];
            const candidateWorkspace = createLocalMetricWorkspace([...frontierForward, ...riverForward]);
            const candidateMetricPoints = frontierForward.map(candidateWorkspace.toMeters);
            const candidateCumulative = lineCumulative(candidateMetricPoints);
            const candidateChain = {
              ...chain,
              points: frontierForward,
              workspace: candidateWorkspace,
              metricPoints: candidateMetricPoints,
              cumulative: candidateCumulative,
              lengthM: candidateCumulative[candidateCumulative.length - 1] || 0,
              frontierIndex: null,
            };
            const connectors = [];
            const startDistance = distance(candidateWorkspace.toMeters(frontierStart), candidateWorkspace.toMeters(riverStart));
            const endDistance = distance(candidateWorkspace.toMeters(frontierEnd), candidateWorkspace.toMeters(riverEnd));
            const normalizedRiver = riverForward.map(point => point.slice());
            if (startDistance <= config.exactJoinToleranceM) normalizedRiver[0] = frontierStart.slice();
            else connectors.push([riverStart.slice(), frontierStart.slice()]);
            if (endDistance <= config.exactJoinToleranceM) normalizedRiver[normalizedRiver.length - 1] = frontierEnd.slice();
            else connectors.push([frontierEnd.slice(), riverEnd.slice()]);
            let connectorsValid = true;
            for (const connector of connectors) {
              const validation = validateConnector(connector, candidateChain, donorFeature.geometry, targetFeature.geometry, config);
              if (!validation.valid) {
                if (validation.reason === 'length') diagnostics.rejectedByConnectorLength += 1;
                else if (validation.reason === 'outside-donor') diagnostics.rejectedOutsideDonor += 1;
                else diagnostics.rejectedByConnectorGeometry += 1;
                connectorsValid = false;
                break;
              }
            }
            if (!connectorsValid) continue;
            if (connectors.length === 2) {
              const metricConnectors = connectors.map(connector => connector.map(candidateWorkspace.toMeters));
              if (segmentsIntersect(metricConnectors[0][0], metricConnectors[0][1], metricConnectors[1][0], metricConnectors[1][1], false)) {
                diagnostics.rejectedByConnectorGeometry += 1;
                continue;
              }
            }
            if (connectors.some(connector => (
              connectorCrossesPath(connector, frontierForward, candidateWorkspace)
              || connectorCrossesPath(connector, normalizedRiver, candidateWorkspace)
            ))) {
              diagnostics.rejectedByConnectorGeometry += 1;
              continue;
            }
            const ring = closeRing([
              ...frontierForward,
              ...normalizedRiver.slice().reverse(),
            ]);
            if (ring.length < 4 || ringSelfIntersects(ring, candidateWorkspace)) {
              diagnostics.rejectedSelfIntersection += 1;
              continue;
            }
            if (metricRingArea(ring, candidateWorkspace) < config.minCandidateAreaM2) {
              diagnostics.rejectedBelowArea += 1;
              continue;
            }
            const components = clipPocket(ring, donorFeature.geometry, targetFeature.geometry, clipper);
            if (!components.length) {
              diagnostics.rejectedOutsideDonor += 1;
              continue;
            }
            for (const geometry of components) {
              const areaM2 = geometryAreaM2(geometry);
              if (areaM2 < config.minCandidateAreaM2) {
                diagnostics.rejectedBelowArea += 1;
                continue;
              }
              const riverBoundarySegments = boundarySegmentsInside(normalizedRiver, geometry);
              const sharedBorderSegments = boundarySegmentsInside(frontierForward, geometry);
              if (!riverBoundarySegments.length || !sharedBorderSegments.length) {
                diagnostics.rejectedOutsideDonor += 1;
                continue;
              }
              const anchorStart = Math.round(startAnchor.s / config.anchorQuantizationM);
              const anchorEnd = Math.round(endAnchor.s / config.anchorQuantizationM);
              const geometryKey = canonicalGeometryKey(geometry);
              const keySeed = [
                donorCountryId,
                sourceLogicalRiverIds.join(','),
                chain.key,
                Math.min(anchorStart, anchorEnd),
                Math.max(anchorStart, anchorEnd),
                geometryKey,
                algorithmRevision,
                configKey,
              ].join(':');
              const dedupeKey = `${donorCountryId}:${geometryKey}`;
              if (seen.has(dedupeKey)) continue;
              seen.add(dedupeKey);
              candidates.push({
                key: `${donorCountryId}:${sourceLogicalRiverIds.join(',') || 'river'}:${stableTextHash(keySeed)}`,
                donorCountryId,
                geometry,
                areaM2,
                area: areaM2,
                riverBoundarySegments,
                sharedBorderSegments,
                sourceRiverIds,
                sourceLogicalRiverIds,
                topologyRevision: topologyKey,
                algorithmRevision,
                connectorSegments: connectors.map(connector => connector.map(point => point.slice())),
              });
            }
          }
        }
      }
    }
  }
  candidates.sort((left, right) => left.key.localeCompare(right.key));
  diagnostics.candidateCount = candidates.length;
  diagnostics.computeMs = (globalThis.performance?.now?.() ?? Date.now()) - startedAt;
  return { candidates, diagnostics };
}
