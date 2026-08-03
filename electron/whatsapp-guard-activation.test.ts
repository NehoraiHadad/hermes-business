import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { activateWhatsappGuard, waitForFreshHeartbeat } from './whatsapp-guard-activation.cjs'
import { recoverGuardActivation } from './whatsapp-guard-recovery.cjs'
import { verifyGuardHeartbeat } from './whatsapp-guard.cjs'
import { officialGatewayState } from './gateway-status.cjs'
import { guardStatusWithActivation } from './whatsapp-guard-status.cjs'
import { readGuardActivationJournal, writeGuardActivationJournal } from './whatsapp-guard-journal.cjs'

const NOW = Date.parse('2026-08-01T12:00:00.000Z')

// A live gateway heartbeat that verifies as enforcing. `nonce` distinguishes process identity.
function heartbeat(nonce: string, over: Record<string, unknown> = {}) {
  return {
    plugin_loaded: true,
    enforcing: true,
    hooks: ['pre_gateway_dispatch', 'pre_tool_call'],
    mode: 'read_only',
    reply_chats: 0,
    pid: 4242,
    nonce,
    process_role: 'gateway',
    plugin_version: '0.2.0',
    transport_bound: true,
    guard_families: ['whatsapp', 'telegram'],
    updated_at: new Date(NOW - 5_000).toISOString(),
    ttl_seconds: 90,
    ...over
  }
}

const baseDeps = {
  installedVersion: () => '0.2.0',
  isPidAlive: () => true,
  now: () => NOW,
  sleep: async () => {}
}

describe('officialGatewayState — authoritative process snapshot (not heartbeat)', () => {
  const run = (stdout: string, stderr = '', extra: Record<string, unknown> = {}) =>
    officialGatewayState({ command: 'hermes', runner: () => ({ status: 0, stdout, stderr, ...extra }) })

  it('reports running from a positive PID line', () => {
    expect(run('✓ Gateway process running (PID: 1234)').state).toBe('running')
    expect(run('✓ Gateway is running (PID: 7)\n  (Running manually)').state).toBe('running')
  })
  it('reports stopped from the no-process line', () => {
    expect(run('✗ No gateway process detected').state).toBe('stopped')
    expect(run('✗ Gateway is not running').state).toBe('stopped')
  })
  it('a running process is NOT misread as stopped just because the SERVICE is not installed', () => {
    expect(run('✗ Gateway service not installed\n✓ Gateway process running (PID: 9)').state).toBe('running')
  })
  it('fails closed to unknown when hermes is absent', () => {
    expect(officialGatewayState({ command: null as any }).state).toBe('unknown')
  })
  it('fails closed to unknown on a spawn error', () => {
    const state = officialGatewayState({
      command: 'hermes',
      runner: () => {
        throw new Error('ENOENT')
      }
    }).state
    expect(state).toBe('unknown')
  })
  it('fails closed to unknown on unparseable output (even exit 0)', () => {
    expect(run('some unrelated banner text').state).toBe('unknown')
  })
})

describe('verifyGuardHeartbeat — start-nonce supersession', () => {
  const deps = { now: NOW, isPidAlive: () => true, installedVersion: '0.2.0' }
  it('BLOCKS a heartbeat still carrying the superseded (pre-restart) nonce', () => {
    expect(verifyGuardHeartbeat(heartbeat('old'), { ...deps, supersedeNonce: 'old' })).toBeNull()
  })
  it('accepts a fresh-nonce heartbeat after the restart', () => {
    expect(verifyGuardHeartbeat(heartbeat('new'), { ...deps, supersedeNonce: 'old' })).toMatchObject({
      process_role: 'gateway',
      enforcing: true
    })
  })
})

