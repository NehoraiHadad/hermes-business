import { CheckCircle2, LoaderCircle } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { gateExistingCodexGrant } from '../../../lib/codex-existing-grant'
import { hermesClient } from '../../../lib/hermes-client'
import { DeviceFlowOAuth } from './DeviceFlowOAuth'

// Codex-specific wrapper over the generic device-flow: what Codex adds is the
// "use existing grant" path, which is allowed ONLY because it has a real,
// non-destructive liveness probe (main-process probeCodexGrant → official
// /usage endpoint). The evidence boundary:
//   • Device-code approval (DeviceFlowOAuth): the provider just ISSUED a token
//     in response to the user's approval — a live round-trip, records evidence.
//   • Existing on-disk grant: Hermes reports logged_in from a REFRESH-FREE
//     snapshot (creds exist), which is NOT proof the grant still works, so
//     useExisting() must pass the live probe first. A revoked/expired/
//     unreachable grant records NO evidence and the failure is surfaced.
export function CodexOAuth({
  connected,
  onConnected
}: {
  connected: boolean
  onConnected: () => void
}) {
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const cancelled = useRef(false)
  useEffect(() => {
    cancelled.current = false
    return () => {
      cancelled.current = true
    }
  }, [])

  const finish = async () => {
    const { model } = await hermesClient.activateProvider('openai-codex')
    await hermesClient
      .recordProviderEvidence({
        provider: 'openai-codex',
        model: model || null,
        validatedAt: new Date().toISOString(),
        ok: true,
        reachable: true,
        method: 'validate'
      })
      .catch(() => {})
    if (!cancelled.current) onConnected()
  }

  const useExisting = async () => {
    setWorking(true)
    setError('')
    try {
      // A stored grant is NOT proof it still works — probe it live before minting evidence.
      // The facade returns null when the probe capability is unavailable, and the gate
      // fails closed on null (never a blind pass).
      const gate = gateExistingCodexGrant(await hermesClient.probeCodexGrant())
      if (!gate.allow) {
        // Revoked / expired / unreachable grant → NO evidence, onboarding stays incomplete.
        setError(gate.error)
        setWorking(false)
        return
      }
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
        {error ? <p className="form-error" role="alert">{error}</p> : null}
        <button className="primary-button" type="button" disabled={working} onClick={() => void useExisting()}>
          {working ? <LoaderCircle className="spin" size={16} /> : <CheckCircle2 size={16} />}
          השתמש בחיבור הזה
        </button>
      </div>
    )
  }

  return (
    <DeviceFlowOAuth
      providerId="openai-codex"
      connectLabel="חבר באמצעות ChatGPT"
      description="Hermes יבקש אישור בדפדפן באמצעות Device Code. הסיסמה והאסימון אינם עוברים דרך המעטפת."
      onConnected={onConnected}
    />
  )
}
