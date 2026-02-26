import type {Project} from '@twick/core';
import {Player, Stage, getFullPreviewSettings, Vector2} from '@twick/core';
import {
  applyEffects,
  createEffectContext,
  type ActiveEffect,
  type EffectContext,
} from '@twick/gl-runtime';

const stylesNew = `
.overlay {
	position: absolute;
	left: 0;
	right: 0;
	top: 0;
	bottom: 0;
	display: flex;
	align-items: center;
	justify-content: center;
	opacity: 0;
	transition: opacity 0.1s;
	z-index: 0;
  }
  .canvas {
	width: 100%;
	height: 100%;
	display: block;
	opacity: 1;
	transition: opacity 0.1s;
  }
`;

const TEMPLATE = `<style>${stylesNew}</style><div class="overlay"></div>`;
const ID = 'twick-player';

enum State {
  Initial = 'initial',
  Loading = 'loading',
  Ready = 'ready',
  Error = 'error',
}

class TwickPlayer extends HTMLElement {
  public static get observedAttributes() {
    return [
      'playing',
      'variables',
      'looping',
      'fps',
      'quality',
      'width',
      'height',
      'volume',
    ];
  }

  public get fps() {
    const attr = this.getAttribute('fps');
    return attr ? parseFloat(attr) : (this.defaultSettings?.fps ?? 60);
  }

  public set fps(value: number) {
    if (value != null && Number.isFinite(value)) {
      this.setAttribute('fps', String(value));
    }
  }

  public get quality() {
    const attr = this.getAttribute('quality');
    return attr
      ? parseFloat(attr)
      : (this.defaultSettings?.resolutionScale ?? 1);
  }

  public set quality(value: number) {
    if (value != null && Number.isFinite(value)) {
      this.setAttribute('quality', String(value));
    }
  }

  public get width() {
    const attr = this.getAttribute('width');
    return attr ? parseFloat(attr) : (this.defaultSettings?.size.width ?? 0);
  }

  public set width(value: number) {
    if (Number.isFinite(value)) {
      this.setAttribute('width', String(value));
    }
  }

  public get height() {
    const attr = this.getAttribute('height');
    return attr ? parseFloat(attr) : (this.defaultSettings?.size.height ?? 0);
  }

  public set height(value: number) {
    if (Number.isFinite(value)) {
      this.setAttribute('height', String(value));
    }
  }

  private get variables() {
    try {
      const attr = this.getAttribute('variables');
      return attr ? JSON.parse(attr) : {};
    } catch {
      this.project?.logger.warn(`Project variables could not be parsed.`);
      return {};
    }
  }

  public get volume() {
    return this._volume;
  }

  public set volume(value: number) {
    if (value != null) {
      this.setAttribute('volume', String(value));
    }
  }

  public set playing(value: boolean | string) {
    this.setAttribute(
      'playing',
      value === true || value === 'true' ? 'true' : 'false',
    );
  }

  public set looping(value: boolean | string) {
    this.setAttribute(
      'looping',
      value === true || value === 'true' ? 'true' : 'false',
    );
  }

  private readonly root: ShadowRoot;
  private readonly canvas: HTMLCanvasElement;
  private readonly overlay: HTMLCanvasElement;

  private state = State.Initial;
  private project: Project | null = null;
  private player: Player | null = null;
  private defaultSettings:
    | ReturnType<typeof getFullPreviewSettings>
    | undefined;
  private abortController: AbortController | null = null;
  private _playing = false;
  private stage = new Stage();

  private time: number = 0;
  private duration: number = 0; // in frames
  private _looping = true;
  private _volume = 1;
  private volumeChangeRequested = true;

  /** WebGL canvas and context for applying effects to the live preview. */
  private effectGlCanvas: HTMLCanvasElement | OffscreenCanvas | null = null;
  private effectContext: EffectContext | null = null;
  private effectReadbackFbo: WebGLFramebuffer | null = null;

  /**
   * Optional resolver for active effects at a given time. Set by the host (e.g. twick) so
   * effect logic lives outside twick-base. When set, used for live preview effects.
   */
  public getActiveEffectsForTime?: (
    variables: Record<string, unknown>,
    timeInSec: number,
    fps: number,
  ) => Array<{fragment: string; progress: number; intensity: number}>;

  public constructor() {
    super();
    this.root = this.attachShadow({mode: 'open'});
    this.root.innerHTML = TEMPLATE;

    this.overlay = this.root.querySelector('.overlay')!;
    this.canvas = this.stage.finalBuffer;
    this.canvas.classList.add('canvas');
    this.root.prepend(this.canvas);
    this.setState(State.Initial);
  }

  public setProject(project: Project) {
    this.updateProject(project);
  }

  private setState(state: State) {
    this.state = state;
    this.setPlaying(this._playing);
  }

  private setPlaying(value: boolean) {
    if (this.state === State.Ready && value) {
      this.player?.togglePlayback(true);
      this._playing = true;
    } else {
      this.player?.togglePlayback(false);
      this._playing = false;
    }
  }

  private async updateProject(project: Project) {
    const playing = this._playing;
    this.setState(State.Initial);

    this.abortController?.abort();
    this.abortController = new AbortController();

    this.project = project;
    this.defaultSettings = getFullPreviewSettings(this.project);

    const player = new Player(this.project);
    player.setVariables(this.variables);
    player.toggleLoop(this._looping);

    this.player?.onRender.unsubscribe(this.render);
    this.player?.onFrameChanged.unsubscribe(this.handleFrameChanged);
    this.player?.togglePlayback(false);
    this.player?.deactivate();

    this.player = player;
    this.updateSettings();

    this.setState(State.Ready);
    this.dispatchEvent(new CustomEvent('playerready', {detail: this.player}));

    // Restore previous state
    this.setPlaying(playing);
    this.player.onRender.subscribe(this.render);
    this.player.onFrameChanged.subscribe(this.handleFrameChanged);
  }

