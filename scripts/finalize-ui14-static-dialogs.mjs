import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const indexPath = path.join(root, 'index.html');
let html = fs.readFileSync(indexPath, 'utf8');

function addClassById(source, id, className) {
  const pattern = new RegExp(`(<[a-z][\\w-]*\\b[^>]*\\bid=["']${id}["'][^>]*\\bclass=["'])([^"']*)(["'][^>]*>)`, 'i');
  return source.replace(pattern, (_, before, classes, after) => `${before}${classes.split(/\\s+/).includes(className) ? classes : `${classes} ${className}`.trim()}${after}`);
}

function addClassesToExact(source, exactClasses, additions) {
  const pattern = new RegExp(`class=["']${exactClasses.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`);
  return source.replace(pattern, match => {
    const quote = match.includes('"') ? '"' : "'";
    const classes = [...new Set([...exactClasses.split(/\s+/), ...additions])].join(' ');
    return `class=${quote}${classes}${quote}`;
  });
}

function addDescribedBy(source, id, describedBy) {
  const pattern = new RegExp(`(<div\\b[^>]*\\bid=["']${id}["'][^>]*)(>)`, 'i');
  return source.replace(pattern, (match, opening, close) => opening.includes('aria-describedby=') ? match : `${opening} aria-describedby="${describedBy}"${close}`);
}

function prependIconBeforeHeading(source, headingId, symbol, semanticClass = 'workflow-dialog-icon') {
  if (new RegExp(`class=["'][^"']*${semanticClass}[^"']*["'][\\s\\S]*?<h2 id=["']${headingId}["']`).test(source)) return source;
  return source.replace(
    new RegExp(`(<h2 id=["']${headingId}["'][^>]*>)`),
    `<svg class="ui-icon ${semanticClass}" viewBox="0 0 24 24" aria-hidden="true"><use href="#icon-${symbol}"/></svg>$1`,
  );
}

function appendButtonHelp(source, id, detail) {
  const pattern = new RegExp(`(<button\\b[^>]*\\bid=["']${id}["'][^>]*>)([\\s\\S]*?)(</button>)`);
  const match = source.match(pattern);
  if (!match || /workflow-option-detail/.test(match[2])) return source;
  return source.replace(pattern, `${match[1]}${match[2]}<span class="workflow-option-detail">${detail}</span>${match[3]}`);
}

html = addDescribedBy(html, 'territorialTypeModal', 'territorialTypeContext');
html = addDescribedBy(html, 'confirmModal', 'confirmModalMessage');
html = addDescribedBy(html, 'coastReconciliationModal', 'coastReconciliationMessage');

html = addClassesToExact(html, 'ui-dialog-card ui-workflow-shell confirm-modal-card territorial-type-card', ['workflow-dialog-card', 'workflow-dialog--standard']);
html = addClassesToExact(html, 'confirm-modal-card', ['workflow-dialog-card', 'workflow-dialog--compact']);
html = addClassesToExact(html, 'confirm-modal-card coast-reconciliation-card', ['workflow-dialog-card', 'workflow-dialog--wide', 'workflow-dialog--decision']);
html = addClassesToExact(html, 'ui-dialog-card ui-workflow-shell historical-library-card ui-scroll-surface', ['library-workflow-card']);

html = addClassById(html, 'territorialTypeTitle', 'workflow-dialog-title');
html = addClassById(html, 'confirmModalTitle', 'workflow-dialog-title');
html = addClassById(html, 'coastReconciliationTitle', 'workflow-dialog-title');
html = addClassById(html, 'confirmModalChoiceRow', 'workflow-choice-row');
html = addClassById(html, 'coastReconciliationCountryBtn', 'workflow-decision-option');
html = addClassById(html, 'coastReconciliationAdminBtn', 'workflow-decision-option');
html = addClassById(html, 'coastReconciliationIndependentBtn', 'workflow-decision-option');
html = addClassById(html, 'coastReconciliationCancelBtn', 'workflow-decision-cancel');

html = prependIconBeforeHeading(html, 'territorialTypeTitle', 'type');
html = prependIconBeforeHeading(html, 'confirmModalTitle', 'check');
html = prependIconBeforeHeading(html, 'coastReconciliationTitle', 'coastline');

if (!html.includes('library-dialog-icon')) {
  html = html.replace(
    /(<header class="ui-dialog-header">\s*)(<div><h2 id="historicalLibraryTitle">)/,
    '$1<svg class="ui-icon library-dialog-icon" viewBox="0 0 24 24" aria-hidden="true"><use href="#icon-library"/></svg>$2',
  );
}

html = appendButtonHelp(html, 'coastReconciliationCountryBtn', '국가 해안선을 기준으로 가져온 영역을 맞춥니다.');
html = appendButtonHelp(html, 'coastReconciliationAdminBtn', '가져온 영역의 해안선을 기준으로 국가 쪽을 맞춥니다.');
html = appendButtonHelp(html, 'coastReconciliationIndependentBtn', '두 형상을 변경하지 않고 독립적으로 유지합니다.');

html = html.replace(
  /class="confirm-modal-actions ui-dialog-actions"/g,
  'class="confirm-modal-actions ui-dialog-actions workflow-dialog-actions"',
);
html = html.replace(
  /class="confirm-modal-actions coast-reconciliation-actions"/g,
  'class="confirm-modal-actions coast-reconciliation-actions workflow-dialog-actions"',
);
html = html.replace(
  /class="confirm-modal-actions"/g,
  'class="confirm-modal-actions workflow-dialog-actions"',
);
html = html.replace(
  /(<[^>]+\bid="historicalLibraryPreview"[^>]+\bclass=")([^"]*)(")/,
  (_, before, classes, after) => `${before}${classes.split(/\s+/).filter(name => name !== 'ui-card').join(' ')}${after}`,
);

for (const required of [
  'workflow-dialog--standard',
  'workflow-dialog--compact',
  'workflow-dialog--wide',
  'workflow-dialog--decision',
  'library-workflow-card',
  'library-dialog-icon',
  'workflow-option-detail',
]) {
  if (!html.includes(required)) throw new Error(`static dialog convergence missing: ${required}`);
}

fs.writeFileSync(indexPath, html, 'utf8');
console.log('Finalized static workflow dialogs and library presentation.');
