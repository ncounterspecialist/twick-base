'use client';
import type {Player as CorePlayer, Project} from '@twick/core';
import type {ComponentProps} from 'react';
import {useCallback, useEffect, useRef, useState} from 'react';
import {Controls} from './controls';
import './index.css';
import {shouldShowControls} from './utils';

interface TwickPlayerProps {
  playing?: boolean | string;
  variables?: string;
  looping?: boolean | string;
  width?: number;
  height?: number;
  quality?: number;
  fps?: number;
  volume?: number;
}

declare global {
  namespace JSX {
    interface IntrinsicElements {
      // eslint-disable-next-line
      'twick-player': TwickPlayerProps & ComponentProps<'div'>;
    }
  }
}

interface PlayerProps {
  project: Project;
  controls?: boolean;
  variables?: Record<string, any>;
  playing?: boolean;
  currentTime?: number;
  volume?: number;
  looping?: boolean;
  fps?: number;

  width?: number;
  height?: number;
  quality?: number;
  timeDisplayFormat?: 'MM:SS' | 'MM:SS.mm' | 'MM:SS.m';

  onDurationChange?: (duration: number) => void;
  onTimeUpdate?: (currentTime: number) => void;
  onPlayerReady?: (player: CorePlayer) => void;
  onPlayerResize?: (rect: DOMRectReadOnly) => void;
}

