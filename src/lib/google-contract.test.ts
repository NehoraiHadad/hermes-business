import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const contract = require('../../electron/google-contract.cjs') as {
  GOOGLE_SERVICES: readonly string[]
  parseHelp: (text: string) => Record<string, boolean>
  parseAuthUrl: (stdout: string) => string | null
  parseCheckStatus: (stdout: string) => { authenticated: boolean; partial: boolean; liveOk: boolean; liveFailed: boolean }
  parseAuthCodeResult: (stdout: string) => { ok: boolean; partial: boolean }
  safeSetupError: (error: unknown, fallback: string) => string
}

describe('google-workspace v0.19.1 contract parsing', () => {
  it('extracts a raw auth URL and never expects JSON', () => {
    expect(contract.parseAuthUrl('https://accounts.google.com/o/oauth2/auth?client_id=x&scope=y')).toBe(
      'https://accounts.google.com/o/oauth2/auth?client_id=x&scope=y'
    )
    // Tolerates a trailing blank line / any leading status noise.
    expect(contract.parseAuthUrl('noise\nhttps://accounts.google.com/o/oauth2/auth?a=b\n')).toBe(
      'https://accounts.google.com/o/oauth2/auth?a=b'
    )
    expect(contract.parseAuthUrl('ERROR: No client secret stored.')).toBeNull()
    expect(contract.parseAuthUrl('{"auth_url":"https://x"}')).toBeNull()
  })

  it('reads line-oriented --check / --check-live status', () => {
    expect(contract.parseCheckStatus('AUTHENTICATED: Token valid at /home/token.json').authenticated).toBe(true)
    expect(contract.parseCheckStatus('NOT_AUTHENTICATED: No token').authenticated).toBe(false)
    const partial = contract.parseCheckStatus('AUTHENTICATED (partial): Token valid but missing 2 scopes:')
    expect(partial.authenticated).toBe(true)
    expect(partial.partial).toBe(true)
    expect(contract.parseCheckStatus('LIVE_CHECK_OK: Real API call succeeded.').liveOk).toBe(true)
    const liveFail = contract.parseCheckStatus('AUTHENTICATED\nLIVE_CHECK_FAILED: OAuth client disabled')
    expect(liveFail.authenticated).toBe(false) // live failure overrides a stale AUTHENTICATED line
    expect(liveFail.liveFailed).toBe(true)
  })

  it('reads --auth-code result lines', () => {
    expect(contract.parseAuthCodeResult('OK: Authenticated. Token saved to /x').ok).toBe(true)
    expect(contract.parseAuthCodeResult('WARNING: Token missing some Google Workspace scopes: a').partial).toBe(true)
    expect(contract.parseAuthCodeResult('ERROR: Token exchange failed').ok).toBe(false)
  })

  it('never echoes auth codes, client secrets, or tokens in errors', () => {
    const leak = 'ERROR: Token exchange failed: bad code 4/0AeanS0bSECRETcodeValue123456 at http://localhost:1/?code=4/0AbadCODEvalue123456&state=z'
    const safe = contract.safeSetupError(new Error(leak), 'fallback')
    expect(safe).not.toContain('4/0AeanS0bSECRETcodeValue123456')
    expect(safe).not.toContain('4/0AbadCODEvalue123456')
    expect(safe).toContain('<redacted>')
    expect(contract.safeSetupError(new Error('   '), 'fallback')).toBe('fallback')
    expect(contract.safeSetupError('sk-abcdefghijkl12345', 'fallback')).toContain('<redacted>')
  })

  it('exposes the fixed service set covered by v0.19.1 scopes', () => {
    expect(contract.GOOGLE_SERVICES).toContain('Gmail')
    expect(contract.GOOGLE_SERVICES).toContain('Calendar')
    expect(Object.isFrozen(contract.GOOGLE_SERVICES)).toBe(true)
  })
})

describe('google-setup driver never uses unsupported v0.19.1 flags', () => {
  const source = readFileSync(path.resolve('electron/google-setup.cjs'), 'utf8')
  it('does not pass --services all or --format json', () => {
    expect(source).not.toContain("'--services', 'all'")
    expect(source).not.toContain("'--format'")
    expect(source).not.toContain('parseJsonOutput')
  })
  it('passes an explicit HERMES_HOME to every setup subprocess', () => {
    expect(source).toContain('setupEnv()')
  })
})

// Real-installed-script contract: run the ACTUAL setup.py --help and prove our
// parser agrees with the flags v0.19.1 ships. Skips clearly when Hermes (or a
// usable Python) is absent so CI without an install stays green.
function findInstalledSetup(): { python: string; script: string } | null {
  const home = process.env.HERMES_HOME || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), '.hermes'), 'hermes')
  const script = [
    path.join(home, 'skills', 'productivity', 'google-workspace', 'scripts', 'setup.py'),
    path.join(home, 'hermes-agent', 'skills', 'productivity', 'google-workspace', 'scripts', 'setup.py')
  ].find(existsSync)
  if (!script) return null
  const pythons = process.platform === 'win32'
    ? [path.join(home, 'hermes-agent', 'venv', 'Scripts', 'python.exe'), 'python', 'python3']
    : [path.join(home, 'hermes-agent', 'venv', 'bin', 'python'), 'python3', 'python']
  const python = pythons.find(candidate => {
    if (candidate.includes(path.sep)) return existsSync(candidate)
    return spawnSync(candidate, ['--version'], { windowsHide: true }).status === 0
  })
  return python ? { python, script } : null
}

const installed = findInstalledSetup()

describe('installed setup.py --help contract', () => {
  it.skipIf(!installed)('advertises the v0.19.1 flags our driver relies on', () => {
    const help = spawnSync(installed!.python, [installed!.script, '--help'], { encoding: 'utf8', windowsHide: true })
    const text = `${help.stdout || ''}\n${help.stderr || ''}`
    const parsed = contract.parseHelp(text)
    expect(parsed.supportsAuthUrl).toBe(true)
    expect(parsed.supportsAuthCode).toBe(true)
    expect(parsed.supportsCheck).toBe(true)
    expect(parsed.supportsCheckLive).toBe(true)
    expect(parsed.supportsClientSecret).toBe(true)
    // v0.19.1 has FIXED scopes: these must NOT be present.
    expect(parsed.supportsServices).toBe(false)
    expect(parsed.supportsFormatJson).toBe(false)
  })
})
