const fs = require('node:fs')
const path = require('node:path')
const AdmZip = require('adm-zip')
const { hermesHome } = require('./paths.cjs')
const { runCaptured } = require('./process-util.cjs')

// Pre-update backup using Hermes' OWN `hermes backup --output <path>` (a full
// ZIP of the Hermes home). We do NOT invent a parallel backup format — we drive
// the official command and then verify a non-empty, readable ZIP exists before
// letting the update proceed. Hermes' update also takes its own quick snapshot;
// this is the explicit, verifiable full archive.

function resolveBackupPath(requested, stdout) {
  // `hermes backup` prints "Backup complete: <abs path>".
  const printed = String(stdout || '').match(/Backup complete:\s*(.+\.zip)\s*$/im)
  const candidate = printed ? printed[1].trim() : requested
  if (fs.existsSync(candidate)) return candidate
  if (fs.existsSync(requested)) return requested
  throw new Error('גיבוי Hermes לא נוצר לפני העדכון; העדכון בוטל')
}

function verifyReadableZip(target) {
  const stat = fs.statSync(target) // throws if missing
  if (!stat.isFile() || stat.size === 0) {
    throw new Error('גיבוי Hermes ריק או לא קריא; העדכון בוטל')
  }
  // A leading "PK" signature only proves the FIRST local-file header was
  // written — a backup truncated mid-write (disk full, killed process) still
  // starts with "PK". adm-zip reads the ZIP's central directory, which lives at
  // the END of the file, so parsing it proves the archive is complete and
  // enumerable. Zero entries means an empty/corrupt archive. We reuse the
  // adm-zip already bundled for the plugin/diagnostics flows — no new format.
  let entries
  try {
    entries = new AdmZip(target).getEntries()
  } catch (error) {
    throw new Error('גיבוי Hermes אינו ארכיון ZIP תקין (ספריית המרכז פגומה או חסרה); העדכון בוטל')
  }
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error('גיבוי Hermes ריק — אין קבצים בארכיון; העדכון בוטל')
  }
  return entries.length
}

async function createPreUpdateBackup(command) {
  const dir = path.join(hermesHome(), 'business-backups')
  fs.mkdirSync(dir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const output = path.join(dir, `pre-update-${stamp}.zip`)
  const { stdout } = await runCaptured(command, ['backup', '--output', output], 10 * 60_000)
  const resolved = resolveBackupPath(output, stdout)
  verifyReadableZip(resolved)
  return resolved
}

module.exports = { createPreUpdateBackup, resolveBackupPath, verifyReadableZip }
