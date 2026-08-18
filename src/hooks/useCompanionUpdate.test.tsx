// @vitest-environment jsdom
import '../test/setup-dom'
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useCompanionUpdate } from './useCompanionUpdate'
import {
  bridge,
  emitCompanionDownloadProgress,
  emitCompanionUpdateAvailable,
  stubBridge
} from '../test/hermes-bridge'

// Companion self-update check, renderer state machine (docs/specs/versioning.md
// §6.4/§6.5/§13 stage 4). All network/parse/decision work lives in main
// (companion-update.cjs) — this hook only owns "have we checked yet" and the
// passive-push subscription, so every case here drives the bridge double
// directly rather than a real fetch.

const AVAILABLE_VERDICT: CompanionUpdateStatus = {
  status: 'update-available',
  current: '0.4.0',
  latest: '0.5.0',
  checkedAt: 1000,
  downloadUrl: 'https://github.com/NehoraiHadad/hermes-business/releases/tag/v0.5.0'
}

const UNKNOWN_VERDICT: CompanionUpdateStatus = {
  status: 'unknown',
  current: '0.4.0',
  checkedAt: null,
  message: 'לא ניתן לבדוק עדכונים כרגע'
}

const UP_TO_DATE_VERDICT: CompanionUpdateStatus = {
  status: 'up-to-date',
  current: '0.4.0',
  checkedAt: 2000
}

afterEach(() => {
  window.localStorage.clear()
})

describe('useCompanionUpdate — initial state (§7.1 "לא נבדק")', () => {
  it('starts with verdict null before any check has run', () => {
    const { result } = renderHook(() => useCompanionUpdate())
    expect(result.current.verdict).toBeNull()
    expect(result.current.checking).toBe(false)
  })
})

describe('useCompanionUpdate — explicit check()', () => {
  it('calls hermesClient.checkCompanionUpdate with force and stores the verdict', async () => {
    stubBridge({ checkCompanionUpdate: async () => AVAILABLE_VERDICT })
    const { result } = renderHook(() => useCompanionUpdate())

    let returned: CompanionUpdateStatus | undefined
    await act(async () => {
      returned = await result.current.check(true)
    })

    expect(bridge().checkCompanionUpdate).toHaveBeenCalledWith(true)
    expect(result.current.verdict).toEqual(AVAILABLE_VERDICT)
    expect(returned).toEqual(AVAILABLE_VERDICT)
    expect(result.current.checking).toBe(false)
  })

  it('defaults force to false when the caller omits it', async () => {
    stubBridge({ checkCompanionUpdate: async () => UP_TO_DATE_VERDICT })
    const { result } = renderHook(() => useCompanionUpdate())
    await act(async () => {
      await result.current.check()
    })
    expect(bridge().checkCompanionUpdate).toHaveBeenCalledWith(false)
  })

  it('reflects the offline/failure verdict honestly ("unknown") rather than throwing', async () => {
    stubBridge({ checkCompanionUpdate: async () => UNKNOWN_VERDICT })
    const { result } = renderHook(() => useCompanionUpdate())
    await act(async () => {
      await result.current.check(true)
    })
    expect(result.current.verdict).toEqual(UNKNOWN_VERDICT)
  })

  it('sets checking true for the duration of an in-flight check', async () => {
    let resolveCheck: (value: CompanionUpdateStatus) => void = () => {}
    const gate = new Promise<CompanionUpdateStatus>(resolve => {
      resolveCheck = resolve
    })
    stubBridge({ checkCompanionUpdate: async () => gate })
    const { result } = renderHook(() => useCompanionUpdate())

    let inFlight!: Promise<CompanionUpdateStatus>
    act(() => {
      inFlight = result.current.check(true)
    })
    expect(result.current.checking).toBe(true)

    await act(async () => {
      resolveCheck(UP_TO_DATE_VERDICT)
      await inFlight
    })
    expect(result.current.checking).toBe(false)
  })

  it('does not update state after unmount (no act warning, no stale write)', async () => {
    let resolveCheck: (value: CompanionUpdateStatus) => void = () => {}
    const gate = new Promise<CompanionUpdateStatus>(resolve => {
      resolveCheck = resolve
    })
    stubBridge({ checkCompanionUpdate: async () => gate })
    const { result, unmount } = renderHook(() => useCompanionUpdate())

    let inFlight!: Promise<CompanionUpdateStatus>
    act(() => {
      inFlight = result.current.check(true)
    })
    unmount()
    resolveCheck(AVAILABLE_VERDICT)
    await expect(inFlight).resolves.toEqual(AVAILABLE_VERDICT)
    // No assertion on result.current after unmount is meaningful, but reaching
    // here without an act()-outside-of-test-warning proves the mounted guard held.
  })
})

