const LISTBOX_KEYS = new Set(['ArrowDown', 'ArrowUp', 'Home', 'End']);

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
  let selectedVersionId = '';
  let loading = false;

  function setLoadingState(nextLoading) {
    loading = !!nextLoading;
    for (const element of [
      elements.search,
      elements.clearSearch,
      elements.type,
      elements.status,
      elements.year,
      elements.geographicRegion,
      elements.snapshot,
      elements.childDepth,
    ]) {
      if (element) element.disabled = loading;
    }
    if (elements.snapshotButton) elements.snapshotButton.disabled = loading || !elements.snapshot.value;
    if (elements.add) elements.add.disabled = true;
    if (elements.results) elements.results.setAttribute('aria-busy', String(loading));
  }

  function renderLoadingResults() {
    const fragment = document.createDocumentFragment();
    for (let index = 0; index < 6; index += 1) {
      const row = document.createElement('div');
      row.className = 'historical-library-result-skeleton';
      row.setAttribute('aria-hidden', 'true');
      const title = document.createElement('span');
      const meta = document.createElement('span');
      title.className = 'ui-skeleton-block';
      meta.className = 'ui-skeleton-block';
      row.append(title, meta);
      fragment.appendChild(row);
    }
    elements.results.replaceChildren(fragment);
  }

  function period(entity) {
    if (!entity.startDate && !entity.endDate) return '현존';
    return `${entity.startDate || '?'}–${entity.endDate || '현재'}`;
  }

  function syncFilterOptions() {
    const geographicRegions = [...new Set(service.list().map(entity => String(entity.metadata?.geographicRegion || '')).filter(Boolean))].sort(collator.compare);
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
    const automaticVersion = entity ? selectGeometryVersion(entity, elements.year.value) : null;
    const version = entity?.geometryVersions?.find(candidate => candidate.id === selectedVersionId) || automaticVersion;
    if (!entity || !version) {
      selectedVersionId = '';
      const help = document.createElement('p');
      help.className = 'editor-help';
      help.textContent = '항목을 선택하세요.';
      elements.preview.replaceChildren(help);
      elements.add.disabled = true;
      elements.addOptions?.classList.add('hidden');
      elements.optionsBack?.classList.add('hidden');
      elements.card?.classList.remove('is-detail', 'is-options');
      return;
    }
    const title = document.createElement('h3');
    title.textContent = entity.displayNames?.ko || entity.canonicalName;
    const versionField = document.createElement('label');
    versionField.className = 'ui-field field-group historical-library-version-field';
    const versionLabel = document.createElement('span');
    versionLabel.textContent = '경계 버전';
    const versionSelect = document.createElement('select');
    versionSelect.id = 'historicalLibraryGeometryVersionInput';
    versionSelect.setAttribute('aria-label', `${entity.displayNames?.ko || entity.canonicalName} 경계 버전`);
    for (const candidate of entity.geometryVersions || []) {
      const option = document.createElement('option');
      option.value = candidate.id;
      option.textContent = `${candidate.validFrom || '?'}–${candidate.validTo || '현재'}`;
      option.selected = candidate.id === version.id;
      versionSelect.appendChild(option);
    }
    if ((entity.geometryVersions || []).length > 1) {
      versionField.append(versionLabel, versionSelect);
    } else {
      versionField.textContent = `경계 적용 기간 · ${version.validFrom || '?'}–${version.validTo || '현재'}`;
    }
    const versionNotes = document.createElement('p');
    versionNotes.className = 'editor-help historical-library-version-notes';
    versionNotes.textContent = version.notes || entity.sourceInfo?.notes || '';
    versionSelect.addEventListener('change', () => {
      selectedVersionId = versionSelect.value;
      renderPreview();
    });
    const meta = document.createElement('p');
    meta.className = 'editor-help';
    meta.textContent = [
      version.certainty === 'low' ? '정확도가 낮은 경계' : version.certainty === 'medium' ? '경계 일부 불확실' : '',
      entity.metadata?.approximateGeometry ? '근사 경계' : '',
    ].filter(Boolean).join(' · ');
    const source = document.createElement('p');
    source.className = 'editor-help';
    const sourceEntries = Array.isArray(entity.sourceInfo?.sources) ? entity.sourceInfo.sources : [];
    const primarySource = sourceEntries[0] || entity.sourceInfo || {};
    const sourceTitle = primarySource.title || version.sourceId || '미지정';
    const sourceUrl = primarySource.url || entity.sourceInfo?.url || '';
    if (/^https?:\/\//i.test(sourceUrl)) {
      const link = document.createElement('a');
      link.href = sourceUrl;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = '출처';
      link.setAttribute('aria-label', `출처: ${sourceTitle}`);
      source.append(link);
    } else source.textContent = `출처: ${sourceTitle}`;
    const heading = document.createElement('div');
    heading.className = 'historical-library-preview-heading';
    const flagPreview = document.createElement('div');
    flagPreview.className = 'historical-library-flag';
    const flagUrl = String(entity.metadata?.defaultFlagDataUrl || '');
    if (flagUrl) {
      const image = document.createElement('img');
      image.src = flagUrl;
      image.alt = `${entity.displayNames?.ko || entity.canonicalName} 국기`;
      flagPreview.appendChild(image);
      heading.append(flagPreview);
    }
    heading.append(title);
    const advanced = document.createElement('details');
    advanced.className = 'ui-disclosure editor-disclosure';
    const summary = document.createElement('summary');
    summary.textContent = '출처·이용 조건';
    const body = document.createElement('dl');
    body.className = 'historical-library-advanced';
    const addAdvanced = (term, value) => {
      if (!value) return;
      const dt = document.createElement('dt');
      const dd = document.createElement('dd');
      dt.textContent = term;
      dd.textContent = String(value || '—');
      body.append(dt, dd);
    };
    addAdvanced('이용 조건', primarySource.license || entity.sourceInfo?.license);
    for (const item of sourceEntries.slice(1)) addAdvanced(item.title || '출처', [item.url, item.license].filter(Boolean).join(' · '));
    advanced.append(summary, body);
    elements.preview.replaceChildren(heading, versionField, renderMapPreview(entity, version),
      ...(meta.textContent ? [meta] : []), ...(versionNotes.textContent ? [versionNotes] : []), source,
      ...(body.children.length ? [advanced] : []));
    elements.add.disabled = false;
    const hasChildren = service.list().some(candidate => candidate.parentLibraryId === entity.libraryId);
    if (hasChildren) elements.addOptions?.classList.remove('hidden');
    else {
      elements.addOptions?.classList.add('hidden');
      elements.childDepth.value = 'none';
    }
    if (isMobile()) elements.optionsBack?.classList.remove('hidden');
    else elements.optionsBack?.classList.add('hidden');
    elements.add.textContent = '추가';
    elements.add.setAttribute('aria-label', '선택한 항목을 현재 프로젝트에 추가');
    elements.add.dataset.tooltip = '선택한 항목을 현재 프로젝트에 추가';
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
      button.tabIndex = selected ? 0 : -1;
      const strong = document.createElement('strong');
      strong.textContent = entity.displayNames?.ko || entity.canonicalName;
      const small = document.createElement('small');
      small.textContent = `${typeLabels[entity.type]} · ${period(entity)}`;
      button.append(strong, small);
      fragment.appendChild(button);
    }
    if (!results.length) fragment.appendChild(createEmptyState('조건에 맞는 항목이 없습니다.', '검색어, 종류, 상태 또는 기준 연도를 바꿔 보세요.', { compact: true }));
    elements.results.replaceChildren(fragment);
    const options = [...elements.results.querySelectorAll('[role="option"]')];
    if (options.length && !options.some(option => option.tabIndex === 0)) options[0].tabIndex = 0;
    if (selectedId && !results.some(entity => entity.libraryId === selectedId)) {
      selectedId = '';
      renderPreview();
    }
  }

  function select(id) {
    if (loading) return;
    if (selectedId !== String(id || '')) {
      selectedVersionId = '';
      elements.childDepth.value = 'none';
    }
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
    setLoadingState(true);
    renderLoadingResults();
    try {
      await service.load();
      setLoadingState(false);
      syncFilterOptions();
      renderResults();
      renderPreview();
      elements.search.focus();
    } catch (error) {
      loading = false;
      elements.results.setAttribute('aria-busy', 'false');
      elements.results.replaceChildren(createEmptyState('라이브러리를 불러오지 못했습니다.', '잠시 후 다시 시도해 주세요.', { compact: true }));
      reportError(error, '국가·지역 라이브러리를 불러오지 못했습니다.', 'PL-LIB-001', 4800);
    }
  }

  async function addSelected() {
    if (loading || !selectedId) return;
    setLoadingState(true);
    try {
      const versionOverrides = selectedVersionId ? { [selectedId]: selectedVersionId } : {};
      const result = await instantiate([selectedId], elements.year.value, elements.childDepth.value, versionOverrides);
      const added = Number(result?.added || 0);
      const deleted = Number(result?.deleted || 0);
      if (!added) setStatus('이미 현재 프로젝트에 있는 항목입니다.', 'success', 2800);
      else if (Number(result?.subtracted || 0)) {
        const deletedText = deleted ? ` 이 중 ${deleted}개는 완전히 대체되어 제거했습니다.` : '';
        setStatus(`라이브러리 항목 ${added}개를 추가하고 기존 국가 ${result.subtracted}개의 겹친 영토를 대체했습니다.${deletedText}`, 'success', 4200);
      } else {
        setStatus(`라이브러리 항목 ${added}개를 독립 프로젝트 인스턴스로 추가했습니다.`, 'success', 4200);
      }
      close();
    } catch (error) {
      setLoadingState(false);
      renderPreview();
      reportError(error, '라이브러리 항목을 프로젝트에 추가하지 못했습니다.', 'PL-LIB-002', 4800);
    }
  }

  function advanceAdd() {
    if (!selectedId) return;
    void addSelected();
  }

  function returnToDetail() {
    elements.addOptions?.classList.add('hidden');
    elements.optionsBack?.classList.add('hidden');
    elements.add.textContent = '추가';
    elements.card?.classList.remove('is-detail', 'is-options');
    requestFrame(() => elements.results.querySelector('[aria-selected="true"]')?.focus());
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
      onConfirm: async () => {
        try {
          const result = await instantiate(snapshot.entityRefs, snapshot.referenceDate, 'all');
          setStatus(`${snapshot.name}에서 ${Number(result?.added || 0)}개 항목을 추가했습니다.`, 'success', 4200);
          close();
        } catch (error) {
          reportError(error, '세계 스냅샷을 프로젝트에 추가하지 못했습니다.', 'PL-LIB-003', 4800);
        }
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
        if (element === elements.year) {
          selectedVersionId = '';
          renderPreview();
        }
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
    elements.results?.addEventListener('keydown', event => {
      if (!LISTBOX_KEYS.has(event.key)) return;
      const options = [...elements.results.querySelectorAll('[role="option"][data-library-entity-id]')];
      if (!options.length) return;
      const current = event.target.closest('[role="option"]');
      const currentIndex = Math.max(0, options.indexOf(current));
      const nextIndex = event.key === 'Home' ? 0
        : event.key === 'End' ? options.length - 1
          : event.key === 'ArrowDown' ? Math.min(options.length - 1, currentIndex + 1)
            : Math.max(0, currentIndex - 1);
      const next = options[nextIndex];
      if (!(next instanceof HTMLElement)) return;
      event.preventDefault();
      options.forEach(option => { option.tabIndex = option === next ? 0 : -1; });
      if (isMobile()) {
        next.focus({ preventScroll: true });
        return;
      }
      select(next.dataset.libraryEntityId);
      requestFrame(() => elements.results.querySelector('[aria-selected="true"]')?.focus({ preventScroll: true }));
    });
    elements.add?.addEventListener('click', advanceAdd);
    elements.optionsBack?.addEventListener('click', returnToDetail);
    elements.snapshot?.addEventListener('change', () => { elements.snapshotButton.disabled = !elements.snapshot.value; });
    elements.snapshotButton?.addEventListener('click', requestSnapshot);
  }

  return Object.freeze({ close, connect, isOpen: () => !elements.modal.classList.contains('hidden'), open, renderPreview, renderResults, select });
}
