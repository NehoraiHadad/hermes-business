// @vitest-environment jsdom
import '../../test/setup-dom'
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PartnerFeedPanel } from './PartnerFeedPanel'
import type { PartnerFeed, PartnerFeedItem } from '../../lib/partner-feed'

// docs/specs/partner-feed.md §6.3 — the five fail-closed states — plus the CTA
// wiring and the unknown-status tag §11 stage-4 acceptance calls out by name. The
// component consumes an already-derived PartnerFeed (never a raw snapshot), so
// these tests build that shape directly rather than going through
// derivePartnerFeed — src/lib/partner-feed.test.ts already covers the derivation.

function noop(): Promise<void> {
  return Promise.resolve()
}

function item(overrides: Partial<PartnerFeedItem> = {}): PartnerFeedItem {
  return {
    id: 'item-1',
    kind: 'task-run',
    at: Date.now() - 60_000,
    title: 'המשימה ‘סיכום שבועי’ רצה',
    status: 'ok',
    ...overrides
  }
}

function feed(overrides: Partial<PartnerFeed> = {}): PartnerFeed {
  return {
    items: [],
    degraded: { cron: false, sessions: false, curator: false },
    available: true,
    ...overrides
  }
}

describe('PartnerFeedPanel — §6.3 states', () => {
  it('loading: no snapshot yet renders role=status and never a fabricated list', () => {
    render(<PartnerFeedPanel feed={null} loading onRefresh={noop} onOpenSession={vi.fn()} onAddTask={vi.fn()} />)
    expect(screen.getByRole('status')).toHaveTextContent('טוען את פעילות השותף')
    expect(screen.queryByText(/לא הצלחנו/)).not.toBeInTheDocument()
  })

  it('available:false renders the honest error state, NEVER "אין פעילות"', () => {
    render(
      <PartnerFeedPanel
        feed={feed({ available: false, degraded: { cron: true, sessions: true, curator: true } })}
        loading={false}
        onRefresh={noop}
        onOpenSession={vi.fn()}
        onAddTask={vi.fn()}
      />
    )
    expect(screen.getByText('לא הצלחנו לקרוא את פעילות השותף')).toBeInTheDocument()
    expect(screen.queryByText('אין פעילות')).not.toBeInTheDocument()
  })

  it('available:true with zero items renders the proven-empty state with an add-task CTA', async () => {
    const user = userEvent.setup()
    const onAddTask = vi.fn()
    render(<PartnerFeedPanel feed={feed({ items: [] })} loading={false} onRefresh={noop} onOpenSession={vi.fn()} onAddTask={onAddTask} />)
    expect(screen.getByText('עוד לא נרשמה פעילות ברקע')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /משימה חדשה/ }))
    expect(onAddTask).toHaveBeenCalledTimes(1)
  })

  // A2 fix: an empty-but-degraded read must not look like a clean "אין פעילות" —
  // the degraded-sources warning was previously rendered only inside the
  // non-empty branch and silently disappeared for this exact combination.
  it('A2: partial degradation with zero items shows BOTH the empty-state copy and the degraded warning', () => {
    render(
      <PartnerFeedPanel
        feed={feed({ items: [], degraded: { cron: true, sessions: false, curator: false } })}
        loading={false}
        onRefresh={noop}
        onOpenSession={vi.fn()}
        onAddTask={vi.fn()}
      />
    )
    expect(screen.getByText('עוד לא נרשמה פעילות ברקע')).toBeInTheDocument()
    expect(screen.getByText(/חלק מהנתונים לא נקראו הפעם/)).toBeInTheDocument()
    expect(screen.getByText(/ריצות משימות מתוזמנות/)).toBeInTheDocument()
  })

  it('partial degradation: items still render, plus a muted warning naming the failed source', () => {
    render(
      <PartnerFeedPanel
        feed={feed({ items: [item()], degraded: { cron: true, sessions: false, curator: false } })}
        loading={false}
        onRefresh={noop}
        onOpenSession={vi.fn()}
        onAddTask={vi.fn()}
      />
    )
    expect(screen.getByText(/חלק מהנתונים לא נקראו הפעם/)).toBeInTheDocument()
    expect(screen.getByText(/ריצות משימות מתוזמנות/)).toBeInTheDocument()
    expect(screen.getByText(item().title)).toBeInTheDocument()
  })

  it('an item with status:"unknown" always shows the "תוצאה לא ידועה" tag — never hidden, never a fabricated success', () => {
    render(
      <PartnerFeedPanel
        feed={feed({ items: [item({ id: 'unknown-run', status: 'unknown' })] })}
        loading={false}
        onRefresh={noop}
        onOpenSession={vi.fn()}
        onAddTask={vi.fn()}
      />
    )
    expect(screen.getByText('תוצאה לא ידועה')).toBeInTheDocument()
  })
})

