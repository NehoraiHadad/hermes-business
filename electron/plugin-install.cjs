const { app } = require('electron')
const { createHash } = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { hermesHome, desktopPluginSource, bootstrapSkillSource } = require('./paths.cjs')

// Installs the bundled Desktop Plugin and its first-run bootstrap Skill into the
// Hermes home, recording an integrity receipt. Also stages the payload for the
// PowerShell bootstrap installer when Hermes is not yet present.

function safeWrite(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  const temporary = `${filePath}.${process.pid}.tmp`
  fs.writeFileSync(temporary, content, { encoding: 'utf8', mode: 0o600 })
  fs.copyFileSync(temporary, filePath)
  fs.unlinkSync(temporary)
}

function stageBusinessBootstrap() {
  const packagedRoot = path.join(process.resourcesPath, 'business-bootstrap')
  const sourceRoot = app.isPackaged ? packagedRoot : path.join(__dirname, '..')
  const sources = app.isPackaged
    ? {
        script: path.join(sourceRoot, 'bootstrap.ps1'),
        plugin: path.join(sourceRoot, 'plugin.js'),
        skill: path.join(sourceRoot, 'business-bootstrap.SKILL.md')
      }
    : {
        script: path.join(sourceRoot, 'installer', 'bootstrap.ps1'),
        plugin: path.join(sourceRoot, 'hermes-plugin', 'business-shell', 'plugin.js'),
        skill: path.join(sourceRoot, 'hermes-plugin', 'business-shell', 'skills', 'business-bootstrap', 'SKILL.md')
      }
  for (const [name, source] of Object.entries(sources)) {
    if (!fs.existsSync(source)) throw new Error(`The packaged ${name} payload is missing`)
  }
  const stagingRoot = fs.mkdtempSync(path.join(app.getPath('temp'), 'hermes-business-bootstrap-'))
  fs.copyFileSync(sources.script, path.join(stagingRoot, 'bootstrap.ps1'))
  fs.copyFileSync(sources.plugin, path.join(stagingRoot, 'plugin.js'))
  fs.copyFileSync(sources.skill, path.join(stagingRoot, 'business-bootstrap.SKILL.md'))
  return stagingRoot
}

function installDesktopPlugin() {
  const source = desktopPluginSource()
  const skillSource = bootstrapSkillSource()
  if (!fs.existsSync(source) || !fs.existsSync(skillSource)) {
    return { ok: false, error: 'Bundled Desktop Plugin or bootstrap Skill is missing' }
  }
  const targetDir = path.join(hermesHome(), 'desktop-plugins', 'business-shell')
  const target = path.join(targetDir, 'plugin.js')
  const content = fs.readFileSync(source)
  const skillContent = fs.readFileSync(skillSource)
  const skillTarget = path.join(hermesHome(), 'skills', 'productivity', 'business-bootstrap', 'SKILL.md')
  fs.mkdirSync(targetDir, { recursive: true })
  fs.writeFileSync(target, content, { mode: 0o600 })
  fs.mkdirSync(path.dirname(skillTarget), { recursive: true })
  fs.writeFileSync(skillTarget, skillContent, { mode: 0o600 })
  const integrity = `sha256-${createHash('sha256').update(content).digest('base64')}`
  const skillIntegrity = `sha256-${createHash('sha256').update(skillContent).digest('base64')}`
  safeWrite(
    path.join(targetDir, 'install-receipt.json'),
    `${JSON.stringify(
      {
        id: 'business-shell',
        installedAt: new Date().toISOString(),
        integrity,
        bootstrapSkill: skillTarget,
        bootstrapSkillIntegrity: skillIntegrity
      },
      null,
      2
    )}\n`
  )
  return { ok: true, target, integrity, bootstrapSkill: skillTarget, bootstrapSkillIntegrity: skillIntegrity }
}

module.exports = { installDesktopPlugin, stageBusinessBootstrap }
