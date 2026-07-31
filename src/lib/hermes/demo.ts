import type { GatewayEvent, ScheduledTask } from '../../types'
import { DEMO_SESSIONS, DEMO_SKILLS, DEMO_TASKS } from './demo-data'

type Emit = (event: GatewayEvent) => void

export type DemoBackend = {
  rpc<T>(method: string, params: Record<string, unknown>, emit: Emit): Promise<T>
  api<T>(endpoint: string, init?: { method?: string; body?: unknown }): Promise<T>
}

// Self-contained offline stand-in for Hermes. Preserves the exact event timing
// and REST responses the UI was built against so the demo/E2E fallback behaves
// identically to the real client's public surface.
export function createDemoBackend(): DemoBackend {
  let activeDemoSession = 'weekly-leads'

  async function rpc<T>(method: string, params: Record<string, unknown>, emit: Emit): Promise<T> {
    if (method === 'session.list') return { sessions: DEMO_SESSIONS } as T
    if (method === 'session.create') {
      const id = `demo-${Date.now()}`
      activeDemoSession = id
      return { session_id: id, stored_session_id: id, messages: [] } as T
    }
    if (method === 'session.resume') {
      const id = String(params.session_id || activeDemoSession)
      activeDemoSession = id
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
    if (method === 'prompt.submit') {
      const sid = String(params.session_id || activeDemoSession)
      window.setTimeout(() => emit({ type: 'message.start', session_id: sid, payload: {} }), 120)
      window.setTimeout(
        () =>
          emit({
            type: 'tool.start',
            session_id: sid,
            payload: { tool_id: 'tool-1', name: 'google_workspace.gmail_search' }
          }),
        450
      )
      window.setTimeout(
        () =>
          emit({
            type: 'tool.complete',
            session_id: sid,
            payload: { tool_id: 'tool-1', name: 'google_workspace.gmail_search', summary: 'נמצאו 18 לידים' }
          }),
        1_250
      )
      const chunks = [
        'עברתי על הפניות החדשות. ',
        'מצאתי 18 לידים, ומתוכם 6 נראים דחופים במיוחד. ',
        'הייתי מתחיל היום עם דני, נועה וחברת אלומה — לכולם יש בקשה ברורה ותקציב מתאים. ',
        'הכנתי גם טיוטת מייל המשך לדני.'
      ]
      chunks.forEach((chunk, index) => {
        window.setTimeout(
          () => emit({ type: 'message.delta', session_id: sid, payload: { text: chunk } }),
          1_450 + index * 420
        )
      })
      window.setTimeout(
        () =>
          emit({
            type: 'approval.request',
            session_id: sid,
            payload: {
              command: 'gmail send --to dani@example.com',
              reason: 'שליחת טיוטת המשך לדני בנושא הצעת המחיר',
              choices: ['once', 'session', 'deny']
            }
          }),
        3_250
      )
      window.setTimeout(
        () =>
          emit({
            type: 'message.complete',
            session_id: sid,
            payload: { text: chunks.join(''), status: 'complete' }
          }),
        3_420
      )
      return { status: 'streaming' } as T
    }
    return { ok: true } as T
  }

  async function api<T>(endpoint: string, init?: { method?: string; body?: unknown }): Promise<T> {
    await new Promise(resolve => setTimeout(resolve, 180))
    if (endpoint.startsWith('/api/cron/jobs')) {
      if (init?.method === 'POST' && endpoint === '/api/cron/jobs') {
        const body = init.body as Pick<ScheduledTask, 'name' | 'prompt' | 'schedule'>
        DEMO_TASKS.unshift({ id: `task-${Date.now()}`, ...body, enabled: true })
        return { ok: true } as T
      }
      return { jobs: DEMO_TASKS } as T
    }
    if (endpoint.startsWith('/api/skills')) {
      if (init?.method === 'POST') {
        const body = init.body as { name: string; content: string }
        DEMO_SKILLS.unshift({
          name: body.name,
          description: body.content.match(/description:\s*(.+)/)?.[1] || '',
          enabled: true,
          provenance: 'agent',
          usage: 0
        })
        return { ok: true } as T
      }
      return DEMO_SKILLS as T
    }
    if (endpoint === '/api/health') return { ok: true, status: 'healthy' } as T
    if (endpoint === '/api/status') {
      return {
        version: '0.19.0',
        provider: 'openrouter',
        gateway: 'running',
        cron: 'running'
      } as T
    }
    if (endpoint === '/api/providers/oauth?profile=default') {
      return {
        providers: [
          { id: 'openai-codex', name: 'OpenAI Codex', flow: 'device_code', status: { logged_in: true } }
        ]
      } as T
    }
    if (endpoint.includes('/api/providers/oauth/openai-codex/start')) {
      return {
        session_id: 'demo-oauth',
        flow: 'device_code',
        user_code: 'DEMO-CODE',
        verification_url: 'https://chatgpt.com',
        expires_in: 600,
        poll_interval: 1
      } as T
    }
    if (endpoint.includes('/api/providers/oauth/openai-codex/poll/')) {
      return { session_id: 'demo-oauth', status: 'approved' } as T
    }
    if (endpoint.includes('/api/providers/validate')) return { ok: true, reachable: true } as T
    if (endpoint.includes('/api/model/recommended-default')) {
      return { provider: 'openrouter', model: 'anthropic/claude-sonnet-4.5' } as T
    }
    return { ok: true } as T
  }

  return { rpc, api }
}
