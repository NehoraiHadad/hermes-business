import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { stageBusinessBootstrap } from './plugin-install.cjs'
import { DESKTOP_BACKEND_FILES, WHATSAPP_POLICY_PLUGIN_FILES } from './paths.cjs'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

function tempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-full-stage-'))
  roots.push(root)
  return root
}

function write(root: string, relative: string) {
  const target = path.join(root, relative)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, relative)
}

describe('stageBusinessBootstrap', () => {
  it('copies the complete packaged payload into the bootstrap working directory', () => {
    const resourcesPath = tempRoot()
    const tempPath = tempRoot()
    const payload = path.join(resourcesPath, 'business-bootstrap')
    for (const name of [
      'bootstrap.ps1',
      'bootstrap-companion.ps1',
      'plugin.js',
      'business-bootstrap.SKILL.md',
      'business-partner.SKILL.md'
    ]) write(payload, name)
    for (const name of ['Logging.ps1', 'BusinessInstall.ps1', 'enable_plugin.py']) {
      write(payload, path.join('lib', name))
    }
    for (const name of DESKTOP_BACKEND_FILES) write(payload, path.join('dashboard', name))
    for (const name of WHATSAPP_POLICY_PLUGIN_FILES) write(payload, path.join('whatsapp-policy', name))

    const staged = stageBusinessBootstrap({ isPackaged: true, resourcesPath, tempPath })

    for (const name of [
      'bootstrap.ps1',
      'bootstrap-companion.ps1',
      'plugin.js',
      'business-bootstrap.SKILL.md',
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
  })
})
