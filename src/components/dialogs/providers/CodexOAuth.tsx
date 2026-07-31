import { CheckCircle2, ExternalLink, LoaderCircle, ShieldCheck } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { hermesClient } from '../../../lib/hermes-client'
import type { OAuthStart } from '../../../lib/hermes/providers'

const sleep = (milliseconds: number) => new Promise(resolve => window.setTimeout(resolve, milliseconds))

export function CodexOAuth({
  connected,
  onConnected
}: {
  connected: boolean
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
    await hermesClient.activateProvider('openai-codex')
    if (!cancelled.current) onConnected()
  }

  const begin = async () => {
    setWorking(true)
    setError('')
    cancelled.current = false
    try {
      const next = await hermesClient.startOAuth('openai-codex')
      sessionId.current = next.session_id
      setSession(next)
      await window.hermesDesktop?.openExternal(next.verification_url)
      const interval = Math.max(1, next.poll_interval) * 1000
      const deadline = Date.now() + Math.max(1, next.expires_in) * 1000
      let transientFailures = 0
      while (!cancelled.current && Date.now() < deadline) {
        await sleep(interval)
        let result
        try {
          result = await hermesClient.pollOAuth('openai-codex', next.session_id)
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

  const useExisting = async () => {
    setWorking(true)
    setError('')
    try {
      await finish()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'לא ניתן להפעיל את החיבור')
      setWorking(false)
    }
  }

  if (connected) {
    return (
      <div className="modal-form">
        <div className="info-inline">
          <CheckCircle2 size={18} />
          <span>חשבון ChatGPT כבר מחובר ל־Hermes. אין צורך להדביק מפתח API.</span>
        </div>
        {error ? <p className="form-error">{error}</p> : null}
        <button className="primary-button" type="button" disabled={working} onClick={() => void useExisting()}>
          {working ? <LoaderCircle className="spin" size={16} /> : <CheckCircle2 size={16} />}
          השתמש בחיבור הזה
        </button>
      </div>
    )
  }

  return (
    <div className="modal-form">
      <div className="info-inline">
        <ShieldCheck size={18} />
        <span>Hermes יבקש אישור בדפדפן באמצעות Device Code. הסיסמה והאסימון אינם עוברים דרך המעטפת.</span>
      </div>
      {session ? (
        <div className="oauth-code" dir="ltr">
          <small>Code</small>
          <strong>{session.user_code}</strong>
          <button
            type="button"
            className="ghost-button"
            onClick={() => window.hermesDesktop?.openExternal(session.verification_url)}
          >
            <ExternalLink size={16} /> פתח שוב את דף האישור
          </button>
        </div>
      ) : null}
      {error ? <p className="form-error">{error}</p> : null}
      <button className="primary-button" type="button" disabled={working} onClick={() => void begin()}>
        {working ? <LoaderCircle className="spin" size={16} /> : <ExternalLink size={16} />}
        {working ? 'ממתין לאישור בדפדפן…' : 'חבר באמצעות ChatGPT'}
      </button>
    </div>
  )
}
