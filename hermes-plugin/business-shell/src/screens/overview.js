import React, { useMemo, useState } from 'react'
import { Button, Input, evaluateRuntimeReadiness, host, useValue } from '@hermes/plugin-sdk'
import { h } from '../dom.js'
import { readPausedCronCache, useAsync } from '../helpers.js'
import { Card, Metric } from '../ui.js'
import { ActivityStrip } from './activity-strip.js'
import { HomeQuickActions } from './home-quick-actions.js'

// The business home: live status metrics, recent sessions (searchable) and
// quick-actions that deep-link into the official Hermes screens.
export function Overview({ onOnboarding, storage }) {
  const gateway = useValue(host.state.gateway)
  const model = useValue(host.state.model)
  const profile = useValue(host.state.profile)
  const runtime = useAsync(() => evaluateRuntimeReadiness(host.request), [gateway])
  const [sessionQuery, setSessionQuery] = useState('')
  const sessions = useAsync(() => host.request('session.list', { limit: 50 }), [gateway])
  const cron = useAsync(() => host.request('cron.manage', { action: 'list' }), [gateway])
  const providerReady = Boolean(runtime.value?.ready)
  const sessionRows = Array.isArray(sessions.value?.sessions) ? sessions.value.sessions : []
  const sessionCount = sessionRows.length
  const visibleSessions = useMemo(() => {
    const query = sessionQuery.trim().toLowerCase()
    const rows = query
      ? sessionRows.filter(row => `${row.title || ''} ${row.preview || ''} ${row.id || ''}`.toLowerCase().includes(query))
      : sessionRows
    return rows.slice(0, 8)
  }, [sessionQuery, sessions.value])
  const activeJobs = Array.isArray(cron.value?.jobs) ? cron.value.jobs : Array.isArray(cron.value) ? cron.value : []
  const pausedJobs = readPausedCronCache(storage)
  const activeJobIds = new Set(activeJobs.map(job => job.id || job.name).filter(Boolean))
  const jobs = [...activeJobs, ...pausedJobs.filter(job => !activeJobIds.has(job.id || job.name))]

  return h(
    React.Fragment,
    null,
    h(ActivityStrip),
    h(
      'div',
      { className: 'mb-6 flex flex-wrap items-start justify-between gap-4' },
      h(
        'div',
        null,
        h('div', { className: 'mb-1 text-[0.6875rem] font-semibold text-primary' }, 'HERMES לעסק'),
        h('h1', { className: 'text-2xl font-semibold tracking-tight text-(--ui-text-primary)' }, 'בוקר טוב 👋'),
        h(
          'p',
          { className: 'mt-1 text-sm text-(--ui-text-tertiary)' },
          'אותו Hermes חזק — עם כניסה פשוטה לעבודה היומיומית.'
        )
      ),
      h(
        'div',
        { className: 'flex gap-2' },
        h(Button, { variant: 'outline', onClick: onOnboarding }, 'היכרות עם העסק'),
        h(Button, { onClick: () => host.navigate('/') }, 'שיחה חדשה')
      )
    ),
    h(
      Card,
      { className: 'mb-5' },
      h(
        'div',
        { className: 'grid gap-4 sm:grid-cols-2 lg:grid-cols-4' },
        h(Metric, {
          label: 'Hermes',
          value: gateway === 'open' ? 'פועל ותקין' : 'מתחבר…',
          tone: gateway === 'open' ? 'good' : 'warn'
        }),
        h(Metric, {
          label: 'ספק AI',
          value: providerReady ? model || runtime.value?.model || 'מחובר' : 'נדרשת הגדרה',
          tone: providerReady ? 'good' : 'warn'
        }),
        h(Metric, { label: 'פרופיל פעיל', value: profile || 'default', tone: 'good' }),
        h(Metric, {
          label: 'פעילות',
          value: `${sessionCount} שיחות אחרונות · ${jobs.length} משימות`,
          tone: 'good'
        })
      )
    ),
    h(
      Card,
      { className: 'mb-5' },
      h(
        'div',
        { className: 'mb-3 flex flex-wrap items-center justify-between gap-3' },
        h(
          'div',
          null,
          h('h2', { className: 'text-sm font-semibold text-(--ui-text-primary)' }, 'שיחות אחרונות'),
          h('p', { className: 'mt-0.5 text-xs text-(--ui-text-tertiary)' }, 'אותן שיחות שמופיעות בממשק המלא, ב־CLI ובערוצי ההודעות.')
        ),
        h(Input, {
          value: sessionQuery,
          onChange: event => setSessionQuery(event.target.value),
          placeholder: 'חיפוש בשיחות',
          'aria-label': 'חיפוש בשיחות',
          className: 'w-full sm:w-64'
        })
      ),
      sessions.loading
        ? h('div', { className: 'py-5 text-center text-xs text-(--ui-text-tertiary)' }, 'טוען שיחות…')
        : visibleSessions.length
          ? h(
              'div',
              { className: 'grid gap-2 sm:grid-cols-2' },
              ...visibleSessions.map(session =>
                h(
                  'button',
                  {
                    key: session.id,
                    type: 'button',
                    onClick: () => host.navigate(`/${encodeURIComponent(session.id)}`),
                    className:
                      'rounded-[4px] border border-(--ui-stroke-secondary) bg-(--ui-bg-primary) px-3 py-2.5 text-right hover:bg-(--ui-bg-tertiary)'
                  },
                  h('div', { className: 'truncate text-xs font-medium text-(--ui-text-primary)' }, session.title || 'שיחה ללא כותרת'),
                  h(
                    'div',
                    { className: 'mt-1 line-clamp-2 text-[0.6875rem] leading-5 text-(--ui-text-tertiary)' },
                    session.preview || 'פתח את השיחה לצפייה'
                  )
                )
              )
            )
          : h(
              'div',
              { className: 'py-5 text-center text-xs text-(--ui-text-tertiary)' },
              sessionQuery ? 'לא נמצאו שיחות מתאימות.' : 'עדיין אין שיחות. אפשר להתחיל שיחה חדשה.'
            )
    ),
    h(HomeQuickActions)
  )
}
