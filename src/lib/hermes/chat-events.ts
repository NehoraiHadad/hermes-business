import type { Dispatch, SetStateAction } from 'react'
import { approvalCopy, humanizeTool } from '../presentation'
import type { Activity, Approval, ChatMessage, ClarifyRequest, GatewayEvent } from '../../types'

export const now = () => new Date().toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })

export type ChatStreamSetters = {
  setBusy: Dispatch<SetStateAction<boolean>>
  setMessages: Dispatch<SetStateAction<ChatMessage[]>>
  setActivities: Dispatch<SetStateAction<Activity[]>>
  setApproval: Dispatch<SetStateAction<Approval | null>>
  setClarify: Dispatch<SetStateAction<ClarifyRequest | null>>
  setToast: (toast: string) => void
}

function lastStreamingAssistant(messages: ChatMessage[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === 'assistant' && messages[index].streaming) return index
  }
  return -1
}

function sealOrDiscardStreaming(message: ChatMessage): ChatMessage[] {
  if (!message.streaming) return [message]
  return message.text.trim() ? [{ ...message, streaming: false, time: message.time || now() }] : []
}

function appendAssistantDelta(messages: ChatMessage[], text: string): ChatMessage[] {
  if (!text) return messages
  const index = lastStreamingAssistant(messages)
  if (index < 0) {
    return [...messages, { id: `assistant-${Date.now()}`, role: 'assistant', text, streaming: true }]
  }

  const updated = { ...messages[index], text: `${messages[index].text}${text}` }
  if (index === messages.length - 1) {
    return messages.map((message, current) => (current === index ? updated : message))
  }

  // A clarify answer is inserted while the same Hermes turn is still alive.
  // Move the live assistant bubble after that user answer so continued deltas
  // retain their chronological position instead of being silently dropped.
  return [...messages.slice(0, index), ...messages.slice(index + 1), updated]
}

function completeAssistant(messages: ChatMessage[], text: string, responsePreviewed = false): ChatMessage[] {
  if (responsePreviewed) {
    const settled = messages.flatMap(sealOrDiscardStreaming)
    if (!text.trim()) return settled
    const latestAssistant = [...settled].reverse().find(message => message.role === 'assistant')
    if (latestAssistant?.text.trim() === text.trim()) return settled
  }

  const index = lastStreamingAssistant(messages)
  if (index < 0) {
    return text
      ? [
          ...messages,
          {
            id: `assistant-${Date.now()}`,
            role: 'assistant',
            text,
            streaming: false,
            time: now()
          }
        ]
      : messages
  }

  const completed: ChatMessage = {
    ...messages[index],
    text: text || messages[index].text,
    streaming: false,
    time: now()
  }
  const remaining = messages.flatMap((message, current) =>
    current === index ? [] : sealOrDiscardStreaming(message)
  )

  return [...remaining, completed]
}

// Reduces a single Hermes gateway event into chat state. Extracted from useChat so
// the (large) streaming/tool/approval/clarify wiring lives in one testable place
// while the hook keeps only the session lifecycle actions.
export function handleGatewayEvent(event: GatewayEvent, runtimeSession: string, setters: ChatStreamSetters) {
  if (event.session_id && event.session_id !== runtimeSession) return
  const payload = event.payload || {}
  const { setBusy, setMessages, setActivities, setApproval, setClarify, setToast } = setters

  if (event.type === 'message.start') {
    setBusy(true)
    setMessages(current => [
      ...current.flatMap(sealOrDiscardStreaming),
      { id: `assistant-${Date.now()}`, role: 'assistant', text: '', streaming: true }
    ])
  }
  if (event.type === 'message.delta') {
    setMessages(current => appendAssistantDelta(current, String(payload.text || '')))
  }
  if (event.type === 'message.interim') {
    const interimText = String(payload.text || '')
    if (interimText.trim()) {
      setMessages(current => [
        ...completeAssistant(current, interimText),
        { id: `assistant-${Date.now()}-continuation`, role: 'assistant', text: '', streaming: true }
      ])
    }
  }
  if (event.type === 'message.complete') {
    const finalText = String(
      payload.text || payload.rendered || (payload.status === 'error' ? payload.error : '') || ''
    )
    setBusy(false)
    setMessages(current => completeAssistant(current, finalText, Boolean(payload.response_previewed)))
  }
  if (event.type === 'tool.start') {
    const tool = String(payload.name || '')
    setActivities(current => [
      ...current,
      { id: String(payload.tool_id || Date.now()), tool, label: humanizeTool(tool), status: 'running' }
    ])
  }
  if (event.type === 'tool.complete') {
    const id = String(payload.tool_id || '')
    setActivities(current =>
      current.map(item =>
        item.id === id ? { ...item, status: 'done', detail: String(payload.summary || 'הושלם') } : item
      )
    )
  }
  if (event.type === 'status.update') {
    const text = String(payload.text || '')
    if (text) {
      setActivities(current => [
        ...current.filter(item => !item.id.startsWith('status-')),
        { id: `status-${Date.now()}`, tool: 'status', label: text, status: 'running' }
      ])
    }
  }
  if (event.type === 'approval.request') {
    const copy = approvalCopy(payload)
    setApproval({
      id: `approval-${Date.now()}`,
      sessionId: event.session_id || runtimeSession,
      title: copy.title,
      description: copy.description,
      command: payload.command ? String(payload.command) : undefined,
      choices: Array.isArray(payload.choices) ? payload.choices.map(String) : ['once', 'deny']
    })
  }
  if (event.type === 'clarify.request') {
    setClarify({
      requestId: String(payload.request_id || ''),
      sessionId: event.session_id || runtimeSession,
      question: String(payload.question || 'מה חשוב שאדע כדי להמשיך?'),
      choices: Array.isArray(payload.choices) ? payload.choices.map(String) : [],
      multiSelect: Boolean(payload.multi_select)
    })
  }
  if (event.type === 'clarify.expire') {
    setClarify(current => (current?.requestId === String(payload.request_id || '') ? null : current))
  }
  if (event.type === 'error') {
    setBusy(false)
    setMessages(current => current.flatMap(sealOrDiscardStreaming))
    setToast(String(payload.message || 'Hermes נתקל בבעיה'))
  }
}
