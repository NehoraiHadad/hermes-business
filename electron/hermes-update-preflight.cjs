const { runCaptured } = require('./process-util.cjs')
const { rememberLog } = require('./logs.cjs')
const { classifyInstallMethod } = require('./hermes-compat.cjs')

// Hermes owns stable release discovery and reachability; never fetch main or
// infer a target by scraping its source version.
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
  { run = runCaptured, log = rememberLog } = {}
) {
  let check
  try {
    const { stdout, stderr } = await run(command, ['update', '--check', '--channel', 'stable'], 5 * 60_000)
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
  return { reachable: true, method: classifyInstallMethod(command) }
}

module.exports = { OFFLINE_MESSAGE, NETWORK_ERROR_PATTERN, classifyUpdateCheck, assertReleaseReachable }
