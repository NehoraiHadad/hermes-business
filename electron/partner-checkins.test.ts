import { describe, expect, it } from 'vitest'
import {
  reconcileCheckins,
  desiredCheckin,
  isOwnedCheckin,
  ownedCadence,
  checkinDrifted,
  checkinName,
  readCheckinStatus
} from './partner-checkins.cjs'

type Job = Record<string, any>

// In-memory stand-in for the ONE official Hermes cron store. Reconciliation only
// ever drives these operations; the real electron client (partner-cron.cjs) maps
// them 1:1 onto /api/cron/jobs.
function fakeCron(initial: Job[] = []) {
  let jobs = initial.map(j => ({ ...j }))
  let seq = 0
  const calls: Array<[string, string]> = []
  return {
    all: () => jobs,
    calls,
    list: async () => jobs.map(j => ({ ...j })),
    create: async (job: Job) => {
      const created = { id: `job-${++seq}`, enabled: true, state: 'scheduled', created_at: `2020-01-0${seq}`, ...job }
      jobs.push(created)
      calls.push(['create', created.id])
      return created
    },
    update: async (id: string, updates: Job) => {
      Object.assign(jobs.find(j => j.id === id)!, updates)
      calls.push(['update', id])
    },
    pause: async (id: string) => {
      Object.assign(jobs.find(j => j.id === id)!, { enabled: false, state: 'paused' })
      calls.push(['pause', id])
    },
    resume: async (id: string) => {
      Object.assign(jobs.find(j => j.id === id)!, { enabled: true, state: 'scheduled' })
      calls.push(['resume', id])
    },
    remove: async (id: string) => {
      jobs = jobs.filter(j => j.id !== id)
      calls.push(['remove', id])
    }
  }
}

const ownedJob = (cadence: string, over: Job = {}): Job => {
  const desired = desiredCheckin({ mode: 'partner', checkins: true, checkinCadence: cadence })!
  return {
    id: over.id || 'owned-1',
    name: checkinName(cadence),
    prompt: desired.prompt,
    schedule: desired.schedule,
    deliver: 'local',
    enabled: true,
    state: 'scheduled',
    created_at: '2020-01-01',
    ...over
  }
}

const ENABLED = { mode: 'partner', checkins: true, checkinCadence: 'weekly' }
const USER_JOB: Job = { id: 'user-1', name: 'הדוח השבועי שלי', enabled: true, created_at: '2019-01-01' }

describe('marker helpers', () => {
  it('desiredCheckin is null unless partner mode + opt-in', () => {
    expect(desiredCheckin({ mode: 'normal', checkins: true, checkinCadence: 'weekly' })).toBeNull()
    expect(desiredCheckin({ mode: 'partner', checkins: false, checkinCadence: 'weekly' })).toBeNull()
    expect(desiredCheckin(ENABLED)!.schedule).toBe('0 8 * * 0')
  })

  it('weekdays follows the Israeli business week (Sun-Thu = cron 0-4, not Mon-Fri 1-5)', () => {
    const weekdays = desiredCheckin({ mode: 'partner', checkins: true, checkinCadence: 'weekdays' })!
    expect(weekdays.schedule).toBe('0 8 * * 0-4')
    expect(weekdays.name).toContain('א׳–ה׳')
    // daily has no day-of-week restriction; weekly fires Sunday.
    expect(desiredCheckin({ mode: 'partner', checkins: true, checkinCadence: 'daily' })!.schedule).toBe('0 8 * * *')
  })

  it('recognises only its own marked jobs and parses the cadence', () => {
    expect(isOwnedCheckin(ownedJob('daily'))).toBe(true)
    expect(isOwnedCheckin(USER_JOB)).toBe(false)
    expect(ownedCadence(ownedJob('weekdays'))).toBe('weekdays')
  })
})

