import { describe, expect, it } from 'vitest'
import { applySandbox, computeSandboxPlan } from './sandbox-config.cjs'

const base = { mode: 'partner', network: false, checkins: false, roots: [] as Array<{ path: string; access: string }> }

describe('computeSandboxPlan', () => {
  it('off: local backend, no isolation, honest semantics', () => {
    const plan = computeSandboxPlan({ ...base, sandbox: 'off' }, { ready: false })
    expect(plan).toMatchObject({ effective: 'off', backend: 'local', isolation: false, degraded: false })
    expect(plan.config.terminal).toEqual({ backend: 'local' })
    expect(plan.config.approvals).toEqual({ mode: 'manual', cron_mode: 'deny' })
    expect(plan.approvalSemantics).toContain('ללא בידוד')
  })

  it('guard: local backend + manual approvals + no auto-approve', () => {
    const plan = computeSandboxPlan({ ...base, sandbox: 'guard' }, { ready: false })
    expect(plan).toMatchObject({ effective: 'guard', backend: 'local', isolation: false })
    expect(plan.config.delegation).toEqual({ subagent_auto_approve: false })
    expect(plan.approvalSemantics).toContain('HERMES_WRITE_SAFE_ROOT')
  })

  it('docker ready: real isolation with safe docker defaults and host binds', () => {
    const settings = {
      ...base,
      sandbox: 'docker',
      roots: [
        { path: 'C:/data', access: 'ro' },
        { path: 'C:/out', access: 'rw' }
      ]
    }
    const plan = computeSandboxPlan(settings, { ready: true, status: 'ready' })
    expect(plan).toMatchObject({ effective: 'docker', backend: 'docker', isolation: true, degraded: false })
    expect(plan.config).toMatchObject({
      docker_mount_cwd_to_workspace: false,
      docker_network: false,
      docker_forward_env: []
    })
    expect(plan.config.docker_volumes).toEqual(['C:/data:/mnt/root0:ro', 'C:/out:/mnt/root1'])
    expect(plan.mounts.map(m => m.ro)).toEqual([true, false])
    // With host binds the guard stack still applies — must be stated, not hidden.
    expect(plan.approvalSemantics).toContain('Docker אינו עוקף')
  })

  it('docker requested but not ready: fails closed to guard and reports it', () => {
    const plan = computeSandboxPlan({ ...base, sandbox: 'docker' }, { ready: false, status: 'stopped' })
    expect(plan).toMatchObject({ effective: 'guard', backend: 'local', isolation: false, degraded: true })
    expect(plan.reason).toContain('stopped')
    expect(plan.config.terminal).toEqual({ backend: 'local' })
  })

  it('docker network only opens when explicitly enabled', () => {
    const plan = computeSandboxPlan({ ...base, sandbox: 'docker', network: true }, { ready: true })
    expect(plan.config.docker_network).toBe(true)
    expect(plan.network).toBe(true)
  })
})

describe('applySandbox', () => {
  it('probes docker only when requested and pins config + backend', async () => {
    const calls: Array<{ endpoint: string; init?: { method?: string; body?: unknown } }> = []
    const api = async (endpoint: string, init?: { method?: string; body?: unknown }) => {
      calls.push({ endpoint, init })
      return {}
    }
    let readinessCalls = 0
    const dockerReadiness = async () => {
      readinessCalls += 1
      return { ready: true, status: 'ready' }
    }

    const applied = await applySandbox({ ...base, sandbox: 'docker', roots: [{ path: 'C:/x', access: 'rw' }] }, {
      api,
      dockerReadiness
    })
    expect(readinessCalls).toBe(1)
    expect(applied.backend).toBe('docker')
    expect(calls.some(c => c.endpoint === '/api/config' && c.init?.method === 'PUT')).toBe(true)
    expect(calls.some(c => c.endpoint === '/api/tools/terminal/backend')).toBe(true)
  })

  it('does not probe docker for the guard tier', async () => {
    let readinessCalls = 0
    await applySandbox({ ...base, sandbox: 'guard' }, {
      api: async () => ({}),
      dockerReadiness: async () => {
        readinessCalls += 1
        return { ready: false, status: 'x' }
      }
    })
    expect(readinessCalls).toBe(0)
  })
})
