import { describe, expect, it, vi } from 'vitest'
import { settleRuntimeBoot } from './runtime-boot'

describe('settleRuntimeBoot', () => {
  it('preserves the authoritative runtime result', async () => {
    const runtime = { installed: true, running: true, starting: false } as HermesRuntime
    await expect(settleRuntimeBoot(async () => runtime, 10)).resolves.toBe(runtime)
  })

  it('turns a rejected boot into a truthful stopped runtime', async () => {
    const runtime = await settleRuntimeBoot(async () => {
      throw new Error('IPC unavailable')
    }, 10)
    expect(runtime).toMatchObject({ running: false, starting: false, error: 'IPC unavailable' })
  })

  it('never leaves the renderer unresolved when boot hangs', async () => {
    vi.useFakeTimers()
    const result = settleRuntimeBoot(() => new Promise(() => {}), 25)
    await vi.advanceTimersByTimeAsync(25)
    await expect(result).resolves.toMatchObject({ running: false, starting: false, mode: 'error' })
    vi.useRealTimers()
  })
})
