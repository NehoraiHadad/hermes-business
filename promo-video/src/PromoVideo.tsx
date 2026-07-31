import {AbsoluteFill, Audio, Sequence, staticFile, useCurrentFrame} from 'remotion';
import {fontFamily} from './theme';
import {sceneFade} from './motion';
import {IntroScene} from './scenes/IntroScene';
import {OnboardingScene} from './scenes/OnboardingScene';
import {ChatScene} from './scenes/ChatScene';
import {ApprovalScene} from './scenes/ApprovalScene';
import {ConnectionsScene} from './scenes/ConnectionsScene';
import {WhatsappScene} from './scenes/WhatsappScene';
import {AutomationScene} from './scenes/AutomationScene';
import {SupportScene} from './scenes/SupportScene';
import {ClosingScene} from './scenes/ClosingScene';

const scenes = [
  {from: 0, duration: 180, component: IntroScene},
  {from: 165, duration: 210, component: OnboardingScene},
  {from: 360, duration: 240, component: ChatScene},
  {from: 585, duration: 195, component: ApprovalScene},
  {from: 765, duration: 210, component: ConnectionsScene},
  {from: 960, duration: 195, component: WhatsappScene},
  {from: 1140, duration: 210, component: AutomationScene},
  {from: 1335, duration: 180, component: SupportScene},
  {from: 1500, duration: 150, component: ClosingScene},
];

export const PromoVideo = () => (
  <AbsoluteFill style={{fontFamily}}>
    <Audio src={staticFile('soundtrack.wav')} volume={0.52} />
    {scenes.map(({from, duration, component: Scene}, index) => (
      <Sequence key={index} from={from} durationInFrames={duration} layout="none">
        <SceneShell duration={duration}><Scene /></SceneShell>
      </Sequence>
    ))}
  </AbsoluteFill>
);

const SceneShell = ({duration, children}: {duration: number; children: React.ReactNode}) => {
  const frame = useCurrentFrame();
  return <AbsoluteFill style={{opacity: sceneFade(frame, duration)}}>{children}</AbsoluteFill>;
};