describe('PartnerFeedPanel — item rendering', () => {
  it('an ok task-run shows a success tag, not "תוצאה לא ידועה"', () => {
    render(
      <PartnerFeedPanel
        feed={feed({ items: [item({ status: 'ok' })] })}
        loading={false}
        onRefresh={noop}
        onOpenSession={vi.fn()}
        onAddTask={vi.fn()}
      />
    )
    expect(screen.queryByText('תוצאה לא ידועה')).not.toBeInTheDocument()
  })

  it('an error task-run shows the failure tag', () => {
    render(
      <PartnerFeedPanel
        feed={feed({ items: [item({ status: 'error' })] })}
        loading={false}
        onRefresh={noop}
        onOpenSession={vi.fn()}
        onAddTask={vi.fn()}
      />
    )
    expect(screen.getByText('נכשלה')).toBeInTheDocument()
  })

  it('a background-session / curator item never shows a status tag, even though status is fixed to "ok"', () => {
    render(
      <PartnerFeedPanel
        feed={feed({
          items: [
            item({ id: 'bg', kind: 'background-session', sourceLabel: 'טלגרם', title: 'שיחה חדשה מטלגרם', status: 'ok' }),
            item({ id: 'cur', kind: 'curator', title: 'העוזר סקר וסידר את הידע שלו', status: 'ok' })
          ]
        })}
        loading={false}
        onRefresh={noop}
        onOpenSession={vi.fn()}
        onAddTask={vi.fn()}
      />
    )
    expect(screen.queryByText('הצליחה')).not.toBeInTheDocument()
  })

  it('an item with no sessionId (curator) renders no CTA button', () => {
    render(
      <PartnerFeedPanel
        feed={feed({ items: [item({ id: 'cur', kind: 'curator', title: 'העוזר סקר וסידר את הידע שלו', status: 'ok' })] })}
        loading={false}
        onRefresh={noop}
        onOpenSession={vi.fn()}
        onAddTask={vi.fn()}
      />
    )
    expect(screen.queryByRole('button', { name: 'פתח את השיחה' })).not.toBeInTheDocument()
  })
})

describe('PartnerFeedPanel — CTA and refresh wiring', () => {
  it('clicking "פתח את השיחה" calls onOpenSession with the item\'s sessionId', async () => {
    const user = userEvent.setup()
    const onOpenSession = vi.fn()
    render(
      <PartnerFeedPanel
        feed={feed({ items: [item({ sessionId: 'cron_job-1_1730000000' })] })}
        loading={false}
        onRefresh={noop}
        onOpenSession={onOpenSession}
        onAddTask={vi.fn()}
      />
    )
    await user.click(screen.getByRole('button', { name: 'פתח את השיחה' }))
    expect(onOpenSession).toHaveBeenCalledWith('cron_job-1_1730000000')
  })

  it('the refresh button calls onRefresh and is disabled while loading', async () => {
    const user = userEvent.setup()
    const onRefresh = vi.fn(noop)
    const { rerender } = render(
      <PartnerFeedPanel feed={feed({ items: [item()] })} loading={false} onRefresh={onRefresh} onOpenSession={vi.fn()} onAddTask={vi.fn()} />
    )
    await user.click(screen.getByRole('button', { name: /רענון/ }))
    expect(onRefresh).toHaveBeenCalledTimes(1)

    rerender(
      <PartnerFeedPanel feed={feed({ items: [item()] })} loading onRefresh={onRefresh} onOpenSession={vi.fn()} onAddTask={vi.fn()} />
    )
    expect(screen.getByRole('button', { name: /רענון/ })).toBeDisabled()
  })
})
