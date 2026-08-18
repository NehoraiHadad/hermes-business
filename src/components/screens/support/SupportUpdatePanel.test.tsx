// @vitest-environment jsdom
import '../../../test/setup-dom'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { SupportUpdatePanel } from './SupportUpdatePanel'
import {
  bridge,
  emitCompanionDownloadProgress,
  emitCompanionUpdateAvailable,
  stubBridge
} from '../../../test/hermes-bridge'
import type { HermesUpdateStatus } from '../../../lib/hermes-client'

// docs/specs/versioning.md §7.1 — the five display states, the offline path,
// and the fail-closed "never fabricate מעודכן" guarantee that closes the §1.4
// doctrine violation this panel used to commit (hardcoded 'מעודכן' + '0.1.0').

function baseProps(overrides: Partial<Parameters<typeof SupportUpdatePanel>[0]> = {}) {
  return {
    runtime: null as HermesRuntime | null,
    versions: {} as Record<string, string>,
    updateStatus: null as HermesUpdateStatus | null,
    updating: false,
    onCheck: vi.fn(),
    onApply: vi.fn(),
    ...overrides
  }
}

function companionRow() {
  // The second .version-row is the תכל'ס (companion) row — the first is Hermes Agent.
  return document.querySelectorAll('.version-row')[1] as HTMLElement
}

describe('SupportUpdatePanel — shell version display (no fabricated fallback)', () => {
  it('shows an em dash when the bridge has not answered versions.shell — never a fake "0.1.0"', () => {
    render(<SupportUpdatePanel {...baseProps({ versions: {} })} />)
    expect(companionRow().textContent).toContain('—')
    expect(companionRow().textContent).not.toContain('0.1.0')
  })

  it('shows the real shell version wrapped LTR when present', () => {
    render(<SupportUpdatePanel {...baseProps({ versions: { shell: '0.4.0-alpha.1' } })} />)
    const bdi = companionRow().querySelector('bdi')
    expect(bdi).toHaveTextContent('0.4.0-alpha.1')
    expect(bdi).toHaveAttribute('dir', 'ltr')
  })
})

describe('SupportUpdatePanel — companion status tag: five §7.1 states', () => {
  it('"לא נבדק" before any check has run (default)', () => {
    render(<SupportUpdatePanel {...baseProps()} />)
    expect(companionRow()).toHaveTextContent('לא נבדק')
  })

  it('"יש עדכון" after an update-available verdict', async () => {
    stubBridge({
      checkCompanionUpdate: async () => ({
        status: 'update-available',
        current: '0.4.0',
        latest: '0.5.0',
        checkedAt: 1000,
        downloadUrl: 'https://github.com/NehoraiHadad/hermes-business/releases/tag/v0.5.0'
      })
    })
    const user = userEvent.setup()
    render(<SupportUpdatePanel {...baseProps()} />)
    await user.click(screen.getByRole('button', { name: 'בדוק עדכון' }))
    expect(await screen.findByText('יש עדכון')).toBeInTheDocument()
  })

  it('"מעודכן" ONLY after a real up-to-date verdict — never rendered without it', async () => {
    stubBridge({ checkCompanionUpdate: async () => ({ status: 'up-to-date', current: '0.4.0', checkedAt: 1000 }) })
    render(<SupportUpdatePanel {...baseProps()} />)
    // Before checking: must not claim "מעודכן" (the exact doctrine violation being fixed).
    expect(companionRow()).not.toHaveTextContent('מעודכן')
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'בדוק עדכון' }))
    expect(await screen.findByText('מעודכן', { selector: '.version-row .up-to-date' })).toBeInTheDocument()
  })

  it('"גרסה מקומית חדשה מהפורסם" after a dev-ahead verdict', async () => {
    stubBridge({ checkCompanionUpdate: async () => ({ status: 'dev-ahead', current: '9.0.0', checkedAt: 1000 }) })
    const user = userEvent.setup()
    render(<SupportUpdatePanel {...baseProps()} />)
    await user.click(screen.getByRole('button', { name: 'בדוק עדכון' }))
    expect(await screen.findByText('גרסה מקומית חדשה מהפורסם')).toBeInTheDocument()
  })

  it('"לא ידוע" after an unknown verdict, plus the honest "no change made" note (offline path)', async () => {
    stubBridge({
      checkCompanionUpdate: async () => ({
        status: 'unknown',
        current: '0.4.0',
        checkedAt: null,
        message: 'לא ניתן לבדוק עדכונים כרגע'
      })
    })
    const user = userEvent.setup()
    render(<SupportUpdatePanel {...baseProps()} />)
    await user.click(screen.getByRole('button', { name: 'בדוק עדכון' }))
    expect(await screen.findByText('לא ידוע')).toBeInTheDocument()
    expect(screen.getByText('לא ניתן לבדוק עדכונים כרגע. לא בוצע שינוי.')).toBeInTheDocument()
  })
})

