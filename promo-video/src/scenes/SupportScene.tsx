import {Activity, CheckCircle2, ExternalLink, FileArchive, HeartPulse, RefreshCw} from 'lucide-react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
import {AppWindow} from '../components/AppWindow';
import {Backdrop} from '../components/Backdrop';
import {Pill} from '../components/UiBits';
import {reveal} from '../motion';
import {colors} from '../theme';

const rows = [
  {label: 'Hermes', value: 'פועל', icon: Activity},
  {label: 'ספק AI', value: 'מחובר', icon: CheckCircle2},
  {label: 'חיבורים', value: '3 תקינים', icon: HeartPulse},
  {label: 'משימות', value: '2 פעילות', icon: RefreshCw},
];

export const SupportScene = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const win = reveal(frame, fps, 4);
  return (
    <Backdrop tint="#f7f5ef">
      <AbsoluteFill style={{alignItems: 'center', justifyContent: 'center'}}>
        <div dir="rtl" style={{position: 'absolute', top: 40, right: 145}}><Pill tone="green">הכול במקום אחד</Pill><h2 style={{fontSize: 46, margin: '12px 0 0', color: colors.ink}}>תמיכה, תקינות — וגישה ל־Hermes המלא</h2></div>
        <div style={{marginTop: 100, opacity: win, transform: `translateY(${(1-win)*45}px)`}}>
          <AppWindow width={1480} height={730}>
            <div dir="rtl" style={{height: 656, padding: '38px 48px', background: '#fbfaf7', display: 'grid', gridTemplateColumns: '1.2fr 0.8fr', gap: 24}}>
              <section style={panel}><h3 style={heading}>מצב המערכת</h3><div style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 25}}>{rows.map((row, i) => {const p = reveal(frame, fps, 35+i*10); const Icon=row.icon; return <div key={row.label} style={{opacity:p, padding: 18, borderRadius: 14, background: '#f8f7f3', display: 'flex', alignItems: 'center', gap: 15}}><Icon size={22} color={colors.mint}/><div><span style={{display:'block',fontSize:15,color:colors.muted}}>{row.label}</span><strong style={{fontSize:19,color:colors.ink}}>{row.value}</strong></div></div>;})}</div><div style={{display:'flex', gap:12, marginTop:24}}><Action icon={<HeartPulse size={18}/>} label="בדיקת תקינות" primary/><Action icon={<FileArchive size={18}/>} label="חבילת אבחון בטוחה"/></div></section>
              <section style={panel}><h3 style={heading}>אותו Hermes, שתי דרכי שימוש</h3><p style={{fontSize:18,lineHeight:1.55,color:colors.muted}}>Profile, שיחות, זיכרון, Skills ומשימות נשארים משותפים.</p><div style={{height:155,borderRadius:17,background:`linear-gradient(145deg,${colors.purpleSoft},#fff)`,border:`1px solid ${colors.line}`,display:'grid',placeItems:'center',marginTop:25}}><div style={{textAlign:'center'}}><ExternalLink size={34} color={colors.purple}/><strong style={{display:'block',fontSize:23,color:colors.ink,marginTop:12}}>פתח את Hermes המלא</strong><span style={{fontSize:16,color:colors.muted}}>למשתמש מתקדם או לתמיכה</span></div></div><p style={{fontSize:14,lineHeight:1.5,color:colors.muted,marginTop:19}}>חבילת האבחון אינה כוללת מפתחות, שיחות, מיילים או קבצי עסק.</p></section>
            </div>
          </AppWindow>
        </div>
      </AbsoluteFill>
    </Backdrop>
  );
};

const panel: React.CSSProperties={background:'#fff',border:`1px solid ${colors.line}`,borderRadius:20,padding:28};
const heading: React.CSSProperties={fontSize:27,color:colors.ink,margin:0};
const Action=({icon,label,primary=false}:{icon:React.ReactNode;label:string;primary?:boolean})=><div style={{display:'flex',alignItems:'center',gap:9,padding:'12px 16px',borderRadius:12,background:primary?colors.purple:'#fff',color:primary?'#fff':colors.ink,border:`1px solid ${primary?colors.purple:colors.line}`,fontWeight:700,fontSize:16}}>{icon}{label}</div>;
