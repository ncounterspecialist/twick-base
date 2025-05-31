import {Video, Audio, makeScene2D} from '@twick/2d';
import {createRef, waitFor, all} from '@twick/core';

import exampleMp4 from '@twick/examples/assets/example.mp4';
import exampleMp3 from '@twick/examples/assets/123.mp3';

export default makeScene2D('media-video', function* (view) {
  const videoRef = createRef<Video>();
  const audioRef = createRef<Audio>();

  // Use yield to properly add components to the scene
  yield view.add(
    <Video
      ref={videoRef}
      src={exampleMp4}
      width={720}
      height={1080}
    />
  );

  yield view.add(
    <Audio
      ref={audioRef}
      src={exampleMp3}
    />
  );

  // No manual play() calls - let Media components handle playback automatically

  // Create animations to drive the rendering loop
  yield* all(
    waitFor(15) // Wait for 15 seconds to see the video
  );
});