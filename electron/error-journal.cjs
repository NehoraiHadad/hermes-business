const { redactSecrets } = require('./redact.cjs')

// In-memory ring of APP-LEVEL error events for the diagnostics bundle. This is
// deliberately NOT the raw runtime log stream (logs.cjs): gateway output may
// echo conversation or business content, so the bundle keeps excluding it. The
// entries here are app-generated messages only (spawn failures, startup errors,
// unhandled exceptions), whose vocabulary the app controls — redacted at
// ingestion and re-redacted by the diagnostics serialize chokepoint.
const MAX_ENTRIES = 100
const MAX_MESSAGE = 300
const MAX_SOURCE = 40

const entries = []

/**
 * Record one app-level error event. `source` is a short machine tag naming the
 * failure domain ('runtime', 'startup', 'uncaught', 'unhandled-rejection'…).
 * Accepts an Error or any message-shaped value; empty messages are dropped.
 */
function recordAppError(source, error, { now = () => new Date().toISOString() } = {}) {
  const message = redactSecrets(String(error?.message || error || ''))
    .trim()
    .slice(0, MAX_MESSAGE)
  if (!message) return
  entries.push({ at: now(), source: String(source || 'app').slice(0, MAX_SOURCE), message })
  if (entries.length > MAX_ENTRIES) entries.shift()
}

function recentAppErrors(count = 50) {
  return entries.slice(-count)
}

// Test-only: drop recorded entries so suites stay independent.
function __resetAppErrorJournal() {
  entries.length = 0
}

module.exports = { recordAppError, recentAppErrors, __resetAppErrorJournal }
