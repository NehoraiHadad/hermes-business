import { describe, expect, it } from 'vitest'
import { derivePartnerFeed, type PartnerFeedItem } from './partner-feed'
import type { CuratorInsights } from './hermes/curator'

// Fixed clock so window/sort/cap math is fully deterministic — never Date.now().
const NOW = Date.UTC(2026, 7, 3, 12, 0, 0) // 2026-08-03T12:00:00Z

function isoHoursAgo(hours: number): string {
  return new Date(NOW - hours * 60 * 60 * 1000).toISOString()
}

function secondsHoursAgo(hours: number): number {
  return Math.floor((NOW - hours * 60 * 60 * 1000) / 1000)
}

function job(overrides: Partial<FeedCronJob> = {}): FeedCronJob {
  return {
    id: 'job-1',
    name: 'סיכום שבועי',
    enabled: true,
    schedule_display: 'כל יום שני ב-09:00',
    last_run_at: null,
    last_status: null,
    next_run_at: null,
    isPartnerCheckin: false,
    runs: [],
    ...overrides
  }
}

function run(overrides: Partial<FeedRunRow> = {}): FeedRunRow {
  return {
    id: 'run-1',
    title: null,
    started_at: null,
    ended_at: null,
    message_count: 0,
    is_active: false,
    ...overrides
  }
}

function sessionRow(overrides: Partial<FeedSessionRow> = {}): FeedSessionRow {
  return {
    id: 'session-1',
    source: 'telegram',
    title: null,
    preview: null,
    started_at: null,
    last_active: null,
    message_count: 0,
    ...overrides
  }
}

function snapshot(overrides: Partial<PartnerFeedSnapshot> = {}): PartnerFeedSnapshot {
  return {
    generatedAt: new Date(NOW).toISOString(),
    available: true,
    cron: { ok: true, jobs: [] },
    sessions: { ok: true, rows: [] },
    curator: { ok: true, insights: { available: false, curator: null, learning: null } },
    ...overrides
  }
}

describe('derivePartnerFeed — cron-run status inheritance', () => {
  it('inherits last_status ONLY for the run last_run_at points at; other runs are unknown', () => {
    const lastRunHours = 1
    const theJob = job({
      id: 'checkin-1',
      isPartnerCheckin: true,
      last_run_at: isoHoursAgo(lastRunHours),
      last_status: 'ok',
      runs: [
        run({ id: 'run-last', started_at: secondsHoursAgo(lastRunHours) }),
        run({ id: 'run-older', started_at: secondsHoursAgo(lastRunHours + 5) })
      ]
    })
    const feed = derivePartnerFeed(snapshot({ cron: { ok: true, jobs: [theJob] } }), NOW)
    const byId = new Map(feed.items.map(i => [i.id, i]))
    expect(byId.get('run-last')?.status).toBe('ok')
    expect(byId.get('run-older')?.status).toBe('unknown')
  })

  it('never turns a null last_status into ok, even for the run last_run_at points at', () => {
    const lastRunHours = 2
    const theJob = job({
      id: 'checkin-2',
      isPartnerCheckin: true,
      last_run_at: isoHoursAgo(lastRunHours),
      last_status: null,
      runs: [run({ id: 'run-x', started_at: secondsHoursAgo(lastRunHours) })]
    })
    const feed = derivePartnerFeed(snapshot({ cron: { ok: true, jobs: [theJob] } }), NOW)
    expect(feed.items.find(i => i.id === 'run-x')?.status).toBe('unknown')
  })

  it('maps last_status "error" onto the matching run, unchanged', () => {
    const theJob = job({
      id: 'task-err',
      name: 'סיכום שבועי',
      last_run_at: isoHoursAgo(1),
      last_status: 'error',
      runs: [run({ id: 'run-err', started_at: secondsHoursAgo(1) })]
    })
    const feed = derivePartnerFeed(snapshot({ cron: { ok: true, jobs: [theJob] } }), NOW)
    expect(feed.items.find(i => i.id === 'run-err')?.status).toBe('error')
  })
})

