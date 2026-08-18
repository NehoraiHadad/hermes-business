// THE reader for "which version of תכל'ס is running".
//
// There were three of these, one per module in the companion-update family
// (companion-update.cjs, companion-download.cjs, companion-rollback.cjs), and
// they had DRIFTED: two threw when Electron was absent, the third swallowed the
// error and returned null. That is not a harmless duplication. The running
// version is the anti-replay anchor of the whole update path — it decides which
// release is "newer", it is written into the durable journal as `currentVersion`,
// and a future rollback offer reads that field back to decide where it may send
// the installer. Two implementations of one fact is a seam where the value used
// to DECIDE can differ from the value RECORDED, and the null-returning variant
// turned a hard failure into a silent `null` flowing into a comparison.
//
// (Found the honest way: a live end-to-end run crashed in one module and not
// another, for the same missing Electron.)
//
// `electron` is required LAZILY, inside the function and never at module load,
// so every consumer stays importable from vitest without a live Electron runtime.
// Callers that need to survive its absence catch it — they do NOT get a second
// implementation that decides for them what an unreadable version means.
//
// This is deliberately NOT merged with runtime.cjs's `getVersions()`. That one
// builds a user-facing map of several components' versions for the diagnostics
// surface; this one answers a single question the update decisions depend on.
// Same underlying call, different contracts — see the note atop
// companion-update-journal.cjs on why look-alike things are not merged here.

/**
 * The running app version, e.g. '0.4.0-alpha.10'.
 * THROWS if Electron is unavailable — an unreadable version is never reported
 * as `null`, because `null` compares as "cannot order" everywhere downstream and
 * would silently disable the very checks that depend on it.
 */
function appVersion() {
  return require('electron').app.getVersion()
}

module.exports = { appVersion }
