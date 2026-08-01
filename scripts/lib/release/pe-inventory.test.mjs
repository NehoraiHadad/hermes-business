import { describe, expect, it } from 'vitest'
import { classifyShippedPes, evaluatePayloadSigning, isPe } from './pe-inventory.mjs'
import { signerApproved } from './signing.mjs'

const LISTING = [
  'App.exe',
  'resources/elevate.exe',
  'ffmpeg.dll',
  'libEGL.dll',
  'resources/app.asar.unpacked/native.node',
  'resources/release-manifest.json', // not a PE
  'LICENSE.electron.txt' // not a PE
]

const APPROVED = { subjects: ['Contoso, Inc.'], thumbprints: [] }
const good = { valid: true, trustedTimestamp: true, status: 'Valid', publisher: 'Contoso, Inc.', thumbprint: null }

describe('classifyShippedPes — enumerate every shipped executable (CRITICAL 2)', () => {
  it('picks up .exe/.dll/.node and ignores data files', () => {
    const r = classifyShippedPes(LISTING)
    expect(r.all).toEqual(['App.exe', 'ffmpeg.dll', 'libEGL.dll', 'resources/app.asar.unpacked/native.node', 'resources/elevate.exe'])
    expect(r.mustSign).toContain('resources/elevate.exe')
    expect(r.excluded).toEqual([])
  })
  it('isPe classifies by extension', () => {
    expect(isPe('x.EXE')).toBe(true)
    expect(isPe('x.dll')).toBe(true)
    expect(isPe('x.json')).toBe(false)
  })
  it('a JUSTIFIED exclusion drops a PE from must-sign', () => {
    const r = classifyShippedPes(LISTING, { allowlist: [{ path: 'ffmpeg.dll', reason: 'signed upstream by Electron; hash-pinned' }] })
    expect(r.mustSign).not.toContain('ffmpeg.dll')
    expect(r.excluded).toEqual([{ path: 'ffmpeg.dll', reason: 'signed upstream by Electron; hash-pinned' }])
    expect(r.unjustified).toEqual([])
  })
  it('ADVERSARIAL: an exclusion WITHOUT a reason is flagged as a hole', () => {
    const r = classifyShippedPes(LISTING, { allowlist: [{ path: 'resources/elevate.exe', reason: '' }] })
    expect(r.unjustified).toContain('resources/elevate.exe')
    // still must-sign because the exclusion is invalid
    expect(r.mustSign).toContain('resources/elevate.exe')
  })
})

describe('evaluatePayloadSigning — public covers ALL shipped PEs (CRITICAL 2)', () => {
  const pes = ['App.exe', 'resources/elevate.exe', 'ffmpeg.dll'].map(p => ({ path: p, signature: good }))

  it('every PE signed by an approved publisher → distributable', () => {
    const v = evaluatePayloadSigning({ channel: 'public', pes, allowlist: APPROVED, signerApproved })
    expect(v.failures).toEqual([])
    expect(v.distributable).toBe(true)
    expect(v.covered).toBe(3)
  })
  it('ADVERSARIAL: an unsigned elevate.exe under a signed app blocks public', () => {
    const mixed = [{ path: 'App.exe', signature: good }, { path: 'resources/elevate.exe', signature: null }]
    const v = evaluatePayloadSigning({ channel: 'public', pes: mixed, allowlist: APPROVED, signerApproved })
    expect(v.distributable).toBe(false)
    expect(v.failures.map(f => f.code)).toContain('pe-unsigned')
    expect(v.failures.find(f => f.code === 'pe-unsigned').detail).toMatch(/elevate\.exe/)
  })
  it('ADVERSARIAL: a signed-but-wrong-publisher helper blocks public', () => {
    const wrong = { ...good, publisher: 'Evil Corp' }
    const v = evaluatePayloadSigning({ channel: 'public', pes: [{ path: 'ffmpeg.dll', signature: wrong }], allowlist: APPROVED, signerApproved })
    expect(v.failures.map(f => f.code)).toContain('pe-publisher-not-approved')
  })
  it('an unjustified exclusion blocks public even if everything else is signed', () => {
    const v = evaluatePayloadSigning({ channel: 'public', pes, allowlist: APPROVED, unjustified: ['resources/elevate.exe'], signerApproved })
    expect(v.failures.map(f => f.code)).toContain('pe-exclusion-unjustified')
  })
  it('QA does not require signing', () => {
    const v = evaluatePayloadSigning({ channel: 'qa', pes: [{ path: 'App.exe', signature: null }], signerApproved })
    expect(v.failures).toEqual([])
  })
})
