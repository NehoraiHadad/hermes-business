import { afterAll, describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { classifyInstallMethod, resetInstallCheckout } from './hermes-compat.cjs'
import { readInstallStamp, validInstallStamp } from './hermes-install-identity.cjs'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tachles-identity-test-'))
const repo = path.join(root, 'hermes-agent')
const command = path.join(repo, 'venv', 'bin', 'hermes')
const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
fs.mkdirSync(path.dirname(command), { recursive: true })
git('init')
git('config', 'user.email', 'test@example.invalid')
git('config', 'user.name', 'Test')
git('remote', 'add', 'origin', 'https://github.com/NousResearch/hermes-agent.git')
const code = path.join(repo, 'engine.txt')
fs.writeFileSync(code, 'before')
git('add', 'engine.txt')
git('commit', '-m', 'before')
const before = git('rev-parse', 'HEAD')
fs.writeFileSync(code, 'after')
git('commit', '-am', 'after')
const after = git('rev-parse', 'HEAD')
const stampPath = path.join(repo, 'install-stamp.json')
const oldStamp = JSON.stringify({ commit: before, baseVersion: '0.22.2', updateMechanism: 'self' }, null, 2) + '\n'
const newStamp = JSON.stringify({ commit: after, baseVersion: '0.23.0', updateMechanism: 'self' })
afterAll(() => fs.rmSync(root, { recursive: true, force: true }))

describe('native install identity during rollback', () => {
  it('allows an official detached release checkout to update', () => {
    git('checkout', '--detach', after)
    expect(classifyInstallMethod(command)).toBe('git')
  })
  it('restores the code and exact previous stamp bytes together', () => {
    fs.writeFileSync(stampPath, oldStamp)
    const saved = readInstallStamp(repo)
    fs.writeFileSync(stampPath, newStamp)
    expect(resetInstallCheckout(command, before, saved)).toMatchObject({ ok: true })
    expect(fs.readFileSync(code, 'utf8')).toBe('before')
    expect(fs.readFileSync(stampPath, 'utf8')).toBe(oldStamp)
  })
  it('refuses a historical journal without stamp identity before changing code', () => {
    git('checkout', '--detach', after)
    expect(resetInstallCheckout(command, before)).toMatchObject({ ok: false, reason: 'missing-install-identity' })
    expect(git('rev-parse', 'HEAD')).toBe(after)
  })
  it('rejects corrupt identity and restores a previously unstamped source install', () => {
    expect(validInstallStamp('{broken')).toBe(false)
    expect(resetInstallCheckout(command, before, newStamp)).toMatchObject({ ok: false, reason: 'invalid-install-identity' })
    expect(resetInstallCheckout(command, before, '{broken')).toMatchObject({ ok: false })
    expect(git('rev-parse', 'HEAD')).toBe(after)
    expect(resetInstallCheckout(command, before, null)).toMatchObject({ ok: true })
    expect(fs.existsSync(stampPath)).toBe(false)
  })
})
