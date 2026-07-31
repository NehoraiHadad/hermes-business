import {Check, Download, Sparkles} from 'lucide-react';
import {AbsoluteFill, useCurrentFrame, useVideoConfig} from 'remotion';
import {Backdrop} from '../components/Backdrop';
import {BrandMark} from '../components/Brand';
import {reveal} from '../motion';
import {colors} from '../theme';

const points = ['מתקינים', 'מחברים', 'פשוט עובדים'];

export const ClosingScene = () => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const p = reveal(frame, fps, 3);
  return (
    <Backdrop tint="#24213d">
      <AbsoluteFill style={{background: 'linear-gradient(135deg,#25213f 0%,#41376f 58%,#5a4f9b 100%)', alignItems: 'center', justifyContent: 'center'}}>
        <div style={{position:'absolute',inset:0,backgroundImage:'radial-gradient(#ffffff22 1px,transparent 1px)',backgroundSize:'28px 28px'}}/>
        <div dir="rtl" style={{position:'relative',textAlign:'center',color:'#fff',opacity:p,transform:`scale(${0.93+p*0.07})`}}>
          <div style={{display:'flex',justifyContent:'center',marginBottom:26}}><BrandMark size={96}/></div>
          <div style={{display:'inline-flex',alignItems:'center',gap:9,color:'#dcd7ff',fontSize:22,fontWeight:700}}><Sparkles size={22}/>Hermes שמגיע מוכן לעסק</div>
          <h2 style={{fontSize:76,lineHeight:1.08,letterSpacing:-3,margin:'22px 0 18px'}}>פחות הגדרות.<br/>יותר עבודה שנעשית.</h2>
          <div style={{display:'flex',gap:18,justifyContent:'center',marginTop:30}}>{points.map((point,i)=>{const pp=reveal(frame,fps,35+i*13);return <span key={point} style={{opacity:pp,display:'inline-flex',alignItems:'center',gap:8,padding:'12px 18px',borderRadius:999,background:'#ffffff15',border:'1px solid #ffffff24',fontSize:20}}><Check size={18} color="#6fe2bd"/>{point}</span>;})}</div>
          <div style={{display:'inline-flex',alignItems:'center',gap:12,padding:'17px 27px',borderRadius:15,background:'#fff',color:colors.purpleDark,fontSize:21,fontWeight:800,marginTop:38,boxShadow:'0 18px 50px #00000035'}}><Download size={22}/>העוזר לעסק · Windows</div>
        </div>
      </AbsoluteFill>
    </Backdrop>
  );
};
