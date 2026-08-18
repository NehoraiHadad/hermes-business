// USER-LEVEL GATEWAY LOGIN-ITEM GUARD for the isolated packaged E2E.
//
// The engine's `gateway install` Startup-folder fallback writes ONE user-global
// file — %APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\
// Hermes_Gateway.vbs — pointing at whatever HERMES_HOME the installing process
// ran with. A QA-armed app run that reaches it therefore hijacks the LIVE
// install's logon recovery toward a throwaway temp home (observed live,
// 2026-08-16 and three times on 2026-08-17). The runtime now suppresses the
// registration under an armed QA override (electron/google-setup.cjs); this
// guard is the detection-in-depth: snapshot the exact bytes BEFORE launch,
// verify them AFTER, and — unlike the live-home marker, where auto-restore is
// withheld because only a hash is held — RESTORE on mutation, because here we
// hold the exact prior bytes of a tiny file whose only legitimate writer during
// a QA run is the app under test, so the mutation is conclusively attributable.

import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'

/** Absolute path of the user-level Startup login item (null off-Windows). */
export function loginItemPath(env = process.env) {
  if (process.platform !== 'win32') return null
  const appData = env.APPDATA
  if (!appData) return null
  return path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'Hermes_Gateway.vbs')
}

/**
 * Snapshot the login item BEFORE the app launches: exact bytes when present,
 * `exists: false` when absent (a clean machine must stay clean). `applicable:
 * false` (off-Windows / no APPDATA) disables the whole guard honestly rather
 * than asserting on a path that cannot exist.
 */
export function snapshotLoginItem({ env = process.env, itemPath = loginItemPath(env) } = {}) {
  if (!itemPath) return { applicable: false, path: null, exists: false, content: null }
  try {
    if (!existsSync(itemPath)) return { applicable: true, path: itemPath, exists: false, content: null }
    return { applicable: true, path: itemPath, exists: true, content: readFileSync(itemPath, 'utf8') }
  } catch (error) {
    // An unreadable snapshot cannot back a restore — fail closed to "guard off"
    // but say so, instead of later "restoring" content we never actually held.
    return { applicable: false, path: itemPath, exists: false, content: null, snapshot_error: String(error?.message || error) }
  }
}

/**
 * Verify the login item still matches the pre-launch snapshot; restore the
 * snapshot when it does not. Returns the teardown patch:
 *   { applicable, unchanged, restored, restore_error? }
 * `unchanged: false` means the app under test performed user-level registration
 * — the run must FAIL even though the item was put back.
 */
export function verifyAndRestoreLoginItem(snapshot, { fs: fsOps = { existsSync, readFileSync, writeFileSync, unlinkSync } } = {}) {
  if (!snapshot || !snapshot.applicable) {
    return { applicable: false, unchanged: null, restored: null }
  }
  const { path: itemPath } = snapshot
  let existsNow = false
  let contentNow = null
  try {
    existsNow = fsOps.existsSync(itemPath)
    if (existsNow) contentNow = fsOps.readFileSync(itemPath, 'utf8')
  } catch (error) {
    return { applicable: true, unchanged: false, restored: false, restore_error: `login item unreadable after run: ${String(error?.message || error)}` }
  }
  const unchanged = existsNow === snapshot.exists && contentNow === snapshot.content
  if (unchanged) return { applicable: true, unchanged: true, restored: null }
  try {
    if (snapshot.exists) fsOps.writeFileSync(itemPath, snapshot.content)
    else if (existsNow) fsOps.unlinkSync(itemPath)
    return { applicable: true, unchanged: false, restored: true }
  } catch (error) {
    return { applicable: true, unchanged: false, restored: false, restore_error: String(error?.message || error) }
  }
}
