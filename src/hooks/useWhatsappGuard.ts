import { useEffect, useState } from 'react'
import { interpretWhatsappGuard, type WhatsappGuardStatus } from '../lib/whatsapp-policy'

// A LIVE proof that the WhatsApp reply policy is enforced by the RUNNING gateway — not
// that a policy file exists. It is read from an official gateway introspection surface
// via the desktop bridge (`getWhatsappGuard`). Returns:
//   undefined — no desktop bridge (web/demo has no enforcement concept): skip the row
//   null      — probed but NO live proof (bridge lacks the surface, or it says not
//               loaded/enforcing): a connected channel then reads UNKNOWN/unprotected
//   value     — the live guard proof from the running gateway
// `refreshKey` lets the caller re-probe on a health refresh and after policy writes.
type GuardBridge = { getWhatsappGuard?: () => Promise<unknown> }

export function useWhatsappGuard(refreshKey?: unknown): WhatsappGuardStatus | null | undefined {
  const [guard, setGuard] = useState<WhatsappGuardStatus | null | undefined>(undefined)
  useEffect(() => {
    const bridge = window.hermesDesktop as (typeof window.hermesDesktop & GuardBridge) | undefined
    if (!bridge) return // web/demo — no enforcement concept
    // No introspection surface on this bridge yet ⇒ we cannot PROVE enforcement, so we
    // report null (unknown), never a falsely-protected value.
    if (!bridge.getWhatsappGuard) {
      setGuard(null)
      return
    }
    let alive = true
    bridge
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
