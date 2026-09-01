const runtimePromises = new Map();

export function canUseMapLibreHost({ windowObject = globalThis.window } = {}) {
  if (!windowObject?.document || typeof windowObject.Worker !== 'function') return false;
  // Do not probe WebGL by creating a second context. MapLibre owns the only
  // live WebGL context and its initialization failure activates the legacy
  // Canvas/WebGL1 host through the outer startup boundary.
  return typeof windowObject.WebGL2RenderingContext === 'function';
}

export async function loadMapLibreRuntime({ moduleUrl, workerUrl = '' } = {}) {
  const key = String(moduleUrl || '');
  if (!key) throw new Error('MapLibre 모듈 URL이 없습니다.');
  if (!runtimePromises.has(key)) {
    runtimePromises.set(key, import(key).then(module => {
      if (workerUrl && typeof module.setWorkerUrl === 'function') module.setWorkerUrl(String(workerUrl));
      return module;
    }).catch(error => {
      runtimePromises.delete(key);
      throw error;
    }));
  }
  const runtime = await runtimePromises.get(key);
  if (workerUrl && typeof runtime.setWorkerUrl === 'function' && runtime.getWorkerUrl?.() !== String(workerUrl)) {
    runtime.setWorkerUrl(String(workerUrl));
  }
  return runtime;
}

export function clearMapLibreRuntimeCache() {
  runtimePromises.clear();
}
