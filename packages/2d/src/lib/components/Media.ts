import type {SignalValue, SimpleSignal} from '@twick/core';
import {
  DependencyContext,
  PlaybackState,
  clamp,
  isReactive,
  useLogger,
  useThread,
} from '@twick/core';
import {computed, initial, nodeName, signal} from '../decorators';
import type {RectProps} from './Rect';
import {Rect} from './Rect';

export interface MediaProps extends RectProps {
  src?: SignalValue<string>;
  loop?: SignalValue<boolean>;
  playbackRate?: number;
  volume?: number;
  time?: SignalValue<number>;
  play?: boolean;
  awaitCanPlay?: SignalValue<boolean>;
  allowVolumeAmplificationInPreview?: SignalValue<boolean>;
}

const reactivePlaybackRate = `
The \`playbackRate\` of a \`Video\` cannot be reactive.

Make sure to use a concrete value and not a function:

\`\`\`ts wrong
video.playbackRate(() => 7);
\`\`\`

\`\`\`ts correct
video.playbackRate(7);
\`\`\`

If you're using a signal, extract its value before passing it to the property:

\`\`\`ts wrong
video.playbackRate(mySignal);
\`\`\`

\`\`\`ts correct
video.playbackRate(mySignal());
\`\`\`
`;

@nodeName('Media')
export abstract class Media extends Rect {
  @initial('')
  @signal()
  public declare readonly src: SimpleSignal<string, this>;

  @initial(false)
  @signal()
  public declare readonly loop: SimpleSignal<boolean, this>;

  @initial(1)
  @signal()
  public declare readonly playbackRate: SimpleSignal<number, this>;

  @initial(0)
  @signal()
  protected declare readonly time: SimpleSignal<number, this>;

  @initial(false)
  @signal()
  protected declare readonly playing: SimpleSignal<boolean, this>;

  @initial(true)
  @signal()
  protected declare readonly awaitCanPlay: SimpleSignal<boolean, this>;

  @initial(false)
  @signal()
  protected declare readonly allowVolumeAmplificationInPreview: SimpleSignal<
    boolean,
    this
  >;

  protected declare volume: number;

  protected static readonly amplificationPool: Record<
    string,
    {
      audioContext: AudioContext;
      sourceNode: MediaElementAudioSourceNode;
      gainNode: GainNode;
    }
  > = {};
  protected lastTime = -1;
  private isSchedulingPlay = false;

  public constructor(props: MediaProps) {
    super(props);
    
    if (!this.awaitCanPlay()) {
      this.scheduleSeek(this.time());
    }

    if (props.play) {
      this.play();
    }
    this.volume = props.volume ?? 1;
    // Only set volume immediately if media is ready
    if (!this.awaitCanPlay()) {
      this.setVolume(this.volume);
    }
  }
  
  public isPlaying(): boolean {
    return this.playing();
  }

  public getCurrentTime(): number {
    return this.clampTime(this.time());
  }

  public getDuration(): number {
    try {
      const mElement = this.mediaElement();
      const isVideo = (mElement instanceof HTMLVideoElement);
      const isAudio = (mElement instanceof HTMLAudioElement);
      return (this.isIOS() && (isVideo || isAudio)) ? 2 /** dummy duration for iOS */ : mElement.duration;    
    } catch (error) {
      // If media element is not ready yet, return a default duration
      return 0;
    }
  }

  public getVolume(): number {
    return this.volume;
  }

  public getUrl(): string {
    try {
      return this.mediaElement().src;
    } catch (error) {
      // If media element is not ready yet, return the src signal value
      return this.src();
    }
  }

  public override dispose() {
    // Set playing state to false without trying to access media element
    this.playing(false);
    this.time.save();
    this.remove();
    super.dispose();
  }

  @computed()
  public override completion(): number {
    return this.clampTime(this.time()) / this.getDuration();
  }

  protected abstract mediaElement(): HTMLMediaElement;

  protected abstract seekedMedia(): HTMLMediaElement;

