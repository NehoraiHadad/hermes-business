import { describe, expect, it } from 'vitest'
import { createStorage, loadShippedPlugin, pluginSource } from './plugin-test-harness'

// The shipped plugin must single-source scheduled tasks from the official
// cron.manage door — no client-owned paused cache as authority. These assertions
// run against the real generated bundle Hermes Desktop loads.
describe('business-shell cron listing', () => {
  it('ships no client-owned paused-cron cache', () => {
    expect(pluginSource).not.toContain('PAUSED_CRON_CACHE_TTL_MS')
    expect(pluginSource).not.toContain('readPausedCronCache')
  })

  it('single-sources enabled+paused rows from the cron.manage payload and never reads storage', () => {
    const runtime = loadShippedPlugin({})
    const active = { id: 'a', name: 'a', enabled: true }
    const paused = { id: 'b', name: 'b', enabled: false }

    // A paused-inclusive surface: both rows kept, paused detected honestly.
    const withPaused = runtime.__helpers.summarizeCronJobs({ jobs: [active, paused] })
    expect(withPaused.jobs).toHaveLength(2)
    expect(withPaused.pausedListingSupported).toBe(true)
    expect(runtime.__helpers.isJobPaused(paused)).toBe(true)
    expect(runtime.__helpers.isJobPaused(active)).toBe(false)

    // Active-only surface (Hermes 0.19.x cron.manage): degrade honestly, never
    // fabricate paused rows. Bare arrays and empty payloads normalize too.
    const activeOnly = runtime.__helpers.summarizeCronJobs({ jobs: [active] })
    expect(activeOnly.jobs).toHaveLength(1)
    expect(activeOnly.pausedListingSupported).toBe(false)
    expect(runtime.__helpers.summarizeCronJobs([active, paused]).jobs).toHaveLength(2)
    expect(runtime.__helpers.summarizeCronJobs(null).jobs).toEqual([])
  })

  it('prefers the namespace-locked backend door and reports paused-inclusive support', async () => {
    const active = { id: 'a', name: 'a', enabled: true }
    const paused = { id: 'b', name: 'b', enabled: false }
    // host.request must NOT be consulted when the backend door answers.
    const runtime = loadShippedPlugin({
      request: async () => {
        throw new Error('cron.manage must not be called when the backend door is present')
      }
    })
    const calls: string[] = []
    runtime.__helpers.setPluginRest(async (path: string) => {
      calls.push(path)
      return { jobs: [active, paused], paused_listing_supported: true }
    })
    expect(runtime.__helpers.hasPausedInclusiveDoor()).toBe(true)

    const result = await runtime.__helpers.loadScheduledTasks()
    expect(calls).toEqual(['/cron/jobs']) // relative path — the namespace is the boundary
    expect(result.source).toBe('plugin-backend')
    expect(result.jobs).toHaveLength(2)
    expect(result.pausedListingSupported).toBe(true)
  })

  it('normalizes a bare-array backend payload to the job list', async () => {
    const runtime = loadShippedPlugin({ request: async () => ({ jobs: [] }) })
    runtime.__helpers.setPluginRest(async () => [{ id: 'x', name: 'x', enabled: false }])
    const result = await runtime.__helpers.loadScheduledTasks()
    expect(result.jobs).toHaveLength(1)
    expect(result.pausedListingSupported).toBe(true)
  })

  it('falls back when the backend door answers but reports itself degraded', async () => {
    const active = { id: 'a', name: 'a', enabled: true }
    const runtime = loadShippedPlugin({ request: async () => ({ jobs: [active] }) })
    // Backend read the scheduler and failed closed to its degraded body.
    runtime.__helpers.setPluginRest(async () => ({ jobs: [], paused_listing_supported: false, degraded: true }))
    const result = await runtime.__helpers.loadScheduledTasks()
    expect(result.source).toBe('cron.manage') // don't trust a degraded door
    expect(result.jobs).toHaveLength(1)
    expect(result.pausedListingSupported).toBe(false)
  })

  it('falls back to the active-only cron.manage RPC when the backend door errors', async () => {
    const active = { id: 'a', name: 'a', enabled: true }
    const runtime = loadShippedPlugin({ request: async () => ({ jobs: [active] }) })
    runtime.__helpers.setPluginRest(async () => {
      throw new Error('backend unavailable (older Hermes / not enabled / remote)')
    })
    const result = await runtime.__helpers.loadScheduledTasks()
    expect(result.source).toBe('cron.manage')
    expect(result.jobs).toHaveLength(1)
    expect(result.pausedListingSupported).toBe(false) // honest degrade
  })

  it('falls back when no backend door is installed at all', async () => {
    const runtime = loadShippedPlugin({ request: async () => ({ jobs: [{ id: 'a', name: 'a', enabled: true }] }) })
    runtime.__helpers.setPluginRest(null)
    expect(runtime.__helpers.hasPausedInclusiveDoor()).toBe(false)
    const result = await runtime.__helpers.loadScheduledTasks()
    expect(result.source).toBe('cron.manage')
    expect(result.pausedListingSupported).toBe(false)
  })

  it('treats the official CronJob schema as authoritative for pause + human display', () => {
    const runtime = loadShippedPlugin({})
    const { isJobPaused, humanSchedule } = runtime.__helpers

    // Official normalized schema: state drives the pause pill (not just enabled).
    expect(isJobPaused({ id: 'p', name: 'p', enabled: true, state: 'paused' })).toBe(true)
    expect(isJobPaused({ id: 'a', name: 'a', enabled: true, state: 'active' })).toBe(false)
    expect(isJobPaused({ id: 'b', name: 'b', enabled: false, state: 'active' })).toBe(true)

    // schedule_display is the human string; the schedule dict must NEVER render as
    // "[object Object]" — an unknown dict shape degrades to the Hermes fallback.
    expect(humanSchedule('שבועי')).toBe('שבועי')
    expect(humanSchedule({ schedule_display: 'כל יום בשעה 09:00' })).toBe('כל יום בשעה 09:00')
    expect(humanSchedule({ expr: '0 9 * * *' })).toBe('כל יום בשעה 09:00')
    const opaque = humanSchedule({ kind: 'cron', minute: 0, hour: 9 })
    expect(opaque).not.toContain('[object Object]')
    expect(opaque).toBe('לפי לוח הזמנים של Hermes')
  })

  it('purges any legacy paused cache without ever treating it as authoritative', () => {
    const runtime = loadShippedPlugin({})
    const storage = createStorage()
    storage.set('pausedCronJobs', [{ id: 'ghost-1' }, { id: 'ghost-2' }])

    // Cleanup drops the stale rows and reports the count; the value is never read
    // back — summarizeCronJobs ignores storage entirely.
    expect(runtime.__helpers.purgeLegacyPausedCache(storage)).toBe(2)
    expect(storage.get('pausedCronJobs', null)).toBeNull()
    // Idempotent: nothing left to purge on a second pass.
    expect(runtime.__helpers.purgeLegacyPausedCache(storage)).toBe(0)
  })
})
