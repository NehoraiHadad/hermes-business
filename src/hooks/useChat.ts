import { useCallback, useEffect, useRef, useState } from 'react'
import { hermesClient } from '../lib/hermes-client'
import { handleGatewayEvent, nextTimelineOrder, now } from '../lib/hermes/chat-events'
import { createReconnectResumeTracker } from '../lib/hermes/chat-resume'
import { stageAttachments, type PendingAttachment } from '../lib/hermes/attachments'
import { startSkillSession } from '../lib/hermes/skill-session'
import type { ToastSeverity } from '../lib/toast'
import type { Activity, Approval, ChatMessage, ClarifyRequest, Screen, Session } from '../types'

// Owns the live conversation: streaming messages, tool activity, approvals and
// clarify requests driven by the Hermes event stream, plus the actions that
// start/resume/submit sessions. The per-event reducer lives in ../lib/hermes/
// chat-events so this hook stays focused on session lifecycle.
export function useChat({
  setScreen,
  setToast
}: {
  setScreen: (screen: Screen) => void
  setToast: (toast: string, severity?: ToastSeverity) => void
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [activities, setActivities] = useState<Activity[]>([])
  const [approval, setApproval] = useState<Approval | null>(null)
  const [clarify, setClarify] = useState<ClarifyRequest | null>(null)
  const [busy, setBusy] = useState(false)
  const [runtimeSession, setRuntimeSession] = useState('')
  const [activeSession, setActiveSession] = useState('')

  useEffect(() => {
    return hermesClient.onEvent(event =>
      handleGatewayEvent(event, runtimeSession, {
        setBusy,
        setMessages,
        setActivities,
        setApproval,
        setClarify,
        // chat-events only calls this on the 'error' gateway event, so it is
        // always an error toast — give it the longer, lingering duration.
        setToast: message => setToast(message, 'error')
      })
    )
  }, [runtimeSession, setToast])

  // Stream recovery after a reconnect. The transport reconnects on its own and our
  // onEvent subscription survives, but Hermes binds a session to the CONNECTION it was
  // created/resumed on and detaches it when that socket drops — so the new socket
  // delivers nothing for this session until `session.resume` re-binds it. The tracker
  // (pure, tested in lib/hermes/chat-resume) fires only on an 'open' that FOLLOWS a
  // drop, so a normal boot never re-resumes. A failed re-bind is surfaced, not hidden:
  // the turn is provably dead, so we stop claiming to be busy and say so.
  useEffect(() => {
    if (!runtimeSession) return
    const tracker = createReconnectResumeTracker()
    return hermesClient.onConnectionChange(state => {
      if (!tracker.observe(state)) return
      void hermesClient.resumeSession(runtimeSession).catch(() => {
        setBusy(false)
        setToast('החיבור ל־Hermes חזר, אך לא ניתן היה לחדש את השיחה. שלח/י הודעה כדי להמשיך.', 'error')
      })
    })
  }, [runtimeSession, setToast])

  const resetConversation = () => {
    setActivities([])
    setApproval(null)
    setClarify(null)
  }

  const selectSession = useCallback(async (session: Session) => {
    setScreen('chat')
    setActiveSession(session.id)
    resetConversation()
    try {
      const resumed = await hermesClient.resumeSession(session.id)
      setRuntimeSession(resumed.session_id)
      const hydrated = (resumed.messages || [])
        .filter(message => message.role === 'user' || message.role === 'assistant')
        .map((message, index) => ({
          id: `${session.id}-${index}`,
          role: message.role as 'user' | 'assistant',
          text: String(message.content || message.text || '')
        }))
      setMessages(hydrated)
    } catch {
      setMessages([])
      setRuntimeSession(session.id)
    }
  }, [setScreen])

  const newSession = useCallback(async () => {
    setScreen('chat')
    setBusy(true)
    try {
      const created = await hermesClient.createSession()
      setRuntimeSession(created.session_id)
      setActiveSession(created.stored_session_id)
      setMessages([{ id: 'welcome', role: 'assistant', text: 'היי, אני כאן. במה נתחיל?' }])
      resetConversation()
    } catch (error) {
      setToast(error instanceof Error ? error.message : 'לא ניתן לפתוח שיחה חדשה', 'error')
    } finally {
      setBusy(false)
    }
  }, [setScreen, setToast])

  // Submit a chat turn with optional attachments. Attachments are staged into
  // the runtime session via the official file/image attach RPCs, then a single
  // prompt.submit consumes them. Returns false (and rolls back the optimistic
  // bubble) on failure so the composer can retain the attachments for retry.
  const sendMessage = useCallback(
    async (text: string, attachments: PendingAttachment[] = []): Promise<boolean> => {
      let sid = runtimeSession
      if (!sid) {
        const created = await hermesClient.createSession()
        sid = created.session_id
        setRuntimeSession(sid)
      }
      const userId = `user-${Date.now()}`
      const chips = attachments.map(item => ({ name: item.name, kind: item.kind }))
      setMessages(current => [
        ...current,
        {
          id: userId,
          role: 'user',
          text,
          timelineOrder: nextTimelineOrder(),
          time: now(),
          attachments: chips.length ? chips : undefined
        }
      ])
      resetConversation()
      setBusy(true)
      try {
        const submitText = await stageAttachments(hermesClient, sid, text, attachments)
        await hermesClient.submit(sid, submitText)
        return true
      } catch (error) {
        setMessages(current => current.filter(message => message.id !== userId))
        setBusy(false)
        setToast(error instanceof Error ? error.message : 'שליחת ההודעה נכשלה', 'error')
        return false
      }
    },
    [runtimeSession, setToast]
  )

  // Guards stop() against a double-fire while an interrupt is already in
  // flight — the stop button stays visible for the whole busy window, so a
  // user can (and does) click it more than once before the first click's
  // request has even reached Hermes.
  const stopInFlight = useRef(false)

  // Deliberately PESSIMISTIC, mirroring respondApproval below: only claim the
  // turn is over once Hermes actually acknowledges the interrupt. The old
  // code set busy=false the instant it *fired* the request, which lied about
  // a turn that was still running server-side whenever the interrupt itself
  // failed (dead session, gateway hiccup) — the composer unblocked and the
  // stop button vanished while Hermes could still be streaming into a UI that
  // claimed nothing was happening.
  //
  // This can never deadlock busy=true, even if Hermes never acks the
  // interrupt at all: handleGatewayEvent (chat-events.ts) already flips busy
  // back to false on its own the moment the turn's `message.complete` or
  // `error` event arrives, completely independent of stop() ever succeeding.
  // So a failed/lost interrupt just means the user sees an error toast and
  // can press Stop again (or simply wait) — busy is always eventually
  // resolved by the gateway's own event stream, never left stuck on this
  // request alone. (The mirror-image race — an ack arriving just as a brand
  // new turn starts — is the same unguarded risk respondApproval already
  // accepts below; neither action carries a turn/session generation token.)
  //
  // Deliberately does NOT touch chat messages: sealing the streaming bubble
  // is chat-events.ts's job on message.complete/error, and there is no
  // contract guarantee Hermes emits one of those after an interrupt ack
  // rather than just going quiet — reaching into setMessages here would risk
  // racing or duplicating with that handler instead of fixing anything.
  const stop = useCallback(async () => {
    if (stopInFlight.current) return
    stopInFlight.current = true
    try {
      await hermesClient.interrupt(runtimeSession)
      setBusy(false)
    } catch {
      // Hebrew, plain, no transport detail — the only fact that matters to
      // the user is that the turn is still running and Stop did not work.
      setToast('לא הצלחנו לעצור את התשובה. אפשר לנסות שוב.', 'error')
    } finally {
      stopInFlight.current = false
    }
  }, [runtimeSession, setToast])

  // Answer the approval gate. The card locks its own buttons on the first
  // click, but that is only UI state — this ref is what actually protects the
  // send: while a response is in flight no second one may reach Hermes, or the
  // same email goes out twice (or a deny chases an approve already on the
  // wire). Resolves false when the answer did NOT land, so the card can unlock
  // itself and stay on screen for a retry instead of silently vanishing — the
  // card reads that value at runtime, since ChatScreen's onApproval prop erases
  // it to void on the way down.
  const approvalInFlight = useRef(false)
  const respondApproval = useCallback(
    async (choice: 'once' | 'deny'): Promise<boolean | void> => {
      if (!approval || approvalInFlight.current) return false
      approvalInFlight.current = true
      try {
        await hermesClient.respondApproval(approval.sessionId, choice)
        setApproval(null)
        setToast(choice === 'once' ? 'הפעולה אושרה' : 'הפעולה נדחתה')
        return true
      } catch {
        // The transport's own failure text is English and technical; the only
        // thing that matters to the user is that nothing was sent yet.
        setToast('לא הצלחנו לשלוח את התשובה. אפשר לנסות שוב.', 'error')
        return false
      } finally {
        approvalInFlight.current = false
      }
    },
    [approval, setToast]
  )

  const respondClarify = useCallback(
    async (answer: string) => {
      if (!clarify) return
      const pending = clarify
      const stamp = Date.now()
      const userId = `clarify-${stamp}`
      const assistantId = `assistant-clarify-${stamp}`

      // Hermes keeps this same turn alive while clarify blocks. Re-anchor the
      // streaming bubble after the user's answer before releasing the gateway,
      // so the continuation cannot land behind the newly appended user row.
      setMessages(current => [
        ...current.flatMap(message => {
          if (message.role !== 'assistant' || !message.streaming) return [message]
          return message.text.trim() ? [{ ...message, streaming: false, time: message.time || now() }] : []
        }),
        { id: userId, role: 'user', text: answer, timelineOrder: nextTimelineOrder(), time: now() },
        { id: assistantId, role: 'assistant', text: '', streaming: true }
      ])
      setClarify(null)
      setBusy(true)
      try {
        await hermesClient.respondClarify(pending.requestId, answer)
      } catch (error) {
        setMessages(current => current.filter(message => message.id !== userId && message.id !== assistantId))
        setClarify(pending)
        setToast(error instanceof Error ? error.message : 'שליחת התשובה ל־Hermes נכשלה', 'error')
      }
    },
    [clarify, setToast]
  )

  // Seed a new conversation by resolving the requested Skill through Hermes'
  // official dispatcher, then submit its expanded message on that same session.
  const beginConversation = useCallback(
    async ({ userMessage, skillName, instruction }: { userMessage: string; skillName: string; instruction: string }) => {
      try {
        await startSkillSession(hermesClient, {
          name: skillName,
          arg: instruction,
          onCreated: created => {
            setScreen('chat')
            setRuntimeSession(created.session_id)
            setActiveSession(created.stored_session_id)
            setMessages([
              {
                id: `seed-${Date.now()}`,
                role: 'user',
                text: userMessage,
                timelineOrder: nextTimelineOrder()
              }
            ])
            resetConversation()
          }
        })
      } catch (error) {
        setBusy(false)
        setToast(error instanceof Error ? error.message : 'שמירת ההיכרות ב־Hermes נכשלה', 'error')
        throw error
      }
    },
    [setScreen, setToast]
  )

  return {
    messages,
    activities,
    approval,
    clarify,
    busy,
    runtimeSession,
    activeSession,
    selectSession,
    newSession,
    sendMessage,
    stop,
    respondApproval,
    respondClarify,
    beginConversation
  }
}
