import {ArrowLeft, Minimize2} from 'lucide-react';
import {AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig} from 'remotion';
import {Backdrop} from '../components/Backdrop';
import {BrandMark} from '../components/Brand';
import {PrimaryButton} from '../components/UiBits';
import {reveal} from '../motion';
import {colors} from '../theme';

export const IntroScene = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const p = reveal(frame, fps, 3);
  const mini = reveal(frame, fps, 72);
  const glint = interpolate(frame, [30, 105], [-260, 360], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'});
  return (
    <Backdrop>
      <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center'}}>
        <div dir="rtl" style={{textAlign: 'center', transform: `scale(${0.9 + p * 0.1})`, opacity: p, position: 'relative', zIndex: 2}}>
          <div style={{display: 'flex', justifyContent: 'center', marginBottom: 28}}><BrandMark size={108} /></div>
          <h1 style={{fontSize: 86, lineHeight: 1, letterSpacing: -4, color: colors.ink, margin: 0}}>תכל'ס</h1>
          <p style={{fontSize: 35, color: colors.muted, margin: '25px 0 34px'}}>Hermes החזק — מוכן לעבודה, בלי המורכבות</p>
          <PrimaryButton>פשוט מתחילים לדבר <ArrowLeft size={20} /></PrimaryButton>
        </div>
        <div style={{position: 'absolute', top: 60, left: glint, width: 220, height: 1000, transform: 'rotate(20deg)', background: 'linear-gradient(90deg, transparent, #ffffff80, transparent)'}} />
        <div dir="rtl" style={{position: 'absolute', right: 56, bottom: 48, opacity: mini, transform: `translateY(${(1 - mini) * 35}px)`, display: 'flex', alignItems: 'center', gap: 14, padding: '17px 22px', borderRadius: 18, background: '#fff', border: `1px solid ${colors.line}`, boxShadow: '0 20px 55px #302a4830', color: colors.ink, fontSize: 20, fontWeight: 700}}>
          <Minimize2 size={21} color={colors.purple} /> תמיד זמין על שולחן העבודה
        </div>
      </AbsoluteFill>
    </Backdrop>
  );
};
