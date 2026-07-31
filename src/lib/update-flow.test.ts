import { describe, expect, it, vi } from 'vitest'
import { runHermesUpdate, type UpdateClient } from './update-flow'

const noSleep = async () => {}

function client(overrides: Partial<UpdateClient>): UpdateClient {
  return {
    startUpdate: async () => ({ ok: true }),
    updateActionStatus: async () => ({ running: false, exit_code: 0 }),
    healthCheck: async () => ({ health: { ok: true } }),
    checkUpdate: async () => ({ update_available: false, message: 'מעודכן' }),
    ...overrides
  }
}

describe('runHermesUpdate', () => {
  it('drives the official update to completion and returns the fresh status', async () => {
    let polls = 0
    const result = await runHermesUpdate(
      client({
        updateActionStatus: async () => {
          polls += 1
          return polls < 2 ? { running: true } : { running: false, exit_code: 0 }
        }
      }),
      { sleep: noSleep }
    )
    expect(result).toEqual({ update_available: false, message: 'מעודכן' })
    expect(polls).toBe(2)
  })

  it('refuses to poll when Hermes never started the update', async () => {
    const updateActionStatus = vi.fn()
    await expect(
      runHermesUpdate(client({ startUpdate: async () => ({ ok: false, message: 'busy' }), updateActionStatus }), {
        sleep: noSleep
      })
    ).rejects.toThrow('busy')
    expect(updateActionStatus).not.toHaveBeenCalled()
  })

  it('fails when the update action exits non-zero', async () => {
    await expect(
      runHermesUpdate(client({ updateActionStatus: async () => ({ running: false, exit_code: 1 }) }), {
        sleep: noSleep
      })
    ).rejects.toThrow('עדכון Hermes נכשל')
  })
})
