import { describe, expect, it } from 'vitest'
import { getPartnerFeed } from './partner-feed.cjs'

// Mirrors the recorder idiom in curator-insights.test.ts: an injected `api`
// keyed by exact endpoint string, so assertions can pin the precise
// query-string shape (profile=default, limit=N) each door is called with.
function recorder(map: Record<string, unknown | (() => never)>) {
  const calls: string[] = []
  const api = async (endpoint: string) => {
    calls.push(endpoint)
    if (!(endpoint in map)) return null
    const value = map[endpoint]
    if (typeof value === 'function') return (value as () => never)()
    return value
  }
  return { api, calls }
}

const boom = () => {
  throw new Error('gateway down')
}

const NOW = Date.now()
const isoAgo = (ms: number) => new Date(NOW - ms).toISOString()

const CHECKIN_JOB = {
  id: 'checkin-1',
  name: 'צ׳ק־אין שותף עסקי · כל יום ראשון ב-08:00 [hermes-business-partner-checkin:brief:weekly]',
  enabled: true,
  schedule_display: 'כל יום ראשון ב-08:00',
  last_run_at: isoAgo(60 * 60 * 1000), // 1 hour ago
  last_status: 'ok',
  next_run_at: null,
  // Fields that must NEVER cross the IPC boundary:
  prompt: 'SECRET-CHECKIN-PROMPT',
  deliver: 'local',
  system_prompt: 'SECRET-SYSTEM-PROMPT',
  input_tokens: 4321,
  output_tokens: 1234,
  cwd: 'C:\\Users\\owner\\secret-project'
}

const TASK_JOB = {
  id: 'task-2',
  name: 'סיכום שבועי',
  enabled: true,
  schedule_display: 'כל יום שני ב-09:00',
  last_run_at: isoAgo(2 * 60 * 60 * 1000), // 2 hours ago
  last_status: 'error',
  next_run_at: isoAgo(-7 * 24 * 60 * 60 * 1000),
  prompt: 'SECRET-TASK-PROMPT',
  deliver: 'telegram',
  model_config: { model: 'secret-model' }
}

const CHECKIN_RUN = {
  id: 'cron_checkin-1_1730000000',
  title: 'צ׳ק־אין שותף עסקי',
  started_at: 1730000000,
  ended_at: 1730000300,
  message_count: 6,
  is_active: false,
  // Must never cross the boundary either.
  system_prompt: 'SECRET-RUN-SYSTEM-PROMPT',
  cwd: 'C:\\secret\\run-cwd'
}

const TELEGRAM_SESSION = {
  id: 'telegram-abc',
  source: 'telegram',
  title: 'שיחה עם דני',
  preview: 'תודה על העדכון!',
  started_at: 1730001000,
  last_active: 1730001500,
  message_count: 3,
  system_prompt: 'SECRET-SESSION-SYSTEM-PROMPT',
  cwd: 'C:\\secret\\session-cwd'
}

const DESKTOP_SESSION = {
  id: 'desktop-own-1',
  source: 'desktop',
  title: 'שיחה מהאפליקציה',
  preview: 'זה לא אמור להופיע כרקע',
  started_at: 1730002000,
  last_active: 1730002500,
  message_count: 2
}

function endpointFor(jobId: string, limit = 3) {
  return `/api/cron/jobs/${jobId}/runs?limit=${limit}&profile=default`
}

const BASE_MAP = {
  '/api/cron/jobs?profile=default': [CHECKIN_JOB, TASK_JOB],
  '/api/sessions?limit=30&order=recent&profile=default': { sessions: [TELEGRAM_SESSION, DESKTOP_SESSION] },
  '/api/curator': { paused: false, last_run_at: isoAgo(3 * 60 * 60 * 1000) },
  '/api/learning/graph?profile=default': { stats: { learned_skills: 2 } },
  [endpointFor('checkin-1')]: { runs: [CHECKIN_RUN] },
  [endpointFor('task-2')]: { runs: [] }
}

