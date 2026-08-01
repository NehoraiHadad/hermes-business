const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { hermesHome } = require('./paths.cjs')

// Truthful confidentiality posture for the WhatsApp reply policy file, which
// contains PII (the allow-listed phone numbers / chat ids).
//
// Windows ACL truth: POSIX mode bits like 0o600 do NOT provide confidentiality
// on NTFS. Node maps a Unix mode onto Windows only as the read-only *attribute*
// — it does not restrict which users can READ the file. Claiming "chmod 0600"
// secures the file on Windows is false. The real boundary is that the Hermes
// home lives under the per-user profile (``%LOCALAPPDATA%\hermes``), whose ACL
// is inherited to grant access to that user (plus SYSTEM/Administrators) only.
// On POSIX, 0o600 IS a real boundary, so we still set it there.
//
// Diagnostics exclusion: the policy file must never be collected into a support
// bundle. The diagnostics bundle (electron/diagnostics.cjs) is strictly
// allow-listed — it emits only a synthesized runtime summary and a README and
// never walks the Hermes home — so the policy file is excluded by construction.
// ``diagnosticsExclusions()`` documents that contract for any future collector.

const WHATSAPP_PRIVATE_RELATIVE_FILES = Object.freeze([
  path.join('business', 'whatsapp-policy.json'),
  path.join('business', 'telegram-policy.json')
])

function isWin() {
  return process.platform === 'win32'
}

// Is the Hermes home inside the current user's private profile? That per-user
// ACL — not chmod — is what actually keeps the policy file confidential on
// Windows. A caller can surface a warning when this is false (e.g. HERMES_HOME
// pointed at a shared/world-readable location).
function privateHomeIsUserScoped(home = hermesHome()) {
  const resolvedHome = path.resolve(home)
  const roots = [
    process.env.LOCALAPPDATA,
    process.env.APPDATA,
    os.homedir()
  ].filter(Boolean)
  return roots.some(root => {
    const base = path.resolve(root)
    const rel = path.relative(base, resolvedHome)
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
  })
}

// Atomic write with a truthful, platform-correct confidentiality boundary.
function writeWhatsappPrivateFile(target, content) {
  fs.mkdirSync(path.dirname(target), { recursive: true })
  const temporary = `${target}.${process.pid}.tmp`
  // On POSIX 0o600 is meaningful; on Windows it is not a confidentiality
  // control, so we do not pretend it is one — confidentiality comes from the
  // per-user home ACL asserted via privateHomeIsUserScoped().
  const options = isWin()
    ? { encoding: 'utf8' }
    : { encoding: 'utf8', mode: 0o600 }
  fs.writeFileSync(temporary, content, options)
  if (!isWin()) {
    try {
      fs.chmodSync(temporary, 0o600)
    } catch {
      // Best-effort on exotic POSIX filesystems; the home ACL still applies.
    }
  }
  fs.renameSync(temporary, target)
}

// Absolute paths a diagnostics/support bundle MUST NOT include.
function diagnosticsExclusions(home = hermesHome()) {
  return WHATSAPP_PRIVATE_RELATIVE_FILES.map(rel => path.join(home, rel))
}

// True when `candidate` resolves to one of the private, diagnostics-excluded
// WhatsApp files. Lets a collector fail closed if it ever tries to add one.
function isDiagnosticsExcluded(candidate, home = hermesHome()) {
  const resolved = path.resolve(candidate)
  return diagnosticsExclusions(home).some(
    excluded => path.resolve(excluded) === resolved
  )
}

module.exports = {
  WHATSAPP_PRIVATE_RELATIVE_FILES,
  privateHomeIsUserScoped,
  writeWhatsappPrivateFile,
  diagnosticsExclusions,
  isDiagnosticsExcluded
}
