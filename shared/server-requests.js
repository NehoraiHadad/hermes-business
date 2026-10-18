// Native Hermes server→client JSON-RPC, normalized to Tachles' existing card
// model. These card events are internal; no legacy *.respond RPC is sent.
// Self-contained so the exact-artifact driver can execute this same class.
export class HermesServerRequests {
  constructor(send, emit) {
    this.send = send
    this.emit = emit
    this.pending = new Map()
  }

  advertise() {
    this.send({ jsonrpc: '2.0', method: 'client.capabilities', params: { server_requests: true } })
  }

  accept(frame) {
    if (frame.id == null || !frame.method) return false
    if (!['approval', 'clarify'].includes(frame.method)) {
      this.send({ jsonrpc: '2.0', id: frame.id, error: { code: -32601, message: 'Unsupported client request' } })
      return true
    }
    if (typeof frame.params?.session_id !== 'string' ||
        (frame.method === 'clarify' && (!Array.isArray(frame.params.questions) ||
          !frame.params.questions.length || frame.params.questions.some(item => typeof item.qid !== 'string')))) {
      this.send({ jsonrpc: '2.0', id: frame.id, error: { code: -32602, message: 'Invalid client request' } })
      return true
    }
    const id = String(frame.id)
    if (this.pending.has(id)) return true
    const request = { ...frame, id, answers: { ...frame.params?.answers } }
    this.pending.set(id, request)
    const first = [...this.pending.values()].find(item =>
      item.method === request.method && item.params.session_id === request.params.session_id)
    if (first === request) this.show(request)
    return true
  }

  show(request) {
    const params = request.params || {}
    if (request.method === 'approval') {
      this.emit({ type: 'approval.request', session_id: params.session_id,
        payload: { ...params, request_id: request.id } })
      return
    }
    const question = params.questions?.find(item => !(item.qid in request.answers))
    if (question) {
      this.emit({ type: 'clarify.request', session_id: params.session_id,
        payload: { ...question, request_id: `${request.id}:${question.qid}` } })
    }
  }

  respond(displayId, result) {
    const id = String(displayId).split(':')[0]
    const request = this.pending.get(id)
    if (!request) throw new Error('This Hermes request is no longer open')
    let answer = result
    if (request.method === 'clarify') {
      const question = request.params.questions.find(item => `${id}:${item.qid}` === displayId)
      if (!question || question.qid in request.answers) throw new Error('This question is no longer open')
      const answers = { ...request.answers, [question.qid]: result.answer }
      if (request.params.questions.some(item => !(item.qid in answers))) {
        request.answers = answers
        this.show(request)
        return
      }
      answer = { answers }
    }
    // Only forget after send succeeds. A synchronous send failure can be retried.
    this.send({ jsonrpc: '2.0', id, result: answer })
    this.pending.delete(id)
    this.promote(request)
  }

  promote(previous) {
    const next = [...this.pending.values()].find(item => item.method === previous.method &&
      item.params.session_id === previous.params.session_id)
    if (next) this.show(next)
  }

  cancel(payload) {
    const id = String(payload.id || '')
    const request = this.pending.get(id)
    this.pending.delete(id)
    this.emit({ type: 'request.cancel', session_id: request?.params?.session_id,
      payload: { ...payload, id } })
    if (request) this.promote(request)
  }

  replay(result) {
    if (!Array.isArray(result?.open_requests)) return
    const ids = new Set(result.open_requests.map(frame => String(frame.id)))
    for (const [id, pending] of this.pending) {
      if (pending.params.session_id === result.session_id && !ids.has(id)) this.cancel({ id, reason: 'settled' })
    }
    const shown = new Set()
    for (const frame of result.open_requests) {
      const existing = this.pending.has(String(frame.id))
      this.accept(frame)
      const key = `${frame.method}:${frame.params?.session_id}`
      if (existing && !shown.has(key)) {
        const first = [...this.pending.values()].find(item => item.method === frame.method &&
          item.params.session_id === frame.params.session_id)
        if (first) this.show(first)
      }
      shown.add(key)
    }
  }

  reset() {
    for (const id of [...this.pending.keys()]) this.cancel({ id, reason: 'disconnected' })
  }
}
