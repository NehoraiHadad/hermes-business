// The evidence boundary for an EXISTING Codex (ChatGPT) OAuth grant.
//
// Hermes reports openai-codex `logged_in:true` from a refresh-free on-disk snapshot — that
// proves credentials are STORED, not that the grant still works. Before a "use this
// connection" flow may mint FRESH provider evidence, a real non-destructive liveness probe
// (main-process probeCodexGrant → official /usage endpoint) must prove the grant is live.
// This pure gate turns that probe verdict into an allow/deny decision, so a revoked,
// expired, or unreachable grant can NEVER pass — and onboarding stays incomplete (no fresh
// accepting evidence is ever recorded on a denied grant).

// `usedPercent`/`quotaExhausted` are DISPLAY-ONLY extras carried by the probe (the worst
// rate-limit window / a known-exhausted quota) — the gate below keys off ok/reachable only.
export type CodexGrantProbe = {
  ok: boolean
  reachable: boolean
  message?: string
  usedPercent?: number | null
  quotaExhausted?: boolean
}

export type ExistingGrantGate = { allow: true } | { allow: false; error: string }

// Allow ONLY a probe that is both accepting (ok) AND actually reached the provider
// (reachable). Everything else — a missing probe capability, a rejected grant (ok:false,
// reachable:true = revoked/expired), or an un-probed grant (reachable:false = offline / no
// token, which is NOT proof) — is denied with a clear, user-facing reason. Fails closed on a
// null/undefined probe (the capability was unavailable).
export function gateExistingCodexGrant(probe: CodexGrantProbe | null | undefined): ExistingGrantGate {
  if (probe && probe.ok === true && probe.reachable === true) return { allow: true }
  if (probe && probe.message) return { allow: false, error: probe.message }
  const reachable = Boolean(probe && probe.reachable)
  return {
    allow: false,
    error: reachable
      ? 'חיבור ה־ChatGPT אינו תקף עוד. חבר/י מחדש דרך ChatGPT.'
      : 'לא ניתן היה לאמת את החיבור הקיים. חבר/י מחדש דרך ChatGPT.'
  }
}
