const fs = require('node:fs')
const path = require('node:path')

// Single atomic-write primitive shared by the plugin and companion-backend
// installers: write to a pid-scoped temp sibling, then rename it over the target.
// The rename is an atomic directory-entry swap on the same volume (POSIX rename /
// Windows MoveFileEx REPLACE_EXISTING), so a crash mid-write can never leave a
// half-written file in place — unlike a copy, which truncates the target first.
// Kept in its own tiny module so both installers share one implementation.
function safeWrite(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const temporary = `${filePath}.${process.pid}.tmp`
  fs.writeFileSync(temporary, content, { encoding: 'utf8', mode: 0o600 })
  try {
    fs.renameSync(temporary, filePath)
  } catch (error) {
    try { fs.unlinkSync(temporary) } catch { /* leave nothing behind on failure */ }
    throw error
  }
}

module.exports = { safeWrite }
