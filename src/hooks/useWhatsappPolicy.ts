import { useEffect, useState } from 'react'
import { hermesClient } from '../lib/hermes-client'
import type { WhatsappPolicy } from '../lib/whatsapp-policy'

// Reads the AUTHORITATIVE WhatsApp reply policy from the same file the plugin enforces,
// through the Hermes facade. Returns:
//   undefined — not loaded yet
//   null      — loaded but absent/unreadable (a connected channel then reads UNPROTECTED)
//   policy    — the current read-only / selected-chats policy
// A read that FAILS fails closed to null; it is never reported as "no policy concern".
// No connector/policy logic is duplicated here; it just surfaces existing state.
export function useWhatsappPolicy(): WhatsappPolicy | null | undefined {
  const [policy, setPolicy] = useState<WhatsappPolicy | null | undefined>(undefined)
  useEffect(() => {
    let alive = true
    hermesClient
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
