const { spawnSync } = require('node:child_process')
const { createHash } = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const {
  hermesHome,
  findHermes,
  whatsappPolicyPluginSource,
  WHATSAPP_POLICY_PLUGIN_ID,
  WHATSAPP_POLICY_PLUGIN_FILES,
  WHATSAPP_POLICY_PLUGIN_OBSOLETE_FILES
} = require('./paths.cjs')
const { safeWrite } = require('./atomic-write.cjs')

// Installs the fail-closed WhatsApp reply-policy plugin as a real Hermes user
// plugin and activates it through the official `hermes plugins enable` command.
// Idempotent: a receipt records the payload integrity and enablement so repeat
// launches skip the copy/enable unless the bundled payload actually changed.

function pluginTargetDir(home) {
  return path.join(home, 'plugins', WHATSAPP_POLICY_PLUGIN_ID)
}

function copyPluginFiles(sourceDir, targetDir) {
  fs.mkdirSync(targetDir, { recursive: true })
  const hash = createHash('sha256')
  for (const name of WHATSAPP_POLICY_PLUGIN_FILES) {
    const source = path.join(sourceDir, name)
    if (!fs.existsSync(source)) {
      throw new Error(`WhatsApp policy plugin payload is missing: ${name}`)
    }
    const content = fs.readFileSync(source)
    hash.update(name).update(content)
    fs.writeFileSync(path.join(targetDir, name), content, { mode: 0o600 })
  }
  for (const name of WHATSAPP_POLICY_PLUGIN_OBSOLETE_FILES) {
    fs.rmSync(path.join(targetDir, name), { force: true })
  }
  return `sha256-${hash.digest('base64')}`
}

function readReceipt(targetDir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(targetDir, 'install-receipt.json'), 'utf8'))
  } catch {
    return null
  }
}

function enablePlugin(hermesCommand, home, runner) {
  if (!hermesCommand) return { enabled: false, reason: 'hermes-not-found' }
  const result = runner(
    hermesCommand,
    ['plugins', 'enable', WHATSAPP_POLICY_PLUGIN_ID, '--no-allow-tool-override'],
    {
      encoding: 'utf8',
      windowsHide: true,
      env: { ...process.env, HERMES_HOME: home }
    }
  )
  if (!result || result.status !== 0) {
    const output = `${(result && result.stdout) || ''}${(result && result.stderr) || ''}`.trim()
    return { enabled: false, reason: 'enable-failed', output: output.slice(-2000) }
  }
  return { enabled: true }
}

function installWhatsappPolicyPlugin(options = {}) {
  const sourceDir = options.sourceDir || whatsappPolicyPluginSource()
  const home = options.home || hermesHome()
  const hermesCommand = options.hermesCommand !== undefined ? options.hermesCommand : findHermes()
  const runner = options.runner || spawnSync
  const targetDir = pluginTargetDir(home)

  let integrity
  try {
    integrity = copyPluginFiles(sourceDir, targetDir)
  } catch (error) {
    return { ok: false, error: error.message }
  }

  // Enabling is intentionally checked on every launch. A stale receipt must
  // not hide that an operator (or an update) disabled the safety plugin.
  const previous = readReceipt(targetDir)
  const unchanged = Boolean(previous && previous.integrity === integrity)
  const enableResult = enablePlugin(hermesCommand, home, runner)

  const receipt = {
    id: WHATSAPP_POLICY_PLUGIN_ID,
    installedAt: new Date().toISOString(),
    integrity,
    payloadUnchanged: unchanged,
    enabled: enableResult.enabled,
    enableReason: enableResult.reason || null
  }
  safeWrite(path.join(targetDir, 'install-receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`)

  // `changed` = the bundled payload differs from what was last installed (a plugin
  // UPDATE). The caller uses it to trigger a gateway reload so the dispatch process
  // re-runs register() — loading the new code AND publishing a fresh guard heartbeat
  // (new pid/nonce) that the desktop then re-verifies. An unchanged payload needs no reload.
  return { ok: true, target: targetDir, integrity, changed: !unchanged, ...enableResult }
}

module.exports = { installWhatsappPolicyPlugin, pluginTargetDir, copyPluginFiles, enablePlugin }
