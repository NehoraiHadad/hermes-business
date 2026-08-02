import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openFullSurface } from './open-full.cjs'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

function dependencies() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-open-full-'))
  roots.push(home)
  const unref = vi.fn()
  const spawnProcess = vi.fn(() => ({ unref }))
  const shell = { openPath: vi.fn(async () => '') }
  return { home, unref, spawnProcess, shell }
}

describe('openFullSurface', () => {
  it.each(['dashboard', 'settings'])('launches a real %s UI on a free port', async surface => {
    const deps = dependencies()
    await expect(openFullSurface(surface, { command: 'hermes.exe', ...deps })).resolves.toEqual({ ok: true })
    expect(deps.spawnProcess).toHaveBeenCalledWith(
      'hermes.exe',
      ['dashboard', '--port', '0'],
      { detached: true, stdio: 'ignore', windowsHide: true }
    )
    expect(deps.unref).toHaveBeenCalledOnce()
  })

  it('opens logs without requiring a Hermes executable', async () => {
    const deps = dependencies()
    await openFullSurface('logs', { command: null, ...deps })
    expect(deps.shell.openPath).toHaveBeenCalledWith(path.join(deps.home, 'logs'))
    expect(fs.existsSync(path.join(deps.home, 'logs'))).toBe(true)
  })

  it('fails closed for an unknown surface instead of opening the headless API', async () => {
    const deps = dependencies()
    await expect(openFullSurface('other', { command: 'hermes.exe', ...deps })).rejects.toThrow(
      'Unknown Hermes surface'
    )
    expect(deps.spawnProcess).not.toHaveBeenCalled()
  })
})
