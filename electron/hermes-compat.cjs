const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const SHA_PATTERN = /^[0-9a-f]{7,40}$/i

// Main-process mirror of src/lib/hermes/compat.ts. The companion supports only
// Hermes v0.19.x, so both the startup surfacing and the self-update preflight
// refuse anything outside [0.19.0, 0.20.0). Keep in lockstep with
// scripts/plugin-sdk-contract.mjs (HERMES_COMPAT_RANGE).

const HERMES_MIN_VERSION = '0.19.0'
const HERMES_MAX_VERSION_EXCLUSIVE = '0.20.0'
const HERMES_COMPAT_RANGE = `>=${HERMES_MIN_VERSION} <${HERMES_MAX_VERSION_EXCLUSIVE}`

function parseVersion(text) {
  const match = String(text || '').match(/(\d+)\.(\d+)(?:\.(\d+))?/)
  if (!match) return null
  return { major: Number(match[1]), minor: Number(match[2]), patch: match[3] ? Number(match[3]) : 0 }
}

function compare(a, b) {
  return a.major - b.major || a.minor - b.minor || a.patch - b.patch
}

function isVersionSupported(text) {
  const version = parseVersion(text)
  if (!version) return false
  return (
    compare(version, parseVersion(HERMES_MIN_VERSION)) >= 0 &&
    compare(version, parseVersion(HERMES_MAX_VERSION_EXCLUSIVE)) < 0
  )
}

// The git checkout backing a git install: findHermes() returns
// <root>/venv/Scripts/hermes.exe (or venv/bin/hermes), so the repo root is
// three levels up from the executable.
function installRepoRoot(command) {
  return path.resolve(command, '..', '..', '..')
}

function isGitInstall(command) {
  if (!command) return false
  const probe = spawnSync('git', ['-C', installRepoRoot(command), 'rev-parse', '--is-inside-work-tree'], {
    encoding: 'utf8',
    windowsHide: true
  })
  return probe.status === 0 && String(probe.stdout).trim() === 'true'
}

// Fetch origin/<branch> and report whether the release source was actually
// reachable. Split out from gitTargetVersion so a fetch (network) failure is
// SURFACED to the preflight instead of being swallowed into a mutation attempt.
// `run` is injectable for tests. Non-git → { ok:false, reason:'not-git' }.
function gitFetchOrigin(command, branch = 'main', { run = spawnSync } = {}) {
  if (!isGitInstall(command)) return { ok: false, reason: 'not-git' }
  const probe = run('git', ['-C', installRepoRoot(command), 'fetch', 'origin', branch], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 120_000
  })
  if (probe.status !== 0) {
    return { ok: false, reason: 'fetch-failed', detail: String(probe.stderr || probe.stdout || '').trim() }
  }
  return { ok: true }
}

// Read the __version__ that origin/<branch> WOULD install, so a git self-update
// cannot silently cross the tested 0.20 boundary. Reads the ALREADY-fetched
// origin ref (the preflight runs gitFetchOrigin first and aborts if it failed —
// we never silently re-fetch here). Returns a version string or null (unknown →
// the forward guard is skipped and assertRunningVersionSupported re-gates the
// ACTUAL landed version after the update as the authoritative backstop).
function gitTargetVersion(command, branch = 'main') {
  const root = installRepoRoot(command)
  const show = spawnSync('git', ['-C', root, 'show', `origin/${branch}:hermes_cli/__init__.py`], {
    encoding: 'utf8',
    windowsHide: true
  })
  if (show.status !== 0) return null
  const match = String(show.stdout).match(/__version__\s*=\s*["']([^"']+)["']/)
  return match ? match[1] : null
}

// Capture the exact commit the install checkout is on RIGHT NOW, before any
// mutation, so a failed self-update can be reset back to it. Returns a SHA or
// null (non-git install, or git unavailable → caller falls back to the verified
// backup + fail-closed path).
function captureInstallCommit(command) {
  if (!command || !isGitInstall(command)) return null
  const probe = spawnSync('git', ['-C', installRepoRoot(command), 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
    windowsHide: true
  })
  if (probe.status !== 0) return null
  const sha = String(probe.stdout).trim()
  return SHA_PATTERN.test(sha) ? sha : null
}

// Reset ONLY the Hermes install checkout (<hermesHome>/hermes-agent — code only)
// back to a captured commit. User profile and data (sessions/, skills/,
// memories/, state.db) are SIBLINGS of the checkout, outside the git work tree,
// so a hard reset here can never touch them. Hermes' own updater autostashes
// tracked local edits and `reset --hard` never disturbs a stash, so this is
// non-destructive to user changes. Returns {ok, reason?, detail?}.
function resetInstallCheckout(command, commit) {
  if (!isGitInstall(command)) return { ok: false, reason: 'not-git' }
  if (!SHA_PATTERN.test(String(commit || ''))) return { ok: false, reason: 'no-anchor' }
  const probe = spawnSync('git', ['-C', installRepoRoot(command), 'reset', '--hard', commit], {
    encoding: 'utf8',
    windowsHide: true
  })
  if (probe.status !== 0) {
    return { ok: false, reason: 'reset-failed', detail: String(probe.stderr || probe.stdout || '').trim() }
  }
  return { ok: true, commit }
}

