import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const indexPath = path.join(root, 'index.html');
const appPath = path.join(root, 'assets', 'js', 'app.js');
const bootstrapPath = path.join(root, 'assets', 'js', 'bootstrap.js');

let index = fs.readFileSync(indexPath, 'utf8');
let app = fs.readFileSync(appPath, 'utf8');
let bootstrap = fs.readFileSync(bootstrapPath, 'utf8');

function replaceRequired(source, pattern, replacement, label, { min = 1 } = {}) {
  const matches = source.match(pattern);
  const count = matches?.length || 0;
  if (count < min) throw new Error(`${label}: expected at least ${min} match(es), found ${count}`);
  return source.replace(pattern, replacement);
}

function replaceNestedButtonLabel(source, id, text) {
  const pattern = new RegExp(`(<button\\b[^>]*\\bid=["']${id}["'][^>]*>[\\s\\S]*?<(?:span|strong)\\b[^>]*>)([^<]*)(</(?:span|strong)>)`);
  if (!pattern.test(source)) return source;
  return source.replace(pattern, `$1${text}$3`);
}

function replaceSimpleElementText(source, id, text) {
  const pattern = new RegExp(`(<([a-z][\\w-]*)\\b[^>]*\\bid=["']${id}["'][^>]*>)([^<]*)(</\\2>)`, 'i');
  if (!pattern.test(source)) return source;
  return source.replace(pattern, `$1${text}$4`);
}

index = replaceRequired(
  index,
  /<meta\s+name=["']viewport["']\s+content=["'][^"']*["']\s*\/?>/i,
  '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />',
  'viewport meta',
);

index = index.replace(/\s*<span\s+class=["']ui-dialog-kicker["'][^>]*>[^<]*<\/span>/g, '');
index = index.replace(/\s*<span\s+class=["'][^"']*\bcreate-toolbar-divider\b[^"']*["'][^>]*><\/span>/g, '');

index = replaceNestedButtonLabel(index, 'mobileCreateBtn', '만들기');
index = replaceNestedButtonLabel(index, 'createMenuBtn', '만들기');
index = replaceNestedButtonLabel(index, 'openGisBtn', 'GIS 가져오기');
index = replaceNestedButtonLabel(index, 'saveProjectBtn', '저장');
index = replaceNestedButtonLabel(index, 'dataExportBtn', 'GIS 데이터 내보내기');
index = replaceSimpleElementText(index, 'createSheetTitle', '만들기');
index = replaceSimpleElementText(index, 'mapSheetTitle', '지도');
index = replaceSimpleElementText(index, 'terrainLayerSettingsTitle', '지형');

index = index.replace(
  /(<[^>]+\bid=["']projectionControl["'][^>]*\baria-label=["'])[^"']*(["'][^>]*>)/i,
  '$1투영법$2',
);
index = index.replace(
  /(<button\b[^>]*\bid=["']saveProjectBtn["'][^>]*\bclass=["'])([^"']*)(["'])/i,
  (_, before, classes, after) => `${before}${classes.includes('ghost') ? classes : `${classes} ghost`.trim()}${after}`,
);

app = replaceRequired(
  app,
  /\(min-width: 800px\) and \(max-width: 1359px\)/g,
  '(min-width: 800px) and (max-width: 1199px)',
  'legacy compact breakpoint',
);

bootstrap = replaceRequired(
  bootstrap,
  /  const LEGACY_COMPACT_QUERY = '[^']+';\n  const CANONICAL_COMPACT_QUERY = '[^']+';\n/,
  '',
  'bootstrap legacy breakpoint constants',
);
bootstrap = replaceRequired(
  bootstrap,
  /  function normalizeViewportAccessibility\(\) \{[\s\S]*?\n  \}\n\n  function installLayoutContract\(\) \{[\s\S]*?\n  \}\n\n  normalizeViewportAccessibility\(\);\n  installLayoutContract\(\);\n\n/,
  '',
  'bootstrap compatibility functions',
);
bootstrap = bootstrap
  .replace('../css/features/state-feedback.css', '../css/components/feedback.css')
  .replace('../css/features/responsive-accessibility.css', '../css/utilities/accessibility.css');

if (/maximum-scale\s*=\s*1|user-scalable\s*=\s*no/i.test(index)) {
  throw new Error('viewport zoom restriction remains after migration');
}
if (/\bui-dialog-kicker\b/.test(index)) throw new Error('dialog kicker remains after migration');
if (/\bcreate-toolbar-divider\b/.test(index)) throw new Error('create toolbar divider remains after migration');
if (/max-width:\s*1359px/.test(app)) throw new Error('legacy compact breakpoint remains after migration');
if (/LEGACY_COMPACT_QUERY|installLayoutContract|normalizeViewportAccessibility/.test(bootstrap)) {
  throw new Error('bootstrap compatibility shim remains after migration');
}

fs.writeFileSync(indexPath, index, 'utf8');
fs.writeFileSync(appPath, app, 'utf8');
fs.writeFileSync(bootstrapPath, bootstrap, 'utf8');
console.log('Finalized UI v2 static markup, bootstrap, and breakpoint contract.');
