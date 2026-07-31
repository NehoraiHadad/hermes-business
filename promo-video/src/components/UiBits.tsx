import type {ReactNode} from 'react';
import {Check, ChevronLeft} from 'lucide-react';
import {colors} from '../theme';

export const Pill = ({children, tone = 'purple'}: {children: ReactNode; tone?: 'purple' | 'green' | 'amber'}) => {
  const map = {purple: [colors.purpleSoft, colors.purpleDark], green: [colors.mintSoft, '#147b60'], amber: [colors.amberSoft, '#9a5c0b']} as const;
  return <span dir="rtl" style={{display: 'inline-flex', alignItems: 'center', gap: 7, padding: '7px 13px', borderRadius: 999, background: map[tone][0], color: map[tone][1], fontSize: 17, fontWeight: 700}}>{tone === 'green' && <Check size={16} />}{children}</span>;
};

export const PrimaryButton = ({children}: {children: ReactNode}) => (
  <div dir="rtl" style={{display: 'inline-flex', alignItems: 'center', gap: 10, padding: '13px 21px', borderRadius: 13, background: colors.purple, color: 'white', fontSize: 19, fontWeight: 700, boxShadow: '0 10px 24px #7367df40'}}>{children}<ChevronLeft size={19} /></div>
);

export const Card = ({children, style = {}}: {children: ReactNode; style?: React.CSSProperties}) => (
  <div style={{background: '#fff', border: `1px solid ${colors.line}`, borderRadius: 18, boxShadow: '0 10px 25px #3b34540d', ...style}}>{children}</div>
);
