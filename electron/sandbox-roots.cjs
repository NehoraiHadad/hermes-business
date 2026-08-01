const fs = require('node:fs')
const path = require('node:path')
const { hermesHome } = require('./paths.cjs')

// Pure validation + SINGLE canonical resolution of sandbox roots. Every consumer
// (guard's HERMES_WRITE_SAFE_ROOT, Docker bind specs, invalid-root reporting,
// persisted settings, and the live UI state) derives from the ONE classification
// here — no second normalizer anywhere. The guard tier's only real boundary is
// HERMES_WRITE_SAFE_ROOT, which Hermes (agent/file_safety.py) treats as write-only
// and, critically, FAILS OPEN when the env is absent/blank — so a guard tier whose
// designated writable roots are all invalid must never silently inject nothing.
// This module classifies roots and lets callers fail closed. It never widens a
// claim: reads, terminal and network are NOT gated here and never claimed to be.

// A root is INVALID (rejected, fail-closed) when it is empty, not absolute,
// contains a `..` escape segment, resolves to a filesystem/drive root (which would
// make the write boundary allow-all and meaningless), or is not an existing
// directory. Hebrew letters and spaces are ordinary path characters and stay valid.
function hasParentEscape(raw) {
  return raw.split(/[\\/]+/).some(segment => segment === '..')
}

function isFilesystemRoot(normalized) {
  return path.parse(normalized).root === normalized
}

// Classify one root. `selected` is ALWAYS the owner's original (trimmed) input,
// kept for display ("selected link -> real target"). `path` is the canonical real
// target once resolvable — the one effective value handed to Hermes, bound into
// Docker, persisted and shown. selected !== path exactly when a reparse point
// (junction/symlink/subst) was followed.
function classifyRoot(candidate) {
  const selected = String((candidate && candidate.path) || '').trim()
  const access = candidate && candidate.access === 'rw' ? 'rw' : 'ro'
  const bad = (reason, resolvedPath = selected, reparse = false) => ({
    selected,
    path: resolvedPath,
    access,
    valid: false,
    reason,
    reparse
  })
  if (!selected) return bad('empty')
  if (!path.isAbsolute(selected)) return bad('not-absolute')
  if (hasParentEscape(selected)) return bad('parent-escape')
  const normalized = path.resolve(selected)
  if (isFilesystemRoot(normalized)) return bad('filesystem-root', normalized)
  // lstat (does NOT follow the final component) first, so a symlink/junction is
  // observed as itself before we canonicalize — path.resolve alone is purely
  // lexical and would leave a reparse point silently pointing outside the root the
  // UI shows. Fail closed if it cannot be resolved to a real on-disk target.
  let link
  try {
    link = fs.lstatSync(normalized)
  } catch {
    return bad('missing', normalized)
  }
  // Canonicalize to the REAL target (OS canonicalizer: follows Windows junctions,
  // symlinks, reparse points, drive substitutions). TOCTOU caveat: resolves at
  // validation time; callers re-verify immediately before applying.
  let real
  try {
    real = fs.realpathSync.native(normalized)
  } catch {
    return bad('unresolvable', normalized)
  }
  const reparse = link.isSymbolicLink() || real !== normalized
  // Re-apply the allow-all guard: a link into a drive root is as dangerous as naming it.
  if (isFilesystemRoot(real)) return bad('filesystem-root', real, reparse)
  let stat
  try {
    stat = fs.statSync(real)
  } catch {
    return bad('missing', real, reparse)
  }
  if (!stat.isDirectory()) return bad('not-a-directory', real, reparse)
  return { selected, path: real, access, valid: true, reason: null, reparse }
}

// Classify a settings object's roots. `writable` are the CANONICAL real paths of
// valid rw roots; `invalidWritable` are designated rw roots that failed validation.
function resolveRoots(settings = {}) {
  const roots = Array.isArray(settings.roots) ? settings.roots : []
  const classified = roots.map(classifyRoot)
  const designatedWritable = classified.filter(root => root.access === 'rw')
  return {
    classified,
    writable: designatedWritable.filter(root => root.valid).map(root => root.path),
    invalidWritable: designatedWritable.filter(root => !root.valid),
    invalid: classified.filter(root => !root.valid),
    hasDesignatedWritable: designatedWritable.length > 0
  }
}

// Effective roots for the runtime boundary: valid roots pinned to their canonical
// real target (access preserved) — Docker binds, never a raw link. Invalid excluded.
function effectiveRoots(settings = {}) {
  return resolveRoots(settings)
    .classified.filter(root => root.valid)
    .map(root => ({ path: root.path, access: root.access }))
}

// Persisted form: valid roots pinned to their canonical real target so startup /
// writeRoot / UI / Docker stay stable; invalid roots kept as the raw selection so
// the owner can still see and fix them (surfaced with a reason, never as effective).
function persistedRoots(settings = {}) {
  return resolveRoots(settings).classified.map(root => ({
    path: root.valid ? root.path : root.selected,
    access: root.access
  }))
}

function containerPathFor(index) {
  return `/mnt/root${index}`
}

// Docker volume spec: host:container[:ro], built ONLY from canonical valid roots
// (effectiveRoots). Windows drive-letter host paths pass through unchanged.
function mountsFor(roots) {
  return roots.map((root, index) => {
    const container = containerPathFor(index)
    const ro = root.access !== 'rw'
    return { host: root.path, container, ro, spec: `${root.path}:${container}${ro ? ':ro' : ''}` }
  })
}

// Deny-all safe root for a broken guard config: a deterministic path Hermes' file
// tools CANNOT write under, because its parent is the partner-settings.json file
// itself (an existing REGULAR FILE) — the OS rejects any descendant (ENOTDIR), and
// that parent lives OUTSIDE the safe root so the tools cannot delete it first. So
// Hermes denies every file-tool write instead of failing open on a blank env. NOT
// protection from terminal/shell — guard never gated those. Ordering invariant (see
// applyPartnerMode): settings are persisted BEFORE this env is derived, so the
// guarding file exists when the boundary goes live. Dependency-free (mirrors
// settingsPath literally) to avoid a require cycle with partner-settings.cjs.
function denyAllSafeRoot(home = hermesHome()) {
  return path.join(home, 'business', 'partner-settings.json', '.deny-all')
}

module.exports = {
  classifyRoot,
  resolveRoots,
  effectiveRoots,
  persistedRoots,
  mountsFor,
  containerPathFor,
  denyAllSafeRoot,
  hasParentEscape,
  isFilesystemRoot
}
