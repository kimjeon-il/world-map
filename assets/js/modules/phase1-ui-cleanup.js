import { installBoundaryGhostingGuard } from './boundary-ghosting-guard.js';

installBoundaryGhostingGuard();

function detachMapStatusSurface() {
  const surface = document.querySelector('.map-bottom-status');
  if (!surface) return;

  const stateHost = document.createElement('div');
  stateHost.className = 'map-status-state';
  stateHost.hidden = true;
  stateHost.setAttribute('aria-hidden', 'true');

  for (const id of ['statusView', 'statusPrimary', 'statusSelection']) {
    const node = document.getElementById(id);
    if (node) stateHost.appendChild(node);
  }

  surface.replaceWith(stateHost);
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
  if (app) app.dataset.uiCleanupPhase = '1';
}

export function applyPhase1UiCleanup() {
  if (document.documentElement.dataset.pandolabUiCleanupPhase1 === 'done') return;
  document.documentElement.dataset.pandolabUiCleanupPhase1 = 'done';

  detachMapStatusSurface();
  removeRedundantEditorEdge();
  removeDecorativeOnlyNodes();
  flattenHistoricalPreview();
  normalizeEmptyConditionalSurfaces();
  markPhaseApplied();
}
