/** CountryLabels: extracted application responsibility.
 * Dependencies are explicitly wired once by the composition modules.
 * Mutable bindings stay local; exported accessors retain live identity.
 */
export function createCountryLabels() {
  let dependencies;
  let countryOutlineCache;
  let labelLayoutMetrics;
  let countryLabelScreenAreas;
  let countryDisplaySource;
  let countryDisplayIndex;
  function connect(ports) {
    if (dependencies) throw new Error('country-labels already connected');
    dependencies = ports;
  }

  function currentMapZoom() {
    return dependencies.state.projection === 'globe' ? dependencies.state.view.globeZoom : dependencies.state.view.flatZoom;
  }

  function countryOutlineFeature(feature) {
    const geometry = feature?.geometry;
    if (geometry && countryOutlineCache.has(geometry)) return countryOutlineCache.get(geometry);
    const outline = (0, dependencies.buildRenderableStrokeFeature)(feature);
    if (geometry) countryOutlineCache.set(geometry, outline);
    return outline;
  }

  function refreshCountryDisplayIndex() {
    const source = dependencies.state.auditPreviewCountries;
    if (source === countryDisplaySource) return;
    countryDisplaySource = source;
    countryDisplayIndex = new Map((source?.features || []).map(feature => [
      String(feature.id || ''),
      feature,
    ]));
  }

  function countryDisplayFeature(feature) {
    if (dependencies.state.countryVisualPhase === 'canonical') return feature;
    const id = String(feature?.id || '');
    if (!id) return feature;
    refreshCountryDisplayIndex();
    return countryDisplayIndex.get(id) || feature;
  }

  function applyUserPreferences(nextPreferences, { persist = true, rerender = true } = {}) {
    const previousTheme = (0, dependencies.effectiveTheme)(dependencies.userPreferences, dependencies.systemTheme === 'dark');
    const previousAccent = dependencies.resolvedAccentColor;
    dependencies.userPreferences = persist ? (0, dependencies.saveUserPreferences)(nextPreferences) : nextPreferences;
    const resolvedTheme = (0, dependencies.effectiveTheme)(dependencies.userPreferences, dependencies.systemTheme === 'dark');
    const statusBarVisible = dependencies.userPreferences.appearance?.statusBarVisible !== false;
    document.documentElement.dataset.theme = resolvedTheme;
    document.documentElement.dataset.statusBarVisible = String(statusBarVisible);
    const statusBar = (0, dependencies.$)('mapBottomStatus');
    if (statusBar) statusBar.hidden = !statusBarVisible;
    dependencies.resolvedAccentColor = (0, dependencies.applyAppAccent)(document, dependencies.userPreferences.appearance.accentColor);
    (0, dependencies.applyMapLabelPreferences)();
    window.__PANDOLAB_THEME__ = resolvedTheme;
    const themeChanged = previousTheme !== resolvedTheme;
    if (themeChanged || previousAccent !== dependencies.resolvedAccentColor) (0, dependencies.syncResolvedInteractionStyle)({ redraw: rerender });
    if (themeChanged) {
      dependencies.gpuMapRenderer.invalidateCountryPalette({ base: true, emphasis: true }, 'user-preferences');
      dependencies.gpuMapRenderer.invalidatePhysicalStyle('user-preferences');
    }
    if (themeChanged && rerender && dependencies.svg) {
      (0, dependencies.markLayerTreeDirty)();
      dependencies.layerTreeController?.render();
      dependencies.renderingDomain?.invalidateBaseScene?.('user-preferences');
    }
    return dependencies.userPreferences;
  }

  function countryLabelScreenMetrics(feature, fontSize = (0, dependencies.isMobile)() ? 8 : 9, projectedExtent = null, labelFeature = feature) {
    let width = Number(projectedExtent?.width);
    let height = Number(projectedExtent?.height);
    if (!Number.isFinite(width) || !Number.isFinite(height)) {
      const geometry = feature?.geometry;
      const bounds = geometry ? (0, dependencies.geometryBounds)(geometry) : null;
      const scale = Math.max(1, Number((0, dependencies.activeProjection)()?.scale?.()) || 1);
      const lonSpan = bounds?.every(Number.isFinite)
        ? Math.max(0, Math.min(360, Number(bounds[2]) - Number(bounds[0]))) * Math.PI / 180
        : 0;
      const latSpan = bounds?.every(Number.isFinite)
        ? Math.max(0, Math.min(180, Number(bounds[3]) - Number(bounds[1]))) * Math.PI / 180
        : 0;
      if (dependencies.state.projection === 'globe') {
        const centerLatitude = bounds?.every(Number.isFinite)
          ? Math.max(-89.999, Math.min(89.999, (Number(bounds[1]) + Number(bounds[3])) / 2)) * Math.PI / 180
          : 0;
        width = Math.min(scale * 2, scale * lonSpan * Math.max(0.08, Math.abs(Math.cos(centerLatitude))));
        height = Math.min(scale * 2, scale * latSpan);
      } else {
        width = scale * lonSpan;
        height = scale * latSpan;
      }
    }
    const textWidth = Math.max(20, [...(0, dependencies.countryName)(labelFeature)].length * fontSize * 1.02 + 8);
    return {
      width: Number.isFinite(width) ? width : 0,
      height: Number.isFinite(height) ? height : 0,
      area: Number.isFinite(width * height) ? width * height : 0,
      textWidth,
      textHeight: fontSize * 1.65 + 4,
    };
  }

  function shouldShowCountryLabel(feature, metrics = countryLabelScreenMetrics(feature)) {
    if (!dependencies.state.layerVisibility.basemapLabels) return false;
    const id = String(feature.id || '');
    if (!(0, dependencies.isLayerItemVisible)('countryLabels', id) || dependencies.pendingCountryLabelAnchors.has(id)) return false;
    if ((dependencies.state.selected?.domain === 'territorial' && dependencies.state.selected.type === dependencies.TERRITORIAL_UNIT_TYPES.COUNTRY) && dependencies.state.selected.id === id) return true;
    const widthFit = metrics.width >= Math.min(34, metrics.textWidth * ((0, dependencies.isMobile)() ? 0.48 : 0.42));
    const heightFit = metrics.height >= metrics.textHeight * 0.52;
    const areaFit = metrics.area >= Math.max((0, dependencies.isMobile)() ? 72 : 58, metrics.textWidth * metrics.textHeight * 0.32);
    return widthFit && heightFit && areaFit;
  }

  function renderPendingCountryOverlays() {
    if (!dependencies.countryLayer) return;
    const pending = dependencies.state.layerVisibility.countries && dependencies.state.pendingCountryRenderIds?.size
      ? [...dependencies.state.pendingCountryRenderIds]
        .map(dependencies.countryFeatureById)
        .filter(feature => feature && (0, dependencies.isCountryVisibleById)(String(feature.id || '')))
      : [];
    const patchFill = dependencies.countryLayer.selectAll('path.country-patch-preview-fill')
      .data(pending, feature => feature.id);
    patchFill.enter().append('path').attr('class', 'country-patch-preview country-patch-preview-fill');
    dependencies.countryLayer.selectAll('path.country-patch-preview-fill')
      .attr('d', feature => (0, dependencies.path)(feature))
      .attr('data-gpu-scene-key', feature => `pending-country-fill:${feature.id}`)
      .style('fill', dependencies.countryColor)
      .style('fill-opacity', (0, dependencies.mapTheme)().fillAlpha)
      .style('stroke', 'none');
    patchFill.exit().remove();
    const patchOutline = dependencies.countryLayer.selectAll('path.country-patch-preview-outline')
      .data(pending, feature => feature.id);
    patchOutline.enter().append('path').attr('class', 'country-patch-preview country-patch-preview-outline');
    dependencies.countryLayer.selectAll('path.country-patch-preview-outline')
      .attr('d', feature => (0, dependencies.path)(countryOutlineFeature(feature)))
      .attr('data-gpu-scene-key', feature => `pending-country-outline:${feature.id}`)
      .style('fill', 'none')
      .style('stroke', (0, dependencies.mapTheme)().border)
      .style('stroke-opacity', (0, dependencies.mapTheme)().borderAlpha);
    patchOutline.exit().remove();
  }

  function visibleLabelLayout() {
    const candidates = [];
    const indexedLabelIds = dependencies.state.layerVisibility.labels
      ? new Set((0, dependencies.visibleMapObjectCandidates)(['label']).map(record => String(record.id)))
      : new Set();
    countryLabelScreenAreas.clear();
    const zoom = currentMapZoom();
    if (dependencies.state.layerVisibility.basemapLabels) for (const feature of (0, dependencies.builtinRenderCountries)().labelById.values()) {
      const id = String(feature.id || '');
      if (!(0, dependencies.isLayerItemVisible)('countryLabels', id) || dependencies.pendingCountryLabelAnchors.has(id)) continue;
      const settings = (0, dependencies.automaticLabelSettings)('country', dependencies.state.labelSettings[(0, dependencies.labelKey)('country', id)] || {});
      if (zoom < Number(settings.minZoom ?? -Infinity) || zoom > Number(settings.maxZoom ?? Infinity)) continue;
      const anchor = dependencies.countryLabelAnchors.get(id);
      const coordinate = settings.pinned && settings.manualPosition ? settings.manualPosition : anchor;
      if (!Array.isArray(coordinate)) continue;
      const point = (0, dependencies.projectVisibleCoordinate)(coordinate);
      if (!point) continue;
      const labelRef = (0, dependencies.builtinRenderCountries)().labelRefs.get(id);
      const selected = labelRef ? dependencies.selectionDomain.has(labelRef)
        : (dependencies.state.selected?.domain === 'territorial' && dependencies.state.selected.type === dependencies.TERRITORIAL_UNIT_TYPES.COUNTRY) && dependencies.state.selected.id === id;
      const displayFeature = countryDisplayFeature(feature);
      const baseMetrics = countryLabelScreenMetrics(displayFeature, (0, dependencies.isMobile)() ? 8 : 9, null, feature);
      const fontSize = baseMetrics.area >= ((0, dependencies.isMobile)() ? 3200 : 2200) ? ((0, dependencies.isMobile)() ? 10 : 12) : (0, dependencies.isMobile)() ? 8 : 9;
      const metrics = countryLabelScreenMetrics(displayFeature, fontSize, baseMetrics, feature);
      countryLabelScreenAreas.set(id, metrics.area);
      if (!selected && !shouldShowCountryLabel(feature, metrics)) continue;
      candidates.push({
        key: (0, dependencies.labelKey)('country', id), sourceType: 'country', source: feature, point,
        width: metrics.textWidth, height: metrics.textHeight,
        priority: settings.priority ?? dependencies.LABEL_PRIORITIES.country, minZoom: settings.minZoom, maxZoom: settings.maxZoom,
        pinned: settings.pinned, collisionGroup: settings.collisionGroup,
        selected,
      });
    }
    if (dependencies.state.layerVisibility.labels) for (const label of dependencies.state.labels) {
      const selected = dependencies.state.selected?.domain === 'label' && String(dependencies.state.selected.id) === String(label.id);
      if (!selected && !indexedLabelIds.has(String(label.id))) continue;
      const settings = (0, dependencies.automaticLabelSettings)(label.kind, dependencies.state.labelSettings[(0, dependencies.labelKey)('label', label.id)] || {});
      if (zoom < Number(settings.minZoom ?? -Infinity) || zoom > Number(settings.maxZoom ?? Infinity)) continue;
      const coordinate = settings.pinned && settings.manualPosition ? settings.manualPosition : label.coordinates;
      const point = (0, dependencies.projectVisibleCoordinate)(coordinate);
      if (!point) continue;
      const priority = settings.priority ?? (label.kind === 'capital' ? dependencies.LABEL_PRIORITIES.capital : label.kind === 'city' ? dependencies.LABEL_PRIORITIES.majorCity : label.kind === 'region' ? dependencies.LABEL_PRIORITIES.administrative : dependencies.LABEL_PRIORITIES.place);
      candidates.push({
        key: (0, dependencies.labelKey)('label', label.id), sourceType: 'label', source: label, point,
        width: Math.max(22, [...String(label.name || '')].length * 9 + 16), height: 19,
        priority, minZoom: settings.minZoom, maxZoom: settings.maxZoom,
        pinned: settings.pinned, collisionGroup: settings.collisionGroup,
        selected,
      });
    }
    const labelDensity = Math.max(0.25, Math.min(1, Number(dependencies.currentRenderQuality.labelDensity) || 1));
    const viewportArea = Math.max(1, Number(dependencies.state.size.width || 1) * Number(dependencies.state.size.height || 1));
    const backgroundLimit = labelDensity >= 0.99
      ? Number.POSITIVE_INFINITY
      : Math.max(labelDensity < 0.6 ? 42 : 72, Math.floor(viewportArea / 8_500 * labelDensity));
    const protectedCandidates = candidates.filter(candidate => candidate.selected || candidate.pinned);
    const protectedCandidateKeys = new Set(protectedCandidates.map(candidate => candidate.key));
    const backgroundCandidates = candidates.filter(candidate => !protectedCandidateKeys.has(candidate.key))
      .sort((left, right) => Number(right.priority || 0) - Number(left.priority || 0));
    const qualityCandidates = Number.isFinite(backgroundLimit)
      ? [...protectedCandidates, ...backgroundCandidates.slice(0, backgroundLimit)]
      : candidates;
    const nextLabelLayoutMetrics = {
      qualityTier: dependencies.currentRenderQuality.tier,
      qualityCandidateCount: qualityCandidates.length,
      qualityCulledCount: Math.max(0, candidates.length - qualityCandidates.length),
    };
    const placed = (0, dependencies.layoutLabels)(qualityCandidates, { zoom, padding: (0, dependencies.isMobile)() ? 5 : 3, metrics: nextLabelLayoutMetrics });
    const placedCountryLabels = placed.filter(item => item.sourceType === 'country');
    const countryFlags = (0, dependencies.layoutCountryFlags)(placed, {
      zoom, enabled: dependencies.state.layerVisibility.countryFlags !== false,
      isCountry: feature => !(0, dependencies.builtinRenderCountries)().labelRefs.has(String(feature.id)),
      flagUrl: feature => (0, dependencies.effectiveCountryFlagUrl)({ countryId: feature.id, override: dependencies.state.countryOverrides[String(feature.id)] || {}, assetRevision: dependencies.ASSET_REVISION }),
    });
    const placedUserLabels = placed.filter(item => item.sourceType === 'label');
    labelLayoutMetrics = nextLabelLayoutMetrics;
    if (dependencies.viewportCullingMetrics.lastByDomain.label) dependencies.viewportCullingMetrics.lastByDomain.label.finalVisibleCount = placedUserLabels.length;
    return {
      countryLabels: placedCountryLabels.map(item => item.source),
      countryFlags,
      userLabels: placedUserLabels.map(item => item.source),
      countryLabelPoints: new Map(placedCountryLabels.map(item => [String(item.source?.id || ''), item.point])),
      userLabelPoints: new Map(placedUserLabels.map(item => [String(item.source?.id || ''), item.point])),
      countryScreenAreas: new Map(countryLabelScreenAreas),
      candidateCount: candidates.length,
    };
  }

  function initializeCountryOutlineCache() {
    (countryOutlineCache = new WeakMap());
  }

  function initializeLabelLayoutMetrics() {
    (labelLayoutMetrics = {});
  }

  function initializeCountryLabelScreenAreas() {
    (countryLabelScreenAreas = new Map());

    (countryDisplaySource = null);

    (countryDisplayIndex = new Map());
  }

  return Object.freeze({
    connect,
    initializeCountryOutlineCache,
    initializeLabelLayoutMetrics,
    initializeCountryLabelScreenAreas,
    get applyUserPreferences() { return applyUserPreferences; },
    get countryDisplayFeature() { return countryDisplayFeature; },
    get countryDisplayIndex() { return countryDisplayIndex; },
    set countryDisplayIndex(value) { countryDisplayIndex = value; },
    get countryDisplaySource() { return countryDisplaySource; },
    set countryDisplaySource(value) { countryDisplaySource = value; },
    get countryOutlineCache() { return countryOutlineCache; },
    get countryOutlineFeature() { return countryOutlineFeature; },
    get currentMapZoom() { return currentMapZoom; },
    get labelLayoutMetrics() { return labelLayoutMetrics; },
    get renderPendingCountryOverlays() { return renderPendingCountryOverlays; },
    get visibleLabelLayout() { return visibleLabelLayout; },
  });
}
