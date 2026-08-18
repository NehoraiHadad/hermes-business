// Read-only release-contract verifier / dry run.
//
//   node scripts/verify-release-contract.mjs [--channel public|qa|pilot] [--no-probe]
//
// Gathers the current workspace + release/ output and runs the fail-closed
// preflight. Prints every honest reason a release is NOT ready (dirty inputs,
// stale/missing attestation, artifact/version/fingerprint mismatch, invalid
// checksums, blocked/unfresh evidence, forbidden packaged tests, unsigned public)
// and the external blockers that remain. Mutates NOTHING — no build, no packaging,
// no signing, no evidence writes, no live Hermes state. Exits non-zero unless the
// release is fully contract-clean for the chosen channel.
//
// `package:win` does NOT run this script. Its stage 1 is `npm run verify:release`
// (tests + plugin/bootstrap verifiers); the contract gate itself — the same
// `preflightRelease` — runs in stage 12, `scripts/finalize-release.mjs`, the LAST
// of the 12 stages (scripts/package-win.mjs), over the STAGED sidecars it is about
// to promote. So this is the tool an operator runs BY HAND, at any point, to see
// exactly what stands between HEAD and a release without paying for a full build
// to be told. (package-win.mjs does read ONE of those inputs early — an
// uncommitted release input aborts a public/pilot run before stage 1 — but that
// is a cheap pre-read, not this gate.)

import { repoRoot } from './lib/source-fingerprint.mjs'
import { gatherReleaseState } from './lib/release/gather.mjs'
import { preflightRelease } from './lib/release/preflight.mjs'
import { computeReleaseBinding } from './lib/release/binding.mjs'
import { parseChannel } from './lib/parse-channel.mjs'

function parseArgs(argv) {
  return {
    channel: parseChannel(argv, { allowShorthand: true }),
    probe: !argv.includes('--no-probe')
  }
}

export function runVerifier({ root = repoRoot(), channel = 'public', probe = true, log = console } = {}) {
  const state = gatherReleaseState({ root, channel, probe })
  const verdict = preflightRelease(state)
  // Prefer the tamper-evident release report's binding digest; fall back to the
  // legacy artifact binding for display when no report has been cut yet.
  const reportDigest = state.releaseReport?.release_binding_digest
  const binding = reportDigest
    ? { digest: reportDigest }
    : computeReleaseBinding({ installers: state.installers, attestation: state.attestation, checksums: state.checksums, head: state.currentHead, subject: state.headSubject })
  const pb = state.releaseReport?.payload_binding

  log.log(`release-contract — channel=${channel}, app v${state.packageVersion}, HEAD ${short(state.currentHead)}`)
  log.log(`  binding digest: ${String(binding.digest).slice(0, 16)}…  (installers: ${state.installers.map(i => i.name).join(', ') || 'none'})`)
  log.log(`  version immutability: ${verdict.immutability?.label || 'n/a'}`)
  log.log(`  installer↔payload binding: ${pb ? (pb.proven ? 'PROVEN' : `NOT proven (${pb.reason})`) : 'no release report'}`)
  log.log(`  signing: ${verdict.label}${state.probed ? '' : ' [signtool not probed]'}`)
  const t = state.tools || {}
  log.log(`  bundled tools: 7za ${t.sevenZip?.chosen ? `${t.sevenZip.chosen.id} (${t.sevenZip.chosen.source})` : 'not discovered'}, signtool ${t.signtool?.chosen ? `${t.signtool.chosen.id} (${t.signtool.chosen.source})` : 'not discovered'}`)

  if (verdict.failures.length) {
    log.log(`\n✗ ${verdict.failures.length} contract failure(s) — release BLOCKED:`)
    for (const f of verdict.failures) log.log(`   - [${f.code}] ${f.detail}`)
  } else {
    log.log('\n✓ no contract failures')
  }
  if (verdict.externalBlockers.length) {
    log.log(`\n  external blockers (honest, not faked): ${verdict.externalBlockers.join(', ')}`)
    log.log('   qa may leave thin-installer blocked; public REQUIRES it passed.')
  }
  log.log(`\n${verdict.distributable ? 'DISTRIBUTABLE' : 'NOT distributable'} — ${verdict.ok ? 'contract clean' : 'contract failed'}`)
  return { state, verdict, binding }
}

function short(h) {
  return typeof h === 'string' && h.length > 12 ? h.slice(0, 12) : String(h)
}

if (process.argv[1]?.endsWith('verify-release-contract.mjs')) {
  const { channel, probe } = parseArgs(process.argv.slice(2))
  const { verdict } = runVerifier({ channel, probe })
  process.exit(verdict.ok ? 0 : 1)
}
