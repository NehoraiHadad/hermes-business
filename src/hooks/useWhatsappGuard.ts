import { useEffect, useState } from 'react'
import { hermesClient } from '../lib/hermes-client'
import { interpretWhatsappGuard, type WhatsappGuardStatus } from '../lib/whatsapp-policy'

// A LIVE proof that the WhatsApp reply policy is enforced by the RUNNING gateway — not
// that a policy file exists. Read from an official gateway introspection surface through
// the Hermes facade (`getWhatsappGuard`). Returns:
//   undefined — not probed yet
//   null      — probed but NO live proof (the surface is unavailable, or it says not
//               loaded/enforcing): a connected channel then reads UNKNOWN/unprotected
//   value     — the live guard proof from the running gateway
// Any failure fails CLOSED to null; a falsely-protected value is never reported.
// `refreshKey` lets the caller re-probe on a health refresh and after policy writes.
export function useWhatsappGuard(refreshKey?: unknown): WhatsappGuardStatus | null | undefined {
  const [guard, setGuard] = useState<WhatsappGuardStatus | null | undefined>(undefined)
  useEffect(() => {
    let alive = true
    hermesClient
      .getWhatsappGuard()
      .then(raw => {
        if (alive) setGuard(interpretWhatsappGuard(raw))
      })
      .catch(() => {
        if (alive) setGuard(null)
      })
    return () => {
      alive = false
    }
  }, [refreshKey])
  return guard
}
