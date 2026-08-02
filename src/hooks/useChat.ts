import { useCallback, useEffect, useState } from 'react'
import { hermesClient } from '../lib/hermes-client'
import { handleGatewayEvent, now } from '../lib/hermes/chat-events'
import { stageAttachments, type PendingAttachment } from '../lib/hermes/attachments'
import { startSkillSession } from '../lib/hermes/skill-session'
import type { Activity, Approval, ChatMessage, ClarifyRequest, Screen, Session } from '../types'

// Owns the live conversation: streaming messages, tool activity, approvals and
// clarify requests driven by the Hermes event stream, plus the actions that
// start/resume/submit sessions. The per-event reducer lives in ../lib/hermes/
// chat-events so this hook stays focused on session lifecycle.
export function useChat({ setScreen, setToast }: { setScreen: (screen: Screen) => void; setToast: (toast: string) => void }) {
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
        setToast
      })
    )
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
      setToast(error instanceof Error ? error.message : 'לא ניתן לפתוח שיחה חדשה')
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
        { id: userId, role: 'user', text, time: now(), attachments: chips.length ? chips : undefined }
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
        setToast(error instanceof Error ? error.message : 'שליחת ההודעה נכשלה')
        return false
      }
    },
    [runtimeSession, setToast]
  )

  const stop = useCallback(() => {
    void hermesClient.interrupt(runtimeSession)
    setBusy(false)
  }, [runtimeSession])

  const respondApproval = useCallback(
    async (choice: 'once' | 'deny') => {
      if (!approval) return
      await hermesClient.respondApproval(approval.sessionId, choice)
      setApproval(null)
      setToast(choice === 'once' ? 'הפעולה אושרה' : 'הפעולה נדחתה')
      window.setTimeout(() => setToast(''), 2500)
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
        { id: userId, role: 'user', text: answer, time: now() },
        { id: assistantId, role: 'assistant', text: '', streaming: true }
      ])
      setClarify(null)
      setBusy(true)
      try {
        await hermesClient.respondClarify(pending.requestId, answer)
      } catch (error) {
        setMessages(current => current.filter(message => message.id !== userId && message.id !== assistantId))
        setClarify(pending)
        setToast(error instanceof Error ? error.message : 'שליחת התשובה ל־Hermes נכשלה')
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
            setMessages([{ id: `seed-${Date.now()}`, role: 'user', text: userMessage }])
          }
        })
      } catch (error) {
        setBusy(false)
        setToast(error instanceof Error ? error.message : 'שמירת ההיכרות ב־Hermes נכשלה')
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
