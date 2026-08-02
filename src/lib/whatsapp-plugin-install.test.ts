import { createRequire } from 'node:module'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const require = createRequire(import.meta.url)
const repoRoot = path.resolve(process.cwd())

type InstallModule = {
  installWhatsappPolicyPlugin: (options: Record<string, unknown>) => Record<string, unknown>
}
type PathsModule = {
  whatsappPolicyPluginSource: () => string
  WHATSAPP_POLICY_PLUGIN_ID: string
  WHATSAPP_POLICY_PLUGIN_FILES: string[]
  WHATSAPP_POLICY_PLUGIN_OBSOLETE_FILES: string[]
}

const install = require('../../electron/whatsapp-plugin-install.cjs') as InstallModule
const paths = require('../../electron/paths.cjs') as PathsModule

let home = ''
beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), 'hermes-plugin-'))
})
afterEach(() => {
  if (home) rmSync(home, { recursive: true, force: true })
})

describe('WhatsApp policy plugin payload', () => {
  it('ships every runtime file the loader needs', () => {
    const source = paths.whatsappPolicyPluginSource()
    for (const file of paths.WHATSAPP_POLICY_PLUGIN_FILES) {
      expect(existsSync(path.join(source, file)), `missing payload: ${file}`).toBe(true)
    }
    // plugin.yaml must declare the enforcement hook.
    expect(readFileSync(path.join(source, 'plugin.yaml'), 'utf8')).toContain('pre_gateway_dispatch')
  })
})

describe('installWhatsappPolicyPlugin', () => {
  it('copies the payload and enables via the official CLI, then writes a receipt', () => {
    const runner = vi.fn(() => ({ status: 0, stdout: '', stderr: '' }))
    const result = install.installWhatsappPolicyPlugin({
      home,
      hermesCommand: 'hermes',
      runner
    })
    expect(result.ok).toBe(true)
    expect(result.enabled).toBe(true)

    const target = path.join(home, 'plugins', paths.WHATSAPP_POLICY_PLUGIN_ID)
    for (const file of paths.WHATSAPP_POLICY_PLUGIN_FILES) {
      expect(existsSync(path.join(target, file))).toBe(true)
    }
    expect(runner).toHaveBeenCalledWith(
      'hermes',
      ['plugins', 'enable', 'business-whatsapp-policy', '--no-allow-tool-override'],
      expect.objectContaining({
        env: expect.objectContaining({ HERMES_HOME: home })
      })
    )
    const receipt = JSON.parse(readFileSync(path.join(target, 'install-receipt.json'), 'utf8'))
    expect(receipt).toMatchObject({ id: 'business-whatsapp-policy', enabled: true })
  })

  it('prunes obsolete Telegram guard modules from an existing install', () => {
    const target = path.join(home, 'plugins', paths.WHATSAPP_POLICY_PLUGIN_ID)
    const stale = path.join(target, paths.WHATSAPP_POLICY_PLUGIN_OBSOLETE_FILES[0])
    require('node:fs').mkdirSync(target, { recursive: true })
    require('node:fs').writeFileSync(stale, 'stale')
    install.installWhatsappPolicyPlugin({
      home,
      hermesCommand: 'hermes',
      runner: () => ({ status: 0, stdout: '', stderr: '' })
    })
    expect(existsSync(stale)).toBe(false)
  })

  it('re-checks enablement even when the payload receipt is unchanged', () => {
    const runner = vi.fn(() => ({ status: 0, stdout: '', stderr: '' }))
    install.installWhatsappPolicyPlugin({ home, hermesCommand: 'hermes', runner })
    install.installWhatsappPolicyPlugin({ home, hermesCommand: 'hermes', runner })
    expect(runner).toHaveBeenCalledTimes(2)
  })

  it('still copies files but reports not-enabled when Hermes is absent', () => {
    const result = install.installWhatsappPolicyPlugin({ home, hermesCommand: null })
    expect(result.ok).toBe(true)
    expect(result.enabled).toBe(false)
    expect(result.reason).toBe('hermes-not-found')
    expect(existsSync(path.join(home, 'plugins', paths.WHATSAPP_POLICY_PLUGIN_ID, '__init__.py'))).toBe(true)
  })
})

describe('installer packaging references the policy plugin', () => {
  it('package.json extraResources ships the whatsapp-policy payload', () => {
    const pkg = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'))
    const resources: Array<{ from: string; to: string }> = pkg.build.extraResources
    const entry = resources.find(item => item.to === 'business-bootstrap/whatsapp-policy') as
      | { from: string; filter?: string[] }
      | undefined
    expect(entry?.from).toBe('hermes-plugin/business-whatsapp-policy')
    // Every runtime payload file must be whitelisted so a module split can never
    // silently drop a file from the packaged companion.
    for (const file of paths.WHATSAPP_POLICY_PLUGIN_FILES) {
      expect(entry?.filter, `package.json filter missing ${file}`).toContain(file)
    }
  })

  it('bootstrap.ps1 installs and enables the plugin transactionally', () => {
    const bootstrap = readFileSync(path.join(repoRoot, 'installer', 'bootstrap.ps1'), 'utf8')
    // Every Hermes CLI call (plugin enablement, gateway) must target the selected install.
    expect(bootstrap).toContain('$env:HERMES_HOME = $HermesHome')
    // bootstrap.ps1 dot-sources its local install steps (Install-BusinessPayload)
    // from installer/lib/BusinessInstall.ps1; the transactional guarantee below
    // holds across the installer as a whole, so assert against that sourced module.
    expect(bootstrap).toContain('BusinessInstall.ps1')
    const payload = readFileSync(
      path.join(repoRoot, 'installer', 'lib', 'BusinessInstall.ps1'),
      'utf8'
    )
    // The policy payload is installed and enabled inside ONE payload transaction so
    // that a failure to enable rolls the plugin + skill back (fail closed) — the
    // transactional refactor replaced the old Install-WhatsappPolicyPlugin helper.
    expect(payload).toContain('Invoke-PayloadTransaction')
    expect(payload).toContain("Join-Path $PayloadRoot 'whatsapp-policy'")
    expect(payload).toContain('plugins enable business-whatsapp-policy')
    // Enablement must abort (throw) on non-zero exit so the transaction rolls back
    // instead of leaving the safety plugin copied-but-disabled.
    expect(payload).toMatch(/plugins enable business-whatsapp-policy[\s\S]*?\$LASTEXITCODE -ne 0[\s\S]*?throw/)
    // The thin bootstrap must copy every runtime payload file (fail-closed
    // parity with the packaged companion).
    for (const file of paths.WHATSAPP_POLICY_PLUGIN_FILES) {
      expect(payload, `BusinessInstall.ps1 missing ${file}`).toContain(`'${file}'`)
    }
    expect(payload).toContain("Remove-Item -LiteralPath $obsoletePath -Force")
  })

  it('the NSI web installer bundles the plugin payload', () => {
    const nsi = readFileSync(path.join(repoRoot, 'installer', 'business-bootstrap.nsi'), 'utf8')
    expect(nsi).toContain('whatsapp-policy')
    for (const file of paths.WHATSAPP_POLICY_PLUGIN_FILES) {
      expect(nsi).toContain(file)
    }
  })
})
