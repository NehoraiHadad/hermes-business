const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const { safeWrite } = require('./atomic-write.cjs')
const { validInstallStamp } = require('./hermes-install-identity.cjs')

const SHA_PATTERN = /^[0-9a-f]{7,40}$/i

// Future official stable releases remain eligible; capability checks detect drift.
const policy = require('../hermes-compat.json')
const HERMES_MIN_VERSION = policy.minVersion
const HERMES_COMPAT_RANGE = policy.range

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
    compare(version, parseVersion(HERMES_MIN_VERSION)) >= 0
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

function gitProbe(root, args) {
  return spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', windowsHide: true })
}

// Official stable source installs may legitimately use a detached release HEAD.
// Only custom/missing origins require their operator's update mechanism.
function isPinnedGitInstall(command) {
  if (!isGitInstall(command)) return false
  const root = installRepoRoot(command)
  const origin = gitProbe(root, ['remote', 'get-url', 'origin'])
  if (origin.status !== 0) return true
  const normalized = String(origin.stdout).trim().replace(/\\/g, '/').replace(/\.git$/i, '').toLowerCase()
  return !/(?:github\.com[/:])nousresearch\/hermes-agent$/.test(normalized)
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
function resetInstallCheckout(command, commit, installStamp) {
  if (!isGitInstall(command)) return { ok: false, reason: 'not-git' }
  if (!SHA_PATTERN.test(String(commit || ''))) return { ok: false, reason: 'no-anchor' }
  const stampFile = path.join(installRepoRoot(command), 'install-stamp.json')
  if (installStamp === undefined && fs.existsSync(stampFile)) return { ok: false, reason: 'missing-install-identity' }
  if (installStamp !== undefined && !validInstallStamp(installStamp, commit)) return { ok: false, reason: 'invalid-install-identity' }
  const probe = spawnSync('git', ['-C', installRepoRoot(command), 'reset', '--hard', commit], {
    encoding: 'utf8',
    windowsHide: true
  })
  if (probe.status !== 0) {
    return { ok: false, reason: 'reset-failed', detail: String(probe.stderr || probe.stdout || '').trim() }
  }
  try {
    if (installStamp === null) {
      if (fs.existsSync(stampFile)) fs.unlinkSync(stampFile)
    } else if (installStamp !== undefined) {
      safeWrite(stampFile, installStamp)
    }
  } catch (error) { return { ok: false, reason: 'identity-restore-failed', detail: error.message } }
  return { ok: true, commit }
}

// Which official install layout backs this executable:
//   'git'     — an official source checkout (including detached release tags).
//   'pinned'  — a custom fork or checkout without a known official origin.
//   'managed' — the official native/ZIP layout (<...>/hermes-agent with a
//               pyproject.toml). Classified for status/UI, but NOT eligible for
//               unattended auto-update (see assertUpdateMethodSupported).
//   'unknown' — anything else (a global pip/system install, an unexpected path).
function classifyInstallMethod(command) {
  if (!command) return 'unknown'
  if (isGitInstall(command)) return isPinnedGitInstall(command) ? 'pinned' : 'git'
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
  if (method === 'pinned') {
    throw new Error(
      'התקנת Hermes משתמשת במקור מותאם אישית. עדכן באמצעות מנגנון ההתקנה שלה או עבור להתקנה הרשמית של Hermes.'
    )
  }
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

module.exports = {
  HERMES_MIN_VERSION,
  HERMES_COMPAT_RANGE,
  parseVersion,
  isVersionSupported,
  assertRunningVersionSupported,
  installRepoRoot,
  isGitInstall,
  isPinnedGitInstall,
  captureInstallCommit,
  resetInstallCheckout,
  classifyInstallMethod,
  assertUpdateMethodSupported
}
