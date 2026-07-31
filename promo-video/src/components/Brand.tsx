import {Sparkles} from 'lucide-react';
import {colors} from '../theme';

export const BrandMark = ({size = 70}: {size?: number}) => (
  <div style={{width: size, height: size, borderRadius: size * 0.3, display: 'grid', placeItems: 'center', background: `linear-gradient(145deg, ${colors.purple}, ${colors.purpleDark})`, color: 'white', boxShadow: '0 16px 36px #655bd14d'}}>
    <Sparkles size={size * 0.5} strokeWidth={2.3} />
  </div>
);

export const Wordmark = ({compact = false}: {compact?: boolean}) => (
  <div dir="rtl" style={{display: 'flex', alignItems: 'center', gap: 16}}>
    <BrandMark size={compact ? 46 : 66} />
    <div>
      <strong style={{display: 'block', fontSize: compact ? 26 : 38, color: colors.ink}}>העוזר לעסק</strong>
      {!compact && <span style={{fontSize: 21, color: colors.muted}}>פשוט, זמין ומסונכרן</span>}
    </div>
  </div>
);
