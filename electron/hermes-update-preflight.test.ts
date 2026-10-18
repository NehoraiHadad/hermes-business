import { describe, expect, it, vi } from 'vitest'
import {
  classifyUpdateCheck,
  assertReleaseReachable,
  OFFLINE_MESSAGE
} from './hermes-update-preflight.cjs'

const CMD = '/home/hermes-agent/venv/bin/hermes'

describe('classifyUpdateCheck', () => {
  it('permits mutation only on a clean check', () => {
    expect(classifyUpdateCheck({ ok: true, output: 'up to date' })).toBe('reachable')
  })

  it('flags a network failure as offline', () => {
    expect(classifyUpdateCheck({ ok: false, output: 'could not resolve host github.com' })).toBe('offline')
    expect(classifyUpdateCheck({ ok: false, output: 'connection refused' })).toBe('offline')
  })

  it('blocks (never silently proceeds) on a non-network check failure', () => {
    expect(classifyUpdateCheck({ ok: false, output: 'some other error' })).toBe('blocked')
  })
})

describe('assertReleaseReachable — never swallows a failed check into a mutation', () => {
  it('delegates stable release discovery to the native updater', async () => {
    const run = vi.fn().mockResolvedValue({ stdout: 'update available', stderr: '' })
    const fetch = vi.fn().mockReturnValue({ ok: true })
    await expect(
      assertReleaseReachable(CMD, { run, log: vi.fn() })
    ).resolves.toMatchObject({ reachable: true })
    expect(run).toHaveBeenCalledWith(CMD, ['update', '--check', '--channel', 'stable'], expect.any(Number))
    expect(fetch).not.toHaveBeenCalled()
  })

  it('aborts with the offline message when update --check fails with a network error', async () => {
    const run = vi.fn().mockRejectedValue(new Error('getaddrinfo ENOTFOUND'))
    await expect(
      assertReleaseReachable(CMD, { run, log: vi.fn() })
    ).rejects.toThrow(OFFLINE_MESSAGE)
  })

  it('aborts when update --check fails for a non-network reason (fail closed)', async () => {
    const run = vi.fn().mockRejectedValue(new Error('unexpected internal error'))
    const fetch = vi.fn()
    await expect(
      assertReleaseReachable(CMD, { run, log: vi.fn() })
    ).rejects.toThrow(/בדיקת זמינות/)
    // We never reached the git fetch (check already blocked).
    expect(fetch).not.toHaveBeenCalled()
  })


})
