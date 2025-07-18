import type {SerializedVector2, SignalValue, SimpleSignal} from '@twick/core';
import {BBox, DependencyContext, PlaybackState} from '@twick/core';
import Hls from 'hls.js';
import {computed, initial, nodeName, signal} from '../decorators';
import type {DesiredLength} from '../partials';
import {drawImage} from '../utils';
import {ImageCommunication} from '../utils/video/ffmpeg-client';
import {dropExtractor, getFrame} from '../utils/video/mp4-parser-manager';
import type {MediaProps} from './Media';
import {Media} from './Media';

export interface VideoProps extends MediaProps {
  /**
   * {@inheritDoc Video.alpha}
   */
  alpha?: SignalValue<number>;
  /**
   * {@inheritDoc Video.smoothing}
   */
  smoothing?: SignalValue<boolean>;
  /**
   * {@inheritDoc Video.decoder}
   */
  decoder?: SignalValue<'web' | 'ffmpeg' | 'slow' | null>;
}

@nodeName('Video')
export class Video extends Media {
  /**
   * The alpha value of this video.
   *
   * @remarks
   * Unlike opacity, the alpha value affects only the video itself, leaving the
   * fill, stroke, and children intact.
   */
  @initial(1)
  @signal()
  public declare readonly alpha: SimpleSignal<number, this>;

  /**
   * Whether the video should be smoothed.
   *
   * @remarks
   * When disabled, the video will be scaled using the nearest neighbor
   * interpolation with no smoothing. The resulting video will appear pixelated.
   *
   * @defaultValue true
   */
  @initial(true)
  @signal()
  public declare readonly smoothing: SimpleSignal<boolean, this>;

  /**
   * Which decoder to use during rendering. The `web` decoder is the fastest
   * but only supports MP4 files. The `ffmpeg` decoder is slower and more resource
   * intensive but supports more formats. The `slow` decoder is the slowest but
   * supports all formats.
   *
   * @defaultValue null
   */
  @initial(null)
  @signal()
  public declare readonly decoder: SimpleSignal<
    'web' | 'ffmpeg' | 'slow' | null,
    this
  >;

  public detectedFileType: 'mp4' | 'webm' | 'hls' | 'mov' | 'unknown' =
    'unknown';
  private fileTypeWasDetected: boolean = false;

  private static readonly pool: Record<string, HTMLVideoElement> = {};

  private static readonly imageCommunication = !import.meta.hot
    ? null
    : new ImageCommunication();

  public constructor(props: VideoProps) {
    super(props);
  }

  protected override desiredSize(): SerializedVector2<DesiredLength> {
    const custom = super.desiredSize();
    if (custom.x === null && custom.y === null) {
      const image = this.video();
      return {
        x: image.videoWidth,
        y: image.videoHeight,
      };
    }

    return custom;
  }

  protected mediaElement(): HTMLVideoElement {
    return this.video();
  }

  protected seekedMedia(): HTMLVideoElement {
    return this.seekedVideo();
  }

  protected fastSeekedMedia(): HTMLVideoElement {
    return this.fastSeekedVideo();
  }

