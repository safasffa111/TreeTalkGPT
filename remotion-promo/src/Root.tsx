import React from 'react';
import {Composition} from 'remotion';
import {TreeTalkFullPromo, DURATION_FRAMES, FPS, HEIGHT, WIDTH} from './TreeTalkFullPromo';

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="TreeTalkFullPromo"
      component={TreeTalkFullPromo}
      durationInFrames={DURATION_FRAMES}
      fps={FPS}
      width={WIDTH}
      height={HEIGHT}
    />
  );
};
