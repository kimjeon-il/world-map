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
    /(<div class="mode-task-heading">)(<strong id="modeTaskName">)/,
    '$1<svg id="modeTaskIcon" class="ui-icon mode-task-icon" viewBox="0 0 24 24" aria-hidden="true"><use href="#icon-boundary-edit"/></svg>$2',
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

app = app.replace(
  "    setActionStatus(message, state.dataReadiness === DATA_READINESS.ERROR ? 'error' : 'working', 0);",
  "    setActionStatus(message, state.dataReadiness === DATA_READINESS.ERROR ? 'error' : 'working', 2600);",
);
app = app.replace(
  "    if (detail.stage?.includes('retry') || state.geometryProgress >= 95 || state.geometryProgress % 10 === 0) {\n      setActionStatus(detail.message || `편집 데이터 준비 중 · ${Math.round(state.geometryProgress)}%`, 'working', 0);\n    }\n",
  '',
);
app = app.replace(
  "    if (detail.stage?.includes('retry')) setActionStatus(detail.message || '고화질 지도를 다시 준비하는 중입니다.', 'working', 0);\n",
  '',
);
app = app.replace(
  "    $('engineStatus').textContent = '빠른 미리보기 · 무손실 데이터 대기';\n    const detail = String(event.detail || '무손실 데이터를 준비하지 못했습니다.');\n    setActionStatus(`${detail} 미리보기 오류. 자동 재시도합니다.`, 'error', 0);",
  "    $('engineStatus').textContent = '편집 데이터 오류 · 자동 재시도 중';",
);
app = app.replace(
  "    $('engineStatus').textContent = '빠른 미리보기 · 고화질 지도 대기';\n    const detail = String(event.detail || '고화질 지도를 준비하지 못했습니다.');\n    setActionStatus(`${detail} 편집 데이터 오류. 자동 재시도합니다.`, 'error', 0);",
  "    $('engineStatus').textContent = '고화질 지도 오류 · 자동 재시도 중';",
);
app = app.replace("    setActionStatus('프로젝트 저장 준비 중…', 'working', 0);\n", '');
app = app.replace(
  "      const blob = await window.PandoLabGIS.exportGeoPackage(projectDomain.buildProject(), (_message, percent) => {\n        setActionStatus(`프로젝트 저장 중${Number.isFinite(percent) ? ` · ${Math.round(percent)}%` : ''}`, 'working', 0);\n      });",
  "      const blob = await window.PandoLabGIS.exportGeoPackage(projectDomain.buildProject(), () => undefined);",
);

surface = surface.replace(
  "      ['createMenuBtn', createOpen], ['togglePanelBtn', editorOpen],",
  "      ['createMenuBtn', createOpen],",
);

if (!index.includes('id="modeTaskIcon"')) throw new Error('mode task icon slot was not baked');
if (!index.match(/id="modeActionBar"[^>]*\bworkflow-actions\b/)) throw new Error('workflow action class missing');
if (!index.match(/id="geometryPreviewSummary"[^>]*\bworkflow-impact\b/)) throw new Error('workflow impact class missing');
if (!app.includes("nextTaskIcon.id = 'modeTaskIcon'")) throw new Error('app task icon sync missing');
if (/미리보기 오류\. 자동 재시도합니다|고화질 지도를 다시 준비하는 중입니다/.test(app)) throw new Error('persistent readiness still routes through toast');
if (/프로젝트 저장 준비 중…|프로젝트 저장 중\$\{/.test(app)) throw new Error('save progress still routes through toast');
if (/togglePanelBtn/.test(surface)) throw new Error('surface controller still references retired editor edge toggle');

fs.writeFileSync(indexPath, index, 'utf8');
fs.writeFileSync(appPath, app, 'utf8');
fs.writeFileSync(surfacePath, surface, 'utf8');
console.log('Finalized workflow icon semantics and persistent feedback routing.');
