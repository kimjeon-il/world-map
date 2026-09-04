import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function write(relativePath, source) {
  fs.writeFileSync(path.join(root, relativePath), source, 'utf8');
}

function replaceExact(source, before, after, label) {
  if (!source.includes(before)) throw new Error(`Missing replacement anchor: ${label}`);
  const next = source.replace(before, after);
  if (next === source) throw new Error(`Replacement made no change: ${label}`);
  return next;
}

function replaceRegex(source, pattern, replacement, label) {
  if (!pattern.test(source)) throw new Error(`Missing regex anchor: ${label}`);
  pattern.lastIndex = 0;
  const next = source.replace(pattern, replacement);
  if (next === source) throw new Error(`Regex replacement made no change: ${label}`);
  return next;
}

function patchIndex() {
  const file = 'index.html';
  let source = read(file);
  if (!source.includes('data-pandolab-ui-v2="ui-v2-bundle"')) {
    source = replaceRegex(
      source,
      /(  <link rel="stylesheet" href="assets\/css\/app\.css\?v=([^"]+)" \/>)/,
      '$1\n  <link rel="stylesheet" data-pandolab-ui-v2="ui-v2-bundle" href="assets/css/ui-v2.bundle.css?v=$2" />\n  <link rel="modulepreload" data-pandolab-app-preload href="assets/js/app.js?v=$2" fetchpriority="low" />',
      'static UI bundle and app module preload',
    );
  }
  write(file, source);
}

