import {BriefcaseBusiness, Check, UserRound} from 'lucide-react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
import {AppWindow} from '../components/AppWindow';
import {Backdrop} from '../components/Backdrop';
import {SceneTitle} from '../components/Typography';
import {Pill, PrimaryButton} from '../components/UiBits';
import {reveal} from '../motion';
import {colors} from '../theme';

const fields = ['שם העסק', 'תחום פעילות', 'סגנון תקשורת', 'שעות עבודה'];

export const OnboardingScene = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const card = reveal(frame, fps, 25);
  return (
    <Backdrop tint="#f7f5ef">
      <AbsoluteFill style={{padding: '105px 115px', display: 'grid', gridTemplateColumns: '1fr 1.42fr', alignItems: 'center', gap: 80}}>
        <SceneTitle eyebrow="מתחילים נכון" sub="אשף קצר מכיר את המשתמש ואת העסק — ושומר את המידע במנגנונים של Hermes.">העוזר לומד<br />איך העסק שלך עובד</SceneTitle>
        <div style={{transform: `translateX(${(1 - card) * 90}px) scale(${0.95 + card * 0.05})`, opacity: card}}>
          <AppWindow width={1010} height={720}>
            <div dir="rtl" style={{height: 646, padding: '42px 52px', background: '#fbfaf7'}}>
              <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
                <div><Pill>שלב 2 מתוך 4</Pill><h3 style={{fontSize: 34, margin: '16px 0 7px', color: colors.ink}}>כמה מילים על העסק</h3><p style={{fontSize: 19, color: colors.muted, margin: 0}}>כדי שהתשובות יתאימו באמת לעבודה היומיומית</p></div>
                <div style={{width: 66, height: 66, borderRadius: 20, display: 'grid', placeItems: 'center', color: colors.purple, background: colors.purpleSoft}}><BriefcaseBusiness size={32} /></div>
              </div>
              <div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18, marginTop: 34}}>
                {fields.map((field, i) => {
                  const fp = reveal(frame, fps, 42 + i * 8);
                  return <div key={field} style={{opacity: fp, transform: `translateY(${(1 - fp) * 16}px)`}}><label style={{display: 'block', fontSize: 17, color: colors.ink, marginBottom: 8, fontWeight: 700}}>{field}</label><div style={{height: 53, borderRadius: 12, border: `1px solid ${colors.line}`, background: '#fff', padding: '14px 16px', color: i === 0 ? colors.ink : '#9b99a8', fontSize: 18}}>{i === 0 ? 'סטודיו נועה' : 'ממלאים בשיחה פשוטה…'}</div></div>;
                })}
              </div>
              <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 35}}><div style={{display: 'flex', gap: 13, color: colors.muted, alignItems: 'center', fontSize: 18}}><UserRound size={19} /> המידע נשאר במחשב שלך</div><PrimaryButton>המשך <Check size={18} /></PrimaryButton></div>
            </div>
          </AppWindow>
        </div>
      </AbsoluteFill>
    </Backdrop>
  );
};
