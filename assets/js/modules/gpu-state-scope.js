function safeGet(gl, parameter, fallback = null) {
  try { return gl.getParameter(parameter); }
  catch (_) { return fallback; }
}

function safeEnabled(gl, capability) {
  try { return gl.isEnabled(capability); }
  catch (_) { return false; }
}

function restoreCapability(gl, capability, enabled) {
  if (enabled) gl.enable(capability);
  else gl.disable(capability);
}

export function captureGpuState(gl, { textureUnits = 4 } = {}) {
  if (!gl) return null;
  const webGl2 = typeof globalThis.WebGL2RenderingContext !== 'undefined'
    && gl instanceof globalThis.WebGL2RenderingContext;
  const activeTexture = safeGet(gl, gl.ACTIVE_TEXTURE, gl.TEXTURE0);
  const textures = [];
  const unitCount = Math.max(1, Math.min(Number(textureUnits) || 1, Number(safeGet(gl, gl.MAX_COMBINED_TEXTURE_IMAGE_UNITS, 1)) || 1));
  for (let unit = 0; unit < unitCount; unit += 1) {
    try {
      gl.activeTexture(gl.TEXTURE0 + unit);
      textures.push({
        unit,
        texture2d: safeGet(gl, gl.TEXTURE_BINDING_2D),
        textureCube: safeGet(gl, gl.TEXTURE_BINDING_CUBE_MAP),
      });
    } catch (_) {}
  }
  try { gl.activeTexture(activeTexture); } catch (_) {}
  return {
    webGl2,
    framebuffer: safeGet(gl, gl.FRAMEBUFFER_BINDING),
    drawFramebuffer: webGl2 ? safeGet(gl, gl.DRAW_FRAMEBUFFER_BINDING) : null,
    readFramebuffer: webGl2 ? safeGet(gl, gl.READ_FRAMEBUFFER_BINDING) : null,
    viewport: safeGet(gl, gl.VIEWPORT, [0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight]),
    scissorBox: safeGet(gl, gl.SCISSOR_BOX, [0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight]),
    program: safeGet(gl, gl.CURRENT_PROGRAM),
    vertexArray: webGl2 ? safeGet(gl, gl.VERTEX_ARRAY_BINDING) : null,
    arrayBuffer: safeGet(gl, gl.ARRAY_BUFFER_BINDING),
    elementArrayBuffer: safeGet(gl, gl.ELEMENT_ARRAY_BUFFER_BINDING),
    renderbuffer: safeGet(gl, gl.RENDERBUFFER_BINDING),
    pixelPackBuffer: webGl2 ? safeGet(gl, gl.PIXEL_PACK_BUFFER_BINDING) : null,
    pixelUnpackBuffer: webGl2 ? safeGet(gl, gl.PIXEL_UNPACK_BUFFER_BINDING) : null,
    packAlignment: safeGet(gl, gl.PACK_ALIGNMENT, 4),
    unpackAlignment: safeGet(gl, gl.UNPACK_ALIGNMENT, 4),
    activeTexture,
    textures,
    blend: safeEnabled(gl, gl.BLEND),
    depth: safeEnabled(gl, gl.DEPTH_TEST),
    stencil: safeEnabled(gl, gl.STENCIL_TEST),
    cull: safeEnabled(gl, gl.CULL_FACE),
    scissor: safeEnabled(gl, gl.SCISSOR_TEST),
    blendSrcRgb: safeGet(gl, gl.BLEND_SRC_RGB, gl.ONE),
    blendDstRgb: safeGet(gl, gl.BLEND_DST_RGB, gl.ZERO),
    blendSrcAlpha: safeGet(gl, gl.BLEND_SRC_ALPHA, gl.ONE),
    blendDstAlpha: safeGet(gl, gl.BLEND_DST_ALPHA, gl.ZERO),
    blendEquationRgb: safeGet(gl, gl.BLEND_EQUATION_RGB, gl.FUNC_ADD),
    blendEquationAlpha: safeGet(gl, gl.BLEND_EQUATION_ALPHA, gl.FUNC_ADD),
    colorMask: safeGet(gl, gl.COLOR_WRITEMASK, [true, true, true, true]),
    depthMask: safeGet(gl, gl.DEPTH_WRITEMASK, true),
    depthFunc: safeGet(gl, gl.DEPTH_FUNC, gl.LESS),
    depthRange: safeGet(gl, gl.DEPTH_RANGE, [0, 1]),
    cullFaceMode: safeGet(gl, gl.CULL_FACE_MODE, gl.BACK),
    frontFace: safeGet(gl, gl.FRONT_FACE, gl.CCW),
    stencilMaskFront: safeGet(gl, gl.STENCIL_WRITEMASK, 0xff),
    stencilMaskBack: webGl2 ? safeGet(gl, gl.STENCIL_BACK_WRITEMASK, 0xff) : 0xff,
    stencilFuncFront: safeGet(gl, gl.STENCIL_FUNC, gl.ALWAYS),
    stencilRefFront: safeGet(gl, gl.STENCIL_REF, 0),
    stencilValueMaskFront: safeGet(gl, gl.STENCIL_VALUE_MASK, 0xff),
    stencilFailFront: safeGet(gl, gl.STENCIL_FAIL, gl.KEEP),
    stencilDepthFailFront: safeGet(gl, gl.STENCIL_PASS_DEPTH_FAIL, gl.KEEP),
    stencilDepthPassFront: safeGet(gl, gl.STENCIL_PASS_DEPTH_PASS, gl.KEEP),
    stencilFuncBack: webGl2 ? safeGet(gl, gl.STENCIL_BACK_FUNC, gl.ALWAYS) : safeGet(gl, gl.STENCIL_FUNC, gl.ALWAYS),
    stencilRefBack: webGl2 ? safeGet(gl, gl.STENCIL_BACK_REF, 0) : safeGet(gl, gl.STENCIL_REF, 0),
    stencilValueMaskBack: webGl2 ? safeGet(gl, gl.STENCIL_BACK_VALUE_MASK, 0xff) : safeGet(gl, gl.STENCIL_VALUE_MASK, 0xff),
    stencilFailBack: webGl2 ? safeGet(gl, gl.STENCIL_BACK_FAIL, gl.KEEP) : safeGet(gl, gl.STENCIL_FAIL, gl.KEEP),
    stencilDepthFailBack: webGl2 ? safeGet(gl, gl.STENCIL_BACK_PASS_DEPTH_FAIL, gl.KEEP) : safeGet(gl, gl.STENCIL_PASS_DEPTH_FAIL, gl.KEEP),
    stencilDepthPassBack: webGl2 ? safeGet(gl, gl.STENCIL_BACK_PASS_DEPTH_PASS, gl.KEEP) : safeGet(gl, gl.STENCIL_PASS_DEPTH_PASS, gl.KEEP),
    clearColor: safeGet(gl, gl.COLOR_CLEAR_VALUE, [0, 0, 0, 0]),
    clearDepth: safeGet(gl, gl.DEPTH_CLEAR_VALUE, 1),
    clearStencil: safeGet(gl, gl.STENCIL_CLEAR_VALUE, 0),
  };
}

