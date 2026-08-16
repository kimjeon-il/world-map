/* ChronoMap Editor MVP 0.3
 * Fully offline static prototype.
 * Rendering: bundled D3 v3 + bundled Natural Earth 1:110m country polygons.
 * No network requests are required for the built-in globe, countries, labels or editor UI.
 */

(() => {
  'use strict';

  const STORAGE_KEY = 'chronomap-editor-mvp-v03-project';
  const DEFAULT_COLOR = '#63758a';
  const DEFAULT_DRAWING_COLOR = '#8c68d8';
  const MAX_HISTORY = 100;

  const $ = (id) => document.getElementById(id);
  const deepClone = (obj) => JSON.parse(JSON.stringify(obj));
  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const uid = (prefix = 'obj') => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

  const state = {
    countriesData: null,
    countryIndex: new Map(),
    countryOverrides: {},
    labels: [],
    drawings: [],
    selected: null,
    projection: 'globe',
    layerVisibility: {
      countries: true,
      drawings: true,
      labels: true,
      basemapLabels: true,
    },
    countriesLocked: false,
    tool: 'select',
    labelPlacementMode: false,
    draftCoords: [],
    draftHover: null,
    history: [],
    future: [],
    autosaveTimer: null,
    lastSavedAt: null,
    view: {
      globeRotation: [-15, -25, 0],
      globeZoom: 1,
      flatCenter: [0, 20],
      flatZoom: 1,
    },
    size: { width: 1000, height: 700 },
  };

  let svg;
  let root;
  let shadowLayer;
  let oceanLayer;
  let graticuleLayer;
  let countryLayer;
  let drawingLayer;
  let countryLabelLayer;
  let labelLayer;
  let vertexLayer;
  let draftLayer;

  const globeProjection = d3.geo.orthographic().clipAngle(90).precision(0.35);
  const flatProjection = d3.geo.equirectangular().precision(0.25);
  const path = d3.geo.path().pointRadius(5);
  const graticule = d3.geo.graticule();

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

  function setCurrentTool(name) {
    $('currentToolName').textContent = name || '선택·편집';
  }

  function setActionStatus(message, tone = 'success', timeout = 1800) {
    const chip = $('actionStatus');
    const last = $('lastActionStatus');
    if (last) last.textContent = `마지막 동작 · ${message}`;
    if (!chip) return;
    chip.classList.remove('ready', 'working', 'success', 'error');
    chip.classList.add(tone);
    const strong = chip.querySelector('strong');
    if (strong) strong.textContent = message;
    clearTimeout(setActionStatus._timer);
    if (timeout > 0) {
      setActionStatus._timer = setTimeout(() => {
        chip.classList.remove('working', 'success', 'error');
        chip.classList.add('ready');
        if (strong) strong.textContent = '준비';
      }, timeout);
    }
  }

  function flashButton(button) {
    if (!button || button.disabled) return;
    button.classList.remove('button-flash');
    void button.offsetWidth;
    button.classList.add('button-flash');
    setTimeout(() => button.classList.remove('button-flash'), 260);
  }

  function slugify(value) {
    return String(value || 'country')
      .normalize('NFKD')
      .replace(/[^A-Za-z0-9가-힣]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'country';
  }

  function featureCountryId(feature, index) {
    const p = feature.properties || {};
    const iso = p.iso_a3 || p.ISO_A3 || p.ADM0_A3;
    if (iso && iso !== '-99') return String(iso);
    return `${slugify(p.name || p.ADMIN || p.NAME)}_${index}`;
  }

  function featureCountryName(feature) {
    const p = feature.properties || {};
    return p.name || p.ADMIN || p.NAME || p.NAME_LONG || '이름 없는 국가';
  }

  function normalizeCountries(raw) {
    const fc = raw?.type === 'FeatureCollection' ? deepClone(raw) : { type: 'FeatureCollection', features: [] };
    state.countryIndex.clear();
    fc.features.forEach((feature, index) => {
      feature.properties = feature.properties || {};
      const id = featureCountryId(feature, index);
      const originalName = featureCountryName(feature);
      const override = state.countryOverrides[id] || {};
      feature.properties.editor_id = id;
      feature.properties.editor_original_name = originalName;
      feature.properties.editor_name = override.name || originalName;
      feature.properties.editor_color = override.color || DEFAULT_COLOR;
      try {
        feature.properties.editor_centroid = d3.geo.centroid(feature);
      } catch (_) {
        feature.properties.editor_centroid = [0, 0];
      }
      state.countryIndex.set(id, index);
    });
    return fc;
  }

  function activeProjection() {
    return state.projection === 'globe' ? globeProjection : flatProjection;
  }

  function updateProjection() {
    const { width, height } = state.size;
    if (state.projection === 'globe') {
      const base = Math.max(60, Math.min(width, height - 26) * 0.455);
      globeProjection
        .translate([width / 2, height / 2])
        .scale(base * state.view.globeZoom)
        .rotate(state.view.globeRotation)
        .clipAngle(90);
      path.projection(globeProjection);
    } else {
      const base = Math.max(30, width / (2 * Math.PI));
      flatProjection
        .translate([width / 2, height / 2])
        .scale(base * state.view.flatZoom)
        .center(state.view.flatCenter)
        .rotate([0, 0, 0])
        .clipExtent([[0, 0], [width, height - 25]]);
      path.projection(flatProjection);
    }
    updateZoomStatus();
  }

  function updateZoomStatus() {
    $('zoomStatus').textContent = state.projection === 'globe'
      ? `Globe ×${state.view.globeZoom.toFixed(1)}`
      : `Flat ×${state.view.flatZoom.toFixed(1)}`;
  }

  function isCoordVisible(coord) {
    if (!coord) return false;
    const p = activeProjection()(coord);
    if (!p || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) return false;
    if (state.projection === 'globe') {
      const r = state.view.globeRotation;
      const center = [-r[0], -r[1]];
      return d3.geo.distance(coord, center) <= Math.PI / 2 + 0.005;
    }
    return p[0] >= -30 && p[0] <= state.size.width + 30 && p[1] >= -30 && p[1] <= state.size.height + 30;
  }

  function screenToGeo(screenPoint) {
    const projection = activeProjection();
    if (state.projection === 'globe') {
      const c = projection.translate();
      const s = projection.scale();
      const dx = screenPoint[0] - c[0];
      const dy = screenPoint[1] - c[1];
      if ((dx * dx + dy * dy) > s * s) return null;
    }
    const coord = projection.invert(screenPoint);
    if (!coord || !Number.isFinite(coord[0]) || !Number.isFinite(coord[1])) return null;
    let lon = ((coord[0] + 540) % 360) - 180;
    let lat = clamp(coord[1], -89.999, 89.999);
    return [lon, lat];
  }

  function drawingColor(feature) {
    return feature.properties?.editorColor || DEFAULT_DRAWING_COLOR;
  }

  function drawingName(feature) {
    return feature.properties?.name || `사용자 도형 ${String(feature.id || '').slice(0, 8)}`;
  }

  function countryColor(feature) {
    return feature.properties?.editor_color || DEFAULT_COLOR;
  }

  function countryName(feature) {
    return feature.properties?.editor_name || feature.properties?.editor_original_name || feature.properties?.name || '국가';
  }

  function shouldShowCountryLabel(feature) {
    if (!state.layerVisibility.basemapLabels) return false;
    const pop = Number(feature.properties?.pop_est || 0);
    const z = state.projection === 'globe' ? state.view.globeZoom : state.view.flatZoom;
    let threshold = 30_000_000;
    if (z >= 1.4) threshold = 12_000_000;
    if (z >= 2) threshold = 4_000_000;
    if (z >= 3) threshold = 1_000_000;
    if (z >= 4.5) threshold = 0;
    if (state.selected?.type === 'country' && state.selected.id === feature.properties?.editor_id) return true;
    return pop >= threshold;
  }

  function renderCountries() {
    const data = state.layerVisibility.countries && state.countriesData ? state.countriesData.features : [];
    const selection = countryLayer.selectAll('path.country-shape')
      .data(data, d => d.properties.editor_id);

    selection.enter().append('path')
      .attr('class', 'country-shape')
      .on('click', function(d) {
        if (d3.event.defaultPrevented) return;
        // In drawing/label modes the click must bubble to the SVG so the map
        // receives the coordinate even when a country polygon is underneath.
        if (state.tool !== 'select' || state.labelPlacementMode) return;
        d3.event.stopPropagation();
        if (state.countriesLocked) {
          setActionStatus('국가 레이어가 잠겨 있음', 'error');
          return;
        }
        selectCountry(d.properties.editor_id);
      });

    selection
      .attr('d', path)
      .style('fill', countryColor)
      .style('fill-opacity', 0.74)
      .classed('selected', d => state.selected?.type === 'country' && state.selected.id === d.properties.editor_id)
      .classed('locked', state.countriesLocked);

    selection.exit().remove();
  }

  function renderCountryLabels() {
    const features = state.countriesData?.features || [];
    const data = features.filter(f => {
      const c = f.properties?.editor_centroid;
      return shouldShowCountryLabel(f) && isCoordVisible(c);
    });

    const selection = countryLabelLayer.selectAll('text.country-label')
      .data(data, d => d.properties.editor_id);

    selection.enter().append('text')
      .attr('class', 'country-label')
      .attr('dy', '.35em')
      .on('click', function(d) {
        if (state.tool !== 'select' || state.labelPlacementMode) return;
        d3.event.stopPropagation();
        if (state.countriesLocked) return;
        selectCountry(d.properties.editor_id);
      });

    selection
      .text(countryName)
      .classed('major', d => Number(d.properties?.pop_est || 0) >= 50_000_000)
      .attr('transform', d => {
        const p = activeProjection()(d.properties.editor_centroid);
        return p ? `translate(${p[0]},${p[1]})` : 'translate(-9999,-9999)';
      });

    selection.exit().remove();
  }

  function renderDrawings() {
    const data = state.layerVisibility.drawings ? state.drawings : [];
    const selection = drawingLayer.selectAll('path.drawing-shape')
      .data(data, d => String(d.id));

    selection.enter().append('path')
      .attr('class', 'drawing-shape')
      .on('click', function(d) {
        if (d3.event.defaultPrevented) return;
        if (state.tool !== 'select' || state.labelPlacementMode) return;
        d3.event.stopPropagation();
        selectDrawing(String(d.id));
      });

    selection
      .attr('d', path)
      .style('fill', d => d.geometry?.type?.includes('Polygon') ? drawingColor(d) : 'none')
      .style('fill-opacity', d => d.geometry?.type?.includes('Polygon') ? 0.34 : 0)
      .style('stroke', drawingColor)
      .classed('selected', d => state.selected?.type === 'drawing' && state.selected.id === String(d.id));

    selection.exit().remove();
  }

  function renderUserLabels() {
    const data = state.layerVisibility.labels
      ? state.labels.filter(l => isCoordVisible(l.coordinates))
      : [];

    const selection = labelLayer.selectAll('g.user-label')
      .data(data, d => d.id);

    const enter = selection.enter().append('g')
      .attr('class', 'user-label')
      .on('click', function(d) {
        if (d3.event.defaultPrevented) return;
        if (state.tool !== 'select' || state.labelPlacementMode) return;
        d3.event.stopPropagation();
        selectLabel(d.id);
      });

    enter.append('circle').attr('class', 'user-label-dot').attr('r', 4);
    enter.append('text').attr('class', 'user-label-text').attr('x', 7).attr('dy', '.35em');

    selection
      .classed('selected', d => state.selected?.type === 'label' && state.selected.id === d.id)
      .attr('transform', d => {
        const p = activeProjection()(d.coordinates);
        return p ? `translate(${p[0]},${p[1]})` : 'translate(-9999,-9999)';
      });

    selection.select('text').text(d => d.name);
    // Drag capture would otherwise eat clicks intended for drawing tools.
    selection.on('.drag', null);
    if (state.tool === 'select' && !state.labelPlacementMode) selection.call(labelDragBehavior());
    selection.exit().remove();
  }

  function getEditableVertices(feature) {
    if (!feature?.geometry) return [];
    const type = feature.geometry.type;
    if (type === 'LineString') {
      return feature.geometry.coordinates.map((coord, index) => ({ index, coord }));
    }
    if (type === 'Polygon') {
      const ring = feature.geometry.coordinates?.[0] || [];
      return ring.slice(0, Math.max(0, ring.length - 1)).map((coord, index) => ({ index, coord }));
    }
    return [];
  }

  function renderVertices() {
    let data = [];
    let feature = null;
    if (state.tool === 'select' && state.selected?.type === 'drawing') {
      feature = state.drawings.find(f => String(f.id) === state.selected.id);
      if (feature) data = getEditableVertices(feature).filter(v => isCoordVisible(v.coord));
    }
    const selection = vertexLayer.selectAll('circle.vertex-handle').data(data, d => d.index);
    selection.enter().append('circle').attr('class', 'vertex-handle').attr('r', 4.5);
    selection
      .attr('transform', d => {
        const p = activeProjection()(d.coord);
        return p ? `translate(${p[0]},${p[1]})` : 'translate(-9999,-9999)';
      })
      .call(vertexDragBehavior(feature));
    selection.exit().remove();
  }

  function draftFeature() {
    const coords = state.draftCoords.slice();
    if (state.draftHover) coords.push(state.draftHover);
    if (state.tool === 'polygon') {
      if (!coords.length) return null;
      // A GeoJSON polygon is only valid once it has at least three vertices.
      // Until then, draw the draft as a line so D3 never receives an invalid polygon ring.
      if (coords.length < 3) {
        return { type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: {} };
      }
      const ring = coords.slice();
      ring.push(ring[0]);
      return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [ring] }, properties: {} };
    }
    if (state.tool === 'line') {
      if (!coords.length) return null;
      return { type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: {} };
    }
    return null;
  }

  function renderDraft() {
    draftLayer.selectAll('*').remove();
    const feature = draftFeature();
    if (feature && (feature.geometry.coordinates?.length || feature.geometry.coordinates?.[0]?.length)) {
      draftLayer.append('path').datum(feature).attr('class', 'draft-shape').attr('d', path);
    }
    const visible = state.draftCoords.filter(isCoordVisible);
    draftLayer.selectAll('circle.draft-vertex').data(visible).enter().append('circle')
      .attr('class', 'draft-vertex').attr('r', 3.5)
      .attr('transform', d => {
        const p = activeProjection()(d);
        return `translate(${p[0]},${p[1]})`;
      });
  }

  function renderBase() {
    shadowLayer.datum({ type: 'Sphere' }).attr('d', path);
    oceanLayer.datum({ type: 'Sphere' }).attr('d', path);
    graticuleLayer.datum(graticule()).attr('d', path);
  }

  function renderAll() {
    updateProjection();
    renderBase();
    renderCountries();
    renderDrawings();
    renderCountryLabels();
    renderUserLabels();
    renderVertices();
    renderDraft();
  }

  function initSvg() {
    const map = d3.select('#map');
    map.selectAll('*').remove();
    svg = map.append('svg').attr('class', 'map-svg');
    root = svg.append('g').attr('class', 'map-root');
    shadowLayer = root.append('path').attr('class', 'globe-shadow');
    oceanLayer = root.append('path').attr('class', 'map-ocean');
    graticuleLayer = root.append('path').attr('class', 'map-graticule');
    countryLayer = root.append('g').attr('class', 'countries-layer');
    drawingLayer = root.append('g').attr('class', 'drawings-layer');
    countryLabelLayer = root.append('g').attr('class', 'country-label-layer');
    labelLayer = root.append('g').attr('class', 'labels-layer');
    vertexLayer = root.append('g').attr('class', 'vertices-layer');
    draftLayer = root.append('g').attr('class', 'draft-layer');

    const mapEl = $('map');
    mapEl.insertAdjacentHTML('beforeend', '<div class="map-instruction">드래그: 지도 이동 · 휠: 확대/축소 · 선택 도구: 객체 편집</div>');

    const drag = d3.behavior.drag()
      .on('dragstart', () => {
        if (state.tool !== 'select' || state.labelPlacementMode) return;
        $('map').classList.add('dragging');
      })
      .on('drag', () => {
        if (state.tool !== 'select' || state.labelPlacementMode) return;
        if (state.projection === 'globe') {
          const sensitivity = 0.22 / Math.max(0.75, Math.sqrt(state.view.globeZoom));
          state.view.globeRotation[0] += d3.event.dx * sensitivity;
          state.view.globeRotation[1] -= d3.event.dy * sensitivity;
          state.view.globeRotation[1] = clamp(state.view.globeRotation[1], -89, 89);
        } else {
          const scale = flatProjection.scale();
          state.view.flatCenter[0] -= d3.event.dx * 180 / (Math.PI * scale);
          state.view.flatCenter[1] += d3.event.dy * 180 / (Math.PI * scale);
          state.view.flatCenter[1] = clamp(state.view.flatCenter[1], -85, 85);
          state.view.flatCenter[0] = ((state.view.flatCenter[0] + 540) % 360) - 180;
        }
        renderAll();
      })
      .on('dragend', () => {
        $('map').classList.remove('dragging');
        if (state.tool !== 'select' || state.labelPlacementMode) return;
        queueAutosave();
        setActionStatus('지도 이동 완료', 'success');
      });

    svg.call(drag);

    svg.on('click', function() {
      if (d3.event.defaultPrevented) return;
      handleMapClick(d3.mouse(this));
    });

    svg.on('dblclick', function() {
      if (['polygon', 'line'].includes(state.tool) && state.draftCoords.length) {
        d3.event.preventDefault();
        finishDraft();
      }
    });

    svg.on('mousemove', function() {
      const coord = screenToGeo(d3.mouse(this));
      if (coord) {
        $('coordStatus').textContent = `경도 ${coord[0].toFixed(4)} · 위도 ${coord[1].toFixed(4)}`;
        if (['polygon', 'line'].includes(state.tool) && state.draftCoords.length) {
          state.draftHover = coord;
          renderDraft();
        }
      } else {
        $('coordStatus').textContent = '지구본 바깥';
        if (state.draftHover) {
          state.draftHover = null;
          renderDraft();
        }
      }
    });

    mapEl.addEventListener('wheel', (event) => {
      event.preventDefault();
      const factor = Math.exp(-event.deltaY * 0.0013);
      if (state.projection === 'globe') {
        state.view.globeZoom = clamp(state.view.globeZoom * factor, 0.72, 14);
      } else {
        state.view.flatZoom = clamp(state.view.flatZoom * factor, 0.75, 28);
      }
      renderAll();
      queueAutosave();
    }, { passive: false });
  }

  function resizeMap() {
    const el = $('map');
    state.size.width = Math.max(320, el.clientWidth || 900);
    state.size.height = Math.max(300, el.clientHeight || 650);
    if (svg) svg.attr('width', state.size.width).attr('height', state.size.height);
    renderAll();
  }

  function setTool(tool) {
    if (state.tool !== tool && state.draftCoords.length) cancelDraft(false);
    state.labelPlacementMode = false;
    state.tool = tool;
    const names = {
      select: '선택·편집', polygon: '폴리곤 그리기', line: '선 그리기', point: '점 찍기', label: '지명 배치',
    };
    setCurrentTool(names[tool] || tool);
    $('modeBanner').classList.add('hidden');
    $('map').classList.toggle('drawing-mode', ['polygon', 'line', 'point'].includes(tool));
    $('map').classList.toggle('select-mode', tool === 'select');
    ['select', 'polygon', 'line', 'point'].forEach(name => {
      const btn = $(`${name}ToolBtn`);
      if (btn) btn.classList.toggle('active', name === tool);
    });
    $('addLabelBtn').classList.remove('active');
    renderVertices();
    renderDraft();
    setActionStatus(`도구 선택 · ${names[tool] || tool}`, 'success');
  }

  function enterLabelMode() {
    if (state.draftCoords.length) cancelDraft(false);
    state.tool = 'label';
    state.labelPlacementMode = true;
    setCurrentTool('지명 배치');
    $('addLabelBtn').classList.add('active');
    ['selectToolBtn', 'polygonToolBtn', 'lineToolBtn', 'pointToolBtn'].forEach(id => $(id)?.classList.remove('active'));
    $('map').classList.add('drawing-mode');
    const banner = $('modeBanner');
    banner.textContent = '지도에서 지명을 놓을 위치를 클릭하세요. ESC로 취소';
    banner.classList.remove('hidden');
    setActionStatus('지명 배치 모드', 'working', 0);
  }

  function exitLabelMode() {
    state.labelPlacementMode = false;
    state.tool = 'select';
    $('addLabelBtn').classList.remove('active');
    $('selectToolBtn').classList.add('active');
    $('map').classList.remove('drawing-mode');
    $('map').classList.add('select-mode');
    $('modeBanner').classList.add('hidden');
    setCurrentTool('선택·편집');
    setActionStatus('지명 배치 취소', 'success');
  }

  function handleMapClick(screenPoint) {
    const coord = screenToGeo(screenPoint);
    if (!coord) return;
    if (state.labelPlacementMode) {
      addLabelAt(coord);
      return;
    }
    if (state.tool === 'polygon' || state.tool === 'line') {
      state.draftCoords.push(coord);
      state.draftHover = null;
      renderDraft();
      const min = state.tool === 'polygon' ? 3 : 2;
      const banner = $('modeBanner');
      banner.textContent = `${state.draftCoords.length}개 꼭짓점 · 최소 ${min}개 · 완료 버튼 또는 더블클릭`;
      banner.classList.remove('hidden');
      setActionStatus(`꼭짓점 ${state.draftCoords.length}개 입력`, 'success');
      return;
    }
    if (state.tool === 'point') {
      recordHistory();
      const feature = {
        type: 'Feature', id: uid('point'),
        geometry: { type: 'Point', coordinates: coord },
        properties: { name: '', editorColor: DEFAULT_DRAWING_COLOR, category: 'custom', notes: '' },
      };
      state.drawings.push(feature);
      setTool('select');
      selectDrawing(String(feature.id));
      renderAll();
      queueAutosave();
      setActionStatus('점 객체 생성 완료', 'success');
      return;
    }
    if (state.tool === 'select') clearSelection();
  }

  function finishDraft() {
    if (!['polygon', 'line'].includes(state.tool)) {
      setActionStatus('완료할 도형이 없음', 'error');
      return;
    }
    const min = state.tool === 'polygon' ? 3 : 2;
    if (state.draftCoords.length < min) {
      showToast(`${state.tool === 'polygon' ? '폴리곤' : '선'}은 꼭짓점이 최소 ${min}개 필요합니다.`);
      setActionStatus('꼭짓점 부족', 'error');
      return;
    }
    recordHistory();
    const id = uid(state.tool === 'polygon' ? 'poly' : 'line');
    let geometry;
    if (state.tool === 'polygon') {
      const ring = state.draftCoords.map(c => c.slice());
      ring.push(ring[0].slice());
      geometry = { type: 'Polygon', coordinates: [ring] };
    } else {
      geometry = { type: 'LineString', coordinates: state.draftCoords.map(c => c.slice()) };
    }
    const feature = {
      type: 'Feature', id, geometry,
      properties: { name: '', editorColor: DEFAULT_DRAWING_COLOR, category: 'custom', notes: '' },
    };
    state.drawings.push(feature);
    state.draftCoords = [];
    state.draftHover = null;
    $('modeBanner').classList.add('hidden');
    setTool('select');
    selectDrawing(String(id));
    renderAll();
    queueAutosave();
    setActionStatus('사용자 도형 생성 완료', 'success');
  }

  function cancelDraft(showMessage = true) {
    state.draftCoords = [];
    state.draftHover = null;
    $('modeBanner').classList.add('hidden');
    renderDraft();
    if (showMessage) setActionStatus('도형 그리기 취소', 'success');
  }

  function addLabelAt(coord) {
    const name = prompt('지명 또는 도시명을 입력하세요.', '새 지명');
    if (name === null) return;
    recordHistory();
    const label = { id: uid('label'), name: name.trim() || '새 지명', kind: 'city', coordinates: coord.slice(), notes: '' };
    state.labels.push(label);
    exitLabelMode();
    selectLabel(label.id);
    renderAll();
    queueAutosave();
    setActionStatus(`지명 추가 · ${label.name}`, 'success');
  }

  function vertexDragBehavior(feature) {
    return d3.behavior.drag()
      .on('dragstart', function() {
        if (!feature || state.tool !== 'select') return;
        recordHistory();
        d3.event.sourceEvent?.stopPropagation?.();
      })
      .on('drag', function(vertex) {
        if (!feature || state.tool !== 'select') return;
        const coord = screenToGeo(d3.mouse(svg.node()));
        if (!coord) return;
        if (feature.geometry.type === 'LineString') {
          feature.geometry.coordinates[vertex.index] = coord;
        } else if (feature.geometry.type === 'Polygon') {
          const ring = feature.geometry.coordinates[0];
          ring[vertex.index] = coord;
          if (vertex.index === 0) ring[ring.length - 1] = coord.slice();
        }
        drawingLayer.selectAll('path.drawing-shape').attr('d', path);
        vertexLayer.selectAll('circle.vertex-handle').attr('transform', d => {
          const f = state.drawings.find(x => String(x.id) === state.selected?.id);
          const verts = getEditableVertices(f);
          const fresh = verts.find(v => v.index === d.index) || d;
          const p = activeProjection()(fresh.coord);
          return p ? `translate(${p[0]},${p[1]})` : 'translate(-9999,-9999)';
        });
      })
      .on('dragend', function() {
        if (!feature) return;
        renderAll();
        queueAutosave();
        setActionStatus('꼭짓점 이동 완료', 'success');
      });
  }

  function labelDragBehavior() {
    return d3.behavior.drag()
      .on('dragstart', function() {
        if (state.tool !== 'select') return;
        recordHistory();
        d3.event.sourceEvent?.stopPropagation?.();
      })
      .on('drag', function(label) {
        if (state.tool !== 'select') return;
        const coord = screenToGeo(d3.mouse(svg.node()));
        if (!coord) return;
        label.coordinates = coord;
        const p = activeProjection()(coord);
        d3.select(this).attr('transform', `translate(${p[0]},${p[1]})`);
      })
      .on('dragend', function(label) {
        if (state.tool !== 'select') return;
        queueAutosave();
        setActionStatus(`지명 이동 · ${label.name}`, 'success');
      });
  }

  function showPropertyForm(type) {
    $('emptyProperties').classList.toggle('hidden', !!type);
    $('countryProperties').classList.toggle('hidden', type !== 'country');
    $('drawingProperties').classList.toggle('hidden', type !== 'drawing');
    $('labelProperties').classList.toggle('hidden', type !== 'label');
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

  function selectCountry(id) {
    const idx = state.countryIndex.get(String(id));
    if (idx === undefined) return;
    const feature = state.countriesData.features[idx];
    const p = feature.properties || {};
    const override = state.countryOverrides[id] || {};
    state.selected = { type: 'country', id: String(id) };
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
    renderAll();
    setActionStatus(`국가 선택 · ${$('propertyTitle').textContent}`, 'success');
  }

  function selectDrawing(id) {
    const feature = state.drawings.find(f => String(f.id) === String(id));
    if (!feature) return;
    const meta = feature.properties || (feature.properties = {});
    state.selected = { type: 'drawing', id: String(id) };
    showPropertyForm('drawing');
    $('propertyTitle').textContent = drawingName(feature);
    $('propertyType').textContent = '도형';
    $('drawingNameInput').value = meta.name || '';
    $('drawingIdInput').value = String(id);
    $('drawingColorInput').value = meta.editorColor || DEFAULT_DRAWING_COLOR;
    $('drawingCategoryInput').value = meta.category || 'custom';
    $('drawingNotesInput').value = meta.notes || '';
    $('selectionStatus').textContent = `도형 · ${meta.name || String(id).slice(0, 8)}`;
    renderAll();
    setActionStatus('사용자 도형 선택됨', 'success');
  }

  function selectLabel(id) {
    const label = state.labels.find(item => item.id === id);
    if (!label) return;
    state.selected = { type: 'label', id };
    showPropertyForm('label');
    $('propertyTitle').textContent = label.name;
    $('propertyType').textContent = '지명';
    $('labelNameInput').value = label.name;
    $('labelKindInput').value = label.kind;
    $('labelNotesInput').value = label.notes || '';
    $('selectionStatus').textContent = `지명 · ${label.name}`;
    renderAll();
    setActionStatus(`지명 선택 · ${label.name}`, 'success');
  }

  function clearSelection() {
    state.selected = null;
    $('propertyTitle').textContent = '선택 없음';
    $('propertyType').textContent = '—';
    $('selectionStatus').textContent = '선택 없음';
    showPropertyForm(null);
    renderAll();
    setActionStatus('선택 해제', 'success');
  }

  function commitCountryEdit(field, value) {
    if (state.selected?.type !== 'country') return;
    recordHistory();
    const id = state.selected.id;
    state.countryOverrides[id] = { ...(state.countryOverrides[id] || {}), [field]: value };
    const idx = state.countryIndex.get(id);
    if (idx !== undefined) {
      const f = state.countriesData.features[idx];
      f.properties.editor_name = state.countryOverrides[id].name || f.properties.editor_original_name;
      f.properties.editor_color = state.countryOverrides[id].color || DEFAULT_COLOR;
    }
    selectCountry(id);
    queueAutosave();
    setActionStatus('국가 속성 변경됨', 'success');
  }

  function commitDrawingMeta(field, value) {
    if (state.selected?.type !== 'drawing') return;
    const f = state.drawings.find(x => String(x.id) === state.selected.id);
    if (!f) return;
    recordHistory();
    f.properties = f.properties || {};
    f.properties[field] = value;
    selectDrawing(state.selected.id);
    queueAutosave();
    setActionStatus('도형 속성 변경됨', 'success');
  }

  function commitLabelEdit(field, value) {
    if (state.selected?.type !== 'label') return;
    const label = state.labels.find(x => x.id === state.selected.id);
    if (!label) return;
    recordHistory();
    label[field] = value;
    selectLabel(label.id);
    queueAutosave();
    setActionStatus('지명 속성 변경됨', 'success');
  }

  function snapshotEditable() {
    return deepClone({
      countryOverrides: state.countryOverrides,
      labels: state.labels,
      drawings: state.drawings,
    });
  }

  function recordHistory() {
    state.history.push(snapshotEditable());
    if (state.history.length > MAX_HISTORY) state.history.shift();
    state.future = [];
    updateHistoryButtons();
  }

  function restoreEditable(snapshot) {
    state.countryOverrides = deepClone(snapshot.countryOverrides || {});
    state.labels = deepClone(snapshot.labels || []);
    state.drawings = deepClone(snapshot.drawings || []);
    state.countriesData = normalizeCountries(window.CHRONOMAP_COUNTRIES || { type: 'FeatureCollection', features: [] });
    state.selected = null;
    showPropertyForm(null);
    $('propertyTitle').textContent = '선택 없음';
    $('propertyType').textContent = '—';
    $('selectionStatus').textContent = '선택 없음';
    renderAll();
    queueAutosave();
  }

  function undo() {
    if (!state.history.length) return;
    state.future.push(snapshotEditable());
    const prev = state.history.pop();
    restoreEditable(prev);
    updateHistoryButtons();
    setActionStatus('실행취소 완료', 'success');
  }

  function redo() {
    if (!state.future.length) return;
    state.history.push(snapshotEditable());
    const next = state.future.pop();
    restoreEditable(next);
    updateHistoryButtons();
    setActionStatus('다시실행 완료', 'success');
  }

  function updateHistoryButtons() {
    $('undoBtn').disabled = !state.history.length;
    $('redoBtn').disabled = !state.future.length;
  }

  function setProjection(type) {
    state.projection = type === 'globe' ? 'globe' : 'flat';
    $('globeBtn').classList.toggle('active', state.projection === 'globe');
    $('flatBtn').classList.toggle('active', state.projection === 'flat');
    renderAll();
    queueAutosave();
    setActionStatus(state.projection === 'globe' ? '지구본 보기' : '평면 보기', 'success');
  }

  function setLayerVisibility(key, visible) {
    state.layerVisibility[key] = visible;
    renderAll();
    queueAutosave();
    const names = { countries: '국가', drawings: '사용자 도형', labels: '도시·지명', basemapLabels: '국가명 라벨' };
    setActionStatus(`${names[key]} ${visible ? '표시' : '숨김'}`, 'success');
  }

  function buildProjectData() {
    return {
      format: 'chronomap-project',
      version: 0.3,
      savedAt: new Date().toISOString(),
      countryOverrides: state.countryOverrides,
      labels: state.labels,
      drawings: state.drawings,
      projection: state.projection,
      layerVisibility: state.layerVisibility,
      countriesLocked: state.countriesLocked,
      view: state.view,
      baseDataset: 'Natural Earth 1:110m bundled',
    };
  }

  function queueAutosave() {
    setAutosaveStatus('저장 대기…');
    clearTimeout(state.autosaveTimer);
    state.autosaveTimer = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(buildProjectData()));
        state.lastSavedAt = new Date();
        setAutosaveStatus(state.lastSavedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
      } catch (error) {
        console.warn('Autosave failed', error);
        setAutosaveStatus('저장 실패');
      }
    }, 650);
  }

  function restoreLocalProject() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  function applyLoadedProject(project, manual = false) {
    if (!project || typeof project !== 'object') throw new Error('프로젝트 형식이 올바르지 않습니다.');
    state.countryOverrides = deepClone(project.countryOverrides || {});
    state.labels = deepClone(project.labels || []);
    state.drawings = deepClone(project.drawings || project.restoreDrawings || []);
    state.projection = project.projection || project.view?.projection || 'globe';
    state.layerVisibility = { ...state.layerVisibility, ...(project.layerVisibility || {}) };
    state.countriesLocked = !!project.countriesLocked;
    state.view = { ...state.view, ...(project.view || {}) };
    if (project.view?.center && !project.view.flatCenter) state.view.flatCenter = project.view.center;
    state.countriesData = normalizeCountries(window.CHRONOMAP_COUNTRIES);
    state.history = [];
    state.future = [];
    state.selected = null;
    state.draftCoords = [];
    state.draftHover = null;

    $('globeBtn').classList.toggle('active', state.projection === 'globe');
    $('flatBtn').classList.toggle('active', state.projection !== 'globe');
    $('countriesVisible').checked = state.layerVisibility.countries;
    $('drawingsVisible').checked = state.layerVisibility.drawings;
    $('labelsVisible').checked = state.layerVisibility.labels;
    $('basemapLabelsVisible').checked = state.layerVisibility.basemapLabels;
    $('countriesLocked').checked = state.countriesLocked;
    showPropertyForm(null);
    renderAll();
    updateHistoryButtons();
    setTool('select');
    queueAutosave();
    if (manual) showToast('프로젝트를 불러왔습니다.');
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
    const data = JSON.stringify(buildProjectData(), null, 2);
    downloadBlob('chronomap-project.chronomap', new Blob([data], { type: 'application/json' }));
    setActionStatus('프로젝트 파일 저장 완료', 'success');
    showToast('프로젝트 파일을 저장했습니다.');
  }

  async function importGeoJson(file) {
    const parsed = JSON.parse(await file.text());
    const features = parsed.type === 'FeatureCollection' ? parsed.features : parsed.type === 'Feature' ? [parsed] : [];
    const supported = [];
    for (const raw of features) {
      if (!['Point', 'LineString', 'Polygon', 'MultiLineString', 'MultiPolygon'].includes(raw.geometry?.type)) continue;
      const f = deepClone(raw);
      f.id = String(f.id || uid('import'));
      const p = f.properties || {};
      f.properties = {
        ...p,
        name: p.name || '',
        editorColor: p.editorColor || p.color || DEFAULT_DRAWING_COLOR,
        category: p.category || 'custom',
        notes: p.notes || '',
      };
      supported.push(f);
    }
    if (!supported.length) throw new Error('지원되는 Point/LineString/Polygon 객체가 없습니다.');
    recordHistory();
    state.drawings.push(...supported);
    renderAll();
    queueAutosave();
    showToast(`GeoJSON ${supported.length}개 객체를 가져왔습니다.`);
    setActionStatus(`GeoJSON 가져오기 완료 · ${supported.length}개`, 'success');
  }

  function exportDrawingsGeoJson() {
    const geojson = { type: 'FeatureCollection', features: deepClone(state.drawings) };
    downloadBlob('chronomap_user_features.geojson', new Blob([JSON.stringify(geojson, null, 2)], { type: 'application/geo+json' }));
    showToast(`사용자 도형 ${state.drawings.length}개를 GeoJSON으로 내보냈습니다.`);
    setActionStatus(`GeoJSON 내보내기 완료 · ${state.drawings.length}개`, 'success');
  }

  function deleteSelected() {
    if (!state.selected) {
      setActionStatus('삭제할 선택 객체 없음', 'error');
      return;
    }
    if (state.selected.type === 'country') {
      setActionStatus('내장 국가는 삭제 불가 · 향후 영토편집에서 지원', 'error', 3500);
      return;
    }
    recordHistory();
    if (state.selected.type === 'drawing') {
      state.drawings = state.drawings.filter(f => String(f.id) !== state.selected.id);
    } else if (state.selected.type === 'label') {
      state.labels = state.labels.filter(l => l.id !== state.selected.id);
    }
    clearSelection();
    queueAutosave();
    setActionStatus('선택 객체 삭제 완료', 'success');
  }

  function focusBalkans() {
    if (state.projection === 'globe') {
      state.view.globeRotation = [-22.2, -42.3, 0];
      state.view.globeZoom = 3.25;
    } else {
      state.view.flatCenter = [22.2, 42.3];
      state.view.flatZoom = 5.8;
    }
    renderAll();
    queueAutosave();
    setActionStatus('발칸으로 이동 완료', 'success');
  }

  function resetView() {
    if (state.projection === 'globe') {
      state.view.globeRotation = [-15, -25, 0];
      state.view.globeZoom = 1;
    } else {
      state.view.flatCenter = [0, 20];
      state.view.flatZoom = 1;
    }
    renderAll();
    queueAutosave();
    setActionStatus('세계 보기로 복귀', 'success');
  }

  function bindUI() {
    document.addEventListener('click', e => {
      const button = e.target.closest('button');
      if (button) flashButton(button);
    });

    $('globeBtn').addEventListener('click', () => setProjection('globe'));
    $('flatBtn').addEventListener('click', () => setProjection('flat'));

    $('countriesVisible').addEventListener('change', e => setLayerVisibility('countries', e.target.checked));
    $('drawingsVisible').addEventListener('change', e => setLayerVisibility('drawings', e.target.checked));
    $('labelsVisible').addEventListener('change', e => setLayerVisibility('labels', e.target.checked));
    $('basemapLabelsVisible').addEventListener('change', e => setLayerVisibility('basemapLabels', e.target.checked));
    $('countriesLocked').addEventListener('change', e => {
      state.countriesLocked = e.target.checked;
      renderCountries();
      queueAutosave();
      setActionStatus(`국가 레이어 ${state.countriesLocked ? '잠금' : '잠금 해제'}`, 'success');
    });

    $('selectToolBtn').addEventListener('click', () => setTool('select'));
    $('polygonToolBtn').addEventListener('click', () => setTool('polygon'));
    $('lineToolBtn').addEventListener('click', () => setTool('line'));
    $('pointToolBtn').addEventListener('click', () => setTool('point'));
    $('addLabelBtn').addEventListener('click', () => state.labelPlacementMode ? exitLabelMode() : enterLabelMode());
    $('finishDrawingBtn').addEventListener('click', finishDraft);
    $('deleteSelectedBtn').addEventListener('click', deleteSelected);
    $('clearSelectionBtn').addEventListener('click', clearSelection);
    $('focusBalkansBtn').addEventListener('click', focusBalkans);
    $('resetViewBtn').addEventListener('click', resetView);

    $('countryNameInput').addEventListener('change', e => commitCountryEdit('name', e.target.value.trim()));
    $('countryColorInput').addEventListener('change', e => commitCountryEdit('color', e.target.value));
    $('capitalInput').addEventListener('change', e => commitCountryEdit('capital', e.target.value.trim()));
    $('notesInput').addEventListener('change', e => commitCountryEdit('notes', e.target.value));
    $('flagUploadBtn').addEventListener('click', () => $('flagFileInput').click());
    $('flagFileInput').addEventListener('change', e => {
      const file = e.target.files?.[0];
      if (!file || state.selected?.type !== 'country') return;
      const reader = new FileReader();
      reader.onload = () => commitCountryEdit('flagDataUrl', reader.result);
      reader.readAsDataURL(file);
      e.target.value = '';
    });
    $('flagRemoveBtn').addEventListener('click', () => commitCountryEdit('flagDataUrl', null));

    $('drawingNameInput').addEventListener('change', e => commitDrawingMeta('name', e.target.value.trim()));
    $('drawingColorInput').addEventListener('change', e => commitDrawingMeta('editorColor', e.target.value));
    $('drawingCategoryInput').addEventListener('change', e => commitDrawingMeta('category', e.target.value));
    $('drawingNotesInput').addEventListener('change', e => commitDrawingMeta('notes', e.target.value));

    $('labelNameInput').addEventListener('change', e => commitLabelEdit('name', e.target.value.trim()));
    $('labelKindInput').addEventListener('change', e => commitLabelEdit('kind', e.target.value));
    $('labelNotesInput').addEventListener('change', e => commitLabelEdit('notes', e.target.value));
    $('deleteLabelBtn').addEventListener('click', deleteSelected);

    $('undoBtn').addEventListener('click', undo);
    $('redoBtn').addEventListener('click', redo);

    $('togglePanelBtn').addEventListener('click', () => {
      $('rightPanel').classList.toggle('collapsed');
      document.querySelector('.workspace').classList.toggle('panel-collapsed');
      const collapsed = $('rightPanel').classList.contains('collapsed');
      setActionStatus(`속성창 ${collapsed ? '접음' : '펼침'}`, 'success');
      setTimeout(resizeMap, 60);
    });

    $('saveProjectBtn').addEventListener('click', saveProjectFile);
    $('loadProjectBtn').addEventListener('click', () => {
      setActionStatus('프로젝트 파일 선택 대기', 'working', 3000);
      $('projectFileInput').click();
    });
    $('projectFileInput').addEventListener('change', async e => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        applyLoadedProject(JSON.parse(await file.text()), true);
        setActionStatus('프로젝트 불러오기 완료', 'success');
      } catch (error) {
        showToast(`프로젝트 불러오기 실패: ${error.message}`, 4000);
        setActionStatus('프로젝트 불러오기 실패', 'error', 4000);
      }
      e.target.value = '';
    });

    $('newProjectBtn').addEventListener('click', () => {
      if (!confirm('현재 자동 저장 내용을 지우고 새 프로젝트를 시작할까요?')) return;
      localStorage.removeItem(STORAGE_KEY);
      location.reload();
    });

    $('importGeoJsonBtn').addEventListener('click', () => {
      setActionStatus('GeoJSON 파일 선택 대기', 'working', 3000);
      $('geoJsonFileInput').click();
    });
    $('geoJsonFileInput').addEventListener('change', async e => {
      const file = e.target.files?.[0];
      if (!file) return;
      try { await importGeoJson(file); }
      catch (error) {
        showToast(`GeoJSON 가져오기 실패: ${error.message}`, 4500);
        setActionStatus('GeoJSON 가져오기 실패', 'error', 4500);
      }
      e.target.value = '';
    });
    $('exportGeoJsonBtn').addEventListener('click', exportDrawingsGeoJson);

    document.addEventListener('keydown', e => {
      const tag = document.activeElement?.tagName;
      const editingText = ['INPUT', 'TEXTAREA', 'SELECT'].includes(tag);
      if (e.key === 'Escape') {
        if (state.labelPlacementMode) exitLabelMode();
        else if (state.draftCoords.length) cancelDraft(true);
        else clearSelection();
      }
      if (e.key === 'Enter' && !editingText && ['polygon', 'line'].includes(state.tool) && state.draftCoords.length) {
        e.preventDefault(); finishDraft();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault(); saveProjectFile();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey && !editingText) {
        e.preventDefault(); undo();
      }
      if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey)) && !editingText) {
        e.preventDefault(); redo();
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && !editingText && state.selected) {
        e.preventDefault(); deleteSelected();
      }
    });

    window.addEventListener('resize', () => setTimeout(resizeMap, 30));
    window.addEventListener('beforeunload', () => {
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(buildProjectData())); } catch (_) {}
    });
  }

  function init() {
    if (!window.d3) {
      $('engineStatus').textContent = '엔진 오류';
      setActionStatus('내장 D3 엔진 로드 실패', 'error', 0);
      return;
    }
    if (!window.CHRONOMAP_COUNTRIES?.features?.length) {
      $('countryStatus').textContent = '내장 데이터 오류';
      setActionStatus('내장 국가 데이터 로드 실패', 'error', 0);
      return;
    }

    const restored = restoreLocalProject();
    if (restored) {
      state.countryOverrides = deepClone(restored.countryOverrides || {});
      state.labels = deepClone(restored.labels || []);
      state.drawings = deepClone(restored.drawings || []);
      state.projection = restored.projection || 'globe';
      state.layerVisibility = { ...state.layerVisibility, ...(restored.layerVisibility || {}) };
      state.countriesLocked = !!restored.countriesLocked;
      state.view = { ...state.view, ...(restored.view || {}) };
    }

    state.countriesData = normalizeCountries(window.CHRONOMAP_COUNTRIES);
    $('countryStatus').textContent = `내장 ${state.countriesData.features.length}개`;
    $('engineStatus').textContent = '내장 SVG · 오프라인';

    bindUI();
    initSvg();

    $('countriesVisible').checked = state.layerVisibility.countries;
    $('drawingsVisible').checked = state.layerVisibility.drawings;
    $('labelsVisible').checked = state.layerVisibility.labels;
    $('basemapLabelsVisible').checked = state.layerVisibility.basemapLabels;
    $('countriesLocked').checked = state.countriesLocked;
    $('globeBtn').classList.toggle('active', state.projection === 'globe');
    $('flatBtn').classList.toggle('active', state.projection !== 'globe');

    resizeMap();
    updateHistoryButtons();
    setTool('select');

    if (restored) {
      setAutosaveStatus('복원됨');
      showToast('자동 저장 프로젝트를 복원했습니다.');
      setActionStatus(`오프라인 지도 준비 완료 · 국가 ${state.countriesData.features.length}개`, 'success');
    } else {
      setAutosaveStatus('준비');
      setActionStatus(`오프라인 지도 준비 완료 · 국가 ${state.countriesData.features.length}개`, 'success');
    }
  }

  init();
})();
