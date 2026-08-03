import React, { useMemo } from 'react'
import { Button, StatusDot, evaluateRuntimeReadiness, host } from '@hermes/plugin-sdk'
import { h } from '../dom.js'
import { flattenSkillNames, useAsync } from '../helpers.js'
import { Card, SectionTitle } from '../ui.js'

// Connection overview. Every card links into an official Hermes screen or opens a
// guided session — the shell never stores credentials or duplicates state itself.
export function Connections() {
  const provider = useAsync(() => evaluateRuntimeReadiness(host.request), [])
  const skills = useAsync(() => host.request('skills.manage', { action: 'list' }), [])
  const system = useAsync(() => host.status(), [])
  const skillNames = useMemo(() => {
    return flattenSkillNames(skills.value?.skills).join(' ').toLowerCase()
  }, [skills.value])
  const hasGoogle = skillNames.includes('google-workspace')
  const platforms = system.value?.gateway_platforms || system.value?.platforms || {}
  const telegramState = String(platforms.telegram?.state || platforms.telegram?.status || '').toLowerCase()
  const telegramConnected = ['connected', 'running', 'ok'].includes(telegramState)

  const cards = [
    {
      title: 'ספק AI',
      copy: 'OpenAI, Anthropic, Gemini, OpenRouter וספקים נוספים.',
      // A failed readiness probe is NOT proof the provider isn't configured —
      // show it as an explicit unknown, never as the same "נדרשת הגדרה" a
      // genuinely-unconfigured provider would render.
      status: provider.loading ? 'בודק…' : provider.error ? 'לא הצלחנו לבדוק — נסו לרענן' : provider.value?.ready ? 'מוגדר' : 'נדרשת הגדרה',
      connected: Boolean(provider.value?.ready),
      error: Boolean(provider.error),
      action: () => host.navigate('/settings?tab=providers&pview=keys')
    },
    {
      title: 'Google Workspace',
      copy: 'Gmail, יומן, Drive, Docs ו־Sheets דרך ה־Skill הרשמי.',
      // Same rule for the skills-list read: a failed probe must not read as the
      // confident "התקנת Skill נדרשת" a real not-installed Skill would show.
      status: skills.loading ? 'בודק…' : skills.error ? 'לא הצלחנו לבדוק — נסו לרענן' : hasGoogle ? 'יכולת החיבור זמינה' : 'התקנת Skill נדרשת',
      connected: false,
      error: Boolean(skills.error),
      action: async () => {
        try {
          const created = await host.request('session.create', { title: 'חיבור Google Workspace', source: 'desktop' })
          await host.request('prompt.submit', {
            session_id: created.session_id,
            text:
              'עזור לי לחבר Google Workspace באמצעות ה-Skill הרשמי google-workspace של Hermes. הצג כל שלב בפשטות, פתח את כתובת האישור בדפדפן, ואל תבצע פעולת כתיבה בשירות ללא אישור.'
          })
          if (created.stored_session_id) host.navigate(`/${encodeURIComponent(created.stored_session_id)}`)
        } catch (error) {
          host.notifyError(error, 'לא הצלחנו לפתוח את תהליך החיבור')
        }
      }
    },
    {
      title: 'Telegram',
      copy: 'דבר עם אותו Hermes גם מהטלפון באמצעות ה־gateway המובנה.',
      // A failed status probe must not read as the confident "לא מחובר" a real
      // disconnected channel would show.
      status: telegramConnected ? 'מחובר' : system.loading ? 'בודק…' : system.error ? 'לא הצלחנו לבדוק — נסו לרענן' : 'לא מחובר',
      connected: telegramConnected,
      error: Boolean(system.error),
      action: () => host.navigate('/messaging')
    }
  ]

  return h(
    React.Fragment,
    null,
    h(SectionTitle, {
      eyebrow: 'חיבורים',
      title: 'השירותים של העסק',
      copy: 'כל חיבור נשמר ומנוהל על ידי Hermes. המעטפת רק מקצרת את הדרך למסך או ל־Skill הרשמי.'
    }),
    h(
      'div',
      { className: 'grid gap-3 lg:grid-cols-3' },
      ...cards.map(card =>
        h(
          Card,
          { key: card.title },
          h('h3', { className: 'text-sm font-semibold text-(--ui-text-primary)' }, card.title),
          h('p', { className: 'mt-1 min-h-10 text-xs leading-5 text-(--ui-text-tertiary)' }, card.copy),
          h(
            'div',
            { className: 'mt-4 flex items-center justify-between gap-2' },
            h(
              'span',
              { className: 'flex items-center gap-1.5 text-[0.6875rem] text-(--ui-text-tertiary)' },
              h(StatusDot, { tone: card.error ? 'bad' : card.connected ? 'good' : 'muted' }),
              card.status
            ),
            h(Button, { variant: card.connected ? 'outline' : 'default', onClick: card.action }, card.connected ? 'ניהול' : 'חבר')
          )
        )
      )
    ),
    h(
      Card,
      { className: 'mt-3' },
      h(
        'div',
        { className: 'flex flex-wrap items-center justify-between gap-3' },
        h(
          'div',
          null,
          h('h3', { className: 'text-sm font-semibold text-(--ui-text-primary)' }, 'WhatsApp'),
          h(
            'p',
            { className: 'mt-1 max-w-2xl text-xs leading-5 text-(--ui-text-tertiary)' },
            'Hermes תומך גם ב־WhatsApp Business Cloud API וגם בחיבור אישי דרך API צד שלישי. הרישום דרך צד שלישי עלול להשתנות, להיחסם או להביא להגבלת החשבון; מומלץ מספר ייעודי.'
          )
        ),
        h(Button, { variant: 'outline', onClick: () => host.navigate('/messaging') }, 'הצג אפשרויות')
      )
    )
  )
}
