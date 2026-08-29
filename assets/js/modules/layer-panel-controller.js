export function createLayerPanelController({
  window,
  elements,
  commands,
  searchDelay = 120,
}) {
  let searchTimer = 0;

  function bind() {
    elements.layersTab?.addEventListener('click', () => commands.setPanelView?.('layers'));
    elements.viewTab?.addEventListener('click', () => commands.setPanelView?.('view'));
    elements.panelTabs?.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      commands.setPanelView?.(event.key === 'ArrowRight' || event.key === 'End' ? 'view' : 'layers', { focus: true });
    });
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
      const menu = event.target.closest('[data-layer-item-menu]');
      if (menu) {
        event.stopPropagation();
        commands.openItemMenu(menu.dataset.layerItemMenu, menu.dataset.itemId, menu);
        return;
      }
      const regionFolder = event.target.closest('[data-country-region-folder-toggle]');
      if (regionFolder) {
        commands.toggleRegionFolder(regionFolder.dataset.countryRegionFolderToggle);
        return;
      }
      const hydroFolder = event.target.closest('[data-hydro-folder-toggle]');
      if (hydroFolder) {
        commands.toggleHydroFolder?.(hydroFolder.dataset.hydroFolderToggle);
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
    });
  }

  return Object.freeze({ bind });
}
