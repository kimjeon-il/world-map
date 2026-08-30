export function createHistoricalLibraryController({
  document,
  elements,
  service,
  typeLabels,
  selectGeometryVersion,
  renderMapPreview,
  createEmptyState,
  replaceSelectOptions,
  collator,
  isMobile,
  closeCreateMenu,
  instantiate,
  confirm,
  setStatus,
  reportError,
  requestFrame = callback => requestAnimationFrame(callback),
}) {
  let selectedId = '';

  function period(entity) {
    if (!entity.startDate && !entity.endDate) return '현존';
    return `${entity.startDate || '?'}–${entity.endDate || '현재'}`;
  }

  function syncFilterOptions() {
    const geographicRegions = [...new Set(service.list().map(entity => String(entity.metadata?.region || '')).filter(Boolean))].sort(collator.compare);
    replaceSelectOptions(elements.geographicRegion, [{ value: '', label: '전체' }, ...geographicRegions.map(geographicRegion => ({ value: geographicRegion, label: geographicRegion }))], elements.geographicRegion.value);
    replaceSelectOptions(elements.snapshot, [
      { value: '', label: '스냅샷 선택' },
      ...service.snapshots().map(snapshot => ({ value: snapshot.id, label: `${snapshot.name}${snapshot.metadata?.partial ? ' · 부분' : ''}` })),
    ], elements.snapshot.value);
  }

  function searchResults() {
    return service.search({
      query: elements.search.value,
      type: elements.type.value,
      status: elements.status.value,
      referenceDate: elements.year.value,
      geographicRegion: elements.geographicRegion.value,
    });
  }

  function renderPreview() {
    const entity = service.get(selectedId);
    const version = entity ? selectGeometryVersion(entity, elements.year.value) : null;
    if (!entity || !version) {
      const help = document.createElement('p');
      help.className = 'editor-help';
      help.textContent = '항목을 선택하면 시대·경계 버전·출처를 확인할 수 있습니다.';
      elements.preview.replaceChildren(help);
      elements.add.disabled = true;
      elements.addOptions?.classList.add('hidden');
      elements.optionsBack?.classList.add('hidden');
      elements.card?.classList.remove('is-detail', 'is-options');
      return;
    }
    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'ui-button btn ghost historical-library-back';
    back.textContent = '검색 결과로 돌아가기';
    back.addEventListener('click', () => {
      elements.card?.classList.remove('is-detail');
      requestFrame(() => elements.results.querySelector('[aria-selected="true"]')?.focus());
    });
    const title = document.createElement('h3');
    title.textContent = entity.displayNames?.ko || entity.canonicalName;
    const meta = document.createElement('p');
    meta.className = 'editor-help';
    meta.textContent = `${typeLabels[entity.type]} · ${period(entity)}`;
    const source = document.createElement('p');
    source.className = 'editor-help';
    source.textContent = `출처: ${entity.sourceInfo?.title || version.sourceId || '미지정'}`;
    const advanced = document.createElement('details');
    advanced.className = 'ui-disclosure';
    const summary = document.createElement('summary');
    summary.textContent = '고급 정보';
    const body = document.createElement('dl');
    body.className = 'historical-library-advanced';
    const addAdvanced = (term, value) => {
      const dt = document.createElement('dt');
      const dd = document.createElement('dd');
      dt.textContent = term;
      dd.textContent = String(value || '—');
      body.append(dt, dd);
    };
    const alternativeNames = [...new Set([...(entity.aliases || []), ...Object.values(entity.displayNames || {})].filter(Boolean))].join(' · ');
    addAdvanced('별칭·다국어 이름', alternativeNames);
    addAdvanced('GeometryVersion', version.id || version.geometryVersionId);
    addAdvanced('날짜 정밀도', version.datePrecision);
    addAdvanced('신뢰도', version.certainty);
    addAdvanced('상세 출처', `${entity.sourceInfo?.title || version.sourceId || '미지정'}${entity.sourceInfo?.license ? ` · ${entity.sourceInfo.license}` : ''}${version.notes || entity.sourceInfo?.notes ? ` · ${version.notes || entity.sourceInfo.notes}` : ''}`);
    advanced.append(summary, body);
    elements.preview.replaceChildren(back, title, renderMapPreview(entity, version), meta, source, advanced);
    elements.add.disabled = false;
    elements.addOptions?.classList.add('hidden');
    elements.optionsBack?.classList.add('hidden');
    elements.add.textContent = '프로젝트에 추가';
    elements.card?.classList.remove('is-options');
  }

  function renderResults() {
    const results = searchResults();
    const fragment = document.createDocumentFragment();
    for (const entity of results) {
      const button = document.createElement('button');
      const selected = selectedId === entity.libraryId;
      button.type = 'button';
      button.className = `ui-button ui-row ui-card ui-selectable-row historical-library-result${selected ? ' is-selected' : ''}`;
      button.dataset.libraryEntityId = entity.libraryId;
      button.setAttribute('role', 'option');
      button.setAttribute('aria-selected', String(selected));
      const strong = document.createElement('strong');
      strong.textContent = entity.displayNames?.ko || entity.canonicalName;
      const small = document.createElement('small');
      small.textContent = `${typeLabels[entity.type]} · ${period(entity)}${entity.metadata?.pilot ? ' · 시험 데이터' : ''}`;
      button.append(strong, small);
      fragment.appendChild(button);
    }
    if (!results.length) fragment.appendChild(createEmptyState('조건에 맞는 항목이 없습니다.', '검색어, 종류, 상태 또는 기준 연도를 바꾸 보세요.', { compact: true }));
    elements.results.replaceChildren(fragment);
    if (selectedId && !results.some(entity => entity.libraryId === selectedId)) {
      selectedId = '';
      renderPreview();
    }
  }

  function select(id) {
    selectedId = String(id || '');
    renderResults();
    renderPreview();
    if (isMobile()) elements.card?.classList.add('is-detail');
  }

  function close() {
    elements.modal.classList.add('hidden');
    elements.card?.classList.remove('is-detail', 'is-options');
    elements.open?.focus();
  }

  async function open() {
    closeCreateMenu();
    elements.modal.classList.remove('hidden');
    elements.results.replaceChildren(Object.assign(document.createElement('p'), { className: 'editor-help', textContent: '라이브러리를 불러오는 중입니다.' }));
    try {
      await service.load();
      syncFilterOptions();
      renderResults();
      renderPreview();
      elements.search.focus();
    } catch (error) {
      reportError(error, '국가·지역 라이브러리를 불러오지 못했습니다.', 'PL-LIB-001', 4800);
    }
  }

  function addSelected() {
    if (!selectedId) return;
    const count = instantiate([selectedId], elements.year.value, elements.childDepth.value);
    if (!count) setStatus('이미 현재 프로젝트에 있는 항목입니다.', 'success', 2800);
    else setStatus(`라이브러리 항목 ${count}개를 독립 프로젝트 인스턴스로 추가했습니다.`, 'success', 4200);
    close();
  }

  function advanceAdd() {
    if (!selectedId) return;
    if (elements.addOptions?.classList.contains('hidden')) {
      elements.addOptions.classList.remove('hidden');
      elements.addOptions.open = true;
      elements.optionsBack?.classList.remove('hidden');
      elements.add.textContent = '추가 확정';
      elements.card?.classList.add('is-options');
      requestFrame(() => elements.childDepth?.focus());
      return;
    }
    addSelected();
  }

  function returnToDetail() {
    elements.addOptions?.classList.add('hidden');
    elements.optionsBack?.classList.add('hidden');
    elements.add.textContent = '프로젝트에 추가';
    elements.card?.classList.remove('is-options');
    requestFrame(() => elements.add?.focus());
  }

  function requestSnapshot() {
    const snapshot = service.getSnapshot(elements.snapshot.value);
    if (!snapshot) return;
    confirm({
      title: `${snapshot.name} 스냅샷`,
      message: snapshot.metadata?.partial
        ? '이 스냅샷은 라이브러리 기능 시험용 부분 구성입니다. 현재 프로젝트에 없는 항목만 추가합니다.'
        : '현재 프로젝트에 없는 스냅샷 항목만 추가합니다.',
      confirmText: '없는 항목 추가',
      onConfirm: () => {
        const count = instantiate(snapshot.entityRefs, snapshot.referenceDate, 'all');
        setStatus(`${snapshot.name}에서 ${count}개 항목을 추가했습니다.`, 'success', 4200);
        close();
      },
    });
  }

  function connect() {
    elements.open?.addEventListener('click', open);
    elements.close?.addEventListener('click', close);
    elements.backdrop?.addEventListener('click', close);
    for (const [element, eventName] of [
      [elements.search, 'input'],
      [elements.type, 'change'],
      [elements.status, 'change'],
      [elements.year, 'input'],
      [elements.geographicRegion, 'change'],
    ]) {
      element?.addEventListener(eventName, () => {
        renderResults();
        if (element === elements.year) renderPreview();
      });
    }
    elements.clearSearch?.addEventListener('click', () => {
      elements.search.value = '';
      elements.search.dispatchEvent(new elements.search.ownerDocument.defaultView.Event('input', { bubbles: true }));
      elements.search.focus({ preventScroll: true });
    });
    elements.results?.addEventListener('click', event => {
      const button = event.target.closest('[data-library-entity-id]');
      if (button) select(button.dataset.libraryEntityId);
    });
    elements.add?.addEventListener('click', advanceAdd);
    elements.optionsBack?.addEventListener('click', returnToDetail);
    elements.snapshot?.addEventListener('change', () => { elements.snapshotButton.disabled = !elements.snapshot.value; });
    elements.snapshotButton?.addEventListener('click', requestSnapshot);
  }

  return Object.freeze({ close, connect, isOpen: () => !elements.modal.classList.contains('hidden'), open, renderPreview, renderResults, select });
}
