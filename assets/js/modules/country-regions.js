export const COUNTRY_REGION_SCHEMA_VERSION = 1;

export const COUNTRY_REGION_KINDS = Object.freeze({
  REGION: 'region',
  ADMINISTRATIVE: 'administrative',
});

export const COUNTRY_REGION_STATUS = Object.freeze({
  ASSIGNED: 'assigned',
  UNASSIGNED: 'unassigned',
});

const POLYGON_TYPES = new Set(['Polygon', 'MultiPolygon']);

const text = value => String(value ?? '').trim();

export function countryRegionKind(feature) {
  const properties = feature?.properties || {};
  const value = text(properties.kind).toLowerCase();
  if (value === 'administrative') return COUNTRY_REGION_KINDS.ADMINISTRATIVE;
  if (value === 'region') return COUNTRY_REGION_KINDS.REGION;
  return '';
}

export function isCountryRegionFeature(feature) {
  return !!countryRegionKind(feature) && POLYGON_TYPES.has(feature?.geometry?.type);
}

function normalizedProperties(feature, kind) {
  const source = feature?.properties || {};
  const countryId = text(source.countryId);
  const parentRegionId = text(source.parentRegionId);
  const status = source.status === COUNTRY_REGION_STATUS.UNASSIGNED || !countryId
    ? COUNTRY_REGION_STATUS.UNASSIGNED
    : COUNTRY_REGION_STATUS.ASSIGNED;
  const properties = {
    ...source,
    schemaVersion: COUNTRY_REGION_SCHEMA_VERSION,
    kind,
    countryId,
    parentRegionId: kind === COUNTRY_REGION_KINDS.ADMINISTRATIVE ? parentRegionId : '',
    level: kind === COUNTRY_REGION_KINDS.ADMINISTRATIVE
      ? Math.max(1, Number.parseInt(source.level, 10) || 1)
      : null,
    status,
    name: text(source.name),
    notes: text(source.notes),
    sourceFolderId: text(source.sourceFolderId),
  };
  const color = text(source.color);
  if (color) properties.color = color;
  else delete properties.color;
  return properties;
}

export function normalizeCountryRegionFeature(feature, { makeId } = {}) {
  if (!isCountryRegionFeature(feature)) return null;
  const kind = countryRegionKind(feature);
  const id = text(feature.id || feature.properties?.id || feature.properties?.aw_id)
    || (typeof makeId === 'function' ? text(makeId(kind)) : '');
  if (!id) return null;
  return {
    type: 'Feature',
    id,
    properties: normalizedProperties(feature, kind),
    geometry: structuredClone(feature.geometry),
  };
}

function parentCreatesCycle(id, parentId, byId) {
  let cursor = text(parentId);
  const seen = new Set([text(id)]);
  while (cursor) {
    if (seen.has(cursor)) return true;
    seen.add(cursor);
    cursor = text(byId.get(cursor)?.properties?.parentRegionId);
  }
  return false;
}

export function normalizeCountryRegions(value, {
  countryExists = () => true,
  makeId,
} = {}) {
  const normalized = [];
  const seen = new Set();
  for (const raw of Array.isArray(value) ? value : []) {
    const feature = normalizeCountryRegionFeature(raw, { makeId });
    if (!feature || seen.has(feature.id)) continue;
    seen.add(feature.id);
    normalized.push(feature);
  }

  const byId = new Map(normalized.map(feature => [feature.id, feature]));
  for (const feature of normalized) {
    const properties = feature.properties;
    if (!properties.countryId || !countryExists(properties.countryId)) {
      properties.countryId = '';
      properties.status = COUNTRY_REGION_STATUS.UNASSIGNED;
    }
    if (properties.kind === COUNTRY_REGION_KINDS.REGION) {
      properties.parentRegionId = '';
      properties.level = null;
      continue;
    }
    const parent = byId.get(properties.parentRegionId);
    const compatibleParent = properties.countryId && parent
      && parent.id !== feature.id
      && parent.properties.countryId === properties.countryId
      && !parentCreatesCycle(feature.id, parent.id, byId);
    if (!compatibleParent) {
      properties.parentRegionId = '';
      properties.level = 1;
    }
  }

  const levelCache = new Map();
  const resolveLevel = feature => {
    if (feature.properties.kind !== COUNTRY_REGION_KINDS.ADMINISTRATIVE) return null;
    if (levelCache.has(feature.id)) return levelCache.get(feature.id);
    const parent = byId.get(feature.properties.parentRegionId);
    const level = !parent
      ? 1
      : parent.properties.kind === COUNTRY_REGION_KINDS.REGION
        ? 2
        : resolveLevel(parent) + 1;
    levelCache.set(feature.id, level);
    return level;
  };
  for (const feature of normalized) {
    if (feature.properties.kind === COUNTRY_REGION_KINDS.ADMINISTRATIVE) feature.properties.level = resolveLevel(feature);
  }
  return normalized;
}