  public attributeChangedCallback(name: string, _: any, newValue: any) {
    switch (name) {
      case 'playing':
        this.setPlaying(newValue === 'true');
        break;
      case 'variables':
        this.player?.setVariables(this.variables);
        this.player?.requestSeek(this.player.playback.frame);
        this.player?.playback.reload();
        break;
      case 'looping':
        this._looping = newValue === 'true';
        this.player?.toggleLoop(newValue === 'true');
        break;
      case 'fps':
      case 'quality':
      case 'width':
      case 'height':
        this.updateSettings();
        break;
      case 'volume':
        this._volume = newValue;
        this.volumeChangeRequested = true;
    }
  }

  /**
   * Runs when the element is removed from the DOM.
   */
  public disconnectedCallback() {
    this.player?.deactivate();
    this.player?.onRender.unsubscribe(this.render);

    this.removeEventListener('seekto', this.handleSeekTo);
    this.removeEventListener('volumechange', this.handleVolumeChange);
  }

  /**
   * Runs when the element is added to the DOM.
   */
  public connectedCallback() {
    this.player?.activate();
    this.player?.onRender.subscribe(this.render);

    this.addEventListener('seekto', this.handleSeekTo);
    this.addEventListener('volumechange', this.handleVolumeChange);
  }

  /**
   * Triggered by the timeline.
   */
  private handleSeekTo = (event: Event) => {
    if (!this.project) {
      return;
    }

    const e = event as CustomEvent;
    const timeSec = e.detail as number;
    const frame = timeSec * this.player!.playback.fps;
    this.time = timeSec;
    this.player?.requestSeek(frame);
    this.volumeChangeRequested = true;
  };

  private handleVolumeChange = (event: Event) => {
    if (!this.project) {
      return;
    }

    const e = event as CustomEvent;
    this._volume = e.detail;

    this.player?.playback.currentScene.adjustVolume(this._volume);
  };

  /**
   * Triggered by the player.
   */
  private handleFrameChanged = (frame: number) => {
    if (!this.project || !this.player) {
      return;
    }
    this.time = frame / this.player.playback.fps;

    if (this.volumeChangeRequested || frame === 0) {
      this.player?.playback.currentScene.adjustVolume(this._volume);
      this.volumeChangeRequested = false;
    }
  };

  /**
   * Resolve active effects for the given time. Uses host-provided callback when set.
   */
  private resolveActiveEffectsForTime(timeInSec: number): ActiveEffect[] {
    if (this.getActiveEffectsForTime) {
      const fps = this.player?.playback.fps ?? 30;
      return this.getActiveEffectsForTime(this.variables, timeInSec, fps);
    }
    return [];
  }

  /**
   * Apply GL effects to the current frame and draw the result back to the stage canvas.
   */
  private applyEffectsToFinalBuffer(): void {
    const canvas = this.stage.finalBuffer;
    const w = canvas.width;
    const h = canvas.height;
    if (w <= 0 || h <= 0) return;

    const activeEffects = this.resolveActiveEffectsForTime(this.time);
    if (activeEffects.length === 0) return;

    if (!this.effectGlCanvas) {
      this.effectGlCanvas = typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(w, h)
        : document.createElement('canvas');
      (this.effectGlCanvas as HTMLCanvasElement).width = w;
      (this.effectGlCanvas as HTMLCanvasElement).height = h;
    }
    const glCanvas = this.effectGlCanvas as HTMLCanvasElement & { width: number; height: number };
    if (glCanvas.width !== w || glCanvas.height !== h) {
      glCanvas.width = w;
      glCanvas.height = h;
    }

    if (!this.effectContext) {
      this.effectContext = createEffectContext(glCanvas);
    }

    const gl = this.effectContext.gl;
    const sourceTexture = gl.createTexture();
    if (!sourceTexture) return;

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

    // Read back from the result texture (it's an FBO attachment) via a readback FBO
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

    const ctx2d = canvas.getContext('2d');
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
  }

  /**
   * Called on every frame.
   */
  private render = async () => {
    if (this.player && this.project) {
      await this.stage.render(
        this.player.playback.currentScene,
        this.player.playback.previousScene,
      );

      this.applyEffectsToFinalBuffer();

      this.dispatchEvent(new CustomEvent('timeupdate', {detail: this.time}));

      const durationInFrames = this.player.playback.duration;
      if (durationInFrames === this.duration) {
        return;
      }

      this.duration = durationInFrames;

      const durationInSeconds = durationInFrames / this.player.playback.fps;
      this.dispatchEvent(
        new CustomEvent('duration', {detail: durationInSeconds}),
      );
    }
  };

  private updateSettings() {
    if (!this.defaultSettings) {
      return;
    }

    // Use the requested quality (resolutionScale) instead of forcing 1,
    // so the preview canvas can render at higher internal resolution.
    const resolutionScale =
      Number.isFinite(this.quality) && this.quality > 0
        ? this.quality
        : this.defaultSettings.resolutionScale ?? 1;

    const settings = {
      ...this.defaultSettings,
      size: new Vector2(this.width, this.height),
      resolutionScale,
      fps: this.fps,
    };
    this.stage.configure(settings);
    this.player?.configure(settings);
  }
}

if (!customElements.get(ID)) {
  customElements.define(ID, TwickPlayer);
}
