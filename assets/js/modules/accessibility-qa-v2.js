const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

const MODAL_SELECTOR = '.ui-dialog[aria-modal="true"]:not(#confirmModal)';
const SHEET_IDS = Object.freeze(['leftPanel', 'createMenu', 'rightPanel']);
const LISTBOX_KEYS = new Set(['ArrowDown', 'ArrowUp', 'Home', 'End']);
const LEGACY_COMPACT_QUERY = '(min-width: 800px) and (max-width: 1359px)';

let installed = false;
let openSequence = 0;
const dialogState = new WeakMap();

function isHidden(element) {
  return !element
    || element.hidden
    || element.classList?.contains('hidden')
    || element.closest?.('[hidden], .hidden, [aria-hidden="true"]')
    || (element instanceof HTMLElement && element.getClientRects().length === 0);
}

function focusables(container) {
  if (!(container instanceof HTMLElement)) return [];
  return [...container.querySelectorAll(FOCUSABLE_SELECTOR)].filter(element => !isHidden(element));
}

function dialogOpen(dialog) {
  return dialog instanceof HTMLElement && !dialog.hidden && !dialog.classList.contains('hidden');
}

function topOpenDialog(documentRef) {
  return [...documentRef.querySelectorAll(MODAL_SELECTOR)]
    .filter(dialogOpen)
    .sort((a, b) => (dialogState.get(a)?.order || 0) - (dialogState.get(b)?.order || 0))
    .at(-1) || null;
}

function syncDialog(dialog, documentRef) {
  if (!(dialog instanceof HTMLElement)) return;
  let state = dialogState.get(dialog);
  if (!state) {
    state = { open: false, order: 0, trigger: null };
    dialogState.set(dialog, state);
  }

  const open = dialogOpen(dialog);
  if (open && !state.open) {
    state.open = true;
    state.order = ++openSequence;
    const active = documentRef.activeElement;
    state.trigger = active instanceof HTMLElement && !dialog.contains(active) ? active : null;
    requestAnimationFrame(() => {
      if (!dialogOpen(dialog) || dialog.contains(documentRef.activeElement)) return;
      focusables(dialog)[0]?.focus({ preventScroll: true });
    });
    return;
  }

  if (!open && state.open) {
    state.open = false;
    const trigger = state.trigger;
    state.trigger = null;
    requestAnimationFrame(() => {
      if (!(trigger instanceof HTMLElement) || !trigger.isConnected) return;
      if (topOpenDialog(documentRef)) return;
      trigger.focus({ preventScroll: true });
    });
  }
}

function installDialogGuards(documentRef) {
  const dialogs = [...documentRef.querySelectorAll(MODAL_SELECTOR)];
  dialogs.forEach(dialog => {
    syncDialog(dialog, documentRef);
    new MutationObserver(() => syncDialog(dialog, documentRef)).observe(dialog, {
      attributes: true,
      attributeFilter: ['class', 'hidden'],
    });
  });

  documentRef.addEventListener('keydown', event => {
    if (event.key !== 'Tab') return;
    const dialog = topOpenDialog(documentRef);
    if (!(dialog instanceof HTMLElement)) return;
    const active = documentRef.activeElement;
    if (active?.closest?.('.ui-select-popover:not([hidden]), [data-color-picker].is-open')) return;
    const items = focusables(dialog);
    if (!items.length) {
      event.preventDefault();
      return;
    }
    const first = items[0];
    const last = items.at(-1);
    if (event.shiftKey && (active === first || !dialog.contains(active))) {
      event.preventDefault();
      last.focus({ preventScroll: true });
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus({ preventScroll: true });
    }
  }, true);
}

function syncHiddenSurfaceInert(documentRef) {
  for (const id of SHEET_IDS) {
    const panel = documentRef.getElementById(id);
    if (!(panel instanceof HTMLElement)) continue;
    const sync = () => {
      panel.inert = panel.getAttribute('aria-hidden') === 'true';
    };
    sync();
    new MutationObserver(sync).observe(panel, {
      attributes: true,
      attributeFilter: ['aria-hidden'],
    });
  }
}

function libraryOptions(results) {
  return [...(results?.querySelectorAll?.('[role="option"][data-library-entity-id]') || [])]
    .filter(option => !isHidden(option));
}

function syncLibraryRovingTabindex(results) {
  const options = libraryOptions(results);
  if (!options.length) return;
  const selected = options.find(option => option.getAttribute('aria-selected') === 'true');
  const target = selected || options.find(option => option.tabIndex === 0) || options[0];
  options.forEach(option => { option.tabIndex = option === target ? 0 : -1; });
}

