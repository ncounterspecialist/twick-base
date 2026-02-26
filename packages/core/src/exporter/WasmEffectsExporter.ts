import {
  applyEffects,
  createEffectContext,
  type EffectContext,
} from '@twick/gl-runtime';
import type {Project} from '../app/Project';
import type {AssetInfo, RendererSettings} from '../app/Renderer';
import type {Exporter} from './Exporter';
import {WasmExporter} from './WasmExporter';

/**
 * WASM exporter that applies GL effects from variables.input.tracks before encoding.
 * Use exporter name '@twick/core/wasm-effects' when rendering with effect tracks.
 */
export class WasmEffectsExporter implements Exporter {
  public static readonly id = '@twick/core/wasm-effects';
  public static readonly displayName = 'Video (Wasm + Effects)';

  public static async create(project: Project, settings: RendererSettings) {
    const inner = await WasmExporter.create(project, settings);
    return new WasmEffectsExporter(project, settings, inner);
  }

  private effectGlCanvas: HTMLCanvasElement | OffscreenCanvas | null = null;
  private effectContext: EffectContext | null = null;
  private effectReadbackFbo: WebGLFramebuffer | null = null;

  constructor(
    private readonly project: Project,
    private readonly settings: RendererSettings,
    private readonly inner: WasmExporter,
  ) {}

  async start(): Promise<void> {
    return this.inner.start();
  }

  async handleFrame(
    canvas: HTMLCanvasElement,
    frame: number,
    sceneFrame: number,
    sceneName: string,
    signal: AbortSignal,
  ): Promise<void> {
    const variables = this.project.variables as Record<string, unknown> | undefined;
    const fps = this.settings.fps ?? this.project.settings.rendering.fps ?? 30;
    const activeEffects = this.project.getActiveEffectsForFrame?.(variables ?? {}, frame, fps) ?? [];

    if (activeEffects.length === 0) {
      return (this.inner as any).handleFrame(canvas, frame, sceneFrame, sceneName, signal);
    }

    const w = canvas.width;
    const h = canvas.height;
    if (w <= 0 || h <= 0) {
      return (this.inner as any).handleFrame(canvas, frame, sceneFrame, sceneName, signal);
    }

    if (!this.effectGlCanvas) {
      this.effectGlCanvas =
        typeof OffscreenCanvas !== 'undefined'
          ? new OffscreenCanvas(w, h)
          : document.createElement('canvas');
      (this.effectGlCanvas as HTMLCanvasElement).width = w;
      (this.effectGlCanvas as HTMLCanvasElement).height = h;
    }
    const glCanvas = this.effectGlCanvas as HTMLCanvasElement & {width: number; height: number};
    if (glCanvas.width !== w || glCanvas.height !== h) {
      glCanvas.width = w;
      glCanvas.height = h;
    }

    if (!this.effectContext) {
      this.effectContext = createEffectContext(glCanvas);
    }

    const gl = this.effectContext.gl;
    const sourceTexture = gl.createTexture();
    if (!sourceTexture) {
      return (this.inner as any).handleFrame(canvas, frame, sceneFrame, sceneName, signal);
    }

    gl.bindTexture(gl.TEXTURE_2D, sourceTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);

    const resultTexture = applyEffects({
      ctx: this.effectContext,
      sourceTexture,
      width: w,
      height: h,
      effects: activeEffects,
    });

    gl.deleteTexture(sourceTexture);

    if (!this.effectReadbackFbo) {
      this.effectReadbackFbo = gl.createFramebuffer();
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.effectReadbackFbo);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      resultTexture,
      0,
    );
    const pixels = new Uint8Array(w * h * 4);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    const outCanvas = document.createElement('canvas');
    outCanvas.width = w;
    outCanvas.height = h;
    const ctx2d = outCanvas.getContext('2d');
    if (ctx2d) {
      const imageData = ctx2d.createImageData(w, h);
      const rowBytes = w * 4;
      for (let y = 0; y < h; y++) {
        imageData.data.set(
          pixels.subarray((h - 1 - y) * rowBytes, (h - y) * rowBytes),
          y * rowBytes,
        );
      }
      ctx2d.putImageData(imageData, 0, 0);
    }

    return (this.inner as any).handleFrame(outCanvas, frame, sceneFrame, sceneName, signal);
  }

  async stop(result?: unknown): Promise<void> {
    return this.inner.stop?.();
  }

  async generateAudio(
    assets: AssetInfo[][],
    startFrame: number,
    endFrame: number,
  ): Promise<void> {
    return this.inner.generateAudio?.(assets, startFrame, endFrame);
  }

  async mergeMedia(): Promise<void> {
    return this.inner.mergeMedia?.();
  }

  async downloadVideos(assets: AssetInfo[][]): Promise<void> {
    return this.inner.downloadVideos?.(assets);
  }
}