// Which official install layout backs this executable:
//   'git'     — a git checkout: compat preflight + git-reset rollback available.
//   'managed' — the official native/ZIP layout (<...>/hermes-agent with a
//               pyproject.toml). Classified for status/UI, but NOT eligible for
//               unattended auto-update (see assertUpdateMethodSupported).
//   'unknown' — anything else (a global pip/system install, an unexpected path).
function classifyInstallMethod(command) {
  if (!command) return 'unknown'
  if (isGitInstall(command)) return 'git'
  const root = installRepoRoot(command)
  if (path.basename(root) === 'hermes-agent' && fs.existsSync(path.join(root, 'pyproject.toml'))) {
    return 'managed'
  }
  return 'unknown'
}

// Gate unattended auto-update to install methods with a PROVEN automatic
// rollback. Only a git checkout qualifies: on failure we `git reset --hard` back
// to the anchor captured before the update, restoring the exact prior code.
//
// A managed/native (ZIP) install has NO safe unattended in-place restore — its
// pre-update backup ZIP is a MANUAL recovery aid, not an automatic rollback, and
// driving `hermes import` over a live home mid-failure would itself be
// destructive. So we REFUSE managed and unknown installs BEFORE any surface is
// stopped, any backup is taken, or the checkout is touched, and tell the user the
// supported recovery path. (If a future Hermes ships a verified import/restore
// API, add it here only after source verification + isolated tests.)
function assertUpdateMethodSupported(command) {
  const method = classifyInstallMethod(command)
  if (method === 'git') return method
  if (method === 'managed') {
    throw new Error(
      'עדכון אוטומטי של Hermes אינו נתמך עבור התקנה מנוהלת (native/ZIP) מכיוון שאין לה מנגנון שחזור אוטומטי מוכח. ' +
        'לא בוצע שינוי. לעדכון בטוח השתמש במתקין הרשמי של Hermes; המידע שלך (שיחות, כישורים, זיכרון) נשמר.'
    )
  }
  throw new Error(
    'עדכון Hermes בוטל: לא זוהתה שיטת התקנה נתמכת לעדכון אוטומטי (נדרשת התקנת git). ' +
      'לא בוצע שינוי. עדכן ידנית או פנה לתמיכה.'
  )
}

// Authoritative POST-update/recovery re-gate: given the version Hermes ACTUALLY
// resolves to now (from `hermes --version` on the running install), enforce
// hermes-compat.json before any success is reported. Throws — with a stable,
// user-facing Hebrew error — when the version is unresolvable OR out of the
// supported range, so the update flow routes it through rollback and never
// reports a landing it cannot support. The pre-mutation target preflight is a
// best-effort forward guard (null for non-git / unreadable origin); THIS is the
// backstop that actually closes the boundary.
function assertRunningVersionSupported(version) {
  const text = String(version || '').trim()
  if (!parseVersion(text)) {
    throw new Error(
      `לא ניתן לאמת את גרסת Hermes לאחר העדכון (${text || 'לא זוהתה גרסה'}); ` +
        `מבצע שחזור כדי להישאר בטווח הנתמך ${HERMES_COMPAT_RANGE}.`
    )
  }
  if (!isVersionSupported(text)) {
    throw new Error(
      `גרסת Hermes לאחר העדכון (${text}) חורגת מהטווח הנתמך ${HERMES_COMPAT_RANGE}; מבצע שחזור.`
    )
  }
  return text
}

// Throw (aborting the update, before any mutation) if a git install's
// origin/main would leave the shell on an unsupported Hermes.
function assertUpdateTargetSupported(command) {
  if (!isGitInstall(command)) return { checked: false, target: null }
  const target = gitTargetVersion(command)
  if (target && !isVersionSupported(target)) {
    throw new Error(
      `עדכון Hermes בוטל: הגרסה ב-origin/main (${target}) חורגת מהטווח הנתמך ${HERMES_COMPAT_RANGE}. לא בוצע שינוי.`
    )
  }
  return { checked: true, target }
}

module.exports = {
  HERMES_MIN_VERSION,
  HERMES_MAX_VERSION_EXCLUSIVE,
  HERMES_COMPAT_RANGE,
  parseVersion,
  isVersionSupported,
  assertRunningVersionSupported,
  installRepoRoot,
  isGitInstall,
  gitFetchOrigin,
  gitTargetVersion,
  assertUpdateTargetSupported,
  captureInstallCommit,
  resetInstallCheckout,
  classifyInstallMethod,
  assertUpdateMethodSupported
}
