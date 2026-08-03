const { createHash } = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { hermesHome } = require('./paths.cjs')
const { PARTNER_SKILL_ID, partnerSkillSource } = require('./partner-personality.cjs')
const { safeWrite } = require('./atomic-write.cjs')

// Installs the packaged `business-partner` native Hermes Skill into the shared
// skills tree so it is visible and usable inside full Hermes. Idempotent: an
// integrity receipt skips the rewrite unless the bundled SKILL.md changed. This
// is a plain skill file (like the bootstrap skill), not a runtime or a plugin.

function skillTargetDir(home) {
  return path.join(home, 'skills', 'business', PARTNER_SKILL_ID)
}

function installPartnerSkill(options = {}) {
  const source = options.source || partnerSkillSource()
  const home = options.home || hermesHome()
  if (!fs.existsSync(source)) return { ok: false, error: 'Packaged business-partner Skill payload is missing' }

  const content = fs.readFileSync(source)
  const integrity = `sha256-${createHash('sha256').update(content).digest('base64')}`
  const targetDir = skillTargetDir(home)
  const target = path.join(targetDir, 'SKILL.md')
  const receiptPath = path.join(targetDir, 'install-receipt.json')

  let previous = null
  try {
    previous = JSON.parse(fs.readFileSync(receiptPath, 'utf8'))
  } catch {
    previous = null
  }
  if (previous && previous.integrity === integrity && fs.existsSync(target)) {
    return { ok: true, target, integrity, unchanged: true }
  }

  fs.mkdirSync(targetDir, { recursive: true })
  fs.writeFileSync(target, content, { mode: 0o600 })
  safeWrite(
    receiptPath,
    `${JSON.stringify({ id: PARTNER_SKILL_ID, installedAt: new Date().toISOString(), integrity }, null, 2)}\n`
  )
  return { ok: true, target, integrity, unchanged: false }
}

module.exports = { installPartnerSkill, skillTargetDir }