describe('SupportUpdatePanel — update-available block', () => {
  it('shows latest version, published date, plain-text notes, and the fixed advisory copy', async () => {
    stubBridge({
      checkCompanionUpdate: async () => ({
        status: 'update-available',
        current: '0.4.0',
        latest: '0.5.0',
        checkedAt: 1000,
        releaseName: "תכל'ס 0.5.0",
        notes: 'תוקנה תקלה קטנה.',
        downloadUrl: 'https://github.com/NehoraiHadad/hermes-business/releases/tag/v0.5.0',
        publishedAt: '2026-01-15T00:00:00Z'
      })
    })
    const user = userEvent.setup()
    render(<SupportUpdatePanel {...baseProps()} />)
    await user.click(screen.getByRole('button', { name: 'בדוק עדכון' }))

    expect(await screen.findByText(/0\.5\.0/)).toBeInTheDocument()
    expect(screen.getByText('תוקנה תקלה קטנה.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /פתח דף הורדה/ })).toBeInTheDocument()
    expect(screen.getByText(/הקובץ אינו חתום/)).toBeInTheDocument()
    expect(screen.getByText(/SHA256SUMS\.txt/)).toBeInTheDocument()
    expect(screen.getByText(/סגרו את תכל'ס לפני הרצת ההתקנה/)).toBeInTheDocument()
  })

  it('opens the download URL via the openExternal facade on click', async () => {
    stubBridge({
      checkCompanionUpdate: async () => ({
        status: 'update-available',
        current: '0.4.0',
        latest: '0.5.0',
        checkedAt: 1000,
        downloadUrl: 'https://github.com/NehoraiHadad/hermes-business/releases/tag/v0.5.0'
      }),
      openExternal: async () => undefined
    })
    const user = userEvent.setup()
    render(<SupportUpdatePanel {...baseProps()} />)
    await user.click(screen.getByRole('button', { name: 'בדוק עדכון' }))
    const openButton = await screen.findByRole('button', { name: /פתח דף הורדה/ })
    await user.click(openButton)
    expect(bridge().openExternal).toHaveBeenCalledWith('https://github.com/NehoraiHadad/hermes-business/releases/tag/v0.5.0')
  })

  it('omits the download button and shows a manual pointer when downloadUrl is absent', async () => {
    stubBridge({
      checkCompanionUpdate: async () => ({
        status: 'update-available',
        current: '0.4.0',
        latest: '0.5.0',
        checkedAt: 1000
      })
    })
    const user = userEvent.setup()
    render(<SupportUpdatePanel {...baseProps()} />)
    await user.click(screen.getByRole('button', { name: 'בדוק עדכון' }))
    await screen.findByText('יש עדכון')
    expect(screen.queryByRole('button', { name: /פתח דף הורדה/ })).not.toBeInTheDocument()
    expect(screen.getByText(/דף ה־Releases/)).toBeInTheDocument()
  })
})

describe('SupportUpdatePanel — one button checks both Hermes AND the companion', () => {
  it('calls onCheck (Hermes) and the companion check on the same click', async () => {
    const onCheck = vi.fn()
    stubBridge({ checkCompanionUpdate: async () => ({ status: 'up-to-date', current: '0.4.0', checkedAt: 1000 }) })
    const user = userEvent.setup()
    render(<SupportUpdatePanel {...baseProps({ onCheck })} />)
    await user.click(screen.getByRole('button', { name: 'בדוק עדכון' }))
    expect(onCheck).toHaveBeenCalledTimes(1)
    expect(bridge().checkCompanionUpdate).toHaveBeenCalledWith(true)
  })
})

// ---------------------------------------------------------------------------
// Consent-based one-click update (docs/specs/versioning.md §7). Every action the
// panel can take is a NO-ARGUMENT call into main — these tests assert exactly
// that (`toHaveBeenCalledWith()`), because "the renderer names nothing" is the
// property that makes a compromised renderer unable to redirect a download or
// choose which file gets executed.
// ---------------------------------------------------------------------------

const MANAGED_VERDICT: CompanionUpdateStatus = {
  status: 'update-available',
  current: '0.4.0',
  latest: '0.5.0',
  checkedAt: 1000,
  managedUpdate: true,
  installerUrl: 'https://github.com/NehoraiHadad/hermes-business/releases/download/v0.5.0/Tachles-Setup-0.5.0.exe',
  manifestUrl: 'https://github.com/NehoraiHadad/hermes-business/releases/download/v0.5.0/update-manifest.json',
  downloadUrl: 'https://github.com/NehoraiHadad/hermes-business/releases/tag/v0.5.0'
}

const UNMANAGED_VERDICT: CompanionUpdateStatus = {
  status: 'update-available',
  current: '0.4.0',
  latest: '0.5.0',
  checkedAt: 1000,
  managedUpdate: false,
  managedUpdateReason: 'manifest-asset-absent',
  downloadUrl: 'https://github.com/NehoraiHadad/hermes-business/releases/tag/v0.5.0'
}

const MB = 1024 * 1024

/** A promise the test resolves by hand, so an in-flight action can be observed mid-flight. */
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(r => {
    resolve = r
  })
  return { promise, resolve }
}

describe('SupportUpdatePanel — managed update: idle → downloading → ready → applying', () => {
  it('walks the whole consented flow, asking main for each step with no arguments at all', async () => {
    const download = deferred<CompanionDownloadResult>()
    const apply = deferred<CompanionApplyRefusal>()
    stubBridge({
      downloadCompanionUpdate: async () => download.promise,
      applyCompanionUpdate: async () => apply.promise
    })
    const user = userEvent.setup()
    render(<SupportUpdatePanel {...baseProps()} />)

    // The passive push is a real path to a verdict (§6.5) — no click needed.
    act(() => {
      emitCompanionUpdateAvailable(MANAGED_VERDICT)
    })
    expect(await screen.findByText(/אפשר לעדכן ישירות מכאן/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /עדכן עכשיו/ }))
    expect(bridge().downloadCompanionUpdate).toHaveBeenCalledWith()

    act(() => {
      emitCompanionDownloadProgress({ receivedBytes: 21 * MB, totalBytes: 84 * MB, phase: 'downloading' })
    })
    const bar = screen.getByRole('progressbar')
    expect(bar).toHaveAttribute('aria-valuenow', '25')
    expect(bar).toHaveAttribute('aria-valuemin', '0')
    expect(bar).toHaveAttribute('aria-valuemax', '100')
    // Text alternative — never colour/width alone.
    expect(screen.getByText('הורדו 21 MB מתוך 84 MB (25%)')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /בטלו את ההורדה/ })).toBeInTheDocument()

    act(() => {
      emitCompanionDownloadProgress({ receivedBytes: 84 * MB, totalBytes: 84 * MB, phase: 'verifying' })
    })
    expect(screen.getByText('בודקים שקובץ ההתקנה תקין…')).toBeInTheDocument()

    await act(async () => {
      download.resolve({ ok: true, version: '0.5.0', bytes: 84 * MB, sha256: 'a'.repeat(64) })
      await download.promise
    })

    // Nothing is applied automatically: the install is a SECOND, separate consent.
    expect(bridge().applyCompanionUpdate).not.toHaveBeenCalled()
    const applyButton = await screen.findByRole('button', { name: /התקן והפעל מחדש/ })
    expect(screen.getByText(/ירדה ואומתה/)).toBeInTheDocument()
    expect(screen.getByText(/תכל'ס ייסגר, ההתקנה תרוץ ברקע, והאפליקציה תעלה מחדש/)).toBeInTheDocument()
    expect(screen.getByText(/העוזר לא יענה להודעות/)).toBeInTheDocument()

    await user.click(applyButton)
    expect(bridge().applyCompanionUpdate).toHaveBeenCalledWith()
    // On a REAL success this process is already gone, so the applying state is
    // the last thing this panel ever shows.
    const applyingButton = screen.getByRole('button', { name: /מתקינים…/ })
    expect(applyingButton).toBeDisabled()
    expect(applyingButton).toHaveAttribute('aria-busy', 'true')
  })

  it('goes INDETERMINATE when the download carries no total — never a fabricated denominator', async () => {
    const download = deferred<CompanionDownloadResult>()
    stubBridge({ downloadCompanionUpdate: async () => download.promise })
    const user = userEvent.setup()
    render(<SupportUpdatePanel {...baseProps()} />)
    act(() => {
      emitCompanionUpdateAvailable(MANAGED_VERDICT)
    })

    await user.click(await screen.findByRole('button', { name: /עדכן עכשיו/ }))
    act(() => {
      emitCompanionDownloadProgress({ receivedBytes: 3 * MB, totalBytes: null, phase: 'downloading' })
    })

    const bar = screen.getByRole('progressbar')
    expect(bar).not.toHaveAttribute('aria-valuenow')
    expect(bar).not.toHaveAttribute('aria-valuemax')
    expect(bar).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByText('הורדו 3 MB — גודל הקובץ אינו ידוע מראש')).toBeInTheDocument()
    expect(screen.queryByText(/%/)).not.toBeInTheDocument()
  })

  it('cancels mid-download and reports the outcome in main’s own words', async () => {
    const download = deferred<CompanionDownloadResult>()
    stubBridge({
      downloadCompanionUpdate: async () => download.promise,
      cancelCompanionDownload: async () => ({ ok: true, cancelled: true })
    })
    const user = userEvent.setup()
    render(<SupportUpdatePanel {...baseProps()} />)
    act(() => {
      emitCompanionUpdateAvailable(MANAGED_VERDICT)
    })

    await user.click(await screen.findByRole('button', { name: /עדכן עכשיו/ }))
    act(() => {
      emitCompanionDownloadProgress({ receivedBytes: 1024, totalBytes: 4096, phase: 'downloading' })
    })
    await user.click(screen.getByRole('button', { name: /בטלו את ההורדה/ }))
    expect(bridge().cancelCompanionDownload).toHaveBeenCalledWith()

    // The cancel lands as the download's OWN outcome — one writer, one story.
    await act(async () => {
      download.resolve({ ok: false, code: 'cancelled', message: 'ההורדה בוטלה. לא בוצע שינוי.' })
      await download.promise
    })
    expect(await screen.findByText('ההורדה בוטלה. לא בוצע שינוי.')).toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /עדכן עכשיו/ })).toBeInTheDocument()
  })
})

