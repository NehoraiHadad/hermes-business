import { createRequire } from 'node:module'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const originalHome = process.env.HERMES_HOME
let home = ''

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), 'hermes-tg-policy-'))
  process.env.HERMES_HOME = home
})

afterEach(() => {
  if (originalHome === undefined) delete process.env.HERMES_HOME
  else process.env.HERMES_HOME = originalHome
  if (home) rmSync(home, { recursive: true, force: true })
})

type PolicyModule = {
  getTelegramPolicy: () => { version: 1; mode: string; reply_chats: string[] }
  setTelegramPolicy: (candidate: unknown) => { version: 1; mode: string; reply_chats: string[] }
  normalizePolicy: (candidate: unknown) => { version: 1; mode: string; reply_chats: string[] }
}

function load(): PolicyModule {
  return require('../../electron/telegram-policy.cjs') as PolicyModule
}

describe('Electron Telegram policy persistence', () => {
  it('defaults to read-only when the file is missing or garbage', () => {
    const { getTelegramPolicy, normalizePolicy } = load()
    expect(getTelegramPolicy()).toEqual({ version: 1, mode: 'read_only', reply_chats: [] })
    expect(normalizePolicy({ mode: 'answer_all' })).toEqual({
      version: 1,
      mode: 'read_only',
      reply_chats: []
    })
  })

  it('normalizes, de-duplicates and round-trips selected targets through disk', () => {
    const { setTelegramPolicy, getTelegramPolicy } = load()
    const saved = setTelegramPolicy({
      mode: 'selected_chats',
      reply_chats: 'telegram:123, 123\n@MyGroup\n-1001234567890'
    })
    expect(saved.mode).toBe('selected_chats')
    expect(saved.reply_chats).toEqual(['123', 'mygroup', '-1001234567890'])
    expect(getTelegramPolicy()).toEqual(saved)
    const raw = JSON.parse(readFileSync(path.join(home, 'business', 'telegram-policy.json'), 'utf8'))
    expect(raw.mode).toBe('selected_chats')
  })

  it('accepts full_access and refuses selected mode with no targets', () => {
    const { setTelegramPolicy } = load()
    expect(setTelegramPolicy({ mode: 'full_access', reply_chats: [] }).mode).toBe('full_access')
    expect(() => setTelegramPolicy({ mode: 'selected_chats', reply_chats: [] })).toThrow()
  })
})