  @computed()
  private video(): HTMLVideoElement {
    const src = this.src();
    
    // Use a temporary key for undefined src to avoid conflicts
    const key = `${this.key}/${src || 'pending'}`;
    
    let video = Video.pool[key];
    if (!video) {
      video = document.createElement('video');
      video.crossOrigin = 'anonymous';

      // Only set src if it's valid, otherwise leave it empty
      if (src && src !== 'undefined') {
        try {
          const parsedSrc = new URL(src, window.location.origin);
          
          if (parsedSrc.pathname.endsWith('.m3u8')) {
            const hls = new Hls();
            hls.loadSource(src);
            hls.attachMedia(video);
          } else {
            video.src = src;
          }
        } catch (error) {
          // Fallback to direct assignment
          video.src = src;
        }
      }

      Video.pool[key] = video;
    } else if (src && src !== 'undefined' && video.src !== src) {
      // Update existing video element if src has changed and is now valid
      try {
        const parsedSrc = new URL(src, window.location.origin);
        
        if (parsedSrc.pathname.endsWith('.m3u8')) {
          const hls = new Hls();
          hls.loadSource(src);
          hls.attachMedia(video);
        } else {
          video.src = src;
        }
      } catch (error) {
        // Fallback to direct assignment
        video.src = src;
      }
      
      // Move video to correct pool key
      delete Video.pool[key];
      const newKey = `${this.key}/${src}`;
      Video.pool[newKey] = video;
    }

    // If src is still undefined, wait for it to become available
    if (!src || src === 'undefined') {
      DependencyContext.collectPromise(
        new Promise<void>(resolve => {
          // Check periodically for valid src
          const checkSrc = () => {
            const currentSrc = this.src();
            if (currentSrc && currentSrc !== 'undefined') {
              resolve();
            } else {
              setTimeout(checkSrc, 10);
            }
          };
          checkSrc();
        }),
      );
    }

    const weNeedToWait = this.waitForCanPlayNecessary(video);
    
    if (!weNeedToWait) {
      return video;
    }

    DependencyContext.collectPromise(
      new Promise<void>(resolve => {
        this.waitForCanPlay(video, resolve);
      }),
    );

    return video;
  }

  @computed()
  protected seekedVideo(): HTMLVideoElement {
    const video = this.video();
    const time = this.clampTime(this.time());

    video.playbackRate = this.playbackRate();

    if (!video.paused) {
      video.pause();
    }

    if (this.lastTime === time) {
      return video;
    }

    this.setCurrentTime(time);

    return video;
  }

  @computed()
  protected fastSeekedVideo(): HTMLVideoElement {
    const video = this.video();
    const time = this.clampTime(this.time());

    video.playbackRate = this.playbackRate();

    if (this.lastTime === time) {
      return video;
    }

    const playing =
      this.playing() && time < video.duration && video.playbackRate > 0;
    
    if (playing) {
      if (video.paused) {
        DependencyContext.collectPromise(video.play());
      }
    } else {
      if (!video.paused) {
        video.pause();
      }
    }

    // reseek when video is out of sync by more than one second
    if (Math.abs(video.currentTime - time) > 1) {
      this.setCurrentTime(time);
    } else if (!playing) {
      video.currentTime = time;
    }

    return video;
  }

  protected lastFrame: ImageBitmap | null = null;

  protected async webcodecSeekedVideo(): Promise<CanvasImageSource> {
    const video = this.video();
    const time = this.clampTime(this.time());

    video.playbackRate = this.playbackRate();

    if (this.lastFrame && this.lastTime === time) {
      return this.lastFrame;
    }

    const fps = this.view().fps() / this.playbackRate();
    return getFrame(this.key, video.src, time, fps);
  }

  protected async ffmpegSeekedVideo(): Promise<ImageBitmap> {
    const video = this.video();
    const time = this.clampTime(this.time());
    const duration = this.getDuration();

    video.playbackRate = this.playbackRate();

    if (this.lastFrame && this.lastTime === time) {
      return this.lastFrame;
    }

    const fps = this.view().fps() / this.playbackRate();

    if (!Video.imageCommunication) {
      throw new Error('ServerSeekedVideo can only be used with HMR.');
    }

    const frame = await Video.imageCommunication.getFrame(
      this.key,
      video.src,
      time,
      duration,
      fps,
    );
    this.lastFrame = frame;
    this.lastTime = time;

    return frame;
  }

