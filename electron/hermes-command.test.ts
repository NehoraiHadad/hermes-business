import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { invocation, spawnCommandSync } from './hermes-command.cjs'
import { installRepoRoot, launcherCandidates } from './hermes-install.cjs'
import { resolveHermesBinary } from './runtime-mode.cjs'

const roots: string[] = []
afterEach(() => roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true })))
function fixture(text: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tachles-launcher-'))
  roots.push(root)
  const file = path.join(root, 'bin', 'hermes.cmd')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, text)
  return { root, file }
}

describe('official PM launcher boundary', () => {
  it('preserves argument boundaries without invoking a shell', () => {
    // Node stands in for the PE interpreter: its -I rejection proves no shell
    // parsed the metacharacters. The resolved argv is checked independently.
    const code = 'print("native bootstrap")'
    const { file } = fixture(`@echo off\r\n"${process.execPath}" -I -c "import base64; exec(base64.b64decode('${Buffer.from(code).toString('base64')}'))" %*\r\n`)
    const args = ['a b', '"quoted"', '%PATH%', '& echo injected', 'עברית']
    expect(invocation(file, args)).toEqual([process.execPath, ['-I', '-c', code, ...args]])
    const result = spawnCommandSync(file, args, { encoding: 'utf8', shell: false })
    expect(result.status).not.toBe(0)
    expect(result.stdout).not.toContain('injected')
  })

  it('keeps an explicitly selected custom engine separate from the default CLI', () => {
    const { root } = fixture('fixture')
    const engine = path.join(root, 'custom-engine')
    const candidates = launcherCandidates(root, 'win32', engine)
    expect(candidates).toContain(path.join(engine, '.hermes', 'bin', 'hermes.cmd'))
    expect(candidates).not.toContain(path.join(root, 'bin', 'hermes.cmd'))
  })

  it('rejects an unrecognized command script', () => {
    const { file } = fixture('@echo off\necho unexpected %*')
    expect(() => invocation(file, [])).toThrow(/Unsupported official Hermes launcher/)
  })

  it('discovers the published CMD before the active legacy executable', () => {
    const { root, file } = fixture('fixture')
    const legacy = path.join(root, 'hermes-agent', 'venv', 'Scripts', 'hermes.exe')
    fs.mkdirSync(path.dirname(legacy), { recursive: true })
    fs.writeFileSync(legacy, 'fixture')
    expect(resolveHermesBinary({ hermesHome: root, hermesBinary: null })).toBe(file)
    expect(launcherCandidates(root, 'win32')).toContain(file)
    expect(installRepoRoot(file)).toBe(path.join(root, 'hermes-agent'))
    expect(installRepoRoot(path.join(root, 'hermes-agent', '.hermes', 'bin', 'hermes.cmd'))).toBe(path.join(root, 'hermes-agent'))
    expect(installRepoRoot(legacy)).toBe(path.join(root, 'hermes-agent'))
  })
})
