// Single source of channel POLICY groupings for the release contract.
//
// Three channels, three different distribution postures — but only TWO axes of
// leniency, and they are independent:
//
//   'public' — the fully signed, fully gated release. Every rigor gate applies.
//   'pilot'  — Alpha prerelease for OUTSIDE testers (docs/specs/versioning.md
//              §13 stage 5). The renderer is the REAL production build
//              (`npm run build`, demo fixtures physically stripped) — never
//              `build:qa`. It IS distributable (no DO-NOT-DISTRIBUTE marker) and
//              carries the SAME binding-chain/ledger/lock-integrity rigor as
//              public. The only things it tolerates, exactly like qa, are: no
//              code-signing certificate yet (unsigned PEs, SmartScreen expected)
//              and the two hosted-service external gates (thin-installer,
//              telegram) staying honest blockers rather than passed.
//   'qa'     — internal/dev build: demo transport baked in, unsigned, ledger and
//              lock-attest tolerated too. Never distributed
//              (release/qa-thin-installer-DO-NOT-DISTRIBUTE is the precedent).
//
// A gate that reads `channel === 'public'` directly could not tell "pilot wants
// public's rigor" from "pilot wants qa's leniency" — hence these two named
// predicates instead of a growing pile of `channel === 'x' || channel === 'y'`
// call sites. Import from HERE, not by re-deriving the grouping locally.

import { CHANNELS } from '../parse-channel.mjs'

export { CHANNELS }

// Channels whose artifact is handed to someone outside the dev machine and must
// therefore prove version-immutability (durable ledger), a verified clean
// install (lock-attest) and the full installer↔payload binding chain
// (release-report + independently re-proven containment, including the
// app.asar coverage public additionally requires) — everything EXCEPT the
// signing certificate itself and the two hosted-service external gates.
export const FULL_RIGOR_CHANNELS = new Set(['public', 'pilot'])

// Channels that may ship an installer whose EXEs are not Authenticode-signed,
// and whose thin-installer/telegram evidence may stay an honest external
// blocker instead of `passed`.
export const SIGNING_TOLERANT_CHANNELS = new Set(['qa', 'pilot'])

/** An unrecognized channel string must never fall through to ANY grouping —
 * a `Set.has()` miss would silently grant it the lenient side of every
 * predicate (the exact "unknown fact defaults to pass" failure this module
 * exists to prevent). CLI entry points already parse via parseChannel(), but
 * these are exported pure functions with no such guarantee of their own. */
export function assertKnownChannel(channel) {
  if (!CHANNELS.includes(channel)) {
    throw new Error(`unknown release channel ${JSON.stringify(channel)}; expected ${CHANNELS.join('|')}`)
  }
}

/** Does `channel` require the full binding-chain/ledger/lock-integrity rigor? */
export function requiresFullRigor(channel) {
  assertKnownChannel(channel)
  return FULL_RIGOR_CHANNELS.has(channel)
}

/** May `channel` ship unsigned PEs / leave thin-installer+telegram blocked? */
export function isSigningTolerant(channel) {
  assertKnownChannel(channel)
  return SIGNING_TOLERANT_CHANNELS.has(channel)
}
