import { describe, expect, it, vi } from 'vitest'
import { recoverIncompleteUpdate } from './hermes-update-recovery.cjs'

const CMD = '/home/hermes-agent/venv/bin/hermes'
const RECORD = { phase: 'mutating', method: 'git', anchor: 'abc123', backupPath: '/b/pre.zip' }

function makeDeps(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    detect: vi.fn().mockReturnValue(RECORD),
    resolveCommand: vi.fn().mockReturnValue(CMD),
    fullHealth: vi.fn().mockResolvedValue({ health: { ok: true } }),
    rollback: vi.fn().mockReturnValue({ restored: true, method: 'git', commit: 'abc123' }),
    fail: vi.fn(),
    clear: vi.fn(),
    log: vi.fn(),
    ...overrides
  }
}

describe('recoverIncompleteUpdate — launch-time deterministic recovery', () => {
  it('does nothing when there is no incomplete journal', async () => {
    const deps = makeDeps({ detect: vi.fn().mockReturnValue(null) })
    const result = await recoverIncompleteUpdate(deps)
    expect(result).toMatchObject({ recovered: false, action: 'none' })
    expect(deps.fullHealth).not.toHaveBeenCalled()
    expect(deps.clear).not.toHaveBeenCalled()
  })

  it('clears the journal when the install is already verified-healthy (update landed pre-crash)', async () => {
    const deps = makeDeps()
    const result = await recoverIncompleteUpdate(deps)
    expect(result).toMatchObject({ recovered: true, action: 'already-healthy' })
    expect(deps.clear).toHaveBeenCalledWith({ outcome: 'recovered-healthy' })
    expect(deps.rollback).not.toHaveBeenCalled()
  })

  it('rolls back to the anchor and clears only after BOTH healths pass post-rollback', async () => {
    // First full-health (as-is) fails; second (after rollback) passes.
    const fullHealth = vi
      .fn()
      .mockRejectedValueOnce(new Error('unhealthy after crash'))
      .mockResolvedValueOnce({ health: { ok: true } })
    const deps = makeDeps({ fullHealth })
    const result = await recoverIncompleteUpdate(deps)
    expect(result).toMatchObject({ recovered: true, action: 'rolled-back', commit: 'abc123' })
    expect(deps.rollback).toHaveBeenCalledWith({ command: CMD, anchor: 'abc123', backupPath: '/b/pre.zip' })
    expect(deps.clear).toHaveBeenCalledWith({ outcome: 'recovered-rolledback' })
  })

  it('preserves the journal (no clear) when rollback restores but health still fails', async () => {
    const deps = makeDeps({ fullHealth: vi.fn().mockRejectedValue(new Error('still broken')) })
    const result = await recoverIncompleteUpdate(deps)
    expect(result).toMatchObject({ recovered: false, action: 'rolled-back-unhealthy' })
    expect(deps.clear).not.toHaveBeenCalled()
    expect(deps.fail).toHaveBeenCalled()
  })

  it('fails closed (journal preserved) when the rollback cannot restore', async () => {
    const deps = makeDeps({
      fullHealth: vi.fn().mockRejectedValue(new Error('unhealthy')),
      rollback: vi.fn().mockReturnValue({ restored: false, method: 'non-git', message: 'see backup /b/pre.zip' })
    })
    const result = await recoverIncompleteUpdate(deps)
    expect(result).toMatchObject({ recovered: false, action: 'fail-closed', message: 'see backup /b/pre.zip' })
    expect(deps.clear).not.toHaveBeenCalled()
  })

  it('reports honestly when Hermes is not installed during recovery', async () => {
    const deps = makeDeps({ resolveCommand: vi.fn().mockReturnValue(null) })
    const result = await recoverIncompleteUpdate(deps)
    expect(result).toMatchObject({ recovered: false, action: 'no-command' })
    expect(deps.fullHealth).not.toHaveBeenCalled()
  })
})