  protected abstract fastSeekedMedia(): HTMLMediaElement;

  protected abstract override draw(
    context: CanvasRenderingContext2D,
  ): Promise<void>;

  protected setCurrentTime(value: number) {
    try {
      const media = this.mediaElement();
      if (media.readyState < 2) return;

      media.currentTime = value;
      this.lastTime = value;
      if (media.seeking) {
        DependencyContext.collectPromise(
          new Promise<void>(resolve => {
            const listener = () => {
              resolve();
              media.removeEventListener('seeked', listener);
            };
            media.addEventListener('seeked', listener);
          }),
        );
      }
    } catch (error) {
      // If media element is not ready yet, just update the lastTime
      this.lastTime = value;
    }
  }

  public setVolume(volume: number) {
    if (volume < 0) {
      console.warn(
        `volumes cannot be negative - the value will be clamped to 0.`,
      );
    }
    
    // Store the volume value
    this.volume = volume;
    
    try {
      const media = this.mediaElement();
      media.volume = Math.min(Math.max(volume, 0), 1);

      if (volume > 1) {
        if (this.allowVolumeAmplificationInPreview()) {
          this.amplify(media, volume);
          return;
        }
        console.warn(
          `you have set the volume of node ${this.key} to ${volume} - your video will be exported with the correct volume, but the browser does not support volumes higher than 1 by default. To enable volume amplification in the preview, set the "allowVolumeAmplificationInPreview" of your <Video/> or <Audio/> tag to true. Note that amplification for previews will not work if you use autoplay within the player due to browser autoplay policies: https://developer.chrome.com/blog/autoplay/#webaudio.`,
        );
      }
    } catch (error) {
      // If media element is not ready yet, just store the volume
      // It will be applied when the media becomes available via collectAsyncResources
    }
  }

  @computed()
  protected amplify(node: HTMLMediaElement, volume: number) {
    const key = `${this.src()}/${this.key}`;

    if (Media.amplificationPool[key]) {
      Media.amplificationPool[key].gainNode.gain.value = volume;
      return;
    }

    const audioContext = new AudioContext();
    const sourceNode = audioContext.createMediaElementSource(node);
    const gainNode = audioContext.createGain();

    gainNode.gain.value = volume;
    sourceNode.connect(gainNode);
    gainNode.connect(audioContext.destination);

    Media.amplificationPool[key] = {audioContext, sourceNode, gainNode};

    if (typeof window === 'undefined' || audioContext.state !== 'suspended') {
      return;
    }

    // Start audio context after user interation, neccessary due to browser autoplay policies
    const handleInteraction = () => {
      Media.amplificationPool[key].audioContext.resume();
      window.removeEventListener('click', handleInteraction);
    };
    window.addEventListener('click', handleInteraction);
  }

  protected setPlaybackRate(playbackRate: number) {
    let value: number;
    if (isReactive(playbackRate)) {
      value = playbackRate();
      useLogger().warn({
        message: 'Invalid value set as the playback rate',
        remarks: reactivePlaybackRate,
        inspect: this.key,
        stack: new Error().stack,
      });
    } else {
      value = playbackRate;
    }
    this.playbackRate.context.setter(value);

    if (this.playing()) {
      if (value === 0) {
        this.pause();
      } else {
        const time = useThread().time;
        const start = time();
        const offset = this.time();
        this.time(() => this.clampTime(offset + (time() - start) * value));
      }
    }
  }

  protected scheduleSeek(time: number) {
    // Defer the media element access to avoid immediate async property access
    setTimeout(() => {
      try {
        const media = this.mediaElement();
        
        // Use the existing waitForCanPlay method which handles readiness properly
        this.waitForCanPlay(media, () => {
          // Wait until the media is ready to seek again as
          // setting the time before the video doesn't work reliably.
          media.currentTime = time;
        });
      } catch (error) {
        // If media element is not ready yet, retry after a longer delay
        setTimeout(() => this.scheduleSeek(time), 50);
      }
    }, 0);
  }

