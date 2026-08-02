import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { stageBootstrapLibrary } from './bootstrap-stage.cjs'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

function tempRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-bootstrap-stage-'))
  roots.push(root)
  return root
}

describe('stageBootstrapLibrary', () => {
  it.each([
    { packaged: true, relative: 'lib' },
    { packaged: false, relative: path.join('installer', 'lib') }
  ])('stages modules and the Python helper from the $relative layout', ({ packaged, relative }) => {
    const sourceRoot = tempRoot()
    const stagingRoot = tempRoot()
    const sourceDir = path.join(sourceRoot, relative)
    fs.mkdirSync(sourceDir, { recursive: true })
    fs.writeFileSync(path.join(sourceDir, 'Logging.ps1'), 'function Write-Step {}')
    fs.writeFileSync(path.join(sourceDir, 'BusinessInstall.ps1'), 'function Install-BusinessPayload {}')
    fs.writeFileSync(path.join(sourceDir, 'enable_plugin.py'), 'print("ok")')
    fs.writeFileSync(path.join(sourceDir, 'test_enable_plugin.py'), 'raise Exception("do not ship")')

    expect(stageBootstrapLibrary(sourceRoot, stagingRoot, packaged)).toEqual([
      'BusinessInstall.ps1',
      'Logging.ps1',
      'enable_plugin.py'
    ])
    expect(fs.readdirSync(path.join(stagingRoot, 'lib')).sort()).toEqual([
      'BusinessInstall.ps1',
      'Logging.ps1',
      'enable_plugin.py'
    ])
  })
})
