import type { GatewayEvent, ScheduledTask, Session, Skill } from '../types'
import { buildSkillContent } from './skill-content'
import { normalizeScheduledTask } from './hermes-shapes'
import type { HermesMessagingPlatform } from './connections'

export type HermesUpdateStatus = {
  install_method?: string
  current_version?: string
  behind?: number | null
  update_available?: boolean
  can_apply?: boolean
  message?: string | null
}

type EventListener = (event: GatewayEvent) => void
type Pending = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

const DEMO_SESSIONS: Session[] = [
  {
    id: 'weekly-leads',
    title: 'סיכום לידים שבועי',
    preview: 'סיכמתי את 18 הלידים החדשים וחילקתי לפי דחיפות…',
    started_at: Date.now() / 1000 - 1_800,
    message_count: 12,
    source: 'desktop'
  },
  {
    id: 'tomorrow-calendar',
    title: 'הכנה לפגישות מחר',
    preview: 'יש לך שלוש פגישות. הכנתי נקודות רקע לכל אחת.',
    started_at: Date.now() / 1000 - 86_400,
    message_count: 8,
    source: 'telegram'
  },
  {
    id: 'client-followup',
    title: 'מעקב אחרי הצעת מחיר',
    preview: 'ניסחתי הודעת המשך לדני, ממתין לאישור שלך.',
    started_at: Date.now() / 1000 - 172_800,
    message_count: 6,
    source: 'desktop'
  },
  {
    id: 'content-plan',
    title: 'תוכנית תוכן לאוגוסט',
    preview: 'בנינו יחד תוכנית של 8 פרסומים לחודש הבא.',
    started_at: Date.now() / 1000 - 345_600,
    message_count: 21,
    source: 'cli'
  }
]

const DEMO_TASKS: ScheduledTask[] = [
  {
    id: 'morning-summary',
    name: 'סיכום בוקר',
    prompt: 'סכם את הפגישות, המיילים החשובים והמשימות להיום.',
    schedule: '0 8 * * 0-4',
    enabled: true,
    deliver: 'telegram',
    last_run: 'היום, 08:00',
    next_run: 'מחר, 08:00'
  },
  {
    id: 'weekly-leads-task',
    name: 'סיכום לידים שבועי',
    prompt: 'הכן סיכום של הלידים החדשים והצע למי לחזור קודם.',
    schedule: '0 16 * * 4',
    enabled: true,
    deliver: 'local',
    last_run: 'יום ה׳, 16:00',
    next_run: 'יום ה׳ הבא, 16:00'
  },
  {
    id: 'invoice-followup',
    name: 'בדיקת חשבוניות פתוחות',
    prompt: 'בדוק אילו חשבוניות עברו את תאריך התשלום והכן טיוטות מעקב.',
    schedule: '0 9 * * 1',
    enabled: false,
    deliver: 'local',
    last_run: 'לפני שבוע',
    next_run: null
  }
]

const DEMO_SKILLS: Skill[] = [
  {
    name: 'google-workspace',
    description: 'Gmail, Calendar, Drive, Docs ו־Sheets',
    enabled: true,
    provenance: 'bundled',
    usage: 24
  },
  {
    name: 'weekly-lead-summary',
    description: 'מסכם לידים לפי מקור, דחיפות ושלב בתהליך המכירה',
    enabled: true,
    provenance: 'agent',
    usage: 6
  },
  {
    name: 'business-context',
    description: 'היכרות עם העסק, ההעדפות והמגבלות שלך',
    enabled: true,
    provenance: 'agent',
    usage: 18
  },
  {
    name: 'research',
    description: 'חיפוש, אימות וסיכום מידע ממקורות ברשת',
    enabled: true,
    provenance: 'bundled',
    usage: 11
  }
]

export class HermesClient {
  readonly demo: boolean
  private socket: WebSocket | null = null
  private listeners = new Set<EventListener>()
  private pending = new Map<string, Pending>()
  private nextId = 0
  private activeDemoSession = 'weekly-leads'

  constructor() {
    this.demo = !window.hermesDesktop || new URLSearchParams(window.location.search).get('demo') === '1'
  }

  async boot() {
    if (this.demo) {
      return {
        installed: true,
        running: true,
        starting: false,
        mode: 'demo',
        version: '0.19.0',
        error: null,
        wsUrl: ''
      } satisfies HermesRuntime
    }
    const runtime = await window.hermesDesktop!.startRuntime()
    if (runtime.running) await this.connect(runtime.wsUrl)
    return runtime
  }