describe('reconcileCheckins', () => {
  it('creates exactly one owned job when enabled and none exists', async () => {
    const cron = fakeCron([USER_JOB])
    const result = await reconcileCheckins(ENABLED, cron)
    expect(result.created).toBe(true)
    const owned = cron.all().filter(isOwnedCheckin)
    expect(owned).toHaveLength(1)
    // The user's own task was never touched.
    expect(cron.all().find(j => j.id === 'user-1')).toMatchObject({ enabled: true })
  })

  it('is idempotent: a second reconcile creates no duplicate and no drift update', async () => {
    const cron = fakeCron([])
    await reconcileCheckins(ENABLED, cron)
    const second = await reconcileCheckins(ENABLED, cron)
    expect(second.created).toBe(false)
    expect(second.updated).toBe(false)
    expect(cron.all().filter(isOwnedCheckin)).toHaveLength(1)
  })

  it('updates the schedule when the cadence changes', async () => {
    const cron = fakeCron([ownedJob('weekly')])
    const result = await reconcileCheckins({ ...ENABLED, checkinCadence: 'daily' }, cron)
    expect(result.updated).toBe(true)
    expect(ownedCadence(cron.all().filter(isOwnedCheckin)[0])).toBe('daily')
  })

  it('reconciles a schedule EDITED in full Hermes back to the intended check-in', async () => {
    // Same name/cadence/prompt, but the cron time was changed by hand in full Hermes.
    const cron = fakeCron([ownedJob('weekly', { schedule: '30 9 * * 0' })])
    const result = await reconcileCheckins(ENABLED, cron)
    expect(result.updated).toBe(true)
    expect(cron.all().filter(isOwnedCheckin)[0].schedule).toBe('0 8 * * 0')
  })

  it('reconciles a deliver target edited in full Hermes', async () => {
    const cron = fakeCron([ownedJob('weekly', { deliver: 'telegram' })])
    const result = await reconcileCheckins(ENABLED, cron)
    expect(result.updated).toBe(true)
    expect(cron.all().filter(isOwnedCheckin)[0].deliver).toBe('local')
  })

  it('resumes a paused owned job on re-enable', async () => {
    const cron = fakeCron([ownedJob('weekly', { enabled: false, state: 'paused' })])
    const result = await reconcileCheckins(ENABLED, cron)
    expect(result.resumed).toBe(true)
    expect(cron.all().filter(isOwnedCheckin)[0].enabled).toBe(true)
  })

  it('converges duplicate owned jobs (ownership collision) to exactly one', async () => {
    const cron = fakeCron([
      ownedJob('weekly', { id: 'owned-a', created_at: '2020-01-01' }),
      ownedJob('weekly', { id: 'owned-b', created_at: '2020-02-01' })
    ])
    const result = await reconcileCheckins(ENABLED, cron)
    expect(result.removed).toBe(1)
    expect(result.jobId).toBe('owned-a') // earliest created is canonical
    expect(cron.all().filter(isOwnedCheckin)).toHaveLength(1)
  })

  it('pauses (never deletes) the owned job when disabled, preserving user tasks', async () => {
    const cron = fakeCron([ownedJob('weekly'), USER_JOB])
    const result = await reconcileCheckins({ ...ENABLED, checkins: false }, cron)
    expect(result.paused).toBe(1)
    const owned = cron.all().filter(isOwnedCheckin)
    expect(owned).toHaveLength(1) // preserved, not removed
    expect(owned[0].enabled).toBe(false)
    expect(cron.all().find(j => j.id === 'user-1')).toMatchObject({ enabled: true })
  })

  it('touches nothing when partner mode is off and no owned job exists', async () => {
    const cron = fakeCron([USER_JOB])
    const result = await reconcileCheckins({ mode: 'normal', checkins: false, checkinCadence: 'weekly' }, cron)
    expect(result).toMatchObject({ created: false, paused: 0, removed: 0 })
    expect(cron.calls).toHaveLength(0)
  })
})

describe('checkinDrifted — compares the authoritative schedule + deliver, not just the marker', () => {
  const desired = desiredCheckin(ENABLED)!
  it('is false for an exact match', () => {
    expect(checkinDrifted(ownedJob('weekly'), desired)).toBe(false)
  })
  it('is true when only the live schedule differs (edited in full Hermes)', () => {
    expect(checkinDrifted(ownedJob('weekly', { schedule: '0 7 * * 0' }), desired)).toBe(true)
  })
  it('is true when only the deliver target differs', () => {
    expect(checkinDrifted(ownedJob('weekly', { deliver: 'telegram' }), desired)).toBe(true)
  })
  it('reads the schedule from a Hermes kind-object, not just a string', () => {
    const asObject = ownedJob('weekly', { schedule: { kind: 'cron', expr: '0 8 * * 0', display: 'weekly' } })
    expect(checkinDrifted(asObject, desired)).toBe(false)
  })
})

describe('readCheckinStatus', () => {
  it('reports a scheduled owned job honestly with its live schedule', async () => {
    const cron = fakeCron([ownedJob('daily')])
    expect(await readCheckinStatus(cron)).toMatchObject({
      scheduled: true,
      paused: false,
      jobId: 'owned-1',
      liveSchedule: '0 8 * * *',
      edited: false
    })
  })

  it('surfaces the ACTUAL live schedule and flags an edit made in full Hermes', async () => {
    const cron = fakeCron([ownedJob('weekly', { schedule: '30 9 * * 0' })])
    const status = await readCheckinStatus(cron)
    expect(status).toMatchObject({ edited: true, liveSchedule: '30 9 * * 0' })
    // The display reflects the real live expression, not the stale marker label.
    expect(status!.scheduleDisplay).toBe('30 9 * * 0')
  })

  it('reports paused, and null on a store error', async () => {
    const paused = fakeCron([ownedJob('daily', { enabled: false, state: 'paused' })])
    expect(await readCheckinStatus(paused)).toMatchObject({ scheduled: false, paused: true })
    const broken = { list: async () => { throw new Error('runtime down') } }
    expect(await readCheckinStatus(broken as never)).toBeNull()
  })

  it('AGGREGATES duplicate owned jobs and flags a mismatch when more than one is active', async () => {
    const cron = fakeCron([
      ownedJob('weekly', { id: 'owned-a', created_at: '2020-01-01' }),
      ownedJob('weekly', { id: 'owned-b', created_at: '2020-02-01' })
    ])
    const status = await readCheckinStatus(cron)
    expect(status).toMatchObject({ jobId: 'owned-a', duplicates: 2, activeDuplicates: 2, mismatch: true })
  })

  it('does NOT flag a mismatch when only one duplicate is active (others paused)', async () => {
    const cron = fakeCron([
      ownedJob('weekly', { id: 'owned-a', created_at: '2020-01-01' }),
      ownedJob('weekly', { id: 'owned-b', created_at: '2020-02-01', enabled: false, state: 'paused' })
    ])
    const status = await readCheckinStatus(cron)
    expect(status).toMatchObject({ duplicates: 2, activeDuplicates: 1, mismatch: false })
  })
})
