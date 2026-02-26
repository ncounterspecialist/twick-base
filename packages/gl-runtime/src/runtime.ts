export interface ActiveEffect {
  /**
   * GLSL fragment shader source to apply.
   * The runtime is agnostic to effect identity; higher layers supply fragments.
   */
  fragment: string;
  /** Normalized progress for time-based effects (0–1). */
  progress: number;
  /** Overall effect intensity (recommended 0–1, clamped by callers). */
  intensity: number;
}

export interface EffectContext {
  gl: WebGLRenderingContext;
  programCache: Map<string, WebGLProgram>;
  quadBuffer: WebGLBuffer;
  texCoordBuffer: WebGLBuffer;
  framebuffers: WebGLFramebuffer[];
  textures: WebGLTexture[];
}

const BASIC_VERTEX_SHADER = `
  attribute vec2 a_position;
  attribute vec2 a_texCoord;

  varying vec2 v_texCoord;

  void main() {
    v_texCoord = a_texCoord;
    gl_Position = vec4(a_position, 0.0, 1.0);
  }
`;

function createShader(
  gl: WebGLRenderingContext,
  type: number,
  source: string,
): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) {
    throw new Error('Failed to create shader');
  }
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader) || 'Unknown error';
    gl.deleteShader(shader);
    throw new Error(`Failed to compile shader: ${info}`);
  }
  return shader;
}

function createProgram(
  gl: WebGLRenderingContext,
  vertexSrc: string,
  fragmentSrc: string,
): WebGLProgram {
  const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexSrc);
  const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentSrc);
  const program = gl.createProgram();
  if (!program) {
    throw new Error('Failed to create program');
  }
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(program) || 'Unknown error';
    gl.deleteProgram(program);
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    throw new Error(`Failed to link program: ${info}`);
  }
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);
  return program;
}

export function createEffectContext(
  canvas: HTMLCanvasElement | OffscreenCanvas,
): EffectContext {
  const gl =
    (canvas as any).getContext('webgl') ||
    (canvas as any).getContext('experimental-webgl');
  if (!gl) {
    throw new Error('WebGL not supported');
  }

  const quadBuffer = gl.createBuffer();
  if (!quadBuffer) {
    throw new Error('Failed to create quad buffer');
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
  const quadVertices = new Float32Array([
    -1, -1, //
    1, -1,
    -1, 1,
    1, 1,
  ]);
  gl.bufferData(gl.ARRAY_BUFFER, quadVertices, gl.STATIC_DRAW);

  const texCoordBuffer = gl.createBuffer();
  if (!texCoordBuffer) {
    throw new Error('Failed to create texCoord buffer');
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
  const texCoords = new Float32Array([
    0, 0, //
    1, 0,
    0, 1,
    1, 1,
  ]);
  gl.bufferData(gl.ARRAY_BUFFER, texCoords, gl.STATIC_DRAW);

  const framebuffers: WebGLFramebuffer[] = [];
  const textures: WebGLTexture[] = [];

  return {
    gl,
    programCache: new Map(),
    quadBuffer,
    texCoordBuffer,
    framebuffers,
    textures,
  };
}

function ensureRenderTargets(
  ctx: EffectContext,
  width: number,
  height: number,
): void {
  const {gl, framebuffers, textures} = ctx;
  while (framebuffers.length < 2) {
    const fb = gl.createFramebuffer();
    const tex = gl.createTexture();
    if (!fb || !tex) {
      throw new Error('Failed to create framebuffer or texture');
    }
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      width,
      height,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null,
    );
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      tex,
      0,
    );
    framebuffers.push(fb);
    textures.push(tex);
  }

  // Resize existing textures if needed
  for (let i = 0; i < textures.length; i++) {
    gl.bindTexture(gl.TEXTURE_2D, textures[i]);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      width,
      height,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null,
    );
  }
}

export function applyEffects(opts: {
  ctx: EffectContext;
  sourceTexture: WebGLTexture;
  width: number;
  height: number;
  effects: ActiveEffect[];
}): WebGLTexture {
  const {ctx, sourceTexture, width, height, effects} = opts;
  const {gl, programCache, quadBuffer, texCoordBuffer, framebuffers, textures} =
    ctx;

  if (!effects.length) {
    return sourceTexture;
  }

  ensureRenderTargets(ctx, width, height);

  let readTexture = sourceTexture;
  let writeIndex = 0;

  gl.viewport(0, 0, width, height);

  effects.forEach(active => {
    if (!active.fragment) return;

    const cacheKey = active.fragment;
    let program = programCache.get(cacheKey);
    if (!program) {
      program = createProgram(gl, BASIC_VERTEX_SHADER, active.fragment);
      programCache.set(cacheKey, program);
    }

    gl.useProgram(program);

    // Attributes
    const positionLocation = gl.getAttribLocation(program, 'a_position');
    const texCoordLocation = gl.getAttribLocation(program, 'a_texCoord');

    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
    gl.enableVertexAttribArray(texCoordLocation);
    gl.vertexAttribPointer(texCoordLocation, 2, gl.FLOAT, false, 0, 0);

    // Framebuffer & texture
    const fb = framebuffers[writeIndex];
    const targetTex = textures[writeIndex];
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, readTexture);

    const textureLocation = gl.getUniformLocation(program, 'uTexture');
    if (textureLocation) {
      gl.uniform1i(textureLocation, 0);
    }

    const resolutionLocation = gl.getUniformLocation(program, 'uResolution');
    if (resolutionLocation) {
      gl.uniform2f(resolutionLocation, width, height);
    }

    const timeLocation = gl.getUniformLocation(program, 'uTime');
    if (timeLocation) {
      gl.uniform1f(timeLocation, active.progress);
    }

    const intensityLocation = gl.getUniformLocation(program, 'uIntensity');
    if (intensityLocation) {
      gl.uniform1f(intensityLocation, active.intensity);
    }

    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    readTexture = targetTex;
    writeIndex = (writeIndex + 1) % textures.length;
  });

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return readTexture;
}

