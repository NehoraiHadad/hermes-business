import { afterAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import AdmZip from 'adm-zip'
import { resolveBackupPath, verifyReadableZip } from './hermes-backup.cjs'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-backup-test-'))
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }))

function writeRealZip(name: string): string {
  const zip = new AdmZip()
  zip.addFile('SOUL.md', Buffer.from('# soul'))
  zip.addFile('sessions/a.json', Buffer.from('{}'))
  const target = path.join(tmp, name)
  zip.writeZip(target)
  return target
}

describe('verifyReadableZip', () => {
  it('accepts a real archive and returns its entry count', () => {
    const zipPath = writeRealZip('good.zip')
    expect(verifyReadableZip(zipPath)).toBe(2)
  })

  it('rejects a file that merely starts with the PK signature but is truncated', () => {
    // Central directory is at the END of a ZIP; a truncated backup still leads
    // with "PK" but has no parseable central directory.
    const bad = path.join(tmp, 'truncated.zip')
    fs.writeFileSync(bad, Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]))
    expect(() => verifyReadableZip(bad)).toThrow(/ZIP|ספריית המרכז/)
  })

  it('rejects an empty file', () => {
    const empty = path.join(tmp, 'empty.zip')
    fs.writeFileSync(empty, Buffer.alloc(0))
    expect(() => verifyReadableZip(empty)).toThrow(/ריק|לא קריא/)
  })

  it('rejects an archive with zero entries', () => {
    const emptyZip = path.join(tmp, 'no-entries.zip')
    new AdmZip().writeZip(emptyZip)
    expect(() => verifyReadableZip(emptyZip)).toThrow(/אין קבצים|ריק/)
  })

  it('throws for a missing file', () => {
    expect(() => verifyReadableZip(path.join(tmp, 'nope.zip'))).toThrow()
  })
})

describe('resolveBackupPath', () => {
  it('prefers the path Hermes printed in "Backup complete: <path>"', () => {
    const printed = writeRealZip('printed.zip')
    const requested = path.join(tmp, 'requested.zip')
    fs.writeFileSync(requested, 'x')
    expect(resolveBackupPath(requested, `Backup complete: ${printed}`)).toBe(printed)
  })

  it('falls back to the requested path when nothing was printed', () => {
    const requested = writeRealZip('req-only.zip')
    expect(resolveBackupPath(requested, 'no path here')).toBe(requested)
  })

  it('throws when neither the printed nor requested backup exists', () => {
    expect(() => resolveBackupPath(path.join(tmp, 'ghost.zip'), '')).toThrow(/גיבוי/)
  })
})
