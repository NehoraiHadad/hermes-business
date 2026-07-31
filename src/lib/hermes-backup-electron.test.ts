import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import AdmZip from 'adm-zip'
import { afterAll, describe, expect, it } from 'vitest'
import backup from '../../electron/hermes-backup.cjs'

const dir = mkdtempSync(path.join(os.tmpdir(), 'hermes-backup-test-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

function writeZip(name: string): string {
  const file = path.join(dir, name)
  // A REAL archive: verifyReadableZip now parses the central directory (which
  // lives at the end of the file), so a truncated PK-only stub no longer passes.
  const zip = new AdmZip()
  zip.addFile('SOUL.md', Buffer.from('# soul'))
  zip.writeZip(file)
  return file
}

describe('electron hermes-backup verification', () => {
  it('accepts a complete, non-empty ZIP (central directory parses)', () => {
    const file = writeZip('good.zip')
    expect(() => backup.verifyReadableZip(file)).not.toThrow()
  })

  it('rejects a truncated file that only carries the PK signature', () => {
    const file = path.join(dir, 'truncated.zip')
    writeFileSync(file, Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]))
    expect(() => backup.verifyReadableZip(file)).toThrow(/ZIP|ספריית המרכז/)
  })

  it('rejects an empty file', () => {
    const file = path.join(dir, 'empty.zip')
    writeFileSync(file, Buffer.alloc(0))
    expect(() => backup.verifyReadableZip(file)).toThrow(/ריק|לא קריא/)
  })

  it('rejects a file that is not a ZIP', () => {
    const file = path.join(dir, 'notzip.zip')
    writeFileSync(file, Buffer.from('hello world'))
    expect(() => backup.verifyReadableZip(file)).toThrow(/ZIP/)
  })

  it('rejects a missing backup', () => {
    expect(() => backup.verifyReadableZip(path.join(dir, 'nope.zip'))).toThrow()
  })

  it('prefers the path printed by hermes backup, falling back to the requested path', () => {
    const printed = writeZip('printed.zip')
    const requested = writeZip('requested.zip')
    expect(backup.resolveBackupPath(requested, `Backing up 3 files ...\nBackup complete: ${printed}`)).toBe(printed)
    expect(backup.resolveBackupPath(requested, 'no path here')).toBe(requested)
  })
})
