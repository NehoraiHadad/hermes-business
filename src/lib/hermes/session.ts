import type { Session } from '../../types'

export type RpcFn = <T>(method: string, params?: Record<string, unknown>) => Promise<T>

export interface HermesSessions {
  listSessions(): Promise<Session[]>
  createSession(): Promise<{ session_id: string; stored_session_id: string }>
  resumeSession(id: string): Promise<{
    session_id: string
    messages?: Array<{ role: string; content?: string; text?: string }>
  }>
  submit(sessionId: string, text: string): Promise<{ status: string }>
  interrupt(sessionId: string): Promise<unknown>
  respondApproval(sessionId: string, choice: 'once' | 'session' | 'always' | 'deny'): Promise<unknown>
  respondClarify(requestId: string, answer: string): Promise<unknown>
}

// Session and prompt operations expressed over the RPC transport. Grouped
// together because they share the interactive conversation lifecycle.
export function createHermesSessions(rpc: RpcFn): HermesSessions {
  return {
    async listSessions() {
      const result = await rpc<{ sessions: Session[] }>('session.list', { limit: 100 })
      return result.sessions || []
    },
    createSession() {
      return rpc<{ session_id: string; stored_session_id: string }>('session.create', {
        source: 'desktop',
        cols: 96
      })
    },
    resumeSession(id) {
      return rpc('session.resume', { session_id: id, cols: 96 })
    },
    submit(sessionId, text) {
      return rpc<{ status: string }>('prompt.submit', { session_id: sessionId, text })
    },
    interrupt(sessionId) {
      return rpc('session.interrupt', { session_id: sessionId })
    },
    respondApproval(sessionId, choice) {
      return rpc('approval.respond', { session_id: sessionId, choice })
    },
    respondClarify(requestId, answer) {
      return rpc('clarify.respond', { request_id: requestId, answer })
    }
  }
}
