import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const indexPath = path.join(root, 'index.html');
const appPath = path.join(root, 'assets/js/app.js');
const surfacePath = path.join(root, 'assets/js/modules/surface-controller.js');

let index = fs.readFileSync(indexPath, 'utf8');
let app = fs.readFileSync(appPath, 'utf8');
let surface = fs.readFileSync(surfacePath, 'utf8');

function addClassById(source, id, className) {
  const pattern = new RegExp(`(<[a-z][\\w-]*\\b[^>]*\\bid=["']${id}["'][^>]*\\bclass=["'])([^"']*)(["'][^>]*>)`, 'i');
  return source.replace(pattern, (_, before, classes, after) => `${before}${classes.split(/\\s+/).includes(className) ? classes : `${classes} ${className}`.trim()}${after}`);
}

if (!index.includes('id="modeTaskIcon"')) {
  index = index.replace(
    '<div class="mode-task-heading">\n                    <strong id="modeTaskName">',
    '<div class="mode-task-heading">\n                    <svg id="modeTaskIcon" class="ui-icon mode-task-icon" viewBox="0 0 24 24" aria-hidden="true"><use href="#icon-boundary-edit"/></svg>\n                    <strong id="modeTaskName">',
  );
}
index = addClassById(index, 'modeActionBar', 'workflow-actions');
index = addClassById(index, 'geometryPreviewSummary', 'workflow-impact');

if (!app.includes("nextTaskIcon.id = 'modeTaskIcon'")) {
  const anchor = "    if ($('modeTaskName')) $('modeTaskName').textContent = task.name;\n    if ($('modeTaskStage')) $('modeTaskStage').textContent = task.stage;";
  const replacement = `${anchor}\n    const currentTaskIcon = $('modeTaskIcon');\n    if (currentTaskIcon && task.icon) {\n      const nextTaskIcon = createSemanticIcon(document, task.icon, 'ui-icon mode-task-icon');\n      nextTaskIcon.id = 'modeTaskIcon';\n      currentTaskIcon.replaceWith(nextTaskIcon);\n    }`;
  if (!app.includes(anchor)) throw new Error('mode task render anchor not found');
  app = app.replace(anchor, replacement);
}

surface = surface.replace(
  "      ['createMenuBtn', createOpen], ['togglePanelBtn', editorOpen],",
  "      ['createMenuBtn', createOpen],",
);

if (!index.includes('id="modeTaskIcon"')) throw new Error('mode task icon slot was not baked');
if (!index.match(/id="modeActionBar"[^>]*\bworkflow-actions\b/)) throw new Error('workflow action class missing');
if (!index.match(/id="geometryPreviewSummary"[^>]*\bworkflow-impact\b/)) throw new Error('workflow impact class missing');
if (!app.includes("nextTaskIcon.id = 'modeTaskIcon'")) throw new Error('app task icon sync missing');
if (/togglePanelBtn/.test(surface)) throw new Error('surface controller still references retired editor edge toggle');

fs.writeFileSync(indexPath, index, 'utf8');
fs.writeFileSync(appPath, app, 'utf8');
fs.writeFileSync(surfacePath, surface, 'utf8');
console.log('Finalized explicit workflow icon semantics and retired edge references.');
