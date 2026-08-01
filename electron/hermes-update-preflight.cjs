const { runCaptured } = require('./process-util.cjs')
const { rememberLog } = require('./logs.cjs')
const { isGitInstall, gitFetchOrigin, classifyInstallMethod } = require('./hermes-compat.cjs')

// Pre-mutation gates for the official Hermes self-update. NOTHING here stops a
// surface, backs up, or mutates the checkout — these run first and, on any
// failure, abort the update before a single side effect. Two concerns:
//
//   1. Install-method eligibility. We only auto-update an install we can BOTH
//      preflight AND automatically roll back — that is a git checkout (reset to
//      the captured anchor). A managed/native (ZIP) install has NO proven
//      automatic in-place rollback: its pre-update backup ZIP is a manual
//      recovery aid, NOT an automatic restore, so we refuse before mutation and
//      tell the user the supported recovery path. (See assertUpdateMethodSupported
//      in hermes-compat.cjs, which owns the git-only policy.)
//
//   2. Release reachability. `update --check` (read-only) and, for a git install,
//      `git fetch origin` must both actually reach the release source. Their
//      failures are NEVER swallowed into a mutation attempt — offline/unreachable
//      aborts here, before we touch anything.

const OFFLINE_MESSAGE =
  'עדכון Hermes בוטל: מקור העדכון אינו נגיש (ייתכן שאין חיבור לרשת). לא בוצע שינוי; נסה שוב כשהחיבור יציב.'

// Recognisable network/offline signatures in an `update --check` failure. Used
// only to phrase the error; ANY non-success check still aborts (see below).
const NETWORK_ERROR_PATTERN =
  /(network|offline|unreachable|could not resolve|name resolution|timed?\s*out|timeout|connection (?:refused|reset|failed)|failed to connect|no route to host|temporary failure|getaddrinfo|ssl|tls handshake|proxy)/i

// Classify a completed `update --check` probe. A clean exit is the ONLY result
// that permits proceeding to mutation; every failure blocks (fail closed), with
// 'offline' distinguished from a generic 'blocked' purely for the message.
function classifyUpdateCheck({ ok, output }) {
  if (ok) return 'reachable'
  if (NETWORK_ERROR_PATTERN.test(String(output || ''))) return 'offline'
  return 'blocked'
}

// Assert the release source is reachable before any mutation. Throws on offline /
// unreachable / any failed check — the failure is surfaced, never swallowed.
async function assertReleaseReachable(
  command,
  { run = runCaptured, isGit = isGitInstall, fetch = gitFetchOrigin, log = rememberLog } = {}
) {
  let check
  try {
    const { stdout, stderr } = await run(command, ['update', '--check'], 5 * 60_000)
    check = { ok: true, output: `${stdout || ''}\n${stderr || ''}` }
  } catch (error) {
    check = { ok: false, output: error.message || String(error) }
  }
  const verdict = classifyUpdateCheck(check)
  if (verdict === 'offline') {
    log(`update --check unreachable: ${String(check.output).slice(0, 200)}`)
    throw new Error(OFFLINE_MESSAGE)
  }
  if (verdict === 'blocked') {
    log(`update --check failed: ${String(check.output).slice(0, 200)}`)
    throw new Error(`עדכון Hermes בוטל: בדיקת זמינות העדכון נכשלה. לא בוצע שינוי. פרטים: ${String(check.output).slice(0, 160)}`)
  }
  // For a git install, `git fetch origin` is the authoritative reachability gate;
  // a fetch failure must abort rather than be swallowed into `update --yes`.
  if (isGit(command)) {
    const fetched = fetch(command)
    if (!fetched.ok) {
      log(`git fetch origin failed before update: ${fetched.detail || fetched.reason || 'unknown'}`)
      throw new Error(`${OFFLINE_MESSAGE}${fetched.detail ? ` (${String(fetched.detail).slice(0, 160)})` : ''}`)
    }
  }
  return { reachable: true, method: classifyInstallMethod(command) }
}

module.exports = { OFFLINE_MESSAGE, NETWORK_ERROR_PATTERN, classifyUpdateCheck, assertReleaseReachable }
