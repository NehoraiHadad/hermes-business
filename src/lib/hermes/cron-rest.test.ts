import { describe, expect, it, vi } from 'vitest'
import type { ScheduledTask } from '../../types'
import { createHermesRest } from './rest'

// Exact official cron REST contracts (hermes_cli/web_routers/cron.py):
//  PUT    /api/cron/jobs/{id}          body { updates: {...} }
//  POST   /api/cron/jobs/{id}/trigger
//  DELETE /api/cron/jobs/{id}
// all profile-scoped via ?profile=default.
describe('cron task edit/trigger/delete wiring', () => {
  function restWith() {
    const calls: Array<{ endpoint: string; method?: string; body?: unknown }> = []
    const api = vi.fn(async (endpoint: string, init?: { method?: string; body?: unknown }) => {
      calls.push({ endpoint, method: init?.method, body: init?.body })
      return { ok: true }
    })
    return { rest: createHermesRest(api as never), calls }
  }

  it('sends only changed fields as an atomic {updates} PUT', async () => {
    const { rest, calls } = restWith()
    await rest.editTask('job-9', { name: 'בוקר טוב', schedule: '0 9 * * 1-5' })
    expect(calls).toEqual([
      {
        endpoint: '/api/cron/jobs/job-9?profile=default',
        method: 'PUT',
        body: { updates: { name: 'בוקר טוב', schedule: '0 9 * * 1-5' } }
      }
    ])
  })

  it('drops undefined fields from the update payload', async () => {
    const { rest, calls } = restWith()
    await rest.editTask('job-9', { name: 'x', prompt: undefined, schedule: undefined })
    expect(calls[0].body).toEqual({ updates: { name: 'x' } })
  })

  it('triggers a job with a POST to the official trigger route', async () => {
    const { rest, calls } = restWith()
    await rest.triggerTask('job-9')
    expect(calls).toEqual([{ endpoint: '/api/cron/jobs/job-9/trigger?profile=default', method: 'POST', body: undefined }])
  })

  it('deletes a job with a DELETE to the official route', async () => {
    const { rest, calls } = restWith()
    await rest.deleteTask('job-9')
    expect(calls).toEqual([{ endpoint: '/api/cron/jobs/job-9?profile=default', method: 'DELETE', body: undefined }])
  })

  it('url-encodes job ids in every route', async () => {
    const { rest, calls } = restWith()
    const id = 'job/with space'
    await rest.triggerTask(id)
    await rest.deleteTask(id)
    await rest.editTask(id, { name: 'n' } as Partial<ScheduledTask>)
    expect(calls[0].endpoint).toBe('/api/cron/jobs/job%2Fwith%20space/trigger?profile=default')
    expect(calls[1].endpoint).toBe('/api/cron/jobs/job%2Fwith%20space?profile=default')
    expect(calls[2].endpoint).toBe('/api/cron/jobs/job%2Fwith%20space?profile=default')
  })
})
