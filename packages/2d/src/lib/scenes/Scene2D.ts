import type {
  AssetInfo,
  FullSceneDescription,
  Inspectable,
  InspectedAttributes,
  InspectedElement,
  Scene,
  ThreadGeneratorFactory,
} from '@twick/core';
import {
  GeneratorScene,
  PlaybackState,
  SceneRenderEvent,
  Vector2,
  transformVectorAsPoint,
  useLogger,
} from '@twick/core';
import type {Node} from '../components';
import {Audio, Media, Video, View2D} from '../components';

export class Scene2D extends GeneratorScene<View2D> implements Inspectable {
  private view: View2D | null = null;
  private registeredNodes = new Map<string, Node>();
  private readonly nodeCounters = new Map<string, number>();
  private assetHash = Date.now().toString();

  public constructor(
    description: FullSceneDescription<ThreadGeneratorFactory<View2D>>,
  ) {
    super(description);
    this.recreateView();
    if (import.meta.hot) {
      import.meta.hot.on('twick:assets', () => {
        this.assetHash = Date.now().toString();
        this.getView().assetHash(this.assetHash);
      });
    }
  }

  public getView(): View2D {
    return this.view!;
  }

  public override next(): Promise<void> {
    this.getView()
      ?.playbackState(this.playback.state)
      .globalTime(this.playback.time);
    return super.next();
  }

  public async draw(context: CanvasRenderingContext2D) {
    context.save();
    this.renderLifecycle.dispatch([SceneRenderEvent.BeforeRender, context]);
    context.save();
    this.renderLifecycle.dispatch([SceneRenderEvent.BeginRender, context]);
    this.getView()
      .playbackState(this.playback.state)
      .globalTime(this.playback.time)
      .fps(this.playback.fps);
    // When paused, seek all media to current time so Video/audio elements stay in
    // sync after a user seek (e.g. seekTo). When playing, do not sync here—the
    // Video draw path (fastSeekedVideo) handles playback and only seeks when out of sync.
    if (this.playback.state === PlaybackState.Paused) {
      this.syncAllMediaToCurrentTime();
    }
    await this.getView().render(context);
    this.renderLifecycle.dispatch([SceneRenderEvent.FinishRender, context]);
    context.restore();
    this.renderLifecycle.dispatch([SceneRenderEvent.AfterRender, context]);
    context.restore();
  }

  public override reset(previousScene?: Scene): Promise<void> {
    for (const key of this.registeredNodes.keys()) {
      try {
        this.registeredNodes.get(key)!.dispose();
      } catch (e: any) {
        this.logger.error(e);
      }
    }
    this.registeredNodes.clear();
    this.registeredNodes = new Map<string, Node>();
    this.nodeCounters.clear();
    this.recreateView();

    return super.reset(previousScene);
  }

  public inspectPosition(x: number, y: number): InspectedElement | null {
    const node = this.getNodeByPosition(x, y);
    return node?.key;
  }

  public getNodeByPosition(x: number, y: number): Node | null {
    return this.execute(() => this.getView().hit(new Vector2(x, y)) ?? null);
  }

  public validateInspection(
    element: InspectedElement | null,
  ): InspectedElement | null {
    return this.getNode(element)?.key ?? null;
  }

  public inspectAttributes(
    element: InspectedElement,
  ): InspectedAttributes | null {
    const node = this.getNode(element);
    if (!node) return null;

    const attributes: Record<string, any> = {
      stack: node.creationStack,
      key: node.key,
    };
    for (const {key, meta, signal} of node) {
      if (!meta.inspectable) continue;
      attributes[key] = signal();
    }

    return attributes;
  }

  public drawOverlay(
    element: InspectedElement,
    matrix: DOMMatrix,
    context: CanvasRenderingContext2D,
  ): void {
    const node = this.getNode(element);
    if (node) {
      this.execute(() => {
        node.drawOverlay(context, matrix.multiply(node.localToWorld()));
      });
    }
  }

  public transformMousePosition(x: number, y: number): Vector2 | null {
    return transformVectorAsPoint(
      new Vector2(x, y),
      this.getView().localToParent().inverse(),
    );
  }