function patchBootstrap() {
  const file = 'assets/js/bootstrap.js';
  let source = read(file);
  source = replaceExact(
    source,
    "  const CACHE_RECOVERY_PARAM = '_pandolab_cache';\n  const UI_BUNDLE = '../css/ui-v2.bundle.css';",
    "  const CACHE_RECOVERY_PARAM = '_pandolab_cache';\n  const DATA_CACHE_NAME = 'pandolab-data-assets-v1';",
    'bootstrap stable data cache constant',
  );
  source = replaceExact(
    source,
    "    dataCacheName: `pandolab-data-${DATA_REVISION}`,\n    uiStylesheetRequestCount: 0,\n    uiBundleBuildSourceCount: 16,",
    "    dataCacheName: DATA_CACHE_NAME,\n    uiStylesheetRequestCount: document.querySelectorAll('link[data-pandolab-ui-v2=\"ui-v2-bundle\"]').length,\n    uiBundleBuildSourceCount: 13,\n    appModulePreloaded: !!document.querySelector('link[data-pandolab-app-preload]'),\n    canonicalRequestedMs: null,",
    'bootstrap startup metric contracts',
  );
  source = replaceRegex(
    source,
    /  function installUiV2\(\) \{[\s\S]*?\n  \}\n\n  function cacheMismatchMessage\(\) \{/,
    `  function installUiRuntime() {\n    window.addEventListener('pandolab:interactive', () => {\n      import(versionedAsset('./modules/ui-runtime.js').href)\n        .then(module => module.initializeUiRuntime?.(document))\n        .catch(error => console.error('[PL-UI-RUNTIME-001]', error));\n    }, { once: true });\n  }\n\n  function scheduleCanonicalLoad(loader) {\n    if (startupMetrics.canonicalRequestedMs !== null) return;\n    const start = () => {\n      if (startupMetrics.canonicalRequestedMs !== null) return;\n      startupMetrics.canonicalRequestedMs = performance.now() - bootStartedAt;\n      loader.postMessage({ type: 'start-canonical' });\n    };\n    if (typeof window.requestIdleCallback === 'function') {\n      window.requestIdleCallback(start, { timeout: 1200 });\n    } else {\n      window.setTimeout(start, 120);\n    }\n  }\n\n  function cacheMismatchMessage() {`,
    'bootstrap UI runtime and canonical scheduling',
  );
  source = replaceExact(
    source,
    '  installUiV2();',
    '  installUiRuntime();',
    'bootstrap static UI bundle ownership',
  );
  source = replaceExact(
    source,
    '  window.PANDOLAB_DATA_CACHE_NAME = `pandolab-data-${DATA_REVISION}`;',
    '  window.PANDOLAB_DATA_CACHE_NAME = DATA_CACHE_NAME;',
    'bootstrap stable cache diagnostic',
  );
  source = replaceExact(
    source,
    "  window.addEventListener('pandolab:interactive', () => {\n    startupMetrics.interactiveMs = performance.now() - bootStartedAt;\n    startupMetrics.previewDisplayMs = Math.max(0, startupMetrics.interactiveMs - Number(startupMetrics.previewReceivedMs || 0));\n    finish();\n  }, { once: true });",
    "  window.addEventListener('pandolab:interactive', () => {\n    startupMetrics.interactiveMs = performance.now() - bootStartedAt;\n    startupMetrics.previewDisplayMs = Math.max(0, startupMetrics.interactiveMs - Number(startupMetrics.previewReceivedMs || 0));\n    finish();\n    scheduleCanonicalLoad(loader);\n  }, { once: true });",
    'bootstrap defer canonical until interactive',
  );
  source = replaceExact(
    source,
    "    app.onload = () => setProgress('빠른 지도를 표시하는 중입니다.', 99);",
    "    app.onload = () => {\n      setProgress('빠른 지도를 표시하는 중입니다.', 99);\n      // Fallback for a runtime that never emits the interactive milestone.\n      scheduleCanonicalLoad(loader);\n    };",
    'bootstrap canonical fallback after app evaluation',
  );
  write(file, source);
}

function patchDataLoader() {
  const file = 'assets/js/workers/data-loader-worker.js';
  let source = read(file);
  source = replaceExact(
    source,
    "const DATA_CACHE_PREFIX = 'pandolab-data-';\nconst DATA_CACHE_NAME = `${DATA_CACHE_PREFIX}${DATA_REVISION}`;\nconst LEGACY_CORE_CACHE_PREFIX = 'pandolab-core-';",
    "const DATA_CACHE_PREFIX = 'pandolab-data-';\nconst DATA_CACHE_NAME = 'pandolab-data-assets-v1';\nconst LEGACY_CORE_CACHE_PREFIX = 'pandolab-core-';",
    'worker stable cache namespace',
  );
  source = replaceExact(
    source,
    "function versionedDataUrl(relativePath) {\n  const url = new URL(relativePath, self.location.href);\n  url.searchParams.set('v', DATA_REVISION);\n  return url;\n}",
    "function versionedDataUrl(relativePath, revision = DATA_REVISION) {\n  const url = new URL(relativePath, self.location.href);\n  url.searchParams.set('v', String(revision || DATA_REVISION));\n  return url;\n}",
    'worker revision parameterization',
  );
  source = replaceExact(
    source,
    "let dataCachePromise = null;\nlet oldCacheCleanupPromise = null;",
    "let dataCachePromise = null;\nlet legacyCacheNamesPromise = null;\nlet oldCacheCleanupPromise = null;\nlet canonicalRequested = false;",
    'worker cache and canonical state',
  );
  source = replaceRegex(
    source,
    /async function cleanupOldCoreCaches\(\) \{[\s\S]*?\n\}\n\nasync function cacheNetworkResponse/,
    `async function legacyDataCacheNames() {\n  if (!('caches' in self)) return [];\n  if (!legacyCacheNamesPromise) {\n    legacyCacheNamesPromise = caches.keys()\n      .then(names => names.filter(name => name !== DATA_CACHE_NAME\n        && (name.startsWith(DATA_CACHE_PREFIX) || name.startsWith(LEGACY_CORE_CACHE_PREFIX))))\n      .catch(() => []);\n  }\n  return legacyCacheNamesPromise;\n}\n\nfunction responseStoredLengthMatches(response, spec) {\n  const expected = Number(spec?.compressedBytes || 0);\n  const actual = Number(response?.headers?.get?.('content-length') || 0);\n  return expected <= 0 || actual <= 0 || expected === actual;\n}\n\nasync function findCachedAsset(cache, url, spec) {\n  const exact = await cache?.match(url).catch(() => null);\n  if (exact) return { response: exact, legacy: false };\n  const names = await legacyDataCacheNames();\n  for (const name of names) {\n    const legacyCache = await caches.open(name).catch(() => null);\n    const response = await legacyCache?.match(url, { ignoreSearch: true }).catch(() => null);\n    if (!response || !responseStoredLengthMatches(response, spec)) continue;\n    return { response, legacy: true, cacheName: name };\n  }\n  return null;\n}\n\nasync function cleanupOldDataCaches() {\n  if (!('caches' in self)) return;\n  if (!oldCacheCleanupPromise) {\n    oldCacheCleanupPromise = (async () => {\n      const names = await caches.keys();\n      await Promise.all(names\n        .filter(name => name !== DATA_CACHE_NAME\n          && (name.startsWith(DATA_CACHE_PREFIX) || name.startsWith(LEGACY_CORE_CACHE_PREFIX)))\n        .map(name => caches.delete(name)));\n      const cache = await openDataCache();\n      if (!cache || !manifest?.assets) return;\n      const activeUrls = new Set(Object.values(manifest.assets).map(spec => resolveAssetUrl(spec).href));\n      const requests = await cache.keys();\n      await Promise.all(requests\n        .filter(request => !activeUrls.has(request.url))\n        .map(request => cache.delete(request)));\n    })().catch(() => undefined);\n  }\n  await oldCacheCleanupPromise;\n}\n\nasync function cacheNetworkResponse`,
    'worker cache migration and cleanup',
  );
  source = source.replaceAll('cleanupOldCoreCaches()', 'cleanupOldDataCaches()');
  source = replaceExact(
    source,
    "function resolveAssetUrl(spec) {\n  return versionedDataUrl(`../../data/${String(spec.url || '')}`);\n}",
    "function resolveAssetUrl(spec) {\n  const contentRevision = String(spec?.sha256 || DATA_REVISION);\n  return versionedDataUrl(`../../data/${String(spec?.url || '')}`, contentRevision);\n}",
    'worker content-addressed asset URLs',
  );
  source = replaceRegex(
    source,
    /  const cache = await openDataCache\(\);\n  if \(cache\) \{[\s\S]*?\n  \}\n\n  let lastError = null;/,
    `  const cache = await openDataCache();\n  const cachedEntry = await findCachedAsset(cache, url, spec);\n  if (cachedEntry?.response) {\n    try {\n      const migrationCopy = cachedEntry.legacy ? cachedEntry.response.clone() : null;\n      const result = await consumeResponse(cachedEntry.response, spec, phase, key, label, 'cache');\n      validateAssetLength(result, spec, label);\n      const value = await validate(result.buffer, label);\n      if (migrationCopy && cache) void cache.put(url, migrationCopy).catch(() => false);\n      report(phase, key, \`\${label}: 저장된 데이터를 확인했습니다.\`, Number(spec.compressedBytes || result.storedBytes), Number(spec.compressedBytes || result.storedBytes), true, {\n        source: 'cache',\n        migrated: cachedEntry.legacy,\n      });\n      return { ...result, value, cacheHit: true, cacheMigrated: cachedEntry.legacy };\n    } catch (_) {\n      await cache?.delete(url).catch(() => false);\n      report(phase, \`\${key}-cache-repair\`, \`\${label}: 손상되었거나 오래된 저장 데이터를 건너뛰고 다시 받습니다.\`, 1, 1, true, { source: 'cache', recovered: true });\n    }\n  }\n\n  let lastError = null;`,
    'worker cache read path',
  );
  source = replaceRegex(
    source,
    /self\.onmessage = event => \{[\s\S]*?\n\};\n\n\(async \(\) => \{/,
    `function startCanonicalLoad() {\n  if (!previewReady || canonicalRequested) return false;\n  canonicalRequested = true;\n  // Geometry unlocks editing and is much smaller than the canonical mesh.\n  // Load it first; the mesh starts only after the app has applied geometry.\n  loadGeometry();\n  return true;\n}\n\nself.onmessage = event => {\n  const type = event.data?.type;\n  if (type === 'start-canonical') startCanonicalLoad();\n  if (type === 'geometry-applied' && canonicalRequested) loadMesh();\n  if (type === 'retry-canonical' && !canonicalRequested) startCanonicalLoad();\n  if ((type === 'retry-geometry' || type === 'retry-canonical') && previewReady && !geometryReady) {\n    canonicalRequested = true;\n    loadGeometry();\n  }\n  if ((type === 'retry-mesh' || type === 'retry-canonical') && previewReady && geometryReady && !meshReady) {\n    canonicalRequested = true;\n    meshCancelled = false;\n    loadMesh();\n  }\n  if (type === 'cancel-mesh') {\n    meshCancelled = true;\n    meshAbortController?.abort();\n    if (geometryReady) void cleanupOldDataCaches();\n  }\n};\n\n(async () => {`,
    'worker canonical start gate',
  );
  source = replaceExact(
    source,
    "    manifest = await loadManifest();\n    await loadPreview();\n    if (loadPolicy.mode === 'parallel') loadMesh();\n    loadGeometry();",
    "    manifest = await loadManifest();\n    await loadPreview();",
    'worker preview-only bootstrap',
  );
  write(file, source);
}

function patchAppResize() {
  const file = 'assets/js/app.js';
  let source = read(file);
  source = replaceExact(
    source,
    "  function syncOverlayState() {\n    const fileOpen = !!document.querySelector('.top-actions')?.classList.contains('mobile-open');\n    const view = surfaceController.render({ fileOpen });\n    syncEditorPanelControls();\n    refreshMapSheetMetrics();\n    syncMobileNavigation();\n    requestAnimationFrame(syncMapHudBounds);\n    if (fileOpen) requestAnimationFrame(syncFileMenuNotificationOffset);\n    else $('app')?.style.removeProperty('--file-menu-notification-top');\n    queueMapResize('panel-layout');\n    return view;\n  }",
    "  let lastOverlayMapLayoutSignature = '';\n\n  function overlayMapLayoutSignature() {\n    const activeKind = surfaceController.activeMobileSheet || '';\n    const panel = activeKind ? mobileSheetPanel(activeKind) : null;\n    const snap = panel ? (sheetSnapIndex.get(panel.id) ?? '') : '';\n    return [\n      layoutMode,\n      surfaceController.isOpen('layers') ? 1 : 0,\n      surfaceController.isOpen('create') ? 1 : 0,\n      surfaceController.isOpen('editor') ? 1 : 0,\n      activeKind,\n      snap,\n    ].join('|');\n  }\n\n  function syncOverlayState() {\n    const fileOpen = !!document.querySelector('.top-actions')?.classList.contains('mobile-open');\n    const view = surfaceController.render({ fileOpen });\n    syncEditorPanelControls();\n    refreshMapSheetMetrics();\n    syncMobileNavigation();\n    requestAnimationFrame(syncMapHudBounds);\n    if (fileOpen) requestAnimationFrame(syncFileMenuNotificationOffset);\n    else $('app')?.style.removeProperty('--file-menu-notification-top');\n    const layoutSignature = overlayMapLayoutSignature();\n    if (layoutSignature !== lastOverlayMapLayoutSignature) {\n      lastOverlayMapLayoutSignature = layoutSignature;\n      queueMapResize('panel-layout');\n    }\n    return view;\n  }",
    'overlay resize signature guard',
  );
  source = replaceExact(
    source,
    "    setMobileSheetHeight(panel, drag.startIndex, drag.startHeight - deltaY);\n    refreshMapSheetMetrics();\n    queueMapResize('panel-layout');\n    return true;",
    "    // During a drag, only move the sheet. Resizing WebGL/SVG every pointer\n    // frame caused visible jank; the settled snap triggers one resize below.\n    setMobileSheetHeight(panel, drag.startIndex, drag.startHeight - deltaY);\n    return true;",
    'remove per-frame sheet map resize',
  );
  source = replaceExact(
    source,
    "    syncMobileNavigation();\n    if (layoutMode === 'wide') queueMapResize('panel-layout');\n  }\n\n\n  function openSurface",
    "    syncMobileNavigation();\n  }\n\n\n  function openSurface",
    'remove duplicate editor resize',
  );
  write(file, source);
}

function patchUiRuntime() {
  const file = 'assets/js/modules/ui-runtime.js';
  let source = read(file);
  source = replaceExact(
    source,
    "  if (!(stepper instanceof HTMLOListElement) || !(indicator instanceof HTMLElement)) return;",
    "  if (stepper?.tagName !== 'OL' || !indicator) return;",
    'ui runtime portable stepper guards',
  );
  source = replaceExact(
    source,
    "  if (!(select instanceof HTMLSelectElement) || !(list instanceof HTMLElement)) return;",
    "  if (select?.tagName !== 'SELECT' || !list) return;",
    'ui runtime portable select guards',
  );
  source = replaceExact(
    source,
    "      select.dispatchEvent(new Event('change', { bubbles: true }));",
    "      select.dispatchEvent(new globalThis.Event('change', { bubbles: true }));",
    'ui runtime global Event',
  );
  write(file, source);
}

function patchCss() {
  const file = 'assets/css/components/editor-shell.css';
  let source = read(file);
  const before = source;
  source = source
    .replace(/^\s*backdrop-filter:\s*blur\(18px\)\s+saturate\(1\.08\);\s*\n/gm, '')
    .replace(/^\s*backdrop-filter:\s*blur\(18px\);\s*\n/gm, '');
  if (source === before) throw new Error('Missing editor shell backdrop-filter declarations');
  write(file, source);
}

function patchChecksAndTests() {
  let layering = read('scripts/check-ui-layering.mjs');
  layering = replaceExact(
    layering,
    "const bootstrapPath = path.join(root, 'assets/js/bootstrap.js');\nconst bundlePath = path.join(root, 'assets/css/ui-v2.bundle.css');",
    "const bootstrapPath = path.join(root, 'assets/js/bootstrap.js');\nconst htmlPath = path.join(root, 'index.html');\nconst bundlePath = path.join(root, 'assets/css/ui-v2.bundle.css');",
    'layering audit index path',
  );
  layering = replaceExact(
    layering,
    "  const bootstrap = fs.readFileSync(bootstrapPath, 'utf8');\n  if (!bootstrap.includes('../css/ui-v2.bundle.css')) failures.push('bootstrap does not install ui-v2.bundle.css');",
    "  const bootstrap = fs.readFileSync(bootstrapPath, 'utf8');\n  const html = fs.readFileSync(htmlPath, 'utf8');\n  if (!/data-pandolab-ui-v2=\"ui-v2-bundle\"[^>]+ui-v2\\.bundle\\.css/.test(html)) {\n    failures.push('index.html does not load ui-v2.bundle.css statically');\n  }\n  if (bootstrap.includes('../css/ui-v2.bundle.css')) failures.push('bootstrap still injects ui-v2.bundle.css at runtime');",
    'layering audit static bundle contract',
  );
  write('scripts/check-ui-layering.mjs', layering);

  let testSource = read('tests/unit/startup-performance-contract.test.mjs');
  testSource = replaceExact(
    testSource,
    "const bundle = read('assets/css/ui-v2.bundle.css');",
    "const bundle = read('assets/css/ui-v2.bundle.css');\nconst html = read('index.html');\nconst editorShell = read('assets/css/components/editor-shell.css');",
    'startup test extra sources',
  );
  testSource = replaceExact(
    testSource,
    "  assert.match(loader, /const DATA_CACHE_PREFIX = 'pandolab-data-'/);\n  assert.match(loader, /url\\.searchParams\\.set\\('v', DATA_REVISION\\)/);",
    "  assert.match(loader, /const DATA_CACHE_NAME = 'pandolab-data-assets-v1'/);\n  assert.match(loader, /spec\\?\\.sha256 \\|\\| DATA_REVISION/);\n  assert.match(loader, /cache\\?\\.match\\(url\\)/);\n  assert.match(loader, /ignoreSearch: true/);",
    'startup test content-addressed cache assertions',
  );
  testSource = replaceExact(
    testSource,
    "  assert.match(bootstrap, /const UI_BUNDLE = '\\.\\.\\/css\\/ui-v2\\.bundle\\.css'/);\n  assert.doesNotMatch(bootstrap, /const UI_STYLES/);",
    "  assert.match(html, /data-pandolab-ui-v2=\"ui-v2-bundle\"/);\n  assert.match(html, /rel=\"modulepreload\"[^>]+assets\\/js\\/app\\.js/);\n  assert.doesNotMatch(bootstrap, /const UI_BUNDLE|const UI_STYLES/);",
    'startup test static UI and preload assertions',
  );
  testSource += `\n\ntest('canonical data waits until the interactive app and avoids drag-time map resizes', () => {\n  assert.match(bootstrap, /scheduleCanonicalLoad\\(loader\\)/);\n  assert.match(loader, /type === 'start-canonical'/);\n  const startupTail = loader.slice(loader.lastIndexOf('(async () =>'));\n  assert.doesNotMatch(startupTail, /loadGeometry\\(\\)|loadMesh\\(\\)/);\n  const dragStart = app.indexOf('function moveMobileSheetDrag');\n  const dragEnd = app.indexOf('function finishMobileSheetDrag', dragStart);\n  const dragSource = app.slice(dragStart, dragEnd);\n  assert.doesNotMatch(dragSource, /queueMapResize|refreshMapSheetMetrics/);\n  assert.match(app, /function overlayMapLayoutSignature/);\n});\n\ntest('large map chrome does not use live backdrop blur', () => {\n  assert.doesNotMatch(editorShell, /backdrop-filter/);\n});\n`;
  write('tests/unit/startup-performance-contract.test.mjs', testSource);
}

patchIndex();
patchBootstrap();
patchDataLoader();
patchAppResize();
patchUiRuntime();
patchCss();
patchChecksAndTests();

console.log('Applied startup, cache, resize, compositing, and CI performance hotfixes.');
