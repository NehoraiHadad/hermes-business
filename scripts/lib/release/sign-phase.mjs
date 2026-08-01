// CRITICAL 2 — the two-phase packaging ORDER (pure) + the loose-vs-inside signing
// decision that makes a "signed installer around unsigned code" un-shippable.
//
// The incident: `afterPack` runs while electron-builder is still assembling the app
// dir — BEFORE electron-builder's own final resource edit/sign step and, in a single
// `--win nsis` run, before NSIS compresses the payload. Signing inside afterPack
// therefore seals bytes that a later resource edit re-writes, and coverage of every
// shipped PE (elevate.exe, runtime DLLs, native addons) is not guaranteed by the
// per-file hook. The fix is an explicit TWO-PHASE build:
//
//   1. build:dir         — `electron-builder --win dir`; afterPack does the FINAL
//                          resource edit (rcedit icon/version) and NOTHING ELSE.
//   2. finalize-payload  — sign EVERY shipped PE (helpers/DLLs first, product exe
//                          last), VERIFY each immediately, THEN embed the manifest so
//                          its recorded hashes describe the SIGNED bytes.
//   3. nsis:prepackaged  — `electron-builder --prepackaged <win-unpacked> --win nsis`
//                          compresses the already-signed copies (afterPack does NOT
//                          re-run, so nothing is re-edited after signing).
//   4. sign-release      — sign the installer itself (post-NSIS).
//   5. report:extract    — the final verifier extracts EVERY shipped PE from the NSIS
//                          payload and re-verifies the exact copies.
//
// This module owns the ORDER invariant and the loose/inside decision; the scripts
// (after-pack.cjs, finalize-payload.mjs, gen-release-report.mjs) execute it.

/** Canonical ordered step ids for the two-phase Windows package. */
export const PACKAGE_STEPS = Object.freeze([
  'build:dir',
  'finalize-payload:sign+verify+manifest',
  'nsis:prepackaged',
  'sign-release:installer',
  'report:extract+reverify'
])

/** The ordered plan for a channel. QA keeps the same order but signing is a labeled
 * no-op (non-distributable); public fails closed at finalize-payload without a cert. */
export function planPackageOrder(/* channel = 'public' */) {
  return [...PACKAGE_STEPS]
}

/**
 * Assert the timing invariant over a step order:
 *   - the app dir is built BEFORE any signing (so signing is the LAST PE mutation);
 *   - payload signing happens BEFORE NSIS compresses the payload;
 *   - the installer is signed AFTER NSIS;
 *   - the extract+reverify step is LAST.
 *   - afterPack MUST NOT sign (afterPackSigns must be false).
 * Returns { ok, failures:[{code,detail}] }.
 */
export function assertHookOrder(steps = [], { afterPackSigns = false } = {}) {
  const failures = []
  const at = id => steps.indexOf(id)
  const dir = at('build:dir')
  const sign = at('finalize-payload:sign+verify+manifest')
  const nsis = at('nsis:prepackaged')
  const inst = at('sign-release:installer')
  const verify = at('report:extract+reverify')
  if (afterPackSigns) failures.push({ code: 'afterpack-signs', detail: 'afterPack must NOT sign — it runs before the final resource edit/NSIS capture' })
  if (dir < 0 || sign < 0 || nsis < 0) failures.push({ code: 'missing-phase', detail: 'two-phase order requires build:dir, finalize-payload and nsis:prepackaged' })
  else {
    if (!(dir < sign)) failures.push({ code: 'sign-before-dir', detail: 'payload signing must occur AFTER the app dir is fully built (last PE mutation)' })
    if (!(sign < nsis)) failures.push({ code: 'sign-after-nsis', detail: 'payload signing must occur BEFORE NSIS compresses the payload' })
  }
  if (inst >= 0 && !(nsis < inst)) failures.push({ code: 'installer-sign-early', detail: 'the installer is signed AFTER NSIS packs it' })
  if (verify >= 0 && verify !== steps.length - 1) failures.push({ code: 'verify-not-last', detail: 'extract+reverify must be the LAST step' })
  return { ok: failures.length === 0, failures }
}

/**
 * The adversarial rejection: a build whose LOOSE installer/app carries a valid
 * signature while ANY shipped PE INSIDE the compressed payload is unsigned must be
 * refused for public. Payload signatures are the source of truth; a signed shell
 * around unsigned innards is exactly the swap the whole scheme exists to stop.
 *   inside : [{ path, signature }] — signatures of the PEs extracted FROM the NSIS
 *            payload (signature is a classifySignature() verdict or null).
 *   loose  : { installer, app } — classifySignature() verdicts for the loose files.
 * Returns { ok, failures:[{code,detail}] }. Public only; qa is non-distributable.
 */
export function rejectUnsignedInsideSignedLoose({ inside = [], loose = {}, channel = 'public' } = {}) {
  if (channel !== 'public') return { ok: true, failures: [] }
  const failures = []
  const looseSigned = !!(loose.installer && loose.installer.valid) || !!(loose.app && loose.app.valid)
  const unsignedInside = inside.filter(p => !p.signature || !p.signature.valid)
  if (looseSigned && unsignedInside.length) {
    for (const p of unsignedInside) {
      failures.push({ code: 'unsigned-inside-signed-loose', detail: `payload PE ${p.path} is UNSIGNED while a loose installer/app is signed — signed shell around unsigned code (rejected)` })
    }
  }
  return { ok: failures.length === 0, failures }
}
