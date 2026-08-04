import { useEffect, useState } from 'react'
import { hermesClient } from '../lib/hermes-client'
import type { UsageSummary } from '../lib/hermes/rest-usage'

// Local usage accounting for the support panel's usage row. Same three-state
// contract as useWhatsappGuard:
//   undefined — not probed (row not applicable, e.g. runtime down): no row
//   null      — probed but the read failed: honest "no data", never a zero
//   value     — a successful read
// The value is DISPLAY-ONLY: nothing gates on it, so any failure simply lands
// on null. `refreshKey` re-reads on the same health-refresh cadence the panel
// already has — no polling of its own.
export function useUsageSummary(refreshKey?: unknown, enabled = true): UsageSummary | null | undefined {
  const [usage, setUsage] = useState<UsageSummary | null | undefined>(undefined)
  useEffect(() => {
    if (!enabled) {
      setUsage(undefined)
      return
    }
    let alive = true
    hermesClient
      .getUsageSummary()
      .then(value => {
        if (alive) setUsage(value)
      })
      .catch(() => {
        if (alive) setUsage(null)
      })
    return () => {
      alive = false
    }
  }, [refreshKey, enabled])
  return usage
}
