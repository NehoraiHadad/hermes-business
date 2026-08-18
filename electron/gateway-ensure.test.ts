import { describe, expect, it, vi } from 'vitest'

// require() (not import) so the module graph matches the CJS singletons the
// runtime uses — same idiom as companion-update.test.ts.
const { ensureGatewayBackground } = require('./gateway-ensure.cjs')

const REGISTERED_STATUS = {
  stdout: '✓ Windows login item installed: X\n✓ Gateway process running (PID: 1)',
  stderr: ''
}

describe('ensureGatewayBackground — QA runtime suppression', () => {
  it('ARMED override: returns the skip verdict and never spawns a single command', async () => {
    const run = vi.fn()
    const result = await ensureGatewayBackground('hermes.exe', {
      qaOverride: () => ({ enabled: true, hermesHome: 'C:/tmp/qa', host: '127.0.0.1', port: 47100 }),
      run
    })
    expect(result).toEqual({
      ok: true,
      installed: false,
      running: false,
      startedFresh: false,
      skipped: 'qa-isolated-runtime'
    })
    expect(run).not.toHaveBeenCalled()
  })

  it('a requested-but-invalid override propagates the fail-closed throw — no install fallback', async () => {
    const run = vi.fn()
    await expect(
      ensureGatewayBackground('hermes.exe', {
        qaOverride: () => {
          throw new Error('qa override invalid')
        },
        run
      })
    ).rejects.toThrow('qa override invalid')
    expect(run).not.toHaveBeenCalled()
  })

  it('UNARMED (production): running + registered gateway is left alone, startedFresh false', async () => {
    const run = vi.fn().mockResolvedValue(REGISTERED_STATUS)
    const result = await ensureGatewayBackground('hermes.exe', { qaOverride: () => ({ enabled: false }), run })
    expect(result).toEqual({ ok: true, installed: true, running: true, startedFresh: false })
    expect(run).toHaveBeenCalledTimes(1)
    expect(run.mock.calls[0][1]).toEqual(['gateway', 'status'])
  })

  it('UNARMED (production): unregistered gateway still gets the full install, unchanged', async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce({ stdout: 'nothing here', stderr: '' })
      .mockResolvedValueOnce({ stdout: '', stderr: '' })
    const result = await ensureGatewayBackground('hermes.exe', {
      qaOverride: () => ({ enabled: false }),
      run,
      log: vi.fn()
    })
    expect(result).toEqual({ ok: true, installed: true, running: true, startedFresh: true })
    expect(run.mock.calls[1][1]).toEqual(['gateway', 'install', '--start-now', '--start-on-login'])
  })

  it('UNARMED with no hermes command: honest failure, no spawn', async () => {
    const run = vi.fn()
    const result = await ensureGatewayBackground(null, { qaOverride: () => ({ enabled: false }), run })
    expect(result).toEqual({ ok: false, installed: false, startedFresh: false })
    expect(run).not.toHaveBeenCalled()
  })
})
