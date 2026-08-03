'use strict'

// Partner visibility feed: aggregates "what did the partner do while the window
// was closed" from THREE official Hermes read doors — cron job runs, background
// (Telegram/WhatsApp/…) sessions, and curator insights — into one IPC snapshot.
// See docs/specs/partner-feed.md for the full architecture/evidence.
//
// Same shape as the existing precedents this follows exactly:
//   - electron/curator-insights.cjs: safeGet-per-source, `available` only true
//     when at least one door answered, never a fabricated "healthy" empty result.
//   - electron/partner-cron.cjs: `api` injected (default hermesApi), tolerant of
//     both the bare-array and {jobs:[...]} response shapes.
//
// The aggregation lives HERE, in main, deliberately — NOT behind `hermes:api` —
// so the renderer never adds a single new `/api/...` literal and
// ALLOWED_API_ROUTES (electron/ipc-guards.cjs) needs zero changes (spec §5).
//
// Privacy (spec §4.1/§8): the payloads this module reads from Hermes carry
// fields that must NEVER cross the IPC boundary — a cron job's `prompt`, its
// `deliver` target, `system_prompt`, token counts, `cwd`. Every value handed
// back to the renderer is built field-by-field from a strict allow-list; there
// is no passthrough spread anywhere in this file.

const { isOwnedCheckin } = require('./partner-checkin-def.cjs')
const { cronJobId } = require('./cron-identity.cjs')
const { getCuratorInsights } = require('./curator-insights.cjs')
const { withProfile } = require('./partner-cron.cjs')

const RUNS_WINDOW_MS = 7 * 24 * 60 * 60 * 1000 // 7 days
const MAX_JOBS_WITH_RUNS = 5 // N+1 bound: at most this many /runs calls per snapshot
const RUNS_LIMIT = 3
const SESSIONS_LIMIT = 30

// Deny-list of OUR OWN surfaces (spec §2.3): any other `source` is shown as a
// background channel. Deliberately allow-by-default for unknown platforms —
// this is a display decision (proof the partner worked), not a security gate.
const OWN_SURFACE_SOURCES = new Set(['desktop', 'cli', 'tui', 'web', 'tool', 'cron'])

function defaultApi() {
  return require('./runtime.cjs').hermesApi
}

// GET wrapper that resolves to null on any failure (endpoint missing, gateway
// down, non-2xx). Never throws, so one failed source can't sink the others and
// never fabricates an empty-but-"successful" result.
async function safeGet(api, endpoint) {
  try {
    const result = await api(endpoint, { method: 'GET' })
    return result == null ? null : result
  } catch {
    return null
  }
}

// /api/cron/jobs?profile=default resolves to a bare array (verified against the
// live 0.19.1 route: profile-scoped listing returns the list directly). Some
// callers/shapes wrap it as {jobs:[...]} (see partner-cron.cjs) — tolerate both.
function jobsFromPayload(payload) {
  if (Array.isArray(payload)) return payload
  return (payload && Array.isArray(payload.jobs) && payload.jobs) || []
}

// /api/cron/jobs/{id}/runs wraps its rows under `runs` (verified:
// _list_cron_job_runs_sync returns {runs, limit}). Tolerate a bare array too.
function runsFromPayload(payload) {
  if (Array.isArray(payload)) return payload
  return (payload && Array.isArray(payload.runs) && payload.runs) || []
}

// /api/sessions wraps its rows under `sessions` (verified: get_sessions returns
// {sessions, total, limit, offset}). Tolerate a bare array too.
function sessionsFromPayload(payload) {
  if (Array.isArray(payload)) return payload
  return (payload && Array.isArray(payload.sessions) && payload.sessions) || []
}

function withinRunsWindow(job, now) {
  if (!job || typeof job.last_run_at !== 'string') return false
  const at = Date.parse(job.last_run_at)
  return Number.isFinite(at) && now - at <= RUNS_WINDOW_MS
}

// Strict allow-list projection of one cron-run session row (spec §4.1). Only
// these fields cross the boundary — never `prompt`/`preview` text beyond what's
// listed here, never system_prompt/tokens/cwd.
function projectRun(row) {
  if (!row || typeof row.id !== 'string') return null
  return {
    id: row.id,
    title: typeof row.title === 'string' ? row.title : null,
    started_at: typeof row.started_at === 'number' ? row.started_at : null,
    ended_at: typeof row.ended_at === 'number' ? row.ended_at : null,
    message_count: typeof row.message_count === 'number' ? row.message_count : 0,
    is_active: Boolean(row.is_active)
  }
}

