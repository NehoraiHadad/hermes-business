import { describe, expect, it, vi } from 'vitest'
import { runHermesUpdate, type UpdateClient } from './update-flow'

const noSleep = async () => {}

function client(overrides: Partial<UpdateClient>): UpdateClient {
  let updateChecks = 0
  return {
    startUpdate: async () => ({ ok: true }),
    updateActionStatus: async () => ({ running: false, exit_code: 0 }),
    healthCheck: async () => ({ health: { ok: true } }),
    checkUpdate: async () => {
      updateChecks += 1
      return updateChecks === 1
        ? { update_available: true, can_apply: true, message: 'מוכן לעדכון' }
        : { update_available: false, message: 'מעודכן' }
    },
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

  it('accepts a completed desktop-orchestrated Windows update without stale REST polling', async () => {
    const updateActionStatus = vi.fn()
    const result = await runHermesUpdate(
      client({ startUpdate: async () => ({ ok: true, completed: true }), updateActionStatus }),
      { sleep: noSleep }
    )
    expect(result.update_available).toBe(false)
    expect(updateActionStatus).not.toHaveBeenCalled()
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

  it('refuses an update when Hermes marks the checkout unsafe', async () => {
    const startUpdate = vi.fn()
    await expect(
      runHermesUpdate(
        client({
          checkUpdate: async () => ({
            update_available: true,
            can_apply: false,
            message: 'התקנת Hermes כוללת שינויים מקומיים'
          }),
          startUpdate
        }),
        { sleep: noSleep }
      )
    ).rejects.toThrow('שינויים מקומיים')
    expect(startUpdate).not.toHaveBeenCalled()
  })

  it('does not start a stale update after Hermes is already current', async () => {
    const startUpdate = vi.fn()
    await expect(
      runHermesUpdate(
        client({
          checkUpdate: async () => ({ update_available: false, can_apply: true, message: 'מעודכן' }),
          startUpdate
        }),
        { sleep: noSleep }
      )
    ).rejects.toThrow('מעודכן')
    expect(startUpdate).not.toHaveBeenCalled()
  })
})
