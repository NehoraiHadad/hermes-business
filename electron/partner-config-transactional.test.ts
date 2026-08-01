import { describe, expect, it } from 'vitest'
import { captureOwned, restoreOwnedTransactional } from './partner-config.cjs'

// The live pre-operation config restoreOwnedTransactional snapshots via GET before
// touching anything — here a partner-shaped config it must be able to roll back to.
const PRE_OP = {
  display: { personality: 'business-partner' },
  approvals: { mode: 'manual', cron_mode: 'deny' },
  terminal: { backend: 'local' }
}
// The desired restore target (the durable pre-partner backup): normal-shaped.
const DESIRED = captureOwned({
  display: { personality: 'friendly' },
  approvals: { mode: 'smart', cron_mode: 'approve' },
  terminal: { backend: 'local' }
})

function makeApi(failEndpoint: string | null) {
  const puts: Array<{ endpoint: string; body: any }> = []
  const api = async (endpoint: string, init?: { method?: string; body?: any }) => {
    if (init?.method === 'PUT' || init?.method === 'POST') {
      puts.push({ endpoint, body: init.body })
      if (failEndpoint && endpoint === failEndpoint) throw new Error(`${endpoint} failed`)
      return { ok: true }
    }
    if (endpoint.startsWith('/api/config')) return PRE_OP
    if (endpoint.startsWith('/api/tools/terminal/backends')) return []
    return {}
  }
  return { api, puts }
}

describe('restoreOwnedTransactional', () => {
  it('applies the desired restore when both live calls succeed', async () => {
    const { api, puts } = makeApi(null)
    await restoreOwnedTransactional(DESIRED, api)
    const lastConfig = puts.filter(p => p.endpoint === '/api/config').at(-1)
    expect(lastConfig?.body.config.display.personality).toBe('friendly')
  })

  it('rolls the config back to the pre-op snapshot and rethrows when the backend pin fails', async () => {
    const { api, puts } = makeApi('/api/tools/terminal/backend')
    await expect(restoreOwnedTransactional(DESIRED, api)).rejects.toThrow(/backend failed/)
    const configPuts = puts.filter(p => p.endpoint === '/api/config')
    // First PUT attempted the desired 'friendly' restore...
    expect(configPuts.at(0)?.body.config.display.personality).toBe('friendly')
    // ...then, after the backend pin failed, a rollback PUT restored the captured
    // pre-operation state ('business-partner'), so config is never half-restored.
    expect(configPuts.at(-1)?.body.config.display.personality).toBe('business-partner')
  })
})
