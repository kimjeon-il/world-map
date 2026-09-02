import { installBoundaryGhostingGuard } from './boundary-ghosting-guard.js';
import { installObjectRegistryPresenter } from './object-registry-presenter.js';

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
]);

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
    section.hidden = true;
    section.setAttribute('aria-hidden', 'true');
    section.dataset.legacyGenericSemantics = 'hidden';
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
  removeRedundantEditorEdge();
  removeDecorativeOnlyNodes();
  flattenHistoricalPreview();
  constrainGenericFallbackUi();
  normalizeEmptyConditionalSurfaces();
  markPhaseApplied();
}
