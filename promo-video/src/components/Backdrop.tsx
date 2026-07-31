import type {ReactNode} from 'react';
import {AbsoluteFill, useCurrentFrame} from 'remotion';
import {colors} from '../theme';

export const Backdrop = ({children, tint = colors.canvas}: {children: ReactNode; tint?: string}) => {
  const frame = useCurrentFrame();
  const drift = Math.sin(frame / 70) * 18;
  return (
    <AbsoluteFill style={{background: tint, overflow: 'hidden'}}>
      <div style={{position: 'absolute', width: 640, height: 640, borderRadius: '50%', top: -320, left: -120 + drift, background: 'radial-gradient(circle, #dcd7ff 0%, transparent 69%)', opacity: 0.78}} />
      <div style={{position: 'absolute', width: 760, height: 760, borderRadius: '50%', bottom: -480, right: -180 - drift, background: 'radial-gradient(circle, #d9f5e9 0%, transparent 70%)', opacity: 0.78}} />
      <div style={{position: 'absolute', inset: 0, opacity: 0.22, backgroundImage: 'radial-gradient(#9f9aae 0.8px, transparent 0.8px)', backgroundSize: '24px 24px'}} />
      {children}
    </AbsoluteFill>
  );
};
