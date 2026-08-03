import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  CircleHelp,
  Clock3,
  HeartHandshake,
  Inbox,
  MessageCircle,
  Plus,
  RefreshCw,
  Send,
  WandSparkles,
  XCircle
} from 'lucide-react'
import { timeAgo } from '../../lib/presentation'
import type { PartnerFeed, PartnerFeedItem, PartnerFeedItemKind } from '../../lib/partner-feed'

// "מה השותף עשה בשבילך" — docs/specs/partner-feed.md §6.1-6.3. Deliberately a THIN
// component: every fact it shows (title/detail/status/timestamp) was already derived
// in the pure src/lib/partner-feed.ts; this file only picks icons/classes and lays the
// rows out in the existing task-row/list-state patterns. It never invents a fact of
// its own — an item whose proof is missing renders "תוצאה לא ידועה"/"מועד לא ידוע",
// never a fabricated success or a silently dropped row.

const KIND_ICON: Record<PartnerFeedItemKind, typeof HeartHandshake> = {
  'checkin-run': HeartHandshake,
  'task-run': CalendarClock,
  'background-session': MessageCircle,
  curator: WandSparkles
}

// Telegram gets its own recognizable glyph (matches ServiceIcon's channel iconography
// elsewhere in the app); every other background-session source — including an
// unrecognized future platform (spec §10.4: shown honestly, never hidden) — falls
// back to the generic channel icon above.
function iconForItem(item: PartnerFeedItem) {
  if (item.kind === 'background-session' && item.sourceLabel === 'טלגרם') return Send
  return KIND_ICON[item.kind]
}

// Status tags carry real success/failure semantics ONLY for cron-run items
// (checkin-run/task-run — spec §6.2). A background session or a curator note has no
// pass/fail concept of its own (src/lib/partner-feed.ts pins their `status` to a
// fixed 'ok' for exactly this reason) — rendering a tag for them would fabricate a
// success claim Hermes never made, so those two kinds stay badge-less by design.
function showsStatusTag(kind: PartnerFeedItemKind): boolean {
  return kind === 'checkin-run' || kind === 'task-run'
}

function StatusTag({ status }: { status: PartnerFeedItem['status'] }) {
  if (status === 'ok') {
    return (
      <span className="partner-feed-status partner-feed-status--ok">
        <CheckCircle2 size={13} /> הצליחה
      </span>
    )
  }
  if (status === 'error') {
    return (
      <span className="partner-feed-status partner-feed-status--error">
        <XCircle size={13} /> נכשלה
      </span>
    )
  }
  // Fail-closed default (spec §6.3 last row): no proof of outcome is shown honestly,
  // never as a silent success and never hidden.
  return (
    <span className="partner-feed-status partner-feed-status--unknown">
      <CircleHelp size={13} /> תוצאה לא ידועה
    </span>
  )
}

function timeLabel(at: number | null): string {
  if (at === null) return 'מועד לא ידוע'
  return timeAgo(new Date(at).toISOString()) || 'מועד לא ידוע'
}

function PartnerFeedRow({ item, onOpenSession }: { item: PartnerFeedItem; onOpenSession: (sessionId: string) => void }) {
  const Icon = iconForItem(item)
  return (
    <article className="task-row">
      <span className="task-row__state">
        <Icon size={18} />
      </span>
      <div className="task-row__main">
        <strong>{item.title}</strong>
        {item.detail ? <p>{item.detail}</p> : null}
        <div className="task-row__meta">
          <span>
            <Clock3 size={14} /> {timeLabel(item.at)}
          </span>
          {showsStatusTag(item.kind) ? <StatusTag status={item.status} /> : null}
        </div>
      </div>
      <div className="task-row__right">
        {item.sessionId ? (
          <button
            type="button"
            className="outline-button outline-button--small"
            onClick={() => onOpenSession(item.sessionId as string)}
          >
            פתח את השיחה
          </button>
        ) : null}
      </div>
    </article>
  )
}

// Hebrew labels for the snapshot's per-source `degraded` flags (spec §6.3 "דגרדציה
// חלקית" row) — never the raw `cron`/`sessions`/`curator` keys.
function degradedSourceLabels(degraded: PartnerFeed['degraded']): string[] {
  const labels: string[] = []
  if (degraded.cron) labels.push('ריצות משימות מתוזמנות')
  if (degraded.sessions) labels.push('שיחות רקע')
  if (degraded.curator) labels.push('תובנות הלמידה')
  return labels
}

export function PartnerFeedPanel({
  feed,
  loading,
  onRefresh,
  onOpenSession,
  onAddTask
}: {
  feed: PartnerFeed | null
  loading: boolean
  onRefresh: () => Promise<void>
  onOpenSession: (sessionId: string) => void
  onAddTask: () => void
}) {
  return (
    <section className="panel partner-feed-panel">
      <div className="panel__title">
        <h3>מה השותף עשה בשבילך</h3>
        <button type="button" className="ghost-button" onClick={() => void onRefresh()} disabled={loading}>
          <RefreshCw size={15} className={loading ? 'spin' : ''} /> רענון
        </button>
      </div>

      {!feed ? (
        // "אין snapshot עדיין" (spec §6.3 row 1) — covers both the in-flight fetch and
        // the brief instant before the first fetch effect has run; either way there is
        // nothing proven yet to show.
        <div className="list-state" role="status">
          <span className="list-state__icon">
            <RefreshCw size={20} className="spin" />
          </span>
          <strong>טוען את פעילות השותף…</strong>
        </div>
      ) : !feed.available ? (
        // available:false — runtime down / bridge missing / every source failed. Must
        // NEVER read as "אין פעילות" (spec §6.3 row 2 is explicit about this).
        <div className="list-state list-state--error">
          <span className="list-state__icon list-state__icon--error">
            <AlertTriangle size={20} />
          </span>
          <strong>לא הצלחנו לקרוא את פעילות השותף</strong>
          <p>ייתכן שהחיבור ל-Hermes נקטע. רעננו את החלון, או בדקו את מצב המערכת במסך התמיכה.</p>
        </div>
      ) : (
        <>
          {/* A2 fix: hoisted above the empty/non-empty split so a partially degraded
              but otherwise EMPTY read (available:true, some source ok:false, zero
              items) still shows this warning — previously it only rendered inside the
              non-empty branch, so that snapshot looked like a clean "עוד לא נרשמה
              פעילות" instead of an honest "we couldn't read everything" (spec §6.3). */}
          {degradedSourceLabels(feed.degraded).length ? (
            <p className="partner-feed-degraded-note">
              <AlertTriangle size={13} /> חלק מהנתונים לא נקראו הפעם ({degradedSourceLabels(feed.degraded).join(', ')})
            </p>
          ) : null}
          {feed.items.length === 0 ? (
            <div className="list-state">
              <span className="list-state__icon">
                <Inbox size={20} />
              </span>
              <strong>עוד לא נרשמה פעילות ברקע</strong>
              <p>כשמשימה מתוזמנת תרוץ או שתגיע שיחה מהטלפון — תראו את זה כאן.</p>
              <button type="button" className="outline-button outline-button--small" onClick={onAddTask}>
                <Plus size={15} /> משימה חדשה
              </button>
            </div>
          ) : (
            <div className="task-list">
              {feed.items.map(item => (
                <PartnerFeedRow key={item.id} item={item} onOpenSession={onOpenSession} />
              ))}
            </div>
          )}
        </>
      )}
    </section>
  )
}
