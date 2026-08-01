import type { DemoEmit, DemoState } from './demo'
import { DEMO_SESSIONS } from './demo-data'

export function createDemoRpc(state: DemoState) {
  return async function rpc<T>(method: string, params: Record<string, unknown>, emit: DemoEmit): Promise<T> {
    if (method === 'session.list') return { sessions: DEMO_SESSIONS } as T
    if (method === 'session.create') {
      const id = `demo-${Date.now()}`
      state.activeSession = id
      return { session_id: id, stored_session_id: id, messages: [] } as T
    }
    if (method === 'session.resume') {
      const id = String(params.session_id || state.activeSession)
      state.activeSession = id
      return {
        session_id: id,
        messages: [
          { role: 'user', content: 'תכין לי סיכום קצר של הלידים החדשים השבוע' },
          {
            role: 'assistant',
            content:
              'בשמחה. עברתי על הלידים החדשים: 18 פניות בסך הכול, מתוכן 6 חמות שכדאי לחזור אליהן עוד היום. רוצה שאכין גם הודעות המשך?'
          }
        ]
      } as T
    }
    if (method === 'file.attach') {
      const name = String(params.name || 'file')
      return { attached: true, name, path: String(params.path || ''), ref_text: `@file:${name}` } as T
    }
    if (method === 'image.attach' || method === 'image.attach_bytes') {
      return { attached: true, count: 1, text: '', path: String(params.path || '') } as T
    }
    if (method === 'pdf.attach') {
      const filename = String(params.filename || 'uploaded.pdf')
      return { attached: true, filename, pages_attached: 1, count: 1, text: '' } as T
    }
    if (method === 'command.dispatch') {
      const name = String(params.name || '')
      return { type: 'skill', name, message: String(params.arg || ''), display: `/${name}` } as T
    }
    if (method === 'prompt.submit') return submitDemoPrompt(params, emit) as Promise<T>
    return { ok: true } as T
  }
}

async function submitDemoPrompt(params: Record<string, unknown>, emit: DemoEmit) {
  const sessionId = String(params.session_id || 'weekly-leads')
  const later = (delay: number, event: Parameters<DemoEmit>[0]) => window.setTimeout(() => emit(event), delay)
  later(120, { type: 'message.start', session_id: sessionId, payload: {} })
  later(450, {
    type: 'tool.start',
    session_id: sessionId,
    payload: { tool_id: 'tool-1', name: 'google_workspace.gmail_search' }
  })
  later(1_250, {
    type: 'tool.complete',
    session_id: sessionId,
    payload: { tool_id: 'tool-1', name: 'google_workspace.gmail_search', summary: 'נמצאו 18 לידים' }
  })
  const chunks = [
    'עברתי על הפניות החדשות. ',
    'מצאתי 18 לידים, ומתוכם 6 נראים דחופים במיוחד. ',
    'הייתי מתחיל היום עם דני, נועה וחברת אלומה — לכולם יש בקשה ברורה ותקציב מתאים. ',
    'הכנתי גם טיוטת מייל המשך לדני.'
  ]
  chunks.forEach((text, index) => {
    later(1_450 + index * 420, { type: 'message.delta', session_id: sessionId, payload: { text } })
  })
  later(3_250, {
    type: 'approval.request',
    session_id: sessionId,
    payload: {
      command: 'gmail send --to dani@example.com',
      reason: 'שליחת טיוטת המשך לדני בנושא הצעת המחיר',
      choices: ['once', 'session', 'deny']
    }
  })
  later(3_420, {
    type: 'message.complete',
    session_id: sessionId,
    payload: { text: chunks.join(''), status: 'complete' }
  })
  return { status: 'streaming' }
}
