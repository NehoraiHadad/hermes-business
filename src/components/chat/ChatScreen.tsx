import { AlertTriangle, Bell, Paperclip, Play, Send, Sparkles, Square } from 'lucide-react'
import { FormEvent, ReactNode, useContext, useEffect, useRef, useState } from 'react'
import type { Activity, Approval, ChatMessage, ClarifyRequest, ScheduledTask } from '../../types'
import type { PendingAttachment } from '../../lib/hermes/attachments'
import { FeedUnseenContext } from '../../lib/feed-unseen-context'
import { summarizeHomeTasks } from '../../lib/home-status'
import { ActivityStrip } from './ActivityStrip'
import { ApprovalCard } from './ApprovalCard'
import { ClarifyCard } from './ClarifyCard'
import { ComposerAttachments } from './ComposerAttachments'
import { MessageBubble } from './MessageBubble'
import { buildConversationTimeline } from './conversation-timeline'
import { useComposerAttachments } from './useComposerAttachments'

// One card of the empty state's "מצב העסק" strip. Every card is a real button
// that navigates somewhere the number can be acted on — nothing here is decoration.
type StatusCard = {
  key: string
  icon: ReactNode
  tone: string
  value: string
  note: string
  /** Full-sentence accessible name — the visible value/note read as one thought. */
  label: string
  onClick: () => void
}

