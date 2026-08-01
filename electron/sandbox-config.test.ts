import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applySandbox, computeSandboxPlan } from './sandbox-config.cjs'

const base = { mode: 'partner', network: false, checkins: false, roots: [] as Array<{ path: string; access: string }> }

let tmp: string
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-sandbox-cfg-'))
})
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})
function realDir(name: string) {
  const p = path.join(tmp, name)
  fs.mkdirSync(p, { recursive: true })
  return p
}

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

  it('docker ready: real isolation with safe docker defaults and canonical host binds', () => {
    // Real directories: Docker binds are built from the CANONICAL valid roots
    // (same resolver as the guard write-root), never from raw/unresolved input.
    const data = realDir('data')
    const out = realDir('out')
    const settings = {
      ...base,
      sandbox: 'docker',
      roots: [
        { path: data, access: 'ro' },
        { path: out, access: 'rw' }
      ]
    }
    const plan = computeSandboxPlan(settings, { ready: true, status: 'ready' })
    expect(plan).toMatchObject({ effective: 'docker', backend: 'docker', isolation: true, degraded: false })
    // Docker fields live under `terminal` — that is where Hermes reads them
    // (config_defaults terminal.docker_volumes / env TERMINAL_DOCKER_VOLUMES).
    expect(plan.config.terminal).toMatchObject({
      backend: 'docker',
      docker_mount_cwd_to_workspace: false,
      docker_network: false,
      docker_forward_env: []
    })
    const realData = fs.realpathSync.native(data)
    const realOut = fs.realpathSync.native(out)
    expect(plan.config.terminal.docker_volumes).toEqual([`${realData}:/mnt/root0:ro`, `${realOut}:/mnt/root1`])
    expect(plan.mounts.map(m => m.ro)).toEqual([true, false])
    expect(plan.mounts.map(m => m.host)).toEqual([realData, realOut])
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
    expect(plan.config.terminal.docker_network).toBe(true)
    expect(plan.network).toBe(true)
  })

  it('surfaces invalid roots for the effective tier without throwing (read-safe)', () => {
    const good = realDir('good')
    const guard = computeSandboxPlan(
      { ...base, sandbox: 'guard', roots: [{ path: good, access: 'rw' }, { path: path.join(tmp, 'ghost'), access: 'rw' }] },
      { ready: false }
    )
    expect(guard.invalidRoots).toEqual([{ path: path.join(tmp, 'ghost'), reason: 'missing' }])
    // A guard tier with only a valid writable root is clean.
    const clean = computeSandboxPlan({ ...base, sandbox: 'guard', roots: [{ path: good, access: 'rw' }] }, { ready: false })
    expect(clean.invalidRoots).toEqual([])
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

    const applied = await applySandbox({ ...base, sandbox: 'docker', roots: [{ path: realDir('out'), access: 'rw' }] }, {
      api,
      dockerReadiness
    })
    expect(readinessCalls).toBe(1)
    expect(applied.backend).toBe('docker')
    expect(calls.some(c => c.endpoint === '/api/config' && c.init?.method === 'PUT')).toBe(true)
    expect(calls.some(c => c.endpoint === '/api/tools/terminal/backend')).toBe(true)
  })

  it('fails closed: an invalid designated writable root in guard tier throws and applies nothing', async () => {
    const calls: string[] = []
    const api = async (endpoint: string) => {
      calls.push(endpoint)
      return {}
    }
    await expect(
      applySandbox({ ...base, sandbox: 'guard', roots: [{ path: path.join(tmp, 'ghost'), access: 'rw' }] }, { api })
    ).rejects.toThrow(/לא תקינות/)
    // Nothing was applied to the live runtime.
    expect(calls).toHaveLength(0)
  })

  it('fails closed: an invalid docker bind root throws before applying', async () => {
    await expect(
      applySandbox({ ...base, sandbox: 'docker', roots: [{ path: path.join(tmp, 'ghost'), access: 'ro' }] }, {
        api: async () => ({}),
        dockerReadiness: async () => ({ ready: true, status: 'ready' })
      })
    ).rejects.toThrow(/לא תקינות/)
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
