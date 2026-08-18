// Pure release-side evidence rules that the generic evidence verifier can't own
// because they need the RELEASE channel and the CURRENT build's binding facts.
//
//   * cardinality (finding 6): EXACTLY one envelope per declared category. An
//     absent category OR a duplicate (two files claiming the same category) blocks
//     — a duplicate previously overwrote silently in a name→status map.
//   * external gate (finding 6): for the PUBLIC/full product, thin-installer must
//     be `passed`, not merely "surfaced as a blocker". For qa it may remain an
//     honest external blocker. (`telegram` was a category here until 2026-08-18;
//     it attested the native engine's round-trip, not our code — see
//     evidence-gates.mjs CATEGORIES for the rationale.)
//   * packaged-e2e build binding (finding 4): a passed packaged-e2e envelope must
//     carry the tested build's nonce + release_binding_digest + installer hash set,
//     and they must MATCH the artifact being released — an envelope captured
//     against a different build is stale, never an auto-pass.

import { assertKnownChannel, isSigningTolerant } from './channel-policy.mjs'

export const DECLARED_CATEGORIES = ['packaged-e2e', 'approval', 'shared-state', 'thin-installer']
export const PUBLIC_REQUIRED = ['packaged-e2e', 'approval', 'shared-state', 'thin-installer']
export const QA_REQUIRED = ['packaged-e2e', 'approval', 'shared-state']
// pilot requires the SAME machine-bound packaged-e2e + approval (+ shared-state)
// evidence as qa — the exact-artifact stage that produces them already runs
// against the real production transport (no demo/VITE_ALLOW_DEMO dependency; see
// scripts/e2e-exact-artifact.mjs / scripts/e2e-installed-isolated.mjs), so pilot
// gets no exemption there. It DOES get qa's tolerance on the hosted-service
// external gate (thin-installer) — see channel-policy.mjs.
export const PILOT_REQUIRED = QA_REQUIRED
export const REQUIRED_BY_CHANNEL = { public: PUBLIC_REQUIRED, qa: QA_REQUIRED, pilot: PILOT_REQUIRED }

/** Exactly one envelope per declared category. `counts` maps category→file count. */
export function checkCardinality(counts = {}, categories = DECLARED_CATEGORIES) {
  const errors = []
  for (const cat of categories) {
    const n = counts[cat] || 0
    if (n === 0) errors.push({ code: 'evidence-category-absent', detail: `no evidence envelope for declared category "${cat}"` })
    else if (n > 1) errors.push({ code: 'evidence-category-duplicate', detail: `${n} envelopes claim category "${cat}" (exactly one allowed)` })
  }
  return errors
}

/** Which categories must be `passed` for a channel, and the honest blockers. */
export function checkGateStatuses(channel, statuses = {}) {
  // An unknown channel must never inherit qa's (weakest) requirement set — the
  // old `|| QA_REQUIRED` fallback was exactly that fail-open.
  assertKnownChannel(channel)
  const required = REQUIRED_BY_CHANNEL[channel]
  const failures = []
  for (const cat of required) {
    if (statuses[cat] !== 'passed') {
      failures.push({ code: 'evidence-not-passed', detail: `required gate "${cat}" is ${statuses[cat] || 'absent'} (must be passed for ${channel})` })
    }
  }
  // Signing-tolerant channels (qa, pilot) may leave the hosted-service gate
  // non-passed: report it honestly. For public it is a hard failure above.
  const externalBlockers = isSigningTolerant(channel)
    ? ['thin-installer'].filter(c => statuses[c] && statuses[c] !== 'passed')
    : []
  return { failures, externalBlockers }
}

/**
 * The packaged-e2e envelope must be bound to the build being released.
 *   binding  : envelope.summary binding fields { build_nonce, release_binding_digest, installer_sha256 }
 *   build    : { build_nonce, release_binding_digest, installer_sha256 } from the current artifact/manifest
 * Missing fields or a mismatch → the envelope is stale for this build.
 */
export function checkPackagedBinding(binding, build) {
  const failures = []
  if (!binding) return [{ code: 'evidence-wrong-build', detail: 'packaged-e2e passed envelope carries no build binding' }]
  // HIGH 3: the binding must have been MACHINE-captured from the staged artifact —
  // a hand-entered binding (capture_method != 'machine') is a lifecycle hole.
  if (binding.capture_method !== 'machine') {
    failures.push({ code: 'evidence-manual-binding', detail: `packaged-e2e build binding capture_method=${JSON.stringify(binding.capture_method)} — must be machine-captured, not hand-entered` })
  }
  for (const key of ['build_nonce', 'release_binding_digest', 'installer_sha256']) {
    if (!binding[key]) failures.push({ code: 'evidence-wrong-build', detail: `packaged-e2e envelope missing ${key}` })
    else if (build && build[key] && binding[key] !== build[key]) {
      failures.push({ code: 'evidence-wrong-build', detail: `packaged-e2e ${key} ${short(binding[key])} != current build ${short(build[key])}` })
    }
  }
  return failures
}

function short(h) {
  return typeof h === 'string' ? h.slice(0, 12) + '…' : String(h)
}
