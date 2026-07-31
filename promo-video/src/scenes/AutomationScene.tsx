import {BookOpenCheck, CalendarClock, CheckCircle2, Sparkles, Zap} from 'lucide-react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
import {Backdrop} from '../components/Backdrop';
import {SceneTitle} from '../components/Typography';
import {Card, Pill} from '../components/UiBits';
import {reveal} from '../motion';
import {colors} from '../theme';

export const AutomationScene = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  return (
    <Backdrop tint="#f4f1eb">
      <AbsoluteFill style={{padding: '100px 115px', display: 'grid', gridTemplateColumns: '0.9fr 1.2fr', alignItems: 'center', gap: 110}}>
        <SceneTitle eyebrow="משתפר עם העסק" sub="Hermes משתמש ב־Skills ובמשימות המתוזמנות שלו. המעטפת רק הופכת אותם לפשוטים.">תהליכים שחוזרים על עצמם<br />הופכים לאוטומציה</SceneTitle>
        <div dir="rtl" style={{display: 'grid', gap: 22}}>
          <AnimatedCard frame={frame} fps={fps} delay={25}>
            <div style={{display: 'flex', gap: 20, alignItems: 'center'}}><IconBox color={colors.purple} bg={colors.purpleSoft}><Sparkles size={29}/></IconBox><div style={{flex: 1}}><Pill>Skill חדש</Pill><h3 style={title}>העוזר למד להכין סיכום לידים שבועי</h3><p style={desc}>התהליך זמין גם בממשק המלא של Hermes.</p></div><CheckCircle2 size={30} color={colors.mint}/></div>
          </AnimatedCard>
          <AnimatedCard frame={frame} fps={fps} delay={64}>
            <div style={{display: 'flex', gap: 20, alignItems: 'center'}}><IconBox color="#9a5c0b" bg={colors.amberSoft}><CalendarClock size={29}/></IconBox><div style={{flex: 1}}><Pill tone="amber">משימה פעילה</Pill><h3 style={title}>סיכום בוקר</h3><p style={desc}>ימים א׳–ה׳ בשעה 08:00 · נשלח ל־Telegram</p></div><div style={{display: 'flex', alignItems: 'center', gap: 7, color: '#148062', fontWeight: 700, fontSize: 18}}><Zap size={20}/>פעיל</div></div>
          </AnimatedCard>
          <div style={{opacity: reveal(frame, fps, 105), display: 'flex', alignItems: 'center', gap: 11, justifyContent: 'center', fontSize: 18, color: colors.muted}}><BookOpenCheck size={21} color={colors.purple}/>בלי לבנות Skill Engine או Scheduler חדשים</div>
        </div>
      </AbsoluteFill>
    </Backdrop>
  );
};

const AnimatedCard = ({frame, fps, delay, children}: {frame: number; fps: number; delay: number; children: React.ReactNode}) => {const p = reveal(frame, fps, delay); return <div style={{opacity: p, transform: `translateY(${(1-p)*34}px)`}}><Card style={{padding: 28, boxShadow: '0 22px 50px #3a34541a'}}>{children}</Card></div>;};
const IconBox = ({children, color, bg}: {children: React.ReactNode; color: string; bg: string}) => <div style={{width: 66, height: 66, borderRadius: 19, display: 'grid', placeItems: 'center', background: bg, color}}>{children}</div>;
const title: React.CSSProperties = {fontSize: 25, margin: '10px 0 5px', color: colors.ink};
const desc: React.CSSProperties = {fontSize: 17, margin: 0, color: colors.muted};