// Strict allow-list projection of one cron job (spec §4.1). Deliberately omits
// `prompt`, `script`, `skills`, `deliver`, `context_from` and every other field
// the normalized job record carries beyond this list.
function projectJob(job, runs) {
  const id = cronJobId(job)
  return {
    id: typeof id === 'string' ? id : '',
    name: typeof job.name === 'string' ? job.name : '',
    enabled: job.enabled !== false,
    schedule_display: typeof job.schedule_display === 'string' ? job.schedule_display : null,
    last_run_at: typeof job.last_run_at === 'string' ? job.last_run_at : null,
    last_status: job.last_status === 'ok' || job.last_status === 'error' ? job.last_status : null,
    next_run_at: typeof job.next_run_at === 'string' ? job.next_run_at : null,
    isPartnerCheckin: isOwnedCheckin(job),
    runs: (runs || []).map(projectRun).filter(Boolean)
  }
}

// Strict allow-list projection of one background-session row (spec §4.1). Omits
// `system_prompt`, `cwd`, `model_config`, token counts and everything else the
// session-dashboard row can carry.
function projectSessionRow(row) {
  if (!row || typeof row.id !== 'string') return null
  return {
    id: row.id,
    source: typeof row.source === 'string' ? row.source : 'unknown',
    title: typeof row.title === 'string' ? row.title : null,
    preview: typeof row.preview === 'string' ? row.preview : null,
    started_at: typeof row.started_at === 'number' ? row.started_at : null,
    last_active: typeof row.last_active === 'number' ? row.last_active : null,
    message_count: typeof row.message_count === 'number' ? row.message_count : 0
  }
}

// Aggregate the partner-feed snapshot. `api` is injectable (default
// hermesApi) so this is unit-testable with no Electron/gateway involved —
// exactly like curator-insights.cjs / partner-cron.cjs.
async function getPartnerFeed(api = defaultApi()) {
  const generatedAt = new Date().toISOString()
  const now = Date.now()

  const [jobsPayload, sessionsPayload, curatorInsights] = await Promise.all([
    safeGet(api, withProfile('/api/cron/jobs')),
    safeGet(api, withProfile(`/api/sessions?limit=${SESSIONS_LIMIT}&order=recent`)),
    getCuratorInsights(api)
  ])

  const cronOk = jobsPayload !== null
  const rawJobs = cronOk ? jobsFromPayload(jobsPayload) : []

  // N+1 bound (spec §5): fetch /runs for at most MAX_JOBS_WITH_RUNS jobs, and
  // only for jobs that actually ran inside the 7-day window — never one call
  // per job in the full list. Most-recently-run jobs win the cap.
  const jobsNeedingRuns = rawJobs
    .filter(job => withinRunsWindow(job, now))
    .sort((a, b) => Date.parse(b.last_run_at) - Date.parse(a.last_run_at))
    .slice(0, MAX_JOBS_WITH_RUNS)

  const runsById = new Map()
  await Promise.all(
    jobsNeedingRuns.map(async job => {
      const id = cronJobId(job)
      if (id == null) return
      const payload = await safeGet(api, withProfile(`/api/cron/jobs/${encodeURIComponent(id)}/runs?limit=${RUNS_LIMIT}`))
      runsById.set(id, runsFromPayload(payload))
    })
  )

  const jobs = cronOk ? rawJobs.map(job => projectJob(job, runsById.get(cronJobId(job)))) : []

  const sessionsOk = sessionsPayload !== null
  const rawSessions = sessionsOk ? sessionsFromPayload(sessionsPayload) : []
  const sessionRows = rawSessions
    .filter(row => row && !OWN_SURFACE_SOURCES.has(row.source))
    .map(projectSessionRow)
    .filter(Boolean)

  return {
    generatedAt,
    available: cronOk || sessionsOk || curatorInsights.available,
    cron: { ok: cronOk, jobs },
    sessions: { ok: sessionsOk, rows: sessionRows },
    curator: { ok: curatorInsights.available, insights: curatorInsights }
  }
}

module.exports = { getPartnerFeed }
