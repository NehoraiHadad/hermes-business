import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { installCompanionBackend } from './backend-install.cjs'

// Prove installCompanionBackend is transactional: if the dashboard payload commit
// fails AFTER the config was enabled, it rolls the config enablement back to its
// preexisting bytes — no partial state, no config that claims an installed door
// with nothing behind it. The failure is injected with real filesystem state (a
// plain FILE planted where the dashboard directory must be created makes the
// commit's mkdirSync throw ENOTDIR), so no fs mocking and no real Hermes.

let home: string
const originalHome = process.env.HERMES_HOME
const originalProfile = process.env.HERMES_PROFILE
const configPath = () => join(home, 'config.yaml')
const pluginDir = () => join(home, 'plugins', 'business-shell')
const dashDir = () => join(pluginDir(), 'dashboard')

// Block dashboard creation: plant a FILE at <home>/plugins/business-shell so the
// commit's mkdirSync(<...>/business-shell/dashboard) cannot create a dir under it.
const blockCommit = () => {
  mkdirSync(join(home, 'plugins'), { recursive: true })
  writeFileSync(pluginDir(), 'not-a-directory', 'utf8')
}

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'hbp-rollback-'))
  process.env.HERMES_HOME = home
  delete process.env.HERMES_PROFILE
})
afterEach(() => {
  if (originalHome === undefined) delete process.env.HERMES_HOME
  else process.env.HERMES_HOME = originalHome
  if (originalProfile === undefined) delete process.env.HERMES_PROFILE
  else process.env.HERMES_PROFILE = originalProfile
  rmSync(home, { recursive: true, force: true })
})

describe('installCompanionBackend rolls back a failed payload commit', () => {
  it('restores the preexisting config byte-for-byte (enablement undone)', () => {
    writeFileSync(configPath(), 'model: gpt-test\n', 'utf8')
    const configBefore = readFileSync(configPath())
    blockCommit()

    const result = installCompanionBackend()

    expect(result.ok).toBe(false)
    expect(String(result.reason)).toMatch(/rolled back/)
    // The config was enabled (business-shell added) then rolled back to its exact
    // prior bytes — proving the enablement is undone on a failed commit.
    expect(readFileSync(configPath()).equals(configBefore)).toBe(true)
    expect(readFileSync(configPath(), 'utf8')).not.toMatch(/business-shell/)
    expect(existsSync(dashDir())).toBe(false)
  })

  it('restores an absent config when there was none before', () => {
    expect(existsSync(configPath())).toBe(false)
    blockCommit()

    const result = installCompanionBackend()

    expect(result.ok).toBe(false)
    expect(existsSync(configPath())).toBe(false) // enablement rolled back (config removed)
    expect(existsSync(dashDir())).toBe(false)
  })
})
