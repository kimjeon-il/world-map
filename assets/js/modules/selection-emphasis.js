export const SELECTION_STYLE = {
  color: '#346733',
  primaryWidth: 2.5,
  primaryAlpha: 1.0,
  secondaryWidth: 1.5,
  secondaryAlpha: 0.72,
};

export function setSelectionColor(color) {
  const value = String(color || '').trim();
  if (/^#[0-9a-f]{6}$/i.test(value)) SELECTION_STYLE.color = value.toLowerCase();
  return SELECTION_STYLE.color;
}

const DEGREES_TO_RADIANS = Math.PI / 180;

function selectionColorRgb() {
  const match = /^#([0-9a-f]{6})$/i.exec(SELECTION_STYLE.color);
  if (!match) return [0, 0, 0];
  const value = Number.parseInt(match[1], 16);
  return [(value >> 16 & 255) / 255, (value >> 8 & 255) / 255, (value & 255) / 255];
}

function polygonSets(geometry) {
  if (geometry?.type === 'Polygon') return [geometry.coordinates || []];
  if (geometry?.type === 'MultiPolygon') return geometry.coordinates || [];
  return [];
}

function addSegment(segments, start, end) {
  if (!Array.isArray(start) || !Array.isArray(end) || start.length < 2 || end.length < 2) return;
  const startLon = Number(start[0]);
  const endLon = Number(end[0]);
  if (!Number.isFinite(startLon) || !Number.isFinite(endLon) || Math.abs(startLon - endLon) > 180) return;
  segments.push([start.slice(0, 2), end.slice(0, 2)]);
}

export function buildSelectionBoundarySegments(geometry) {
  const segments = [];
  for (const polygon of polygonSets(geometry)) {
    for (const ring of polygon || []) {
      for (let index = 0; index < ring.length - 1; index += 1) addSegment(segments, ring[index], ring[index + 1]);
    }
  }
  if (geometry?.type === 'LineString') {
    const coordinates = geometry.coordinates || [];
    for (let index = 0; index < coordinates.length - 1; index += 1) addSegment(segments, coordinates[index], coordinates[index + 1]);
  }
  if (geometry?.type === 'MultiLineString') {
    for (const line of geometry.coordinates || []) {
      for (let index = 0; index < line.length - 1; index += 1) addSegment(segments, line[index], line[index + 1]);
    }
  }
  return segments;
}

function ribbonVerticesForSegments(segments) {
  const values = [];
  for (const [[startLon, startLat], [endLon, endLat]] of segments) {
    // Endpoint extension overlaps adjacent quads, keeping joins continuous
    // without CPU screen-space work on pan/zoom frames.
    values.push(
      startLon, startLat, endLon, endLat, -1, 0,
      startLon, startLat, endLon, endLat, 1, 0,
      endLon, endLat, startLon, startLat, -1, 1,
      endLon, endLat, startLon, startLat, -1, 1,
      startLon, startLat, endLon, endLat, 1, 0,
      endLon, endLat, startLon, startLat, 1, 1,
    );
  }
  return values;
}

export function buildSelectionRibbonVertices(geometry) {
  return ribbonVerticesForSegments(buildSelectionBoundarySegments(geometry));
}

export function buildSelectionPointCoordinates(geometry) {
  if (geometry?.type === 'Point' && Array.isArray(geometry.coordinates)) return [geometry.coordinates.slice(0, 2)];
  return [];
}

export function createSelectionEmphasisRenderer({ canvas, projectionForView, getSize, getDpr } = {}) {
  let gl = null;
  let program = null;
  let primaryBuffer = null;
  let secondaryBuffer = null;
  let primaryPointBuffer = null;
  let secondaryPointBuffer = null;
  let primaryCount = 0;
  let secondaryCount = 0;
  let primarySegmentCount = 0;
  let secondarySegmentCount = 0;
  let primaryPointCount = 0;
  let secondaryPointCount = 0;
  let items = { primary: [], secondary: [] };
  let geometryRevision = -1;
  let bufferBuildCount = 0;
  let bufferBuildMs = 0;
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
    const webgl2 = typeof globalThis.WebGL2RenderingContext !== 'undefined' && gl instanceof globalThis.WebGL2RenderingContext;
    const vertex = webgl2 ? `#version 300 es
      precision highp float;
      layout(location=0) in vec2 aStart;
      layout(location=1) in vec2 aEnd;
      layout(location=2) in float aSide;
      layout(location=3) in float aEndpoint;
      uniform vec2 uViewport; uniform vec2 uTranslate; uniform float uScale;
      uniform vec3 uRowX; uniform vec3 uRowY; uniform vec3 uRowZ; uniform vec2 uFlatCenter;
      uniform float uWorldOffset; uniform int uMode; uniform float uHalfWidth; uniform float uDpr;
      out float vDepth;
      vec3 project(vec2 coord) {
        float lon=coord.x*0.017453292519943; float lat=coord.y*0.017453292519943; vec2 p; float depth;
        if(uMode==0){ vec3 q=vec3(cos(lat)*cos(lon),cos(lat)*sin(lon),sin(lat)); p=uTranslate+uScale*vec2(dot(uRowX,q),dot(uRowY,q)); depth=dot(uRowZ,q); }
        else { p=uTranslate+uScale*vec2(lon+uWorldOffset-uFlatCenter.x,-(lat-uFlatCenter.y)); depth=1.0; }
        return vec3(p, depth);
      }
      void main(){
        vec3 start=project(aStart); vec3 end=project(aEnd); vec2 direction=end.xy-start.xy;
        float lengthPx=max(length(direction),0.0001); direction/=lengthPx;
        vec2 normal=vec2(-direction.y,direction.x);
        vec2 center=mix(start.xy,end.xy,aEndpoint)+direction*((aEndpoint<0.5)?-uHalfWidth:uHalfWidth);
        vec2 p=center+normal*aSide*uHalfWidth;
        vDepth=mix(start.z,end.z,aEndpoint);
        gl_Position=vec4(p.x*2.0/uViewport.x-1.0,1.0-p.y*2.0/uViewport.y,0.0,1.0);
        gl_PointSize=6.0*uDpr;
      }`
      : `precision highp float;
      attribute vec2 aStart; attribute vec2 aEnd; attribute float aSide; attribute float aEndpoint;
      uniform vec2 uViewport; uniform vec2 uTranslate; uniform float uScale;
      uniform vec3 uRowX; uniform vec3 uRowY; uniform vec3 uRowZ; uniform vec2 uFlatCenter;
      uniform float uWorldOffset; uniform int uMode; uniform float uHalfWidth; uniform float uDpr;
      varying float vDepth;
      vec3 project(vec2 coord) {
        float lon=coord.x*0.017453292519943; float lat=coord.y*0.017453292519943; vec2 p; float depth;
        if(uMode==0){ vec3 q=vec3(cos(lat)*cos(lon),cos(lat)*sin(lon),sin(lat)); p=uTranslate+uScale*vec2(dot(uRowX,q),dot(uRowY,q)); depth=dot(uRowZ,q); }
        else { p=uTranslate+uScale*vec2(lon+uWorldOffset-uFlatCenter.x,-(lat-uFlatCenter.y)); depth=1.0; }
        return vec3(p, depth);
      }
      void main(){
        vec3 start=project(aStart); vec3 end=project(aEnd); vec2 direction=end.xy-start.xy;
        float lengthPx=max(length(direction),0.0001); direction/=lengthPx;
        vec2 normal=vec2(-direction.y,direction.x);
        vec2 center=mix(start.xy,end.xy,aEndpoint)+direction*((aEndpoint<0.5)?-uHalfWidth:uHalfWidth);
        vec2 p=center+normal*aSide*uHalfWidth;
        vDepth=mix(start.z,end.z,aEndpoint);
        gl_Position=vec4(p.x*2.0/uViewport.x-1.0,1.0-p.y*2.0/uViewport.y,0.0,1.0);
        gl_PointSize=6.0*uDpr;
      }`;
    const fragment = webgl2 ? `#version 300 es
      precision mediump float; uniform vec4 uColor; uniform int uMode; in float vDepth; out vec4 outColor;
      void main(){if(uMode==0&&vDepth<0.0)discard;outColor=uColor;}`
      : `precision mediump float; uniform vec4 uColor; uniform int uMode; varying float vDepth;
      void main(){if(uMode==0&&vDepth<0.0)discard;gl_FragColor=uColor;}`;
    const vs = compile(gl.VERTEX_SHADER, vertex);
    const fs = compile(gl.FRAGMENT_SHADER, fragment);
    program = gl.createProgram(); gl.attachShader(program, vs); gl.attachShader(program, fs); gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || 'selection shader link failed');
    primaryBuffer = gl.createBuffer(); secondaryBuffer = gl.createBuffer();
    primaryPointBuffer = gl.createBuffer(); secondaryPointBuffer = gl.createBuffer();
    available = true;
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
    let segmentCount = 0;
    for (const item of nextItems) for (const geometry of flattenGeometry(item.geometry)) {
      const segments = buildSelectionBoundarySegments(geometry);
      segmentCount += segments.length;
      values.push(...ribbonVerticesForSegments(segments));
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(values), gl.STATIC_DRAW);
    return { vertexCount: values.length / 6, segmentCount };
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
    const started = performance.now();
    const primaryData = updateBuffer(primaryBuffer, items.primary);
    const secondaryData = updateBuffer(secondaryBuffer, items.secondary);
    primaryCount = primaryData.vertexCount;
    secondaryCount = secondaryData.vertexCount;
    primarySegmentCount = primaryData.segmentCount;
    secondarySegmentCount = secondaryData.segmentCount;
    primaryPointCount = updatePointBuffer(primaryPointBuffer, items.primary);
    secondaryPointCount = updatePointBuffer(secondaryPointBuffer, items.secondary);
    bufferBuildCount += 1;
    bufferBuildMs = performance.now() - started;
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

  function setRibbonAttributes() {
    const locations = [
      gl.getAttribLocation(program, 'aStart'), gl.getAttribLocation(program, 'aEnd'),
      gl.getAttribLocation(program, 'aSide'), gl.getAttribLocation(program, 'aEndpoint'),
    ];
    const stride = 6 * Float32Array.BYTES_PER_ELEMENT;
    for (const [index, location] of locations.entries()) {
      if (location < 0) continue;
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, index < 2 ? 2 : 1, gl.FLOAT, false, stride, index === 0 ? 0 : index === 1 ? 2 * Float32Array.BYTES_PER_ELEMENT : index === 2 ? 4 * Float32Array.BYTES_PER_ELEMENT : 5 * Float32Array.BYTES_PER_ELEMENT);
    }
    return locations;
  }

  function drawRibbon(buffer, count, width, alpha, viewState) {
    if (!count) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    const locations = setRibbonAttributes();
    const [red, green, blue] = selectionColorRgb();
    gl.uniform4f(gl.getUniformLocation(program, 'uColor'), red, green, blue, alpha);
    gl.uniform1f(gl.getUniformLocation(program, 'uHalfWidth'), width / 2);
    const offsets = viewState.projection === 'globe' ? [0] : [-2 * Math.PI, 0, 2 * Math.PI];
    const worldLocation = gl.getUniformLocation(program, 'uWorldOffset');
    for (const offset of offsets) { gl.uniform1f(worldLocation, offset); gl.drawArrays(gl.TRIANGLES, 0, count); }
    for (const location of locations) if (location >= 0) gl.disableVertexAttribArray(location);
  }

  function drawPoints(buffer, count, alpha) {
    if (!count) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    const location = gl.getAttribLocation(program, 'aStart');
    const endLocation = gl.getAttribLocation(program, 'aEnd');
    const sideLocation = gl.getAttribLocation(program, 'aSide');
    const endpointLocation = gl.getAttribLocation(program, 'aEndpoint');
    gl.enableVertexAttribArray(location); gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0);
    for (const attribute of [endLocation, sideLocation, endpointLocation]) if (attribute >= 0) gl.disableVertexAttribArray(attribute);
    if (endLocation >= 0) gl.vertexAttrib2f(endLocation, 0, 0);
    if (sideLocation >= 0) gl.vertexAttrib1f(sideLocation, 0);
    if (endpointLocation >= 0) gl.vertexAttrib1f(endpointLocation, 0);
    const [red, green, blue] = selectionColorRgb();
    gl.uniform4f(gl.getUniformLocation(program, 'uColor'), red, green, blue, alpha);
    gl.uniform1f(gl.getUniformLocation(program, 'uHalfWidth'), 0);
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
    gl.uniform2f(gl.getUniformLocation(program, 'uFlatCenter'), flatCenter[0] * DEGREES_TO_RADIANS, flatCenter[1] * DEGREES_TO_RADIANS); gl.uniform1i(gl.getUniformLocation(program, 'uMode'), mode);
    gl.uniform1f(gl.getUniformLocation(program, 'uDpr'), dpr);
    drawRibbon(primaryBuffer, primaryCount, SELECTION_STYLE.primaryWidth, SELECTION_STYLE.primaryAlpha, viewState);
    drawRibbon(secondaryBuffer, secondaryCount, SELECTION_STYLE.secondaryWidth, SELECTION_STYLE.secondaryAlpha, viewState);
    drawPoints(primaryPointBuffer, primaryPointCount, SELECTION_STYLE.primaryAlpha);
    drawPoints(secondaryPointBuffer, secondaryPointCount, SELECTION_STYLE.secondaryAlpha);
    gl.disable(gl.BLEND);
    return true;
  }

  function clear() {
    items = { primary: [], secondary: [] }; geometryRevision = -1;
    primaryCount = secondaryCount = primarySegmentCount = secondarySegmentCount = primaryPointCount = secondaryPointCount = 0;
    if (available) render({ projection: 'flat', size: getSize?.() || { width: 1, height: 1 }, dpr: getDpr?.() || 1 });
  }

  return Object.freeze({
    init, setSelection, render, clear, isAvailable: () => available,
    stats: () => ({
      primaryCount, secondaryCount, primarySegmentCount, secondarySegmentCount,
      segmentCount: primarySegmentCount + secondarySegmentCount,
      ribbonTriangleCount: (primaryCount + secondaryCount) / 3,
      bufferBuildCount, bufferBuildMs, geometryRevision,
    }),
  });
}
