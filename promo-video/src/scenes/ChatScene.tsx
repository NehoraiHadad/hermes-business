import {CalendarDays, Paperclip, Send, Sparkles} from 'lucide-react';
import {AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig} from 'remotion';
import {AppWindow} from '../components/AppWindow';
import {Backdrop} from '../components/Backdrop';
import {Pill} from '../components/UiBits';
import {reveal} from '../motion';
import {colors} from '../theme';

export const ChatScene = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const windowIn = reveal(frame, fps, 2);
  const user = reveal(frame, fps, 30);
  const activity = reveal(frame, fps, 68);
  const reply = reveal(frame, fps, 104);
  const typing = Math.floor(interpolate(frame, [105, 182], [0, 76], {extrapolateLeft: 'clamp', extrapolateRight: 'clamp'}));
  const text = 'מצאתי 4 פגישות. יום שלישי פנוי בין 10:30 ל־12:00. להכין לך הצעה?'.slice(0, typing);
  return (
    <Backdrop tint="#f4f1eb">
      <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center'}}>
        <div style={{opacity: windowIn, transform: `translateY(${(1 - windowIn) * 45}px) scale(${0.96 + windowIn * 0.04})`}}>
          <AppWindow width={1480} height={820}>
            <div style={{height: 746, display: 'grid', gridTemplateColumns: '300px 1fr'}}>
              <aside dir="rtl" style={{padding: 25, borderRight: `1px solid ${colors.line}`, background: '#f8f6f2'}}>
                <div style={{padding: '14px 17px', borderRadius: 13, background: colors.purple, color: '#fff', fontWeight: 700, fontSize: 18}}>＋ שיחה חדשה</div>
                <p style={{fontSize: 15, color: colors.muted, margin: '28px 5px 12px'}}>שיחות אחרונות</p>
                {['תיאום פגישות לשבוע הבא', 'סיכום לידים שבועי', 'ניסוח מייל ללקוח'].map((x, i) => <div key={x} style={{padding: '15px 13px', borderRadius: 11, background: i === 0 ? colors.purpleSoft : 'transparent', color: i === 0 ? colors.purpleDark : colors.ink, fontSize: 17, marginBottom: 5}}>{x}</div>)}
              </aside>
              <main dir="rtl" style={{padding: '28px 55px 30px', display: 'flex', flexDirection: 'column'}}>
                <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}><div><h3 style={{fontSize: 28, margin: 0, color: colors.ink}}>תיאום פגישות לשבוע הבא</h3><p style={{margin: '6px 0', color: colors.muted, fontSize: 16}}>מחובר ל־Hermes</p></div><Pill tone="green">פעיל</Pill></div>
                <div style={{flex: 1, paddingTop: 35}}>
                  <div style={{display: 'flex', justifyContent: 'flex-start', opacity: user, transform: `translateY(${(1 - user) * 20}px)`}}><div style={{background: colors.purple, color: 'white', padding: '17px 21px', borderRadius: '18px 18px 5px 18px', fontSize: 22}}>מתי יש לי זמן פנוי לפגישות בשבוע הבא?</div></div>
                  <div style={{height: 25}} />
                  <div style={{display: 'flex', justifyContent: 'flex-end', opacity: activity}}><div style={{display: 'flex', alignItems: 'center', gap: 12, color: colors.muted, fontSize: 19}}><CalendarDays size={21} color={colors.purple} /><span>בודק את היומן…</span><span style={{display: 'flex', gap: 4}}>{[0,1,2].map(i=><i key={i} style={{width: 7, height: 7, borderRadius: '50%', background: colors.purple, opacity: 0.35 + ((frame+i*7)%24)/38}} />)}</span></div></div>
                  <div style={{height: 22}} />
                  <div style={{display: 'flex', justifyContent: 'flex-end', opacity: reply, transform: `translateY(${(1 - reply) * 18}px)`}}><div style={{maxWidth: 650, minHeight: 48, background: '#fff', border: `1px solid ${colors.line}`, padding: '17px 21px', borderRadius: '18px 18px 18px 5px', color: colors.ink, fontSize: 22, lineHeight: 1.5}}>{text}<span style={{opacity: frame % 18 < 9 ? 1 : 0, color: colors.purple}}>|</span></div></div>
                </div>
                <div style={{border: `1px solid ${colors.line}`, background: '#fff', borderRadius: 17, height: 86, padding: '17px 19px', color: '#aaa6b1', fontSize: 19, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end'}}><div><Paperclip size={21} /></div><span style={{alignSelf: 'flex-start'}}>מה תרצה לעשות?</span><div style={{width: 42, height: 42, borderRadius: 12, display: 'grid', placeItems: 'center', background: colors.purple, color: 'white'}}><Send size={19} /></div></div>
              </main>
            </div>
          </AppWindow>
        </div>
        <div dir="rtl" style={{position: 'absolute', top: 45, left: 92, display: 'flex', gap: 10, color: colors.purpleDark, fontSize: 21, fontWeight: 700}}><Sparkles size={22} /> רואים פעילות — בשפה אנושית</div>
      </AbsoluteFill>
    </Backdrop>
  );
};
