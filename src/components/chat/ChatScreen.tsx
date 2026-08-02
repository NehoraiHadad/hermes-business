import { Paperclip, Plus, Send, Sparkles, Square } from 'lucide-react'
import { FormEvent, useEffect, useRef, useState } from 'react'
import type { Activity, Approval, ChatMessage, ClarifyRequest } from '../../types'
import type { PendingAttachment } from '../../lib/hermes/attachments'
import { ActivityStrip } from './ActivityStrip'
import { ApprovalCard } from './ApprovalCard'
import { ClarifyCard } from './ClarifyCard'
import { ComposerAttachments } from './ComposerAttachments'
import { MessageBubble } from './MessageBubble'
import { buildConversationTimeline } from './conversation-timeline'
import { useComposerAttachments } from './useComposerAttachments'

export function ChatScreen({
  messages,
  activities,
  approval,
  clarify,
  busy,
  onSend,
  onStop,
  onApproval,
  onClarify
}: {
  messages: ChatMessage[]
  activities: Activity[]
  approval: Approval | null
  clarify: ClarifyRequest | null
  busy: boolean
  onSend: (text: string, attachments: PendingAttachment[]) => Promise<boolean> | void
  onStop: () => void
  onApproval: (choice: 'once' | 'deny') => void
  onClarify: (answer: string) => void
}) {
  const [text, setText] = useState('')
  const { attachments, setAttachments, fileInput, pickAttachment, onBrowserFiles, removeAttachment } =
    useComposerAttachments(busy)
  const endRef = useRef<HTMLDivElement>(null)
  const timeline = buildConversationTimeline(messages, activities)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [messages, activities, approval, clarify])

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
      <div className="chat-scroll">
        <div className="conversation">
          <div className="conversation-date">היום</div>
          {!messages.length && !busy ? (
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
                  <button key={suggestion} type="button" onClick={() => void onSend(suggestion, [])}>
                    {suggestion}
                  </button>
                ))}
              </div>
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
            rows={1}
            disabled={busy}
            value={text}
            onChange={event => setText(event.target.value)}
            onKeyDown={event => {
              if (event.key === 'Enter' && !event.shiftKey) submit(event)
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
              <button type="button" className="composer-icon" aria-label="פעולות נוספות">
                <Plus size={18} />
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