describe('activateWhatsappGuard', () => {
  let tmp: string
  let prevHome: string | undefined
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-guard-act-'))
    prevHome = process.env.HERMES_BUSINESS_HOME
    process.env.HERMES_BUSINESS_HOME = tmp
  })
  afterEach(() => {
    if (prevHome === undefined) delete process.env.HERMES_BUSINESS_HOME
    else process.env.HERMES_BUSINESS_HOME = prevHome
    fs.rmSync(tmp, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('OLD running gateway with ZERO heartbeat + changed plugin → STILL restarts (the core fix)', async () => {
    // The regression: a gateway launched before heartbeat support publishes no heartbeat, so the
    // old `Boolean(beforeHeartbeat)` proxy skipped the restart. The authoritative official state
    // is 'running', so the restart is now mandatory even with no pre-restart heartbeat.
    let current: any = null // old pre-heartbeat gateway → no heartbeat file at all
    const restart = vi.fn(async () => {
      current = heartbeat('new') // the restarted gateway publishes its first heartbeat
      return { ok: true }
    })
    const result = await activateWhatsappGuard({
      ...baseDeps,
      priorGatewayState: 'running',
      install: () => ({ ok: true, enabled: true, changed: true }),
      readHeartbeat: () => current,
      restart
    })
    expect(restart).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ active: true, blocked: false, restarted: true, phase: 'active' })
    expect(readGuardActivationJournal()?.status).toBe('active')
  })

  it('existing running gateway (with heartbeat) + changed plugin → restarts and reverifies FRESH', async () => {
    let current: any = heartbeat('old')
    const restart = vi.fn(async () => {
      current = heartbeat('new')
      return { ok: true }
    })
    const result = await activateWhatsappGuard({
      ...baseDeps,
      priorGatewayState: 'running',
      install: () => ({ ok: true, enabled: true, changed: true }),
      readHeartbeat: () => current,
      restart
    })
    expect(restart).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ active: true, restarted: true, phase: 'active' })
  })

  it('changed plugin + restart FAILURE → fails closed (blocked), journal failed', async () => {
    const result = await activateWhatsappGuard({
      ...baseDeps,
      priorGatewayState: 'running',
      install: () => ({ ok: true, enabled: true, changed: true }),
      readHeartbeat: () => heartbeat('old'),
      restart: async () => {
        throw new Error('boom')
      }
    })
    expect(result.active).toBe(false)
    expect(result.blocked).toBe(true)
    expect(result.reason).toContain('restart-failed')
    expect(readGuardActivationJournal()?.status).toBe('failed')
  })

  it('changed plugin + heartbeat NEVER goes fresh → heartbeat-timeout, fails closed', async () => {
    const restart = vi.fn(async () => ({ ok: true }))
    const result = await activateWhatsappGuard({
      ...baseDeps,
      priorGatewayState: 'running',
      timeoutMs: 0,
      install: () => ({ ok: true, enabled: true, changed: true }),
      readHeartbeat: () => heartbeat('old'), // stays the superseded pre-restart process
      restart
    })
    expect(restart).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ active: false, blocked: true, restarted: true, reason: 'heartbeat-timeout' })
    expect(readGuardActivationJournal()?.status).toBe('failed')
  })

  it('FRESH start: stopped + startedFresh + changed → active WITHOUT a redundant restart', async () => {
    const restart = vi.fn(async () => ({ ok: true }))
    const result = await activateWhatsappGuard({
      ...baseDeps,
      priorGatewayState: 'stopped',
      gatewayStartedFresh: true,
      install: () => ({ ok: true, enabled: true, changed: true }),
      readHeartbeat: () => heartbeat('fresh'), // the freshly launched gateway published a heartbeat
      restart
    })
    expect(restart).not.toHaveBeenCalled()
    expect(result).toMatchObject({ active: true, restarted: false, phase: 'active' })
  })

  it('fresh start whose heartbeat has not appeared yet → pending, NOT blocked (no old code risk)', async () => {
    const restart = vi.fn(async () => ({ ok: true }))
    const result = await activateWhatsappGuard({
      ...baseDeps,
      priorGatewayState: 'stopped',
      gatewayStartedFresh: true,
      timeoutMs: 0,
      install: () => ({ ok: true, enabled: true, changed: true }),
      readHeartbeat: () => null,
      restart
    })
    expect(restart).not.toHaveBeenCalled()
    expect(result).toMatchObject({ active: false, blocked: false, phase: 'pending', reason: 'no-heartbeat' })
  })

  it('UNKNOWN official status + changed plugin → fails closed (blocked), no restart', async () => {
    const restart = vi.fn(async () => ({ ok: true }))
    const result = await activateWhatsappGuard({
      ...baseDeps,
      priorGatewayState: 'unknown',
      install: () => ({ ok: true, enabled: true, changed: true }),
      readHeartbeat: () => heartbeat('x'),
      restart
    })
    expect(restart).not.toHaveBeenCalled()
    expect(result).toMatchObject({ active: false, blocked: true, reason: 'gateway-status-unknown' })
    expect(readGuardActivationJournal()?.status).toBe('failed')
  })

  it('unchanged plugin + live heartbeat → active WITHOUT restarting', async () => {
    const restart = vi.fn(async () => ({ ok: true }))
    const result = await activateWhatsappGuard({
      ...baseDeps,
      priorGatewayState: 'running',
      install: () => ({ ok: true, enabled: true, changed: false }),
      readHeartbeat: () => heartbeat('running'),
      restart
    })
    expect(restart).not.toHaveBeenCalled()
    expect(result).toMatchObject({ active: true, restarted: false, phase: 'active' })
  })

  it('no credentials (no gateway heartbeat) → pending, not active, not blocked, no restart', async () => {
    const restart = vi.fn(async () => ({ ok: true }))
    const result = await activateWhatsappGuard({
      ...baseDeps,
      priorGatewayState: 'stopped',
      install: () => ({ ok: true, enabled: true, changed: false }),
      readHeartbeat: () => null,
      restart
    })
    expect(restart).not.toHaveBeenCalled()
    expect(result).toMatchObject({ active: false, blocked: false, phase: 'pending', reason: 'no-heartbeat' })
  })

  it('plugin cannot be enabled → fails closed (blocked)', async () => {
    const result = await activateWhatsappGuard({
      ...baseDeps,
      priorGatewayState: 'running',
      install: () => ({ ok: true, enabled: false, reason: 'hermes-not-found', changed: false }),
      readHeartbeat: () => null,
      restart: async () => ({ ok: true })
    })
    expect(result).toMatchObject({ active: false, blocked: true, reason: 'hermes-not-found' })
  })

  it('pending path NEVER silently clears an in-flight or failed journal owed to recovery', async () => {
    // Defense-in-depth for the ordering fix: even if activation reaches its pending path while a
    // prior transaction record survives, it must not wipe an in-flight/failed journal.
    for (const status of ['verifying', 'failed'] as const) {
      writeGuardActivationJournal({ status, supersedeNonce: 'old', changed: true })
      await activateWhatsappGuard({
        ...baseDeps,
        priorGatewayState: 'stopped',
        install: () => ({ ok: true, enabled: true, changed: false }),
        readHeartbeat: () => null,
        restart: async () => ({ ok: true })
      })
      expect(readGuardActivationJournal()?.status).toBe(status)
    }
  })

  it('pending path DOES reset a stale active journal (no live proof anymore)', async () => {
    writeGuardActivationJournal({ status: 'active', changed: false })
    await activateWhatsappGuard({
      ...baseDeps,
      priorGatewayState: 'stopped',
      install: () => ({ ok: true, enabled: true, changed: false }),
      readHeartbeat: () => null,
      restart: async () => ({ ok: true })
    })
    expect(readGuardActivationJournal()).toBeNull()
  })
})