describe('SupportUpdatePanel — failure paths keep the manual route open', () => {
  it('renders the main-process failure message VERBATIM and still offers the download page', async () => {
    stubBridge({
      downloadCompanionUpdate: async () => ({
        ok: false,
        code: 'installer-digest-mismatch',
        message: 'קובץ ההתקנה שהתקבל אינו תואם לחתימה — הקובץ נמחק. לא בוצע שינוי.'
      }),
      openExternal: async () => undefined
    })
    const user = userEvent.setup()
    render(<SupportUpdatePanel {...baseProps()} />)
    act(() => {
      emitCompanionUpdateAvailable(MANAGED_VERDICT)
    })

    await user.click(await screen.findByRole('button', { name: /עדכן עכשיו/ }))

    expect(
      await screen.findByText('קובץ ההתקנה שהתקבל אינו תואם לחתימה — הקובץ נמחק. לא בוצע שינוי.')
    ).toBeInTheDocument()
    // The manual fallback is reachable after a failed managed attempt.
    await user.click(screen.getByRole('button', { name: /פתח דף הורדה/ }))
    expect(bridge().openExternal).toHaveBeenCalledWith(MANAGED_VERDICT.downloadUrl)
  })

  it('surfaces a REFUSED apply — the only way applyCompanionUpdate ever resolves', async () => {
    stubBridge({
      companionUpdateState: async () => ({ phase: 'ready', targetVersion: '0.5.0', currentVersion: '0.4.0' }),
      applyCompanionUpdate: async () => ({
        ok: false,
        code: 'not-ready',
        message: 'אין עדכון מאומת שמוכן להתקנה.'
      })
    })
    const user = userEvent.setup()
    render(<SupportUpdatePanel {...baseProps()} />)

    await user.click(await screen.findByRole('button', { name: /התקן והפעל מחדש/ }))
    expect(await screen.findByText('אין עדכון מאומת שמוכן להתקנה.')).toBeInTheDocument()
  })
})

