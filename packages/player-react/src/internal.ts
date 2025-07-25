import type {Project} from '@twick/core';
import {Player, Stage, getFullPreviewSettings} from '@twick/core';

import {Vector2} from '@twick/core';

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

  private get fps() {
    const attr = this.getAttribute('fps');
    return attr ? parseFloat(attr) : (this.defaultSettings?.fps ?? 60);
  }

  private get quality() {
    const attr = this.getAttribute('quality');
    return attr
      ? parseFloat(attr)
      : (this.defaultSettings?.resolutionScale ?? 1);
  }

  private get width() {
    const attr = this.getAttribute('width');
    return attr ? parseFloat(attr) : (this.defaultSettings?.size.width ?? 0);
  }

  private get height() {
    const attr = this.getAttribute('height');
    return attr ? parseFloat(attr) : (this.defaultSettings?.size.height ?? 0);
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
  private playing = false;
  private stage = new Stage();

  private time: number = 0;
  private duration: number = 0; // in frames
  private looping = true;
  private volume = 1;
  private volumeChangeRequested = true;

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
    this.setPlaying(this.playing);
  }

  private setPlaying(value: boolean) {
    if (this.state === State.Ready && value) {
      this.player?.togglePlayback(true);
      this.playing = true;
    } else {
      this.player?.togglePlayback(false);
      this.playing = false;
    }
  }

  private async updateProject(project: Project) {
    const playing = this.playing;
    this.setState(State.Initial);

    this.abortController?.abort();
    this.abortController = new AbortController();

    this.project = project;
    console.log(project);
    this.defaultSettings = getFullPreviewSettings(this.project);

    const player = new Player(this.project);
    player.setVariables(this.variables);
    player.toggleLoop(this.looping);

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
        this.looping = newValue === 'true';
        this.player?.toggleLoop(newValue === 'true');
        break;
      case 'fps':
      case 'quality':
      case 'width':
      case 'height':
        this.updateSettings();
        break;
      case 'volume':
        this.volume = newValue;
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
    this.time = e.detail;
    this.player?.requestSeek(e.detail * this.player.playback.fps);
    this.volumeChangeRequested = true;
  };

  private handleVolumeChange = (event: Event) => {
    if (!this.project) {
      return;
    }

    const e = event as CustomEvent;
    this.volume = e.detail;

    this.player?.playback.currentScene.adjustVolume(this.volume);
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
      this.player?.playback.currentScene.adjustVolume(this.volume);
      this.volumeChangeRequested = false;
    }
  };

  /**
   * Called on every frame.
   */
  private render = async () => {
    if (this.player && this.project) {
      await this.stage.render(
        this.player.playback.currentScene,
        this.player.playback.previousScene,
      );

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

    const settings = {
      ...this.defaultSettings,
      size: new Vector2(this.width, this.height),
      resolutionScale: this.quality,
      fps: this.fps,
    };
    this.stage.configure(settings);
    this.player?.configure(settings);
  }
}

if (!customElements.get(ID)) {
  customElements.define(ID, TwickPlayer);
}
