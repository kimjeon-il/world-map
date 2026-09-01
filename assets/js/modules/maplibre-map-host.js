import {
  MAP_HOST_KINDS,
  createMapHostEventHub,
  normalizeMapSurfaceDragDelta,
  normalizeMapProjectionKind,
} from './map-host.js';
import { loadMapLibreRuntime } from './maplibre-runtime.js';
import { createPandoMapLibreCustomLayers } from './pando-maplibre-custom-layers.js';

function normalizedPoint(value) {
  if (Array.isArray(value)) return [Number(value[0]) || 0, Number(value[1]) || 0];
  return [Number(value?.x) || 0, Number(value?.y) || 0];
}

function normalizedCenter(value) {
  if (Array.isArray(value)) return [Number(value[0]) || 0, Number(value[1]) || 0];
  return [Number(value?.lng) || 0, Number(value?.lat) || 0];
}

function finitePositive(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function wrappedLongitude(value) {
  return ((Number(value || 0) + 540) % 360) - 180;
}

function clampLatitude(value) {
  return Math.max(-89, Math.min(89, Number(value) || 0));
}

function blankStyle() {
  return {
    version: 8,
    name: 'PandoLab local host',
    sources: {},
    layers: [{
      id: 'pando-host-background',
      type: 'background',
      paint: {
        'background-color': 'rgba(0,0,0,0)',
        'background-opacity': 0,
      },
    }],
  };
}

export function createMapLibreMapHost({
  moduleUrl,
  workerUrl,
  initialProjection = 'globe',
  initialViewState = null,
  getPandoViewState = null,
  onViewStateChange = null,
  onInteractionStart = null,
  onInteractionEnd = null,
  onDevice = null,
  onDeviceRemoved = null,
  onContextLost = null,
  onContextRestored = null,
  prerenderScene = null,
  renderScene = null,
  renderInteraction = null,
  onRenderError = null,
  mapOptions = {},
} = {}) {
  const events = createMapHostEventHub();
  let container = null;
  let hostElement = null;
  let runtime = null;
  let map = null;
  let layers = null;
  let ready = false;
  let initializing = null;
  let projectionKind = normalizeMapProjectionKind(initialProjection);
  let navigationEnabled = true;
  let forcedPan = false;
  let viewRevision = 0;
  let contextLost = false;
  let loadFailure = '';
  let rawContextLostHandler = null;
  let rawContextRestoredHandler = null;
  let requestedPixelRatio = null;
  let contextRecoveryGeneration = 0;
  const contextRecoveryFrames = new Set();
  const contextRecoveryTimers = new Set();

  function cancelContextRecoveryRepaint() {
    contextRecoveryGeneration += 1;
    for (const frame of contextRecoveryFrames) cancelAnimationFrame(frame);
    for (const timer of contextRecoveryTimers) clearTimeout(timer);
    contextRecoveryFrames.clear();
    contextRecoveryTimers.clear();
  }

  function scheduleContextRecoveryRepaint() {
    cancelContextRecoveryRepaint();
    const generation = contextRecoveryGeneration;
    let remainingFrames = 8;
    const repaint = ({ resize = false } = {}) => {
      if (generation !== contextRecoveryGeneration || contextLost || !map) return false;
      if (resize) map.resize?.();
      map.triggerRepaint?.();
      return true;
    };
    const nextFrame = () => {
      if (generation !== contextRecoveryGeneration || contextLost || !map || remainingFrames <= 0) return;
      remainingFrames -= 1;
      const frame = requestAnimationFrame(() => {
        contextRecoveryFrames.delete(frame);
        if (!repaint()) return;
        nextFrame();
      });
      contextRecoveryFrames.add(frame);
    };
    // MapLibre rebuilds its painter from its own context-restored listener. The
    // first repaint can arrive before that asynchronous work has settled, so a
    // short bounded sequence keeps the custom interaction layer recoverable.
    repaint({ resize: true });
    nextFrame();
    for (const delay of [50, 150, 400, 1000]) {
      const timer = setTimeout(() => {
        contextRecoveryTimers.delete(timer);
        repaint();
      }, delay);
      contextRecoveryTimers.add(timer);
    }
  }

  function restorePandoLayersAfterContext(event, generation = contextRecoveryGeneration, attempt = 0) {
    if (generation !== contextRecoveryGeneration || contextLost || !map) return false;
    try {
      addPandoLayers({ replace: true });
      const device = layers?.getDevice?.() || null;
      if (!device) throw new Error('MapLibre custom layer RenderDevice를 복구하지 못했습니다.');
      onContextRestored?.(device, event);
      events.emit('contextrestored', { device, originalEvent: event });
      scheduleContextRecoveryRepaint();
      return true;
    } catch (error) {
      if (attempt >= 11) {
        onRenderError?.({ stage: 'maplibre-context-restore', error });
        events.emit('error', { error });
        return false;
      }
      const delay = attempt < 3 ? 0 : Math.min(400, 25 * (2 ** Math.min(4, attempt - 3)));
      if (delay === 0) {
        const frame = requestAnimationFrame(() => {
          contextRecoveryFrames.delete(frame);
          restorePandoLayersAfterContext(event, generation, attempt + 1);
        });
        contextRecoveryFrames.add(frame);
      } else {
        const timer = setTimeout(() => {
          contextRecoveryTimers.delete(timer);
          restorePandoLayersAfterContext(event, generation, attempt + 1);
        }, delay);
        contextRecoveryTimers.add(timer);
      }
      return false;
    }
  }

  function attach(nextContainer) {
    container = nextContainer || null;
    if (!container) return false;
    if (!hostElement) {
      hostElement = document.createElement('div');
      hostElement.className = 'maplibre-host';
      hostElement.setAttribute('aria-hidden', 'true');
      container.appendChild(hostElement);
    }
    return true;
  }

  function currentViewState() {
    if (!map) return initialViewState || {
      projection: projectionKind,
      center: [0, 0],
      zoom: 0,
      bearing: 0,
      pitch: 0,
      revision: viewRevision,
    };
    const center = map.getCenter();
    const canvas = map.getCanvas();
    return Object.freeze({
      projection: projectionKind,
      center: Object.freeze([Number(center.lng), Number(center.lat)]),
      zoom: Number(map.getZoom()),
      bearing: Number(map.getBearing()),
      pitch: Number(map.getPitch()),
      padding: Object.freeze({ ...(map.getPadding?.() || {}) }),
      size: Object.freeze({
        width: Number(canvas?.clientWidth || hostElement?.clientWidth || 1),
        height: Number(canvas?.clientHeight || hostElement?.clientHeight || 1),
        dpr: Number(requestedPixelRatio || globalThis.devicePixelRatio || 1),
      }),
      revision: viewRevision,
    });
  }

  function emitView(source = 'maplibre') {
    viewRevision += 1;
    const viewState = currentViewState();
    onViewStateChange?.(viewState, { source });
    events.emit('viewchange', { viewState, source });
  }

  function installContextEvents() {
    const canvas = map?.getCanvas?.();
    if (!canvas) return;
    rawContextLostHandler = event => {
      cancelContextRecoveryRepaint();
      contextLost = true;
      event.preventDefault?.();
      onContextLost?.(event);
      events.emit('contextlost', { originalEvent: event });
    };
    rawContextRestoredHandler = event => {
      contextLost = false;
      cancelContextRecoveryRepaint();
      const generation = contextRecoveryGeneration;
      restorePandoLayersAfterContext(event, generation);
    };
    canvas.addEventListener('webglcontextlost', rawContextLostHandler, false);
    canvas.addEventListener('webglcontextrestored', rawContextRestoredHandler, false);
  }

  function removeContextEvents() {
    const canvas = map?.getCanvas?.();
    if (canvas && rawContextLostHandler) canvas.removeEventListener('webglcontextlost', rawContextLostHandler);
    if (canvas && rawContextRestoredHandler) canvas.removeEventListener('webglcontextrestored', rawContextRestoredHandler);
    rawContextLostHandler = rawContextRestoredHandler = null;
  }

  function installMapEvents() {
    map.on('movestart', event => {
      onInteractionStart?.({ source: event?.originalEvent ? 'input' : 'programmatic' });
      events.emit('interactionstart', { originalEvent: event?.originalEvent || null });
    });
    map.on('move', event => emitView(event?.originalEvent ? 'input' : 'programmatic'));
    map.on('moveend', event => {
      emitView(event?.originalEvent ? 'input-end' : 'programmatic-end');
      onInteractionEnd?.({ source: event?.originalEvent ? 'input' : 'programmatic' });
      events.emit('interactionend', { originalEvent: event?.originalEvent || null });
    });
    map.on('resize', () => {
      emitView('resize');
      events.emit('resize', { size: api.getViewportSize() });
    });
    map.on('error', event => {
      const error = event?.error || event;
      onRenderError?.({ stage: 'maplibre-host', error });
      events.emit('error', { error });
    });
  }

  function addPandoLayers({ replace = false } = {}) {
    if (replace && layers) {
      const previous = layers;
      const layerIds = [previous.interactionLayer?.id, previous.sceneLayer?.id].filter(Boolean);
      for (const id of layerIds) {
        if (map.getLayer(id)) map.removeLayer(id);
      }
      previous.dispose?.();
      layers = null;
    }
    layers = createPandoMapLibreCustomLayers({
      getViewState: () => getPandoViewState?.() || currentViewState(),
      onDevice,
      onDeviceRemoved,
      prerenderScene,
      renderScene,
      renderInteraction,
      onRenderError,
      onFrameRendered: stage => {
        if (stage === 'interaction' && !contextLost) cancelContextRecoveryRepaint();
      },
    });
    if (!map.getLayer(layers.sceneLayer.id)) map.addLayer(layers.sceneLayer);
    if (!map.getLayer(layers.interactionLayer.id)) map.addLayer(layers.interactionLayer);
  }

  async function initialize() {
    if (ready) return true;
    if (initializing) return initializing;
    initializing = (async () => {
      if (!container) throw new Error('MapLibre host container가 없습니다.');
      runtime = await loadMapLibreRuntime({ moduleUrl, workerUrl });
      const initial = initialViewState || {};
      projectionKind = normalizeMapProjectionKind(initial.projection || projectionKind);
      map = new runtime.Map({
        container: hostElement,
        style: blankStyle(),
        center: normalizedCenter(initial.center || [0, 0]),
        zoom: Number(initial.zoom ?? 0),
        bearing: 0,
        pitch: 0,
        minPitch: 0,
        maxPitch: 0,
        attributionControl: false,
        maplibreLogo: false,
        dragRotate: false,
        pitchWithRotate: false,
        touchPitch: false,
        cooperativeGestures: false,
        renderWorldCopies: true,
        validateStyle: true,
        fadeDuration: 0,
        projection: { type: projectionKind === 'globe' ? 'globe' : 'mercator' },
        canvasContextAttributes: {
          antialias: true,
          preserveDrawingBuffer: false,
          powerPreference: 'high-performance',
          stencil: true,
        },
        ...mapOptions,
      });
      installMapEvents();
      await new Promise((resolve, reject) => {
        const loaded = () => {
          map.off('error', fail);
          resolve();
        };
        const fail = event => {
          map.off('load', loaded);
          reject(event?.error || new Error('MapLibre style을 불러오지 못했습니다.'));
        };
        map.once('load', loaded);
        map.once('error', fail);
      });
      addPandoLayers();
      installContextEvents();
      if (requestedPixelRatio != null) map.setPixelRatio?.(requestedPixelRatio);
      ready = true;
      emitView('ready');
      events.emit('ready', { host: api });
      return true;
    })().catch(error => {
      loadFailure = error?.message || String(error);
      ready = false;
      throw error;
    }).finally(() => { initializing = null; });
    return initializing;
  }

  function setProjectionKind(kind) {
    const next = normalizeMapProjectionKind(kind);
    if (next === projectionKind && ready) return false;
    projectionKind = next;
    if (map) {
      map.setProjection({ type: next === 'globe' ? 'globe' : 'mercator' });
      map.triggerRepaint();
    }
    viewRevision += 1;
    events.emit('projectionchange', { projection: next });
    return true;
  }

  function setViewState(view = {}, { animate = false } = {}) {
    if (!map) return false;
    if (view.projection) setProjectionKind(view.projection);
    const options = {
      center: normalizedCenter(view.center || map.getCenter()),
      zoom: Number(view.zoom ?? map.getZoom()),
      bearing: 0,
      pitch: 0,
      padding: view.padding || map.getPadding?.(),
      duration: animate ? Number(view.duration || 240) : 0,
    };
    if (animate) map.easeTo(options);
    else map.jumpTo(options);
    return true;
  }

  // MapLibre's globe pan implementation derives the next camera center from
  // a screen-to-globe ray.  When a small globe is being dragged, the target
  // point can fall outside the visible sphere and MapLibre intentionally
  // returns without changing the center.  Use a local screen Jacobian for
  // globe drags instead: it keeps the surface-following contract continuous
  // even when the drag endpoint is outside the sphere.
  function dragGlobeBy(dx, dy, options = {}) {
    if (!map) return false;
    const [dragX, dragY] = normalizeMapSurfaceDragDelta(dx, dy);
    if (dragX === 0 && dragY === 0) return false;
    const center = map.getCenter?.();
    if (!center) return false;
    const centerPoint = map.project?.(center);
    if (!centerPoint) return false;
    const probe = 0.25;
    const west = map.project?.([center.lng - probe, center.lat]);
    const east = map.project?.([center.lng + probe, center.lat]);
    const south = map.project?.([center.lng, clampLatitude(center.lat - probe)]);
    const north = map.project?.([center.lng, clampLatitude(center.lat + probe)]);
    const pixelsPerLongitude = finitePositive(
      Math.hypot(Number(east?.x) - Number(west?.x), Number(east?.y) - Number(west?.y)) / (probe * 2),
    );
    const pixelsPerLatitude = finitePositive(
      Math.hypot(Number(north?.x) - Number(south?.x), Number(north?.y) - Number(south?.y)) / (probe * 2),
    );
    if (!pixelsPerLongitude && !pixelsPerLatitude) return false;
    const nextCenter = [
      wrappedLongitude(center.lng - (pixelsPerLongitude ? dragX / pixelsPerLongitude : 0)),
      clampLatitude(center.lat + (pixelsPerLatitude ? dragY / pixelsPerLatitude : 0)),
    ];
    const camera = {
      center: nextCenter,
      zoom: map.getZoom?.(),
      bearing: 0,
      pitch: 0,
      padding: map.getPadding?.(),
      duration: options.animate === true ? Number(options.duration || 0) : 0,
    };
    if (options.animate === true) map.easeTo(camera);
    else map.jumpTo(camera);
    return true;
  }

  function setNavigationEnabled(value) {
    navigationEnabled = value !== false;
    for (const handler of ['dragPan', 'scrollZoom', 'boxZoom', 'doubleClickZoom', 'touchZoomRotate', 'keyboard']) {
      const control = map?.[handler];
      if (!control) continue;
      if (navigationEnabled) control.enable?.();
      else control.disable?.();
    }
    map?.dragRotate?.disable?.();
    map?.touchZoomRotate?.disableRotation?.();
    return navigationEnabled;
  }

  function setForcedPan(value) {
    forcedPan = value === true;
    return forcedPan;
  }

  function setRenderPixelRatio(value) {
    const next = Math.max(1, Number(value) || 1);
    if (requestedPixelRatio === next) return false;
    requestedPixelRatio = next;
    map?.setPixelRatio?.(next);
    map?.triggerRepaint?.();
    return true;
  }

  function destroy() {
    ready = false;
    cancelContextRecoveryRepaint();
    removeContextEvents();
    layers?.dispose?.();
    layers = null;
    map?.remove?.();
    map = null;
    hostElement?.remove?.();
    hostElement = null;
    container = null;
    runtime = null;
    events.clear();
  }

  const api = Object.freeze({
    attach,
    initialize,
    destroy,
    getKind: () => MAP_HOST_KINDS.MAPLIBRE,
    isReady: () => ready,
    getProjectionKind: () => projectionKind,
    setProjectionKind,
    getViewState: currentViewState,
    setViewState,
    getViewportSize: () => {
      const canvas = map?.getCanvas?.();
      return Object.freeze({
        width: Number(canvas?.clientWidth || hostElement?.clientWidth || 1),
        height: Number(canvas?.clientHeight || hostElement?.clientHeight || 1),
        dpr: Number(requestedPixelRatio || globalThis.devicePixelRatio || 1),
      });
    },
    project(coordinate) {
      if (!map || !coordinate) return null;
      const point = map.project(normalizedCenter(coordinate));
      return [Number(point.x), Number(point.y)];
    },
    unproject(point) {
      if (!map || !point) return null;
      const coordinate = map.unproject(normalizedPoint(point));
      return [Number(coordinate.lng), Number(coordinate.lat)];
    },
    visibleGeographicBounds() {
      const bounds = map?.getBounds?.();
      return bounds ? [[bounds.getWest(), bounds.getSouth()], [bounds.getEast(), bounds.getNorth()]] : null;
    },
    // dx/dy describe how far the map surface follows the pointer. MapLibre's
    // public panBy() already performs its camera-offset conversion internally;
    // pass the surface delta through unchanged for flat maps. Globe maps use
    // a local trackball/Jacobian path because panBy() can no-op when the drag
    // endpoint falls outside a small visible sphere.
    dragBy(dx, dy, options = {}) {
      if (!map) return false;
      const [dragX, dragY] = normalizeMapSurfaceDragDelta(dx, dy);
      if (dragX === 0 && dragY === 0) return false;
      if (projectionKind === 'globe') return dragGlobeBy(dragX, dragY, options);
      map.panBy([dragX, dragY], {
        duration: Number(options.duration || 0),
        animate: options.animate === true,
      });
      return true;
    },
    zoomAround({ zoom, point, animate = false } = {}) {
      if (!map) return false;
      const around = point ? map.unproject(normalizedPoint(point)) : map.getCenter();
      const next = { zoom: Number(zoom ?? map.getZoom()), around, duration: animate ? 180 : 0 };
      if (animate) map.easeTo(next);
      else map.jumpTo(next);
      return true;
    },
    focusCoordinate(coordinate, { zoom = null, animate = false } = {}) {
      if (!map || !coordinate) return false;
      const next = { center: normalizedCenter(coordinate), duration: animate ? 220 : 0 };
      if (zoom != null) next.zoom = Number(zoom);
      if (animate) map.easeTo(next);
      else map.jumpTo(next);
      return true;
    },
    fitGeometry(_geometry, { bounds = null, padding = 24, maxZoom = null, animate = false } = {}) {
      if (!map || !bounds) return false;
      const options = { padding, duration: animate ? 260 : 0 };
      if (maxZoom != null) options.maxZoom = Number(maxZoom);
      map.fitBounds(bounds, options);
      return true;
    },
    requestRepaint() {
      if (!map) return false;
      map.triggerRepaint();
      return true;
    },
    resize() {
      if (!map) return false;
      map.resize();
      return true;
    },
    setNavigationEnabled,
    setForcedPan,
    setRenderPixelRatio,
    getRenderDevice: () => layers?.getDevice?.() || null,
    getMapLibreMap: () => map,
    on: events.on,
    off: events.off,
    getDebugState: () => Object.freeze({
      kind: MAP_HOST_KINDS.MAPLIBRE,
      ready,
      projection: projectionKind,
      viewRevision,
      navigationEnabled,
      forcedPan,
      contextLost,
      contextRevision: Number(layers?.getContextRevision?.() || 0),
      loadFailure,
      activeWebGlContextCount: ready ? 1 : 0,
      requestedPixelRatio,
      layerIds: layers ? [layers.sceneLayer.id, layers.interactionLayer.id] : [],
    }),
  });

  return api;
}
