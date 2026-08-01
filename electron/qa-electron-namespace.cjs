const path = require('node:path')

// Decide the Electron userData / single-instance namespace for a launch, given
// the already-resolved QA runtime override (electron/qa-runtime.cjs).
//
// WHY THIS EXISTS — the incident it fixes:
//   Electron keys its single-instance lock on the `userData` directory. The
//   packaged companion previously requested the lock with the DEFAULT userData.
//   When a QA packaged launch happened while the user's LIVE companion was
//   already running (holding the default-userData lock), the QA process either
//   lost the lock and was forwarded to the live instance, or otherwise ended up
//   bound to the live gateway on the default port. The QA approval run then
//   drove a REAL session/config mutation against the live profile.
//
// The fix is to give a QA launch its OWN userData — rooted under the validated,
// throwaway HERMES_HOME — set BEFORE app.requestSingleInstanceLock(). A distinct
// userData means a distinct single-instance lock key, so no live instance can
// ever intercept/forward the QA launch. Production (override disabled) returns
// { isolated: false, userData: null } and the app keeps Electron's default
// userData/lock exactly as before.
//
// Pure + synchronous so it can run at main-script load time (before app 'ready')
// and be unit-tested without Electron.
function qaElectronNamespace(override) {
  if (!override || !override.enabled || !override.hermesHome) {
    return { isolated: false, userData: null }
  }
  return {
    isolated: true,
    // A dedicated child of the throwaway home. Never the live/default userData,
    // so the single-instance lock keys are disjoint by construction.
    userData: path.join(override.hermesHome, 'electron-user-data')
  }
}

module.exports = { qaElectronNamespace }
