const fs = require('node:fs')
const path = require('node:path')

// The native stamp owns modern Hermes' version and update steward. Restore its
// exact bytes with the checkout so rollback never leaves a newer identity on
// older code. Undefined denotes a historical journal that captured no stamp.
function validInstallStamp(value, commit) {
  if (value === null) return true
  if (typeof value !== 'string' || value.length > 65536) return false
  try {
    const data = JSON.parse(value.replace(/^\uFEFF/, ''))
    return data && typeof data === 'object' && !Array.isArray(data) &&
      /^[0-9a-f]{40}$/i.test(data.commit) && typeof data.updateMechanism === 'string' &&
      (commit === undefined || data.commit.toLowerCase() === String(commit).toLowerCase())
  } catch { return false }
}

function readInstallStamp(root, commit) {
  const file = path.join(root, 'install-stamp.json')
  let stamp
  try { stamp = fs.readFileSync(file, 'utf8') } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
  if (!validInstallStamp(stamp, commit)) throw new Error('Hermes install identity is malformed; update was not started')
  return stamp
}

module.exports = { readInstallStamp, validInstallStamp }
