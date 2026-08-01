// Evidence subject fingerprint: the versioned link between a `passed` evidence
// envelope and the exact repository files it attests (subject-registry.mjs
// `EVIDENCE_SUBJECTS`). Capture stamps `subject_fingerprint`; the verifier
// recomputes it over the working tree and requires equality — so relevant drift
// invalidates the evidence regardless of git_state, closing the "stale
// working-tree evidence passes as current" gap that git provenance alone missed.
//
// Fail-closed everywhere: an unknown category, a missing/unreadable subject file,
// or an absent/mismatched fingerprint on a `passed` envelope is a rejection with
// a concrete recapture hint — never a silent pass and never fabricated evidence.

import { EVIDENCE_SUBJECTS, RECAPTURE, SUBJECT_SCHEME } from './subject-registry.mjs'
import { hashSubjects, MissingSubjectError } from './subject-hash.mjs'

/** Deterministic subject fingerprint for one evidence category. Throws for an
 * unknown category or a missing subject (fail closed — see subject-hash.mjs). */
export function subjectFingerprint(root, category) {
  const selectors = EVIDENCE_SUBJECTS[category]
  if (!selectors) throw new MissingSubjectError(`no evidence subject registry for category "${category}"`)
  return hashSubjects(root, selectors, { scheme: SUBJECT_SCHEME })
}

/** Recompute-based freshness gate for a single envelope. Only `passed` envelopes
 * are held to their subjects — a `blocked`/`skipped` envelope asserts no proof,
 * so it needs no fingerprint. `compute` is injectable for deterministic tests. */
export function checkSubjectFreshness(env, root, fail, compute = subjectFingerprint) {
  if (env.status !== 'passed') return
  const hint = RECAPTURE[env.category] || 'recapture the evidence from a fresh run'

  if (!EVIDENCE_SUBJECTS[env.category]) {
    return fail(`status=passed but no subject registry for category "${env.category}" — fail closed; recapture: ${hint}`)
  }
  if (env.subject_scheme !== SUBJECT_SCHEME) {
    return fail(
      `status=passed but subject_scheme ${JSON.stringify(env.subject_scheme)} != ${SUBJECT_SCHEME} ` +
        `(legacy or scheme-drifted evidence cannot masquerade as current) — recapture: ${hint}`
    )
  }
  if (typeof env.subject_fingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(env.subject_fingerprint)) {
    return fail(`status=passed but no valid subject_fingerprint — recapture: ${hint}`)
  }

  let current
  try {
    current = compute(root, env.category)
  } catch (e) {
    return fail(`status=passed but subject files missing/unreadable (${e.message}) — fail closed; recapture: ${hint}`)
  }
  if (env.subject_fingerprint !== current.fingerprint) {
    fail(
      `status=passed but subject drift: attested subject_fingerprint ` +
        `${env.subject_fingerprint.slice(0, 12)}… no longer matches the working tree ` +
        `(${current.fingerprint.slice(0, 12)}…, ${current.fileCount} files) — recapture: ${hint}`
    )
  }
}
