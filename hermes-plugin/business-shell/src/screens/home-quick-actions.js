import React from 'react'
import { host } from '@hermes/plugin-sdk'
import { h } from '../dom.js'
import { QuickAction, SectionTitle } from '../ui.js'

// The business-home shortcut grid. Every tile deep-links into an official Hermes
// screen — no Sessions, Skills or connections are duplicated by the shell.
export function HomeQuickActions() {
  return h(
    React.Fragment,
    null,
    h(SectionTitle, {
      eyebrow: 'קיצורי דרך',
      title: 'מה תרצה לעשות?',
      copy: 'הפעולות פותחות את המסכים הרשמיים של Hermes — אין שכפול של Sessions, Skills או חיבורים.'
    }),
    h(
      'div',
      { className: 'grid gap-3 sm:grid-cols-2 xl:grid-cols-3' },
      h(QuickAction, {
        icon: '💬',
        title: 'לדבר עם העוזר',
        copy: 'שיחה מלאה עם Streaming, קבצים, פעולות ואישורים.',
        onClick: () => host.navigate('/'),
        badge: 'מומלץ'
      }),
      h(QuickAction, {
        icon: '🗓️',
        title: 'משימות קבועות',
        copy: 'סיכום בוקר, מעקב לידים ותהליכים חוזרים.',
        onClick: () => host.navigate('/cron')
      }),
      h(QuickAction, {
        icon: '✨',
        title: 'מה Hermes למד',
        copy: 'Skills קיימים ותהליכים חדשים שהעוזר למד.',
        onClick: () => host.navigate('/skills')
      }),
      h(QuickAction, {
        icon: '🔌',
        title: 'חיבור שירותים',
        copy: 'Telegram וערוצי הודעות דרך מנגנון Hermes.',
        onClick: () => host.navigate('/messaging')
      }),
      h(QuickAction, {
        icon: '🖼️',
        title: 'תוצרים וקבצים',
        copy: 'Artifacts, תמונות, מסמכים וקישורים מכל השיחות.',
        onClick: () => host.navigate('/artifacts')
      }),
      h(QuickAction, {
        icon: '⚙️',
        title: 'Hermes המלא',
        copy: 'Providers, Logs, עדכונים וכל ההגדרות המתקדמות.',
        onClick: () => host.navigate('/settings')
      })
    )
  )
}
