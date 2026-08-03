import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
// @ts-expect-error - plain CJS module without type declarations
import { createSerialGuard, normalizeOpenFileFilters } from './ipc-guards.cjs'

describe('normalizeOpenFileFilters', () => {
  it('keeps well-formed filters and returns a fresh copy, not the renderer object', () => {
    const input = [{ name: 'JSON', extensions: ['json'] }]
    const out = normalizeOpenFileFilters(input)
    expect(out).toEqual([{ name: 'JSON', extensions: ['json'] }])
    expect(out[0]).not.toBe(input[0])
    expect(out[0].extensions).not.toBe(input[0].extensions)
  })

  it('treats a missing or non-array argument as "no filter"', () => {
    expect(normalizeOpenFileFilters(undefined)).toEqual([])
    expect(normalizeOpenFileFilters(null)).toEqual([])
    expect(normalizeOpenFileFilters([])).toEqual([])
    expect(normalizeOpenFileFilters('json')).toEqual([])
    expect(normalizeOpenFileFilters({ name: 'JSON', extensions: ['json'] })).toEqual([])
    expect(normalizeOpenFileFilters(42)).toEqual([])
  })

  it('drops entries whose shape is not { name: string, extensions: string[] }', () => {
    expect(
      normalizeOpenFileFilters([
        null,
        'json',
        ['json'],
        { name: 'NoExtensions' },
        { name: 'WrongExtensions', extensions: 'json' },
        { extensions: ['json'] },
        { name: 42, extensions: ['json'] },
        { name: '   ', extensions: ['json'] },
        { name: 'AllExtensionsInvalid', extensions: [{}, 5, '', '  '] },
        { name: 'Docs', extensions: ['pdf', 'docx'] }
      ])
    ).toEqual([{ name: 'Docs', extensions: ['pdf', 'docx'] }])
  })

  it('sanitizes extensions: strips leading dots, dedupes, rejects hostile values', () => {
    expect(
      normalizeOpenFileFilters([
        {
          name: '  Client secret  ',
          extensions: ['.json', 'json', '../../etc/passwd', 'a b', 'js;rm', '*', 'tar.gz']
        }
      ])
    ).toEqual([{ name: 'Client secret', extensions: ['json', '*', 'tar.gz'] }])
  })

  it('caps pathological input so a renderer cannot flood the dialog', () => {
    const out = normalizeOpenFileFilters(
      Array.from({ length: 200 }, (_, index) => ({
        name: 'x'.repeat(500),
        extensions: Array.from({ length: 200 }, (__, extension) => `e${index}x${extension}`)
      }))
    )
    expect(out.length).toBe(24)
    expect(out[0].name.length).toBe(64)
    expect(out[0].extensions.length).toBe(32)
  })
})

// ipc.cjs itself cannot be imported here (it pulls in Electron), so assert at the
// source level that the two guards are actually wired into their channels — the
// guards are worthless if the handlers stop going through them.
describe('ipc.cjs wiring', () => {
  const source = readFileSync(fileURLToPath(new URL('./ipc.cjs', import.meta.url)), 'utf8')

  it('routes hermes:install through the serial guard and never spawns inline', () => {
    expect(source).toMatch(/const runInstallExclusively = createSerialGuard\('.+'\)/)
    expect(source).toMatch(/ipcMain\.handle\('hermes:install',[^\n]*runInstallExclusively\(performInstall\)\)/)
    // The bootstrap spawn lives in the guarded function, not in the handler body.
    expect(source).toMatch(/async function performInstall\(\)[\s\S]*?powershell\.exe/)
  })

  it('validates the renderer-supplied choose-file filters', () => {
    expect(source).toContain('filters: normalizeOpenFileFilters(filters)')
    expect(source).not.toContain('filters: filters || []')
  })
})

describe('createSerialGuard', () => {
  it('runs the task and returns its value when nothing is in flight', async () => {
    const guard = createSerialGuard('busy')
    await expect(guard(async () => 'done')).resolves.toBe('done')
  })

  it('rejects a re-entrant call with the user-facing message while one is running', async () => {
    const guard = createSerialGuard('התקנת Hermes כבר מתבצעת')
    const task = vi.fn(() => new Promise(resolve => setTimeout(() => resolve('installed'), 10)))

    const first = guard(task)
    await expect(guard(task)).rejects.toThrow('התקנת Hermes כבר מתבצעת')
    await expect(guard(task)).rejects.toBeInstanceOf(Error)
    await expect(first).resolves.toBe('installed')
    // The blocked calls never started a second bootstrap.
    expect(task).toHaveBeenCalledTimes(1)
  })

  it('clears the flag after success so a later call runs', async () => {
    const guard = createSerialGuard('busy')
    await guard(async () => 'first')
    await expect(guard(async () => 'second')).resolves.toBe('second')
  })

  it('clears the flag after a failure so a retry is possible', async () => {
    const guard = createSerialGuard('busy')
    await expect(
      guard(async () => {
        throw new Error('bootstrap failed')
      })
    ).rejects.toThrow('bootstrap failed')
    await expect(guard(async () => 'retry')).resolves.toBe('retry')
  })

  it('gives each guard its own independent flag', async () => {
    const install = createSerialGuard('install busy')
    const update = createSerialGuard('update busy')
    const pending = install(() => new Promise(resolve => setTimeout(() => resolve('i'), 5)))
    await expect(update(async () => 'u')).resolves.toBe('u')
    await expect(pending).resolves.toBe('i')
  })
})
