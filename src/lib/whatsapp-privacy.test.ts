import { createRequire } from 'node:module'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const repoRoot = path.resolve(process.cwd())

type PrivacyModule = {
  WHATSAPP_PRIVATE_RELATIVE_FILES: string[]
  privateHomeIsUserScoped: (home?: string) => boolean
  writeWhatsappPrivateFile: (target: string, content: string) => void
  diagnosticsExclusions: (home?: string) => string[]
  isDiagnosticsExcluded: (candidate: string, home?: string) => boolean
}

const privacy = require('../../electron/whatsapp-privacy.cjs') as PrivacyModule

let dir = ''
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'wa-privacy-'))
})
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
})

describe('WhatsApp private file writer', () => {
  it('writes the content atomically (final file, no leftover temp)', () => {
    const target = path.join(dir, 'business', 'whatsapp-policy.json')
    privacy.writeWhatsappPrivateFile(target, '{"mode":"read_only"}\n')
    expect(readFileSync(target, 'utf8')).toBe('{"mode":"read_only"}\n')
  })

  it.skipIf(process.platform === 'win32')(
    'applies 0600 on POSIX, where mode bits are a real confidentiality boundary',
    () => {
      const target = path.join(dir, 'secret.json')
      privacy.writeWhatsappPrivateFile(target, 'x')
      expect(statSync(target).mode & 0o777).toBe(0o600)
    }
  )
})

describe('Windows ACL truth: confidentiality via the per-user home, not chmod', () => {
  it('recognizes a home inside the user profile as ACL-protected', () => {
    expect(privacy.privateHomeIsUserScoped(path.join(homedir(), 'hermes'))).toBe(true)
  })

  it('flags a home outside any per-user root as NOT confidential', () => {
    const root = path.parse(homedir()).root
    const shared = path.join(root, 'hermes-shared-outside-profile-xyz')
    expect(privacy.privateHomeIsUserScoped(shared)).toBe(false)
  })
})

describe('Diagnostics exclusion', () => {
  it('lists the policy file as diagnostics-excluded', () => {
    const home = path.join(dir, 'home')
    const excluded = privacy.diagnosticsExclusions(home)
    expect(excluded).toContain(path.join(home, 'business', 'whatsapp-policy.json'))
    expect(privacy.isDiagnosticsExcluded(path.join(home, 'business', 'whatsapp-policy.json'), home)).toBe(true)
    expect(privacy.isDiagnosticsExcluded(path.join(home, 'logs', 'gateway.log'), home)).toBe(false)
  })

  it('the diagnostics bundle stays strictly allow-listed and cannot pull the policy file', () => {
    // Regression guard for the ACL-truth claim: the diagnostics bundle must never
    // read the Hermes home or add the WhatsApp policy file. It only synthesizes an
    // in-memory summary + README (zip.addFile), never addLocalFile/addLocalFolder.
    const src = readFileSync(path.join(repoRoot, 'electron', 'diagnostics.cjs'), 'utf8')
    expect(src).not.toContain('whatsapp-policy')
    expect(src).not.toMatch(/addLocalFile|addLocalFolder/)
    expect(src).not.toMatch(/readdir|readFileSync\s*\(\s*.*business/)
  })
})