describe('derivePartnerFeed — cron-run titles', () => {
  it('uses the fixed check-in title, never the raw (marker-bearing) job name', () => {
    const theJob = job({
      id: 'checkin-1',
      name: 'צ׳ק־אין שותף עסקי · כל יום ראשון ב-08:00 [hermes-business-partner-checkin:brief:weekly]',
      isPartnerCheckin: true,
      last_run_at: isoHoursAgo(1),
      last_status: 'ok',
      runs: [run({ id: 'r1', started_at: secondsHoursAgo(1) })]
    })
    const feed = derivePartnerFeed(snapshot({ cron: { ok: true, jobs: [theJob] } }), NOW)
    const item = feed.items.find(i => i.id === 'r1')
    expect(item?.title).toBe('השותף ערך בדיקה תקופתית')
    expect(item?.title).not.toContain('hermes-business-partner-checkin')
    expect(item?.kind).toBe('checkin-run')
  })

  it('titles a regular task run with the job name, quoted', () => {
    const theJob = job({
      id: 'task-2',
      name: 'סיכום שבועי',
      isPartnerCheckin: false,
      last_run_at: isoHoursAgo(1),
      last_status: 'ok',
      runs: [run({ id: 'r2', started_at: secondsHoursAgo(1) })]
    })
    const feed = derivePartnerFeed(snapshot({ cron: { ok: true, jobs: [theJob] } }), NOW)
    const item = feed.items.find(i => i.id === 'r2')
    expect(item?.title).toBe(`המשימה ‚סיכום שבועי' רצה`)
    expect(item?.kind).toBe('task-run')
    expect(item?.sessionId).toBe('r2')
    expect(item?.jobId).toBe('task-2')
  })
})

describe('derivePartnerFeed — background-session source labels', () => {
  it('maps telegram to the Hebrew label', () => {
    const feed = derivePartnerFeed(
      snapshot({ sessions: { ok: true, rows: [sessionRow({ id: 's1', source: 'telegram', started_at: secondsHoursAgo(1) })] } }),
      NOW
    )
    const item = feed.items.find(i => i.id === 's1')
    expect(item?.sourceLabel).toBe('טלגרם')
    expect(item?.title).toBe('שיחה חדשה מטלגרם')
    expect(item?.kind).toBe('background-session')
  })

  it('maps whatsapp and whatsapp_cloud to "WhatsApp"', () => {
    const feed = derivePartnerFeed(
      snapshot({
        sessions: {
          ok: true,
          rows: [
            sessionRow({ id: 's2', source: 'whatsapp', started_at: secondsHoursAgo(1) }),
            sessionRow({ id: 's3', source: 'whatsapp_cloud', started_at: secondsHoursAgo(2) })
          ]
        }
      }),
      NOW
    )
    expect(feed.items.find(i => i.id === 's2')?.sourceLabel).toBe('WhatsApp')
    expect(feed.items.find(i => i.id === 's3')?.sourceLabel).toBe('WhatsApp')
  })

  it('falls back to the raw source name for an unrecognized platform', () => {
    const feed = derivePartnerFeed(
      snapshot({ sessions: { ok: true, rows: [sessionRow({ id: 's4', source: 'discord', started_at: secondsHoursAgo(1) })] } }),
      NOW
    )
    const item = feed.items.find(i => i.id === 's4')
    expect(item?.sourceLabel).toBe('discord')
    expect(item?.title).toBe('שיחה חדשה מdiscord')
  })
})

describe('derivePartnerFeed — preview truncation', () => {
  it('truncates a preview over 120 chars to 120 + an ellipsis', () => {
    const longPreview = 'א'.repeat(150)
    const feed = derivePartnerFeed(
      snapshot({ sessions: { ok: true, rows: [sessionRow({ id: 's5', preview: longPreview, started_at: secondsHoursAgo(1) })] } }),
      NOW
    )
    const detail = feed.items.find(i => i.id === 's5')?.detail
    expect(detail).toBe(`${'א'.repeat(120)}…`)
    expect(detail?.length).toBe(121)
  })

  it('leaves a short preview untouched, with no ellipsis', () => {
    const shortPreview = 'תודה על העדכון!'
    const feed = derivePartnerFeed(
      snapshot({ sessions: { ok: true, rows: [sessionRow({ id: 's6', preview: shortPreview, started_at: secondsHoursAgo(1) })] } }),
      NOW
    )
    expect(feed.items.find(i => i.id === 's6')?.detail).toBe(shortPreview)
  })

  it('omits detail entirely when preview is null', () => {
    const feed = derivePartnerFeed(
      snapshot({ sessions: { ok: true, rows: [sessionRow({ id: 's7', preview: null, started_at: secondsHoursAgo(1) })] } }),
      NOW
    )
    expect(feed.items.find(i => i.id === 's7')?.detail).toBeUndefined()
  })
})

