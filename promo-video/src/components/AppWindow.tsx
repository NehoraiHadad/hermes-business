import type {ReactNode} from 'react';
import {colors} from '../theme';
import {Wordmark} from './Brand';

export const AppWindow = ({children, width = 1050, height = 690}: {children: ReactNode; width?: number; height?: number}) => (
  <div style={{width, height, background: colors.paper, borderRadius: 30, border: `1px solid ${colors.line}`, boxShadow: '0 38px 90px #3a34542b', overflow: 'hidden'}}>
    <div style={{height: 74, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 24px', borderBottom: `1px solid ${colors.line}`, background: '#fff'}}>
      <Wordmark compact />
      <div style={{display: 'flex', gap: 10}}><i style={dot('#ff6e6e')} /><i style={dot('#ffbf4f')} /><i style={dot('#46c879')} /></div>
    </div>
    {children}
  </div>
);

const dot = (background: string) => ({display: 'block', width: 13, height: 13, borderRadius: '50%', background});
