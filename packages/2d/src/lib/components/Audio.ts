import {DependencyContext, PlaybackState} from '@twick/core';
import {computed, nodeName} from '../decorators';
import type {MediaProps} from './Media';
import {Media} from './Media';

@nodeName('Audio')
export class Audio extends Media {
  private static readonly pool: Record<string, HTMLAudioElement> = {};

  public constructor(props: MediaProps) {
    super(props);
  }

  protected mediaElement(): HTMLAudioElement {
    return this.audio();
  }

  protected seekedMedia(): HTMLAudioElement {
    return this.seekedAudio();
  }

  protected fastSeekedMedia(): HTMLAudioElement {
    return this.fastSeekedAudio();
  }

  @computed()
  protected audio(): HTMLAudioElement {
    const src = this.src();
    
    // Use a temporary key for undefined src to avoid conflicts
    const key = `${this.key}/${src || 'pending'}`;
    
    let audio = Audio.pool[key];
    if (!audio) {
      audio = document.createElement('audio');
      audio.crossOrigin = 'anonymous';
      
      // Only set src if it's valid, otherwise leave it empty
      if (src && src !== 'undefined') {
        audio.src = src;
      }
      
      Audio.pool[key] = audio;
    } else if (src && src !== 'undefined' && audio.src !== src) {
      // Update existing audio element if src has changed and is now valid
      audio.src = src;
      
      // Move audio to correct pool key
      delete Audio.pool[key];
      const newKey = `${this.key}/${src}`;
      Audio.pool[newKey] = audio;
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

    const weNeedToWait = this.waitForCanPlayNecessary(audio);
    if (!weNeedToWait) {
      return audio;
    }

    DependencyContext.collectPromise(
      new Promise<void>(resolve => {
        this.waitForCanPlay(audio, resolve);
      }),
    );

    return audio;
  }

  @computed()
  protected seekedAudio(): HTMLAudioElement {
    const audio = this.audio();

    audio.addEventListener('ended', () => {
      this.pause();
    });

    if (!(this.time() < audio.duration)) {
      this.pause();
      return audio;
    }

    const time = this.clampTime(this.time());
    audio.playbackRate = this.playbackRate();

    if (!audio.paused) {
      audio.pause();
    }

    if (this.lastTime === time) {
      return audio;
    }

    this.setCurrentTime(time);

    return audio;
  }

  @computed()
  protected fastSeekedAudio(): HTMLAudioElement {
    const audio = this.audio();

    if (!(this.time() < audio.duration)) {
      this.pause();
      return audio;
    }

    const time = this.clampTime(this.time());

    audio.playbackRate = this.playbackRate();

    if (this.lastTime === time) {
      return audio;
    }

    const playing =
      this.playing() && time < audio.duration && audio.playbackRate > 0;
    if (playing) {
      if (audio.paused) {
        DependencyContext.collectPromise(audio.play());
      }
    } else {
      if (!audio.paused) {
        audio.pause();
      }
    }
    if (Math.abs(audio.currentTime - time) > 0.3) {
      this.setCurrentTime(time);
    } else if (!playing) {
      audio.currentTime = time;
    }

    return audio;
  }

  protected override async draw(context: CanvasRenderingContext2D) {
    // Auto-start playback if Twick is playing but media isn't
    this.autoPlayBasedOnTwick();
    
    const playbackState = this.view().playbackState();

    playbackState === PlaybackState.Playing ||
    playbackState === PlaybackState.Presenting
      ? this.fastSeekedAudio()
      : this.seekedAudio();

    context.save();
    context.restore();

    await this.drawChildren(context);
  }
}