  /**
   * Waits for the canplay event to be fired before calling onCanPlay.
   *
   * If the media is already ready to play, onCanPlay is called immediately.
   * @param onCanPlay - The function to call when the media is ready to play.
   * @returns
   */
  protected waitForCanPlay(media: HTMLMediaElement, onCanPlay: () => void) {
    // Be more strict - require readyState >= 3 (HAVE_FUTURE_DATA) for better reliability
    if (media.readyState >= 3) {
      onCanPlay();
      return;
    }
    
    const onCanPlayWrapper = () => {
      onCanPlay();
      media.removeEventListener('canplay', onCanPlayWrapper);
      media.removeEventListener('canplaythrough', onCanPlayWrapper);
    };

    const onError = () => {
      const reason = this.getErrorReason(media.error?.code);
      const srcValue = this.src();
      
      console.error(`Error loading video: src="${srcValue}", ${reason}`);
      console.error(`Media element src: "${media.src}"`);
      media.removeEventListener('error', onError);
      media.removeEventListener('canplay', onCanPlayWrapper);
      media.removeEventListener('canplaythrough', onCanPlayWrapper);
    };

    // Listen for both canplay and canplaythrough events
    media.addEventListener('canplay', onCanPlayWrapper);
    media.addEventListener('canplaythrough', onCanPlayWrapper);
    media.addEventListener('error', onError);
  }

  /**
   * Returns true if we should wait for the media to be ready to play.
   */
  protected waitForCanPlayNecessary(media: HTMLMediaElement): boolean {
    if (media.readyState >= 2) {
      return false;
    }

    return (
      this.awaitCanPlay() ||
      this.view().playbackState() === PlaybackState.Rendering
    );
  }

  public play() {
    // Set the playing state first
    this.playing(true);
    
    // Schedule the actual play operation for when media is ready
    this.schedulePlay();
  }
  
  protected schedulePlay() {
    // Prevent recursive calls
    if (this.isSchedulingPlay) {
      return;
    }
    
    this.isSchedulingPlay = true;
    
    // Check if thread context is available before accessing it
    let timeFunction: (() => number) | null = null;
    try {
      const time = useThread().time;
      timeFunction = time;
    } catch (error) {
      // Reset flag and use simple play without thread time
      this.isSchedulingPlay = false;
      this.simplePlay();
      return;
    }
    
    // We need to wait for the media to be ready before we can play it
    // Use a setTimeout to defer the operation and avoid immediate async property access
    setTimeout(() => {
      // Check if we're still supposed to be playing (avoid race conditions)
      const isPlaying = this.playing();
      if (!isPlaying) {
        this.isSchedulingPlay = false;
        return;
      }
      
      // Add another timeout to further defer media element access
      setTimeout(() => {
        try {
          const media = this.mediaElement();
          
          // Always use waitForCanPlay to ensure media is ready
          this.waitForCanPlay(media, () => {
            // Double-check we're still playing before calling actuallyPlay
            if (this.playing() && timeFunction) {
              this.actuallyPlay(media, timeFunction);
            }
            // Reset the flag when done
            this.isSchedulingPlay = false;
          });
        } catch (error) {
          // Reset flag before retry
          this.isSchedulingPlay = false;
          // If media is not ready yet, retry after a longer delay
          setTimeout(() => this.schedulePlay(), 100);
        }
      }, 10);
    }, 0);
  }
  
  private simplePlay() {
    setTimeout(() => {
      try {
        const media = this.mediaElement();
        
        // Guard against undefined src
        if (!media.src || media.src.includes('undefined')) {
          return;
        }
        
        if (media.paused && this.playing()) {
          media.playbackRate = this.playbackRate();
          const playPromise = media.play();
          if (playPromise !== undefined) {
            playPromise.then(() => {
              // Play started successfully
            }).catch(error => {
              if (error.name !== 'AbortError') {
                console.warn('Error in simple play:', error);
              }
              // During rendering, keep playing=true even if play() fails
              // because the renderer needs to collect media assets for audio extraction
              const playbackState = this.view().playbackState();
              if (playbackState !== PlaybackState.Rendering) {
                this.playing(false);
              }
            });
          }
        }
      } catch (error) {
        // Stop retries for errors
        return;
      }
    }, 10);
  }
  
