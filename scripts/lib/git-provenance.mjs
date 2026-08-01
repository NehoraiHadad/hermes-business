// Cohesive git-provenance helper for evidence correspondence.
//
// An evidence envelope records the commit it was captured against (`git_head`).
// This helper classifies how that commit relates to the current HEAD so the
// correspondence gate can stay fail-closed while still letting a committed
// envelope survive an *evidence-only refresh* commit (the paradox where merely
// committing docs/evidence/*.json advances HEAD past the head the envelope
// truthfully records).
//
// Relations (see classifyProvenance):
//   equal               git_head IS the current HEAD — always fine.
//   evidence-descendant git_head is a real ancestor and EVERY committed change
//                       from it to HEAD is confined to durable evidence
//                       envelopes (docs/evidence/*.json). Safe: nothing the
//                       evidence attests to (code / config / app / Hermes
//                       compatibility) moved.
//   code-descendant     git_head is a real ancestor but something outside the
//                       evidence envelopes changed since — the evidence may no
//                       longer be true, so a committed envelope is invalidated.
//   divergent           git_head is not an ancestor of HEAD (stale/other branch)
//                       or is not a resolvable object (bogus/typo hash).
//   unknown             no usable git_head was recorded.
//
// git access is injected (`opts.git`) so the classifier is unit-testable with a
// deterministic fake and never needs a real repository.

import { execFileSync } from 'node:child_process'

// Durable evidence artifacts: top-level JSON envelopes under docs/evidence.
// Only these may change between a committed envelope's git_head and HEAD without
// invalidating it. Deliberately EXCLUDED so any change to them fails closed:
// the forensics/ subdir (raw captures) and prose docs (README.md, *.md), because
// they are not the machine-checked envelopes the verifier gates.
export const EVIDENCE_ARTIFACT_RE = /^docs\/evidence\/[^/]+\.json$/

function runGit(args, cwd) {
  return execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'ignore'] }).toString()
}

/** True iff `head` is an ancestor of (or equal to) `current`. Any git error
 * (unknown object, or a genuine non-ancestor) resolves to false — fail closed. */
export function isAncestor(head, current, git, cwd) {
  try {
    git(['merge-base', '--is-ancestor', head, current], cwd)
    return true
  } catch {
    return false
  }
}

/** Committed paths changed between two commits, as a forward-slash list. Any git
 * error (diff failure on a corrupt/unreadable object even after ancestry held)
 * is swallowed to `null` — an indeterminate diff the caller must fail closed on,
 * distinct from a genuinely empty `[]` diff. */
export function changedPaths(head, current, git, cwd) {
  let out
  try {
    out = git(['diff', '--name-only', head, current], cwd).trim()
  } catch {
    return null
  }
  return out ? out.split(/\r?\n/) : []
}

export function classifyProvenance(head, current, { git = runGit, cwd } = {}) {
  if (!head || head === 'unknown') return { relation: 'unknown', changed: [] }
  if (head === current) return { relation: 'equal', changed: [] }
  if (!isAncestor(head, current, git, cwd)) return { relation: 'divergent', changed: [] }
  const changed = changedPaths(head, current, git, cwd)
  // Diff could not be computed (git error after ancestry succeeded): the change
  // set is unknown, so we cannot prove it is evidence-only. Fail closed as
  // divergent — rejected by every git_state — never crashing the verifier.
  if (changed === null) return { relation: 'divergent', changed: [] }
  // An empty diff (identical trees, e.g. a revert) is NOT evidence-only: fail
  // closed rather than open. Only a non-empty, all-evidence diff is durable.
  const evidenceOnly = changed.length > 0 && changed.every(p => EVIDENCE_ARTIFACT_RE.test(p))
  return { relation: evidenceOnly ? 'evidence-descendant' : 'code-descendant', changed }
}

/** Wrap a classifier so each distinct (head, current) pair is classified once per
 * run. The verifier checks many envelopes that share only a handful of git_heads
 * against one current HEAD; without this, every envelope re-spawns the same
 * merge-base + diff subprocesses (O(envelopes) git calls → O(unique heads)).
 *
 * classifyProvenance is a pure function of the repo's git state, which cannot
 * change mid-run, so a fail-closed result ('divergent'/'unknown') is as cacheable
 * as a passing one — fail-closed semantics are preserved, never weakened. The
 * classifier stays injectable: pass a fake to make this deterministic in tests. */
export function memoizeProvenance(classify = classifyProvenance) {
  const cache = new Map()
  return (head, current, opts) => {
    // JSON-encode the pair so no two distinct (head, current) inputs — including
    // '', 'unknown' or an odd separator char — can ever collide on one key.
    const key = JSON.stringify([head, current])
    if (!cache.has(key)) cache.set(key, classify(head, current, opts))
    return cache.get(key)
  }
}
