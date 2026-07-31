import path from 'node:path'
import { describe, expect, it } from 'vitest'
import compat from '../../electron/hermes-compat.cjs'
import { HERMES_COMPAT_RANGE } from './hermes/compat'

describe('electron hermes-compat', () => {
  it('shares the exact range with the renderer contract', () => {
    expect(compat.HERMES_COMPAT_RANGE).toBe(HERMES_COMPAT_RANGE)
    expect(compat.HERMES_COMPAT_RANGE).toBe('>=0.19.0 <0.20.0')
  })

  it('parses and gates versions identically to the renderer', () => {
    expect(compat.parseVersion('Hermes Agent v0.19.1 (2026.6.19)')).toEqual({ major: 0, minor: 19, patch: 1 })
    expect(compat.isVersionSupported('v0.19.0')).toBe(true)
    expect(compat.isVersionSupported('v0.18.9')).toBe(false)
    expect(compat.isVersionSupported('v0.20.0')).toBe(false)
    expect(compat.isVersionSupported(null)).toBe(false)
  })

  it('derives the git repo root three levels above the hermes executable', () => {
    const exe = path.join('C:', 'x', 'hermes-agent', 'venv', 'Scripts', 'hermes.exe')
    expect(path.basename(compat.installRepoRoot(exe))).toBe('hermes-agent')
  })
})
