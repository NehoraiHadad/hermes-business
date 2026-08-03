import { useEffect, useState } from 'react'
import { humanizeSchedule } from '../../../shared/schedule-display.js'
import { describeTool } from '../../../shared/tool-copy.js'

// Pure helpers and small hooks shared by the business shell screens. No JSX and
// no side effects at module load — safe for the contract test that evaluates the
// bundled plugin in a bare VM.

// Legacy key: earlier builds shadowed paused cron jobs in plugin storage. That
// store is never trusted again — see purgeLegacyPausedCache below.
export const LEGACY_PAUSED_CACHE_KEY = 'pausedCronJobs'

// A short in-progress ellipsis for tool names this shell has its own tighter copy
// for. Anything not listed here falls through to the shared tool-copy classifier
// (../../../shared/tool-copy.js) — the same ~50-rule table src/lib/presentation.ts
// uses — so this went from 8 recognised substrings to full category coverage
// without duplicating a single rule.
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
  if (key) return TOOL_COPY[key]
  // The activity strip only ever has a bare tool name (no action/command), so this
  // resolves to the shared classifier's category default text.
  const described = describeTool(name)
  return described || 'מבצע פעולה…'
}

export function humanSchedule(raw) {
  // Accept either the official human string (schedule_display) or the structured
  // schedule dict. For a dict we pull a known display/expr field — never String()
  // the object, which would render "[object Object]"; an unknown shape degrades to
  // the Hermes-schedule fallback below.
  const schedule =
    raw && typeof raw === 'object'
      ? String(raw.schedule_display || raw.display || raw.expr || raw.cron || raw.value || '')
      : String(raw || '')
  if (!schedule) return 'לפי לוח הזמנים של Hermes'
  // Full cron→Hebrew fidelity (day-range compression, single/arbitrary weekdays,
  // once-schedules) from the same core src/lib/schedule.ts uses — not just the
  // three cron strings the quick-create presets happen to offer. An already-human
  // string, or anything genuinely unrecognised, round-trips through unchanged.
  return humanizeSchedule(schedule)
}

// A job is paused when the OFFICIAL record says so — never a local flag. The
// authoritative schema carries state==='paused'; enabled===false and the legacy
// paused flag are honored too so both doors and older normalizers agree.
export function isJobPaused(job) {
  return Boolean(job && (job.state === 'paused' || job.enabled === false || job.paused === true))
}

// Identity for a scheduled-task row across BOTH doors this shell reads: the
// companion backend projects `id`, the fallback active-only cron.manage RPC emits
// `job_id` (== the same id), and both carry a human `name`. cron.manage's
// resolve_job_ref accepts any of them as a mutation key, so prefer the stable id,
// then job_id, then name — one place, no inline `id || job_id || name` scattered.
export function cronJobId(job) {
  return (job && (job.id || job.job_id || job.name)) || null
}

// Single source of truth for the scheduled-task list: normalize a cron.manage
// result to { jobs, pausedListingSupported }. In Hermes 0.19.x the gateway RPC
// door (cronjob action:'list' -> list_jobs(include_disabled=False)) is
// active-only, so pausedListingSupported is true only if the surface itself
// returned a paused job. That lets a future paused-inclusive Hermes render them
// inline, while today's active-only door is reported honestly (no cache).
export function summarizeCronJobs(result) {
  const jobs = Array.isArray(result?.jobs) ? result.jobs : Array.isArray(result) ? result : []
  return { jobs, pausedListingSupported: jobs.some(isJobPaused) }
}

// One-time, non-authoritative cleanup of the legacy paused-task cache, confined
// to plugin storage. Returns how many stale rows were dropped. The value is
// never read back as truth — pause/resume state lives only in official Hermes.
export function purgeLegacyPausedCache(storage) {
  const legacy = storage.get(LEGACY_PAUSED_CACHE_KEY, null)
  if (legacy == null) return 0
  if (typeof storage.remove === 'function') storage.remove(LEGACY_PAUSED_CACHE_KEY)
  else storage.set(LEGACY_PAUSED_CACHE_KEY, null)
  return Array.isArray(legacy) ? legacy.length : 0
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
