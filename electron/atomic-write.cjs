const fs = require('node:fs')
const path = require('node:path')

// Single atomic-write primitive shared across the codebase: write to a
// pid-scoped temp sibling, then rename it over the target. The rename is an
// atomic directory-entry swap on the same volume (POSIX rename / Windows
// MoveFileEx REPLACE_EXISTING), so a crash mid-write can never leave a
// half-written file in place — unlike a copy, which truncates the target first.
// Kept in its own tiny module so every writer shares one implementation
// (including the temp-cleanup-on-rename-failure, easy to forget by hand).
//
// Options (all optional):
//   encoding    - defaults to 'utf8'.
//   mode        - fs.writeFileSync mode, defaults to 0o600 (owner-only). Pass
//                 `null` explicitly to omit the mode entirely (e.g. Windows
//                 callers that document POSIX mode bits are not a real ACL
//                 there and choose not to imply otherwise).
//   chmodAfter  - if set, chmod the temp file to this mode before the rename,
//                 as a best-effort belt-and-suspenders pass on filesystems
//                 where the initial mode can be affected by umask. Failures
//                 are swallowed (the caller's real confidentiality boundary
//                 is documented at the call site, not this bit).
function safeWrite(filePath, content, options = {}) {
  const encoding = options.encoding || 'utf8'
  const hasMode = Object.prototype.hasOwnProperty.call(options, 'mode')
  const mode = hasMode ? options.mode : 0o600
  const writeOptions = mode === null || mode === undefined ? { encoding } : { encoding, mode }

  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const temporary = `${filePath}.${process.pid}.tmp`
  fs.writeFileSync(temporary, content, writeOptions)
  if (options.chmodAfter !== undefined) {
    try {
      fs.chmodSync(temporary, options.chmodAfter)
    } catch {
      /* best-effort on exotic filesystems */
    }
  }
  try {
    fs.renameSync(temporary, filePath)
  } catch (error) {
    try { fs.unlinkSync(temporary) } catch { /* leave nothing behind on failure */ }
    throw error
  }
  return filePath
}

module.exports = { safeWrite }
