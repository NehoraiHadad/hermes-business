// @vitest-environment jsdom
import '../../../test/setup-dom'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { SupportUpdatePanel } from './SupportUpdatePanel'
import { bridge, stubBridge } from '../../../test/hermes-bridge'
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
