export function createCountryPropertyController({
  window,
  document,
  elements = {},
  getCountryView,
  getPrimaryRef = () => null,
  showPropertyForm,
  resolveColor,
  defaultColor,
  syncColorPicker,
  resolveFlagUrl,
  calculateAreaKm2,
  formatArea,
  syncActions = () => {},
  syncStatus = () => {},
  commitField = () => false,
  metrics = {},
} = {}) {
  const areaCache = new WeakMap();
  const pendingAreas = new WeakSet();
  let presentationToken = 0;
  let disposed = false;

  const renderFlag = (dataUrl, displayName = '') => {
    const preview = elements.flagPreview;
    if (!preview) return;
    preview.replaceChildren();
    if (!dataUrl) {
      preview.textContent = '국기 없음';
      elements.flagRemove?.classList.add('hidden');
      return;
    }
    elements.flagRemove?.classList.remove('hidden');
    const image = document.createElement('img');
    image.src = dataUrl;
    image.alt = `${displayName || '선택한 국가'} 국기`;
    image.addEventListener('error', () => {
      if (!preview.contains(image)) return;
      preview.replaceChildren();
      preview.textContent = '국기 없음';
      elements.flagRemove?.classList.add('hidden');
    }, { once: true });
    preview.appendChild(image);
  };

  const scheduleArea = (view, token) => {
    const geometry = view?.feature?.geometry;
    if (!geometry || pendingAreas.has(geometry)) return;
    pendingAreas.add(geometry);
    const calculate = () => {
      const value = calculateAreaKm2(geometry);
      areaCache.set(geometry, value);
      pendingAreas.delete(geometry);
      const primary = getPrimaryRef();
      if (disposed || token !== presentationToken || primary?.key !== view.ref.key) return;
      const current = getCountryView(view.ref);
      if (current?.feature?.geometry !== geometry) return;
      if (elements.area) elements.area.textContent = formatArea(value);
      if (elements.selectionStatus) elements.selectionStatus.textContent = `국가 · ${view.displayName} · ${formatArea(value)}`;
      syncStatus();
    };
    if (typeof window?.requestIdleCallback === 'function') window.requestIdleCallback(calculate, { timeout: 800 });
    else window?.setTimeout?.(calculate, 0);
  };

  const present = (countryRef, { refreshOnly = false } = {}) => {
    if (disposed) return false;
    const view = getCountryView(countryRef);
    if (!view?.feature) return false;
    const token = ++presentationToken;
    const startedAt = globalThis.performance?.now?.() || Date.now();
    showPropertyForm('country', view.displayName, { resetScroll: !refreshOnly });
    const fieldsStartedAt = globalThis.performance?.now?.() || Date.now();
    if (elements.name) elements.name.value = view.override.name || view.properties.name || '';
    if (elements.code) elements.code.textContent = view.id;
    const color = resolveColor(view);
    if (elements.color) elements.color.value = color.value;
    syncColorPicker('country', { value: color.value, defaultColor: defaultColor(), isDefault: color.isDefault });
    if (elements.capital) elements.capital.value = view.override.capital || '';
    if (elements.notes) elements.notes.value = view.override.notes || '';
    if (elements.originalName) elements.originalName.textContent = view.properties.name || '—';
    renderFlag(resolveFlagUrl(view), view.displayName);
    const geometry = view.feature.geometry;
    const cached = geometry && areaCache.has(geometry);
    const area = cached ? areaCache.get(geometry) : null;
    if (elements.area) {
      elements.area.textContent = cached ? formatArea(area) : '면적 계산 중…';
      elements.area.dataset.tooltip = '구면 근사 면적이며 고정밀 GIS 측정값과 차이가 날 수 있습니다.';
    }
    if (elements.selectionStatus) elements.selectionStatus.textContent = cached
      ? `국가 · ${view.displayName} · ${formatArea(area)}`
      : `국가 · ${view.displayName}`;
    if (!cached) scheduleArea(view, token);
    syncStatus();
    syncActions(view);
    metrics.propertyPanelMs = fieldsStartedAt - startedAt;
    metrics.propertyFieldsMs = (globalThis.performance?.now?.() || Date.now()) - fieldsStartedAt;
    metrics.transactionMs = (globalThis.performance?.now?.() || Date.now()) - startedAt;
    return true;
  };

  const refresh = countryRef => present(countryRef, { refreshOnly: true });
  const clear = () => { presentationToken += 1; };

  const bind = () => {
    const bindField = (element, field, transform = value => value) => element?.addEventListener('change', event => {
      commitField(field, transform(event.target.value));
    });
    bindField(elements.name, 'name', value => value.trim());
    bindField(elements.capital, 'capital', value => value.trim());
    bindField(elements.notes, 'notes');
    elements.flagUpload?.addEventListener('click', () => elements.flagFile?.click());
    elements.flagFile?.addEventListener('change', event => {
      const file = event.target.files?.[0];
      const primary = getPrimaryRef();
      if (!file || primary?.domain !== 'territorial' || primary?.type !== 'country') return;
      const Reader = event.target.ownerDocument?.defaultView?.FileReader;
      if (typeof Reader !== 'function') return;
      const reader = new Reader();
      reader.addEventListener('load', () => commitField('flagDataUrl', reader.result), { once: true });
      reader.readAsDataURL(file);
      event.target.value = '';
    });
    elements.flagRemove?.addEventListener('click', () => commitField('flagDataUrl', null));
    return api;
  };

  const dispose = () => {
    disposed = true;
    presentationToken += 1;
  };

  const api = Object.freeze({ bind, present, refresh, clear, dispose });
  return api;
}
