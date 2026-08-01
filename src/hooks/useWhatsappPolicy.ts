import { useEffect, useState } from 'react'
import type { WhatsappPolicy } from '../lib/whatsapp-policy'

// Reads the AUTHORITATIVE WhatsApp reply policy from the same file the plugin enforces
// (via the desktop bridge). Returns:
//   undefined — not loaded yet, or no desktop bridge (web/demo has no enforcement concept)
//   null      — loaded but absent/unreadable (a connected channel then reads UNPROTECTED)
//   policy    — the current read-only / selected-chats policy
// No connector/policy logic is duplicated here; it just surfaces existing state.
export function useWhatsappPolicy(): WhatsappPolicy | null | undefined {
  const [policy, setPolicy] = useState<WhatsappPolicy | null | undefined>(undefined)
  useEffect(() => {
    const bridge = window.hermesDesktop
    if (!bridge?.getWhatsappPolicy) return
    let alive = true
    bridge
      .getWhatsappPolicy()
      .then(value => {
        if (alive) setPolicy(value ?? null)
      })
      .catch(() => {
        if (alive) setPolicy(null)
      })
    return () => {
      alive = false
    }
  }, [])
  return policy
}
