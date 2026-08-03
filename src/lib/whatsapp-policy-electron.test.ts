import { createRequire } from 'node:module'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const originalHome = process.env.HERMES_BUSINESS_HOME
let home = ''

beforeEach(() => {
  home = mkdtempSync(path.join(tmpdir(), 'hermes-policy-'))
  process.env.HERMES_BUSINESS_HOME = home
})

afterEach(() => {
  if (originalHome === undefined) delete process.env.HERMES_BUSINESS_HOME
  else process.env.HERMES_BUSINESS_HOME = originalHome
  if (home) rmSync(home, { recursive: true, force: true })
})

type PolicyModule = {
  getWhatsappPolicy: () => WhatsappPolicy
  setWhatsappPolicy: (candidate: unknown) => WhatsappPolicy
  normalizePolicy: (candidate: unknown) => WhatsappPolicy
}

type WhatsappPolicy = {
  version: 2; mode: string; behavior: string; instructions: string
  reply_chats: string[]; reply_groups: string[]; sources: unknown[]
}

function load(): PolicyModule {
  return require('../../electron/whatsapp-policy.cjs') as PolicyModule
}

describe('Electron WhatsApp policy persistence', () => {
  it('defaults to read-only when the file is missing or garbage', () => {
    const { getWhatsappPolicy, normalizePolicy } = load()
    expect(getWhatsappPolicy()).toEqual({
      version: 2, mode: 'read_only', behavior: 'monitor', instructions: '', reply_chats: [], reply_groups: [], sources: []
    })
    expect(normalizePolicy({ mode: 'answer_everyone' })).toEqual({
      version: 2,
      mode: 'read_only',
      behavior: 'monitor',
      instructions: '',
      reply_chats: [],
      reply_groups: [],
      sources: []
    })
  })

  it('keeps group JIDs separate from private chats', () => {
    const { setWhatsappPolicy } = load()
    const saved = setWhatsappPolicy({
      mode: 'selected_chats', reply_chats: ['15551234567'], reply_groups: ['12345@g.us']
    })
    expect(saved.reply_chats).toEqual(['15551234567'])
    expect(saved.reply_groups).toEqual(['12345@g.us'])
  })

  it('normalizes and de-duplicates selected chats and round-trips through disk', () => {
    const { setWhatsappPolicy, getWhatsappPolicy } = load()
    const saved = setWhatsappPolicy({
      mode: 'selected_chats',
      reply_chats: '+15551234567, 15551234567@s.whatsapp.net\nwhatsapp:15550000000'
    })
    expect(saved.mode).toBe('selected_chats')
    expect(saved.reply_chats).toEqual(['15551234567', '15550000000'])
    expect(getWhatsappPolicy()).toEqual(saved)
    // Persisted with 0600 semantics and valid JSON.
    const raw = JSON.parse(
      readFileSync(path.join(home, 'business', 'whatsapp-policy.json'), 'utf8')
    )
    expect(raw.mode).toBe('selected_chats')
  })

  it('refuses selected mode with no chats (fail closed, no silent downgrade)', () => {
    const { setWhatsappPolicy } = load()
    expect(() => setWhatsappPolicy({ mode: 'selected_chats', reply_chats: [] })).toThrow()
  })
})
