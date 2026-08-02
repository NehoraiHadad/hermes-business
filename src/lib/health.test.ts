import { describe, expect, it } from 'vitest'
import { interpretHealthResponse, withTimeout } from './health'
import { buildSystemHealth } from './health-panel'
import type { Connection, ScheduledTask } from '../types'
import type { ProviderStatus } from './provider-readiness'

// Real Hermes 0.19.1 /api/health + /api/status shapes. health = liveness only; status
// carries `overall` and `components.<name>.status`, each exactly "ok" | "degraded".
const healthyStatus = {
  overall: 'ok',
  components: {
    gateway: { status: 'ok', state: 'running' },
    dashboard: { status: 'ok' },
    storage: { status: 'ok' },
    platforms: { status: 'ok', configured: 2, connected: 1 }
  }
}
const healthy = { health: { ok: true, version: '0.19.1', auth_required: false }, status: healthyStatus }

describe('interpretHealthResponse — fails closed on real nested shape', () => {
  it('confirms health only when liveness ok AND overall ok AND every component ok', () => {
    expect(interpretHealthResponse(healthy).healthy).toBe(true)
  })

  it('rejects a degraded overall even when every component looks ok', () => {
    const verdict = interpretHealthResponse({ health: { ok: true }, status: { ...healthyStatus, overall: 'degraded' } })
    expect(verdict.healthy).toBe(false)
    expect(verdict.reason).toContain('overall')
  })

  it('rejects a degraded nested component (status.components.<name>.status)', () => {
    const verdict = interpretHealthResponse({
      health: { ok: true },
      status: { overall: 'ok', components: { gateway: { status: 'degraded', state: 'startup_failed' }, storage: { status: 'ok' } } }
    })
    expect(verdict.healthy).toBe(false)
    expect(verdict.reason).toContain('gateway')
  })

  it('rejects a status object with NO components block (incomplete rollup, never healthy-by-omission)', () => {
    expect(interpretHealthResponse({ health: { ok: true }, status: { overall: 'ok' } }).healthy).toBe(false)
  })

  it('requires ALL of gateway/dashboard/storage/platforms — a missing required component is unhealthy', () => {
    const verdict = interpretHealthResponse({
      health: { ok: true },
      // dashboard + platforms absent, overall optimistically "ok".
      status: { overall: 'ok', components: { gateway: { status: 'ok' }, storage: { status: 'ok' } } }
    })
    expect(verdict.healthy).toBe(false)
    expect(verdict.reason).toContain('dashboard')
    expect(verdict.reason).toContain('platforms')
  })

  it('rejects an incomplete component object that carries no recognisable status/state signal', () => {
    const verdict = interpretHealthResponse({
      health: { ok: true },
      status: { overall: 'ok', components: { gateway: {}, dashboard: { status: 'ok' }, storage: { status: 'ok' }, platforms: { status: 'ok' } } }
    })
    expect(verdict.healthy).toBe(false)
    expect(verdict.reason).toContain('gateway')
  })

  it('rejects ok:false liveness', () => {
    const verdict = interpretHealthResponse({ health: { ok: false, message: 'gateway down' }, status: healthyStatus })
    expect(verdict.healthy).toBe(false)
    expect(verdict.reason).toContain('gateway down')
  })

  it('rejects a missing ok flag (never assume healthy)', () => {
    expect(interpretHealthResponse({ health: {}, status: healthyStatus }).healthy).toBe(false)
  })

  it('rejects malformed / non-object responses and payloads', () => {
    expect(interpretHealthResponse(null).healthy).toBe(false)
    expect(interpretHealthResponse('ok').healthy).toBe(false)
    expect(interpretHealthResponse({ health: 'up' }).healthy).toBe(false)
    expect(interpretHealthResponse({ status: { overall: 'ok' } }).healthy).toBe(false)
    expect(interpretHealthResponse({ health: { ok: true }, status: 'weird' }).healthy).toBe(false)
  })

  it('also catches an error/down dialect and a flat component ok:false', () => {
    expect(interpretHealthResponse({ health: { ok: true }, status: { overall: 'error' } }).healthy).toBe(false)
    expect(interpretHealthResponse({ health: { ok: true }, status: { telegram: { ok: false } } }).healthy).toBe(false)
    expect(interpretHealthResponse({ health: { ok: true }, status: { gw: { status: 'down' } } }).healthy).toBe(false)
  })
})

describe('withTimeout', () => {
  it('rejects (fails closed) when the promise never resolves', async () => {
    await expect(withTimeout(new Promise(() => {}), 5)).rejects.toThrow(/timed out/)
  })

  it('passes a resolved value through', async () => {
    await expect(withTimeout(Promise.resolve(42), 50)).resolves.toBe(42)
  })
})

