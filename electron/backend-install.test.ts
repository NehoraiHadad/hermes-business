import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import yaml from 'js-yaml'
import { enableBackendInConfig } from './backend-install.cjs'

// Regression proof for the config-preservation contract of BOTH installers:
//   - electron/backend-install.cjs::enableBackendInConfig (best-effort) must FAIL
//     CLOSED (return false, no write) on a malformed / non-mapping config and
//     never reset it to {} and overwrite it.
//   - scripts/install-plugin.mjs (dev installer) must ABORT (non-zero exit) on the
//     same, leaving the user's config.yaml BYTE-FOR-BYTE unchanged.
// Isolated temp HERMES_HOME per case — no real Hermes is touched.

const repoRoot = resolve(__dirname, '..')
const MALFORMED = 'plugins:\n  enabled: [business-shell\nunbalanced: "\n'
const NON_MAPPING = '- business-shell\n- other\n'
let home: string
const originalHome = process.env.HERMES_BUSINESS_HOME
const originalProfile = process.env.HERMES_PROFILE

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'hbp-cfg-'))
  process.env.HERMES_BUSINESS_HOME = home
  delete process.env.HERMES_PROFILE
})
afterEach(() => {
  if (originalHome === undefined) delete process.env.HERMES_BUSINESS_HOME
  else process.env.HERMES_BUSINESS_HOME = originalHome
  if (originalProfile === undefined) delete process.env.HERMES_PROFILE
  else process.env.HERMES_PROFILE = originalProfile
  rmSync(home, { recursive: true, force: true })
})

const configPath = () => join(home, 'config.yaml')
const writeConfig = (text: string) => writeFileSync(configPath(), text, 'utf8')
const readBytes = (path: string) => readFileSync(path)

describe('enableBackendInConfig fails closed and preserves the config', () => {
  it('returns false and leaves malformed YAML byte-for-byte unchanged', () => {
    writeConfig(MALFORMED)
    const before = readBytes(configPath())
    expect(enableBackendInConfig()).toBe(false) // no false enabled success
    expect(readBytes(configPath()).equals(before)).toBe(true)
  })

  it('returns false and never clobbers a readable non-mapping config', () => {
    writeConfig(NON_MAPPING)
    const before = readBytes(configPath())
    expect(enableBackendInConfig()).toBe(false)
    expect(readBytes(configPath()).equals(before)).toBe(true)
  })

  it('enables a valid mapping while preserving unrelated keys', () => {
    writeConfig('model: gpt-test\nplugins:\n  enabled:\n  - business-whatsapp-policy\n')
    expect(enableBackendInConfig()).toBe(true)
    const text = readFileSync(configPath(), 'utf8')
    expect(text).toMatch(/business-shell/)
    expect(text).toMatch(/business-whatsapp-policy/)
    expect(text).toMatch(/model/)
  })

  it('leaves an already-enabled config byte-for-byte unchanged (idempotent, no rewrite)', () => {
    // Canonical already-enabled shape; a second enable must not rewrite the file.
    writeConfig('plugins:\n  enabled:\n  - business-shell\n  disabled: []\n')
    const before = readBytes(configPath())
    expect(enableBackendInConfig()).toBe(true)
    expect(readBytes(configPath()).equals(before)).toBe(true)
  })

  it('creates a fresh config when none exists', () => {
    expect(existsSync(configPath())).toBe(false)
    expect(enableBackendInConfig()).toBe(true)
    expect(readFileSync(configPath(), 'utf8')).toMatch(/business-shell/)
  })
})

// Hermes' disabled list takes precedence: an id in plugins.disabled never loads
// even when also enabled. Mirroring `hermes plugins enable`, enableBackendInConfig
// must add to enabled AND drop from disabled — a config with the id in both is NOT
// already-correct and must be rewritten.
const plugins = (text: string) => (yaml.load(text) as { plugins: { enabled: string[]; disabled: string[] } }).plugins

describe('enableBackendInConfig reconciles plugins.disabled (disabled precedence)', () => {
  it('enables a disabled-only id by adding to enabled and removing from disabled', () => {
    writeConfig('plugins:\n  enabled: []\n  disabled:\n  - business-shell\n')
    expect(enableBackendInConfig()).toBe(true)
    const p = plugins(readFileSync(configPath(), 'utf8'))
    expect(p.enabled).toContain('business-shell')
    expect(p.disabled).not.toContain('business-shell')
  })

  it('heals the enabled-AND-disabled false-pass by dropping the disabled entry (rewrites, not idempotent)', () => {
    writeConfig('plugins:\n  enabled:\n  - business-shell\n  disabled:\n  - business-shell\n')
    const before = readBytes(configPath())
    expect(enableBackendInConfig()).toBe(true)
    expect(readBytes(configPath()).equals(before)).toBe(false) // NOT treated as already-enabled
    const p = plugins(readFileSync(configPath(), 'utf8'))
    expect(p.enabled.filter(id => id === 'business-shell')).toHaveLength(1)
    expect(p.disabled).not.toContain('business-shell')
  })
})

describe('scripts/install-plugin.mjs aborts without corrupting the config', () => {
  const runInstaller = () =>
    execFileSync(process.execPath, [join(repoRoot, 'scripts', 'install-plugin.mjs')], {
      env: { ...process.env, HERMES_HOME: home },
      stdio: 'pipe'
    })

  it('exits non-zero on malformed YAML and leaves it byte-for-byte unchanged', () => {
    writeConfig(MALFORMED)
    const before = readBytes(configPath())
    expect(runInstaller).toThrow()
    expect(readBytes(configPath()).equals(before)).toBe(true)
  })

  it('exits non-zero on a non-mapping config and leaves it byte-for-byte unchanged', () => {
    writeConfig(NON_MAPPING)
    const before = readBytes(configPath())
    expect(runInstaller).toThrow()
    expect(readBytes(configPath()).equals(before)).toBe(true)
  })

  it('creates NO plugin/skill/backend/receipt artifacts when the config is malformed', () => {
    // Validation must run BEFORE any filesystem mutation: a bad config aborts with
    // a pristine home — nothing copied, nothing written.
    writeConfig(MALFORMED)
    expect(runInstaller).toThrow()
    expect(existsSync(join(home, 'desktop-plugins', 'business-shell', 'plugin.js'))).toBe(false)
    expect(existsSync(join(home, 'desktop-plugins', 'business-shell', 'install-receipt.json'))).toBe(false)
    expect(existsSync(join(home, 'skills', 'productivity', 'business-bootstrap', 'SKILL.md'))).toBe(false)
    expect(existsSync(join(home, 'plugins', 'business-shell', 'dashboard', 'plugin_api.py'))).toBe(false)
  })

  it('installs and enables against a valid mapping config', () => {
    writeConfig('model: gpt-test\n')
    runInstaller() // must not throw
    const text = readFileSync(configPath(), 'utf8')
    expect(text).toMatch(/business-shell/)
    expect(text).toMatch(/model/)
  })
})
