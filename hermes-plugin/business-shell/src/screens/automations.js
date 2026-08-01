import React, { useEffect, useState } from 'react'
import { Badge, Button, host } from '@hermes/plugin-sdk'
import { h } from '../dom.js'
import { humanSchedule, isJobPaused, purgeLegacyPausedCache, useAsync } from '../helpers.js'
import { loadScheduledTasks } from '../cron-source.js'
import { Card, SectionTitle } from '../ui.js'
import { NewTaskForm } from './automation-form.js'

// Scheduled-task management. Hermes is the ONLY source of truth: the list comes
// from this plugin's own namespace-locked backend door, which reads the
// authoritative scheduler list_jobs(include_disabled=True) — active AND paused,
// one store, no local cache. If that companion backend isn't available the
// loader falls back to the active-only cron.manage RPC and we say so honestly
// instead of shadowing ghost rows. Mutations stay official cron.manage ops.
export function Automations({ storage }) {
  const [refresh, setRefresh] = useState(0)
  const result = useAsync(() => loadScheduledTasks(), [refresh])
  const jobs = result.value?.jobs || []
  const pausedListingSupported = Boolean(result.value?.pausedListingSupported)

  // Non-authoritative, one-time cleanup of any legacy paused-task cache.
  useEffect(() => {
    purgeLegacyPausedCache(storage)
  }, [])

  async function toggle(job) {
    const id = job.id || job.name
    if (!id) return
    const paused = isJobPaused(job)
    try {
      await host.request('cron.manage', { action: paused ? 'resume' : 'pause', name: id })
      host.notify({
        kind: 'success',
        title: paused ? 'המשימה הופעלה' : 'המשימה הושהתה',
        message: paused ? 'השינוי נשמר ב־Hermes המלא.' : 'היא מנוהלת כעת במסך Cron המלא של Hermes.'
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
      copy: 'המעטפת מציעה תבנית אנושית, אבל שומרת אותה במנגנון ה־Cron הרשמי של Hermes.'
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
                        humanSchedule(job.schedule_display || job.schedule || job.cron)
                      )
                    ),
                    h(
                      'div',
                      { className: 'flex items-center gap-2' },
                      h(Badge, { variant: isJobPaused(job) ? 'muted' : 'default' }, isJobPaused(job) ? 'מושהית' : 'פעילה'),
                      h(Button, { variant: 'outline', size: 'sm', onClick: () => toggle(job) }, isJobPaused(job) ? 'הפעל' : 'השהה')
                    )
                  )
                )
              )
            : h('div', { className: 'py-8 text-center text-xs text-(--ui-text-tertiary)' }, 'עדיין אין משימות מתוזמנות.'),
        // Honest degrade: shown only when the paused-inclusive backend door is
        // unavailable and we fell back to the active-only cron.manage RPC.
        pausedListingSupported
          ? null
          : h(
              'p',
              { className: 'mt-4 text-[0.6875rem] leading-5 text-(--ui-text-tertiary)' },
              'התצוגה הפשוטה מציגה משימות פעילות מתוך Hermes. משימות מושהות נשמרות ב־Hermes ומנוהלות במסך ה־Cron המלא.'
            ),
        h(
          'div',
          { className: 'mt-4 flex flex-wrap justify-end gap-2' },
          h(Button, { variant: 'text', onClick: () => setRefresh(value => value + 1) }, 'רענן'),
          h(Button, { variant: 'textStrong', onClick: () => host.navigate('/cron') }, 'פתח ניהול מלא')
        )
      ),
      h(NewTaskForm, { onCreated: () => setRefresh(value => value + 1) })
    )
  )
}
