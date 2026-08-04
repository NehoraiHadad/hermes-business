import { useEffect, useState } from 'react'
import { hermesClient } from '../lib/hermes-client'
import { resolveActiveProviderId, resolveQuotaSignal, type QuotaSignal } from '../lib/provider-quota'
import type { ProviderStatus } from '../lib/provider-readiness'

// The quota tier of the usage row (see lib/provider-quota.ts). Same three-state
// contract as the panel's other probes:
//   undefined      — not probed (disabled / runtime down): quota tier not shown
//   { kind:'none' } — probed but no quota door answered: fall back to local counts
//   value          — a real signal (exhausted / percent)
// DISPLAY-ONLY: every failure lands on 'none'; nothing gates on this. The Codex
// probe is a real external call, so it fires only on the panel's existing
// refresh cadence (refreshKey) and only when Codex is the active provider.
export function useProviderQuota(
  provider: ProviderStatus,
  refreshKey?: unknown,
  enabled = true
): QuotaSignal | undefined {
  const [signal, setSignal] = useState<QuotaSignal | undefined>(undefined)
  useEffect(() => {
    if (!enabled) {
      setSignal(undefined)
      return
    }
    let alive = true
    const read = async (): Promise<QuotaSignal> => {
      const [catalog, poolStatuses] = await Promise.all([
        hermesClient.listOAuthProviders().catch(() => null),
        hermesClient.getCredentialPoolStatuses().catch(() => null)
      ])
      const providerId = resolveActiveProviderId(provider, catalog)
      const codexProbe =
        providerId === 'openai-codex'
          ? await hermesClient.probeCodexGrant().catch(() => null)
          : null
      return resolveQuotaSignal({ providerId, poolStatuses, codexProbe })
    }
    read()
      .then(value => {
        if (alive) setSignal(value)
      })
      .catch(() => {
        if (alive) setSignal({ kind: 'none' })
      })
    return () => {
      alive = false
    }
  }, [refreshKey, enabled, provider])
  return signal
}