describe('derivePartnerFeed — curator items', () => {
  const AVAILABLE_INSIGHTS: CuratorInsights = {
    available: true,
    curator: { paused: false, last_run_at: isoHoursAgo(3) },
    learning: { stats: { learned_skills: 2 } }
  }

  it('is absent when curator insights are unavailable', () => {
    const feed = derivePartnerFeed(
      snapshot({ curator: { ok: false, insights: { available: false, curator: null, learning: null } } }),
      NOW
    )
    expect(feed.items.filter(i => i.kind === 'curator')).toEqual([])
  })

  it('is absent when insights are null', () => {
    const feed = derivePartnerFeed(snapshot({ curator: { ok: false, insights: null } }), NOW)
    expect(feed.items.filter(i => i.kind === 'curator')).toEqual([])
  })

  it('surfaces up to 2 curator items, timestamped from curator.last_run_at, with no CTA', () => {
    const feed = derivePartnerFeed(snapshot({ curator: { ok: true, insights: AVAILABLE_INSIGHTS } }), NOW)
    const curatorItems = feed.items.filter(i => i.kind === 'curator')
    expect(curatorItems.length).toBeGreaterThan(0)
    expect(curatorItems.length).toBeLessThanOrEqual(2)
    for (const item of curatorItems) {
      expect(item.at).toBe(Date.parse(isoHoursAgo(3)))
      expect(item.sessionId).toBeUndefined()
    }
  })

  it('is null-at when the curator has no last_run_at', () => {
    const insights: CuratorInsights = { available: true, curator: null, learning: { stats: { learned_skills: 1 } } }
    const feed = derivePartnerFeed(snapshot({ curator: { ok: true, insights } }), NOW)
    const curatorItems = feed.items.filter(i => i.kind === 'curator')
    expect(curatorItems.length).toBe(1)
    expect(curatorItems[0].at).toBeNull()
  })
})

describe('derivePartnerFeed — merge, sort, window, cap', () => {
  it('sorts merged items across all kinds newest-first', () => {
    const theJob = job({
      id: 'job-a',
      last_run_at: isoHoursAgo(2),
      last_status: 'ok',
      runs: [run({ id: 'run-2h', started_at: secondsHoursAgo(2) })]
    })
    const feed = derivePartnerFeed(
      snapshot({
        cron: { ok: true, jobs: [theJob] },
        sessions: { ok: true, rows: [sessionRow({ id: 'sess-1h', started_at: secondsHoursAgo(1) })] },
        curator: {
          ok: true,
          insights: { available: true, curator: { paused: false, last_run_at: isoHoursAgo(4) }, learning: { stats: { learned_skills: 1 } } }
        }
      }),
      NOW
    )
    // 1h ago session, then 2h ago run, then 4h-ago curator item(s).
    const ids = feed.items.map(i => i.id)
    expect(ids[0]).toBe('sess-1h')
    expect(ids[1]).toBe('run-2h')
    expect(ids.slice(2)).toEqual(expect.arrayContaining(['learning-skills', 'curator-last-run']))
  })

  it('sorts items with at:null last, after every timestamped item', () => {
    const feed = derivePartnerFeed(
      snapshot({
        sessions: {
          ok: true,
          rows: [
            sessionRow({ id: 'sess-known', started_at: secondsHoursAgo(1) }),
            sessionRow({ id: 'sess-unknown', started_at: null })
          ]
        }
      }),
      NOW
    )
    const ids = feed.items.map(i => i.id)
    expect(ids.indexOf('sess-known')).toBeLessThan(ids.indexOf('sess-unknown'))
    expect(feed.items.find(i => i.id === 'sess-unknown')?.at).toBeNull()
  })

  it('caps at 20 items, keeping the most recent', () => {
    const rows = Array.from({ length: 25 }, (_, i) => sessionRow({ id: `sess-${i}`, started_at: secondsHoursAgo(i) }))
    const feed = derivePartnerFeed(snapshot({ sessions: { ok: true, rows } }), NOW)
    expect(feed.items).toHaveLength(20)
    // Most recent 20 (sess-0 .. sess-19) win; the oldest 5 are dropped.
    expect(feed.items.map(i => i.id)).toEqual(Array.from({ length: 20 }, (_, i) => `sess-${i}`))
    expect(feed.items.some(i => i.id === 'sess-24')).toBe(false)
  })

  it('excludes items older than the 7-day window, even when there is room under the cap', () => {
    const rows = [
      sessionRow({ id: 'recent', started_at: secondsHoursAgo(1) }),
      sessionRow({ id: 'stale', started_at: secondsHoursAgo(8 * 24) }) // 8 days ago
    ]
    const feed = derivePartnerFeed(snapshot({ sessions: { ok: true, rows } }), NOW)
    expect(feed.items.map(i => i.id)).toEqual(['recent'])
  })

  it('never windows out an item with at:null (unproven time is shown, not hidden)', () => {
    const feed = derivePartnerFeed(
      snapshot({ sessions: { ok: true, rows: [sessionRow({ id: 'unknown-time', started_at: null })] } }),
      NOW
    )
    expect(feed.items.map(i => i.id)).toEqual(['unknown-time'])
  })
})

