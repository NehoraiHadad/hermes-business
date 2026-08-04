import { ExternalLink, LoaderCircle, ShieldCheck } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { hermesClient } from '../../../lib/hermes-client'
import type { OAuthStart } from '../../../lib/hermes/providers'

const sleep = (milliseconds: number) => new Promise(resolve => window.setTimeout(resolve, milliseconds))

// The generic device-code connect flow (start → open browser with a user code →
// poll → activate), parameterized by provider id. This is the exact flow built
// for Codex, generalized per the catalog's `flow: "device_code"` contract —
// nous / minimax / xai ride the same two gateway endpoints Codex already uses.
//
// Evidence boundary: a device-code APPROVAL is a live round-trip with the
// provider (it just issued a token for the user's consent), so finish() may
// record provider evidence directly. There is NO "use existing grant" path
// here — a stored grant is not proof it still works, and only Codex has a
// non-destructive liveness probe (CodexOAuth carries that path itself).
export function DeviceFlowOAuth({
  providerId,
  connectLabel,
  description,
  note,
  onConnected
}: {
  providerId: string
  connectLabel: string
  description: string
  note?: string
  onConnected: () => void
}) {
  const [session, setSession] = useState<OAuthStart | null>(null)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const cancelled = useRef(false)
  const sessionId = useRef<string | null>(null)

  useEffect(() => {
    cancelled.current = false
    return () => {
      cancelled.current = true
      if (sessionId.current) void hermesClient.cancelOAuth(sessionId.current).catch(() => undefined)
    }
  }, [])

  const finish = async () => {
    const { model } = await hermesClient.activateProvider(providerId)
    await hermesClient
      .recordProviderEvidence({
        provider: providerId,
        model: model || null,
        validatedAt: new Date().toISOString(),
        ok: true,
        reachable: true,
        method: 'validate'
      })
      .catch(() => {})
    if (!cancelled.current) onConnected()
  }

  const begin = async () => {
    setWorking(true)
    setError('')
    cancelled.current = false
    try {
      const next = await hermesClient.startOAuth(providerId)
      sessionId.current = next.session_id
      setSession(next)
      await hermesClient.openExternal(next.verification_url).catch(() => undefined)
      const interval = Math.max(1, next.poll_interval) * 1000
      const deadline = Date.now() + Math.max(1, next.expires_in) * 1000
      let transientFailures = 0
      while (!cancelled.current && Date.now() < deadline) {
        await sleep(interval)
        let result
        try {
          result = await hermesClient.pollOAuth(providerId, next.session_id)
          transientFailures = 0
        } catch (pollError) {
          transientFailures += 1
          if (transientFailures < 3 && Date.now() < deadline) continue
          throw pollError
        }
        if (result.status === 'pending') continue
        if (result.status === 'approved') {
          sessionId.current = null
          await finish()
          return
        }
        throw new Error(result.error_message || `האישור הסתיים במצב ${result.status}`)
      }
      if (!cancelled.current) throw new Error('קוד האישור פג. אפשר להתחיל חיבור חדש.')
    } catch (caught) {
      if (!cancelled.current) setError(caught instanceof Error ? caught.message : 'החיבור נכשל')
    } finally {
      if (!cancelled.current) setWorking(false)
    }
  }

  return (
    <div className="modal-form">
      <div className="info-inline">
        <ShieldCheck size={18} />
        <span>{description}</span>
      </div>
      {note ? <p className="form-hint">{note}</p> : null}
      {session ? (
        <div className="oauth-code" dir="ltr">
          <small>Code</small>
          <strong>{session.user_code}</strong>
          <button
            type="button"
            className="ghost-button"
            onClick={() => void hermesClient.openExternal(session.verification_url).catch(() => undefined)}
          >
            <ExternalLink size={16} /> פתח שוב את דף האישור
          </button>
        </div>
      ) : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <button className="primary-button" type="button" disabled={working} onClick={() => void begin()}>
        {working ? <LoaderCircle className="spin" size={16} /> : <ExternalLink size={16} />}
        {working ? 'ממתין לאישור בדפדפן…' : connectLabel}
      </button>
    </div>
  )
}
