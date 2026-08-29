export const DRAWING_SCHEMA_VERSION = 1;
export const DRAWING_CATEGORY_RULES = Object.freeze({
  custom: Object.freeze({ role: 'custom', geometry: 'any', binding: 'none', label: '사용자 정의' }),
});
export const DRAWING_ROLE_LABELS = Object.freeze({ custom: '사용자 정의' });

const text = value => String(value ?? '').trim();

export function drawingGeometryKind(feature) {
  const type = feature?.geometry?.type || '';
  if (type === 'Polygon' || type === 'MultiPolygon') return 'polygon';
  if (type === 'LineString' || type === 'MultiLineString') return 'line';
  if (type === 'Point' || type === 'MultiPoint') return 'point';
  return 'unknown';
}

export function drawingCategoryRule(category) {
  return DRAWING_CATEGORY_RULES[category] || DRAWING_CATEGORY_RULES.custom;
}

export function drawingCategoryCompatible(feature, category) {
  const expected = drawingCategoryRule(category).geometry;
  return expected === 'any' || expected === drawingGeometryKind(feature);
}

export function drawingRole(feature) {
  return feature?.properties?.pandolab_role || drawingCategoryRule(feature?.properties?.category).role;
}

export function drawingLandBinding(feature) {
  return feature?.properties?.pandolab_land_binding || drawingCategoryRule(feature?.properties?.category).binding;
}

export function normalizeDrawingSemantics(feature) {
  if (!feature) return feature;
  feature.properties ||= {};
  const properties = feature.properties;
  delete properties.visible;
  let category = DRAWING_CATEGORY_RULES[properties.category] ? properties.category : 'custom';
  if (!drawingCategoryCompatible(feature, category)) category = 'custom';
  const rule = drawingCategoryRule(category);
  properties.category = category;
  delete properties.pandolab_folder_id;
  properties.pandolab_schema_version = DRAWING_SCHEMA_VERSION;
  properties.pandolab_role = rule.role;
  const allowedBindings = new Set(['none', 'clip']);
  const requestedBinding = String(properties.pandolab_land_binding || rule.binding);
  properties.pandolab_land_binding = allowedBindings.has(requestedBinding) ? requestedBinding : rule.binding;
  properties.pandolab_owner_id = '';
  properties.pandolab_parent_id = '';
  properties.pandolab_topology_group = `${rule.role}:${category}`;
  return feature;
}

export function normalizeDrawingCollection(drawings) {
  const output = [];
  const seen = new Set();
  for (const feature of Array.isArray(drawings) ? drawings : []) {
    const id = text(feature?.id);
    if (!id) throw new Error('지형지물 ID가 비어 있습니다.');
    if (seen.has(id)) throw new Error(`지형지물 ID가 중복되었습니다: ${id}`);
    if (!['Point', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon'].includes(feature?.geometry?.type)
      || !Array.isArray(feature.geometry.coordinates) || !feature.geometry.coordinates.length) {
      throw new Error(`${id}의 지형지물 geometry가 비어 있거나 지원되지 않습니다.`);
    }
    seen.add(id);
    output.push(normalizeDrawingSemantics(feature));
  }
  return output;
}

export function createDrawingService({ documentStore, runDocumentMutation, writeColor }) {
  const drawings = () => documentStore.readDrawings();
  const get = id => drawings().find(feature => text(feature.id) === text(id)) || null;

  function add(feature) {
    const normalized = normalizeDrawingSemantics(feature);
    if (get(normalized.id)) throw new Error(`지형지물 ID가 중복되었습니다: ${normalized.id}`);
    runDocumentMutation({ type: 'drawing-create', affectedIds: [text(normalized.id)] }, () => {
      documentStore.replaceDrawings(normalizeDrawingCollection([...drawings(), normalized]));
    });
    return get(normalized.id);
  }

  function addMany(features) {
    const normalized = normalizeDrawingCollection(features);
    runDocumentMutation({ type: 'drawing-import', affectedIds: normalized.map(feature => text(feature.id)) }, () => {
      documentStore.replaceDrawings(normalizeDrawingCollection([...drawings(), ...normalized]));
    });
    return normalized.map(feature => get(feature.id));
  }

  function updateMetadata(id, field, value) {
    const current = get(id);
    if (!current) return { ok: false, code: 'not-found' };
    runDocumentMutation({ type: 'drawing-metadata', affectedIds: [text(current.id)] }, () => {
      if (field === 'editorColor') writeColor(current, value);
      else current.properties[field] = value;
      if (['category', 'pandolab_owner_id', 'pandolab_parent_id', 'pandolab_land_binding'].includes(field)) {
        normalizeDrawingSemantics(current);
      }
    });
    return { ok: true, feature: current };
  }

  function remove(id, { beforeRemove = () => {} } = {}) {
    const feature = get(id);
    if (!feature) return { ok: false, code: 'not-found' };
    runDocumentMutation({ type: 'drawing-delete', affectedIds: [text(feature.id)] }, () => {
      beforeRemove(feature);
      documentStore.replaceDrawings(drawings().filter(candidate => text(candidate.id) !== text(feature.id)));
    });
    return { ok: true, feature };
  }

  return Object.freeze({ get, list: () => drawings(), add, addMany, updateMetadata, remove });
}
