// The ONE impure reader of "which release inputs are uncommitted right now".
//
// It lives in its own module because two very different callers need the same
// answer and neither should own it: `gather.mjs` folds it into the preflight
// state (the authoritative stage-12 verdict), and `package-win.mjs` asks it
// BEFORE stage 1 so a dirty tree is reported in seconds instead of after a full
// build. A second implementation here is exactly how the two would drift into
// disagreeing about what "clean" means — the parsing and the membership rules
// stay in `porcelain.mjs` / the subject registry, and this file only supplies the
// git call.

import { execFileSync } from 'node:child_process'
import { dirtyReleaseInputs } from './porcelain.mjs'

/**
 * Uncommitted paths that are release inputs, as repo-relative strings.
 *
 * `--untracked-files=all` matters: a brand-new, never-added source file is just
 * as much an uncommitted input as a modified one. When git itself cannot be run
 * we return a single sentinel rather than an empty array — "we could not prove a
 * clean tree" must never be indistinguishable from "the tree is clean".
 */
export const GIT_UNAVAILABLE = '<git unavailable — cannot prove a clean tree>'

export function releaseDirtyInputs(root, { runGit = defaultRunGit } = {}) {
  let out
  try {
    out = runGit(root)
  } catch {
    return [GIT_UNAVAILABLE]
  }
  return dirtyReleaseInputs(out)
}

function defaultRunGit(root) {
  return execFileSync('git', ['status', '--porcelain=v1', '-z', '--untracked-files=all'], { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString('utf8')
}
