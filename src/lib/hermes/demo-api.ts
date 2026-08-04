import type { ScheduledTask } from '../../types'
import { DEMO_SKILLS, DEMO_TASKS } from './demo-data'

export function createDemoApi() {
  return async function api<T>(endpoint: string, init?: { method?: string; body?: unknown }): Promise<T> {
    await new Promise(resolve => setTimeout(resolve, 180))
    if (endpoint.startsWith('/api/cron/jobs')) return cronResponse(endpoint, init) as T
    if (endpoint.startsWith('/api/skills')) return skillsResponse(init) as T
    if (endpoint === '/api/health') return { ok: true, status: 'healthy' } as T
    if (endpoint === '/api/status') {
      return { version: '0.19.0', provider: 'openrouter', gateway: 'running', cron: 'running' } as T
    }
    if (endpoint === '/api/providers/oauth?profile=default') {
      // Mirrors the real 0.19.1 catalog shape: all three `flow` kinds, so the
      // dynamic provider list renders every UI branch in demo.
      return {
        providers: [
          {
            id: 'nous',
            name: 'Nous Portal',
            flow: 'device_code',
            cli_command: 'hermes auth add nous',
            docs_url: 'https://portal.nousresearch.com',
            status: { logged_in: false }
          },
          { id: 'openai-codex', name: 'OpenAI Codex', flow: 'device_code', status: { logged_in: true } },
          {
            id: 'qwen-oauth',
            name: 'Qwen (via Qwen CLI)',
            flow: 'external',
            cli_command: 'hermes auth add qwen-oauth',
            docs_url: 'https://github.com/QwenLM/qwen-code',
            status: { logged_in: false }
          },
          { id: 'anthropic', name: 'Anthropic API Key', flow: 'pkce', status: { logged_in: false } }
        ]
      } as T
    }
    if (/\/api\/providers\/oauth\/[^/]+\/start/.test(endpoint)) {
      return {
        session_id: 'demo-oauth',
        flow: 'device_code',
        user_code: 'DEMO-CODE',
        verification_url: 'https://chatgpt.com',
        expires_in: 600,
        poll_interval: 1
      } as T
    }
    if (/\/api\/providers\/oauth\/[^/]+\/poll\//.test(endpoint)) {
      return { session_id: 'demo-oauth', status: 'approved' } as T
    }
    if (endpoint.startsWith('/api/analytics/usage')) {
      const today = /[?&]days=1(&|$)/.test(endpoint)
      return {
        totals: today
          ? { total_api_calls: 4, total_sessions: 2 }
          : { total_api_calls: 87, total_sessions: 23 },
        period_days: today ? 1 : 30
      } as T
    }
    if (endpoint === '/api/credentials/pool') {
      return {
        providers: [
          { provider: 'openai-codex', entries: [{ index: 1, last_status: 'ok', token_preview: 'sk-…demo' }] }
        ]
      } as T
    }
    if (endpoint.startsWith('/api/messaging/whatsapp/onboarding')) return whatsappResponse(endpoint, init) as T
    if (endpoint.includes('/api/providers/validate')) return { ok: true, reachable: true } as T
    if (endpoint.includes('/api/model/recommended-default')) {
      if (endpoint.includes('provider=nous')) {
        // Hermes picks a free model for free-tier accounts server-side.
        return { provider: 'nous', model: 'Hermes-4-70B', free_tier: true } as T
      }
      return { provider: 'openrouter', model: 'anthropic/claude-sonnet-4.5' } as T
    }
    return { ok: true } as T
  }
}

function cronResponse(endpoint: string, init?: { method?: string; body?: unknown }) {
  const method = init?.method || 'GET'
  if (method === 'POST' && endpoint.startsWith('/api/cron/jobs')) {
    const trigger = endpoint.match(/\/api\/cron\/jobs\/([^/?]+)\/trigger/)
    if (trigger) return { ok: true, triggered: decodeURIComponent(trigger[1]) }
    if (endpoint.startsWith('/api/cron/jobs?')) {
      const body = init?.body as Pick<ScheduledTask, 'name' | 'prompt' | 'schedule'>
      DEMO_TASKS.unshift({ id: `task-${Date.now()}`, ...body, enabled: true })
      return { ok: true }
    }
    return { ok: true }
  }
  const jobMatch = endpoint.match(/\/api\/cron\/jobs\/([^/?]+)/)
  if (method === 'PUT' && jobMatch) {
    const id = decodeURIComponent(jobMatch[1])
    const updates = (init?.body as { updates?: Partial<ScheduledTask> })?.updates || {}
    const job = DEMO_TASKS.find(task => task.id === id)
    if (job) Object.assign(job, updates)
    return { ok: true }
  }
  if (method === 'DELETE' && jobMatch) {
    const id = decodeURIComponent(jobMatch[1])
    const index = DEMO_TASKS.findIndex(task => task.id === id)
    if (index >= 0) DEMO_TASKS.splice(index, 1)
    return { ok: true }
  }
  return { jobs: DEMO_TASKS }
}

function skillsResponse(init?: { method?: string; body?: unknown }) {
  if (init?.method === 'POST') {
    const body = init.body as { name: string; content: string }
    DEMO_SKILLS.unshift({
      name: body.name,
      description: body.content.match(/description:\s*(.+)/)?.[1] || '',
      enabled: true,
      provenance: 'agent',
      usage: 0
    })
    return { ok: true }
  }
  return DEMO_SKILLS
}

function whatsappResponse(endpoint: string, init?: { method?: string; body?: unknown }) {
  const expiresAt = new Date(Date.now() + 120_000).toISOString()
  if (endpoint.endsWith('/start')) {
    return {
      pairing_id: 'demo-pair',
      status: 'waiting',
      qr_payload: 'demo-whatsapp-qr-payload',
      expires_at: expiresAt,
      mode: (init?.body as { mode?: string })?.mode || 'bot'
    }
  }
  if (endpoint.endsWith('/apply')) return { ok: true, platform: 'whatsapp' }
  if (init?.method === 'DELETE') return { ok: true }
  return {
    pairing_id: 'demo-pair',
    status: 'connected',
    expires_at: expiresAt,
    mode: 'bot',
    account_phone: '+972500000000'
  }
}
