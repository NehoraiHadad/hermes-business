import { describe, expect, it } from 'vitest'
import { reconcileCheckins, desiredCheckin, isOwnedCheckin, checkinName, jobIsPaused } from './partner-checkins.cjs'

type Job = Record<string, any>

// Focused failure-injection suite for the update-before-resume ordering: a paused,
// drifted owned job must be UPDATED while still paused and only resumed after the
// update lands. If the update throws, the job must stay paused (never resumed into
// an outdated active state). User jobs are never touched here.
function fakeCron(initial: Job[], opts: { failUpdate?: boolean } = {}) {
  let jobs = initial.map(j => ({ ...j }))
  const calls: Array<[string, string]> = []
  return {
    all: () => jobs,
    calls,
    list: async () => jobs.map(j => ({ ...j })),
    create: async () => {
      throw new Error('unexpected create')
    },
    update: async (id: string, updates: Job) => {
      calls.push(['update', id])
      if (opts.failUpdate) throw new Error('update failed (runtime rejected the edit)')
      Object.assign(jobs.find(j => j.id === id)!, updates)
    },
    pause: async (id: string) => {
      calls.push(['pause', id])
      Object.assign(jobs.find(j => j.id === id)!, { enabled: false, state: 'paused' })
    },
    resume: async (id: string) => {
      calls.push(['resume', id])
      Object.assign(jobs.find(j => j.id === id)!, { enabled: true, state: 'scheduled' })
    },
    remove: async (id: string) => {
      calls.push(['remove', id])
      jobs = jobs.filter(j => j.id !== id)
    }
  }
}

const ENABLED = { mode: 'partner', checkins: true, checkinCadence: 'daily' }

// A paused owned job whose cadence has DRIFTED from the desired 'daily' (it is on
// the old 'weekly' name/prompt), so reconcile must update it before resuming.
const pausedDrifted = (): Job => ({
  id: 'owned-1',
  name: checkinName('weekly'),
  prompt: desiredCheckin({ mode: 'partner', checkins: true, checkinCadence: 'weekly' })!.prompt,
  enabled: false,
  state: 'paused',
  created_at: '2020-01-01'
})

describe('reconcileCheckins update-before-resume ordering', () => {
  it('updates a paused drifted job WHILE paused, then resumes only after success', async () => {
    const cron = fakeCron([pausedDrifted()])
    const result = await reconcileCheckins(ENABLED, cron)
    expect(result.updated).toBe(true)
    expect(result.resumed).toBe(true)
    // update must be driven before resume — never the reverse.
    const order = cron.calls.map(c => c[0])
    expect(order.indexOf('update')).toBeLessThan(order.indexOf('resume'))
    expect(jobIsPaused(cron.all().filter(isOwnedCheckin)[0])).toBe(false)
  })

  it('leaves the job PAUSED and never resumes it when the update fails', async () => {
    const cron = fakeCron([pausedDrifted()], { failUpdate: true })
    await expect(reconcileCheckins(ENABLED, cron)).rejects.toThrow(/update failed/)
    // resume was never attempted, so an outdated job is not activated.
    expect(cron.calls.some(c => c[0] === 'resume')).toBe(false)
    // The job on the store is still paused.
    expect(jobIsPaused(cron.all().filter(isOwnedCheckin)[0])).toBe(true)
  })
})

// An ACTIVE drifted job must be transactionally PAUSED (and the pause verified) BEFORE
// its definition is edited, then resumed because it was originally active.
const activeDrifted = (): Job => ({
  id: 'owned-1',
  name: checkinName('weekly'),
  prompt: desiredCheckin({ mode: 'partner', checkins: true, checkinCadence: 'weekly' })!.prompt,
  enabled: true,
  state: 'scheduled',
  created_at: '2020-01-01'
})

describe('reconcileCheckins pause-before-update for an ACTIVE drifted job', () => {
  it('pauses, updates, then resumes — in that order — and ends active', async () => {
    const cron = fakeCron([activeDrifted()])
    const result = await reconcileCheckins(ENABLED, cron)
    expect(result.updated).toBe(true)
    expect(result.resumed).toBe(true)
    const order = cron.calls.map(c => c[0])
    expect(order.indexOf('pause')).toBeLessThan(order.indexOf('update'))
    expect(order.indexOf('update')).toBeLessThan(order.indexOf('resume'))
    expect(jobIsPaused(cron.all().filter(isOwnedCheckin)[0])).toBe(false)
  })

  it('ABORTS the update (never edits a live job) when the pause is not confirmed', async () => {
    // A store that accepts pause() but does not actually flip the job to paused.
    const jobs: Job[] = [activeDrifted()]
    const cron = {
      all: () => jobs,
      list: async () => jobs.map(j => ({ ...j })),
      create: async () => { throw new Error('unexpected create') },
      update: async () => { throw new Error('update must not run when pause is unconfirmed') },
      pause: async () => { /* silently fails to pause */ },
      resume: async () => { throw new Error('unexpected resume') },
      remove: async () => {}
    }
    await expect(reconcileCheckins(ENABLED, cron)).rejects.toThrow(/להשהות/)
  })
})
