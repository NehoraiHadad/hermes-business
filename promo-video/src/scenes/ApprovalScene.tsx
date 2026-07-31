import {Eye, Mail, ShieldCheck, X} from 'lucide-react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
import {Backdrop} from '../components/Backdrop';
import {SceneTitle} from '../components/Typography';
import {Card} from '../components/UiBits';
import {reveal} from '../motion';
import {colors} from '../theme';

export const ApprovalScene = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const card = reveal(frame, fps, 34);
  const detail = reveal(frame, fps, 82);
  return (
    <Backdrop tint="#f7f4ee">
      <AbsoluteFill style={{padding: '110px 120px', display: 'grid', gridTemplateColumns: '0.9fr 1.2fr', alignItems: 'center', gap: 120}}>
        <SceneTitle eyebrow="אתה בשליטה" sub="פעולות משמעותיות נעצרות לאישור ברור. אפשר לראות בדיוק מה יקרה לפני שמחליטים.">שום דבר חשוב<br />לא קורה בלי אישור</SceneTitle>
        <div dir="rtl" style={{opacity: card, transform: `translateY(${(1-card)*50}px)`}}>
          <Card style={{padding: 34, width: 760, boxShadow: '0 35px 75px #3a345429'}}>
            <div style={{display: 'flex', gap: 19, alignItems: 'flex-start'}}>
              <div style={{width: 60, height: 60, borderRadius: 18, display: 'grid', placeItems: 'center', background: colors.amberSoft, color: '#a46410'}}><Mail size={29}/></div>
              <div style={{flex: 1}}><P style={{fontSize: 18, color: colors.muted, margin: '2px 0 7px'}}>העוזר מבקש אישור</P><h3 style={{fontSize: 30, margin: 0, color: colors.ink}}>לשלוח מייל לדני כהן?</h3></div>
            </div>
            <div style={{opacity: detail, marginTop: 28, borderRadius: 15, padding: 23, background: '#f8f7f3', border: `1px solid ${colors.line}`}}>
              <div style={{display: 'flex', justifyContent: 'space-between', color: colors.muted, fontSize: 17}}><span>נושא: סיכום הפגישה והצעדים הבאים</span><span>אל: dani@example.com</span></div>
              <p style={{fontSize: 18, lineHeight: 1.65, color: colors.ink, margin: '18px 0 0'}}>היי דני, תודה על השיחה. מצורף סיכום קצר של מה שסיכמנו…</p>
            </div>
            <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 27}}>
              <div style={{display: 'flex', alignItems: 'center', gap: 9, color: colors.muted, fontSize: 17}}><ShieldCheck size={20} color={colors.mint}/>האישור מטופל על ידי Hermes</div>
              <div style={{display: 'flex', gap: 12}}><button style={button('#fff', colors.ink)}><X size={18}/>דחה</button><button style={button(colors.purple, '#fff')}><Eye size={18}/>אשר פעם אחת</button></div>
            </div>
          </Card>
        </div>
      </AbsoluteFill>
    </Backdrop>
  );
};

const P = (props: React.HTMLAttributes<HTMLParagraphElement>) => <p {...props}/>;
const button = (background: string, color: string): React.CSSProperties => ({display: 'flex', alignItems: 'center', gap: 9, padding: '13px 19px', borderRadius: 12, border: `1px solid ${background === '#fff' ? colors.line : background}`, background, color, fontSize: 17, fontWeight: 700});