describe('useCompanionUpdate — passive push subscription (§6.5)', () => {
  it('adopts a pushed update-available verdict without calling check()', () => {
    const { result } = renderHook(() => useCompanionUpdate())
    expect(result.current.verdict).toBeNull()

    act(() => {
      emitCompanionUpdateAvailable(AVAILABLE_VERDICT)
    })

    expect(result.current.verdict).toEqual(AVAILABLE_VERDICT)
    expect(bridge().checkCompanionUpdate).not.toHaveBeenCalled()
  })

  it('unsubscribes on unmount — a later emit does not touch the unmounted hook', () => {
    const { result, unmount } = renderHook(() => useCompanionUpdate())
    unmount()
    expect(() => emitCompanionUpdateAvailable(AVAILABLE_VERDICT)).not.toThrow()
    expect(result.current.verdict).toBeNull()
  })
})

describe('useCompanionUpdate — dismissedVersion (localStorage seen-marker)', () => {
  it('starts null with nothing persisted', () => {
    const { result } = renderHook(() => useCompanionUpdate())
    expect(result.current.dismissedVersion).toBeNull()
  })

  it('dismiss() persists to localStorage and updates state', () => {
    const { result } = renderHook(() => useCompanionUpdate())
    act(() => {
      result.current.dismiss('0.5.0')
    })
    expect(result.current.dismissedVersion).toBe('0.5.0')
    expect(window.localStorage.getItem('tachles.companionUpdate.dismissedVersion')).toBe('0.5.0')
  })

  it('a fresh hook instance reads a previously persisted dismissal', () => {
    window.localStorage.setItem('tachles.companionUpdate.dismissedVersion', '0.4.9')
    const { result } = renderHook(() => useCompanionUpdate())
    expect(result.current.dismissedVersion).toBe('0.4.9')
  })
})

// ---------------------------------------------------------------------------
// The CONSENTED actions (§7). Same division of labour as the check: main does
// the work and owns every operand, the hook owns only what the screen shows.
// ---------------------------------------------------------------------------

describe('useCompanionUpdate — download progress subscription', () => {
  it('mirrors a progress frame, keeping totalBytes:null as the indeterminate fact it is', () => {
    const { result } = renderHook(() => useCompanionUpdate())

    act(() => {
      emitCompanionDownloadProgress({ receivedBytes: 4096, totalBytes: null, phase: 'downloading' })
    })

    expect(result.current.phase).toBe('downloading')
    expect(result.current.receivedBytes).toBe(4096)
    expect(result.current.totalBytes).toBeNull()
  })

  it('maps the verifying frame to its own phase (still one continuous operation)', () => {
    const { result } = renderHook(() => useCompanionUpdate())
    act(() => {
      emitCompanionDownloadProgress({ receivedBytes: 100, totalBytes: 100, phase: 'verifying' })
    })
    expect(result.current.phase).toBe('verifying')
  })

  it('unsubscribes on unmount — a later frame does not touch the unmounted hook', () => {
    const { result, unmount } = renderHook(() => useCompanionUpdate())
    unmount()
    expect(() =>
      emitCompanionDownloadProgress({ receivedBytes: 1, totalBytes: 2, phase: 'downloading' })
    ).not.toThrow()
    expect(result.current.phase).toBe('idle')
  })
})

