import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  clearRestoreJournal,
  journalPath,
  pendingRestoreKeys,
  readRestoreJournal,
  recoverPendingRestore,
  withLiveRestore,
  writeRestoreJournal
} from './live-restore-journal.mjs'

// A fake "live profile": a single mutable value with capture/restore hooks that
// can be made to fail on demand, standing in for the WhatsApp policy / partner
// settings the installed-UI probes really flip.
function fakeLive(initial) {
  const state = { value: initial, restores: 0, failRestore: false, dropRestore: false }
  return {
    state,
    capture: async () => JSON.parse(JSON.stringify(state.value)),
    restore: async value => {
      state.restores += 1
      if (state.failRestore) throw new Error('restore RPC exploded')
      if (state.dropRestore) return // silently ignored — must be caught by verify
      state.value = JSON.parse(JSON.stringify(value))
    }
  }
}

let dir
beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'hermes-restore-journal-test-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

const quiet = { warn: () => undefined }

describe('restore journal file contract', () => {
  it('writes, reads back and clears a journal', () => {
    const record = writeRestoreJournal('whatsapp-policy', { mode: 'read_only' }, { dir })
    expect(record.value).toEqual({ mode: 'read_only' })
    expect(existsSync(journalPath('whatsapp-policy', { dir }))).toBe(true)
    expect(readRestoreJournal('whatsapp-policy', { dir }).value).toEqual({ mode: 'read_only' })
    expect(pendingRestoreKeys({ dir })).toEqual(['whatsapp-policy'])
    clearRestoreJournal('whatsapp-policy', { dir })
    expect(readRestoreJournal('whatsapp-policy', { dir })).toBeNull()
    expect(pendingRestoreKeys({ dir })).toEqual([])
  })

  it('leaves no staging file behind (atomic temp + rename)', () => {
    writeRestoreJournal('partner-settings', { mode: 'assistant' }, { dir })
    const strays = pendingRestoreKeys({ dir })
    expect(strays).toEqual(['partner-settings'])
  })

  it('rejects an unreadable or foreign journal instead of dropping it', () => {
    writeFileSync(journalPath('whatsapp-policy', { dir }), '{not json', 'utf8')
    expect(() => readRestoreJournal('whatsapp-policy', { dir })).toThrow(/unreadable/)
    writeFileSync(journalPath('whatsapp-policy', { dir }), JSON.stringify({ version: 99 }), 'utf8')
    expect(() => readRestoreJournal('whatsapp-policy', { dir })).toThrow(/unexpected shape/)
  })

  it('rejects unsafe keys', () => {
    expect(() => journalPath('../escape', { dir })).toThrow(/must match/)
    expect(() => journalPath('', { dir })).toThrow(/must match/)
  })
})

describe('withLiveRestore', () => {
  it('journals before mutating and clears only after a verified restore', async () => {
    const live = fakeLive({ mode: 'read_only' })
    const seen = []
    const { result } = await withLiveRestore(
      { key: 'whatsapp-policy', capture: live.capture, restore: live.restore, dir, log: quiet },
      async original => {
        seen.push(JSON.parse(readFileSync(journalPath('whatsapp-policy', { dir }), 'utf8')).value)
        live.state.value = { mode: 'selected_chats' } // the probe mutates live state
        return `mutated from ${original.mode}`
      }
    )
    expect(result).toBe('mutated from read_only')
    expect(seen).toEqual([{ mode: 'read_only' }]) // journal existed DURING the mutation
    expect(live.state.value).toEqual({ mode: 'read_only' })
    expect(readRestoreJournal('whatsapp-policy', { dir })).toBeNull()
  })

  it('restores and clears even when the probe body throws, then rethrows the probe error', async () => {
    const live = fakeLive({ mode: 'read_only' })
    await expect(
      withLiveRestore(
        { key: 'whatsapp-policy', capture: live.capture, restore: live.restore, dir, log: quiet },
        async () => {
          live.state.value = { mode: 'full_access' }
          throw new Error('locator not found')
        }
      )
    ).rejects.toThrow(/locator not found/)
    expect(live.state.value).toEqual({ mode: 'read_only' })
    expect(readRestoreJournal('whatsapp-policy', { dir })).toBeNull()
  })

  it('throws loudly and KEEPS the journal when the restore call fails', async () => {
    const live = fakeLive({ mode: 'read_only' })
    live.state.failRestore = true
    await expect(
      withLiveRestore(
        { key: 'whatsapp-policy', capture: live.capture, restore: live.restore, dir, log: quiet },
        async () => {
          live.state.value = { mode: 'full_access' }
        }
      )
    ).rejects.toThrow(/restore RPC exploded/)
    expect(readRestoreJournal('whatsapp-policy', { dir }).value).toEqual({ mode: 'read_only' })
  })

  it('treats a silently ignored restore as a failure (verified read-back)', async () => {
    const live = fakeLive({ mode: 'read_only' })
    await expect(
      withLiveRestore(
        { key: 'whatsapp-policy', capture: live.capture, restore: live.restore, dir, log: quiet },
        async () => {
          live.state.value = { mode: 'full_access' }
          live.state.dropRestore = true
        }
      )
    ).rejects.toThrow(/did not take/)
    expect(readRestoreJournal('whatsapp-policy', { dir })).not.toBeNull()
  })

  it('reports BOTH errors when the probe fails and the restore fails', async () => {
    const live = fakeLive({ mode: 'read_only' })
    live.state.failRestore = true
    await expect(
      withLiveRestore(
        { key: 'whatsapp-policy', capture: live.capture, restore: live.restore, dir, log: quiet },
        async () => {
          throw new Error('locator not found')
        }
      )
    ).rejects.toThrow(/probe error:.*locator not found[\s\S]*restore error:.*restore RPC exploded/)
  })
})

