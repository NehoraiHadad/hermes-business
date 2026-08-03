// Pure guards for the main-process IPC boundary. They live here rather than in
// ipc.cjs (which pulls in Electron and every feature module) so the rules that
// protect the boundary are unit-testable on their own.

const EXTENSION = /^[A-Za-z0-9*][A-Za-z0-9+._-]{0,23}$/
const MAX_FILTERS = 24
const MAX_EXTENSIONS = 32
const MAX_NAME = 64

/**
 * Validate the renderer-supplied `filters` argument of `hermes:choose-file`
 * against Electron's documented shape (`{ name: string, extensions: string[] }`)
 * and return a freshly built, sanitized copy — the renderer object itself is
 * never forwarded to `dialog.showOpenDialog`.
 *
 * Anything that does not fit is ignored rather than thrown at the user: a bad
 * filter must not turn "pick a file" into an error dialog. A wholly invalid
 * argument degrades to `[]`, which is exactly "show every file" — the same
 * behaviour the previous `filters || []` fallback had for a missing argument.
 */
function normalizeOpenFileFilters(filters) {
  if (!Array.isArray(filters)) return []
  const normalized = []
  for (const candidate of filters) {
    if (normalized.length >= MAX_FILTERS) break
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue
    if (typeof candidate.name !== 'string') continue
    const name = candidate.name.trim().slice(0, MAX_NAME)
    if (!name) continue
    if (!Array.isArray(candidate.extensions)) continue
    const extensions = []
    for (const raw of candidate.extensions) {
      if (extensions.length >= MAX_EXTENSIONS) break
      if (typeof raw !== 'string') continue
      // Electron expects bare extensions; a leading dot is a common caller slip.
      const extension = raw.trim().replace(/^\.+/, '')
      if (!EXTENSION.test(extension)) continue
      if (!extensions.includes(extension)) extensions.push(extension)
    }
    if (!extensions.length) continue
    normalized.push({ name, extensions })
  }
  return normalized
}

/**
 * Serialize an IPC-triggered operation that must never run twice at once (the
 * same in-flight-flag idiom `applyOfficialHermesUpdate` uses in
 * hermes-update.cjs). A re-entrant call rejects with `busyMessage` — a
 * user-facing string, since it is rendered verbatim by the renderer — and the
 * flag is always cleared in `finally`, including when the task throws.
 */
function createSerialGuard(busyMessage) {
  let inFlight = false
  return async function runExclusive(task) {
    if (inFlight) throw new Error(busyMessage)
    inFlight = true
    try {
      return await task()
    } finally {
      inFlight = false
    }
  }
}

module.exports = { normalizeOpenFileFilters, createSerialGuard }