describe('SupportUpdatePanel — a release with no managed path (honest, not an error)', () => {
  it('offers only the manual download and never the one-click button', async () => {
    render(<SupportUpdatePanel {...baseProps()} />)
    act(() => {
      emitCompanionUpdateAvailable(UNMANAGED_VERDICT)
    })

    expect(await screen.findByText(/את הגרסה הזו לא ניתן לעדכן מתוך תכל'ס/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /פתח דף הורדה/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /עדכן עכשיו/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /התקן והפעל מחדש/ })).not.toBeInTheDocument()
    expect(bridge().downloadCompanionUpdate).not.toHaveBeenCalled()
  })
})

describe('SupportUpdatePanel — a download verified in a PREVIOUS session', () => {
  const READY_STATE: CompanionUpdateJournalState = {
    phase: 'ready',
    targetVersion: '0.5.0',
    currentVersion: '0.4.0'
  }

  it('comes back as a resumable install offer, without re-downloading anything', async () => {
    stubBridge({ companionUpdateState: async () => READY_STATE })
    render(<SupportUpdatePanel {...baseProps({ versions: { shell: '0.4.0' } })} />)

    expect(await screen.findByRole('button', { name: /התקן והפעל מחדש/ })).toBeInTheDocument()
    expect(screen.getByText(/ירדה ואומתה/)).toBeInTheDocument()
    expect(bridge().downloadCompanionUpdate).not.toHaveBeenCalled()
  })

  // §1.4 regression guard, restated for the resumable path: a waiting download
  // proves a FILE was verified — never anything about how current the running
  // version is. No check ran here, so the row must still say 'לא נבדק'.
  it('never turns a resumable offer into a fabricated "מעודכן" or version claim', async () => {
    stubBridge({ companionUpdateState: async () => READY_STATE })
    render(<SupportUpdatePanel {...baseProps({ versions: {} })} />)

    await screen.findByRole('button', { name: /התקן והפעל מחדש/ })
    expect(companionRow()).toHaveTextContent('לא נבדק')
    expect(companionRow()).not.toHaveTextContent('מעודכן')
    expect(companionRow().textContent).toContain('—')
    expect(companionRow().textContent).not.toContain('0.1.0')
  })
})

describe('SupportUpdatePanel — an install that was launched and never confirmed', () => {
  const STUCK_STATE: CompanionUpdateJournalState = {
    phase: 'applying',
    targetVersion: '0.5.0',
    currentVersion: '0.5.0'
  }

  it('says so plainly, and can be acknowledged so it is not an un-dismissable nag', async () => {
    stubBridge({ companionUpdateState: async () => STUCK_STATE })
    const user = userEvent.setup()
    render(<SupportUpdatePanel {...baseProps()} />)

    expect(await screen.findByText(/לא הצלחנו לוודא שהכול חזר/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /הבנתי, אפשר להסתיר/ }))
    expect(screen.queryByText(/לא הצלחנו לוודא שהכול חזר/)).not.toBeInTheDocument()
    // Acknowledged in the RENDERER only — there is no IPC (and must be none) to
    // delete main's record of an unresolved install.
    expect(window.localStorage.getItem('tachles.companionUpdate.acknowledgedApply')).toBe('0.5.0@0.5.0')
  })

  it('stays acknowledged across a remount, and still claims nothing about the version', async () => {
    window.localStorage.setItem('tachles.companionUpdate.acknowledgedApply', '0.5.0@0.5.0')
    stubBridge({ companionUpdateState: async () => STUCK_STATE })
    render(<SupportUpdatePanel {...baseProps()} />)

    await act(async () => {
      await Promise.resolve()
    })
    expect(screen.queryByText(/לא הצלחנו לוודא/)).not.toBeInTheDocument()
    expect(companionRow()).not.toHaveTextContent('מעודכן')
  })

  it('an unresolved install that landed on some THIRD version reports both versions', async () => {
    stubBridge({
      companionUpdateState: async () => ({ phase: 'applying', targetVersion: '0.5.0', currentVersion: '0.4.9' })
    })
    render(<SupportUpdatePanel {...baseProps()} />)

    expect(await screen.findByText(/ולא ידוע אם/)).toBeInTheDocument()
    expect(screen.getByText(/הגרסה שפועלת עכשיו היא/)).toBeInTheDocument()
  })
})