  private actuallyPlay(media: HTMLMediaElement, timeFunction: () => number) {
    // Make sure we're still supposed to be playing
    if (!this.playing()) {
      return;
    }
    
    // Set playback rate on media element
    media.playbackRate = this.playbackRate();
    
    // Ensure the media is ready to play
    if (media.paused) {
      // Start playing the media element
      const playPromise = media.play();
      if (playPromise !== undefined) {
        playPromise.then(() => {
          // Media play() promise resolved
        }).catch(error => {
          // Don't warn about AbortError - it's normal when play() is interrupted by pause()
          if (error.name !== 'AbortError') {
            console.warn('Error playing media:', error);
          }
          // During rendering, keep playing=true even if play() fails
          // because the renderer needs to collect media assets for audio extraction
          const playbackState = this.view().playbackState();
          if (playbackState !== PlaybackState.Rendering) {
            this.playing(false);
          }
        });
      }
    }
    
    // Set up time synchronization
    const start = timeFunction();
    const offset = media.currentTime;
    
    // Update time signal
    this.time(() => {
      const newTime = this.clampTime(offset + (timeFunction() - start) * this.playbackRate());
      return newTime;
    });
  }

  public pause() {
    // Set the playing state first
    this.playing(false);
    this.time.save();
    
    // Try to pause the media element if it's available
    // Use setTimeout to defer access and avoid async property issues
    setTimeout(() => {
      try {
        const media = this.mediaElement();
        media.pause();
      } catch (error) {
        // If media element is not ready yet, just update the state
        // The media won't be playing anyway if it's not ready
      }
    }, 0);
  }

  public clampTime(time: number): number {
    const duration = this.getDuration();
    if (this.loop()) {
      time %= duration;
    }
    return clamp(0, duration, time);
  }

  protected override collectAsyncResources() {
    super.collectAsyncResources();
    this.seekedMedia();
    // Ensure volume is set when media becomes available
    this.setVolume(this.volume);
  }

  protected autoPlayBasedOnTwick() {
    // Auto-start/stop playback based on Twick's playback state
    const playbackState = this.view().playbackState();
    const shouldBePlaying =
      playbackState === PlaybackState.Playing ||
      playbackState === PlaybackState.Presenting ||
      playbackState === PlaybackState.Rendering;

    // In both preview and renderer/export mode we want media elements
    // to be considered "playing" whenever Twick is advancing frames.
    if (shouldBePlaying && !this.playing()) {
      // During rendering, immediately set playing=true so getMediaAssets() can collect it
      // The actual browser playback may fail, but that's OK - ffmpeg will extract audio server-side
      if (playbackState === PlaybackState.Rendering) {
        this.playing(true);
      }
      this.play(); // Call the full play() method instead of just setting playing(true)
    } else if (!shouldBePlaying && this.playing()) {
      this.pause(); // Call the full pause() method
    }
  }

  protected getErrorReason(errCode?: number) {
    let reason;
    switch (errCode) {
      case 1:
        reason = 'MEDIA_ERR_ABORTED';
        break;
      case 2:
        reason = 'MEDIA_ERR_NETWORK. This might be a 404 error.';
        break;
      case 3:
        reason =
          'MEDIA_ERR_DECODE. This might be an issue with your video file.';
        break;
      case 4:
        reason =
          'MEDIA_ERR_SRC_NOT_SUPPORTED. If you are sure that the path to the video is correct, this might be a CORS error.';
        break;
      default:
        reason = 'UNKNOWN';
    }

    return reason;
  }

  // Helper method to check if running on iOS
  protected isIOS(): boolean {
    if (typeof navigator === 'undefined') return false;
    const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) || 
           (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

    return isIos;
  }
}