describe('crash recovery', () => {
  it('restores a stale journal FIRST, before the new run mutates anything', async () => {
    // Simulate a crashed previous run: journal on disk, live value left mutated.
    writeRestoreJournal('partner-settings', { mode: 'assistant' }, { dir })
    const live = fakeLive({ mode: 'partner' })
    const order = []
    await withLiveRestore(
      {
        key: 'partner-settings',
        capture: async () => {
          order.push(`capture:${live.state.value.mode}`)
          return live.capture()
        },
        restore: async value => {
          order.push(`restore:${value.mode}`)
          return live.restore(value)
        },
        dir,
        log: quiet
      },
      async () => {
        order.push('body')
        live.state.value = { mode: 'partner' }
      }
    )
    expect(order[0]).toBe('restore:assistant') // recovery precedes everything
    expect(order).toContain('body')
    // The value the new run journalled is the RECOVERED one, not the crashed one.
    expect(live.state.value).toEqual({ mode: 'assistant' })
    expect(readRestoreJournal('partner-settings', { dir })).toBeNull()
  })

  it('refuses to proceed when the recovery itself fails', async () => {
    writeRestoreJournal('partner-settings', { mode: 'assistant' }, { dir })
    const live = fakeLive({ mode: 'partner' })
    live.state.failRestore = true
    let bodyRan = false
    await expect(
      recoverPendingRestore('partner-settings', {
        capture: live.capture,
        restore: live.restore,
        dir,
        log: quiet
      })
    ).rejects.toThrow(/restore RPC exploded/)
    expect(bodyRan).toBe(false)
    expect(readRestoreJournal('partner-settings', { dir })).not.toBeNull()
  })

  it('refuses to restore a journal captured against a DIFFERENT profile', async () => {
    writeRestoreJournal('partner-settings', { mode: 'assistant' }, { dir, meta: { scope: 'C:\\Temp\\qa-home' } })
    const live = fakeLive({ mode: 'partner' })
    await expect(
      recoverPendingRestore('partner-settings', {
        capture: live.capture,
        restore: live.restore,
        dir,
        scope: 'live-profile',
        log: quiet
      })
    ).rejects.toThrow(/captured against a different profile/)
    expect(live.state.restores).toBe(0)
    expect(readRestoreJournal('partner-settings', { dir })).not.toBeNull()
  })

  it('recovers when the scope matches', async () => {
    writeRestoreJournal('partner-settings', { mode: 'assistant' }, { dir, meta: { scope: 'live-profile' } })
    const live = fakeLive({ mode: 'partner' })
    const recovery = await recoverPendingRestore('partner-settings', {
      capture: live.capture,
      restore: live.restore,
      dir,
      scope: 'live-profile',
      log: quiet
    })
    expect(recovery.recovered).toBe(true)
    expect(live.state.value).toEqual({ mode: 'assistant' })
  })

  it('is a no-op when there is nothing pending', async () => {
    const live = fakeLive({ mode: 'assistant' })
    const recovery = await recoverPendingRestore('partner-settings', {
      capture: live.capture,
      restore: live.restore,
      dir,
      log: quiet
    })
    expect(recovery).toEqual({ recovered: false })
    expect(live.state.restores).toBe(0)
  })
})
