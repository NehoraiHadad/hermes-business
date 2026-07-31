import {CalendarDays, CheckCircle2, MessageCircle, Send, ShieldCheck} from 'lucide-react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
import {AppWindow} from '../components/AppWindow';
import {Backdrop} from '../components/Backdrop';
import {Pill} from '../components/UiBits';
import {reveal} from '../motion';
import {colors} from '../theme';

const connections = [
  {name: 'Google Workspace', desc: 'מייל, יומן, Drive ומסמכים', icon: CalendarDays, tone: '#4285f4'},
  {name: 'Telegram', desc: 'העוזר זמין גם מהטלפון', icon: Send, tone: '#269ed8'},
  {name: 'WhatsApp', desc: 'רשמי או QR — בבחירה שקופה', icon: MessageCircle, tone: '#20b769'},
];

export const ConnectionsScene = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const win = reveal(frame, fps, 2);
  return (
    <Backdrop tint="#f3f0ea">
      <AbsoluteFill style={{padding: '80px 140px', alignItems: 'center', justifyContent: 'center'}}>
        <div dir="rtl" style={{position: 'absolute', top: 45, right: 140}}><Pill tone="green">החיבורים של Hermes</Pill><h2 style={{fontSize: 48, margin: '13px 0 0', color: colors.ink}}>מחברים את הכלים שכבר עובדים איתם</h2></div>
        <div style={{marginTop: 95, opacity: win, transform: `scale(${0.96+win*0.04})`}}>
          <AppWindow width={1460} height={730}>
            <div dir="rtl" style={{height: 656, padding: '42px 55px', background: '#fbfaf7'}}>
              <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}><div><h3 style={{fontSize: 33, margin: 0, color: colors.ink}}>חיבורים</h3><p style={{fontSize: 19, color: colors.muted}}>בלי MCP, בלי קבצי הגדרות ובלי Terminal</p></div><div style={{display: 'flex', alignItems: 'center', gap: 10, color: colors.muted, fontSize: 17}}><ShieldCheck color={colors.mint}/>פרטי החיבור נשמרים במחשב שלך</div></div>
              <div style={{display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 21, marginTop: 30}}>
                {connections.map((item, i) => {
                  const p = reveal(frame, fps, 32 + i * 14);
                  const Icon = item.icon;
                  return <div key={item.name} style={{opacity: p, transform: `translateY(${(1-p)*35}px)`, background: '#fff', border: `1px solid ${colors.line}`, borderRadius: 21, padding: 27, minHeight: 205, boxShadow: '0 12px 28px #352f4d0c'}}><div style={{width: 59, height: 59, borderRadius: 17, display: 'grid', placeItems: 'center', background: `${item.tone}17`, color: item.tone}}><Icon size={30}/></div><h4 style={{fontSize: 24, margin: '19px 0 8px', color: colors.ink}}>{item.name}</h4><p style={{fontSize: 17, color: colors.muted, margin: 0}}>{item.desc}</p><div style={{display: 'flex', alignItems: 'center', gap: 7, color: '#148062', fontSize: 17, fontWeight: 700, marginTop: 20}}><CheckCircle2 size={18}/>מחובר</div></div>;
                })}
              </div>
              <div style={{marginTop: 28, padding: '19px 22px', borderRadius: 15, background: colors.purpleSoft, color: colors.purpleDark, fontSize: 19, display: 'flex', alignItems: 'center', gap: 12}}><CheckCircle2 size={21}/>אותה שיחה ממשיכה גם ב־Telegram וגם בממשק המלא של Hermes.</div>
            </div>
          </AppWindow>
        </div>
      </AbsoluteFill>
    </Backdrop>
  );
};