export function countryRegionChildren(regions, id) {
  const key = text(id);
  return (regions || []).filter(feature => text(feature.properties?.parentRegionId) === key);
}

export function countryRegionSiblings(regions, source) {
  if (!source) return [];
  const properties = source.properties || {};
  return (regions || []).filter(candidate => candidate.id !== source.id
    && candidate.properties?.kind === properties.kind
    && text(candidate.properties?.countryId) === text(properties.countryId)
    && text(candidate.properties?.parentRegionId) === text(properties.parentRegionId)
    && Number(candidate.properties?.level || 0) === Number(properties.level || 0));
}

export function validateCountryRegionRelations(regions, { countryExists = () => true } = {}) {
  const issues = [];
  const byId = new Map((regions || []).map(feature => [text(feature.id), feature]));
  for (const feature of regions || []) {
    const id = text(feature.id);
    const properties = feature.properties || {};
    if (!id) issues.push('영역 ID가 비어 있습니다.');
    if (!POLYGON_TYPES.has(feature.geometry?.type)) issues.push(`${id || '영역'}의 형상이 Polygon이 아닙니다.`);
    if (properties.countryId && !countryExists(properties.countryId)) issues.push(`${id}의 소속 국가가 존재하지 않습니다.`);
    if (properties.kind !== COUNTRY_REGION_KINDS.ADMINISTRATIVE) {
      if (text(properties.parentRegionId)) issues.push(`${id} 지역은 상위 영역을 가질 수 없습니다.`);
      continue;
    }
    const parentId = text(properties.parentRegionId);
    if (!parentId) {
      if (Number(properties.level) !== 1) issues.push(`${id}의 국가 직속 행정 단계가 1급이 아닙니다.`);
      continue;
    }
    const parent = byId.get(parentId);
    if (!parent) issues.push(`${id}의 상위 영역이 존재하지 않습니다.`);
    else if (text(parent.properties?.countryId) !== text(properties.countryId)) issues.push(`${id}와 상위 영역의 국가가 다릅니다.`);
    else if (parentCreatesCycle(id, parentId, byId)) issues.push(`${id}의 상위 관계가 순환합니다.`);
    else {
      const expectedLevel = parent.properties?.kind === COUNTRY_REGION_KINDS.REGION
        ? 2
        : Math.max(1, Number(parent.properties?.level) || 1) + 1;
      if (Number(properties.level) !== expectedLevel) issues.push(`${id}의 행정 단계가 상위 영역과 일치하지 않습니다.`);
    }
  }
  return { ok: issues.length === 0, issues };
}

export function createCountryRegionFeature({
  id,
  kind,
  countryId = '',
  parentRegionId = '',
  level = null,
  status,
  name = '',
  color = '',
  notes = '',
  sourceFolderId = '',
  geometry,
}) {
  const feature = normalizeCountryRegionFeature({
    type: 'Feature',
    id,
    properties: {
      kind,
      countryId,
      parentRegionId,
      level,
      status: status || (countryId ? COUNTRY_REGION_STATUS.ASSIGNED : COUNTRY_REGION_STATUS.UNASSIGNED),
      name,
      color,
      notes,
      sourceFolderId,
    },
    geometry,
  });
  if (!feature) throw new Error('지역 또는 행정구역 형식이 올바르지 않습니다.');
  return feature;
}

export async function runCountryRegionTransaction({
  snapshot,
  calculate,
  validate = () => ({ ok: true }),
  apply,
  restore,
  recordHistory,
  autosave,
}) {
  const before = snapshot();
  try {
    const result = await calculate();
    const validation = await validate(result);
    if (validation === false || validation?.ok === false) {
      throw new Error(validation?.message || validation?.issues?.[0] || '국가 영역 관계가 올바르지 않습니다.');
    }
    await apply(result);
    recordHistory(before);
    autosave();
    return result;
  } catch (error) {
    await restore(before);
    throw error;
  }
}