  public registerNode(node: Node, key?: string): [string, () => void] {
    const className = node.constructor?.name ?? 'unknown';
    const counter = (this.nodeCounters.get(className) ?? 0) + 1;
    this.nodeCounters.set(className, counter);

    if (key && this.registeredNodes.has(key)) {
      useLogger().error({
        message: `Duplicated node key: "${key}".`,
        inspect: key,
        stack: new Error().stack,
      });
      key = undefined;
    }

    key ??= `${this.name}/${className}[${counter}]`;
    this.registeredNodes.set(key, node);
    const currentNodeMap = this.registeredNodes;
    return [key, () => currentNodeMap.delete(key!)];
  }

  public getNode(key: any): Node | null {
    if (typeof key !== 'string') return null;
    return this.registeredNodes.get(key) ?? null;
  }

  public *getDetachedNodes() {
    for (const node of this.registeredNodes.values()) {
      if (!node.parent() && node !== this.view) yield node;
    }
  }

  public override getMediaAssets(): Array<AssetInfo> {
    // During rendering, ensure all media elements are marked as playing
    // so they can be collected for audio extraction
    const playbackState = this.playback.state;
    const isRendering = playbackState === PlaybackState.Rendering;
    
    // Get all video and audio nodes
    const allVideos = Array.from(this.registeredNodes.values())
      .filter((node): node is Video => node instanceof Video);
    const allAudios = Array.from(this.registeredNodes.values())
      .filter((node): node is Audio => node instanceof Audio);
    
    // During rendering, mark all media as playing if they have a valid src
    if (isRendering) {
      allVideos.forEach(video => {
        const src = video.src();
        if (src && src !== 'undefined' && !video.isPlaying()) {
          // Set playing state directly for rendering mode
          (video as any).playing(true);
        }
      });
      allAudios.forEach(audio => {
        const src = audio.src();
        if (src && src !== 'undefined' && !audio.isPlaying()) {
          // Set playing state directly for rendering mode
          (audio as any).playing(true);
        }
      });
    }
    
    const playingVideos = allVideos.filter(video => video.isPlaying());
    const playingAudios = allAudios.filter(audio => audio.isPlaying());

    const returnObjects: AssetInfo[] = [];

    returnObjects.push(
      ...playingVideos.map(vid => ({
        key: vid.key,
        type: 'video' as const,
        src: vid.src(),
        decoder: vid.decoder(),
        playbackRate:
          typeof vid.playbackRate === 'function'
            ? vid.playbackRate()
            : vid.playbackRate,
        volume: vid.getVolume(),
        currentTime: vid.getCurrentTime(),
        duration: vid.getDuration(),
      })),
    );

    returnObjects.push(
      ...playingAudios.map(audio => ({
        key: audio.key,
        type: 'audio' as const,
        src: audio.src(),
        playbackRate:
          typeof audio.playbackRate === 'function'
            ? audio.playbackRate()
            : audio.playbackRate,
        volume: audio.getVolume(),
        currentTime: audio.getCurrentTime(),
        duration: audio.getDuration(),
      })),
    );

    return returnObjects;
  }

  /**
   * Seek all registered Media nodes to the current playback time.
   * Passes draw time (playback.time) so media sync does not depend on node time signal.
   */
  private syncAllMediaToCurrentTime(): void {
    const drawTime = this.playback.time;
    const mediaNodes = Array.from(this.registeredNodes.values()).filter(
      (node): node is Media => node instanceof Media,
    );
    for (const media of mediaNodes) {
      try {
        media.syncToCurrentTime(drawTime);
      } catch (e) {
        this.logger.warn({
          message: `syncAllMediaToCurrentTime: skipped node ${media.key ?? 'unknown'}`,
          object: e,
        });
      }
    }
  }

  public override stopAllMedia() {
    const playingMedia = Array.from(this.registeredNodes.values())
      .filter((node): node is Media => node instanceof Media)
      .filter(video => (video as Media).isPlaying());

    for (const media of playingMedia) {
      media.dispose();
    }
  }

  public override adjustVolume(volumeScale: number) {
    const mediaNodes = Array.from(this.registeredNodes.values()).filter(
      (node): node is Media => node instanceof Media,
    );

    for (const media of mediaNodes) {
      media.setVolume(media.getVolume() * volumeScale);
    }
  }

  protected recreateView() {
    this.execute(() => {
      const size = this.getSize();
      this.view = new View2D({
        position: size.scale(this.resolutionScale / 2),
        scale: this.resolutionScale,
        assetHash: this.assetHash,
        size,
      });
    });
  }
}
