import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  parseAsarHeader, flattenAsarFiles, findForbiddenEntries, findUnsafePaths,
  unsafeAsarPathReason, inspectAsar
} from './asar-index.mjs'

// Build a minimal, spec-accurate asar buffer carrying only a directory header.
function makeAsar(header) {
  const json = Buffer.from(JSON.stringify(header), 'utf8')
  const strLen = json.length
  const padded = (strLen + 3) & ~3
  const payloadLen = 4 + padded
  const region = Buffer.alloc(4 + payloadLen)
  region.writeUInt32LE(payloadLen, 0)
  region.writeUInt32LE(strLen, 4)
  json.copy(region, 8)
  const sizeBuf = Buffer.alloc(8)
  sizeBuf.writeUInt32LE(4, 0)
  sizeBuf.writeUInt32LE(region.length, 4)
  return Buffer.concat([sizeBuf, region])
}

const tmp = []
afterEach(() => { while (tmp.length) rmSync(tmp.pop(), { recursive: true, force: true }) })
function tmpAsar(buf) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'asar-'))
  tmp.push(dir)
  const file = path.join(dir, 'app.asar')
  writeFileSync(file, buf)
  return file
}

const CLEAN = { files: { electron: { files: { 'main.cjs': { size: 1 } } }, 'package.json': { size: 1 } } }
const DIRTY = {
  files: {
    electron: { files: { 'main.cjs': { size: 1 }, 'main.test.cjs': { size: 1 } } },
    'hermes-plugin': { files: { policy: { files: { tests: { files: { 'test_x.py': { size: 1 } } }, __pycache__: { files: { 'm.pyc': { size: 1 } } } } } } }
  }
}

describe('asar directory parsing + strict validation (finding 2)', () => {
  it('round-trips a synthetic header', () => {
    expect(parseAsarHeader(makeAsar(CLEAN))).toEqual(CLEAN)
  })
  it('rejects a too-short buffer', () => {
    expect(() => parseAsarHeader(Buffer.alloc(8))).toThrow(/too short/)
  })
  it('rejects a bad size-pickle marker', () => {
    const b = makeAsar(CLEAN); b.writeUInt32LE(9, 0)
    expect(() => parseAsarHeader(b)).toThrow(/marker/)
  })
  it('rejects a truncated header string', () => {
    const b = makeAsar(CLEAN); b.writeUInt32LE(b.length, 12)
    expect(() => parseAsarHeader(b)).toThrow(/truncated/)
  })
  it('rejects non-JSON / missing files-tree', () => {
    const b = makeAsar({ notFiles: {} })
    expect(() => parseAsarHeader(b)).toThrow(/files tree/)
  })
  it('a MISSING archive is reported invalid, never a pass', () => {
    const r = inspectAsar(path.join(os.tmpdir(), 'nope-xyz.asar'))
    expect(r.present).toBe(false); expect(r.valid).toBe(false)
  })
  it('a CORRUPT archive on disk is present-but-invalid (false-pass guard)', () => {
    const r = inspectAsar(tmpAsar(Buffer.from('this is not an asar at all!!')))
    expect(r.valid).toBe(false); expect(r.error).toBeTruthy()
  })
  it('an INCOMPLETE header region is invalid', () => {
    const full = makeAsar(CLEAN)
    const r = inspectAsar(tmpAsar(full.subarray(0, 12)))
    expect(r.valid).toBe(false)
  })
})

describe('forbidden packaged content', () => {
  it('a clean archive has no forbidden entries', () => {
    expect(findForbiddenEntries(flattenAsarFiles(CLEAN))).toEqual([])
  })
  it('flags shipped tests, pytest dirs and .pyc caches', () => {
    const bad = findForbiddenEntries(flattenAsarFiles(DIRTY))
    expect(bad).toContain('electron/main.test.cjs')
    expect(bad).toContain('hermes-plugin/policy/tests/test_x.py')
    expect(bad).toContain('hermes-plugin/policy/__pycache__/m.pyc')
  })
  it('exempts ROOT node_modules (incl. its own tests)', () => {
    const deps = { files: { node_modules: { files: { react: { files: { tests: { files: { 'a.test.js': { size: 1 } } } } } } } } }
    expect(findForbiddenEntries(flattenAsarFiles(deps))).toEqual([])
  })
  it('does NOT exempt a NESTED node_modules subtree (finding 10)', () => {
    const nested = { files: { electron: { files: { node_modules: { files: { 'x.test.cjs': { size: 1 } } } } } } }
    expect(findForbiddenEntries(flattenAsarFiles(nested))).toContain('electron/node_modules/x.test.cjs')
  })
})

describe('path traversal / normalization (finding 10)', () => {
  it('flags backslash, absolute, drive-letter and dot-dot', () => {
    expect(unsafeAsarPathReason('a\\b')).toMatch(/backslash/)
    expect(unsafeAsarPathReason('/etc/passwd')).toMatch(/absolute/)
    expect(unsafeAsarPathReason('C:/x')).toMatch(/absolute/)
    expect(unsafeAsarPathReason('a/../../b')).toMatch(/illegal segment/)
    expect(unsafeAsarPathReason('a/./b')).toMatch(/illegal segment/)
    expect(unsafeAsarPathReason('electron/main.cjs')).toBeNull()
  })
  it('root node_modules does NOT exempt an unsafe traversal path', () => {
    const bad = findUnsafePaths(['node_modules/react/../../../etc/x'])
    expect(bad.length).toBe(1)
  })
  it('inspectAsar surfaces unsafe paths from a written archive', () => {
    const evil = { files: { 'normal.js': { size: 1 }, '..': { files: { 'escape.js': { size: 1 } } } } }
    const r = inspectAsar(tmpAsar(makeAsar(evil)))
    expect(r.valid).toBe(true)
    expect(r.unsafe.some(u => /illegal segment/.test(u.reason))).toBe(true)
  })
})
