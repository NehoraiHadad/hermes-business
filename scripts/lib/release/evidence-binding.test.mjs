import { describe, expect, it } from 'vitest'
import { checkCardinality, checkGateStatuses, checkPackagedBinding } from './evidence-binding.mjs'

const ALL_ONE = { 'packaged-e2e': 1, approval: 1, 'shared-state': 1, 'thin-installer': 1 }

describe('evidence cardinality (finding 6)', () => {
  it('exactly one per declared category passes', () => {
    expect(checkCardinality(ALL_ONE)).toEqual([])
  })
  it('an ABSENT category blocks', () => {
    const e = checkCardinality({ ...ALL_ONE, 'thin-installer': 0 })
    expect(e.map(x => x.code)).toContain('evidence-category-absent')
  })
  it('a RETIRED category (telegram) is no longer declared, so its absence is clean', () => {
    expect(checkCardinality(ALL_ONE).map(x => x.detail).join()).not.toMatch(/telegram/)
  })
  it('a DUPLICATE category blocks (silent-overwrite guard)', () => {
    const e = checkCardinality({ ...ALL_ONE, approval: 2 })
    expect(e.map(x => x.code)).toContain('evidence-category-duplicate')
  })
})

describe('external gates by channel (finding 6)', () => {
  const passed = { 'packaged-e2e': 'passed', approval: 'passed', 'shared-state': 'passed', 'thin-installer': 'passed' }
  it('PUBLIC requires thin-installer passed', () => {
    const r = checkGateStatuses('public', { ...passed, 'thin-installer': 'blocked' })
    expect(r.failures.map(f => f.code)).toContain('evidence-not-passed')
  })
  it('PUBLIC with all four passed is clean', () => {
    expect(checkGateStatuses('public', passed).failures).toEqual([])
  })
  it('QA MAY leave thin-installer blocked (surfaced, not failed)', () => {
    const r = checkGateStatuses('qa', { ...passed, 'thin-installer': 'blocked' })
    expect(r.failures).toEqual([])
    expect(r.externalBlockers).toEqual(['thin-installer'])
  })
  it('PILOT requires packaged-e2e/approval/shared-state passed, like qa', () => {
    const missing = checkGateStatuses('pilot', { ...passed, approval: 'blocked' })
    expect(missing.failures.map(f => f.code)).toContain('evidence-not-passed')
  })
  it('PILOT MAY leave thin-installer blocked, exactly like qa', () => {
    const r = checkGateStatuses('pilot', { ...passed, 'thin-installer': 'blocked' })
    expect(r.failures).toEqual([])
    expect(r.externalBlockers).toEqual(['thin-installer'])
  })
  it('a stray telegram status neither gates nor surfaces (category retired)', () => {
    const r = checkGateStatuses('public', { ...passed, telegram: 'blocked' })
    expect(r.failures).toEqual([])
    expect(r.externalBlockers).toEqual([])
  })
})

describe('packaged-e2e build binding (finding 4)', () => {
  const build = { build_nonce: 'n1', release_binding_digest: 'd1', installer_sha256: 's1' }
  const machine = { ...build, capture_method: 'machine' }
  it('a matching, machine-captured binding passes', () => {
    expect(checkPackagedBinding({ ...machine }, build)).toEqual([])
  })
  it('a MISSING binding is stale/wrong-build', () => {
    expect(checkPackagedBinding(null, build).map(f => f.code)).toContain('evidence-wrong-build')
  })
  it('a WRONG build_nonce (evidence from a different build) is rejected', () => {
    const e = checkPackagedBinding({ ...machine, build_nonce: 'OTHER' }, build)
    expect(e.map(f => f.code)).toContain('evidence-wrong-build')
  })
  it('a wrong release_binding_digest is rejected', () => {
    const e = checkPackagedBinding({ ...machine, release_binding_digest: 'OTHER' }, build)
    expect(e.map(f => f.code)).toContain('evidence-wrong-build')
  })
  it('ADVERSARIAL: a hand-entered binding (no machine capture) is rejected (HIGH 3)', () => {
    const e = checkPackagedBinding({ ...build }, build) // capture_method absent
    expect(e.map(f => f.code)).toContain('evidence-manual-binding')
  })
})
