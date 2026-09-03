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

const commandIcons = Object.freeze({
  multiBorderEditBtn: 'boundary-edit',
  annexTerritoryBtn: 'transfer', mergeCountryBtn: 'merge', editBorderBtn: 'boundary-edit', editCoastBtn: 'coastline', changeCountryTypeBtn: 'type',
  reassignTerritoryShapeBtn: 'boundary-edit', mergeTerritoryBtn: 'merge', splitTerritoryBtn: 'split', transferTerritoryBtn: 'transfer', changeTerritoryTypeBtn: 'type', promoteTerritoryBtn: 'country', removeTerritoryDivisionBtn: 'merge',
  reassignAdministrativeShapeBtn: 'boundary-edit', reconcileAdministrativeCoastBtn: 'coastline', mergeAdministrativeBtn: 'merge', splitAdministrativeBtn: 'split', transferAdministrativeBtn: 'transfer', changeAdministrativeTypeBtn: 'type', promoteAdministrativeBtn: 'country', removeAdministrativeDivisionBtn: 'merge',
  reassignRegionShapeBtn: 'boundary-edit', mergeRegionBtn: 'merge', transferRegionBtn: 'transfer',
  addTerritorialDistributionBtn: 'plus', addGeometryDistributionBtn: 'boundary-edit', editGenericFeatureBoundaryBtn: 'boundary-edit', mergeGenericFeatureBtn: 'merge', splitGenericFeatureBtn: 'split', syncGenericFeatureCoastBtn: 'coastline', editGenericFeatureCoastBtn: 'coastline', applyGenericFeatureToCountryBtn: 'transfer', promoteGenericFeatureToCountryBtn: 'country',
});

function replaceRequired(source, pattern, replacement, label, { min = 1 } = {}) {
  const matches = source.match(pattern);
  const count = matches?.length || 0;
  if (count < min) throw new Error(`${label}: expected at least ${min} match(es), found ${count}`);
  return source.replace(pattern, replacement);
}

function replaceNestedButtonLabel(source, id, text) {
  const pattern = new RegExp(`(<button\\b[^>]*\\bid=["']${id}["'][^>]*>[\\s\\S]*?<(?:span|strong)\\b[^>]*>)([^<]*)(</(?:span|strong)>)`);
  return pattern.test(source) ? source.replace(pattern, `$1${text}$3`) : source;
}

function replaceSimpleElementText(source, id, text) {
  const pattern = new RegExp(`(<([a-z][\\w-]*)\\b[^>]*\\bid=["']${id}["'][^>]*>)([^<]*)(</\\2>)`, 'i');
  return pattern.test(source) ? source.replace(pattern, `$1${text}$4`) : source;
}

