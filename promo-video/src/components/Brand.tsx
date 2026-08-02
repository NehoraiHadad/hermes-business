import {colors} from '../theme';
import brandLogo from '../assets/tahlas-logo.png';

export const BrandMark = ({size = 70}: {size?: number}) => (
  <img
    src={brandLogo}
    alt=""
    style={{width: size, height: size, objectFit: 'contain', filter: 'drop-shadow(0 16px 18px #655bd14d)'}}
  />
);

export const Wordmark = ({compact = false}: {compact?: boolean}) => (
  <div dir="rtl" style={{display: 'flex', alignItems: 'center', gap: 16}}>
    <BrandMark size={compact ? 46 : 66} />
    <div>
      <strong style={{display: 'block', fontSize: compact ? 26 : 38, color: colors.ink}}>תכל'ס</strong>
      {!compact && <span style={{fontSize: 21, color: colors.muted}}>פשוט, זמין ומסונכרן</span>}
    </div>
  </div>
);