export function Player({
  project,
  controls = true,
  variables = {},
  playing = false,
  currentTime = 0,
  volume = 1,
  looping = true,
  fps = 30,

  width = undefined,
  height = undefined,
  quality = undefined,
  timeDisplayFormat = 'MM:SS',

  onDurationChange = () => {},
  onTimeUpdate = () => {},
  onPlayerReady = () => {},
  onPlayerResize = () => {},
}: PlayerProps) {
  const [playingState, setPlaying] = useState(playing);
  const [isMouseOver, setIsMouseOver] = useState(false);
  const [currentTimeState, setCurrentTime] = useState(currentTime);
  const [volumeState, setVolumeState] = useState(volume);
  const [duration, setDuration] = useState(-1);

  const focus = useRef(false);
  const playerRef = useRef<HTMLDivElement | null>(null);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const lastRect = useRef<DOMRectReadOnly | null>(null);
  const lastLoggedTimeRef = useRef<number | null>(null);

  const onClickHandler = controls ? () => setPlaying(prev => !prev) : undefined;

  /**
   * Sync the playing prop with the player's own state when it changes.
   */
  useEffect(() => {
    setPlaying(playing);
  }, [playing]);

  /**
   * Sync the current time with the player's own state.
   */
  useEffect(() => {
    const diff = Math.abs(currentTime - currentTimeState);
    if (diff > 0.05) {
      setForcedTime(currentTime);
    }
  }, [currentTime]);

  useEffect(() => {
    setForcedVolume(volume);
  }, [volume]);

  /**
   * Set variables via setAttribute - the twick-player custom element's variables
   * property is read-only (getter only). React would fail if we passed it as a prop.
   */
  const variablesJson = JSON.stringify(variables);
  useEffect(() => {
    if (playerRef.current) {
      playerRef.current.setAttribute('variables', variablesJson);
    }
  }, [variablesJson]);

  /**
   * Receives the current time of the video from the player.
   * Use refs to ensure we always call the latest callbacks.
   */
  const onTimeUpdateRef = useRef(onTimeUpdate);
  const onDurationChangeRef = useRef(onDurationChange);
  
  // Update refs when callbacks change
  useEffect(() => {
    onTimeUpdateRef.current = onTimeUpdate;
  }, [onTimeUpdate]);
  
  useEffect(() => {
    onDurationChangeRef.current = onDurationChange;
  }, [onDurationChange]);

  const handleTimeUpdate = useCallback((event: Event) => {
    const e = event as CustomEvent;
    const t = e.detail as number;
    const last = lastLoggedTimeRef.current;
    if (last === null || Math.abs(t - last) > 0.05) {
      lastLoggedTimeRef.current = t;
    }
    setCurrentTime(t);
    onTimeUpdateRef.current(t);
  }, []);

  /**
   * Receives the duration of the video from the player.
   */
  const handleDurationUpdate = useCallback((event: Event) => {
    const e = event as CustomEvent;
    setDuration(e.detail);
    onDurationChangeRef.current(e.detail);
  }, []);

  /**
   * Play and pause using the space key.
   */
  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    if (event.code === 'Space' && focus.current) {
      event.preventDefault();
      setPlaying(prev => !prev);
    }
  }, []);

  const onPlayerReadyRef = useRef(onPlayerReady);
  
  useEffect(() => {
    onPlayerReadyRef.current = onPlayerReady;
  }, [onPlayerReady]);

  const handlePlayerReady = useCallback((event: Event) => {
    const player = (event as CustomEvent).detail;
    if (player) {
      onPlayerReadyRef.current(player);
    }
    
    // Ensure event listeners are attached when player becomes ready
    // This is a fallback in case listeners weren't attached earlier
    const playerElement = playerRef.current;
    if (playerElement) {
      // Remove and re-add to ensure they're attached
      playerElement.removeEventListener('timeupdate', handleTimeUpdate);
      playerElement.removeEventListener('duration', handleDurationUpdate);
      playerElement.addEventListener('timeupdate', handleTimeUpdate);
      playerElement.addEventListener('duration', handleDurationUpdate);
    }
  }, [handleTimeUpdate, handleDurationUpdate]);

  const handlePlayerResize = useCallback(
    (entries: ResizeObserverEntry[]) => {
      const [firstEntry] = entries;
      if (!firstEntry || !wrapperRef.current) {
        return;
      }

      const newRect = wrapperRef.current.getBoundingClientRect();
      if (
        !lastRect.current ||
        newRect.width !== lastRect.current.width ||
        newRect.height !== lastRect.current.height ||
        newRect.x !== lastRect.current.x ||
        newRect.y !== lastRect.current.y
      ) {
        lastRect.current = newRect;
        onPlayerResize(newRect);
      }
    },
    [onPlayerResize],
  );

  useEffect(() => {
    if (!wrapperRef.current) return;

    const resizeObserver = new ResizeObserver(handlePlayerResize);
    resizeObserver.observe(wrapperRef.current);

    return () => {
      resizeObserver.disconnect();
    };
  }, [handlePlayerResize]);

  /**
   * Import the player and add all event listeners.
   */
  useEffect(() => {
    let cleanup: (() => void) | null = null;

    const setupListeners = () => {
      const player = playerRef.current;
      if (!player) return;

      // Remove any existing listeners first to avoid duplicates
      player.removeEventListener('timeupdate', handleTimeUpdate);
      player.removeEventListener('duration', handleDurationUpdate);
      player.removeEventListener('playerready', handlePlayerReady);

      // Add event listeners
      player.addEventListener('timeupdate', handleTimeUpdate);
      player.addEventListener('duration', handleDurationUpdate);
      player.addEventListener('playerready', handlePlayerReady);
      document.addEventListener('keydown', handleKeyDown);

      cleanup = () => {
        player.removeEventListener('timeupdate', handleTimeUpdate);
        player.removeEventListener('duration', handleDurationUpdate);
        player.removeEventListener('playerready', handlePlayerReady);
        document.removeEventListener('keydown', handleKeyDown);
      };
    };

    // Import the custom element definition
    import('./internal').then(() => {
      // Wait for the next tick to ensure the element is in the DOM
      // Use requestAnimationFrame to ensure the custom element is ready
      requestAnimationFrame(() => {
        if (playerRef.current) {
          (playerRef.current as any).setProject(project);
          // Set up listeners after the element is ready
          setupListeners();
        }
      });
    });

    // Also set up listeners immediately if element already exists
    // This handles the case where the element was already in the DOM
    if (playerRef.current) {
      setupListeners();
    }

    return () => {
      if (cleanup) {
        cleanup();
      }
    };
  }, [project, handleTimeUpdate, handleDurationUpdate, handlePlayerReady, handleKeyDown]);

  /**
   * When the forced time changes, seek to that time.
   */
  function setForcedTime(forcedTime: number) {
    if (playerRef.current) {
      playerRef.current.dispatchEvent(
        new CustomEvent('seekto', {detail: forcedTime}),
      );
    }
  }

  function setForcedVolume(volume: number) {
    setVolumeState(volume);
    if (playerRef.current) {
      playerRef.current.dispatchEvent(
        new CustomEvent('volumechange', {detail: volume}),
      );
    }
  }

  return (
    <div className="twick-player-root w-full h-full" style={{display: 'contents'}}>
      <div
        ref={wrapperRef}
        className="relative cursor-default w-full h-full focus:outline-none"
        onFocus={() => (focus.current = true)}
        onBlur={() => (focus.current = false)}
        tabIndex={0}
        onMouseEnter={() => setIsMouseOver(true)}
        onMouseLeave={() => setIsMouseOver(false)}
      >
        <div className="relative w-full h-full">
          <twick-player
            ref={playerRef}
            quality={quality}
            fps={fps}
            width={width}
            height={height}
            volume={volumeState}
            playing={playingState}
            looping={looping}
            onClick={onClickHandler}
          />
          <div
            className={`absolute bottom-0 w-full transition-opacity duration-200 ${
              shouldShowControls(playingState, isMouseOver, !controls)
                ? 'opacity-100'
                : 'opacity-0'
            }`}
          >
            <Controls
              duration={duration}
              playing={playingState}
              setPlaying={setPlaying}
              currentTime={currentTimeState}
              setForcedTime={setForcedTime}
              timeDisplayFormat={timeDisplayFormat}
              volume={volumeState}
              setVolume={setForcedVolume}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