describe('guardStatusWithActivation — stale heartbeat fails closed during an in-flight restart', () => {
  it('BLOCKS the pre-restart heartbeat while a restart transaction is verifying', () => {
    const journal = { status: 'verifying', supersedeNonce: 'old' }
    const read = ({ supersedeNonce }: { supersedeNonce?: string }) =>
      verifyGuardHeartbeat(heartbeat('old'), { now: NOW, isPidAlive: () => true, installedVersion: '0.2.0', supersedeNonce })
    expect(guardStatusWithActivation({ journal, read } as any)).toBeNull()
  })
  it('accepts a live heartbeat once the transaction is active (supersede cleared)', () => {
    const journal = { status: 'active' }
    const read = ({ supersedeNonce }: { supersedeNonce?: string }) =>
      verifyGuardHeartbeat(heartbeat('new'), { now: NOW, isPidAlive: () => true, installedVersion: '0.2.0', supersedeNonce })
    expect(guardStatusWithActivation({ journal, read } as any)).toMatchObject({ enforcing: true })
  })
})

describe('recoverGuardActivation — finishes a crash-interrupted restart BEFORE activation', () => {
  let tmp: string
  let prevHome: string | undefined
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-guard-rec-'))
    prevHome = process.env.HERMES_BUSINESS_HOME
    process.env.HERMES_BUSINESS_HOME = tmp
  })
  afterEach(() => {
    if (prevHome === undefined) delete process.env.HERMES_BUSINESS_HOME
    else process.env.HERMES_BUSINESS_HOME = prevHome
    fs.rmSync(tmp, { recursive: true, force: true })
  })

  it('no journal → no-op', async () => {
    expect(await recoverGuardActivation({ ...baseDeps, readHeartbeat: () => null })).toMatchObject({ action: 'none' })
  })

  it('interrupted "verifying" journal + fresh heartbeat now present → recovered active', async () => {
    writeGuardActivationJournal({ status: 'verifying', supersedeNonce: 'old', expectedVersion: '0.2.0', changed: true })
    const result = await recoverGuardActivation({ ...baseDeps, readHeartbeat: () => heartbeat('new') })
    expect(result).toMatchObject({ action: 'recovered', active: true })
    expect(readGuardActivationJournal()?.status).toBe('active')
  })

  it('interrupted journal + still-superseded heartbeat → recovery-timeout (failed)', async () => {
    writeGuardActivationJournal({ status: 'verifying', supersedeNonce: 'old', expectedVersion: '0.2.0', changed: true })
    const result = await recoverGuardActivation({ ...baseDeps, timeoutMs: 0, readHeartbeat: () => heartbeat('old') })
    expect(result).toMatchObject({ action: 'failed', active: false })
    expect(readGuardActivationJournal()?.status).toBe('failed')
  })

  it('ordering: recovery finalizes the interrupted journal so a later pending activation preserves it', async () => {
    // Simulate the launch sequence: recovery runs FIRST and honestly fails an unrecoverable
    // restart; a subsequent pending activation must not erase that 'failed' record.
    writeGuardActivationJournal({ status: 'verifying', supersedeNonce: 'old', expectedVersion: '0.2.0', changed: true })
    await recoverGuardActivation({ ...baseDeps, timeoutMs: 0, readHeartbeat: () => heartbeat('old') })
    expect(readGuardActivationJournal()?.status).toBe('failed')
    await activateWhatsappGuard({
      ...baseDeps,
      priorGatewayState: 'stopped',
      install: () => ({ ok: true, enabled: true, changed: false }),
      readHeartbeat: () => null,
      restart: async () => ({ ok: true })
    })
    expect(readGuardActivationJournal()?.status).toBe('failed')
  })
})

// waitForFreshHeartbeat is re-exported for direct probing in other suites; touch it so a broken
// export surfaces here rather than in a distant importer.
describe('waitForFreshHeartbeat export', () => {
  it('resolves the verified heartbeat immediately when one is already fresh', async () => {
    const verified = await waitForFreshHeartbeat({
      ...baseDeps,
      timeoutMs: 0,
      expectedVersion: '0.2.0',
      readHeartbeat: () => heartbeat('now')
    })
    expect(verified).toMatchObject({ enforcing: true, process_role: 'gateway' })
  })
})
