const { app } = require('electron')
const { createHash } = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const {
  hermesHome,
  desktopPluginSource,
  bootstrapSkillSource,
  companionBootstrapSource,
  whatsappPolicyPluginSource,
  WHATSAPP_POLICY_PLUGIN_FILES
} = require('./paths.cjs')
const { safeWrite } = require('./atomic-write.cjs')
const { installCompanionBackend, stageBackendPayload } = require('./backend-install.cjs')
const { stageBootstrapLibrary } = require('./bootstrap-stage.cjs')

// Installs the bundled Desktop Plugin and its first-run bootstrap Skill into the
// Hermes home, recording an integrity receipt. Also stages the payload for the
// PowerShell bootstrap installer when Hermes is not yet present. The read-only
// companion backend (dashboard/) install + config enable live in
// backend-install.cjs so this file stays focused on the desktop-plugin contract.

function stageBusinessBootstrap(options = {}) {
  const isPackaged = options.isPackaged ?? app.isPackaged
  const resourcesPath = options.resourcesPath || process.resourcesPath
  const tempPath = options.tempPath || app.getPath('temp')
  const packagedRoot = path.join(resourcesPath, 'business-bootstrap')
  const sourceRoot = isPackaged ? packagedRoot : path.join(__dirname, '..')
  const sources = isPackaged
    ? {
        script: path.join(sourceRoot, 'bootstrap.ps1'),
        companionModule: path.join(sourceRoot, 'bootstrap-companion.ps1'),
        plugin: path.join(sourceRoot, 'plugin.js'),
        skill: path.join(sourceRoot, 'business-bootstrap.SKILL.md'),
        welcomeSkill: path.join(sourceRoot, 'tachles-welcome.SKILL.md'),
        partnerSkill: path.join(sourceRoot, 'business-partner.SKILL.md')
      }
    : {
        script: path.join(sourceRoot, 'installer', 'bootstrap.ps1'),
        companionModule: companionBootstrapSource(),
        plugin: path.join(sourceRoot, 'hermes-plugin', 'business-shell', 'plugin.js'),
        skill: path.join(sourceRoot, 'hermes-plugin', 'business-shell', 'skills', 'business-bootstrap', 'SKILL.md'),
        welcomeSkill: path.join(sourceRoot, 'hermes-plugin', 'business-shell', 'skills', 'tachles-welcome', 'SKILL.md'),
        partnerSkill: path.join(sourceRoot, 'hermes-plugin', 'business-partner', 'SKILL.md')
      }
  for (const [name, source] of Object.entries(sources)) {
    if (!fs.existsSync(source)) throw new Error(`The packaged ${name} payload is missing`)
  }
  const stagingRoot = fs.mkdtempSync(path.join(tempPath, 'hermes-business-bootstrap-'))
  fs.copyFileSync(sources.script, path.join(stagingRoot, 'bootstrap.ps1'))
  fs.copyFileSync(sources.companionModule, path.join(stagingRoot, 'bootstrap-companion.ps1'))
  fs.copyFileSync(sources.plugin, path.join(stagingRoot, 'plugin.js'))
  fs.copyFileSync(sources.skill, path.join(stagingRoot, 'business-bootstrap.SKILL.md'))
  fs.copyFileSync(sources.welcomeSkill, path.join(stagingRoot, 'tachles-welcome.SKILL.md'))
  fs.copyFileSync(sources.partnerSkill, path.join(stagingRoot, 'business-partner.SKILL.md'))
  stageBootstrapLibrary(sourceRoot, stagingRoot, isPackaged)
  stageWhatsappPolicyPayload(sourceRoot, stagingRoot, isPackaged)
  stageCommunityPayload(sourceRoot, stagingRoot, isPackaged)
  // The companion backend ships in the SAME staged payload so the bootstrap can
  // install desktop plugin + backend as one transaction (see BusinessInstall.ps1).
  stageBackendPayload(sourceRoot, stagingRoot, isPackaged)
  return stagingRoot
}

const COMMUNITY_REQUIRED_FILES = Object.freeze([
  'scripts/community-generate.mjs',
  'scripts/community-provision.mjs',
  'assets/community-skills/community-bootstrap/SKILL.md',
  'assets/community-skills/community-admin/SKILL.md',
  'hermes-plugin/community-archive/plugin.yaml',
  'hermes-plugin/community-archive/__init__.py',
  'node_modules/js-yaml/package.json',
  'node_modules/argparse/package.json'
])

function stageCommunityPayload(sourceRoot, stagingRoot, isPackaged) {
  const target = path.join(stagingRoot, 'community')
  if (isPackaged) {
    const source = path.join(sourceRoot, 'community')
    for (const relative of COMMUNITY_REQUIRED_FILES) {
      if (!fs.existsSync(path.join(source, relative))) {
        throw new Error(`The packaged community payload is missing: ${relative}`)
      }
    }
    fs.cpSync(source, target, { recursive: true })
    return
  }

  const include = [
    ['scripts/community-generate.mjs', 'scripts/community-generate.mjs'],
    ['scripts/community-provision.mjs', 'scripts/community-provision.mjs'],
    ['scripts/lib/community', 'scripts/lib/community'],
    ['assets/community-skills', 'assets/community-skills'],
    ['hermes-plugin/community-archive', 'hermes-plugin/community-archive'],
    ['node_modules/js-yaml', 'node_modules/js-yaml'],
    ['node_modules/argparse', 'node_modules/argparse']
  ]
  for (const [from, to] of include) {
    const source = path.join(sourceRoot, from)
    if (!fs.existsSync(source)) throw new Error(`The community payload is missing: ${from}`)
    fs.cpSync(source, path.join(target, to), {
      recursive: true,
      filter: candidate => !/[\\/](?:tests?|__pycache__)(?:[\\/]|$)/.test(candidate) && !/\.test\.mjs$/.test(candidate)
    })
  }
}

// The bootstrap installer reads the WhatsApp policy plugin payload from
// <PayloadRoot>/whatsapp-policy/. Packaged builds ship it under the
// business-bootstrap resource; the dev tree reads it from hermes-plugin/.
function stageWhatsappPolicyPayload(sourceRoot, stagingRoot, isPackaged) {
  const sourceDir = isPackaged
    ? path.join(sourceRoot, 'whatsapp-policy')
    : whatsappPolicyPluginSource()
  const targetDir = path.join(stagingRoot, 'whatsapp-policy')
  fs.mkdirSync(targetDir, { recursive: true })
  for (const name of WHATSAPP_POLICY_PLUGIN_FILES) {
    const source = path.join(sourceDir, name)
    if (!fs.existsSync(source)) throw new Error(`The packaged WhatsApp policy payload is missing: ${name}`)
    fs.copyFileSync(source, path.join(targetDir, name))
  }
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
  const backend = installCompanionBackend()

  return { ok: true, target, integrity, bootstrapSkill: skillTarget, bootstrapSkillIntegrity: skillIntegrity, backend }
}

module.exports = { COMMUNITY_REQUIRED_FILES, installDesktopPlugin, stageBusinessBootstrap }