describe('getPartnerFeed — composition', () => {
  it('composes a snapshot from all three official doors', async () => {
    const { api } = recorder(BASE_MAP)
    const snapshot = await getPartnerFeed(api)

    expect(snapshot.available).toBe(true)
    expect(snapshot.cron).toEqual({
      ok: true,
      jobs: [
        {
          id: 'checkin-1',
          name: CHECKIN_JOB.name,
          enabled: true,
          schedule_display: 'כל יום ראשון ב-08:00',
          last_run_at: CHECKIN_JOB.last_run_at,
          last_status: 'ok',
          next_run_at: null,
          isPartnerCheckin: true,
          runs: [
            {
              id: 'cron_checkin-1_1730000000',
              title: 'צ׳ק־אין שותף עסקי',
              started_at: 1730000000,
              ended_at: 1730000300,
              message_count: 6,
              is_active: false
            }
          ]
        },
        {
          id: 'task-2',
          name: 'סיכום שבועי',
          enabled: true,
          schedule_display: 'כל יום שני ב-09:00',
          last_run_at: TASK_JOB.last_run_at,
          last_status: 'error',
          next_run_at: TASK_JOB.next_run_at,
          isPartnerCheckin: false,
          runs: []
        }
      ]
    })
    expect(snapshot.sessions).toEqual({
      ok: true,
      rows: [
        {
          id: 'telegram-abc',
          source: 'telegram',
          title: 'שיחה עם דני',
          preview: 'תודה על העדכון!',
          started_at: 1730001000,
          last_active: 1730001500,
          message_count: 3
        }
      ]
    })
    expect(snapshot.curator.ok).toBe(true)
    expect(snapshot.curator.insights?.available).toBe(true)
    expect(typeof snapshot.generatedAt).toBe('string')
    expect(Number.isNaN(Date.parse(snapshot.generatedAt))).toBe(false)
  })

  it('excludes own-surface sessions (desktop/cli/tui/web/tool/cron) from the background list', async () => {
    const { api } = recorder(BASE_MAP)
    const snapshot = await getPartnerFeed(api)
    expect(snapshot.sessions.rows.find(row => row.source === 'desktop')).toBeUndefined()
    expect(snapshot.sessions.rows.map(row => row.id)).toEqual(['telegram-abc'])
  })

  it('tolerates the {jobs:[...]} cron response shape, same as partner-cron.cjs', async () => {
    const { api } = recorder({ ...BASE_MAP, '/api/cron/jobs?profile=default': { jobs: [TASK_JOB] } })
    const snapshot = await getPartnerFeed(api)
    expect(snapshot.cron.ok).toBe(true)
    expect(snapshot.cron.jobs.map(j => j.id)).toEqual(['task-2'])
  })

  it('tolerates a bare-array /runs response', async () => {
    const { api } = recorder({ ...BASE_MAP, [endpointFor('checkin-1')]: [CHECKIN_RUN] })
    const snapshot = await getPartnerFeed(api)
    expect(snapshot.cron.jobs[0].runs).toHaveLength(1)
  })

  it('tolerates a bare-array /sessions response', async () => {
    const { api } = recorder({ ...BASE_MAP, '/api/sessions?limit=30&order=recent&profile=default': [TELEGRAM_SESSION] })
    const snapshot = await getPartnerFeed(api)
    expect(snapshot.sessions.ok).toBe(true)
    expect(snapshot.sessions.rows).toHaveLength(1)
  })
})

describe('getPartnerFeed — check-in detection', () => {
  it('marks only the owned check-in job via isOwnedCheckin', async () => {
    const { api } = recorder(BASE_MAP)
    const snapshot = await getPartnerFeed(api)
    const checkin = snapshot.cron.jobs.find(j => j.id === 'checkin-1')
    const task = snapshot.cron.jobs.find(j => j.id === 'task-2')
    expect(checkin?.isPartnerCheckin).toBe(true)
    expect(task?.isPartnerCheckin).toBe(false)
  })
})

