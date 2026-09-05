const RENDERER_V2_PASS_IDS = Object.freeze({
  TERRAIN: 'terrain',
  COUNTRY_FILL: 'country-fill',
  DISTRIBUTION_FILL: 'distribution-fill',
  HYDRO: 'hydro',
  BASE_BOUNDARIES: 'base-boundaries',
  TERRITORIAL_BOUNDARIES: 'territorial-boundaries',
  SELECTION_FILL: 'selection-fill',
  SELECTION_STROKE: 'selection-stroke',
  EDIT_PREVIEW: 'edit-preview',
  PICKING: 'picking',
});

export const RENDERER_V2_PASSES = Object.freeze([
  Object.freeze({ id: RENDERER_V2_PASS_IDS.TERRAIN, order: 10, phase: 'scene', geometry: 'physical' }),
  Object.freeze({ id: RENDERER_V2_PASS_IDS.COUNTRY_FILL, order: 20, phase: 'scene', geometry: 'polygon' }),
  Object.freeze({ id: RENDERER_V2_PASS_IDS.DISTRIBUTION_FILL, order: 30, phase: 'scene', geometry: 'polygon' }),
  Object.freeze({ id: RENDERER_V2_PASS_IDS.HYDRO, order: 40, phase: 'scene', geometry: 'physical' }),
  Object.freeze({ id: RENDERER_V2_PASS_IDS.BASE_BOUNDARIES, order: 50, phase: 'scene', geometry: 'stroke' }),
  Object.freeze({ id: RENDERER_V2_PASS_IDS.TERRITORIAL_BOUNDARIES, order: 60, phase: 'scene', geometry: 'stroke' }),
  Object.freeze({ id: RENDERER_V2_PASS_IDS.SELECTION_FILL, order: 70, phase: 'interaction', geometry: 'polygon' }),
  Object.freeze({ id: RENDERER_V2_PASS_IDS.SELECTION_STROKE, order: 80, phase: 'interaction', geometry: 'stroke' }),
  Object.freeze({ id: RENDERER_V2_PASS_IDS.EDIT_PREVIEW, order: 90, phase: 'interaction', geometry: 'stroke' }),
  Object.freeze({ id: RENDERER_V2_PASS_IDS.PICKING, order: 100, phase: 'picking', geometry: 'id-buffer' }),
]);

export const RENDERER_V2_STROKE_QUALITY = Object.freeze({
  widthSpace: 'css-pixel',
  geometrySpace: 'geographic',
  connectedTopology: true,
  analyticAa: true,
  aaRadiusPx: 1,
  caps: Object.freeze(['round', 'butt']),
  joins: Object.freeze(['round', 'miter', 'bevel']),
  miterFallback: 'bevel',
  viewRebuildsGeometry: false,
});

export const RENDERER_V2_RUNTIME_CONTRACT = Object.freeze({
  webGlContextCount: 1,
  renderSceneImmutable: true,
  geometryWorkerCompiled: true,
  viewStateUsesUniforms: true,
  canonicalGeometryIsNeverLodMutated: true,
  canvasFallbackConsumesCanonicalState: true,
});

export function validateRendererV2PassOrder(passes = RENDERER_V2_PASSES) {
  const ids = new Set();
  let previousOrder = -Infinity;
  for (const pass of passes || []) {
    if (!pass?.id || ids.has(pass.id)) return false;
    if (!Number.isFinite(Number(pass.order)) || Number(pass.order) <= previousOrder) return false;
    ids.add(pass.id);
    previousOrder = Number(pass.order);
  }
  return ids.size === RENDERER_V2_PASSES.length;
}

export function rendererV2FramePlan({
  sceneChanged = false,
  interactionChanged = false,
  editPreviewChanged = false,
  picking = false,
} = {}) {
  const phases = new Set();
  if (sceneChanged) phases.add('scene');
  if (interactionChanged || editPreviewChanged) phases.add('interaction');
  if (picking) phases.add('picking');
  return Object.freeze(RENDERER_V2_PASSES.filter(pass => phases.has(pass.phase)));
}
