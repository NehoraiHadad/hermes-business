import { describe, expect, it } from 'vitest'
import { decideRestore, normalizeRegContent, snapshotProtocol } from './real-loader-protocol.mjs'

describe('real-loader-protocol guards + normalization', () => {
  it('snapshotProtocol rejects a relative backup path (never spawns reg)', () => {
    expect(() => snapshotProtocol({ backupFile: 'relative.reg' })).toThrow(/absolute/)
  })

  it('normalizeRegContent strips BOM, CRLF and trailing blanks so two exports compare equal', () => {
    const a = '﻿Windows Registry Editor Version 5.00\r\n\r\n[HKCU\\...]\r\n"x"="1"  \r\n\r\n'
    const b = 'Windows Registry Editor Version 5.00\n\n[HKCU\\...]\n"x"="1"\n'
    expect(normalizeRegContent(a)).toBe(normalizeRegContent(b))
    expect(normalizeRegContent(null)).toBeNull()
  })
})

describe('real-loader-protocol decideRestore (crash-safe transaction + concurrent guard)', () => {
  const HINT = 'C:\\hermes\\win-unpacked\\Hermes.exe'
  const OURS = `[HKCU]\n"cmd"="${HINT} %1"`
  const SNAP = '[HKCU]\n"cmd"="C:\\\\old\\\\Handler.exe %1"'
  const FOREIGN = '[HKCU]\n"cmd"="C:\\\\other\\\\App.exe %1"'

  it('key pre-existed: imports the snapshot when the current handler is OUR launched exe', () => {
    const plan = decideRestore({ existed: true, snapshotContent: SNAP, currentState: 'present', currentContent: OURS, handlerHint: HINT })
    expect(plan).toMatchObject({ action: 'import', ok: true, preserveBackup: false })
  })

  it('key pre-existed: no-op when the registry already matches the snapshot exactly', () => {
    const plan = decideRestore({ existed: true, snapshotContent: SNAP, currentState: 'present', currentContent: SNAP, handlerHint: HINT })
    expect(plan).toMatchObject({ action: 'noop', ok: true, preserveBackup: false })
  })

  it('key pre-existed: CONCURRENT CHANGE by another actor is left untouched, backup preserved, fails', () => {
    const plan = decideRestore({ existed: true, snapshotContent: SNAP, currentState: 'present', currentContent: FOREIGN, handlerHint: HINT })
    expect(plan).toMatchObject({ action: 'noop', ok: false, preserveBackup: true, concurrentChange: true })
  })

  it('key was absent: deletes ONLY our own creation', () => {
    expect(decideRestore({ existed: false, currentState: 'present', currentContent: OURS, handlerHint: HINT })).toMatchObject({
      action: 'delete',
      ok: true
    })
  })

  it('key was absent: a FOREIGN handler now present is left untouched (fails, preserves backup)', () => {
    expect(decideRestore({ existed: false, currentState: 'present', currentContent: FOREIGN, handlerHint: HINT })).toMatchObject({
      action: 'noop',
      ok: false,
      preserveBackup: true,
      concurrentChange: true
    })
  })

  it('key was absent and still absent: nothing to do', () => {
    expect(decideRestore({ existed: false, currentState: 'absent', handlerHint: HINT })).toMatchObject({ action: 'noop', ok: true })
  })

  it('a current-query ERROR fails closed and preserves the backup (never claims ok)', () => {
    expect(decideRestore({ existed: true, snapshotContent: SNAP, currentState: 'error', handlerHint: HINT })).toMatchObject({
      action: 'noop',
      ok: false,
      preserveBackup: true
    })
  })
})