describe('getPartnerFeed — fail-closed per source', () => {
  it('marks cron.ok:false and returns an empty job list on a jobs-list failure, without sinking the other sources', async () => {
    const { api } = recorder({ ...BASE_MAP, '/api/cron/jobs?profile=default': boom })
    const snapshot = await getPartnerFeed(api)
    expect(snapshot.cron).toEqual({ ok: false, jobs: [] })
    expect(snapshot.sessions.ok).toBe(true)
    expect(snapshot.curator.ok).toBe(true)
    expect(snapshot.available).toBe(true)
  })

  it('marks sessions.ok:false and returns an empty row list on a sessions failure, without sinking cron', async () => {
    const { api } = recorder({ ...BASE_MAP, '/api/sessions?limit=30&order=recent&profile=default': boom })
    const snapshot = await getPartnerFeed(api)
    expect(snapshot.sessions).toEqual({ ok: false, rows: [] })
    expect(snapshot.cron.ok).toBe(true)
    expect(snapshot.available).toBe(true)
  })

  it('marks curator.ok:false on a curator failure, without sinking cron/sessions', async () => {
    const { api } = recorder({ ...BASE_MAP, '/api/curator': boom, '/api/learning/graph?profile=default': boom })
    const snapshot = await getPartnerFeed(api)
    expect(snapshot.curator).toEqual({ ok: false, insights: { available: false, curator: null, learning: null } })
    expect(snapshot.cron.ok).toBe(true)
    expect(snapshot.available).toBe(true)
  })

  it('never fabricates a healthy empty list: a failed /runs call leaves that job with runs:[], not a thrown error', async () => {
    const { api } = recorder({ ...BASE_MAP, [endpointFor('checkin-1')]: boom })
    const snapshot = await getPartnerFeed(api)
    const checkin = snapshot.cron.jobs.find(j => j.id === 'checkin-1')
    expect(checkin?.runs).toEqual([])
    expect(snapshot.cron.ok).toBe(true)
  })

  it('is unavailable (never fabricates) only when every source fails', async () => {
    const { api } = recorder({
      '/api/cron/jobs?profile=default': boom,
      '/api/sessions?limit=30&order=recent&profile=default': boom,
      '/api/curator': boom,
      '/api/learning/graph?profile=default': boom
    })
    const snapshot = await getPartnerFeed(api)
    expect(snapshot).toEqual({
      generatedAt: snapshot.generatedAt,
      available: false,
      cron: { ok: false, jobs: [] },
      sessions: { ok: false, rows: [] },
      curator: { ok: false, insights: { available: false, curator: null, learning: null } }
    })
  })
})

describe('getPartnerFeed — privacy allow-list (explicit deny)', () => {
  it('never lets prompt/deliver/system_prompt/tokens/cwd cross the IPC boundary', async () => {
    const { api } = recorder(BASE_MAP)
    const snapshot = await getPartnerFeed(api)
    const serialized = JSON.stringify(snapshot)

    // Distinctive secret markers planted on the raw fixtures above — if any of
    // these leak through, the allow-list projection has a hole.
    for (const secret of [
      'SECRET-CHECKIN-PROMPT',
      'SECRET-TASK-PROMPT',
      'SECRET-SYSTEM-PROMPT',
      'SECRET-RUN-SYSTEM-PROMPT',
      'SECRET-SESSION-SYSTEM-PROMPT',
      'secret-project',
      'secret-run-cwd',
      'secret-session-cwd',
      'secret-model'
    ]) {
      expect(serialized).not.toContain(secret)
    }

    // Field-name check too, independent of value content.
    for (const field of ['prompt', 'deliver', 'system_prompt', 'model_config', 'input_tokens', 'output_tokens', 'cwd']) {
      expect(serialized).not.toContain(`"${field}"`)
    }

    // And structurally: every projected job/run/session carries EXACTLY the
    // allow-listed keys, nothing extra.
    for (const job of snapshot.cron.jobs) {
      expect(Object.keys(job).sort()).toEqual(
        [
          'enabled',
          'id',
          'isPartnerCheckin',
          'last_run_at',
          'last_status',
          'name',
          'next_run_at',
          'runs',
          'schedule_display'
        ].sort()
      )
      for (const run of job.runs) {
        expect(Object.keys(run).sort()).toEqual(
          ['ended_at', 'id', 'is_active', 'message_count', 'started_at', 'title'].sort()
        )
      }
    }
    for (const row of snapshot.sessions.rows) {
      expect(Object.keys(row).sort()).toEqual(
        ['id', 'last_active', 'message_count', 'preview', 'source', 'started_at', 'title'].sort()
      )
    }
  })
})

