import { useCallback, useEffect, useRef, useState } from 'react'
import { hermesClient } from '../lib/hermes-client'
import type { WhatsappOnboarding } from '../lib/hermes/rest'
import { isTerminalOnboardingStatus } from '../lib/hermes/whatsapp-onboarding'
import { allowedUsersForPolicy } from '../lib/whatsapp-policy'

// Drives the official Hermes QR onboarding REST flow: start → poll until a
// terminal status → apply (persist + gateway restart). Timers and the pairing
// id are kept in refs so the effect cleanup can always cancel in-flight polls.
// The reply allow-list is never taken from the caller: it is derived in start()
// from the ENFORCED policy, so pairing can only ever apply what the guard allows.
export function useWhatsappOnboarding(mode: 'bot' | 'self-chat') {
  const [onboarding, setOnboarding] = useState<WhatsappOnboarding | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const timer = useRef<number | null>(null)
  const pairing = useRef<string | null>(null)
  const appliedAllowedUsers = useRef('')
  const pollFailures = useRef(0)

  const stopPolling = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current)
      timer.current = null
    }
  }, [])

  const poll = useCallback(
    async (id: string) => {
      try {
        const next = await hermesClient.pollWhatsappOnboarding(id)
        pollFailures.current = 0
        setError('')
        setOnboarding(next)
        if (!isTerminalOnboardingStatus(next.status)) {
          timer.current = window.setTimeout(() => poll(id), 1500)
        }
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'איבדנו קשר עם Hermes בזמן ההמתנה לקוד.')
        pollFailures.current += 1
        if (pairing.current === id && pollFailures.current < 5) {
          timer.current = window.setTimeout(() => poll(id), 2500)
        }
      }
    },
    []
  )

  const start = useCallback(async () => {
    setError('')
    setBusy(true)
    stopPolling()
    pollFailures.current = 0
    try {
      // Safety precondition, enforced identically in every mode: the messaging-policy
      // guard must be live before a channel may be paired, and the allow-list comes
      // from the policy the guard actually enforces — never from the form state.
      const safety = await hermesClient.ensureWhatsappPolicy()
      if (!safety?.ok || !safety.enabled) {
        throw new Error('רכיב ההגנה של WhatsApp אינו פעיל.')
      }
      const policy = await hermesClient.getWhatsappPolicy()
      if (!policy) throw new Error('לא ניתן לקרוא את מדיניות WhatsApp.')
      appliedAllowedUsers.current = allowedUsersForPolicy(policy)
      const started = await hermesClient.startWhatsappOnboarding(
        mode,
        appliedAllowedUsers.current
      )
      pairing.current = started.pairing_id
      setOnboarding(started)
      if (!isTerminalOnboardingStatus(started.status)) poll(started.pairing_id)
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'לא ניתן להתחיל את חיבור ה־WhatsApp.')
    } finally {
      setBusy(false)
    }
  }, [mode, poll, stopPolling])

  const apply = useCallback(async () => {
    if (!pairing.current) return false
    setBusy(true)
    setError('')
    try {
      await hermesClient.applyWhatsappOnboarding(
        pairing.current,
        mode,
        appliedAllowedUsers.current
      )
      pairing.current = null
      return true
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'שמירת החיבור נכשלה.')
      return false
    } finally {
      setBusy(false)
    }
  }, [mode])

  const cancel = useCallback(() => {
    stopPolling()
    const id = pairing.current
    pairing.current = null
    if (id) hermesClient.cancelWhatsappOnboarding(id).catch(() => undefined)
    setOnboarding(null)
  }, [stopPolling])

  useEffect(
    () => () => {
      stopPolling()
      const id = pairing.current
      pairing.current = null
      if (id) hermesClient.cancelWhatsappOnboarding(id).catch(() => undefined)
    },
    [stopPolling]
  )

  return { onboarding, error, busy, start, apply, cancel }
}