function addClassToOpeningTag(tag, className) {
  if (new RegExp(`\\b${className}\\b`).test(tag)) return tag;
  if (/\bclass=["'][^"']*["']/.test(tag)) return tag.replace(/\bclass=(["'])([^"']*)\1/, (_, q, classes) => `class=${q}${`${classes} ${className}`.trim()}${q}`);
  return tag.replace(/>$/, ` class="${className}">`);
}

function bakeCommandRows(source) {
  let next = source;
  for (const [id, symbol] of Object.entries(commandIcons)) {
    const pattern = new RegExp(`(<button\\b[^>]*\\bid=["']${id}["'][^>]*>)([\\s\\S]*?)(</button>)`);
    const match = next.match(pattern);
    if (!match) continue;
    const opening = addClassToOpeningTag(match[1], 'has-command-row-icon');
    let body = match[2];
    if (!/\bcommand-row-icon\b/.test(body)) body = `<svg class="ui-icon command-row-icon" viewBox="0 0 24 24" aria-hidden="true"><use href="#icon-${symbol}"/></svg>${body}`;
    next = next.replace(pattern, `${opening}${body}${match[3]}`);
  }
  return next;
}

function bakeMapWorkflowShell(source) {
  return source.replace(/<section\s+id="modeEditingHud"\s+class="([^"]*)"\s+role="region"\s+(?:aria-label="[^"]*"|aria-labelledby="modeTaskName")>/, (_, classes) => `<section id="modeEditingHud" class="${classes.includes('workflow-map-session') ? classes : `${classes} workflow-map-session`}" role="region" aria-labelledby="modeTaskName">`);
}

function bakeGisSteppers(source) {
  let next = source;
  if (!next.includes('gis-stepper--5')) next = next.replace(/(<form id="gisImportForm")/, '<ol class="gis-stepper gis-stepper--5" aria-label="진행 단계"><li data-step-number="1" class="is-current" aria-current="step">파일</li><li data-step-number="2">종류</li><li data-step-number="3">속성</li><li data-step-number="4">적용</li><li data-step-number="5">확인</li></ol>\n      $1');
  if (!next.includes('gis-stepper--2')) next = next.replace(/(<form id="gisExportForm")/, '<ol class="gis-stepper gis-stepper--2" aria-label="진행 단계"><li data-step-number="1" class="is-current" aria-current="step">데이터</li><li data-step-number="2">형식</li></ol>\n      $1');
  return next;
}

function bakeGisExportFormat(source) {
  if (source.includes('gis-export-format-list')) return source;
  return source.replace(/<label class="ui-field field-group"><span>파일 형식<\/span><select id="gisExportFormat">([\s\S]*?)<\/select><\/label>/, '<label class="ui-field field-group gis-export-format-field"><span>파일 형식</span><select id="gisExportFormat" class="gis-export-format-native">$1</select></label><div class="gis-export-format-list" role="radiogroup" aria-label="파일 형식"><label class="gis-export-format-option"><input type="radio" name="gisExportFormatPresentation" value="gpkg" checked /><span class="gis-export-format-copy"><strong>GIS용 GeoPackage</strong><small>하나의 GIS 패키지 파일로 저장합니다.</small></span></label><label class="gis-export-format-option"><input type="radio" name="gisExportFormatPresentation" value="geojson-zip" /><span class="gis-export-format-copy"><strong>GeoJSON 묶음 (.zip)</strong><small>레이어별 GeoJSON을 ZIP 파일로 저장합니다.</small></span></label></div>');
}

function removeEditorEdgeDom(source) {
  return source.replace(/\s*<div class="editor-edge-slot">[\s\S]*?<\/div>\s*(?=<div class="ui-toolbar ui-floating-surface ui-floating-toolbar mobile-zoom-dock")/, '\n\n        ');
}

function removeEditorEdgeAppReferences(source) {
  let next = source.replace(/, 'togglePanelBtn', 'rightPanel'/, ", 'rightPanel'");
  next = next.replace(/\n  function toggleEditorPanel\(\) \{\n    toggleSurface\('editor', document\.activeElement\);\n  \}\n/, '\n');
  next = next.replace(/\n    \$\('togglePanelBtn'\)\.addEventListener\('click', toggleEditorPanel\);/, '');
  next = next.replace(/  function syncEditorPanelControls\(\) \{\n    const edge = \$\('togglePanelBtn'\);[\s\S]*?    if \(edge\) edge\.dataset\.tooltip = edgeLabel;\n    const headerToggle =/, '  function syncEditorPanelControls() {\n    const headerToggle =');
  return next;
}

index = replaceRequired(index, /<meta\s+name=["']viewport["']\s+content=["'][^"']*["']\s*\/?>/i, '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />', 'viewport meta');
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
index = index.replace(/(<[^>]+\bid=["']projectionControl["'][^>]*\baria-label=["'])[^"']*(["'][^>]*>)/i, '$1투영법$2');
index = index.replace(/(<button\b[^>]*\bid=["']saveProjectBtn["'][^>]*\bclass=["'])([^"']*)(["'])/i, (_, before, classes, after) => `${before}${classes.includes('ghost') ? classes : `${classes} ghost`.trim()}${after}`);
index = bakeCommandRows(index);
index = bakeMapWorkflowShell(index);
index = bakeGisSteppers(index);
index = bakeGisExportFormat(index);
index = removeEditorEdgeDom(index);

const legacyCompact = /\(min-width: 800px\) and \(max-width: 1359px\)/g;
if (legacyCompact.test(app)) app = app.replace(legacyCompact, '(min-width: 800px) and (max-width: 1199px)');
else if (!/\(min-width: 800px\) and \(max-width: 1199px\)/.test(app)) throw new Error('canonical compact breakpoint is missing');
app = removeEditorEdgeAppReferences(app);

const bootstrapLegacyConstants = /  const LEGACY_COMPACT_QUERY = '[^']+';\n  const CANONICAL_COMPACT_QUERY = '[^']+';\n/;
if (bootstrapLegacyConstants.test(bootstrap)) bootstrap = bootstrap.replace(bootstrapLegacyConstants, '');
const bootstrapCompatibilityFunctions = /  function normalizeViewportAccessibility\(\) \{[\s\S]*?\n  \}\n\n  function installLayoutContract\(\) \{[\s\S]*?\n  \}\n\n  normalizeViewportAccessibility\(\);\n  installLayoutContract\(\);\n\n/;
if (bootstrapCompatibilityFunctions.test(bootstrap)) bootstrap = bootstrap.replace(bootstrapCompatibilityFunctions, '');
const styleMoves = Object.freeze([
  ['../css/features/editor-shell.css', '../css/components/editor-shell.css'], ['../css/features/edit-workflow.css', '../css/components/edit-workflow.css'], ['../css/features/map-create-panel.css', '../css/components/map-create-panel.css'], ['../css/features/library-gis-file.css', '../css/components/library-gis-file.css'], ['../css/features/mobile-sheets.css', '../css/components/mobile-sheets.css'], ['../css/features/state-feedback.css', '../css/components/feedback.css'], ['../css/features/responsive-accessibility.css', '../css/utilities/accessibility.css'],
]);
for (const [legacyPath, canonicalPath] of styleMoves) bootstrap = bootstrap.replace(legacyPath, canonicalPath);

if (/maximum-scale\s*=\s*1|user-scalable\s*=\s*no/i.test(index)) throw new Error('viewport zoom restriction remains after migration');
if (/\bui-dialog-kicker\b/.test(index)) throw new Error('dialog kicker remains after migration');
if (/\bcreate-toolbar-divider\b/.test(index)) throw new Error('create toolbar divider remains after migration');
if (/\beditor-edge-slot\b|\bid="togglePanelBtn"/.test(index)) throw new Error('retired editor edge control remains after migration');
if (!index.includes('gis-stepper--5') || !index.includes('gis-stepper--2')) throw new Error('static GIS steppers are missing');
if (!index.includes('gis-export-format-list')) throw new Error('static GIS export format list is missing');
if (/max-width:\s*1359px/.test(app)) throw new Error('legacy compact breakpoint remains after migration');
if (/togglePanelBtn|toggleEditorPanel/.test(app)) throw new Error('retired editor edge JS remains after migration');
if (/LEGACY_COMPACT_QUERY|installLayoutContract|normalizeViewportAccessibility/.test(bootstrap)) throw new Error('bootstrap compatibility shim remains after migration');
for (const [, canonicalPath] of styleMoves) if (!bootstrap.includes(canonicalPath)) throw new Error(`canonical stylesheet is not loaded: ${canonicalPath}`);

fs.writeFileSync(indexPath, index, 'utf8');
fs.writeFileSync(appPath, app, 'utf8');
fs.writeFileSync(bootstrapPath, bootstrap, 'utf8');
console.log('Finalized UI v2 static markup, command rows, GIS controls, editor shell, and stylesheet ownership.');
