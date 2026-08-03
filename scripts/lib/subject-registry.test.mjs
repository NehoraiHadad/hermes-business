import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  APP_RUNTIME_INPUTS,
  BUILD_PIPELINE_INPUTS,
  CATEGORIES,
  EVIDENCE_SUBJECTS,
  PACKAGED_INPUTS,
  RECAPTURE,
  SUBJECT_SCHEME,
  THIN_INSTALLER_INPUTS
} from './subject-registry.mjs'
import { CATEGORIES as GATE_CATEGORIES } from './evidence-gates.mjs'
import { resolveSubjects } from './subject-hash.mjs'
import { repoRoot } from './source-fingerprint.mjs'
import { packagingStages } from '../package-win.mjs'

// The registry is the single declarative source of truth; these guard its shape
// so a category can never be attested by one gate and ignored by another.

describe('subject registry integrity', () => {
  it('every gate-known category has subjects and a recapture hint', () => {
    for (const c of GATE_CATEGORIES) {
      expect(EVIDENCE_SUBJECTS[c], `subjects for ${c}`).toBeTruthy()
      expect(typeof RECAPTURE[c], `recapture hint for ${c}`).toBe('string')
    }
    expect([...CATEGORIES].sort()).toEqual([...GATE_CATEGORIES].sort())
  })

  it('packaged-e2e attests the full packaged input set', () => {
    expect(EVIDENCE_SUBJECTS['packaged-e2e']).toBe(PACKAGED_INPUTS)
  })

  it('PACKAGED_INPUTS = app runtime + build pipeline (transforms count too)', () => {
    expect(PACKAGED_INPUTS).toEqual([...APP_RUNTIME_INPUTS, ...BUILD_PIPELINE_INPUTS])
    expect(BUILD_PIPELINE_INPUTS.length).toBeGreaterThan(0)
    expect(THIN_INSTALLER_INPUTS.length).toBeGreaterThan(0)
  })

  it('SUBJECT_SCHEME is a positive integer, bumped past the narrow-set scheme', () => {
    expect(Number.isInteger(SUBJECT_SCHEME)).toBe(true)
    expect(SUBJECT_SCHEME).toBeGreaterThanOrEqual(2)
  })
})

describe('packaged input set — resolved over the real repo', () => {
  const files = resolveSubjects(repoRoot(), PACKAGED_INPUTS)

  it('spans renderer sources, electron runtime, hermes-plugin and installer', () => {
    const hasPrefix = p => files.some(f => f.startsWith(p))
    expect(hasPrefix('src/')).toBe(true)
    expect(hasPrefix('electron/')).toBe(true)
    expect(hasPrefix('hermes-plugin/')).toBe(true)
    expect(files).toContain('installer/bootstrap.ps1')
    expect(files).toContain('package.json')
    expect(files).toContain('index.html')
  })

  it('includes the build-pipeline transforms that produce the shipped bytes', () => {
    expect(files).toContain('scripts/after-pack.cjs')
    expect(files).toContain('scripts/build-plugin.mjs')
    expect(files).toContain('scripts/gen-build-attestation.mjs')
    expect(files).toContain('scripts/lib/build-attestation.mjs')
  })

  it('thin-installer subjects span the whole installer + harness contract', () => {
    const t = resolveSubjects(repoRoot(), EVIDENCE_SUBJECTS['thin-installer'])
    for (const f of [
      'installer/business-bootstrap.nsi',
      'scripts/build-bootstrap.ps1',
      'scripts/verify-bootstrap.ps1',
      'scripts/e2e-thin-network-installer.ps1',
      'scripts/e2e-companion-nsis-contract.ps1',
      'hermes-compat.json'
    ]) {
      expect(t, f).toContain(f)
    }
    // whole installer library + PowerShell harness helpers, via dir selectors
    expect(t.some(f => f.startsWith('installer/lib/'))).toBe(true)
    expect(t.some(f => f.startsWith('scripts/lib/') && f.endsWith('.ps1'))).toBe(true)
    expect(t.some(f => f.startsWith('scripts/lib/tests/'))).toBe(true)
  })

  it('never hashes generated outputs, node_modules, tests or evidence envelopes', () => {
    for (const f of files) {
      expect(f.startsWith('dist/'), f).toBe(false)
      expect(f.startsWith('release/'), f).toBe(false)
      expect(f.includes('node_modules/'), f).toBe(false)
      expect(f.startsWith('docs/evidence/'), f).toBe(false)
      expect(/\.test\.(cjs|mjs|js|jsx|ts|tsx|py)$/.test(f), f).toBe(false)
      expect(f.includes('__pycache__'), f).toBe(false)
    }
  })
})

describe('recapture hints match the real capture contract', () => {
  // requirePassProof (evidence-gates.mjs) rejects a passed packaged-e2e envelope
  // unless summary carries build_nonce + release_binding_digest + installer_sha256.
  // The ONLY path that machine-writes those is scripts/e2e-exact-artifact.mjs, a
  // stage of the package pipeline. A plain
  //   e2e-installed-isolated.mjs | capture-evidence.mjs packaged-e2e -
  // pipe mints an UNBOUND passed envelope the verifier then rejects, so the hint
  // must never send an operator down that path (verified live 2026-08-03).
  it('packaged-e2e points at the exact-artifact package stage, never the unbound plain pipe', () => {
    const hint = RECAPTURE['packaged-e2e']
    expect(hint).toMatch(/package:win:qa/)
    expect(hint).toMatch(/exact-artifact/)
    expect(hint).toMatch(/HERMES_BUSINESS_E2E_APPROVAL=1/)
    expect(hint).not.toMatch(/build:test-packaged/)
    expect(hint).not.toMatch(/capture-evidence\.mjs packaged-e2e/)
  })

  it('approval is captured by the same exact-artifact run, not a standalone pipe', () => {
    expect(RECAPTURE.approval).toMatch(/package:win:qa/)
    expect(RECAPTURE.approval).toMatch(/exact-artifact/)
    expect(RECAPTURE.approval).not.toMatch(/capture-evidence\.mjs approval/)
  })

  it('the referenced pipeline script and stage actually exist and are wired', () => {
    const pkg = JSON.parse(readFileSync(path.join(repoRoot(), 'package.json'), 'utf8'))
    expect(pkg.scripts['package:win:qa']).toContain('package-win.mjs')
    expect(existsSync(path.join(repoRoot(), 'scripts', 'e2e-exact-artifact.mjs'))).toBe(true)
    for (const channel of ['public', 'qa']) {
      const scripts = packagingStages(channel).map(s => s.script)
      expect(scripts, channel).toContain('scripts/e2e-exact-artifact.mjs')
    }
  })
})

describe('evidence subjects never include the evidence envelopes themselves', () => {
  it('so an evidence-only edit can never self-invalidate a passed envelope', () => {
    for (const c of CATEGORIES) {
      const files = resolveSubjects(repoRoot(), EVIDENCE_SUBJECTS[c])
      expect(files.some(f => f.startsWith('docs/evidence/')), c).toBe(false)
    }
  })
})