export function ChatScreen({
  messages,
  activities,
  approval,
  clarify,
  busy,
  tasks = [],
  tasksLoadError = false,
  onSend,
  onStop,
  onApproval,
  onClarify,
  onOpenTasks
}: {
  messages: ChatMessage[]
  activities: Activity[]
  approval: Approval | null
  clarify: ClarifyRequest | null
  busy: boolean
  // Same authoritative schedule slice TasksScreen renders, with the same caveat:
  // when `tasksLoadError` is set, `tasks` is an EMPTY PLACEHOLDER, not a
  // proven-empty list. Optional because the surfaces that only host a
  // conversation (tests, any future embed) have nothing to say about them.
  tasks?: ScheduledTask[]
  tasksLoadError?: boolean
  onSend: (text: string, attachments: PendingAttachment[]) => Promise<boolean> | void
  onStop: () => void
  onApproval: (choice: 'once' | 'deny') => void
  onClarify: (answer: string) => void
  onOpenTasks?: () => void
}) {
  const [text, setText] = useState('')
  const { attachments, setAttachments, fileInput, pickAttachment, onBrowserFiles, removeAttachment } =
    useComposerAttachments(busy)
  const endRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  // Set by a suggestion chip click; consumed once the populated text has committed
  // to the DOM so the caret lands after the real value, not the stale one.
  const focusComposerRef = useRef(false)
  const timeline = buildConversationTimeline(messages, activities)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [messages, activities, approval, clarify])

  useEffect(() => {
    if (!focusComposerRef.current) return
    focusComposerRef.current = false
    const node = textareaRef.current
    if (!node) return
    node.focus()
    node.setSelectionRange(node.value.length, node.value.length)
  }, [text])

  const [liveStatus, setLiveStatus] = useState('')
  // Reports state transitions to screen readers (turn started/finished, tool activity),
  // never per-token deltas — the ref gates each branch so a re-render mid-stream (text
  // still arriving, busy/activity unchanged) does not re-announce anything.
  const liveStatusRef = useRef({ busy: false, activityKey: '' })
  useEffect(() => {
    const state = liveStatusRef.current
    const activeActivity = activities.reduce<Activity | null>(
      (latest, activity) => (!latest || activity.timelineOrder > latest.timelineOrder ? activity : latest),
      null
    )
    const activityKey = activeActivity ? `${activeActivity.id}:${activeActivity.status}` : ''
    if (activityKey && activityKey !== state.activityKey) {
      state.activityKey = activityKey
      setLiveStatus(
        activeActivity!.status === 'running'
          ? activeActivity!.detail
            ? `${activeActivity!.label}: ${activeActivity!.detail}`
            : activeActivity!.label
          : `${activeActivity!.label} — הושלם`
      )
      return
    }
    if (busy && !state.busy) {
      state.busy = true
      setLiveStatus('העוזר עובד על התשובה')
    } else if (!busy && state.busy) {
      state.busy = false
      const finished = [...messages].reverse().find(message => message.role === 'assistant' && message.text.trim())
      setLiveStatus(finished ? `התשובה מוכנה. ${finished.text}` : 'התשובה מוכנה')
    }
  }, [busy, activities, messages])

  // "מצב העסק" strip — the empty screen's only real-data content. Read from the
  // exact values their own screens use: the schedule slice via summarizeHomeTasks
  // (src/lib/home-status.ts), and the partner-feed unseen count via the context
  // FullAppShell publishes from the SAME computation the sidebar badge renders,
  // so the two can never disagree.
  const feedUnseenCount = useContext(FeedUnseenContext)
  const showEmptyState = !messages.length && !busy
  const statusCards: StatusCard[] = []
  if (showEmptyState) {
    const { activeCount, nextRun } = summarizeHomeTasks(tasks, tasksLoadError, Date.now())
    if (activeCount === null) {
      // A failed read renders as honestly-unknown rather than as nothing at all.
      // Silence here would be its own lie: scheduled tasks may well be running
      // right now, and the owner would read the empty screen as "nothing is set
      // up". Same wording as TasksScreen's stat cards ('לא ידוע'), and the card
      // leads to the screen that explains the failure and offers a retry.
      statusCards.push({
        key: 'tasks',
        icon: <AlertTriangle size={16} />,
        tone: 'empty-state-card__icon--amber',
        value: 'לא ידוע',
        note: 'מצב המשימות המתוזמנות',
        label: 'לא הצלחנו לקרוא כרגע את המשימות המתוזמנות. פתחו את מסך פעילות ומשימות כדי לבדוק.',
        onClick: () => onOpenTasks?.()
      })
    } else if (activeCount > 0) {
      // A proven 0 shows nothing: a fresh install must keep the clean empty
      // state, not a row of zeros telling the owner what they do not have.
      const count = activeCount === 1 ? 'משימה פעילה אחת' : `${activeCount} משימות פעילות`
      const note = nextRun ? `הריצה הבאה: ${nextRun}` : 'טרם נקבעה ריצה הבאה'
      statusCards.push({
        key: 'tasks',
        icon: <Play size={16} />,
        tone: 'empty-state-card__icon--green',
        value: count,
        note,
        label: `${count}. ${note}. פתחו את מסך פעילות ומשימות.`,
        onClick: () => onOpenTasks?.()
      })
    }
    if (feedUnseenCount > 0) {
      const count =
        feedUnseenCount === 1 ? 'עדכון חדש מהעוזר' : `${feedUnseenCount} עדכונים חדשים מהעוזר`
      statusCards.push({
        key: 'feed',
        icon: <Bell size={16} />,
        tone: 'empty-state-card__icon--indigo',
        value: count,
        note: 'מאז הביקור האחרון',
        label: `${count} מאז הביקור האחרון. פתחו את מסך פעילות ומשימות כדי לראות מה נעשה.`,
        onClick: () => onOpenTasks?.()
      })
    }
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const value = text.trim()
    if ((!value && !attachments.length) || busy) return
    const outgoing = attachments
    setText('')
    setAttachments([])
    const ok = await onSend(value, outgoing)
    if (ok === false) {
      // Restore the composer so the user can retry without re-picking files.
      setText(value)
      setAttachments(outgoing.map(item => ({ ...item, status: 'error' })))
    }
  }

  return (
    <main className="chat-screen">
      <div className="chat-live-region visually-hidden" role="status" aria-live="polite">
        {liveStatus}
      </div>
      <div className="chat-scroll">
        <div className="conversation">
          <div className="conversation-date">היום</div>
          {showEmptyState ? (
            <div className="empty-conversation">
              <span>
                <Sparkles size={20} />
              </span>
              <strong>מה תרצה להוריד מהראש היום?</strong>
              <p>תאר מטרה, בעיה או משימה במילים שלך. העוזר יכוון את הצעד הבא ויבקש חיבור רק אם באמת צריך.</p>
              <div className="empty-suggestions" aria-label="רעיונות להתחלה">
                {[
                  'נסח תשובה ללקוח',
                  'עזור לי לתכנן את השבוע',
                  'מצא משימה שחוזרת על עצמה'
                ].map(suggestion => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => {
                      // Populate the composer instead of sending — a curious click should
                      // let the user edit the suggestion before it becomes a real turn.
                      focusComposerRef.current = true
                      setText(suggestion)
                    }}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
              {/* Collapses entirely when there is nothing real to say — a fresh
                  install keeps the clean greeting-and-chips screen. Never
                  auto-focused: starting a conversation stays the primary action.
                  Outside the chat live region above, so none of this is announced
                  as conversation activity. */}
              {statusCards.length ? (
                <nav className="empty-state-strip" aria-label="מצב העסק">
                  {statusCards.map(card => (
                    <button
                      key={card.key}
                      type="button"
                      className="empty-state-card"
                      aria-label={card.label}
                      onClick={card.onClick}
                    >
                      <span className={`empty-state-card__icon ${card.tone}`}>{card.icon}</span>
                      <strong>{card.value}</strong>
                      <small>{card.note}</small>
                    </button>
                  ))}
                </nav>
              ) : null}
            </div>
          ) : null}
          {timeline.map(entry =>
            entry.kind === 'message' ? (
              <MessageBubble key={`message-${entry.id}`} message={entry.message} />
            ) : (
              <ActivityStrip key={`activity-${entry.id}`} activity={entry.activity} />
            )
          )}
          {approval ? <ApprovalCard approval={approval} onRespond={onApproval} /> : null}
          {clarify ? <ClarifyCard request={clarify} onRespond={onClarify} /> : null}
          <div ref={endRef} />
        </div>
      </div>
      <div className="composer-wrap">
        <form className="composer" onSubmit={submit}>
          <ComposerAttachments attachments={attachments} onRemove={removeAttachment} />
          <textarea
            ref={textareaRef}
            rows={1}
            value={text}
            onChange={event => setText(event.target.value)}
            onKeyDown={event => {
              if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
              // Sending stays blocked while busy (the stop button covers cancelling the
              // turn) — but let Enter insert a newline instead of swallowing the keystroke,
              // so nothing the user typed is lost.
              if (busy) return
              submit(event)
            }}
            placeholder="מה תרצה לעשות?"
            aria-label="הודעה לעוזר"
          />
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            onChange={onBrowserFiles}
            aria-hidden="true"
          />
          <div className="composer__bottom">
            <div>
              <button
                type="button"
                className="composer-icon"
                aria-label="צירוף קובץ"
                onClick={pickAttachment}
                disabled={busy}
              >
                <Paperclip size={18} />
              </button>
            </div>
            {busy ? (
              <button type="button" className="send-button send-button--stop" onClick={onStop} aria-label="עצור תשובה">
                <Square size={15} fill="currentColor" />
              </button>
            ) : (
              <button
                type="submit"
                className="send-button"
                disabled={!text.trim() && !attachments.length}
                aria-label="שלח"
              >
                <Send size={17} />
              </button>
            )}
          </div>
        </form>
        <p className="composer-hint">
          התשובות עשויות לכלול טעויות. פעולות משמעותיות יוצגו לך לאישור לפני ביצוע.
        </p>
      </div>
    </main>
  )
}
