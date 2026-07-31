import { describe, expect, it, vi } from 'vitest'
import { reapProcessTree } from './process-util.cjs'

describe('reapProcessTree', () => {
  it('force-kills the whole tree via taskkill /t /f on Windows', () => {
    const run = vi.fn()
    const ok = reapProcessTree({ pid: 4242 }, { platform: 'win32', run })
    expect(ok).toBe(true)
    expect(run).toHaveBeenCalledWith(
      'taskkill.exe',
      ['/pid', '4242', '/t', '/f'],
      { windowsHide: true }
    )
  })

  it('escalates SIGTERM then SIGKILL on POSIX', () => {
    const kill = vi.fn()
    const ok = reapProcessTree({ pid: 5, kill }, { platform: 'linux' })
    expect(ok).toBe(true)
    expect(kill).toHaveBeenNthCalledWith(1, 'SIGTERM')
    expect(kill).toHaveBeenNthCalledWith(2, 'SIGKILL')
  })

  it('is a no-op for a missing process (no pid)', () => {
    const run = vi.fn()
    expect(reapProcessTree(null, { platform: 'win32', run })).toBe(false)
    expect(reapProcessTree({ pid: null }, { platform: 'win32', run })).toBe(false)
    expect(run).not.toHaveBeenCalled()
  })

  it('swallows a SIGTERM that throws because the process already exited', () => {
    const kill = vi.fn().mockImplementationOnce(() => {
      throw new Error('ESRCH')
    })
    // SIGTERM throws, SIGKILL still attempted; overall returns true.
    expect(reapProcessTree({ pid: 9, kill }, { platform: 'linux' })).toBe(true)
    expect(kill).toHaveBeenCalledTimes(2)
  })
})
