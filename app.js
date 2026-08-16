/* ChronoMap Editor MVP 0.1
 * Static browser prototype. No build step required.
 * MapLibre GL JS + @watergis/maplibre-gl-terradraw
 */

(() => {
  'use strict';

  const STORAGE_KEY = 'chronomap-editor-mvp-project';
  const DEFAULT_COLOR = '#7c8da6';
  const DEFAULT_DRAWING_COLOR = '#8c68d8';
  const COUNTRY_DATA_URL = 'https://raw.githubusercontent.com/datasets/geo-countries/master/data/countries.geojson';

  const $ = (id) => document.getElementById(id);
  const deepClone = (obj) => JSON.parse(JSON.stringify(obj));

  const state = {
    countriesData: null,
    countryIndex: new Map(),
    countryOverrides: {},
    labels: [],
    drawingMeta: {},
    selected: null,
    projection: 'globe',
    layerVisibility: {
      countries: true,
      drawings: true,
      labels: true,
      basemapLabels: true,
    },
    countriesLocked: false,
    labelPlacementMode: false,
    history: [],
    future: [],
    drawControl: null,
    draw: null,
    restoreDrawings: [],
    autosaveTimer: null,
    lastSavedAt: null,
  };

  const map = new maplibregl.Map({
    container: 'map',
    style: 'https://tiles.openfreemap.org/styles/bright',
    center: [21.6, 42.1],
    zoom: 3.25,
    bearing: 0,
    pitch: 0,
    attributionControl: true,
  });

  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');
  map.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: 'metric' }), 'bottom-left');

  function showToast(message, timeout = 2200) {
    const toast = $('toast');
    toast.textContent = message;
    toast.classList.remove('hidden');
    clearTimeout(showToast._timer);
    showToast._timer = setTimeout(() => toast.classList.add('hidden'), timeout);
  }

  function setAutosaveStatus(text) {
    $('autosaveStatus').textContent = text;
  }

  function featureCountryId(feature, index) {
    const p = feature.properties || {};
    const code = p.ISO_A3 || p.ADM0_A3 || p.iso_a3 || p.WB_A3 || p.SOV_A3 || p.ADMIN || p.name || p.NAME;
    return String(code || `country_${index}`).replace(/\s+/g, '_');
  }

  function featureCountryName(feature) {
    const p = feature.properties || {};
    return p.ADMIN || p.NAME || p.name || p.NAME_LONG || p.SOVEREIGNT || '이름 없는 국가';
  }

  function normalizeCountries(raw) {
    const fc = raw && raw.type === 'FeatureCollection' ? raw : { type: 'FeatureCollection', features: [] };
    state.countryIndex.clear();

    fc.features.forEach((feature, index) => {
      feature.properties = feature.properties || {};
      const id = featureCountryId(feature, index);
      const originalName = featureCountryName(feature);
      feature.properties.editor_id = id;
      feature.properties.editor_original_name = originalName;
      feature.properties.editor_name = originalName;
      feature.properties.editor_color = DEFAULT_COLOR;

      const override = state.countryOverrides[id];
      if (override) {
        if (override.name) feature.properties.editor_name = override.name;
        if (override.color) feature.properties.editor_color = override.color;
      }
      state.countryIndex.set(id, index);
    });

    return fc;
  }

  function styleCountryFillExpression() {
    return ['coalesce', ['get', 'editor_color'], DEFAULT_COLOR];
  }

  function addCountryLayers() {
    if (map.getSource('editor-countries')) return;
    map.addSource('editor-countries', {
      type: 'geojson',
      data: state.countriesData || { type: 'FeatureCollection', features: [] },
      generateId: true,
    });

    map.addLayer({
      id: 'editor-country-fill',
      type: 'fill',
      source: 'editor-countries',
      paint: {
        'fill-color': styleCountryFillExpression(),
        'fill-opacity': 0.46,
      },
    });

    map.addLayer({
      id: 'editor-country-lines',
      type: 'line',
      source: 'editor-countries',
      paint: {
        'line-color': '#313944',
        'line-width': ['interpolate', ['linear'], ['zoom'], 2, 0.45, 7, 1.2],
        'line-opacity': 0.9,
      },
    });

    map.addLayer({
      id: 'editor-country-selected',
      type: 'line',
      source: 'editor-countries',
      filter: ['==', ['get', 'editor_id'], '__none__'],
      paint: {
        'line-color': '#ffe099',
        'line-width': 2.7,
        'line-opacity': 1,
      },
    });

    map.on('mouseenter', 'editor-country-fill', () => {
      if (!state.labelPlacementMode) map.getCanvas().style.cursor = state.countriesLocked ? 'not-allowed' : 'pointer';
    });
    map.on('mouseleave', 'editor-country-fill', () => {
      if (!state.labelPlacementMode) map.getCanvas().style.cursor = '';
    });

    map.on('click', 'editor-country-fill', (e) => {
      if (state.labelPlacementMode || state.countriesLocked || !e.features?.length) return;
      const id = e.features[0].properties?.editor_id;
      if (id) selectCountry(id);
    });

    applyLayerVisibility();
  }

  function addLabelLayers() {
    if (map.getSource('editor-labels')) return;
    map.addSource('editor-labels', {
      type: 'geojson',
      data: labelsFeatureCollection(),
    });

    map.addLayer({
      id: 'editor-label-points',
      type: 'circle',
      source: 'editor-labels',
      paint: {
        'circle-radius': ['case', ['==', ['get', 'kind'], 'capital'], 5, 3.5],
        'circle-color': ['case', ['==', ['get', 'kind'], 'capital'], '#e8c66d', '#c9d0d8'],
        'circle-stroke-color': '#20262e',
        'circle-stroke-width': 1.2,
      },
    });

    map.addLayer({
      id: 'editor-label-text',
      type: 'symbol',
      source: 'editor-labels',
      minzoom: 2,
      layout: {
        'text-field': ['get', 'name'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 2, 9, 6, 12, 10, 15],
        'text-offset': [0, 1.05],
        'text-anchor': 'top',
        'text-allow-overlap': false,
      },
      paint: {
        'text-color': '#f3f1ea',
        'text-halo-color': '#1d2229',
        'text-halo-width': 1.3,
      },
    });

    map.on('click', 'editor-label-points', (e) => {
      if (state.labelPlacementMode || !e.features?.length) return;
      selectLabel(e.features[0].properties?.id);
    });
    map.on('click', 'editor-label-text', (e) => {
      if (state.labelPlacementMode || !e.features?.length) return;
      selectLabel(e.features[0].properties?.id);
    });

    applyLayerVisibility();
  }

  function labelsFeatureCollection() {
    return {
      type: 'FeatureCollection',
      features: state.labels.map((label) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: label.coordinates },
        properties: {
          id: label.id,
          name: label.name,
          kind: label.kind,
        },
      })),
    };
  }

  function refreshLabels() {
    const src = map.getSource('editor-labels');
    if (src) src.setData(labelsFeatureCollection());
  }

  function setupTerraDraw() {
    if (!window.MaplibreTerradrawControl?.MaplibreTerradrawControl) {
      showToast('Terra Draw를 불러오지 못했습니다. 네트워크를 확인하세요.', 4000);
      return;
    }

    const control = new MaplibreTerradrawControl.MaplibreTerradrawControl({
      modes: [
        'polygon',
        'linestring',
        'point',
        'rectangle',
        'freehand',
        'select',
        'delete-selection',
        'delete',
        'undo',
        'redo',
      ],
      open: true,
    });

    state.drawControl = control;
    map.addControl(control, 'top-left');

    try {
      state.draw = control.getTerradrawInstance();
    } catch (error) {
      console.warn('Terra Draw instance unavailable', error);
      return;
    }

    if (!state.draw) return;

    state.draw.on('change', () => {
      syncDrawingMetadata();
      queueAutosave();
    });

    state.draw.on('select', (id) => {
      if (!id) return;
      selectDrawing(String(id));
    });

    restoreDrawingsIntoTerraDraw();
    applyLayerVisibility();
  }

  function cleanDrawSnapshot(snapshot) {
    return (snapshot || []).filter((feature) => {
      const p = feature.properties || {};
      if (p.coordinatePoint || p.midPoint || p.closingPoint) return false;
      if (p.selectionPoint) return false;
      return ['Point', 'LineString', 'Polygon'].includes(feature.geometry?.type);
    });
  }

  function getDrawingsSnapshot() {
    if (!state.draw) return state.restoreDrawings || [];
    try {
      return cleanDrawSnapshot(state.draw.getSnapshot());
    } catch (error) {
      console.warn(error);
      return [];
    }
  }

  function restoreDrawingsIntoTerraDraw() {
    if (!state.draw || !state.restoreDrawings?.length) return;
    const prepared = state.restoreDrawings.map((feature) => {
      const f = deepClone(feature);
      f.properties = f.properties || {};
      if (!f.properties.mode) {
        if (f.geometry.type === 'Polygon') f.properties.mode = 'polygon';
        else if (f.geometry.type === 'LineString') f.properties.mode = 'linestring';
        else f.properties.mode = 'point';
      }
      return f;
    });
    try {
      state.draw.addFeatures(prepared);
    } catch (error) {
      console.warn('일부 사용자 도형을 복원하지 못했습니다.', error);
    }
    state.restoreDrawings = [];
  }

  function syncDrawingMetadata() {
    for (const feature of getDrawingsSnapshot()) {
      const id = String(feature.id ?? '');
      if (!id) continue;
      if (!state.drawingMeta[id]) {
        state.drawingMeta[id] = {
          name: '',
          color: DEFAULT_DRAWING_COLOR,
          category: feature.geometry.type === 'Polygon' ? 'custom' : 'custom',
          notes: '',
        };
      }
    }
  }

  async function loadCountries() {
    $('countryStatus').textContent = '불러오는 중…';
    try {
      const response = await fetch(COUNTRY_DATA_URL);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const raw = await response.json();
      state.countriesData = normalizeCountries(raw);
      const source = map.getSource('editor-countries');
      if (source) source.setData(state.countriesData);
      else addCountryLayers();
      $('countryStatus').textContent = `${state.countriesData.features.length}개`;
    } catch (error) {
      console.error(error);
      $('countryStatus').textContent = '원격 데이터 실패';
      state.countriesData = { type: 'FeatureCollection', features: [] };
      addCountryLayers();
      showToast('기본 국가 GeoJSON을 불러오지 못했습니다. 사용자 GeoJSON 가져오기는 계속 사용할 수 있습니다.', 5000);
    }
  }

  function selectCountry(id) {
    const idx = state.countryIndex.get(String(id));
    if (idx === undefined || !state.countriesData) return;
    const feature = state.countriesData.features[idx];
    const p = feature.properties || {};
    const override = state.countryOverrides[id] || {};

    state.selected = { type: 'country', id: String(id) };
    if (map.getLayer('editor-country-selected')) {
      map.setFilter('editor-country-selected', ['==', ['get', 'editor_id'], String(id)]);
    }

    showPropertyForm('country');
    $('propertyTitle').textContent = override.name || p.editor_name || p.editor_original_name || id;
    $('propertyType').textContent = '국가';
    $('countryNameInput').value = override.name || p.editor_name || p.editor_original_name || '';
    $('countryCodeInput').value = id;
    $('countryColorInput').value = override.color || p.editor_color || DEFAULT_COLOR;
    $('capitalInput').value = override.capital || '';
    $('notesInput').value = override.notes || '';
    $('originalNameValue').textContent = p.editor_original_name || '—';
    renderFlag(override.flagDataUrl || null);
    $('selectionStatus').textContent = `국가 · ${$('propertyTitle').textContent}`;
  }

  function selectDrawing(id) {
    syncDrawingMetadata();
    const meta = state.drawingMeta[id] || {
      name: '', color: DEFAULT_DRAWING_COLOR, category: 'custom', notes: '',
    };
    state.drawingMeta[id] = meta;
    state.selected = { type: 'drawing', id };
    showPropertyForm('drawing');
    $('propertyTitle').textContent = meta.name || `사용자 도형 ${id.slice(0, 8)}`;
    $('propertyType').textContent = '도형';
    $('drawingNameInput').value = meta.name || '';
    $('drawingIdInput').value = id;
    $('drawingColorInput').value = meta.color || DEFAULT_DRAWING_COLOR;
    $('drawingCategoryInput').value = meta.category || 'custom';
    $('drawingNotesInput').value = meta.notes || '';
    $('selectionStatus').textContent = `도형 · ${meta.name || id.slice(0, 8)}`;
  }

  function selectLabel(id) {
    const label = state.labels.find((item) => item.id === id);
    if (!label) return;
    state.selected = { type: 'label', id };
    showPropertyForm('label');
    $('propertyTitle').textContent = label.name;
    $('propertyType').textContent = '지명';
    $('labelNameInput').value = label.name;
    $('labelKindInput').value = label.kind;
    $('labelNotesInput').value = label.notes || '';
    $('selectionStatus').textContent = `지명 · ${label.name}`;
  }

  function showPropertyForm(type) {
    $('emptyProperties').classList.toggle('hidden', !!type);
    $('countryProperties').classList.toggle('hidden', type !== 'country');
    $('drawingProperties').classList.toggle('hidden', type !== 'drawing');
    $('labelProperties').classList.toggle('hidden', type !== 'label');
  }

  function clearSelection() {
    state.selected = null;
    if (map.getLayer('editor-country-selected')) {
      map.setFilter('editor-country-selected', ['==', ['get', 'editor_id'], '__none__']);
    }
    $('propertyTitle').textContent = '선택 없음';
    $('propertyType').textContent = '—';
    $('selectionStatus').textContent = '선택 없음';
    showPropertyForm(null);
  }

  function renderFlag(dataUrl) {
    const preview = $('flagPreview');
    preview.innerHTML = '';
    if (!dataUrl) {
      preview.textContent = '국기 없음';
      return;
    }
    const img = document.createElement('img');
    img.src = dataUrl;
    img.alt = '등록된 국기';
    preview.appendChild(img);
  }

  function commitCountryEdit(field, value) {
    if (state.selected?.type !== 'country') return;
    const id = state.selected.id;
    const before = deepClone(state.countryOverrides[id] || {});
    const after = { ...before, [field]: value };
    state.countryOverrides[id] = after;
    pushHistory({ kind: 'countryOverride', id, before, after: deepClone(after) });
    applyCountryOverrideToFeature(id);
    selectCountry(id);
    queueAutosave();
  }

  function applyCountryOverrideToFeature(id) {
    const idx = state.countryIndex.get(String(id));
    if (idx === undefined || !state.countriesData) return;
    const feature = state.countriesData.features[idx];
    const override = state.countryOverrides[id] || {};
    feature.properties.editor_name = override.name || feature.properties.editor_original_name;
    feature.properties.editor_color = override.color || DEFAULT_COLOR;
    const source = map.getSource('editor-countries');
    if (source) source.setData(state.countriesData);
  }

  function commitDrawingMeta(field, value) {
    if (state.selected?.type !== 'drawing') return;
    const id = state.selected.id;
    const before = deepClone(state.drawingMeta[id] || {});
    const after = { ...before, [field]: value };
    state.drawingMeta[id] = after;
    pushHistory({ kind: 'drawingMeta', id, before, after: deepClone(after) });

    if (state.draw?.updateFeatureProperties) {
      try {
        state.draw.updateFeatureProperties(id, {
          editorName: after.name || '',
          editorColor: after.color || DEFAULT_DRAWING_COLOR,
          editorCategory: after.category || 'custom',
          editorNotes: after.notes || '',
        });
      } catch (error) {
        console.warn('Terra Draw property sync skipped', error);
      }
    }
    selectDrawing(id);
    queueAutosave();
  }

  function commitLabelEdit(field, value) {
    if (state.selected?.type !== 'label') return;
    const idx = state.labels.findIndex((item) => item.id === state.selected.id);
    if (idx < 0) return;
    const before = deepClone(state.labels[idx]);
    state.labels[idx][field] = value;
    const after = deepClone(state.labels[idx]);
    pushHistory({ kind: 'label', id: after.id, before, after });
    refreshLabels();
    selectLabel(after.id);
    queueAutosave();
  }

  function pushHistory(entry) {
    state.history.push(entry);
    if (state.history.length > 100) state.history.shift();
    state.future = [];
    updateHistoryButtons();
  }

  function updateHistoryButtons() {
    $('undoBtn').disabled = state.history.length === 0;
    $('redoBtn').disabled = state.future.length === 0;
  }

  function applyHistoryEntry(entry, direction) {
    const value = deepClone(direction === 'undo' ? entry.before : entry.after);
    if (entry.kind === 'countryOverride') {
      state.countryOverrides[entry.id] = value;
      applyCountryOverrideToFeature(entry.id);
      if (state.selected?.type === 'country' && state.selected.id === entry.id) selectCountry(entry.id);
    } else if (entry.kind === 'drawingMeta') {
      state.drawingMeta[entry.id] = value;
      if (state.selected?.type === 'drawing' && state.selected.id === entry.id) selectDrawing(entry.id);
    } else if (entry.kind === 'label') {
      const idx = state.labels.findIndex((item) => item.id === entry.id);
      if (idx >= 0) state.labels[idx] = value;
      else state.labels.push(value);
      refreshLabels();
      if (state.selected?.type === 'label' && state.selected.id === entry.id) selectLabel(entry.id);
    } else if (entry.kind === 'labelAdd') {
      if (direction === 'undo') {
        state.labels = state.labels.filter((item) => item.id !== entry.after.id);
        clearSelection();
      } else {
        state.labels.push(deepClone(entry.after));
      }
      refreshLabels();
    } else if (entry.kind === 'labelDelete') {
      if (direction === 'undo') state.labels.push(deepClone(entry.before));
      else state.labels = state.labels.filter((item) => item.id !== entry.before.id);
      refreshLabels();
      clearSelection();
    }
  }

  function undo() {
    const entry = state.history.pop();
    if (!entry) return;
    applyHistoryEntry(entry, 'undo');
    state.future.push(entry);
    updateHistoryButtons();
    queueAutosave();
  }

  function redo() {
    const entry = state.future.pop();
    if (!entry) return;
    applyHistoryEntry(entry, 'redo');
    state.history.push(entry);
    updateHistoryButtons();
    queueAutosave();
  }

  function addLabelAt(lngLat) {
    const name = window.prompt('지명을 입력하세요', '새 지명');
    if (!name) return;
    const label = {
      id: `label_${crypto.randomUUID ? crypto.randomUUID() : Date.now()}`,
      name: name.trim(),
      kind: 'city',
      notes: '',
      coordinates: [lngLat.lng, lngLat.lat],
    };
    state.labels.push(label);
    pushHistory({ kind: 'labelAdd', before: null, after: deepClone(label) });
    refreshLabels();
    exitLabelMode();
    selectLabel(label.id);
    queueAutosave();
  }

  function enterLabelMode() {
    state.labelPlacementMode = true;
    $('labelModeBanner').classList.remove('hidden');
    $('addLabelBtn').classList.add('active');
    map.getCanvas().style.cursor = 'crosshair';
  }

  function exitLabelMode() {
    state.labelPlacementMode = false;
    $('labelModeBanner').classList.add('hidden');
    $('addLabelBtn').classList.remove('active');
    map.getCanvas().style.cursor = '';
  }

  function setProjection(type) {
    state.projection = type;
    map.setProjection({ type: type === 'globe' ? 'globe' : 'mercator' });
    $('globeBtn').classList.toggle('active', type === 'globe');
    $('flatBtn').classList.toggle('active', type !== 'globe');
    queueAutosave();
  }

  function setLayerVisibility(group, visible) {
    state.layerVisibility[group] = visible;
    applyLayerVisibility();
    queueAutosave();
  }

  function setVisibilityForLayer(id, visible) {
    if (!map.getLayer(id)) return;
    map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
  }

  function applyLayerVisibility() {
    setVisibilityForLayer('editor-country-fill', state.layerVisibility.countries);
    setVisibilityForLayer('editor-country-lines', state.layerVisibility.countries);
    setVisibilityForLayer('editor-country-selected', state.layerVisibility.countries);
    setVisibilityForLayer('editor-label-points', state.layerVisibility.labels);
    setVisibilityForLayer('editor-label-text', state.layerVisibility.labels);

    const style = map.getStyle();
    if (style?.layers) {
      style.layers.forEach((layer) => {
        if (String(layer.id).startsWith('td-')) {
          setVisibilityForLayer(layer.id, state.layerVisibility.drawings);
        }
        if (layer.type === 'symbol' && !String(layer.id).startsWith('editor-') && !String(layer.id).startsWith('td-')) {
          setVisibilityForLayer(layer.id, state.layerVisibility.basemapLabels);
        }
      });
    }
  }

  function buildProjectData() {
    return {
      format: 'chronomap-project',
      version: 1,
      savedAt: new Date().toISOString(),
      view: {
        projection: state.projection,
        center: [map.getCenter().lng, map.getCenter().lat],
        zoom: map.getZoom(),
        bearing: map.getBearing(),
        pitch: map.getPitch(),
      },
      layerVisibility: deepClone(state.layerVisibility),
      countriesLocked: state.countriesLocked,
      countryOverrides: deepClone(state.countryOverrides),
      labels: deepClone(state.labels),
      drawingMeta: deepClone(state.drawingMeta),
      drawings: deepClone(getDrawingsSnapshot()),
    };
  }

  function applyLoadedProject(project, reload = false) {
    if (!project || project.format !== 'chronomap-project') throw new Error('ChronoMap 프로젝트 파일이 아닙니다.');
    localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
    if (reload) location.reload();
  }

  function restoreLocalProject() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    try {
      const project = JSON.parse(raw);
      if (project.format !== 'chronomap-project') return null;
      state.countryOverrides = project.countryOverrides || {};
      state.labels = project.labels || [];
      state.drawingMeta = project.drawingMeta || {};
      state.restoreDrawings = project.drawings || [];
      state.projection = project.view?.projection || 'globe';
      state.layerVisibility = { ...state.layerVisibility, ...(project.layerVisibility || {}) };
      state.countriesLocked = !!project.countriesLocked;
      $('countriesVisible').checked = state.layerVisibility.countries;
      $('drawingsVisible').checked = state.layerVisibility.drawings;
      $('labelsVisible').checked = state.layerVisibility.labels;
      $('basemapLabelsVisible').checked = state.layerVisibility.basemapLabels;
      $('countriesLocked').checked = state.countriesLocked;
      return project;
    } catch (error) {
      console.warn('자동 저장 복원 실패', error);
      return null;
    }
  }

  function queueAutosave() {
    clearTimeout(state.autosaveTimer);
    setAutosaveStatus('변경됨');
    state.autosaveTimer = setTimeout(() => {
      try {
        const data = buildProjectData();
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
        state.lastSavedAt = new Date();
        setAutosaveStatus(state.lastSavedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
      } catch (error) {
        console.warn('자동 저장 실패', error);
        setAutosaveStatus('저장 실패');
      }
    }, 900);
  }

  function downloadBlob(filename, blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function saveProjectFile() {
    const data = buildProjectData();
    const stamp = new Date().toISOString().slice(0, 10);
    downloadBlob(`chronomap_${stamp}.chronomap.json`, new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    showToast('프로젝트 파일을 저장했습니다.');
  }

  async function importGeoJson(file) {
    const text = await file.text();
    const geojson = JSON.parse(text);
    const features = geojson.type === 'FeatureCollection' ? geojson.features : geojson.type === 'Feature' ? [geojson] : [];
    if (!features.length) throw new Error('Feature 또는 FeatureCollection이 필요합니다.');
    if (!state.draw) throw new Error('Terra Draw가 준비되지 않았습니다.');

    const supported = [];
    for (const raw of features) {
      if (!['Point', 'LineString', 'Polygon'].includes(raw.geometry?.type)) continue;
      const f = deepClone(raw);
      f.properties = f.properties || {};
      if (!f.properties.mode) {
        if (f.geometry.type === 'Polygon') f.properties.mode = 'polygon';
        else if (f.geometry.type === 'LineString') f.properties.mode = 'linestring';
        else f.properties.mode = 'point';
      }
      supported.push(f);
    }
    const result = state.draw.addFeatures(supported);
    syncDrawingMetadata();
    queueAutosave();
    showToast(`GeoJSON ${result?.filter?.((r) => r.valid).length ?? supported.length}개 객체를 가져왔습니다.`);
  }

  function exportDrawingsGeoJson() {
    const features = getDrawingsSnapshot().map((feature) => {
      const f = deepClone(feature);
      const id = String(f.id ?? '');
      const meta = state.drawingMeta[id] || {};
      f.properties = {
        ...(f.properties || {}),
        name: meta.name || f.properties?.name || '',
        editorColor: meta.color || DEFAULT_DRAWING_COLOR,
        category: meta.category || 'custom',
        notes: meta.notes || '',
      };
      return f;
    });
    const geojson = { type: 'FeatureCollection', features };
    downloadBlob('chronomap_user_features.geojson', new Blob([JSON.stringify(geojson, null, 2)], { type: 'application/geo+json' }));
    showToast(`사용자 도형 ${features.length}개를 GeoJSON으로 내보냈습니다.`);
  }

  function bindUI() {
    $('globeBtn').addEventListener('click', () => setProjection('globe'));
    $('flatBtn').addEventListener('click', () => setProjection('mercator'));

    $('countriesVisible').addEventListener('change', (e) => setLayerVisibility('countries', e.target.checked));
    $('drawingsVisible').addEventListener('change', (e) => setLayerVisibility('drawings', e.target.checked));
    $('labelsVisible').addEventListener('change', (e) => setLayerVisibility('labels', e.target.checked));
    $('basemapLabelsVisible').addEventListener('change', (e) => setLayerVisibility('basemapLabels', e.target.checked));
    $('countriesLocked').addEventListener('change', (e) => {
      state.countriesLocked = e.target.checked;
      queueAutosave();
    });

    $('addLabelBtn').addEventListener('click', () => state.labelPlacementMode ? exitLabelMode() : enterLabelMode());
    $('clearSelectionBtn').addEventListener('click', clearSelection);
    $('focusBalkansBtn').addEventListener('click', () => map.flyTo({ center: [22.2, 42.3], zoom: 5.1, duration: 850 }));
    $('resetViewBtn').addEventListener('click', () => map.flyTo({ center: [15, 28], zoom: 2.0, bearing: 0, pitch: 0, duration: 900 }));

    $('countryNameInput').addEventListener('change', (e) => commitCountryEdit('name', e.target.value.trim()));
    $('countryColorInput').addEventListener('change', (e) => commitCountryEdit('color', e.target.value));
    $('capitalInput').addEventListener('change', (e) => commitCountryEdit('capital', e.target.value.trim()));
    $('notesInput').addEventListener('change', (e) => commitCountryEdit('notes', e.target.value));

    $('flagUploadBtn').addEventListener('click', () => $('flagFileInput').click());
    $('flagFileInput').addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (!file || state.selected?.type !== 'country') return;
      const reader = new FileReader();
      reader.onload = () => commitCountryEdit('flagDataUrl', reader.result);
      reader.readAsDataURL(file);
      e.target.value = '';
    });
    $('flagRemoveBtn').addEventListener('click', () => commitCountryEdit('flagDataUrl', null));

    $('drawingNameInput').addEventListener('change', (e) => commitDrawingMeta('name', e.target.value.trim()));
    $('drawingColorInput').addEventListener('change', (e) => commitDrawingMeta('color', e.target.value));
    $('drawingCategoryInput').addEventListener('change', (e) => commitDrawingMeta('category', e.target.value));
    $('drawingNotesInput').addEventListener('change', (e) => commitDrawingMeta('notes', e.target.value));

    $('labelNameInput').addEventListener('change', (e) => commitLabelEdit('name', e.target.value.trim()));
    $('labelKindInput').addEventListener('change', (e) => commitLabelEdit('kind', e.target.value));
    $('labelNotesInput').addEventListener('change', (e) => commitLabelEdit('notes', e.target.value));
    $('deleteLabelBtn').addEventListener('click', () => {
      if (state.selected?.type !== 'label') return;
      const label = state.labels.find((item) => item.id === state.selected.id);
      if (!label) return;
      state.labels = state.labels.filter((item) => item.id !== label.id);
      pushHistory({ kind: 'labelDelete', before: deepClone(label), after: null });
      refreshLabels();
      clearSelection();
      queueAutosave();
    });

    $('undoBtn').addEventListener('click', undo);
    $('redoBtn').addEventListener('click', redo);

    $('togglePanelBtn').addEventListener('click', () => {
      $('rightPanel').classList.toggle('collapsed');
      document.querySelector('.workspace').classList.toggle('panel-collapsed');
      setTimeout(() => map.resize(), 160);
    });

    $('saveProjectBtn').addEventListener('click', saveProjectFile);
    $('loadProjectBtn').addEventListener('click', () => $('projectFileInput').click());
    $('projectFileInput').addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const project = JSON.parse(await file.text());
        applyLoadedProject(project, true);
      } catch (error) {
        showToast(`프로젝트 불러오기 실패: ${error.message}`, 4000);
      }
    });

    $('newProjectBtn').addEventListener('click', () => {
      if (!confirm('현재 자동 저장 내용을 지우고 새 프로젝트를 시작할까요?')) return;
      localStorage.removeItem(STORAGE_KEY);
      location.reload();
    });

    $('importGeoJsonBtn').addEventListener('click', () => $('geoJsonFileInput').click());
    $('geoJsonFileInput').addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        await importGeoJson(file);
      } catch (error) {
        showToast(`GeoJSON 가져오기 실패: ${error.message}`, 4500);
      }
      e.target.value = '';
    });
    $('exportGeoJsonBtn').addEventListener('click', exportDrawingsGeoJson);

    map.on('mousemove', (e) => {
      $('coordStatus').textContent = `경도 ${e.lngLat.lng.toFixed(4)} · 위도 ${e.lngLat.lat.toFixed(4)}`;
    });
    map.on('zoom', () => { $('zoomStatus').textContent = `Zoom ${map.getZoom().toFixed(1)}`; });
    map.on('moveend', queueAutosave);

    map.on('click', (e) => {
      if (state.labelPlacementMode) {
        e.preventDefault();
        addLabelAt(e.lngLat);
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (state.labelPlacementMode) exitLabelMode();
        else clearSelection();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        saveProjectFile();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        const active = document.activeElement?.tagName;
        if (!['INPUT', 'TEXTAREA'].includes(active)) {
          e.preventDefault();
          undo();
        }
      }
      if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) {
        const active = document.activeElement?.tagName;
        if (!['INPUT', 'TEXTAREA'].includes(active)) {
          e.preventDefault();
          redo();
        }
      }
    });
  }

  const restored = restoreLocalProject();
  bindUI();
  updateHistoryButtons();

  map.on('load', async () => {
    addLabelLayers();
    setupTerraDraw();
    await loadCountries();

    map.setProjection({ type: state.projection === 'globe' ? 'globe' : 'mercator' });
    $('globeBtn').classList.toggle('active', state.projection === 'globe');
    $('flatBtn').classList.toggle('active', state.projection !== 'globe');

    if (restored?.view) {
      map.jumpTo({
        center: restored.view.center || [21.6, 42.1],
        zoom: restored.view.zoom ?? 3.25,
        bearing: restored.view.bearing ?? 0,
        pitch: restored.view.pitch ?? 0,
      });
      setAutosaveStatus('복원됨');
      showToast('자동 저장 프로젝트를 복원했습니다.');
    } else {
      setAutosaveStatus('준비');
    }

    refreshLabels();
    applyLayerVisibility();
  });

  map.on('style.load', () => {
    // Style reloads can change symbol layer availability.
    setTimeout(applyLayerVisibility, 50);
  });

  window.addEventListener('beforeunload', () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(buildProjectData()));
    } catch (_) {}
  });
})();
