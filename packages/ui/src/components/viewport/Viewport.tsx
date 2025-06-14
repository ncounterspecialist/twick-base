import {getFullRenderingSettings, RendererState} from '@twick/core';
import clsx from 'clsx';
import {useEffect, useState} from 'preact/hooks';
import {useApplication} from '../../contexts';
import {useDuration, useRendererState} from '../../hooks';
import {useShortcut} from '../../hooks/useShortcut';
import {formatDuration, openOutputPath} from '../../utils';
import {Button} from '../controls';
import {
  PlaybackControls,
  PlaybackProgress,
  RenderingProgress,
} from '../playback';
import {CurrentTime} from '../playback/CurrentTime';
import {EditorPreview} from './EditorPreview';
import {StageView} from './StageView';
import {Timestamp} from './Timestamp';
import styles from './Viewport.module.scss';

export function Viewport() {
  const state = useRendererState();
  return state === RendererState.Working ? (
    <RenderingViewport />
  ) : (
    <EditorViewport />
  );
}

function EditorViewport() {
  const [hoverRef] = useShortcut<HTMLDivElement>('viewport');
  const duration = useDuration();
  const {renderer, project} = useApplication();

  return (
    <div ref={hoverRef} className={styles.root}>
      <EditorPreview />
      <PlaybackProgress />
      <div className={styles.playback}>
        <div style={{flexShrink: 1, display: 'flex', columnGap: '12px'}}>
          <Button
            main
            value="Render"
            id="render"
            onClick={async () => {
              await renderer.render({
                ...getFullRenderingSettings(project),
                name: project.name,
              });
              await openOutputPath();
            }}
            class={styles.renderButton}
          >
            Render video
          </Button>
          <CurrentTime
            render={time => (
              <Timestamp
                className={styles.time}
                title="Current time"
                frameTitle="Current frame"
                frame={time}
              />
            )}
          />
        </div>
        <PlaybackControls />
        <Timestamp
          reverse
          className={styles.duration}
          title="Duration"
          frameTitle="Duration in frames"
          frame={duration}
        />
      </div>
    </div>
  );
}

function RenderingViewport() {
  const {renderer} = useApplication();
  const [estimate, setEstimate] = useState(renderer.estimator.estimate());

  useEffect(() => {
    const id = setInterval(() => {
      setEstimate(renderer.estimator.estimate());
    }, 100);
    return () => clearInterval(id);
  }, []);

  return (
    <div className={styles.root}>
      <StageView
        stage={renderer.stage}
        className={clsx(styles.viewport, styles.renderingPreview)}
      />
      <RenderingProgress />
      <div className={styles.playback}>
        <div style={{flexShrink: 1, display: 'flex', columnGap: '12px'}}>
          <Button
            value="Abort"
            id="render"
            data-rendering={true}
            onClick={() => renderer.abort()}
            class={styles.renderButton}
          >
            Abort
          </Button>
          <code
            className={styles.time}
            title="Time elapsed since the rendering started"
          >
            {formatDuration(estimate.elapsed / 1000)}
            <span className={styles.frames}>Elapsed</span>
          </code>
        </div>
        <code
          className={styles.duration}
          title="Estimated time remaining until the rendering is complete"
        >
          <span className={styles.frames}>ETA:</span>
          {formatDuration(estimate.eta / 1000)}
        </code>
      </div>
    </div>
  );
}
