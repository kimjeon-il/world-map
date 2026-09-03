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
  '../../css/features/edit-workflow.css',
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

const COAST_DECISION_DETAIL_BY_ID = Object.freeze({
  coastReconciliationCountryBtn: '국가 해안선을 기준으로 가져온 영역을 맞춥니다.',
  coastReconciliationAdminBtn: '가져온 영역의 해안선을 기준으로 국가 쪽을 맞춥니다.',
  coastReconciliationIndependentBtn: '두 형상을 변경하지 않고 독립적으로 유지합니다.',
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

function workflowSemanticFromLabel(label, fallback = 'boundary') {
  const text = String(label || '');
  if (/삭제/.test(text)) return 'delete';
  if (/종류/.test(text)) return 'transform';
  if (/편입|소속|반영/.test(text)) return 'transfer';
  if (/합병|합치기/.test(text)) return 'merge';
  if (/나누기|분할/.test(text)) return 'split';
  if (/해안/.test(text)) return 'coastline';
  if (/국경|경계/.test(text)) return 'boundary';
  if (/국가로 전환|국가 추가|새 국가/.test(text)) return 'country';
  if (/구분 해제/.test(text)) return 'close';
  return fallback;
}

function replaceWorkflowIcon(host, semantic, className) {
  if (!(host instanceof Element)) return null;
  const next = createSemanticIcon(document, semantic, className);
  const current = host.querySelector(`:scope > .${className.split(' ').at(-1)}`);
  if (current) current.replaceWith(next);
  else host.prepend(next);
  return next;
}

function normalizeMapEditingWorkflow() {
  const hud = document.getElementById('modeEditingHud');
  const heading = hud?.querySelector('.mode-task-heading');
  const title = document.getElementById('modeTaskName');
  if (!(hud instanceof HTMLElement) || !(heading instanceof HTMLElement) || !(title instanceof HTMLElement)) return;

  hud.classList.add('workflow-map-session');
  hud.setAttribute('aria-labelledby', 'modeTaskName');
  hud.removeAttribute('aria-label');

  const syncIcon = () => {
    replaceWorkflowIcon(heading, workflowSemanticFromLabel(title.textContent), 'ui-icon mode-task-icon');
  };
  syncIcon();
  new MutationObserver(syncIcon).observe(title, { childList: true, characterData: true, subtree: true });

  document.getElementById('modeActionBar')?.classList.add('workflow-actions');
  document.getElementById('geometryPreviewSummary')?.classList.add('workflow-impact');
}

function normalizeWorkflowDialog({ modalId, cardSelector, variant, semantic, titleId, descriptionId }) {
  const modal = document.getElementById(modalId);
  const card = modal?.querySelector(cardSelector);
  const title = titleId ? document.getElementById(titleId) : card?.querySelector(':scope > h2');
  if (!(modal instanceof HTMLElement) || !(card instanceof HTMLElement)) return null;

  card.classList.add('workflow-dialog-card', `workflow-dialog--${variant}`);
  if (title instanceof HTMLElement) title.classList.add('workflow-dialog-title');
  if (descriptionId && document.getElementById(descriptionId)) modal.setAttribute('aria-describedby', descriptionId);
  if (semantic) replaceWorkflowIcon(card, semantic, 'ui-icon workflow-dialog-icon');

  card.querySelector(':scope > .ui-dialog-actions, :scope > .confirm-modal-actions')?.classList.add('workflow-dialog-actions');
  return { modal, card, title };
}

function normalizeEditingDialogs() {
  normalizeWorkflowDialog({
    modalId: 'territorialTypeModal',
    cardSelector: '.territorial-type-card',
    variant: 'standard',
    semantic: 'transform',
    titleId: 'territorialTypeTitle',
    descriptionId: 'territorialTypeContext',
  });

  const confirm = normalizeWorkflowDialog({
    modalId: 'confirmModal',
    cardSelector: '.confirm-modal-card',
    variant: 'compact',
    semantic: 'check',
    titleId: 'confirmModalTitle',
    descriptionId: 'confirmModalMessage',
  });
  if (confirm?.title) {
    const syncConfirmIcon = () => {
      replaceWorkflowIcon(confirm.card, workflowSemanticFromLabel(confirm.title.textContent, 'check'), 'ui-icon workflow-dialog-icon');
    };
    syncConfirmIcon();
    new MutationObserver(syncConfirmIcon).observe(confirm.title, { childList: true, characterData: true, subtree: true });
  }
  document.getElementById('confirmModalChoiceRow')?.classList.add('workflow-choice-row');

  const coast = normalizeWorkflowDialog({
    modalId: 'coastReconciliationModal',
    cardSelector: '.coast-reconciliation-card',
    variant: 'wide',
    semantic: 'coastline',
    titleId: 'coastReconciliationTitle',
    descriptionId: 'coastReconciliationMessage',
  });
  coast?.card.classList.add('workflow-dialog--decision');

  for (const [id, detail] of Object.entries(COAST_DECISION_DETAIL_BY_ID)) {
    const button = document.getElementById(id);
    if (!(button instanceof HTMLButtonElement)) continue;
    button.classList.add('workflow-decision-option');
    if (!button.querySelector('.workflow-option-detail')) {
      const help = document.createElement('span');
      help.className = 'workflow-option-detail';
      help.textContent = detail;
      button.appendChild(help);
    }
  }
  document.getElementById('coastReconciliationCancelBtn')?.classList.add('workflow-decision-cancel');
}

function normalizeEditingWorkflows() {
  normalizeMapEditingWorkflow();
  normalizeEditingDialogs();
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
  normalizeEditingWorkflows();
  removeRedundantEditorEdge();
  removeDecorativeOnlyNodes();
  flattenHistoricalPreview();
  constrainGenericFallbackUi();
  normalizeEmptyConditionalSurfaces();
  markPhaseApplied();
}
