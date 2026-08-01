import React, { useState } from 'react'
import { Button, evaluateRuntimeReadiness, host, useValue } from '@hermes/plugin-sdk'
import { h } from '../dom.js'
import { summarizeCronJobs, useAsync } from '../helpers.js'
import { Card, Metric, SectionTitle } from '../ui.js'

// System health for a non-technical owner. Every button drives an official Hermes
// door (status, gateway, logs); nothing is uploaded and there is no remote access.
export function Support({ storage }) {
  const gateway = useValue(host.state.gateway)
  const model = useValue(host.state.model)
  const profile = useValue(host.state.profile)
  const [refresh, setRefresh] = useState(0)
  const status = useAsync(() => host.status(), [refresh])
  const runtime = useAsync(() => evaluateRuntimeReadiness(host.request), [refresh])
  const cron = useAsync(() => host.request('cron.manage', { action: 'list' }), [refresh])
  const [logs, setLogs] = useState('')
  const [checking, setChecking] = useState(false)
  // Active tasks from the official cron.manage door — no local paused cache.
  const { jobs: activeJobs } = summarizeCronJobs(cron.value)
  const platformEntries = Object.values(status.value?.gateway_platforms || status.value?.platforms || {})
  const connectedPlatforms = platformEntries.filter(platform => {
    const state = String(platform?.state || platform?.status || '').toLowerCase()
    return ['connected', 'running', 'ok'].includes(state)
  }).length

  async function check() {
    setChecking(true)
    try {
      const [snapshot, readiness] = await Promise.all([host.status(), evaluateRuntimeReadiness(host.request)])
      const gatewayReady = host.state.gateway.get() === 'open'
      if (!gatewayReady || !readiness?.ready) {
        throw new Error(snapshot?.error || 'Hermes או ספק ה־AI אינם מוכנים')
      }
      host.notify({
        kind: 'success',
        title: 'בדיקת התקינות עברה',
        message: `Hermes פועל עם ${host.state.model.get() || readiness.model || 'המודל המוגדר'}.`
      })
    } catch (error) {
      host.notifyError(error, 'בדיקת התקינות מצאה בעיה')
    } finally {
      setRefresh(value => value + 1)
      setChecking(false)
    }
  }

  async function showLogs() {
    try {
      const value = await host.logs({ file: 'errors', lines: 120 })
      setLogs(Array.isArray(value?.lines) ? value.lines.join('\n') : JSON.stringify(value, null, 2))
    } catch (error) {
      host.notifyError(error, 'לא הצלחנו לפתוח את ה־Logs')
    }
  }

  return h(
    React.Fragment,
    null,
    h(SectionTitle, {
      eyebrow: 'תמיכה',
      title: 'מצב המערכת',
      copy: 'הבדיקות מפעילות את דלתות ה־status וה־gateway הרשמיות של Hermes.'
    }),
    h(
      Card,
      null,
      h(
        'div',
        { className: 'grid gap-4 sm:grid-cols-2 lg:grid-cols-4' },
        h(Metric, { label: 'Hermes', value: gateway === 'open' ? 'פועל' : gateway, tone: gateway === 'open' ? 'good' : 'warn' }),
        h(Metric, {
          label: 'Provider',
          value: runtime.loading ? 'בודק…' : runtime.value?.ready ? model || 'מוגדר' : 'לא מוכן',
          tone: runtime.loading ? 'warn' : runtime.value?.ready ? 'good' : 'bad'
        }),
        h(Metric, {
          label: 'גרסת Hermes',
          value: status.value?.version || status.value?.hermes_version || 'נבדקת…',
          tone: 'good'
        }),
        h(Metric, { label: 'פרופיל', value: profile || 'default', tone: 'good' }),
        h(Metric, {
          label: 'חיבורים',
          value: platformEntries.length ? `${connectedPlatforms} מתוך ${platformEntries.length} מחוברים` : 'אין חיבורים מוגדרים',
          tone: connectedPlatforms ? 'good' : 'warn'
        }),
        h(Metric, {
          label: 'משימות פעילות',
          value: `${activeJobs.length} פעילות`,
          tone: activeJobs.length ? 'good' : 'warn'
        })
      ),
      h(
        'div',
        { className: 'mt-5 flex flex-wrap gap-2 border-t border-(--ui-stroke-secondary) pt-4' },
        h(Button, { disabled: checking, onClick: check }, checking ? 'בודק…' : 'בדיקת תקינות'),
        h(Button, { variant: 'outline', onClick: () => host.restartGateway() }, 'הפעל מחדש את Hermes'),
        h(Button, { variant: 'outline', onClick: showLogs }, 'פתח Logs'),
        h(Button, { variant: 'outline', onClick: () => host.navigate('/settings?tab=about') }, 'עדכונים וגרסאות'),
        h(Button, { variant: 'textStrong', onClick: () => host.navigate('/settings?tab=gateway') }, 'אבחון מתקדם')
      )
    ),
    logs
      ? h(
          Card,
          { className: 'mt-4' },
          h(
            'div',
            { className: 'mb-2 flex items-center justify-between' },
            h('h3', { className: 'text-sm font-semibold text-(--ui-text-primary)' }, 'שגיאות אחרונות'),
            h(Button, { variant: 'text', onClick: () => setLogs('') }, 'סגור')
          ),
          h(
            'pre',
            {
              className:
                'max-h-72 overflow-auto whitespace-pre-wrap break-all rounded-[4px] bg-(--ui-bg-primary) p-3 text-[0.6875rem] leading-5 text-(--ui-text-secondary)'
            },
            logs
          )
        )
      : null,
    h(
      'p',
      { className: 'mt-4 text-[0.6875rem] leading-5 text-(--ui-text-quaternary)' },
      'האבחון המתקדם הוא המסך הרשמי של Hermes ואינו מעלה דבר אוטומטית. ZIP מצומצם ללא שיחות, מיילים או קבצי עסק זמין ב־launcher של המעטפת. אין במעטפת גישה מרחוק או backdoor.'
    )
  )
}
