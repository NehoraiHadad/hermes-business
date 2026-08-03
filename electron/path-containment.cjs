const path = require('node:path')

// Win32-aware path-containment primitive shared by qa-runtime-policy.cjs (the
// fail-closed QA isolated-home validator) and whatsapp-privacy.cjs (the
// private-home-scope check). A trailing separator is trimmed before
// comparison, and case-folding applies ONLY on win32 — where the filesystem
// is case-insensitive — so POSIX paths still compare byte-exact.
//
// NOTE: a third, near-identical copy (`pathKey`/`isUnder`) lives in
// runtime-mode.cjs. That file is out of scope for this consolidation (owned
// by a concurrent task) and is left untouched — worth revisiting later.

const winCI = process.platform === 'win32'

function normalizePathForCompare(value) {
  const trimmed = String(value).replace(/[\\/]+$/, '')
  return winCI ? trimmed.toLowerCase() : trimmed
}

// True when `child` IS `parent` or lives strictly under it. The boundary
// separator is appended un-normalized: normalizePathForCompare would trim a
// lone path.sep down to '' (its trailing-separator regex matches it), which
// would degrade this to a raw string-prefix check that accepts a SIBLING
// sharing the parent's name as a prefix (e.g. `${parent}-evil/payload`).
function isUnder(child, parent) {
  const c = normalizePathForCompare(child)
  const p = normalizePathForCompare(parent)
  return c === p || c.startsWith(p + path.sep)
}

module.exports = { normalizePathForCompare, isUnder }
