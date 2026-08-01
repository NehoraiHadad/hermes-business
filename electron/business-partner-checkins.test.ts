import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applyPartnerMode, getPartnerState } from './business-partner.cjs'
import { readSettings } from './partner-settings.cjs'
import { isOwnedCheckin, checkinName } from './partner-checkins.cjs'

// Orchestrator-level check-in behaviour: the real reconcile logic driven against an
// in-memory stand-in for the ONE official Hermes cron store (no live Hermes). Split
// from business-partner.test.ts to keep each file focused and small.

function fakeApi(config: Record<string, unknown> = { display: {}, terminal: { backend: 'local' } }) {
  const api = async (endpoint: string, init?: { method?: string; body?: unknown }) => {
    if (init?.method === 'PUT' || init?.method === 'POST') return { ok: true }
    if (endpoint.startsWith('/api/config')) return config
    if (endpoint.startsWith('/api/tools/terminal/backends')) return []
    return {}
  }
  return { api }
}

function fakeCron(initial: Array<Record<string, unknown>> = []) {
  let jobs = initial.map(j => ({ ...j }))
  let seq = 0
  return {
    all: () => jobs,
    list: async () => jobs.map(j => ({ ...j })),
    create: async (job: Record<string, unknown>) => {
      const created = { id: `job-${++seq}`, enabled: true, state: 'scheduled', created_at: `2020-01-0${seq}`, ...job }
      jobs.push(created)
      return created
    },
    update: async (id: string, u: Record<string, unknown>) => Object.assign(jobs.find(j => j.id === id)!, u),
    pause: async (id: string) => Object.assign(jobs.find(j => j.id === id)!, { enabled: false, state: 'paused' }),
    resume: async (id: string) => Object.assign(jobs.find(j => j.id === id)!, { enabled: true, state: 'scheduled' }),
    remove: async (id: string) => (jobs = jobs.filter(j => j.id !== id))
  }
}

let home: string
let previousHome: string | undefined

beforeEach(() => {
  previousHome = process.env.HERMES_HOME
  home = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-partner-checkin-orch-'))
  process.env.HERMES_HOME = home
})

afterEach(() => {
  if (previousHome === undefined) delete process.env.HERMES_HOME
  else process.env.HERMES_HOME = previousHome
  fs.rmSync(home, { recursive: true, force: true })
})

describe('partner check-ins are real, reconciled cron jobs', () => {
  it('creates an owned job on opt-in and reports it scheduled, then pauses (preserves) it on opt-out', async () => {
    const { api } = fakeApi()
    const cron = fakeCron()

    const enabled = await applyPartnerMode(
      { mode: 'partner', sandbox: 'guard', checkins: true, checkinCadence: 'daily' },
      { api, restart: async () => {}, cron }
    )
    expect(enabled.checkin).toMatchObject({ created: true })
    expect(cron.all().filter(isOwnedCheckin)).toHaveLength(1)

    const state = await getPartnerState({ api, cron })
    expect(state.checkins).toBe(true)
    expect(state.checkin).toMatchObject({ scheduled: true })
    expect(state.checkinMismatch).toBe(false)

    const disabled = await applyPartnerMode({ checkins: false }, { api, restart: async () => {}, cron })
    expect(disabled.checkin).toMatchObject({ paused: 1 })
    const owned = cron.all().filter(isOwnedCheckin)
    expect(owned).toHaveLength(1) // preserved, not deleted
    expect(owned[0].enabled).toBe(false)
  })

  it('a failed opt-out reconcile is reported as an error, never masqueraded as success', async () => {
    const { api } = fakeApi()
    // Cron store whose pause always fails — the owned job stays active.
    const jobs = [
      { id: 'owned-1', name: checkinName('daily'), enabled: true, state: 'scheduled', created_at: '2020-01-01' }
    ]
    const cron = {
      all: () => jobs,
      list: async () => jobs.map(j => ({ ...j })),
      create: async () => ({ id: 'x' }),
      update: async () => {},
      pause: async () => {
        throw new Error('cron store offline')
      },
      resume: async () => {},
      remove: async () => {}
    }
    const result = await applyPartnerMode(
      { mode: 'partner', sandbox: 'guard', checkins: false },
      { api, restart: async () => {}, cron }
    )
    // Intent is still persisted (startup will retry), but the API surfaces the
    // failure and does NOT report the pause as done.
    expect(result.checkin.error).toContain('cron store offline')
    expect(result.checkin).not.toMatchObject({ paused: 1 })
    expect(readSettings().checkins).toBe(false)
    // The job the reconcile could not pause is still active — a getPartnerState read
    // flags the divergence rather than hiding it.
    const state = await getPartnerState({ api, cron })
    expect(state.checkinMismatch).toBe(true)
  })
})
