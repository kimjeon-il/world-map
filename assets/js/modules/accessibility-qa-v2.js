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
const MENU_KEYS = new Set(['ArrowDown', 'ArrowUp', 'Home', 'End']);
const LISTBOX_KEYS = new Set(['ArrowDown', 'ArrowUp', 'Home', 'End']);

let installed = false;
let openSequence = 0;
const dialogState = new WeakMap();

function isHidden(element) {
  return !element
    || element.hidden
    || element.classList?.contains('hidden')
    || element.closest?.('[hidden], .hidden, [aria-hidden="true"]');
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
    dialog.inert = false;
    requestAnimationFrame(() => {
      if (!dialogOpen(dialog) || dialog.contains(documentRef.activeElement)) return;
      focusables(dialog)[0]?.focus({ preventScroll: true });
    });
    return;
  }

  if (!open && state.open) {
    state.open = false;
    dialog.inert = true;
    const trigger = state.trigger;
    state.trigger = null;
    requestAnimationFrame(() => {
      if (!(trigger instanceof HTMLElement) || !trigger.isConnected) return;
      if (topOpenDialog(documentRef)) return;
      trigger.focus({ preventScroll: true });
    });
    return;
  }

  if (!open) dialog.inert = true;
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

function menuItems(menu) {
  return [...(menu?.querySelectorAll?.('[role="menuitem"]') || [])]
    .filter(item => !item.disabled && item.getAttribute('aria-disabled') !== 'true' && !isHidden(item));
}

function setMenuFocus(items, target) {
  items.forEach(item => { item.tabIndex = item === target ? 0 : -1; });
  target?.focus({ preventScroll: true });
}

function installFileMenuKeyboard(documentRef) {
  const trigger = documentRef.getElementById('mobileFileBtn');
  const menu = documentRef.getElementById('fileMenu');
  if (!(trigger instanceof HTMLElement) || !(menu instanceof HTMLElement)) return;

  const sync = () => {
    const open = trigger.getAttribute('aria-expanded') === 'true';
    menu.inert = !open;
    const items = menuItems(menu);
    if (!items.length) return;
    items.forEach((item, index) => { item.tabIndex = index === 0 ? 0 : -1; });
    if (open) {
      requestAnimationFrame(() => {
        if (trigger.getAttribute('aria-expanded') !== 'true') return;
        if (documentRef.activeElement === trigger) items[0]?.focus({ preventScroll: true });
      });
    } else if (menu.contains(documentRef.activeElement)) {
      requestAnimationFrame(() => trigger.focus({ preventScroll: true }));
    }
  };

  sync();
  new MutationObserver(sync).observe(trigger, {
    attributes: true,
    attributeFilter: ['aria-expanded'],
  });

  menu.addEventListener('keydown', event => {
    if (!MENU_KEYS.has(event.key)) return;
    const items = menuItems(menu);
    const current = event.target.closest?.('[role="menuitem"]');
    const index = Math.max(0, items.indexOf(current));
    const nextIndex = event.key === 'Home' ? 0
      : event.key === 'End' ? items.length - 1
        : event.key === 'ArrowDown' ? (index + 1) % items.length
          : (index - 1 + items.length) % items.length;
    event.preventDefault();
    setMenuFocus(items, items[nextIndex]);
  });
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
  installStyle(documentRef);
  installDialogGuards(documentRef);
  syncHiddenSurfaceInert(documentRef);
  installFileMenuKeyboard(documentRef);
  installLibraryKeyboard(documentRef);
  installDirectEditFocusGuard(documentRef);
}