const usable: ProviderStatus = {
  provider_ready: true,
  provider_state: 'usable',
  provider_label: 'Anthropic',
  runtime_running: true,
  provider_configured: true,
  provider_usable: true,
  provider_sources: { oauth: 'positive', env: 'negative' }
}
const configuredOnly: ProviderStatus = {
  ...usable,
  provider_ready: false,
  provider_state: 'configured',
  provider_usable: false,
  provider_configured: true
}
const absent: ProviderStatus = {
  provider_ready: false,
  provider_state: 'unavailable',
  provider_label: 'לא מחובר',
  runtime_running: true,
  provider_configured: false,
  provider_usable: false,
  provider_sources: { oauth: 'negative', env: 'negative' }
}

const conn = (id: string, state: Connection['state']): Connection => ({ id, name: id, description: '', state, icon: 'google' })
const tasks: ScheduledTask[] = [{ id: '1', name: 'a', prompt: 'p', schedule: '0 8 * * *', enabled: true }]

describe('buildSystemHealth — panel rows', () => {
  it('reports healthy when runtime is up and the provider is verified/usable', () => {
    const report = buildSystemHealth({ runtime: { running: true } as HermesRuntime, provider: usable, connections: [conn('google', 'connected')], tasks })
    expect(report.healthy).toBe(true)
    expect(report.summary).toBe('הכול תקין')
    expect(report.components.find(c => c.id === 'provider')?.state).toBe('ok')
  })

  it('never claims healthy when the runtime is stopped', () => {
    const report = buildSystemHealth({ runtime: { running: false } as HermesRuntime, provider: usable, connections: [], tasks })
    expect(report.healthy).toBe(false)
    expect(report.components.find(c => c.id === 'runtime')?.state).toBe('error')
  })

  it('treats a merely-configured (unverified) provider as an ERROR that flips overall health', () => {
    const report = buildSystemHealth({ runtime: { running: true } as HermesRuntime, provider: configuredOnly, connections: [], tasks })
    const provider = report.components.find(c => c.id === 'provider')
    expect(provider?.state).toBe('error')
    expect(provider?.value).toContain('טרם אומת')
    expect(report.healthy).toBe(false)
  })

  it('treats an absent provider as a required error (product needs a working provider)', () => {
    const report = buildSystemHealth({ runtime: { running: true } as HermesRuntime, provider: absent, connections: [], tasks })
    expect(report.components.find(c => c.id === 'provider')?.state).toBe('error')
    expect(report.healthy).toBe(false)
  })

  it('surfaces Business Cloud and personal QR WhatsApp as separate rows', () => {
    const report = buildSystemHealth({ runtime: { running: true } as HermesRuntime, provider: usable, connections: [conn('whatsapp-cloud', 'connected')], tasks })
    expect(report.components.find(c => c.id === 'whatsapp-cloud')?.value).toBe('מחובר')
    expect(report.components.find(c => c.id === 'whatsapp')?.value).toBe('לא מחובר')
    // Optional connectors stay warnings; they do not flip overall health.
    expect(report.healthy).toBe(true)
  })

  it('marks a connected WhatsApp with NO live guard proof as unknown/unprotected (error)', () => {
    const report = buildSystemHealth({
      runtime: { running: true } as HermesRuntime,
      provider: usable,
      connections: [conn('whatsapp-cloud', 'connected')],
      tasks,
      whatsappGuard: null // probed but no live proof (a policy file alone is not proof)
    })
    const row = report.components.find(c => c.id === 'whatsapp-policy')
    expect(row?.state).toBe('error')
    expect(report.healthy).toBe(false)
  })

  it('shows LIVE read-only enforcement as protected (ok) and adds no policy row when nothing is connected', () => {
    const readOnly = buildSystemHealth({
      runtime: { running: true } as HermesRuntime,
      provider: usable,
      connections: [conn('whatsapp-cloud', 'connected')],
      tasks,
      whatsappGuard: { pluginLoaded: true, enforcing: true, mode: 'read_only' }
    })
    expect(readOnly.components.find(c => c.id === 'whatsapp-policy')?.state).toBe('ok')
    const none = buildSystemHealth({ runtime: { running: true } as HermesRuntime, provider: usable, connections: [], tasks, whatsappGuard: null })
    expect(none.components.find(c => c.id === 'whatsapp-policy')).toBeUndefined()
  })

  it('does NOT show a failed tasks read as a healthy "0 active"', () => {
    const report = buildSystemHealth({ runtime: { running: true } as HermesRuntime, provider: usable, connections: [], tasks: [], errors: { tasks: true } })
    const row = report.components.find(c => c.id === 'tasks')
    expect(row?.state).toBe('error')
    expect(row?.value).toContain('נכשל')
    expect(report.healthy).toBe(false)
  })

  it('does NOT show a failed platform read as known-disconnected connectors', () => {
    const report = buildSystemHealth({ runtime: { running: true } as HermesRuntime, provider: usable, connections: [], tasks, errors: { connections: true } })
    const whatsapp = report.components.find(c => c.id === 'whatsapp')
    expect(whatsapp?.state).toBe('error')
    expect(whatsapp?.value).toContain('לא ידוע')
    expect(report.healthy).toBe(false)
  })
})
