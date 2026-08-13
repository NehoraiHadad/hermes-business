import type { DemoEmit, DemoState } from './demo'
import { DEMO_SESSIONS, DEMO_TRANSCRIPTS } from './demo-data'
import {
  buildApprovalFollowUpEvents,
  buildScenarioEvents,
  findDemoScenario,
  matchDemoScenario,
  type DemoScheduledEvent
} from './demo-scenarios'

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
      // Per-session transcript, or honestly empty for ids without one (sessions the
      // demo user created live) — never another conversation's history.
      return { session_id: id, messages: DEMO_TRANSCRIPTS[id] ?? [] } as T
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
    if (method === 'approval.respond') return respondDemoApproval(state, params, emit) as Promise<T>
    if (method === 'prompt.submit') return submitDemoPrompt(state, params, emit) as Promise<T>
    return { ok: true } as T
  }
}

// The staggered delays are what make the demo read like a live answer rather than a
// paste; the scripted timing itself lives in demo-scenarios.
function play(events: DemoScheduledEvent[], emit: DemoEmit) {
  events.forEach(({ delay, event }) => window.setTimeout(() => emit(event), delay))
}

async function submitDemoPrompt(state: DemoState, params: Record<string, unknown>, emit: DemoEmit) {
  const sessionId = String(params.session_id || state.activeSession || 'weekly-leads')
  const scenario = matchDemoScenario(String(params.text || ''))
  state.pendingApproval = scenario.approval ? scenario.id : null
  play(buildScenarioEvents(scenario, sessionId), emit)
  return { status: 'streaming' }
}

async function respondDemoApproval(state: DemoState, params: Record<string, unknown>, emit: DemoEmit) {
  const scenario = state.pendingApproval ? findDemoScenario(state.pendingApproval) : null
  if (!scenario) return { ok: true }
  state.pendingApproval = null
  const sessionId = String(params.session_id || state.activeSession || 'weekly-leads')
  play(buildApprovalFollowUpEvents(scenario, String(params.choice || 'deny'), sessionId), emit)
  return { ok: true }
}
