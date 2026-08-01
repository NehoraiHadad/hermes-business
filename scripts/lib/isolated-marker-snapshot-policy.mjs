// Explicit, per-tree exclusion POLICY for the stable-profile content fingerprint.
// Two independently-justified exclusion classes, deliberately kept SEPARATE so a
// leading dot never blanket-hides authored content:
//
//   1. BYTECODE caches (__pycache__/, *.pyc, *.pyo) — compiled artifacts, NEVER
//      authored. Universal derived noise; excluded in EVERY protected tree so a
//      tool recompiling *.py sources does not read as a profile mutation.
//   2. RUNTIME_META (Curator / learning-graph dot-metadata) — persisted by the LIVE
//      Hermes 0.19.1 gateway INSIDE the authored skills tree while our isolated run
//      executes (agent/curator.py:86 → .curator_state; agent/learning_graph.py:90 →
//      .usage.json[.lock]; .hub, .bundled_manifest). SKILLS-ONLY: the identical
//      basename authored under plugins/desktop-plugins/business/hooks is real content
//      and MUST be hashed, so this allowlist is scoped by policy to the skills tree
//      and is NEVER applied globally.
import path from 'node:path'

export const BYTECODE_NAMES = new Set(['__pycache__'])
export const BYTECODE_EXT = new Set(['.pyc', '.pyo'])
export const RUNTIME_META = new Set([
  '.curator_state', '.usage.json', '.usage.json.lock', '.hub', '.bundled_manifest'
])

/** A compiled Python bytecode cache dir/file — derived everywhere, never authored. */
export function isBytecode(name) {
  return BYTECODE_NAMES.has(name) || BYTECODE_EXT.has(path.extname(name).toLowerCase())
}
/** An exact Hermes Curator/learning-graph runtime-metadata basename (skills tree). */
export function isRuntimeMeta(name) {
  return RUNTIME_META.has(name)
}

// Concrete policies. `runtimeMeta` is enabled ONLY for the live-Curator-managed
// skills tree; `bytecode` everywhere. Fail-closed default = PROTECTED (runtime
// metadata is authored content unless a caller explicitly opts into skipping it).
export const SKILLS_POLICY = Object.freeze({ runtimeMeta: true, bytecode: true })
export const PROTECTED_POLICY = Object.freeze({ runtimeMeta: false, bytecode: true })
export const DEFAULT_POLICY = PROTECTED_POLICY

/** Resolve the explicit exclusion policy for a named stable tree (no name inference). */
export function snapshotPolicyFor(dir) {
  return dir === 'skills' ? SKILLS_POLICY : PROTECTED_POLICY
}

/** Should `name` be excluded from the fingerprint under `policy`? */
export function excluded(name, policy) {
  if (policy.bytecode && isBytecode(name)) return true
  if (policy.runtimeMeta && isRuntimeMeta(name)) return true
  return false
}
