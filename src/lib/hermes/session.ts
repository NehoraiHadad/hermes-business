import type { Session } from '../../types'
import type { RpcFn } from './core'

export type { RpcFn }

// Return shapes from Hermes' official attach RPCs (v0.19.x tui_gateway).
export type HermesFileAttachment = {
  attached?: boolean
  name?: string
  path?: string
  ref_path?: string
  ref_text?: string
}
export type HermesImageAttachment = {
  attached?: boolean
  path?: string
  count?: number
  text?: string
}
// pdf.attach renders each page to an image tile; it consumes attached images
// implicitly on the next prompt.submit (no ref text), like image.attach.
export type HermesPdfAttachment = {
  attached?: boolean
  filename?: string
  pages_attached?: number
  count?: number
  text?: string
}

export interface HermesSessions {
  listSessions(): Promise<Session[]>
  createSession(): Promise<{ session_id: string; stored_session_id: string }>
  resumeSession(id: string): Promise<{
    session_id: string
    messages?: Array<{ role: string; content?: string; text?: string }>
  }>
  submit(sessionId: string, text: string): Promise<{ status: string }>
  attachFile(
    sessionId: string,
    file: { path?: string; dataUrl?: string; name?: string }
  ): Promise<HermesFileAttachment>
  attachImage(sessionId: string, path: string): Promise<HermesImageAttachment>
  attachImageBytes(
    sessionId: string,
    image: { content_base64: string; filename?: string }
  ): Promise<HermesImageAttachment>
  attachPdf(
    sessionId: string,
    pdf: { path?: string; contentBase64?: string; filename?: string }
  ): Promise<HermesPdfAttachment>
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
    attachFile(sessionId, file) {
      return rpc<HermesFileAttachment>('file.attach', {
        session_id: sessionId,
        path: file.path,
        data_url: file.dataUrl,
        name: file.name
      })
    },
    attachImage(sessionId, path) {
      return rpc<HermesImageAttachment>('image.attach', { session_id: sessionId, path })
    },
    attachImageBytes(sessionId, image) {
      return rpc<HermesImageAttachment>('image.attach_bytes', {
        session_id: sessionId,
        content_base64: image.content_base64,
        filename: image.filename
      })
    },
    attachPdf(sessionId, pdf) {
      // Exact pdf.attach contract (tui_gateway methods_prompt.py): a host `path`
      // (local mode) or base64 `content_base64` upload, with `filename` naming
      // the base64 variant. The gateway renders each page to a vision tile.
      return rpc<HermesPdfAttachment>('pdf.attach', {
        session_id: sessionId,
        path: pdf.path,
        content_base64: pdf.contentBase64,
        filename: pdf.filename
      })
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
