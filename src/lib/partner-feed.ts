// Pure derivation of the partner-visibility feed (docs/specs/partner-feed.md §4.2):
// turns the allow-list-projected `PartnerFeedSnapshot` (ambient type, src/vite-env.d.ts,
// built in electron/partner-feed.cjs) into the Hebrew display items the UI renders.
//
// No React, no hermesClient, no window — same "pure derivation" split as
// deriveCuratorNotifications (src/lib/hermes/curator.ts): main hands over raw-but-safe
// facts, this module only reshapes them into sentences. It never invents a number or a
// claim that isn't present in the snapshot — an unproven fact renders as "unknown"
// (`status: 'unknown'`) or is simply left out (curator items, absent runs), never
// fabricated as success.

import { deriveCuratorNotifications } from './hermes/curator'

export type PartnerFeedItemKind = 'checkin-run' | 'task-run' | 'background-session' | 'curator'

export type PartnerFeedItem = {
  id: string // stable: the run's session id / the session id / the curator notification id
  kind: PartnerFeedItemKind
  at: number | null // epoch ms, normalized; null = "unknown time" (shown, never hidden)
  title: string // Hebrew, derived only — never a fabricated number/fact
  detail?: string
  status: 'ok' | 'error' | 'unknown' // 'unknown' when there is no proof — shown as "unknown", never as success
  sourceLabel?: string // 'טלגרם' / 'WhatsApp' / the job name
  sessionId?: string // present ⇒ CTA "open the conversation"
  jobId?: string
}

export type PartnerFeed = {
  items: PartnerFeedItem[] // sorted newest→oldest, capped at 20, 7-day window
  degraded: { cron: boolean; sessions: boolean; curator: boolean } // which sources failed to read
  available: boolean
}

const WINDOW_MS = 7 * 24 * 60 * 60 * 1000 // 7 days
const MAX_ITEMS = 20
const PREVIEW_MAX = 120

// Fixed Hebrew title for a check-in run — never interpolates the job's (marker-bearing)
// raw name.
const CHECKIN_TITLE = 'השותף ערך בדיקה תקופתית'

// Channels we can confidently translate; everything else is shown by its raw `source`
// (spec §4.2: "ואחרת ה-source כלשונו") — deliberately not a closed allow-list, so an
// unrecognized platform is still visible, just untranslated.
function sourceLabelFor(source: string): string {
  if (source === 'telegram') return 'טלגרם'
  if (source.startsWith('whatsapp')) return 'WhatsApp'
  return source
}

// Hermes returns started_at/ended_at/last_active in epoch SECONDS (verified against the
// electron/partner-feed.test.ts and demo-desktop.ts fixtures, which build them via
// `Math.floor(Date.now() / 1000)`); the feed item's `at` is epoch MS.
function secondsToMs(seconds: number | null): number | null {
  return seconds == null ? null : seconds * 1000
}

function parseIsoToMs(iso: string | null | undefined): number | null {
  if (!iso) return null
  const ms = Date.parse(iso)
  return Number.isFinite(ms) ? ms : null
}

// Maps the job's `last_status` to an item status. `null` (not reported) must never
// become 'ok' — that would fabricate a success that Hermes never proved.
function statusFromLastStatus(lastStatus: 'ok' | 'error' | null): 'ok' | 'error' | 'unknown' {
  if (lastStatus === 'ok') return 'ok'
  if (lastStatus === 'error') return 'error'
  return 'unknown'
}

// True only for the ONE run that the job's `last_run_at` actually points at (compared
// at second precision, since `last_run_at` is an ISO timestamp and `started_at` is
// epoch seconds). There is no per-historical-run status in Hermes 0.19.1 (spec §2.1),
// so every other run in the list is 'unknown' by construction, never inherited.
function isRunJobLastRunAtPointsTo(job: FeedCronJob, run: FeedRunRow): boolean {
  if (job.last_run_at == null || run.started_at == null) return false
  const jobAtSeconds = Math.floor(Date.parse(job.last_run_at) / 1000)
  return Number.isFinite(jobAtSeconds) && jobAtSeconds === run.started_at
}

