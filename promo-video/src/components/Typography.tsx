import type {ReactNode} from 'react';
import {useCurrentFrame, useVideoConfig} from 'remotion';
import {reveal} from '../motion';
import {colors} from '../theme';

export const Eyebrow = ({children}: {children: ReactNode}) => (
  <div dir="rtl" style={{display: 'inline-flex', alignItems: 'center', borderRadius: 999, padding: '10px 18px', background: colors.purpleSoft, color: colors.purpleDark, fontSize: 22, fontWeight: 700, letterSpacing: 0.2}}>{children}</div>
);

export const SceneTitle = ({eyebrow, children, sub}: {eyebrow: string; children: ReactNode; sub?: string}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const p = reveal(frame, fps, 4);
  return (
    <div dir="rtl" style={{textAlign: 'right', transform: `translateY(${(1 - p) * 28}px)`, opacity: p}}>
      <Eyebrow>{eyebrow}</Eyebrow>
      <h2 style={{fontSize: 58, lineHeight: 1.12, letterSpacing: -1.8, margin: '22px 0 14px', color: colors.ink}}>{children}</h2>
      {sub && <p style={{fontSize: 27, lineHeight: 1.55, margin: 0, color: colors.muted, maxWidth: 650}}>{sub}</p>}
    </div>
  );
};
