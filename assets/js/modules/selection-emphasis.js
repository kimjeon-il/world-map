import { buildRenderableBoundarySegments, densifyBoundarySegmentsForProjection } from './geographic-boundary.js';

export const SELECTION_STYLE = {
  color: '#cda95d',
  primaryWidth: 2.5,
  primaryAlpha: 1.0,
  secondaryWidth: 1.5,
  secondaryAlpha: 0.72,
};

let interactionStyle = Object.freeze({
  hover: Object.freeze({ color: '#d7ba7d', width: 1.5, alpha: 1, fillAlpha: 0.05775 }),
  selection: Object.freeze({
    color: '#cda95d', casingColor: '#f2f4f6',
    primary: Object.freeze({ innerWidth: 2.5, innerAlpha: 1, outerWidth: 4, casingAlpha: 0.72, fillAlpha: 0.13 }),
    secondary: Object.freeze({ innerWidth: 1.5, innerAlpha: 0.72, outerWidth: 2.8, casingAlpha: 0.48, fillAlpha: 0.08 }),
  }),
});

export function setInteractionStyle(nextStyle) {
  if (!nextStyle?.hover || !nextStyle?.selection) return interactionStyle;
  interactionStyle = nextStyle;
  SELECTION_STYLE.color = nextStyle.selection.color;
  SELECTION_STYLE.primaryWidth = nextStyle.selection.primary.innerWidth;
  SELECTION_STYLE.primaryAlpha = nextStyle.selection.primary.innerAlpha;
  SELECTION_STYLE.secondaryWidth = nextStyle.selection.secondary.innerWidth;
  SELECTION_STYLE.secondaryAlpha = nextStyle.selection.secondary.innerAlpha;
  return interactionStyle;
}