  protected async seekFunction() {
    const playbackState = this.view().playbackState();

    // During playback
    if (
      playbackState === PlaybackState.Playing ||
      playbackState === PlaybackState.Presenting
    ) {
      return this.fastSeekedVideo();
    }

    if (playbackState === PlaybackState.Paused) {
      return this.seekedVideo();
    }

    // During rendering, if set explicitly
    if (this.decoder() === 'slow') {
      return this.seekedVideo();
    }

    if (this.decoder() === 'ffmpeg') {
      return this.ffmpegSeekedVideo();
    }

    if (this.decoder() === 'web') {
      return this.webcodecSeekedVideo();
    }

    if (!this.fileTypeWasDetected) {
      this.detectFileType();
    }

    // If not set explicitly, use detected file type to determine decoder
    if (this.detectedFileType === 'webm') {
      return this.ffmpegSeekedVideo();
    }

    if (this.detectedFileType === 'hls') {
      return this.seekedVideo();
    }

    return this.webcodecSeekedVideo();
  }

  protected override async draw(context: CanvasRenderingContext2D) {
    // Auto-start playback if Twick is playing but media isn't
    this.autoPlayBasedOnTwick();
    
    this.drawShape(context);
    const alpha = this.alpha();
    if (alpha > 0) {
      const video = await this.seekFunction();

      const box = BBox.fromSizeCentered(this.computedSize());
      context.save();
      context.clip(this.getPath());
      if (alpha < 1) {
        context.globalAlpha *= alpha;
      }
      context.imageSmoothingEnabled = this.smoothing();
      drawImage(context, video, box);
      context.restore();
    }

    if (this.clip()) {
      context.clip(this.getPath());
    }

    await this.drawChildren(context);
  }

  protected override applyFlex() {
    super.applyFlex();
    try {
      const video = this.video();
      // Only set aspect ratio if video element is available and has valid dimensions
      if (video && video.videoWidth > 0 && video.videoHeight > 0) {
        this.element.style.aspectRatio = (
          this.ratio() ?? video.videoWidth / video.videoHeight
        ).toString();
      }
    } catch (error) {
      // If video element is not ready yet, skip setting aspect ratio
      // It will be set later when the video becomes available
    }
  }

  public override remove() {
    super.remove();
    dropExtractor(this.key, this.src());
    return this;
  }

  private handleUnknownFileType(src: string) {
    console.warn(
      `WARNING: Could not detect file type of video (${src}), will default to using mp4 decoder. If your video file is not an mp4 file, this will lead to an error - to fix this, reencode your video as an mp4 file (better performance) or specify a different decoder: https://docs.re.video/common-issues/slow-rendering#use-mp4-decoder`,
    );
    this.detectedFileType = 'unknown';
    this.fileTypeWasDetected = true;
  }

  private detectFileType() {
    return DependencyContext.collectPromise(
      (async () => {
        const src = this.src();
        const extension = src.split('?')[0].split('.').pop()?.toLowerCase();

        if (
          extension === 'mp4' ||
          extension === 'webm' ||
          extension === 'mov'
        ) {
          this.detectedFileType = extension;
          this.fileTypeWasDetected = true;
          return;
        }

        if (extension === 'm3u8') {
          this.detectedFileType = 'hls';
          this.fileTypeWasDetected = true;
          return;
        }

        if (!src.startsWith('http://') && !src.startsWith('https://')) {
          this.handleUnknownFileType(src);
          return;
        }

        const response = await fetch(src, {method: 'HEAD'});
        const contentType = response.headers.get('Content-Type');

        if (!contentType) {
          this.handleUnknownFileType(src);
          return;
        }

        if (contentType.includes('video/mp4')) {
          this.detectedFileType = 'mp4';
          this.fileTypeWasDetected = true;
          return;
        }

        if (contentType.includes('video/webm')) {
          this.detectedFileType = 'webm';
          this.fileTypeWasDetected = true;
          return;
        }

        if (contentType.includes('video/quicktime')) {
          this.detectedFileType = 'mov';
          this.fileTypeWasDetected = true;
          return;
        }

        if (
          contentType.includes('application/vnd.apple.mpegurl') ||
          contentType.includes('application/x-mpegURL')
        ) {
          this.detectedFileType = 'hls';
          this.fileTypeWasDetected = true;
          return;
        }

        this.handleUnknownFileType(src);
      })(),
    );
  }
}
