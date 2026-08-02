import { describe, expect, it } from 'vitest'
import { measureCandidate, assembleExactArtifactRaw, assessExactArtifactRun, selectVersionedInstaller } from './exact-artifact.mjs'
import { assertMachineCaptured } from './evidence-capture.mjs'

const NONCE = 'deadbeefdeadbeefdeadbeefdeadbeef'
const candidate = { installer_sha256: 'a'.repeat(64), build_nonce: NONCE, release_binding_digest: 'b'.repeat(64) }

describe('selectVersionedInstaller', () => {
  it('ignores stale and thin-bootstrap executables', () => {
    const result = selectVersionedInstaller([
      "תכל'ס Setup 0.3.3.exe",
      'Hermes-Business-Web-Setup-0.4.0-alpha.1.exe',
      "תכל'ס Setup 0.4.0-alpha.1.exe"
    ], '0.4.0-alpha.1')
    expect(result).toEqual({ ok: true, name: "תכל'ס Setup 0.4.0-alpha.1.exe", errors: [] })
  })

  it('fails closed when the current version is missing or ambiguous', () => {
    expect(selectVersionedInstaller(['old.exe'], '0.4.0-alpha.1').ok).toBe(false)
    expect(selectVersionedInstaller(['a-0.4.0.exe', 'b-0.4.0.exe'], '0.4.0').ok).toBe(false)
  })
})

function goodRun(overrides = {}) {
  return {
    ok: true,
    isolation: { runtime_mode: 'qa-isolated' },
    teardown: { live_home_untouched: true },
    exact_staged_artifact: true,
    running_nonce: NONCE,
    ...overrides
  }
}

describe('measureCandidate — all measured, none hand-entered', () => {
  it('ok when every field is present', () => {
    const m = measureCandidate({ installerSha256: 'a'.repeat(64), buildNonce: NONCE, releaseBindingDigest: 'b'.repeat(64) })
    expect(m.ok).toBe(true)
    expect(m.candidate.build_nonce).toBe(NONCE)
  })
  it('fails honestly when the report binding is missing (gen-release-report not run)', () => {
    const m = measureCandidate({ installerSha256: 'a'.repeat(64), buildNonce: NONCE })
    expect(m.ok).toBe(false)
    expect(m.errors.join(' ')).toMatch(/release_binding_digest/)
  })
})

describe('assessExactArtifactRun (AUTOMATED EXACT-ARTIFACT CAPTURE)', () => {
  it('HAPPY: exact artifact + matching non-empty nonce → machine binding reachable', () => {
    const v = assessExactArtifactRun({ candidate, harnessReport: goodRun() })
    expect(v.ok).toBe(true)
    expect(v.errors).toEqual([])
    expect(v.binding).toMatchObject({ capture_method: 'machine', build_nonce: NONCE, installer_sha256: candidate.installer_sha256 })
    // The captured raw survives the manual-binding guard.
    expect(assertMachineCaptured({ ...v.binding })).toEqual([])
  })

  it('ADVERSARIAL: nonce ABSENT (running app echoed nothing) → fail closed', () => {
    const v = assessExactArtifactRun({ candidate, harnessReport: goodRun({ running_nonce: null }) })
    expect(v.ok).toBe(false)
    expect(v.errors.join(' ')).toMatch(/nonce absent/)
    expect(v.binding).toBeNull()
  })

  it('ADVERSARIAL: nonce MISMATCH (wrong binary) → fail closed', () => {
    const v = assessExactArtifactRun({ candidate, harnessReport: goodRun({ running_nonce: 'f'.repeat(32) }) })
    expect(v.ok).toBe(false)
    expect(v.errors.join(' ')).toMatch(/disagrees|wrong binary/)
    expect(v.binding).toBeNull()
  })

  it('ADVERSARIAL: not the EXACT staged artifact → fail closed', () => {
    const v = assessExactArtifactRun({ candidate, harnessReport: goodRun({ exact_staged_artifact: false }) })
    expect(v.ok).toBe(false)
    expect(v.errors.join(' ')).toMatch(/exact immutable staged artifact/)
  })

  it('ADVERSARIAL: a failed isolated run cannot mint a passed binding', () => {
    const v = assessExactArtifactRun({ candidate, harnessReport: goodRun({ ok: false }) })
    expect(v.ok).toBe(false)
  })

  it('MANUAL-PATH: the assembled raw is always machine-captured (no hand-entered field survives)', () => {
    const raw = assembleExactArtifactRaw({ harnessReport: goodRun(), candidate })
    // capture_method is never set to anything but machine downstream; a caller
    // trying to inject a manual capture_method is rejected by the guard.
    expect(assertMachineCaptured({ capture_method: 'manual' }).length).toBeGreaterThan(0)
    expect(assertMachineCaptured({ capture_method: 'machine', manual_entry: true }).length).toBeGreaterThan(0)
    expect(raw.build_binding.build_nonce).toBe(NONCE)
    expect(raw.running_nonce).toBe(NONCE)
  })
})
