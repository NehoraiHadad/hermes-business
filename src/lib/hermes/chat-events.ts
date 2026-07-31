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
      ...current.filter(message => !message.streaming),
      { id: `assistant-${Date.now()}`, role: 'assistant', text: '', streaming: true }
    ])
  }
  if (event.type === 'message.delta') {
    setMessages(current =>
      current.map((message, index) =>
        index === current.length - 1 && message.streaming
          ? { ...message, text: `${message.text}${String(payload.text || '')}` }
          : message
      )
    )
  }
  if (event.type === 'message.complete') {
    const finalText = String(payload.text || '')
    setBusy(false)
    setMessages(current =>
      current.map((message, index) =>
        index === current.length - 1 && message.streaming
          ? { ...message, text: finalText || message.text, streaming: false, time: now() }
          : message
      )
    )
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
    setToast(String(payload.message || 'Hermes נתקל בבעיה'))
  }
}
