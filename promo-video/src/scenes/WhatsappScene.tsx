import {Check, LockKeyhole, MessageCircle, Shield} from 'lucide-react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
import {Backdrop} from '../components/Backdrop';
import {SceneTitle} from '../components/Typography';
import {Card, Pill} from '../components/UiBits';
import {reveal} from '../motion';
import {colors} from '../theme';

const options = [
  {title: 'קריאה בלבד', text: 'הודעות נשמרות — הסוכן לא עונה', icon: LockKeyhole},
  {title: 'רק שיחות נבחרות', text: 'מענה רק לאנשי קשר שהוגדרו', icon: MessageCircle},
];

export const WhatsappScene = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const panel = reveal(frame, fps, 25);
  return (
    <Backdrop tint="#f7f5ef">
      <AbsoluteFill style={{padding: '105px 120px', display: 'grid', gridTemplateColumns: '0.9fr 1.15fr', gap: 120, alignItems: 'center'}}>
        <SceneTitle eyebrow="WhatsApp בשליטה" sub="מדיניות fail-closed נאכפת מתחת לממשק — לא רק כמתג שנראה יפה.">העסק קובע<br />מי מקבל תשובה</SceneTitle>
        <div dir="rtl" style={{opacity: panel, transform: `translateX(${(1-panel)*85}px)`}}>
          <Card style={{padding: 34, width: 760, boxShadow: '0 35px 75px #3a345429'}}>
            <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between'}}><div><Pill tone="green">מדיניות פעילה</Pill><h3 style={{fontSize: 31, margin: '14px 0 3px', color: colors.ink}}>איך העוזר עובד ב־WhatsApp?</h3></div><div style={{width: 65, height: 65, display: 'grid', placeItems: 'center', borderRadius: 19, background: colors.mintSoft, color: '#188365'}}><Shield size={31}/></div></div>
            <div style={{display: 'grid', gap: 15, marginTop: 27}}>
              {options.map((option, i) => {const p = reveal(frame, fps, 48+i*28); const Icon = option.icon; const selected = frame < 125 ? i === 0 : i === 1; return <div key={option.title} style={{opacity: p, display: 'flex', alignItems: 'center', gap: 18, padding: 21, borderRadius: 16, border: `2px solid ${selected ? colors.purple : colors.line}`, background: selected ? colors.purpleSoft : '#fff'}}><span style={{width: 28, height: 28, borderRadius: '50%', display: 'grid', placeItems: 'center', background: selected ? colors.purple : '#fff', border: `2px solid ${selected ? colors.purple : '#bbb7c4'}`, color: '#fff'}}>{selected && <Check size={17}/>}</span><Icon size={25} color={selected ? colors.purple : colors.muted}/><div><strong style={{fontSize: 21, color: colors.ink}}>{option.title}</strong><p style={{fontSize: 17, margin: '5px 0 0', color: colors.muted}}>{option.text}</p></div></div>;})}
            </div>
            <div style={{marginTop: 25, borderTop: `1px solid ${colors.line}`, paddingTop: 20, color: colors.muted, fontSize: 16, lineHeight: 1.6}}>המסלול הרשמי של Meta מוצג בנפרד מחיבור QR לא־רשמי — בלי להסתיר את ההבדלים.</div>
          </Card>
        </div>
      </AbsoluteFill>
    </Backdrop>
  );
};
