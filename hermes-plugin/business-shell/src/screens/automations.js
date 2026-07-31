import React, { useState } from 'react'
import { Badge, Button, host } from '@hermes/plugin-sdk'
import { h } from '../dom.js'
import { humanSchedule, readPausedCronCache, useAsync } from '../helpers.js'
import { Card, SectionTitle } from '../ui.js'
import { NewTaskForm } from './automation-form.js'

// Scheduled-task management. Hermes remains the source of truth; a short-lived
// local cache only bridges paused jobs that the gateway omits from its list.
export function Automations({ storage }) {
  const [refresh, setRefresh] = useState(0)
  const [pausedJobs, setPausedJobs] = useState(() => readPausedCronCache(storage))
  const result = useAsync(() => host.request('cron.manage', { action: 'list' }), [refresh])
  const activeJobs = Array.isArray(result.value?.jobs)
    ? result.value.jobs
    : Array.isArray(result.value)
      ? result.value
      : []
  const activeIds = new Set(activeJobs.map(job => job.id || job.name).filter(Boolean))
  const jobs = [
    ...activeJobs,
    ...pausedJobs.filter(job => !activeIds.has(job.id || job.name))
  ]

  function savePausedJobs(next) {
    setPausedJobs(next)
    storage.set('pausedCronJobs', next)
  }

  async function toggle(job) {
    const id = job.id || job.name
    if (!id) return
    const paused = job.paused || job.enabled === false
    try {
      await host.request('cron.manage', { action: paused ? 'resume' : 'pause', name: id })
      if (paused) {
        savePausedJobs(pausedJobs.filter(item => (item.id || item.name) !== id))
      } else {
        savePausedJobs([
          ...pausedJobs.filter(item => (item.id || item.name) !== id),
          { ...job, enabled: false, paused: true, cachedAt: new Date().toISOString() }
        ])
      }
      host.notify({
        kind: 'success',
        title: paused ? 'המשימה הופעלה' : 'המשימה הושהתה',
        message: 'השינוי נשמר גם במסך Cron המלא.'
      })
      setRefresh(value => value + 1)
    } catch (error) {
      host.notifyError(error, 'לא הצלחנו לעדכן את המשימה')
    }
  }

  return h(
    React.Fragment,
    null,
    h(SectionTitle, {
      eyebrow: 'אוטומציות',
      title: 'משימות קבועות',
      copy: 'ה־POC מציע תבנית אנושית, אבל שומר אותה במנגנון ה־Cron הרשמי של Hermes.'
    }),
    h(
      'div',
      { className: 'grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]' },
      h(
        Card,
        null,
        result.loading
          ? h('div', { className: 'py-8 text-center text-xs text-(--ui-text-tertiary)' }, 'טוען משימות…')
          : jobs.length
            ? h(
                'div',
                { className: 'grid gap-2' },
                ...jobs.map((job, index) =>
                  h(
                    'div',
                    {
                      key: job.id || job.name || index,
                      className:
                        'flex flex-wrap items-center justify-between gap-3 rounded-[4px] border border-(--ui-stroke-secondary) px-3 py-2.5'
                    },
                    h(
                      'div',
                      null,
                      h('div', { className: 'text-xs font-medium text-(--ui-text-primary)' }, job.name || 'משימה'),
                      h(
                        'div',
                        { className: 'mt-0.5 text-[0.6875rem] text-(--ui-text-tertiary)' },
                        humanSchedule(job.schedule || job.cron)
                      )
                    ),
                    h(
                      'div',
                      { className: 'flex items-center gap-2' },
                      h(
                        Badge,
                        { variant: job.enabled === false || job.paused ? 'muted' : 'default' },
                        job.enabled === false || job.paused ? 'מושהית' : 'פעילה'
                      ),
                      h(
                        Button,
                        { variant: 'outline', size: 'sm', onClick: () => toggle(job) },
                        job.enabled === false || job.paused ? 'הפעל' : 'השהה'
                      )
                    )
                  )
                )
              )
            : h('div', { className: 'py-8 text-center text-xs text-(--ui-text-tertiary)' }, 'עדיין אין משימות קבועות.'),
        h(
          'div',
          { className: 'mt-4 flex flex-wrap justify-end gap-2' },
          h(
            Button,
            {
              variant: 'text',
              onClick: () => {
                savePausedJobs([])
                setRefresh(value => value + 1)
                host.notify({
                  kind: 'success',
                  title: 'התצוגה סונכרנה',
                  message: 'מטמון המשימות המושהות נוקה; Hermes המלא נשאר מקור האמת.'
                })
              }
            },
            'סנכרן'
          ),
          h(Button, { variant: 'textStrong', onClick: () => host.navigate('/cron') }, 'פתח ניהול מלא')
        )
      ),
      h(NewTaskForm, { onCreated: () => setRefresh(value => value + 1) })
    )
  )
}