describe('useCompanionUpdate — the durable state read on mount', () => {
  it('restores a verified-but-unapplied download as a resumable ready offer', async () => {
    stubBridge({
      companionUpdateState: async () => ({ phase: 'ready', targetVersion: '0.5.0', currentVersion: '0.4.0' })
    })
    const { result } = renderHook(() => useCompanionUpdate())

    await act(async () => {
      await Promise.resolve()
    })

    expect(bridge().companionUpdateState).toHaveBeenCalledWith()
    expect(result.current.phase).toBe('ready')
    expect(result.current.targetVersion).toBe('0.5.0')
  })

  it('never adopts a stale downloading record — nothing of OURS is in flight at mount', async () => {
    stubBridge({
      companionUpdateState: async () => ({ phase: 'downloading', targetVersion: '0.5.0', currentVersion: '0.4.0' })
    })
    const { result } = renderHook(() => useCompanionUpdate())

    await act(async () => {
      await Promise.resolve()
    })

    expect(result.current.phase).toBe('idle')
  })

  it('surfaces an unconfirmed apply as an acknowledgeable notice, not as progress', async () => {
    stubBridge({
      companionUpdateState: async () => ({ phase: 'applying', targetVersion: '0.5.0', currentVersion: '0.5.0' })
    })
    const { result } = renderHook(() => useCompanionUpdate())

    await act(async () => {
      await Promise.resolve()
    })

    expect(result.current.phase).toBe('idle')
    expect(result.current.stuckApply).toEqual({
      targetVersion: '0.5.0',
      currentVersion: '0.5.0',
      reachedTarget: true
    })

    act(() => {
      result.current.acknowledgeStuckApply()
    })
    expect(result.current.stuckApply).toBeNull()
    expect(window.localStorage.getItem('tachles.companionUpdate.acknowledgedApply')).toBe('0.5.0@0.5.0')
  })
})

describe('useCompanionUpdate — download / cancel / apply', () => {
  it('takes NO arguments into main and lands on ready with the version main reports', async () => {
    stubBridge({
      downloadCompanionUpdate: async () => ({
        ok: true,
        version: '0.5.0',
        bytes: 1024,
        sha256: 'b'.repeat(64)
      })
    })
    const { result } = renderHook(() => useCompanionUpdate())

    await act(async () => {
      await result.current.download()
    })

    expect(bridge().downloadCompanionUpdate).toHaveBeenCalledWith()
    expect(result.current.phase).toBe('ready')
    expect(result.current.targetVersion).toBe('0.5.0')
    expect(result.current.error).toBeNull()
  })

  it('keeps main’s failure message verbatim and returns to idle (nothing was changed)', async () => {
    stubBridge({
      downloadCompanionUpdate: async () => ({
        ok: false,
        code: 'installer-fetch-failed',
        message: 'לא ניתן להוריד את קובץ ההתקנה. לא בוצע שינוי.'
      })
    })
    const { result } = renderHook(() => useCompanionUpdate())

    await act(async () => {
      await result.current.download()
    })

    expect(result.current.phase).toBe('idle')
    expect(result.current.error).toBe('לא ניתן להוריד את קובץ ההתקנה. לא בוצע שינוי.')
    expect(result.current.errorCode).toBe('installer-fetch-failed')
  })

  it('reports an unavailable bridge as a failure that changed nothing, never as a silent success', async () => {
    // The bridge double's default for this method REJECTS (it is a side-effecting
    // call with no safe default) — the same shape a missing preload produces.
    const { result } = renderHook(() => useCompanionUpdate())

    await act(async () => {
      await result.current.download()
    })

    expect(result.current.phase).toBe('idle')
    expect(result.current.errorCode).toBe('bridge-unavailable')
    expect(result.current.error).toContain('לא בוצע שינוי')
  })

  it('cancel asks main to abort the one in-flight download and writes no state of its own', async () => {
    stubBridge({ cancelCompanionDownload: async () => ({ ok: true, cancelled: true }) })
    const { result } = renderHook(() => useCompanionUpdate())

    await act(async () => {
      await result.current.cancel()
    })

    expect(bridge().cancelCompanionDownload).toHaveBeenCalledWith()
    // The download() promise is the single writer of the outcome, so cancel()
    // itself leaves the phase alone.
    expect(result.current.phase).toBe('idle')
  })

  it('treats a RESOLVED apply as the refusal it is, then re-reads what main still holds', async () => {
    stubBridge({
      companionUpdateState: async () => ({ phase: 'ready', targetVersion: '0.5.0', currentVersion: '0.4.0' }),
      applyCompanionUpdate: async () => ({ ok: false, code: 'not-ready', message: 'אין עדכון מאומת שמוכן להתקנה.' })
    })
    const { result } = renderHook(() => useCompanionUpdate())

    await act(async () => {
      await result.current.apply()
    })

    expect(bridge().applyCompanionUpdate).toHaveBeenCalledWith()
    expect(result.current.error).toBe('אין עדכון מאומת שמוכן להתקנה.')
    // Re-synced from main rather than guessed: the verified download is still there.
    expect(result.current.phase).toBe('ready')
  })
})
