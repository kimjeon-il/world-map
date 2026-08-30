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

function ribbonVerticesForSegments(segments) {
  const values = [];
  for (const [[startLon, startLat], [endLon, endLat]] of segments) appendRibbonSegment(values, startLon, startLat, endLon, endLat);
  return values;
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
        for (const value of item.ribbonVertices) values.push(value);
        itemSegmentCount = Math.max(0, Number(item.segmentCount || item.ribbonVertices.length / 36));
      } else if (!item?.missing) {
        for (const geometry of flattenSelectionGeometry(item?.geometry)) {
          const segments = buildSelectionBoundarySegments(geometry, { densify: true });
          itemSegmentCount += segments.length;
          for (const value of ribbonVerticesForSegments(segments)) values.push(value);
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

export function createSelectionEmphasisRenderer({ canvas, projectionForView, getSize, getDpr } = {}) {
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

  function init() {
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
    available = true;
    return true;
  }

  function updateBuffer(buffer, nextItems) {
    const data = buildSelectionBoundaryBufferData(nextItems);
    try {
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data.values), gl.STATIC_DRAW);
    } catch (_) {
      return {
        vertexCount: 0,
        coverage: coverageChannel(nextItems, [], nextItems.map(item => item?.key).filter(Boolean), 0),
      };
    }
    return {
      vertexCount: data.values.length / 6,
      coverage: coverageChannel(nextItems, data.renderedKeys, data.missingKeys, data.segmentCount),
    };
  }

  function updatePointBuffer(buffer, nextItems) {
    const values = [];
    for (const item of nextItems) for (const geometry of flattenSelectionGeometry(item.geometry)) {
      for (const point of buildSelectionPointCoordinates(geometry)) values.push(...point);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(values), gl.STATIC_DRAW);
    return values.length / 2;
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
    const nextRevision = String(revision || '');
    if (nextRevision === territorialBoundaryRevision) return false;
    territorialBoundaryRevision = nextRevision;
    territorialBoundarySegmentCount = 0;
    territorialBoundaryBufferBytes = 0;
    if (!available) return false;
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
          appendRibbonSegment(ribbon, startLon, startLat, endLon, endLat);
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
    const item = pairs.length ? {
      key: `country:${key}`,
      ribbonVertices: new Float32Array(ribbonValues),
      segmentCount: pairs.length / 2,
    } : null;
    countryRibbonCache.set(cacheKey, item);
    return item;
  }

  function countryRequestItem(id) {
    const key = String(id || '');
    if (!key) return null;
    return countryRibbonItem(key) || { key: `country:${key}`, missing: true };
  }

  function geometryIdentity(feature) {
    if (feature?.ribbonVertices) return feature.ribbonVertices;
    if (feature?.type === 'FeatureCollection') return (feature.features || []).map(item => item.geometry);
    if (feature?.type === 'Feature') return feature.geometry;
    return feature;
  }

  function sameItems(left = [], right = []) {
    return left.length === right.length && left.every((item, index) => {
      const other = right[index];
      const a = item.ribbonVertices || geometryIdentity(item.geometry);
      const b = other?.ribbonVertices || geometryIdentity(other?.geometry);
      return item.key === other?.key && (Array.isArray(a) ? a.length === b?.length && a.every((value, childIndex) => value === b[childIndex]) : a === b);
    });
  }

  function setSelection({
    hover = [], primary = [], secondary = [], revision = 0,
    countryHoverId = '', countryPrimaryId = '', countrySecondaryIds = [],
  } = {}) {
    const nextHover = hover.slice();
    const nextPrimary = primary.slice();
    const nextSecondary = secondary.slice();
    const countryHover = countryRequestItem(countryHoverId);
    const countryPrimary = countryRequestItem(countryPrimaryId);
    if (countryHover) nextHover.push(countryHover);
    if (countryPrimary) nextPrimary.push(countryPrimary);
    for (const id of countrySecondaryIds || []) {
      const item = countryRequestItem(id);
      if (item) nextSecondary.push(item);
    }
    if (Number(revision) === geometryRevision && sameItems(items.hover, nextHover) && sameItems(items.primary, nextPrimary) && sameItems(items.secondary, nextSecondary)) return false;
    items = { hover: nextHover, primary: nextPrimary, secondary: nextSecondary };
    geometryRevision = Number(revision || 0);
    if (!available) {
      coverage = emptyCoverage(items);
      primaryCount = secondaryCount = hoverCount = 0;
      primarySegmentCount = secondarySegmentCount = hoverSegmentCount = 0;
      primaryPointCount = secondaryPointCount = hoverPointCount = 0;
      return false;
    }
    const started = performance.now();
    const primaryData = updateBuffer(primaryBuffer, items.primary);
    const secondaryData = updateBuffer(secondaryBuffer, items.secondary);
    const hoverData = updateBuffer(hoverBuffer, items.hover);
    primaryCount = primaryData.vertexCount;
    secondaryCount = secondaryData.vertexCount;
    primarySegmentCount = primaryData.coverage.segmentCount;
    secondarySegmentCount = secondaryData.coverage.segmentCount;
    hoverCount = hoverData.vertexCount;
    hoverSegmentCount = hoverData.coverage.segmentCount;
    coverage = Object.freeze({
      hover: hoverData.coverage,
      primary: primaryData.coverage,
      secondary: secondaryData.coverage,
    });
    primaryPointCount = updatePointBuffer(primaryPointBuffer, items.primary);
    secondaryPointCount = updatePointBuffer(secondaryPointBuffer, items.secondary);
    hoverPointCount = updatePointBuffer(hoverPointBuffer, items.hover);
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
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    const view = { width, height, translate, scale, rows, flatCenter, mode };
    drawTerritorialBoundaries(view, viewState);
    gl.useProgram(program);
    setViewUniforms(programInfo, view);
    const uniforms = programInfo.uniforms;
    gl.uniform1f(uniforms.uDpr, dpr);
    const primary = interactionStyle.selection.primary;
    const secondary = interactionStyle.selection.secondary;
    drawRibbon(hoverBuffer, hoverCount, interactionStyle.hover.width, interactionStyle.hover.alpha, viewState, interactionStyle.hover.color);
    drawRibbon(secondaryBuffer, secondaryCount, secondary.outerWidth, secondary.casingAlpha, viewState, interactionStyle.selection.casingColor);
    drawRibbon(secondaryBuffer, secondaryCount, secondary.innerWidth, secondary.innerAlpha, viewState, interactionStyle.selection.color);
    drawRibbon(primaryBuffer, primaryCount, primary.outerWidth, primary.casingAlpha, viewState, interactionStyle.selection.casingColor);
    drawRibbon(primaryBuffer, primaryCount, primary.innerWidth, primary.innerAlpha, viewState, interactionStyle.selection.color);
    drawPoints(hoverPointBuffer, hoverPointCount, interactionStyle.hover.alpha, interactionStyle.hover.color);
    drawPoints(secondaryPointBuffer, secondaryPointCount, secondary.casingAlpha, interactionStyle.selection.casingColor);
    drawPoints(secondaryPointBuffer, secondaryPointCount, secondary.innerAlpha, interactionStyle.selection.color);
    drawPoints(primaryPointBuffer, primaryPointCount, primary.casingAlpha, interactionStyle.selection.casingColor);
    drawPoints(primaryPointBuffer, primaryPointCount, primary.innerAlpha, interactionStyle.selection.color);
    gl.disable(gl.BLEND);
    return true;
  }

  function clear() {
    items = { hover: [], primary: [], secondary: [] }; geometryRevision = -1;
    coverage = emptyCoverage(items);
    primaryCount = secondaryCount = hoverCount = primarySegmentCount = secondarySegmentCount = hoverSegmentCount = primaryPointCount = secondaryPointCount = hoverPointCount = 0;
    if (available) render({ projection: 'flat', size: getSize?.() || { width: 1, height: 1 }, dpr: getDpr?.() || 1 });
  }

  return Object.freeze({
    init, setSelection, setCountryBoundaryMesh, setTerritorialBoundaries, setInteractionStyle: setInteractionStyle, render, clear, isAvailable: () => available,
    stats: () => ({
      primaryCount, secondaryCount, hoverCount, primarySegmentCount, secondarySegmentCount, hoverSegmentCount,
      segmentCount: primarySegmentCount + secondarySegmentCount + hoverSegmentCount,
      ribbonTriangleCount: (primaryCount + secondaryCount + hoverCount) / 3,
      bufferBuildCount, bufferBuildMs, geometryRevision, countryBoundaryRevision,
      territorialBoundaryRevision, territorialBoundarySegmentCount, territorialBoundaryBufferBytes,
      territorialBoundaryBuildCount, territorialBoundaryDrawCalls: territorialBuffers.size,
      coverage: {
        hover: { ...coverage.hover, renderedKeys: [...coverage.hover.renderedKeys], missingKeys: [...coverage.hover.missingKeys] },
        primary: { ...coverage.primary, renderedKeys: [...coverage.primary.renderedKeys], missingKeys: [...coverage.primary.missingKeys] },
        secondary: { ...coverage.secondary, renderedKeys: [...coverage.secondary.renderedKeys], missingKeys: [...coverage.secondary.missingKeys] },
      },
    }),
  });
}
