import { createRequire } from 'node:module'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { readWhatsappDirectory } = require('../../electron/whatsapp-directory.cjs')
let root = ''

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true })
})

describe('official Hermes WhatsApp channel directory', () => {
  it('returns friendly DMs and groups without exposing other platforms', () => {
    root = mkdtempSync(path.join(tmpdir(), 'wa-directory-'))
    const file = path.join(root, 'channel_directory.json')
    writeFileSync(file, JSON.stringify({ platforms: {
      whatsapp: [
        { id: '1555@s.whatsapp.net', name: 'דני', type: 'dm' },
        { id: '123@g.us', name: 'לקוחות VIP', type: 'group' }
      ],
      telegram: [{ id: 'secret', name: 'not returned', type: 'dm' }]
    }}))
    expect(readWhatsappDirectory({ file })).toEqual([
      { id: '1555@s.whatsapp.net', name: 'דני', type: 'dm', platform: 'whatsapp' },
      { id: '123@g.us', name: 'לקוחות VIP', type: 'group', platform: 'whatsapp' }
    ])
  })

  it('fails safely when Hermes has not produced a directory yet', () => {
    expect(readWhatsappDirectory({ file: path.join(root || '.', 'missing.json') })).toEqual([])
  })
})
