export function createLayerPanelController({
  window,
  elements,
  commands,
  searchDelay = 120,
}) {
  let searchTimer = 0;

  function bind() {
    for (const [group, input] of Object.entries(elements.visibilityInputs || {})) {
      input?.addEventListener('change', event => {
        commands.syncVisibilityToggle?.(event.target);
        commands.setLayerVisibility(group, event.target.checked);
      });
    }
    elements.terrainVisible?.addEventListener('change', event => commands.setTerrainVisible(event.target.checked));
    for (const input of elements.terrainStyleInputs || []) input?.addEventListener('change', event => {
      if (event.target.checked) commands.setTerrainStyle(event.target.value);
    });
    elements.terrainStrength?.addEventListener('input', event => commands.previewTerrainStrength(event.target.value));
    elements.terrainStrength?.addEventListener('change', () => commands.commitTerrainStrength());
    for (const input of elements.distributionModeInputs || []) input?.addEventListener('change', event => {
      commands.setDistributionRenderMode?.(event.target.value);
    });
    elements.distributionBoundaryVisible?.addEventListener('change', event => {
      commands.setDistributionBoundaryVisible?.(event.target.checked);
    });
    elements.search?.addEventListener('input', event => {
      commands.setSearchValue(event.target.value || '');
      clearTimeout(searchTimer);
      searchTimer = window.setTimeout(commands.commitSearch, searchDelay);
    });
    elements.searchClear?.addEventListener('click', () => {
      if (!elements.search) return;
      elements.search.value = '';
      elements.search.dispatchEvent(new window.Event('input', { bubbles: true }));
      elements.search.focus({ preventScroll: true });
    });
    elements.section?.addEventListener('click', event => {
      const styleToggle = event.target.closest('[data-layer-style-toggle]');
      if (styleToggle) {
        event.preventDefault();
        event.stopPropagation();
        commands.toggleLayerStyle?.(styleToggle.dataset.layerStyleToggle);
        return;
      }
      const menu = event.target.closest('[data-layer-item-menu]');
      if (menu) {
        event.stopPropagation();
        commands.openItemMenu(menu.dataset.layerItemMenu, menu.dataset.itemId, menu);
        return;
      }
      const territorialFolder = event.target.closest('[data-territorial-unit-folder-toggle]');
      if (territorialFolder) {
        commands.toggleTerritorialUnitFolder(territorialFolder.dataset.territorialUnitFolderToggle);
        return;
      }
      const folder = event.target.closest('[data-layer-folder-toggle]');
      if (folder) {
        commands.toggleFolder(folder.dataset.layerFolderToggle);
        return;
      }
      const item = event.target.closest('[data-layer-item-select]');
      if (item) commands.selectItem({
        group: item.dataset.layerItemSelect,
        id: item.dataset.itemId,
        additive: event.ctrlKey || event.metaKey,
        range: event.shiftKey,
      });
    });
    elements.section?.addEventListener('scroll', commands.handleScroll, true);
    elements.section?.addEventListener('change', event => {
      commands.syncVisibilityToggle?.(event.target);
      const checkbox = event.target.closest('[data-layer-item-visibility]');
      if (checkbox) commands.setItemVisibility(checkbox.dataset.layerItemVisibility, checkbox.dataset.itemId, checkbox.checked);
      const opacity = event.target.closest('[data-layer-style-opacity]');
      if (opacity) commands.updateLayerStyle?.(opacity.dataset.layerStyleOpacity, { opacity: Number(opacity.value) / 100 });
      const boundary = event.target.closest('[data-layer-style-boundary]');
      if (boundary) commands.updateLayerStyle?.(boundary.dataset.layerStyleBoundary, { boundaryVisible: boundary.checked });
      const blendMode = event.target.closest('[data-layer-style-blend-mode]');
      if (blendMode) commands.updateLayerStyle?.(blendMode.dataset.layerStyleBlendMode, { blendMode: blendMode.value });
    });
    elements.section?.addEventListener('input', event => {
      const opacity = event.target.closest('[data-layer-style-opacity]');
      if (opacity) commands.updateLayerStyle?.(opacity.dataset.layerStyleOpacity, { opacity: Number(opacity.value) / 100 });
    });
  }

  return Object.freeze({ bind });
}
