import {Composition} from 'remotion';
import {PromoVideo} from './PromoVideo';

export const VIDEO = {
  fps: 30,
  width: 1920,
  height: 1080,
  durationInFrames: 1650,
};

export const VideoRoot = () => (
  <Composition id="HermesBusinessPromo" component={PromoVideo} {...VIDEO} />
);
