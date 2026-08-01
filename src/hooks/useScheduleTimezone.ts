import { useEffect, useState } from 'react'
import { hermesClient } from '../lib/hermes-client'
import { resolveScheduleTimezone, type ResolvedTimezone } from '../lib/timezone'

// Reads the AUTHORITATIVE schedule timezone from Hermes config.yaml (GET /api/config
// → `timezone`, an IANA id or empty=system) so the nontechnical picker can show which
// zone a "09:00" means. A blank config resolves the machine's own zone; an unreadable
// config keeps the system zone rather than inventing one. Best-effort, non-blocking.
export function useScheduleTimezone(): ResolvedTimezone {
  // Start from the resolved SYSTEM zone (config unknown until the read returns), never
  // a hard-coded Israeli guess — resolveScheduleTimezone(null) reads Intl for us.
  const [resolved, setResolved] = useState<ResolvedTimezone>(() => resolveScheduleTimezone(null))
  useEffect(() => {
    let alive = true
    hermesClient
      .api<{ timezone?: unknown }>('/api/config')
      .then(config => {
        if (alive) setResolved(resolveScheduleTimezone(config?.timezone))
      })
      .catch(() => {
        /* keep the resolved system zone — never assume a zone we could not read */
      })
    return () => {
      alive = false
    }
  }, [])
  return resolved
}