function installLibraryKeyboard(documentRef) {
  const results = documentRef.getElementById('historicalLibraryResults');
  if (!(results instanceof HTMLElement)) return;
  const sync = () => syncLibraryRovingTabindex(results);
  sync();
  new MutationObserver(sync).observe(results, { childList: true, subtree: true });

  results.addEventListener('keydown', event => {
    if (!LISTBOX_KEYS.has(event.key)) return;
    const options = libraryOptions(results);
    const current = event.target.closest?.('[role="option"]');
    const index = Math.max(0, options.indexOf(current));
    const nextIndex = event.key === 'Home' ? 0
      : event.key === 'End' ? options.length - 1
        : event.key === 'ArrowDown' ? Math.min(options.length - 1, index + 1)
          : Math.max(0, index - 1);
    const next = options[nextIndex];
    if (!(next instanceof HTMLElement)) return;
    event.preventDefault();

    const layout = documentRef.getElementById('app')?.dataset.layout || documentRef.body?.dataset.layout;
    if (layout === 'mobile') {
      options.forEach(option => { option.tabIndex = option === next ? 0 : -1; });
      next.focus({ preventScroll: true });
      return;
    }

    next.click();
    requestAnimationFrame(() => {
      const selected = results.querySelector('[role="option"][aria-selected="true"]');
      syncLibraryRovingTabindex(results);
      selected?.focus({ preventScroll: true });
    });
  });
}

function installDirectEditFocusGuard(documentRef) {
  const body = documentRef.body;
  if (!(body instanceof HTMLElement)) return;
  const sync = () => {
    if (!body.classList.contains('mobile-direct-edit')) return;
    const toolbar = documentRef.getElementById('mapToolToolbar');
    if (!toolbar?.contains(documentRef.activeElement)) return;
    requestAnimationFrame(() => {
      const cancel = documentRef.getElementById('modeCancelBtn');
      cancel?.focus({ preventScroll: true });
    });
  };
  sync();
  new MutationObserver(sync).observe(body, {
    attributes: true,
    attributeFilter: ['class'],
  });
}

function normalizeViewportAccessibility(documentRef) {
  const viewport = documentRef.querySelector('meta[name="viewport"]');
  if (!viewport) return;
  const content = String(viewport.getAttribute('content') || '');
  if (!/maximum-scale\s*=\s*1|user-scalable\s*=\s*no/i.test(content)) return;
  viewport.setAttribute('content', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

function normalizeLayoutBreakpointContract(windowRef) {
  if (!windowRef || windowRef.__PANDOLAB_UI13_LAYOUT_PATCHED__) return;
  const prototype = windowRef.MediaQueryList?.prototype;
  const descriptor = prototype ? Object.getOwnPropertyDescriptor(prototype, 'matches') : null;
  if (!descriptor?.get || descriptor.configurable === false) return;

  Object.defineProperty(prototype, 'matches', {
    configurable: true,
    enumerable: descriptor.enumerable,
    get() {
      if (String(this.media || '').replace(/\s+/g, ' ').trim() === LEGACY_COMPACT_QUERY) {
        return windowRef.innerWidth >= 800 && windowRef.innerWidth <= 1199;
      }
      return descriptor.get.call(this);
    },
  });
  windowRef.__PANDOLAB_UI13_LAYOUT_PATCHED__ = true;
  requestAnimationFrame(() => windowRef.dispatchEvent(new Event('resize')));
}

function installStyle(documentRef) {
  if (documentRef.querySelector('link[data-pandolab-ui-v2="features-responsive-accessibility"]')) return;
  const href = new URL('../../css/features/responsive-accessibility.css', import.meta.url);
  const revision = String(globalThis.PANDOLAB_ASSET_REVISION || '').trim();
  if (revision) href.searchParams.set('v', revision);
  const link = documentRef.createElement('link');
  link.rel = 'stylesheet';
  link.href = href.href;
  link.dataset.pandolabUiV2 = 'features-responsive-accessibility';
  documentRef.head.appendChild(link);
}

export function installAccessibilityQaV2(documentRef = document) {
  if (installed) return;
  installed = true;
  normalizeViewportAccessibility(documentRef);
  normalizeLayoutBreakpointContract(documentRef.defaultView || globalThis.window);
  installStyle(documentRef);
  installDialogGuards(documentRef);
  syncHiddenSurfaceInert(documentRef);
  installLibraryKeyboard(documentRef);
  installDirectEditFocusGuard(documentRef);
}
