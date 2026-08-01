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
  it('passes for a reachable git install (check ok + fetch ok)', async () => {
    const run = vi.fn().mockResolvedValue({ stdout: 'update available', stderr: '' })
    const fetch = vi.fn().mockReturnValue({ ok: true })
    await expect(
      assertReleaseReachable(CMD, { run, isGit: () => true, fetch, log: vi.fn() })
    ).resolves.toMatchObject({ reachable: true })
    expect(fetch).toHaveBeenCalledWith(CMD)
  })

  it('aborts with the offline message when update --check fails with a network error', async () => {
    const run = vi.fn().mockRejectedValue(new Error('getaddrinfo ENOTFOUND'))
    await expect(
      assertReleaseReachable(CMD, { run, isGit: () => true, fetch: vi.fn(), log: vi.fn() })
    ).rejects.toThrow(OFFLINE_MESSAGE)
  })

  it('aborts when update --check fails for a non-network reason (fail closed)', async () => {
    const run = vi.fn().mockRejectedValue(new Error('unexpected internal error'))
    const fetch = vi.fn()
    await expect(
      assertReleaseReachable(CMD, { run, isGit: () => true, fetch, log: vi.fn() })
    ).rejects.toThrow(/בדיקת זמינות/)
    // We never reached the git fetch (check already blocked).
    expect(fetch).not.toHaveBeenCalled()
  })

  it('aborts when the git fetch cannot reach origin even though update --check passed', async () => {
    const run = vi.fn().mockResolvedValue({ stdout: 'ok', stderr: '' })
    const fetch = vi.fn().mockReturnValue({ ok: false, reason: 'fetch-failed', detail: 'Could not read from remote' })
    await expect(
      assertReleaseReachable(CMD, { run, isGit: () => true, fetch, log: vi.fn() })
    ).rejects.toThrow(/מקור העדכון אינו נגיש/)
  })
})
