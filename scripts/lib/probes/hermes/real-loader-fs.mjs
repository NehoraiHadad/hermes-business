// Filesystem lifecycle for the real-loader E2E: create an isolated throwaway
// HERMES_HOME / userData / cwd / home / cache / config under the OS temp root,
// prove every owned path is really under that temp root before we act on it, and
// tear the exact roots down afterwards. Pure fs + path logic (no Playwright, no
// desktop env knowledge) so the path-safety and cleanup control flow are testable.

import { existsSync, mkdtempSync, mkdirSync, readdirSync, realpathSync, rmSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// Files Electron writes under a real userData dir on launch. A POPULATED marker
// (not merely a non-empty dir) is positive proof the userData override took hold.
const ELECTRON_USERDATA_MARKERS = ['Local Storage', 'Network', 'GPUCache', 'blob_storage', 'Preferences', 'Cache']

/**
 * Prove the launched Electron used the ISOLATED userData dir: if the override had
 * been ignored, Electron would have written to its default location and no known
 * marker would appear here. Requires at least one KNOWN Electron marker — a
 * non-empty dir alone is not accepted. Returns { used, entryCount, markers }.
 */
export function verifyElectronUserDataUsed(userDataDir) {
  if (!existsSync(userDataDir)) return { used: false, entryCount: 0, markers: [] }
  const entries = readdirSync(userDataDir)
  const markers = ELECTRON_USERDATA_MARKERS.filter(m => entries.includes(m))
  return { used: markers.length > 0, entryCount: entries.length, markers }
}

/** Case-folded, canonical, trailing-separator-stripped key for a path. */
export function pathKey(p) {
  return path.resolve(String(p)).replace(/[\\/]+$/, '').toLowerCase()
}

/**
 * True iff `candidate`, after resolution, is strictly INSIDE `root` (not equal to
 * it). Realpath-resolves both so a symlinked/8.3-short TEMP can't smuggle a path
 * out of the temp tree.
 */
export function isStrictlyUnder(candidate, root) {
  const resolve = p => {
    try {
      return realpathSync.native(p)
    } catch {
      return path.resolve(p)
    }
  }
  const c = pathKey(resolve(candidate))
  const r = pathKey(resolve(root))
  return c !== r && c.startsWith(r + path.sep.toLowerCase())
}

/** The canonical OS temp root, realpath-resolved. */
export function osTempRoot() {
  return realpathSync.native(os.tmpdir())
}

/**
 * A STABLE recovery directory that OUTLIVES any single sandbox (it is a sibling of
 * the sandboxes under TEMP, never removed by sandbox teardown). Crash-safe
 * registry backups live here until an exact restore is verified. Created on demand.
 */
export function recoveryRoot() {
  const dir = path.join(osTempRoot(), 'hermes-realloader-recovery')
  mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * Create a fresh, empty, UNIQUE directory under the OS temp root and prove it
 * landed there. Throws (fail closed) if the created dir escapes the temp root.
 */
export function createTempDir(prefix) {
  const dir = mkdtempSync(path.join(os.tmpdir(), prefix))
  const real = realpathSync.native(dir)
  if (!isStrictlyUnder(real, osTempRoot())) {
    rmSync(dir, { recursive: true, force: true })
    throw new Error(`temp dir escaped the OS temp root: ${real}`)
  }
  return real
}

/**
 * Build the full isolated sandbox: a single unique root under TEMP holding the
 * throwaway HERMES_HOME, Electron userData, desktop cwd, the fake USERPROFILE and
 * the re-homed TEMP / XDG cache/config dirs the child sees. One root => one exact
 * path to remove in finally. All paths are proven under TEMP by construction.
 */
export function createSandbox(prefix = 'hermes-realloader-') {
  const root = createTempDir(prefix)
  const profile = path.join(root, 'profile')
  const layout = {
    root,
    hermesHome: path.join(root, 'hermes-home'),
    userData: path.join(root, 'user-data'),
    cwd: path.join(root, 'cwd'),
    userProfile: profile,
    appData: path.join(profile, 'AppData', 'Roaming'),
    localAppData: path.join(profile, 'AppData', 'Local'),
    tmp: path.join(root, 'tmp'),
    xdgConfig: path.join(profile, '.config'),
    xdgCache: path.join(profile, '.cache'),
    xdgData: path.join(profile, '.local', 'share')
  }
  for (const key of Object.keys(layout)) {
    if (key === 'root') continue
    mkdirSync(layout[key], { recursive: true })
  }
  return layout
}

/**
 * Remove an owned directory tree, tolerating brief Windows file locks. Never
 * throws — returns { removed }. Refuses (removed:false) if `dir` is not strictly
 * under the OS temp root, so a mis-wired caller can never rm a live profile.
 */
export function removeOwnedDir(dir) {
  if (!dir || !existsSync(dir)) return { removed: true, safe: true }
  if (!isStrictlyUnder(dir, osTempRoot())) {
    return { removed: false, safe: false, reason: `refusing to remove path outside OS temp: ${dir}` }
  }
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 3 })
      if (!existsSync(dir)) return { removed: true, safe: true }
    } catch {
      /* retry after a short spin */
    }
    const spin = Date.now() + 300
    while (Date.now() < spin) {
      /* brief busy wait to let a file lock release; no async in finally */
    }
  }
  return { removed: !existsSync(dir), safe: true }
}

/**
 * GENERIC stale-sandbox sweep: remove leftover sandbox roots from earlier aborted
 * runs, but ONLY dirs that are (a) under the OS temp root, (b) carry the expected
 * prefix and (c) are older than `maxAgeMs` — and never the live `keep` root. No
 * hardcoded one-off paths. Returns a per-target result list.
 */
export function sweepStaleSandboxes({ prefix = 'hermes-realloader-', maxAgeMs = 3_600_000, keep = null } = {}) {
  const tempRoot = osTempRoot()
  // Realpath-resolve `keep` before keying: enumerated targets are built on the
  // CANONICAL temp root, so a keep handed in via an 8.3-short TEMP (e.g.
  // C:\Users\RUNNER~1\...) would never match its own canonical entry and the
  // live root would lose its protection exactly when it matters.
  let keepKey = null
  if (keep) {
    try {
      keepKey = pathKey(realpathSync.native(keep))
    } catch {
      keepKey = pathKey(keep)
    }
  }
  const now = Date.now()
  let entries = []
  try {
    entries = readdirSync(tempRoot, { withFileTypes: true })
  } catch {
    return []
  }
  const results = []
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith(prefix)) continue
    if (entry.name === 'hermes-realloader-recovery') continue // durable recovery store
    const full = path.join(tempRoot, entry.name)
    if (keepKey && pathKey(full) === keepKey) continue
    let ageMs = Infinity
    try {
      ageMs = now - statSync(full).mtimeMs
    } catch {
      /* unreadable — treat as ancient and attempt safe removal */
    }
    if (ageMs < maxAgeMs) {
      results.push({ target: full, removed: false, reason: 'newer than maxAge; left untouched' })
      continue
    }
    const res = removeOwnedDir(full)
    results.push({ target: full, removed: res.removed, safe: res.safe })
  }
  return results
}