describe('derivePartnerFeed — degraded flags and availability', () => {
  it('flags a source as degraded exactly when its ok flag is false', () => {
    const feed = derivePartnerFeed(
      snapshot({
        cron: { ok: false, jobs: [] },
        sessions: { ok: true, rows: [] },
        curator: { ok: false, insights: null }
      }),
      NOW
    )
    expect(feed.degraded).toEqual({ cron: true, sessions: false, curator: true })
  })

  it('passes `available` straight through from the snapshot', () => {
    expect(derivePartnerFeed(snapshot({ available: false }), NOW).available).toBe(false)
    expect(derivePartnerFeed(snapshot({ available: true }), NOW).available).toBe(true)
  })
})

describe('derivePartnerFeed — never fabricates a fact not present in the input', () => {
  it('a task-run title contains only the literal job name plus fixed phrasing', () => {
    const name = 'ניקוי תיבת דואר נכנס'
    const theJob = job({ id: 'j', name, last_run_at: isoHoursAgo(1), last_status: 'ok', runs: [run({ id: 'r', started_at: secondsHoursAgo(1) })] })
    const feed = derivePartnerFeed(snapshot({ cron: { ok: true, jobs: [theJob] } }), NOW)
    const title = feed.items.find(i => i.id === 'r')?.title ?? ''
    expect(title).toBe(`המשימה ‚${name}' רצה`)
    // Nothing beyond the job's own name and the fixed template survives.
    expect(title.replace(name, '')).toBe(`המשימה ‚' רצה`)
  })

  it('a background-session detail is a literal prefix of the input preview, never invented text', () => {
    const preview = 'הזמנה מספר 4821 אושרה'
    const feed = derivePartnerFeed(
      snapshot({ sessions: { ok: true, rows: [sessionRow({ id: 's', preview, started_at: secondsHoursAgo(1) })] } }),
      NOW
    )
    const detail = feed.items.find(i => i.id === 's')?.detail ?? ''
    expect(preview.startsWith(detail.replace(/…$/, ''))).toBe(true)
  })

  it('the check-in title never contains any digit — it is a fixed phrase, not a synthesized count', () => {
    const theJob = job({
      id: 'checkin',
      isPartnerCheckin: true,
      last_run_at: isoHoursAgo(1),
      last_status: 'ok',
      runs: [run({ id: 'r', started_at: secondsHoursAgo(1) })]
    })
    const feed = derivePartnerFeed(snapshot({ cron: { ok: true, jobs: [theJob] } }), NOW)
    const item = feed.items.find(i => i.id === 'r') as PartnerFeedItem
    expect(/\d/.test(item.title)).toBe(false)
  })

  it("a curator item's learned-skills count in the title matches the raw input count exactly", () => {
    const insights: CuratorInsights = { available: true, curator: null, learning: { stats: { learned_skills: 5 } } }
    const feed = derivePartnerFeed(snapshot({ curator: { ok: true, insights } }), NOW)
    const item = feed.items.find(i => i.kind === 'curator')
    expect(item?.title).toContain('5')
    expect(item?.title).not.toMatch(/[0-46-9]/) // no digit other than the real "5" appears
  })
})
