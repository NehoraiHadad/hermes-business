import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('managed Hermes process ownership', () => {
  it('ignores a stale process exit after a restart installed a new process', () => {
    // The spawn/health launch path (and its stale-exit race guard) now lives in
    // runtime-launch.cjs; the process handle is owned by runtime-state.cjs via
    // getHermesProcess()/setHermesProcess().
    const source = readFileSync(path.resolve('electron/runtime-launch.cjs'), 'utf8')
    expect(source).toContain('if (getHermesProcess() !== processInstance) return')
    expect(source.indexOf('setHermesProcess(processInstance)')).toBeLessThan(
      source.indexOf("processInstance.on('exit'")
    )
  })
})
