import { describe, expect, it, vi } from 'vitest'

const { downloadCompanionRollback, ROLLBACK_HISTORY_OUTCOME } = require('./companion-rollback.cjs')

// Fully injected: no Electron, no network, no filesystem. What is asserted here
// is the ORDERING and the OPERANDS — which version the engine is pointed at,
// which direction it is told to move, and what happens to the durable record on
// the way — because those are the only things this module decides.

const PREV = '0.4.0-alpha.8'
const RUNNING = '0.4.0-alpha.9'
const BASE = 'https://github.com/NehoraiHadad/hermes-business/releases/download'

const OFFER = { available: true, target: PREV, from: RUNNING, source: 'history', code: null, message: null }

function harness(overrides: Record<string, unknown> = {}) {
  const calls: string[] = []
  const download = vi.fn(async () => {
    calls.push('download')
    return { ok: true, version: PREV, bytes: 10, sha256: 'a'.repeat(64) }
  })
  const clearJournal = vi.fn(() => {
    calls.push('clearJournal')
    return {}
  })
  return {
    calls,
    download,
    clearJournal,
    deps: {
      log: () => {},
      getVersion: () => RUNNING,
      resolveOffer: () => OFFER,
      fetchReleaseList: async () => ({
        releases: [{ tag_name: `v${PREV}`, assets: [{ name: `Tachles-Setup-${PREV}.exe` }, { name: 'update-manifest.json' }] }],
        truncated: false
      }),
      selectRelease: () => ({ ok: true, release: { tag_name: `v${PREV}` } }),
      selectAssets: () => ({
        ok: true,
        installerUrl: `${BASE}/v${PREV}/Tachles-Setup-${PREV}.exe`,
        manifestUrl: `${BASE}/v${PREV}/update-manifest.json`
      }),
      download,
      clearJournal,
      ...overrides
    }
  }
}

describe('downloadCompanionRollback', () => {
  it("points the ordinary engine at the recorded previous version with direction:'rollback'", async () => {
    const h = harness()
    const result = await downloadCompanionRollback({}, h.deps)
    expect(result.ok).toBe(true)
    expect(result).toMatchObject({ rollback: true, from: RUNNING })
    const [request] = h.download.mock.calls[0]
    expect(request).toMatchObject({
      version: PREV,
      direction: 'rollback',
      installerUrl: `${BASE}/v${PREV}/Tachles-Setup-${PREV}.exe`,
      manifestUrl: `${BASE}/v${PREV}/update-manifest.json`
    })
  })

  it('refuses before any network call when no rollback is on offer', async () => {
    const fetchReleaseList = vi.fn()
    const h = harness({
      resolveOffer: () => ({ available: false, code: 'no-recorded-update', message: 'אין גרסה קודמת', detail: 'x' }),
      fetchReleaseList
    })
    const result = await downloadCompanionRollback({}, h.deps)
    expect(result).toMatchObject({ ok: false, code: 'no-recorded-update' })
    expect(fetchReleaseList).not.toHaveBeenCalled()
    expect(h.download).not.toHaveBeenCalled()
  })

  it('reports an unreachable release feed honestly and downloads nothing', async () => {
    const h = harness({
      fetchReleaseList: async () => {
        throw new Error('ENOTFOUND')
      }
    })
    const result = await downloadCompanionRollback({}, h.deps)
    expect(result).toMatchObject({ ok: false, code: 'releases-unreachable' })
    expect(result.message).toBeTruthy()
    expect(h.download).not.toHaveBeenCalled()
  })

  it('surfaces truncation in the DETAIL without softening the verdict', async () => {
    // "we only read the first page" is a reason the target MIGHT exist elsewhere,
    // never evidence that it does — the user-facing answer stays "not available".
    const h = harness({
      fetchReleaseList: async () => ({ releases: [], truncated: true }),
      selectRelease: () => ({ ok: false, code: 'release-absent', detail: 'not found', message: 'אינה זמינה' })
    })
    const result = await downloadCompanionRollback({}, h.deps)
    expect(result).toMatchObject({ ok: false, code: 'release-absent' })
    expect(result.detail).toContain('truncated')
    expect(h.download).not.toHaveBeenCalled()
  })

  it('refuses a previous release that carries no signed manifest asset', async () => {
    const h = harness({ selectAssets: () => ({ ok: false, code: 'manifest-asset-absent', detail: 'no manifest' }) })
    const result = await downloadCompanionRollback({}, h.deps)
    expect(result).toMatchObject({ ok: false, code: 'manifest-asset-absent' })
    expect(h.download).not.toHaveBeenCalled()
  })

  it('archives an ACTIVE unhealthy record BEFORE the download overwrites it', async () => {
    // Without this the engine's beginCompanionUpdate would clobber the only proof
    // that a previous version ran here; a failed rollback would then clear the
    // journal as `failed`, and the offer would be gone for good — on a broken
    // version, which is the worst possible moment to lose the way back.
    const h = harness({ resolveOffer: () => ({ ...OFFER, source: 'journal' }) })
    await downloadCompanionRollback({}, h.deps)
    expect(h.clearJournal).toHaveBeenCalledWith({ outcome: ROLLBACK_HISTORY_OUTCOME })
    expect(h.calls).toEqual(['clearJournal', 'download'])
  })

  it('does NOT touch the journal when the offer came from history', async () => {
    // Nothing is active in that case, and clearing would archive a second,
    // duplicate anchor for an update that was already archived once.
    const h = harness()
    await downloadCompanionRollback({}, h.deps)
    expect(h.clearJournal).not.toHaveBeenCalled()
  })

  it('proceeds when archiving fails — losing the retry affordance beats stranding the user', async () => {
    const h = harness({
      resolveOffer: () => ({ ...OFFER, source: 'journal' }),
      clearJournal: () => {
        throw new Error('EACCES')
      }
    })
    const result = await downloadCompanionRollback({}, h.deps)
    expect(result.ok).toBe(true)
    expect(h.download).toHaveBeenCalled()
  })

  it("returns the engine's failure verbatim rather than inventing a second account", async () => {
    const failure = { ok: false, code: 'installer-digest-mismatch', message: 'הקובץ שהתקבל אינו תואם', detail: 'x' }
    const h = harness({ download: async () => failure })
    expect(await downloadCompanionRollback({}, h.deps)).toEqual(failure)
  })

  it('drives the engine with the SAME getVersion the offer was decided against', async () => {
    // Found live: the rollback crashed outside Electron because getVersion was
    // not threaded through. The crash was harness-only, but the seam it exposed
    // is real — the engine writes the journal's `currentVersion` from ITS reading
    // of the running version, and that field is exactly what a future rollback
    // offer reads back. Two sources for one value can disagree; there is one.
    const getVersion = () => RUNNING
    const h = harness({ getVersion })
    await downloadCompanionRollback({}, h.deps)
    expect(h.download.mock.calls[0][1].getVersion).toBe(getVersion)
    expect(h.download.mock.calls[0][1].getVersion()).toBe(RUNNING)
  })

  it('forwards the abort signal so a rollback download can be cancelled like any other', async () => {
    const h = harness()
    const controller = new AbortController()
    await downloadCompanionRollback({ signal: controller.signal }, h.deps)
    expect(h.download.mock.calls[0][0].signal).toBe(controller.signal)
  })
})
