import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('non-interactive Electron setup processes', () => {
  it('closes stdin so Hermes cannot wait on an invisible GUI prompt', () => {
    const source = readFileSync(path.resolve('electron/process-util.cjs'), 'utf8')
    expect(source).toContain("stdio: ['ignore', 'pipe', 'pipe']")
  })
})
