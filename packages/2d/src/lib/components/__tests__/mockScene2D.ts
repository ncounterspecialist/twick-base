import type {FullSceneDescription, ThreadGeneratorFactory} from '@twick/core';
import {
  PlaybackManager,
  PlaybackStatus,
  Vector2,
  endPlayback,
  endScene,
  startPlayback,
  startScene,
} from '@twick/core';
import {afterAll, beforeAll, beforeEach} from 'vitest';
import {Scene2D, makeScene2D} from '../../scenes';
import type {View2D} from '../View2D';

/**
 * Set up the test environment to support creating nodes.
 *
 * @remarks
 * Should be called inside a `describe()` block.
 * Due to js-dom limitations, layouts are not correctly computed.
 */
export function mockScene2D() {
  const playback = new PlaybackManager();
  const status = new PlaybackStatus(playback);
  const description = {
    ...makeScene2D('scene 1', function* () {
      // do nothing
    }),
    name: 'test',
    size: new Vector2(1920, 1080),
    resolutionScale: 1,
    playback: status,
  } as unknown as FullSceneDescription<ThreadGeneratorFactory<View2D>>;
  const scene = new Scene2D(description);

  beforeAll(() => {
    startScene(scene);
    startPlayback(status);
  });
  afterAll(() => {
    endPlayback(status);
    endScene(scene);
  });
  beforeEach(() => scene.reset());
}
