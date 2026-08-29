export const SELECTION_STYLE = Object.freeze({
  color: '#346733',
  primaryWidth: 2.5,
  primaryAlpha: 1.0,
  secondaryWidth: 1.5,
  secondaryAlpha: 0.72,
});

function polygonSets(geometry) {
  if (geometry?.type === 'Polygon') return [geometry.coordinates || []];
  if (geometry?.type === 'MultiPolygon') return geometry.coordinates || [];
  return [];
}

export function buildSelectionBoundarySegments(geometry) {
  const segments = [];
  for (const polygon of polygonSets(geometry)) {
    for (const ring of polygon || []) {
      for (let index = 0; index < ring.length - 1; index += 1) {
        const start = ring[index];
        const end = ring[index + 1];
        if (Array.isArray(start) && Array.isArray(end) && start.length >= 2 && end.length >= 2 && Math.abs(Number(start[0]) - Number(end[0])) <= 180) segments.push([start.slice(0, 2), end.slice(0, 2)]);
      }
    }
  }
  if (geometry?.type === 'LineString') {
    for (let index = 0; index < (geometry.coordinates || []).length - 1; index += 1) {
      const start = geometry.coordinates[index]; const end = geometry.coordinates[index + 1];
      if (Math.abs(Number(start[0]) - Number(end[0])) <= 180) segments.push([start.slice(0, 2), end.slice(0, 2)]);
    }
  }
  if (geometry?.type === 'MultiLineString') {
    for (const line of geometry.coordinates || []) for (let index = 0; index < line.length - 1; index += 1) {
      if (Math.abs(Number(line[index][0]) - Number(line[index + 1][0])) <= 180) segments.push([line[index].slice(0, 2), line[index + 1].slice(0, 2)]);
    }
  }
  return segments;
}

export function buildSelectionPointCoordinates(geometry) {
  if (geometry?.type === 'Point' && Array.isArray(geometry.coordinates)) return [geometry.coordinates.slice(0, 2)];
  return [];
}

