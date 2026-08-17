import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { COMMUNITY_REQUIRED_FILES, stageBusinessBootstrap } from './plugin-install.cjs'
import { DESKTOP_BACKEND_FILES, WHATSAPP_POLICY_PLUGIN_FILES } from './paths.cjs'
import { writePackagedBootstrapPayload } from './business-bootstrap.fixtures'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

function tempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-full-stage-'))
  roots.push(root)
  return root
}

describe('stageBusinessBootstrap', () => {
  it('copies the complete packaged payload into the bootstrap working directory', () => {
    const resourcesPath = tempRoot()
    const tempPath = tempRoot()
    writePackagedBootstrapPayload(resourcesPath)

    const staged = stageBusinessBootstrap({ isPackaged: true, resourcesPath, tempPath })

    for (const name of [
      'bootstrap.ps1',
      'bootstrap-companion.ps1',
      'plugin.js',
      'business-bootstrap.SKILL.md',
      'tachles-welcome.SKILL.md',
      'business-partner.SKILL.md',
      path.join('lib', 'Logging.ps1'),
      path.join('lib', 'BusinessInstall.ps1'),
      path.join('lib', 'enable_plugin.py')
    ]) expect(fs.existsSync(path.join(staged, name)), name).toBe(true)
    for (const name of DESKTOP_BACKEND_FILES) {
      expect(fs.existsSync(path.join(staged, 'dashboard', name)), name).toBe(true)
    }
    for (const name of WHATSAPP_POLICY_PLUGIN_FILES) {
      expect(fs.existsSync(path.join(staged, 'whatsapp-policy', name)), name).toBe(true)
    }
    for (const name of COMMUNITY_REQUIRED_FILES) {
      expect(fs.existsSync(path.join(staged, 'community', name)), name).toBe(true)
    }
  })
})

describe('the tachles-welcome first-run Skill ships through every install door', () => {
  const repoRoot = path.resolve(__dirname, '..')

  it('exists in the source tree the doors point at', () => {
    expect(
      fs.existsSync(
        path.join(repoRoot, 'hermes-plugin', 'business-shell', 'skills', 'tachles-welcome', 'SKILL.md')
      )
    ).toBe(true)
  })

  it('is packaged as an extraResource and installed by the thin bootstrap', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'))
    const resources: Array<{ from: string; to: string }> = pkg.build.extraResources
    const entry = resources.find(item => item.to === 'business-bootstrap/tachles-welcome.SKILL.md')
    expect(entry?.from).toBe('hermes-plugin/business-shell/skills/tachles-welcome/SKILL.md')

    const nsi = fs.readFileSync(path.join(repoRoot, 'installer', 'business-bootstrap.nsi'), 'utf8')
    expect(nsi).toContain('tachles-welcome.SKILL.md')

    const install = fs.readFileSync(path.join(repoRoot, 'installer', 'lib', 'BusinessInstall.ps1'), 'utf8')
    expect(install).toContain('tachles-welcome.SKILL.md')
    expect(install).toContain('skills\\productivity\\tachles-welcome\\SKILL.md')
    // It is installed ALONGSIDE business-bootstrap, which the welcome hands off to.
    expect(install).toContain('skills\\productivity\\business-bootstrap\\SKILL.md')
  })
})
