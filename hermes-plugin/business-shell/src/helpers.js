import { useEffect, useState } from 'react'

// Pure helpers and small hooks shared by the business shell screens. No JSX and
// no side effects at module load — safe for the contract test that evaluates the
// bundled plugin in a bare VM.

export const PAUSED_CRON_CACHE_TTL_MS = 24 * 60 * 60 * 1000

const TOOL_COPY = {
  google_calendar: 'בודק את היומן…',
  google_drive: 'מחפש ב־Drive…',
  gmail: 'עובד עם המייל…',
  skills_list: 'בודק תהליכים שנלמדו…',
  skill_manage: 'לומד את התהליך…',
  cronjob: 'מעדכן משימה מתוזמנת…',
  browser: 'פותח את הדפדפן…',
  terminal: 'מבצע פעולה במחשב…'
}

export function friendlyToolName(raw) {
  const name = String(raw || '').toLowerCase()
  const key = Object.keys(TOOL_COPY).find(candidate => name.includes(candidate))
  return key ? TOOL_COPY[key] : 'מבצע פעולה…'
}

export function humanSchedule(raw) {
  const schedule =
    raw && typeof raw === 'object'
      ? String(raw.display || raw.expr || raw.cron || raw.value || '')
      : String(raw || '')
  const known = {
    '0 8 * * 0-4': 'ימים א׳–ה׳ בשעה 08:00',
    '0 9 * * *': 'כל יום בשעה 09:00',
    '0 9 * * 0': 'כל יום ראשון בשעה 09:00'
  }
  return known[schedule] || schedule || 'לפי לוח הזמנים של Hermes'
}

export function readPausedCronCache(storage) {
  const now = Date.now()
  const cached = storage.get('pausedCronJobs', [])
  const fresh = Array.isArray(cached)
    ? cached.filter(job => {
        const cachedAt = Date.parse(String(job?.cachedAt || ''))
        return Number.isFinite(cachedAt) && now - cachedAt < PAUSED_CRON_CACHE_TTL_MS
      })
    : []
  if (fresh.length !== (Array.isArray(cached) ? cached.length : 0)) {
    storage.set('pausedCronJobs', fresh)
  }
  return fresh
}

export function flattenSkillNames(value) {
  if (Array.isArray(value)) {
    return value.flatMap(flattenSkillNames)
  }

  if (value && typeof value === 'object') {
    if (typeof value.name === 'string') {
      return [value.name]
    }

    return Object.values(value).flatMap(flattenSkillNames)
  }

  return typeof value === 'string' ? [value] : []
}

export function useAsync(load, deps) {
  const [state, setState] = useState({ loading: true, value: null, error: null })

  useEffect(() => {
    let live = true
    setState(current => ({ ...current, loading: true, error: null }))
    Promise.resolve()
      .then(load)
      .then(value => live && setState({ loading: false, value, error: null }))
      .catch(error => live && setState({ loading: false, value: null, error }))
    return () => {
      live = false
    }
  }, deps)

  return state
}