function cronRunTitle(job: FeedCronJob): string {
  return job.isPartnerCheckin ? CHECKIN_TITLE : `המשימה ‚${job.name}' רצה`
}

// Truncated to 120 chars (spec §4.2) with a trailing ellipsis when actually cut, so the
// UI never silently swallows the fact that more text existed.
function truncatePreview(preview: string | null): string | undefined {
  if (!preview) return undefined
  if (preview.length <= PREVIEW_MAX) return preview
  return `${preview.slice(0, PREVIEW_MAX)}…`
}

function cronRunItems(cron: PartnerFeedSnapshot['cron']): PartnerFeedItem[] {
  const items: PartnerFeedItem[] = []
  for (const job of cron.jobs) {
    for (const run of job.runs) {
      items.push({
        id: run.id,
        kind: job.isPartnerCheckin ? 'checkin-run' : 'task-run',
        at: secondsToMs(run.started_at),
        title: cronRunTitle(job),
        status: isRunJobLastRunAtPointsTo(job, run) ? statusFromLastStatus(job.last_status) : 'unknown',
        sourceLabel: job.name,
        sessionId: run.id,
        jobId: job.id
      })
    }
  }
  return items
}

function backgroundSessionItems(sessions: PartnerFeedSnapshot['sessions']): PartnerFeedItem[] {
  return sessions.rows.map(row => {
    const label = sourceLabelFor(row.source)
    return {
      id: row.id,
      kind: 'background-session',
      at: secondsToMs(row.started_at),
      title: `שיחה חדשה מ${label}`,
      detail: truncatePreview(row.preview),
      // A background session has no success/failure concept — it's proof a
      // conversation happened, not a job outcome — so it is never 'unknown'.
      status: 'ok',
      sourceLabel: label,
      sessionId: row.id
    }
  })
}

// Up to 2 items (spec §4.2), reusing the existing deriveCuratorNotifications so the
// feed and SkillsScreen never tell two different stories about the curator (same
// doctrine as the DEMO_PARTNER_FEED/DEMO_CURATOR fixture pairing).
function curatorItems(curator: PartnerFeedSnapshot['curator']): PartnerFeedItem[] {
  const notifications = deriveCuratorNotifications(curator.insights).slice(0, 2)
  const at = parseIsoToMs(curator.insights?.curator?.last_run_at)
  return notifications.map(notification => ({
    id: notification.id,
    kind: 'curator',
    at,
    title: notification.title,
    detail: notification.detail,
    // Like a background session, a curator note has no success/failure concept —
    // it is proof the curator ran, not a job outcome. If a generic renderer ever
    // treats `status` uniformly across kinds, these must stay badge-less.
    status: 'ok'
  }))
}

function compareItems(a: PartnerFeedItem, b: PartnerFeedItem): number {
  if (a.at === null && b.at === null) return 0
  if (a.at === null) return 1 // at:null always sorts last
  if (b.at === null) return -1
  return b.at - a.at // newest first
}

// The one pure entry point (spec §4.2). `now` is injected (not `Date.now()`) so the
// window/cap/sort logic is fully deterministic under test.
export function derivePartnerFeed(snapshot: PartnerFeedSnapshot, now: number): PartnerFeed {
  const items = [
    ...cronRunItems(snapshot.cron),
    ...backgroundSessionItems(snapshot.sessions),
    ...curatorItems(snapshot.curator)
  ].filter(item => item.at === null || now - item.at <= WINDOW_MS)

  items.sort(compareItems)

  return {
    items: items.slice(0, MAX_ITEMS),
    degraded: {
      cron: !snapshot.cron.ok,
      sessions: !snapshot.sessions.ok,
      curator: !snapshot.curator.ok
    },
    available: snapshot.available
  }
}