  onEvent(listener: EventListener) {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private emit(event: GatewayEvent) {
    this.listeners.forEach(listener => listener(event))
  }

  async connect(wsUrl: string) {
    if (this.socket?.readyState === WebSocket.OPEN) return
    this.socket = new WebSocket(wsUrl)
    await new Promise<void>((resolve, reject) => {
      const socket = this.socket!
      const timer = window.setTimeout(() => reject(new Error('Hermes connection timed out')), 15_000)
      socket.addEventListener(
        'open',
        () => {
          window.clearTimeout(timer)
          resolve()
        },
        { once: true }
      )
      socket.addEventListener(
        'error',
        () => {
          window.clearTimeout(timer)
          reject(new Error('Could not connect to Hermes'))
        },
        { once: true }
      )
      socket.addEventListener('message', message => {
        try {
          const frame = JSON.parse(String(message.data))
          if (frame.id != null) {
            const pending = this.pending.get(String(frame.id))
            if (!pending) return
            clearTimeout(pending.timer)
            this.pending.delete(String(frame.id))
            if (frame.error) pending.reject(new Error(frame.error.message || 'Hermes RPC failed'))
            else pending.resolve(frame.result)
          } else if (frame.method === 'event' && frame.params?.type) {
            this.emit(frame.params)
          }
        } catch {
          // Ignore malformed frames from unrelated dev tooling.
        }
      })
    })
  }

  async rpc<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    if (this.demo) return this.demoRpc<T>(method, params)
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error('Hermes is not connected')
    }
    const id = `business-${++this.nextId}`
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Hermes request timed out: ${method}`))
      }, 120_000)
      this.pending.set(id, { resolve: value => resolve(value as T), reject, timer })
      this.socket!.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }))
    })
  }

  async api<T>(endpoint: string, init?: { method?: string; body?: unknown }): Promise<T> {
    if (this.demo) return this.demoApi<T>(endpoint, init)
    return window.hermesDesktop!.api<T>(endpoint, init)
  }

  async listSessions(): Promise<Session[]> {
    const result = await this.rpc<{ sessions: Session[] }>('session.list', { limit: 100 })
    return result.sessions || []
  }

  async createSession(): Promise<{ session_id: string; stored_session_id: string }> {
    const result = await this.rpc<{ session_id: string; stored_session_id: string }>('session.create', {
      source: 'desktop',
      cols: 96
    })
    if (this.demo) this.activeDemoSession = result.session_id
    return result
  }

  async resumeSession(id: string) {
    const result = await this.rpc<{
      session_id: string
      messages?: Array<{ role: string; content?: string; text?: string }>
    }>('session.resume', { session_id: id, cols: 96 })
    if (this.demo) this.activeDemoSession = result.session_id
    return result
  }

  async submit(sessionId: string, text: string) {
    return this.rpc<{ status: string }>('prompt.submit', { session_id: sessionId, text })
  }

  async interrupt(sessionId: string) {
    return this.rpc('session.interrupt', { session_id: sessionId })
  }

  async respondApproval(sessionId: string, choice: 'once' | 'session' | 'always' | 'deny') {
    return this.rpc('approval.respond', { session_id: sessionId, choice })
  }

  async respondClarify(requestId: string, answer: string) {
    return this.rpc('clarify.respond', { request_id: requestId, answer })
  }

  async listTasks(): Promise<ScheduledTask[]> {
    const result = await this.api<{ jobs?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>>(
      '/api/cron/jobs?profile=default'
    )
    const jobs = Array.isArray(result) ? result : result.jobs || []
    return jobs.map(normalizeScheduledTask)
  }

  async listMessagingPlatforms(): Promise<HermesMessagingPlatform[]> {
    const result = await this.api<{ platforms?: HermesMessagingPlatform[] }>(
      '/api/messaging/platforms?profile=default'
    )
    return Array.isArray(result.platforms) ? result.platforms : []
  }

  async testMessagingPlatform(id: string) {
    return this.api<{ ok?: boolean; state?: string; message?: string }>(
      `/api/messaging/platforms/${encodeURIComponent(id)}/test?profile=default`,
      { method: 'POST' }
    )
  }

  async connectTelegram(token: string, userId: string) {
    await this.api('/api/messaging/platforms/telegram?profile=default', {
      method: 'PUT',
      body: {
        enabled: true,
        env: { TELEGRAM_BOT_TOKEN: token, TELEGRAM_ALLOWED_USERS: userId },
        clear_env: []
      }
    })
    await this.api('/api/gateway/restart?profile=default', { method: 'POST' })
    let verification: { ok?: boolean; state?: string; message?: string } = {}
    for (let attempt = 0; attempt < 20; attempt += 1) {
      verification = await this.testMessagingPlatform('telegram')
      if (verification.ok) return verification
      if (['not_configured', 'startup_failed', 'disabled'].includes(String(verification.state))) break
      await new Promise(resolve => window.setTimeout(resolve, 1000))
    }
    throw new Error(
      verification.message ||
        'Hermes שמר את הפרטים, אבל Telegram עדיין לא דיווח על חיבור פעיל. בדוק את ה־token ונסה שוב.'
    )
  }

  async healthCheck() {
    const [health, status] = await Promise.all([
      this.api<{ ok?: boolean }>('/api/health'),
      this.api<Record<string, unknown>>('/api/status')
    ])
    return { health, status }
  }

  async checkUpdate(force = false) {
    return this.api<HermesUpdateStatus>(`/api/hermes/update/check?force=${force ? 'true' : 'false'}`)
  }

  async startUpdate() {
    return this.api<{ ok?: boolean; message?: string }>('/api/hermes/update', { method: 'POST' })
  }

  async updateActionStatus() {
    return this.api<{ running?: boolean; exit_code?: number | null }>(
      '/api/actions/hermes-update/status?lines=20'
    )
  }

  async createTask(task: Pick<ScheduledTask, 'name' | 'prompt' | 'schedule'>) {
    return this.api('/api/cron/jobs?profile=default', {
      method: 'POST',
      body: { ...task, deliver: 'local' }
    })
  }

  async toggleTask(task: ScheduledTask) {
    return this.api(
      `/api/cron/jobs/${encodeURIComponent(task.id)}/${task.enabled ? 'pause' : 'resume'}?profile=default`,
      { method: 'POST' }
    )
  }

  async listSkills(): Promise<Skill[]> {
    return this.api<Skill[]>('/api/skills?profile=default')
  }

  async createSkill(name: string, description: string) {
    const content = buildSkillContent(name, description)
    return this.api('/api/skills', {
      method: 'POST',
      body: { name, content, category: 'business', profile: 'default' }
    })
  }

  async connectProvider(provider: string, apiKey: string) {
    const keys: Record<string, string> = {
      openrouter: 'OPENROUTER_API_KEY',
      anthropic: 'ANTHROPIC_API_KEY',
      gemini: 'GEMINI_API_KEY',
      openai: 'OPENAI_API_KEY'
    }
    const key = keys[provider]
    if (!key) throw new Error('Provider is not supported by this quick setup')
    const validation = await this.api<{ ok: boolean; reachable: boolean; message?: string }>('/api/providers/validate', {
      method: 'POST',
      body: { key, value: apiKey }
    })
    if (!validation.ok && validation.reachable) throw new Error(validation.message || 'The API key was rejected')
    await this.api('/api/env', { method: 'PUT', body: { key, value: apiKey } })
    const recommended = await this.api<{ model: string }>(
      `/api/model/recommended-default?provider=${encodeURIComponent(provider)}`
    )
    if (recommended.model) {
      await this.api('/api/model/set', {
        method: 'POST',
        body: { scope: 'main', provider, model: recommended.model, confirm_expensive_model: true }
      })
    }
    return { ok: true, model: recommended.model }
  }

  private async demoRpc<T>(method: string, params: Record<string, unknown>): Promise<T> {
    if (method === 'session.list') return { sessions: DEMO_SESSIONS } as T
    if (method === 'session.create') {
      const id = `demo-${Date.now()}`
      return { session_id: id, stored_session_id: id, messages: [] } as T
    }
    if (method === 'session.resume') {
      const id = String(params.session_id || this.activeDemoSession)
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
      const sid = String(params.session_id || this.activeDemoSession)
      window.setTimeout(() => this.emit({ type: 'message.start', session_id: sid, payload: {} }), 120)
      window.setTimeout(
        () =>
          this.emit({
            type: 'tool.start',
            session_id: sid,
            payload: { tool_id: 'tool-1', name: 'google_workspace.gmail_search' }
          }),
        450
      )
      window.setTimeout(
        () =>
          this.emit({
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
          () => this.emit({ type: 'message.delta', session_id: sid, payload: { text: chunk } }),
          1_450 + index * 420
        )
      })
      window.setTimeout(
        () =>
          this.emit({
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
          this.emit({
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

  private async demoApi<T>(endpoint: string, init?: { method?: string; body?: unknown }): Promise<T> {
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
    if (endpoint.includes('/api/providers/validate')) return { ok: true, reachable: true } as T
    if (endpoint.includes('/api/model/recommended-default')) {
      return { provider: 'openrouter', model: 'anthropic/claude-sonnet-4.5' } as T
    }
    return { ok: true } as T
  }
}

export const hermesClient = new HermesClient()
