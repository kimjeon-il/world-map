import { installBoundaryGhostingGuard } from './boundary-ghosting-guard.js';
import { installObjectRegistryPresenter } from './object-registry-presenter.js';
import { createSemanticIcon } from './icon-utils.js';

installBoundaryGhostingGuard();

const UI_V2_STYLES = Object.freeze([
  '../../css/tokens/ui-v2.css',
  '../../css/primitives/controls.css',
  '../../css/components/surface.css',
  '../../css/components/content.css',
  '../../css/components/command-row.css',
  '../../css/components/workflow.css',
  '../../css/layout/surfaces.css',
  '../../css/features/layer-panel.css',
  '../../css/features/editor-shell.css',
  '../../css/features/map-create-panel.css',
]);

const COMMAND_ROW_ICON_BY_ID = Object.freeze({
  multiBorderEditBtn: 'boundary',
  annexTerritoryBtn: 'transfer',
  mergeCountryBtn: 'merge',
  editBorderBtn: 'boundary',
  editCoastBtn: 'coastline',
  changeCountryTypeBtn: 'transform',

  reassignTerritoryShapeBtn: 'boundary',
  mergeTerritoryBtn: 'merge',
  splitTerritoryBtn: 'split',
  transferTerritoryBtn: 'transfer',
  changeTerritoryTypeBtn: 'transform',
  promoteTerritoryBtn: 'country',
  removeTerritoryDivisionBtn: 'merge',

  reassignAdministrativeShapeBtn: 'boundary',
  reconcileAdministrativeCoastBtn: 'coastline',
  mergeAdministrativeBtn: 'merge',
  splitAdministrativeBtn: 'split',
  transferAdministrativeBtn: 'transfer',
  changeAdministrativeTypeBtn: 'transform',
  promoteAdministrativeBtn: 'country',
  removeAdministrativeDivisionBtn: 'merge',

  reassignRegionShapeBtn: 'boundary',
  mergeRegionBtn: 'merge',
  transferRegionBtn: 'transfer',

  addTerritorialDistributionBtn: 'add',
  addGeometryDistributionBtn: 'boundary',
  editGenericFeatureBoundaryBtn: 'boundary',
  mergeGenericFeatureBtn: 'merge',
  splitGenericFeatureBtn: 'split',
  syncGenericFeatureCoastBtn: 'coastline',
  editGenericFeatureCoastBtn: 'coastline',
  applyGenericFeatureToCountryBtn: 'transfer',
  promoteGenericFeatureToCountryBtn: 'country',
});

function installUiV2Styles() {
  const revision = String(globalThis.PANDOLAB_ASSET_REVISION || '').trim();
  for (const relativePath of UI_V2_STYLES) {
    const key = relativePath.replace('../../css/', '').replace(/\.css$/, '').replaceAll('/', '-');
    if (document.querySelector(`link[data-pandolab-ui-v2="${key}"]`)) continue;
    const href = new URL(relativePath, import.meta.url);
    if (revision) href.searchParams.set('v', revision);
    const style = document.createElement('link');
    style.rel = 'stylesheet';
    style.href = href.href;
    style.dataset.pandolabUiV2 = key;
    document.head.appendChild(style);
  }
}

function commandRowChevron() {
  return createSemanticIcon(document, 'chevronRight', 'ui-icon command-row-chevron');
}

function normalizeCommandRows() {
  for (const [id, semanticIcon] of Object.entries(COMMAND_ROW_ICON_BY_ID)) {
    const row = document.getElementById(id);
    if (!(row instanceof HTMLElement)) continue;

    row.classList.add('has-command-row-icon');

    const nextIcon = createSemanticIcon(document, semanticIcon, 'ui-icon command-row-icon');
    const currentIcon = row.querySelector(':scope > .command-row-icon');
    if (currentIcon) currentIcon.replaceWith(nextIcon);
    else row.prepend(nextIcon);

    const directIcons = Array.from(row.children).filter(node => node instanceof SVGElement && node !== nextIcon);
    const trailing = directIcons.at(-1);
    if (trailing) trailing.replaceWith(commandRowChevron());
    else row.appendChild(commandRowChevron());
  }
}

function normalizeMapCreateSurfaceLabels() {
  const mapSheetTitle = document.getElementById('mapSheetTitle');
  if (mapSheetTitle) mapSheetTitle.textContent = '지도';

  const mapViewTab = document.getElementById('mapViewTabBtn');
  if (mapViewTab) mapViewTab.textContent = '지도';

  const terrainTitle = document.getElementById('terrainLayerSettingsTitle');
  if (terrainTitle) terrainTitle.textContent = '지형';

  const projectionControl = document.getElementById('projectionControl');
  if (projectionControl) projectionControl.setAttribute('aria-label', '투영법');
}

function removeRedundantEditorEdge() {
  document.querySelector('.editor-edge-slot')?.remove();
}

function removeDecorativeOnlyNodes() {
  document.querySelectorAll('.ui-dialog-kicker, .create-toolbar-divider').forEach(node => node.remove());
}

function flattenHistoricalPreview() {
  document.getElementById('historicalLibraryPreview')?.classList.remove('ui-card');
}

function constrainGenericFallbackUi() {
  const form = document.getElementById('genericFeatureProperties');
  if (form) form.dataset.genericFeatureMode = 'fallback';
  for (const id of ['genericFeatureLandRelationSection', 'genericFeatureLandActionsSection']) {
    const section = document.getElementById(id);
    if (!section) continue;
    section.hidden = false;
    section.removeAttribute('aria-hidden');
    delete section.dataset.legacyGenericSemantics;
  }
}

function normalizeEmptyConditionalSurfaces() {
  const selectors = [
    '.gis-import-status',
    '.territorial-type-impact',
    '.ui-callout',
    '.ui-alert',
  ];
  for (const selector of selectors) {
    document.querySelectorAll(selector).forEach(node => {
      if (!node.textContent?.trim() && !node.children.length) node.hidden = true;
    });
  }
}

function markPhaseApplied() {
  const app = document.getElementById('app');
  if (app) {
    app.dataset.uiCleanupPhase = '1';
    app.dataset.uiArchitecture = '2';
  }
}

export function applyPhase1UiCleanup() {
  if (document.documentElement.dataset.pandolabUiCleanupPhase1 === 'done') return;
  document.documentElement.dataset.pandolabUiCleanupPhase1 = 'done';

  installUiV2Styles();
  installObjectRegistryPresenter();
  normalizeCommandRows();
  normalizeMapCreateSurfaceLabels();
  removeRedundantEditorEdge();
  removeDecorativeOnlyNodes();
  flattenHistoricalPreview();
  constrainGenericFallbackUi();
  normalizeEmptyConditionalSurfaces();
  markPhaseApplied();
}
