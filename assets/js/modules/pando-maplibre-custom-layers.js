import { createRenderDevice } from './render-device.js';
import { withGpuStateScope } from './gpu-state-scope.js';

function renderOptions(first, second) {
  if (second && typeof second === 'object') return second;
  if (first && typeof first === 'object' && !('drawingBufferWidth' in first)) return first;
  return {};
}

export function createPandoMapLibreCustomLayers({
  getViewState,
  onDevice,
  onDeviceRemoved,
  prerenderScene,
  renderScene,
  renderInteraction,
  onRenderError,
  onFrameRendered,
} = {}) {
  let map = null;
  let device = null;
  let contextRevision = 0;
  let attachedLayerCount = 0;
  // MapLibre invokes prerender, scene and interaction for one frame as
  // separate callbacks. Keep one immutable view snapshot across that cycle
  // so the cache signature cannot change between passes.
  let frameViewState = null;

  function ensureDevice(nextMap, gl) {
    map = nextMap || map;
    if (device?.gl === gl) return device;
    contextRevision += 1;
    frameViewState = null;
    device = createRenderDevice({
      gl,
      canvas: map?.getCanvas?.() || gl.canvas || null,
      version: 2,
      contextRevision,
    });
    onDevice?.(device, { map, contextRevision });
    return device;
  }

  function scoped(stage, gl, options, callback, viewStateOverride = null) {
    try {
      return withGpuStateScope(gl, state => callback({
        gl,
        device,
        map,
        options,
        viewState: viewStateOverride || getViewState?.() || null,
        targetFramebuffer: state?.framebuffer || null,
      })).value;
    } catch (error) {
      onRenderError?.({ stage, error });
      return null;
    }
  }

  const sceneLayer = {
    id: 'pando-scene',
    type: 'custom',
    renderingMode: '2d',
    onAdd(nextMap, gl) {
      attachedLayerCount += 1;
      withGpuStateScope(gl, () => ensureDevice(nextMap, gl));
    },
    prerender(gl, maybeOptions) {
      ensureDevice(map, gl);
      const options = renderOptions(gl, maybeOptions);
      const nextViewState = getViewState?.() || null;
      frameViewState = nextViewState && typeof nextViewState === 'object'
        ? Object.freeze({ ...nextViewState })
        : nextViewState;
      return scoped('maplibre-scene-prerender', gl, options, prerenderScene, frameViewState);
    },
    render(gl, maybeOptions) {
      ensureDevice(map, gl);
      const options = renderOptions(gl, maybeOptions);
      if (!frameViewState) {
        const nextViewState = getViewState?.() || null;
        frameViewState = nextViewState && typeof nextViewState === 'object'
          ? Object.freeze({ ...nextViewState })
          : nextViewState;
      }
      const result = scoped('maplibre-scene-render', gl, options, renderScene, frameViewState);
      if (result != null && result?.succeeded !== false) onFrameRendered?.('scene', result);
      return result;
    },
    onRemove() {
      attachedLayerCount = Math.max(0, attachedLayerCount - 1);
      if (!attachedLayerCount && device) {
        const removedDevice = device;
        device = null;
        onDeviceRemoved?.(removedDevice);
      }
    },
  };

  const interactionLayer = {
    id: 'pando-interaction',
    type: 'custom',
    renderingMode: '2d',
    onAdd(nextMap, gl) {
      attachedLayerCount += 1;
      withGpuStateScope(gl, () => ensureDevice(nextMap, gl));
    },
    render(gl, maybeOptions) {
      ensureDevice(map, gl);
      const options = renderOptions(gl, maybeOptions);
      const result = scoped('maplibre-interaction-render', gl, options, renderInteraction, frameViewState);
      if (result != null && result?.succeeded !== false) onFrameRendered?.('interaction', result);
      frameViewState = null;
      return result;
    },
    onRemove() {
      attachedLayerCount = Math.max(0, attachedLayerCount - 1);
      if (!attachedLayerCount && device) {
        const removedDevice = device;
        device = null;
        onDeviceRemoved?.(removedDevice);
      }
    },
  };

  return Object.freeze({
    sceneLayer,
    interactionLayer,
    getDevice: () => device,
    getContextRevision: () => contextRevision,
    reinitializeDevice(gl) {
      device = null;
      return withGpuStateScope(gl, () => ensureDevice(map, gl)).value;
    },
    dispose() {
      if (device) {
        const removedDevice = device;
        device = null;
        onDeviceRemoved?.(removedDevice);
      }
      map = null;
      frameViewState = null;
      attachedLayerCount = 0;
    },
  });
}
