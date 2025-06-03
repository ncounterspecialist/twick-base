import {Video, makeScene2D} from '@twick/2d';
import {createRef, waitFor} from '@twick/core';

import exampleMp4 from '@revideo/examples/assets/example.mp4';

export default makeScene2D('media-video', function* (view) {
  const videoRef = createRef<Video>();

  view.add(<Video ref={videoRef} src="https://static-assets.kifferai.com/instagram_videos/1746601560981.mp4" volume={0.5}/>);

  // Wait for video metadata to be loaded
  yield* videoRef().waitForMetadata();

  
  videoRef().play();
  yield* videoRef().scale(1.25, 2).to(1, 2);
  yield* waitFor(10);
});