describe('getPartnerFeed — N+1 bounding', () => {
  function jobAt(id: string, msAgo: number) {
    return {
      id,
      name: `job-${id}`,
      enabled: true,
      schedule_display: 'כל יום',
      last_run_at: isoAgo(msAgo),
      last_status: 'ok',
      next_run_at: null
    }
  }

  it('fetches /runs for at most 5 jobs, preferring the most recently run, at limit=3', async () => {
    const jobs = [
      jobAt('j1', 1 * 60 * 60 * 1000), // most recent
      jobAt('j2', 2 * 60 * 60 * 1000),
      jobAt('j3', 3 * 60 * 60 * 1000),
      jobAt('j4', 4 * 60 * 60 * 1000),
      jobAt('j5', 5 * 60 * 60 * 1000),
      jobAt('j6', 6 * 60 * 60 * 1000),
      jobAt('j7', 7 * 60 * 60 * 1000) // 7 jobs, only top 5 should be fetched
    ]
    const map: Record<string, unknown> = {
      '/api/cron/jobs?profile=default': jobs,
      '/api/sessions?limit=30&order=recent&profile=default': { sessions: [] },
      '/api/curator': {},
      '/api/learning/graph?profile=default': {}
    }
    for (const job of jobs) map[endpointFor(job.id)] = { runs: [] }
    const { api, calls } = recorder(map)

    await getPartnerFeed(api)

    const runCalls = calls.filter(c => c.includes('/runs'))
    expect(runCalls).toHaveLength(5)
    expect(runCalls).toEqual(
      expect.arrayContaining([endpointFor('j1'), endpointFor('j2'), endpointFor('j3'), endpointFor('j4'), endpointFor('j5')])
    )
    expect(runCalls).not.toEqual(expect.arrayContaining([endpointFor('j6')]))
    expect(runCalls).not.toEqual(expect.arrayContaining([endpointFor('j7')]))
    for (const call of runCalls) expect(call).toContain('limit=3')
  })

  it('never fetches /runs for a job whose last_run_at is outside the 7-day window', async () => {
    const staleJob = jobAt('stale', 8 * 24 * 60 * 60 * 1000) // 8 days ago
    const neverRunJob = { ...jobAt('never', 0), last_run_at: null }
    const map: Record<string, unknown> = {
      '/api/cron/jobs?profile=default': [staleJob, neverRunJob],
      '/api/sessions?limit=30&order=recent&profile=default': { sessions: [] },
      '/api/curator': {},
      '/api/learning/graph?profile=default': {},
      [endpointFor('stale')]: { runs: [{ id: 'should-not-be-fetched', started_at: 1, ended_at: 1, message_count: 1, is_active: false }] }
    }
    const { api, calls } = recorder(map)

    const snapshot = await getPartnerFeed(api)

    expect(calls.some(c => c.includes('/runs'))).toBe(false)
    expect(snapshot.cron.jobs.find(j => j.id === 'stale')?.runs).toEqual([])
    expect(snapshot.cron.jobs.find(j => j.id === 'never')?.runs).toEqual([])
  })
})
