import { describe, expect, it, vi } from 'vitest'
import { reapOwnedTreeAndRemoveHome } from './teardown.mjs'

const home = 'C:\\Temp\\hermes-qa-home-x'
const owned = records => ({ applicable: true, ok: true, records })
const rec = pid => ({ pid, creation: 'c', exe: 'x.exe' })
const noSleep = () => Promise.resolve()

function harness({ reapResults, removeResults }) {
  let reapCall = 0
  let removeCall = 0
  return {
    reapFn: vi.fn(() => reapResults[Math.min(reapCall++, reapResults.length - 1)]),
    removeFn: vi.fn(async () => removeResults[Math.min(removeCall++, removeResults.length - 1)]),
    killPortFn: vi.fn(),
    sleepFn: vi.fn(noSleep)
  }
}

describe('reapOwnedTreeAndRemoveHome (fail-closed owned-tree containment)', () => {
  it('clean pass: verified-dead tree, home removed on the first try, zero kill rounds', async () => {
    const h = harness({
      reapResults: [{ owned: [1], survivors: [], killed: [], reused: [], allExited: true }],
      removeResults: [{ removed: true }]
    })
    const result = await reapOwnedTreeAndRemoveHome({
      tempHome: home,
      isolatedPort: 47100,
      ownedProcs: owned([rec(1)]),
      platform: 'win32',
      ...h
    })
    expect(result.treeDead).toBe(true)
    expect(result.removed.removed).toBe(true)
    expect(result.removalRounds).toBe(0)
    expect(h.reapFn).toHaveBeenCalledTimes(1)
    expect(h.reapFn).toHaveBeenCalledWith([rec(1)], { timeoutMs: 2_500 })
  })

  it('a lock-holding survivor triggers immediate force-kill rounds interleaved with removal retries', async () => {
    const h = harness({
      reapResults: [
        { owned: [7], survivors: [7], killed: [], reused: [], allExited: false },
        { owned: [7], survivors: [], killed: [7], reused: [], allExited: true }
      ],
      removeResults: [{ removed: false }, { removed: true }]
    })
    const result = await reapOwnedTreeAndRemoveHome({
      tempHome: home,
      isolatedPort: 47100,
      ownedProcs: owned([rec(7)]),
      platform: 'win32',
      ...h
    })
    expect(result.removalRounds).toBe(1)
    expect(result.removed.removed).toBe(true)
    expect(result.treeDead).toBe(true)
    expect(result.killed).toEqual([7])
    // Retry rounds force-kill without a natural-exit grace window.
    expect(h.reapFn).toHaveBeenNthCalledWith(2, [rec(7)], { timeoutMs: 0 })
    expect(h.killPortFn).toHaveBeenCalledTimes(1)
  })

  it('NEVER reports removed/dead when the survivor outlives every bounded round', async () => {
    const stuck = { owned: [9], survivors: [9], killed: [], reused: [], allExited: false }
    const h = harness({ reapResults: [stuck], removeResults: [{ removed: false }] })
    const result = await reapOwnedTreeAndRemoveHome({
      tempHome: home,
      isolatedPort: 47100,
      ownedProcs: owned([rec(9)]),
      platform: 'win32',
      rounds: 3,
      ...h
    })
    expect(result.removed.removed).toBe(false)
    expect(result.treeDead).toBe(false)
    expect(result.survivors).toEqual([9])
    expect(result.removalRounds).toBe(3)
    expect(h.removeFn).toHaveBeenCalledTimes(4) // initial + 3 bounded retries
  })

  it('fails closed when the alive-snapshot could not be captured, even if nothing is visibly alive', async () => {
    const h = harness({
      reapResults: [{ owned: [], survivors: [], killed: [], reused: [], allExited: true }],
      removeResults: [{ removed: true }]
    })
    const result = await reapOwnedTreeAndRemoveHome({
      tempHome: home,
      isolatedPort: 47100,
      ownedProcs: { applicable: true, ok: false, records: [] },
      platform: 'win32',
      ...h
    })
    expect(result.snapshotOk).toBe(false)
    expect(result.treeDead).toBe(false)
  })

  it('fails closed when no snapshot was ever taken (ownedProcs null on win32)', async () => {
    const h = harness({
      reapResults: [{ owned: [], survivors: [], killed: [], reused: [], allExited: true }],
      removeResults: [{ removed: true }]
    })
    const result = await reapOwnedTreeAndRemoveHome({
      tempHome: home,
      isolatedPort: 47100,
      ownedProcs: null,
      platform: 'win32',
      ...h
    })
    expect(result.snapshotOk).toBe(false)
    expect(result.treeDead).toBe(false)
  })

  it('off Windows the identity machinery is inert and the verdict is explicitly null', async () => {
    const h = harness({ reapResults: [], removeResults: [{ removed: true }] })
    const result = await reapOwnedTreeAndRemoveHome({
      tempHome: home,
      isolatedPort: 47100,
      ownedProcs: null,
      platform: 'linux',
      ...h
    })
    expect(result).toMatchObject({ applicable: false, snapshotOk: null, treeDead: null })
    expect(h.reapFn).not.toHaveBeenCalled()
  })
})
