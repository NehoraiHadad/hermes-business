import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('managed Hermes process ownership', () => {
  it('ignores a stale process exit after a restart installed a new process', () => {
    const source = readFileSync(path.resolve('electron/runtime.cjs'), 'utf8')
    expect(source).toContain('if (hermesProcess !== processInstance) return')
    expect(source.indexOf('hermesProcess = processInstance')).toBeLessThan(
      source.indexOf("processInstance.on('exit'")
    )
  })
})
