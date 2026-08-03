const { getWhatsappGuardStatus, installedPluginVersion } = require('./whatsapp-guard.cjs')

// Activation-aware guard status reader for the UI/IPC — moved out of
// whatsapp-guard-journal.cjs (it reads the journal, it does not journal). A
// connection may be reported connected/enabled ONLY when this returns a live
// proof. When a restart transaction is in-flight or failed, the pre-restart
// nonce is superseded so the stale gateway heartbeat fails closed.
//
// NOTE: whatsapp-guard-journal.cjs re-exports guardStatusWithActivation for its
// one pre-existing IPC import site; the require of this module below is lazy
// (inside the function body, not at module top-level) so the two files can
// require each other without either seeing a partially-initialized module.
function guardStatusWithActivation(deps = {}) {
  const read = deps.read || getWhatsappGuardStatus
  const journal =
    deps.journal !== undefined ? deps.journal : require('./whatsapp-guard-journal.cjs').readGuardActivationJournal()
  const supersedeNonce =
    journal && journal.status !== 'active' && journal.supersedeNonce ? journal.supersedeNonce : undefined
  const forward = { supersedeNonce }
  if (deps.now !== undefined) forward.now = deps.now
  if (deps.isPidAlive) forward.isPidAlive = deps.isPidAlive
  if (deps.installedVersion) forward.installedVersion = deps.installedVersion
  return read(forward)
}

module.exports = { guardStatusWithActivation, installedPluginVersion }
