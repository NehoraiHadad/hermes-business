import { describe, expect, it } from 'vitest'
import { stripDemoFixtures } from '../../../scripts/strip-demo-fixtures.mjs'

// Guards the durable production boundary that makes the "demo fixtures are
// physically absent from the shipping executable" claim TRUE: a non-demo build
// replaces the demo entry module with a fixture-free stub, tree-shaking the
// whole demo subtree out. A full-build proof lives in the acceptance run; this
// keeps the boundary honest cheaply on every `npm test`.
const posix = '/repo/src/lib/hermes/demo.ts'
const windows = 'C:\\repo\\src\\lib\\hermes\\demo.ts'

describe('stripDemoFixtures production boundary', () => {
  it('replaces the demo entry with a fixture-free, fail-closed stub in a non-demo build', () => {
    const out = stripDemoFixtures(false).load(posix)
    expect(out).toContain('createDemoBackend')
    expect(out).toContain('throw new Error')
    // None of the real fixture surface may survive into the stub.
    expect(out).not.toContain('DEMO_SESSIONS')
    expect(out).not.toContain('tomorrow-calendar')
    expect(out).not.toContain('createDemoApi')
  })

  it('matches the demo entry regardless of path separator or query suffix', () => {
    expect(stripDemoFixtures(false).load(windows)).toContain('createDemoBackend')
    expect(stripDemoFixtures(false).load(`${posix}?v=1`)).toContain('createDemoBackend')
  })

  it('leaves the real demo module intact when the build allows demo (dev/QA)', () => {
    expect(stripDemoFixtures(true).load(posix)).toBeNull()
    expect(stripDemoFixtures(true).load(windows)).toBeNull()
  })

  it('never touches non-demo modules', () => {
    expect(stripDemoFixtures(false).load('/repo/src/lib/hermes/rest.ts')).toBeNull()
    expect(stripDemoFixtures(false).load('/repo/src/lib/hermes/demo-data.ts')).toBeNull()
  })
})