export function restoreGpuState(gl, state) {
  if (!gl || !state) return false;
  try {
    if (state.webGl2) {
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, state.drawFramebuffer);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, state.readFramebuffer);
      gl.bindVertexArray(state.vertexArray);
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, state.framebuffer);
    }
    gl.useProgram(state.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, state.arrayBuffer);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, state.elementArrayBuffer);
    gl.bindRenderbuffer(gl.RENDERBUFFER, state.renderbuffer);
    if (state.webGl2) {
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, state.pixelPackBuffer);
      gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, state.pixelUnpackBuffer);
    }
    gl.pixelStorei(gl.PACK_ALIGNMENT, state.packAlignment);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, state.unpackAlignment);
    for (const entry of state.textures || []) {
      gl.activeTexture(gl.TEXTURE0 + entry.unit);
      gl.bindTexture(gl.TEXTURE_2D, entry.texture2d);
      gl.bindTexture(gl.TEXTURE_CUBE_MAP, entry.textureCube);
    }
    gl.activeTexture(state.activeTexture);
    gl.viewport(...state.viewport);
    gl.scissor(...state.scissorBox);
    restoreCapability(gl, gl.BLEND, state.blend);
    restoreCapability(gl, gl.DEPTH_TEST, state.depth);
    restoreCapability(gl, gl.STENCIL_TEST, state.stencil);
    restoreCapability(gl, gl.CULL_FACE, state.cull);
    restoreCapability(gl, gl.SCISSOR_TEST, state.scissor);
    gl.blendEquationSeparate(state.blendEquationRgb, state.blendEquationAlpha);
    gl.blendFuncSeparate(state.blendSrcRgb, state.blendDstRgb, state.blendSrcAlpha, state.blendDstAlpha);
    gl.colorMask(...state.colorMask);
    gl.depthMask(state.depthMask);
    gl.depthFunc(state.depthFunc);
    gl.depthRange(...state.depthRange);
    gl.cullFace(state.cullFaceMode);
    gl.frontFace(state.frontFace);
    gl.stencilMaskSeparate(gl.FRONT, state.stencilMaskFront);
    gl.stencilMaskSeparate(gl.BACK, state.stencilMaskBack);
    gl.stencilFuncSeparate(gl.FRONT, state.stencilFuncFront, state.stencilRefFront, state.stencilValueMaskFront);
    gl.stencilFuncSeparate(gl.BACK, state.stencilFuncBack, state.stencilRefBack, state.stencilValueMaskBack);
    gl.stencilOpSeparate(gl.FRONT, state.stencilFailFront, state.stencilDepthFailFront, state.stencilDepthPassFront);
    gl.stencilOpSeparate(gl.BACK, state.stencilFailBack, state.stencilDepthFailBack, state.stencilDepthPassBack);
    gl.clearColor(...state.clearColor);
    gl.clearDepth(state.clearDepth);
    gl.clearStencil(state.clearStencil);
    return true;
  } catch (_) {
    return false;
  }
}

export function withGpuStateScope(gl, callback, options) {
  const state = captureGpuState(gl, options);
  let value;
  let error = null;
  try {
    if (state?.webGl2) gl.bindVertexArray(null);
    if (state?.webGl2) {
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      gl.bindBuffer(gl.PIXEL_UNPACK_BUFFER, null);
    }
    value = callback(state);
  } catch (caught) {
    error = caught;
  }
  const restored = restoreGpuState(gl, state);
  if (error) throw error;
  return Object.freeze({ value, restored, previousFramebuffer: state?.framebuffer || null });
}