export function setSelectionColor(color) {
  const value = String(color || '').trim();
  if (/^#[0-9a-f]{6}$/i.test(value)) SELECTION_STYLE.color = value.toLowerCase();
  return SELECTION_STYLE.color;
}

const DEGREES_TO_RADIANS = Math.PI / 180;
const RIBBON_VERTEX_SCALAR_COUNT = 6;
const RIBBON_SEGMENT_SCALAR_COUNT = RIBBON_VERTEX_SCALAR_COUNT * 6;
const RIBBON_MIN_SEGMENT_LENGTH_DEGREES = 1e-12;
const RIBBON_SIDE_PATTERN = Object.freeze([-1, 1, -1, -1, 1, 1]);
const RIBBON_ENDPOINT_PATTERN = Object.freeze([0, 0, 1, 1, 0, 1]);

export function buildSelectionBoundarySegments(geometry, { densify = false } = {}) {
  const segments = buildRenderableBoundarySegments(geometry);
  return densify ? densifyBoundarySegmentsForProjection(segments) : segments;
}

function colorRgb(value) {
  const match = /^#([0-9a-f]{6})$/i.exec(String(value || ''));
  if (!match) return [0, 0, 0];
  const packed = Number.parseInt(match[1], 16);
  return [(packed >> 16 & 255) / 255, (packed >> 8 & 255) / 255, (packed & 255) / 255];
}

function appendRibbonSegment(values, startLon, startLat, endLon, endLat) {
  const coordinates = [startLon, startLat, endLon, endLat].map(Number);
  if (!coordinates.every(Number.isFinite)) return false;
  const [safeStartLon, safeStartLat, safeEndLon, safeEndLat] = coordinates;
  if (Math.hypot(safeEndLon - safeStartLon, safeEndLat - safeStartLat) <= RIBBON_MIN_SEGMENT_LENGTH_DEGREES) return false;
  // Every vertex keeps the same start/end order. The shader selects the cap
  // with aEndpoint; reversing the coordinates here collapses both triangles.
  values.push(
    safeStartLon, safeStartLat, safeEndLon, safeEndLat, -1, 0,
    safeStartLon, safeStartLat, safeEndLon, safeEndLat, 1, 0,
    safeStartLon, safeStartLat, safeEndLon, safeEndLat, -1, 1,
    safeStartLon, safeStartLat, safeEndLon, safeEndLat, -1, 1,
    safeStartLon, safeStartLat, safeEndLon, safeEndLat, 1, 0,
    safeStartLon, safeStartLat, safeEndLon, safeEndLat, 1, 1,
  );
  return true;
}

function ribbonVerticesForSegments(segments) {
  const values = [];
  for (const [[startLon, startLat], [endLon, endLat]] of segments) appendRibbonSegment(values, startLon, startLat, endLon, endLat);
  return values;
}

export function validateSelectionRibbonVertices(vertices, expectedSegmentCount = null) {
  const values = Array.from(vertices || []);
  if (!values.length) return { valid: false, segmentCount: 0, reason: 'empty-ribbon' };
  if (values.length % RIBBON_SEGMENT_SCALAR_COUNT !== 0) {
    return { valid: false, segmentCount: 0, reason: 'invalid-ribbon-length' };
  }
  if (!values.every(value => Number.isFinite(Number(value)))) {
    return { valid: false, segmentCount: 0, reason: 'non-finite-ribbon-value' };
  }
  const segmentCount = values.length / RIBBON_SEGMENT_SCALAR_COUNT;
  if (expectedSegmentCount != null && Number(expectedSegmentCount) !== segmentCount) {
    return { valid: false, segmentCount: 0, reason: 'segment-count-mismatch' };
  }
  for (let segmentOffset = 0; segmentOffset < values.length; segmentOffset += RIBBON_SEGMENT_SCALAR_COUNT) {
    const startLon = Number(values[segmentOffset]);
    const startLat = Number(values[segmentOffset + 1]);
    const endLon = Number(values[segmentOffset + 2]);
    const endLat = Number(values[segmentOffset + 3]);
    if (Math.hypot(endLon - startLon, endLat - startLat) <= RIBBON_MIN_SEGMENT_LENGTH_DEGREES) {
      return { valid: false, segmentCount: 0, reason: 'zero-length-ribbon-segment' };
    }
    for (let vertex = 0; vertex < 6; vertex += 1) {
      const offset = segmentOffset + vertex * RIBBON_VERTEX_SCALAR_COUNT;
      if (Number(values[offset]) !== startLon || Number(values[offset + 1]) !== startLat
        || Number(values[offset + 2]) !== endLon || Number(values[offset + 3]) !== endLat) {
        return { valid: false, segmentCount: 0, reason: 'inconsistent-ribbon-endpoints' };
      }
      if (Number(values[offset + 4]) !== RIBBON_SIDE_PATTERN[vertex]
        || Number(values[offset + 5]) !== RIBBON_ENDPOINT_PATTERN[vertex]) {
        return { valid: false, segmentCount: 0, reason: 'invalid-ribbon-vertex-pattern' };
      }
    }
  }
  return { valid: true, segmentCount, reason: '' };
}

export function buildSelectionRibbonVertices(geometry) {
  return ribbonVerticesForSegments(buildSelectionBoundarySegments(geometry));
}

export function buildSelectionPointCoordinates(geometry) {
  if (geometry?.type === 'Point' && Array.isArray(geometry.coordinates)) return [geometry.coordinates.slice(0, 2)];
  return [];
}

function flattenSelectionGeometry(feature) {
  if (!feature) return [];
  if (feature.type === 'FeatureCollection') return (feature.features || []).flatMap(flattenSelectionGeometry);
  if (feature.type === 'Feature') return flattenSelectionGeometry(feature.geometry);
  return [feature];
}

export function buildSelectionBoundaryBufferData(nextItems = []) {
  const values = [];
  let segmentCount = 0;
  const renderedKeys = [];
  const missingKeys = [];
  for (const item of nextItems) {
    const key = String(item?.key || '');
    const itemValueOffset = values.length;
    let itemSegmentCount = 0;
    try {
      if (item?.ribbonVertices?.length) {
        const validation = validateSelectionRibbonVertices(item.ribbonVertices, item.segmentCount ?? null);
        if (!validation.valid) throw new Error(validation.reason);
        for (const value of item.ribbonVertices) values.push(Number(value));
        itemSegmentCount = validation.segmentCount;
      } else if (!item?.missing) {
        for (const geometry of flattenSelectionGeometry(item?.geometry)) {
          const segments = buildSelectionBoundarySegments(geometry, { densify: true });
          const ribbonValues = ribbonVerticesForSegments(segments);
          if (!ribbonValues.length) continue;
          const validation = validateSelectionRibbonVertices(ribbonValues);
          if (!validation.valid) throw new Error(validation.reason);
          itemSegmentCount += validation.segmentCount;
          for (const value of ribbonValues) values.push(value);
        }
      }
    } catch (_) {
      itemSegmentCount = 0;
      values.length = itemValueOffset;
    }
    if (itemSegmentCount > 0 && values.length > itemValueOffset) {
      segmentCount += itemSegmentCount;
      if (key) renderedKeys.push(key);
    } else if (key) {
      values.length = itemValueOffset;
      missingKeys.push(key);
    }
  }
  return { values, segmentCount, renderedKeys, missingKeys };
}

export function buildSelectionChannelSignature(name, nextItems = []) {
  const itemSignature = item => [
    String(item?.key || ''),
    String(item?.geometryRevision ?? item?.revision ?? 0),
    String(item?.ribbonRevision ?? ''),
    item?.missing ? 'missing' : 'ready',
  ].join('@');
  return `${String(name || '')}:${nextItems.map(itemSignature).join('|')}`;
}

export function createSelectionEmphasisRenderer({ canvas, projectionForView, getSize, getDpr, onContextChange, onRenderError } = {}) {
  let gl = null;
  let program = null;
  let programInfo = null;
  let territorialProgram = null;
  let territorialProgramInfo = null;
  const territorialBuffers = new Map();
  let territorialBoundaryRevision = '';
  let territorialBoundarySegmentCount = 0;
  let territorialBoundaryBufferBytes = 0;
  let territorialBoundaryBuildCount = 0;
  let primaryBuffer = null;
  let secondaryBuffer = null;
  let primaryPointBuffer = null;
  let secondaryPointBuffer = null;
  let hoverBuffer = null;
  let hoverPointBuffer = null;
  let primaryCount = 0;
  let secondaryCount = 0;
  let primarySegmentCount = 0;
  let secondarySegmentCount = 0;
  let primaryPointCount = 0;
  let secondaryPointCount = 0;
  let hoverCount = 0;
  let hoverSegmentCount = 0;
  let hoverPointCount = 0;
  let items = { hover: [], primary: [], secondary: [] };
  let coverage = emptyCoverage();
  let countryBoundaryRevision = '';
  let countryBoundarySnapshot = null;
  let countryLinePairs = { base: new Map(), override: new Map() };
  const countryRibbonCache = new Map();
  let geometryRevision = -1;
  let bufferBuildCount = 0;
  let bufferBuildMs = 0;
  let available = false;
  let gpuHealth = 'unchecked';
  let selfTestPassed = false;
  let selfTestFailureReason = '';
  let selfTestCount = 0;
  let selfTestMs = 0;
  let lastSelfTestContextRevision = 0;
  let contextRevision = 0;
  let contextLost = false;
  let contextLossCount = 0;
  let contextRestoreCount = 0;
  let viewDrawCount = 0;
  let renderFailureCount = 0;
  let lastRenderResult = null;
  let territorialBoundaryRequest = { revision: '', batches: [] };
  const channelMetrics = {
    hover: { signature: '', rebuildCount: 0, rebuildMs: 0, buildFailed: false },
    primary: { signature: '', rebuildCount: 0, rebuildMs: 0, buildFailed: false },
    secondary: { signature: '', rebuildCount: 0, rebuildMs: 0, buildFailed: false },
  };

  function coverageChannel(nextItems = [], renderedKeys = [], missingKeys = [], segmentCount = 0) {
    const requestedKeys = [...new Set(nextItems.map(item => String(item?.key || '')).filter(Boolean))];
    const rendered = [...new Set(renderedKeys.map(String))];
    const renderedSet = new Set(rendered);
    const missing = [...new Set([
      ...missingKeys.map(String),
      ...requestedKeys.filter(key => !renderedSet.has(key)),
    ])];
    return Object.freeze({
      renderedKeys: Object.freeze(rendered),
      missingKeys: Object.freeze(missing),
      segmentCount: Math.max(0, Number(segmentCount) || 0),
    });
  }

  function emptyCoverage(nextItems = items) {
    return Object.freeze({
      hover: coverageChannel(nextItems.hover),
      primary: coverageChannel(nextItems.primary),
      secondary: coverageChannel(nextItems.secondary),
    });
  }

  function compile(type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader) || 'selection shader compile failed');
    return shader;
  }

  function selfTestError(reason, message = reason) {
    const error = new Error(message);
    error.selfTestReason = reason;
    return error;
  }

  function captureSelfTestState() {
    const attributes = Object.values(programInfo?.attributes || {}).filter(location => location >= 0);
    return {
      framebuffer: gl.getParameter(gl.FRAMEBUFFER_BINDING),
      viewport: Array.from(gl.getParameter(gl.VIEWPORT)),
      program: gl.getParameter(gl.CURRENT_PROGRAM),
      arrayBuffer: gl.getParameter(gl.ARRAY_BUFFER_BINDING),
      activeTexture: gl.getParameter(gl.ACTIVE_TEXTURE),
      texture2d: gl.getParameter(gl.TEXTURE_BINDING_2D),
      blend: gl.isEnabled(gl.BLEND),
      depthTest: gl.isEnabled(gl.DEPTH_TEST),
      cullFace: gl.isEnabled(gl.CULL_FACE),
      scissorTest: gl.isEnabled(gl.SCISSOR_TEST),
      blendSrcRgb: gl.getParameter(gl.BLEND_SRC_RGB),
      blendDstRgb: gl.getParameter(gl.BLEND_DST_RGB),
      blendSrcAlpha: gl.getParameter(gl.BLEND_SRC_ALPHA),
      blendDstAlpha: gl.getParameter(gl.BLEND_DST_ALPHA),
      blendEquationRgb: gl.getParameter(gl.BLEND_EQUATION_RGB),
      blendEquationAlpha: gl.getParameter(gl.BLEND_EQUATION_ALPHA),
      colorMask: Array.from(gl.getParameter(gl.COLOR_WRITEMASK)),
      clearColor: Array.from(gl.getParameter(gl.COLOR_CLEAR_VALUE)),
      attributes: attributes.map(location => ({
        location,
        enabled: !!gl.getVertexAttrib(location, gl.VERTEX_ATTRIB_ARRAY_ENABLED),
        buffer: gl.getVertexAttrib(location, gl.VERTEX_ATTRIB_ARRAY_BUFFER_BINDING),
        size: gl.getVertexAttrib(location, gl.VERTEX_ATTRIB_ARRAY_SIZE),
        type: gl.getVertexAttrib(location, gl.VERTEX_ATTRIB_ARRAY_TYPE),
        normalized: !!gl.getVertexAttrib(location, gl.VERTEX_ATTRIB_ARRAY_NORMALIZED),
        stride: gl.getVertexAttrib(location, gl.VERTEX_ATTRIB_ARRAY_STRIDE),
        offset: gl.getVertexAttribOffset(location, gl.VERTEX_ATTRIB_ARRAY_POINTER),
      })),
    };
  }

  function restoreSelfTestState(state) {
    const setEnabled = (capability, enabled) => enabled ? gl.enable(capability) : gl.disable(capability);
    gl.bindFramebuffer(gl.FRAMEBUFFER, state.framebuffer);
    gl.viewport(...state.viewport);
    gl.useProgram(state.program);
    for (const attribute of state.attributes) {
      if (attribute.buffer) {
        gl.bindBuffer(gl.ARRAY_BUFFER, attribute.buffer);
        gl.vertexAttribPointer(attribute.location, attribute.size, attribute.type, attribute.normalized, attribute.stride, attribute.offset);
      }
      if (attribute.enabled) gl.enableVertexAttribArray(attribute.location);
      else gl.disableVertexAttribArray(attribute.location);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, state.arrayBuffer);
    gl.activeTexture(state.activeTexture);
    gl.bindTexture(gl.TEXTURE_2D, state.texture2d);
    setEnabled(gl.BLEND, state.blend);
    setEnabled(gl.DEPTH_TEST, state.depthTest);
    setEnabled(gl.CULL_FACE, state.cullFace);
    setEnabled(gl.SCISSOR_TEST, state.scissorTest);
    gl.blendFuncSeparate(state.blendSrcRgb, state.blendDstRgb, state.blendSrcAlpha, state.blendDstAlpha);
    gl.blendEquationSeparate(state.blendEquationRgb, state.blendEquationAlpha);
    gl.colorMask(...state.colorMask);
    gl.clearColor(...state.clearColor);
  }

  function runRibbonSelfTest() {
    const started = performance.now();
    selfTestCount += 1;
    lastSelfTestContextRevision = contextRevision;
    let stage = 'shader-program-unavailable';
    let passed = false;
    let failureReason = '';
    let savedState = null;
    let texture = null;
    let framebuffer = null;
    let buffer = null;
    try {
      if (!gl || !program || !programInfo) throw selfTestError(stage);
      savedState = captureSelfTestState();
      const ribbonValues = [];
      appendRibbonSegment(ribbonValues, -0.5, 0, 0.5, 0);
      const validation = validateSelectionRibbonVertices(ribbonValues, 1);
      if (!validation.valid) throw selfTestError('invalid-ribbon-data', validation.reason);

      stage = 'framebuffer-incomplete';
      texture = gl.createTexture();
      framebuffer = gl.createFramebuffer();
      if (!texture || !framebuffer) throw selfTestError(stage, 'selection self-test framebuffer allocation failed');
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 16, 16, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw selfTestError(stage);

      stage = 'buffer-upload-failed';
      buffer = gl.createBuffer();
      if (!buffer) throw selfTestError(stage, 'selection self-test buffer allocation failed');
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(ribbonValues), gl.STATIC_DRAW);

      stage = 'draw-failed';
      gl.viewport(0, 0, 16, 16);
      gl.disable(gl.BLEND);
      gl.disable(gl.DEPTH_TEST);
      gl.disable(gl.CULL_FACE);
      gl.disable(gl.SCISSOR_TEST);
      gl.colorMask(true, true, true, true);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(program);
      const locations = setRibbonAttributes();
      const uniforms = programInfo.uniforms;
      gl.uniform2f(uniforms.uViewport, 16, 16);
      gl.uniform2f(uniforms.uTranslate, 8, 8);
      gl.uniform1f(uniforms.uScale, 400);
      gl.uniform3fv(uniforms.uRowX, [1, 0, 0]);
      gl.uniform3fv(uniforms.uRowY, [0, 1, 0]);
      gl.uniform3fv(uniforms.uRowZ, [0, 0, 1]);
      gl.uniform2f(uniforms.uFlatCenter, 0, 0);
      gl.uniform1f(uniforms.uWorldOffset, 0);
      gl.uniform1i(uniforms.uMode, 1);
      gl.uniform1f(uniforms.uHalfWidth, 1.5);
      gl.uniform1f(uniforms.uDpr, 1);
      gl.uniform4f(uniforms.uColor, 1, 1, 1, 1);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      for (const location of locations) if (location >= 0) gl.disableVertexAttribArray(location);

      stage = 'zero-alpha-output';
      const pixels = new Uint8Array(16 * 16 * 4);
      gl.readPixels(0, 0, 16, 16, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      if (!pixels.some((value, index) => index % 4 === 3 && value > 0)) throw selfTestError(stage);
      passed = true;
    } catch (error) {
      failureReason = error?.selfTestReason || stage;
      onRenderError?.({ stage: 'selection-ribbon-self-test', reason: failureReason, error });
    } finally {
      try {
        if (buffer) gl?.deleteBuffer?.(buffer);
        if (framebuffer) gl?.deleteFramebuffer?.(framebuffer);
        if (texture) gl?.deleteTexture?.(texture);
        if (savedState) restoreSelfTestState(savedState);
      } catch (error) {
        passed = false;
        failureReason = 'state-restore-failed';
        onRenderError?.({ stage: 'selection-ribbon-self-test', reason: failureReason, error });
      }
    }
    selfTestPassed = passed;
    selfTestFailureReason = passed ? '' : failureReason || stage;
    selfTestMs = performance.now() - started;
    gpuHealth = passed ? 'healthy' : 'unhealthy';
    available = passed && !contextLost;
    return passed;
  }

  function init() {
    if (available && !contextLost) return true;
    if (!canvas || !globalThis.WebGLRenderingContext) return false;
    gl = canvas.getContext('webgl2', { alpha: true, antialias: true }) || canvas.getContext('webgl', { alpha: true, antialias: true });
    if (!gl) return false;
    const webgl2 = typeof globalThis.WebGL2RenderingContext !== 'undefined' && gl instanceof globalThis.WebGL2RenderingContext;
    const vertex = webgl2 ? `#version 300 es
      precision highp float;
      precision highp int;
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
      precision highp int;
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
      precision mediump float; precision highp int; uniform vec4 uColor; uniform int uMode; in float vDepth; out vec4 outColor;
      void main(){if(uMode==0&&vDepth<0.0)discard;outColor=uColor;}`
      : `precision mediump float; precision highp int; uniform vec4 uColor; uniform int uMode; varying float vDepth;
      void main(){if(uMode==0&&vDepth<0.0)discard;gl_FragColor=uColor;}`;
    const vs = compile(gl.VERTEX_SHADER, vertex);
    const fs = compile(gl.FRAGMENT_SHADER, fragment);
    program = gl.createProgram(); gl.attachShader(program, vs); gl.attachShader(program, fs); gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || 'selection shader link failed');
    programInfo = Object.freeze({
      attributes: Object.freeze({
        start: gl.getAttribLocation(program, 'aStart'),
        end: gl.getAttribLocation(program, 'aEnd'),
        side: gl.getAttribLocation(program, 'aSide'),
        endpoint: gl.getAttribLocation(program, 'aEndpoint'),
      }),
      uniforms: Object.freeze(Object.fromEntries([
        'uViewport', 'uTranslate', 'uScale', 'uRowX', 'uRowY', 'uRowZ',
        'uFlatCenter', 'uWorldOffset', 'uMode', 'uHalfWidth', 'uDpr', 'uColor',
      ].map(name => [name, gl.getUniformLocation(program, name)]))),
    });
    const territorialVertex = webgl2 ? `#version 300 es
      precision highp float; precision highp int;
      layout(location=0) in vec2 aStart; layout(location=1) in vec2 aEnd;
      layout(location=2) in float aSide; layout(location=3) in float aEndpoint; layout(location=4) in vec4 aColor;
      uniform vec2 uViewport; uniform vec2 uTranslate; uniform float uScale;
      uniform vec3 uRowX; uniform vec3 uRowY; uniform vec3 uRowZ; uniform vec2 uFlatCenter;
      uniform float uWorldOffset; uniform int uMode; uniform float uHalfWidth;
      out float vDepth; out float vAlong; out vec4 vColor;
      vec3 project(vec2 coord){float lon=coord.x*0.017453292519943;float lat=coord.y*0.017453292519943;vec2 p;float depth;
        if(uMode==0){vec3 q=vec3(cos(lat)*cos(lon),cos(lat)*sin(lon),sin(lat));p=uTranslate+uScale*vec2(dot(uRowX,q),dot(uRowY,q));depth=dot(uRowZ,q);}
        else{p=uTranslate+uScale*vec2(lon+uWorldOffset-uFlatCenter.x,-(lat-uFlatCenter.y));depth=1.0;}return vec3(p,depth);}
      void main(){vec3 start=project(aStart);vec3 end=project(aEnd);vec2 direction=end.xy-start.xy;float lengthPx=max(length(direction),0.0001);direction/=lengthPx;
        vec2 normal=vec2(-direction.y,direction.x);vec2 center=mix(start.xy,end.xy,aEndpoint)+direction*((aEndpoint<0.5)?-uHalfWidth:uHalfWidth);
        vec2 p=center+normal*aSide*uHalfWidth;vDepth=mix(start.z,end.z,aEndpoint);vAlong=aEndpoint*lengthPx;vColor=aColor;
        gl_Position=vec4(p.x*2.0/uViewport.x-1.0,1.0-p.y*2.0/uViewport.y,0.0,1.0);}`
      : `precision highp float; precision highp int;
      attribute vec2 aStart;attribute vec2 aEnd;attribute float aSide;attribute float aEndpoint;attribute vec4 aColor;
      uniform vec2 uViewport;uniform vec2 uTranslate;uniform float uScale;uniform vec3 uRowX;uniform vec3 uRowY;uniform vec3 uRowZ;uniform vec2 uFlatCenter;
      uniform float uWorldOffset;uniform int uMode;uniform float uHalfWidth;varying float vDepth;varying float vAlong;varying vec4 vColor;
      vec3 project(vec2 coord){float lon=coord.x*0.017453292519943;float lat=coord.y*0.017453292519943;vec2 p;float depth;
        if(uMode==0){vec3 q=vec3(cos(lat)*cos(lon),cos(lat)*sin(lon),sin(lat));p=uTranslate+uScale*vec2(dot(uRowX,q),dot(uRowY,q));depth=dot(uRowZ,q);}
        else{p=uTranslate+uScale*vec2(lon+uWorldOffset-uFlatCenter.x,-(lat-uFlatCenter.y));depth=1.0;}return vec3(p,depth);}
      void main(){vec3 start=project(aStart);vec3 end=project(aEnd);vec2 direction=end.xy-start.xy;float lengthPx=max(length(direction),0.0001);direction/=lengthPx;
        vec2 normal=vec2(-direction.y,direction.x);vec2 center=mix(start.xy,end.xy,aEndpoint)+direction*((aEndpoint<0.5)?-uHalfWidth:uHalfWidth);
        vec2 p=center+normal*aSide*uHalfWidth;vDepth=mix(start.z,end.z,aEndpoint);vAlong=aEndpoint*lengthPx;vColor=aColor;
        gl_Position=vec4(p.x*2.0/uViewport.x-1.0,1.0-p.y*2.0/uViewport.y,0.0,1.0);}`;
    const territorialFragment = webgl2 ? `#version 300 es
      precision mediump float;precision highp int;uniform int uMode;uniform vec2 uDash;in float vDepth;in float vAlong;in vec4 vColor;out vec4 outColor;
      void main(){if(uMode==0&&vDepth<0.0)discard;float period=max(1.0,uDash.x+uDash.y);if(uDash.x>0.0&&mod(vAlong,period)>uDash.x)discard;outColor=vColor;}`
      : `precision mediump float;precision highp int;uniform int uMode;uniform vec2 uDash;varying float vDepth;varying float vAlong;varying vec4 vColor;
      void main(){if(uMode==0&&vDepth<0.0)discard;float period=max(1.0,uDash.x+uDash.y);if(uDash.x>0.0&&mod(vAlong,period)>uDash.x)discard;gl_FragColor=vColor;}`;
    const territorialVs = compile(gl.VERTEX_SHADER, territorialVertex);
    const territorialFs = compile(gl.FRAGMENT_SHADER, territorialFragment);
    territorialProgram = gl.createProgram(); gl.attachShader(territorialProgram, territorialVs); gl.attachShader(territorialProgram, territorialFs); gl.linkProgram(territorialProgram);
    if (!gl.getProgramParameter(territorialProgram, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(territorialProgram) || 'territorial boundary shader link failed');
    territorialProgramInfo = Object.freeze({
      attributes: Object.freeze(Object.fromEntries(['aStart', 'aEnd', 'aSide', 'aEndpoint', 'aColor'].map(name => [name, gl.getAttribLocation(territorialProgram, name)]))),
      uniforms: Object.freeze(Object.fromEntries([
        'uViewport', 'uTranslate', 'uScale', 'uRowX', 'uRowY', 'uRowZ', 'uFlatCenter', 'uWorldOffset', 'uMode', 'uHalfWidth', 'uDash',
      ].map(name => [name, gl.getUniformLocation(territorialProgram, name)]))),
    });
    primaryBuffer = gl.createBuffer(); secondaryBuffer = gl.createBuffer(); hoverBuffer = gl.createBuffer();
    primaryPointBuffer = gl.createBuffer(); secondaryPointBuffer = gl.createBuffer(); hoverPointBuffer = gl.createBuffer();
    contextLost = false;
    contextRevision += 1;
    gpuHealth = 'unchecked';
    available = false;
    return runRibbonSelfTest();
  }

  function resetChannelResources() {
    primaryBuffer = secondaryBuffer = hoverBuffer = null;
    primaryPointBuffer = secondaryPointBuffer = hoverPointBuffer = null;
    primaryCount = secondaryCount = hoverCount = 0;
    primarySegmentCount = secondarySegmentCount = hoverSegmentCount = 0;
    primaryPointCount = secondaryPointCount = hoverPointCount = 0;
    for (const metrics of Object.values(channelMetrics)) {
      metrics.signature = '';
      metrics.buildFailed = false;
    }
    coverage = emptyCoverage(items);
  }

  function handleContextLost(event) {
    event?.preventDefault?.();
    contextLost = true;
    available = false;
    gpuHealth = 'context-lost';
    selfTestPassed = false;
    selfTestFailureReason = 'context-lost';
    contextLossCount += 1;
    lastRenderResult = finishRenderResult({
      channelSucceeded: { hover: false, primary: false, secondary: false },
      succeeded: false,
    });
    onContextChange?.({ type: 'lost', contextLost: true });
  }

  function handleContextRestored() {
    contextLost = false;
    available = false;
    gpuHealth = 'unchecked';
    contextRestoreCount += 1;
    program = programInfo = territorialProgram = territorialProgramInfo = null;
    territorialBuffers.clear();
    territorialBoundaryRevision = '';
    resetChannelResources();
    try {
      if (!init()) throw new Error('selection WebGL context restore failed');
      const requestItems = { hover: items.hover.slice(), primary: items.primary.slice(), secondary: items.secondary.slice() };
      for (const name of ['hover', 'primary', 'secondary']) {
        rebuildChannel(name, requestItems[name], channelSignature(name, requestItems[name]));
      }
      if (territorialBoundaryRequest.revision || territorialBoundaryRequest.batches.length) {
        setTerritorialBoundaries(territorialBoundaryRequest);
      }
      onContextChange?.({ type: 'restored', contextLost: false });
    } catch (error) {
      available = false;
      contextLost = false;
      onRenderError?.({ stage: 'selection-context-restore', error });
      onContextChange?.({ type: 'restore-failed', contextLost: false, error });
    }
  }

  function countryLinePairsForId(mesh, countryIds, targetId) {
    const pairs = [];
    if (!mesh?.lineIndices?.length || !mesh.positions?.length) return pairs;
    for (let offset = 0; offset < mesh.lineIndices.length; offset += 2) {
      const startIndex = Number(mesh.lineIndices[offset]);
      const endIndex = Number(mesh.lineIndices[offset + 1]);
      const countryIndex = Number(mesh.countryIndices?.[startIndex]);
      const id = String(countryIds?.[countryIndex] || '');
      if (id === targetId) pairs.push(startIndex, endIndex);
    }
    return pairs;
  }

  function setCountryBoundaryMesh(snapshot = null) {
    const revision = String(snapshot?.revision || '');
    if (revision === countryBoundaryRevision) return false;
    countryBoundaryRevision = revision;
    countryBoundarySnapshot = snapshot;
    countryLinePairs = { base: new Map(), override: new Map() };
    countryRibbonCache.clear();
    return true;
  }

  function setTerritorialBoundaries({ revision = '', batches = [] } = {}) {
    territorialBoundaryRequest = { revision: String(revision || ''), batches };
    const nextRevision = String(revision || '');
    if (!available) {
      territorialBoundaryRevision = '';
      territorialBoundarySegmentCount = 0;
      territorialBoundaryBufferBytes = 0;
      return false;
    }
    if (nextRevision === territorialBoundaryRevision) return false;
    territorialBoundaryRevision = nextRevision;
    territorialBoundarySegmentCount = 0;
    territorialBoundaryBufferBytes = 0;
    const retained = new Set();
    for (const batch of batches || []) {
      const key = String(batch.styleType || 'territory');
      retained.add(key);
      const values = [];
      for (const segment of batch.segments || []) {
        const [red, green, blue] = colorRgb(segment.color);
        const alpha = Math.max(0, Math.min(1, Number(segment.opacity ?? 1)));
        const dense = densifyBoundarySegmentsForProjection([[segment.a, segment.b]]);
        for (const [[startLon, startLat], [endLon, endLat]] of dense) {
          const ribbon = [];
          if (!appendRibbonSegment(ribbon, startLon, startLat, endLon, endLat)) continue;
          for (let offset = 0; offset < ribbon.length; offset += 6) values.push(...ribbon.slice(offset, offset + 6), red, green, blue, alpha);
          territorialBoundarySegmentCount += 1;
        }
      }
      let record = territorialBuffers.get(key);
      if (!record) record = { buffer: gl.createBuffer() };
      const typed = new Float32Array(values);
      gl.bindBuffer(gl.ARRAY_BUFFER, record.buffer);
      gl.bufferData(gl.ARRAY_BUFFER, typed, gl.STATIC_DRAW);
      territorialBoundaryBufferBytes += typed.byteLength;
      territorialBuffers.set(key, {
        ...record,
        count: typed.length / 10,
        width: Math.max(0.5, Number(batch.width) || 1),
        dash: Array.isArray(batch.dash) ? batch.dash.map(Number) : [0, 0],
      });
    }
    for (const [key, record] of territorialBuffers) {
      if (retained.has(key)) continue;
      gl.deleteBuffer(record.buffer);
      territorialBuffers.delete(key);
    }
    territorialBoundaryBuildCount += 1;
    return true;
  }

  function countryRibbonItem(id) {
    const key = String(id || '');
    const snapshot = countryBoundarySnapshot;
    if (!key || !snapshot || snapshot.pendingIds?.includes(key) || snapshot.visibleIds && !snapshot.visibleIds.includes(key)) return null;
    const overridden = snapshot.overriddenIds?.includes(key);
    const sourceName = overridden ? 'override' : 'base';
    const cacheKey = `${countryBoundaryRevision}:${sourceName}:${key}`;
    if (countryRibbonCache.has(cacheKey)) return countryRibbonCache.get(cacheKey);
    const mesh = snapshot[sourceName];
    if (!countryLinePairs[sourceName].has(key)) {
      countryLinePairs[sourceName].set(key, countryLinePairsForId(mesh, snapshot.countryIds, key));
    }
    const pairs = countryLinePairs[sourceName].get(key) || [];
    const ribbonValues = [];
    for (let offset = 0; offset < pairs.length; offset += 2) {
      const startIndex = pairs[offset];
      const endIndex = pairs[offset + 1];
      appendRibbonSegment(
        ribbonValues,
        Number(mesh.positions[startIndex * 2]) / 1e6,
        Number(mesh.positions[startIndex * 2 + 1]) / 1e6,
        Number(mesh.positions[endIndex * 2]) / 1e6,
        Number(mesh.positions[endIndex * 2 + 1]) / 1e6,
      );
    }
    const validSegmentCount = ribbonValues.length / RIBBON_SEGMENT_SCALAR_COUNT;
    const item = validSegmentCount ? {
      key: `country:${key}`,
      ribbonVertices: new Float32Array(ribbonValues),
      segmentCount: validSegmentCount,
    } : null;
    countryRibbonCache.set(cacheKey, item);
    return item;
  }

  function countryRequestItem(id) {
    const key = String(id || '');
    if (!key) return null;
    const item = countryRibbonItem(key);
    return item
      ? { ...item, geometryRevision: countryBoundaryRevision, ribbonRevision: countryBoundaryRevision }
      : { key: `country:${key}`, missing: true, geometryRevision: countryBoundaryRevision };
  }

  function channelSignature(name, nextItems = []) {
    return buildSelectionChannelSignature(name, nextItems);
  }

  function pointBufferValues(nextItems = []) {
    const values = [];
    for (const item of nextItems) for (const geometry of flattenSelectionGeometry(item.geometry)) {
      for (const point of buildSelectionPointCoordinates(geometry)) values.push(...point);
    }
    return values;
  }

  function activeChannelBuffers(name) {
    if (name === 'hover') return { line: hoverBuffer, point: hoverPointBuffer };
    if (name === 'primary') return { line: primaryBuffer, point: primaryPointBuffer };
    return { line: secondaryBuffer, point: secondaryPointBuffer };
  }

  function assignChannelBuffers(name, line, point) {
    if (name === 'hover') { hoverBuffer = line; hoverPointBuffer = point; return; }
    if (name === 'primary') { primaryBuffer = line; primaryPointBuffer = point; return; }
    secondaryBuffer = line; secondaryPointBuffer = point;
  }

  function assignChannelCounts(name, boundaryData, pointCount) {
    if (name === 'hover') {
      hoverCount = boundaryData.values.length / 6;
      hoverSegmentCount = boundaryData.segmentCount;
      hoverPointCount = pointCount;
      return;
    }
    if (name === 'primary') {
      primaryCount = boundaryData.values.length / 6;
      primarySegmentCount = boundaryData.segmentCount;
      primaryPointCount = pointCount;
      return;
    }
    secondaryCount = boundaryData.values.length / 6;
    secondarySegmentCount = boundaryData.segmentCount;
    secondaryPointCount = pointCount;
  }

  function rebuildChannel(name, nextItems, signature) {
    const metrics = channelMetrics[name];
    if (signature === metrics.signature && !metrics.buildFailed) return { changed: false, succeeded: true };
    const started = performance.now();
    let stagedLine = null;
    let stagedPoint = null;
    try {
      const boundaryData = buildSelectionBoundaryBufferData(nextItems);
      const pointValues = pointBufferValues(nextItems);
      stagedLine = gl.createBuffer();
      stagedPoint = gl.createBuffer();
      if (!stagedLine || !stagedPoint) throw new Error('selection buffer allocation failed');
      gl.bindBuffer(gl.ARRAY_BUFFER, stagedLine);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(boundaryData.values), gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, stagedPoint);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(pointValues), gl.STATIC_DRAW);
      const previous = activeChannelBuffers(name);
      assignChannelBuffers(name, stagedLine, stagedPoint);
      if (previous.line) gl.deleteBuffer(previous.line);
      if (previous.point) gl.deleteBuffer(previous.point);
      assignChannelCounts(name, boundaryData, pointValues.length / 2);
      coverage = Object.freeze({
        ...coverage,
        [name]: coverageChannel(nextItems, boundaryData.renderedKeys, boundaryData.missingKeys, boundaryData.segmentCount),
      });
      metrics.signature = signature;
      metrics.buildFailed = false;
      return { changed: true, succeeded: true };
    } catch (error) {
      if (stagedLine) gl.deleteBuffer(stagedLine);
      if (stagedPoint) gl.deleteBuffer(stagedPoint);
      metrics.buildFailed = true;
      coverage = Object.freeze({ ...coverage, [name]: coverageChannel(nextItems) });
      onRenderError?.({ stage: 'selection-buffer-build', channel: name, error });
      return { changed: true, succeeded: false, error };
    } finally {
      const elapsed = performance.now() - started;
      metrics.rebuildCount += 1;
      metrics.rebuildMs = elapsed;
      bufferBuildCount += 1;
      bufferBuildMs += elapsed;
    }
  }

  function updateSelectionData({
    hover = [], primary = [], secondary = [], revision = 0,
    countryHoverId = '', countryPrimaryId = '', countrySecondaryIds = [],
  } = {}) {
    const next = { hover: hover.slice(), primary: primary.slice(), secondary: secondary.slice() };
    const countryHover = countryRequestItem(countryHoverId);
    const countryPrimary = countryRequestItem(countryPrimaryId);
    if (countryHover) next.hover.push(countryHover);
    if (countryPrimary) next.primary.push(countryPrimary);
    for (const id of countrySecondaryIds || []) {
      const item = countryRequestItem(id);
      if (item) next.secondary.push(item);
    }
    items = next;
    geometryRevision = Number(revision || 0);
    if (!available || contextLost) {
      coverage = emptyCoverage(items);
      return { succeeded: false, changedChannels: [], failedChannels: Object.keys(items), coverage };
    }
    const changedChannels = [];
    const failedChannels = [];
    for (const name of ['hover', 'primary', 'secondary']) {
      const result = rebuildChannel(name, items[name], channelSignature(name, items[name]));
      if (result.changed) changedChannels.push(name);
      if (!result.succeeded) failedChannels.push(name);
    }
    return { succeeded: !failedChannels.length, changedChannels, failedChannels, coverage };
  }

  function setSelection(request = {}) {
    return updateSelectionData(request);
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
      programInfo.attributes.start, programInfo.attributes.end,
      programInfo.attributes.side, programInfo.attributes.endpoint,
    ];
    const stride = 6 * Float32Array.BYTES_PER_ELEMENT;
    for (const [index, location] of locations.entries()) {
      if (location < 0) continue;
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, index < 2 ? 2 : 1, gl.FLOAT, false, stride, index === 0 ? 0 : index === 1 ? 2 * Float32Array.BYTES_PER_ELEMENT : index === 2 ? 4 * Float32Array.BYTES_PER_ELEMENT : 5 * Float32Array.BYTES_PER_ELEMENT);
    }
    return locations;
  }

  function drawRibbon(buffer, count, width, alpha, viewState, color = interactionStyle.selection.color) {
    if (!count) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    const locations = setRibbonAttributes();
    const [red, green, blue] = colorRgb(color);
    gl.uniform4f(programInfo.uniforms.uColor, red, green, blue, alpha);
    gl.uniform1f(programInfo.uniforms.uHalfWidth, width / 2);
    const offsets = viewState.projection === 'globe' ? [0] : [-2 * Math.PI, 0, 2 * Math.PI];
    const worldLocation = programInfo.uniforms.uWorldOffset;
    for (const offset of offsets) { gl.uniform1f(worldLocation, offset); gl.drawArrays(gl.TRIANGLES, 0, count); }
    for (const location of locations) if (location >= 0) gl.disableVertexAttribArray(location);
  }

  function drawPoints(buffer, count, alpha, color = interactionStyle.selection.color) {
    if (!count) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    const location = programInfo.attributes.start;
    const endLocation = programInfo.attributes.end;
    const sideLocation = programInfo.attributes.side;
    const endpointLocation = programInfo.attributes.endpoint;
    gl.enableVertexAttribArray(location); gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0);
    for (const attribute of [endLocation, sideLocation, endpointLocation]) if (attribute >= 0) gl.disableVertexAttribArray(attribute);
    if (endLocation >= 0) gl.vertexAttrib2f(endLocation, 0, 0);
    if (sideLocation >= 0) gl.vertexAttrib1f(sideLocation, 0);
    if (endpointLocation >= 0) gl.vertexAttrib1f(endpointLocation, 0);
    const [red, green, blue] = colorRgb(color);
    gl.uniform4f(programInfo.uniforms.uColor, red, green, blue, alpha);
    gl.uniform1f(programInfo.uniforms.uHalfWidth, 0);
    gl.uniform1f(programInfo.uniforms.uWorldOffset, 0);
    gl.drawArrays(gl.POINTS, 0, count);
    gl.disableVertexAttribArray(location);
  }

  function setViewUniforms(info, { width, height, translate, scale, rows, flatCenter, mode }) {
    const uniforms = info.uniforms;
    gl.uniform2f(uniforms.uViewport, width, height);
    gl.uniform2f(uniforms.uTranslate, translate[0], translate[1]);
    gl.uniform1f(uniforms.uScale, scale);
    gl.uniform3fv(uniforms.uRowX, rows.rowX);
    gl.uniform3fv(uniforms.uRowY, rows.rowY);
    gl.uniform3fv(uniforms.uRowZ, rows.rowZ);
    gl.uniform2f(uniforms.uFlatCenter, flatCenter[0] * DEGREES_TO_RADIANS, flatCenter[1] * DEGREES_TO_RADIANS);
    gl.uniform1i(uniforms.uMode, mode);
  }

  function drawTerritorialBoundaries(view, viewState) {
    if (!territorialProgram || !territorialBuffers.size) return;
    gl.useProgram(territorialProgram);
    setViewUniforms(territorialProgramInfo, view);
    const attributes = territorialProgramInfo.attributes;
    const locations = [attributes.aStart, attributes.aEnd, attributes.aSide, attributes.aEndpoint, attributes.aColor];
    const sizes = [2, 2, 1, 1, 4];
    const offsets = [0, 2, 4, 5, 6].map(value => value * Float32Array.BYTES_PER_ELEMENT);
    const stride = 10 * Float32Array.BYTES_PER_ELEMENT;
    for (const record of territorialBuffers.values()) {
      if (!record.count) continue;
      gl.bindBuffer(gl.ARRAY_BUFFER, record.buffer);
      locations.forEach((location, index) => {
        if (location < 0) return;
        gl.enableVertexAttribArray(location);
        gl.vertexAttribPointer(location, sizes[index], gl.FLOAT, false, stride, offsets[index]);
      });
      gl.uniform1f(territorialProgramInfo.uniforms.uHalfWidth, record.width / 2);
      gl.uniform2f(territorialProgramInfo.uniforms.uDash, Math.max(0, record.dash[0] || 0), Math.max(0, record.dash[1] || 0));
      const worldOffsets = viewState.projection === 'globe' ? [0] : [-2 * Math.PI, 0, 2 * Math.PI];
      for (const offset of worldOffsets) {
        gl.uniform1f(territorialProgramInfo.uniforms.uWorldOffset, offset);
        gl.drawArrays(gl.TRIANGLES, 0, record.count);
      }
    }
    for (const location of locations) if (location >= 0) gl.disableVertexAttribArray(location);
  }

  function renderCoverage(channelSucceeded = {}) {
    const channels = {};
    for (const name of ['hover', 'primary', 'secondary']) {
      const requestedKeys = [...new Set(items[name].map(item => String(item?.key || '')).filter(Boolean))];
      const buildCoverage = coverage[name] || coverageChannel(items[name]);
      const buildSucceeded = !channelMetrics[name].buildFailed;
      const drawSucceeded = gpuHealth === 'healthy' && selfTestPassed && buildSucceeded && channelSucceeded[name] !== false;
      const renderedKeys = drawSucceeded ? [...buildCoverage.renderedKeys] : [];
      const renderedSet = new Set(renderedKeys);
      const missingKeys = [...new Set([
        ...buildCoverage.missingKeys,
        ...requestedKeys.filter(key => !renderedSet.has(key)),
      ])];
      channels[name] = Object.freeze({ buildSucceeded, drawSucceeded, renderedKeys, missingKeys });
    }
    return Object.freeze(channels);
  }

  function finishRenderResult({ channelSucceeded = {}, succeeded = true, error = null } = {}) {
    const channels = renderCoverage(channelSucceeded);
    const result = Object.freeze({
      succeeded: succeeded && Object.values(channels).every(channel => channel.drawSucceeded),
      contextLost,
      selfTestPassed,
      gpuHealth,
      channels,
      error,
    });
    if (!result.succeeded) renderFailureCount += 1;
    lastRenderResult = result;
    return result;
  }

  function render(viewState = {}) {
    viewDrawCount += 1;
    if (!available || !canvas || contextLost || gl?.isContextLost?.()) {
      contextLost = contextLost || !!gl?.isContextLost?.();
      if (contextLost) {
        available = false;
        gpuHealth = 'context-lost';
        selfTestPassed = false;
        selfTestFailureReason = 'context-lost';
      }
      return finishRenderResult({ channelSucceeded: { hover: false, primary: false, secondary: false }, succeeded: false });
    }
    const channelSucceeded = { hover: true, primary: true, secondary: true };
    try {
      const size = getSize?.() || viewState.size || { width: 1, height: 1 };
      const dpr = Number(getDpr?.() || viewState.dpr || 1);
      const width = Math.max(1, Number(size.width || 1));
      const height = Math.max(1, Number(size.height || 1));
      const pixelWidth = Math.max(1, Math.round(width * dpr));
      const pixelHeight = Math.max(1, Math.round(height * dpr));
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) { canvas.width = pixelWidth; canvas.height = pixelHeight; }
      const projection = projectionForView?.(viewState);
      if (!projection) return finishRenderResult({ channelSucceeded: { hover: false, primary: false, secondary: false }, succeeded: false });
      const mode = viewState.projection === 'globe' ? 0 : 1;
      const rows = mode === 0 ? rowsForProjection(projection) : { rowX: [1, 0, 0], rowY: [0, 1, 0], rowZ: [0, 0, 1] };
      const translate = viewState.translate || projection.translate();
      const scale = Number(viewState.scale || projection.scale());
      const flatCenter = viewState.projectionCenter || viewState.flatCenter || [0, 0];
      gl.viewport(0, 0, pixelWidth, pixelHeight); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      const view = { width, height, translate, scale, rows, flatCenter, mode };
      try { drawTerritorialBoundaries(view, viewState); }
      catch (error) { onRenderError?.({ stage: 'selection-territorial-render', error }); }
      gl.useProgram(program);
      setViewUniforms(programInfo, view);
      gl.uniform1f(programInfo.uniforms.uDpr, dpr);
      const primary = interactionStyle.selection.primary;
      const secondary = interactionStyle.selection.secondary;
      const drawChannel = (name, draw) => {
        if (channelMetrics[name].buildFailed) { channelSucceeded[name] = false; return; }
        try { draw(); }
        catch (error) {
          channelSucceeded[name] = false;
          onRenderError?.({ stage: 'selection-gpu-render', channel: name, error });
        }
      };
      drawChannel('hover', () => {
        drawRibbon(hoverBuffer, hoverCount, interactionStyle.hover.width, interactionStyle.hover.alpha, viewState, interactionStyle.hover.color);
        drawPoints(hoverPointBuffer, hoverPointCount, interactionStyle.hover.alpha, interactionStyle.hover.color);
      });
      drawChannel('secondary', () => {
        drawRibbon(secondaryBuffer, secondaryCount, secondary.outerWidth, secondary.casingAlpha, viewState, interactionStyle.selection.casingColor);
        drawRibbon(secondaryBuffer, secondaryCount, secondary.innerWidth, secondary.innerAlpha, viewState, interactionStyle.selection.color);
        drawPoints(secondaryPointBuffer, secondaryPointCount, secondary.casingAlpha, interactionStyle.selection.casingColor);
        drawPoints(secondaryPointBuffer, secondaryPointCount, secondary.innerAlpha, interactionStyle.selection.color);
      });
      drawChannel('primary', () => {
        drawRibbon(primaryBuffer, primaryCount, primary.outerWidth, primary.casingAlpha, viewState, interactionStyle.selection.casingColor);
        drawRibbon(primaryBuffer, primaryCount, primary.innerWidth, primary.innerAlpha, viewState, interactionStyle.selection.color);
        drawPoints(primaryPointBuffer, primaryPointCount, primary.casingAlpha, interactionStyle.selection.casingColor);
        drawPoints(primaryPointBuffer, primaryPointCount, primary.innerAlpha, interactionStyle.selection.color);
      });
      gl.disable(gl.BLEND);
      return finishRenderResult({ channelSucceeded });
    } catch (error) {
      try { gl?.disable?.(gl.BLEND); } catch (_) {}
      onRenderError?.({ stage: 'selection-gpu-render', error });
      return finishRenderResult({ channelSucceeded: { hover: false, primary: false, secondary: false }, succeeded: false, error });
    }
  }

  function clear() {
    updateSelectionData({ hover: [], primary: [], secondary: [], revision: -1 });
    geometryRevision = -1;
    if (available) render({ projection: 'flat', size: getSize?.() || { width: 1, height: 1 }, dpr: getDpr?.() || 1 });
  }

  function dispose() {
    canvas?.removeEventListener?.('webglcontextlost', handleContextLost);
    canvas?.removeEventListener?.('webglcontextrestored', handleContextRestored);
    if (available && gl && !gl.isContextLost?.()) {
      for (const buffer of [primaryBuffer, secondaryBuffer, hoverBuffer, primaryPointBuffer, secondaryPointBuffer, hoverPointBuffer]) {
        if (buffer) gl.deleteBuffer(buffer);
      }
      for (const record of territorialBuffers.values()) if (record.buffer) gl.deleteBuffer(record.buffer);
      if (program) gl.deleteProgram(program);
      if (territorialProgram) gl.deleteProgram(territorialProgram);
    }
    available = false;
    contextLost = false;
    gpuHealth = 'unchecked';
    selfTestPassed = false;
    selfTestFailureReason = '';
    resetChannelResources();
    territorialBuffers.clear();
  }

  canvas?.addEventListener?.('webglcontextlost', handleContextLost);
  canvas?.addEventListener?.('webglcontextrestored', handleContextRestored);

  return Object.freeze({
    init, setSelection, updateSelectionData, setCountryBoundaryMesh, setTerritorialBoundaries,
    setInteractionStyle: setInteractionStyle, render, clear, dispose,
    handleContextLost, handleContextRestored, runRibbonSelfTest,
    isAvailable: () => available && !contextLost && gpuHealth === 'healthy' && selfTestPassed,
    stats: () => ({
      primaryCount, secondaryCount, hoverCount, primarySegmentCount, secondarySegmentCount, hoverSegmentCount,
      segmentCount: primarySegmentCount + secondarySegmentCount + hoverSegmentCount,
      ribbonTriangleCount: (primaryCount + secondaryCount + hoverCount) / 3,
      bufferBuildCount, bufferBuildMs, geometryRevision, countryBoundaryRevision,
      viewDrawCount, renderFailureCount, contextLost, contextLossCount, contextRestoreCount,
      gpuHealth, selfTestPassed, selfTestFailureReason, selfTestCount, selfTestMs, lastSelfTestContextRevision,
      renderSucceeded: lastRenderResult?.succeeded ?? false,
      channels: Object.fromEntries(Object.entries(channelMetrics).map(([name, metrics]) => [name, {
        rebuildCount: metrics.rebuildCount,
        rebuildMs: metrics.rebuildMs,
        buildFailed: metrics.buildFailed,
        drawSucceeded: lastRenderResult?.channels?.[name]?.drawSucceeded ?? false,
      }])),
      territorialBoundaryRevision, territorialBoundarySegmentCount, territorialBoundaryBufferBytes,
      territorialBoundaryBuildCount, territorialBoundaryDrawCalls: territorialBuffers.size,
      coverage: {
        hover: { ...coverage.hover, renderedKeys: [...coverage.hover.renderedKeys], missingKeys: [...coverage.hover.missingKeys] },
        primary: { ...coverage.primary, renderedKeys: [...coverage.primary.renderedKeys], missingKeys: [...coverage.primary.missingKeys] },
        secondary: { ...coverage.secondary, renderedKeys: [...coverage.secondary.renderedKeys], missingKeys: [...coverage.secondary.missingKeys] },
      },
      drawCoverage: lastRenderResult ? Object.fromEntries(Object.entries(lastRenderResult.channels).map(([name, channel]) => [name, {
        ...channel,
        renderedKeys: [...channel.renderedKeys],
        missingKeys: [...channel.missingKeys],
      }])) : null,
    }),
  });
}