export function createSelectionEmphasisRenderer({ canvas, projectionForView, getSize, getDpr } = {}) {
  let gl = null;
  let program = null;
  let positionBuffer = null;
  let primaryBuffer = null;
  let secondaryBuffer = null;
  let primaryPointBuffer = null;
  let secondaryPointBuffer = null;
  let primaryCount = 0;
  let secondaryCount = 0;
  let primaryPointCount = 0;
  let secondaryPointCount = 0;
  let items = { primary: [], secondary: [] };
  let geometryRevision = -1;
  let available = false;

  function compile(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) || 'selection shader compile failed');
    return shader;
  }

  function init() {
    if (!canvas || !globalThis.WebGLRenderingContext) return false;
    gl = canvas.getContext('webgl2', { alpha: true, antialias: true }) || canvas.getContext('webgl', { alpha: true, antialias: true });
    if (!gl) return false;
    const webgl2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
    const vertex = webgl2 ? `#version 300 es
      precision highp float; layout(location=0) in vec2 aCoord;
      uniform vec2 uViewport; uniform vec2 uTranslate; uniform float uScale;
      uniform vec3 uRowX; uniform vec3 uRowY; uniform vec3 uRowZ; uniform vec2 uFlatCenter;
      uniform float uWorldOffset; uniform int uMode; out float vDepth;
      void main(){float lon=aCoord.x*0.017453292519943;float lat=aCoord.y*0.017453292519943;vec2 p;
      if(uMode==0){vec3 q=vec3(cos(lat)*cos(lon),cos(lat)*sin(lon),sin(lat));p=uTranslate+uScale*vec2(dot(uRowX,q),dot(uRowY,q));vDepth=dot(uRowZ,q);}
      else{p=uTranslate+uScale*vec2(lon+uWorldOffset-uFlatCenter.x,-(lat-uFlatCenter.y));vDepth=1.0;}
      gl_Position=vec4(p.x*2.0/uViewport.x-1.0,1.0-p.y*2.0/uViewport.y,0.0,1.0);gl_PointSize=6.0;}`
      : `precision highp float; attribute vec2 aCoord; uniform vec2 uViewport; uniform vec2 uTranslate; uniform float uScale;
      uniform vec3 uRowX; uniform vec3 uRowY; uniform vec3 uRowZ; uniform vec2 uFlatCenter; uniform float uWorldOffset; uniform int uMode; varying float vDepth;
      void main(){float lon=aCoord.x*0.017453292519943;float lat=aCoord.y*0.017453292519943;vec2 p;
      if(uMode==0){vec3 q=vec3(cos(lat)*cos(lon),cos(lat)*sin(lon),sin(lat));p=uTranslate+uScale*vec2(dot(uRowX,q),dot(uRowY,q));vDepth=dot(uRowZ,q);}
      else{p=uTranslate+uScale*vec2(lon+uWorldOffset-uFlatCenter.x,-(lat-uFlatCenter.y));vDepth=1.0;}
      gl_Position=vec4(p.x*2.0/uViewport.x-1.0,1.0-p.y*2.0/uViewport.y,0.0,1.0);gl_PointSize=6.0;}`;
    const fragment = webgl2 ? `#version 300 es
      precision mediump float; uniform vec4 uColor; in float vDepth; uniform int uMode; out vec4 outColor;
      void main(){if(uMode==0&&vDepth<0.0)discard;outColor=uColor;}`
      : `precision mediump float; uniform vec4 uColor; varying float vDepth; uniform int uMode;
      void main(){if(uMode==0&&vDepth<0.0)discard;gl_FragColor=uColor;}`;
    const vs = compile(gl.VERTEX_SHADER, vertex);
    const fs = compile(gl.FRAGMENT_SHADER, fragment);
    program = gl.createProgram(); gl.attachShader(program, vs); gl.attachShader(program, fs); gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || 'selection shader link failed');
    positionBuffer = gl.createBuffer(); primaryBuffer = gl.createBuffer(); secondaryBuffer = gl.createBuffer(); primaryPointBuffer = gl.createBuffer(); secondaryPointBuffer = gl.createBuffer(); available = true;
    return true;
  }

  function flattenGeometry(feature) {
    if (!feature) return [];
    if (feature.type === 'FeatureCollection') return (feature.features || []).flatMap(flattenGeometry);
    if (feature.type === 'Feature') return flattenGeometry(feature.geometry);
    return [feature];
  }

  function updateBuffer(buffer, nextItems) {
    const values = [];
    for (const item of nextItems) for (const geometry of flattenGeometry(item.geometry)) {
      for (const segment of buildSelectionBoundarySegments(geometry)) values.push(...segment[0], ...segment[1]);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(values), gl.STATIC_DRAW);
    return values.length / 2;
  }

  function updatePointBuffer(buffer, nextItems) {
    const values = [];
    for (const item of nextItems) for (const geometry of flattenGeometry(item.geometry)) {
      for (const point of buildSelectionPointCoordinates(geometry)) values.push(...point);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(values), gl.STATIC_DRAW);
    return values.length / 2;
  }

  function geometryIdentity(feature) {
    if (feature?.type === 'FeatureCollection') return (feature.features || []).map(item => item.geometry);
    if (feature?.type === 'Feature') return feature.geometry;
    return feature;
  }

  function sameItems(left = [], right = []) {
    return left.length === right.length && left.every((item, index) => {
      const other = right[index];
      const a = geometryIdentity(item.geometry);
      const b = geometryIdentity(other?.geometry);
      return item.key === other?.key && (Array.isArray(a) ? a.length === b?.length && a.every((value, childIndex) => value === b[childIndex]) : a === b);
    });
  }

  function setSelection({ primary = [], secondary = [], revision = 0 } = {}) {
    if (Number(revision) === geometryRevision && sameItems(items.primary, primary) && sameItems(items.secondary, secondary)) return false;
    items = { primary: primary.slice(), secondary: secondary.slice() };
    geometryRevision = Number(revision || 0);
    if (!available) return false;
    primaryCount = updateBuffer(primaryBuffer, items.primary);
    secondaryCount = updateBuffer(secondaryBuffer, items.secondary);
    primaryPointCount = updatePointBuffer(primaryPointBuffer, items.primary);
    secondaryPointCount = updatePointBuffer(secondaryPointBuffer, items.secondary);
    return true;
  }

  function rowsForProjection(projection) {
    const translate = projection.translate();
    const scale = projection.scale();
    const basis = [[0, 0], [90, 0], [0, 90]].map(coord => projection(coord));
    const rowX = basis.map(point => (point[0] - translate[0]) / scale);
    const rowY = basis.map(point => (point[1] - translate[1]) / scale);
    const cross = [rowX[1] * rowY[2] - rowX[2] * rowY[1], rowX[2] * rowY[0] - rowX[0] * rowY[2], rowX[0] * rowY[1] - rowX[1] * rowY[0]];
    const length = Math.hypot(...cross) || 1;
    return { rowX, rowY, rowZ: cross.map(value => -value / length) };
  }

  function draw(buffer, count, width, alpha, viewState) {
    if (!count) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    const location = gl.getAttribLocation(program, 'aCoord');
    gl.enableVertexAttribArray(location); gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0);
    gl.uniform4f(gl.getUniformLocation(program, 'uColor'), 52 / 255, 103 / 255, 51 / 255, alpha);
    gl.lineWidth(width);
    const offsets = viewState.projection === 'globe' ? [0] : [-2 * Math.PI, 0, 2 * Math.PI];
    const worldLocation = gl.getUniformLocation(program, 'uWorldOffset');
    for (const offset of offsets) { gl.uniform1f(worldLocation, offset); gl.drawArrays(gl.LINES, 0, count); }
    gl.disableVertexAttribArray(location);
  }

  function drawPoints(buffer, count, alpha, viewState) {
    if (!count) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    const location = gl.getAttribLocation(program, 'aCoord');
    gl.enableVertexAttribArray(location); gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0);
    gl.uniform4f(gl.getUniformLocation(program, 'uColor'), 52 / 255, 103 / 255, 51 / 255, alpha);
    gl.uniform1f(gl.getUniformLocation(program, 'uWorldOffset'), 0);
    gl.drawArrays(gl.POINTS, 0, count);
    gl.disableVertexAttribArray(location);
  }

  function render(viewState = {}) {
    if (!available || !canvas) return false;
    const size = getSize?.() || viewState.size || { width: 1, height: 1 };
    const dpr = Number(getDpr?.() || viewState.dpr || 1);
    const width = Math.max(1, Number(size.width || 1));
    const height = Math.max(1, Number(size.height || 1));
    const pixelWidth = Math.max(1, Math.round(width * dpr));
    const pixelHeight = Math.max(1, Math.round(height * dpr));
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) { canvas.width = pixelWidth; canvas.height = pixelHeight; }
    const projection = projectionForView?.(viewState);
    if (!projection) return false;
    const mode = viewState.projection === 'globe' ? 0 : 1;
    const rows = mode === 0 ? rowsForProjection(projection) : { rowX: [1, 0, 0], rowY: [0, 1, 0], rowZ: [0, 0, 1] };
    const translate = viewState.translate || projection.translate();
    const scale = Number(viewState.scale || projection.scale());
    const flatCenter = viewState.projectionCenter || viewState.flatCenter || [0, 0];
    gl.viewport(0, 0, pixelWidth, pixelHeight); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.useProgram(program);
    gl.uniform2f(gl.getUniformLocation(program, 'uViewport'), width, height); gl.uniform2f(gl.getUniformLocation(program, 'uTranslate'), translate[0], translate[1]);
    gl.uniform1f(gl.getUniformLocation(program, 'uScale'), scale); gl.uniform3fv(gl.getUniformLocation(program, 'uRowX'), rows.rowX); gl.uniform3fv(gl.getUniformLocation(program, 'uRowY'), rows.rowY); gl.uniform3fv(gl.getUniformLocation(program, 'uRowZ'), rows.rowZ);
    gl.uniform2f(gl.getUniformLocation(program, 'uFlatCenter'), flatCenter[0] * Math.PI / 180, flatCenter[1] * Math.PI / 180); gl.uniform1i(gl.getUniformLocation(program, 'uMode'), mode);
    draw(primaryBuffer, primaryCount, SELECTION_STYLE.primaryWidth, SELECTION_STYLE.primaryAlpha, viewState);
    draw(secondaryBuffer, secondaryCount, SELECTION_STYLE.secondaryWidth, SELECTION_STYLE.secondaryAlpha, viewState);
    drawPoints(primaryPointBuffer, primaryPointCount, SELECTION_STYLE.primaryAlpha, viewState);
    drawPoints(secondaryPointBuffer, secondaryPointCount, SELECTION_STYLE.secondaryAlpha, viewState);
    gl.disable(gl.BLEND);
    return true;
  }

  function clear() { items = { primary: [], secondary: [] }; geometryRevision = -1; primaryCount = secondaryCount = primaryPointCount = secondaryPointCount = 0; if (available) render({}); }
  return Object.freeze({ init, setSelection, render, clear, isAvailable: () => available, stats: () => ({ primaryCount, secondaryCount, segmentCount: (primaryCount + secondaryCount) / 2, geometryRevision }) });
}
